/**
 * Reading and writing the shared **content warning** collection from the
 * browser, plus fetching the audiobook pipeline's published warnings file.
 *
 * The Worker derives the keys (`GET /api/warnings/:workId/keys`) and builds the
 * document (`POST /api/warnings/:workId/draft`); this file does the Firestore
 * I/O with the signed-in person's own credentials. No service account exists
 * anywhere in this project — `apps/worker/src/routes/reviews.ts` explains why
 * that is the point rather than an omission.
 *
 * ⚠️ **This is the collection the audiobook site has always written**
 * (`user_content_warnings`, doc id `{bookId}_{nameLower}_{topicId}`). Joining
 * it rather than inventing a second store is what makes a note added here show
 * up there — see `packages/core/src/warnings.ts` for the key derivation, which
 * is the whole feature.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import type { PublishedWarningEntry } from '@lc/core';
import { firestore } from './firebase.js';

/** A warning document as it comes back out of Firestore. */
export interface WarningView {
  /** The Firestore document id — what a delete is issued against. */
  id: string;
  bookId?: string | null;
  bookTitle?: string | null;
  label: string;
  displayName?: string | null;
  authorUid?: string | null;
  source?: string | null;
  createdAt?: { seconds?: number } | null;
}

/**
 * Every reader note about this book, from either catalog.
 *
 * ⚠️ **One query per candidate id, unioned — and the second one is not
 * redundant.** `bookIds` holds the audiobook catalog's spelling of the title
 * and this catalog's, because a note may sit under either: theirs for anything
 * written on that site (and for everything written here since this feature
 * landed), ours for a book the matcher has never linked. Asking only the first
 * would hide notes on unmatched books; asking only the second would hide every
 * note the other site has ever written.
 *
 * A parallel query per id rather than one `in` filter, mirroring `fetchReviews`
 * — the shape this repo already reasons about, with no 30-value ceiling to
 * remember and no different failure mode when the list is empty.
 */
export async function fetchWarnings(
  collectionName: string,
  bookIds: readonly string[],
): Promise<WarningView[]> {
  if (bookIds.length === 0) return [];
  const ref = collection(firestore(), collectionName);
  const snaps = await Promise.all(
    bookIds.map((bookId) => getDocs(query(ref, where('bookId', '==', bookId)))),
  );

  // Deduplicate on document id: the two catalogs' keys can be the same string,
  // and showing one note twice reads as two people having flagged it.
  const seen = new Map<string, WarningView>();
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      const label = typeof data.label === 'string' ? data.label.trim() : '';
      // A note with no label names nothing. Dropped rather than drawn as a
      // blank chip — the same reading `publishedWarningsFor` applies.
      if (!label) continue;
      seen.set(d.id, { id: d.id, ...(data as object), label } as WarningView);
    }
  }

  // Oldest first, exactly as `getUserWarnings` sorts on the audiobook site, so
  // the same book reads the same way in both places.
  return [...seen.values()].sort(
    (a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0),
  );
}

/**
 * Add (or replace) a note.
 *
 * ⚠️ **A plain `setDoc`, deliberately — this is the dedupe.** The document id
 * carries the topic, so re-adding the same topic overwrites the same document
 * rather than filing a second one; `addUserWarning` on the audiobook site does
 * exactly this and the semantics are ported, not re-invented. `createdAt` moves
 * to the moment of the re-add, which is the truth about when this note was last
 * asserted.
 *
 * `serverTimestamp()` and not `new Date()`: the audiobook site sorts these by
 * `createdAt.seconds`, and a browser clock that is minutes out would reorder
 * everyone's notes on that page.
 */
export async function writeWarning(
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await setDoc(doc(firestore(), collectionName, docId), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

/**
 * Take a note down — the same `deleteDoc` the audiobook site's own control
 * performs, against the same document.
 *
 * ⚠️ The gate is `firestore.rules`, never this function:
 * `canDeleteUserWarning()` allows it only for the document's `authorUid` or an
 * estate `site_roles` moderator/admin. `warningDeleteVerdict` in `@lc/core`
 * decides which affordance to draw; a refusal that gets through it anyway
 * arrives here as a `permission-denied` and is worded by `describeStoreError`.
 */
export async function removeWarning(collectionName: string, docId: string): Promise<void> {
  await deleteDoc(doc(firestore(), collectionName, docId));
}

/**
 * The audiobook pipeline's PUBLISHED warnings — Hardcover / StoryGraph / web
 * sources, gathered by `app/tools/fetch_content_warnings.py` in that repo and
 * shipped as a static file beside its site.
 *
 * ## ⚠️ Why this is honest to consume, and what it cost to check
 *
 * Nothing new was built for it, which was the condition on doing it at all:
 *
 * | Question | Measured, 2026-08-17 |
 * |---|---|
 * | Is it fetchable cross-origin? | `Access-Control-Allow-Origin: *` on the live response |
 * | Keyed by what? | the audiobook catalog's **full title string** (339 keys) |
 * | Do we have that string? | yes — `audiobook_holding.title`, migration 0010 |
 * | Does our own title reach any extra books? | **no — zero of 92 holdings**, so there is no fallback worth the mis-key risk |
 *
 * ## ⚠️ Fetched at most once per session, and only for a book that can use it
 *
 * The file is ~200 KB. `ContentNotes` asks only when the work has an audiobook
 * holding (92 of 351 works today), and the promise is cached in module scope,
 * so a browsing session pays for it once. `no-cache` on the response means the
 * browser revalidates rather than re-downloads on a later session.
 *
 * A failure answers `null`, never throws: the published half is an extra, and
 * losing it must not take down the reader notes beside it.
 */
const PUBLISHED_WARNINGS_URL = 'https://audiobooks.heygabi.ai/content_warnings.json';

let publishedCache: Promise<Record<string, PublishedWarningEntry> | null> | null = null;

export function fetchPublishedWarnings(): Promise<Record<string, PublishedWarningEntry> | null> {
  if (!publishedCache) {
    publishedCache = fetch(PUBLISHED_WARNINGS_URL)
      .then((res) => (res.ok ? (res.json() as Promise<Record<string, PublishedWarningEntry>>) : null))
      .catch(() => null);
  }
  return publishedCache;
}
