import type { CreateCopy, CreateEdition, UpdateCopy, UpdateEdition } from '@lc/core';

/**
 * Editions (printings) and copies (the ones on the shelf).
 *
 * The catalog/collection split from migration 0001 is enforced here: an
 * `edition` re-synced from Open Library may be overwritten wholesale; a `copy`
 * never is, because nothing outside this house knows where the book lives.
 */

export interface EditionRow {
  id: number;
  work_id: number;
  isbn13: string | null;
  isbn10: string | null;
  asin: string | null;
  format: string;
  edition_name: string | null;
  /**
   * The canonical bucket beside the free-text name — `'collectors'` or null.
   * Migration 0050.
   *
   * ⚠️ **NULL means an ORDINARY printing, not an unclassified one**, which is
   * the opposite of what `work.cover_status` null means one table over. See
   * `EDITION_KINDS` in `@lc/core` for why the two differ. Nothing may treat a
   * null here as a question to be answered.
   */
  edition_kind: string | null;
  publisher: string | null;
  published_year: number | null;
  pages: number | null;
  language: string | null;
  cover_url: string | null;
  source: string;
  source_url: string | null;
  cwa_book_id: number | null;
}

const EDITION_COLS = `id, work_id, isbn13, isbn10, asin, format, edition_name, edition_kind,
                      publisher, published_year, pages, language, cover_url, source, source_url,
                      cwa_book_id`;

export async function createEdition(db: D1Database, input: CreateEdition): Promise<EditionRow> {
  const row = await db
    .prepare(
      `INSERT INTO edition (work_id, isbn13, isbn10, asin, format, edition_name, edition_kind,
                            publisher, published_year, pages, language, cover_url, source,
                            source_url, cwa_book_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${EDITION_COLS}`,
    )
    .bind(
      input.workId,
      input.isbn13 ?? null,
      input.isbn10 ?? null,
      input.asin ?? null,
      input.format,
      input.editionName ?? null,
      input.editionKind ?? null,
      input.publisher ?? null,
      input.publishedYear ?? null,
      input.pages ?? null,
      input.language ?? null,
      input.coverUrl ?? null,
      input.source,
      input.sourceUrl ?? null,
      input.cwaBookId ?? null,
    )
    .first<EditionRow>();
  if (!row) throw new Error('insert returned no row');
  return row;
}

export async function listEditionsForWork(
  db: D1Database,
  workId: number,
): Promise<EditionRow[]> {
  const { results } = await db
    .prepare(`SELECT ${EDITION_COLS} FROM edition WHERE work_id = ? ORDER BY published_year, id`)
    .bind(workId)
    .all<EditionRow>();
  return results;
}

/**
 * The self-healing lookup: has a scan of this ISBN already been answered by
 * something on our own shelf?
 *
 * Every successful scan writes `edition.isbn13` back, so the collection
 * gradually becomes its own barcode database and a re-scan of a book you own
 * costs no network call. Ported from `edition.barcode` in the board game
 * catalog, where it is the single highest-value line in the scan path.
 */
export async function findEditionByIsbn13(
  db: D1Database,
  isbn13: string,
): Promise<EditionRow | null> {
  return db
    .prepare(`SELECT ${EDITION_COLS} FROM edition WHERE isbn13 = ?`)
    .bind(isbn13)
    .first<EditionRow>();
}

/**
 * Has this exact file already been ingested?
 *
 * ⚠️ This exists because it was missing, and the absence cost 83 duplicate
 * editions in production. The ingest route matched on `work_key` and so
 * correctly avoided duplicate *works* — then created a second edition of the
 * same format for every book that already had one, because nothing checked.
 *
 * Matched on `source_url`, which for a machine import is the file's path and is
 * therefore the closest thing to an identity the file has. NOT on
 * (work, format) alone: a work may legitimately hold two EPUBs from different
 * publishers, and collapsing those would be a different bug in the other
 * direction.
 */
export async function findEditionBySourceUrl(
  db: D1Database,
  workId: number,
  sourceUrl: string,
): Promise<EditionRow | null> {
  return db
    .prepare(`SELECT ${EDITION_COLS} FROM edition WHERE work_id = ? AND source_url = ?`)
    .bind(workId, sourceUrl)
    .first<EditionRow>();
}

export async function findEditionByAsin(
  db: D1Database,
  asin: string,
): Promise<EditionRow | null> {
  return db
    .prepare(`SELECT ${EDITION_COLS} FROM edition WHERE asin = ?`)
    .bind(asin)
    .first<EditionRow>();
}

export async function getEdition(db: D1Database, id: number): Promise<EditionRow | null> {
  return db.prepare(`SELECT ${EDITION_COLS} FROM edition WHERE id = ?`).bind(id).first<EditionRow>();
}

/**
 * Correct a printing in place.
 *
 * ⚠️ **The column this exists for is `format`.** A barcode scan writes
 * `paperback` for every book — `addLineToCatalog` says why, and the guess is
 * sound — but a hardcover scanned off its own barcode lands in the catalog as a
 * paperback and nothing could change it. `PHYSICAL_FORMATS` filtering, the
 * collection's format facet and the Drive links all key on this one value, so a
 * wrong one is wrong in four places at once.
 *
 * Same `pick` idiom as `updateCopy`, and for the same reason: absent means
 * "leave it alone", explicit `null` means "clear it". The caller's JSON
 * distinguishes `undefined` from `null` and so does this, which is what lets the
 * edit form clear a publisher somebody typed by mistake without a second verb.
 *
 * ⚠️ `source` is patchable but the form does not offer it, and that asymmetry is
 * deliberate — see the note on `EDITION_SOURCES`: `manual` outranks every
 * importer and is never overwritten. A person correcting a row by hand has not
 * turned an Open Library import into a hand-typed one; they have corrected an
 * Open Library import. Rewriting the provenance would lose the only record of
 * where the other columns came from.
 */
export async function updateEdition(
  db: D1Database,
  id: number,
  patch: UpdateEdition,
): Promise<EditionRow | null> {
  const current = await getEdition(db, id);
  if (!current) return null;

  const pick = <T>(next: T | undefined, fallback: T): T => (next === undefined ? fallback : next);

  return db
    .prepare(
      `UPDATE edition SET
         isbn13 = ?, isbn10 = ?, asin = ?, format = ?, edition_name = ?, edition_kind = ?,
         publisher = ?, published_year = ?, pages = ?, language = ?, cover_url = ?, source = ?,
         source_url = ?, cwa_book_id = ?, updated_at = datetime('now')
       WHERE id = ?
       RETURNING ${EDITION_COLS}`,
    )
    .bind(
      pick(patch.isbn13, current.isbn13),
      pick(patch.isbn10, current.isbn10),
      pick(patch.asin, current.asin),
      pick(patch.format, current.format),
      pick(patch.editionName, current.edition_name),
      // ⚠️ Independent of `editionName`, deliberately. Renaming a printing must
      // not re-run `classifyEdition` behind the caller's back, and clearing a
      // name must not silently un-file the row — both are how a hand-made
      // one-off correction gets undone by an unrelated edit. The form sends
      // both, and each says exactly what it means.
      pick(patch.editionKind, current.edition_kind),
      pick(patch.publisher, current.publisher),
      pick(patch.publishedYear, current.published_year),
      pick(patch.pages, current.pages),
      pick(patch.language, current.language),
      pick(patch.coverUrl, current.cover_url),
      pick(patch.source, current.source),
      pick(patch.sourceUrl, current.source_url),
      pick(patch.cwaBookId, current.cwa_book_id),
      id,
    )
    .first<EditionRow>();
}

/**
 * Remove a printing.
 *
 * No cascade to worry about on the collection side: `copy.edition_id` is
 * `ON DELETE SET NULL` (migration 0001), so a copy of a deleted printing stays
 * on the shelf and merely stops naming which printing it is. That is the right
 * answer — the book has not left the house because the catalog row was wrong.
 *
 * ⚠️ `research_run.edition_id` and `research_finding.edition_id` ARE
 * `ON DELETE CASCADE`, so any research attached to this printing goes with it.
 * Both tables hold 0 rows today (the paid call has never run), but that will
 * stop being true.
 */
export async function deleteEdition(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM edition WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Copies
// ---------------------------------------------------------------------------

export interface CopyRow {
  id: number;
  work_id: number;
  edition_id: number | null;
  status: string;
  location: string | null;
  acquired_on: string | null;
  price_paid_cents: number | null;
  currency: string;
  vendor: string | null;
  condition: string | null;
  is_signed: number;
  edition_notes: string | null;
  lent_to: string | null;
  notes: string | null;
}

const COPY_COLS = `id, work_id, edition_id, status, location, acquired_on, price_paid_cents,
                   currency, vendor, condition, is_signed, edition_notes, lent_to, notes`;

export async function createCopy(db: D1Database, input: CreateCopy): Promise<CopyRow> {
  const row = await db
    .prepare(
      `INSERT INTO copy (work_id, edition_id, status, location, acquired_on, price_paid_cents,
                         currency, vendor, condition, is_signed, edition_notes, lent_to, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${COPY_COLS}`,
    )
    .bind(
      input.workId,
      input.editionId ?? null,
      input.status,
      input.location ?? null,
      input.acquiredOn ?? null,
      input.pricePaidCents ?? null,
      input.currency,
      input.vendor ?? null,
      input.condition ?? null,
      input.isSigned ? 1 : 0,
      input.editionNotes ?? null,
      input.lentTo ?? null,
      input.notes ?? null,
    )
    .first<CopyRow>();
  if (!row) throw new Error('insert returned no row');
  return row;
}

export async function listCopiesForWork(db: D1Database, workId: number): Promise<CopyRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COPY_COLS} FROM copy WHERE work_id = ? ORDER BY id`)
    .bind(workId)
    .all<CopyRow>();
  return results;
}

export async function getCopy(db: D1Database, id: number): Promise<CopyRow | null> {
  return db.prepare(`SELECT ${COPY_COLS} FROM copy WHERE id = ?`).bind(id).first<CopyRow>();
}

/**
 * Change a copy in place — the wishlist's whole mechanism.
 *
 * ⚠️ **Wanted → owned is an UPDATE, not a delete and an insert.** A wishlist
 * entry that becomes a purchase carries facts nothing else has: when it was
 * wanted, what was going to be paid, which shop. Re-creating the row throws all
 * of that away and resets `created_at` to the day it arrived rather than the day
 * it was wanted, which quietly makes "how long was this on the list" unanswerable
 * for every book that ever leaves the list.
 *
 * Every field is optional and an absent one is left alone (`COALESCE` on the
 * bound value), so `{ status: 'owned' }` is a complete and safe request. The one
 * asymmetry: `editionId`, `condition` and the free-text fields can be *cleared*
 * by sending an explicit `null`, which `undefined` does not do — the caller's
 * JSON distinguishes them and so does this.
 */
export async function updateCopy(
  db: D1Database,
  id: number,
  patch: UpdateCopy,
): Promise<CopyRow | null> {
  const current = await getCopy(db, id);
  if (!current) return null;

  const pick = <T>(next: T | undefined, fallback: T): T => (next === undefined ? fallback : next);

  return db
    .prepare(
      `UPDATE copy SET
         edition_id = ?, status = ?, location = ?, acquired_on = ?, price_paid_cents = ?,
         currency = ?, vendor = ?, condition = ?, is_signed = ?, edition_notes = ?,
         lent_to = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ?
       RETURNING ${COPY_COLS}`,
    )
    .bind(
      pick(patch.editionId, current.edition_id),
      pick(patch.status, current.status),
      pick(patch.location, current.location),
      pick(patch.acquiredOn, current.acquired_on),
      pick(patch.pricePaidCents, current.price_paid_cents),
      pick(patch.currency, current.currency),
      pick(patch.vendor, current.vendor),
      pick(patch.condition, current.condition),
      patch.isSigned === undefined ? current.is_signed : patch.isSigned ? 1 : 0,
      pick(patch.editionNotes, current.edition_notes),
      pick(patch.lentTo, current.lent_to),
      pick(patch.notes, current.notes),
      id,
    )
    .first<CopyRow>();
}

export async function deleteCopy(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM copy WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

export interface WishlistRow {
  copyId: number;
  workId: number;
  title: string;
  authors: string;
  series: string | null;
  seriesIndexDisplay: string | null;
  coverUrl: string | null;
  status: string;
  vendor: string | null;
  pricePaidCents: number | null;
  currency: string;
  notes: string | null;
  createdAt: string;
  /**
   * Normally null on this list — a copy that has not arrived has no arrival
   * date. It rides along so that marking one as arrived can fill the column
   * *only when it is empty*: an importer or a hand-typed correction may already
   * know the real date, and ticking the row weeks late must not replace it with
   * today. See `arrivedPatch` in the web app.
   */
  acquiredOn: string | null;
  /** Formats already held, if any — "we have the ebook, we want it in print". */
  formats: string | null;
}

/**
 * The wishlist: every copy we have said we want but do not hold.
 *
 * ⚠️ A copy-level list, not a work-level one, and that is the point. The
 * collection page can already filter works by copy status, but a *work* is the
 * wrong grain for a wishlist: this catalog holds 117 ebooks and physical books
 * are about to arrive, so "we have the EPUB and want the hardcover" is a normal
 * wish and shows up here as a wanted copy against a book that is also owned.
 * Filtering the collection could never express that — it would just say the book
 * is in the collection.
 *
 * `formats` rides along so the page can say which forms are already held; that
 * is the fact that makes the difference above visible instead of confusing.
 */
export async function listWishlist(
  db: D1Database,
  statuses: readonly string[],
): Promise<WishlistRow[]> {
  if (statuses.length === 0) return [];
  const placeholders = statuses.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT c.id AS copyId, c.work_id AS workId, w.title, w.authors, w.series,
              w.series_index_display AS seriesIndexDisplay, w.cover_url AS coverUrl,
              c.status, c.vendor, c.price_paid_cents AS pricePaidCents, c.currency,
              c.notes, c.created_at AS createdAt, c.acquired_on AS acquiredOn,
              (SELECT group_concat(DISTINCT e.format) FROM edition e WHERE e.work_id = w.id) AS formats
         FROM copy c
         JOIN work w ON w.id = c.work_id
        WHERE c.status IN (${placeholders})
        ORDER BY COALESCE(w.series, w.sort_title) COLLATE NOCASE,
                 w.series_index_sort IS NULL, w.series_index_sort,
                 w.sort_title COLLATE NOCASE`,
    )
    .bind(...statuses)
    .all<WishlistRow>();
  return results;
}
