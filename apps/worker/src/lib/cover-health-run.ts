/**
 * One cover-health tick — what the cron and the admin route both call.
 *
 * Platform inventory §7 row **#4**: *"D1 read + HTTP HEAD, nothing else. Broken
 * covers are the estate's most visible silent rot, and both instances need
 * it."* The script (`scripts/check-cover-health.mjs`) stays and is unchanged in
 * what it prints; both callers now share `judgeCoverProbe` and
 * `formatCoverHealthReport` out of `@lc/core`.
 *
 * ## ⚠️ This audit WRITES NOTHING, and that is not caution — it is correctness
 *
 * A broken cover URL is a QUESTION. `docs/TODO.md`'s padhard 356 *Evocation* row
 * says it exactly: the stored Open Library cover redirects to an archive.org
 * object answering 503, and the entry's own instruction is *"wait and re-run …
 * not cleared: a dead URL may be an outage, and blanking it loses where the
 * cover came from"*. An audit that healed itself would throw that away on the
 * first bad afternoon at somebody's CDN.
 *
 * ## The three counts, and why they are three
 *
 * | Count | Means | Whose problem |
 * |---|---|---|
 * | `broken` | the origin ANSWERED, and the answer was not a usable cover | this catalog's — a stored URL is wrong |
 * | `unreachable` | nothing answered at all | possibly nobody's — a timeout, a DNS blip, an outage |
 * | `missingCover` | the work has no cover URL to check | the free ladder's (`backfill-missing-covers.mjs`) |
 *
 * 🔴 **Merging `unreachable` into `broken` is the failure mode this split
 * exists to prevent** — and it is not hypothetical. **Measured 2026-09-06, the
 * first production run of this code against padhard: 8 rows failed, and 7 of
 * them were FINE.** All seven were `fetch failed` against
 * `pub-….r2.dev` (her `COVERS_BASE_URL`, which `wrangler.toml` already records
 * as *rate-limited*); re-probed by hand minutes later, three of three answered
 * **HTTP 200, `image/jpeg`, 3.4–4.2 MB**. Only the eighth — work 356
 * *Evocation*, an Open Library URL redirecting to an archive.org object — was a
 * genuine `HTTP 503`, and `docs/TODO.md` has been recording that same 503 since
 * 2026-08-23.
 *
 * So the honest reading of that night was *"1 broken, 7 unreachable"*, and a
 * merged count would have said **"8 broken covers on padhard"** — sending
 * somebody after seven covers that were never broken. The script folds them back
 * into one printed list because a person reading a script has the reason column;
 * a cron has no reader.
 *
 * ## ⚠️ What this audit is NOT the instrument for
 *
 * **KI-6** and the 50-pixel Goodreads smudge in `docs/TODO.md` both clear the
 * byte floor: a Google Books *"COVER COMING SOON"* card is a genuine 4,013-byte
 * JPEG, and `…._SX50_.jpg` is 1,980 real bytes of the right book. Both are
 * findable only by LOOKING at the image. Do not widen the floor here hoping to
 * catch them — KI-6 names the instrument that would (a hash deny-list in
 * `verifyCoverUrl`) and the condition for building it (a second hit).
 */

import {
  auditWindow,
  formatCoverHealthReport,
  judgeCoverProbe,
  resolveCoverUrl,
  type CoverHealthFinding,
  type CoverHealthRow,
} from '@lc/core';
import { readCoverHealthInputs } from '@lc/db';
import type { Env } from '../env.js';
import { recordAuditRun, type AuditRunResult } from './audit-run.js';

/**
 * 🔴 **THE CAP: 250 cover URLs per tick.**
 *
 * Why a cap at all: this is the only one of the two audits that leaves the
 * Worker, and a scheduled invocation's subrequest budget is finite (the games
 * repo records 50 on the free plan; the account moved to Workers Paid on
 * 2026-08-17, which raises it, and *"raises it"* is not a number worth betting a
 * silent cron on).
 *
 * Why 250 — **measured 2026-09-06, and one of the two numbers was a guess that
 * turned out wrong**: main holds **411** works with a cover and padhard **642**
 * (not the ~370 assumed before the script was actually run against her). So the
 * catalog is covered in **2 ticks on main and 3 on padhard**, which is still
 * fine for a defect class that does not change hour to hour. It is comfortably
 * inside any plausible subrequest budget while leaving room for the details
 * sweep, which the games repo measures spending 46 on its own — though these two
 * never share a minute (`AUDITS_CRON` is `:47`, details is `:07`).
 *
 * ⚠️ **The cap only works because the window WRAPS** — see `auditWindow`. A cap
 * with a fixed `LIMIT` would audit the first 250 covers every night, never look
 * at the rest, and report itself clean while doing it.
 */
export const COVER_HEALTH_CAP = 250;

/**
 * How many probes are in flight at once.
 *
 * ⚠️ Not unbounded, and not one. Firing 250 `fetch`es at once would hammer other
 * people's origins from one IP and is the shape that earns a WAF block; one at a
 * time would take minutes of wall clock for no benefit. Six is the sibling
 * catalog's cover-check figure and it has never been rate-limited.
 */
export const COVER_HEALTH_CONCURRENCY = 6;

/** How long one origin has to answer before this cover is `unreachable`. */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * ⚠️ **GET, not HEAD** — and the inventory row's own phrase ("HTTP HEAD") is the
 * thing being corrected here. The script has always used `fetch(url)` with no
 * method, i.e. a GET, and a good number of image CDNs answer HEAD with a 405 or
 * with no `Content-Length` at all. Switching the route to HEAD would have made
 * it disagree with the script on real rows, which is exactly the divergence the
 * shared-implementation rule exists to prevent.
 */
const UA = 'library_catalog cover-health-check';

/**
 * What the run row and `/api/health` carry.
 *
 * ⚠️ **Counts and ids, never a title and never a URL.** `audit_run.detail_json`
 * is read back by `/api/health`, which is unauthenticated on purpose. `sampleIds`
 * is bounded so a catalog-wide outage cannot write a 400-element array into a
 * column a status page reads on every load.
 */
export interface CoverHealthFindings {
  /** Works that claim a cover, catalog-wide — not just this tick's window. */
  withCover: number;
  /** Works with no cover URL at all. The free ladder's business, not this one's. */
  missingCover: number;
  /** How many URLs this tick actually asked for. */
  checked: number;
  /** How many the cap deferred to a later tick. */
  deferred: number;
  /** Where in the id-ordered list this tick's window started. */
  windowOffset: number;
  broken: number;
  unreachable: number;
  /** At most 20 work ids, so a person has somewhere to start. */
  sampleIds: number[];
}

export interface CoverHealthRunResult extends AuditRunResult<CoverHealthFindings> {
  /**
   * The full titled list — for the ADMIN ROUTE's response only.
   *
   * ⚠️ Never persisted and never on `/api/health`. It exists because an operator
   * who asked for the audit needs to know *which* books, and they have already
   * proved `manageUsers` to ask.
   */
  findingRows: CoverHealthFinding[];
}

/**
 * Where a relative `cover_url` is served from.
 *
 * ⚠️ `SITE_ORIGIN` — this instance's own hostname, already set on both
 * `[vars]` blocks for the peer-push. Using it means the rows and the base can
 * never come apart the way the script's `--friend` flag let them until
 * 2026-08-22 (it switched the base to padhard while still reading main's rows,
 * so a clean run was being read as evidence about a catalog it had never
 * touched). Here they are two settings of one instance.
 */
function coverBase(env: Env): string {
  return env.SITE_ORIGIN ?? 'https://library.heygabi.ai';
}

/** Days since the epoch — the rotation tick. One window per day. */
function todayTick(): number {
  return Math.floor(Date.now() / 86_400_000);
}

async function probeOne(row: CoverHealthRow, base: string): Promise<CoverHealthFinding | null> {
  const url = resolveCoverUrl(row.coverUrl, base);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const length = res.headers.get('content-length');
    const verdict = judgeCoverProbe({
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type'),
      contentLength: length === null ? null : Number.parseInt(length, 10),
    });
    // ⚠️ The body is deliberately not read. A 250-cover tick that downloaded
    // every JPEG would move tens of megabytes to learn nothing the headers did
    // not already say, and the byte floor is a Content-Length test by design.
    if (verdict.verdict === 'ok') return null;
    return { ...row, url, verdict: verdict.verdict, reason: verdict.reason };
  } catch (err) {
    const verdict = judgeCoverProbe({
      ok: false,
      status: 0,
      contentType: null,
      contentLength: null,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...row, url, verdict: verdict.verdict, reason: verdict.reason };
  }
}

/**
 * Probe a list with a bounded number in flight.
 *
 * A hand-rolled pool rather than `Promise.all` over chunks, because a chunked
 * `Promise.all` runs at the speed of the slowest member of each chunk — one
 * 10-second timeout would stall five healthy probes behind it, and there are
 * enough dead covers in this catalog to make that the normal case rather than
 * the unlucky one.
 */
async function probeAll(
  rows: readonly CoverHealthRow[],
  base: string,
  concurrency: number,
): Promise<CoverHealthFinding[]> {
  const findings: CoverHealthFinding[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= rows.length) return;
      const finding = await probeOne(rows[i] as CoverHealthRow, base);
      if (finding) findings.push(finding);
    }
  });
  await Promise.all(workers);
  // The pool finishes out of order; the report is read by people, and an id
  // order is the one they can compare against yesterday's.
  findings.sort((a, b) => a.id - b.id);
  return findings;
}

/**
 * One tick. **Never rejects** — the returned result is the whole report.
 */
export async function runCoverHealthAudit(
  env: Env,
  opts: { trigger: 'cron' | 'admin'; cap?: number; tick?: number },
): Promise<CoverHealthRunResult> {
  let findingRows: CoverHealthFinding[] = [];

  const result = await recordAuditRun<CoverHealthFindings>(
    env,
    'cover-health',
    opts.trigger,
    async () => {
      let inputs;
      try {
        inputs = await readCoverHealthInputs(env.DB);
      } catch (err) {
        return {
          state: 'failed' as const,
          detail: `read failed: ${err instanceof Error ? err.message : String(err)}`,
          findings: null,
        };
      }

      // ⚠️ **Guard: a zero-works read is a REFUSED run, not a clean catalog.**
      // The audiobook sweep's phase 0 measured this exact shape — one `--remote`
      // run returned `0 work(s)` and exited 0, wrangler handing back an empty
      // result set with no error. Here the consequence is milder than a stale
      // sweep's but the same in kind: `ok` would mean "audited, nothing wrong"
      // about a catalog nobody read.
      if (inputs.totalWorks === 0) {
        return { state: 'failed' as const, detail: 'empty-read', findings: null };
      }

      const cap = opts.cap ?? COVER_HEALTH_CAP;
      const window = auditWindow(inputs.rows, cap, opts.tick ?? todayTick());
      const base = coverBase(env);
      findingRows = await probeAll(window.slice, base, COVER_HEALTH_CONCURRENCY);

      const findings: CoverHealthFindings = {
        withCover: inputs.rows.length,
        missingCover: inputs.missingCover,
        checked: window.slice.length,
        deferred: window.skipped,
        windowOffset: window.offset,
        broken: findingRows.filter((f) => f.verdict === 'broken').length,
        unreachable: findingRows.filter((f) => f.verdict === 'unreachable').length,
        sampleIds: findingRows.slice(0, 20).map((f) => f.id),
      };

      // ⚠️ A catalog whose works all lack a cover is `ok`, not `failed`: nothing
      // was wrong, there was simply nothing to ask. The detail says so, because
      // `ok` with `checked: 0` otherwise reads as a working audit.
      if (window.slice.length === 0) {
        return { state: 'ok' as const, detail: 'no covers to check', findings };
      }

      return {
        state: findingRows.length > 0 ? ('findings' as const) : ('ok' as const),
        detail: null,
        findings,
      };
    },
  );

  return { ...result, findingRows };
}

/**
 * The audit's findings as the script prints them — the operator's view.
 *
 * ⚠️ The SAME formatter the script calls, so an operator comparing the route's
 * answer to a `--remote` run of the script is comparing text produced by one
 * function rather than two that look alike.
 */
export function describeCoverHealth(result: CoverHealthRunResult): string {
  if (result.state === 'failed') {
    return (
      `The cover audit refused to report, and that is the safe outcome: ` +
      `${result.detail ?? 'no reason was recorded'}. Nothing was measured, so this is NOT ` +
      `evidence that the covers are fine.`
    );
  }
  const f = result.findings;
  if (!f) return 'The cover audit ran but recorded no counts.';
  if (result.state === 'ok' && f.checked === 0) {
    return 'No work on this instance has a cover URL to check.';
  }
  if (result.state === 'ok') {
    return (
      `Checked ${f.checked} of ${f.withCover} cover URLs and every one answered with a ` +
      `usable image. ${f.deferred} are queued for the next nightly tick, and ${f.missingCover} ` +
      `work(s) have no cover URL at all — which is the free ladder's business, not this audit's.`
    );
  }
  return (
    `Checked ${f.checked} of ${f.withCover} cover URLs: ${f.broken} answered with something ` +
    `that is not a usable cover, and ${f.unreachable} did not answer at all. ` +
    `⚠️ The unreachable ones may be an outage rather than a fault — re-run before ` +
    `changing anything, and never blank a URL to make the number go down: it loses where ` +
    `the cover came from.\n` +
    formatCoverHealthReport(result.findingRows, f.checked)
  );
}
