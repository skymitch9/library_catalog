import {
  normaliseTitle,
  primaryAuthor,
  sortTitleFor,
  workKeyFor,
  type CreateWork,
} from '@lc/core';

/**
 * Works, editions and copies.
 *
 * Every function takes the database as its first argument — no globals, no
 * singletons — so the same query runs under the Worker, the CLI and a test.
 *
 * ⚠️ **`work_key`, `sort_title` and `primary_author` are derived on write, in
 * this file, and nowhere else.** They are the columns the audiobook bridge joins
 * on; a second place that computes them is a second place that can compute them
 * differently. If a caller hands you a work_key, ignore it.
 */

export interface WorkRow {
  id: number;
  title: string;
  subtitle: string | null;
  sort_title: string | null;
  authors: string;
  primary_author: string;
  work_key: string;
  series: string | null;
  series_index_sort: number | null;
  series_index_display: string | null;
  first_published: number | null;
  openlibrary_work_id: string | null;
  description: string | null;
  cover_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Work {
  id: number;
  title: string;
  subtitle: string | null;
  sortTitle: string | null;
  authors: string;
  primaryAuthor: string;
  workKey: string;
  series: string | null;
  seriesIndexSort: number | null;
  seriesIndexDisplay: string | null;
  firstPublished: number | null;
  openlibraryWorkId: string | null;
  description: string | null;
  coverUrl: string | null;
}

export function toWork(row: WorkRow): Work {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    sortTitle: row.sort_title,
    authors: row.authors,
    primaryAuthor: row.primary_author,
    workKey: row.work_key,
    series: row.series,
    seriesIndexSort: row.series_index_sort,
    seriesIndexDisplay: row.series_index_display,
    firstPublished: row.first_published,
    openlibraryWorkId: row.openlibrary_work_id,
    description: row.description,
    coverUrl: row.cover_url,
  };
}

const WORK_COLS = `id, title, subtitle, sort_title, authors, primary_author, work_key,
                   series, series_index_sort, series_index_display, first_published,
                   openlibrary_work_id, description, cover_url, created_at, updated_at`;

export async function createWork(db: D1Database, input: CreateWork): Promise<Work> {
  const author = primaryAuthor(input.authors);
  const res = await db
    .prepare(
      `INSERT INTO work (title, subtitle, sort_title, authors, primary_author, work_key,
                         series, series_index_sort, series_index_display, first_published,
                         openlibrary_work_id, description, cover_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${WORK_COLS}`,
    )
    .bind(
      input.title,
      input.subtitle ?? null,
      sortTitleFor(input.title),
      input.authors,
      author,
      workKeyFor(input.title, input.authors),
      input.series ?? null,
      input.seriesIndexSort ?? null,
      input.seriesIndexDisplay ?? null,
      input.firstPublished ?? null,
      input.openlibraryWorkId ?? null,
      input.description ?? null,
      input.coverUrl ?? null,
    )
    .first<WorkRow>();
  if (!res) throw new Error('insert returned no row');
  return toWork(res);
}

export async function getWork(db: D1Database, id: number): Promise<Work | null> {
  const row = await db
    .prepare(`SELECT ${WORK_COLS} FROM work WHERE id = ?`)
    .bind(id)
    .first<WorkRow>();
  return row ? toWork(row) : null;
}

/**
 * Update a work, re-deriving anything downstream of title or authors.
 *
 * ⚠️ A title or author edit **must** move `work_key`, or the review bridge
 * silently keeps pointing at the old key and the book's reviews vanish from this
 * side. That is why this is one function rather than a generic column setter:
 * there is no way to change `title` here without `work_key` following.
 */
export async function updateWork(
  db: D1Database,
  id: number,
  patch: Partial<CreateWork>,
): Promise<Work | null> {
  const current = await getWork(db, id);
  if (!current) return null;

  const title = patch.title ?? current.title;
  const authors = patch.authors ?? current.authors;

  const row = await db
    .prepare(
      `UPDATE work SET
         title = ?, subtitle = ?, sort_title = ?, authors = ?, primary_author = ?, work_key = ?,
         series = ?, series_index_sort = ?, series_index_display = ?, first_published = ?,
         openlibrary_work_id = ?, description = ?, cover_url = ?,
         updated_at = datetime('now')
       WHERE id = ?
       RETURNING ${WORK_COLS}`,
    )
    .bind(
      title,
      patch.subtitle !== undefined ? patch.subtitle : current.subtitle,
      sortTitleFor(title),
      authors,
      primaryAuthor(authors),
      workKeyFor(title, authors),
      patch.series !== undefined ? patch.series : current.series,
      patch.seriesIndexSort !== undefined ? patch.seriesIndexSort : current.seriesIndexSort,
      patch.seriesIndexDisplay !== undefined
        ? patch.seriesIndexDisplay
        : current.seriesIndexDisplay,
      patch.firstPublished !== undefined ? patch.firstPublished : current.firstPublished,
      patch.openlibraryWorkId !== undefined
        ? patch.openlibraryWorkId
        : current.openlibraryWorkId,
      patch.description !== undefined ? patch.description : current.description,
      patch.coverUrl !== undefined ? patch.coverUrl : current.coverUrl,
      id,
    )
    .first<WorkRow>();
  return row ? toWork(row) : null;
}

export async function deleteWork(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM work WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * Everything the matcher needs, and nothing else.
 *
 * A shelf photo asks this once and then asks the in-memory index N times. It
 * deliberately does not join editions or copies: 800 rows × three joins to
 * answer "do we already have this" is the shape that made the board game
 * catalog's scan path slow, and none of that data changes the answer.
 */
export async function listWorksForMatching(
  db: D1Database,
): Promise<{ id: number; title: string; authors: string }[]> {
  const { results } = await db
    .prepare('SELECT id, title, authors FROM work')
    .all<{ id: number; title: string; authors: string }>();
  return results;
}

export async function listWorkAliases(
  db: D1Database,
): Promise<{ workId: number; alias: string }[]> {
  const { results } = await db
    .prepare('SELECT work_id AS workId, alias FROM work_alias')
    .all<{ workId: number; alias: string }>();
  return results;
}

/** Exact key lookup — the audiobook bridge's entry point. */
export async function findWorkByKey(db: D1Database, workKey: string): Promise<Work | null> {
  const row = await db
    .prepare(`SELECT ${WORK_COLS} FROM work WHERE work_key = ? LIMIT 1`)
    .bind(workKey)
    .first<WorkRow>();
  return row ? toWork(row) : null;
}

export interface CollectionQuery {
  /** Free text over title and author. Folded the same way the catalog is. */
  q?: string | undefined;
  series?: string | undefined;
  format?: string | undefined;
  status?: string | undefined;
  limit: number;
  offset: number;
}

export interface CollectionRow extends Work {
  /** Formats actually held, comma-joined. Empty when nothing is owned. */
  formats: string | null;
  copyCount: number;
}

/**
 * The collection page.
 *
 * `q` is matched with LIKE against the *stored* folded columns rather than
 * against `lower(title)`, so a search for "cafe" finds "Café" — the fold strips
 * diacritics and the raw column does not. That only works because
 * `primary_author` and `work_key` are written folded; it is the second reason
 * those columns exist (the first being the bridge).
 */
export async function listCollection(
  db: D1Database,
  query: CollectionQuery,
): Promise<{ rows: CollectionRow[]; total: number }> {
  const where: string[] = [];
  const binds: unknown[] = [];

  if (query.q) {
    const folded = `%${normaliseTitle(query.q)}%`;
    where.push('(w.work_key LIKE ? OR w.primary_author LIKE ?)');
    binds.push(folded, folded);
  }
  if (query.series) {
    where.push('w.series = ?');
    binds.push(query.series);
  }
  if (query.format) {
    where.push('EXISTS (SELECT 1 FROM edition e WHERE e.work_id = w.id AND e.format = ?)');
    binds.push(query.format);
  }
  if (query.status) {
    where.push('EXISTS (SELECT 1 FROM copy c WHERE c.work_id = w.id AND c.status = ?)');
    binds.push(query.status);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM work w ${whereSql}`)
    .bind(...binds)
    .first<{ n: number }>();

  const { results } = await db
    .prepare(
      `SELECT ${WORK_COLS.split(',').map((c) => `w.${c.trim()}`).join(', ')},
              (SELECT group_concat(DISTINCT e.format) FROM edition e WHERE e.work_id = w.id) AS formats,
              (SELECT COUNT(*) FROM copy c WHERE c.work_id = w.id AND c.status = 'owned') AS copy_count
         FROM work w
         ${whereSql}
        ORDER BY COALESCE(w.series, w.sort_title), w.series_index_sort, w.sort_title
        LIMIT ? OFFSET ?`,
    )
    .bind(...binds, query.limit, query.offset)
    .all<WorkRow & { formats: string | null; copy_count: number }>();

  return {
    total: totalRow?.n ?? 0,
    rows: results.map((r) => ({ ...toWork(r), formats: r.formats, copyCount: r.copy_count })),
  };
}
