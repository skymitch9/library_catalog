import {
  isDirectionalRelation,
  type CreateWorkRelation,
  type ScanOverlap,
  type WorkRelation,
} from '@lc/core';

/**
 * Books that belong together without sharing a series.
 *
 * Ported from the board game catalog's `packages/db/src/relations.ts`, minus its
 * recursive `same_family` closure. That project treats family membership as
 * transitive because a family is a statement about what a game *is* — link three
 * Catans to each other and all three are Catans.
 *
 * ⚠️ **`same_universe` is deliberately NOT transitive here**, and the difference
 * is a fact about this catalog rather than a simplification. The Cosmere is 40+
 * published works and this house owns nine of them with no series between them;
 * a transitive closure would make every Cosmere book's page a list of every
 * other one, which is a table of contents, not a relation. Worse, one wrong link
 * would silently absorb an unrelated book into the whole set. Each link is
 * therefore a claim about two specific books, and the page shows exactly what
 * somebody said.
 */

export interface RelatedWork {
  /** The row that stores this link, for the unlink button. */
  relationId: number;
  workId: number;
  title: string;
  authors: string;
  series: string | null;
  seriesIndexDisplay: string | null;
  coverUrl: string | null;
  relation: WorkRelation;
  /**
   * True when the work being viewed is the `from` end of the stored row.
   *
   * Meaningless for `same_universe` and `companion`, and the whole meaning of
   * the other two: outgoing `contains` reads "contains", incoming reads "part
   * of". One row, two sentences.
   */
  outgoing: boolean;
  note: string | null;
}

export async function listRelatedWorks(db: D1Database, workId: number): Promise<RelatedWork[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id AS relation_id,
              CASE WHEN r.from_work_id = ?1 THEN r.to_work_id ELSE r.from_work_id END AS work_id,
              r.relation,
              CASE WHEN r.from_work_id = ?1 THEN 1 ELSE 0 END AS outgoing,
              r.note,
              w.title, w.authors, w.series, w.series_index_display, w.cover_url
         FROM work_relation r
         JOIN work w
           ON w.id = CASE WHEN r.from_work_id = ?1 THEN r.to_work_id ELSE r.from_work_id END
        WHERE r.from_work_id = ?1 OR r.to_work_id = ?1
        ORDER BY r.relation, w.sort_title COLLATE NOCASE`,
    )
    .bind(workId)
    .all<{
      relation_id: number;
      work_id: number;
      relation: WorkRelation;
      outgoing: number;
      note: string | null;
      title: string;
      authors: string;
      series: string | null;
      series_index_display: string | null;
      cover_url: string | null;
    }>();

  return results.map((r) => ({
    relationId: r.relation_id,
    workId: r.work_id,
    title: r.title,
    authors: r.authors,
    series: r.series,
    seriesIndexDisplay: r.series_index_display,
    coverUrl: r.cover_url,
    relation: r.relation,
    outgoing: r.outgoing === 1,
    note: r.note,
  }));
}

/**
 * "Do I already have this text, inside something else?"
 *
 * ⚠️ **The question the scan path asks, and it is not the duplicate question.**
 * A duplicate is the same object twice and `copy` answers it. This is the same
 * *text* reached two ways — an omnibus and a volume printed inside it — and only
 * `work_relation.contains` can answer it, because it is the only place the
 * catalog records that one book is inside another.
 *
 * Both directions, from one row, because both are worth being told while the
 * book is still in your hand:
 *
 * - **`inside`** — you hold the omnibus and are scanning volume 1.
 * - **`holds`** — you hold volume 1 and are scanning the omnibus.
 *
 * ⚠️ Which end is which is the entire meaning. `contains` is directional —
 * `from` contains `to`, never the other way — and migration 0004 spells out that
 * a row read the wrong way round is not an untidy duplicate but a false
 * statement. Read backwards here it would tell somebody they own a book inside
 * one of its own chapters.
 *
 * ## ⚠️ Wishes are excluded, by the same rule the series ladder uses
 *
 * "You already own this inside *X*" is a lie if *X* is a book we merely want. A
 * work is a wish only when it has **no editions at all** and **every** copy it
 * has is a wishlist status — the narrow rule from `completeness-wishlist-
 * relations.md` §2, and it has to be the narrow one: 115 imported works have no
 * copies of any status, and the obvious "no owned copy" test would file every
 * one of them as a wish and silence the warning completely.
 *
 * ## ⚠️ Every `contains` row in one read, not one read per book
 *
 * A shelf photograph produces a dozen lines and each one wants this answer, so
 * the obvious per-line query is a dozen subrequests for a table that held **0
 * rows** on 2026-08-11 and will hold single figures for years. This reads the
 * whole table once and hands back an index; the scan path then answers every
 * line for free, and — the part that matters — **short-circuits entirely when
 * the map is empty**, which is the state the catalog is in today. The feature
 * therefore costs one query until somebody records their first omnibus.
 */
export async function loadContainmentIndex(
  db: D1Database,
): Promise<Map<number, ScanOverlap[]>> {
  const { results } = await db
    .prepare(
      // `held` is 0 only for a pure wish: no editions at all, and every copy a
      // wishlist status. The narrow rule — 115 imported works have no copies of
      // any status and every one of them is on the shelf.
      `SELECT r.from_work_id, r.to_work_id,
              f.title AS from_title, t.title AS to_title,
              CASE WHEN (SELECT COUNT(*) FROM edition e WHERE e.work_id = f.id) = 0
                    AND (SELECT COUNT(*) FROM copy c WHERE c.work_id = f.id) > 0
                    AND (SELECT COUNT(*) FROM copy c WHERE c.work_id = f.id
                           AND c.status NOT IN ('wanted', 'preordered')) = 0
                   THEN 0 ELSE 1 END AS from_held,
              CASE WHEN (SELECT COUNT(*) FROM edition e WHERE e.work_id = t.id) = 0
                    AND (SELECT COUNT(*) FROM copy c WHERE c.work_id = t.id) > 0
                    AND (SELECT COUNT(*) FROM copy c WHERE c.work_id = t.id
                           AND c.status NOT IN ('wanted', 'preordered')) = 0
                   THEN 0 ELSE 1 END AS to_held
         FROM work_relation r
         JOIN work f ON f.id = r.from_work_id
         JOIN work t ON t.id = r.to_work_id
        WHERE r.relation = 'contains'`,
    )
    .all<{
      from_work_id: number;
      to_work_id: number;
      from_title: string;
      to_title: string;
      from_held: number;
      to_held: number;
    }>();

  const index = new Map<number, ScanOverlap[]>();
  const add = (key: number, entry: ScanOverlap) => {
    const list = index.get(key);
    if (list) list.push(entry);
    else index.set(key, [entry]);
  };

  for (const r of results) {
    // ⚠️ `from` CONTAINS `to`. Read either way round and the warning inverts —
    // it would tell somebody they own an omnibus inside one of its own chapters.
    // Migration 0004 is emphatic about this and it is worth being emphatic twice.
    if (r.from_held === 1) {
      add(r.to_work_id, { workId: r.from_work_id, title: r.from_title, direction: 'inside' });
    }
    if (r.to_held === 1) {
      add(r.from_work_id, { workId: r.to_work_id, title: r.to_title, direction: 'holds' });
    }
  }
  return index;
}

export class RelationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Link two works.
 *
 * ⚠️ The id sort is applied to symmetric relations only. Sorting a `contains`
 * would make the omnibus a component of its own chapter whenever the chapter was
 * catalogued first — *Dungeon Born* is work 24 and *The Divine Dungeon Complete
 * Series* is work 103, so this is not hypothetical here; it is the exact pair
 * that would break. Migration 0004 and the board game catalog's `createRelation`
 * both carry the same warning.
 *
 * Idempotent: linking the same pair the same way twice returns the existing row
 * rather than erroring. A double tap on a phone is not a conflict.
 */
export async function createWorkRelation(
  db: D1Database,
  fromWorkId: number,
  input: CreateWorkRelation,
): Promise<{ id: number; fromWorkId: number; toWorkId: number; relation: WorkRelation }> {
  if (fromWorkId === input.toWorkId) {
    throw new RelationError('A book cannot be related to itself', 400);
  }

  const both = await db
    .prepare('SELECT COUNT(*) AS n FROM work WHERE id IN (?1, ?2)')
    .bind(fromWorkId, input.toWorkId)
    .first<{ n: number }>();
  if ((both?.n ?? 0) !== 2) throw new RelationError('One of those books does not exist', 404);

  const directional = isDirectionalRelation(input.relation);
  const [a, b] =
    directional || fromWorkId < input.toWorkId
      ? [fromWorkId, input.toWorkId]
      : [input.toWorkId, fromWorkId];

  const note = input.note?.trim() || null;
  const row = await db
    .prepare(
      `INSERT INTO work_relation (from_work_id, to_work_id, relation, note)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(from_work_id, to_work_id, relation)
         DO UPDATE SET note = COALESCE(?4, work_relation.note)
       RETURNING id, from_work_id, to_work_id, relation`,
    )
    .bind(a, b, input.relation, note)
    .first<{ id: number; from_work_id: number; to_work_id: number; relation: WorkRelation }>();

  if (!row) throw new RelationError('Could not create that link', 500);
  return {
    id: row.id,
    fromWorkId: row.from_work_id,
    toWorkId: row.to_work_id,
    relation: row.relation,
  };
}

export async function deleteWorkRelation(db: D1Database, relationId: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM work_relation WHERE id = ?').bind(relationId).run();
  return (res.meta.changes ?? 0) > 0;
}
