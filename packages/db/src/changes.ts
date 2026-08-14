/**
 * The audit log — `change_log`, migration 0120.
 *
 * One row per changed field, grouped into events by `batch_id`. Append-only:
 * this module exposes INSERT builders and reads, and deliberately no update or
 * delete — an audit log something can edit is not an audit log.
 *
 * ⚠️ **Audit rows are written in the same `db.batch()` as the mutation they
 * describe** — `works.ts` builds the statements with `changeLogInsert` and
 * batches them beside its own INSERT/UPDATE/DELETE, so a change and its record
 * land atomically or not at all. Two separate awaits would be the "flag written
 * in a second request" bug (review checklist item 3) wearing an audit costume.
 *
 * Design: docs/info/edit-and-audit-design.md §4. The DDL is shared with the
 * audiobook catalog (shape and semantics, never the table itself — PLATFORM.md
 * §2.2).
 */

import type { DecisionMode } from '@lc/core';

/**
 * Who is making a change, and how.
 *
 * `how: 'auto'` is any writer that did not read the value it wrote — the
 * details queue, an importer, a scan job. `userId` stays meaningful under
 * 'auto' (it is whoever triggered the run, same as `research_finding`'s
 * `reviewed_by` under auto-apply). Absent actor defaults to
 * `{ userId: null, how: 'auto' }` so importers that predate this feature are
 * logged rather than skipped — the estate's precedent is to record and
 * distinguish, never to omit.
 */
export interface Actor {
  userId: number | null;
  how: DecisionMode;
  /** The one fact worth keeping beside the diff — 'reviews restamped: 3', 'ebook ingest'. */
  note?: string | null;
}

/** The field name a whole-row creation or deletion is logged under. */
export const ROW_FIELD = '__row__';

export interface ChangeLogEntry {
  batchId: string;
  /**
   * 'app_user' joined 2026-08-13 (role changes — users.ts setUserRole). The
   * 0120 DDL anticipated growth ("user_book? watches?") and carries no CHECK,
   * so widening this union is the entire migration.
   */
  entity: 'work' | 'edition' | 'copy' | 'app_user';
  /**
   * The row's id — or the literal string 'last_insert_rowid()' when the entry
   * is batched immediately after the INSERT that creates the row and the id
   * does not exist yet. That expression is evaluated by SQLite *after* the
   * preceding statement in the same batch (D1 runs a batch sequentially on one
   * session), which is the only way a creation and its audit row can land in
   * one atomic batch.
   */
  entityId: number | 'last_insert_rowid()';
  field: string;
  /** Already JSON-encoded ('null' for a column that was NULL). Never SQL NULL. */
  oldJson: string;
  newJson: string;
  actor?: Actor | undefined;
  note?: string | null | undefined;
}

/**
 * Build one append-only audit INSERT, for batching beside the mutation.
 *
 * `old_json`/`new_json` are NOT NULL by schema; callers pass JSON text
 * (`JSON.stringify(value)` — which yields the string `'null'` for null, never
 * SQL NULL). The entity id is either a bind (known id) or the
 * `last_insert_rowid()` expression (creation) — never caller text.
 */
export function changeLogInsert(db: D1Database, entry: ChangeLogEntry): D1PreparedStatement {
  const idExpr = entry.entityId === 'last_insert_rowid()' ? 'last_insert_rowid()' : '?';
  const stmt = db.prepare(
    `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json,
                             changed_by, changed_how, note)
     VALUES (?, ?, ${idExpr}, ?, ?, ?, ?, ?, ?)`,
  );
  const binds: unknown[] = [entry.batchId, entry.entity];
  if (idExpr === '?') binds.push(entry.entityId);
  binds.push(
    entry.field,
    entry.oldJson,
    entry.newJson,
    entry.actor?.userId ?? null,
    entry.actor?.how ?? 'auto',
    // `undefined` note falls back to the actor's; an EXPLICIT null means "no
    // note on this row" and is honoured — works.ts uses that to keep a general
    // note off ordinary field rows.
    entry.note !== undefined ? entry.note : (entry.actor?.note ?? null),
  );
  return stmt.bind(...binds);
}

/** One audit row, as the Changes panel reads it. */
export interface ChangeRow {
  id: number;
  batchId: string;
  entity: string;
  entityId: number;
  field: string;
  /** Decoded from the stored JSON. `null` means the column was NULL. */
  oldValue: unknown;
  newValue: unknown;
  changedBy: number | null;
  /** The display name of who changed it, when the account still exists. */
  changedByName: string | null;
  changedHow: string;
  note: string | null;
  createdAt: string;
}

/**
 * The history of one row, newest first — the book page's Changes panel.
 *
 * ⚠️ Only ever scoped to one entity. There is deliberately no unscoped "all
 * changes" read yet; when an estate-wide view is wanted it gets its own
 * function with its own paging, against `idx_change_log_time`.
 */
export async function listChangesForEntity(
  db: D1Database,
  entity: string,
  entityId: number,
  limit = 200,
): Promise<ChangeRow[]> {
  const { results } = await db
    .prepare(
      `SELECT cl.id, cl.batch_id, cl.entity, cl.entity_id, cl.field,
              cl.old_json, cl.new_json, cl.changed_by, cl.changed_how, cl.note,
              cl.created_at,
              u.display_name AS changed_by_name
         FROM change_log cl
         LEFT JOIN app_user u ON u.id = cl.changed_by
        WHERE cl.entity = ? AND cl.entity_id = ?
        ORDER BY cl.id DESC
        LIMIT ?`,
    )
    .bind(entity, entityId, limit)
    .all<{
      id: number;
      batch_id: string;
      entity: string;
      entity_id: number;
      field: string;
      old_json: string;
      new_json: string;
      changed_by: number | null;
      changed_how: string;
      note: string | null;
      created_at: string;
      changed_by_name: string | null;
    }>();

  return results.map((r) => ({
    id: r.id,
    batchId: r.batch_id,
    entity: r.entity,
    entityId: r.entity_id,
    field: r.field,
    oldValue: safeJson(r.old_json),
    newValue: safeJson(r.new_json),
    changedBy: r.changed_by,
    changedByName: r.changed_by_name,
    changedHow: r.changed_how,
    note: r.note,
    createdAt: r.created_at,
  }));
}

/** A stored value that fails to parse is shown as its raw text, never dropped. */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * The server-side evidence floor for a key move — every fact D1 holds that
 * says "reviews exist for this book". Design §5.2.
 *
 * The Worker cannot see Firestore, so it can never *prove* a zero; what it can
 * do is refuse a claimed zero that contradicts any of these. The floor forces
 * the careful path; it can never authorise skipping it.
 */
export interface KeyMoveEvidence {
  /** The browser's last observation of this book's review count. NULL = never reported. */
  reviewsSeenCount: number | null;
  reviewsSeenAt: string | null;
  /** `user_book` rows holding a cached rating or a rating-derived read state. */
  ratingRows: number;
  /** Prior key-move audit rows whose note records reviews actually carried. */
  carriedKeyMoves: number;
}

export async function keyMoveEvidence(db: D1Database, workId: number): Promise<KeyMoveEvidence> {
  const [seen, ratings, moves] = await Promise.all([
    db
      .prepare('SELECT reviews_seen_count, reviews_seen_at FROM work WHERE id = ?')
      .bind(workId)
      .first<{ reviews_seen_count: number | null; reviews_seen_at: string | null }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM user_book
          WHERE work_id = ? AND (rating_cached IS NOT NULL OR read_state_how = 'rating')`,
      )
      .bind(workId)
      .first<{ n: number }>(),
    // Only moves that carried a positive number of reviews count as evidence —
    // 'reviews restamped: 0' is a clean move and proves nothing.
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM change_log
          WHERE entity = 'work' AND entity_id = ? AND field = 'work_key'
            AND note LIKE 'reviews restamped: %'
            AND note <> 'reviews restamped: 0'`,
      )
      .bind(workId)
      .first<{ n: number }>(),
  ]);

  return {
    reviewsSeenCount: seen?.reviews_seen_count ?? null,
    reviewsSeenAt: seen?.reviews_seen_at ?? null,
    ratingRows: ratings?.n ?? 0,
    carriedKeyMoves: moves?.n ?? 0,
  };
}

/** True when any leg of the floor says reviews exist. */
export function evidenceSaysReviews(e: KeyMoveEvidence): boolean {
  return (e.reviewsSeenCount ?? 0) > 0 || e.ratingRows > 0 || e.carriedKeyMoves > 0;
}

/**
 * The browser reporting what its review fetch just saw — the write side of the
 * evidence floor.
 *
 * ⚠️ Count and timestamp move together or not at all (0040's pairing rule): a
 * count with no timestamp is unfalsifiable, and a timestamp alone says
 * nothing. One UPDATE, both columns. A read-model of Firestore, like
 * `user_book.rating_cached` — never authoritative, never written back the
 * other way.
 */
export async function recordReviewsSeen(
  db: D1Database,
  workId: number,
  count: number,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE work SET reviews_seen_count = ?, reviews_seen_at = datetime('now') WHERE id = ?`,
    )
    .bind(count, workId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
