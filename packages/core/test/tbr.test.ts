/**
 * The cross-catalog TBR rules (`packages/core/src/tbr.ts`).
 *
 * Every assertion here is measured against the audiobook site's own writer —
 * `renderReadingListButtons` in
 * `audiobook_catalog/app/web/templates/index.html`, read 2026-08-17:
 *
 *     const docId = `${session.displayName.toLowerCase()}_${bookId}`;
 *     setDoc(listRef, { displayName, bookId, bookTitle, bookCover,
 *                       status: 'tbr', addedAt: serverTimestamp() });
 *
 * ⚠️ These are not style tests. The document id IS the identity of documents
 * that already exist in production, and the ownership rule decides whose
 * intentions land on whose list. Each `it` below fails on a behaviour that
 * would be invisible on screen: a second document beside the person's real
 * entry, a housemate's list bleeding into theirs, or an intention that survives
 * finishing the book.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UNKNOWN_AUTHOR } from '../src/constants.js';
import { reviewDocId } from '../src/reviews.js';
import {
  myTbrEntries,
  outstandingTbrEntries,
  readingListDocId,
  spentTbrEntries,
  tbrDocFor,
} from '../src/tbr.js';

describe('readingListDocId — ported verbatim, and NOT a review id', () => {
  it('is `${displayNameLower}_${bookId}`, exactly as the audiobook site writes it', () => {
    assert.equal(readingListDocId('Skylar', 'the-lake-house'), 'skylar_the-lake-house');
  });

  /**
   * ⚠️ The whole reason this function exists rather than reusing `reviewDocId`.
   * The two ids are REVERSED on the audiobook site — reviews.js writes
   * `${bookId}_${name}` and index.html writes `${name}_${bookId}` — and using
   * one order for the other collection files a document nobody's UI will ever
   * find, beside the one they already have.
   */
  it('is the REVERSE of a review id — the two must never be harmonised', () => {
    const name = 'Skylar';
    const bookId = 'firefight';
    assert.equal(readingListDocId(name, bookId), 'skylar_firefight');
    assert.equal(reviewDocId(bookId, name), 'firefight_skylar');
    assert.notEqual(readingListDocId(name, bookId), reviewDocId(bookId, name));
  });

  it('folds case in the name, because that site does', () => {
    assert.equal(readingListDocId('SKYLAR', 'x'), readingListDocId('skylar', 'x'));
  });
});

describe('tbrDocFor — the document this catalog writes', () => {
  const params = {
    title: 'The Lake House',
    authors: 'Kate Morton',
    displayName: 'Skylar',
    email: 'sky@example.com',
    coverUrl: 'https://bookcovers.heygabi.ai/lake-house.jpg',
  };

  it('carries the three fields firestore.rules validates, and status is theirs', () => {
    const { doc } = tbrDocFor(params);
    assert.equal(typeof doc.displayName, 'string');
    assert.equal(typeof doc.bookId, 'string');
    assert.equal(doc.status, 'tbr');
  });

  /**
   * ⚠️ `bookIdFromTitle` KEEPS the leading article where `normaliseTitle`
   * strips it. A document id built with the wrong fold lands beside the
   * existing entry instead of on it — the same trap `reviews.ts` records, and
   * the reason the key had to be the review store's.
   */
  it('keeps the leading article in the id, like the review store', () => {
    const { id, doc } = tbrDocFor(params);
    assert.equal(doc.bookId, 'the-lake-house');
    assert.equal(id, 'skylar_the-lake-house');
  });

  /**
   * The key that actually spans. `bookId` is title-only and cannot join a
   * paperback to an audiobook; `workKey` is what `POST /api/tbr/resolve`
   * matches, and without it an entry could never be cleared by finishing
   * another format.
   */
  it('stamps a composite workKey, so the entry can be matched to a work', () => {
    const { doc } = tbrDocFor(params);
    assert.equal(doc.workKey, 'lake house|kate morton');
    assert.equal(doc.source, 'library');
    assert.equal(doc.email, 'sky@example.com');
  });

  it('strips audiobook packaging from the workKey but never from the id', () => {
    const { doc } = tbrDocFor({
      ...params,
      title: 'Firefight (Dramatized Adaptation)',
      authors: 'Brandon Sanderson',
    });
    assert.equal(doc.workKey, 'firefight|brandon sanderson');
    // The id must stay a slug of the title AS GIVEN — if this row came from the
    // audiobook catalog, the decorated title is what built its existing id.
    assert.equal(doc.bookId, 'firefight-dramatized-adaptation');
  });

  /**
   * ⚠️ `docs/info/edit-and-audit-design.md` §3.4: zero Firestore documents may
   * carry a provisional key, because that is the proof that filling in an
   * author later is a free key move. The route answers 409 first; this is the
   * backstop that makes it impossible from any caller.
   */
  it('refuses a provisional (authorless) work rather than writing the sentinel', () => {
    assert.throws(() => tbrDocFor({ ...params, authors: UNKNOWN_AUTHOR }), /provisional/);
  });

  it('omits email and cover when there are none, rather than writing empties', () => {
    const { doc } = tbrDocFor({ title: 'Gold', authors: 'A B', displayName: 'Sky' });
    assert.equal('email' in doc, false);
    assert.equal('bookCover' in doc, false);
  });
});

describe('myTbrEntries — whose list this is, and what belongs on it', () => {
  const me = { email: 'sky@example.com', reviewName: 'Skylar' };

  const mine = {
    docId: 'skylar_the-lake-house',
    displayName: 'Skylar',
    bookId: 'the-lake-house',
    bookTitle: 'The Lake House',
    status: 'tbr',
    workKey: 'lake house|kate morton',
    email: 'sky@example.com',
  };

  it('keeps my own entry', () => {
    assert.deepEqual(myTbrEntries([mine], me).map((e) => e.docId), ['skylar_the-lake-house']);
  });

  /**
   * ⚠️ The measured reason the weak key is not optional: everything the
   * audiobook site has written carries a `displayName` and NO `email` (870
   * review documents on 2026-08-11 carried none, and its reading-list writer
   * has never written one either). Matching on email alone shows an empty list
   * to somebody whose whole TBR was recorded there.
   */
  it('reaches an entry written on the audiobook site, which has no email', () => {
    const theirs = { ...mine, email: undefined, workKey: undefined, docId: 'skylar_firefight' };
    assert.equal(myTbrEntries([theirs], me).length, 1);
  });

  it("never picks up a housemate's intentions", () => {
    const hers = {
      docId: 'samantha hardman_gold',
      displayName: 'Samantha Hardman',
      bookId: 'gold',
      status: 'tbr',
    };
    assert.deepEqual(myTbrEntries([hers], me), []);
  });

  it('drops a status this catalog does not know — that field is theirs to grow', () => {
    assert.deepEqual(myTbrEntries([{ ...mine, status: 'finished' }], me), []);
  });

  it('drops a document with no bookId, which names no book either side can reach', () => {
    assert.deepEqual(myTbrEntries([{ ...mine, bookId: '' }], me), []);
  });

  /**
   * ⚠️ A bare title is not one of our keys — `workKeyFor` always joins a folded
   * title and author with `|` — and trusting one would collide two books called
   * "Gold". Treated as absent, so the entry falls back to the bookId match.
   */
  it('treats a workKey with no pipe as absent rather than trusting it', () => {
    const [entry] = myTbrEntries([{ ...mine, workKey: 'lake house' }], me);
    assert.equal(entry?.workKey, null);
  });

  /**
   * The owner's rule, seen from the list: *"finishing one format clears the
   * intention"* — so one work is one row, even when it was added on both sites
   * under two spellings of the title.
   */
  it('shows one row for a book recorded on both sites under one workKey', () => {
    const audio = {
      ...mine,
      docId: 'skylar_the-lake-house-a-novel',
      bookId: 'the-lake-house-a-novel',
      bookTitle: 'The Lake House: A Novel',
    };
    assert.equal(myTbrEntries([mine, audio], me).length, 1);
  });

  it('keeps two genuinely different books apart', () => {
    const other = {
      ...mine,
      docId: 'skylar_firefight',
      bookId: 'firefight',
      workKey: 'firefight|brandon sanderson',
    };
    assert.equal(myTbrEntries([mine, other], me).length, 2);
  });

  it('falls back to the bookId as a title rather than rendering a blank row', () => {
    const [entry] = myTbrEntries([{ ...mine, bookTitle: '' }], me);
    assert.equal(entry?.title, 'the-lake-house');
  });
});

describe('spentTbrEntries — what finishing a book clears', () => {
  const row = (readState: string | null) => ({ workId: 1, readState });

  it("clears an entry the reader has read — whichever catalog's format it was", () => {
    assert.equal(spentTbrEntries([row('read')]).length, 1);
    assert.equal(outstandingTbrEntries([row('read')]).length, 0);
  });

  /**
   * ⚠️ `null` is "no user_book row", which is the state of nearly every book in
   * the catalog. Reading it as finished would empty everybody's TBR on the
   * first visit.
   */
  it('leaves an entry with no read-state row alone', () => {
    assert.equal(spentTbrEntries([row(null)]).length, 0);
  });

  /**
   * ⚠️ A did-not-finish is a MORE specific truth than "done with it" — the same
   * reading `deriveReadState`'s precedence rule 5 applies — and 'reference' is
   * not something anybody finishes. Both stay; the button removes them.
   */
  it('leaves dnf, reference and reading alone', () => {
    assert.equal(spentTbrEntries([row('dnf'), row('reference'), row('reading')]).length, 0);
    assert.equal(outstandingTbrEntries([row('dnf'), row('reading')]).length, 2);
  });

  it('leaves an unmatched entry alone — an audiobook we hold no copy of', () => {
    assert.equal(spentTbrEntries([{ workId: null, readState: null }]).length, 0);
  });
});
