/**
 * The whole-library half of *"if a book has a rating from the audiobook library
 * mark it as read"*.
 *
 * ## Why this is in the browser, like everything else about reviews
 *
 * The Worker cannot see Firestore. There is no service account in this project
 * and `apps/worker/src/routes/reviews.ts` explains at length why that is the
 * design rather than an omission. The browser is the only thing in the estate
 * that sees both stores, so a sweep can only run here.
 *
 * ## Why it exists as well as the per-book derivation
 *
 * `Reviews.tsx` does exactly this for one book when its page is opened, which
 * covers a book the moment somebody looks at it and covers nothing otherwise.
 * The catalog holds 258 works and nobody is going to open 258 pages. The
 * existing `scripts/backfill-read-from-ratings.mjs` answers the same question
 * unattended, but it is a Node script that needs a checkout of the sibling
 * audiobook repo to turn a `bookId` into a `workKey` — a maintainer's tool, not
 * something the household runs.
 *
 * ## ⚠️ This only became possible on 2026-08-12
 *
 * `backfill-review-keys.mjs --commit` ran for the first time that day and
 * stamped `workKey` (and `source: 'audio'`) onto all 870 review documents.
 * Before it, a sweep would have matched **nothing**: it starts from the person
 * rather than from a book, so unlike `fetchReviews` it has no legacy `bookId`
 * to fall back on. A review written on the audiobook site *since* that backfill
 * carries no `workKey` either and is skipped here — it is still picked up when
 * its book page is opened, which is why the per-book path stays.
 *
 * ## Once per session, and quiet about it
 *
 * `sessionStorage`, keyed on the person. The collection page remounts on every
 * filter change, and a sweep per remount would be a Firestore read and a write
 * request for a question whose answer cannot have changed. The flag is set
 * **before** the work, not after: a sweep that fails should not be retried on
 * every keystroke either. Closing the tab is the retry.
 *
 * Nothing here is on the critical path. Every failure is swallowed — the
 * collection renders from D1 and is worth showing whether or not Firestore
 * answered.
 */

import { OBSERVED_RATINGS_MAX, observedRatingsFromReviews } from '@lc/core';
import { api, type DerivedRead, type Me } from '../api.js';
import { fetchMyReviews } from './reviews.js';

/** Bumped only if the sweep's meaning changes and every session must run again. */
const FLAG = 'lc.readSync.v1';

export interface ReadSyncResult {
  /** Ratings of this person's that named a book — the denominator on screen. */
  considered: number;
  /** Works whose read state actually changed. Empty on every run after the first. */
  marked: DerivedRead[];
}

/** Has this browser already swept for this person in this session? */
function alreadySwept(who: string): boolean {
  try {
    const done = sessionStorage.getItem(FLAG);
    return done === who;
  } catch {
    // Private-mode Safari throws on `sessionStorage`. Sweeping every mount is
    // worse than not sweeping, so a browser that cannot remember does not run.
    return true;
  }
}

function markSwept(who: string): void {
  try {
    sessionStorage.setItem(FLAG, who);
  } catch {
    /* see above — nothing to do about it, and nothing depends on it */
  }
}

/**
 * Read this person's ratings out of Firestore and report them to the API.
 *
 * Returns `null` when nothing was attempted — already swept this session, or
 * there is no key to find their reviews by. A result with `marked: []` means the
 * sweep ran and had nothing to say, which is the ordinary answer.
 */
export async function syncReadStatesFromRatings(me: Me): Promise<ReadSyncResult | null> {
  // Setting read state is the same permission the read-state chips need. Without
  // it there is nothing this could write, so there is no reason to read.
  if (!me.capabilities.includes('trackReading')) return null;

  const who = me.email;
  if (alreadySwept(who)) return null;
  markSwept(who);

  const { collection } = await api.reviewCollection();
  const reviews = await fetchMyReviews(collection, me);

  // Fetch the bookId→workKey index so reviews written on the audiobook site
  // after the last backfill (which carry no workKey) can still be resolved.
  // Non-fatal: if it fails, the sweep falls back to the workKey-only behaviour.
  let bookIdToWorkKey: Map<string, string> | undefined;
  try {
    const { index } = await api.reviewBookIdIndex();
    bookIdToWorkKey = new Map(Object.entries(index));
  } catch {
    // The endpoint may not be deployed yet, or the request failed. The sweep
    // still works for every review that carries a workKey — same as before.
  }

  // ⚠️ The one implementation of "which of these are mine, and which name a book
  // we can reach". Shared with the Worker and the backfill; a second, looser
  // rule here would mark this person's books read on a housemate's rating.
  const observed = observedRatingsFromReviews(reviews, me, bookIdToWorkKey);
  if (observed.length === 0) return { considered: 0, marked: [] };

  const marked: DerivedRead[] = [];
  let considered = 0;
  // Chunked at the size the endpoint states, rather than on the assumption that
  // one person's review count will stay under it.
  for (let i = 0; i < observed.length; i += OBSERVED_RATINGS_MAX) {
    const res = await api.reviewsObserved(observed.slice(i, i + OBSERVED_RATINGS_MAX));
    marked.push(...res.marked);
    considered += res.considered;
  }
  return { considered, marked };
}
