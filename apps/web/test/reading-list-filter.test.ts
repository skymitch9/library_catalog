/**
 * `lib/reading-list-filter.ts` — the collection filter's ids and its sentences.
 *
 * Owner, 2026-08-26: *"can we also add a filter in each of the search bars for
 * tbr and other read states"*.
 *
 * ## ⚠️ Why the WORDING is tested at all
 *
 * Four different things produce an empty grid under this filter and the fixes
 * are four different fixes — not signed in / list empty / on the list but not in
 * this catalogue / excluded by another control. A single *"Nothing matches
 * that"* over all four is the estate's silent-failure rule broken in the
 * expensive direction, because the third case looks exactly like the second and
 * the second looks exactly like the list having been lost.
 *
 * ⚠️ And it HAS been misread once. Measured 2026-08-26 (`docs/info/tbr.md` §10):
 * the owner reported *"in the tbr list, not all have sync'd"* about 53 entries
 * that had synced perfectly and simply name books padhard holds no row for. So
 * the assertions below include what the sentences must NEVER say.
 *
 * The precedent is `tbr-elsewhere.test.ts` beside this file: a sentence a person
 * reads is a pure function with its own tests, so the wording can be argued
 * about in a test file rather than in a JSX diff.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  READING_LIST_NO_ACCOUNT,
  notInCatalogue,
  readingListEmptyMessage,
  readingListErrorMessage,
  readingListNote,
  readingListWorkIds,
} from '../src/lib/reading-list-filter.js';

describe('readingListWorkIds — what the list actually reached', () => {
  it('takes the matched works and nothing else', () => {
    assert.deepEqual(
      readingListWorkIds([{ workId: 4 }, { workId: 9 }, { workId: 1 }]),
      [4, 9, 1],
    );
  });

  it('⚠️ drops an unmatched entry rather than inventing anything for it', () => {
    // `workId === null` is the ordinary case, not a failure: the household owns
    // ~1,075 audiobooks against a few hundred works here. There is nothing in
    // the grid to show for one, and the note says so instead.
    assert.deepEqual(readingListWorkIds([{ workId: null }, { workId: 2 }, { workId: null }]), [2]);
  });

  it('⚠️ deduplicates — two documents can resolve to ONE work (the media fold)', () => {
    // A book on paper and on audio is two `readingLists` documents and one
    // `work_id`. Repeats would still filter correctly but would misreport how
    // many books are on screen, and the page prints that number.
    assert.deepEqual(readingListWorkIds([{ workId: 7 }, { workId: 7 }, { workId: 8 }]), [7, 8]);
  });

  it('an empty list of matches is an empty list of ids, not undefined', () => {
    assert.deepEqual(readingListWorkIds([]), []);
  });
});

describe('notInCatalogue', () => {
  it('is the gap between what is listed and what was matched', () => {
    assert.equal(notInCatalogue({ listed: 358, matched: 305 }), 53);
  });

  it('never goes negative, however the numbers arrive', () => {
    assert.equal(notInCatalogue({ listed: 2, matched: 6 }), 0);
  });
});

describe('readingListNote — the two numbers, said out loud', () => {
  it('names both figures when some of the list is elsewhere', () => {
    const note = readingListNote('tbr', { listed: 40, matched: 12 });
    assert.ok(note);
    assert.match(note, /12 books/);
    assert.match(note, /other 28/);
  });

  it('says nothing when the whole list is in this catalogue', () => {
    assert.equal(readingListNote('tbr', { listed: 12, matched: 12 }), null);
  });

  it('says nothing for an empty list — that is the empty message’s job', () => {
    assert.equal(readingListNote('read', { listed: 0, matched: 0 }), null);
  });

  it('reads singularly for one book', () => {
    const note = readingListNote('read', { listed: 2, matched: 1 });
    assert.ok(note);
    assert.match(note, /1 book\b/);
    assert.match(note, /other 1 is/);
  });

  it('⚠️ never says failed, missing or not synced', () => {
    const note = readingListNote('tbr', { listed: 358, matched: 305 });
    assert.ok(note);
    for (const word of [/fail/i, /missing/i, /sync/i, /lost/i]) {
      assert.doesNotMatch(note, word);
    }
  });
});

describe('readingListEmptyMessage — which of the causes it was', () => {
  it('an empty to-read list says where a book is added from', () => {
    const msg = readingListEmptyMessage('tbr', { listed: 0, matched: 0 });
    assert.ok(msg);
    assert.match(msg, /audiobook site/);
    assert.match(msg, /same list/);
  });

  it('an empty read list is worded for the read list, not the to-read one', () => {
    const msg = readingListEmptyMessage('read', { listed: 0, matched: 0 });
    assert.ok(msg);
    assert.match(msg, /read/i);
    assert.doesNotMatch(msg, /Add to my TBR/);
  });

  it('⚠️ a list with books but none here says exactly that, with the count', () => {
    // The measured case: 53 of Samantha's 358 to-read entries.
    const msg = readingListEmptyMessage('tbr', { listed: 53, matched: 0 });
    assert.ok(msg);
    assert.match(msg, /53 books/);
    assert.match(msg, /none of them are in this catalogue/);
    assert.match(msg, /still on your list/);
  });

  it('⚠️ and never blames a sync for it', () => {
    const msg = readingListEmptyMessage('tbr', { listed: 53, matched: 0 });
    assert.ok(msg);
    for (const word of [/fail/i, /missing/i, /sync/i, /lost/i, /error/i]) {
      assert.doesNotMatch(msg, word);
    }
  });

  it('reads singularly for one book', () => {
    const msg = readingListEmptyMessage('tbr', { listed: 1, matched: 0 });
    assert.ok(msg);
    assert.match(msg, /1 book\b/);
    assert.match(msg, /it is not in this catalogue/);
  });

  it('⚠️ answers null when the list DID match and something else excluded them', () => {
    // Blaming the reading list for a Series dropdown would be worse than saying
    // nothing; the caller falls back to its own "Nothing matches that."
    assert.equal(readingListEmptyMessage('tbr', { listed: 40, matched: 12 }), null);
  });
});

describe('the two sentences that are NOT about an empty list', () => {
  it('⚠️ the no-account sentence never says the list is empty', () => {
    assert.match(READING_LIST_NO_ACCOUNT, /account/i);
    assert.match(READING_LIST_NO_ACCOUNT, /reload|try again/i);
    assert.doesNotMatch(READING_LIST_NO_ACCOUNT, /empty|no books|nothing on/i);
  });

  it('⚠️ AN OUTAGE IS NOT AN EMPTY LIST — the most expensive one to mislabel', () => {
    const msg = readingListErrorMessage('the server did not answer.');
    assert.match(msg, /connection problem/i);
    assert.match(msg, /your list is safe/i);
    // ⚠️ It may mention emptiness only to DENY it. What is forbidden is the
    // shapes that ASSERT it — those are what read as data loss.
    assert.doesNotMatch(msg, /your list is empty|you have nothing|no books on/i);
  });
});
