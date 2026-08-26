/**
 * "Show me only the books on my list" — the collection search bar's read-state
 * filter, and every sentence it can produce.
 *
 * ## ⚠️ The owner's ask, 2026-08-26
 *
 * > *"can we also add a filter in each of the search bars for tbr and other
 * > read states"*
 *
 * The list is the shared `readingLists` collection — the same store `/tbr`
 * reads, the same one the audiobook site writes. **There is no second store and
 * no second matcher**: this page reads its own documents, hands their keys to
 * `POST /api/tbr/resolve` (the SAME `resolveTbrEntries` path `/tbr` uses), and
 * passes the work ids that come back to the collection query as `?listIds=`.
 *
 * ## ⚠️ Why the WORDING is a module with tests rather than JSX
 *
 * Four different things produce an empty grid under this filter and **the fixes
 * are four different fixes**, which is the estate's rule about never showing a
 * bare refusal applied to an empty result:
 *
 * | Cause | What the person must do |
 * |---|---|
 * | not signed in | sign in — and the control is not even rendered (see the page) |
 * | signed in, list genuinely empty | add a book to it |
 * | list has books, none in this catalogue | nothing — they are audiobooks and ebooks, and 53 of Samantha's 358 were exactly this (`docs/info/tbr.md` §10) |
 * | list matched books, the OTHER filters excluded them | clear a filter |
 *
 * A single *"Nothing matches that"* over all four is the silent-failure rule
 * broken in the expensive direction: the third case looks exactly like the
 * second, and the second looks exactly like the list having been lost. So the
 * page states which one it is, and the sentences live here — the precedent
 * `lib/tbr-elsewhere.ts` set, for the same reason: a sentence a person reads is
 * a pure function with its own tests, so the wording can be argued about in a
 * test file rather than in a JSX diff.
 *
 * ⚠️ **Nothing here says "failed", "missing" or "not synced"**, and the tests
 * assert those absences. The entries are in the shared store exactly as
 * recorded; blaming a sync would send the next session hunting a bug that
 * measured clean.
 */

import { READING_LIST_STATUS_LABEL, type ReadingListStatus } from '@lc/core';

/** What the filter is called on screen, per status. One spelling estate-wide. */
export { READING_LIST_STATUS_LABEL };

/**
 * The work ids a resolved reading list actually reached in this catalogue.
 *
 * ⚠️ **`workId === null` is DROPPED, not turned into anything.** It means all
 * three rungs of `resolveTbrEntries` — the indexed `work_key` pass, the
 * title-slug scan and the `audiobook_holding` / `ebook_holding` bridge —
 * declined to name a work, which is the ordinary case rather than a failure
 * (the household holds ~1,075 audiobooks against a few hundred works here).
 * There is nothing in the grid to show for such an entry, and `notInCatalogue`
 * below is how the page says so instead of silently shrinking the count.
 *
 * ⚠️ **Deduplicated, because two documents can resolve to one work** — that is
 * the whole media fold (`tbrFoldKey`): a book on paper and on audio is two
 * documents and one `work_id`. An id list with repeats would still filter
 * correctly (`IN (…)` does not care) but would misreport how many books the
 * filter is showing, and the page prints that number.
 *
 * First-seen order, so the caller's order decides and nothing here is a
 * tiebreak worth more than that.
 */
export function readingListWorkIds(
  matches: readonly { workId: number | null }[],
): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const m of matches) {
    const id = m.workId;
    if (typeof id !== 'number' || !Number.isInteger(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** What a resolved reading list came to, in the two numbers the wording needs. */
export interface ReadingListNarrowing {
  /** Documents this person has at that status, after `myReadingListEntries`. */
  listed: number;
  /** Of those, how many named a work this catalogue holds a row for. */
  matched: number;
}

/**
 * The count of entries on the list that this catalogue has no row for.
 *
 * Never negative, however the two numbers arrive — a caller that swapped them
 * should get `0` rather than a sentence promising minus four books.
 */
export function notInCatalogue(n: ReadingListNarrowing): number {
  return Math.max(0, n.listed - n.matched);
}

/**
 * The note that sits under the search bar while the filter is on.
 *
 * ⚠️ **It is rendered whether or not the grid is empty**, because the
 * interesting number is true either way: *"showing 12 of the 40 books on your
 * TBR — the other 28 are not in this catalogue"* is the sentence that stops a
 * person counting cards and concluding the list lost books. §10 of
 * `docs/info/tbr.md` measured exactly that misreading.
 *
 * `null` when there is nothing worth saying — a list whose every book is here,
 * with the grid showing them. The empty cases are `readingListEmptyMessage`'s.
 */
export function readingListNote(
  status: ReadingListStatus,
  n: ReadingListNarrowing,
): string | null {
  const missing = notInCatalogue(n);
  if (n.listed === 0 || missing === 0) return null;
  const label = status === 'tbr' ? 'to-read list' : 'read list';
  const books = (k: number) => `${k} ${k === 1 ? 'book' : 'books'}`;
  return (
    `Showing the ${books(n.matched)} from your ${label} that this catalogue holds. ` +
    `The other ${missing} ${missing === 1 ? 'is' : 'are'} still on your list — ` +
    `${missing === 1 ? 'it is' : 'they are'} an audiobook or an ebook the household ` +
    'holds elsewhere, so there is no copy here to show.'
  );
}

/**
 * Why the grid is empty, in words, when this filter is the reason.
 *
 * ⚠️ **`null` means "this filter is not the explanation"** — the list matched
 * books and something else excluded them — and the caller falls back to its own
 * *"Nothing matches that"*. Returning a sentence in that case would blame the
 * reading list for a Series dropdown, which is worse than saying nothing.
 */
export function readingListEmptyMessage(
  status: ReadingListStatus,
  n: ReadingListNarrowing,
): string | null {
  const label = status === 'tbr' ? 'to-read list' : 'read list';

  if (n.listed === 0) {
    // ⚠️ Says where the list is written, because it is written in two places
    // and neither is this screen. A bare "your list is empty" leaves a person
    // with nowhere to go.
    return status === 'tbr'
      ? 'Nothing on your to-read list yet. A book page has an “Add to my TBR” button, ' +
          'and so does the audiobook site — it is the same list.'
      : 'Nothing marked read on your list yet. Marking a book read on the audiobook ' +
          'site puts it here — it is the same list.';
  }

  if (n.matched === 0) {
    const k = n.listed;
    // The measured case: 53 of Samantha's 358 entries name a book padhard has
    // no row for, and 48 of those are absent from the main instance too. Not a
    // sync failure, and the sentence must not imply one.
    return (
      `Your ${label} has ${k} ${k === 1 ? 'book' : 'books'} on it, but ` +
      `${k === 1 ? 'it is not' : 'none of them are'} in this catalogue — ` +
      `${k === 1 ? 'it will be' : 'they will be'} an audiobook or an ebook the ` +
      `household holds elsewhere. ${k === 1 ? 'It is' : 'They are'} still on your ` +
      'list; there is just no copy here to show. The My TBR screen lists them.'
    );
  }

  return null;
}

/**
 * The sentence for a session that has not settled which account it is.
 *
 * ⚠️ **Not an empty list, and never worded as one.** Firebase publishes a
 * restored session asynchronously (~340 ms of token refresh measured on the
 * sibling app), so pressing this filter early is an ordinary race — and a
 * reading list is attributed by uid ALONE since the 2026-08-18 account
 * migration, so a missing uid fails CLOSED and every document is rejected. The
 * audiobook site's own filter hit this and says the same thing in the same
 * words; two surfaces, one sentence.
 */
export const READING_LIST_NO_ACCOUNT =
  'Could not confirm which account you are signed in as, so your list cannot be ' +
  'shown yet. Give the page a moment and try again, or reload it.';

/**
 * The sentence for a read that did not answer.
 *
 * ⚠️ **AN OUTAGE IS NOT AN EMPTY LIST.** The estate rule is that the four
 * causes stay distinct because the fixes differ, and "your list is empty" told
 * to somebody whose network dropped is the most expensive of the four to get
 * wrong: it reads as data loss.
 */
export function readingListErrorMessage(detail: string): string {
  return (
    `Could not load your reading list — ${detail} Your list is safe; this is a ` +
    'connection problem, not an empty list. Try again.'
  );
}
