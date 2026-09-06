/**
 * The standing audits' D1 half — the inputs they read, and the run log.
 *
 * Platform inventory §7 rows #4 and #5, built 2026-09-06. The DECISIONS are in
 * `@lc/core`'s `audits.ts` and are shared with `scripts/check-cover-health.mjs`
 * and `scripts/audit-series-aggregates.mjs`; what lives here is the SQL, which
 * the scripts reach through `scripts/lib/d1.mjs` and the Worker through its D1
 * binding.
 *
 * ⚠️ **Every function here READS.** Neither audit writes to a catalog table and
 * neither ever should — the whole point of a standing alarm is that a hit is a
 * question for a person, not an instruction to a sweep. The only writes in this
 * file are to `audit_run` (migration 0480), which is bookkeeping about the audit
 * rather than about the catalog.
 */

import type { CoverHealthRow, SeriesAggregateWork } from '@lc/core';
import { listKnownSeriesNames } from './series.js';

// ---------------------------------------------------------------------------
// The run log (migration 0480)
// ---------------------------------------------------------------------------

/**
 * ⚠️ The vocabulary of record for `audit_run.audit`. The column has no CHECK on
 * purpose (see 0480); this type is the constraint, and it is enforced where
 * types are — at every call site, in one package.
 */
export type AuditName = 'cover-health' | 'series-aggregates';

/** Who asked. `cron` is the clock; `admin` is the on-demand route. */
export type AuditTrigger = 'cron' | 'admin';

export interface AuditRunRow {
  id: number;
  audit: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  state: string;
  detail: unknown;
}

/** Open a run row. The id is how the finishing write finds it again. */
export async function startAuditRun(
  db: D1Database,
  audit: AuditName,
  trigger: AuditTrigger,
): Promise<number> {
  const row = await db
    .prepare(
      "INSERT INTO audit_run (audit, trigger, started_at, state)" +
        " VALUES (?, ?, datetime('now'), 'running') RETURNING id",
    )
    .bind(audit, trigger)
    .first<{ id: number }>();
  return Number(row?.id ?? 0);
}

/**
 * Close a run row.
 *
 * ⚠️ `state` and `finished_at` move together, in ONE statement — the pairing
 * rule migration 0040 records. Two writes mean a window in which the row says
 * something that was never true: a finished timestamp on a `running` state, or
 * a verdict with no finish.
 */
export async function finishAuditRun(
  db: D1Database,
  id: number,
  input: { state: string; detail: unknown },
): Promise<void> {
  await db
    .prepare(
      "UPDATE audit_run SET state = ?, finished_at = datetime('now'), detail_json = ?" +
        ' WHERE id = ?',
    )
    .bind(input.state, JSON.stringify(input.detail ?? null), id)
    .run();
}

/**
 * The most recently STARTED run of one audit — what `/api/health` reports.
 *
 * ⚠️ Ordered by `id`, not by `started_at`, exactly as `latestAudiobookSweepRun`
 * is: `datetime('now')` has one-second resolution, an admin run beside a cron
 * tick is a real thing, and the autoincrement id is the only strict order this
 * table has.
 */
export async function latestAuditRun(
  db: D1Database,
  audit: AuditName,
): Promise<AuditRunRow | null> {
  const row = await db
    .prepare(
      'SELECT id, audit, trigger, started_at, finished_at, state, detail_json' +
        ' FROM audit_run WHERE audit = ? ORDER BY id DESC LIMIT 1',
    )
    .bind(audit)
    .first<{
      id: number;
      audit: string;
      trigger: string;
      started_at: string;
      finished_at: string | null;
      state: string;
      detail_json: string | null;
    }>();
  if (!row) return null;
  let detail: unknown = null;
  try {
    detail = row.detail_json ? JSON.parse(row.detail_json) : null;
  } catch {
    // A stored value that fails to parse is shown as its raw text, never
    // dropped — the same rule `listChangesForEntity` and `latestAudiobookSweepRun`
    // follow.
    detail = row.detail_json;
  }
  return {
    id: Number(row.id),
    audit: row.audit,
    trigger: row.trigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    state: row.state,
    detail,
  };
}

// ---------------------------------------------------------------------------
// Cover health inputs
// ---------------------------------------------------------------------------

export interface CoverHealthInputs {
  /** Every work claiming a cover, in id order. */
  rows: CoverHealthRow[];
  /** How many works exist at all — the empty-read guard's number. */
  totalWorks: number;
  /**
   * How many works have NO cover URL. ⚠️ Reported beside `broken` and
   * `unreachable` and never merged with them: a work nobody has found a cover
   * for is the free-ladder's business (`backfill-missing-covers.mjs`), while a
   * broken one is a URL that used to work. Same-looking hole on a shelf page,
   * two different fixes.
   */
  missingCover: number;
}

/**
 * Everything the cover audit reads, in two statements.
 *
 * ⚠️ **The whole row set, not a `LIMIT`.** A D1 read is not a subrequest and
 * four hundred rows is nothing; the per-tick cap belongs on the FETCHES, and it
 * is applied in memory by `auditWindow` so the window can WRAP. A `LIMIT` here
 * would audit the first N covers every night and never once look at the rest —
 * while reporting itself clean.
 */
export async function readCoverHealthInputs(db: D1Database): Promise<CoverHealthInputs> {
  const [covers, totals] = await Promise.all([
    db
      .prepare(
        "SELECT id, title, cover_url FROM work" +
          " WHERE cover_url IS NOT NULL AND cover_url <> '' ORDER BY id",
      )
      .all<{ id: number; title: string; cover_url: string }>(),
    db
      .prepare(
        "SELECT COUNT(*) AS total," +
          " SUM(CASE WHEN cover_url IS NULL OR cover_url = '' THEN 1 ELSE 0 END) AS missing" +
          ' FROM work',
      )
      .first<{ total: number; missing: number }>(),
  ]);

  return {
    rows: (covers.results ?? []).map((r) => ({
      id: Number(r.id),
      title: r.title,
      coverUrl: r.cover_url,
    })),
    totalWorks: Number(totals?.total ?? 0),
    missingCover: Number(totals?.missing ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Series-aggregate inputs
// ---------------------------------------------------------------------------

export interface SeriesAggregateInputs {
  /** The curated spellings. ⚠️ Folded by `@lc/core`, never in SQL. */
  seriesNames: string[];
  works: SeriesAggregateWork[];
  /** The empty-read guard's number — zero works is a refused run, not a clean one. */
  totalWorks: number;
}

/**
 * Every work carrying two or more editions, with its copy count, plus the series
 * names to test their titles against.
 *
 * ⚠️ `COUNT(DISTINCT …)` on both, because the join multiplies: a work with two
 * editions and three copies produces six rows, and a plain `COUNT(e.id)` would
 * report six editions. The script's SQL is reproduced here character for
 * character apart from formatting — it is the one place the two callers could
 * still drift, since SQL cannot live in `@lc/core`.
 *
 * ⚠️ `listKnownSeriesNames` is imported rather than restated: the three-way
 * UNION (`work` ∪ `series_volume` ∪ `series_check`) is named by the bare-series
 * rule and already had a home.
 */
export async function readSeriesAggregateInputs(
  db: D1Database,
): Promise<SeriesAggregateInputs> {
  const [seriesNames, works, totals] = await Promise.all([
    listKnownSeriesNames(db),
    db
      .prepare(
        'SELECT w.id AS id, w.title AS title, w.authors AS authors,' +
          ' COUNT(DISTINCT e.id) AS editions, COUNT(DISTINCT c.id) AS copies' +
          ' FROM work w JOIN edition e ON e.work_id = w.id' +
          ' LEFT JOIN copy c ON c.work_id = w.id' +
          ' GROUP BY w.id HAVING COUNT(DISTINCT e.id) >= 2' +
          ' ORDER BY editions DESC, w.id',
      )
      .all<{ id: number; title: string; authors: string; editions: number; copies: number }>(),
    db.prepare('SELECT COUNT(*) AS total FROM work').first<{ total: number }>(),
  ]);

  return {
    seriesNames,
    works: (works.results ?? []).map((r) => ({
      id: Number(r.id),
      title: r.title,
      authors: r.authors,
      editions: Number(r.editions),
      copies: Number(r.copies),
    })),
    totalWorks: Number(totals?.total ?? 0),
  };
}
