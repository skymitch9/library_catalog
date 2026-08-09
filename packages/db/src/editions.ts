import type { CreateCopy, CreateEdition } from '@lc/core';

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
  publisher: string | null;
  published_year: number | null;
  pages: number | null;
  language: string | null;
  cover_url: string | null;
  source: string;
  source_url: string | null;
}

const EDITION_COLS = `id, work_id, isbn13, isbn10, asin, format, edition_name, publisher,
                      published_year, pages, language, cover_url, source, source_url`;

export async function createEdition(db: D1Database, input: CreateEdition): Promise<EditionRow> {
  const row = await db
    .prepare(
      `INSERT INTO edition (work_id, isbn13, isbn10, asin, format, edition_name, publisher,
                            published_year, pages, language, cover_url, source, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${EDITION_COLS}`,
    )
    .bind(
      input.workId,
      input.isbn13 ?? null,
      input.isbn10 ?? null,
      input.asin ?? null,
      input.format,
      input.editionName ?? null,
      input.publisher ?? null,
      input.publishedYear ?? null,
      input.pages ?? null,
      input.language ?? null,
      input.coverUrl ?? null,
      input.source,
      input.sourceUrl ?? null,
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

export async function findEditionByAsin(
  db: D1Database,
  asin: string,
): Promise<EditionRow | null> {
  return db
    .prepare(`SELECT ${EDITION_COLS} FROM edition WHERE asin = ?`)
    .bind(asin)
    .first<EditionRow>();
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

export async function deleteCopy(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM copy WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}
