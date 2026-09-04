import {
  UNKNOWN_AUTHOR,
  type CreateCopy,
  type CreateEdition,
  type UpdateCopy,
  type UpdateEdition,
} from '@lc/core';
import { ROW_FIELD, changeLogInsert, type Actor } from './changes.js';

/**
 * Editions (printings) and copies (the ones on the shelf).
 *
 * The catalog/collection split from migration 0001 is enforced here: an
 * `edition` re-synced from Open Library may be overwritten wholesale; a `copy`
 * never is, because nothing outside this house knows where the book lives.
 *
 * ⚠️ Every mutation here writes its `change_log` rows in the SAME `db.batch()`
 * as the change — the works.ts pattern, for the works.ts reason: a record
 * written in a second request can fail while the first succeeded (review
 * checklist item 3). Added 2026-08-13 when the rescan flow started filling
 * `edition.isbn13` on existing rows: an ISBN landing on a printing months
 * after the row was made is exactly the event "who changed this, and from
 * what?" exists to answer. An absent actor logs as `{ userId: null, how:
 * 'auto' }` — importers are recorded and distinguished, never skipped.
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
  /**
   * What is bound inside this object — "Volumes 1-3". Migration 0060, and NULL
   * on 227 of 229 rows because the ordinary printing is the whole work.
   *
   * ⚠️ Not a substitute for `work_relation.contains`. This says what is in the
   * *object*; that says which *catalog rows* are inside which, and only that one
   * can be linked to, counted, or read by the scan path's overlap warning. White
   * Sand has this column filled and no relation row, because its three volumes
   * are not rows — see migration 0060.
   */
  collects: string | null;
  /**
   * A remark ABOUT the printing — migration 0460, and the home
   * *"No barcode printed on this copy (owner-verified)"* should always have had.
   *
   * ⚠️ **NULL is an ABSENCE here**, not a claim: nobody wrote a note. That is
   * the opposite of `edition_kind` two fields up, where NULL is the positive
   * statement "ordinary printing" — the two nulls in this row mean different
   * things and nothing may treat them alike.
   */
  note: string | null;
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
                      collects, note, publisher, published_year, pages, language, cover_url,
                      source, source_url, cwa_book_id`;

export async function createEdition(
  db: D1Database,
  input: CreateEdition,
  actor?: Actor,
): Promise<EditionRow> {
  const insert = db
    .prepare(
      `INSERT INTO edition (work_id, isbn13, isbn10, asin, format, edition_name, edition_kind,
                            collects, note, publisher, published_year, pages, language, cover_url,
                            source, source_url, cwa_book_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      input.collects ?? null,
      input.note ?? null,
      input.publisher ?? null,
      input.publishedYear ?? null,
      input.pages ?? null,
      input.language ?? null,
      input.coverUrl ?? null,
      input.source,
      input.sourceUrl ?? null,
      input.cwaBookId ?? null,
    );

  // The id does not exist until the insert runs, so the audit row binds
  // `last_insert_rowid()` — same batch, atomically or not at all.
  const audit = changeLogInsert(db, {
    batchId: crypto.randomUUID(),
    entity: 'edition',
    entityId: 'last_insert_rowid()',
    field: ROW_FIELD,
    oldJson: 'null',
    newJson: JSON.stringify({
      workId: input.workId,
      isbn13: input.isbn13 ?? null,
      isbn10: input.isbn10 ?? null,
      asin: input.asin ?? null,
      format: input.format,
      editionName: input.editionName ?? null,
      editionKind: input.editionKind ?? null,
      collects: input.collects ?? null,
      note: input.note ?? null,
      publisher: input.publisher ?? null,
      publishedYear: input.publishedYear ?? null,
      pages: input.pages ?? null,
      language: input.language ?? null,
      coverUrl: input.coverUrl ?? null,
      source: input.source,
      sourceUrl: input.sourceUrl ?? null,
      cwaBookId: input.cwaBookId ?? null,
    }),
    actor,
  });

  const [inserted] = await db.batch<EditionRow>([insert, audit]);
  const row = inserted?.results?.[0];
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
  actor?: Actor,
): Promise<EditionRow | null> {
  const current = await getEdition(db, id);
  if (!current) return null;

  const pick = <T>(next: T | undefined, fallback: T): T => (next === undefined ? fallback : next);

  // The next values, derived once — the UPDATE binds them and the audit rows
  // diff them, so the log cannot disagree with the write.
  const next = {
    isbn13: pick(patch.isbn13, current.isbn13),
    isbn10: pick(patch.isbn10, current.isbn10),
    asin: pick(patch.asin, current.asin),
    format: pick(patch.format, current.format),
    editionName: pick(patch.editionName, current.edition_name),
    // ⚠️ Independent of `editionName`, deliberately. Renaming a printing must
    // not re-run `classifyEdition` behind the caller's back, and clearing a
    // name must not silently un-file the row — both are how a hand-made
    // one-off correction gets undone by an unrelated edit. The form sends
    // both, and each says exactly what it means.
    editionKind: pick(patch.editionKind, current.edition_kind),
    // Independent of both of the above. "Volume 1" is a fact about what is
    // between the covers and survives being renamed or re-filed — see
    // migration 0060 for why it is neither a name nor a kind.
    collects: pick(patch.collects, current.collects),
    // Independent of all three above, and of the ISBN it usually talks about.
    // Migration 0460: this is a remark about the printing ("No barcode printed
    // on this copy (owner-verified)"), and clearing it must not be a side
    // effect of typing an ISBN — an observation somebody made stays until
    // somebody unmakes it.
    note: pick(patch.note, current.note),
    publisher: pick(patch.publisher, current.publisher),
    publishedYear: pick(patch.publishedYear, current.published_year),
    pages: pick(patch.pages, current.pages),
    language: pick(patch.language, current.language),
    coverUrl: pick(patch.coverUrl, current.cover_url),
    source: pick(patch.source, current.source),
    sourceUrl: pick(patch.sourceUrl, current.source_url),
    cwaBookId: pick(patch.cwaBookId, current.cwa_book_id),
  };

  // One audit row per field that actually changed — no-op saves log nothing,
  // which matters here because `Editions.tsx` sends the identifier fields on
  // every save whether or not they moved.
  const batchId = crypto.randomUUID();
  const diffs: { field: string; oldValue: unknown; newValue: unknown }[] = [];
  const consider = (field: string, oldValue: unknown, newValue: unknown) => {
    if (oldValue !== newValue) diffs.push({ field, oldValue, newValue });
  };
  consider('isbn13', current.isbn13, next.isbn13);
  consider('isbn10', current.isbn10, next.isbn10);
  consider('asin', current.asin, next.asin);
  consider('format', current.format, next.format);
  consider('editionName', current.edition_name, next.editionName);
  consider('editionKind', current.edition_kind, next.editionKind);
  consider('collects', current.collects, next.collects);
  consider('note', current.note, next.note);
  consider('publisher', current.publisher, next.publisher);
  consider('publishedYear', current.published_year, next.publishedYear);
  consider('pages', current.pages, next.pages);
  consider('language', current.language, next.language);
  consider('coverUrl', current.cover_url, next.coverUrl);
  consider('source', current.source, next.source);
  consider('sourceUrl', current.source_url, next.sourceUrl);
  consider('cwaBookId', current.cwa_book_id, next.cwaBookId);

  const update = db
    .prepare(
      `UPDATE edition SET
         isbn13 = ?, isbn10 = ?, asin = ?, format = ?, edition_name = ?, edition_kind = ?,
         collects = ?, note = ?, publisher = ?, published_year = ?, pages = ?, language = ?,
         cover_url = ?, source = ?, source_url = ?, cwa_book_id = ?, updated_at = datetime('now')
       WHERE id = ?
       RETURNING ${EDITION_COLS}`,
    )
    .bind(
      next.isbn13,
      next.isbn10,
      next.asin,
      next.format,
      next.editionName,
      next.editionKind,
      next.collects,
      next.note,
      next.publisher,
      next.publishedYear,
      next.pages,
      next.language,
      next.coverUrl,
      next.source,
      next.sourceUrl,
      next.cwaBookId,
      id,
    );

  const [updated] = await db.batch<EditionRow>([
    update,
    ...diffs.map((d) =>
      changeLogInsert(db, {
        batchId,
        entity: 'edition',
        entityId: id,
        field: d.field,
        oldJson: JSON.stringify(d.oldValue === undefined ? null : d.oldValue),
        newJson: JSON.stringify(d.newValue === undefined ? null : d.newValue),
        actor,
      }),
    ),
  ]);
  return updated?.results?.[0] ?? null;
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
export async function deleteEdition(db: D1Database, id: number, actor?: Actor): Promise<boolean> {
  const row = await getEdition(db, id);
  if (!row) return false;

  // The whole row is the undo material — the audit row has no FK, so it
  // survives the row it describes (migration 0120).
  const del = db.prepare('DELETE FROM edition WHERE id = ?').bind(id);
  const audit = changeLogInsert(db, {
    batchId: crypto.randomUUID(),
    entity: 'edition',
    entityId: id,
    field: ROW_FIELD,
    oldJson: JSON.stringify(row),
    newJson: 'null',
    actor,
  });
  const [res] = await db.batch([del, audit]);
  return ((res?.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
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
  /** Special-edition attributes, first-class since migration 0430. 0/1. */
  sprayed_edges: number;
  leatherbound: number;
  slipcase: number;
  edition_notes: string | null;
  /** ⚠️ Deprecated by migration 0400 — read `person_name`. Still selected for one release. */
  lent_to: string | null;
  /** WHO has it, as an estate identity — null for a stranger, or nobody. */
  person_user_id: number | null;
  /** WHO has it, as typed. Kept even when the id is set — migration 0400 says why. */
  person_name: string | null;
  notes: string | null;
}

const COPY_COLS = `id, work_id, edition_id, status, location, acquired_on, price_paid_cents,
                   currency, vendor, condition, is_signed, sprayed_edges, leatherbound,
                   slipcase, edition_notes, lent_to,
                   person_user_id, person_name, notes`;

/**
 * The statuses that can carry a person. `owned` cannot: a book on the shelf is
 * in nobody else's hands, and letting a name sit on one would make "who has
 * this?" answer for a copy that is right here.
 *
 * ⚠️ Local rather than imported from `@lc/core` on purpose — it is not a subset
 * anybody else needs, and `HELD_STATUSES` / `WISHLIST_STATUSES` next door are
 * about a different question (is it ours, do we want it). A third named subset
 * exported beside those two would invite the wrong one being reached for.
 */
const PERSON_STATUSES: readonly string[] = ['lent', 'borrowed', 'sold'];

/**
 * A copy write that states a falsehood, refused with a status the route can
 * relay. The `AccessoryError` shape from `accessories.ts`, for the same
 * reason it exists there.
 */
export class CopyLinkError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message);
    this.name = 'CopyLinkError';
  }
}

/**
 * ⚠️ The check migration 0001's FK cannot make: `copy.edition_id` references
 * *an* edition, not an edition *of this copy's work*. A link to another book's
 * printing is a false statement, not an untidy one — the `assertCopyBelongs`
 * argument from `accessories.ts`, one table over. It went unchecked while the
 * rescan flow was the only writer (it derives ids from the same work's own
 * rows); the manual picker multiplies the writers, so the floor goes in with
 * it.
 */
async function assertEditionBelongs(
  db: D1Database,
  workId: number,
  editionId: number | null | undefined,
): Promise<void> {
  if (editionId == null) return;
  const row = await db
    .prepare('SELECT work_id FROM edition WHERE id = ?')
    .bind(editionId)
    .first<{ work_id: number }>();
  if (!row) throw new CopyLinkError('That printing is not in the catalog', 404);
  if (row.work_id !== workId) {
    throw new CopyLinkError('That printing belongs to a different book', 400);
  }
}

/**
 * The two checks a person write has to survive, both refused in words.
 *
 * ⚠️ **It is asked about the TRANSITION, not about the row**, which is why this
 * is a function and not a CHECK constraint in migration 0400. Attaching a
 * person to a copy that is merely `owned` is a false statement — the book is
 * right here. But a copy that comes home from a lend goes `lent` → `owned`
 * while KEEPING the record of who had it, and a row-level constraint cannot
 * tell those two apart. So the rule is: a patch that *names* a person must
 * leave the copy in a status that can carry one; a patch that touches neither
 * person field is never refused for a person's sake.
 *
 * The second check is the `assertEditionBelongs` argument applied to people: an
 * id naming nobody is a false statement, not an untidy one, and storing it
 * would produce a card that resolves to a blank name forever.
 *
 * `nextStatus` is the status the copy will have AFTER the write, never the one
 * it has now — a single PATCH routinely sets both at once ("lent, to Samantha").
 */
async function assertPersonAllowed(
  db: D1Database,
  patch: { personUserId?: number | null; personName?: string | null },
  nextStatus: string,
): Promise<void> {
  const namesSomebody =
    (patch.personUserId != null && patch.personUserId !== undefined) ||
    (patch.personName != null && patch.personName !== '');

  if (namesSomebody && !PERSON_STATUSES.includes(nextStatus)) {
    throw new CopyLinkError(
      `a copy can only record who has it when it is lent out, borrowed or sold — ` +
        `this one is "${nextStatus}". Change the status first, then say who has it.`,
      400,
    );
  }

  if (patch.personUserId != null) {
    const row = await db
      .prepare('SELECT id FROM app_user WHERE id = ?')
      .bind(patch.personUserId)
      .first<{ id: number }>();
    if (!row) {
      throw new CopyLinkError('That person is not a member of this catalog', 404);
    }
  }
}

export async function createCopy(
  db: D1Database,
  input: CreateCopy,
  actor?: Actor,
): Promise<CopyRow> {
  await assertEditionBelongs(db, input.workId, input.editionId);
  await assertPersonAllowed(db, input, input.status);
  const insert = db
    .prepare(
      `INSERT INTO copy (work_id, edition_id, status, location, acquired_on, price_paid_cents,
                         currency, vendor, condition, is_signed, sprayed_edges, leatherbound,
                         slipcase, edition_notes, lent_to,
                         person_user_id, person_name, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      input.sprayedEdges ? 1 : 0,
      input.leatherbound ? 1 : 0,
      input.slipcase ? 1 : 0,
      input.editionNotes ?? null,
      input.lentTo ?? null,
      input.personUserId ?? null,
      input.personName ?? null,
      input.notes ?? null,
    );

  const audit = changeLogInsert(db, {
    batchId: crypto.randomUUID(),
    entity: 'copy',
    entityId: 'last_insert_rowid()',
    field: ROW_FIELD,
    oldJson: 'null',
    newJson: JSON.stringify({
      workId: input.workId,
      editionId: input.editionId ?? null,
      status: input.status,
      location: input.location ?? null,
      acquiredOn: input.acquiredOn ?? null,
      pricePaidCents: input.pricePaidCents ?? null,
      currency: input.currency,
      vendor: input.vendor ?? null,
      condition: input.condition ?? null,
      isSigned: input.isSigned ?? false,
      sprayedEdges: input.sprayedEdges ?? false,
      leatherbound: input.leatherbound ?? false,
      slipcase: input.slipcase ?? false,
      editionNotes: input.editionNotes ?? null,
      lentTo: input.lentTo ?? null,
      personUserId: input.personUserId ?? null,
      personName: input.personName ?? null,
      notes: input.notes ?? null,
    }),
    actor,
  });

  const [inserted] = await db.batch<CopyRow>([insert, audit]);
  const row = inserted?.results?.[0];
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
 * The CURRENT display name of every linked member in a batch of copies.
 *
 * ⚠️ **A live join, and that is the owner's answer to his own open question**
 * ("is it a live join or a snapshot?" — `docs/TODO.md` OR-1, answered
 * 2026-08-23: *"If the id is set the card shows the member's CURRENT display
 * name"*). So a person who renames themselves renames themselves everywhere,
 * and `copy.person_name` is not quietly the truth on a linked row.
 *
 * One query for the whole page rather than one per copy — a book with four
 * lent copies is rare but a `for` loop of awaits over D1 is how a rare row
 * becomes a slow page. A member whose `display_name` is NULL (it is nullable —
 * the Google account may never have supplied one) resolves to nothing, and the
 * caller falls back to `person_name`, which is what the fallback is for.
 */
export async function memberDisplayNames(
  db: D1Database,
  userIds: readonly number[],
): Promise<Map<number, string>> {
  const ids = [...new Set(userIds.filter((n): n is number => Number.isInteger(n)))];
  if (ids.length === 0) return new Map();
  const { results } = await db
    .prepare(
      `SELECT id, display_name FROM app_user WHERE id IN (${ids.map(() => '?').join(', ')})`,
    )
    .bind(...ids)
    .all<{ id: number; display_name: string | null }>();
  const byId = new Map<number, string>();
  for (const r of results) if (r.display_name) byId.set(r.id, r.display_name);
  return byId;
}

/** One row of "Books with you" — enough to recognise the book and say why it is listed. */
export interface LinkedCopyRow {
  copyId: number;
  workId: number;
  title: string;
  authors: string | null;
  coverUrl: string | null;
  status: string;
  /** When it left, when it arrived, or when it sold — whichever the status means. */
  acquiredOn: string | null;
}

/**
 * Every copy that points at one member — the whole of "Books with you".
 *
 * ⚠️ Keyed on `person_user_id` ALONE and never on a name match. A typed
 * "Samantha" is not evidence that *this* Samantha is the one, and guessing here
 * would show one member somebody else's borrowing. A stranger's row simply has
 * no id and appears on nobody's page, which is correct: the section exists
 * because a member was deliberately LINKED.
 *
 * Ordered newest-first on the copy id rather than on `acquired_on`, which is
 * frequently NULL on a lend — a date nobody filled in must not sort a row to
 * the bottom of a list of three.
 */
export async function listCopiesLinkedTo(
  db: D1Database,
  userId: number,
): Promise<LinkedCopyRow[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id AS copyId, c.work_id AS workId, w.title AS title, w.authors AS authors,
              w.cover_url AS coverUrl, c.status AS status, c.acquired_on AS acquiredOn
         FROM copy c JOIN work w ON w.id = c.work_id
        WHERE c.person_user_id = ?
        ORDER BY c.id DESC`,
    )
    .bind(userId)
    .all<LinkedCopyRow>();
  return results;
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
  actor?: Actor,
): Promise<CopyRow | null> {
  const current = await getCopy(db, id);
  if (!current) return null;

  // The link write the picker makes — checked against THIS copy's work.
  await assertEditionBelongs(db, current.work_id, patch.editionId);
  // ⚠️ Against the status the copy will HAVE, not the one it has: "lent, to
  // Samantha" arrives as one patch and both halves have to be judged together.
  await assertPersonAllowed(db, patch, patch.status ?? current.status);

  const pick = <T>(next: T | undefined, fallback: T): T => (next === undefined ? fallback : next);

  const next = {
    editionId: pick(patch.editionId, current.edition_id),
    status: pick(patch.status, current.status),
    location: pick(patch.location, current.location),
    acquiredOn: pick(patch.acquiredOn, current.acquired_on),
    pricePaidCents: pick(patch.pricePaidCents, current.price_paid_cents),
    currency: pick(patch.currency, current.currency),
    vendor: pick(patch.vendor, current.vendor),
    condition: pick(patch.condition, current.condition),
    isSigned: patch.isSigned === undefined ? current.is_signed : patch.isSigned ? 1 : 0,
    sprayedEdges:
      patch.sprayedEdges === undefined ? current.sprayed_edges : patch.sprayedEdges ? 1 : 0,
    leatherbound:
      patch.leatherbound === undefined ? current.leatherbound : patch.leatherbound ? 1 : 0,
    slipcase: patch.slipcase === undefined ? current.slipcase : patch.slipcase ? 1 : 0,
    editionNotes: pick(patch.editionNotes, current.edition_notes),
    lentTo: pick(patch.lentTo, current.lent_to),
    personUserId: pick(patch.personUserId, current.person_user_id),
    personName: pick(patch.personName, current.person_name),
    notes: pick(patch.notes, current.notes),
  };

  // One audit row per changed field. The rows that matter most here: `status`
  // (a wish becoming a purchase, a pre-order arriving) and `editionId` (a copy
  // finally saying which printing it is — the rescan flow's link write).
  const batchId = crypto.randomUUID();
  const diffs: { field: string; oldValue: unknown; newValue: unknown }[] = [];
  const consider = (field: string, oldValue: unknown, newValue: unknown) => {
    if (oldValue !== newValue) diffs.push({ field, oldValue, newValue });
  };
  consider('editionId', current.edition_id, next.editionId);
  consider('status', current.status, next.status);
  consider('location', current.location, next.location);
  consider('acquiredOn', current.acquired_on, next.acquiredOn);
  consider('pricePaidCents', current.price_paid_cents, next.pricePaidCents);
  consider('currency', current.currency, next.currency);
  consider('vendor', current.vendor, next.vendor);
  consider('condition', current.condition, next.condition);
  consider('isSigned', current.is_signed, next.isSigned);
  consider('sprayedEdges', current.sprayed_edges, next.sprayedEdges);
  consider('leatherbound', current.leatherbound, next.leatherbound);
  consider('slipcase', current.slipcase, next.slipcase);
  consider('editionNotes', current.edition_notes, next.editionNotes);
  consider('lentTo', current.lent_to, next.lentTo);
  // ⚠️ Two rows, never one. "Samantha" being replaced by a LINK to Samantha is
  // a real change to the record even though the card reads the same afterwards,
  // and an audit that folded them would make an unlink invisible.
  consider('personUserId', current.person_user_id, next.personUserId);
  consider('personName', current.person_name, next.personName);
  consider('notes', current.notes, next.notes);

  const update = db
    .prepare(
      `UPDATE copy SET
         edition_id = ?, status = ?, location = ?, acquired_on = ?, price_paid_cents = ?,
         currency = ?, vendor = ?, condition = ?, is_signed = ?, sprayed_edges = ?,
         leatherbound = ?, slipcase = ?, edition_notes = ?,
         lent_to = ?, person_user_id = ?, person_name = ?, notes = ?,
         updated_at = datetime('now')
       WHERE id = ?
       RETURNING ${COPY_COLS}`,
    )
    .bind(
      next.editionId,
      next.status,
      next.location,
      next.acquiredOn,
      next.pricePaidCents,
      next.currency,
      next.vendor,
      next.condition,
      next.isSigned,
      next.sprayedEdges,
      next.leatherbound,
      next.slipcase,
      next.editionNotes,
      next.lentTo,
      next.personUserId,
      next.personName,
      next.notes,
      id,
    );

  const [updated] = await db.batch<CopyRow>([
    update,
    ...diffs.map((d) =>
      changeLogInsert(db, {
        batchId,
        entity: 'copy',
        entityId: id,
        field: d.field,
        oldJson: JSON.stringify(d.oldValue === undefined ? null : d.oldValue),
        newJson: JSON.stringify(d.newValue === undefined ? null : d.newValue),
        actor,
      }),
    ),
  ]);
  return updated?.results?.[0] ?? null;
}

export async function deleteCopy(db: D1Database, id: number, actor?: Actor): Promise<boolean> {
  const row = await getCopy(db, id);
  if (!row) return false;

  const del = db.prepare('DELETE FROM copy WHERE id = ?').bind(id);
  const audit = changeLogInsert(db, {
    batchId: crypto.randomUUID(),
    entity: 'copy',
    entityId: id,
    field: ROW_FIELD,
    oldJson: JSON.stringify(row),
    newJson: 'null',
    actor,
  });
  const [res] = await db.batch([del, audit]);
  return ((res?.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
}

export interface WishlistRow {
  copyId: number;
  workId: number;
  title: string;
  /** Null for a book added without an author - the sentinel never leaves SQL. */
  authors: string | null;
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
      // NULLIF folds the 0120 sentinel to the honest null at the SQL boundary.
      `SELECT c.id AS copyId, c.work_id AS workId, w.title, NULLIF(w.authors, '${UNKNOWN_AUTHOR}') AS authors, w.series,
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
