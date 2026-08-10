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
  /** When this row was catalogued. Drives the "recently added" view. */
  createdAt: string;
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
    createdAt: row.created_at,
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
  /** Read state for ONE person — the caller's, never a body parameter. */
  readState?: string | undefined;
  readerId?: number | undefined;
  sort?: CollectionSort | undefined;
  dir?: 'asc' | 'desc' | undefined;
  limit: number;
  offset: number;
}

export interface CollectionRow extends Work {
  /** Formats actually held, comma-joined. Empty when nothing is owned. */
  formats: string | null;
  copyCount: number;
  /** This reader's state for this book, when a reader was supplied. */
  readState: string | null;
}

/**
 * ⚠️ THE ALLOWLIST. A sort key never reaches SQL as text a caller supplied.
 *
 * `ORDER BY` cannot be a bound parameter, so the only safe shape is a fixed map
 * from a name to a fragment written here. An unknown key falls back to `series`
 * rather than erroring: a stale bookmark should show the collection, not a 400.
 *
 * ## Why each one is more than a column
 *
 * **series** is the default and is the read side of migration 0001's decision to
 * put a line in a column rather than a parent row. Books with no series fall
 * back to their own sort title, so a standalone slots in alphabetically among
 * the series names rather than piling up at one end.
 *
 * **`series_index_sort IS NULL` first in every series-aware sort.** SQLite orders
 * NULL *before* everything in ASC, and this library has real volumes with no
 * number — the six *Seirei Tsukai no Blade Dance* "Extra" side stories. Without
 * this they sort ahead of Volume 01, which reads as a data error.
 *
 * **author** keeps the series grouping underneath it, because "sort by author"
 * on a shelf means "put an author's books together", and inside that a series
 * still wants to be in order.
 *
 * **added** is what makes a recently-added view possible at all. `created_at`
 * has second resolution and imports land in one batch, so `id` breaks the tie —
 * without it the order inside an import is undefined and the list reshuffles
 * between requests.
 */
const SORTS = {
  series:
    `COALESCE(w.series, w.sort_title) COLLATE NOCASE %DIR%,
     w.series_index_sort IS NULL %DIR%, w.series_index_sort %DIR%,
     w.sort_title COLLATE NOCASE %DIR%`,
  title: 'w.sort_title COLLATE NOCASE %DIR%, w.id %DIR%',
  author:
    `w.primary_author COLLATE NOCASE %DIR%,
     COALESCE(w.series, '') COLLATE NOCASE %DIR%,
     w.series_index_sort IS NULL ASC, w.series_index_sort ASC,
     w.sort_title COLLATE NOCASE ASC`,
  added: 'w.created_at %DIR%, w.id %DIR%',
} as const;

export type CollectionSort = keyof typeof SORTS;
export const COLLECTION_SORTS = Object.keys(SORTS) as CollectionSort[];

export function isCollectionSort(value: unknown): value is CollectionSort {
  return typeof value === 'string' && Object.hasOwn(SORTS, value);
}

function orderBy(sort: CollectionSort | undefined, dir: 'asc' | 'desc' | undefined): string {
  const template = SORTS[sort && isCollectionSort(sort) ? sort : 'series'];
  return template.replace(/%DIR%/g, dir === 'desc' ? 'DESC' : 'ASC');
}

/**
 * The WHERE clause and its binds, shared by the list, the count and the facets.
 *
 * One builder rather than three, because a facet count that disagrees with the
 * list it labels is worse than no facet at all — and three copies of this is how
 * they come to disagree.
 */
function collectionFilter(query: CollectionQuery): { sql: string; binds: unknown[] } {
  const where: string[] = [];
  const binds: unknown[] = [];

  if (query.q) {
    // Two patterns, because the columns are stored two different ways.
    //
    // `work_key` and `primary_author` are written folded, so a folded pattern
    // finds "Café" from "cafe" — that is the second reason those columns exist.
    // `series` is stored as printed and has no folded twin, so it is matched
    // raw; SQLite's LIKE is case-insensitive over ASCII, which is enough.
    //
    // ⚠️ Searching the series is not a nicety. Verified against the local
    // database 2026-08-10: before this clause, `?q=cradle` returned **0 rows**
    // while the collection held six Cradle books — none of them has the word in
    // its title, because the importer strips "(Cradle Book 3)" off before
    // storing. Searching a series by name is the first thing anyone tries.
    const folded = `%${normaliseTitle(query.q)}%`;
    const raw = `%${query.q.trim()}%`;
    where.push('(w.work_key LIKE ? OR w.primary_author LIKE ? OR w.series LIKE ?)');
    binds.push(folded, folded, raw);
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
  if (query.readState && query.readerId) {
    // 'unread' has to include rows with no `user_book` at all — a book nobody has
    // opened has no row, and treating that as "not unread" would hide most of the
    // collection behind the one filter people reach for first.
    if (query.readState === 'unread') {
      where.push(
        `NOT EXISTS (SELECT 1 FROM user_book ub
                      WHERE ub.work_id = w.id AND ub.user_id = ? AND ub.read_state <> 'unread')`,
      );
      binds.push(query.readerId);
    } else {
      where.push(
        `EXISTS (SELECT 1 FROM user_book ub
                  WHERE ub.work_id = w.id AND ub.user_id = ? AND ub.read_state = ?)`,
      );
      binds.push(query.readerId, query.readState);
    }
  }

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', binds };
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
  const { sql: whereSql, binds } = collectionFilter(query);

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM work w ${whereSql}`)
    .bind(...binds)
    .first<{ n: number }>();

  // The reader's own read-state travels with the row so the grid can mark a book
  // read without N follow-up requests. Bound as a parameter even when absent, so
  // the statement text is the same shape every time.
  //
  // ⚠️ It is the FIRST bind because it appears first in the SQL text, inside the
  // select list. D1 binds positionally by order of appearance; numbering it `?1`
  // and leaving the rest bare mixes SQLite's two parameter syntaxes, which is
  // legal SQL and not something D1's positional bind promises to follow.
  const readerId = query.readerId ?? -1;

  const { results } = await db
    .prepare(
      `SELECT ${WORK_COLS.split(',').map((c) => `w.${c.trim()}`).join(', ')},
              (SELECT group_concat(DISTINCT e.format) FROM edition e WHERE e.work_id = w.id) AS formats,
              (SELECT COUNT(*) FROM copy c WHERE c.work_id = w.id AND c.status = 'owned') AS copy_count,
              (SELECT ub.read_state FROM user_book ub
                WHERE ub.work_id = w.id AND ub.user_id = ?) AS read_state
         FROM work w
         ${whereSql}
        ORDER BY ${orderBy(query.sort, query.dir)}
        LIMIT ? OFFSET ?`,
    )
    .bind(readerId, ...binds, query.limit, query.offset)
    .all<WorkRow & { formats: string | null; copy_count: number; read_state: string | null }>();

  return {
    total: totalRow?.n ?? 0,
    rows: results.map((r) => ({
      ...toWork(r),
      formats: r.formats,
      copyCount: r.copy_count,
      readState: r.read_state,
    })),
  };
}

export interface CollectionFacets {
  series: { name: string; count: number }[];
  formats: { format: string; count: number }[];
  statuses: { status: string; count: number }[];
}

/**
 * What is in the collection to filter by, counted against the *current* filter.
 *
 * Counted rather than listed, because "Cradle" with nothing after it does not
 * tell you whether picking it leaves you with 6 books or 1. The series filter is
 * counted with the series clause removed, so choosing one does not collapse the
 * list you chose it from to a single entry.
 */
export async function collectionFacets(
  db: D1Database,
  query: CollectionQuery,
): Promise<CollectionFacets> {
  const withoutSeries = collectionFilter({ ...query, series: undefined });
  const all = collectionFilter(query);

  const [series, formats, statuses] = await Promise.all([
    db
      .prepare(
        `SELECT w.series AS name, COUNT(*) AS count
           FROM work w ${withoutSeries.sql}
          ${withoutSeries.sql ? 'AND' : 'WHERE'} w.series IS NOT NULL
          GROUP BY w.series
          ORDER BY w.series COLLATE NOCASE`,
      )
      .bind(...withoutSeries.binds)
      .all<{ name: string; count: number }>(),
    db
      .prepare(
        `SELECT e.format AS format, COUNT(DISTINCT w.id) AS count
           FROM work w JOIN edition e ON e.work_id = w.id ${all.sql}
          GROUP BY e.format ORDER BY count DESC`,
      )
      .bind(...all.binds)
      .all<{ format: string; count: number }>(),
    db
      .prepare(
        `SELECT c.status AS status, COUNT(DISTINCT w.id) AS count
           FROM work w JOIN copy c ON c.work_id = w.id ${all.sql}
          GROUP BY c.status ORDER BY count DESC`,
      )
      .bind(...all.binds)
      .all<{ status: string; count: number }>(),
  ]);

  return { series: series.results, formats: formats.results, statuses: statuses.results };
}

export interface CollectionStats {
  works: number;
  editions: number;
  copies: number;
  series: number;
  authors: number;
  withCover: number;
  /**
   * Copies with a wishlist status — `wanted` or `preordered`.
   *
   * Counted here rather than derived on the client from `formats`, for the
   * reason the rest of this function exists: a number the page shows is a number
   * the database just answered. Measured 2026-08-10, this is **0** in production
   * and locally, because nothing has ever written a `copy` row.
   */
  wanted: number;
  formats: { format: string; count: number }[];
  readStates: { readState: string; count: number }[];
}

/**
 * The numbers on the shelf, counted from the database on every request.
 *
 * ⚠️ Nothing here is cached and nothing is written into the UI as a literal.
 * A previous session in this household shipped a hard-coded count that was wrong
 * by a wide margin; a number a page shows must be a number the database just
 * answered.
 */
export async function collectionStats(
  db: D1Database,
  readerId: number,
): Promise<CollectionStats> {
  const [totals, formats, readStates] = await Promise.all([
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM work) AS works,
                (SELECT COUNT(*) FROM edition) AS editions,
                (SELECT COUNT(*) FROM copy WHERE status = 'owned') AS copies,
                (SELECT COUNT(DISTINCT series) FROM work WHERE series IS NOT NULL) AS series,
                (SELECT COUNT(DISTINCT primary_author) FROM work) AS authors,
                (SELECT COUNT(cover_url) FROM work) AS with_cover,
                (SELECT COUNT(*) FROM copy
                  WHERE status IN ('wanted', 'preordered')) AS wanted`,
      )
      .first<{
        works: number; editions: number; copies: number;
        series: number; authors: number; with_cover: number; wanted: number;
      }>(),
    db
      .prepare('SELECT format, COUNT(*) AS count FROM edition GROUP BY format ORDER BY count DESC')
      .all<{ format: string; count: number }>(),
    db
      .prepare(
        `SELECT read_state AS readState, COUNT(*) AS count
           FROM user_book WHERE user_id = ? GROUP BY read_state ORDER BY count DESC`,
      )
      .bind(readerId)
      .all<{ readState: string; count: number }>(),
  ]);

  return {
    works: totals?.works ?? 0,
    editions: totals?.editions ?? 0,
    copies: totals?.copies ?? 0,
    series: totals?.series ?? 0,
    authors: totals?.authors ?? 0,
    withCover: totals?.with_cover ?? 0,
    wanted: totals?.wanted ?? 0,
    formats: formats.results,
    readStates: readStates.results,
  };
}
