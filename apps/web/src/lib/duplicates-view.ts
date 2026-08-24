/**
 * The words the duplicates view puts on screen.
 *
 * Pure, and in `lib/` rather than inline in `CollectionPage.tsx`, for the
 * reason every other file here is: this app's tests run under `node:test` with
 * no DOM, so a sentence that lives in JSX is a sentence nothing can pin. The
 * empty state is the one most worth pinning — it is what the owner sees on the
 * day the feature works perfectly.
 */

import { UNKNOWN_AUTHOR } from '@lc/core';
import type { DuplicateGroupView, DuplicateWork } from '../api.js';

/**
 * "No duplicates found across 1,143 works."
 *
 * ⚠️ **The number is the whole point of the sentence.** A bare "no duplicates"
 * is indistinguishable from a finder that ran over nothing, silently filtered
 * itself to zero rows, or failed and swallowed the error — the silent-wrong-
 * guess this page writes notes about everywhere else. Saying what it looked at
 * makes "none" evidence rather than an absence.
 *
 * Localised like every other count on this page (`Stat` uses `toLocaleString`),
 * so a four-figure catalog reads as 1,143 and not 1143.
 */
export function duplicatesEmptyMessage(totalWorks: number): string {
  return `No duplicates found across ${totalWorks.toLocaleString()} work${
    totalWorks === 1 ? '' : 's'
  }.`;
}

/**
 * "3 books recorded twice, in 2 groups" — the header above the list.
 *
 * Says both numbers because they answer different questions: how much there is
 * to fix, and how many decisions that is. A group of three is one decision.
 */
export function duplicatesSummary(groups: readonly DuplicateGroupView[]): string {
  const works = groups.reduce((n, g) => n + g.works.length, 0);
  return (
    `${works.toLocaleString()} record${works === 1 ? '' : 's'} to look at, ` +
    `in ${groups.length.toLocaleString()} group${groups.length === 1 ? '' : 's'}.`
  );
}

/**
 * The author, as a person reads it.
 *
 * ⚠️ The sentinel becomes words here and nowhere else. The API deliberately
 * hands over the raw stored string — `workKeyFor` needs it — so exactly one
 * place has to know that `?unknown` is not somebody's name.
 */
export function duplicateAuthorLabel(authors: string): string {
  return authors === UNKNOWN_AUTHOR ? 'Author unknown' : authors;
}

/**
 * The line under a title that tells two rows in a group apart.
 *
 * Only the parts that exist, joined with a middle dot. ⚠️ A row with nothing
 * to say gets an empty string rather than a lonely separator — the two rows in
 * a group often differ in exactly one of these fields, and that difference is
 * the whole reason the person is on this screen.
 */
export function duplicateRowDetail(work: DuplicateWork): string {
  const parts: string[] = [];
  if (work.subtitle) parts.push(work.subtitle);
  if (work.series) parts.push(work.series);
  if (work.copyCount > 0) {
    parts.push(`${work.copyCount} cop${work.copyCount === 1 ? 'y' : 'ies'}`);
  } else {
    // Worth saying out loud: a work with no copy at all is the likelier of a
    // pair to be the stray row, and "0 copies" reads as a missing number.
    parts.push('no copies');
  }
  return parts.join(' · ');
}
