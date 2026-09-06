/**
 * The two standing audits' DECISIONS, in one place, for both callers.
 *
 * `scripts/check-cover-health.mjs` and `scripts/audit-series-aggregates.mjs`
 * became routes on 2026-09-06 (platform inventory §7 rows #4 and #5). The rule
 * that inventory ends on is the reason this file exists:
 *
 * > ⚠️ *the matcher, the fold, the threshold does not get copied. A route and
 * > its script share ONE implementation in `packages/core`, or the conversion
 * > has made the estate worse.*
 *
 * `packages/core/src/matching.ts` opens with three wrong-game matches the
 * sibling catalog shipped, **every one from a second similarity function
 * drifting from the first**. So the scripts do not keep a private copy of "what
 * counts as a broken cover" or "what counts as a bare series title" — they
 * import from here, and so does the Worker.
 *
 * ⚠️ **The REPORT TEXT is here too, not just the rules.** That is deliberate
 * and it is what makes the conversion checkable: `packages/core/test/audits.test.ts`
 * runs the pre-conversion script logic (kept verbatim in the test as the
 * oracle) beside these functions on one fixture and asserts the printed bytes
 * are identical. A formatter left in the script would make that test impossible
 * to write, and "the script still prints the same thing" would be a claim
 * rather than a measurement.
 *
 * No I/O. The fetch lives in the Worker runner and in the script; what is here
 * is only *given this answer, what is the verdict*.
 */

import { MIN_COVER_BYTES } from './covers.js';
import { foldSeriesNames, isBareSeriesTitle } from './matching.js';

// ---------------------------------------------------------------------------
// Cover health
// ---------------------------------------------------------------------------

/**
 * Below this a 200 is a placeholder, not a cover.
 *
 * ⚠️ **The same constant `verifyCoverUrl` and the upload check use**, imported
 * rather than restated. The script had its own `const MIN_BYTES = 1000` — the
 * same number, arrived at twice, which is exactly the drift this file exists to
 * end. `covers.ts`'s own header already says the floors "share
 * `MIN_COVER_BYTES` rather than each keeping a floor of their own"; the audit
 * was the one caller that did not.
 *
 * ⚠️ It is a FLOOR and it has a known blind spot, recorded as **KI-6**: a
 * Google Books *"COVER COMING SOON"* card is a genuine 4,013-byte JPEG and
 * clears it, and the 50-pixel Goodreads smudge in `docs/TODO.md` is 1,980 bytes
 * and clears it too. This audit is not the instrument for either; do not widen
 * it here hoping it becomes one.
 */
export const COVER_HEALTH_MIN_BYTES = MIN_COVER_BYTES;

/** One row of `work` that claims to have a cover. */
export interface CoverHealthRow {
  id: number;
  title: string;
  coverUrl: string;
}

/**
 * What came back from asking for a cover — or what went wrong asking.
 *
 * `error` is set when the request never got an ANSWER at all (DNS, TLS, a
 * timeout, an aborted socket). Everything else describes a real HTTP response.
 */
export interface CoverProbe {
  ok: boolean;
  status: number;
  contentType: string | null;
  /** `Content-Length` as a number; 0 or null when the origin did not send one. */
  contentLength: number | null;
  error?: string | null;
}

/**
 * ⚠️ **Three verdicts, not two — and the split is the one thing this route adds
 * to the script.**
 *
 * The script pushed a fetch that THREW into the same `broken` list as an HTTP
 * 404, because a person watching a script scroll past can tell "the network
 * died" from "the cover is gone" by looking at the reason column. A cron has no
 * such reader: a Worker with a flaky egress would file every cover in the
 * catalog as broken, `/api/health` would say so, and the next person would go
 * hunting for 400 dead covers that were all fine.
 *
 * So `unreachable` is counted separately in the run row, and the SCRIPT still
 * prints both under one heading — see `formatCoverHealthReport`, which folds
 * them back so the text is byte-identical to what it printed before.
 */
export type CoverVerdict = 'ok' | 'broken' | 'unreachable';

export interface CoverHealthFinding extends CoverHealthRow {
  /** The absolute URL actually asked for. */
  url: string;
  verdict: CoverVerdict;
  /** `HTTP 404`, `not an image (text/html)`, `1980B placeholder`, or the error. */
  reason: string;
}

/**
 * Relative cover paths are served by the instance itself; absolute ones are
 * somebody else's host.
 *
 * ⚠️ The base and the DATABASE must be chosen together. Until 2026-08-22 the
 * script's `--friend` switched only this base, so it read the MAIN catalog's
 * rows and fetched them against padhard — and a clean run of it was being read
 * as evidence that the second instance was fine while padhard held 47 works
 * needing a cover. In the Worker the pairing is structural and cannot come
 * apart: the rows come from `env.DB` and the base from `env.SITE_ORIGIN`, which
 * are two settings of one instance.
 */
export function resolveCoverUrl(coverUrl: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(coverUrl)) return coverUrl;
  return `${baseUrl.replace(/\/+$/, '')}${coverUrl.startsWith('/') ? '' : '/'}${coverUrl}`;
}

/**
 * The verdict on one answer. Ported from the script rule for rule, in the same
 * order — the order matters, because a 404 page is also "not an image" and the
 * status is the more useful thing to say.
 */
export function judgeCoverProbe(probe: CoverProbe): { verdict: CoverVerdict; reason: string } {
  if (probe.error) {
    // The script's `err.message?.slice(0, 50)`, kept — a stack-shaped message in
    // a report column helps nobody, and 50 characters is enough to name a DNS
    // failure or a timeout.
    return { verdict: 'unreachable', reason: probe.error.slice(0, 50) };
  }
  if (!probe.ok) return { verdict: 'broken', reason: `HTTP ${probe.status}` };
  const ct = probe.contentType ?? '';
  if (!ct.startsWith('image/')) return { verdict: 'broken', reason: `not an image (${ct})` };
  const size = probe.contentLength ?? 0;
  // ⚠️ `size > 0` first, deliberately: an origin that sends no Content-Length
  // (chunked, or a HEAD-less CDN) reports 0, and treating that as a 0-byte
  // placeholder would fail every cover behind such a host.
  if (size > 0 && size < COVER_HEALTH_MIN_BYTES) {
    return { verdict: 'broken', reason: `${size}B placeholder` };
  }
  return { verdict: 'ok', reason: '' };
}

export interface CoverHealthSummary {
  checked: number;
  broken: number;
  unreachable: number;
}

export function summariseCoverHealth(
  findings: readonly CoverHealthFinding[],
  checked: number,
): CoverHealthSummary {
  return {
    checked,
    broken: findings.filter((f) => f.verdict === 'broken').length,
    unreachable: findings.filter((f) => f.verdict === 'unreachable').length,
  };
}

/**
 * The script's opening line, verbatim.
 *
 * `dbLabel` is `library-catalog` / `library-catalog-2nd` — the DATABASE, not the
 * host, because naming only the host is how the 2026-08-22 mismatch above hid
 * for months.
 */
export function formatCoverHealthHeader(rowCount: number, dbLabel: string, base: string): string {
  return `Checking ${rowCount} cover(s) from ${dbLabel} against ${base}...\n`;
}

/**
 * The script's closing block, verbatim — one string, printed with one
 * `console.log`, byte-identical to the four the script used to make.
 *
 * ⚠️ `broken` and `unreachable` are folded into ONE count here, on purpose. The
 * script has always reported them together and a person reading it has the
 * reason column to tell them apart; changing the text would have made the
 * equality test in `packages/core/test/audits.test.ts` a test of the new
 * behaviour rather than a proof that nothing changed.
 */
export function formatCoverHealthReport(
  findings: readonly CoverHealthFinding[],
  checked: number,
): string {
  const lines = [`\nChecked: ${checked}`, `Broken:  ${findings.length}`];
  if (findings.length > 0) {
    lines.push('\nBroken covers:');
    for (const f of findings) {
      lines.push(
        `  ${String(f.id).padStart(4)}  ${f.title.slice(0, 40).padEnd(40)}  ${f.reason}`,
      );
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The per-tick window — how a cron audits 400 covers without 400 subrequests
// ---------------------------------------------------------------------------

/**
 * Which slice of the catalog this tick looks at.
 *
 * ⚠️ **A cap without ROTATION is worse than no cap**, and that is the whole
 * reason this is a function rather than a `LIMIT`. `ORDER BY id LIMIT 250`
 * every night audits the first 250 covers forever and never once looks at the
 * rest — and it would report itself clean while doing it, which is the silent
 * failure this estate has already paid for twice.
 *
 * So the window WRAPS: `tick` (days since the epoch, from the runner) advances
 * the offset by one whole cap each day, and the slice runs off the end and back
 * to the front. Every row is reached within `ceil(total / cap)` days, with no
 * cursor to persist and nothing to go stale if a tick is missed — a skipped day
 * shifts the window, it does not skip rows permanently.
 *
 * `tick` is deliberately an argument rather than read from the clock in here:
 * this package does no I/O, and a testable window needs a nameable tick.
 */
export function auditWindow<T>(
  rows: readonly T[],
  cap: number,
  tick: number,
): { slice: T[]; offset: number; skipped: number } {
  const total = rows.length;
  if (total === 0) return { slice: [], offset: 0, skipped: 0 };
  if (cap <= 0) return { slice: [], offset: 0, skipped: total };
  if (cap >= total) return { slice: [...rows], offset: 0, skipped: 0 };

  // A negative or non-finite tick must not produce a negative offset — the
  // window would silently become `slice(-n)` and audit the tail forever.
  const safeTick = Number.isFinite(tick) ? Math.trunc(tick) : 0;
  const windows = Math.ceil(total / cap);
  const offset = (((safeTick % windows) + windows) % windows) * cap;

  const slice: T[] = [];
  for (let i = 0; i < cap; i += 1) slice.push(rows[(offset + i) % total] as T);
  return { slice, offset, skipped: total - cap };
}

// ---------------------------------------------------------------------------
// Series aggregates — tier 3 of the bare-series-name rule
// ---------------------------------------------------------------------------

/** A work carrying two or more editions, with its copy count. */
export interface SeriesAggregateWork {
  id: number;
  title: string;
  authors: string;
  editions: number;
  copies: number;
}

export interface SeriesAggregateFindings {
  /** How many distinct folded series names the catalog knows. */
  seriesKeys: number;
  /** How many works carry 2+ editions at all. */
  multiEditionWorks: number;
  /** The subset whose title IS a bare series name. */
  flagged: SeriesAggregateWork[];
}

/**
 * The standing alarm, as a pure function.
 *
 * Any work whose title equals a known series name AND which carries two or more
 * editions. That is the signature the 2026-08-13 corruption wore: a scanned
 * barcode resolved to an Open Library record titled bare *Space Knight*, and the
 * phantom work it minted absorbed six editions with six unrelated ISBNs and six
 * copies (works #300–#302, cleaned up by hand that night).
 *
 * ⚠️ **A hit is a QUESTION, not a defect.** *The Wandering Inn* is legitimately
 * titled with its series name and legitimately owned in two printings. Nothing
 * here writes anything, and nothing downstream may auto-act on this list; it
 * exists so the question gets asked.
 *
 * ⚠️ The fold is `foldSeriesNames` and the test is `isBareSeriesTitle`, both out
 * of `matching.ts`. A second normalisation here — in SQL, in the script, or in
 * the Worker — is precisely the drift that shipped three wrong games.
 */
export function auditSeriesAggregates(input: {
  seriesNames: readonly string[];
  works: readonly SeriesAggregateWork[];
}): SeriesAggregateFindings {
  const seriesKeys = foldSeriesNames(input.seriesNames);
  return {
    seriesKeys: seriesKeys.size,
    multiEditionWorks: input.works.length,
    flagged: input.works.filter((w) => isBareSeriesTitle(w.title, seriesKeys)),
  };
}

/**
 * The script's whole output, verbatim, as one string.
 *
 * `where` is `production` / `local` for the script and the instance's database
 * name for anything else. The script printed this in two or three `console.log`
 * calls; one string with the same bytes is what makes the equality test in
 * `packages/core/test/audits.test.ts` a byte comparison rather than a vibe.
 */
export function formatSeriesAggregateReport(
  findings: SeriesAggregateFindings,
  where: string,
): string {
  const head =
    `${where}: ${findings.seriesKeys} known series name(s), ` +
    `${findings.multiEditionWorks} work(s) with 2+ editions, ${findings.flagged.length} flagged.`;

  if (findings.flagged.length === 0) {
    return `${head}\nClean — no series-titled work carries multiple editions.`;
  }

  const lines = [
    head,
    '\n⚠️ Series-titled works with 2+ editions. Each is either the OL work-level\n' +
      'aggregate bug recurring (docs/TODO.md, 2026-08-13) or a real multi-printing\n' +
      'volume 1. A person should eyeball each one:\n',
  ];
  for (const w of findings.flagged) {
    lines.push(
      `  #${String(w.id).padStart(4)}  ${w.title} — ${w.authors} ` +
        `(${w.editions} editions, ${w.copies} copies)`,
    );
  }
  return lines.join('\n');
}
