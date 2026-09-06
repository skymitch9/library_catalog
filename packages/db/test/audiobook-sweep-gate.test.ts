/**
 * `audiobookSweepGateCounts` against real SQLite — the counters `/api/health`
 * publishes as the answer to *"can we flip `AUDIOBOOK_SWEEP_MODE` to
 * `enforce`?"*.
 *
 * 🔴 **Why this exists at all.** On 2026-09-06 the flip was attempted on the
 * belief that ~42 shadow ticks had accumulated. The real figure — dug out of two
 * production databases by hand, because nothing published it — was **3 run rows,
 * 1 with a plan, 0 with `seriesVolumes`**. `/api/health` read only the LATEST
 * row, so a single `304` hid every plan before it. These counters are that
 * measurement, made cheap and made visible.
 *
 * Real SQLite rather than a stub, for the reason `details-run-history.test.ts`
 * and `audio-edition-count.test.ts` give: every claim below is decided inside
 * the SQL — `json_extract` over `detail_json`, the `state = 'shadow'` filter,
 * the quoted `"trigger"` keyword — and a TypeScript restatement would exercise
 * none of it.
 */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { audiobookSweepGateCounts } from '../src/audiobook-holdings.ts';

/** The narrow D1 surface the counter touches: prepare().first(). */
function d1(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        async first<T>() {
          return (stmt.get() ?? null) as T | null;
        },
      };
    },
  } as unknown as D1Database;
}

/** Migration 0470's run table, as shipped. */
function fixture(): { db: DatabaseSync; d1: D1Database } {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE audiobook_sweep_run (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger      TEXT NOT NULL CHECK (trigger IN ('cron', 'on-add', 'admin')),
      started_at   TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at  TEXT,
      state        TEXT NOT NULL,
      detail_json  TEXT
    );
  `);
  return { db, d1: d1(db) };
}

/** One run row, written the way `finishAudiobookSweepRun` writes it. */
function addRun(
  db: DatabaseSync,
  row: { trigger: string; state: string; detail: unknown },
): void {
  db.prepare(
    "INSERT INTO audiobook_sweep_run (trigger, started_at, finished_at, state, detail_json)" +
      " VALUES (?, '2026-09-06 00:00:00', '2026-09-06 00:00:01', ?, ?)",
  ).run(row.trigger, row.state, row.detail === undefined ? null : JSON.stringify(row.detail));
}

/** What a tick that planned BOTH halves records. */
const BOTH = {
  detail: 'shadow — nothing written',
  plan: { workCount: 411, editionUpserts: 127 },
  seriesVolumes: { planned: { seriesCount: 139, statements: 329 }, written: null, detail: null },
};

/** What a tick that planned only the holdings half records — the pre-2026-09-05 bundle. */
const HOLDINGS_ONLY = { detail: 'shadow — nothing written', plan: { workCount: 411 } };

describe('audiobookSweepGateCounts — the enforce gate, as a number', () => {
  it('an empty table is 0/0/0, not an error', async () => {
    const { d1: db } = fixture();
    assert.deepEqual(await audiobookSweepGateCounts(db), {
      planTicks: 0,
      seriesVolumeTicks: 0,
      cronPlanTicks: 0,
    });
  });

  it('🔴 a 304 tick counts toward NOTHING — it planned nothing', async () => {
    // The whole reason the gate read ~0 while three rows existed. `skipped` /
    // `unchanged` is a row, and a row is not evidence.
    const { db, d1: api } = fixture();
    addRun(db, { trigger: 'cron', state: 'skipped', detail: { detail: 'unchanged', plan: null } });
    addRun(db, { trigger: 'cron', state: 'skipped', detail: { detail: 'unchanged', plan: null } });
    assert.deepEqual(await audiobookSweepGateCounts(api), {
      planTicks: 0,
      seriesVolumeTicks: 0,
      cronPlanTicks: 0,
    });
  });

  it('a shadow tick with both halves counts on both counters', async () => {
    const { db, d1: api } = fixture();
    addRun(db, { trigger: 'cron', state: 'shadow', detail: BOTH });
    assert.deepEqual(await audiobookSweepGateCounts(api), {
      planTicks: 1,
      seriesVolumeTicks: 1,
      cronPlanTicks: 1,
    });
  });

  it('⚠️ the holdings half is NOT evidence for the series-volume half', async () => {
    // One switch enforces both, so the counters are separate on purpose. Row id
    // 1 in production is exactly this shape: a plan, and no `seriesVolumes` key
    // at all, because it ran on the bundle before W8-SERIES-VOL.
    const { db, d1: api } = fixture();
    addRun(db, { trigger: 'cron', state: 'shadow', detail: HOLDINGS_ONLY });
    const counts = await audiobookSweepGateCounts(api);
    assert.equal(counts.planTicks, 1);
    assert.equal(counts.seriesVolumeTicks, 0);
  });

  it('an explicit `"seriesVolumes": null` is the same silence as an absent key', async () => {
    // How the two bundles are told apart in the data — and neither counts.
    const { db, d1: api } = fixture();
    addRun(db, {
      trigger: 'cron',
      state: 'shadow',
      detail: { ...HOLDINGS_ONLY, seriesVolumes: null },
    });
    assert.equal((await audiobookSweepGateCounts(api)).seriesVolumeTicks, 0);
  });

  it('a SCOPED on-add run planned holdings but declined the other half — guard 3', async () => {
    const { db, d1: api } = fixture();
    addRun(db, {
      trigger: 'on-add',
      state: 'shadow',
      detail: {
        ...HOLDINGS_ONLY,
        seriesVolumes: { planned: null, written: null, detail: 'scoped run — the cron owns this half' },
      },
    });
    const counts = await audiobookSweepGateCounts(api);
    assert.equal(counts.planTicks, 1);
    assert.equal(counts.seriesVolumeTicks, 0, 'a declined half is not a planned half');
    assert.equal(counts.cronPlanTicks, 0, 'and it is not the cron');
  });

  it('🔴 `cronPlanTicks` separates the clock from an admin forcing plans on demand', async () => {
    // `force` makes a plan available whenever somebody asks for one. Forty of
    // those in an afternoon are forty readings of one CSV, not a week of
    // evidence — so the gate's "42" gets its own number.
    const { db, d1: api } = fixture();
    addRun(db, { trigger: 'cron', state: 'shadow', detail: BOTH });
    addRun(db, { trigger: 'admin', state: 'shadow', detail: BOTH });
    addRun(db, { trigger: 'admin', state: 'shadow', detail: BOTH });
    assert.deepEqual(await audiobookSweepGateCounts(api), {
      planTicks: 3,
      seriesVolumeTicks: 3,
      cronPlanTicks: 1,
    });
  });

  it('an APPLIED or IN-SYNC tick is not a shadow tick', async () => {
    // Once the mode flips, the evidence count freezes rather than climbing on
    // rows that prove nothing about the shadow phase.
    const { db, d1: api } = fixture();
    addRun(db, { trigger: 'cron', state: 'applied', detail: BOTH });
    addRun(db, { trigger: 'cron', state: 'in-sync', detail: BOTH });
    assert.equal((await audiobookSweepGateCounts(api)).planTicks, 0);
  });

  it('a row still `running` has no detail_json and counts as nothing', async () => {
    const { db, d1: api } = fixture();
    addRun(db, { trigger: 'cron', state: 'running', detail: undefined });
    assert.deepEqual(await audiobookSweepGateCounts(api), {
      planTicks: 0,
      seriesVolumeTicks: 0,
      cronPlanTicks: 0,
    });
  });
});
