/**
 * Reading and writing the shared **reading list** collection from the browser.
 *
 * The Worker derives the keys (`GET /api/tbr/:workId/keys`) and matches a list
 * against the catalog (`POST /api/tbr/resolve`); this file does the Firestore
 * I/O, with the signed-in person's own credentials. No service account exists
 * anywhere in this project — `apps/worker/src/routes/reviews.ts` explains why
 * that is the point rather than an omission, and nothing about a to-read list
 * is worth introducing one for.
 *
 * ⚠️ **This is the collection the audiobook site has always written**
 * (`readingLists`, doc id `${displayNameLower}_${bookId}`, `status: 'tbr'`).
 * Joining it rather than inventing a second store is what makes the owner's ask
 * — *"tbr like read should span all catalogs"* — true rather than merely
 * mirrored: an intention recorded on either site is one document, and clearing
 * it here clears the `✓ To Be Read` button there.
 */

import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { TBR_STATUS, myReadingListEntries, type TbrEntry } from '@lc/core';
import { firestore } from './firebase.js';
import { fetchMineFrom } from './reviews.js';

/**
 * Every TBR entry this person has, from either catalog.
 *
 * The ownership rule and the `status === 'tbr'` filter are `myTbrEntries` in
 * `@lc/core` — the one implementation.
 *
 * ⚠️ **`uid` is not optional in practice, even though the type allows null.**
 * Since the 2026-08-18 account migration `ownsTbrDoc` attributes an
 * account-keyed document by uid ALONE, so a caller that omits it gets back only
 * the legacy uid-less entries and the list silently looks nearly empty. The
 * fetch below is deliberately still a superset — the display-name query pulls
 * account-keyed documents too, name-sharers' included — and `myTbrEntries` is
 * what rejects the ones that are not this account's. The query is the fetch;
 * the predicate is the gate.
 */
export async function fetchMyTbr(
  collectionName: string,
  me: { uid?: string | null; email?: string | null; reviewName?: string | null },
): Promise<TbrEntry[]> {
  return fetchMyReadingList(collectionName, me, TBR_STATUS);
}

/**
 * The same fetch at any status the shared store holds — `READING_LIST_STATUSES`,
 * measured 2026-08-26 as exactly `tbr` and `read`.
 *
 * ⚠️ **`fetchMyTbr` IS this with `'tbr'` bound**, so there is one Firestore
 * query and one ownership gate between them. Added 2026-08-26 for the owner's
 * ask — *"can we also add a filter in each of the search bars for tbr and other
 * read states"* — because the collection filter has to reach `status: 'read'`
 * documents, which `myTbrEntries` drops by design.
 *
 * ⚠️ **The query is still the SUPERSET and `myReadingListEntries` is still
 * the gate**, exactly as above: the fetch pulls name-matched documents too and
 * the predicate rejects the ones that are not this account's. Do not be tempted
 * to add a `where('status','==',…)` here as well — `fetchMineFrom` composes the
 * queries this collection is indexed for, and a third clause is a composite
 * index this project has never needed.
 */
export async function fetchMyReadingList(
  collectionName: string,
  me: { uid?: string | null; email?: string | null; reviewName?: string | null },
  status: string,
): Promise<TbrEntry[]> {
  const docs = await fetchMineFrom(collectionName, me);
  return myReadingListEntries(
    docs.map((d) => ({ docId: d.id, ...(d.data as Record<string, unknown>) })),
    me,
    status,
  );
}

/** Is this book on the list? `null` for "no entry", which is the ordinary answer. */
export async function getTbrEntry(
  collectionName: string,
  docId: string,
): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(firestore(), collectionName, docId));
  return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
}

/**
 * Put the book on the list.
 *
 * ⚠️ `merge: true`, so re-adding a book that the audiobook site already listed
 * keeps whatever that site wrote — its `addedAt`, and the cover it captured
 * from its own modal — while stamping the `workKey` this catalog needs to match
 * it later. A plain `set` would quietly rewrite the date somebody's list is
 * ordered by.
 */
export async function addToTbr(
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await setDoc(
    doc(firestore(), collectionName, docId),
    { ...data, addedAt: new Date() },
    { merge: true },
  );
}

/**
 * Take it off the list — the same `deleteDoc` the audiobook site's own toggle
 * performs, against the same document.
 *
 * ⚠️ Deleting a document that is not there is not an error in Firestore, which
 * is what lets the clearing path fire without reading first.
 */
export async function removeFromTbr(collectionName: string, docId: string): Promise<void> {
  await deleteDoc(doc(firestore(), collectionName, docId));
}
