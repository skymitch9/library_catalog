/**
 * 🔴 `scope` — the guard that stops a route doing damage a script cannot.
 *
 * The script has always looked at the WHOLE catalog before deciding a row is
 * gone, so "I did not reproduce this row" and "this row is gone" mean the same
 * thing to it. **The route's on-add hook has looked at ONE book**, and if it
 * inherited that reasoning it would mark every other holding in the catalog
 * stale — on both instances, silently, and looking exactly like success.
 *
 * §6.2 guard 3 of `catalog-platform/docs/info/audiobook-association-route.md`
 * therefore says the stale phases run only under `{ kind: 'all' }`, and that
 * **this must be a type-level distinction, not a flag somebody remembers.**
 * This file is that rule as a test rather than a convention: every assertion
 * below fails loudly the day someone widens the scoped path.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  groupWorkAliases,
  planAudiobookSweep,
  type AudiobookSweepInput,
  type SweepWork,
} from '../src/audiobook-sweep.js';
import type { AudiobookRow } from '../src/audiobook-csv.js';

function audiobook(o: Partial<AudiobookRow> & { title: string; id: number }): AudiobookRow {
  return {
    rawTitle: o.rawTitle ?? o.title,
    authors: '',
    series: null,
    seriesIndexSort: null,
    seriesIndex: null,
    seriesIndexDisplay: null,
    narrator: null,
    coverHref: null,
    year: null,
    genre: null,
    description: null,
    ...o,
  };
}

function work(o: Partial<SweepWork> & { id: number; title: string }): SweepWork {
  return { authors: '', series: null, seriesIndexSort: null, ...o };
}

/**
 * A catalog with two books and two matching recordings, plus a database full of
 * rows NEITHER of them accounts for. Under `{ kind: 'all' }` every one of those
 * rows is stale; under a scoped run, none of them may be touched.
 */
const WORKS = [
  work({ id: 1, title: 'Elantris', authors: 'Brandon Sanderson' }),
  work({
    id: 2,
    title: 'The Primal Hunter 1',
    authors: 'Zogarth',
    series: 'The Primal Hunter',
    seriesIndexSort: 1,
  }),
];

const AUDIOBOOKS = [
  audiobook({ id: 1, title: 'Elantris', authors: 'Brandon Sanderson' }),
  audiobook({
    id: 2,
    title: 'The Primal Hunter 1',
    authors: 'Zogarth',
    series: 'The Primal Hunter',
    seriesIndexSort: 1,
    seriesIndex: 1,
  }),
  audiobook({
    id: 3,
    title: 'The Primal Hunter 2',
    authors: 'Zogarth',
    series: 'The Primal Hunter',
    seriesIndexSort: 2,
    seriesIndex: 2,
  }),
];

const EXISTING_EDITIONS = [
  { workId: 1, audioKey: 'Elantris', staleAt: null },
  { workId: 2, audioKey: 'The Primal Hunter 1', staleAt: null },
  // Rows nothing in this run reproduces — a full sweep must stale all three.
  { workId: 3, audioKey: 'A Book We No Longer Match', staleAt: null },
  { workId: 4, audioKey: 'Another One', staleAt: null },
  { workId: 5, audioKey: 'And Another', staleAt: null },
];

const EXISTING_RUNGS = [
  { series: 'The Primal Hunter', indexSort: 1, staleAt: null },
  { series: 'A Series Nobody Holds Any More', indexSort: 1, staleAt: null },
  { series: 'A Series Nobody Holds Any More', indexSort: 2, staleAt: null },
];

function plan(over: Partial<AudiobookSweepInput> = {}) {
  return planAudiobookSweep({
    works: WORKS,
    aliases: groupWorkAliases([]),
    audiobooks: AUDIOBOOKS,
    existingEditions: EXISTING_EDITIONS,
    existingRungs: EXISTING_RUNGS,
    canonicalSeries: (n) => n,
    scope: { kind: 'all' },
    ...over,
  });
}

describe('the control — a FULL sweep does stale things, so the scoped test proves something', () => {
  it('marks every unreproduced edition and rung stale', () => {
    const p = plan();
    assert.equal(p.editionStales.length, 3);
    assert.equal(p.rungStales.length, 2);
    assert.equal(p.report.editionsGoneStale, 3);
    assert.equal(p.report.rungsGoneStale, 2);
  });
});

describe('🔴 scope: { kind: "works" } produces ZERO stale entries', () => {
  it('no edition stales, whatever the database holds', () => {
    const p = plan({ scope: { kind: 'works', ids: [1] } });
    assert.deepEqual(p.editionStales, []);
    assert.equal(p.report.editionsGoneStale, 0);
  });

  it('no rung stales either — a series ladder is not the hook’s business', () => {
    const p = plan({ scope: { kind: 'works', ids: [1] } });
    assert.deepEqual(p.rungStales, []);
    assert.equal(p.report.rungsGoneStale, 0);
  });

  it('not even when the scoped work is the ONLY thing in the catalog it reproduces', () => {
    // The most tempting case to get wrong: work 2's own edition row is absent
    // from what this run rebuilt, and work 1's is not. Neither may be staled.
    const p = plan({ scope: { kind: 'works', ids: [2] } });
    assert.deepEqual(p.editionStales, []);
    assert.deepEqual(p.rungStales, []);
  });

  it('an EMPTY id list stales nothing — it does not fall back to "all"', () => {
    const p = plan({ scope: { kind: 'works', ids: [] } });
    assert.deepEqual(p.editionStales, []);
    assert.deepEqual(p.rungStales, []);
    assert.equal(p.editionUpserts.length, 0);
    assert.equal(p.rungUpserts.length, 0);
  });
});

describe('what a scoped run DOES do', () => {
  it('matches only the works it was given, and writes their editions', () => {
    const p = plan({ scope: { kind: 'works', ids: [1] } });
    assert.equal(p.report.matched.length, 1);
    assert.equal(p.report.matched[0]!.work.id, 1);
    assert.equal(p.editionUpserts.length, 1);
    assert.equal(p.editionUpserts[0]!.workId, 1);
  });

  it('the percentages still count the WHOLE catalog — the report is not rescaled', () => {
    // `workCount` is what the script's `pct()` divides by. A scoped run
    // reporting "100% matched" because it looked at one book would be a lie
    // that reads like good news.
    const p = plan({ scope: { kind: 'works', ids: [1] } });
    assert.equal(p.report.workCount, WORKS.length);
  });

  it('adds rungs a scoped run itself corroborated', () => {
    const p = plan({ scope: { kind: 'works', ids: [2] } });
    assert.equal(p.rungUpserts.length, 2, 'both Primal Hunter rungs');
    for (const r of p.rungUpserts) assert.equal(r.seriesMatchedVia, 'work_match');
    assert.deepEqual(p.report.foldSeriesDeferred, []);
  });

  it('⚠️ but DEFERS a series it could only fold — writing it would DOWNGRADE a work_match', () => {
    // Same catalog, but this run's evidence does not corroborate the numbering
    // (our volume says 9, the recordings say 1 and 2). A full sweep may well
    // have earned `work_match` for this series from another book; a scoped run
    // writing `fold` over it would erase that, so it writes nothing and says so.
    const p = plan({
      works: [
        work({
          id: 2,
          title: 'The Primal Hunter 1',
          authors: 'Zogarth',
          series: 'The Primal Hunter',
          seriesIndexSort: 9,
        }),
      ],
      scope: { kind: 'works', ids: [2] },
    });
    assert.deepEqual(p.rungUpserts, []);
    assert.deepEqual(p.report.foldSeriesDeferred, ['The Primal Hunter']);
    // …and the full sweep is unaffected: it still writes the fold verdict.
    const full = plan({
      works: [
        work({
          id: 2,
          title: 'The Primal Hunter 1',
          authors: 'Zogarth',
          series: 'The Primal Hunter',
          seriesIndexSort: 9,
        }),
      ],
    });
    assert.equal(full.rungUpserts.length, 2);
    assert.equal(full.rungUpserts[0]!.seriesMatchedVia, 'fold');
    assert.deepEqual(full.report.foldSeriesDeferred, []);
  });

  it('carries its scope back on the plan, so a writer can refuse what it must not apply', () => {
    assert.deepEqual(plan({ scope: { kind: 'works', ids: [1, 2] } }).scope, {
      kind: 'works',
      ids: [1, 2],
    });
    assert.deepEqual(plan().scope, { kind: 'all' });
  });
});
