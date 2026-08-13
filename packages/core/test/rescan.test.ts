/**
 * Tests for the rescan rule — a scanned barcode whose ISBN is not on file, on a
 * book the catalog already holds.
 *
 * ⚠️ **The failure this guards:** the add path used to answer this case
 * silently, with a brand-new edition and a brand-new copy — so rescanning the
 * slipcase volumes to fill their deliberately blank ISBNs would have minted
 * nine duplicates. Everything here is about which choices may be OFFERED;
 * offering the wrong set is how a person holding a book gets railroaded into a
 * wrong row.
 *
 * Run with `npm test` (Node strips the types; no build step, no framework).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  appendSharedIsbnNote,
  rescanChoices,
  rescanQuestionText,
  rescanSentence,
} from '../src/rescan.ts';

const edition = (id: number, format: string, isbn13: string | null) => ({ id, format, isbn13 });
const copy = (id: number, status: string, edition_id: number | null) => ({ id, status, edition_id });

describe('rescan — what there is to offer', () => {
  it('offers ISBN-less physical editions as fill targets, and nothing else', () => {
    // The slipcase case: a deliberately blank isbn13 beside an ISBN'd sibling.
    // Only the blank one can be what the barcode is; the sibling's ISBN is a
    // different printing by definition.
    const out = rescanChoices(
      [edition(1, 'hardcover', null), edition(2, 'paperback', '9781638493457')],
      [copy(10, 'owned', 1)],
    );
    assert.deepEqual(out.fillTargets.map((e) => e.id), [1]);
    assert.equal(out.shouldAsk, true);
    assert.equal(out.bareCopy, false);
  });

  it('⚠️ never offers an ebook row — a print ISBN on an epub is a wrong fact', () => {
    // Recorded decision (isbn-ladder.md): epub identifier backfill is closed
    // permanently. The rescan prompt must not reopen it one row at a time.
    const out = rescanChoices(
      [edition(1, 'ebook_epub', null), edition(2, 'ebook_kindle', null)],
      [copy(10, 'owned', null)],
    );
    assert.deepEqual(out.fillTargets, []);
    // Owned copies exist and no PHYSICAL edition does — the spine-added shape.
    assert.equal(out.bareCopy, true);
    assert.equal(out.shouldAsk, true);
  });

  it('⚠️ does not ask at all for the paperback-of-an-ebook case', () => {
    // A work with no physical presence: adding the first physical printing is
    // what Add means, and a question would cost a tap to confirm nothing. This
    // is the commonest attach in the catalog (117 ebook-imported works).
    const out = rescanChoices([edition(1, 'ebook_epub', null)], []);
    assert.equal(out.shouldAsk, false);
  });

  it('asks even when every physical edition already has an ISBN', () => {
    // The #341 shape: a printing not yet recorded. The silent path would have
    // created it without asking — right rows, no consent. Still a question.
    const out = rescanChoices([edition(1, 'hardcover', '9781638493457')], [copy(10, 'owned', 1)]);
    assert.deepEqual(out.fillTargets, []);
    assert.equal(out.shouldAsk, true);
    assert.equal(out.bareCopy, false);
  });

  it('links the unlinked copy only when it is unambiguous', () => {
    // One owned copy with no edition_id → that is the object on the shelf.
    assert.equal(
      rescanChoices([edition(1, 'hardcover', null)], [copy(10, 'owned', null)]).linkCopyId,
      10,
    );
    // Two unlinked copies → guessing which one is in the person's hands is
    // exactly what this codebase refuses to do.
    assert.equal(
      rescanChoices(
        [edition(1, 'hardcover', null)],
        [copy(10, 'owned', null), copy(11, 'owned', null)],
      ).linkCopyId,
      null,
    );
    // A wanted copy is not on the shelf and can never be the link target.
    assert.equal(
      rescanChoices([edition(1, 'hardcover', null)], [copy(10, 'wanted', null)]).linkCopyId,
      null,
    );
  });

  it('a wanted-only work does not count as physical presence', () => {
    // A wish must create no edition (`reportFor` keys held-vs-wished on that),
    // and scanning the book you finally bought should attach cleanly, not
    // interrogate you about copies you do not own.
    const out = rescanChoices([], [copy(10, 'wanted', null)]);
    assert.equal(out.shouldAsk, false);
    assert.equal(out.bareCopy, false);
  });
});

describe('rescan — the words the prompt uses', () => {
  it('names the book, names the barcode, and passes no verdict', () => {
    const said = rescanSentence('The Grey King', '9780020425809');
    assert.match(said, /The Grey King/);
    assert.match(said, /9780020425809/);
    assert.doesNotMatch(said, /duplicate|error|wrong/i);
    assert.match(rescanQuestionText(), /\?$/);
  });

  it('still forms a sentence when the title is unknown', () => {
    assert.match(rescanSentence(null, '9780020425809'), /^This book /);
  });
});

describe('rescan — the slipcase treatment for a shared ISBN', () => {
  it('appends to an existing edition name after an em dash', () => {
    // The Realmkeeper shape: 16 rows describe 8 physical volumes, so a volume
    // ISBN lands on ONE row and the other carries the fact in its name —
    // `edition` has no notes column; that lives on `copy`.
    assert.equal(
      appendSharedIsbnNote('Realmkeeper Kickstarter omnibus', '9781938570308', 'Beneath the Dragoneye Moons 1'),
      'Realmkeeper Kickstarter omnibus — shares ISBN 9781938570308 with “Beneath the Dragoneye Moons 1”',
    );
  });

  it('becomes the whole name when there was none', () => {
    assert.equal(
      appendSharedIsbnNote(null, '9781938570308', 'Vol 1'),
      'Shares ISBN 9781938570308 with “Vol 1”',
    );
    assert.equal(appendSharedIsbnNote('  ', '9781938570308', null), 'Shares ISBN 9781938570308');
  });

  it('says something useful even when the holder has no title', () => {
    assert.match(
      appendSharedIsbnNote('Set volume', '9781938570308', null),
      /shares ISBN 9781938570308 with another printing/,
    );
  });
});
