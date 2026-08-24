/**
 * The volume number: what makes it complete, and what the printed form is for.
 *
 * ## ⚠️ The owner rule these pin (2026-08-19)
 *
 * Verbatim: *"We don't need physical volume if we have series. Only a few
 * things have it like the 2 part Sanderson. Make it optional."*
 *
 * So `series_index_sort` alone decides whether the volume number is a gap, and
 * `series_index_display` — the designation a particular printing physically
 * carries — is optional data. `docs/info/volume-numbers.md` is the canonical
 * statement; these tests are the mechanical guard on it.
 *
 * ## Why this file is worth its lines
 *
 * The predicate was a two-column test from 2026-08-13 to 2026-08-19, and the
 * reasoning for that version reads persuasively — *"a row that sorts correctly
 * and prints nothing"*. What it actually did, measured on `library-catalog-2nd`
 * the day it was reversed: **55 of 55 remaining queue rows were `seriesIndex`**,
 * every one of them a row research could be paid for for ever and never close,
 * because nothing downstream of `routes/ingest.ts` had ever written the second
 * column. A future session WILL be tempted to re-tighten it. This is the thing
 * that stops them doing it silently.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  detailGaps,
  seriesIndexDisplayFrom,
  seriesIndexIncomplete,
  seriesIndexSortFrom,
} from '../src/gaps.js';

test('a series and a sort is COMPLETE, printed form or not', () => {
  // ⚠️ The whole rule, in one assertion. Re-tightening this to demand a printed
  // form is what made 55 of 55 rows unclosable.
  assert.equal(seriesIndexIncomplete(1), false);
  assert.equal(seriesIndexIncomplete(2.5), false);
  assert.equal(seriesIndexIncomplete(0), false, 'volume zero is a volume');
});

test('no sort is the only thing that makes a volume number a gap', () => {
  assert.equal(seriesIndexIncomplete(null), true);
  assert.equal(seriesIndexIncomplete(undefined), true);
});

test('detailGaps agrees: a numbered book with no printed form owes nothing', () => {
  // The predicate and its one caller, together — a tally that disagreed with
  // the rows is the failure `gapSummary`'s comment warns about.
  const numbered = {
    firstPublished: 2022,
    series: 'Bright Falls',
    seriesIndexSort: 1,
    seriesIndexDisplay: null,
    description: 'A book.',
  };
  assert.deepEqual(detailGaps(numbered), []);

  // And the same row without the number still asks.
  assert.deepEqual(detailGaps({ ...numbered, seriesIndexSort: null }), ['seriesIndex']);
});

test('a volume number is still not a question for a book with no series', () => {
  // Unchanged, and load-bearing: asking "which volume is this?" of a standalone
  // is how a model is handed a blank and invents a series to put the number in.
  assert.deepEqual(
    detailGaps({
      firstPublished: 2022,
      series: null,
      seriesIndexSort: null,
      seriesIndexDisplay: null,
      description: 'A book.',
    }),
    ['series'],
  );
});

test('seriesIndexDisplayFrom is the INGEST route’s legacy default, kept byte-for-byte', () => {
  // ⚠️ Not the semantics — the semantics are "present only where a printing
  // physically carries a designation". This exists because `routes/ingest.ts`
  // has written it on every work it ever created with a volume number, and
  // changing it would change how newly imported books read on the shelf. It is
  // pinned so that lifting the literal out of that route changed nothing, and
  // so nobody mistakes it for a rule and starts calling it from research.
  assert.equal(seriesIndexDisplayFrom(1), 'Book 1');
  assert.equal(seriesIndexDisplayFrom(12), 'Book 12');
  assert.equal(seriesIndexDisplayFrom(2.5), 'Book 2.5', 'a novella files at 2.5 and prints it');
});

test('seriesIndexSortFrom — a clean number becomes its sort', () => {
  // The common case: a bare volume label a person types into GABI's "volume".
  assert.equal(seriesIndexSortFrom('5'), 5);
  assert.equal(seriesIndexSortFrom('12'), 12);
  assert.equal(seriesIndexSortFrom('0'), 0, 'volume zero is a volume');
  assert.equal(seriesIndexSortFrom('07'), 7, 'a padded number is not octal here');
  assert.equal(seriesIndexSortFrom('  3  '), 3, 'surrounding whitespace is ignored');
});

test('seriesIndexSortFrom — a decimal files where it sorts', () => {
  assert.equal(seriesIndexSortFrom('2.5'), 2.5);
  assert.equal(seriesIndexSortFrom('0.5'), 0.5);
});

test('seriesIndexSortFrom round-trips seriesIndexDisplayFrom and the shelf forms', () => {
  // ⚠️ The invariant that justifies stripping a leading label: the inverse of
  // the legacy default must recover the number, and the hand-quoted forms
  // already on the shelf ("Volume 07", "#5") must too.
  for (const n of [1, 12, 2.5]) {
    assert.equal(seriesIndexSortFrom(seriesIndexDisplayFrom(n)), n, `Book ${n}`);
  }
  assert.equal(seriesIndexSortFrom('Book 5'), 5);
  assert.equal(seriesIndexSortFrom('Volume 07'), 7);
  assert.equal(seriesIndexSortFrom('Vol. 5'), 5);
  assert.equal(seriesIndexSortFrom('#5'), 5);
});

test('seriesIndexSortFrom — an ambiguous display writes NO sort (null), never garbage', () => {
  // ⚠️ The fail-safe. The caller reads null as "leave the sort alone", so a
  // book's ordering key is never corrupted by a display it cannot parse.
  assert.equal(seriesIndexSortFrom('Book Two'), null, 'a word is not a number');
  assert.equal(seriesIndexSortFrom('1a'), null, 'a number with a tail is refused, not truncated');
  assert.equal(seriesIndexSortFrom('Prequel'), null);
  assert.equal(seriesIndexSortFrom(''), null);
  assert.equal(seriesIndexSortFrom('   '), null);
  assert.equal(seriesIndexSortFrom(null), null);
  assert.equal(seriesIndexSortFrom(undefined), null);
  assert.equal(seriesIndexSortFrom('-5'), null, 'a sign is not a plain volume position');
  assert.equal(seriesIndexSortFrom('1e3'), null, 'scientific notation is not a volume');
});
