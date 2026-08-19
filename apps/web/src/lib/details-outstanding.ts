/**
 * ⚠️ **What "Look up all" is allowed to offer.** The one piece of judgement
 * behind the queue page's primary button, pure and exported so it sits under a
 * test rather than inside a render.
 *
 * ## The incident this exists to make impossible
 *
 * 2026-08-19, reported twice by the owner as *"the button didnt fix"*. The page
 * had:
 *
 * ```ts
 * const outstanding = shown.filter((w) => runs[w.workId] === undefined);
 * ```
 *
 * `runs` is keyed **by work**, so "already asked" was a fact about a BOOK. A
 * research pass filled `series` on 57 books — which marked those books asked —
 * and the volume question (`seriesIndex`) only comes into existence once a book
 * HAS a series (`detailFieldsFor`). So 51 questions that had never been put to
 * anybody were born behind an "already asked" marker: the button rendered
 * **"Every one already asked"**, disabled, one line under the page's own
 * sentence *"51 books are waiting for a lookup."* Both sentences were true,
 * which is the whole problem.
 *
 * ## The two lies, and why the fix is neither of them
 *
 * ⚠️ **Dropping the marker is a worse bug than the one it fixes.** Every run
 * costs 2–8¢ of somebody's Anthropic allowance, and a queue with no memory
 * re-buys the same nothing for ever — roughly half this library has no free
 * record anywhere (`isbn-ladder.md` §4.2), so "asked and came back empty" is
 * the *expected* outcome, not a retryable failure.
 *
 * So the button has to be honest in **both** directions, and the only shape
 * that is, is per **(work, field)**:
 *
 * | | must not |
 * |---|---|
 * | offer | a question already bought — that is the paid re-ask loop |
 * | hide | a question nobody has put — that is what got reported as broken |
 *
 * ## Where "asked" comes from, and where it must not
 *
 * `work.asked` is the server's, out of `detailsRunHistory` — **finished runs
 * only**, and only while `input_title` still matches, so an errored lookup has
 * asked nothing and a retitled book becomes askable again. It is the same
 * record the hourly sweep plans against, so the button and the cron cannot
 * disagree about what is left.
 *
 * ⚠️ **Do not re-derive it from `runs`.** That map holds the latest run per
 * work, of any status; reading it would count a failed lookup as an answer and
 * would miss every field an older run covered.
 *
 * `sessionAsked` is the second half, and it is not optional. The page does not
 * refetch the worklist between books during a sweep, so without it the count
 * would sit still while forty books were bought — and after a run that *threw*,
 * nothing would stop the driver re-firing at the same book for ever. It records
 * what this tab has put, whatever came back.
 */

import { unaskedGaps, type DetailField } from '@lc/core';

/** Just enough of a queue row to decide whether it is still worth buying. */
export interface OutstandingSubject {
  workId: number;
  /** Everything this work still owes. */
  missing: readonly DetailField[];
  /** Questions a finished run already put. Absent on an older API response. */
  asked?: readonly string[];
}

/** Questions this tab has put during this visit, by work id. */
export type SessionAsked = Readonly<Record<number, readonly string[]>>;

/**
 * Every question a finished run has put to this book: the server's memory of
 * previous visits, plus what this one has bought since the last load.
 *
 * ⚠️ The single definition of "already asked" on this page. `residueSentence`
 * takes it too, so the row's *"research looked and could not identify this"*
 * sentence and the button's count cannot contradict each other — they did on
 * 2026-08-19, in both directions, on the same screen.
 */
export function askedFor(
  work: OutstandingSubject,
  sessionAsked: SessionAsked = {},
): string[] {
  return [...(work.asked ?? []), ...(sessionAsked[work.workId] ?? [])];
}

/**
 * The open questions on this book that nobody has paid for yet.
 *
 * Empty means the book is genuinely finished with lookups: it may still be on
 * the worklist (`missing` non-empty) and that is correct — what it is waiting
 * for is a person. `residueSentence` is the row-level half of the same fact.
 */
export function outstandingFields(
  work: OutstandingSubject,
  sessionAsked: SessionAsked = {},
): DetailField[] {
  return unaskedGaps(work.missing, askedFor(work, sessionAsked));
}

/** The books "Look up all" would actually spend money on, in worklist order. */
export function outstandingWorks<T extends OutstandingSubject>(
  works: readonly T[],
  sessionAsked: SessionAsked = {},
): T[] {
  return works.filter((w) => outstandingFields(w, sessionAsked).length > 0);
}

/**
 * What one finished POST contributes to the session record — **nothing at all
 * unless the run finished.**
 *
 * ⚠️ This is the browser's copy of the rule `detailsRunHistory` applies in SQL,
 * and it is the refusal that keeps the whole change honest in the second
 * direction: a run that came back `error` never got an answer, so its questions
 * have not been put and must stay on the button's list. Recording them would
 * hide open work behind a marker — the exact defect being fixed, reintroduced
 * one layer up. Pure and exported so it sits under a test rather than inside a
 * `try` block.
 */
export function askedByRun(run: { status: string; asked: readonly string[] }): readonly string[] {
  return run.status === 'done' ? run.asked : [];
}

/**
 * Add what a finished run covered to the session record. Returns a new object;
 * never mutates.
 *
 * ⚠️ The session record answers *"has this question been put?"*, not *"has this
 * book been tried?"*. The second is `startedRef` on the page, and the two are
 * deliberately different: a failed lookup has been tried (so the driver must
 * not loop on it) and has not been asked (so the button must keep offering it).
 */
export function withSessionAsked(
  sessionAsked: SessionAsked,
  workId: number,
  fields: readonly string[],
): SessionAsked {
  if (fields.length === 0) return sessionAsked;
  const already = sessionAsked[workId] ?? [];
  return { ...sessionAsked, [workId]: [...new Set([...already, ...fields])] };
}
