/**
 * Leaf module: a barcode that resolved to a book the catalog already holds,
 * carrying an ISBN no printing on file has — and what to ask about it.
 *
 * Imports `constants.ts` only. No I/O.
 *
 * ## ⚠️ The defect this replaces, and why the answer is a question
 *
 * `addLineToCatalog` used to handle this case silently: match the work, write a
 * brand-new edition wearing the scanned ISBN, write a new copy. Both writes are
 * wrong for the commonest reason the barcode is not on file — **the printing is
 * already in the catalog, recorded before anyone had the barcode**. Production
 * carries 60+ such rows on purpose (crowdfunded printings, slipcase volumes,
 * everything in `docs/isbn-barcode-worklist.md`), and the documented promise on
 * every one of them is "a barcode scan will fill it in later". The silent path
 * turned that promise into a duplicate: rescanning the nine slipcase volumes
 * would have produced nine phantom editions and nine phantom copies. Residue of
 * exactly this shape is already live — work #139 holds an Open Library
 * hardcover beside the `manual` ISBN-less row that describes the same object.
 *
 * Exactly four things can be true, and nothing the catalog knows can tell them
 * apart — which is the same argument `preorders.ts` makes, and this module is
 * deliberately that module's shape applied to a second case:
 *
 * | The person says | What must be written |
 * |---|---|
 * | **the book I already have** | `isbn13` onto the ISBN-less row. **No new rows.** |
 * | **a second copy of it** | one new `copy` (and the ISBN, which is new information either way) |
 * | **a different printing I own** | a new `edition` + a new `copy` on the same work |
 * | **a different book** | a new work — the match was a name collision |
 *
 * Guess the first as the third and every rescan mints a duplicate printing.
 * Guess the third as the first and a real second printing is erased into the
 * first one's row. So the add path stops and asks, exactly as it already stops
 * for a pre-order on file.
 *
 * ## ⚠️ The blank ISBN is not an error state
 *
 * Seven slipcase volumes are ISBN-less **deliberately** — the set's ISBN lives
 * in `edition_name`, per the slipcase precedent. A rescan *offers* to fill
 * them; nothing here treats their blankness as a defect to be repaired without
 * asking.
 */

import { isPhysicalFormat } from './constants.js';

/** The slice of an edition row this module needs to decide. */
export interface RescanEdition {
  id: number;
  format: string;
  isbn13: string | null;
}

/** The slice of a copy row this module needs. */
export interface RescanCopy {
  id: number;
  status: string;
  edition_id: number | null;
}

/**
 * What there is to offer, computed from the work's own rows.
 *
 * Pure and testable; the web app adds labels and the network. The decisions:
 *
 * - `fillTargets` — ISBN-less **physical** editions, because those are the rows
 *   the barcode could belong to. Ebook rows are excluded twice over: a print
 *   ISBN on an epub row is a wrong fact (recorded decision, isbn-ladder.md),
 *   and nobody scans a barcode off a file.
 * - `bareCopy` — the shelf holds owned copies but no physical printing row at
 *   all (a spine-added book). "This is my copy" then *creates* the row and
 *   links the copy, which is the moment "which printing is this?" finally
 *   becomes answerable.
 * - `linkCopyId` — the one owned copy with no `edition_id`, **only when it is
 *   unambiguous**. Two unlinked copies would mean guessing which object the
 *   person is holding, and this codebase does not guess; they stay unlinked
 *   and the copies panel can sort it out.
 * - `shouldAsk` — false when the work has no physical presence at all, which
 *   is the paperback-of-an-ebook case: adding the *first* physical printing is
 *   what Add means there, and a question would cost a tap to confirm nothing.
 */
export interface RescanChoices {
  fillTargets: RescanEdition[];
  bareCopy: boolean;
  linkCopyId: number | null;
  shouldAsk: boolean;
}

export function rescanChoices(
  editions: readonly RescanEdition[],
  copies: readonly RescanCopy[],
): RescanChoices {
  const physical = editions.filter((e) => isPhysicalFormat(e.format));
  const owned = copies.filter((c) => c.status === 'owned');
  const unlinked = owned.filter((c) => c.edition_id === null);

  return {
    fillTargets: physical.filter((e) => e.isbn13 === null),
    bareCopy: physical.length === 0 && owned.length > 0,
    linkCopyId: unlinked.length === 1 ? unlinked[0]!.id : null,
    shouldAsk: physical.length > 0 || owned.length > 0,
  };
}

/**
 * ⚠️ **The answer, and the only shapes it may take.** Each one names its writes.
 *
 * `linkCopyId` rides on the answers that repair the existing shelf rather than
 * being re-derived at write time, because the answer is a button press against
 * the question that was actually shown — re-deriving could link a copy the
 * person never saw offered.
 */
export type RescanAnswer =
  /**
   * "The book I already have." `editionId` null means no printing row existed
   * (a spine-added book) and one is created for the copy; otherwise the ISBN
   * lands on that row. Never a new copy — the object was already counted.
   */
  | { kind: 'fill'; editionId: number | null; linkCopyId: number | null }
  /**
   * The UNIQUE index said another row already holds this ISBN, and the person
   * chose the slipcase treatment: the fact goes into THIS row's
   * `edition_name`, the ISBN stays where it is. This is the Realmkeeper case —
   * 16 edition rows describing 8 physical omnibus volumes, where one barcode
   * can only ever live on one of a volume's two rows.
   */
  | { kind: 'fill-note'; editionId: number; holderTitle: string | null }
  /**
   * "A second copy of that edition." One new copy, linked. `alsoFillIsbn` is
   * set when the chosen edition is ISBN-less — saying "this barcode is that
   * edition, and I have two" records both facts.
   */
  | { kind: 'extra-copy'; editionId: number | null; alsoFillIsbn: boolean }
  /** "A different printing I own." New edition wearing the ISBN, new copy. */
  | { kind: 'new-printing' }
  /** "A different book that happens to match by name." A new work entirely. */
  | { kind: 'different-book' };

/**
 * What to say to somebody standing there with the book. One sentence, no
 * verdict, no default — the standing rule (`preorderSentence`, `overlapSentence`):
 * *tell me, then let me decide.*
 */
export function rescanSentence(title: string | null, isbn13: string): string {
  const book = title ? `“${title}”` : 'This book';
  return `${book} is already in the catalog, but the barcode you scanned (${isbn13}) is not on any of its printings.`;
}

/** The question itself, so every caller asks it in the same words. */
export function rescanQuestionText(): string {
  return 'Which is it — the book already on the shelf, or something new?';
}

/**
 * The slipcase treatment for a shared ISBN, as an `edition_name`.
 *
 * ⚠️ `edition` has no notes column — that lives on `copy` — so the name is
 * where this fact goes, exactly where the slipcase volumes and the
 * two-volume Words of Radiance set already keep theirs. Appended after an
 * em dash when a name exists; the name IS the note when none does.
 */
export function appendSharedIsbnNote(
  existingName: string | null,
  isbn13: string,
  holderTitle: string | null,
): string {
  const note = holderTitle
    ? `shares ISBN ${isbn13} with “${holderTitle}”`
    : `shares ISBN ${isbn13} with another printing in the catalog`;
  return existingName && existingName.trim() !== ''
    ? `${existingName.trim()} — ${note}`
    : `Shares ISBN ${isbn13}${holderTitle ? ` with “${holderTitle}”` : ''}`;
}

// ---------------------------------------------------------------------------
// The manual picker — the same question, asked with no barcode in hand
// ---------------------------------------------------------------------------
//
// ⚠️ **This is the rescan question's third caller, NOT a third protocol.** The
// scan path answers "which printing is this?" when a barcode resolves; the
// rescan prompt answers it when the barcode is new; this answers it when there
// is no barcode at all — 70 physical editions carry no ISBN, several verified
// to carry no barcode ever (Kickstarter and Illumicrate printings). All three
// must keep using this module's vocabulary, or they drift into three subtly
// different ideas of what an edition is.
//
// Two writes hang off the question:
//
//  * `copy.edition_id` — "which printing do I own?", the column that was 67%
//    NULL when the rescan flow started repairing it and still names nothing on
//    172 copies. The picker is how those get answered without a barcode.
//  * a new same-format sibling edition — the #341 case (`Copies.tsx` reuses
//    any edition of the same format, so "a second, different hardcover" was
//    literally unsayable). ⚠️ Only a person choosing may create one, and it
//    must carry something that tells it apart — see `blankSiblingOf`.

/**
 * The printings a copy could be.
 *
 * `format` given (recording a copy that named its format): candidates are that
 * format's editions, all of them — including the ones that already carry an
 * ISBN, because owning the Open Library-recorded printing is the common case,
 * not the exception. This is where the rescan's `fillTargets` filter would be
 * wrong: a barcode can only belong to an ISBN-less row, but a copy can be of
 * any row.
 *
 * `format` null (linking an existing copy, which names no format of its own):
 * every edition is a candidate, physical first — a copy is usually an object
 * on a shelf, but an owned EPUB licence is a real copy too and hiding its row
 * would make that copy permanently unlinkable.
 */
export function printingCandidates<E extends RescanEdition>(
  editions: readonly E[],
  format: string | null,
): E[] {
  if (format !== null) return editions.filter((e) => e.format === format);
  return [
    ...editions.filter((e) => isPhysicalFormat(e.format)),
    ...editions.filter((e) => !isPhysicalFormat(e.format)),
  ];
}

/**
 * Must a new printing of this format carry a distinguishing name?
 *
 * True exactly when a same-format edition already exists: two rows both saying
 * only "hardcover" are indistinguishable forever, which is the #139 residue
 * shape — a blank `manual` row beside a real one, and nobody able to say which
 * was which without the audit log. The first printing of a format needs no
 * name; the format IS its description.
 */
export function newPrintingNeedsName(
  editions: readonly RescanEdition[],
  format: string,
): boolean {
  return editions.some((e) => e.format === format);
}

/** What a hand-described new printing may carry. Everything optional but the format. */
export interface ProposedPrinting {
  format: string;
  isbn13?: string | null;
  isbn10?: string | null;
  asin?: string | null;
  editionName?: string | null;
  collects?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  sourceUrl?: string | null;
  cwaBookId?: number | null;
}

/**
 * The same-format sibling a proposed edition could never be told apart from —
 * or null when the proposal is distinguishable (or the first of its format).
 *
 * ⚠️ **This is the server-side floor under "only a person choosing may create
 * a same-format sibling."** The 83-duplicate-editions guard
 * (`findEditionBySourceUrl`) protects the importer path and the rescan
 * question protects the scan path; this closes the last silent minting point,
 * the raw POST. It fires ONLY on a row carrying nothing at all — no
 * identifier, no name, no contents, no publisher, no year, no provenance —
 * beside an existing row of the same format, because such a row is not a
 * different printing being recorded, it is residue being minted (#139's
 * second edition was exactly this shape). A genuinely different printing
 * always has *something* to say about itself; requiring that is not a burden,
 * it is the point.
 */
export function blankSiblingOf<E extends { id: number; format: string }>(
  editions: readonly E[],
  proposed: ProposedPrinting,
): E | null {
  const marks = [
    proposed.isbn13,
    proposed.isbn10,
    proposed.asin,
    proposed.editionName,
    proposed.collects,
    proposed.publisher,
    proposed.publishedYear,
    proposed.sourceUrl,
    proposed.cwaBookId,
  ];
  const distinguishable = marks.some((m) => m !== null && m !== undefined && m !== '');
  if (distinguishable) return null;
  return editions.find((e) => e.format === proposed.format) ?? null;
}

/** The picker's question, one spelling — the rescan rule (`rescanQuestionText`). */
export function printingQuestionText(): string {
  return 'Which printing is this — one already on file, or a different one?';
}

/**
 * "The object carries no barcode" — recorded as an observed fact, not left as
 * a blank that reads as an unanswered question.
 *
 * ⚠️ The spelling matches the two rows the owner already verified at the shelf
 * (Dungeon Born PB and Unmapped PB, 2026-08-13): checked against production —
 * `edition_name = 'No barcode printed on this copy (owner-verified)'` — so
 * every recording of this fact greps identically and no future pass re-asks a
 * settled row. It lives in `edition_name` because `edition` has no notes
 * column (that lives on `copy`), the same reasoning as the slipcase ISBNs and
 * `appendSharedIsbnNote` above. The distinction is 0040's: NULL means nobody
 * looked; this note means somebody looked and there is nothing to scan.
 */
export const NO_BARCODE_NOTE = 'No barcode printed on this copy (owner-verified)';

export function hasNoBarcodeNote(name: string | null): boolean {
  return name !== null && name.includes(NO_BARCODE_NOTE);
}

/** Idempotent: a name already carrying the note comes back unchanged. */
export function appendNoBarcodeNote(existingName: string | null): string {
  if (hasNoBarcodeNote(existingName)) return existingName as string;
  return existingName && existingName.trim() !== ''
    ? `${existingName.trim()} — ${NO_BARCODE_NOTE}`
    : NO_BARCODE_NOTE;
}

/** Undo of the above — unticking the box. A name that was only the note goes back to null. */
export function stripNoBarcodeNote(name: string | null): string | null {
  if (name === null) return null;
  const stripped = name.replace(` — ${NO_BARCODE_NOTE}`, '').replace(NO_BARCODE_NOTE, '').trim();
  return stripped === '' ? null : stripped;
}
