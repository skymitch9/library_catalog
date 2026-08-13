import { rescanChoices } from '@lc/core';
import { ApiError, api } from '../api.js';
import { editionKindLabel, formatLabel } from './formats.js';

/**
 * "This barcode is not on file, but the book is — what am I holding?" — asked
 * BEFORE anything is written.
 *
 * ## ⚠️ One question, built the way `preorders.ts` builds its own
 *
 * The rule and the wording live in `@lc/core/rescan.ts`; this is the half that
 * needs the network. Deliberately one function, for the reason its sibling
 * states: two callers asking two subtly different questions is how a prompt
 * teaches the wrong distinction at the one moment somebody is acting on it.
 *
 * The whole work is fetched (`GET /api/works/:id`) rather than anything
 * narrower, because the options ARE its rows: which physical printings have no
 * ISBN, whether the shelf holds a copy that never named its printing. One
 * request, only on the path where a work already exists, only while somebody
 * is waiting for a button they just pressed.
 */

/** One printing the person can point at. Never a blank button. */
export interface RescanOption {
  editionId: number;
  /** Enough to tell printings apart: name, then format. */
  label: string;
}

export interface RescanQuestion {
  workId: number;
  title: string | null;
  /** The scanned ISBN the catalog has never seen. */
  isbn13: string;
  /** ISBN-less physical printings this barcode could belong to. */
  fillTargets: RescanOption[];
  /** Owned copies exist but no physical printing row does — spine-added. */
  bareCopy: boolean;
  /** The one unlinked owned copy, when unambiguous. See `rescanChoices`. */
  linkCopyId: number | null;
}

/** The shape of `GET /api/works/:id` this module reads. Narrower than the wire. */
interface WorkDetail {
  work?: { title?: string | null };
  editions?: {
    id: number;
    format: string;
    isbn13: string | null;
    edition_name?: string | null;
    edition_kind?: string | null;
  }[];
  copies?: { id: number; status: string; edition_id: number | null }[];
}

/**
 * One printing, in enough words to tell it from its siblings — name, kind,
 * format, ISBN.
 *
 * ⚠️ The ONE label both prompts use (the rescan's fill buttons and the manual
 * picker's candidate buttons). Two label builders would be two ideas of what
 * distinguishes a printing, and the person at the shelf would be shown
 * different vocabulary for the same row depending on which door they came in.
 * The rescan's fill targets are ISBN-less by construction, so the ISBN part
 * simply never renders there; the picker is where it earns its place, because
 * "which of these two hardcovers?" is often answered by nothing else.
 */
export function printingLabel(edition: {
  format: string;
  edition_name?: string | null;
  edition_kind?: string | null;
  isbn13?: string | null;
}): string {
  const name = edition.edition_name?.trim();
  return [
    name || null,
    edition.edition_kind ? editionKindLabel(edition.edition_kind) : null,
    formatLabel(edition.format),
    edition.isbn13 ? `ISBN ${edition.isbn13}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Ask the catalog what this barcode could be, for a work it already holds.
 *
 * `null` means "nothing to ask" and the add proceeds as it always did — which
 * is the answer for a work with no physical presence at all (the
 * paperback-of-an-ebook case, the commonest attach in the catalog). A work
 * with physical rows gets a question, because the silent path there is
 * exactly how #139 grew an Open Library hardcover beside the `manual`
 * ISBN-less row describing the same object.
 */
export async function rescanQuestionFor(
  workId: number,
  fallbackTitle: string | null,
  isbn13: string,
): Promise<RescanQuestion | null> {
  const detail = (await api.work(workId)) as unknown as WorkDetail;
  const editions = detail.editions ?? [];
  const choices = rescanChoices(editions, detail.copies ?? []);
  if (!choices.shouldAsk) return null;

  return {
    workId,
    title: detail.work?.title ?? fallbackTitle,
    isbn13,
    fillTargets: choices.fillTargets.map((e) => ({
      editionId: e.id,
      label: printingLabel(editions.find((row) => row.id === e.id) ?? e),
    })),
    bareCopy: choices.bareCopy,
    linkCopyId: choices.linkCopyId,
  };
}

/** What the `isbn_taken` 409 knows about the row already wearing the ISBN. */
export interface IsbnHolder {
  editionId: number;
  workId: number;
  title: string | null;
  editionName: string | null;
  format: string;
}

/**
 * The refusal that must not dead-end: another printing already carries this
 * ISBN — one physical object, two catalog rows (the Realmkeeper set is eight
 * such objects). The server names the holder precisely so the flow can offer
 * the slipcase treatment instead of showing a person a constraint violation.
 */
export interface IsbnConflict {
  /** The row the person was trying to fill — null when none existed yet. */
  editionId: number | null;
  workId: number;
  attachedTo: string | null;
  isbn13: string;
  holder: IsbnHolder | null;
}

/**
 * Read an `isbn_taken` refusal out of a thrown error, or `null` for anything
 * else. A hit with no holder is still a hit — the refusal stands even if the
 * server could not name the row — so the two cases are kept distinguishable.
 */
export function isbnTakenFrom(err: unknown): { holder: IsbnHolder | null } | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as { error?: string; holder?: IsbnHolder } | null;
  if (body?.error !== 'isbn_taken') return null;
  return { holder: body.holder ?? null };
}
