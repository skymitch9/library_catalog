import { preorderedCopies } from '@lc/core';
import { api } from '../api.js';
import { formatLabel } from './formats.js';

/**
 * "Is this the pre-order arriving, or a different copy?" — asked BEFORE anything
 * is written.
 *
 * ## ⚠️ One question, asked from every add path
 *
 * The rule and the wording live in `@lc/core/preorders.ts`; this is the half that
 * needs the network, and it is deliberately one function so the scan review screen
 * and the manual Add form cannot end up asking two subtly different questions. The
 * precedent is `addLineToCatalog` itself — "one path for every kind of row" — and
 * the duplicate prompt it already serves.
 *
 * ## Why the whole work is fetched rather than the wishlist
 *
 * `GET /api/wishlist?status=preordered` would answer *whether* there is a
 * pre-order in one small request, and it is the wrong request, because it cannot
 * answer **which**. Its rows carry no edition, and production's hardest case is a
 * single work with three pre-ordered copies that differ only by variant cover
 * (*Worlds Beyond Number* — see `scripts/fix-worlds-beyond-number.mjs`). Three
 * identical buttons is not a question anybody can answer. `GET /api/works/:id`
 * carries copies *and* editions, so each choice can name the jacket it is for.
 *
 * One request, only on the path where a work already exists, and only while
 * somebody is waiting for a button they just pressed.
 */

/** One thing the person can point at and say "that one turned up". */
export interface PreorderOption {
  copyId: number;
  /** Enough to tell three variant covers apart. Never empty. */
  label: string;
  /** ⚠️ Carried so the arrival date is filled only when it is missing. */
  acquiredOn: string | null;
}

export interface PreorderQuestion {
  workId: number;
  title: string | null;
  options: PreorderOption[];
}

/** The shape of `GET /api/works/:id` this module reads. Narrower than the wire. */
interface WorkCopies {
  work?: { title?: string | null };
  copies?: {
    id: number;
    status: string;
    edition_id: number | null;
    notes: string | null;
    acquired_on: string | null;
    vendor?: string | null;
    edition_notes?: string | null;
    location?: string | null;
  }[];
  editions?: { id: number; format: string; edition_name?: string | null }[];
}

/**
 * How one pre-ordered copy is told apart from its siblings.
 *
 * The edition's *name* leads, because that is the field migration 0060 defines as
 * "how this printing differs from the standard one" and is therefore the only
 * thing that separates three copies of one book. Format, vendor and the copy's own
 * note follow. A copy with none of them still gets a label — its id — rather than
 * a blank button: three unlabelled choices are unanswerable, and "copy 214" is at
 * least a thing you can pick and then check.
 */
function labelFor(
  copy: { id: number; edition_id: number | null; notes: string | null; vendor?: string | null },
  editions: readonly { id: number; format: string; edition_name?: string | null }[],
): string {
  const edition = copy.edition_id === null ? undefined : editions.find((e) => e.id === copy.edition_id);
  const parts = [
    edition?.edition_name?.trim() || null,
    edition ? formatLabel(edition.format) : null,
    copy.vendor?.trim() || null,
    copy.notes?.trim() || null,
  ].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' · ') : `copy #${copy.id}`;
}

/**
 * Ask the catalog whether this book has anything on the way.
 *
 * `null` is the ordinary answer and means "nothing to ask" — the add proceeds
 * untouched. Only a work that already exists can have a pre-order, so callers with
 * no work id have nothing to call this with, which is why there is no "match the
 * title first" step buried in here.
 */
export async function preorderQuestionFor(
  workId: number,
  fallbackTitle: string | null,
): Promise<PreorderQuestion | null> {
  const detail = (await api.work(workId)) as unknown as WorkCopies;
  const editions = detail.editions ?? [];
  // ⚠️ `preorderedCopies` and not a `status !== 'owned'` test of our own. It
  // filters on `preordered` alone, and folding `wanted` in here would offer to
  // "receive" a book nobody has bought.
  const options = preorderedCopies(detail.copies ?? []).map((c) => ({
    copyId: c.id,
    label: labelFor(c, editions),
    acquiredOn: c.acquired_on,
  }));

  if (options.length === 0) return null;
  return { workId, title: detail.work?.title ?? fallbackTitle, options };
}
