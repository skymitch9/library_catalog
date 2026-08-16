/**
 * Fill in missing details on a schedule, instead of waiting to be asked.
 *
 * Owner ask 2026-08-16: *"can we make missing details auto fire the look up
 * every hour if there is missing details, obviously skipping ones it cant
 * finish?"*
 *
 * The board game catalog shipped the same feature the same day
 * (`apps/worker/src/lib/details-sweep.ts` there). This is its twin in shape and
 * in reasoning, and **deliberately not its twin in three places**, each because
 * this catalog measurably differs. Those three are the whole content of this
 * file; everything else is the clock.
 *
 * ## ⚠️ 1. This queue does NOT converge, and there the queue does
 *
 * The games sweep is four lines of loop because `listItemsNeedingDetails()`
 * excludes per FIELD and never re-asks unless an input changed: an unanswerable
 * row is asked once and leaves for good. **`listWorksNeedingDetails()` here is
 * not that.** It is a person's worklist — "what does this catalog still owe" —
 * recomputed from the columns every time it is read. A gap closes only when a
 * value lands in the column or a `gap_verdict` row is written, and three
 * ordinary outcomes produce neither:
 *
 * | Outcome | Why the gap survives | How common |
 * |---|---|---|
 * | `identified: false` | no findings at all are returned, so nothing becomes a verdict | isbn-ladder.md §4.2 — **roughly half this library**; 16 of 30 sampled titles have no record anywhere free |
 * | volume number | `applyFinding` fills `series_index_sort` only; `series_index_display` quotes the cover, which research cannot read | 22 works on 2026-08-13 |
 * | an unusable value | the finding stays `pending` **on purpose**, so a person still gets asked | rare |
 *
 * Left alone, an hourly sweep would therefore re-buy the same nothing for the
 * same half of the catalog every hour, for ever. That is the "obviously skipping
 * ones it cant finish" half of the ask, and here it costs code.
 *
 * **What was chosen: the sweep never asks the same book the same question
 * twice** (`detailsRunHistory` + `unaskedGaps` below). It is a read, not a
 * write — no catalog state changes, so the queue page, `gapSummary` and the
 * manual Run button all behave exactly as they did.
 *
 * **What was deliberately NOT chosen: writing a `gap_verdict` of `unknown` for
 * every field a run failed to fill.** It is the tidier mechanism and it is what
 * the twin's queue effectively does, but here it would assert *"looked, and
 * nobody knows"* about the volume-number gap — and that gap is not unknown at
 * all. It is answerable, by a person holding the book, and the fix that made it
 * visible is three days old (2026-08-13, 22 works that sorted correctly and
 * printed nothing). Silencing 22 rows a person can close, from a background job,
 * to save a table read, is a bad trade. A run that genuinely reaches "nobody
 * knows" still writes that verdict — the model returning `kind: 'unknown'` has
 * always done so, through the ordinary path, and nothing here changes it.
 *
 * ## ⚠️ 2. Two books an hour, not eight, and the reason is subrequests
 *
 * Not timidity about the money — the money would allow more. A Worker
 * invocation gets **50 subrequests and every D1 call spends one**, and
 * exceeding it *terminates the invocation* rather than throwing. In a
 * `scheduled()` handler that failure is completely silent. `lib/research-run.ts`
 * counts one run at ~24 of the 50 for exactly this reason, and says in as many
 * words: *"A 'research these ten' route must not share an invocation."* A sweep
 * IS that route with a clock attached, so it obeys the same arithmetic:
 *
 * | Step | Subrequests |
 * |---|---|
 * | `claimRun` — closeStaleRuns, activeRun, getWork, gapsFor (getWork + verdicts), createRun | 6 |
 * | `runDetailsResearch` — getWork, the Claude call, saveFindings, finishRun | 5 |
 * | `autoApplyFindings` — listFindings, then 4 per field applied | 1 + 4·fields |
 * | **one book, per field asked** | **12 + 4·fields** |
 *
 * So a two-gap book is ~20 and a four-gap book is ~28. `SWEEP_BUDGET` spends
 * against that estimate rather than counting books, which is why the cap is
 * "two ordinary books, or one greedy one" instead of a flat number.
 *
 * ## ⚠️ 3. `scheduled()` returns the promise as well as registering it
 *
 * `waitUntil` alone would be a bug here, and one this repo has already paid for.
 * A registered task is cancelled about thirty seconds after the handler
 * settles — and a details lookup takes 20–90s (`RESEARCH_TIMEOUT_MS` is 90s
 * precisely because they run that long). The sibling project put this work in
 * `waitUntil` alone and *half its runs were cancelled silently*: no exception,
 * nothing in the catch, the row stuck at `running` for eleven hours. The route
 * fixed that by awaiting AND registering; so does this, for the same reason and
 * with the same both-belts logic in `index.ts`.
 *
 * ## What it never does
 *
 * ⚠️ **It never throws.** Every section is caught and folded into the result,
 * which `index.ts` logs as one line. There is no user, no response, and
 * (measured in the sibling project 2026-08-13) a scheduled Worker's logs
 * defeated three separate `wrangler tail` attempts — an exception here would be
 * invisible in a way a request's never is.
 *
 * ⚠️ **It never fights a person for a book.** `claimRun` reports a run already
 * in flight; the sweep steps over it and sees the book again on a later tick.
 *
 * ⚠️ **It does not retry errors specially.** A run that ends `error` is not
 * recorded as asked, so the book stays eligible — but it also goes to the back
 * of the rotation, so a book that fails every time cannot starve the rest.
 */

import { detailsRunHistory, listWorksNeedingDetails, type NeedsDetails } from '@lc/db';
import type { DetailField } from '@lc/core';
import type { Env } from '../env.js';
import { claimRun, runDetailsResearch } from './research-run.js';

/**
 * The most books one tick may pay for.
 *
 * Hourly, so this is also the per-hour ceiling: **2 books × ~2¢
 * (`RESEARCH_CENTS_EACH.low`) ≈ 4¢ an hour**, ~£0.75 a day at the absolute
 * worst — and only while a backlog exists. 116 works converge in roughly two
 * and a half days, after which the eligible list is empty and the cost is zero
 * until a book is added.
 *
 * Deliberately a constant rather than an env var: a knob nobody tunes is a knob
 * that hides its value, and the number that matters — what an hour can cost —
 * should be readable here.
 */
export const SWEEP_LIMIT = 2;

/**
 * Estimated subrequests one tick may spend on lookups, of the 50 an invocation
 * gets. The two queue reads take 2 more, and the remaining slack is on purpose:
 * the per-book figure is an estimate, and being wrong about it does not throw —
 * it silently kills the invocation mid-lookup.
 */
export const SWEEP_BUDGET = 44;

/**
 * ⚠️ Must match `wrangler.toml`'s `crons` entry EXACTLY — `scheduled()`
 * dispatches on the string, and there is a test below that reads the toml to
 * prove it still does. Minute 7 rather than 0 on purpose: every cron in the
 * world fires at :00, and this one has no reason to join the stampede.
 */
export const DETAILS_SWEEP_CRON = '7 * * * *';

/** See the table in the header. Per field, because auto-apply is per field. */
export function estimateSubrequests(fields: number): number {
  return 12 + 4 * fields;
}

/**
 * The questions this book has never been put, of the ones it still owes.
 *
 * Empty means the sweep has nothing new to buy: every open gap has already been
 * asked about by a finished run and the answer did not close it. Asking again
 * costs the same money and returns the same nothing.
 *
 * ⚠️ A field is *asked*, not *answered*. That is the whole distinction — the
 * three outcomes in the header all count as asked, which is precisely why they
 * stop repeating.
 */
export function unaskedGaps(
  missing: readonly DetailField[],
  asked: readonly string[],
): DetailField[] {
  const already = new Set(asked);
  return missing.filter((field) => !already.has(field));
}

/** A queue row with what the run history knows about it. */
export interface SweepCandidate {
  workId: number;
  title: string;
  /** Everything this work still owes — what a run would actually be sent for. */
  missing: readonly DetailField[];
  /** Fields a finished run already asked about. See `detailsRunHistory`. */
  asked: readonly string[];
  /** Newest attempt of any status, or null if never attempted. */
  lastAttemptAt: string | null;
}

export interface SweepPlan {
  /** Books to attempt, in order. */
  pick: SweepCandidate[];
  /** Eligible but not picked this tick — they come round on a later one. */
  deferred: number;
  /** Estimated subrequests `pick` will spend. */
  estimated: number;
}

/**
 * Choose this tick's books. Pure — no I/O, so the policy is testable directly
 * rather than through a copy of itself.
 *
 * Three rules, in order:
 *
 * 1. **Skip anything with no unasked question.** The convergence rule; see the
 *    header. Without it this job re-buys half the catalog every hour.
 * 2. **Never attempted first, then oldest attempt first.** The queue is sorted
 *    by title, so taking the head of it every hour would hand the same two
 *    books to a sweep that keeps failing on them and never reach the rest.
 *    Rotating on `lastAttemptAt` makes a failing book cost one slot once, not
 *    every slot for ever.
 * 3. **Stop at the cap OR the subrequest budget, whichever binds first.** The
 *    budget is checked against what the book would actually cost, so a
 *    four-gap book takes the tick to itself rather than being fitted in beside
 *    another and taking the invocation down with it.
 */
export function planSweep(
  candidates: readonly SweepCandidate[],
  limit = SWEEP_LIMIT,
  budget = SWEEP_BUDGET,
): SweepPlan {
  const eligible = candidates.filter((c) => unaskedGaps(c.missing, c.asked).length > 0);

  const ordered = [...eligible].sort((a, b) => {
    if (a.lastAttemptAt === b.lastAttemptAt) return a.workId - b.workId;
    if (a.lastAttemptAt === null) return -1;
    if (b.lastAttemptAt === null) return 1;
    // ISO-ish 'YYYY-MM-DD HH:MM:SS' from SQLite's datetime('now') — string
    // order is time order, so no Date parsing and no timezone to get wrong.
    return a.lastAttemptAt < b.lastAttemptAt ? -1 : 1;
  });

  const pick: SweepCandidate[] = [];
  let estimated = 0;
  for (const candidate of ordered) {
    if (pick.length >= limit) break;
    const cost = estimateSubrequests(candidate.missing.length);
    // ⚠️ `break`, not `continue`. Skipping ahead to find a cheaper book would
    // reorder the rotation the sort above just established, and a book that is
    // always too expensive to fit beside another would never be reached at all.
    if (estimated + cost > budget) break;
    pick.push(candidate);
    estimated += cost;
  }

  return { pick, deferred: ordered.length - pick.length, estimated };
}

export interface SweepResult {
  /** Works with at least one open gap — the person's worklist, whole. */
  queued: number;
  /** Of those, works with a question that has never been put. */
  eligible: number;
  /** Books this tick actually claimed and paid for. */
  attempted: number;
  /** Runs that wrote at least one value or verdict. */
  filled: number;
  /** Runs that finished honestly with nothing — usually "could not identify". */
  notFound: number;
  errored: number;
  /**
   * Everything that did not happen, by name.
   *
   * ⚠️ Named rather than counted, the same rule `autoApplyFindings` follows: a
   * sweep that silently did nothing looks exactly like a sweep with nothing to
   * do, and this is the only line anybody will ever read about this job.
   */
  skipped: string[];
}

/**
 * One tick. Never throws; the return value is the whole report.
 */
export async function runDetailsSweep(
  env: Env,
  limit = SWEEP_LIMIT,
  budget = SWEEP_BUDGET,
): Promise<SweepResult> {
  const result: SweepResult = {
    queued: 0,
    eligible: 0,
    attempted: 0,
    filled: 0,
    notFound: 0,
    errored: 0,
    skipped: [],
  };

  try {
    // No key, no sweep — and say so once, rather than failing twice. The route
    // answers 503 with the same reasoning: a missing key is a
    // misconfiguration, not a fact about any book.
    if (!env.ANTHROPIC_API_KEY) {
      result.skipped.push('no ANTHROPIC_API_KEY');
      return result;
    }

    let works: NeedsDetails[];
    let history: Awaited<ReturnType<typeof detailsRunHistory>>;
    try {
      [works, history] = await Promise.all([
        listWorksNeedingDetails(env.DB),
        detailsRunHistory(env.DB),
      ]);
    } catch (err) {
      result.skipped.push(`queue read failed: ${(err as Error).message}`);
      return result;
    }

    result.queued = works.length;
    if (works.length === 0) return result; // The normal, quiet, converged case.

    const seen = new Map(history.map((h) => [h.workId, h]));
    const candidates: SweepCandidate[] = works.map((work) => {
      const past = seen.get(work.workId);
      return {
        workId: work.workId,
        title: work.title,
        missing: work.missing,
        asked: past?.asked ?? [],
        lastAttemptAt: past?.lastAttemptAt ?? null,
      };
    });

    const plan = planSweep(candidates, limit, budget);
    result.eligible = plan.pick.length + plan.deferred;
    if (plan.deferred > 0) {
      result.skipped.push(`${plan.deferred} eligible left for a later tick`);
    }
    if (plan.pick.length === 0) return result;

    for (const candidate of plan.pick) {
      try {
        // `triggeredBy: null` — nobody pressed anything. `research_run.triggered_by`
        // being null is how the history tells a sweep from a person without
        // inventing a column for it, and it travels into `gap_verdict.decided_by`
        // and `research_finding.reviewed_by` for the same reason. The values it
        // writes are still stamped `decided_how = 'auto'` by `autoApplyFindings`,
        // exactly as they are when a person presses Run.
        const claim = await claimRun(env.DB, candidate.workId, null);

        if (claim.kind === 'running') {
          // Somebody is looking at this book right now. Theirs wins; the sweep
          // steps over it and sees it again if it is still unanswered.
          result.skipped.push(`#${candidate.workId} already running`);
          continue;
        }
        if (claim.kind === 'not_found') {
          result.skipped.push(`#${candidate.workId} was deleted before it could be asked`);
          continue;
        }
        if (claim.kind === 'nothing_to_ask') {
          // Filled in by hand between the queue read and now. Not an error, and
          // not worth a run.
          result.skipped.push(`#${candidate.workId} was answered while this tick was running`);
          continue;
        }

        result.attempted += 1;
        const finished = await runDetailsResearch(
          env,
          claim.run.id,
          candidate.workId,
          claim.fields,
          null,
        );

        if (!finished || finished.status === 'error') {
          // `null` means even `finishRun` failed — the database is gone. Counting
          // it as done would report a healthy sweep while nothing was written.
          result.errored += 1;
        } else if ((finished.result?.applied ?? 0) > 0) {
          result.filled += 1;
        } else {
          // `done` having written nothing: the book could not be identified, or
          // every answer was already recorded. An answer, not a failure — and
          // the run history now records the question as asked, so this book will
          // not be bought again.
          result.notFound += 1;
        }
      } catch (err) {
        // One bad book must not cost the other its turn, and nothing may escape
        // into the scheduled handler where no one would see it.
        result.errored += 1;
        result.skipped.push(`#${candidate.workId}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    // Belt and braces. Everything above is already caught; this is here because
    // the one guarantee this function makes to `scheduled()` is that it settles.
    result.skipped.push(`sweep failed: ${(err as Error).message}`);
  }

  return result;
}
