/**
 * `planAudiobookSweep` — the decisions, pinned without a database.
 *
 * These are the rules that took real measurements to arrive at, and every one
 * of them is invisible in the output when it silently stops holding:
 *
 *   - `VIA_RANK` — an alias-route containment must never displace an exact
 *     match, and the printed pair wins ties. That is what makes "a work with
 *     aliases can only ever GAIN a match" true rather than hopeful;
 *   - two editions of ONE work both survive — the *Elantris* case, and the whole
 *     reason migration 0390 keyed the table `(work_id, audio_key)`;
 *   - `corroborated` needs the series AND the volume to agree, because a series
 *     whose numbering we have never seen agree is a series whose book 4 might be
 *     somebody else's 3;
 *   - phase 2 does NO title comparison. Containment is what produced the flat
 *     lie "All 5 held on audio" on *Tamer*; there is none of it in phase 2 and
 *     this test is what says so out loud.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  VIA_RANK,
  groupWorkAliases,
  planAudiobookSweep,
  type AudiobookSweepInput,
  type SweepWork,
} from '../src/audiobook-sweep.js';
import type { AudiobookRow } from '../src/audiobook-csv.js';

function audiobook(overrides: Partial<AudiobookRow> & { title: string }): AudiobookRow {
  return {
    id: 1,
    rawTitle: overrides.rawTitle ?? overrides.title,
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
    ...overrides,
  };
}

function work(overrides: Partial<SweepWork> & { id: number; title: string }): SweepWork {
  return { authors: '', series: null, seriesIndexSort: null, ...overrides };
}

/** Everything the planner needs, with the empty database as the default. */
function plan(over: Partial<AudiobookSweepInput> = {}) {
  return planAudiobookSweep({
    works: [],
    aliases: groupWorkAliases([]),
    audiobooks: [],
    existingEditions: [],
    existingRungs: [],
    // The identity fold: no cross-catalog drift in these fixtures. The one test
    // that needs a real canon supplies its own.
    canonicalSeries: (n) => n,
    scope: { kind: 'all' },
    ...over,
  });
}

describe('VIA_RANK — strongest first, and a weaker rung never displaces a stronger', () => {
  it('ranks exact above alias above containment', () => {
    assert.ok(VIA_RANK.exact < VIA_RANK.alias);
    assert.ok(VIA_RANK.alias < VIA_RANK.containment);
  });

  it('🔴 an alias-route CONTAINMENT never displaces the printed pair’s EXACT match', () => {
    // Our book is filed under a title that matches one recording exactly, and
    // under an alias that only *contains* another. The exact must win, and the
    // row must not record the alias.
    const audiobooks = [
      audiobook({ id: 1, title: 'Oathbound Healer', authors: 'Selkie Myth' }),
    ];
    const p = plan({
      works: [work({ id: 7, title: 'Oathbound Healer', authors: 'Selkie Myth' })],
      aliases: groupWorkAliases([
        { workId: 7, alias: 'Oathbound Healer - MM', kind: 'title' },
      ]),
      audiobooks,
    });

    assert.equal(p.report.matched.length, 1);
    const m = p.report.matched[0]!;
    assert.equal(m.via, 'exact');
    assert.equal(m.alias, null, 'the printed pair matched, so no alias was spent');
    assert.equal(p.editionUpserts.length, 1);
    assert.equal(p.editionUpserts[0]!.matchedVia, 'exact');
    assert.equal(p.editionUpserts[0]!.viaAlias, null);
  });

  it('an alias reaches a recording the printed name cannot — the Shirtaloon case', () => {
    // matching.ts's author gate rejects the printed author outright, and that
    // rejection is correct. Asking a second time under a recorded pen name is
    // the right fix, not a looser gate.
    const p = plan({
      works: [
        work({
          id: 9,
          title: 'He Who Fights with Monsters',
          authors: 'Travis Deverell',
        }),
      ],
      aliases: groupWorkAliases([{ workId: 9, alias: 'Shirtaloon', kind: 'author' }]),
      audiobooks: [
        audiobook({ id: 1, title: 'He Who Fights with Monsters', authors: 'Shirtaloon' }),
      ],
    });

    assert.equal(p.report.matched.length, 1);
    assert.equal(p.report.matched[0]!.alias, 'Shirtaloon');
    assert.equal(p.report.viaAliasCount, 1);
    assert.equal(p.editionUpserts[0]!.viaAlias, 'Shirtaloon');
  });

  it('with no alias in play the work simply misses — the gate is not widened', () => {
    const p = plan({
      works: [work({ id: 9, title: 'He Who Fights with Monsters', authors: 'Travis Deverell' })],
      audiobooks: [
        audiobook({ id: 1, title: 'He Who Fights with Monsters', authors: 'Shirtaloon' }),
      ],
    });
    assert.equal(p.report.matched.length, 0);
    assert.equal(p.report.missed.length, 1);
    assert.equal(p.editionUpserts.length, 0);
  });
});

/**
 * ⚠️ The fixture is the ACOTAR shape, not the *Elantris* one, and the
 * difference is the whole lesson.
 *
 * `audiobook_edition_holding` was keyed `(work_id, audio_key)` by migration 0390
 * *because of* the two *Elantris* recordings — but the matcher still reaches
 * that pair only under an alias (`docs/info/series-formats-and-audiobooks.md`
 * §4.5: folded, our side is 8 characters against 42, a ratio of 0.19 under a 0.6
 * floor). The shape that reaches TWO recordings on the matcher's own gates is
 * `isEditionSet` (§4.7): a fold whose members all state the **same non-null
 * series AND the same non-null volume**, which cannot be different volumes and
 * therefore must be recordings of one book. Measured against production
 * 2026-09-05, work 458's dramatized *A Court of Mist and Fury* is exactly that,
 * and it is one of the four multi-edition works the live sweep reports.
 */
describe('two editions of ONE work both survive — the edition-set case', () => {
  const works = [
    work({
      id: 458,
      title: 'A Court of Mist and Fury',
      authors: 'Sarah J. Maas',
      series: 'A Court of Thorns and Roses',
      seriesIndexSort: 2,
    }),
  ];
  const audiobooks = [
    audiobook({
      id: 1,
      title: 'A Court of Mist and Fury',
      rawTitle:
        'A Court of Mist and Fury (Part 1 of 2) (Dramatized Adaptation) - A Court of Thorns and Roses 2',
      authors: 'Sarah J. Maas',
      series: 'A Court of Thorns and Roses',
      seriesIndexSort: 2,
      seriesIndex: 2,
      seriesIndexDisplay: 'Book 2',
      narrator: 'Amanda Forstrom, Holly Adams',
    }),
    audiobook({
      id: 2,
      title: 'A Court of Mist and Fury',
      rawTitle:
        'A Court of Mist and Fury (Part 2 of 2) (Dramatized Adaptation) - A Court of Thorns and Roses, Book 2',
      authors: 'Sarah J. Maas',
      series: 'A Court of Thorns and Roses',
      seriesIndexSort: 2,
      seriesIndex: 2,
      seriesIndexDisplay: 'Book 2',
      narrator: 'Amanda Forstrom, Dawn Ursula',
    }),
  ];

  it('writes ONE row per (work, audio_key), keyed on the VERBATIM raw title', () => {
    const p = plan({ works, audiobooks });
    assert.equal(p.editionUpserts.length, 2, 'both recordings are stored, not one');
    // ⚠️ `audio_key` is `raw_title`, never the cleaned title — migration 0390
    // reuses 0340's content-warning key so the two identities cannot drift.
    // ⚠️ And it is why KI-12 is open: two recordings with the IDENTICAL raw
    // title still collide on this key and only one is stored.
    for (const e of p.editionUpserts) assert.equal(e.audioKey, e.rawTitle);
    assert.equal(new Set(p.editionUpserts.map((e) => e.audioKey)).size, 2);
    // Both show the same stripped title to a person.
    for (const e of p.editionUpserts) assert.equal(e.title, 'A Court of Mist and Fury');
  });

  it('still reports ONE verdict per work, and names it as multi-edition', () => {
    const p = plan({ works, audiobooks });
    assert.equal(p.report.matched.length, 1, 'the per-work question has one answer');
    assert.equal(p.report.matched[0]!.editionCount, 2);
    assert.equal(p.report.multiEdition.length, 1);
    assert.equal(p.report.multiEdition[0]!.editions.length, 2);
    assert.equal(p.report.liveEditions.length, 2);
  });

  it('the narrator rides along — it is what tells the two recordings apart', () => {
    const p = plan({ works, audiobooks });
    const byNarrator = new Set(p.editionUpserts.map((e) => e.narrator));
    assert.equal(byNarrator.size, 2);
    assert.ok(byNarrator.has('Amanda Forstrom, Holly Adams'));
    assert.ok(byNarrator.has('Amanda Forstrom, Dawn Ursula'));
  });
});

describe('the stale rule — marked, never deleted', () => {
  it('an existing edition this run did not reproduce is marked stale', () => {
    const p = plan({
      works: [work({ id: 1, title: 'Elantris', authors: 'Brandon Sanderson' })],
      audiobooks: [audiobook({ id: 1, title: 'Elantris', authors: 'Brandon Sanderson' })],
      existingEditions: [
        { workId: 1, audioKey: 'Elantris', staleAt: null },
        { workId: 1, audioKey: 'Elantris - A Recording That Went Away', staleAt: null },
      ],
    });
    assert.deepEqual(p.editionStales, [
      { workId: 1, audioKey: 'Elantris - A Recording That Went Away' },
    ]);
    assert.equal(p.report.editionsGoneStale, 1);
  });

  it('a row already stale is not staled twice', () => {
    const p = plan({
      existingEditions: [{ workId: 1, audioKey: 'Gone', staleAt: '2026-08-17 00:00:00' }],
    });
    assert.deepEqual(p.editionStales, []);
  });
});

describe('phase 2 — the rungs, and what earns an unhedged claim', () => {
  const ladder = [1, 2, 3].map((n) =>
    audiobook({
      id: n,
      title: `The Primal Hunter ${n}`,
      authors: 'Zogarth',
      series: 'The Primal Hunter',
      seriesIndexSort: n,
      seriesIndex: n,
      seriesIndexDisplay: String(n),
    }),
  );

  it('🔴 `corroborated` needs the series AND the volume to agree', () => {
    // The work matches a recording and both call the series the same thing —
    // but our volume number is 2 and the recording it matched is volume 1. The
    // numbering has NOT been seen to agree, so the rungs stay hedged.
    const p = plan({
      works: [
        work({
          id: 1,
          title: 'The Primal Hunter 1',
          authors: 'Zogarth',
          series: 'The Primal Hunter',
          seriesIndexSort: 2,
        }),
      ],
      audiobooks: ladder,
    });
    assert.equal(p.report.matched.length, 1);
    assert.equal(p.report.rungs.length, 1);
    assert.equal(p.report.rungs[0]!.via, 'fold');
    for (const r of p.rungUpserts) assert.equal(r.seriesMatchedVia, 'fold');
  });

  it('series and volume agreeing earns `work_match`', () => {
    const p = plan({
      works: [
        work({
          id: 1,
          title: 'The Primal Hunter 1',
          authors: 'Zogarth',
          series: 'The Primal Hunter',
          seriesIndexSort: 1,
        }),
      ],
      audiobooks: ladder,
    });
    assert.equal(p.report.rungs[0]!.via, 'work_match');
    assert.equal(p.rungUpserts.length, 3);
    assert.deepEqual(p.report.rungs[0]!.indexes, [1, 2, 3]);
    for (const r of p.rungUpserts) assert.equal(r.seriesMatchedVia, 'work_match');
  });

  it('a series with no volume on OUR side can never corroborate', () => {
    const p = plan({
      works: [
        work({
          id: 1,
          title: 'The Primal Hunter 1',
          authors: 'Zogarth',
          series: 'The Primal Hunter',
          seriesIndexSort: null,
        }),
      ],
      audiobooks: ladder,
    });
    assert.equal(p.report.rungs[0]!.via, 'fold');
  });

  it('🔴 phase 2 does NO title comparison — it joins on (series, index_sort) alone', () => {
    // Our series holds a book whose TITLE reaches nothing in the audiobook
    // catalog, and whose author is a different person entirely. The rungs are
    // still built, because phase 2 never looks at either: a gap rung has no
    // title to compare, which is exactly what makes it safe.
    const p = plan({
      works: [
        work({
          id: 1,
          title: 'A Title No Recording Shares',
          authors: 'Someone Else Entirely',
          series: 'The Primal Hunter',
          seriesIndexSort: 9,
        }),
      ],
      audiobooks: ladder,
    });
    assert.equal(p.report.matched.length, 0, 'phase 1 correctly refused');
    assert.equal(p.rungUpserts.length, 3, 'phase 2 built the ladder anyway');
    assert.equal(p.report.rungs[0]!.via, 'fold');
  });

  it('one row per index — the first spelling of a duplicated volume wins', () => {
    const p = plan({
      works: [work({ id: 1, title: 'x', series: 'The Primal Hunter', seriesIndexSort: 1 })],
      audiobooks: [
        ...ladder,
        audiobook({
          id: 99,
          title: 'The Primal Hunter 2 (Reissue)',
          authors: 'Zogarth',
          series: 'The Primal Hunter',
          seriesIndexSort: 2,
          seriesIndex: 2,
        }),
      ],
    });
    assert.equal(p.rungUpserts.length, 3);
    assert.equal(p.rungUpserts.find((r) => r.indexSort === 2)!.title, 'The Primal Hunter 2');
  });

  it('a rung an existing row already carries is not counted `fresh`', () => {
    const p = plan({
      works: [work({ id: 1, title: 'x', series: 'The Primal Hunter', seriesIndexSort: 1 })],
      audiobooks: ladder,
      existingRungs: [{ series: 'The Primal Hunter', indexSort: 1, staleAt: null }],
    });
    assert.equal(p.report.rungs[0]!.fresh, 2);
  });

  it('an existing rung this run did not reproduce is marked stale', () => {
    const p = plan({
      existingRungs: [{ series: 'A Series We Dropped', indexSort: 4, staleAt: null }],
    });
    assert.deepEqual(p.rungStales, [{ series: 'A Series We Dropped', indexSort: 4 }]);
    assert.equal(p.report.rungsGoneStale, 1);
  });

  it('the canon fold is applied to BOTH sides, and only for comparison', () => {
    // "Harry Potter (Full-Cast Editions)" there, "Harry Potter" here. Before the
    // canon existed this series built ZERO rungs.
    const canon = new Map([['harry potter (full-cast editions)', 'Harry Potter']]);
    const p = plan({
      works: [work({ id: 1, title: 'x', series: 'Harry Potter', seriesIndexSort: 1 })],
      audiobooks: [
        audiobook({
          id: 1,
          title: 'Philosopher’s Stone',
          series: 'Harry Potter (Full-Cast Editions)',
          seriesIndexSort: 1,
          seriesIndex: 1,
        }),
      ],
      canonicalSeries: (n) => canon.get(n.toLowerCase()) ?? n,
    });
    assert.equal(p.rungUpserts.length, 1);
    // ⚠️ What is STORED is OUR spelling — the read path joins `work.series`
    // exactly and no fold runs in the Worker.
    assert.equal(p.rungUpserts[0]!.series, 'Harry Potter');
    // …and the audiobook catalog's own spelling rides along, so the report can
    // say "(… there)".
    assert.equal(p.rungUpserts[0]!.audiobookSeries, 'Harry Potter (Full-Cast Editions)');
    assert.equal(p.report.rungs[0]!.abName, 'Harry Potter (Full-Cast Editions)');
  });
});

describe('the row the writer gets', () => {
  it('rounds title_similarity to four places, so both callers store one number', () => {
    const p = plan({
      works: [work({ id: 1, title: 'All The Skills: Book 2', authors: 'Honour Rae' })],
      audiobooks: [audiobook({ id: 1, title: 'All the Skills 2', authors: 'Honour Rae' })],
    });
    const sim = p.editionUpserts[0]!.titleSimilarity;
    assert.equal(sim, Number(sim.toFixed(4)));
  });

  it('carries every column the table has, and no SQL anywhere', () => {
    const p = plan({
      works: [work({ id: 3, title: 'Elantris', authors: 'Brandon Sanderson' })],
      audiobooks: [
        audiobook({
          id: 1,
          title: 'Elantris',
          authors: 'Brandon Sanderson',
          series: 'Elantris',
          seriesIndexSort: 1,
          seriesIndex: 1,
          seriesIndexDisplay: 'Book 1',
          coverHref: 'covers/Brandon Sanderson/Elantris.jpg',
          narrator: 'Jack Garrett',
        }),
      ],
    });
    assert.deepEqual(Object.keys(p.editionUpserts[0]!).sort(), [
      'audioKey', 'authors', 'coverHref', 'indexDisplay', 'indexSort', 'matchedVia',
      'narrator', 'rawTitle', 'series', 'title', 'titleSimilarity', 'viaAlias', 'workId',
    ]);
    // 🔴 The hinge of the whole extraction: DATA, not SQL.
    for (const value of Object.values(p.editionUpserts[0]!)) {
      if (typeof value === 'string') assert.ok(!/INSERT |UPDATE |SELECT /i.test(value));
    }
  });
});
