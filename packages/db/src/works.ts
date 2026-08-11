import {
  PHYSICAL_FORMATS,
  normaliseTitle,
  primaryAuthor,
  sortTitleFor,
  workKeyFor,
  type CoverStatus,
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
  /** 'ok' | 'standin' | NULL (nobody has looked). Migration 0040. */
  cover_status: string | null;
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
  /**
   * Whether the cover we hold is really this book's — `null` until somebody
   * says. ⚠️ `null` is NOT 'ok'; see `COVER_STATUSES`.
   */
  coverStatus: CoverStatus | null;
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
    coverStatus: (row.cover_status as CoverStatus | null) ?? null,
    createdAt: row.created_at,
  };
}

const WORK_COLS = `id, title, subtitle, sort_title, authors, primary_author, work_key,
                   series, series_index_sort, series_index_display, first_published,
                   openlibrary_work_id, description, cover_url, cover_status,
                   created_at, updated_at`;

export async function createWork(db: D1Database, input: CreateWork): Promise<Work> {
  const author = primaryAuthor(input.authors);
  const res = await db
    .prepare(
      `INSERT INTO work (title, subtitle, sort_title, authors, primary_author, work_key,
                         series, series_index_sort, series_index_display, first_published,
                         openlibrary_work_id, description, cover_url, cover_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      input.coverStatus ?? null,
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
 *
 * ⚠️ The same rule now applies to the cover: **`cover_status` moves with
 * `cover_url` or not at all.** See `coverStatus` below.
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

  /**
   * ⚠️ **A new cover with nothing said about it is unassessed, never
   * inherited.** Three cases, and the middle one is the whole reason this is
   * not a plain `patch.coverStatus ?? current.coverStatus`:
   *
   *   1. the patch names a status  → use it (with or without a new URL)
   *   2. the patch moves the URL and says nothing → NULL: nobody has assessed
   *      the *new* image, and carrying 'standin' across would leave the label
   *      on a book somebody has just fixed — the exact failure migration 0040
   *      exists to prevent, wearing the opposite sign
   *   3. neither → leave it alone
   *
   * Case 2 fails safe in the direction that loses a warning rather than
   * inventing one, which matches every other provenance column here: an
   * unobserved value is NULL, not a guess.
   */
  const coverStatus =
    patch.coverStatus !== undefined
      ? patch.coverStatus
      : patch.coverUrl !== undefined
        ? null
        : current.coverStatus;

  const row = await db
    .prepare(
      `UPDATE work SET
         title = ?, subtitle = ?, sort_title = ?, authors = ?, primary_author = ?, work_key = ?,
         series = ?, series_index_sort = ?, series_index_display = ?, first_published = ?,
         openlibrary_work_id = ?, description = ?, cover_url = ?, cover_status = ?,
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
      coverStatus,
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
  /**
   * The coarse format axis — `physical` or `ebook`. See `MEDIUM_CLAUSE`.
   *
   * Composes with `format` rather than replacing it: `medium=physical` and
   * `format=ebook_epub` together is "on the shelf and also as a file", which is
   * a real question and not a contradiction.
   */
  medium?: string | undefined;
  /**
   * How fancy the printing is — `collectors`, or `unsorted`. Migration 0050.
   *
   * ⚠️ A third axis, and it is genuinely orthogonal to the two above.
   * `medium` is paper-or-file, `format` is the binding, and this is whether the
   * object was sold as better than the standard one. A slipcased signed
   * hardcover is `physical` + `hardcover` + `collectors`, and no two of those
   * three can be derived from the other.
   *
   * `unsorted` is the odd one out and is not a stored value: it is "named, but
   * nothing has said what kind", which is the review queue that keeps
   * `edition_kind`'s NULL-means-ordinary rule honest. See `KIND_CLAUSE`.
   */
  editionKind?: string | undefined;
  status?: string | undefined;
  /**
   * "Show me what still wants attention" — `cover`, `watch` or `any`.
   *
   * ⚠️ The one filter here that is about **us**, not about the books. Every
   * other control answers a question about the collection ("which of these are
   * on the shelf"); this one answers "which of these have I not finished with",
   * which is why it is a single control with a short vocabulary rather than two
   * checkboxes. See `NEEDS_CLAUSE`.
   */
  needs?: string | undefined;
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
  /**
   * Copies paid for and not here yet.
   *
   * Carried on the row so the collection can mark them. ⚠️ `owned` gets no such
   * field and no mark: being owned is what being in the collection *means*, and
   * a label repeated on every row stops being read. Only the exceptions earn
   * one — the rule the sibling Board Game Catalog arrived at after badging
   * "owned" on eight hundred cards.
   */
  preordered: number;
  /** This reader's state for this book, when a reader was supplied. */
  readState: string | null;
  /**
   * Open watches on this book. `0` for almost everything.
   *
   * A count and not a boolean, because the card shows a mark and the book page
   * shows the notes, and "2 things to check" is worth knowing before you open
   * it. Same argument `preordered` makes one field up: only the exceptions earn
   * a number on the row.
   */
  openWatches: number;
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

/** `?, ?, ?` — one placeholder per physical format, so the list is never inlined. */
const PHYSICAL_PLACEHOLDERS = PHYSICAL_FORMATS.map(() => '?').join(', ');

/**
 * "Has an edition of this medium", as SQL.
 *
 * ⚠️ **EXISTS, not "every edition is" — the filter means *has*, not *only*.**
 * This household routinely owns the same book on the shelf and on the Kindle, so
 * an exclusive filter would drop exactly those books out of *both* sides and
 * hide the most interesting rows behind the control meant to find them. It also
 * matches every other filter on this page: `format` and `status` are both
 * "any edition/copy matches", and one exclusive filter sitting among inclusive
 * ones is a trap nobody reads the code to discover. The page says so in words.
 *
 * `ebook` is the negation of `PHYSICAL_FORMATS` rather than a list of its own —
 * see `EDITION_MEDIA` in `@lc/core` for why the second list must not exist.
 */
const MEDIUM_CLAUSE: Record<string, string> = {
  physical:
    `EXISTS (SELECT 1 FROM edition e
              WHERE e.work_id = w.id AND e.format IN (${PHYSICAL_PLACEHOLDERS}))`,
  ebook:
    `EXISTS (SELECT 1 FROM edition e
              WHERE e.work_id = w.id AND e.format NOT IN (${PHYSICAL_PLACEHOLDERS}))`,
};

/**
 * "How fancy is the printing", as SQL. Migration 0050.
 *
 * ⚠️ **EXISTS, like every other filter on this page** — it means the book *has*
 * such a printing, not that all of its printings are. A novel owned as a signed
 * leatherbound and as an EPUB is under `collectors`, which is the honest answer:
 * the household does own a collector's edition of it. `MEDIUM_CLAUSE` above
 * makes the same choice and says why one exclusive filter among inclusive ones
 * would be a trap.
 *
 * ⚠️ **`unsorted` is not a stored value and is the point of the control.**
 * `EDITION_KINDS` in `@lc/core` decides that a NULL `edition_kind` means an
 * *ordinary* printing rather than an unexamined one — which is right for the 220
 * unnamed rows and is exactly what could go quietly wrong for a newly imported
 * special edition nothing recognised. The rows where that risk lives are the
 * named ones with no kind, and this is that query. It normally returns two
 * (both *White Sand* — an omnibus and a "Volume 1", neither of which is a
 * special printing) and it is how "we can fix them one off if needed" is
 * actually done.
 *
 * No binds: both clauses are literals, and `edition_kind` values are compared
 * against text written here rather than against anything a caller sent.
 */
const KIND_CLAUSE: Record<string, string> = {
  collectors:
    `EXISTS (SELECT 1 FROM edition e
              WHERE e.work_id = w.id AND e.edition_kind = 'collectors')`,
  unsorted:
    `EXISTS (SELECT 1 FROM edition e
              WHERE e.work_id = w.id AND e.edition_name IS NOT NULL
                AND e.edition_name <> '' AND e.edition_kind IS NULL)`,
};

/**
 * "Still wants attention", as SQL. Migration 0040.
 *
 * ⚠️ **`cover` is not `cover_url IS NULL`, and that gap is the feature.** A
 * stand-in has a URL, so every existing test for "has a cover" says yes — the
 * five Illumicrate Percy Jackson works wear one marketing photograph between
 * them and would otherwise be invisible here forever. Both halves of the OR are
 * load-bearing.
 *
 * ⚠️ A `cover_status` of NULL over a filled URL is **not** included. NULL means
 * nobody has assessed it, which is true of all 224 works today; treating it as
 * suspect would return the whole catalog and make the control useless. Only a
 * positive 'standin' counts. Same rule as `coverNeeded` in `@lc/core`, and the
 * two must agree — that function is what the card mark uses.
 *
 * `watch` reads only *open* watches. A resolved one is history and is never what
 * this question is asking.
 */
const NEEDS_COVER = "(w.cover_url IS NULL OR w.cover_status = 'standin')";
const NEEDS_WATCH =
  'EXISTS (SELECT 1 FROM work_watch ww WHERE ww.work_id = w.id AND ww.resolved_at IS NULL)';

const NEEDS_CLAUSE: Record<string, string> = {
  cover: NEEDS_COVER,
  watch: NEEDS_WATCH,
  any: `(${NEEDS_COVER} OR ${NEEDS_WATCH})`,
};

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
  // Coarse before fine, so the binds land in the order the SQL text reads them.
  // An unrecognised medium adds no clause rather than erroring — same rule the
  // sort allowlist follows, because a stale bookmark should show the collection.
  const medium = query.medium ? MEDIUM_CLAUSE[query.medium] : undefined;
  if (medium) {
    where.push(medium);
    binds.push(...PHYSICAL_FORMATS);
  }
  if (query.format) {
    where.push('EXISTS (SELECT 1 FROM edition e WHERE e.work_id = w.id AND e.format = ?)');
    binds.push(query.format);
  }
  // No binds: `KIND_CLAUSE` is a fixed map of literal SQL, and an unrecognised
  // key adds no clause rather than erroring — the rule `MEDIUM_CLAUSE`, the sort
  // allowlist and `NEEDS_CLAUSE` all follow, so a stale bookmark shows the
  // collection instead of a 400.
  const kind = query.editionKind ? KIND_CLAUSE[query.editionKind] : undefined;
  if (kind) where.push(kind);
  if (query.status) {
    where.push('EXISTS (SELECT 1 FROM copy c WHERE c.work_id = w.id AND c.status = ?)');
    binds.push(query.status);
  }
  // No binds: every clause is a literal written above, never caller text. An
  // unrecognised value adds no clause rather than erroring — the same rule the
  // sort allowlist and `MEDIUM_CLAUSE` follow.
  const needs = query.needs ? NEEDS_CLAUSE[query.needs] : undefined;
  if (needs) where.push(needs);
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
              (SELECT COUNT(*) FROM copy c
                WHERE c.work_id = w.id AND c.status = 'preordered') AS preordered,
              (SELECT ub.read_state FROM user_book ub
                WHERE ub.work_id = w.id AND ub.user_id = ?) AS read_state,
              -- Open only. idx_work_watch_open is the partial index for this.
              -- (No backticks in here: this is inside a template literal.)
              (SELECT COUNT(*) FROM work_watch ww
                WHERE ww.work_id = w.id AND ww.resolved_at IS NULL) AS open_watches
         FROM work w
         ${whereSql}
        ORDER BY ${orderBy(query.sort, query.dir)}
        LIMIT ? OFFSET ?`,
    )
    .bind(readerId, ...binds, query.limit, query.offset)
    .all<
      WorkRow & {
        formats: string | null;
        copy_count: number;
        preordered: number;
        read_state: string | null;
        open_watches: number;
      }
    >();

  return {
    total: totalRow?.n ?? 0,
    rows: results.map((r) => ({
      ...toWork(r),
      formats: r.formats,
      copyCount: r.copy_count,
      preordered: r.preordered,
      readState: r.read_state,
      openWatches: r.open_watches,
    })),
  };
}

export interface CollectionFacets {
  series: { name: string; count: number }[];
  /**
   * The coarse axis, counted with the medium clause itself removed.
   *
   * ⚠️ **Always two entries, and a zero is a real answer.** Physical books are
   * only starting to arrive here, so "Physical (0)" is the truth today and will
   * not be tomorrow; a facet that omitted the empty side would make the control
   * appear and disappear under the reader. The two counts deliberately sum to
   * more than the total when a book is held both ways — that overlap is the
   * point, and `MEDIUM_CLAUSE` explains it.
   */
  media: { medium: string; count: number }[];
  formats: { format: string; count: number }[];
  statuses: { status: string; count: number }[];
  /**
   * How much is still outstanding. Counted with the `needs` clause itself
   * removed, exactly as `series` and `media` drop their own — otherwise
   * "Cover needed (4)" beside a selected "Watch" would be the count of books
   * that are *both*, which is not what picking it would give you.
   */
  needs: { cover: number; watch: number };
  /**
   * How many books hold a special printing, and how many hold a *named* one
   * nothing has sorted yet. Counted with the kind clause itself removed, exactly
   * as `series`, `media` and `needs` drop their own.
   *
   * ⚠️ Two numbers rather than a breakdown, and they can overlap: a book with a
   * signed leatherbound *and* an unrecognised second printing is in both. That
   * is the same shape and the same reason as `needs` — a GROUP BY would have to
   * pick one bucket for it.
   *
   * ⚠️ There is deliberately no `ordinary` count. It would be the whole
   * collection minus a handful, it is the default, and `EDITION_KINDS` explains
   * why "ordinary" is not a thing anybody filters for.
   */
  kinds: { collectors: number; unsorted: number };
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
  // Counted without the medium clause, for the reason the series facet drops its
  // own: with it applied, "Ebook (3)" beside a selected "Physical" would be the
  // count of books held *both* ways, which is not what picking it would give you.
  const withoutMedium = collectionFilter({ ...query, medium: undefined });
  const withoutNeeds = collectionFilter({ ...query, needs: undefined });
  // And without its own kind clause, for the third time and the same reason:
  // "Named, not sorted (2)" beside a selected "Collector's edition" would count
  // the books that are BOTH, which is not what picking it would give you.
  const withoutKind = collectionFilter({ ...query, editionKind: undefined });
  const all = collectionFilter(query);

  const [series, media, formats, statuses, needs, kinds] = await Promise.all([
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
    // One row, two columns — not a GROUP BY, because the two buckets overlap and
    // a work can legitimately be counted in both. SUM(CASE...) rather than
    // COUNT(*) FILTER so this does not depend on how new D1's SQLite is.
    //
    // ⚠️ Bind order is by order of appearance in the SQL text: the physical list
    // twice (once per column) and only then the WHERE binds.
    db
      .prepare(
        `SELECT
            SUM(CASE WHEN ${MEDIUM_CLAUSE.physical} THEN 1 ELSE 0 END) AS physical,
            SUM(CASE WHEN ${MEDIUM_CLAUSE.ebook} THEN 1 ELSE 0 END) AS ebook
           FROM work w ${withoutMedium.sql}`,
      )
      .bind(...PHYSICAL_FORMATS, ...PHYSICAL_FORMATS, ...withoutMedium.binds)
      .first<{ physical: number | null; ebook: number | null }>(),
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
    // One row, two columns, for the same reason `media` is: the two sets
    // overlap (a book can want a cover *and* be on watch) and a GROUP BY would
    // have to pick one bucket for it.
    db
      .prepare(
        `SELECT
            SUM(CASE WHEN ${NEEDS_COVER} THEN 1 ELSE 0 END) AS cover,
            SUM(CASE WHEN ${NEEDS_WATCH} THEN 1 ELSE 0 END) AS watch
           FROM work w ${withoutNeeds.sql}`,
      )
      .bind(...withoutNeeds.binds)
      .first<{ cover: number | null; watch: number | null }>(),
    // One row, two columns, for the third time — the two sets overlap (a book
    // can hold a classified printing and an unsorted one) so a GROUP BY would
    // have to choose a bucket for it. `KIND_CLAUSE` carries no binds, so
    // `withoutKind.binds` is the whole bind list.
    db
      .prepare(
        `SELECT
            SUM(CASE WHEN ${KIND_CLAUSE.collectors} THEN 1 ELSE 0 END) AS collectors,
            SUM(CASE WHEN ${KIND_CLAUSE.unsorted} THEN 1 ELSE 0 END) AS unsorted
           FROM work w ${withoutKind.sql}`,
      )
      .bind(...withoutKind.binds)
      .first<{ collectors: number | null; unsorted: number | null }>(),
  ]);

  return {
    series: series.results,
    // Both entries, always, in `EDITION_MEDIA` order. `SUM` over no rows is NULL.
    media: [
      { medium: 'physical', count: media?.physical ?? 0 },
      { medium: 'ebook', count: media?.ebook ?? 0 },
    ],
    formats: formats.results,
    statuses: statuses.results,
    // `SUM` over no rows is NULL. A zero here is a real and welcome answer —
    // it means nothing is outstanding — so the control stays put and reads
    // "Cover needed (0)" rather than vanishing, the rule `media` states.
    needs: { cover: needs?.cover ?? 0, watch: needs?.watch ?? 0 },
    // `SUM` over no rows is NULL. Both stay put at zero rather than vanishing,
    // the rule `media` states — and "Named, not sorted (0)" is the reading this
    // control most wants to be able to give.
    kinds: { collectors: kinds?.collectors ?? 0, unsorted: kinds?.unsorted ?? 0 },
  };
}

export interface CollectionStats {
  works: number;
  editions: number;
  copies: number;
  series: number;
  authors: number;
  withCover: number;
  /**
   * Copies we might buy. **`wanted` alone — `preordered` is counted separately
   * and folding the two back together is the bug this replaced.**
   *
   * They mean opposite things about a wallet: one is a decision still to make,
   * the other is money already spent on a book in the post. The sibling Board
   * Game Catalog shipped them as one number and it read "262 wanted" over a
   * wishlist of 25, because 236 of the 262 were pledges — both figures right,
   * describing different sets under one word. A crowdfunding import can turn
   * that ratio over in a single afternoon, and one is expected here shortly.
   *
   * Counted by the database rather than derived on the client, for the reason
   * the rest of this function exists: a number a page shows is a number the
   * database just answered.
   */
  wanted: number;
  /**
   * Copies paid for and not here yet. Not a wish, and never was.
   *
   * ⚠️ Both of these are **rows**, not `SUM(quantity)` — this schema has no
   * quantity, but the rule behind it still applies and is worth keeping in
   * view: a number that links somewhere must count what the place it links to
   * counts. Both of these are wishlist rows, and `/wishlist` lists rows.
   */
  preordered: number;
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
                -- Apart, not together. See the doc comment on CollectionStats.
                (SELECT COUNT(*) FROM copy WHERE status = 'wanted') AS wanted,
                (SELECT COUNT(*) FROM copy WHERE status = 'preordered') AS preordered`,
      )
      .first<{
        works: number; editions: number; copies: number;
        series: number; authors: number; with_cover: number;
        wanted: number; preordered: number;
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
    preordered: totals?.preordered ?? 0,
    formats: formats.results,
    readStates: readStates.results,
  };
}
