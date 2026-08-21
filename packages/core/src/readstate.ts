/**
 * Leaf module: when a rating is evidence that a book was read.
 *
 * Imports `constants.ts` and `reviews.ts` (which imports `titles.ts`). Nothing
 * else, and — per CLAUDE.md — **never `index.ts`**. No I/O.
 *
 * ## The requirement
 *
 * The owner's words: *"if a book has a rating from the audiobook library mark it
 * as read"*, refined twice:
 *
 * > *"ratings should be for the logged in person. so if its a rating i left mark
 * > it read for me."*
 *
 * > *"mark all copies of a book read so if i own percy jackson 3 times (we do and
 * > they'll all get scanned in eventually) mark all 3 read if they appear
 * > different at any point."*
 *
 * ## Why this is a pure rule and not a query
 *
 * Three callers need the same answer and none of them can share a database
 * handle: the Worker (`POST /api/reviews/:workId/observed`), the browser (which
 * is the only thing that ever sees Firestore), and
 * `scripts/backfill-read-from-ratings.mjs`. If the rule lived in any one of
 * them, the other two would grow a copy — which is the four-author-splitters
 * failure `titles.ts` records, in a new place.
 *
 * ## ⚠️ What this must never do
 *
 * Overrule a person. `read_state_how = 'human'` means somebody pressed a button,
 * and a re-sync that quietly puts 'read' back over their 'unread' is the one
 * behaviour that would make the whole feature untrustworthy. Same reasoning as
 * `decided_how` on auto-applied research findings (migration 0013) and
 * `cover_status` on stand-in covers (migration 0040): record how a value was
 * arrived at *at the moment it is free to record*, or the catalog can never be
 * audited afterwards.
 */

import type { ReadFormat, ReadState, ReadStateSource, ReviewSource } from './constants.js';
import { isValidRating, reviewSourceOf } from './reviews.js';

/** A rating this app has actually *seen* in Firestore, and what it is a review of. */
export interface ObservedRating {
  /** 0.5 … 5, half stars. Anything else is not a rating and implies nothing. */
  rating: number;
  /**
   * `'audio'` for a review written on the audiobook site, `'library'` for one
   * written here, `null`/absent for a legacy document the review-key backfill
   * has not stamped yet.
   */
  source?: ReviewSource | null;
}

/** The `user_book` row as it stands, or `null` when there is no row at all. */
export interface ExistingReadState {
  readState: string;
  /** `'human' | 'rating' | null` — see `READ_STATE_SOURCES`. */
  readStateHow: string | null;
  readFormat: string | null;
}

/** What the derivation would change. `readFormat` is only ever *added*. */
export interface DerivedReadState {
  readState: ReadState;
  readFormat: ReadFormat | null;
  readStateHow: ReadStateSource;
}

/**
 * The format a review is direct evidence of.
 *
 * ⚠️ An audiobook review is evidence somebody *listened*, and throwing that away
 * would make the book page say "read" against a paperback that was never opened.
 * The library side is deliberately not evidence of `'print'`: this catalog holds
 * EPUBs and Kindle editions too, and the review form asks for a rating, not a
 * format.
 */
export function readFormatFromReviewSource(source?: ReviewSource | null): ReadFormat | null {
  return source === 'audio' ? 'audio' : null;
}

/**
 * Does this rating mean the book was read?
 *
 * ⚠️ **0.5 is a rating.** A book somebody hated is still a book they finished
 * enough of to hate, and the alternative — a floor — would silently un-read the
 * worst books in the house. There is no threshold and there must not be one.
 *
 * The only thing that implies nothing is a value outside the shared 0.5–5
 * half-star scale, which is not a rating at all.
 */
export function ratingImpliesRead(rating: number | null | undefined): boolean {
  return typeof rating === 'number' && isValidRating(rating);
}

/**
 * Whether a review document belongs to the signed-in person.
 *
 * ⚠️ Two keys, and the weak one is not optional.
 *
 * A review written from *this* catalog carries `email`, which is the join
 * `docs/info/identity-and-reviews.md` §2 settles on. A review written on the
 * audiobook site carries no email at all — that site signs out of Firebase
 * before storing anything and attributes by `displayName`, a localStorage
 * string. So `displayName` is the only key that reaches the 860 existing
 * reviews, and dropping it would make this feature see none of them.
 *
 * Case-folded because the audiobook site's own document ids are
 * `${bookId}_${displayName.toLowerCase()}` — it does not consider case
 * significant, so neither may we.
 *
 * ⚠️ Other people in the household review into the same collection. Matching
 * loosely here would mark the owner's books read on the strength of somebody
 * else's rating, which is the specific thing the refinement above rules out.
 */
export function isMyReview(
  review: { displayName?: string | null; email?: string | null },
  me: { email?: string | null; reviewName?: string | null },
): boolean {
  const fold = (s?: string | null) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

  const reviewEmail = fold(review.email);
  const myEmail = fold(me.email);
  if (reviewEmail && myEmail) return reviewEmail === myEmail;

  const reviewName = fold(review.displayName);
  const myName = fold(me.reviewName);
  return !!reviewName && reviewName === myName;
}

/**
 * What a rating should change about one person's read state for one work —
 * or `null` for "leave it alone".
 *
 * Returning `null` for a no-op is load-bearing rather than tidy: it is what
 * makes the backfill's "would write" count honest, what keeps the browser from
 * issuing a write on every page view, and what makes a second run of anything
 * here idempotent.
 *
 * ### The precedence, in order
 *
 * 1. **Not a rating** → nothing. See `ratingImpliesRead`.
 * 2. **`readStateHow === 'human'`** → nothing, ever. A person has spoken.
 * 3. **`readStateHow === 'rating'`** → ours to refine. This is the only path
 *    that may write over an existing `read`, and it exists for one real case:
 *    a library review derived a read with no format, and the audiobook review
 *    for the same book turns up later carrying `'audio'`.
 * 4. **No row, or `read_state = 'unread'` with no recorded how** → write. An
 *    absent row is the default, and so is 'unread'; `cacheRating` mints rows
 *    that look exactly like this.
 * 5. **Anything else** (`reading` / `dnf` / `reference` with no recorded how) →
 *    nothing. Those values were typed by somebody before migration 0070 existed
 *    and are assertions even though the column cannot prove it. ⚠️ `dnf` is the
 *    sharp one: a did-not-finish book *can* carry a rating, and promoting it to
 *    'read' would overwrite the more specific truth with a vaguer one.
 */
export function deriveReadState(
  observed: ObservedRating,
  existing: ExistingReadState | null,
): DerivedReadState | null {
  if (!ratingImpliesRead(observed.rating)) return null;
  if (existing?.readStateHow === 'human') return null;

  const ours = existing?.readStateHow === 'rating';
  if (existing && !ours && existing.readState !== 'unread') return null;

  // Only ever adds. A format somebody recorded — or that an earlier, better
  // -evidenced rating recorded — outranks the absence of one here.
  const readFormat =
    (existing?.readFormat as ReadFormat | null | undefined) ??
    readFormatFromReviewSource(observed.source);

  const next: DerivedReadState = { readState: 'read', readFormat: readFormat ?? null, readStateHow: 'rating' };

  // Nothing to say.
  if (
    existing &&
    existing.readState === next.readState &&
    (existing.readFormat ?? null) === next.readFormat &&
    existing.readStateHow === next.readStateHow
  ) {
    return null;
  }
  return next;
}

/** An observed rating that names the book it is about, by `work_key`. */
export interface ObservedWorkRating extends ObservedRating {
  /** `normaliseTitle(cleanTitle)|normaliseTitle(primaryAuthor)`. */
  workKey: string;
}

/** The fields of a Firestore review document this rule reads. Nothing else. */
export interface ReviewLike {
  workKey?: string | null;
  bookId?: string | null;
  source?: string | null;
  rating?: unknown;
  displayName?: string | null;
  email?: string | null;
}

/**
 * Every rating in this pile that is the signed-in person's own, ready to be
 * reported to `POST /api/reviews/observed`.
 *
 * ## Why a whole-library sweep exists as well as the per-book one
 *
 * `Reviews.tsx` derives a read state when somebody opens a book page, and that
 * is the only automatic path this feature had. It covers a book the moment it
 * is looked at and covers nothing otherwise — nobody opens 258 book pages, and
 * `scripts/backfill-read-from-ratings.mjs` is a Node script needing a checkout
 * of the sibling repo, so it is not something the household runs. One Firestore
 * query for *this person's* reviews answers the same question for the whole
 * catalog at once.
 *
 * ## ⚠️ This became possible on 2026-08-12 and not before
 *
 * It joins on the `workKey` **stored on the document**, and until
 * `backfill-review-keys.mjs --commit` was run for the first time that day, not
 * one of the 870 documents carried one. The per-book path could paper over that
 * by asking Firestore for the audiobook site's `bookId` as well — it knows which
 * book it is looking at, so it has a legacy key to ask with. A sweep does not:
 * it starts from the person, not from the book, so a document with no `workKey`
 * names no book it can reach and is skipped.
 *
 * ⚠️ **Which means a review written on the audiobook site *after* that backfill
 * is invisible here until the backfill is run again.** It is still picked up the
 * moment its book page is opened, which is the safety net; the sweep is a bulk
 * catch-up, not a replacement for the per-book derivation.
 *
 * ## What it refuses
 *
 * - Somebody else's review. `isMyReview` is the one implementation and the whole
 *   point of the owner's refinement — a housemate's rating must never mark the
 *   caller's books read.
 * - Anything that is not a rating on the shared 0.5–5 half-star scale.
 * - A document with no `workKey`, per the note above.
 *
 * ## Duplicates
 *
 * Two documents can clean to one `workKey` — the audiobook catalog spells the
 * same book two ways often enough that the review-key backfill was written for
 * it. First wins, **except** that an `'audio'` source anywhere in the group wins
 * for the whole group: `read_format` is the one field the choice can change, and
 * evidence of a listen is not cancelled by a document that is silent about
 * format. The rating itself only reaches `rating_cached`, which is a sort key
 * and never authoritative.
 */
export function observedRatingsFromReviews(
  reviews: readonly ReviewLike[],
  me: { email?: string | null; reviewName?: string | null },
  /** Optional lookup: `bookId` → `workKey`. When provided, reviews that lack a
   * `workKey` but carry a `bookId` present in this map can still be resolved.
   * This is the bookId fallback the per-book path has always had
   * (via `fetchReviews`'s legacy query) — extended to the sweep so that reviews
   * written on the audiobook site *after* the last `backfill-review-keys.mjs`
   * run are no longer invisible until the backfill is run again. */
  bookIdToWorkKey?: ReadonlyMap<string, string>,
): ObservedWorkRating[] {
  const byKey = new Map<string, ObservedWorkRating>();

  for (const review of reviews) {
    if (!isMyReview(review, me)) continue;
    const rating = review.rating;
    if (!ratingImpliesRead(typeof rating === 'number' ? rating : null)) continue;

    let workKey = typeof review.workKey === 'string' ? review.workKey.trim() : '';
    // A key with no `|` is not one of ours — `workKeyFor` always joins a title
    // and an author with it — and a bare title would collide two books called
    // "Gold". Refusing beats landing a rating on the wrong shelf.
    if (!workKey.includes('|')) {
      // Fallback: resolve via bookId if the caller provided a lookup map.
      // This covers reviews written on the audiobook site after the last
      // workKey backfill — they carry a bookId but no workKey.
      const bookId = typeof review.bookId === 'string' ? review.bookId.trim() : '';
      if (bookId && bookIdToWorkKey) {
        workKey = bookIdToWorkKey.get(bookId) ?? '';
      }
      if (!workKey.includes('|')) continue;
    }

    const source = reviewSourceOf(review);
    const seen = byKey.get(workKey);
    if (!seen) {
      byKey.set(workKey, { workKey, rating: rating as number, source });
    } else if (source === 'audio' && seen.source !== 'audio') {
      seen.source = 'audio';
    }
  }

  return [...byKey.values()];
}
