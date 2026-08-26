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
 * | ~~volume number~~ | ~~a filled `sort` left the gap open because `display` was blank~~ | **RETIRED 2026-08-19 by owner rule** — see below |
 * | an unusable value | the finding stays `pending` **on purpose**, so a person still gets asked | rare |
 *
 * Left alone, an hourly sweep would therefore re-buy the same nothing for the
 * same half of the catalog every hour, for ever. That is the "obviously skipping
 * ones it cant finish" half of the ask, and here it costs code.
 *
 * ⚠️ **The middle row of that table was never a convergence case — it was a
 * predicate that could not be satisfied, and it ate the whole queue.** Measured
 * on `library-catalog-2nd` on 2026-08-19, after the owner pressed Look again and
 * reported no fix: **55 of 55 remaining rows were `seriesIndex`.** The gap test
 * demanded both `series_index_sort` AND `series_index_display`, and nothing
 * downstream of `routes/ingest.ts` had ever written the second — so every lookup
 * was correct, every lookup was paid for, and the count did not move.
 *
 * The owner's ruling, verbatim: *"We don't need physical volume if we have
 * series. Only a few things have it like the 2 part Sanderson. Make it
 * optional."* The printed form is **optional data**; a series plus a sort is
 * complete. `seriesIndexIncomplete` now reads the sort alone, and
 * `docs/info/volume-numbers.md` is the permanent statement of the semantics.
 * The rows below about what this sweep refuses to silence still stand: nothing
 * here writes a verdict a person did not earn.
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
 * | donor ask — one fetch to `DONOR_URL` | 1 |
 * | **judge — one fetch to Anthropic, only on an exact MISS with an AI key** | **1** |
 * | donor bookkeeping when either donor rung answers — createRun, saveFindings, listFindings (inside auto-apply), finishRun | 4 |
 * | `claimRun` — closeStaleRuns, activeRun, getWork, gapsFor (getWork + verdicts), createRun | 6 |
 * | `runDetailsResearch` — getWork, the Claude call, saveFindings, finishRun | 5 |
 * | **the FREE-DETAILS LADDER `runDetailsResearch` now always runs first** — listAliasesForWork, freeDetailsFor (getWork, listGapVerdicts, audiobook, Open Library ×4, Google Books, Hardcover, Wikidata, writeFreeValues ×3), re-read getWork; **derived** from `FREE_LADDER_RUNGS`, see `FREE_LADDER_SUBREQUESTS` | **18** |
 * | apply — 4 per field applied | 4·fields |
 * | **one book, AI only** | **30 + 4·fields** |
 * | **one book, donor only** | **5 + 4·fields** |
 * | **one book, both paths live** | **36 + 4·fields** |
 *
 * ⚠️ The donor's two rungs are **exclusive**, so they do not add up: the judge
 * fires only when the exact match missed, and either way exactly one donor run
 * is written. So the donor column is `1 + 4 = 5` on a donor-only instance and
 * `1 + 1 + 4 = 6` where a judge is possible — the extra 1 is the judge fetch,
 * and it is counted on every book because a MISS is the common case, not the
 * rare one (that is the entire reason this rung was asked for).
 *
 * Each field is APPLIED at most once — by whichever path answered it — so the
 * `4·fields` term is never doubled when both paths run; what doubles is the
 * run bookkeeping, hence 36 rather than 42. On an AI-only instance a two-gap
 * book is ~38 and a four-gap book ~46; donor-only, 13 and 21; both live, 44
 * and 52. ⚠️ Those AI columns are why `planSweep` and `estimateSubrequests`
 * take the mode AND count the free ladder: even on an AI-only instance two
 * ordinary books now estimate past 50 — the whole ceiling — so the plan
 * honestly picks ONE, rather than fitting two in on an estimate blind to the
 * free rungs `runDetailsResearch` runs first and killing the invocation
 * mid-book. `SWEEP_BUDGET` spends against the estimate rather than counting
 * books.
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
 * ## 4. The donor is asked before the AI, and can stand in for it entirely
 *
 * Owner ask 2026-08-16: *"before pinging the ai it checks other libraries for
 * answers. If I have Stormlight Archive don't have her look it up."* With
 * `DONOR_URL` + `DONOR_TOKEN` both set, each picked book first asks the donor
 * instance's `/api/donor/details` (see `routes/donor.ts`) for its unasked
 * missing fields — a free copy of facts a sibling catalog already holds, not
 * a web claim.
 *
 * Three rules keep it honest:
 *
 * - **Donor answers travel the SAME findings → auto-apply path as research**,
 *   under their own run: `source_tier = 'donor'` (migration 0320),
 *   `decided_how = 'auto'`, `model = 'donor'` — auditable and revertible
 *   exactly like everything else the machine writes.
 * - **Only donor-ANSWERED fields count as asked.** The donor run's `unfilled`
 *   lists exactly the fields the donor answered, so `detailsRunHistory` stops
 *   those repeating while everything the donor could NOT answer stays a live
 *   question for the AI half — or for a later tick, since the donor's own
 *   sweep is filling its gaps hourly too.
 * - **Donor down ≠ donor has no answer.** A failed fetch records nothing (the
 *   book stays exactly as eligible, retried next tick); a reachable donor
 *   with no answer falls through to the AI. In donor-ONLY mode that no-answer
 *   writes a run with `unfilled` EMPTY — `lastAttemptAt` moves so the
 *   rotation advances through the catalog, but nothing is marked asked, so
 *   the book is re-askable the day the donor learns the answer or a key
 *   appears.
 *
 * ⚠️ **No ANTHROPIC_API_KEY no longer means no sweep.** If the donor is
 * configured, the sweep runs in donor-only mode (with an honest `skipped[]`
 * note); only when NEITHER path exists does it skip the tick. That is the
 * entire mechanism by which the friend instance — which has no key, on
 * purpose — heals its details from the main library for free.
 *
 * ## 4a. The judged rung — the donor gets a second chance before the web
 *
 * Owner ask 2026-08-16, once the rung above was live: *"have our ai model do a
 * back up search on donors for fuzzy match before going to web."* The ladder
 * a book now walks:
 *
 * | Rung | Matched by | Cost | Writes |
 * |---|---|---|---|
 * | 1 exact | `work_key`, or a unique folded title | one fetch | auto-applied, `source_tier='donor'` |
 * | 2 **judged** | a ≤5-row donor shortlist + ONE Haiku call | one fetch, ≈0.1¢ | confident: auto-applied, `source_tier='donor_fuzzy'`; otherwise **pending for a person** |
 * | 3 web | `researchDetails`, open-web search | ≈2¢ | auto-applied as before |
 *
 * Four rules keep the new rung honest, and each is mechanical rather than
 * written down:
 *
 * - **It never runs without a key.** The shortlist is asked for with
 *   `?candidates=1`, and that parameter is sent only when `mode.ai` — so a
 *   donor-only instance's request is byte-for-byte the one it sent yesterday
 *   and its behaviour stops at rung 1, exactly as before.
 * - **Only `same` + `high` writes unattended.** Anything else — `unsure`, a
 *   medium confidence, a verdict naming a row the donor never offered — leaves
 *   the donor's values as a **pending** finding and falls through to rung 3.
 *   `heldForPerson` in `research-run.ts` is what makes "never auto-applied"
 *   true for ever rather than only in this tick: `autoApplyFindings` is
 *   default-deny on `donor_fuzzy`, so no later ordinary run can sweep an
 *   unconfirmed judgement up.
 * - **A judged copy wears its own tier** (`DONOR_FUZZY_SOURCE_TIER`, migration
 *   0321) and its own run model (`donor+claude-haiku-4-5`), so "which values
 *   did a model *match* rather than a key" is one query — the question a
 *   person asks when a judge turns out to have been wrong, with
 *   `revertFinding` waiting at the end of it.
 * - **A pending judgement marks nothing as asked.** The run records
 *   `unfilled: []`, so rung 3 still gets the question and a later tick can too.
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
 * ⚠️ **It retries errors, and since 2026-08-19 it distinguishes two kinds.** A
 * run that ends `error` is never recorded as asked, so the book stays eligible
 * either way. What changed is the ORDER: a failure about the ACCOUNT — the
 * allowance, a rate limit, a rejected key — is not a turn this book took, so it
 * no longer pushes the book to the back of the rotation. Every other error
 * still does, which is the starvation guard: a book whose lookups keep timing
 * out costs one slot once, not every slot for ever. The classification is
 * `classifyLookupFailure` in `@lc/core` — the same leaf that words those three
 * failures for the screen — applied in `detailsRunHistory`, whose header
 * carries the incident that prompted it (three books on the friend instance
 * demoted by a monthly cap and left demoted after it was cleared).
 */

import {
  createRun,
  detailsRunHistory,
  finishRun,
  listWorksNeedingDetails,
  saveFindings,
  type NeedsDetails,
  type SaveFindingInput,
} from '@lc/db';
import {
  DETAIL_FIELDS,
  DONOR_FUZZY_SOURCE_TIER,
  DONOR_SOURCE_TIER,
  unaskedGaps,
  type DetailField,
  type FindingSourceTier,
} from '@lc/core';
import {
  DONOR_JUDGE_MODEL,
  estimateJudgeCents,
  judgeDonorMatch,
  type DonorJudgeVerdict,
} from '@lc/research';
import type { Env } from '../env.js';
import type { DonorCandidate, DonorDetailsReply } from '../routes/donor.js';
import { autoApplyFindings, claimRun, runDetailsResearch } from './research-run.js';
import { describeError } from './describe-error.js';
// ⚠️ The ladder's price comes FROM the ladder — see `FREE_LADDER_SUBREQUESTS`
// below for the failure that made this an import rather than a number.
import { FREE_DETAILS_SUBREQUESTS } from './free-details.js';

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
 *
 * ⚠️ **44 → 46 on 2026-08-25, when rung 2 of the free ladder stopped being
 * dark.** This is a raise made reluctantly and it is the smallest one that
 * works, because the alternative was worse than tight slack:
 *
 * `planSweep` **`break`s** rather than `continue`s when the next book will not
 * fit (deliberately — skipping ahead would reorder the rotation). The queue is
 * ordered never-attempted-first, so an unaffordable book at the HEAD was not
 * deferred, it stalled the whole sweep, every hour, silently. At the old 44 an
 * AI-only book missing all four details cost `12 + 18 + 16 = 46` and would have
 * done exactly that — and a four-gap book is precisely the one the sweep exists
 * for.
 *
 * ⚠️ **That stall is fixed as of 2026-08-26 — `planSweep` rule 4 admits an
 * unaffordable HEAD alone rather than planning nothing — and this budget is
 * still not the lever.** Rule 4 is a floor under the failure, not a licence to
 * stop pricing: every book it admits exceeds the ceiling and risks a killed
 * invocation. Raising this number buys one more field's headroom and costs the
 * slack that keeps ordinary ticks safe.
 *
 * So the slack under the 50 ceiling is now **2, not 4**. What makes that
 * defensible rather than reckless is that the largest term stopped being an
 * estimate: `FREE_DETAILS_SUBREQUESTS` is summed from `FREE_LADDER_RUNGS` and
 * `free-details.test.ts` **counts the real calls** of a worst-case run against
 * it. What is still guessed here is the bookkeeping constants, and they have
 * not moved since they were enumerated.
 *
 * ⚠️ Do not raise this again to make a book fit. 48 + 2 IS the ceiling, and a
 * budget equal to the ceiling has stopped being a budget. If the ladder grows
 * another rung, the next move is to price the rung down (see
 * `INDEX_MAX_IDENTITIES` in `free-details.ts`), not to spend the last two.
 */
export const SWEEP_BUDGET = 46;

/**
 * ⚠️ Must match `wrangler.toml`'s `crons` entry EXACTLY — `scheduled()`
 * dispatches on the string, and there is a test below that reads the toml to
 * prove it still does. Minute 7 rather than 0 on purpose: every cron in the
 * world fires at :00, and this one has no reason to join the stampede.
 */
export const DETAILS_SWEEP_CRON = '7 * * * *';

/**
 * Which halves of the sweep this deployment can actually run. Pure and
 * separate from `runDetailsSweep` so the mode decision — the thing that
 * changed when donor-only mode was added — is testable by name.
 */
export interface SweepMode {
  /** A paid AI lookup is possible: ANTHROPIC_API_KEY is set. */
  ai: boolean;
  /** A donor ask is possible: DONOR_URL and DONOR_TOKEN are both set. */
  donor: boolean;
}

export function sweepMode(
  env: Pick<Env, 'ANTHROPIC_API_KEY' | 'DONOR_URL' | 'DONOR_TOKEN'>,
): SweepMode {
  return {
    ai: Boolean(env.ANTHROPIC_API_KEY),
    donor: Boolean(env.DONOR_URL && env.DONOR_TOKEN),
  };
}

/** The historical default: AI, no donor — what every pre-donor caller meant. */
const AI_ONLY: SweepMode = { ai: true, donor: false };

/**
 * How long a donor ask may take before it is written off as "donor down".
 * The donor's answer is one or two D1 reads — sub-second when warm — so this
 * covers a cold start with room to spare while staying far inside the tick:
 * even two timeouts must not eat the window a real lookup needs.
 */
const DONOR_TIMEOUT_MS = 15_000;

/**
 * `research_run.model` for a donor copy. Not an AI model on purpose — the run
 * table's model column is provenance ("what produced these values"), and for
 * a donor run the honest answer is the donor, not a model name.
 */
export const DONOR_RUN_MODEL = 'donor';

/**
 * `research_run.model` for a JUDGED donor copy — the donor plus the model that
 * admitted the match, because both are load-bearing provenance and neither
 * alone is the answer. Derived from `DONOR_JUDGE_MODEL` rather than typed out,
 * so swapping the judge rewrites the history's story truthfully instead of
 * leaving an old model's name on new rows.
 */
export const DONOR_FUZZY_RUN_MODEL = `donor+${DONOR_JUDGE_MODEL}`;

/**
 * What `runDetailsResearch` spends AROUND `freeDetailsFor`, worst case:
 * `listAliasesForWork` before it (1) and the `getWork` re-read after it (1).
 * Neither is inside the ladder, and neither is in the `12` term — that one
 * counts only getWork + the Claude call + saveFindings + finishRun.
 */
const FREE_LADDER_CALLER_SUBREQUESTS = 2;

/**
 * ⚠️ **The free-details ladder's subrequest cost — DERIVED, never typed.**
 *
 * Spent by `runDetailsResearch` on every AI-mode book BEFORE the paid model is
 * (maybe) asked. The per-rung table is `FREE_LADDER_RUNGS` in `free-details.ts`
 * and it is the only place a rung's price is written down; a hand-maintained
 * copy here is exactly what went wrong — this constant read **11** while
 * Hardcover and Wikidata had already landed on the ladder (2026-08-25), and its
 * enumeration also missed the `getWork` that `updateWork` does before it writes.
 * Every AI-mode book was priced 4 subrequests short against a ceiling whose
 * overrun does not throw but silently kills the invocation.
 *
 * Today: 16 (ladder) + 2 (caller) = **18**.
 *
 * ⚠️ **It moved 15 → 18 on 2026-08-25 when rung 2 stopped being dark**, and
 * that is the whole reason `INDEX_MAX_IDENTITIES` exists rather than the rung
 * fanning out over every alias `selectTitleAliases` allows. At the uncapped
 * price (1 + 4 = 5, so a ladder of 18 and a total of 20) a two-question book on
 * a donor instance cost 46 against a budget of 44, and `planSweep` would have
 * picked **nothing, every hour, silently** — a worse outcome than asking three
 * spellings instead of five. Reprice the rung and this number follows; it is
 * derived, and the cost test counts the real calls.
 *
 * Only in AI mode: `if (!mode.ai) continue;` gates runDetailsResearch, so a
 * donor-only tick never walks this ladder.
 */
export const FREE_LADDER_SUBREQUESTS =
  FREE_DETAILS_SUBREQUESTS + FREE_LADDER_CALLER_SUBREQUESTS;

/**
 * See the table in the header. Per field, because apply is per field; per
 * mode, because each live path carries its own run bookkeeping — an estimate
 * blind to the donor would under-count by 5 per book, and one blind to the free
 * ladder under-counts by `FREE_LADDER_SUBREQUESTS` (18) per AI book; the overrun
 * does not throw, it silently kills the invocation.
 *
 * ⚠️ The donor term is 6 rather than 5 wherever a judge is possible: the two
 * donor rungs are exclusive (one fetch, one run either way) and the extra 1 is
 * the judge's own fetch, counted on every book because an exact MISS is the
 * ordinary case rather than the exception.
 */
export function estimateSubrequests(fields: number, mode: SweepMode = AI_ONLY): number {
  const donor = mode.donor ? (mode.ai ? 6 : 5) : 0;
  const freeLadder = mode.ai ? FREE_LADDER_SUBREQUESTS : 0;
  return (mode.ai ? 12 : 0) + freeLadder + donor + 4 * fields;
}

/**
 * The questions this book has never been put, of the ones it still owes.
 *
 * ⚠️ **MOVED to `@lc/core` (`gaps.ts`) on 2026-08-19 and re-exported here**, so
 * the queue page can reach the same predicate. It was private to this file
 * while the sweep was its only consumer; the day a second consumer appeared,
 * the *absence* of sharing was the defect — the page had invented its own
 * per-WORK version of "already asked" and hid 51 open questions behind it. The
 * incident, and why neither dropping nor per-work-ing the marker is acceptable,
 * are in the core header. Do not re-implement it here.
 */
export { unaskedGaps } from '@lc/core';

/** A queue row with what the run history knows about it. */
export interface SweepCandidate {
  workId: number;
  title: string;
  /**
   * As recorded, or null for an authorless book. The donor ask sends it so
   * the donor can match on the canonical `work_key` instead of title alone.
   */
  authors: string | null;
  /** Everything this work still owes. Decides eligibility and the rotation. */
  missing: readonly DetailField[];
  /**
   * What a lookup is actually SENT for — `missing` plus the volume number when
   * the series is being bought in the same call (`detailAsks`). ⚠️ Not
   * interchangeable with `missing`: `planSweep` must stay on the owed list, or
   * the companion question alone could earn a book a paid slot.
   */
  asks: readonly DetailField[];
  /** Fields a finished run already asked about. See `detailsRunHistory`. */
  asked: readonly string[];
  /**
   * Newest attempt that was really this book's turn, or null if it has never
   * had one. ⚠️ Not "any status": `detailsRunHistory` skips runs that failed on
   * the account's allowance, rate limit or key — those spent nothing and asked
   * nothing, so demoting a book for one is a rotation the outage invented.
   */
  lastAttemptAt: string | null;
}

export interface SweepPlan {
  /** Books to attempt, in order. */
  pick: SweepCandidate[];
  /** Eligible but not picked this tick — they come round on a later one. */
  deferred: number;
  /** Estimated subrequests `pick` will spend. */
  estimated: number;
  /**
   * Set when the head of the rotation was admitted **over** the budget because
   * nothing else could be (rule 4 below). Null on an ordinary tick.
   *
   * ⚠️ Carried rather than inferred, because it is the one tick that can exceed
   * the 50-subrequest ceiling and the reader deserves to know which book did it.
   * `runDetailsSweep` names it in `skipped`.
   */
  overBudget: { workId: number; cost: number; budget: number } | null;
  /**
   * Why `pick` is empty, in words — null whenever something was picked.
   *
   * ⚠️ **This exists because a tick that planned nothing used to look exactly
   * like a tick with an empty queue**, and that indistinguishability is what let
   * padhard's sweep sit dead for a day and a half without a single line saying
   * so (measured 2026-08-26, `docs/DONE.md`). Rule 4 means an unaffordable book
   * can no longer be the reason; the reasons that remain are named here.
   */
  nothingPicked: string | null;
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
 * 4. ⚠️ **A book that fits nowhere still gets its turn — it takes the tick
 *    ALONE.** If rule 3 would leave `pick` EMPTY, the head candidate is admitted
 *    regardless of cost, and the tick stops there.
 *
 * ## Why rule 4 exists (owner decision 2026-08-26 — option 1 of three)
 *
 * Rules 2 and 3 compose badly without it. The rotation is never-attempted-first
 * and rule 3 `break`s rather than `continue`s, so **an unaffordable book at the
 * HEAD is not deferred — it stops the tick, and it is still at the head an hour
 * later.** The sweep then picks nothing, for ever, silently.
 *
 * That was not hypothetical. **Measured 2026-08-26 on `library-catalog-2nd`
 * (padhard):** work **#541 *"Raising Jesca"***, never attempted, owing all four
 * details, priced `12 + 18 + 6 + 16 = 52` against a budget of 46 — and **90
 * eligible books behind it, 0 picked.** Main was converged (0 queued) and so was
 * unaffected. `scripts/sweep-plan.mjs` is the read-only instrument that measured
 * it and can measure it again.
 *
 * ⚠️ **The admitted book CAN exceed the 50-subrequest ceiling, and that is the
 * accepted cost.** The estimate is a worst case that assumes every rung is asked
 * and every rung fails; a 52-estimate book rarely spends 52. If it does, the
 * invocation is killed mid-lookup — which is not a new failure and not a
 * permanent one: `closeStaleRuns` reaps the abandoned `research_run`, the
 * timestamp moves the book to the BACK of the rotation, and the other 90 books
 * get their turn on the next tick. **Stalling forever was strictly worse than
 * failing once.**
 *
 * The two rejected shapes, so nobody re-litigates them: *skip-and-remember*
 * (`continue` plus a passed-over marker) reintroduces the reordering rule 3
 * exists to prevent, and *make the book cheaper* refuses to answer a question
 * the book actually owes. Both are in `docs/DONE.md`.
 */
export function planSweep(
  candidates: readonly SweepCandidate[],
  limit = SWEEP_LIMIT,
  budget = SWEEP_BUDGET,
  /** Which paths are live — it changes what a book costs. See the header table. */
  mode: SweepMode = AI_ONLY,
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
  let overBudget: SweepPlan['overBudget'] = null;
  for (const candidate of ordered) {
    if (pick.length >= limit) break;
    // ⚠️ `asks`, not `missing` — the budget must price what the run will
    // actually send, and a book being asked its series is sent one field more
    // (the companion volume question, `detailAsks`). Pricing the owed list
    // would undercount that book by a whole field's worth of subrequests and
    // put the invocation over the ceiling this budget exists to stay under.
    const cost = estimateSubrequests(candidate.asks.length, mode);
    // ⚠️ `break`, not `continue`. Skipping ahead to find a cheaper book would
    // reorder the rotation the sort above just established, and a book that is
    // always too expensive to fit beside another would never be reached at all.
    if (estimated + cost > budget) {
      // ⚠️ Rule 4 — the anti-stall. An empty `pick` here means this candidate is
      // the HEAD of the rotation and does not fit even on its own, so `break`ing
      // would plan nothing this tick and nothing every tick after it. Admit it
      // alone and stop; the rotation is untouched, because the book taken is
      // still the one the sort put first.
      if (pick.length === 0) {
        pick.push(candidate);
        estimated += cost;
        overBudget = { workId: candidate.workId, cost, budget };
      }
      break;
    }
    pick.push(candidate);
    estimated += cost;
  }

  return {
    pick,
    deferred: ordered.length - pick.length,
    estimated,
    overBudget,
    nothingPicked: nothingPickedReason(candidates.length, ordered.length, pick.length, limit),
  };
}

/**
 * Why a tick planned zero books, in a sentence — or null when it planned some.
 *
 * ⚠️ **Three causes, and they are NOT interchangeable**, which is the whole
 * point of wording them apart: an empty catalogue queue is the converged, quiet,
 * correct outcome; a queue whose every row has already been asked everything is
 * the convergence rule doing its job; a limit of zero is a caller's choice.
 * Since rule 4, "the head was unaffordable" is no longer among them — that book
 * is picked and `overBudget` says so.
 */
function nothingPickedReason(
  queued: number,
  eligible: number,
  picked: number,
  limit: number,
): string | null {
  if (picked > 0) return null;
  if (limit < 1) return `the per-tick limit is ${limit}`;
  if (queued === 0) return 'the queue is empty — nothing in the catalogue owes a detail';
  if (eligible === 0) {
    return `all ${queued} book(s) on the queue have already been asked everything they owe`;
  }
  // Unreachable while rule 4 holds. Kept, and worded as the fault it would be,
  // because a silent empty pick is exactly the failure this field exists to end.
  return `${eligible} book(s) were eligible and none was picked — this should not happen`;
}

/**
 * Turn a donor's reply into findings for the ordinary apply path. Pure — this
 * is the donor-answer-to-apply mapping, and it is where three refusals live:
 *
 * - **Only unasked fields.** The donor may volunteer everything it holds; a
 *   field this catalog already asked about (or already has) must not be
 *   re-proposed, or the convergence rule unravels one finding at a time.
 * - **Only usable shapes.** null, absent, blank and non-scalar values are
 *   dropped here rather than saved and skipped later — a null that becomes a
 *   finding is a blank-overwrite proposal.
 * - **`DETAIL_FIELDS` order**, same as `autoApplyFindings` sorts, so `series`
 *   always precedes `seriesIndex`.
 *
 * The `basis` says in words what `source_tier = 'donor'` says in the column:
 * this is a fact a sibling catalog already recorded, not a web claim.
 */
export function donorFindings(
  unasked: readonly DetailField[],
  reply: DonorDetailsReply,
  donorUrl: string,
): SaveFindingInput[] {
  if (!reply.matched || !reply.details) return [];
  // When the donor carries a printed volume designation (one of the 81
  // hand-quoted forms — "Volume 07", "Prequel", etc.), merge it into the
  // `seriesIndex` value so `applyFinding`'s existing `printedFormIn` logic
  // writes both `series_index_sort` AND `series_index_display` on the caller.
  const details = reply.seriesIndexDisplay
    ? { ...reply.details, seriesIndex: reply.seriesIndexDisplay }
    : reply.details;
  return detailFindings(unasked, details, {
    tier: DONOR_SOURCE_TIER,
    basis: `Recorded in the donor library's catalog for "${reply.title ?? 'this book'}" — a value that catalog already holds, not a web claim.`,
    sourceUrl: reply.workId != null ? `${donorUrl}/work/${reply.workId}` : donorUrl,
  });
}

/**
 * The three refusals above, once, for both donor rungs.
 *
 * ⚠️ Shared rather than copied on purpose: the drop rules (unasked only,
 * usable shapes only, `DETAIL_FIELDS` order) are the same rules whichever rung
 * matched, and a second copy of them is how the two rungs would quietly start
 * behaving differently.
 */
function detailFindings(
  unasked: readonly DetailField[],
  details: Partial<Record<DetailField, string | number>>,
  meta: { tier: FindingSourceTier; basis: string; sourceUrl: string },
): SaveFindingInput[] {
  const askable = new Set(unasked);
  const out: SaveFindingInput[] = [];
  for (const field of DETAIL_FIELDS) {
    if (!askable.has(field)) continue;
    const raw = details[field];
    if (raw == null) continue;
    if (typeof raw !== 'string' && typeof raw !== 'number') continue;
    if (typeof raw === 'string' && raw.trim() === '') continue;
    out.push({
      field,
      value: { kind: 'found', value: raw, basis: meta.basis },
      sourceTier: meta.tier,
      // The donor's own book page — a person clicking the source lands where
      // a person maintains the value.
      sourceUrl: meta.sourceUrl,
    });
  }
  return out;
}

/**
 * What the judge's answer means, in terms of what gets written. Pure, because
 * this is the decision the whole rung exists to make and it must be pinnable
 * without a model, a donor or a database.
 *
 * - `apply` — `same` at `high` confidence, naming a row the donor actually
 *   offered, with something left to donate. The only outcome that writes
 *   unattended.
 * - `pending` — the judge leaned towards a row but not confidently. The
 *   donor's values are proposed and left for a person; the caller still falls
 *   through to the web pass.
 * - `none` — nothing to propose: `different`, no named row, a row the donor
 *   never offered (⚠️ a work id the model invented must never be trusted), or
 *   a candidate with nothing this book still needs.
 */
export type JudgedOutcome =
  | { kind: 'apply'; candidate: DonorCandidate; findings: SaveFindingInput[] }
  | { kind: 'pending'; candidate: DonorCandidate; findings: SaveFindingInput[] }
  | { kind: 'none'; why: string };

export function judgedOutcome(
  verdict: DonorJudgeVerdict,
  candidates: readonly DonorCandidate[],
  unasked: readonly DetailField[],
  donorUrl: string,
): JudgedOutcome {
  if (verdict.verdict === 'different') {
    return { kind: 'none', why: `The judge says none of the donor's rows is this book. ${verdict.why}` };
  }
  const candidate = candidates.find((c) => c.workId === verdict.workId);
  if (!candidate) {
    return {
      kind: 'none',
      why:
        verdict.workId == null
          ? `The judge named no donor row. ${verdict.why}`
          : `The judge named donor work #${verdict.workId}, which was not on the shortlist — ignored.`,
    };
  }

  const confident = verdict.verdict === 'same' && verdict.confidence === 'high';
  // Merge the candidate's printed volume designation into the seriesIndex
  // value, same as `donorFindings` does for the exact-match path.
  const details = candidate.seriesIndexDisplay
    ? { ...candidate.details, seriesIndex: candidate.seriesIndexDisplay }
    : candidate.details;
  const findings = detailFindings(unasked, details, {
    tier: DONOR_FUZZY_SOURCE_TIER,
    basis: confident
      ? `Copied from the donor library's "${candidate.title}" (work #${candidate.workId}), which ${DONOR_JUDGE_MODEL} judged the same work as this book with high confidence: ${verdict.why}`
      : `Proposed from the donor library's "${candidate.title}" (work #${candidate.workId}). ${DONOR_JUDGE_MODEL} was NOT confident it is the same book (${verdict.verdict}, ${verdict.confidence} confidence): ${verdict.why} — a person decides this one.`,
    sourceUrl: `${donorUrl}/work/${candidate.workId}`,
  });
  if (findings.length === 0) {
    return { kind: 'none', why: `Donor work #${candidate.workId} has nothing this book still needs.` };
  }
  return { kind: confident ? 'apply' : 'pending', candidate, findings };
}

/**
 * The URL of one donor ask. Pure and exported for one property that is
 * otherwise invisible: ⚠️ **`candidates=1` is sent only when this instance can
 * actually judge them.** A donor-only instance must send the request it sent
 * before the judged rung existed — the shortlist costs the donor D1 reads, and
 * an instance with no key could do nothing with the answer.
 */
export function donorAskUrl(
  base: string,
  title: string,
  authors: string | null,
  wantCandidates: boolean,
): string {
  const url = new URL('/api/donor/details', base);
  url.searchParams.set('title', title);
  if (authors) url.searchParams.set('author', authors);
  if (wantCandidates) url.searchParams.set('candidates', '1');
  return url.toString();
}

/**
 * One donor ask. `ok: false` means the donor could not be REACHED or spoke an
 * unrecognised shape — which is a different fact from a reachable donor
 * answering `matched: false`, and the caller treats the two differently:
 * unreachable records nothing (retry next tick), no-answer falls through.
 */
async function askDonor(
  env: Env,
  title: string,
  authors: string | null,
  wantCandidates: boolean,
): Promise<{ ok: true; reply: DonorDetailsReply } | { ok: false; error: string }> {
  try {
    const url = donorAskUrl(env.DONOR_URL as string, title, authors, wantCandidates);
    const res = await fetch(url, {
      headers: { 'X-Donor-Token': env.DONOR_TOKEN ?? '' },
      signal: AbortSignal.timeout(DONOR_TIMEOUT_MS),
    });
    // 404 here means the donor's DONOR_TOKEN disagrees with ours (its gate
    // answers 404 for a wrong token on purpose) — a misconfiguration worth a
    // named skip line, not silence.
    if (!res.ok) return { ok: false, error: `donor answered ${res.status}` };
    const reply = (await res.json()) as DonorDetailsReply;
    if (typeof reply?.matched !== 'boolean') {
      return { ok: false, error: 'donor answered an unrecognised shape' };
    }
    return { ok: true, reply };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface SweepResult {
  /** Works with at least one open gap — the person's worklist, whole. */
  queued: number;
  /** Of those, works with a question that has never been put. */
  eligible: number;
  /**
   * Runs this tick actually claimed — donor copies (free), judged donor copies
   * (≈0.1¢) and AI lookups (≈2¢) all count; a book served by two rungs counts
   * twice, because two runs happened. ⚠️ It does not equal
   * `filled + notFound + errored`: a judged run held for a person wrote a real
   * run and no value, and is counted in `heldForPerson` instead.
   */
  attempted: number;
  /** Runs that wrote at least one value or verdict. */
  filled: number;
  /**
   * Of `filled`, runs whose values were copied from the donor library rather
   * than bought from the AI — the number that says the owner's "check other
   * libraries first" is actually happening.
   */
  donorFilled: number;
  /**
   * Judge calls actually made this tick — one per book whose exact donor match
   * missed while an AI key was available. The line that says what the middle
   * rung cost: ≈0.1¢ each (`estimateJudgeCents`), against ≈2¢ for the web pass
   * each one is trying to avoid.
   */
  judged: number;
  /**
   * Books where the judge leaned towards a donor row but not confidently, so
   * the values are waiting on the findings queue for a person. ⚠️ Counted
   * rather than silent: a proposal nobody knows exists is a proposal nobody
   * decides.
   */
  heldForPerson: number;
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
 * Who asked for this tick.
 *
 * ⚠️ **`null` is the clock, a number is a person** — that is the whole meaning
 * of `research_run.triggered_by`, and the reason the delegated GABI verb
 * (`routes/gabi-delegated.ts`, owner ask *"Hey Gabi, fix all my missing
 * details"*) passes an option rather than getting a sweep of its own: one
 * implementation of the donor-then-AI ladder, the never-ask-twice history and
 * the subrequest arithmetic. A second, chat-shaped copy would be a second place
 * for every one of those to be got wrong.
 *
 * The value travels exactly where a person's Run button already sends it —
 * into `createRun`, `claimRun` and `runDetailsResearch` — so it lands on
 * `gap_verdict.decided_by` and `research_finding.reviewed_by` too. What it does
 * NOT change is `decided_how`, which stays `'auto'`: GABI did not read the
 * values she applied any more than the cron did.
 */
export interface SweepOptions {
  triggeredBy?: number | null;
}

/**
 * One tick. Never throws; the return value is the whole report.
 */
export async function runDetailsSweep(
  env: Env,
  limit = SWEEP_LIMIT,
  budget = SWEEP_BUDGET,
  opts: SweepOptions = {},
): Promise<SweepResult> {
  const triggeredBy = opts.triggeredBy ?? null;
  const result: SweepResult = {
    queued: 0,
    eligible: 0,
    attempted: 0,
    filled: 0,
    donorFilled: 0,
    judged: 0,
    heldForPerson: 0,
    notFound: 0,
    errored: 0,
    skipped: [],
  };

  try {
    // Neither path, no sweep — and say so once, rather than failing twice.
    // ⚠️ A missing AI key alone no longer skips the tick: with a donor
    // configured the sweep runs donor-only (header §4), which is the friend
    // instance's whole feature. The note keeps the donor-only tick honest
    // about what it is not doing.
    const mode = sweepMode(env);
    if (!mode.ai && !mode.donor) {
      result.skipped.push('no ANTHROPIC_API_KEY');
      return result;
    }
    if (!mode.ai) {
      result.skipped.push('no ANTHROPIC_API_KEY — donor-only mode');
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
    // The normal, quiet, converged case — and the ONE empty tick that stays
    // quiet on purpose. `queued: 0` already says it without ambiguity, and a
    // converged instance would otherwise print the same line every hour for
    // ever. Every OTHER way of planning nothing is named below, in `skipped`.
    if (works.length === 0) return result;

    const seen = new Map(history.map((h) => [h.workId, h]));
    const candidates: SweepCandidate[] = works.map((work) => {
      const past = seen.get(work.workId);
      return {
        workId: work.workId,
        title: work.title,
        authors: work.authors,
        missing: work.missing,
        asks: work.asks,
        asked: past?.asked ?? [],
        lastAttemptAt: past?.lastAttemptAt ?? null,
      };
    });

    const plan = planSweep(candidates, limit, budget, mode);
    result.eligible = plan.pick.length + plan.deferred;
    if (plan.deferred > 0) {
      result.skipped.push(`${plan.deferred} eligible left for a later tick`);
    }
    // ⚠️ The tick that costs more than the ceiling says so, by name and by
    // number. `skipped` is the only line anybody reads about this job (see its
    // own doc comment), so the over-budget admission goes THERE rather than
    // into a second status surface — one fact, one home.
    if (plan.overBudget) {
      result.skipped.push(
        `#${plan.overBudget.workId} costs ${plan.overBudget.cost} subrequests against a budget ` +
          `of ${plan.overBudget.budget} — admitted alone, so the queue cannot stall behind it`,
      );
    }
    if (plan.pick.length === 0) {
      // ⚠️ A tick that planned nothing must not read like a tick with nothing to
      // do. `nothingPicked` words the difference; `queued`/`eligible` carry the
      // numbers behind it.
      if (plan.nothingPicked) result.skipped.push(`planned nothing — ${plan.nothingPicked}`);
      return result;
    }

    for (const candidate of plan.pick) {
      try {
        // ── The donor step: ask a sibling catalog before paying a model ─────
        // (header §4). Runs only for this book's UNASKED gaps; whatever the
        // donor answers is recorded under its own run so the history counts
        // exactly those fields as asked, and whatever it cannot answer falls
        // through to the AI claim below unchanged.
        // ⚠️ `asks`, not `missing` — so a donor that hands over the series
        // hands over the volume number with it instead of leaving a gap the AI
        // pass has to buy an hour later. `detailAsks` carries the measurement.
        let remaining = unaskedGaps(candidate.asks, candidate.asked);
        if (mode.donor && remaining.length > 0) {
          // ⚠️ The shortlist is asked for ONLY when this instance can judge it
          // — header §4a. A donor-only instance sends the pre-judge request.
          const donor = await askDonor(env, candidate.title, candidate.authors, mode.ai);
          if (!donor.ok) {
            // Donor DOWN, not donor-has-no-answer. Nothing is recorded, so
            // the book stays exactly as eligible and is retried next tick;
            // the AI half still gets its chance below.
            result.skipped.push(`#${candidate.workId} donor: ${donor.error}`);
          } else {
            const findings = donorFindings(remaining, donor.reply, env.DONOR_URL as string);
            if (findings.length > 0) {
              const answered = findings.map((f) => f.field);
              // ⚠️ `unfilled` lists the donor-ANSWERED fields only — that is
              // what makes them "asked" in `detailsRunHistory` without
              // silencing the questions the donor could not answer.
              const run = await createRun(env.DB, {
                workId: candidate.workId,
                tier: 'details',
                model: DONOR_RUN_MODEL,
                effort: 'copy',
                triggeredBy,
                inputTitle: candidate.title,
                inputYear: null,
                unfilled: answered,
              });
              await saveFindings(env.DB, run.id, candidate.workId, findings);
              // The same apply machinery as research — provenance rows say
              // source 'donor', decided_how 'auto', revertible like any batch.
              // No judged opt-in: an exact match authorises nothing about a
              // proposal some earlier judge left pending.
              const report = await autoApplyFindings(env.DB, candidate.workId, triggeredBy);
              await finishRun(env.DB, run.id, {
                status: 'done',
                result: {
                  proposed: findings.length,
                  applied: report.applied.length,
                  detail:
                    `Copied from the donor library (its "${donor.reply.title ?? candidate.title}", work #${donor.reply.workId}).` +
                    (report.skipped.length > 0 ? ` Skipped — ${report.skipped.join('; ')}.` : ''),
                },
              });
              result.attempted += 1;
              if (report.applied.length > 0) {
                result.filled += 1;
                result.donorFilled += 1;
              } else {
                result.notFound += 1;
              }
              remaining = remaining.filter((f) => !answered.includes(f));
            } else if (mode.ai && !donor.reply.matched && (donor.reply.candidates?.length ?? 0) > 0) {
              // ── Rung 2: the exact fold missed, so ask one small model
              // whether any of the donor's near-misses is this book at all
              // (header §4a). One call, titles and authors only.
              const shortlist = donor.reply.candidates ?? [];
              let verdict: DonorJudgeVerdict | null = null;
              let judgeCents = 0;
              try {
                const answer = await judgeDonorMatch(env.ANTHROPIC_API_KEY, {
                  title: candidate.title,
                  authors: candidate.authors,
                  candidates: shortlist.map((s) => ({
                    workId: s.workId,
                    title: s.title,
                    authors: s.authors,
                  })),
                });
                verdict = answer.verdict;
                judgeCents = estimateJudgeCents(answer.usage.inputTokens, answer.usage.outputTokens);
                result.judged += 1;
              } catch (err) {
                // A judge that failed is a rung that did not happen: nothing is
                // recorded, nothing is marked asked, and the web pass below
                // still gets its chance. Named, because a silent middle rung
                // looks exactly like a rung with nothing to say.
                result.skipped.push(`#${candidate.workId} judge: ${describeError(err)}`);
              }

              const outcome = verdict
                ? judgedOutcome(verdict, shortlist, remaining, env.DONOR_URL as string)
                : null;

              if (outcome && outcome.kind !== 'none') {
                const confident = outcome.kind === 'apply';
                const answered = outcome.findings.map((f) => f.field);
                // ⚠️ A pending judgement marks NOTHING as asked (`unfilled: []`)
                // — the question is still open until a person answers it or the
                // web pass does.
                const run = await createRun(env.DB, {
                  workId: candidate.workId,
                  tier: 'details',
                  model: DONOR_FUZZY_RUN_MODEL,
                  effort: 'judged',
                  triggeredBy,
                  inputTitle: candidate.title,
                  inputYear: null,
                  unfilled: confident ? answered : [],
                });
                await saveFindings(env.DB, run.id, candidate.workId, outcome.findings);
                // ⚠️ Scoped to THIS run: a confident verdict authorises the
                // values it was about and nothing else pending on the work.
                const report = await autoApplyFindings(
                  env.DB,
                  candidate.workId,
                  triggeredBy,
                  confident ? { applyJudgedDonorFromRun: run.id } : undefined,
                );
                await finishRun(env.DB, run.id, {
                  status: 'done',
                  // ⚠️ Token counts deliberately NOT recorded. `toRunView`
                  // prices every run at Claude Opus 5's rate, and this call ran
                  // on Haiku — a token count here would render a fivefold
                  // overstatement on the queue's running cost total. The real
                  // figure is in the sentence instead.
                  result: {
                    proposed: outcome.findings.length,
                    applied: report.applied.length,
                    detail:
                      (confident
                        ? `${DONOR_JUDGE_MODEL} judged the donor's "${outcome.candidate.title}" (work #${outcome.candidate.workId}) the same work, with high confidence, and copied what it had.`
                        : `${DONOR_JUDGE_MODEL} was not confident the donor's "${outcome.candidate.title}" (work #${outcome.candidate.workId}) is this book, so nothing was applied — the values are waiting for a person on the findings queue.`) +
                      ` Judge cost ≈${judgeCents.toFixed(2)}¢.` +
                      (report.skipped.length > 0 ? ` Skipped — ${report.skipped.join('; ')}.` : ''),
                  },
                });
                result.attempted += 1;
                if (confident) {
                  if (report.applied.length > 0) {
                    result.filled += 1;
                    result.donorFilled += 1;
                  } else {
                    result.notFound += 1;
                  }
                  remaining = remaining.filter((f) => !answered.includes(f));
                } else {
                  result.heldForPerson += 1;
                }
              } else if (outcome) {
                // A verdict of "none of these" is an answer, and a cheap one.
                // No run, so nothing is marked asked; the web pass follows.
                result.skipped.push(`#${candidate.workId} judge: ${outcome.why}`);
              }
            } else if (!mode.ai) {
              // Donor-only mode, donor reachable, nothing to copy. Record the
              // attempt with `unfilled` EMPTY: `lastAttemptAt` moves so the
              // rotation reaches the rest of the catalog, but no field is
              // marked asked — the book stays askable for the day the donor
              // learns the answer (its own sweep runs hourly) or a key lands.
              const run = await createRun(env.DB, {
                workId: candidate.workId,
                tier: 'details',
                model: DONOR_RUN_MODEL,
                effort: 'copy',
                triggeredBy,
                inputTitle: candidate.title,
                inputYear: null,
                unfilled: [],
              });
              await finishRun(env.DB, run.id, {
                status: 'done',
                result: {
                  proposed: 0,
                  detail: donor.reply.matched
                    ? 'The donor library has this book but none of the details it is missing.'
                    : 'The donor library has no record of this book.',
                },
              });
              result.attempted += 1;
              result.notFound += 1;
            }
            // Both paths live and the donor had nothing: fall straight
            // through — the AI claim below is unchanged.
          }
        }

        if (!mode.ai) continue;
        if (remaining.length === 0) {
          // The donor answered everything this book had never been asked.
          // Skipping the claim saves its six subrequests; the queue re-reads
          // next tick and the gap test will say whether anything is left.
          continue;
        }

        // `triggeredBy` is NULL on the cron's own tick — nobody pressed
        // anything — and `research_run.triggered_by` being null is how the
        // history tells a sweep from a person without inventing a column for
        // it. It travels into `gap_verdict.decided_by` and
        // `research_finding.reviewed_by` for the same reason. ⚠️ A DELEGATED
        // tick (`SweepOptions.triggeredBy`, the GABI verb) carries the asker's
        // id here instead, which is what makes *"what did GABI fill for me"* one
        // query. Either way the values are stamped `decided_how = 'auto'` by
        // `autoApplyFindings`, exactly as they are when a person presses Run.
        const claim = await claimRun(env.DB, candidate.workId, triggeredBy);

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
          triggeredBy,
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
