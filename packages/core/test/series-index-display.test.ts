/**
 * The printed form of a volume number, when a machine fills one.
 *
 * ⚠️ These tests exist because of a measured dead end rather than a hypothetical
 * one. On 2026-08-19, `library-catalog-2nd` (the friend instance) held **55
 * works still on the details queue and every single one of them was
 * `seriesIndex`** — 54 with neither `series_index_sort` nor
 * `series_index_display` set. Research filled `sort`; `seriesIndexIncomplete`
 * requires both; nothing downstream of the ingest route had ever written
 * `display`. So the owner pressed Look again, the lookups all succeeded, real
 * money was spent, and the count did not move.
 *
 * The fix is one derivation shared by the two machines that write the column,
 * and the properties worth pinning are the two that keep it safe: it is exactly
 * what `routes/ingest.ts` has always written, and undo can recognise its own
 * handwriting without ever mistaking a person's for it.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isDerivedSeriesIndexDisplay, seriesIndexDisplayFrom } from '../src/gaps.js';

test('the derived form is exactly what the ingest route has always written', () => {
  // `routes/ingest.ts` wrote this literal for every work it ever created with a
  // volume number: `Book ${Number(sort).toString().replace(/\.0$/, '')}`. It is
  // where the main catalog's rows whose display is the bare number came from,
  // and it is the whole precedent this change rests on — so a drift here is a
  // drift from history, not a matter of taste.
  assert.equal(seriesIndexDisplayFrom(1), 'Book 1');
  assert.equal(seriesIndexDisplayFrom(12), 'Book 12');
  assert.equal(seriesIndexDisplayFrom(0), 'Book 0');
});

test('a half-volume keeps its decimal — the ladder allows 2.5 and so must the print', () => {
  // `series_index_sort` is REAL precisely so a novella can file at 2.5. Rounding
  // it here would print a number that contradicts the column beside it.
  assert.equal(seriesIndexDisplayFrom(2.5), 'Book 2.5');
  assert.equal(seriesIndexDisplayFrom(0.5), 'Book 0.5');
});

test('isDerivedSeriesIndexDisplay recognises the machine and only the machine', () => {
  // ⚠️ The load-bearing property. `revertFinding` clears the display when this
  // says the machine wrote it, so a false positive DESTROYS a person's work.
  assert.equal(isDerivedSeriesIndexDisplay(3, 'Book 3'), true);
  assert.equal(isDerivedSeriesIndexDisplay(3, '  Book 3  '), true, 'padding is not authorship');

  // Everything a person would actually type, all of it survives an undo.
  assert.equal(isDerivedSeriesIndexDisplay(7, 'Volume 07'), false);
  assert.equal(isDerivedSeriesIndexDisplay(0, 'Prequel'), false);
  assert.equal(isDerivedSeriesIndexDisplay(3, '3'), false);
  assert.equal(isDerivedSeriesIndexDisplay(3, 'Book Three'), false);
  // A number that moved on: the string was ours for a different volume, and it
  // is no longer ours for this one.
  assert.equal(isDerivedSeriesIndexDisplay(4, 'Book 3'), false);
});

test('isDerivedSeriesIndexDisplay never claims an absence', () => {
  // Nothing to take back, and — more to the point — nothing to be wrong about.
  assert.equal(isDerivedSeriesIndexDisplay(null, 'Book 3'), false);
  assert.equal(isDerivedSeriesIndexDisplay(undefined, 'Book 3'), false);
  assert.equal(isDerivedSeriesIndexDisplay(3, null), false);
  assert.equal(isDerivedSeriesIndexDisplay(3, undefined), false);
  assert.equal(isDerivedSeriesIndexDisplay(3, ''), false);
});

test('the derivation round-trips: whatever it writes, it can recognise', () => {
  // The two functions are each other's inverse in the only sense that matters,
  // and the header of `seriesIndexDisplayFrom` says the recognition test only
  // works while the derivation takes the sort and nothing else. This is that
  // promise, pinned.
  for (const sort of [0, 1, 2.5, 7, 12, 0.5, 100]) {
    assert.equal(
      isDerivedSeriesIndexDisplay(sort, seriesIndexDisplayFrom(sort)),
      true,
      `sort ${sort} should be recognised as the machine's own`,
    );
  }
});
