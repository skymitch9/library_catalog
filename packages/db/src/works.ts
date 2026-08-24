import {
  HELD_STATUSES,
  PHYSICAL_FORMATS,
  UNKNOWN_AUTHOR,
  deletionBlockers,
  normaliseTitle,
  primaryAuthor,
  sortTitleFor,
  workKeyFor,
  type CoverStatus,
  type CreateWork,
  type DuplicateCandidate,
  type UniverseSource,
  type UpdateWork,
} from '@lc/core';
import {
  ROW_FIELD,
  changeLogInsert,
  evidenceSaysReviews,
  keyMoveEvidence,
  type Actor,
} from './changes.js';
import { listCopiesForWork, listEditionsForWork, type CopyRow } from './editions.js';
import {
  canonicalUniverseName,
  universeAsserted,
  universeIndex,
  universeOnCreate,
  universeOnUpdate,
  type UniverseAssignment,
} from '@lc/universes';

/**
 * Works, editions and copies.
 *
 * Every function takes the database as its first argument — no globals, no
 * singletons — so the same query runs under the Worker, the CLI and a test.
 *
 * ⚠️ **`work_key`, `sort_title`, `primary_author` and `universe` are derived on
 * write, in this file, and nowhere else.** They are the columns the audiobook
 * bridge joins on and the shelf is grouped by; a second place that computes them
 * is a second place that can compute them differently. If a caller hands you a
 * work_key, ignore it.
 *
 * ⚠️ **`universe` is derived HERE rather than in the add path, and that is the
 * whole of "a book is added to its verse when it enters".** Five callers create
 * works — the barcode/spine scan (`apps/web/src/lib/catalog-add.ts`), the manual
 * Add form, the series-gap wishlist, the ebook importer's `/api/ingest`, and
 * `POST /api/works` — and the owner asked for *when a book enters*, not *when a
 * book is scanned*. Resolving it in the add path would have answered one of the
 * five and left the ebook importer, which is where most of this catalog came
 * from, silently unassigned.
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
  /** The illustrator credit, or NULL (nobody has recorded one). Migration 0130. */
  illustrator: string | null;
  /** 0/1. One series slot, several physical volumes. Migration 0360. */
  multi_volume_printing: number;
  /** The owner's canonical universe name, or NULL for *in no universe*. Migration 0080. */
  universe: string | null;
  /** 'list' | 'human' | NULL (nobody and nothing has decided). Migration 0080. */
  universe_how: string | null;
  created_at: string;
  updated_at: string;
}

export interface Work {
  id: number;
  title: string;
  subtitle: string | null;
  sortTitle: string | null;
  /**
   * As printed — or **`null` for a book whose author is not yet recorded**
   * (migration 0120). The row itself stores the `UNKNOWN_AUTHOR` sentinel
   * (`work.authors` is NOT NULL on purpose — a rebuild of `work` is the
   * riskiest migration this estate could write, see 0008); `toWork` is the one
   * place the sentinel becomes an honest null, so the compiler finds every
   * reader that must handle an unknown author. Null here is what "flagged for
   * remediation" *is* — the flag is derived from the value, never stored
   * beside it.
   */
  authors: string | null;
  /** Null exactly when `authors` is. Same sentinel mapping. */
  primaryAuthor: string | null;
  /**
   * ⚠️ For an authorless book this ends `|?unknown` — a **provisional key**.
   * `normaliseTitle` can never emit `?`, so a provisional key equals no real
   * key, and `reviewDocFor` refuses to stamp one onto a review document —
   * which is why filling the author in later is always a free key move.
   */
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
  /**
   * The illustrator credit, as printed — or null for *nobody has recorded
   * one*. Migration 0130. Picture and board books are why it exists: on some
   * of them the illustrator is the only human credited (#174 Judi Abbot,
   * #269 Shannon Hays), and before this column those credits survived only as
   * `change_log` notes.
   *
   * ⚠️ **THE ONE RULE: this value MUST NEVER ENTER `work_key`.** The key is
   * `title|primaryAuthor` and joins ~860 reviews across two catalogs — fold
   * the illustrator in and correcting an illustrator moves the key and
   * orphans reviews. `workKeyFor`'s two-argument signature is the guard.
   * Display and edit only; a free field, never key-moving, never frozen.
   *
   * Null is *unrecorded*, not *none* — most novels stay null and must render
   * as nothing at all (0040's reading of NULL; no not-applicable sentinel,
   * because absence already says it).
   */
  illustrator: string | null;
  /**
   * The shared fictional universe this book belongs to — 'The Cosmere',
   * 'Runnerverse' — or null. Migration 0080.
   *
   * ⚠️ Null is the ORDINARY answer, not a gap. Six universes cover the real
   * cases across the whole catalog; most books are in none and must never render
   * as something to fix. Same rule as `edition_kind` NULL meaning "ordinary".
   */
  universe: string | null;
  /**
   * Who decided — `'list'`, `'human'`, or null for nobody. ⚠️ Read it before
   * overwriting `universe`: `'human'` is an answer nothing may overrule, and it
   * is meaningful with a null universe (a person saying "in no universe").
   */
  universeHow: UniverseSource | null;
  /**
   * **One position in the reading order, printed as more than one book.**
   * Migration 0360. The Words of Radiance two-volume leatherbound is the
   * standing example; "part 1 of 2" printings are the class.
   *
   * ⚠️ **HUMAN-ONLY.** Owner rule 2026-08-19: set by the checkbox in the book
   * edit surface, or by the conductor on his explicit word — never by research,
   * the donor, or any sweep. It is a fact about a PHYSICAL PRINTING, and a
   * model asked about it answers confidently and wrongly for any book with a
   * part-1-of-2 audiobook, a boxed set or an omnibus.
   * `packages/core/test/multi-volume-flag.test.ts` fails the build if a machine
   * path ever gains a way to write it.
   *
   * False is the ordinary answer and means nothing needs doing — it is not a
   * gap, and it must never appear on the details queue.
   */
  multiVolumePrinting: boolean;
  /** When this row was catalogued. Drives the "recently added" view. */
  createdAt: string;
}

export function toWork(row: WorkRow): Work {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    sortTitle: row.sort_title,
    // The one place the stored sentinel becomes an honest null. Its inverse
    // lives in createWork/updateWork; nothing else may spell '?unknown'.
    authors: row.authors === UNKNOWN_AUTHOR ? null : row.authors,
    primaryAuthor: row.primary_author === UNKNOWN_AUTHOR ? null : row.primary_author,
    workKey: row.work_key,
    series: row.series,
    seriesIndexSort: row.series_index_sort,
    seriesIndexDisplay: row.series_index_display,
    firstPublished: row.first_published,
    openlibraryWorkId: row.openlibrary_work_id,
    description: row.description,
    coverUrl: row.cover_url,
    coverStatus: (row.cover_status as CoverStatus | null) ?? null,
    illustrator: row.illustrator,
    universe: row.universe,
    universeHow: (row.universe_how as UniverseSource | null) ?? null,
    multiVolumePrinting: row.multi_volume_printing === 1,
    createdAt: row.created_at,
  };
}

/** The stored pair, read back off a row. */
function assignmentOf(work: Work): UniverseAssignment {
  return { universe: work.universe, how: work.universeHow };
}

const WORK_COLS = `id, title, subtitle, sort_title, authors, primary_author, work_key,
                   series, series_index_sort, series_index_display, first_published,
                   openlibrary_work_id, description, cover_url, cover_status, illustrator,
                   universe, universe_how, multi_volume_printing, created_at, updated_at`;

export async function createWork(
  db: D1Database,
  input: CreateWork,
  /**
   * Who is adding it. Optional so importers keep compiling; absent means
   * `changed_how: 'auto'`, `changed_by: NULL` — recorded, never skipped.
   */
  actor?: Actor,
): Promise<Work> {
  // `null` authors is the deliberate "add without an author" case: the stored
  // column stays NOT NULL by holding the sentinel, and `workKeyFor`'s sentinel
  // branch gives the row a provisional key no real book can collide with.
  const storedAuthors = input.authors ?? UNKNOWN_AUTHOR;
  const author = primaryAuthor(storedAuthors);
  /*
   * ⚠️ **The universe is decided here, from bundled JSON, and costs no I/O.**
   *
   * One Map lookup against `catalog-platform/data/universes.json` as it was at
   * build time — no network call, and emphatically **no model**. The list is
   * curated by hand and refuses an edit that cannot say why it happened; a book
   * arriving on a shelf is not where a universe gets invented. Most books
   * resolve to null and that is the correct answer, not a failure.
   *
   * ⚠️ It reads the **title as well as the series**, and both are load-bearing.
   * Three real cases in this catalog break a series-keyed lookup: *Secret
   * Projects* has four Cosmere books and one that is not, the *Otherlife*
   * trilogy carries no series value at all, and *Fires of December* is a
   * seriesless standalone that is Cosmere. `universeFor` encodes the precedence
   * — exclusions, then title overrides, then series — so the answer never
   * depends on which rule fires first.
   */
  const verse = universeOnCreate(universeIndex, {
    title: input.title,
    series: input.series ?? null,
  });
  const workKey = workKeyFor(input.title, storedAuthors);

  const insert = db
    .prepare(
      `INSERT INTO work (title, subtitle, sort_title, authors, primary_author, work_key,
                         series, series_index_sort, series_index_display, first_published,
                         openlibrary_work_id, description, cover_url, cover_status, illustrator,
                         universe, universe_how)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${WORK_COLS}`,
    )
    .bind(
      input.title,
      input.subtitle ?? null,
      sortTitleFor(input.title),
      storedAuthors,
      author,
      workKey,
      input.series ?? null,
      input.seriesIndexSort ?? null,
      input.seriesIndexDisplay ?? null,
      input.firstPublished ?? null,
      input.openlibraryWorkId ?? null,
      input.description ?? null,
      input.coverUrl ?? null,
      input.coverStatus ?? null,
      input.illustrator ?? null,
      verse.universe,
      verse.how,
    );

  /*
   * Creation logs one `__row__` audit row, in the SAME batch as the insert —
   * atomically or not at all (design §4.2). The id does not exist until the
   * insert runs, so the audit row binds `last_insert_rowid()`, which D1
   * evaluates sequentially on one session within a batch. `new_json` is the
   * app-shape input plus the derived key — everything needed to answer "who
   * added this book and as what". The sentinel is NOT in it: the app shape is
   * `authors: null`.
   */
  const audit = changeLogInsert(db, {
    batchId: crypto.randomUUID(),
    entity: 'work',
    entityId: 'last_insert_rowid()',
    field: ROW_FIELD,
    oldJson: 'null',
    newJson: JSON.stringify({
      title: input.title,
      subtitle: input.subtitle ?? null,
      authors: input.authors ?? null,
      workKey,
      series: input.series ?? null,
      seriesIndexSort: input.seriesIndexSort ?? null,
      seriesIndexDisplay: input.seriesIndexDisplay ?? null,
      firstPublished: input.firstPublished ?? null,
      openlibraryWorkId: input.openlibraryWorkId ?? null,
      description: input.description ?? null,
      coverUrl: input.coverUrl ?? null,
      coverStatus: input.coverStatus ?? null,
      illustrator: input.illustrator ?? null,
      universe: verse.universe,
      universeHow: verse.how,
    }),
    actor,
  });

  const [inserted] = await db.batch<WorkRow>([insert, audit]);
  const res = inserted?.results?.[0];
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
 *
 * ⚠️ And to the universe, with one difference: **`universe_how = 'human'` stops
 * the re-derivation dead.** See `verse` below.
 *
 * ⚠️ **This function moves the key when told to; the ROUTE decides whether it
 * may be told to.** The key-move ceremony — the live Firestore check, the
 * attestation, the evidence floor — lives on `PATCH /api/works/:id`
 * (edit-and-audit-design.md §5). Every change and its audit rows land in one
 * `db.batch()`.
 */
export async function updateWork(
  db: D1Database,
  id: number,
  patch: UpdateWork,
  actor?: Actor,
  /**
   * The note for the `work_key` audit row when the key moves — the route
   * writes 'reviews restamped: N' here, which is one leg of the evidence
   * floor for the NEXT move. Separate from `actor.note` so a general note
   * does not masquerade as a carry record.
   */
  keyMoveNote?: string,
): Promise<Work | null> {
  const current = await getWork(db, id);
  if (!current) return null;

  const title = patch.title ?? current.title;
  // App shape: `null` means unknown; `undefined` means untouched. The stored
  // column gets the sentinel back — the inverse of `toWork`'s mapping.
  const nextAuthors = patch.authors !== undefined ? patch.authors : current.authors;
  const storedAuthors = nextAuthors ?? UNKNOWN_AUTHOR;
  const series = patch.series !== undefined ? patch.series : current.series;

  /**
   * ⚠️ **This is where case two of the owner's ask actually lands.**
   *
   * A scanned book has no series — `ScanLine` has no such field, and a barcode
   * does not carry one — so it is created with whatever its *title* can prove
   * and nothing else. The series arrives later, from `backfill:series` or the
   * details queue, as a PATCH through here. Without re-derivation, "a new book
   * in a series we already know" would resolve for the ebook importer and never
   * once for a book scanned off a shelf.
   *
   * Three cases, and the first is the reason the `how` column exists:
   *
   *   1. the patch names a universe → a person is answering; stamp 'human' and
   *      pin the row. `null` here means *in no universe* and is pinned too
   *   2. `universe_how` is already 'human' → leave it entirely alone, whatever
   *      moved. A title edit must never put the list's opinion back over a
   *      correction the owner made
   *   3. otherwise → re-resolve from the new title and series
   *
   * Costs one Map lookup in cases 2 and 3, and none in case 1.
   */
  const verse =
    patch.universe !== undefined
      ? universeAsserted((name) => canonicalUniverseName(universeIndex, name), patch.universe)
      : universeOnUpdate(universeIndex, assignmentOf(current), { title, series });

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

  // The next app-shape values, used both to bind the UPDATE and to diff for
  // the audit rows — one derivation, so the log cannot disagree with the write.
  const next = {
    title,
    subtitle: patch.subtitle !== undefined ? patch.subtitle : current.subtitle,
    authors: nextAuthors,
    workKey: workKeyFor(title, storedAuthors),
    series,
    seriesIndexSort:
      patch.seriesIndexSort !== undefined ? patch.seriesIndexSort : current.seriesIndexSort,
    seriesIndexDisplay:
      patch.seriesIndexDisplay !== undefined
        ? patch.seriesIndexDisplay
        : current.seriesIndexDisplay,
    firstPublished:
      patch.firstPublished !== undefined ? patch.firstPublished : current.firstPublished,
    openlibraryWorkId:
      patch.openlibraryWorkId !== undefined ? patch.openlibraryWorkId : current.openlibraryWorkId,
    description: patch.description !== undefined ? patch.description : current.description,
    coverUrl: patch.coverUrl !== undefined ? patch.coverUrl : current.coverUrl,
    coverStatus,
    // ⚠️ A free field — it feeds nothing derived, and above all it must never
    // feed `workKeyFor`. Correcting an illustrator moves no key and needs no
    // ceremony; that is the whole design of the column (migration 0130).
    illustrator: patch.illustrator !== undefined ? patch.illustrator : current.illustrator,
    // ⚠️ HUMAN-ONLY (migration 0360). It reaches this object the same way every
    // other field does — the guard is not here, it is that nothing machine-side
    // can BUILD a patch containing it: `applyFinding`'s patch object names four
    // columns, `DETAIL_FIELDS` does not list it, and the donor cannot propose
    // it. `packages/core/test/multi-volume-flag.test.ts` pins all three.
    multiVolumePrinting:
      patch.multiVolumePrinting !== undefined
        ? patch.multiVolumePrinting
        : current.multiVolumePrinting,
    universe: verse.universe,
  };

  /*
   * The audit diff — one row per field that actually changed (design §4.2):
   *   - no-op fields are not logged, or every save is noise;
   *   - derived columns (`sort_title`, `primary_author`, re-derived `universe`)
   *     are not logged — they move mechanically with their inputs. EXCEPT
   *     `work_key`: a key move is the event the whole §5 ceremony exists for,
   *     so it gets its own row, with the carry note;
   *   - `universe` IS logged when a person asserted it (patch named it) —
   *     that is an edit, not a derivation;
   *   - values are logged in APP shape, so the sentinel never appears in the
   *     log a person reads (`authors: null` is the honest spelling).
   */
  const batchId = crypto.randomUUID();
  const diffs: { field: string; oldValue: unknown; newValue: unknown; note?: string | null }[] = [];
  const consider = (field: string, oldValue: unknown, newValue: unknown, note?: string | null) => {
    if (oldValue !== newValue) diffs.push({ field, oldValue, newValue, note: note ?? null });
  };
  consider('title', current.title, next.title);
  consider('subtitle', current.subtitle, next.subtitle);
  consider('authors', current.authors, next.authors);
  consider('work_key', current.workKey, next.workKey, keyMoveNote ?? actor?.note ?? null);
  consider('series', current.series, next.series);
  consider('seriesIndexSort', current.seriesIndexSort, next.seriesIndexSort);
  consider('seriesIndexDisplay', current.seriesIndexDisplay, next.seriesIndexDisplay);
  consider('firstPublished', current.firstPublished, next.firstPublished);
  consider('openlibraryWorkId', current.openlibraryWorkId, next.openlibraryWorkId);
  consider('description', current.description, next.description);
  consider('coverUrl', current.coverUrl, next.coverUrl);
  consider('coverStatus', current.coverStatus, next.coverStatus);
  consider('illustrator', current.illustrator, next.illustrator);
  consider('multiVolumePrinting', current.multiVolumePrinting, next.multiVolumePrinting);
  if (patch.universe !== undefined) consider('universe', current.universe, next.universe);

  const update = db
    .prepare(
      `UPDATE work SET
         title = ?, subtitle = ?, sort_title = ?, authors = ?, primary_author = ?, work_key = ?,
         series = ?, series_index_sort = ?, series_index_display = ?, first_published = ?,
         openlibrary_work_id = ?, description = ?, cover_url = ?, cover_status = ?,
         illustrator = ?, universe = ?, universe_how = ?, multi_volume_printing = ?,
         updated_at = datetime('now')
       WHERE id = ?
       RETURNING ${WORK_COLS}`,
    )
    .bind(
      next.title,
      next.subtitle,
      sortTitleFor(next.title),
      storedAuthors,
      primaryAuthor(storedAuthors),
      next.workKey,
      next.series,
      next.seriesIndexSort,
      next.seriesIndexDisplay,
      next.firstPublished,
      next.openlibraryWorkId,
      next.description,
      next.coverUrl,
      next.coverStatus,
      next.illustrator,
      verse.universe,
      verse.how,
      next.multiVolumePrinting ? 1 : 0,
      id,
    );

  const statements: D1PreparedStatement[] = [
    update,
    ...diffs.map((d) =>
      changeLogInsert(db, {
        batchId,
        entity: 'work',
        entityId: id,
        field: d.field,
        oldJson: JSON.stringify(d.oldValue === undefined ? null : d.oldValue),
        newJson: JSON.stringify(d.newValue === undefined ? null : d.newValue),
        actor,
        // The work_key row carries the carry note ('reviews restamped: N');
        // ordinary field rows carry the actor's general note when there is one
        // ('finding 412' on an auto-apply), else nothing.
        note: d.field === 'work_key' ? d.note : (actor?.note ?? null),
      }),
    ),
  ];

  const [updated] = await db.batch<WorkRow>(statements);
  const row = updated?.results?.[0];
  return row ? toWork(row) : null;
}

/**
 * Delete a work — and log the whole row as the undo material.
 *
 * The audit row is deliberately NOT a foreign key (migration 0120), so it
 * survives the row it describes: "who deleted this, and what did it say?" is
 * the question an audit log most exists to answer. `old_json` is the app-shape
 * row (`authors: null` for a provisional book, never the sentinel).
 *
 * ⚠️ **The cascade casualties are logged too, one `__row__` row each.** The
 * database deletes this work's editions and copies the moment the work goes
 * (`ON DELETE CASCADE`, migration 0001), and before this the log recorded only
 * the work — the four raw-SQL deletions already in production (works 284, 299
 * among them) took their editions and copies down with no record at all. Every
 * child row now lands in the SAME batch, under the SAME batch_id, so the
 * Changes reader shows one event and the undo material is the whole subtree,
 * not just its root. Raw row shape for editions and copies — identical to what
 * `deleteEdition`/`deleteCopy` log, so a reader of `__row__` rows meets one
 * shape per entity however the row died.
 *
 * ⚠️ This function deletes when told to; the ROUTE decides whether it may be
 * told to. The owned-copies refusal lives on `DELETE /api/works/:id` — same
 * split as the key-move gate on PATCH.
 */
export async function deleteWork(db: D1Database, id: number, actor?: Actor): Promise<boolean> {
  const row = await db
    .prepare(`SELECT ${WORK_COLS} FROM work WHERE id = ?`)
    .bind(id)
    .first<WorkRow>();
  if (!row) return false;

  const [editions, copies] = await Promise.all([
    listEditionsForWork(db, id),
    listCopiesForWork(db, id),
  ]);

  const batchId = crypto.randomUUID();
  const del = db.prepare('DELETE FROM work WHERE id = ?').bind(id);
  const statements: D1PreparedStatement[] = [
    del,
    changeLogInsert(db, {
      batchId,
      entity: 'work',
      entityId: id,
      field: ROW_FIELD,
      oldJson: JSON.stringify(toWork(row)),
      newJson: 'null',
      actor,
    }),
    ...editions.map((e) =>
      changeLogInsert(db, {
        batchId,
        entity: 'edition',
        entityId: e.id,
        field: ROW_FIELD,
        oldJson: JSON.stringify(e),
        newJson: 'null',
        actor,
        // The note says HOW it died: nobody pressed delete on this edition,
        // it went because its work did. Rendered verbatim by the Changes panel.
        note: `cascade: work #${id} deleted`,
      }),
    ),
    ...copies.map((c) =>
      changeLogInsert(db, {
        batchId,
        entity: 'copy',
        entityId: c.id,
        field: ROW_FIELD,
        oldJson: JSON.stringify(c),
        newJson: 'null',
        actor,
        note: `cascade: work #${id} deleted`,
      }),
    ),
  ];

  const [res] = await db.batch(statements);
  return ((res?.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
}

/** One copy, as the deletion preview shows it — enough to recognise the object. */
export interface WorkDeletionCopy {
  id: number;
  status: string;
  isSigned: boolean;
  location: string | null;
  lentTo: string | null;
  editionId: number | null;
  editionNotes: string | null;
}

/** A named count of rows that go with the work — only non-zero ones are listed. */
export interface WorkDeletionTrace {
  what: string;
  rows: number;
}

/**
 * Everything `DELETE /works/:id` would destroy — computed BEFORE it happens.
 *
 * The confirmation dialog renders this, and the DELETE route recomputes it
 * rather than trusting the client's copy: the report a person saw and the
 * state the delete acts on can drift in the seconds between.
 */
export interface WorkDeletionReport {
  workId: number;
  title: string;
  /** Printings destroyed by the cascade. */
  editions: number;
  /** Every copy row, so a person can recognise each object before it goes. */
  copies: WorkDeletionCopy[];
  /**
   * The copies that stop deletion outright — everything but a plain wish.
   * `copyBlocksDeletion` in `@lc/core` is the rule and says why (#139).
   */
  blockers: WorkDeletionCopy[];
  /** Other rows the cascade takes, named: read states, watches, aliases… */
  traces: WorkDeletionTrace[];
  /**
   * Does anything in D1 say reviews exist for this book? Reviews live in
   * Firestore keyed by `work_key` and are NOT deleted with the work — but
   * deleting the shelf-side join means this catalog forgets the book they
   * attach to. Worth a sentence in the dialog, not a refusal: re-adding the
   * book under the same title and author reattaches them.
   */
  reviewEvidence: boolean;
}

function toDeletionCopy(c: CopyRow): WorkDeletionCopy {
  return {
    id: c.id,
    status: c.status,
    isSigned: c.is_signed === 1,
    location: c.location,
    lentTo: c.lent_to,
    editionId: c.edition_id,
    editionNotes: c.edition_notes,
  };
}

export async function workDeletionReport(
  db: D1Database,
  id: number,
): Promise<WorkDeletionReport | null> {
  const work = await getWork(db, id);
  if (!work) return null;

  const [copies, counts, evidence] = await Promise.all([
    listCopiesForWork(db, id),
    db
      .prepare(
        // Scalar subqueries, one round trip. Every table here is ON DELETE
        // CASCADE from work (0001, 0004, 0007, 0010, 0020, 0021, 0040) — this
        // is the list of what silently goes with the row, written out so the
        // dialog can say it instead of the person discovering it afterwards.
        `SELECT
           (SELECT COUNT(*) FROM edition            WHERE work_id = ?1)                        AS editions,
           (SELECT COUNT(*) FROM user_book          WHERE work_id = ?1)                        AS read_states,
           (SELECT COUNT(*) FROM work_watch         WHERE work_id = ?1)                        AS watches,
           (SELECT COUNT(*) FROM work_alias         WHERE work_id = ?1)                        AS aliases,
           (SELECT COUNT(*) FROM work_relation      WHERE from_work_id = ?1 OR to_work_id = ?1) AS relations,
           (SELECT COUNT(*) FROM book_accessory     WHERE work_id = ?1)                        AS accessories,
           (SELECT COUNT(*) FROM pledge_item        WHERE work_id = ?1)                        AS pledge_items,
           (SELECT COUNT(*) FROM audiobook_holding  WHERE work_id = ?1)                        AS audiobook,
           (SELECT COUNT(*) FROM gap_verdict        WHERE work_id = ?1)                        AS verdicts`,
      )
      .bind(id)
      .first<{
        editions: number;
        read_states: number;
        watches: number;
        aliases: number;
        relations: number;
        accessories: number;
        pledge_items: number;
        audiobook: number;
        verdicts: number;
      }>(),
    keyMoveEvidence(db, id),
  ]);

  const copyViews = copies.map(toDeletionCopy);

  // Named as a person would say them; zero-row entries dropped so the dialog
  // lists what IS at stake rather than a wall of zeroes.
  const traces: WorkDeletionTrace[] = [
    { what: 'read states', rows: counts?.read_states ?? 0 },
    { what: 'watches', rows: counts?.watches ?? 0 },
    { what: 'alternate titles', rows: counts?.aliases ?? 0 },
    { what: 'links to related books', rows: counts?.relations ?? 0 },
    { what: 'accessories', rows: counts?.accessories ?? 0 },
    { what: 'crowdfunding reward links', rows: counts?.pledge_items ?? 0 },
    { what: 'audiobook holding', rows: counts?.audiobook ?? 0 },
    { what: 'research verdicts', rows: counts?.verdicts ?? 0 },
  ].filter((t) => t.rows > 0);

  return {
    workId: id,
    title: work.title,
    editions: counts?.editions ?? 0,
    copies: copyViews,
    blockers: deletionBlockers(copyViews),
    traces,
    reviewEvidence: evidenceSaysReviews(evidence),
  };
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

interface AudiobookHoldingRow {
  title: string;
  raw_title: string | null;
  authors: string | null;
  series: string | null;
  index_display: string | null;
  cover_href: string | null;
  matched_via: string;
  title_similarity: number | null;
  stale_at: string | null;
}

/**
 * What the sibling audiobook catalog holds for this WORK — migration 0010.
 *
 * ⚠️ **Not the same shape as `AudiobookRef` in `series.ts`.** That one is the
 * series ladder's chip and only carries enough to render a hedge; this is the
 * whole row the work page shows, so `authors` and `coverHref` ride along too.
 * The two are read separately because the ladder's query also filters
 * `stale_at IS NULL` (a chip has no room to explain a stale match) while this
 * one deliberately does NOT — the work page shows a stale holding with a
 * muted note rather than making it look identical to "no match at all".
 */
export interface AudiobookHolding {
  /** Their title, already stripped of Audible's decoration. Show it when it
   *  differs from ours — that difference is the point of storing it. */
  title: string;
  /**
   * Their title **verbatim**, decoration and all — migration 0340.
   *
   * ⚠️ **This, not `title`, is the content-warning key.** `content_warnings.json`
   * and the audiobook site's own book page are both keyed off the raw catalog
   * string, so `bookIdFromTitle(title)` reproduces their id only for a row that
   * happened to carry no decoration. `warningKeysFor` takes this one.
   *
   * Null on any row not re-run since 0340 landed. Null means **not recorded**,
   * never "same as `title`", and every reader falls back rather than assuming.
   */
  rawTitle: string | null;
  authors: string | null;
  /** That catalog's own series spelling and volume — deliberately not folded
   *  to ours. See migration 0010's header. */
  series: string | null;
  indexDisplay: string | null;
  /** Relative to `audiobook_catalog/site/`, e.g. `covers/Author/Title.jpg`.
   *  Resolve against the sibling's own cover bucket (`covers.heygabi.ai`),
   *  never this catalog's — see `resolveAudiobookCover` in the web app. */
  coverHref: string | null;
  /** 'exact' | 'alias' | 'containment' — shown, never hidden. A containment
   *  match is a claim and must read as one. See migration 0010. */
  matchedVia: string;
  titleSimilarity: number | null;
  /** Marked, never deleted. Non-null means the sibling catalog no longer
   *  agrees; render the section with a "may be out of date" note, not nothing. */
  staleAt: string | null;
}

/**
 * The work's audio holding, or null when the sibling catalog has none for it.
 *
 * ⚠️ Null is the ordinary case for most of this catalog — most books here have
 * no audiobook counterpart — and a work page must render nothing for it, the
 * same rule `universe: null` and `coverStatus: null` already follow.
 *
 * `work_id` is `audiobook_holding`'s primary key (migration 0010), so this is
 * at most one row.
 */
export async function getAudiobookHolding(
  db: D1Database,
  workId: number,
): Promise<AudiobookHolding | null> {
  const row = await db
    .prepare(
      `SELECT title, raw_title, authors, series, index_display, cover_href, matched_via,
              title_similarity, stale_at
         FROM audiobook_holding
        WHERE work_id = ?`,
    )
    .bind(workId)
    .first<AudiobookHoldingRow>();
  if (!row) return null;
  return {
    title: row.title,
    rawTitle: row.raw_title,
    authors: row.authors,
    series: row.series,
    indexDisplay: row.index_display,
    coverHref: row.cover_href,
    matchedVia: row.matched_via,
    titleSimilarity: row.title_similarity,
    staleAt: row.stale_at,
  };
}

interface EbookHoldingRow {
  formats: string;
  source_path: string | null;
  edition_source: string;
  derived_via: string;
  stale_at: string | null;
}

/**
 * What the shared household pool holds for this WORK as an ebook — migration
 * 0310, `audiobook_holding`'s ebook twin.
 *
 * ⚠️ Phase 4 of the ebook split: this cache runs BESIDE the edition-derived
 * answer, not instead of it. The work page shows both and says whether they
 * agree (`ebookAgreement` in `@lc/core`), which is the visible evidence phase
 * 5's edition-pruning is gated on. Like `getAudiobookHolding` above, this
 * deliberately does NOT filter `stale_at` — the page shows a stale holding
 * with a caveat rather than making it look identical to "no holding at all".
 */
export interface EbookHolding {
  /** Manifest-spelling formats ('epub', 'pdf'), split from the stored list. */
  formats: string[];
  /** Manifest-relative path of the file, or null for the hand-added edition. */
  sourcePath: string | null;
  /** 'file' | 'manual' — provenance of the deriving edition. Shown, never hidden. */
  editionSource: string;
  /** 'edition' today; 'manifest' after phase 5. See migration 0310. */
  derivedVia: string;
  /** Non-null means no edition backs this any more. Render with a note, not nothing. */
  staleAt: string | null;
}

/**
 * The work's ebook holding, or null when the pool cache has none for it.
 *
 * Null is the ordinary case — most of this catalog is physical-only — and the
 * page renders nothing for it, the same rule `getAudiobookHolding` follows.
 * `work_id` is `ebook_holding`'s primary key, so this is at most one row.
 */
export async function getEbookHolding(
  db: D1Database,
  workId: number,
): Promise<EbookHolding | null> {
  const row = await db
    .prepare(
      `SELECT formats, source_path, edition_source, derived_via, stale_at
         FROM ebook_holding
        WHERE work_id = ?`,
    )
    .bind(workId)
    .first<EbookHoldingRow>();
  if (!row) return null;
  return {
    formats: row.formats.split(',').map((f) => f.trim()).filter(Boolean),
    sourcePath: row.source_path,
    editionSource: row.edition_source,
    derivedVia: row.derived_via,
    staleAt: row.stale_at,
  };
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
   * `'hide'` — drop the works this catalog holds ONLY as an ebook file.
   *
   * ⚠️ **This is not `medium=physical` and must never be replaced by it.**
   * `MEDIUM_CLAUSE.physical` asks "does a physical *edition row* exist", and
   * measured against the live database on 2026-08-18 that is a different set:
   * **6 works have no `edition` row at all and a `copy` anyway** — five of them
   * catalogued that morning — because `copy.work_id` is denormalised precisely
   * so "a copy can exist before its exact printing is known", which is the
   * ordinary case when a spine photo made the row. Filtering the shelf by
   * `medium=physical` would have hidden the owner's four newest books to remove
   * two ebooks. See `EBOOK_ONLY_CLAUSE` for the predicate that does not.
   *
   * `undefined` is the default and nothing is hidden — every other surface in
   * this app (the collection grid, the facets, `medium=ebook`, the series and
   * universe pages) still sees every row, because those rows are real data that
   * cross-catalog features read. This narrows a *view*, it deletes nothing.
   */
  ebookOnly?: string | undefined;
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
  /**
   * The works belonging to the chosen fictional universe, **already resolved**.
   *
   * ⚠️ Ids and not a name, and this package deliberately does not know what a
   * universe is. The list lives in another repo (`catalog-platform`), it is
   * keyed on series names and exact titles rather than on any column here, and
   * exclusions have to be checked before overrides — all of which is
   * implemented once, in `@lc/universes`. Expressing it again as SQL would make
   * the same decision exist in a third language, which is the class of bug this
   * estate has already shipped once (see the header of
   * `packages/universes/src/catalog.ts`).
   *
   * So the caller resolves and hands over ids. `listUniverseKeys` below is what
   * it reads to do that, and it applies every *other* clause in this query, so
   * the ids arrive already narrowed by the rest of the filter.
   *
   * ⚠️ An empty array means "that universe holds nothing here" and returns no
   * rows. `undefined` means nobody asked. They are not the same, and collapsing
   * them turns an empty universe into the whole collection.
   */
  universeIds?: readonly number[] | undefined;
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
 * "This book is not one we hold ONLY as an ebook file", as SQL.
 *
 * ## Why this exists at all
 *
 * Ebooks moved to their own site (`ebooks.heygabi.ai`) — the shared-pool side,
 * where the household's ebook files already live. `catalog-platform`'s
 * `docs/info/ebook-split-design.md` §3 plans for this catalog's ebook rows to be
 * demoted to a holding cache and then **pruned**; phases 1–4 have shipped and
 * phase 5 (the export-and-delete) has not. So the rows are still here, and the
 * "Recently added" strip was showing them — owner, 2026-08-18: *"in the library
 * site its showing recently added for ebooks, remove those. this should just be
 * physical books now since we have an ebook site."*
 *
 * This is the **display** answer to that, deliberately not the data one. Phase 5
 * deletes rows after an export and a `--force-prune` ceremony; that is a
 * migration a person performs, not something a filter should pre-empt. Until it
 * runs, the rows keep serving the cross-catalog joins that read them (series and
 * universe pages, `ebook_holding`, the "also as an ebook" chip), and this clause
 * keeps them off the one surface the owner asked about.
 *
 * ## The predicate, and why it is not `medium=physical`
 *
 * "Ebook-only" is the split design's own definition, from its §1 census: **has
 * an ebook edition, has no physical edition, and has no copy.** All three
 * conjuncts are load-bearing.
 *
 * Measured on the live database, 2026-08-18 04:55Z (the same SELECTs §1
 * records, re-run):
 *
 * | | |
 * |---|---|
 * | works | 387 |
 * | works with a physical edition | 287 |
 * | works with NO edition row at all | **6** — every one of them has a copy |
 * | **ebook-only works** | **94** |
 * | ebook editions | 127 |
 * | works this clause shows | **293** |
 *
 * 287 + 6 = 293 = 387 − 94, which is the arithmetic that says the three
 * conjuncts partition the catalog the way this clause claims.
 *
 * ⚠️ **The totals move and the ebook figures do not** — 25 works arrived during
 * the twenty minutes this was being written (362 → 387; the owner was
 * cataloguing) while `ebook_only` stayed 94 and `ebook_editions` stayed 127.
 * That is the expected shape: the ebook rows are a closed 2026-08-09 import with
 * no producer left pointed at this catalog. If a re-run ever finds those two
 * numbers *growing*, the ingest is back on and this filter is treating a
 * symptom — check `EBOOK_INGEST_TOKEN` before widening anything here.
 *
 * ⚠️ **The `copy` conjunct is what makes it safe, and the 6 are why.** A work
 * with a copy and no edition row is a physical book somebody photographed before
 * anybody typed its printing in — `copy`'s schema comment says so — and five of
 * those six were catalogued in the hour this shipped, so they were *in* the
 * strip. `medium=physical` would have deleted them from it. A predicate that
 * removes the newest books to remove the unwanted ones is worse than the bug.
 *
 * ⚠️ **Excluding, not selecting.** It removes only what is provably ebook-only,
 * so a work with no editions and no copies at all — none exist today — stays.
 * The failure mode of a mis-measured row is that it is still shown, which is
 * the right way round for a shelf.
 *
 * A fixed map keyed by a short vocabulary, like `MEDIUM_CLAUSE`, `KIND_CLAUSE`
 * and `NEEDS_CLAUSE`: an unrecognised value adds no clause rather than erroring,
 * so a stale link shows the collection.
 *
 * ⚠️ **Exported only so `packages/db/test/ebook-only-clause.test.ts` can run
 * this exact SQL text against a real SQLite** — the sibling clauses are private
 * and stay that way. A predicate whose whole job is to decide which of the
 * owner's books he can see is one to exercise rather than reason about, and the
 * six copy-without-an-edition rows are precisely the case a reader nods past.
 */
export const EBOOK_ONLY_CLAUSE: Record<string, string> = {
  hide:
    `NOT (EXISTS (SELECT 1 FROM edition e
                   WHERE e.work_id = w.id AND e.format NOT IN (${PHYSICAL_PLACEHOLDERS}))
          AND NOT EXISTS (SELECT 1 FROM edition e
                            WHERE e.work_id = w.id AND e.format IN (${PHYSICAL_PLACEHOLDERS}))
          AND NOT EXISTS (SELECT 1 FROM copy c WHERE c.work_id = w.id))`,
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
/**
 * "Still needs an author" — migration 0120. ⚠️ DERIVED from the value, not a
 * stored flag: `authors = '?unknown'` IS the remediation queue, so the mark
 * and the fact cannot diverge (0040's rule, the way `NEEDS_COVER` derives from
 * the cover columns rather than storing "needs a cover"). The sentinel is
 * inlined as a literal — it is a constant written in `@lc/core`, never caller
 * text — and `idx_work_unknown_author` is the partial index for exactly this
 * clause.
 */
const NEEDS_AUTHOR = `w.authors = '${UNKNOWN_AUTHOR}'`;

const NEEDS_CLAUSE: Record<string, string> = {
  cover: NEEDS_COVER,
  watch: NEEDS_WATCH,
  author: NEEDS_AUTHOR,
  any: `(${NEEDS_COVER} OR ${NEEDS_WATCH} OR ${NEEDS_AUTHOR})`,
};

/**
 * "Is one of these works", as SQL. See `CollectionQuery.universeIds`.
 *
 * ⚠️ **Inlined rather than bound, and that is not a shortcut.** D1 caps a
 * statement at 100 bound parameters; The Cosmere alone can supply more ids than
 * that as the shelf grows, and a filter that starts erroring at book 101 is a
 * trap laid for later. Inlining is safe here for the reason `KIND_CLAUSE` and
 * `NEEDS_CLAUSE` are literals: no caller text reaches the statement. These are
 * integers this database issued, filtered through `Number.isInteger` on the way
 * past — a non-integer cannot survive the join.
 *
 * `0 = 1` for the empty case, because `w.id IN ()` is not valid SQLite and
 * "this universe holds nothing here" must return nothing rather than
 * everything.
 */
function universeClause(ids: readonly number[]): string {
  const safe = ids.filter((id) => Number.isInteger(id));
  return safe.length === 0 ? '0 = 1' : `w.id IN (${safe.join(', ')})`;
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
  // Coarse before fine, so the binds land in the order the SQL text reads them.
  // An unrecognised medium adds no clause rather than erroring — same rule the
  // sort allowlist follows, because a stale bookmark should show the collection.
  const medium = query.medium ? MEDIUM_CLAUSE[query.medium] : undefined;
  if (medium) {
    where.push(medium);
    binds.push(...PHYSICAL_FORMATS);
  }
  // Immediately after the medium clause so the binds land in the order the SQL
  // text reads them — this one spells `PHYSICAL_FORMATS` twice, once per EXISTS.
  // It composes with everything above rather than replacing anything: it is a
  // narrowing of the *view*, not an axis somebody chose. See `EBOOK_ONLY_CLAUSE`.
  const ebookOnly = query.ebookOnly ? EBOOK_ONLY_CLAUSE[query.ebookOnly] : undefined;
  if (ebookOnly) {
    where.push(ebookOnly);
    binds.push(...PHYSICAL_FORMATS, ...PHYSICAL_FORMATS);
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
  // No binds — see `universeClause`. `undefined` adds no clause (nobody asked,
  // or the name was not one of the six); an empty array adds `0 = 1`.
  if (query.universeIds) where.push(universeClause(query.universeIds));
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
              -- ⚠️ HELD_STATUSES, not 'owned' alone. ownedMoreThanOnce in @lc/core
              -- counts owned + lent, and the card's x2 mark reads this column, so
              -- counting only 'owned' here would make the badge and the series
              -- page disagree about the same book. A lent copy is still ours.
              -- (No backticks in here: this is inside a template literal.)
              (SELECT COUNT(*) FROM copy c
                WHERE c.work_id = w.id AND c.status IN ('owned','lent')) AS copy_count,
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

/** The two columns the universe lookup reads, plus the id it answers about. */
export interface UniverseKeyRow {
  id: number;
  title: string;
  series: string | null;
}

/**
 * Every work the rest of the filter allows, as `(id, title, series)`.
 *
 * The read half of `CollectionQuery.universeIds`: the caller resolves these
 * rows through `@lc/universes` and hands the ids back. Three columns and no
 * joins, so it is cheap over a catalog this size — 116 rows locally, a few
 * hundred in production — and it is only asked for when a universe control is
 * on screen or a universe filter is applied.
 *
 * ⚠️ **It drops the universe clause itself**, exactly as `collectionFacets`
 * drops the series, medium, needs and kind clauses before counting them. Two
 * consequences, both wanted: a universe *facet* counts what picking it would
 * actually give you rather than what is already showing, and the ids fed back
 * into `universeIds` are already narrowed by every other filter, so the AND
 * that follows is a no-op rather than a second opinion.
 */
export async function listUniverseKeys(
  db: D1Database,
  query: CollectionQuery,
): Promise<UniverseKeyRow[]> {
  const { sql, binds } = collectionFilter({ ...query, universeIds: undefined });
  const { results } = await db
    .prepare(`SELECT w.id, w.title, w.series FROM work w ${sql}`)
    .bind(...binds)
    .all<UniverseKeyRow>();
  return results;
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
  needs: { cover: number; watch: number; author: number };
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
  /**
   * ⚠️ There is deliberately no `universes` field here, even though the
   * collection has a universe filter and the API response carries the counts.
   *
   * This package does not depend on `@lc/universes`, and that is the one thing
   * keeping the cross-repo build dependency contained: `@lc/universes` is the
   * only package here that reads another checkout, and making the database
   * layer import it would put catalog-platform behind every query in the app.
   * The worker composes the two instead — see `apps/worker/src/lib/universes.ts`
   * and the `/collection/facets` route, which spreads this object and adds one
   * more key.
   */
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
            SUM(CASE WHEN ${NEEDS_WATCH} THEN 1 ELSE 0 END) AS watch,
            SUM(CASE WHEN ${NEEDS_AUTHOR} THEN 1 ELSE 0 END) AS author
           FROM work w ${withoutNeeds.sql}`,
      )
      .bind(...withoutNeeds.binds)
      .first<{ cover: number | null; watch: number | null; author: number | null }>(),
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
    needs: { cover: needs?.cover ?? 0, watch: needs?.watch ?? 0, author: needs?.author ?? 0 },
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
  // ⚠️ `copies` counts HELD_STATUSES, not `status = 'owned'` alone.
  //
  // `heldCopies` in @lc/core is the one definition of "an object we have", and
  // it deliberately counts a lent book — two of it still left the house. This
  // figure read `'owned'` only until 2026-08-12, so lending a book would have
  // silently shrunk the shelf total while the ×N mark beside that same book —
  // built on `heldCopies` — kept saying two. No row is `lent` today, so the
  // number does not move; the disagreement was simply waiting for a first loan.
  //
  // ⚠️ Keep this expression OUT of the SQL comment. The query is a template
  // literal, and a backtick in a `-- comment` closes it — that mistake is what
  // broke the build the first time this note was written.
  const [totals, formats, readStates] = await Promise.all([
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM work) AS works,
                (SELECT COUNT(*) FROM edition) AS editions,
                -- HELD_STATUSES, not 'owned' alone. See the note above.
                (SELECT COUNT(*) FROM copy
                  WHERE status IN (${HELD_STATUSES.map((s) => `'${s}'`).join(', ')})) AS copies,
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

/**
 * Every work, reduced to what the duplicate finder compares and shows.
 *
 * ## Why this is a plain read and not a `GROUP BY`
 *
 * The fold that decides a duplicate is `duplicateKeyFor` in `@lc/core`, which
 * runs `cleanTitleWithSeries` — a stack of regexes measured against the real
 * catalog — over the title. There is no SQL expression for it, and writing one
 * would put the same decision in a second language, which is the class of bug
 * this estate has already shipped once (`packages/core/src/matching.ts`'s
 * header, and `listUniverseKeys` two functions up, which resolves in JavaScript
 * for exactly the same reason).
 *
 * ⚠️ **The board-game catalog CAN express its version in SQL, and that is not
 * an argument that this one should.** Its `duplicates` filter asks "does this
 * tree hold more than one of something" — `HAVING SUM(quantity) > 1` over the
 * copy table (`packages/db/src/items.ts:379` there). A count of rows is SQL's
 * natural shape; a folded string comparison is not.
 *
 * So the whole table comes back and JavaScript groups it. That is affordable
 * and stays affordable: five columns over ~1,100 works, against the megabyte a
 * page of whole works costs. If this catalog ever reaches a size where it is
 * not, the fold moves into a stored, migrated column — never into a second
 * implementation of the regexes.
 *
 * ⚠️ `authors` is handed over **raw, sentinel included** — not through
 * `toWork`, which turns `UNKNOWN_AUTHOR` into an honest `null`. `workKeyFor`
 * needs the sentinel: it is the entire collision proof that keeps authorless
 * books from folding onto each other and onto real "Unknown"-credited ones.
 */
export async function listDuplicateCandidates(
  db: D1Database,
): Promise<{ candidates: DuplicateCandidate[]; totalWorks: number }> {
  const { results } = await db
    .prepare(
      `SELECT w.id, w.title, w.subtitle, w.authors, w.series,
              (SELECT COUNT(*) FROM copy c
                WHERE c.work_id = w.id
                  AND c.status IN (${HELD_STATUSES.map((s) => `'${s}'`).join(', ')})) AS copy_count
         FROM work w`,
    )
    .all<{
      id: number;
      title: string;
      subtitle: string | null;
      authors: string;
      series: string | null;
      copy_count: number;
    }>();

  return {
    totalWorks: results.length,
    candidates: results.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      authors: r.authors,
      series: r.series,
      copyCount: r.copy_count,
    })),
  };
}
