/**
 * The OPF series-prefix splitter, and the gate composition the ingest
 * fallback builds from it.
 *
 * Guards the duplicate class measured 2026-08-14: an EPUB's OPF says
 * "Beneath the Dragoneye Moons: Immortal War" where the catalog says
 * "Immortal War" with the series in its own column, and the first full
 * manifest import minted four duplicate works because nothing looked past
 * the exact key. `splitSeriesPrefix` is deliberately just a splitter — the
 * ingest route and the importer's dry-run probe both compose it with
 * `workKeyFor` and a fold-equality check of the prefix against the
 * candidate's recorded series, which is what these tests pin down.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normaliseTitle, splitSeriesPrefix, workKeyFor } from '../src/titles.ts';

describe('splitSeriesPrefix', () => {
  it('splits the measured OPF shape into series and title', () => {
    assert.deepEqual(splitSeriesPrefix('Beneath the Dragoneye Moons: Immortal War'), {
      series: 'Beneath the Dragoneye Moons',
      title: 'Immortal War',
    });
  });

  it('splits on the FIRST colon, so a double-decorated title fails safe', () => {
    // "Book 2: A Deck-Building LitRPG" as a remainder matches no real work,
    // which is the safe direction — the alternative split would invent one.
    assert.deepEqual(splitSeriesPrefix('All The Skills: Book 2: A Deck-Building LitRPG'), {
      series: 'All The Skills',
      title: 'Book 2: A Deck-Building LitRPG',
    });
  });

  it('returns null when there is no colon, or nothing on one side of it', () => {
    assert.equal(splitSeriesPrefix('Immortal War'), null);
    assert.equal(splitSeriesPrefix(': Immortal War'), null);
    assert.equal(splitSeriesPrefix('Beneath the Dragoneye Moons:'), null);
    assert.equal(splitSeriesPrefix('Beneath the Dragoneye Moons:  '), null);
  });

  it('trims both halves', () => {
    assert.deepEqual(splitSeriesPrefix('Tamer:  King of Dinosaurs Book 10'), {
      series: 'Tamer',
      title: 'King of Dinosaurs Book 10',
    });
  });
});

describe('the series-prefix ingest gate (the composition, not a new fold)', () => {
  // The catalog row the 2026-08-14 duplicates should have attached to.
  const catalogWork = {
    title: 'Immortal War',
    authors: 'Selkie Myth',
    series: 'Beneath the Dragoneye Moons',
    workKey: workKeyFor('Immortal War', 'Selkie Myth'),
  };

  it('the remainder key meets the catalog work exactly', () => {
    const split = splitSeriesPrefix('Beneath the Dragoneye Moons: Immortal War');
    assert.ok(split);
    assert.equal(workKeyFor(split.title, 'Selkie Myth'), catalogWork.workKey);
  });

  it('the prefix fold-equals the recorded series — the gate that makes the split safe', () => {
    const split = splitSeriesPrefix('Beneath the Dragoneye Moons: Immortal War');
    assert.ok(split);
    assert.equal(normaliseTitle(split.series), normaliseTitle(catalogWork.series));
  });

  it('⚠️ "Tamer: King of Dinosaurs" does NOT pass the gate against a work in series "Tamer: King of Dinosaurs"', () => {
    // The bare split reads the series as "Tamer". A catalog volume records its
    // series as "Tamer: King of Dinosaurs", so the fold-equality check fails
    // and no attach happens — the exact guess splitSeriesPrefix's doc bans.
    const split = splitSeriesPrefix('Tamer: King of Dinosaurs Book 10');
    assert.ok(split);
    assert.notEqual(normaliseTitle(split.series), normaliseTitle('Tamer: King of Dinosaurs'));
  });

  it('a different author never meets the remainder key', () => {
    const split = splitSeriesPrefix('Beneath the Dragoneye Moons: Immortal War');
    assert.ok(split);
    assert.notEqual(workKeyFor(split.title, 'Somebody Else'), catalogWork.workKey);
  });
});
