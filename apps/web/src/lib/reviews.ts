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
  return (await fetchMineFrom(collectionName, me)).map((d) => d.data as unknown as Review);
}

/**
 * The two-query dance above, over any collection keyed the way the audiobook
 * site keys things — and keeping the document ids.
 *
 * ⚠️ **One implementation, shared with the TBR list** (`lib/tbr.ts`). Both
 * collections have exactly the same identity problem: `email` is the join this
 * project settled on and the audiobook site writes none, so `displayName` is
 * the only key that reaches what it wrote. A second copy of this pair would be
 * a second place for the weak key to be forgotten — and the day it was, the
 * feature would look like it worked while silently seeing nothing anybody had
 * recorded on the other site.
 *
 * The ids matter for the TBR and not for reviews: clearing an intention is a
 * `deleteDoc` against the id, so a list that dropped them could show an entry
 * and never remove it.
 */
export async function fetchMineFrom(
  collectionName: string,
  me: { uid?: string | null; email?: string | null; reviewName?: string | null },
): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const ref = collection(firestore(), collectionName);

  const queries = [];
  // ⚠️ THE ACCOUNT QUERY, added 2026-08-18 with the TBR account migration.
  // Without it this function cannot see a single account-keyed TBR document:
  // those carry a `uid` and are matched by it, and while they DO still carry a
  // `displayName` that the name query would find, relying on that would make
  // the whole migration cosmetic — the list would once again be assembled by
  // display name and a name-sharer's entries would come back with it.
  //
  // Harmless on the reviews collection, which carries no `uid` on any of its
  // 884 documents (measured): the query simply returns nothing, and the two
  // below still answer. `me.uid` is null for a session with no live Firebase
  // user, and then this query is not issued at all.
  if (me.uid) queries.push(getDocs(query(ref, where('uid', '==', me.uid))));
  if (me.email) queries.push(getDocs(query(ref, where('email', '==', me.email))));
  if (me.reviewName) {
    queries.push(getDocs(query(ref, where('displayName', '==', me.reviewName))));
  }
  if (queries.length === 0) return [];

  const snaps = await Promise.all(queries);

  // Deduplicate on document id — somebody who has written from both sites
  // matches both queries, and counting one rating twice is not harmful here but
  // is the sort of thing that makes a reported total impossible to check.
  const seen = new Map<string, Record<string, unknown>>();
  for (const snap of snaps) {
    for (const d of snap.docs) seen.set(d.id, d.data() as Record<string, unknown>);
  }
  return [...seen].map(([id, data]) => ({ id, data }));
}

/**
 * The live check for a key move — the same two queries `fetchReviews` runs,
 * but keeping the document ids, because the ids are what the carry writes to.
 *
 * ⚠️ A thrown error here must reach the caller. The Edit title & author panel
 * disables Save until this resolves, and a failed check is never a zero —
 * that is the silent-staleness trap in one more costume (design §5.2).
 */
export async function countReviewDocs(
  collectionName: string,
  workKey: string,
  legacyBookId: string,
): Promise<{ ids: string[] }> {
  const ref = collection(firestore(), collectionName);
  const [byKey, byLegacy] = await Promise.all([
    getDocs(query(ref, where('workKey', '==', workKey))),
    getDocs(query(ref, where('bookId', '==', legacyBookId))),
  ]);
  const ids = new Set<string>();
  for (const snap of [byKey, byLegacy]) for (const d of snap.docs) ids.add(d.id);
  return { ids: [...ids] };
}

/**
 * The carry: re-point every found review document at the new key.
 *
 * ⚠️ **Firestore FIRST, then the PATCH — the order is load-bearing** (design
 * §5.3). If the browser dies between the two, the docs carry `newKey` while
 * the work still holds the old one — and the reviews stay VISIBLE, because
 * `fetchReviews`' legacy `bookId` query still matches (the stored `bookId`
 * field never changes). Re-running the ceremony is idempotent: the workKey
 * query finds nothing under the old key, the legacy query finds the
 * already-restamped docs, and the merge is a no-op. The opposite order would
 * leave the database claiming a key no document carries, with nothing to
 * notice it.
 *
 * A merge of one field on other people's documents, allowed because
 * `firestore.rules` checks shape only — a posture the owner DECIDED to keep
 * (PLATFORM.md §4a): hardening `reviews` later would silently break exactly
 * this write, and that entry is the tripwire.
 */
export async function restampReviews(
  collectionName: string,
  ids: readonly string[],
  newKey: string,
): Promise<number> {
  const db = firestore();
  for (const id of ids) {
    await setDoc(doc(db, collectionName, id), { workKey: newKey }, { merge: true });
  }
  return ids.length;
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
