/**
 * `myReadingListEntries` — the same list, at a status the caller names.
 *
 * Owner, 2026-08-26: *"can we also add a filter in each of the search bars for
 * tbr and other read states"*.
 *
 * ## What earns this file
 *
 * `myTbrEntries` had `'tbr'` welded into it. The collection filter has to reach
 * `status: 'read'` documents too, and the one thing that must NOT happen while
 * making that possible is a second reader with its own idea of whose list a
 * document is on: the ownership rule carries the whole 2026-08-18 account
 * migration in it, and a name-fallback creeping back would hand a name-sharer
 * somebody else's list while every other test still passed.
 *
 * So the properties pinned here are:
 *
 *   1. ⚠️ **`myTbrEntries` IS `myReadingListEntries(…, 'tbr')`** — identical
 *      output over the same documents. If they ever diverge, one of them is a
 *      second implementation and this file is the alarm.
 *   2. `'read'` reaches the documents `'tbr'` drops, and vice versa. Measured
 *      2026-08-26: production holds 393 `tbr` and 162 `read`.
 *   3. ⚠️ **A status this catalog has never seen selects NOTHING**, rather than
 *      being guessed at — the refusal `TBR_STATUS`'s own header states.
 *   4. ⚠️ **Ownership is still by ACCOUNT**, at every status. The uid branch is
 *      the one that must not be softened.
 *   5. The dedupe and the `bookId` guard still apply, so a "read" list folds
 *      two spellings of one book exactly as a to-read list does.
 *   6. `READING_LIST_STATUSES` is exactly what was measured, and every value in
 *      it has a label — a control cannot offer an option it cannot name.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { READING_LIST_STATUSES, READING_LIST_STATUS_LABEL, TBR_STATUS } from '../src/constants.js';
import { myReadingListEntries, myTbrEntries } from '../src/tbr.js';

const ME = { uid: 'uid-owner', email: 'owner@example.com', reviewName: 'Skylar' };

/** One document as it sits in `readingLists`, keyed to an account. */
function doc(
  bookId: string,
  status: string,
  extra: Record<string, unknown> = {},
): { docId: string; uid: string; bookId: string; bookTitle: string; status: string } & Record<
  string,
  unknown
> {
  return {
    docId: `uid-owner_${bookId}`,
    uid: 'uid-owner',
    bookId,
    bookTitle: bookId,
    status,
    ...extra,
  };
}

const DOCS = [
  doc('firefight', 'tbr', { workKey: 'firefight|brandon sanderson' }),
  doc('firefight-the-reckoners-book-2', 'tbr', { workKey: 'firefight|brandon sanderson' }),
  doc('warbreaker', 'read'),
  doc('elantris', 'read'),
  // Somebody else's, at both statuses — the account gate, not a status question.
  { ...doc('mistborn', 'tbr'), docId: 'uid-other_mistborn', uid: 'uid-other' },
  { ...doc('skyward', 'read'), docId: 'uid-other_skyward', uid: 'uid-other' },
];

describe('myReadingListEntries — one reader, any status', () => {
  it('⚠️ myTbrEntries IS this function with "tbr" bound — identical output', () => {
    assert.deepEqual(myTbrEntries(DOCS, ME), myReadingListEntries(DOCS, ME, TBR_STATUS));
  });

  it('"tbr" reaches the to-read documents and folds the two spellings into one', () => {
    const entries = myReadingListEntries(DOCS, ME, 'tbr');
    // Two documents, one `workKey`, one row — the dedupe `myTbrEntries` has
    // always applied, unchanged by the status becoming a parameter.
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.workKey, 'firefight|brandon sanderson');
  });

  it('"read" reaches exactly the documents "tbr" drops', () => {
    const read = myReadingListEntries(DOCS, ME, 'read').map((e) => e.bookId).sort();
    assert.deepEqual(read, ['elantris', 'warbreaker']);
    const tbr = myReadingListEntries(DOCS, ME, 'tbr').map((e) => e.bookId);
    for (const id of read) assert.ok(!tbr.includes(id), `${id} must not be on both`);
  });

  it('⚠️ a status this catalog has never seen selects NOTHING — never a guess', () => {
    assert.deepEqual(myReadingListEntries(DOCS, ME, 'dnf'), []);
    assert.deepEqual(myReadingListEntries(DOCS, ME, ''), []);
  });

  it('⚠️ ownership is still by ACCOUNT at every status — the 2026-08-18 rule', () => {
    for (const status of READING_LIST_STATUSES) {
      const mine = myReadingListEntries(DOCS, ME, status);
      for (const entry of mine) {
        assert.ok(
          entry.docId.startsWith('uid-owner_'),
          `a ${status} entry leaked from another account: ${entry.docId}`,
        );
      }
    }
  });

  it('⚠️ a name-sharer gets nothing, even carrying the same display name', () => {
    const sharer = { uid: 'uid-sharer', email: null, reviewName: 'Skylar' };
    for (const status of READING_LIST_STATUSES) {
      assert.deepEqual(myReadingListEntries(DOCS, sharer, status), []);
    }
  });

  it('a document with no bookId names no book either catalog could reach', () => {
    const nameless = [{ docId: 'uid-owner_', uid: 'uid-owner', bookId: '', status: 'read' }];
    assert.deepEqual(myReadingListEntries(nameless, ME, 'read'), []);
  });
});

describe('READING_LIST_STATUSES — the measured vocabulary', () => {
  it('⚠️ is exactly what was counted in production on 2026-08-26', () => {
    // 555 documents: 393 tbr, 162 read, nothing else. A third value arriving
    // here without a re-measurement is the thing this assertion refuses.
    assert.deepEqual([...READING_LIST_STATUSES], ['tbr', 'read']);
  });

  it('includes the value this catalog WRITES', () => {
    assert.ok((READING_LIST_STATUSES as readonly string[]).includes(TBR_STATUS));
  });

  it('every status has a label — a control cannot offer what it cannot name', () => {
    for (const status of READING_LIST_STATUSES) {
      assert.equal(typeof READING_LIST_STATUS_LABEL[status], 'string');
      assert.ok(READING_LIST_STATUS_LABEL[status].length > 0);
    }
  });
});
