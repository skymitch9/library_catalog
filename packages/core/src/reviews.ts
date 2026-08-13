/**
 * Leaf module: the contract between this catalog's reviews and the audiobook
 * catalog's. Imports `titles.ts` only. No I/O.
 *
 * ## The requirement
 *
 * A review written on either site must appear on the other. The owner's words:
 * *"port reviews from the audiobook firebase into the physical library and vice
 * versa"*.
 *
 * ## Why there is no sync job
 *
 * Because "vice versa" plus two stores means a bidirectional sync, and a
 * bidirectional sync between two schemas is the shape that produces silent
 * drift. This household has already shipped that bug once — four author-
 * splitters across two languages, two of which disagree (see `titles.ts`). So
 * there is **one store**: the Firestore `reviews` collection the audiobook site
 * already writes. This app reads and writes the same documents. Nothing is
 * copied, so nothing can diverge.
 *
 * D1 keeps what has no counterpart on the other side — where the book is, what
 * condition it is in, whether *this copy* has been read — plus `rating_cached`,
 * which is a read-model and never a source of truth.
 *
 * ## The shape, measured from the live site (2026-08-09)
 *
 * `audiobook_catalog/site/reviews.js`:
 *
 *     doc id   `${bookId}_${displayName.toLowerCase()}`
 *     fields   { bookId, displayName, rating, text, createdAt, updatedAt }
 *     bookId   bookIdFromTitle(title) — a slug of the TITLE ALONE
 *     rating   0.5 … 5, half-star steps, enforced in firestore.rules
 *
 * Two consequences drive everything below.
 *
 * ### 1. The doc id must be computed their way, not ours
 *
 * `bookIdFromTitle` lower-cases and hyphenates but **keeps the leading
 * article** — "The Lake House" becomes `the-lake-house`. `normaliseTitle` in
 * `titles.ts` strips it. Using our fold to build a doc id would write a *second*
 * document for a book that already has one, which is the exact duplicate this
 * module exists to prevent. It is ported verbatim below and must stay verbatim.
 *
 * ### 2. Their key cannot find a paperback, so we add one that can
 *
 * `bookIdFromTitle("Firefight - The Reckoners, Book 2")` is
 * `firefight-the-reckoners-book-2`. A print copy of the same book is called
 * "Firefight", and slugs to `firefight`. They never meet. Worse, the key has no
 * author in it at all, so two different books called "Gold" share one.
 *
 * So every review carries `workKey` alongside `bookId`: the composite key from
 * `titles.ts`, computed on the *cleaned* title. `bookId` stays exactly as it is
 * so the audiobook site's `getReviews(db, bookId)` keeps working untouched — the
 * bridge is additive, and nothing on that side has to change for it to be safe.
 */

import { UNKNOWN_AUTHOR, type ReviewSource } from './constants.js';
import { cleanAudiobookTitle, cleanTitleWithSeries, workKeyFor } from './titles.js';

/**
 * ⚠️ **PORTED VERBATIM from `audiobook_catalog/site/reviews.js`. Do not
 * "improve".**
 *
 * Every existing review document id in production was built with this exact
 * function. A change here does not migrate them, it orphans them.
 *
 * Note what it does NOT do: strip a leading article, fold diacritics, or split
 * an author. It is a slug, not a fold, and it is not interchangeable with
 * `normaliseTitle`.
 */
export function bookIdFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

/** The upsert id. Same rule both sides, so one review is one document. */
export function reviewDocId(bookId: string, displayName: string): string {
  return `${bookId}_${displayName.toLowerCase()}`;
}

/**
 * ⚠️ `REVIEW_SOURCES` and `ReviewSource` live in `constants.ts` now, and the
 * move is not cosmetic: `schemas.ts` needs `z.enum()` over the list and may
 * import `constants.ts` and nothing else (see the header of both files). The
 * honesty argument for why the field exists at all moved with the values.
 *
 * Not re-exported from here — `index.ts` already re-exports `constants.ts`, and
 * two `export *` paths to one name is the `EDITION_MEDIA` duplicate-export trap
 * `docs/TODO.md` records. Importers of `@lc/core` see no change.
 */

/**
 * A review document as it exists in Firestore, in the shared `reviews`
 * collection.
 *
 * The first four fields are the audiobook site's and are load-bearing for it.
 * The rest are added by this catalog and by the backfill; that site ignores
 * unknown fields, and `firestore.rules`' `validReview()` only asserts
 * `displayName is string` and a rating in range, so adding them requires **no
 * rules change** — verified against `audiobook_catalog/firestore.rules`
 * 2026-08-09.
 */
export interface ReviewDoc {
  /** Their key. Slug of the title as that catalog spells it. Never changed. */
  bookId: string;
  displayName: string;
  /** 0.5 … 5, half-star steps. See RATING_* in constants.ts for why not 1–10. */
  rating: number;
  text: string;

  /** Ours. `normaliseTitle(cleanTitle)|normaliseTitle(primaryAuthor)`. */
  workKey?: string;
  /** Which side wrote it, and therefore what it is a review *of*. */
  source?: ReviewSource;
  /** Free text: 'paperback', 'kindle', 'audiobook'. Display only. */
  editionLabel?: string;
  /**
   * The signed-in Google email, when there was one.
   *
   * The audiobook site attributes reviews by `displayName` because its identity
   * is a localStorage string. That is not an identity this app can trust, and it
   * is also not stable — a person can change their Google display name and
   * orphan every review they wrote. Recording the email alongside costs nothing
   * and is what lets `app_user.email` join a review to a real account later.
   *
   * Optional because 'passphrase'-method users on the other site have no email
   * and never will.
   */
  email?: string;
}

/**
 * Which catalog wrote this document — **including the 869 that never said**.
 *
 * ## ⚠️ Why this is a proof and not a guess
 *
 * Measured against the live `reviews` collection 2026-08-11: **869 documents,
 * of which 0 carry `source`, 0 carry `workKey` and 0 carry `email`.** Every one
 * of them predates this catalog, and `backfill-review-keys.mjs` — which is what
 * stamps `source: 'audio'` — has never been run with `--commit`.
 *
 * So reading `doc.source` alone answers "unknown" for the entire corpus, and
 * `read_format` would come out NULL for every book in the house. For an owner
 * who *"reads way more audiobooks than physicals"* that throws away the single
 * most accurate thing this app knows about how a book was consumed.
 *
 * The absence is itself the evidence. `reviewDocFor` below **always** writes
 * both `workKey` and `source`, in the same object, with no branch that can omit
 * either. A document carrying neither therefore cannot have come from this
 * catalog, and the only other writer of that collection is
 * `audiobook_catalog/site/reviews.js`. Hence: no `source` **and** no `workKey`
 * ⇒ written on the audiobook site ⇒ a review of an audiobook.
 *
 * ⚠️ That inference is only sound while `reviewDocFor` writes both fields
 * unconditionally. If a future edit ever makes `workKey` optional on a document
 * this catalog writes, this function starts calling print reviews audiobooks
 * and nothing will fail — so the invariant is asserted in `core.test.ts` rather
 * than left as a comment.
 *
 * The remaining combination — no `source` but a `workKey` present — is not
 * reachable today (the key backfill writes both in one merge) and is answered
 * `null` rather than assumed, because whatever produced it is something this
 * function has never seen.
 */
export function reviewSourceOf(doc: {
  source?: string | null;
  workKey?: string | null;
}): ReviewSource | null {
  if (doc.source === 'audio' || doc.source === 'library') return doc.source;
  if (!doc.source && !doc.workKey) return 'audio';
  return null;
}

/**
 * Build the review document for a book in *this* catalog.
 *
 * `title` is the title as printed on the book. The audiobook-style decoration
 * stripper runs anyway, defensively: a title typed from an Audible listing is
 * a normal way for a row to arrive here, and a `workKey` built from a decorated
 * title matches nothing.
 *
 * ⚠️ **Throws on `UNKNOWN_AUTHOR`.** A review written against a provisional
 * (authorless) work would be stamped with the provisional key and detach the
 * day the author arrives — and, worse, the sentinel would exist in Firestore,
 * which is the one place it must never appear: "zero documents can carry a
 * provisional key" is the entire proof that filling in an author later is a
 * free key move (docs/info/edit-and-audit-design.md §3.4, §5.1). The `/draft`
 * route answers a friendly 409 before this is ever reached; the throw is the
 * backstop for any future caller that skips the route.
 */
export function reviewDocFor(params: {
  title: string;
  authors: string;
  displayName: string;
  email?: string | null;
  rating: number;
  text: string;
  editionLabel?: string | null;
}): { id: string; doc: ReviewDoc } {
  if (params.authors === UNKNOWN_AUTHOR) {
    throw new Error(
      'reviewDocFor refuses a provisional work: add the author first — a review written now would come loose when it arrives.',
    );
  }
  const clean = cleanAudiobookTitle(params.title);
  // ⚠️ bookId off the title as *given*, not the cleaned one. If this row came
  // from the audiobook catalog its decorated title is what built the existing
  // document id, and cleaning first would write a second document beside it.
  const bookId = bookIdFromTitle(params.title);
  const doc: ReviewDoc = {
    bookId,
    displayName: params.displayName,
    rating: params.rating,
    text: params.text,
    workKey: workKeyFor(clean, params.authors),
    source: 'library',
  };
  if (params.email) doc.email = params.email;
  if (params.editionLabel) doc.editionLabel = params.editionLabel;
  return { id: reviewDocId(bookId, params.displayName), doc };
}

/**
 * The `workKey` an existing audiobook review *should* carry, given the row in
 * `catalog.csv` it belongs to.
 *
 * This is what the backfill writes. Split out from `reviewDocFor` because the
 * backfill must not touch anything else on those documents — not the rating,
 * not the text, not `createdAt`, and above all not `bookId`.
 */
export function workKeyForAudiobookRow(
  title: string,
  authors: string,
  /**
   * The `series` column from `catalog.csv`, when the row has one. **Pass it.**
   * Audible writes the same series suffix three different ways within one
   * series and only an exact strip handles all three — see
   * `cleanTitleWithSeries`.
   */
  series?: string | null,
): string {
  return workKeyFor(cleanTitleWithSeries(title, series), authors);
}

/** Half-star steps, 0.5–5. Mirrors `submitReview`'s guard on the other site. */
export function isValidRating(rating: number): boolean {
  return (
    typeof rating === 'number' &&
    Number.isFinite(rating) &&
    rating >= 0.5 &&
    rating <= 5 &&
    (rating * 2) % 1 === 0
  );
}

/** Arithmetic mean to one decimal, ported from the audiobook site so the two agree. */
export function computeAverageRating(reviews: readonly { rating: number }[]): number {
  if (!reviews || reviews.length === 0) return 0;
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}
