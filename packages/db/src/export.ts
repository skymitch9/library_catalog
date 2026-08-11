/**
 * Take the whole catalog away with you.
 *
 * `docs/HANDOFF.md` has said since the first deploy that D1 is the only copy of
 * this data and there is no backup story. This is the backup story: one request,
 * every row of every table that holds a decision, in a shape you could rebuild
 * from.
 *
 * ## Why JSON and not CSV, for the backup
 *
 * A CSV is one table. This catalog is **sixteen**, and the value of it is almost
 * entirely in the joins: `edition.work_id`, `copy.edition_id`,
 * `user_book.user_id`, `work_relation.from_work_id`, `series_volume.series`
 * matching `work.series` exactly. Flattening those into one wide row loses the
 * shape and cannot be read back — a re-import needs to know that two copies
 * belong to one edition, and a flattened row can only repeat the edition twice
 * and hope. The board game catalog reached the same split and ships both: JSON is
 * the thing you keep, CSV is the thing you open in Numbers.
 *
 * So there are two exports here and they are not alternatives:
 *
 * | | |
 * |---|---|
 * | `exportJsonChunks` | every row of every table, with the applied migration list stamped on it. **The one to keep.** |
 * | `exportCsvChunks`  | one row per work, flattened, for a spreadsheet. Lossy on purpose and says so. |
 *
 * ## ⚠️ Paged, not assembled
 *
 * Both are async generators yielding text, and every table is read
 * `LIMIT ... OFFSET ...`. Nothing here ever holds the whole catalog as one string
 * — the Worker's memory limit is 128MB and `JSON.stringify` of everything, plus
 * the row objects it was built from, is the shape that gets close to it as the
 * library grows. 116 works would fit today; the point of an export is that it
 * still works the day it matters, and the day it matters is the day there is a
 * lot of data.
 *
 * ## What is deliberately NOT in it
 *
 * `lookup_cache` and `scan_job`. Neither is catalog data — one is what we already
 * asked Open Library so a repeat scan does not pay twice, the other is transient
 * scan bookkeeping that no route has ever written. Restoring a backup should not
 * restore a cache, and including them would make the file bigger than the thing
 * it is protecting.
 */

/** Rows per query. Small enough to be one modest allocation, large enough that 116 works is one page. */
const PAGE = 500;

/**
 * Every table the export carries, in dependency order.
 *
 * ⚠️ The order is the re-import order. `edition` references `work`, `copy`
 * references both, `user_book` references `app_user` — a file whose tables are in
 * a different order is a file whose foreign keys cannot be satisfied as it is
 * read. Ordering the JSON keys is free; discovering the dependency later is not.
 *
 * `orderBy` is a column name written here, never anything a caller supplied —
 * `ORDER BY` cannot be a bound parameter. Same rule as `works.ts`'s sort
 * allowlist, and for the same reason.
 */
const TABLES: readonly { key: string; table: string; orderBy: string }[] = [
  { key: 'users', table: 'app_user', orderBy: 'id' },
  { key: 'works', table: 'work', orderBy: 'id' },
  { key: 'workAliases', table: 'work_alias', orderBy: 'id' },
  { key: 'aliasChecks', table: 'alias_check', orderBy: 'work_id' },
  { key: 'editions', table: 'edition', orderBy: 'id' },
  { key: 'copies', table: 'copy', orderBy: 'id' },
  { key: 'readState', table: 'user_book', orderBy: 'id' },
  { key: 'workRelations', table: 'work_relation', orderBy: 'id' },
  { key: 'seriesVolumes', table: 'series_volume', orderBy: 'id' },
  { key: 'seriesChecks', table: 'series_check', orderBy: 'series' },
  // ⚠️ Campaign before pledge before item before accessory, and that order is the
  // re-import order. `crowdfunding_pledge` references the campaign,
  // `pledge_item` references the pledge *and* `work` and `edition`, and
  // `book_accessory` references `work`, `copy` and the pledge — so it is last of
  // the four and after `copies`, which it already is.
  { key: 'campaigns', table: 'crowdfunding_campaign', orderBy: 'id' },
  { key: 'pledges', table: 'crowdfunding_pledge', orderBy: 'id' },
  { key: 'pledgeItems', table: 'pledge_item', orderBy: 'id' },
  { key: 'accessories', table: 'book_accessory', orderBy: 'id' },
  { key: 'researchRuns', table: 'research_run', orderBy: 'id' },
  { key: 'researchFindings', table: 'research_finding', orderBy: 'id' },
];

async function pageOf(
  db: D1Database,
  table: string,
  orderBy: string,
  offset: number,
): Promise<Record<string, unknown>[]> {
  const { results } = await db
    .prepare(`SELECT * FROM ${table} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .bind(PAGE, offset)
    .all<Record<string, unknown>>();
  return results;
}

async function countOf(db: D1Database, table: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * The schema this file was taken from, by name.
 *
 * ⚠️ Read from `d1_migrations` rather than written here as a literal. The sibling
 * project stamped `"schemaVersion": "0001_init"` into its export by hand and it
 * has been wrong since migration 0002 — which is worse than absent, because a
 * restore would trust it. The applied list cannot go stale: it is the answer to
 * the question, not a note about it.
 */
async function appliedMigrations(db: D1Database): Promise<string[]> {
  try {
    const { results } = await db
      .prepare('SELECT name FROM d1_migrations ORDER BY id')
      .all<{ name: string }>();
    return results.map((r) => r.name);
  } catch {
    // A database migrated by hand has no such table. Say nothing rather than
    // guessing — an empty list reads as "unknown", a made-up version does not.
    return [];
  }
}

/**
 * The whole catalog as JSON, a chunk at a time.
 *
 * Each row is serialised individually and emitted as it is read, so the largest
 * string this ever holds is one page of one table.
 */
export async function* exportJsonChunks(db: D1Database): AsyncGenerator<string> {
  const migrations = await appliedMigrations(db);

  const counts: Record<string, number> = {};
  for (const t of TABLES) counts[t.key] = await countOf(db, t.table);

  yield '{\n';
  yield `  "exportedAt": ${JSON.stringify(new Date().toISOString())},\n`;
  yield `  "migrations": ${JSON.stringify(migrations)},\n`;
  yield `  "counts": ${JSON.stringify(counts)},\n`;
  yield '  "tables": {\n';

  for (const [i, t] of TABLES.entries()) {
    yield `    ${JSON.stringify(t.key)}: [`;
    let offset = 0;
    let first = true;
    for (;;) {
      const rows = await pageOf(db, t.table, t.orderBy, offset);
      for (const row of rows) {
        yield (first ? '\n      ' : ',\n      ') + JSON.stringify(row);
        first = false;
      }
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
    yield (first ? ']' : '\n    ]') + (i === TABLES.length - 1 ? '\n' : ',\n');
  }

  yield '  }\n}\n';
}

/**
 * A cell, quoted only when it has to be. Doubling the quote is the whole of CSV
 * escaping, and a leading BOM is what makes Excel read UTF-8 (see below).
 */
function cell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADERS = [
  'work_id', 'title', 'subtitle', 'authors', 'series', 'series_index',
  'first_published', 'openlibrary_work_id', 'formats', 'isbn13s', 'asins',
  'copies_owned', 'copy_statuses', 'read_state', 'finished_on',
  'aliases', 'added_at',
] as const;

/**
 * One row per **work**, flattened, for a spreadsheet.
 *
 * ⚠️ Lossy, and the page that offers it says so. The board game catalog's CSV is
 * one row per *copy* because that is the grain an insurer asks about; this
 * library's centre of gravity is 118 ebook files with one copy each, so a
 * copy-grained file would be the work list with the interesting columns removed.
 * Editions, copies and aliases are collapsed into `;`-joined cells: readable,
 * sortable, and not something to rebuild a database from.
 *
 * `read_state` is one person's — whoever asked. There is no household read-state
 * and inventing a column for one would be a lie about a shared shelf.
 */
export async function* exportCsvChunks(db: D1Database, readerId: number): AsyncGenerator<string> {
  // U+FEFF. Without it Excel on Windows reads the file as the system codepage and
  // every accented author name arrives mangled — the same class of corruption
  // CLAUDE.md's mojibake sweep exists for, arriving through a spreadsheet.
  yield '﻿' + CSV_HEADERS.join(',') + '\n';

  let offset = 0;
  for (;;) {
    const { results } = await db
      .prepare(
        `SELECT w.id, w.title, w.subtitle, w.authors, w.series, w.series_index_display,
                w.first_published, w.openlibrary_work_id, w.created_at,
                (SELECT group_concat(DISTINCT e.format) FROM edition e WHERE e.work_id = w.id) AS formats,
                (SELECT group_concat(e.isbn13) FROM edition e
                  WHERE e.work_id = w.id AND e.isbn13 IS NOT NULL) AS isbn13s,
                (SELECT group_concat(e.asin) FROM edition e
                  WHERE e.work_id = w.id AND e.asin IS NOT NULL) AS asins,
                (SELECT COUNT(*) FROM copy c WHERE c.work_id = w.id AND c.status = 'owned') AS copies_owned,
                (SELECT group_concat(DISTINCT c.status) FROM copy c WHERE c.work_id = w.id) AS copy_statuses,
                (SELECT group_concat(a.kind || ':' || a.alias) FROM work_alias a
                  WHERE a.work_id = w.id) AS aliases,
                (SELECT ub.read_state FROM user_book ub
                  WHERE ub.work_id = w.id AND ub.user_id = ?) AS read_state,
                (SELECT ub.finished_on FROM user_book ub
                  WHERE ub.work_id = w.id AND ub.user_id = ?) AS finished_on
           FROM work w
          ORDER BY w.sort_title COLLATE NOCASE, w.id
          LIMIT ? OFFSET ?`,
      )
      .bind(readerId, readerId, PAGE, offset)
      .all<Record<string, unknown>>();

    for (const r of results) {
      yield [
        r['id'], r['title'], r['subtitle'], r['authors'], r['series'],
        r['series_index_display'], r['first_published'], r['openlibrary_work_id'],
        // group_concat uses a bare comma; a `;` keeps a multi-value cell from
        // reading as several columns the moment it is not quoted.
        String(r['formats'] ?? '').split(',').join('; '),
        String(r['isbn13s'] ?? '').split(',').join('; '),
        String(r['asins'] ?? '').split(',').join('; '),
        r['copies_owned'],
        String(r['copy_statuses'] ?? '').split(',').join('; '),
        r['read_state'], r['finished_on'],
        String(r['aliases'] ?? '').split(',').join('; '),
        r['created_at'],
      ]
        .map(cell)
        .join(',') + '\n';
    }

    if (results.length < PAGE) return;
    offset += PAGE;
  }
}
