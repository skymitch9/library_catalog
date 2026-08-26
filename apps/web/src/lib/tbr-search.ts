/**
 * Searching the TBR — narrowing the folded groups on `/tbr`, and the wheel with
 * them.
 *
 * ## ⚠️ The owner's ask, 2026-08-26
 *
 * > *"can we also add a search bar in the /tbr route too so people can search
 * > tbr books there too with the wheel"*
 *
 * Two halves, and the second is the one worth stating: **the wheel spins over
 * whatever the search left**. `TbrSpinner` is handed `groups.map(toSpinnerRow)`,
 * so narrowing the groups narrows the candidate pool with no change to the
 * spinner at all — and `groupTbrEntries` has already made that one candidate
 * per BOOK, which is the guarantee `docs/info/tbr.md` §9 gives.
 *
 * ## ⚠️ CLIENT-SIDE, over what the page already holds
 *
 * The page has the whole list in memory — it fetched every document from
 * Firestore and resolved them in one round trip. Asking a server to search it
 * would mean either shipping the list back up on every keystroke or building a
 * second index of a store the Worker cannot even see. So this is a pure
 * function over `TbrGroup`, and nothing new is fetched.
 *
 * ## ⚠️ NOT A MATCHER
 *
 * This is a **substring search a person typed**, not a claim that two records
 * are the same book. `tbrFoldKey` and `matching.ts` are where that decision
 * lives and they are deliberately strict about it; a search box is the opposite
 * kind of thing — being too generous here shows an extra row, which the person
 * can see and ignore. Do not be tempted to reuse `titleSimilarity` for it, and
 * do not let this grow into a third definition of "same book".
 */

import type { TbrFoldable, TbrGroup } from '@lc/core';

/**
 * Fold a string the way a search box should: case-insensitively, and with
 * accents and punctuation ignored so `cafe` finds *Café* and `dont` finds
 * *Don't*.
 *
 * ⚠️ **Deliberately NOT `normaliseTitle` from `@lc/core`.** That function
 * produces a piece of a PERSISTED KEY (`work_key`, Firestore document ids), so
 * changing it is a migration rather than an edit — and a search box is exactly
 * the kind of caller that later wants "one more small tweak" to how it folds.
 * Keeping them apart is what stops a tweak to the search bar becoming a silent
 * change to how two books are decided to be one. The comment is here rather
 * than in a commit message because the temptation is obvious and the cost is
 * not.
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Every string on a group a person could reasonably be typing at.
 *
 * ⚠️ **EVERY spelling the group was recorded under, not just the one on the
 * card.** A book folded from a paperback entry and an audiobook entry carries
 * *Firefight* and *Firefight - The Reckoners, Book 2*, and somebody who typed
 * "reckoners" means the same book — searching only the displayed title would
 * hide it. This is the same rule `matchTitles` follows on the audiobook site
 * (*"deliberately keeps EVERY spelling, because a catalogue row must still
 * match under either of them"*), stated here for the same reason: folding the
 * MATCH set would HIDE a book, which is a different and worse bug than showing
 * one twice.
 *
 * The series name is in too, for the reason the collection's `?q=` searches
 * `w.series`: before that clause, `?q=cradle` returned zero rows over six
 * Cradle books, because the importer strips the series out of the title.
 */
function haystack<T extends TbrFoldable>(group: TbrGroup<T>): string {
  const parts: string[] = [group.title, group.authors ?? ''];
  for (const entry of group.entries) {
    if (entry.title) parts.push(entry.title);
    if (entry.workTitle) parts.push(entry.workTitle);
    if (entry.authors) parts.push(entry.authors);
    const series = (entry as { series?: string | null }).series;
    if (series) parts.push(series);
  }
  return fold(parts.join(' '));
}

/**
 * The groups matching what was typed — every token must appear somewhere.
 *
 * ⚠️ **AND across tokens, substring within one.** `sanderson storm` finds a
 * Stormlight book by Brandon Sanderson even though no single field holds both
 * words, which is what a person typing two words means. OR would widen with
 * every word typed, so the list would grow as they refined it — the behaviour
 * that makes a search box feel broken.
 *
 * An empty or whitespace-only query returns the groups **unchanged and in the
 * same order**, so a cleared box is indistinguishable from never having typed.
 */
export function narrowTbrGroups<T extends TbrFoldable>(
  groups: readonly TbrGroup<T>[],
  query: string,
): TbrGroup<T>[] {
  const tokens = fold(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return [...groups];
  return groups.filter((group) => {
    const hay = haystack(group);
    return tokens.every((t) => hay.includes(t));
  });
}

/**
 * "Nothing on your list matches that" — said in words, with the query in it.
 *
 * ⚠️ **It says the list is intact.** An empty result under a search box reads
 * as the list having been emptied if nothing says otherwise, and this list is
 * one people have reported as "not synced" before (`docs/info/tbr.md` §10). The
 * total is named so the person can see their books are still there.
 *
 * `null` when the query is empty — an unfiltered list showing nothing is the
 * page's own empty state, not this one's.
 */
export function noTbrMatchSentence(query: string, total: number): string | null {
  const typed = query.trim();
  if (!typed) return null;
  return (
    `Nothing on your list matches “${typed}”. All ${total} ` +
    `${total === 1 ? 'book is' : 'books are'} still there — clear the box to see ` +
    'them.'
  );
}

/**
 * "Showing 3 of 40" — how much of the list is on screen while a search is on.
 *
 * ⚠️ **Only while something is typed, and only when it actually narrowed.** A
 * count repeated over an unfiltered list is the kind of label that stops being
 * read, which is the rule `preordered` follows on a collection card: only the
 * exceptions earn one.
 */
export function tbrSearchCountSentence(
  query: string,
  shown: number,
  total: number,
): string | null {
  if (!query.trim() || shown === total) return null;
  return `Showing ${shown} of ${total} ${total === 1 ? 'book' : 'books'} on your list.`;
}
