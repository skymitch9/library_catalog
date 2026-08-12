/**
 * Reading and writing the shared review collection from the browser.
 *
 * The Worker derives the keys (`/api/reviews/:id/keys`, `/api/reviews/:id/draft`)
 * and this file does the Firestore I/O, with the signed-in user's own
 * credentials. No service account exists anywhere in this project — see
 * `apps/worker/src/routes/reviews.ts` for why that is the point rather than an
 * omission.
 */

import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { firestore } from './firebase.js';

export interface Review {
  bookId: string;
  displayName: string;
  rating: number;
  text: string;
  workKey?: string;
  source?: 'audio' | 'library';
  editionLabel?: string;
  email?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/**
 * Every review of this book, from either catalog.
 *
 * ⚠️ Two queries, unioned, and the second one is not redundant.
 *
 * `workKey` is this project's addition. Reviews written on the audiobook site
 * before the backfill ran have only `bookId` — a slug of the title as *that*
 * catalog spells it — so a `workKey`-only query silently returns nothing for
 * them and the page looks like the reviews were lost.
 *
 * Drop the `legacyBookId` query when the backfill has run and the count is
 * stable. Until then, asking both is the difference between showing a review and
 * appearing to have deleted it.
 */
export async function fetchReviews(
  collectionName: string,
  workKey: string,
  legacyBookId: string,
): Promise<Review[]> {
  const db = firestore();
  const ref = collection(db, collectionName);

  const [byKey, byLegacy] = await Promise.all([
    getDocs(query(ref, where('workKey', '==', workKey))),
    getDocs(query(ref, where('bookId', '==', legacyBookId))),
  ]);

  // Deduplicate on document id: a backfilled review matches both queries, and
  // showing it twice reads as two people having said the same thing.
  const seen = new Map<string, Review>();
  for (const snap of [byKey, byLegacy]) {
    for (const d of snap.docs) seen.set(d.id, d.data() as Review);
  }
  return [...seen.values()];
}

/**
 * Every review **this person** has written, across both catalogs.
 *
 * ## ⚠️ Two queries again, and a different pair
 *
 * `email` is the join `docs/info/identity-and-reviews.md` §2 settles on, and it
 * is the only trustworthy one — but the audiobook site signs out of Firebase
 * before storing anything and writes no email at all, so on 2026-08-12 not one
 * of the 870 documents in the shared collection has one. `displayName` is
 * therefore the query that actually reaches them, and it is the weak key: it is
 * a localStorage string on the other site, and Firestore equality is
 * case-sensitive where `isMyReview` is not.
 *
 * So this returns **candidates**. The caller filters them through `isMyReview`,
 * which is the one implementation shared with the Worker and the backfill.
 * Widening the match here instead would mark this person's books read on a
 * housemate's rating — the exact thing the owner's refinement rules out.
 *
 * ⚠️ Somebody with no `review_name` set matches nothing written on the audiobook
 * site. That is a real gap and it is a data problem, not a code one: the
 * People screen sets it, and `scripts/backfill-read-from-ratings.mjs` prints the
 * same warning.
 */
export async function fetchMyReviews(
  collectionName: string,
  me: { email?: string | null; reviewName?: string | null },
): Promise<Review[]> {
  const ref = collection(firestore(), collectionName);

  const queries = [];
  if (me.email) queries.push(getDocs(query(ref, where('email', '==', me.email))));
  if (me.reviewName) {
    queries.push(getDocs(query(ref, where('displayName', '==', me.reviewName))));
  }
  if (queries.length === 0) return [];

  const snaps = await Promise.all(queries);

  // Deduplicate on document id — somebody who has reviewed from both sites
  // matches both queries, and counting one rating twice is not harmful here but
  // is the sort of thing that makes a reported total impossible to check.
  const seen = new Map<string, Review>();
  for (const snap of snaps) {
    for (const d of snap.docs) seen.set(d.id, d.data() as Review);
  }
  return [...seen.values()];
}

/** Write the document the Worker built. Merge, so `createdAt` survives an edit. */
export async function writeReview(
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await setDoc(doc(firestore(), collectionName, docId), { ...data, updatedAt: new Date() }, {
    merge: true,
  });
}
