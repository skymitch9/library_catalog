/**
 * Running one research pass, and writing what it found into the catalog.
 *
 * ## ⚠️ The rule this file used to enforce has been deliberately retired
 *
 * It read: *the run proposes, the person disposes.* Every finding waited in
 * `research_finding` until somebody read it and pressed Use. That was the right
 * default and it is documented at length in `isbn-ladder.md` §4.4 — a wrong
 * answer scored 1.00 on title and 1.00 on author, twice, and only a human
 * reading the publisher caught it.
 *
 * **It was retired because the gate was not being used.** The owner pressed Use
 * on everything, without reading, every time — so the queue was not buying
 * scrutiny, it was buying taps. A gate nobody looks through is not a safeguard;
 * it is a cost with a safeguard's reputation, and it was keeping four fields
 * blank across a hundred-odd books rather than keeping them right.
 *
 * The trade made in its place, in the owner's words: *"I'd rather come across a
 * book with a wrong desc and fix it then, than confirm each possible item."*
 * That bargain only holds if **both** halves are real, so both are built here:
 *
 * | Given up | Given back |
 * |---|---|
 * | Reading each value before it lands | `decided_how = 'auto'` on every row, so an audit can always separate a machine's guess from a person's assertion (migration 0013) |
 * | The chance to reject one proposal | `listAutoApplied` + `revertFinding` — see a batch afterwards and throw it away wholesale |
 * | | Fields editable in place on the book page, so "fix it then" is two taps |
 *
 * ⚠️ **Do not add a confidence threshold to this.** The temptation is obvious
 * and the codebase already argues against it in three places: `ResearchFinding.confidence`
 * is permanently null on purpose, the queue page shows a source instead of a
 * score, and `scanjobs.ts` carries a weak match rather than hiding it. Auto-apply
 * is the owner's explicit call; silently dropping the findings a number disliked
 * would be a *different* feature, unrequested, and unauditable. Everything gets
 * applied, and everything that could not be is reported by name.
 *
 * ## Where the work runs, and the mistake worth not repeating
 *
 * The route awaits the lookup *and* hands the same promise to
 * `executionCtx.waitUntil`. Both, deliberately:
 *
 * - **Awaiting** keeps the invocation open, so the ~30s `waitUntil` budget never
 *   starts and a 70-second lookup is fine. The sibling project put this work in
 *   `waitUntil` alone and roughly half its runs were cancelled silently — no
 *   exception, nothing in the catch, the row stuck at `running` for eleven
 *   hours. Production said so plainly in `wrangler tail`:
 *   *"waitUntil() tasks did not complete within the allowed time."*
 * - **Registering** means that if the caller vanishes mid-lookup, the work still
 *   gets that budget to write down what it found instead of being dropped.
 *
 * Three layers then guarantee a run cannot go quiet, each catching what the one
 * before it cannot:
 *
 * | Guard | Catches |
 * |---|---|
 * | `RESEARCH_TIMEOUT_MS` aborts the call | a lookup that runs away — it throws, so it is recorded |
 * | the `catch` below | anything thrown, from anywhere |
 * | `closeStaleRuns` on read | the invocation being killed outright, when none of our code runs |
 *
 * ## Subrequest arithmetic
 *
 * A Worker gets 50 subrequests per invocation and every D1 call counts beside
 * every fetch. One run costs: read the work (1) + read its verdicts (1) + create
 * the run (1) + the Claude call (1–2; search and fetch happen on Anthropic's
 * side) + save findings (1 batch) + finish the run (1) ≈ **7**. Comfortably
 * inside the ceiling with one book per invocation.
 *
 * ⚠️ **A "research these ten" route must not share an invocation.** Ten of these
 * is ~70, past the cap, and exceeding it *terminates* the invocation rather than
 * throwing — a silent failure. The queue page drives the list one book at a time
 * from the browser for exactly that reason, and that page is the bulk mechanism.
 *
 * Auto-apply adds to that arithmetic and it was checked rather than assumed:
 * listing the pending findings (1) plus, per field, `getWork` + `updateWork`'s
 * own read + the UPDATE + `markFinding` (4). Four fields is the most that can
 * ever be asked, so the worst case is 1 + 16 = 17 on top of ~7, or **~24 of 50**.
 * Still one book per invocation, and the headroom is now half what it was — a
 * fifth `DETAIL_FIELDS` entry costs 4 more and is fine; a loop over books is not.
 */

import {
  DETAIL_FIELDS,
  detailGaps,
  verdictFor,
  type DecisionMode,
  type DetailField,
  type FindingValue,
  type GapSubject,
} from '@lc/core';
import {
  activeRun,
  closeStaleRuns,
  createRun,
  deleteAutoVerdict,
  finishRun,
  getWork,
  listFindings,
  listGapVerdicts,
  markFinding,
  saveFindings,
  setGapVerdict,
  updateWork,
  type ResearchFinding,
  type ResearchRun,
  type SaveFindingInput,
} from '@lc/db';
import {
  RESEARCH_EFFORT,
  RESEARCH_MODEL,
  ResearchError,
  estimateCents,
  researchDetails,
} from '@lc/research';
import type { Env } from '../env.js';
import { describeError } from './describe-error.js';

/**
 * The run as the browser sees it: outcome and money, no plumbing.
 *
 * `estimatedCents` is computed here rather than in the page. What a model costs
 * is not something a browser should hold an opinion about, and the queue's
 * running total has to mean the same thing after a reload — when the numbers
 * come from the table rather than from the response that produced them.
 */
export interface RunView {
  id: number;
  workId: number;
  status: ResearchRun['status'];
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCents: number;
  /** The fields it was sent to find. */
  asked: string[];
  /** How many proposals it came back with. */
  proposed: number;
  /** How many of them were written into the catalog. Not the same number. */
  applied: number;
  detail: string | null;
  model: string | null;
  effort: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export function toRunView(run: ResearchRun): RunView {
  return {
    id: run.id,
    workId: run.workId,
    status: run.status,
    errorMessage: run.errorMessage,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    estimatedCents: estimateCents(run.inputTokens ?? 0, run.outputTokens ?? 0),
    asked: run.unfilled,
    proposed: run.result?.proposed ?? 0,
    applied: run.result?.applied ?? 0,
    detail: run.result?.detail ?? null,
    model: run.model,
    effort: run.effort,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

/**
 * The sentence a finished run shows for itself.
 *
 * ⚠️ Says what was **written**, not what was proposed. Under the old flow
 * "Proposed 3 answers" was the whole story, because the next step was a person
 * reading them. Now the next step is nothing, so a run that says "proposed 3"
 * and silently wrote 1 would be actively misleading — and the two really do
 * differ, whenever a column filled in while the lookup was out.
 *
 * Skips are named rather than counted, per the no-silent-drops rule at the head
 * of this file.
 */
function describeRun(
  proposed: number,
  report: AutoApplyReport,
  note: string | null | undefined,
): string {
  if (proposed === 0) return note ?? 'Nothing to propose.';

  const parts: string[] = [];
  if (report.applied.length > 0) {
    parts.push(`Filled in ${report.applied.length} of ${proposed}: ${report.applied.join(' ')}`);
  } else {
    parts.push(`Nothing could be filled in from ${proposed} ${proposed === 1 ? 'answer' : 'answers'}.`);
  }
  if (report.skipped.length > 0) parts.push(`Skipped — ${report.skipped.join('; ')}.`);
  if (report.unusable > 0) {
    parts.push(
      `${report.unusable} still needs a decision because the value could not be used.`,
    );
  }
  if (note) parts.push(note);
  return parts.join(' ');
}

/** What a work still owes, decided by the one policy that decides it. */
export async function gapsFor(db: D1Database, workId: number): Promise<DetailField[] | null> {
  const work = await getWork(db, workId);
  if (!work) return null;
  const verdicts = await listGapVerdicts(db, workId);
  const subject: GapSubject = {
    firstPublished: work.firstPublished,
    series: work.series,
    seriesIndexSort: work.seriesIndexSort,
    // ⚠️ Both halves of the volume number, or the gap test is blind to a row
    // that sorts correctly and prints nothing (22 works, 2026-08-13).
    seriesIndexDisplay: work.seriesIndexDisplay,
    description: work.description,
    verdicts: verdicts.map((v) => v.field),
  };
  return detailGaps(subject);
}

/**
 * Claim this book for a lookup, or report the one already running.
 *
 * The queue page polls, and an unguarded route would let a poll landing
 * mid-lookup start a second paid call for the same book — the same answer bought
 * twice. Anything that has gone quiet is swept to `error` first, so a run still
 * reported active really is one.
 */
export async function claimRun(
  db: D1Database,
  workId: number,
  triggeredBy: number | null,
): Promise<
  | { kind: 'running'; run: ResearchRun }
  | { kind: 'nothing_to_ask' }
  | { kind: 'not_found' }
  | { kind: 'claimed'; run: ResearchRun; fields: DetailField[] }
> {
  await closeStaleRuns(db);

  const existing = await activeRun(db, workId);
  if (existing) return { kind: 'running', run: existing };

  const work = await getWork(db, workId);
  if (!work) return { kind: 'not_found' };

  const fields = await gapsFor(db, workId);
  if (!fields) return { kind: 'not_found' };
  if (fields.length === 0) return { kind: 'nothing_to_ask' };

  // Stamped before the call, not after: the record is of what the lookup had to
  // work from. A work edited while a run was in flight would otherwise be
  // stamped with the new value and never re-asked about the old one — migration
  // 0001's reasoning for these columns, unchanged.
  const run = await createRun(db, {
    workId,
    tier: 'details',
    model: RESEARCH_MODEL,
    effort: RESEARCH_EFFORT,
    triggeredBy,
    inputTitle: work.title,
    inputYear: work.firstPublished,
    unfilled: fields,
  });
  return { kind: 'claimed', run, fields };
}

/**
 * Do the lookup, write the outcome down, hand back the finished row. Never throws.
 *
 * The same promise is awaited by the route *and* registered with `waitUntil`, so
 * it must survive having no listener: an exception escaping here would leave the
 * run at `running` for ever with no error recorded — the exact shape of failure
 * that makes a stalled queue indistinguishable from a working one. Everything is
 * funnelled into `finishRun`, whose row is the return value, so the caller
 * reports what the database says rather than what it hoped.
 *
 * ⚠️ **"That book could not be identified" is not an error.** It is an answer,
 * and a run that reaches it is `done` with a sentence explaining itself. Filing
 * it as a failure would offer a retry guaranteed to cost the same money and
 * return the same nothing — and for the Kindle-native half of this library
 * (§4.2: 16 of 30 sampled titles have no record anywhere) that is the *expected*
 * outcome, not a malfunction.
 */
export async function runDetailsResearch(
  env: Env,
  runId: number,
  workId: number,
  fields: readonly DetailField[],
  /**
   * Who asked. Recorded as the authority behind every value this run applies —
   * `decided_how` says nobody *read* them, `reviewed_by` says whose request
   * wrote them. See migration 0013 for why both are kept.
   */
  triggeredBy: number | null,
): Promise<ResearchRun | null> {
  try {
    const work = await getWork(env.DB, workId);
    if (!work) {
      return await finishRun(env.DB, runId, {
        status: 'error',
        errorMessage: 'That book was deleted while the lookup was running.',
      });
    }

    const { answer, usage } = await researchDetails(env.ANTHROPIC_API_KEY, {
      title: work.title,
      // A provisional (authorless) work sends an empty author line rather than
      // a guess — migration 0120. The model is told less, which is honest;
      // its identification gate answers `identified: false` when the title
      // alone is ambiguous, which is the right outcome for exactly that book.
      authors: work.authors ?? '',
      series: work.series,
      fields,
    });

    if (!answer.identified) {
      return await finishRun(env.DB, runId, {
        status: 'done',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        result: {
          proposed: 0,
          detail:
            answer.note ??
            'The book could not be identified confidently, so nothing was proposed.',
        },
      });
    }

    // Only what was asked for. A model that volunteers a field the queue did not
    // ask about is a model proposing a value for something already recorded, and
    // a catalog that quietly rewrites your entries is one you stop trusting.
    const asked = new Set<string>(fields);
    const proposals: SaveFindingInput[] = [];
    for (const raw of answer.findings) {
      if (!asked.has(raw.field)) continue;
      // A "found" with nothing in it is not a finding — it is the model failing
      // to pick an outcome. Treated as unknown rather than saved as a value of
      // null, which would apply as a blank overwrite.
      const kind = raw.kind === 'found' && (raw.value ?? '').trim() === '' ? 'unknown' : raw.kind;
      const value: FindingValue = {
        kind,
        value: kind === 'found' ? raw.value : null,
        basis: raw.basis,
      };
      proposals.push({
        field: raw.field,
        value,
        sourceTier: raw.sourceTier,
        sourceUrl: raw.sourceUrl,
      });
    }

    const saved = await saveFindings(env.DB, runId, workId, proposals);

    // ⚠️ Applied here, inside the run, rather than left for the browser to do.
    // A page that fetched findings and PATCHed each one would be the old gate
    // with the confirmation removed — the same round trips, the same chance to
    // be interrupted halfway, and a book left half-filled if the tab closes.
    // Doing it here means a run either lands or does not.
    const report = await autoApplyFindings(env.DB, workId, triggeredBy);

    return await finishRun(env.DB, runId, {
      status: 'done',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      result: {
        proposed: saved,
        applied: report.applied.length,
        detail: describeRun(saved, report, answer.note),
      },
    });
  } catch (err) {
    // ⚠️ `describeError`, not `String(err)`: `errorMessage` is persisted on the
    // run row and shown on the findings screen, and the research client throws
    // SDK objects — `String({...})` would store `[object Object]` for ever.
    const message = describeError(err);
    return await finishRun(env.DB, runId, { status: 'error', errorMessage: message }).catch(
      // The database is the only place left to report to. If that is gone too
      // there is nothing useful left to do.
      () => null,
    );
  }
}

// ---------------------------------------------------------------------------
// Applying an accepted finding
// ---------------------------------------------------------------------------

export interface ApplyOutcome {
  /** What actually changed, in words a person can check. */
  applied: string | null;
  /** Why nothing changed, when nothing did. */
  skipped: string | null;
  /**
   * Which of three quite different non-events a skip was.
   *
   * ⚠️ The distinction drives what happens to the finding afterwards, and
   * getting it wrong is how a queue either nags forever or goes quiet about a
   * real gap:
   *
   * - `already` — the column was filled while the run was out. Nothing to
   *   decide, so the finding is closed. Leaving it open would show "1 to
   *   decide" against a question that already has an answer.
   * - `unusable` — the model returned something that is not a year, not a
   *   number, not text. The gap is still a gap, so the finding stays **pending**
   *   and gets reported. This is the one case auto-apply cannot swallow.
   * - `gone` — the book was deleted mid-run.
   */
  reason: 'applied' | 'already' | 'unusable' | 'gone';
}

/**
 * A four-digit year, or null.
 *
 * ⚠️ Parsed rather than trusted. `Number('2016 (reissue)')` is NaN, but
 * `parseInt` of it is 2016 — so `Number` it is, and a bare year it must be. The
 * bounds are not decoration: `first_published` is an INTEGER column with no
 * CHECK, so a stray 20161 would store cleanly and sort every list wrong.
 */
function asYear(raw: string | number | null | undefined): number | null {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  return Number.isInteger(n) && n >= 1000 && n <= 2200 ? n : null;
}

/** A volume position: 1, 2.5, 07. */
function asIndex(raw: string | number | null | undefined): number | null {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Write one accepted finding into the catalog.
 *
 * ⚠️ Three rules, and each refuses for a different reason.
 *
 * 1. **Gaps only.** If the column filled in since the run — by hand, by a
 *    backfill, by an earlier accepted finding — the accept becomes a no-op that
 *    says so. A value somebody typed is better evidence than one a model found.
 * 2. **`none` and `unknown` become verdicts, not values.** They are answers
 *    about the absence, and they belong in `gap_verdict` where the queue can see
 *    them. Writing them into the column would be indistinguishable from never
 *    having asked.
 * 3. **Nothing here can reach `title` or `authors`.** `updateWork` re-derives
 *    `work_key` from those two, and `work_key` is the join to 860 audiobook
 *    reviews. The patch object below names four columns and cannot name a fifth.
 */
export async function applyFinding(
  db: D1Database,
  finding: ResearchFinding,
  userId: number | null,
  /**
   * Whether a person read this value first. Passed through to `gap_verdict` so
   * a silenced question carries the same provenance the finding does — see
   * migration 0013. Not defaulted: every caller must state which it is.
   */
  decidedHow: DecisionMode,
): Promise<ApplyOutcome> {
  const field = finding.field as DetailField;
  const verdict = verdictFor(finding.value.kind);

  if (verdict) {
    // The source is required by the table, so it is assembled from whatever the
    // run actually gave us rather than defaulted to a placeholder.
    const source =
      finding.sourceUrl ??
      finding.value.basis ??
      `research run #${finding.runId} (${new Date(finding.createdAt).toISOString().slice(0, 10)})`;
    await setGapVerdict(db, {
      workId: finding.workId,
      field,
      verdict,
      source,
      note: finding.value.basis,
      runId: finding.runId,
      decidedBy: userId,
      decidedHow,
    });
    return {
      applied:
        verdict === 'none'
          ? `Recorded: this book has no ${field}. It will not be asked again.`
          : `Recorded: nobody knows this book's ${field}. It will not be asked again.`,
      skipped: null,
      reason: 'applied',
    };
  }

  const work = await getWork(db, finding.workId);
  if (!work) return { applied: null, skipped: 'That book no longer exists.', reason: 'gone' };

  const blank = (v: string | number | null) =>
    v == null || (typeof v === 'string' && v.trim() === '');

  switch (field) {
    case 'firstPublished': {
      if (!blank(work.firstPublished)) {
        return {
          applied: null,
          skipped: `Already recorded as ${work.firstPublished}.`,
          reason: 'already',
        };
      }
      const year = asYear(finding.value.value);
      if (year == null) {
        return { applied: null, skipped: 'That is not a usable year.', reason: 'unusable' };
      }
      await updateWork(db, work.id, { firstPublished: year });
      return { applied: `First published set to ${year}.`, skipped: null, reason: 'applied' };
    }

    case 'series': {
      if (!blank(work.series)) {
        return {
          applied: null,
          skipped: `Already in the series ${work.series}.`,
          reason: 'already',
        };
      }
      const name = String(finding.value.value ?? '').trim();
      if (!name) return { applied: null, skipped: 'No series name to write.', reason: 'unusable' };
      await updateWork(db, work.id, { series: name });
      return { applied: `Series set to ${name}.`, skipped: null, reason: 'applied' };
    }

    case 'seriesIndex': {
      if (work.seriesIndexSort != null) {
        // ⚠️ Two messages, because the gap test now reads both columns. With
        // the sort set and the display blank the book still shows a
        // volume-number gap — it sorts correctly and prints nothing — and
        // research cannot close it (the display quotes the cover, and
        // research read a web page). Saying only "already volume N" here
        // would leave a person staring at a queue row research claims is done.
        const displayStillNeeded =
          work.seriesIndexDisplay == null || work.seriesIndexDisplay.trim() === '';
        return {
          applied: null,
          skipped: displayStillNeeded
            ? `Already volume ${work.seriesIndexSort} in the ladder — but the printed form ` +
              `(what the cover actually says) is blank, and only a person with the book can fill it.`
            : `Already volume ${work.seriesIndexSort}.`,
          reason: 'already',
        };
      }
      if (blank(work.series)) {
        // ⚠️ Not 'unusable'. The volume number may be perfectly good; it has
        // nowhere to hang until a series exists. `autoApplyFindings` orders
        // `series` ahead of this one so the ordinary case never lands here.
        return {
          applied: null,
          skipped: 'This book has no series to be a volume of.',
          reason: 'already',
        };
      }
      const index = asIndex(finding.value.value);
      if (index == null) {
        return {
          applied: null,
          skipped: 'That is not a usable volume number.',
          reason: 'unusable',
        };
      }
      // ⚠️ `series_index_sort` only. `series_index_display` is what the COVER
      // says — "Book 2", "Volume 07", "Prequel" — and research read a web page,
      // not a cover. Filling it with "Book 2" would be inventing the one field
      // in this trio whose entire job is to quote something.
      await updateWork(db, work.id, { seriesIndexSort: index });
      // Honest about what was and was not filled: the row now SORTS as volume
      // N, but the printed form is still blank and the gap stays open until a
      // person quotes the cover. See `seriesIndexIncomplete`.
      return {
        applied: `Volume number set to ${index} (sorts correctly; the printed form still needs a person).`,
        skipped: null,
        reason: 'applied',
      };
    }

    case 'description': {
      if (!blank(work.description)) {
        return {
          applied: null,
          skipped: 'A description is already recorded.',
          reason: 'already',
        };
      }
      const text = String(finding.value.value ?? '').trim();
      if (!text) {
        return { applied: null, skipped: 'No description to write.', reason: 'unusable' };
      }
      await updateWork(db, work.id, { description: text });
      return { applied: 'Description saved.', skipped: null, reason: 'applied' };
    }
  }
}

// ---------------------------------------------------------------------------
// Applying everything a run found, without asking
// ---------------------------------------------------------------------------

export interface AutoApplyReport {
  /** One sentence per value written, ready to show. */
  applied: string[];
  /**
   * ⚠️ Reported by name, never swallowed. Constraint of the design: auto-apply
   * may not quietly discard a finding. Anything here either needed no action or
   * could not be written, and the second kind is still pending.
   */
  skipped: string[];
  /** Findings left `pending` because their value was not usable. */
  unusable: number;
}

/**
 * Apply every pending finding this book has, in the order they depend on.
 *
 * ⚠️ **`DETAIL_FIELDS` order, not insertion order, and that is a real bug
 * avoided rather than a tidiness preference.** `applyFinding` re-reads the work
 * each time, and refuses `seriesIndex` when the work has no series. A model that
 * returns the volume number before the series name — which it is free to do —
 * would have its volume number dropped on every book that had both to learn.
 * `DETAIL_FIELDS` puts `series` ahead of `seriesIndex` precisely so this
 * sequencing works, so this sorts by that list rather than trusting the array.
 *
 * Everything pending for the work is applied, not only what this run produced.
 * A finding left over from an earlier pass is a value the owner has already
 * declined to read once; leaving it queued forever helps nobody.
 */
export async function autoApplyFindings(
  db: D1Database,
  workId: number,
  userId: number | null,
): Promise<AutoApplyReport> {
  const pending = await listFindings(db, workId, 'pending');

  const order = (f: ResearchFinding) => {
    const i = (DETAIL_FIELDS as readonly string[]).indexOf(f.field);
    // An unrecognised field sorts last rather than first. It cannot be depended
    // on by anything, and putting it ahead of `series` would be the one way to
    // reintroduce the bug this sort exists to prevent.
    return i === -1 ? DETAIL_FIELDS.length : i;
  };
  const ordered = [...pending].sort((a, b) => order(a) - order(b) || a.id - b.id);

  const report: AutoApplyReport = { applied: [], skipped: [], unusable: 0 };

  for (const finding of ordered) {
    const outcome = await applyFinding(db, finding, userId, 'auto');

    if (outcome.applied) {
      report.applied.push(outcome.applied);
      await markFinding(db, finding.id, 'accepted', userId, 'auto');
      continue;
    }

    report.skipped.push(`${finding.field}: ${outcome.skipped ?? 'nothing to do'}`);

    // ⚠️ Only `unusable` stays pending. The gap is still open, so the queue must
    // keep saying so — this is the one thing auto-apply refuses to paper over.
    // Everything else is closed, or the page nags about questions that already
    // have answers.
    if (outcome.reason === 'unusable') {
      report.unusable += 1;
    } else {
      await markFinding(db, finding.id, 'accepted', userId, 'auto');
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// Taking it back
// ---------------------------------------------------------------------------

/**
 * Un-apply one auto-applied finding.
 *
 * ## Why this can simply write null, and could not if anything else changed
 *
 * `applyFinding` writes **only into a blank** — every branch above refuses a
 * column that already had something in it. So the value before an auto-apply is
 * always known without storing it: it was empty. That is what makes undo a
 * one-liner instead of an audit log, and it is load-bearing. ⚠️ If a future
 * change ever lets `applyFinding` overwrite a non-blank column, this becomes
 * wrong and starts destroying data — the previous value would have to be
 * recorded at write time instead.
 *
 * ## Two invariants it has to keep
 *
 * 1. **A volume number cannot outlive its series.** `applyFinding` refuses to
 *    set `seriesIndexSort` when `series` is blank, so undoing a series must take
 *    the index with it or leave a state the forward path would never create.
 * 2. **Only the machine's own work is reachable.** `decided_how = 'auto'` gates
 *    both the finding lookup and `deleteAutoVerdict`, so a bulk undo can never
 *    reach a verdict somebody wrote by hand.
 */
export async function revertFinding(
  db: D1Database,
  finding: ResearchFinding,
): Promise<{ reverted: string | null; skipped: string | null }> {
  if (finding.decidedHow !== 'auto' || finding.reviewState !== 'accepted') {
    return { reverted: null, skipped: 'That was not applied automatically.' };
  }

  const field = finding.field as DetailField;

  // A `none`/`unknown` finding became a verdict, not a column. Withdrawing it
  // puts the question back on the worklist, which is exactly what undo means.
  if (verdictFor(finding.value.kind)) {
    const gone = await deleteAutoVerdict(db, finding.workId, field);
    await markFinding(db, finding.id, 'rejected', null, 'human');
    return gone
      ? { reverted: `Withdrew the recorded answer for ${field}.`, skipped: null }
      : { reverted: null, skipped: 'That answer had already been changed by hand.' };
  }

  const work = await getWork(db, finding.workId);
  if (!work) return { reverted: null, skipped: 'That book no longer exists.' };

  switch (field) {
    case 'firstPublished':
      await updateWork(db, work.id, { firstPublished: null });
      break;
    case 'series':
      // See invariant 1. Both, together, or neither.
      await updateWork(db, work.id, { series: null, seriesIndexSort: null });
      break;
    case 'seriesIndex':
      await updateWork(db, work.id, { seriesIndexSort: null });
      break;
    case 'description':
      await updateWork(db, work.id, { description: null });
      break;
  }

  // Rejected, so a later run proposes it again rather than treating the question
  // as settled. Marked `human`, because throwing it away *is* a person's act —
  // the one act this whole feature preserved.
  await markFinding(db, finding.id, 'rejected', null, 'human');
  return { reverted: `Cleared ${field}.`, skipped: null };
}

export { ResearchError };
