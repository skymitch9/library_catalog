import type { SetReadState } from '@lc/core';

/**
 * Per-person reading state, and the cached mirror of a Firestore rating.
 *
 * ⚠️ **`setReadState` cannot write a rating and `cacheRating` cannot write
 * read-state.** They are separate functions over the same row on purpose: one
 * writes what this database owns, the other copies in something it does not.
 * Merging them is how a D1 rating quietly becomes authoritative and stops
 * matching what the audiobook site shows.
 */

export interface UserBookRow {
  id: number;
  work_id: number;
  user_id: number;
  read_state: string;
  started_on: string | null;
  finished_on: string | null;
  read_format: string | null;
  notes: string | null;
  rating_cached: number | null;
  rating_synced_at: string | null;
}

const COLS = `id, work_id, user_id, read_state, started_on, finished_on, read_format,
              notes, rating_cached, rating_synced_at`;

export async function getReadState(
  db: D1Database,
  workId: number,
  userId: number,
): Promise<UserBookRow | null> {
  return db
    .prepare(`SELECT ${COLS} FROM user_book WHERE work_id = ? AND user_id = ?`)
    .bind(workId, userId)
    .first<UserBookRow>();
}

export async function setReadState(
  db: D1Database,
  workId: number,
  userId: number,
  input: SetReadState,
): Promise<UserBookRow> {
  const row = await db
    .prepare(
      `INSERT INTO user_book (work_id, user_id, read_state, started_on, finished_on, read_format, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (work_id, user_id) DO UPDATE SET
         read_state  = excluded.read_state,
         started_on  = excluded.started_on,
         finished_on = excluded.finished_on,
         read_format = excluded.read_format,
         notes       = excluded.notes,
         updated_at  = datetime('now')
       RETURNING ${COLS}`,
    )
    .bind(
      workId,
      userId,
      input.readState,
      input.startedOn ?? null,
      input.finishedOn ?? null,
      input.readFormat ?? null,
      input.notes ?? null,
    )
    .first<UserBookRow>();
  if (!row) throw new Error('upsert returned no row');
  return row;
}

/**
 * Copy a Firestore rating in, for sorting and filtering only.
 *
 * Firestore is authoritative. Nothing may read this value and write it back, and
 * nothing may present it as "your rating" when `rating_synced_at` is stale
 * enough to matter — it exists so the collection page can sort 800 rows by
 * rating without 800 network calls, and for no other reason.
 */
export async function cacheRating(
  db: D1Database,
  workId: number,
  userId: number,
  rating: number | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_book (work_id, user_id, rating_cached, rating_synced_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (work_id, user_id) DO UPDATE SET
         rating_cached    = excluded.rating_cached,
         rating_synced_at = excluded.rating_synced_at,
         updated_at       = datetime('now')`,
    )
    .bind(workId, userId, rating)
    .run();
}
