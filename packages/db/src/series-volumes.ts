/**
 * The series-volume refresh's D1 half — the plan, bound.
 *
 * `planSeriesVolumes` (`packages/core/src/series-volumes.ts`) decides and
 * returns ROWS; this file is what turns those rows into writes, and the one read
 * that feeds them. Platform inventory §7 row #2.
 *
 * ## 🔴 ONE rendering, not two
 *
 * The same rule `audiobook-holdings.ts` states at length: there is ONE statement
 * list, `seriesVolumeStatements`, and both callers consume it —
 *
 * | Caller | What it does with a `SweepStatement` |
 * |---|---|
 * | this file (`applySeriesVolumePlan`) | `db.prepare(sql).bind(...binds)` |
 * | `scripts/lib/sweep-sql.mjs` | substitutes `lit(bind)` for each `?` and appends `;` |
 *
 * ⚠️ **The SQL below is written as the single-line text
 * `scripts/backfill-series-volumes.mjs`'s concatenations produced, with `?`
 * where a `${lit(...)}` used to be** — verbatim, spaces included. Reformat it
 * for looks and the script's rendered bytes change.
 * `packages/db/test/series-volumes.test.ts` pins them as whole strings.
 *
 * ⚠️ **The statement ORDER is the plan's order** — per series, its volume
 * upserts and then its `series_check` row — because that is what the script has
 * always run and what its dry-run statement count counts.
 *
 * ## Idempotency, and never overwriting a person
 *
 * Every volume INSERT carries `ON CONFLICT(series, index_sort) DO UPDATE …
 * last_seen_at = datetime('now'), stale_at = NULL`, so a second run inside one
 * minute produces the same rows. `source` is guarded by
 * `CASE WHEN series_volume.source = 'manual' THEN series_volume.source ELSE
 * excluded.source END` — **a person's answer is not a CSV's to overwrite** — and
 * the planner additionally does not emit the statement at all for a `manual`
 * row, so the dry run's count is honest as well as the write being safe.
 *
 * ## ⚠️ Why there are NO `change_log` rows here, stated out loud
 *
 * The audiobook sweep writes one `change_log` row per work whose ASSOCIATION
 * changed (`audiobookSweepTransitions`), and this half deliberately writes none.
 * It is not an omission:
 *
 * | | |
 * |---|---|
 * | `change_log.entity_id` is **`INTEGER NOT NULL`** (migration 0120) | a series is NAMED, not numbered. `series_volume.id` exists but is unknown at upsert time, and `last_insert_rowid()` is only correct on the INSERT path of an upsert — on the conflict path SQLite leaves it at whatever the previous statement set, so a mis-keyed audit row would be filed against somebody else's book. **A wrong audit row is worse than none** |
 * | The closest precedent agrees | `audiobook_series_holding` — the OTHER series-keyed table the same sweep writes — logs nothing either, for exactly this reason |
 * | The script logs none | so "matching the script's existing semantics" is satisfied exactly |
 * | The audit trail already exists | `series_check` records per series that a source was consulted, when, and what it said — in the SAME batch as the volumes — and the run row (`audiobook_sweep_run.detail_json.seriesVolumes`) records what each tick decided |
 *
 * 🔴 **What would change it:** widening `change_log.entity_id` to TEXT or adding
 * an `entity_key` column. That is a MIGRATION with its own review, on a table
 * every panel in the app reads, and nothing today needs it.
 */

import type { SeriesVolumePlan } from '@lc/core';
import type { SweepStatement } from './audiobook-holdings.js';

/**
 * ⚠️ Written as the single-line text the script's concatenation produced. The
 * `COALESCE(excluded.x, series_volume.x)` form is what lets a later, richer
 * source (Open Library, a research run) keep a column the CSV has nothing to say
 * about — a NULL from this rung never blanks a value another rung filled.
 */
const VOLUME_UPSERT_SQL =
  'INSERT INTO series_volume (series, index_sort, index_display, title, authors,' +
  ' source, source_url)' +
  ' VALUES (?, ?, ?, ?, ?, ?, ?)' +
  ' ON CONFLICT(series, index_sort) DO UPDATE SET' +
  ' index_display = COALESCE(excluded.index_display, series_volume.index_display),' +
  ' title = COALESCE(excluded.title, series_volume.title),' +
  ' authors = COALESCE(excluded.authors, series_volume.authors),' +
  " source = CASE WHEN series_volume.source = 'manual' THEN series_volume.source" +
  ' ELSE excluded.source END,' +
  " last_seen_at = datetime('now'), stale_at = NULL";

/**
 * ⚠️ ONE statement shape for both outcomes, where the script had two literals.
 * `outcome` and `volumes_seen` are binds, and `lit('not_found')` / `lit(0)`
 * render to exactly the text the two hand-written variants carried — measured,
 * not assumed: `packages/db/test/series-volumes.test.ts` pins both renderings.
 *
 * ⚠️ **`known_total` is not in this statement and must never be.** The sibling
 * catalog's highest volume is a FLOOR, not a total; see the planner's header.
 */
const CHECK_UPSERT_SQL =
  'INSERT INTO series_check (series, source, outcome, volumes_seen)' +
  " VALUES (?, 'audiobook_catalog', ?, ?)" +
  " ON CONFLICT(series) DO UPDATE SET checked_at = datetime('now')," +
  " source = 'audiobook_catalog', outcome = ?, volumes_seen = ?";

/**
 * Every statement for one plan, in the plan's order.
 *
 * Pure: no database, no clock, no I/O — which is what lets the test pin the
 * exact SQL and lets the script render the identical text with no D1 binding in
 * sight.
 */
export function seriesVolumeStatements(plan: SeriesVolumePlan): SweepStatement[] {
  const statements: SweepStatement[] = [];
  for (const write of plan.writes) {
    if (write.kind === 'volume') {
      const v = write.row;
      statements.push({
        sql: VOLUME_UPSERT_SQL,
        binds: [v.series, v.indexSort, v.indexDisplay, v.title, v.authors, v.source, v.sourceUrl],
      });
    } else {
      const c = write.row;
      statements.push({
        sql: CHECK_UPSERT_SQL,
        binds: [c.series, c.outcome, c.volumesSeen, c.outcome, c.volumesSeen],
      });
    }
  }
  return statements;
}

export interface SeriesVolumeApplyResult {
  /** Statements written — volume upserts plus `series_check` rows. */
  statements: number;
}

/**
 * Write one plan. Everything in ONE batch.
 *
 * ⚠️ The volumes and their `series_check` rows land together or not at all. A
 * `series_check` row saying "checked, 12 volumes seen" beside volumes that never
 * landed is the "flag written in a second request" bug: the next run would read
 * the check as done and the page would report a gap nobody could explain.
 */
export async function applySeriesVolumePlan(
  db: D1Database,
  plan: SeriesVolumePlan,
): Promise<SeriesVolumeApplyResult> {
  const statements = seriesVolumeStatements(plan);
  if (statements.length > 0) {
    await db.batch(statements.map((s) => db.prepare(s.sql).bind(...s.binds)));
  }
  return { statements: statements.length };
}

/**
 * Every `series_volume` row as it stands, in the shape the planner wants it.
 *
 * ⚠️ `source` is read for one reason and it is load-bearing: a `manual` row is a
 * person's answer and the planner must decline to propose a statement for it at
 * all. Dropping this column would leave the SQL's `CASE` as the only defence,
 * which is safe but would make the dry run over-report by every hand-entered
 * row.
 */
export async function readSeriesVolumeRows(
  db: D1Database,
): Promise<{ series: string; indexSort: number; source: string }[]> {
  const res = await db
    .prepare('SELECT series, index_sort, source FROM series_volume')
    .all<{ series: string; index_sort: number; source: string }>();
  return (res.results ?? []).map((r) => ({
    series: r.series,
    indexSort: Number(r.index_sort),
    source: r.source,
  }));
}

/** What `series_volume` / `series_check` hold right now — the `/api/health` counts. */
export async function seriesVolumeCounts(
  db: D1Database,
): Promise<{ volumesLive: number; seriesChecked: number }> {
  const row = await db
    .prepare(
      'SELECT (SELECT COUNT(*) FROM series_volume WHERE stale_at IS NULL) AS volumes,' +
        ' (SELECT COUNT(*) FROM series_check) AS checked',
    )
    .first<{ volumes: number; checked: number }>();
  return { volumesLive: Number(row?.volumes ?? 0), seriesChecked: Number(row?.checked ?? 0) };
}
