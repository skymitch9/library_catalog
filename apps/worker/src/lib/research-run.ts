/**
 * Running one research pass, and applying one finding a person accepted.
 *
 * Two jobs, kept in one file because they are the two halves of the same rule:
 * **the run proposes, the person disposes.** Nothing in `runDetailsResearch`
 * writes to `work`; nothing in `applyFinding` runs without somebody having
 * pressed a button.
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
 */

import {
  detailGaps,
  verdictFor,
  type DetailField,
  type FindingValue,
  type GapSubject,
} from '@lc/core';
import {
  activeRun,
  closeStaleRuns,
  createRun,
  finishRun,
  getWork,
  listGapVerdicts,
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
    detail: run.result?.detail ?? null,
    model: run.model,
    effort: run.effort,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
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
      authors: work.authors,
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

    return await finishRun(env.DB, runId, {
      status: 'done',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      result: {
        proposed: saved,
        detail: saved === 0 ? (answer.note ?? 'Nothing to propose.') : answer.note,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
    });
    return {
      applied:
        verdict === 'none'
          ? `Recorded: this book has no ${field}. It will not be asked again.`
          : `Recorded: nobody knows this book's ${field}. It will not be asked again.`,
      skipped: null,
    };
  }

  const work = await getWork(db, finding.workId);
  if (!work) return { applied: null, skipped: 'That book no longer exists.' };

  const blank = (v: string | number | null) =>
    v == null || (typeof v === 'string' && v.trim() === '');

  switch (field) {
    case 'firstPublished': {
      if (!blank(work.firstPublished)) {
        return { applied: null, skipped: `Already recorded as ${work.firstPublished}.` };
      }
      const year = asYear(finding.value.value);
      if (year == null) return { applied: null, skipped: 'That is not a usable year.' };
      await updateWork(db, work.id, { firstPublished: year });
      return { applied: `First published set to ${year}.`, skipped: null };
    }

    case 'series': {
      if (!blank(work.series)) {
        return { applied: null, skipped: `Already in the series ${work.series}.` };
      }
      const name = String(finding.value.value ?? '').trim();
      if (!name) return { applied: null, skipped: 'No series name to write.' };
      await updateWork(db, work.id, { series: name });
      return { applied: `Series set to ${name}.`, skipped: null };
    }

    case 'seriesIndex': {
      if (work.seriesIndexSort != null) {
        return { applied: null, skipped: `Already volume ${work.seriesIndexSort}.` };
      }
      if (blank(work.series)) {
        return { applied: null, skipped: 'This book has no series to be a volume of.' };
      }
      const index = asIndex(finding.value.value);
      if (index == null) return { applied: null, skipped: 'That is not a usable volume number.' };
      // ⚠️ `series_index_sort` only. `series_index_display` is what the COVER
      // says — "Book 2", "Volume 07", "Prequel" — and research read a web page,
      // not a cover. Filling it with "Book 2" would be inventing the one field
      // in this trio whose entire job is to quote something.
      await updateWork(db, work.id, { seriesIndexSort: index });
      return { applied: `Volume number set to ${index}.`, skipped: null };
    }

    case 'description': {
      if (!blank(work.description)) {
        return { applied: null, skipped: 'A description is already recorded.' };
      }
      const text = String(finding.value.value ?? '').trim();
      if (!text) return { applied: null, skipped: 'No description to write.' };
      await updateWork(db, work.id, { description: text });
      return { applied: 'Description saved.', skipped: null };
    }
  }
}

export { ResearchError };
