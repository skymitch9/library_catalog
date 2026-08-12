import {
  deriveReadState,
  type ObservedRating,
  type ObservedWorkRating,
  type SetReadState,
} from '@lc/core';

/**
 * Per-person reading state, and the cached mirror of a Firestore rating.
 *
 * ⚠️ **`setReadState` cannot write a rating and `cacheRating` cannot write
 * read-state.** They are separate functions over the same row on purpose: one
 * writes what this database owns, the other copies in something it does not.
 * Merging them is how a D1 rating quietly becomes authoritative and stops
 * matching what the audiobook site shows.
 *
 * `applyObservedRating` is the third, and it does not break that rule — read it
 * before assuming it does. It writes read-state *because of* a rating, but it
 * never treats the cached rating as its input: the rating comes in from the
 * caller, having just been read out of Firestore. Nothing here reads
 * `rating_cached` and writes anything back, which is the invariant that matters.
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
  /** 'human' | 'rating' | null. Migration 0070. ⚠️ NULL is "unrecorded". */
  read_state_how: string | null;
}

const COLS = `id, work_id, user_id, read_state, started_on, finished_on, read_format,
              notes, rating_cached, rating_synced_at, read_state_how`;

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

/**
 * A person setting their own read state, from the chips on the book page.
 *
 * ⚠️ **This is the ONLY writer of `read_state_how = 'human'`, and it stamps it
 * unconditionally.** That is the whole protection against a rating sync undoing
 * somebody's correction: the moment a person touches this row, every derivation
 * afterwards refuses it (`deriveReadState`, precedence rule 2). Route this
 * through anything that is not a person pressing a button and the guarantee is
 * gone with no error to say so.
 */
export async function setReadState(
  db: D1Database,
  workId: number,
  userId: number,
  input: SetReadState,
): Promise<UserBookRow> {
  const row = await db
    .prepare(
      `INSERT INTO user_book (work_id, user_id, read_state, started_on, finished_on, read_format, notes, read_state_how)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'human')
       ON CONFLICT (work_id, user_id) DO UPDATE SET
         read_state  = excluded.read_state,
         started_on  = excluded.started_on,
         finished_on = excluded.finished_on,
         read_format = excluded.read_format,
         notes       = excluded.notes,
         read_state_how = 'human',
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

/** One work a rating reached, and what it did there. */
export interface DerivedRead {
  workId: number;
  title: string;
  readState: string;
  readFormat: string | null;
}

/**
 * Mark every work this rating is about as read, for this person, and cache the
 * rating on each.
 *
 * ## ⚠️ "Every work", and why that is the answer to the three-copies question
 *
 * The owner: *"mark all copies of a book read so if i own percy jackson 3 times
 * … mark all 3 read if they appear different at any point."*
 *
 * **Three copies of one work needed no code at all.** `user_book` is
 * `UNIQUE (work_id, user_id)` — read state hangs off the *work*, not the copy —
 * so a work with three `copy` rows has exactly one read state and always did.
 *
 * What needed code is three copies that arrived as three *works*, which is what
 * scanning does when a title is spelled differently on two boxes. The join used
 * here is `work.work_key`, which is deliberately **not unique** (migration 0001
 * indexes it, nothing constrains it) — and it is the same key the shared review
 * documents carry. So "which works is this rating about" and "which works does
 * this review belong to" are one question with one answer, and a second work row
 * for the same book is swept in for free rather than by a duplicate-detector
 * that would have to guess.
 *
 * ⚠️ This is NOT duplicate detection and must not grow into it. It merges
 * nothing, mints no `work_relation`, and changes no title. Two works sharing a
 * `work_key` are the same book by the only definition this catalog has; if they
 * should be one row, that is a decision for a person and a different feature.
 *
 * ## What it will not do
 *
 * Overrule a person — `deriveReadState` refuses any row stamped `'human'`, and
 * `setReadState` stamps every row a person touches. Returning only the rows that
 * actually changed is what keeps a second call free and the backfill's counts
 * honest.
 *
 * `finished_on` is deliberately left alone. A review's `createdAt` is the date
 * the review was *written*, not the date the book was finished, and for 860
 * documents written in bulk it would be a fabricated reading history that looked
 * exactly like a measured one. A blank date is honest; a wrong one is forever.
 */
export async function applyObservedRating(
  db: D1Database,
  workKey: string,
  userId: number,
  observed: ObservedRating,
): Promise<DerivedRead[]> {
  // ⚠️ Delegates rather than repeats. The batch below is the one implementation
  // of this rule against the database; two copies of "which works does this
  // rating reach, and may it write there" is precisely the drift `@lc/core`'s
  // `deriveReadState` exists to prevent one layer up.
  return applyObservedRatings(db, userId, [{ workKey, ...observed }]);
}

/**
 * ⚠️ Bound parameters per statement, not a page size.
 *
 * D1 caps them at 100. One is spent on `user_id`, so the `IN (…)` list gets 90
 * with room to spare. A sweep of 400 ratings is five SELECTs, not four hundred.
 */
const KEYS_PER_QUERY = 90;

/** Statements per `batch()`. Chunked on WORK boundaries — see the note below. */
const WRITES_PER_BATCH = 100;

/**
 * Every rating one person has written, applied in a handful of queries.
 *
 * This is `applyObservedRating` for the whole library at once, and it exists
 * because the per-book path only ever fires on a book somebody opens. See
 * `observedRatingsFromReviews` in `@lc/core` for what the browser sends and why
 * a sweep only became possible once the review documents carried `workKey`.
 *
 * Everything the single-work version promises holds here unchanged: a `'human'`
 * row is refused, `finished_on` is never invented, `rating_cached` is written by
 * its own statement, and the returned list is only what actually changed — which
 * is empty on every run after the first, and is what keeps a per-session sweep
 * from redrawing anything.
 *
 * ⚠️ A key naming no work in this catalog matches nothing and costs nothing.
 * That is the ordinary case rather than a failure: the household owns roughly
 * 1,075 audiobooks against 258 works here, so most ratings are of books this
 * catalog does not hold.
 */
export async function applyObservedRatings(
  db: D1Database,
  userId: number,
  observed: readonly ObservedWorkRating[],
): Promise<DerivedRead[]> {
  // First wins, defensively — `observedRatingsFromReviews` has already
  // deduplicated, and a second rule here that disagreed with it would be worse
  // than this one being redundant.
  const byKey = new Map<string, ObservedWorkRating>();
  for (const o of observed) if (!byKey.has(o.workKey)) byKey.set(o.workKey, o);
  const keys = [...byKey.keys()];
  if (keys.length === 0) return [];

  interface Row {
    work_id: number;
    work_key: string;
    title: string;
    read_state: string | null;
    read_state_how: string | null;
    read_format: string | null;
  }

  const rows: Row[] = [];
  for (let i = 0; i < keys.length; i += KEYS_PER_QUERY) {
    const chunk = keys.slice(i, i + KEYS_PER_QUERY);
    const { results } = await db
      .prepare(
        `SELECT w.id AS work_id, w.work_key AS work_key, w.title AS title,
                ub.read_state, ub.read_state_how, ub.read_format
           FROM work w
           LEFT JOIN user_book ub ON ub.work_id = w.id AND ub.user_id = ?
          WHERE w.work_key IN (${chunk.map(() => '?').join(', ')})
          ORDER BY w.id`,
      )
      .bind(userId, ...chunk)
      .all<Row>();
    rows.push(...(results ?? []));
  }

  const changed: DerivedRead[] = [];
  /** One entry per work: the statements that work needs, in order. */
  const perWork: D1PreparedStatement[][] = [];

  const cache = db.prepare(
    `INSERT INTO user_book (work_id, user_id, rating_cached, rating_synced_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (work_id, user_id) DO UPDATE SET
       rating_cached    = excluded.rating_cached,
       rating_synced_at = excluded.rating_synced_at,
       updated_at       = datetime('now')`,
  );
  // ⚠️ Read-state and format only. `rating_cached` is set by the statement above
  // and never by this one, so the two concerns stay separable exactly as the
  // header of this file requires — and an UPDATE, not an upsert, because the
  // cache statement has already guaranteed the row exists.
  const mark = db.prepare(
    `UPDATE user_book
        SET read_state = ?, read_format = ?, read_state_how = 'rating',
            updated_at = datetime('now')
      WHERE work_id = ? AND user_id = ?`,
  );

  for (const row of rows) {
    const seen = byKey.get(row.work_key);
    // Cannot happen — the rows came back from an `IN` over these very keys — but
    // a silent `undefined.rating` here would write a NULL rating over a real one.
    if (!seen) continue;

    const writes = [cache.bind(row.work_id, userId, seen.rating)];

    const next = deriveReadState(
      seen,
      row.read_state === null
        ? null
        : {
            readState: row.read_state,
            readStateHow: row.read_state_how,
            readFormat: row.read_format,
          },
    );
    if (next) {
      writes.push(mark.bind(next.readState, next.readFormat, row.work_id, userId));
      changed.push({
        workId: row.work_id,
        title: row.title,
        readState: next.readState,
        readFormat: next.readFormat,
      });
    }
    perWork.push(writes);
  }

  // ⚠️ Order matters inside the batch: the cache upsert creates the row that the
  // mark UPDATE then edits. `batch` runs statements in sequence, so pairing them
  // per work rather than grouping by kind is what keeps that true — and it is
  // why the chunking below splits between works and never inside one.
  let pending: D1PreparedStatement[] = [];
  for (const writes of perWork) {
    if (pending.length && pending.length + writes.length > WRITES_PER_BATCH) {
      await db.batch(pending);
      pending = [];
    }
    pending.push(...writes);
  }
  if (pending.length) await db.batch(pending);

  return changed;
}
