/**
 * Leaf module: a copy that is paid for and still in the post, and what to ask
 * when the book turns up in somebody's hands.
 *
 * Imports `constants.ts` only. No I/O.
 *
 * ## ⚠️ The question this exists to force, and why guessing is not allowed
 *
 * A book being added already has a `preordered` copy on file. Exactly two things
 * can be true, and they are not distinguishable from anything the catalog knows:
 *
 * | | What must happen |
 * |---|---|
 * | **The pre-order arrived** | flip *that copy* `preordered` → `owned`. **No second copy.** |
 * | **A different copy** | write a new `owned` copy. **Leave the pre-order alone.** |
 *
 * Guess the first as the second and the pre-order becomes a phantom that inflates
 * "on the way" forever, because nothing ever re-checks it. Guess the second as the
 * first and a copy the household genuinely owns is silently lost. So the add path
 * stops and asks, exactly as it already stops and asks about a duplicate — see
 * `isOutstanding` in `scanjobs.ts` for the owner's ruling that produced that
 * prompt, of which this is the same shape for a second reason.
 *
 * ## ⚠️ `preordered` is NEVER folded into `wanted`, here or anywhere
 *
 * `preorderedCopies` tests one status and one status only. `WISHLIST_STATUSES`
 * holds both because both are "not here yet, and we mean to have it"; that is the
 * *only* question the two ever answer together. The doc comment on
 * `CollectionStats` carries the measurement: the sibling Board Game Catalog summed
 * them and read "262 wanted" over a wishlist of 25, because 236 of the 262 were
 * pledges. A wanted copy is a decision still to make; a pre-order is money already
 * spent on a book in the post. Only the second one can *arrive*, which is why this
 * module cannot accept a wider filter without becoming wrong.
 */

import type { CopyStatus } from './constants.js';

/** The one status that can arrive. Not a synonym for anything on the wishlist. */
export const PREORDER_STATUS: CopyStatus = 'preordered';

/** The one field this module needs to decide. Anything with a status will do. */
export interface StatusBearingCopy {
  id: number;
  status: string;
}

/** Is this copy paid for and still on its way? */
export function isPreordered(status: string): boolean {
  return status === PREORDER_STATUS;
}

/**
 * The copies of one book that are on their way.
 *
 * ⚠️ `wanted` is excluded and must stay excluded. A wish has not been bought, so
 * a book turning up cannot be "that wish arriving" — it is a purchase, and the
 * wish is a separate row that may still be outstanding (the hardcover you want
 * of the paperback that just came).
 */
export function preorderedCopies<T extends StatusBearingCopy>(copies: readonly T[]): T[] {
  return copies.filter((c) => isPreordered(c.status));
}

/**
 * ⚠️ **The answer to the question, and the only two shapes it may take.**
 *
 * `copyId` is on the `arrived` branch rather than inferred, because a work can
 * have several pre-orders and picking one for the person is the guess this whole
 * module exists to refuse. Production holds exactly that case: *Worlds Beyond
 * Number* is one work with **three** pre-ordered copies, one per variant cover,
 * so "the pre-order" is not a thing that can be resolved without asking which.
 *
 * `acquiredOn` rides along so the caller can fill the arrival date **only when it
 * is empty** — see `arrivedPatch` in the web app. An importer may already know the
 * real date and a late tick must not overwrite it with today.
 */
export type PreorderAnswer =
  | { kind: 'arrived'; copyId: number; acquiredOn: string | null }
  | { kind: 'another' };

/**
 * What to say to somebody standing there with the book, before they choose.
 *
 * ⚠️ One sentence, no verdict, no default — the same rule `overlapSentence`
 * follows next door, and for the same reason: the owner's position is *tell me,
 * then let me decide*. It lives here rather than in the component so the wording
 * and the rule that raises it cannot drift apart.
 *
 * Deliberately says **"on pre-order"** and not "wanted". They are different rows
 * meaning different things about a wallet, and a prompt that blurred them would
 * teach the wrong distinction at the one moment somebody is acting on it.
 */
export function preorderSentence(count: number, title: string | null): string {
  const book = title ? `“${title}”` : 'This book';
  return count === 1
    ? `${book} already has a copy on pre-order.`
    : `${book} already has ${count} copies on pre-order.`;
}

/** The question itself, so both add paths ask it in the same words. */
export function preorderQuestionText(count: number): string {
  return count === 1
    ? 'Is this that pre-order arriving, or a different copy?'
    : 'Is this one of those arriving, or a different copy?';
}
