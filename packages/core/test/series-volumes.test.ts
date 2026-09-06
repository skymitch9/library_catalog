/**
 * `planSeriesVolumes` — the decisions, pinned without a database.
 *
 * Every rule here cost a real measurement and every one of them is invisible in
 * the output when it silently stops holding:
 *
 *   - the fold is **`normaliseTitle` and nothing else**. "All The Skills" here
 *     and "All the Skills" there must meet, and they must meet through the
 *     project's ONE fold — a bespoke comparison is the second matching rule
 *     `matching.ts` opens by banning;
 *   - a **`manual` row is never proposed at all**. The SQL would leave it alone
 *     anyway; not sending the statement is what keeps the dry run's count
 *     honest, which is the number a person reads before typing `--commit`;
 *   - **only numbered rows become volumes.** A boxed set has a series and no
 *     index, and `series_volume.index_sort` is NOT NULL precisely so it cannot
 *     become a volume nobody can name;
 *   - 🔴 **`known_total` is never written, by anything, ever.** The sibling
 *     catalog is a record of what this household BOUGHT; its highest volume is a
 *     floor. "6 of 12" with nothing behind the 12 is the lie that looks like
 *     data, and the defence that survives a refactor is that `SeriesCheckRow`
 *     has no such field;
 *   - a series the catalog has never heard of is recorded as **`not_found`, not
 *     as silence** — so the next session does not re-ask.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  planSeriesVolumes,
  type SeriesVolumeSweepInput,
  type SeriesVolumeWrite,
} from '../src/series-volumes.js';
import type { AudiobookRow } from '../src/audiobook-csv.js';

function audiobook(over: Partial<AudiobookRow> & { title: string }): AudiobookRow {
  return {
    id: 1,
    rawTitle: over.rawTitle ?? over.title,
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
    ...over,
  };
}

function plan(over: Partial<SeriesVolumeSweepInput> = {}) {
  return planSeriesVolumes({ works: [], audiobooks: [], existing: [], ...over });
}

/** Every `series_volume` row a plan proposes. */
function volumes(writes: SeriesVolumeWrite[]) {
  return writes.flatMap((w) => (w.kind === 'volume' ? [w.row] : []));
}

/** Every `series_check` row a plan proposes. */
function checks(writes: SeriesVolumeWrite[]) {
  return writes.flatMap((w) => (w.kind === 'check' ? [w.row] : []));
}

/** Three volumes of one series, as the sibling catalog files them. */
function skills(spelling = 'All the Skills'): AudiobookRow[] {
  return [1, 2, 3].map((n) =>
    audiobook({
      title: `${spelling} ${n}`,
      series: spelling,
      seriesIndexSort: n,
      seriesIndexDisplay: String(n),
      authors: 'Honour Rae',
    }),
  );
}

describe('the fold is normaliseTitle and nothing else', () => {
  it('“All The Skills” here meets “All the Skills” there', () => {
    const p = plan({
      works: [{ series: 'All The Skills', seriesIndexSort: 1 }],
      audiobooks: skills(),
    });
    assert.equal(p.report.found, 1);
    assert.equal(p.report.notFound, 0);
    assert.deepEqual(
      volumes(p.writes).map((v) => v.indexSort),
      [1, 2, 3],
    );
  });

  it('🔴 the name STORED is OUR spelling, never the sibling catalog’s', () => {
    // `series_volume.series` joins `work.series` by name at read time. Storing
    // their spelling would file the rows under a series no page can find.
    const p = plan({
      works: [{ series: 'All The Skills', seriesIndexSort: 1 }],
      audiobooks: skills(),
    });
    for (const v of volumes(p.writes)) assert.equal(v.series, 'All The Skills');
    for (const c of checks(p.writes)) assert.equal(c.series, 'All The Skills');
  });

  it('punctuation and ampersands fold; a different series does NOT', () => {
    const p = plan({
      works: [{ series: 'Sword & Sorcery', seriesIndexSort: null }],
      audiobooks: [
        audiobook({ title: 'x', series: 'Sword and Sorcery', seriesIndexSort: 1 }),
        audiobook({ title: 'y', series: 'Sword of Sorcery', seriesIndexSort: 9 }),
      ],
    });
    assert.deepEqual(
      volumes(p.writes).map((v) => v.indexSort),
      [1],
      'the ampersand folded, and the unrelated series did not come with it',
    );
  });
});

describe('a series the sibling catalog has never heard of', () => {
  it('is recorded as not_found, not as silence', () => {
    const p = plan({ works: [{ series: 'Cradle', seriesIndexSort: 4 }], audiobooks: skills() });
    assert.equal(p.report.notFound, 1);
    assert.deepEqual(checks(p.writes), [
      { series: 'Cradle', source: 'audiobook_catalog', outcome: 'not_found', volumesSeen: 0 },
    ]);
    assert.equal(volumes(p.writes).length, 0, 'a not_found series proposes no volumes');
  });
});

describe('a manual row is a person’s answer', () => {
  it('is skipped entirely — not upserted, not counted', () => {
    const p = plan({
      works: [{ series: 'All The Skills', seriesIndexSort: 1 }],
      audiobooks: skills(),
      existing: [{ series: 'All The Skills', indexSort: 2, source: 'manual' }],
    });
    assert.deepEqual(
      volumes(p.writes).map((v) => v.indexSort),
      [1, 3],
      'volume 2 belongs to a person and no statement is sent for it',
    );
    assert.equal(p.report.manualSkipped, 1);
  });

  it('⚠️ the series is still SEEN — volumesSeen counts the CSV, not the statements', () => {
    // Otherwise a person hand-entering a volume would make the source look like
    // it had gone quiet about one.
    const p = plan({
      works: [{ series: 'All The Skills', seriesIndexSort: 1 }],
      audiobooks: skills(),
      existing: [{ series: 'All The Skills', indexSort: 2, source: 'manual' }],
    });
    assert.equal(checks(p.writes)[0]?.volumesSeen, 3);
  });
});

describe('only numbered rows become volumes', () => {
  it('a boxed set with a series and no index is not a volume', () => {
    const p = plan({
      works: [{ series: 'All The Skills', seriesIndexSort: 1 }],
      audiobooks: [
        ...skills(),
        audiobook({ title: 'All the Skills: The Collection', series: 'All the Skills' }),
      ],
    });
    assert.equal(volumes(p.writes).length, 3);
    assert.equal(checks(p.writes)[0]?.volumesSeen, 3);
  });

  it('a series whose rows are ALL unnumbered is `ok` with nothing to write', () => {
    // Measured on MAIN 2026-09-05: The Hunger Games. It is `ok` — the catalog
    // knows the series — with `volumes_seen = 0`, and `abTop` is null rather
    // than the `-Infinity` an empty `Math.max` used to print.
    const p = plan({
      works: [{ series: 'The Hunger Games', seriesIndexSort: 5 }],
      audiobooks: [audiobook({ title: 'Mockingjay', series: 'The Hunger Games' })],
    });
    assert.equal(p.report.found, 1);
    assert.equal(volumes(p.writes).length, 0);
    assert.equal(checks(p.writes)[0]?.outcome, 'ok');
    assert.equal(checks(p.writes)[0]?.volumesSeen, 0);
    assert.equal(p.report.entries[0]?.abTop, null);
    assert.equal(p.report.entries[0]?.top, 5);
  });

  it('the first row wins a repeated index — one row per rung', () => {
    const p = plan({
      works: [{ series: 'All The Skills', seriesIndexSort: 1 }],
      audiobooks: [
        audiobook({ title: 'first', series: 'All the Skills', seriesIndexSort: 1 }),
        audiobook({ title: 'second', series: 'All the Skills', seriesIndexSort: 1 }),
      ],
    });
    assert.deepEqual(
      volumes(p.writes).map((v) => v.title),
      ['first'],
    );
  });
});

describe('🔴 known_total is never written', () => {
  it('no proposed check row carries a total under any name', () => {
    const p = plan({
      works: [{ series: 'All The Skills', seriesIndexSort: 1 }],
      audiobooks: skills(),
    });
    for (const c of checks(p.writes)) {
      assert.deepEqual(Object.keys(c).sort(), ['outcome', 'series', 'source', 'volumesSeen']);
    }
    assert.ok(
      !/known_?total/i.test(JSON.stringify(p.writes)),
      'a total reached the plan — the sibling catalog states a FLOOR, never a length',
    );
  });
});

describe('idempotence, and the count a person reads before --commit', () => {
  it('a second run over the same CSV proposes the same set with 0 new', () => {
    const works = [{ series: 'All The Skills', seriesIndexSort: 1 }];
    const first = plan({ works, audiobooks: skills() });
    assert.equal(first.report.newVolumes, 3);

    const existing = volumes(first.writes).map((v) => ({
      series: v.series,
      indexSort: v.indexSort,
      source: v.source,
    }));
    const second = plan({ works, audiobooks: skills(), existing });
    assert.deepEqual(second.writes, first.writes, 'the same statements, every time');
    assert.equal(second.report.newVolumes, 0, 'and nothing is reported as new twice');
  });
});

describe('the order is the contract', () => {
  it('per series: its volumes, then its check — series by series', () => {
    const p = plan({
      works: [
        { series: 'All The Skills', seriesIndexSort: 1 },
        { series: 'Cradle', seriesIndexSort: 1 },
      ],
      audiobooks: skills(),
    });
    assert.deepEqual(
      p.writes.map((w) => `${w.kind}:${w.row.series}`),
      [
        'volume:All The Skills',
        'volume:All The Skills',
        'volume:All The Skills',
        'check:All The Skills',
        'check:Cradle',
      ],
    );
  });

  it('the series are code-point sorted, as SQLite’s BINARY collation orders them', () => {
    const p = plan({
      works: [
        { series: 'b', seriesIndexSort: null },
        { series: 'A', seriesIndexSort: null },
        { series: 'a', seriesIndexSort: null },
      ],
    });
    assert.deepEqual(
      p.writes.map((w) => w.row.series),
      ['A', 'a', 'b'],
    );
  });
});

describe('our own top volume, for the report', () => {
  it('is the MAX over the works, and null when we number none', () => {
    const p = plan({
      works: [
        { series: 'S', seriesIndexSort: 2 },
        { series: 'S', seriesIndexSort: 7 },
        { series: 'S', seriesIndexSort: null },
        { series: 'T', seriesIndexSort: null },
      ],
    });
    const byName = new Map(p.report.entries.map((e) => [e.series, e]));
    assert.equal(byName.get('S')?.top, 7);
    assert.equal(byName.get('T')?.top, null);
  });

  it('a work with no series is not a series', () => {
    const p = plan({ works: [{ series: null, seriesIndexSort: 3 }] });
    assert.equal(p.report.seriesCount, 0);
    assert.equal(p.writes.length, 0);
  });
});
