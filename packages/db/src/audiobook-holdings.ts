/**
 * The audiobook sweep's D1 half — the plan, bound.
 *
 * Step 7 of `catalog-platform/docs/info/audiobook-association-route.md` §9.
 * `planAudiobookSweep` (`packages/core/src/audiobook-sweep.ts`) decides and
 * returns ROWS; this file is what turns those rows into writes, and the reads
 * that feed them.
 *
 * ## 🔴 ONE rendering, not two — and this is the file that owns it
 *
 * §2.3 says the planner returns data because the script interpolates SQL and a
 * Worker binds prepared statements. Phase 0 read that as *two renderers over
 * one plan* and built `scripts/lib/audiobook-sql.mjs` accordingly, with its own
 * header saying so. **That is one canonical implementation too few.** Two
 * renderers is exactly the shape `matching.ts` opens by warning about: a second
 * copy of a decision, correct on the day it was written, drifting afterwards —
 * and here the decision is *which columns a sweep writes and in what order*,
 * where a drift means the cron and the recovery script quietly disagree about
 * what the catalog says.
 *
 * So there is now ONE statement list, `audiobookSweepStatements`, and both
 * callers consume it:
 *
 * | Caller | What it does with a `SweepStatement` |
 * |---|---|
 * | this file (`applyAudiobookSweepPlan`) | `db.prepare(sql).bind(...binds)` |
 * | `scripts/lib/audiobook-sql.mjs` | substitutes `lit(bind)` for each `?` and appends `;` |
 *
 * ⚠️ **The script's rendered bytes are unchanged, and that is load-bearing**,
 * because `scripts/test/backfill-audiobook-holdings.test.mjs` pins them as whole
 * strings and the phase-0 gate was a byte-identical dry run. The SQL below is
 * therefore written as the single-line text the old concatenations produced,
 * with `?` where a `${lit(...)}` used to be — verbatim, spaces included. Do not
 * reformat it for looks; reformat it and the script's output changes.
 *
 * ⚠️ **The statement ORDER is part of the contract**: edition upserts, edition
 * stales, rung upserts, rung stales. A stale UPDATE running before its INSERT
 * would immediately un-stale the row it had just marked.
 *
 * ## Idempotency, and marked-never-deleted
 *
 * Every INSERT carries `ON CONFLICT … DO UPDATE … last_seen_at =
 * datetime('now'), stale_at = NULL`, so a second run inside one minute produces
 * the same rows (§6.1). Nothing here deletes: migration 0010's rule is that a
 * row vanishing looks identical to the audiobook having gone away, so a row
 * that stopped matching is MARKED.
 */

import type {
  AudiobookMatchedVia,
  ExistingRung,
  SweepAlias,
  SweepPlan,
  SweepWork,
} from '@lc/core';
import { ROW_FIELD, changeLogInsert } from './changes.js';

/**
 * One statement, as data — the shape both callers bind or render.
 *
 * ⚠️ `sql` carries NO trailing semicolon. D1's `prepare` takes one statement and
 * the terminator is the script's file-based `execute()` idiom, not the
 * statement's own text; the renderer appends it.
 */
export interface SweepStatement {
  sql: string;
  binds: (string | number | null)[];
}

/**
 * An `audiobook_edition_holding` row as this module reads it back.
 *
 * ⚠️ A superset of `@lc/core`'s `ExistingEdition` (which carries only the key
 * and `stale_at`, because the planner needs nothing else) — `matchedVia` is
 * here for the change_log transition rows, which record what the association
 * was as well as that there was one.
 */
export interface ExistingEditionRow {
  workId: number;
  audioKey: string;
  matchedVia: AudiobookMatchedVia | null;
  staleAt: string | null;
}

/** Who asked for a sweep. The `audiobook_sweep_run.trigger` vocabulary. */
export type AudiobookSweepTrigger = 'cron' | 'on-add' | 'admin';

/**
 * ⚠️ **Which trigger fired is the fact worth keeping** (§6.3). It is the only
 * way to tell later whether the on-add hook is working or the cron is quietly
 * carrying the whole feature — two very different states that look identical
 * from the holding table alone.
 */
const TRIGGER_NOTE: Readonly<Record<AudiobookSweepTrigger, string>> = {
  cron: 'audiobook sweep (cron)',
  'on-add': 'audiobook sweep (on add)',
  admin: 'audiobook sweep (admin)',
};

// ---------------------------------------------------------------------------
// The statements — the one rendering
// ---------------------------------------------------------------------------

/**
 * ⚠️ `raw_title` binds `e.rawTitle`, NOT `e.title` — migration 0340. `title` is
 * stripped by `cleanTitleWithSeries` and is what a person is shown; `raw_title`
 * is the sibling catalog's verbatim string and is the one the content-warning
 * key is derived from, because that is what the audiobook site and
 * `content_warnings.json` are both keyed by. Migration 0390 reuses that same
 * string as `audio_key`, so the edition identity here and the warning identity
 * there cannot drift apart.
 */
const EDITION_UPSERT_SQL =
  'INSERT INTO audiobook_edition_holding (work_id, audio_key, title, raw_title, authors,' +
  ' series, index_display, index_sort, cover_href, narrator, matched_via,' +
  ' title_similarity, via_alias)' +
  ' VALUES (?, ?, ?, ?,' +
  ' ?, ?, ?,' +
  ' ?, ?, ?,' +
  ' ?, ?, ?)' +
  ' ON CONFLICT(work_id, audio_key) DO UPDATE SET' +
  ' title = excluded.title, raw_title = excluded.raw_title,' +
  ' authors = excluded.authors, series = excluded.series,' +
  ' index_display = excluded.index_display, index_sort = excluded.index_sort,' +
  ' cover_href = excluded.cover_href, narrator = excluded.narrator,' +
  ' matched_via = excluded.matched_via,' +
  ' title_similarity = excluded.title_similarity, via_alias = excluded.via_alias,' +
  " last_seen_at = datetime('now'), stale_at = NULL";

const EDITION_STALE_SQL =
  "UPDATE audiobook_edition_holding SET stale_at = datetime('now')" +
  ' WHERE work_id = ? AND audio_key = ?' +
  ' AND stale_at IS NULL';

const RUNG_UPSERT_SQL =
  'INSERT INTO audiobook_series_holding (series, index_sort, title, authors,' +
  ' audiobook_series, index_display, cover_href, series_matched_via)' +
  ' VALUES (?, ?, ?, ?,' +
  ' ?, ?, ?, ?)' +
  ' ON CONFLICT(series, index_sort) DO UPDATE SET' +
  ' title = excluded.title, authors = excluded.authors,' +
  ' audiobook_series = excluded.audiobook_series,' +
  ' index_display = excluded.index_display, cover_href = excluded.cover_href,' +
  ' series_matched_via = excluded.series_matched_via,' +
  " last_seen_at = datetime('now'), stale_at = NULL";

const RUNG_STALE_SQL =
  "UPDATE audiobook_series_holding SET stale_at = datetime('now')" +
  ' WHERE series = ? AND index_sort = ?' +
  ' AND stale_at IS NULL';

/**
 * Every statement for one plan, in the order the sweep has always run them.
 *
 * Pure: no database, no clock, no I/O. That is what lets
 * `packages/db/test/audiobook-holdings.test.ts` pin the exact SQL and lets the
 * script render the identical text without a D1 binding in sight.
 */
export function audiobookSweepStatements(plan: SweepPlan): SweepStatement[] {
  const statements: SweepStatement[] = [];

  for (const e of plan.editionUpserts) {
    statements.push({
      sql: EDITION_UPSERT_SQL,
      binds: [
        e.workId,
        e.audioKey,
        e.title,
        e.rawTitle,
        e.authors,
        e.series,
        e.indexDisplay,
        e.indexSort,
        e.coverHref,
        e.narrator,
        e.matchedVia,
        e.titleSimilarity,
        e.viaAlias,
      ],
    });
  }

  // An EDITION that no longer matches. Marked, never deleted — migration 0010's
  // rule, applied one row finer: a work can keep one recording and lose another
  // (the other catalog re-titled it, or it was returned), and only the row that
  // went away may be marked.
  for (const s of plan.editionStales) {
    statements.push({ sql: EDITION_STALE_SQL, binds: [s.workId, s.audioKey] });
  }

  for (const r of plan.rungUpserts) {
    statements.push({
      sql: RUNG_UPSERT_SQL,
      binds: [
        r.series,
        r.indexSort,
        r.title,
        r.authors,
        r.audiobookSeries,
        r.indexDisplay,
        r.coverHref,
        r.seriesMatchedVia,
      ],
    });
  }

  // Marked, never deleted — the other catalog renaming a series must not look
  // like the audiobook having been returned.
  for (const s of plan.rungStales) {
    statements.push({ sql: RUNG_STALE_SQL, binds: [s.series, s.indexSort] });
  }

  return statements;
}

// ---------------------------------------------------------------------------
// Transitions — the audit rows, and the ones this deliberately does NOT write
// ---------------------------------------------------------------------------

/** One work's audio association, as the audit log records it. */
export interface AssociationState {
  editions: { audioKey: string; matchedVia: AudiobookMatchedVia | null }[];
}

/** A work whose association is not what it was. */
export interface AssociationTransition {
  workId: number;
  /** Null when the work had no live audio edition before this run. */
  before: AssociationState | null;
  /** Null when it has none after. */
  after: AssociationState | null;
}

function sortEditions(list: AssociationState['editions']): AssociationState['editions'] {
  return [...list].sort((a, b) => (a.audioKey < b.audioKey ? -1 : a.audioKey > b.audioKey ? 1 : 0));
}

/**
 * Which works changed association, and to what.
 *
 * 🔴 **Transitions only — never one audit row per upsert.** The sweep touches
 * every live row every run; at six ticks a day that is thousands of rows a day
 * in a table a person is meant to READ (§6.3). In steady state nothing here
 * changes and nothing is written, which is the property that makes the audit
 * trail worth opening.
 *
 * ⚠️ A transition is a change to the SET of `(audio_key, matched_via)` pairs,
 * not merely gaining or losing audio altogether. The design names the two
 * obvious cases — `null → {…}` on gain, `{…} → null` on loss — and both are
 * covered; a work that swapped one recording for another, or whose match
 * weakened from `exact` to `containment`, is also a change a person would want
 * to see, and it is exactly as rare. What is NOT logged is a run that
 * reproduced what was already there.
 *
 * @param existing every `audiobook_edition_holding` row the run was planned
 *   against, live and stale. ⚠️ Under a scoped run this must be the rows for the
 *   scoped works — passing an empty list would report every one of them as a
 *   fresh gain, every time the book was touched.
 */
export function audiobookSweepTransitions(
  plan: SweepPlan,
  existing: readonly ExistingEditionRow[],
): AssociationTransition[] {
  const before = new Map<number, AssociationState['editions']>();
  for (const row of existing) {
    // Only LIVE rows count as an association. A stale row is the record of one
    // that ended, and counting it would make un-staling look like no change.
    if (row.staleAt) continue;
    const list = before.get(Number(row.workId));
    const entry = { audioKey: row.audioKey, matchedVia: row.matchedVia };
    if (list) list.push(entry);
    else before.set(Number(row.workId), [entry]);
  }

  // Which works this run actually looked at. A work the run never considered
  // keeps whatever it had, and has no transition to report.
  const touched = new Set<number>();
  for (const e of plan.editionUpserts) touched.add(Number(e.workId));
  for (const s of plan.editionStales) touched.add(Number(s.workId));

  const staled = new Set<string>();
  for (const s of plan.editionStales) staled.add(`${Number(s.workId)} ${s.audioKey}`);

  const after = new Map<number, AssociationState['editions']>();
  for (const workId of touched) {
    const kept = (before.get(workId) ?? []).filter(
      (e) => !staled.has(`${workId} ${e.audioKey}`),
    );
    const byKey = new Map(kept.map((e) => [e.audioKey, e]));
    for (const e of plan.editionUpserts) {
      if (Number(e.workId) !== workId) continue;
      // An upsert REPLACES what that key said, `matched_via` included — the
      // statement above sets `matched_via = excluded.matched_via`.
      byKey.set(e.audioKey, { audioKey: e.audioKey, matchedVia: e.matchedVia });
    }
    after.set(workId, [...byKey.values()]);
  }

  const out: AssociationTransition[] = [];
  for (const workId of [...touched].sort((a, b) => a - b)) {
    const was = sortEditions(before.get(workId) ?? []);
    const now = sortEditions(after.get(workId) ?? []);
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    out.push({
      workId,
      before: was.length > 0 ? { editions: was } : null,
      after: now.length > 0 ? { editions: now } : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

export interface AudiobookSweepApplyMeta {
  trigger: AudiobookSweepTrigger;
  /** See `audiobookSweepTransitions` — the rows the plan was made against. */
  existingEditions: readonly ExistingEditionRow[];
  /**
   * One id per sweep run, so a run's audit rows are one group — exactly as
   * `createWork` groups its own. Generated when absent.
   */
  batchId?: string;
}

export interface AudiobookSweepApplyResult {
  batchId: string;
  /** Holding-table statements written. */
  statements: number;
  /** `change_log` rows written — one per work that changed association. */
  transitions: number;
}

/**
 * Write one plan. Everything in ONE batch.
 *
 * ⚠️ **The audit rows land in the SAME `db.batch()` as the mutation they
 * describe** — `changes.ts`'s rule, which `works.ts` already follows. Two
 * separate awaits would be the "flag written in a second request" bug wearing
 * an audit costume: a sweep that wrote holdings and then failed would leave a
 * catalog nobody could explain.
 *
 * ⚠️ Reuses `changeLogInsert` rather than building the INSERT here. It is the
 * one implementation, it already settles the `note` semantics (`undefined`
 * inherits from the actor, an explicit `null` suppresses), and a second copy is
 * how two writers start disagreeing about what an audit row looks like.
 */
export async function applyAudiobookSweepPlan(
  db: D1Database,
  plan: SweepPlan,
  meta: AudiobookSweepApplyMeta,
): Promise<AudiobookSweepApplyResult> {
  const batchId = meta.batchId ?? crypto.randomUUID();
  const transitions = audiobookSweepTransitions(plan, meta.existingEditions);

  const statements = audiobookSweepStatements(plan).map((s) => db.prepare(s.sql).bind(...s.binds));

  for (const t of transitions) {
    statements.push(
      changeLogInsert(db, {
        batchId,
        entity: 'audiobook_holding',
        entityId: t.workId,
        // The whole-row sentinel `createWork` uses. An association is not a
        // column on `work`, so there is no field name that would be true.
        field: ROW_FIELD,
        oldJson: JSON.stringify(t.before),
        newJson: JSON.stringify(t.after),
        // ⚠️ `changed_by` NULL and `changed_how` 'auto': nobody read these
        // values, whichever trigger fired. The person who added the book did
        // not choose the audiobook, and the cron has no person at all.
        actor: { userId: null, how: 'auto' },
        note: TRIGGER_NOTE[meta.trigger],
      }),
    );
  }

  if (statements.length > 0) await db.batch(statements);

  return {
    batchId,
    statements: plan.editionUpserts.length + plan.editionStales.length +
      plan.rungUpserts.length + plan.rungStales.length,
    transitions: transitions.length,
  };
}

// ---------------------------------------------------------------------------
// The reads the planner needs
// ---------------------------------------------------------------------------

export interface AudiobookSweepInputRows {
  works: SweepWork[];
  aliasRows: SweepAlias[];
  existingEditions: ExistingEditionRow[];
  existingRungs: ExistingRung[];
}

/**
 * Everything the planner reads out of D1, in the shape it wants it.
 *
 * ⚠️ **The TABLE, never the view.** Since migration 0390 `audiobook_holding` is
 * a read-only VIEW showing one whole row per work; the rows live in
 * `audiobook_edition_holding`, keyed `(work_id, audio_key)`. Reading the view
 * would hide every second edition from the stale sweep, which could then never
 * mark one.
 *
 * ⚠️ **A scoped run reads the existing editions FOR ITS WORKS ONLY, and reads no
 * rungs at all.** It has no stale phase (§6.2 guard 3), so the only thing it
 * needs the existing rows for is the transition diff — and pulling the whole
 * holding table on every book somebody adds would make the add pay for the
 * cron's work. The visible cost is that `report.rungs[].fresh` counts every rung
 * as fresh under a scoped run; it is a report field, no row depends on it, and
 * the alternative was a full-table read per add.
 *
 * `works` is read WHOLE even under a scope, because `report.workCount` is the
 * catalogue's size — "of N works, M matched" — and a scoped read would make the
 * on-add hook report a catalogue of one.
 */
export async function readAudiobookSweepInputs(
  db: D1Database,
  scope: { kind: 'all' } | { kind: 'works'; ids: readonly number[] },
): Promise<AudiobookSweepInputRows> {
  const ids = scope.kind === 'works' ? [...new Set(scope.ids.map(Number))] : [];

  const worksP = db
    .prepare('SELECT id, title, authors, series, series_index_sort FROM work ORDER BY id')
    .all<{
      id: number;
      title: string;
      authors: string;
      series: string | null;
      series_index_sort: number | null;
    }>();

  const aliasesP = db
    .prepare('SELECT work_id, alias, kind FROM work_alias')
    .all<{ work_id: number; alias: string; kind: string | null }>();

  const editionsP =
    scope.kind === 'all'
      ? db
          .prepare(
            'SELECT work_id, audio_key, matched_via, stale_at FROM audiobook_edition_holding',
          )
          .all<{
            work_id: number;
            audio_key: string;
            matched_via: string | null;
            stale_at: string | null;
          }>()
      : ids.length === 0
        ? Promise.resolve({ results: [] as never[] })
        : db
            .prepare(
              'SELECT work_id, audio_key, matched_via, stale_at FROM audiobook_edition_holding' +
                ` WHERE work_id IN (${ids.map(() => '?').join(', ')})`,
            )
            .bind(...ids)
            .all<{
              work_id: number;
              audio_key: string;
              matched_via: string | null;
              stale_at: string | null;
            }>();

  const rungsP =
    scope.kind === 'all'
      ? db
          .prepare('SELECT series, index_sort, stale_at FROM audiobook_series_holding')
          .all<{ series: string; index_sort: number; stale_at: string | null }>()
      : Promise.resolve({ results: [] as never[] });

  const [works, aliases, editions, rungs] = await Promise.all([
    worksP,
    aliasesP,
    editionsP,
    rungsP,
  ]);

  return {
    works: (works.results ?? []).map((w) => ({
      id: Number(w.id),
      title: w.title,
      authors: w.authors,
      series: w.series,
      seriesIndexSort: w.series_index_sort == null ? null : Number(w.series_index_sort),
    })),
    aliasRows: (aliases.results ?? []).map((a) => ({
      workId: Number(a.work_id),
      alias: a.alias,
      kind: a.kind,
    })),
    existingEditions: (editions.results ?? []).map((r) => ({
      workId: Number(r.work_id),
      audioKey: r.audio_key,
      matchedVia: (r.matched_via as AudiobookMatchedVia | null) ?? null,
      staleAt: r.stale_at,
    })),
    existingRungs: (rungs.results ?? []).map((r) => ({
      series: r.series,
      indexSort: Number(r.index_sort),
      staleAt: r.stale_at,
    })),
  };
}

/** What the holding tables hold right now — the `/api/health` counts. */
export async function audiobookHoldingCounts(
  db: D1Database,
): Promise<{ editionsLive: number; rungsLive: number }> {
  const row = await db
    .prepare(
      'SELECT (SELECT COUNT(*) FROM audiobook_edition_holding WHERE stale_at IS NULL) AS editions,' +
        ' (SELECT COUNT(*) FROM audiobook_series_holding WHERE stale_at IS NULL) AS rungs',
    )
    .first<{ editions: number; rungs: number }>();
  return { editionsLive: Number(row?.editions ?? 0), rungsLive: Number(row?.rungs ?? 0) };
}

// ---------------------------------------------------------------------------
// Snapshot and run bookkeeping (migration 0470)
// ---------------------------------------------------------------------------

export interface AudiobookSnapshot {
  etag: string | null;
  fetchedAt: string;
  rowCount: number;
}

export async function readAudiobookSnapshot(db: D1Database): Promise<AudiobookSnapshot | null> {
  const row = await db
    .prepare('SELECT etag, fetched_at, row_count FROM audiobook_snapshot WHERE id = 1')
    .first<{ etag: string | null; fetched_at: string; row_count: number }>();
  if (!row) return null;
  return { etag: row.etag, fetchedAt: row.fetched_at, rowCount: Number(row.row_count) };
}

/**
 * Record what we just read.
 *
 * ⚠️ Called ONLY after a body actually parsed and passed the guards. A snapshot
 * written from a refused fetch would poison the drift baseline: the next tick
 * would compare against the broken number and find no drift at all, which is
 * precisely the silence guard 2 exists to break.
 */
export async function saveAudiobookSnapshot(
  db: D1Database,
  input: { etag: string | null; rowCount: number },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO audiobook_snapshot (id, etag, fetched_at, row_count, updated_at)" +
        " VALUES (1, ?, datetime('now'), ?, datetime('now'))" +
        ' ON CONFLICT(id) DO UPDATE SET etag = excluded.etag,' +
        " fetched_at = excluded.fetched_at, row_count = excluded.row_count," +
        ' updated_at = excluded.updated_at',
    )
    .bind(input.etag, input.rowCount)
    .run();
}

/**
 * 🔴 **The gate, as a number the status page can answer with.**
 *
 * `AUDIOBOOK_SWEEP_MODE` flips to `enforce` after *"≥42 shadow ticks with ZERO
 * divergences on BOTH halves"* (`docs/access/audiobook-sweep.md` §6). Until
 * 2026-09-06 nothing counted them: `/api/health` read only the LATEST run row,
 * so one `304` hid every plan before it, and the flip was attempted — and
 * refused — on a reading of *"3 rows, 1 with a plan, 0 with `seriesVolumes`"*
 * that had to be dug out of two production databases by hand.
 *
 * ⚠️ **A tick counts only if it PLANNED.** `state = 'shadow'` alone is not
 * enough and neither is a row existing: the question the gate asks is *"did the
 * planner run and produce something to compare?"*, so both counters test for the
 * recorded object rather than for the verdict word.
 *
 * ⚠️ **The two counts are separate on purpose.** One switch enforces both
 * halves, so evidence for the holdings half is NOT evidence for the
 * series-volume half — a scoped on-add run plans the first and deliberately
 * declines the second (guard 3), and every row written before 2026-09-05 has no
 * `seriesVolumes` key at all.
 */
export interface AudiobookSweepGateCounts {
  /** Shadow ticks whose row carries a holdings `plan` object. */
  planTicks: number;
  /** Of those, the ones that also carry `seriesVolumes.planned`. */
  seriesVolumeTicks: number;
  /**
   * The subset produced by the four-hourly cron — the clock the gate's "42" was
   * written about. ⚠️ Reported beside `planTicks` because an admin `force` dry
   * run also lands a plan-bearing shadow row, and forty of those in an afternoon
   * would be forty readings of one CSV rather than a week of evidence.
   */
  cronPlanTicks: number;
}

/**
 * Count them. One aggregate, three numbers, no rows returned.
 *
 * ⚠️ `json_extract` over `detail_json`, which is always either NULL or something
 * `JSON.stringify` produced (`finishAudiobookSweepRun`), so there is no
 * malformed-JSON path for SQLite to throw on. A row still `running` has NULL
 * there and is counted by neither.
 */
export async function audiobookSweepGateCounts(
  db: D1Database,
): Promise<AudiobookSweepGateCounts> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS plan_ticks," +
        " SUM(CASE WHEN json_extract(detail_json, '$.seriesVolumes.planned') IS NOT NULL" +
        ' THEN 1 ELSE 0 END) AS sv_ticks,' +
        // ⚠️ `trigger` is a SQLite keyword; quoted so the parser cannot decide
        // this is the start of a CREATE TRIGGER on some future version.
        " SUM(CASE WHEN \"trigger\" = 'cron' THEN 1 ELSE 0 END) AS cron_ticks" +
        ' FROM audiobook_sweep_run' +
        " WHERE state = 'shadow' AND json_extract(detail_json, '$.plan') IS NOT NULL",
    )
    .first<{ plan_ticks: number; sv_ticks: number | null; cron_ticks: number | null }>();
  return {
    planTicks: Number(row?.plan_ticks ?? 0),
    seriesVolumeTicks: Number(row?.sv_ticks ?? 0),
    cronPlanTicks: Number(row?.cron_ticks ?? 0),
  };
}

export interface AudiobookSweepRunRow {
  id: number;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  state: string;
  detail: unknown;
}

/** Open a run row. The id is how the finishing write finds it again. */
export async function startAudiobookSweepRun(
  db: D1Database,
  trigger: AudiobookSweepTrigger,
): Promise<number> {
  const row = await db
    .prepare(
      "INSERT INTO audiobook_sweep_run (trigger, started_at, state)" +
        " VALUES (?, datetime('now'), 'running') RETURNING id",
    )
    .bind(trigger)
    .first<{ id: number }>();
  return Number(row?.id ?? 0);
}

/**
 * Close a run row.
 *
 * ⚠️ `state` and `finished_at` move together, in ONE statement. A finished
 * timestamp with a `running` state, or the reverse, is the pairing bug
 * migration 0040 records: two writes mean a window in which the row says
 * something that was never true.
 */
export async function finishAudiobookSweepRun(
  db: D1Database,
  id: number,
  input: { state: string; detail: unknown },
): Promise<void> {
  await db
    .prepare(
      "UPDATE audiobook_sweep_run SET state = ?, finished_at = datetime('now'), detail_json = ?" +
        ' WHERE id = ?',
    )
    .bind(input.state, JSON.stringify(input.detail ?? null), id)
    .run();
}

/**
 * The most recently STARTED run — what `/api/health` reports.
 *
 * ⚠️ Ordered by `id`, not by `started_at`. Two ticks inside one second is not a
 * real cadence but an admin dry run beside a cron tick is, and `datetime('now')`
 * has one-second resolution; the autoincrement id is the only strict order this
 * table has.
 */
export async function latestAudiobookSweepRun(
  db: D1Database,
): Promise<AudiobookSweepRunRow | null> {
  const row = await db
    .prepare(
      'SELECT id, trigger, started_at, finished_at, state, detail_json' +
        ' FROM audiobook_sweep_run ORDER BY id DESC LIMIT 1',
    )
    .first<{
      id: number;
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
    // dropped — the same rule `listChangesForEntity` follows.
    detail = row.detail_json;
  }
  return {
    id: Number(row.id),
    trigger: row.trigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    state: row.state,
    detail,
  };
}
