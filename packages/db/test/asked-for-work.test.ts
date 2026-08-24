/**
 * The alias-aware "already asked?" accounting, pinned directly.
 *
 * `askedForWork` is the one rule that decides whether adding a `work_alias`
 * re-opens a paid question, and its docstring's promise is exact: *"adding a new
 * alias re-opens exactly the still-empty fields it could newly answer, and
 * nothing already answered under the main title."* That promise is a money
 * decision (an owner-gated re-ask), so it is pinned by a test rather than left to
 * the SQL that calls it — the same reason `lastRealAttempt` is pure and exported.
 *
 * `selectTitleAliases` is the shared cap the ASK and the ACCOUNTING both read
 * with; if they capped differently a field would re-open on every sweep for ever,
 * so the cap is pinned here too.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { MAX_ALIAS_IDENTITIES, askedForWork, selectTitleAliases } from '../src/research.ts';

describe('selectTitleAliases — the shared cap', () => {
  it('drops blanks, the primary title, and duplicates', () => {
    assert.deepEqual(
      selectTitleAliases('The Ex Hex Duo', ['The Ex Hex', '', '  ', 'The Ex Hex', 'The Ex Hex Duo']),
      ['The Ex Hex'],
    );
  });

  it('sorts stably so the write side and the read side pick the SAME subset', () => {
    // Deterministic order is the whole point: were the two sides to keep aliases
    // in insertion order and one insert differently, the "covered" comparison
    // would drift. localeCompare, both sides.
    assert.deepEqual(selectTitleAliases('T', ['charlie', 'alpha', 'bravo']), [
      'alpha',
      'bravo',
      'charlie',
    ]);
  });

  it(`caps at MAX_ALIAS_IDENTITIES (${MAX_ALIAS_IDENTITIES})`, () => {
    const many = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
    const kept = selectTitleAliases('Book', many);
    assert.equal(kept.length, MAX_ALIAS_IDENTITIES);
    // The first N in sorted order, deterministically.
    assert.deepEqual(kept, ['a1', 'a2', 'a3', 'a4']);
  });
});

describe('askedForWork — what a new alias re-opens', () => {
  // A run that asked series+description under just the catalogued title, and got
  // nothing back (both are still gaps).
  const runUnderTitleOnly = {
    inputTitle: 'The Ex Hex Duo',
    inputAliases: [] as string[],
    unfilled: ['series', 'description'],
  };

  it('with no aliases and an unchanged title, behaves exactly like the old title match', () => {
    assert.deepEqual(askedForWork('The Ex Hex Duo', [], [runUnderTitleOnly]).sort(), [
      'description',
      'series',
    ]);
  });

  it('a retitle re-opens everything — no run asked under the new title', () => {
    assert.deepEqual(askedForWork('The Ex Hex', [], [runUnderTitleOnly]), []);
  });

  it('⚠️ adding a NEW alias re-opens the fields no run asked under it', () => {
    // The book gains alias "The Ex Hex". The only past run asked under the title
    // alone, so it did NOT cover the alias: both still-empty fields re-open.
    assert.deepEqual(askedForWork('The Ex Hex Duo', ['The Ex Hex'], [runUnderTitleOnly]), []);
  });

  it('⚠️ once a run HAS asked under the alias, the fields stop re-opening', () => {
    const runUnderBoth = {
      inputTitle: 'The Ex Hex Duo',
      inputAliases: ['The Ex Hex'],
      unfilled: ['series', 'description'],
    };
    assert.deepEqual(askedForWork('The Ex Hex Duo', ['The Ex Hex'], [runUnderBoth]).sort(), [
      'description',
      'series',
    ]);
  });

  it('⚠️ re-opens the alias-covered field but NOT one already asked under BOTH names', () => {
    // Run 1 asked series+description under the title only.
    // Run 2 (after an earlier alias "AKA-1") asked series+description under title+AKA-1.
    // Now a SECOND alias "AKA-2" is added. `series` and `description` re-open,
    // because no run covered AKA-2 — but a field only ever asked once, under a
    // set that already includes every current name, would not. Here both are
    // still open, so both re-open; the discriminating case is the next test.
    const run1 = { inputTitle: 'Book', inputAliases: [] as string[], unfilled: ['series'] };
    const run2 = { inputTitle: 'Book', inputAliases: ['AKA-1'], unfilled: ['description'] };
    // Current names: Book, AKA-1, AKA-2. No single run covers AKA-2 → nothing asked.
    assert.deepEqual(askedForWork('Book', ['AKA-1', 'AKA-2'], [run1, run2]), []);
    // Remove AKA-2 again (current = Book, AKA-1): run2 covers {Book,AKA-1} for
    // `description`; run1 covers only {Book}, so `series` re-opens under AKA-1.
    assert.deepEqual(askedForWork('Book', ['AKA-1'], [run1, run2]), ['description']);
  });

  it('coverage must be satisfied by a SINGLE run, not pieced together across runs', () => {
    // series asked under {Book}; description asked under {AKA} only. Current is
    // {Book, AKA}. Neither run covers the whole current set, so nothing counts as
    // asked — which is correct: the paid ask sends title+aliases together, so a
    // real run always covers the full current set, and fragments should re-open.
    const runA = { inputTitle: 'Book', inputAliases: [] as string[], unfilled: ['series'] };
    const runB = { inputTitle: 'AKA', inputAliases: [] as string[], unfilled: ['description'] };
    assert.deepEqual(askedForWork('Book', ['AKA'], [runA, runB]), []);
  });

  it('honours the alias cap on the CURRENT set so a >cap work cannot re-open for ever', () => {
    // A work with more aliases than the cap. The run recorded the same capped
    // subset the ask would have sent. The overflow alias is dropped from the
    // current set too, so coverage holds and `series` stays asked.
    const capped = selectTitleAliases('Book', ['a1', 'a2', 'a3', 'a4', 'a5']);
    const run = { inputTitle: 'Book', inputAliases: capped, unfilled: ['series'] };
    assert.deepEqual(askedForWork('Book', ['a1', 'a2', 'a3', 'a4', 'a5'], [run]), ['series']);
  });

  it('a field ANSWERED under the main title is not the accounting’s concern', () => {
    // `asked` only ever lists fields a run was SENT (`unfilled`). A field that was
    // filled is not a gap, so `unaskedGaps` never re-asks it regardless of what
    // this returns — the "nothing already answered under the main title re-opens"
    // half of the promise is upheld a layer up, and this function need only get
    // the still-empty fields right, which the cases above cover.
    const run = { inputTitle: 'Book', inputAliases: [], unfilled: ['series'] };
    // description was answered, so it was never in any run's `unfilled`.
    assert.deepEqual(askedForWork('Book', [], [run]), ['series']);
  });
});
