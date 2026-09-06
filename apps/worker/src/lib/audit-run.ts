/**
 * The bookkeeping every standing audit shares — the run row, the promise never
 * to throw, and the one cron both of them fire on.
 *
 * Platform inventory §7 rows #4 and #5, built 2026-09-06. The DECISIONS are in
 * `@lc/core`'s `audits.ts` (shared with the two scripts), the SQL is in
 * `@lc/db`'s `audits.ts`, and what lives here is everything a script never
 * needed: a run row, a verdict vocabulary, and the guarantee `scheduled()`
 * depends on.
 *
 * ## ⚠️ It never throws — and that is a promise to `scheduled()`
 *
 * A scheduled invocation has no user and no response to put an error in, and
 * (measured in the sibling project 2026-08-13) a scheduled Worker's logs
 * defeated three separate `wrangler tail` attempts. So every failure is folded
 * into the returned result AND into the `audit_run` row, which is the surface
 * `/api/health` reads. **A refused run is still a run and still gets a row**:
 * *"the audit refused because it read zero works"* and *"the audit has not fired
 * at all"* are different facts with different fixes, and only a row tells them
 * apart.
 *
 * ## ⚠️ Neither audit writes to a catalog table, and neither ever may
 *
 * Both are READ-ONLY by design (inventory §7): they compute findings and print
 * them. A hit on the series-aggregate alarm is a QUESTION for a person — *The
 * Wandering Inn* is legitimately titled with its series name — and a broken
 * cover is a URL somebody must decide about, because blanking it loses where the
 * cover came from (`docs/TODO.md`'s padhard 356 row says exactly that). Nothing
 * downstream may auto-act on either list.
 */

import { finishAuditRun, startAuditRun, type AuditName, type AuditTrigger } from '@lc/db';
import type { Env } from '../env.js';

/**
 * ⚠️ Must match `wrangler.toml`'s `crons` entry in BOTH `[triggers]` blocks
 * EXACTLY — `scheduled()` dispatches on the string and does nothing for one it
 * does not know, so a drift makes the audits stop firing while both files still
 * look correct. `audits-cron.test.ts` reads the toml and proves it.
 *
 * ## 🔴 ONE shared cron for BOTH audits, and why that was the choice
 *
 * The alternative was one string each. This is one string for the pair, for
 * three reasons in descending order of weight:
 *
 * 1. **The failure this whole family of tests exists to catch is a STRING that
 *    drifted between two `[triggers]` blocks three hundred lines apart.** Two
 *    audits with their own strings means four entries to keep in step; one
 *    shared string means two. Halving the surface halves the bug.
 * 2. **They do not compete for anything.** `series-aggregates` makes **zero**
 *    subrequests (it is pure D1), so the games repo's rule about two crons in
 *    one minute fighting over a 50-subrequest budget does not bind here: only
 *    one of the pair spends any, and it spends them under an explicit cap.
 * 3. **They answer one question** — *is the catalog quietly rotting?* — and a
 *    person who wants to know reads two keys off one `/api/health`. Two clocks
 *    would be two things to remember and no extra freshness.
 *
 * The cost, said out loud: a future audit that genuinely needs its own cadence
 * has to get its own string, and adding it to this list would be the wrong move.
 * The dispatcher branches by string, so that is a two-line change when it comes.
 *
 * **Daily, and nothing faster.** A broken cover does not un-break itself and a
 * phantom aggregate does not appear twice a day; the inventory's own words are
 * *"a report nobody remembers to run is a report that never runs"* — the fix for
 * which is a clock, not a fast clock.
 *
 * **09:47 UTC = 02:47 Phoenix**, and every part of that is deliberate:
 * minute 47 is neither `:00` (where the whole world fires), nor `:07` (the
 * details sweep), nor `:23` (the audiobook sweep); and 09:00 UTC is the quietest
 * hour for a job that HEADs a few hundred cover URLs, several of which are other
 * people's origins.
 */
export const AUDITS_CRON = '47 9 * * *';

/**
 * What an audit run decided.
 *
 * ⚠️ **`ok` and *no row at all* are the two states most easily confused and
 * least alike**, which is the whole reason this vocabulary has three words
 * instead of a boolean:
 *
 * | State | Means | What a person does |
 * |---|---|---|
 * | *(no row)* | it has **never run here** | check the cron and the migration |
 * | `ok` | it RAN and found **nothing** | nothing — this is the good news |
 * | `findings` | it RAN and found **something** | look at the list on the admin route |
 * | `failed` | it **refused**, and said why | read `detail`; nothing was measured |
 *
 * ⚠️ `failed` is never a finding. An audit that could not read the database has
 * learnt nothing about the catalog, and reporting that as "clean" is the silent
 * failure this estate has already paid for.
 */
export type AuditState = 'ok' | 'findings' | 'failed';

export interface AuditRunOutcome<D> {
  state: AuditState;
  /** One phrase — `empty-read`, `no covers to check`, `read failed: …`. */
  detail: string | null;
  /**
   * ⚠️ Counts and ids ONLY. This is what lands in `audit_run.detail_json`, which
   * `/api/health` reads back UNAUTHENTICATED. No title, no author, no cover URL:
   * the same rule migration 0470 states, for the same reason — a shape carrying
   * titles is one careless spread away from publishing the household's shelf.
   */
  findings: D | null;
}

export interface AuditRunResult<D> extends AuditRunOutcome<D> {
  audit: AuditName;
  trigger: AuditTrigger;
  /** Null when the row could not be opened — see `recordAuditRun`. */
  runId: number | null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run one audit inside a run row. **Never rejects.**
 *
 * ⚠️ The order is not arbitrary. The row is opened FIRST, so a body that dies
 * halfway leaves a `running` row somebody can see rather than nothing at all —
 * and a row stuck at `running` for hours is itself the signature of a cancelled
 * invocation (migration 0470 records the eleven-hour version of that bug).
 *
 * ⚠️ A failure to OPEN the row is a refusal, not a run. An audit that cannot
 * write its own bookkeeping cannot be trusted to report, and there would be
 * nowhere to put the answer — so it returns `failed` with no row rather than
 * computing findings nobody will ever see.
 *
 * ⚠️ A failure to CLOSE the row is swallowed. The row stays `running`, which is
 * diagnostic, and there is nowhere better to put it — throwing here would break
 * the one promise this function makes.
 */
export async function recordAuditRun<D>(
  env: Env,
  audit: AuditName,
  trigger: AuditTrigger,
  body: () => Promise<AuditRunOutcome<D>>,
): Promise<AuditRunResult<D>> {
  let runId: number | null = null;
  try {
    runId = await startAuditRun(env.DB, audit, trigger);
  } catch (err) {
    return {
      audit,
      trigger,
      runId: null,
      state: 'failed',
      detail: `run row failed: ${message(err)}`,
      findings: null,
    };
  }

  let outcome: AuditRunOutcome<D>;
  try {
    outcome = await body();
  } catch (err) {
    // Belt and braces: every runner already catches its own bad news. This is
    // here because the one guarantee this function makes is that it settles.
    outcome = { state: 'failed', detail: `audit failed: ${message(err)}`, findings: null };
  }

  try {
    await finishAuditRun(env.DB, runId, {
      state: outcome.state,
      detail: { detail: outcome.detail, trigger, findings: outcome.findings },
    });
  } catch {
    // The row stays `running` — see the header.
  }

  return { ...outcome, audit, trigger, runId };
}
