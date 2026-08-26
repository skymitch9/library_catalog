/**
 * "N books on your list are not in this catalogue" — the wording, and the split
 * it counts.
 *
 * ## ⚠️ The incident these pin
 *
 * Owner, 2026-08-26: *"in the tbr list, not all have sync'd — can we audit
 * Diva's."* The audit ran the shipped `resolveTbrEntries` over the live
 * `readingLists` store against both live D1 instances and found **nothing
 * broken**: 53 of Samantha's 358 to-read entries resolve to no work on
 * `padhard.heygabi.ai`, and 48 of those 53 are absent from the main instance
 * too. They are audiobooks with no library work behind them — `docs/info/tbr.md`
 * §3's *"ordinary case, not a failure"*, measured.
 *
 * ⚠️ **So what is pinned here is a SENTENCE, not a matcher.** The page had been
 * showing those entries under a heading and no number, and a person who counts
 * a shorter list than they expected reads an unexplained absence as a loss. The
 * two refusals below are the expensive half: this sentence must never call the
 * store broken, and it must never appear when there is nothing to say.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { TbrFoldable, TbrGroup } from '@lc/core';
import { notInCatalogueSentence, splitTbrGroupsByShelf } from '../src/lib/tbr-elsewhere.js';

/** A group with only the fields the split reads. */
function group(key: string, workId: number | null): TbrGroup<TbrFoldable> {
  return {
    key,
    entries: [],
    docIds: [`${key}_doc`],
    workId,
    readState: null,
    title: key,
    authors: null,
    workCoverUrl: null,
    docCoverUrl: null,
    formats: { physical: null, audio: null, ebook: null },
  };
}

describe('splitTbrGroupsByShelf', () => {
  it('splits on workId === null, and on nothing else', () => {
    const { here, elsewhere } = splitTbrGroupsByShelf([
      group('firefight', 7),
      group('alchemised', null),
      group('defiant', 12),
      group('untapped', null),
    ]);
    assert.deepEqual(
      here.map((g) => g.key),
      ['firefight', 'defiant'],
    );
    assert.deepEqual(
      elsewhere.map((g) => g.key),
      ['alchemised', 'untapped'],
    );
  });

  it('⚠️ a workId of 0 is a matched work, not an absent one', () => {
    // Falsy-but-present is the classic way a split like this loses a row. The
    // catalogue does not mint id 0 today, which is exactly why nothing else
    // would catch it if the predicate became truthiness.
    const { here, elsewhere } = splitTbrGroupsByShelf([group('zero', 0)]);
    assert.equal(here.length, 1);
    assert.equal(elsewhere.length, 0);
  });

  it('preserves order within each half — the caller’s order is the fold order', () => {
    const { elsewhere } = splitTbrGroupsByShelf([
      group('b', null),
      group('a', null),
      group('c', null),
    ]);
    assert.deepEqual(
      elsewhere.map((g) => g.key),
      ['b', 'a', 'c'],
    );
  });

  it('an empty list splits into two empty halves', () => {
    const { here, elsewhere } = splitTbrGroupsByShelf([]);
    assert.equal(here.length, 0);
    assert.equal(elsewhere.length, 0);
  });
});

describe('notInCatalogueSentence', () => {
  it('states the NUMBER — that is the whole point of the change', () => {
    const said = notInCatalogueSentence(53);
    assert.ok(said);
    assert.match(said, /53 books/);
  });

  it('says it in singular for one', () => {
    const said = notInCatalogueSentence(1);
    assert.ok(said);
    assert.match(said, /^One book/);
    assert.doesNotMatch(said, /1 books/);
  });

  it('⚠️ REFUSES to render at all when nothing is missing', () => {
    // A note that always appears is a note nobody reads, and "0 books are not in
    // this catalogue" invents a category on a list that has none. Same rule the
    // fold note follows two paragraphs up the page.
    assert.equal(notInCatalogueSentence(0), null);
    assert.equal(notInCatalogueSentence(-1), null);
    assert.equal(notInCatalogueSentence(Number.NaN), null);
  });

  it('⚠️ NEVER calls the list broken — no "missing", "failed" or "not synced"', () => {
    // The expensive half. These entries are in the shared store exactly as
    // recorded; the catalogue simply holds no copy. Wording that blamed the
    // sync would send somebody looking for a bug that measured clean on
    // 2026-08-26 — which is the report that produced this sentence.
    for (const n of [1, 2, 53]) {
      const said = notInCatalogueSentence(n);
      assert.ok(said);
      assert.doesNotMatch(said, /sync/i);
      assert.doesNotMatch(said, /fail/i);
      assert.doesNotMatch(said, /missing/i);
      assert.doesNotMatch(said, /error/i);
      // And it says where they ARE, which is what turns the absence into an
      // explanation rather than a shrug.
      assert.match(said, /audiobook/i);
      assert.match(said, /ebook/i);
      assert.match(said, /still on your list/i);
    }
  });
});
