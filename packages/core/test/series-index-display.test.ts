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
import { detailGaps, seriesIndexDisplayFrom, seriesIndexIncomplete } from '../src/gaps.js';

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
