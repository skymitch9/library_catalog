/**
 * The series-volume refresh's D1 half — platform inventory §7 row #2.
 *
 * Four claims, each of which is silent when it stops holding:
 *
 *   1. **ONE rendering.** The script and the cron write the same SQL because
 *      they share `seriesVolumeStatements`, not because two people kept two
 *      copies in step. The equality is asserted against the script's own
 *      renderer, so a change to either side fails this file.
 *   2. 🔴 **The rendered TEXT is the text the script wrote before the
 *      conversion**, pinned as whole strings. The parity check between the
 *      script's dry run and the route's shadow plan rests on it, and a
 *      "harmless" reformat is exactly what would break it.
 *   3. **Never overwrites a person.** `source = CASE WHEN … 'manual' …` is in
 *      the SQL, and the planner additionally sends no statement at all for a
 *      manual row.
 *   4. **One batch.** The volumes and their `series_check` rows land together or
 *      not at all — a check row saying "12 volumes seen" beside volumes that
 *      never landed is the "flag written in a second request" bug.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planSeriesVolumes, type SeriesVolumePlan } from '@lc/core';
import { applySeriesVolumePlan, seriesVolumeStatements } from '../src/series-volumes.ts';
// The script's renderer and the escaping rule it renders with, so the "one
// canonical rendering" claim is asserted rather than asserted-about.
import { renderStatements } from '../../../scripts/lib/sweep-sql.mjs';
import { lit } from '../../../scripts/lib/d1.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VOLUME = {
  series: "All The Skills",
  indexSort: 2,
  indexDisplay: '2',
  title: "All the Skills 2: A Deckbuilding LitRPG",
  authors: 'Honour Rae',
  source: 'audiobook_catalog',
  sourceUrl: 'audiobook_catalog/site/catalog.csv',
} as const;

function planOf(over: Partial<SeriesVolumePlan> = {}): SeriesVolumePlan {
  return {
    writes: [
      { kind: 'volume', row: { ...VOLUME } },
      {
        kind: 'check',
        row: {
          series: 'All The Skills',
          source: 'audiobook_catalog',
          outcome: 'ok',
          volumesSeen: 3,
        },
      },
      {
        kind: 'check',
        row: { series: 'Cradle', source: 'audiobook_catalog', outcome: 'not_found', volumesSeen: 0 },
      },
    ],
    report: {
      seriesCount: 2,
      audiobookCount: 3,
      found: 1,
      notFound: 1,
      newVolumes: 1,
      manualSkipped: 0,
      entries: [],
    },
    ...over,
  } as SeriesVolumePlan;
}

interface Recorded {
  sql: string;
  binds: unknown[];
}

function fakeDb() {
  const batches: Recorded[][] = [];
  let pending: Recorded[] = [];
  const db = {
    prepare(sql: string) {
      const rec: Recorded = { sql, binds: [] };
      const stmt = {
        bind(...args: unknown[]) {
          rec.binds = args;
          pending.push(rec);
          return stmt;
        },
        async run() {
          pending.push(rec);
          return { meta: { changes: 1 } };
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
    async batch(statements: unknown[]) {
      batches.push(pending.slice(0, statements.length));
      pending = [];
      return statements.map(() => ({ success: true }));
    },
    _batches: batches,
  };
  return db as unknown as D1Database & { _batches: Recorded[][] };
}

function fillLocally(sql: string, binds: unknown[]): string {
  let i = 0;
  return `${sql.replace(/\?/g, () => lit(binds[i++]))};`;
}

// ---------------------------------------------------------------------------

describe('one canonical rendering — the script and the cron write the same SQL', () => {
  it('the script’s renderer produces exactly the shared statement list, filled', () => {
    const plan = planOf();
    const shared = seriesVolumeStatements(plan);
    const rendered = renderStatements(shared);
    assert.equal(rendered.length, shared.length);
    assert.deepEqual(
      rendered,
      shared.map((s) => fillLocally(s.sql, s.binds)),
    );
  });

  it('the placeholder count matches the bind count on every statement', () => {
    // A mismatch shifts every value one column to the left, silently.
    for (const s of seriesVolumeStatements(planOf())) {
      assert.equal(
        s.sql.split('?').length - 1,
        s.binds.length,
        `placeholders and binds disagree: ${s.sql}`,
      );
    }
  });

  it('⚠️ the statement ORDER is the plan’s order — per series, volumes then check', () => {
    assert.deepEqual(
      seriesVolumeStatements(planOf()).map(
        (s) => /^INSERT INTO (\w+)/.exec(s.sql)?.[1] ?? '?',
      ),
      ['series_volume', 'series_check', 'series_check'],
    );
  });
});

describe('🔴 the rendered TEXT is what the script wrote before the conversion', () => {
  it('a volume upsert, byte for byte', () => {
    const [sql] = renderStatements(seriesVolumeStatements(planOf()));
    assert.equal(
      sql,
      "INSERT INTO series_volume (series, index_sort, index_display, title, authors," +
        " source, source_url) VALUES ('All The Skills', 2, '2'," +
        " 'All the Skills 2: A Deckbuilding LitRPG', 'Honour Rae', 'audiobook_catalog'," +
        " 'audiobook_catalog/site/catalog.csv') ON CONFLICT(series, index_sort) DO UPDATE SET" +
        ' index_display = COALESCE(excluded.index_display, series_volume.index_display),' +
        ' title = COALESCE(excluded.title, series_volume.title),' +
        ' authors = COALESCE(excluded.authors, series_volume.authors),' +
        " source = CASE WHEN series_volume.source = 'manual' THEN series_volume.source" +
        " ELSE excluded.source END, last_seen_at = datetime('now'), stale_at = NULL;",
    );
  });

  it('an `ok` check, byte for byte', () => {
    const rendered = renderStatements(seriesVolumeStatements(planOf()));
    assert.equal(
      rendered[1],
      "INSERT INTO series_check (series, source, outcome, volumes_seen)" +
        " VALUES ('All The Skills', 'audiobook_catalog', 'ok', 3)" +
        " ON CONFLICT(series) DO UPDATE SET checked_at = datetime('now')," +
        " source = 'audiobook_catalog', outcome = 'ok', volumes_seen = 3;",
    );
  });

  it('a `not_found` check, byte for byte — ONE shape, two outcomes', () => {
    // The script carried two hand-written variants with the outcome and the
    // count as literals; they are binds now, and `lit` renders them to exactly
    // the same text. That equality is the whole reason one shape is safe.
    const rendered = renderStatements(seriesVolumeStatements(planOf()));
    assert.equal(
      rendered[2],
      "INSERT INTO series_check (series, source, outcome, volumes_seen)" +
        " VALUES ('Cradle', 'audiobook_catalog', 'not_found', 0)" +
        " ON CONFLICT(series) DO UPDATE SET checked_at = datetime('now')," +
        " source = 'audiobook_catalog', outcome = 'not_found', volumes_seen = 0;",
    );
  });

  it('an apostrophe in a series name is doubled, not escaped', () => {
    const plan = planOf({
      writes: [{ kind: 'volume', row: { ...VOLUME, series: "Sam's Books" } }],
    });
    assert.match(renderStatements(seriesVolumeStatements(plan))[0] ?? '', /'Sam''s Books'/);
  });

  it('a NULL column renders as NULL, never as the empty string', () => {
    const plan = planOf({
      writes: [{ kind: 'volume', row: { ...VOLUME, indexDisplay: null, authors: null } }],
    });
    const sql = renderStatements(seriesVolumeStatements(plan))[0] ?? '';
    assert.match(sql, /VALUES \('All The Skills', 2, NULL, '[^']*', NULL, 'audiobook_catalog'/);
  });
});

describe('never overwrites a person, and never claims a length', () => {
  it('the source guard is in the SQL as well as in the planner', () => {
    const upsert = seriesVolumeStatements(planOf())[0]?.sql ?? '';
    assert.match(
      upsert,
      /source = CASE WHEN series_volume\.source = 'manual' THEN series_volume\.source ELSE excluded\.source END/,
    );
  });

  it('🔴 no statement mentions known_total', () => {
    for (const s of seriesVolumeStatements(planOf())) {
      assert.ok(!/known_total/.test(s.sql), `a statement writes a series length: ${s.sql}`);
    }
  });

  it('every INSERT carries its ON CONFLICT — idempotent by construction', () => {
    for (const s of seriesVolumeStatements(planOf())) {
      assert.match(s.sql, /ON CONFLICT\(/, `not an upsert: ${s.sql}`);
    }
  });

  it('a manual row never reaches a statement at all', () => {
    // Belt and braces with the planner's own test: the SQL would leave the row
    // alone anyway, and the statement not being sent is what keeps the dry
    // run's count honest.
    const plan = planSeriesVolumes({
      works: [{ series: 'S', seriesIndexSort: 1 }],
      audiobooks: [
        {
          id: 1,
          rawTitle: 'S 1',
          title: 'S 1',
          authors: 'A',
          series: 'S',
          seriesIndexSort: 1,
          seriesIndex: 1,
          seriesIndexDisplay: '1',
          narrator: null,
          coverHref: null,
          year: null,
          genre: null,
          description: null,
        },
      ],
      existing: [{ series: 'S', indexSort: 1, source: 'manual' }],
    });
    assert.equal(
      seriesVolumeStatements(plan).filter((s) => /INSERT INTO series_volume/.test(s.sql)).length,
      0,
    );
  });
});

describe('one batch', () => {
  it('the volumes and their check rows land in the SAME batch', async () => {
    const db = fakeDb();
    const res = await applySeriesVolumePlan(db, planOf());
    assert.equal(db._batches.length, 1, 'a second batch is a second failure domain');
    assert.equal(db._batches[0]?.length, 3);
    assert.equal(res.statements, 3);
  });

  it('an empty plan writes nothing at all — no batch, no statements', async () => {
    const db = fakeDb();
    const res = await applySeriesVolumePlan(db, planOf({ writes: [] }));
    assert.equal(db._batches.length, 0);
    assert.equal(res.statements, 0);
  });

  it('the binds are the row’s values, in column order', async () => {
    const db = fakeDb();
    await applySeriesVolumePlan(db, planOf());
    assert.deepEqual(db._batches[0]?.[0]?.binds, [
      'All The Skills',
      2,
      '2',
      'All the Skills 2: A Deckbuilding LitRPG',
      'Honour Rae',
      'audiobook_catalog',
      'audiobook_catalog/site/catalog.csv',
    ]);
  });
});
