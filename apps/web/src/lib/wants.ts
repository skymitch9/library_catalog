import { WISHLIST_STATUSES } from '@lc/core';

/**
 * "Is this book already on the wishlist?" — the rule, and the words.
 *
 * ## ⚠️ NO `api` IMPORT, AND THAT IS WHY THIS FILE EXISTS SEPARATELY
 *
 * `preorders.ts` and `rescans.ts` each keep a question's rule and its fetch in
 * one module, and neither has a test — because importing either pulls in
 * `api.js` → `lib/firebase.ts`, which reads `import.meta.env` and dies the
 * moment a `node:test` process touches it. The decision below is the half worth
 * pinning, so it is kept where a test can reach it and the one fetch that needs
 * it lives beside its single caller in `catalog-add.ts`. Same split
 * `lib/shelf-view.ts` and `lib/scan-format.ts` already live by.
 *
 * ## ⚠️ WHY IT IS ASKED AT ADD TIME AND NOT WHEN THE ROW ARRIVES
 *
 * The same reason the pre-order question is: it costs a request to find out,
 * and asking that of fifteen rows on a shelf sweep would spend fifteen requests
 * to warn about none. The *owned* case looks different only because the scan
 * route answers it for free out of D1 (`state === 'owned'`); there is no
 * equivalent free signal for a want, so the check happens once, on the one book
 * somebody has just said they want, with nothing written yet.
 *
 * ## ⚠️ Why a want stops and an owned copy does not
 *
 * Scanning a book you own twice is a real event — some books here genuinely are
 * owned twice, which is what "Add 2nd copy" exists for. **Wanting a book twice
 * is not an event**: two `wanted` rows against one work are two rows saying the
 * same sentence, and the wishlist would then offer to buy it twice. Wanting a
 * *second format* of a book is real, and that is still sayable — from the work
 * page's *Want this*, where a format can be chosen. It is not sayable from a
 * barcode, because a barcode names one printing and cannot express "…as well as
 * the one I already asked for".
 */

/** A want already on file — enough to name it and link to it. */
export interface ExistingWant {
  workId: number;
  /** The catalog's title, falling back to whatever the caller knew. */
  title: string | null;
  /** `wanted` or `preordered` — the two read very differently to a person. */
  status: string;
}

/**
 * The pure half: does this set of copies already carry a wish?
 *
 * ⚠️ `WISHLIST_STATUSES`, never a hand-written `status === 'wanted'`. A
 * pre-order is a want that has already been paid for, and adding a second
 * `wanted` row beside it would put a book on the shopping list that is in the
 * post. `@lc/core` owns that list; this reads it.
 */
export function wantIn(copies: readonly { status: string }[]): { status: string } | null {
  return copies.find((c) => (WISHLIST_STATUSES as readonly string[]).includes(c.status)) ?? null;
}

/**
 * What the row says when the answer is "you already asked for this".
 *
 * ⚠️ A pre-order and a plain want are NOT the same sentence. "Already on your
 * wishlist" over a book that is paid for and in the post would send somebody
 * back to the shop to buy it again — which is the exact failure
 * `@lc/core/preorders.ts` exists to prevent, arriving through a different door.
 */
export function wantSentence(want: ExistingWant): string {
  return want.status === 'preordered'
    ? 'Already pre-ordered — this one is bought and on its way.'
    : 'Already on your wishlist.';
}
