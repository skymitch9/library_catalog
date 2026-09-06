/**
 * `seriesVolumeNumber` / `numberedTitleAgrees` — the gate `titleSimilarity`
 * cannot be.
 *
 * ## The defect these pin, measured 2026-09-06
 *
 * The ISBN backfill's Google Books rung proposed the **same** ISBN
 * `9781986619233` for *Space Knight* books **5, 6, 7, 8 and 9**. Its title gate
 * is `titleSimilarity >= 0.80`, and on a numbered series where only the number
 * differs that gate is blind: `titleWords` drops words of one character and
 * weighs a digit like any other word, so *"space knight book 5"* against
 * *"space knight book 7"* shares every word it can see.
 *
 * ⚠️ **Only the UNIQUE index on `edition.isbn13` stopped four of the five
 * writes**, and an index is a backstop rather than a gate — it refuses the
 * second write and says nothing about whether the first one was right. Measured
 * the same day on both production instances: **0** works share an ISBN with
 * another work, which is what the index guarantees and is NOT evidence that the
 * ladder proposed the right one.
 *
 * ⚠️ These are unit tests of a *comparison*, not of the ladder. The ladder half
 * is `scripts/backfill-missing-isbns.mjs` rungs 1 and 2, which call
 * `numberedTitleAgrees` beside the existing similarity floor.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { numberedTitleAgrees, seriesVolumeNumber, titleSimilarity } from '../src/matching.js';
import { normaliseTitle } from '../src/titles.js';

describe('seriesVolumeNumber — what a title says its volume is', () => {
  it('reads a bare trailing number', () => {
    assert.equal(seriesVolumeNumber('Space Knight 5'), '5');
  });

  it('reads every marker spelling the two catalogues use', () => {
    assert.equal(seriesVolumeNumber('Space Knight Book 5'), '5');
    assert.equal(seriesVolumeNumber('Space Knight, Book 5'), '5');
    assert.equal(seriesVolumeNumber('Space Knight (Book #5)'), '5');
    assert.equal(seriesVolumeNumber('Space Knight Vol. 5'), '5');
    assert.equal(seriesVolumeNumber('Space Knight Volume 5'), '5');
    assert.equal(seriesVolumeNumber('Space Knight, Part 5'), '5');
    assert.equal(seriesVolumeNumber('Space Knight #5'), '5');
  });

  it('reads a half-volume, which serial print splits really use', () => {
    // docs/info/serial-print-splits.md: the arithmetic picks N / N.5 over
    // N.1 / N.2, so ".5" has to survive as a number rather than round away.
    assert.equal(seriesVolumeNumber('The Wandering Inn 8.5'), '8.5');
    assert.equal(seriesVolumeNumber('Book 8.5 of The Wandering Inn'), '8.5');
  });

  it('says null when the title states no volume', () => {
    assert.equal(seriesVolumeNumber('Space Knight'), null);
    assert.equal(seriesVolumeNumber('Dungeon Crawler Carl'), null);
    assert.equal(seriesVolumeNumber(''), null);
    assert.equal(seriesVolumeNumber(null), null);
    assert.equal(seriesVolumeNumber(undefined), null);
  });

  it('⚠️ a marker word with no number is not a volume — the Book Thief rule', () => {
    // Same stance as foldVolumeMarker, which only folds a marker FOLLOWED by a
    // number. "The Book Thief" keeps its "book".
    assert.equal(seriesVolumeNumber('The Book Thief'), null);
    assert.equal(seriesVolumeNumber('Part of Your World'), null);
  });

  it('an explicit marker beats a trailing year or print run', () => {
    assert.equal(seriesVolumeNumber('Space Knight Book 5 (2019)'), '5');
    assert.equal(seriesVolumeNumber('Space Knight Book 5: The Long Fall'), '5');
  });

  it('takes the FIRST standalone number when there is no marker', () => {
    // A trailing annotation in a search result is far more often a year or an
    // edition than a volume, so first beats last here.
    assert.equal(seriesVolumeNumber('Space Knight 5 (2019)'), '5');
    assert.equal(seriesVolumeNumber('Space Knight 5: The Long Fall'), '5');
  });

  it('canonicalises the digits so two spellings of one volume agree', () => {
    assert.equal(seriesVolumeNumber('Space Knight Book 05'), '5');
    assert.equal(seriesVolumeNumber('Space Knight 5.'), '5');
  });

  it('⚠️ a title whose number is not a volume reads the same on both sides', () => {
    // Fahrenheit 451 and 1984 have no volume, but they DO have a number, and
    // that is fine: the comparison is symmetric, so both sides read 451 and
    // agree. The cost is only ever a refusal when one side omits it.
    assert.equal(seriesVolumeNumber('Fahrenheit 451'), '451');
    assert.equal(seriesVolumeNumber('1984'), '1984');
    assert.ok(numberedTitleAgrees('Fahrenheit 451', 'Fahrenheit 451'));
    assert.ok(numberedTitleAgrees('1984 (Signet Classics)', '1984'));
  });
});

describe('numberedTitleAgrees — Space Knight, the five-books-one-ISBN defect', () => {
  it('🔴 REJECTS Space Knight 5 against Space Knight 7', () => {
    assert.equal(numberedTitleAgrees('Space Knight 7', 'Space Knight 5'), false);
  });

  it('✅ ACCEPTS Space Knight 5 against Space Knight, Book 5', () => {
    assert.equal(numberedTitleAgrees('Space Knight, Book 5', 'Space Knight 5'), true);
  });

  it('🔴 rejects every one of the five volumes against every other', () => {
    // The real shape: works 69, 70, 253, 254, 255 are Space Knight Books 5, 6,
    // 7, 8 and 9 on production `library-catalog`, and one ISBN was proposed for
    // all five.
    const ours = ['Space Knight Book 5', 'Space Knight Book 6', 'Space Knight Book 7',
      'Space Knight Book 8', 'Space Knight Book 9'];
    for (const a of ours) {
      for (const b of ours) {
        assert.equal(numberedTitleAgrees(a, b), a === b, `${a} vs ${b}`);
      }
    }
  });

  it('⚠️ and titleSimilarity alone does NOT — which is why this exists', () => {
    // The gate that let all five through. If this ever stops being 1.00 the
    // similarity function has changed and this file's premise needs re-reading.
    const sim = titleSimilarity(
      normaliseTitle('Space Knight Book 5'),
      normaliseTitle('Space Knight Book 7'),
    );
    assert.ok(sim >= 0.8, `expected the 0.80 gate to pass, got ${sim}`);
  });

  it('accepts a candidate that carries no number at all', () => {
    // The series-level record. It may still be refused by other gates; this one
    // has nothing to object to.
    assert.equal(numberedTitleAgrees('Space Knight', 'Space Knight Book 5'), true);
  });

  it('🔴 refuses a candidate that names a volume our row does not', () => {
    // The Primal Hunter shape numbersAgree already refuses inside the index: we
    // hold book 1 and the sort offers "The Primal Hunter 10".
    assert.equal(numberedTitleAgrees('The Primal Hunter 10', 'The Primal Hunter'), false);
  });

  it('is unbothered when neither side numbers anything', () => {
    assert.equal(numberedTitleAgrees('Dungeon Crawler Carl', 'Dungeon Crawler Carl'), true);
  });

  it('reads through the fold both rungs apply before comparing', () => {
    // The callers compare normaliseTitle()'d strings, so the gate has to work on
    // that alphabet ([a-z0-9 ]) as well as on raw API titles.
    assert.equal(
      numberedTitleAgrees(normaliseTitle('Space Knight, Book 7'), normaliseTitle('Space Knight 5')),
      false,
    );
    assert.equal(
      numberedTitleAgrees(normaliseTitle('Space Knight, Book 5'), normaliseTitle('Space Knight 5')),
      true,
    );
  });
});
