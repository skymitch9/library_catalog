/**
 * Leaf module: how many of a thing we actually have.
 *
 * Imports `constants.ts` only. No I/O.
 *
 * ## ⚠️ Three different questions used to share one badge
 *
 * The series page's "Bought more than once" section fired on **editions**, and
 * measured against production on 2026-08-11 every book it named was wrong:
 *
 * | | |
 * |---|---|
 * | Do I own the same **object** twice? | `copy` — and this is what the badge means |
 * | Do I own the same **book** in two printings? | `edition`, one `work` |
 * | Do I own the same **text** twice, via a bundle? | two `work`s and a `contains` relation |
 *
 * The old rule was "two printings of one medium", chosen because the obvious
 * `editions.length > 1` swept up every ebook-plus-hardcover pair — five works in
 * this catalog are exactly that and none of them is a duplicate. But the
 * narrower rule was still answering the middle question while the heading asked
 * the first one, and the three books it caught were **scan artifacts, not
 * purchases**: *Dinosaur Dance!* is one board book recorded twice by two
 * different scan paths, and *The Pout-Pout Fish* and *How the Grinch Stole
 * Christmas* have two real ISBNs each and **zero copies**.
 *
 * `copy` is the table that means "an object in this house" — migration 0001 says
 * so, and makes `copy.edition_id` nullable precisely so a copy can exist before
 * anybody knows which printing it is. Counting copies therefore cannot be fooled
 * by a second catalog row for one book, and cannot fire on a format pair, which
 * is the whole of the bug.
 */

import { HELD_STATUSES } from './constants.js';

/** The one field this module needs. Anything with a status can be counted. */
export interface StatusBearing {
  status: string;
}

/**
 * The copies that are objects on the shelf right now.
 *
 * `lent` counts and `wanted`, `preordered`, `sold` and `borrowed` do not — see
 * `HELD_STATUSES`. A book lent to a friend is still owned twice if two of it
 * left the house.
 */
export function heldCopies<T extends StatusBearing>(copies: readonly T[]): T[] {
  return copies.filter((c) => (HELD_STATUSES as readonly string[]).includes(c.status));
}

/**
 * Do we own two or more of this object?
 *
 * ⚠️ **The whole rule, and it is deliberately about copies and nothing else.**
 * Not editions, not formats, not media. A hardcover and an EPUB of one book are
 * one book held two ways, which the media chips already say; two owned copies
 * are two things on a shelf, which nothing else on the page can show you.
 *
 * A wishlist entry for a book already held is **not** a duplicate — it is the
 * ordinary "we have the ebook and want it in print" wish the wishlist exists
 * for, and `HELD_STATUSES` is what keeps it out.
 */
export function ownedMoreThanOnce(copies: readonly StatusBearing[]): boolean {
  return heldCopies(copies).length > 1;
}

/** What the deletion rule needs to know about a copy. */
export interface DeletionSubjectCopy extends StatusBearing {
  isSigned?: boolean;
}

/**
 * Does this copy stop its work being deleted?
 *
 * ⚠️ **The rule exists because of work #139**: two edition rows looked like
 * duplicates, but the two *copies* under them were real books on a real shelf.
 * A delete that quietly takes owned copies with it destroys the record of
 * physical property — a duplicate edition and a duplicate copy are different
 * bugs, and the delete button must not treat them alike.
 *
 * Everything except a plain wish blocks:
 *
 * - `owned` / `lent` — an object in (or out on loan from) this house
 * - `preordered` — money already committed
 * - `borrowed` — someone else's property, which we are answerable for
 * - `sold` — the record that property existed and where it went
 * - any **signed** copy, whatever its status — signatures are the one thing
 *   a re-scan can never recover
 *
 * Only `wanted` — a wish, no object, no money — lets a work go directly.
 * Anything else must be removed copy-by-copy first (each removal is itself
 * logged whole-row), so a person has looked at every object the record
 * claims before the record disappears.
 */
export function copyBlocksDeletion(copy: DeletionSubjectCopy): boolean {
  return copy.status !== 'wanted' || copy.isSigned === true;
}

/** The copies that block deletion — empty means the work may be deleted. */
export function deletionBlockers<T extends DeletionSubjectCopy>(copies: readonly T[]): T[] {
  return copies.filter(copyBlocksDeletion);
}
