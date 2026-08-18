/**
 * The cross-catalog TBR rules (`packages/core/src/tbr.ts`).
 *
 * Every assertion here is measured against the audiobook site's own writer —
 * `renderReadingListButtons` in
 * `audiobook_catalog/app/web/templates/index.html`, which since 2026-08-18
 * (owner: *"Make tbr keyed to account"*) writes:
 *
 *     const docId = `${uid}_${bookId}`;
 *     setDoc(writeRef, { displayName, uid, bookId, bookTitle, bookCover,
 *                        status: 'tbr', addedAt: serverTimestamp() });
 *
 * ⚠️ The id used to be `${session.displayName.toLowerCase()}_${bookId}`, and
 * the tests below used to assert it could never change. It changed, because a
 * display name identifies nobody: two members who picked the same one shared
 * ONE document per book. 234 live documents were enumerated and 181 moved
 * (`audiobook_catalog/scripts/migrate_tbr_to_uid.py`); the 53 that could not be
 * moved belong to a retired v1 passphrase account with no Firebase uid, so the
 * legacy id and the legacy ownership fallback both stay — and are tested.
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
  absoluteCoverUrl,
  legacyReadingListDocId,
  myTbrEntries,
  outstandingTbrEntries,
  ownsTbrDoc,
  readingListDocId,
  spentTbrEntries,
  tbrDocFor,
} from '../src/tbr.js';

/** A real Firebase uid shape: 28 characters of [A-Za-z0-9]. */
const UID = 'tX912OtdBheUhIe4kLDsGuJwE3D2';
const OTHER_UID = 'jjuEFDx0RehdFbvYDe1djZFbU5s2';

describe('readingListDocId — the ACCOUNT key (2026-08-18 migration)', () => {
  it('is `${uid}_${bookId}` — the audiobook site\'s positionDocId idiom', () => {
    assert.equal(readingListDocId(UID, 'the-lake-house'), `${UID}_the-lake-house`);
  });

  /**
   * ⚠️ The ORDER is unchanged and still deliberate. Reviews are
   * `${bookId}_${name}` and reading lists are `${owner}_${bookId}`; only the
   * left-hand half became an account. Using one order for the other collection
   * still files a document nobody's UI will ever find.
   */
  it('is still the REVERSE of a review id', () => {
    assert.equal(readingListDocId(UID, 'firefight'), `${UID}_firefight`);
    assert.equal(reviewDocId('firefight', 'Skylar'), 'firefight_skylar');
    assert.notEqual(readingListDocId(UID, 'firefight'), reviewDocId('firefight', UID));
  });

  /**
   * ⚠️ The old key folded case because display names had to match loosely. A
   * uid must NOT be folded: `tX912…` and `tx912…` are different strings, and
   * folding builds an id that matches no document and silently loses the entry.
   */
  it('does NOT fold case, unlike the display-name key it replaced', () => {
    assert.notEqual(readingListDocId('AbC', 'x'), readingListDocId('abc', 'x'));
  });

  it('never collides with a legacy id for the same book', () => {
    // The two lanes share one collection. A collision would mean the migration
    // overwrote the very documents it was preserving.
    assert.notEqual(readingListDocId(UID, 'x'), legacyReadingListDocId('Skylar', 'x'));
  });
});

describe('legacyReadingListDocId — read-only, and NOT dead code', () => {
  /**
   * 53 live documents still carry this id: their owner is a retired v1
   * passphrase account with no Firebase uid, and the migration refuses to guess
   * an owner for somebody's reading list. A reader that could not build this id
   * would show that person an empty list.
   */
  it('still builds the pre-migration id, case-folded as it always was', () => {
    assert.equal(legacyReadingListDocId('Skylar', 'the-lake-house'), 'skylar_the-lake-house');
    assert.equal(legacyReadingListDocId('SKYLAR', 'x'), legacyReadingListDocId('skylar', 'x'));
  });
});

describe('ownsTbrDoc — whose intention is this?', () => {
  const me = { uid: UID, email: 'sky@example.com', reviewName: 'Skylar' };

  it('matches an account-keyed document by uid', () => {
    assert.equal(ownsTbrDoc({ uid: UID, displayName: 'Skylar' }, me), true);
  });

  /**
   * ⚠️ THE BUG THE MIGRATION EXISTS TO FIX, asserted directly. Two members, one
   * display name: before 2026-08-18 this was the SAME DOCUMENT, and this app
   * put the other person's intentions on this person's list.
   */
  it('does NOT match another account\'s document, even with an identical name', () => {
    assert.equal(ownsTbrDoc({ uid: OTHER_UID, displayName: 'Skylar' }, me), false);
  });

  /**
   * ⚠️ Pinned separately, because getting THIS wrong undoes the migration while
   * every other test still passes: the name fallback exists for the 53 uid-less
   * documents and must never be consulted for a document that has a uid.
   */
  it('never falls back to name or email for a document that HAS a uid', () => {
    assert.equal(
      ownsTbrDoc({ uid: OTHER_UID, displayName: 'Skylar', email: 'sky@example.com' }, me),
      false,
    );
  });

  it('matches a LEGACY uid-less document by the old rule (email, then name)', () => {
    assert.equal(ownsTbrDoc({ displayName: 'Skylar' }, me), true);
    assert.equal(ownsTbrDoc({ email: 'sky@example.com', displayName: 'Nope' }, me), true);
  });

  it('a session with no account sees only legacy documents', () => {
    const anon = { uid: null, email: null, reviewName: 'Skylar' };
    assert.equal(ownsTbrDoc({ displayName: 'Skylar' }, anon), true);
    assert.equal(ownsTbrDoc({ uid: UID, displayName: 'Skylar' }, anon), false);
  });
});

describe('tbrDocFor — the document this catalog writes', () => {
  const params = {
    title: 'The Lake House',
    authors: 'Kate Morton',
    displayName: 'Skylar',
    uid: UID,
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
   * ⚠️ The `uid` FIELD as well as the uid in the ID. `firestore.rules` requires
   * both and requires them to name the same account — a document filed under
   * your id carrying somebody else's uid would be mis-attributed by every scan
   * that trusts the field, so neither half is sufficient alone.
   */
  it('stamps the account as a field AND as the id', () => {
    const { id, doc } = tbrDocFor(params);
    assert.equal(doc.uid, UID);
    assert.equal(id, `${UID}_the-lake-house`);
  });

  /**
   * ⚠️ The same refusal shape as the provisional-key one below, for the same
   * reason: a document written under a key that identifies nobody is worse than
   * no document, and that is precisely what the migration removed.
   */
  it('refuses an entry with no account rather than filing one under a name', () => {
    assert.throws(() => tbrDocFor({ ...params, uid: '' }), /account/);
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
    assert.equal(id, `${UID}_the-lake-house`);
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
    const { doc } = tbrDocFor({ title: 'Gold', authors: 'A B', displayName: 'Sky', uid: UID });
    assert.equal('email' in doc, false);
    assert.equal('bookCover' in doc, false);
  });
});

describe('absoluteCoverUrl — a cover that means the same thing on the other site', () => {
  const base = 'https://library.heygabi.ai/api/tbr/1/keys';

  /**
   * ⚠️ The trap this closes. `work.cover_url` is usually `/covers/…`, served by
   * this Worker — and the document is read by the audiobook site, where that
   * path resolves against THEIR host.
   */
  it('resolves a site-relative path against this instance', () => {
    assert.equal(
      absoluteCoverUrl('/covers/a-killer-s-mind.jpg', base),
      'https://library.heygabi.ai/covers/a-killer-s-mind.jpg',
    );
  });

  it('leaves an absolute, protocol-relative or data URL exactly as it is', () => {
    assert.equal(absoluteCoverUrl('https://x.test/a.jpg', base), 'https://x.test/a.jpg');
    assert.equal(absoluteCoverUrl('//x.test/a.jpg', base), '//x.test/a.jpg');
    assert.equal(absoluteCoverUrl('data:image/gif;base64,AA', base), 'data:image/gif;base64,AA');
  });

  it('answers null for nothing at all — a coverless entry beats a broken one', () => {
    assert.equal(absoluteCoverUrl(null, base), null);
    assert.equal(absoluteCoverUrl('   ', base), null);
    assert.equal(absoluteCoverUrl('/covers/x.jpg', 'not a url'), null);
  });
});

describe('myTbrEntries — whose list this is, and what belongs on it', () => {
  const me = { uid: UID, email: 'sky@example.com', reviewName: 'Skylar' };

  // ⚠️ The fixtures below are deliberately LEGACY (no `uid`), because that is
  // what 53 live documents still look like and what the fallback has to keep
  // reaching. The account-keyed cases are the three at the end of this block.
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

  /* ── account-keyed entries (2026-08-18) ──────────────────────────────── */

  const mineKeyed = { ...mine, docId: `${UID}_the-lake-house`, uid: UID };

  it('keeps my own ACCOUNT-keyed entry', () => {
    assert.deepEqual(
      myTbrEntries([mineKeyed], me).map((e) => e.docId),
      [`${UID}_the-lake-house`],
    );
  });

  /**
   * ⚠️ THE WHOLE POINT OF THE MIGRATION, at the list level. A housemate who
   * shares my display name AND (as here) the email on the document still does
   * not reach my list, because the document names an account and it is not
   * mine. Before 2026-08-18 there was no account to name and this row WAS on
   * my list.
   */
  it("never picks up another account's entry, whatever name or email it carries", () => {
    const theirs = { ...mineKeyed, docId: `${OTHER_UID}_gold`, uid: OTHER_UID, bookId: 'gold' };
    assert.deepEqual(myTbrEntries([theirs], me), []);
  });

  /**
   * The transition state the estate is actually in: 181 documents account-keyed
   * and 53 not. One list, both lanes, and the dedupe still collapses a book
   * recorded twice.
   */
  it('mixes both lanes on one list and still dedupes on workKey', () => {
    const legacyTwin = { ...mine, docId: 'skylar_the-lake-house-a-novel', bookId: 'the-lake-house-a-novel' };
    assert.equal(myTbrEntries([mineKeyed, legacyTwin], me).length, 1);
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
