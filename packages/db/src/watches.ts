import { UNKNOWN_AUTHOR, type DecisionMode } from '@lc/core';

/**
 * Watches: "needs my eyes, and here is why."
 *
 * Migration 0040. The owner's words, about two books recording contradictory
 * series: *"I'll check — put a watch on this issue so I verify later."*
 *
 * ⚠️ **A watch is an annotation, not a verdict.** Nothing here touches a catalog
 * column, and nothing here decides anything: it records that a person is not
 * satisfied with a row and what about it. That is deliberately different from
 * `gap_verdict`, which *closes* a question so it is never asked again — a watch
 * opens one. The two would be easy to confuse and behave oppositely.
 *
 * ## Resolved, not deleted
 *
 * Migration 0003's rule applied to a question instead of a claim: "somebody
 * looked at this and it was fine" is a real answer, and a deleted row is
 * indistinguishable from a question never asked. Every read below therefore has
 * to say whether it wants the open ones — and all but one of them do.
 */

export interface Watch {
  id: number;
  workId: number;
  note: string;
  /** 'human' — a person raised it. 'auto' — a run raised it about its own guess. */
  raisedHow: DecisionMode;
  raisedBy: number | null;
  /** The display name of whoever raised it, when the user row still exists. */
  raisedByName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: number | null;
}

interface WatchRow {
  id: number;
  work_id: number;
  note: string;
  raised_how: string;
  raised_by: number | null;
  raised_by_name: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: number | null;
}

// LEFT JOIN, not JOIN: `raised_by` is `ON DELETE SET NULL`, and a watch whose
// author's account was removed is still a watch. An inner join would make it
// disappear from the list instead.
const SELECT = `
  SELECT ww.id, ww.work_id, ww.note, ww.raised_how, ww.raised_by,
         au.display_name AS raised_by_name,
         ww.created_at, ww.resolved_at, ww.resolved_by
    FROM work_watch ww
    LEFT JOIN app_user au ON au.id = ww.raised_by`;

function toWatch(row: WatchRow): Watch {
  return {
    id: row.id,
    workId: row.work_id,
    note: row.note,
    raisedHow: row.raised_how as DecisionMode,
    raisedBy: row.raised_by,
    raisedByName: row.raised_by_name,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

/**
 * Every watch on one book, open ones first.
 *
 * Resolved ones are returned too rather than filtered away, because the book
 * page is the one place the history is worth having: "we checked this in August
 * and it was fine" is the answer to the question somebody is about to ask again.
 * The collection's mark uses `openWatches` on the row instead, which counts only
 * the open ones.
 */
export async function listWatchesForWork(db: D1Database, workId: number): Promise<Watch[]> {
  const { results } = await db
    .prepare(
      `${SELECT}
        WHERE ww.work_id = ?
        ORDER BY ww.resolved_at IS NOT NULL, ww.created_at DESC`,
    )
    .bind(workId)
    .all<WatchRow>();
  return results.map(toWatch);
}

/**
 * Every open watch in the catalog, with the book it is on.
 *
 * The "work through the list" read. It carries the title rather than making the
 * caller fetch 20 works, and it is capped: a watch list long enough to need
 * paging would mean the feature had failed at its job.
 */
export interface OpenWatch extends Watch {
  title: string;
  /** Null for a book added without an author — the sentinel never leaves SQL. */
  authors: string | null;
  coverUrl: string | null;
}

export async function listOpenWatches(db: D1Database, limit = 200): Promise<OpenWatch[]> {
  const { results } = await db
    .prepare(
      // NULLIF folds the '?unknown' sentinel (migration 0120) back to the
      // honest null at the SQL boundary — the same mapping toWork does, for a
      // query that does not go through it. The sentinel must never render as
      // an author's name.
      `SELECT ww.id, ww.work_id, ww.note, ww.raised_how, ww.raised_by,
              au.display_name AS raised_by_name,
              ww.created_at, ww.resolved_at, ww.resolved_by,
              w.title, NULLIF(w.authors, '${UNKNOWN_AUTHOR}') AS authors, w.cover_url
         FROM work_watch ww
         JOIN work w ON w.id = ww.work_id
         LEFT JOIN app_user au ON au.id = ww.raised_by
        WHERE ww.resolved_at IS NULL
        ORDER BY ww.created_at DESC
        LIMIT ?`,
    )
    .bind(limit)
    .all<WatchRow & { title: string; authors: string; cover_url: string | null }>();
  return results.map((r) => ({
    ...toWatch(r),
    title: r.title,
    authors: r.authors,
    coverUrl: r.cover_url,
  }));
}

/**
 * Raise one.
 *
 * ⚠️ Deliberately **not** deduplicated against an existing open watch. Two
 * people, or one person on two days, noticing two different things about one
 * book is the case this table is for, and collapsing them would silently throw
 * the second note away. `createWorkAlias`'s `UNIQUE (work_id, alias)` is the
 * opposite call for the opposite reason: an alias is a fact and repeats are
 * noise, while a note is an observation and repeats are two observations.
 */
export async function createWatch(
  db: D1Database,
  input: { workId: number; note: string; raisedBy: number | null; raisedHow?: DecisionMode },
): Promise<Watch | null> {
  const row = await db
    .prepare(
      `INSERT INTO work_watch (work_id, note, raised_how, raised_by)
       VALUES (?, ?, ?, ?)
       RETURNING id, work_id, note, raised_how, raised_by,
                 NULL AS raised_by_name, created_at, resolved_at, resolved_by`,
    )
    .bind(input.workId, input.note, input.raisedHow ?? 'human', input.raisedBy)
    .first<WatchRow>();
  return row ? toWatch(row) : null;
}

/**
 * "I have looked at this."
 *
 * ⚠️ `WHERE resolved_at IS NULL` so a second press cannot re-date an answer
 * somebody already gave — the same guard `arrivedPatch` uses to avoid
 * overwriting a known `acquired_on`, and for the same reason: the first answer
 * is the true one.
 */
export async function resolveWatch(
  db: D1Database,
  id: number,
  userId: number | null,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE work_watch
          SET resolved_at = datetime('now'), resolved_by = ?
        WHERE id = ? AND resolved_at IS NULL`,
    )
    .bind(userId, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Raised by mistake. Distinct from resolving it, which asserts somebody looked. */
export async function deleteWatch(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM work_watch WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}
