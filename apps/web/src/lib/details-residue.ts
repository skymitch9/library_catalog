/**
 * ⚠️ **The named residue.** Owner rule, 2026-08-19: *"a book missing details
 * either gets them filled automatically within a day, or sits in a NAMED
 * residue category that the queue page displays with those words — never an
 * anonymous count that looks like a bug."*
 *
 * The queue does not converge to zero and is not supposed to: per
 * `isbn-ladder.md` §4.2 roughly half this library has no free record anywhere,
 * so a run that honestly comes back with nothing leaves the gap exactly where
 * it was. **That row then looks identical to a row nobody has got to yet**, and
 * a count that never falls is indistinguishable from a broken feature — which
 * is precisely what happened: the owner reported *"the button didnt fix"* about
 * a button that had worked forty times that afternoon.
 *
 * So a row whose open questions have all been PUT gets a sentence saying so,
 * naming what would actually close it. Pure, and exported, because it is the
 * page's one piece of judgement and belongs under a test rather than inside a
 * render.
 *
 * ## ⚠️ It takes the ASKED SET, not a run — changed 2026-08-19
 *
 * It used to take `runs[workId]`, the latest run, and read `run.asked` off it.
 * That was only ever *most* of the answer: a book asked about `series` in one
 * run and `seriesIndex` in the next has two runs' worth of questions behind it,
 * and the latest one alone says a settled row is still waiting. It also put
 * this sentence and the "Look up N" button on two different definitions of
 * already-asked, which is the family of defect that produced both of the day's
 * bugs. They now share one: `outstandingFields` is empty exactly when this
 * returns a sentence, because both are `unaskedGaps`.
 *
 * ⚠️ The caller owes it a set built from **finished** runs only. An error never
 * got an answer, so a book whose lookup failed is still waiting its turn, and
 * saying "we looked" about it would be the opposite lie from the one this
 * fixes. `askedByRun` and the server's `detailsRunHistory` each enforce that.
 */
import { unaskedGaps, type DetailField } from '@lc/core';

export function residueSentence(
  missing: readonly string[],
  asked: readonly string[],
): string | null {
  if (missing.length === 0) return null;
  // Not every open question has been put — the book is still genuinely queued
  // for the rest, so it is not residue and must not be labelled as settled.
  if (unaskedGaps(missing as readonly DetailField[], asked).length > 0) return null;

  if (missing.length === 1 && missing[0] === 'seriesIndex') {
    return (
      'Research asked which volume this is and no source says. ' +
      'Somebody who knows the series can set it on the book page — another lookup will not help.'
    );
  }
  return (
    'Research looked and could not identify this book. ' +
    'About half this library has no free record anywhere, so this is an answer rather than a failure — ' +
    'it needs a person, not another lookup.'
  );
}
