/**
 * ONE BOOK, ONE ROW — the media fold (`tbrFoldKey` / `groupTbrEntries`).
 *
 * Owner, 2026-08-26, verbatim:
 *
 *   "for the tbr list, it's double counting if something is owned in multiple
 *    media sources. So if a book is audio, physical and ebook or any
 *    combination we need to have it single count with a link to all formats."
 *
 * ⚠️ These are not style tests. Each `it` below fails on a behaviour the owner
 * would see on his own screen: a book counted twice, two different books merged
 * into one card, an intention that survives being cleared because only one of
 * its two documents was deleted, or a finished book that stays on the list
 * because the format he finished was not the one the card was keyed to.
 *
 * ⚠️ **The most expensive one to get wrong is `unbridgeable stays separate`.**
 * A fold that is too eager is silent and permanent: two books called *Gold*
 * become one card, one of them vanishes from the list, and nothing anywhere
 * says so. A fold that is too shy merely leaves the list slightly long, which
 * is visible and reportable. That asymmetry is why there is no title-only rung.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UNKNOWN_AUTHOR } from '../src/constants.js';
import {
  groupTbrEntries,
  outstandingTbrEntries,
  spentTbrEntries,
  tbrFoldKey,
  type TbrFoldable,
} from '../src/tbr.js';

/** A TBR document as the browser holds it, with the catalog's answer merged in. */
function entry(over: Partial<TbrFoldable> & { docId: string; bookId: string }): TbrFoldable {
  return {
    workKey: null,
    title: null,
    workId: null,
    workWorkKey: null,
    authors: null,
    workTitle: null,
    workCoverUrl: null,
    coverUrl: null,
    readState: null,
    formats: null,
    ...over,
  };
}

/** *Firefight*, as this catalog spells it and as the audiobook site does. */
const FIREFIGHT_KEY = 'firefight|brandon sanderson';

describe('tbrFoldKey — the rungs, strongest first', () => {
  it('rung 1: the matched WORK key wins over the document own key', () => {
    // They disagree because the document was written before the work's author
    // was corrected. The catalog's answer is the current truth.
    const key = tbrFoldKey(
      entry({
        docId: 'u_firefight',
        bookId: 'firefight',
        workKey: 'firefight|b sanderson',
        workWorkKey: FIREFIGHT_KEY,
      }),
    );
    assert.equal(key, `work:${FIREFIGHT_KEY}`);
  });

  it('rung 2: the document own key, for a book this catalog no longer holds', () => {
    const key = tbrFoldKey(
      entry({ docId: 'u_firefight', bookId: 'firefight', workKey: FIREFIGHT_KEY }),
    );
    assert.equal(key, `work:${FIREFIGHT_KEY}`);
  });

  it('⚠️ a key with no "|" is NOT one of ours and is refused', () => {
    // `workKeyFor` always joins a folded title to a folded author. A bare title
    // would collide two books called "Gold" — `myTbrEntries` states the same
    // rule for the same reason, and both must agree.
    const key = tbrFoldKey(entry({ docId: 'u_gold', bookId: 'gold', workKey: 'gold' }));
    assert.equal(key, 'book:gold');
  });

  it('rung 3: a known author and a title build the key that spans', () => {
    const key = tbrFoldKey(
      entry({
        docId: 'u_x',
        bookId: 'firefight-the-reckoners-book-2',
        title: 'Firefight - The Reckoners, Book 2',
        authors: 'Brandon Sanderson',
      }),
    );
    // ⚠️ The AUDIOBOOK decoration is stripped by `cleanAudiobookTitle` before
    // the key is built — that is the whole reason it can meet the paperback.
    assert.equal(key, `work:${FIREFIGHT_KEY}`);
  });

  it('⚠️ rung 3 refuses the provisional author sentinel', () => {
    // A key built on `?unknown` would come loose the day the author arrives —
    // the same refusal `tbrDocFor` makes at write time, and for the same reason.
    const key = tbrFoldKey(
      entry({ docId: 'u_x', bookId: 'gold', title: 'Gold', authors: UNKNOWN_AUTHOR }),
    );
    assert.equal(key, 'book:gold');
  });

  it('rung 4: nothing to key on is its OWN row, never a guess', () => {
    const a = tbrFoldKey(entry({ docId: 'u_gold-a', bookId: 'gold' }));
    const b = tbrFoldKey(entry({ docId: 'u_gold-b', bookId: 'gold-the-novel' }));
    assert.equal(a, 'book:gold');
    assert.notEqual(a, b);
  });

  it('⚠️ two books with the SAME title and no author do NOT fold', () => {
    // The catalog holds neither, so nothing can tell them apart. Two rows on a
    // list is a nuisance; one row that swallowed the other is data loss.
    const a = tbrFoldKey(entry({ docId: 'u_gold-1', bookId: 'gold', title: 'Gold' }));
    const b = tbrFoldKey(entry({ docId: 'u_gold-2', bookId: 'gold-2', title: 'Gold' }));
    assert.notEqual(a, b);
  });
});

describe('groupTbrEntries — one card per book', () => {
  it('⚠️ TWO DOCUMENTS, ONE workKey → ONE group (the reported bug)', () => {
    // The physical entry this catalog wrote, and the audio entry the sibling
    // site wrote, once the Worker has resolved both to the same work.
    const groups = groupTbrEntries([
      entry({
        docId: 'uid_firefight',
        bookId: 'firefight',
        workKey: FIREFIGHT_KEY,
        workId: 12,
        workWorkKey: FIREFIGHT_KEY,
        workTitle: 'Firefight',
        authors: 'Brandon Sanderson',
      }),
      entry({
        docId: 'uid_firefight-the-reckoners-book-2',
        bookId: 'firefight-the-reckoners-book-2',
        title: 'Firefight - The Reckoners, Book 2',
        workId: 12,
        workWorkKey: FIREFIGHT_KEY,
        workTitle: 'Firefight',
      }),
    ]);

    assert.equal(groups.length, 1, 'the list counts BOOKS, not documents');
    assert.equal(groups[0]?.workId, 12);
    assert.deepEqual(groups[0]?.docIds, [
      'uid_firefight',
      'uid_firefight-the-reckoners-book-2',
    ]);
  });

  it('⚠️ an AUDIO document bridged to a work folds with the physical one', () => {
    // This is what the D1 bridge buys: the audio document carries NO workKey at
    // all — the sibling site has no author to build one with — so before the
    // bridge these were two rows, one of them filed under "Not on these
    // shelves". `workWorkKey` here is what `resolveTbrEntries` fills in after
    // matching `audiobook_holding.title`.
    const groups = groupTbrEntries([
      entry({
        docId: 'uid_firefight',
        bookId: 'firefight',
        workKey: FIREFIGHT_KEY,
        workId: 12,
        workWorkKey: FIREFIGHT_KEY,
        workTitle: 'Firefight',
        formats: { physical: { workId: 12, state: 'owned' }, audio: null, ebook: null },
      }),
      entry({
        docId: 'uid_firefight-the-reckoners-book-2',
        bookId: 'firefight-the-reckoners-book-2',
        title: 'Firefight - The Reckoners, Book 2',
        workId: 12,
        workWorkKey: FIREFIGHT_KEY,
        formats: {
          physical: { workId: 12, state: 'none' },
          audio: { title: 'Firefight' },
          ebook: null,
        },
      }),
    ]);

    assert.equal(groups.length, 1);
    // ⚠️ The FORMATS ROW is the union, and `owned` beats the `none` the second
    // document reported — otherwise the order the documents arrived in would
    // decide whether the owner is told he owns his own paperback.
    assert.deepEqual(groups[0]?.formats, {
      physical: { workId: 12, state: 'owned' },
      audio: { title: 'Firefight' },
      ebook: null,
    });
  });

  it('⚠️ an UNBRIDGEABLE entry stays its own row rather than being guessed at', () => {
    const groups = groupTbrEntries([
      entry({
        docId: 'uid_firefight',
        bookId: 'firefight',
        workKey: FIREFIGHT_KEY,
        workId: 12,
        workWorkKey: FIREFIGHT_KEY,
        workTitle: 'Firefight',
      }),
      // On the list from the audiobook site, and this catalog has never heard
      // of it — no work, no holding, no author. The honest answer is a second
      // row that says so, not a merge onto whatever looks closest.
      entry({
        docId: 'uid_the-court-of-the-dead',
        bookId: 'the-court-of-the-dead',
        title: 'The Court of the Dead',
      }),
    ]);

    assert.equal(groups.length, 2);
    assert.equal(groups[1]?.workId, null, 'it belongs under "Not on these shelves"');
  });

  it('the catalog title wins the card, whichever document arrived first', () => {
    const groups = groupTbrEntries([
      entry({
        docId: 'uid_audio',
        bookId: 'firefight-the-reckoners-book-2',
        title: 'Firefight - The Reckoners, Book 2',
        workWorkKey: FIREFIGHT_KEY,
        workId: 12,
      }),
      entry({
        docId: 'uid_paper',
        bookId: 'firefight',
        workKey: FIREFIGHT_KEY,
        workId: 12,
        workWorkKey: FIREFIGHT_KEY,
        workTitle: 'Firefight',
      }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.title, 'Firefight');
  });

  it('the cover is the first non-null of each kind, kept apart', () => {
    // ⚠️ The two covers are NOT interchangeable: the catalog's is a URL the app
    // serves, the document's is a sibling-catalog href that needs
    // `resolveAudiobookCover` before it can be fetched. Collapsing them into one
    // field would send half the covers through the wrong resolver.
    const groups = groupTbrEntries([
      entry({
        docId: 'uid_audio',
        bookId: 'a',
        workWorkKey: FIREFIGHT_KEY,
        coverUrl: 'covers/Brandon Sanderson/Firefight.jpg',
      }),
      entry({
        docId: 'uid_paper',
        bookId: 'b',
        workWorkKey: FIREFIGHT_KEY,
        workCoverUrl: '/covers/firefight.jpg',
      }),
    ]);
    assert.equal(groups[0]?.workCoverUrl, '/covers/firefight.jpg');
    assert.equal(groups[0]?.docCoverUrl, 'covers/Brandon Sanderson/Firefight.jpg');
  });
});

describe('remove-group and clearing semantics', () => {
  it('⚠️ the group carries EVERY document id — "Off the list" deletes them all', () => {
    const groups = groupTbrEntries([
      entry({ docId: 'uid_paper', bookId: 'firefight', workWorkKey: FIREFIGHT_KEY }),
      entry({ docId: 'uid_audio', bookId: 'firefight-b2', workWorkKey: FIREFIGHT_KEY }),
      entry({ docId: 'uid_ebook', bookId: 'firefight-epub', workWorkKey: FIREFIGHT_KEY }),
    ]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0]?.docIds, ['uid_paper', 'uid_audio', 'uid_ebook']);
    // Leaving one behind would light the sibling site's "✓ To Be Read" button
    // for a book the person just cleared — the exact cross-catalog staleness
    // this whole feature exists to remove.
    assert.equal(groups[0]?.docIds.length, groups[0]?.entries.length);
  });

  it("⚠️ 'read' on ANY document spends the WHOLE intention", () => {
    // "Finishing one format clears the intention" — docs/info/tbr.md §5. The
    // audio document is the one that was finished; the paperback document knows
    // nothing about it, and the book must still come off the list.
    const groups = groupTbrEntries([
      entry({ docId: 'uid_paper', bookId: 'firefight', workWorkKey: FIREFIGHT_KEY }),
      entry({
        docId: 'uid_audio',
        bookId: 'firefight-b2',
        workWorkKey: FIREFIGHT_KEY,
        readState: 'read',
      }),
    ]);
    assert.equal(groups[0]?.readState, 'read');
    assert.equal(spentTbrEntries(groups).length, 1);
    assert.equal(outstandingTbrEntries(groups).length, 0);
    // ⚠️ And BOTH ids go, which is why the page clears by group and not by row.
    assert.deepEqual(spentTbrEntries(groups)[0]?.docIds, ['uid_paper', 'uid_audio']);
  });

  it("⚠️ 'dnf' still does NOT clear, folded or not", () => {
    // A did-not-finish is a more specific truth than "done with it", and the
    // person who has genuinely given up presses "Off the list". Unchanged by
    // the fold, and pinned here so the fold cannot quietly widen it.
    const groups = groupTbrEntries([
      entry({
        docId: 'uid_paper',
        bookId: 'firefight',
        workWorkKey: FIREFIGHT_KEY,
        readState: 'dnf',
      }),
    ]);
    assert.equal(spentTbrEntries(groups).length, 0);
    assert.equal(outstandingTbrEntries(groups).length, 1);
  });

  it("'reading' survives a document that says nothing", () => {
    const groups = groupTbrEntries([
      entry({ docId: 'uid_paper', bookId: 'firefight', workWorkKey: FIREFIGHT_KEY }),
      entry({
        docId: 'uid_audio',
        bookId: 'firefight-b2',
        workWorkKey: FIREFIGHT_KEY,
        readState: 'reading',
      }),
    ]);
    assert.equal(groups[0]?.readState, 'reading');
  });

  it('an empty list folds to nothing without throwing', () => {
    assert.deepEqual(groupTbrEntries([]), []);
  });
});
