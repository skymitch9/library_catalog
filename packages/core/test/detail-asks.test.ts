/**
 * The companion ask: buy the series and the volume number in ONE lookup.
 *
 * ## ⚠️ The bug these pin (measured 2026-08-21, `library-catalog-2nd`)
 *
 * | | |
 * |---|---|
 * | runs that asked `series` | **126** |
 * | runs that ever asked `seriesIndex` | **11** |
 * | remaining queue rows | **36** |
 * | of those, `seriesIndex` | **36 — all of them** |
 * | of those, ever asked the volume question | **0** |
 *
 * `detailFieldsFor` will not ask "which volume is this?" until a book has a
 * series — correct, and it must stay that way for the OWED list. But the ASK
 * list inherited the same restriction, so **every series the sweep filled
 * manufactured a fresh volume gap that needed a second paid lookup**, and the
 * queue converged on being nothing but volume numbers.
 *
 * ⚠️ **The number had already been bought.** Run #135 (work 100, *Summoned to
 * the Wilds*) was sent for `firstPublished, series, description` and wrote its
 * own answer down: *"Series set to Villains and Virtues. … **Villains and
 * Virtues #2** by A. K. Caggiano…"*. One search, one page fetch, two invoices,
 * and the row still read "missing volume number" on the queue afterwards.
 *
 * ⚠️ **None of this reopens the completeness rules of 2026-08-19.**
 * `seriesIndexIncomplete` still reads the sort alone; the printed form is
 * still optional data and never a gap; `multi_volume_printing` is still
 * human-only. `docs/info/volume-numbers.md` is the canonical statement.
 * `detailAsks` widens what is *asked*, never what is *owed* — and the pair of
 * tests at the bottom is what stops the two being conflated again.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { detailAsks, detailGaps } from '../src/gaps.js';

/** A book the sweep is about to look up, with nothing recorded but its title. */
const bare = {
  firstPublished: null,
  series: null,
  seriesIndexSort: null,
  seriesIndexDisplay: null,
  description: null,
};

test('asking for the series asks for the volume number in the same call', () => {
  const missing = detailGaps(bare);
  assert.deepEqual(missing, ['firstPublished', 'series', 'description']);

  // The whole fix: one call covers both, so the search that settles the series
  // settles the number too.
  assert.deepEqual(detailAsks(bare, missing), [
    'firstPublished',
    'series',
    'seriesIndex',
    'description',
  ]);
});

test('the companion ask keeps DETAIL_FIELDS order, so series applies first', () => {
  // ⚠️ Load-bearing, not cosmetic. `applyFinding` refuses a `seriesIndex` whose
  // work has no series yet, and `autoApplyFindings` sorts by this same order.
  // A list with the number ahead of the name writes the name and drops the
  // number on every book that had both to learn.
  const asks = detailAsks(bare, detailGaps(bare));
  assert.ok(asks.indexOf('series') < asks.indexOf('seriesIndex'));
});

test('a book that already has its series is unchanged — it already asks', () => {
  const known = { ...bare, series: 'Villains and Virtues', description: 'A book.' };
  const missing = detailGaps(known);
  assert.deepEqual(missing, ['firstPublished', 'seriesIndex']);
  assert.deepEqual(detailAsks(known, missing), missing);
});

test('a numbered book is not asked its volume number again', () => {
  const numbered = { ...bare, series: 'Caraval', seriesIndexSort: 2 };
  const missing = detailGaps(numbered);
  assert.ok(!missing.includes('seriesIndex'));
  assert.ok(!detailAsks(numbered, missing).includes('seriesIndex'));
});

test('a recorded verdict stays recorded — the companion ask does not re-buy it', () => {
  // ⚠️ *Tusk Love* (R10): "Critical Role" is a shelf label, not a numbered
  // series, so the row carries a `none` verdict rather than a fabricated 1.
  // `gap_verdict` exists to stop a settled question being asked twice, and a
  // companion ask that ignored it would be the re-ask loop with a new door.
  const answered = { ...bare, verdicts: ['seriesIndex' as const] };
  const missing = detailGaps(answered);
  assert.ok(!detailAsks(answered, missing).includes('seriesIndex'));
});

test('a book not being asked its series is never widened', () => {
  const onlyDescription = {
    ...bare,
    firstPublished: 2022,
    series: null,
    verdicts: ['series' as const],
  };
  const missing = detailGaps(onlyDescription);
  assert.deepEqual(missing, ['description']);
  // No series question, so no volume question — a standalone must never be
  // handed a blank volume number to invent a series for.
  assert.deepEqual(detailAsks(onlyDescription, missing), ['description']);
});

test('⚠️ the OWED list is untouched — asks widen, gaps do not', () => {
  // The one thing that must never drift. If `detailGaps` ever starts returning
  // `seriesIndex` for a seriesless book, the queue grows a "missing volume
  // number" line under every standalone in the catalog — which is the exact
  // noise this whole area exists to keep out.
  for (const subject of [bare, { ...bare, firstPublished: 2022 }]) {
    assert.ok(!detailGaps(subject).includes('seriesIndex'));
  }
});
