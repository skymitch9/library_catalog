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
