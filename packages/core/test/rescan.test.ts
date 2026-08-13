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
  NO_BARCODE_NOTE,
  appendNoBarcodeNote,
  appendSharedIsbnNote,
  blankSiblingOf,
  hasNoBarcodeNote,
  newPrintingNeedsName,
  printingCandidates,
  printingQuestionText,
  rescanChoices,
  rescanQuestionText,
  rescanSentence,
  stripNoBarcodeNote,
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

describe('manual picker — which printings a copy could be', () => {
  it('a named format offers every edition of that format, ISBN or not', () => {
    // ⚠️ Unlike the rescan's fillTargets: a barcode can only belong to an
    // ISBN-less row, but a COPY can be of any row — owning the Open
    // Library-recorded printing is the common case.
    const out = printingCandidates(
      [
        edition(1, 'hardcover', '9781638493457'),
        edition(2, 'hardcover', null),
        edition(3, 'paperback', null),
      ],
      'hardcover',
    );
    assert.deepEqual(out.map((e) => e.id), [1, 2]);
  });

  it('no format (linking an existing copy) offers everything, physical first', () => {
    // An owned EPUB licence is a real copy; hiding ebook rows would make it
    // permanently unlinkable. But the shelf is the ordinary case, so physical
    // printings come first.
    const out = printingCandidates(
      [edition(1, 'ebook_epub', null), edition(2, 'hardcover', null), edition(3, 'paperback', null)],
      null,
    );
    assert.deepEqual(out.map((e) => e.id), [2, 3, 1]);
  });

  it('a same-format sibling needs a name; the first of its format does not', () => {
    const editions = [edition(1, 'hardcover', null)];
    assert.equal(newPrintingNeedsName(editions, 'hardcover'), true);
    assert.equal(newPrintingNeedsName(editions, 'paperback'), false);
    assert.equal(newPrintingNeedsName([], 'hardcover'), false);
  });
});

describe('manual picker — the blank-sibling refusal (#139 residue shape)', () => {
  const shelf = [edition(7, 'hardcover', '9781638493457'), edition(8, 'paperback', null)];

  it('refuses a same-format row carrying nothing to tell it apart', () => {
    assert.equal(blankSiblingOf(shelf, { format: 'hardcover' })?.id, 7);
  });

  it('any single distinguishing mark defuses it', () => {
    // Each of these is "a genuinely different printing has something to say
    // about itself" — the refusal only ever hits pure residue.
    const marks: Partial<Record<string, unknown>>[] = [
      { isbn13: '9781638494362' },
      { isbn10: '163849436X' },
      { asin: 'B0ABCDEFGH' },
      { editionName: 'Target exclusive — foil case wrap' },
      { collects: 'Volumes 1-3' },
      { publisher: 'Dragonsteel' },
      { publishedYear: 2023 },
      { sourceUrl: 'https://example.com/listing' },
      { cwaBookId: 12 },
    ];
    for (const mark of marks) {
      assert.equal(blankSiblingOf(shelf, { format: 'hardcover', ...mark }), null);
    }
  });

  it('empty strings are not distinguishing marks', () => {
    // A form that submits '' for every untouched field must not slip past the
    // refusal on a technicality.
    assert.equal(
      blankSiblingOf(shelf, { format: 'hardcover', editionName: '', publisher: '' })?.id,
      7,
    );
  });

  it('the first printing of a format is never refused', () => {
    assert.equal(blankSiblingOf(shelf, { format: 'audiobook_cd' }), null);
    assert.equal(blankSiblingOf([], { format: 'hardcover' }), null);
  });

  it('asks its question with no verdict in it', () => {
    assert.match(printingQuestionText(), /\?$/);
    assert.doesNotMatch(printingQuestionText(), /duplicate|error|wrong/i);
  });
});

describe('manual picker — "no barcode" as an observed fact', () => {
  it('⚠️ spells the note exactly as the owner-verified production rows do', () => {
    // Editions 450 and 470 (Dungeon Born PB, Unmapped PB) were settled at the
    // shelf on 2026-08-13 with this exact string. Every future recording must
    // grep identically, or "no barcode" becomes several facts instead of one.
    assert.equal(NO_BARCODE_NOTE, 'No barcode printed on this copy (owner-verified)');
    assert.equal(appendNoBarcodeNote(null), NO_BARCODE_NOTE);
  });

  it('appends after an em dash when a name exists, and is idempotent', () => {
    const named = appendNoBarcodeNote('Kickstarter Grimoire Edition');
    assert.equal(named, `Kickstarter Grimoire Edition — ${NO_BARCODE_NOTE}`);
    assert.equal(appendNoBarcodeNote(named), named);
    assert.equal(hasNoBarcodeNote(named), true);
    assert.equal(hasNoBarcodeNote('Kickstarter Grimoire Edition'), false);
  });

  it('strips cleanly back to what the name was — or to null when it was only the note', () => {
    assert.equal(
      stripNoBarcodeNote(`Kickstarter Grimoire Edition — ${NO_BARCODE_NOTE}`),
      'Kickstarter Grimoire Edition',
    );
    assert.equal(stripNoBarcodeNote(NO_BARCODE_NOTE), null);
    assert.equal(stripNoBarcodeNote(null), null);
    assert.equal(stripNoBarcodeNote('Deluxe'), 'Deluxe');
  });
});
