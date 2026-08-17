/**
 * Leaf module: the cross-catalog **to-be-read** list.
 *
 * Imports `constants.ts`, `reviews.ts` and `readstate.ts` (all leaves, and none
 * of them `index.ts` — see CLAUDE.md). No I/O.
 *
 * ## The requirement
 *
 * The owner, 2026-08-16: *"tbr like read should span all catalogs"*, narrowed
 * the same evening: *"lets not make a to play list … books can stack up"*. So a
 * TBR spans **audiobook + ebook + physical books** and deliberately never
 * games; `docs/TODO.md`'s own section records the reasoning so nobody adds them
 * back for symmetry.
 *
 * ## ⚠️ The store already existed, and finding it is what made this small
 *
 * `audiobook_catalog/app/web/templates/index.html` has had a per-person TBR
 * button since long before this feature: it writes
 * `readingLists/{displayNameLower}_{bookId}` with
 * `{ displayName, bookId, bookTitle, bookCover, status: 'tbr', addedAt }`, and
 * `site/community.html` counts those documents per person. `firestore.rules`
 * validates the shape (`validReadingList`) and ignores unknown fields, exactly
 * as `validReview` does for reviews.
 *
 * So this catalog does what it did for reviews: **joins the existing store
 * rather than inventing a second one**, and adds `workKey` / `email` /
 * `source` alongside. One store cannot diverge from itself
 * (`docs/info/identity-and-reviews.md` §3), and the intention a person recorded
 * on the audiobook site is the same intention this app must be able to clear.
 *
 * ## ⚠️ The document id is REVERSED compared with a review's
 *
 *     review        `${bookId}_${displayNameLower}`      (reviews.js)
 *     reading list  `${displayNameLower}_${bookId}`      (index.html)
 *
 * Both are ported verbatim from the audiobook site and neither may be
 * "harmonised": the id is the identity of a document that already exists in
 * production. Building one with the other's order writes a second document
 * beside the person's real TBR entry, and their `✓ To Be Read` button would
 * then disagree with this catalog forever.
 *
 * ## Two keys again, for the same reason reviews carry two
 *
 * `bookId` is `bookIdFromTitle(title)` — a slug of the title ALONE, as that
 * catalog spells it — so `Firefight - The Reckoners, Book 2` and the paperback
 * `Firefight` never meet. `workKey` (`normaliseTitle(title)|normaliseTitle
 * (author)`) is the key that spans, and it is what makes "finishing one format
 * clears the intention" work at all: one work, one intention, however many
 * formats the household holds.
 */

import { TBR_STATUS, UNKNOWN_AUTHOR } from './constants.js';
import { isMyReview } from './readstate.js';
import { bookIdFromTitle } from './reviews.js';
import { cleanAudiobookTitle, workKeyFor } from './titles.js';

/**
 * ⚠️ **PORTED VERBATIM** from `renderReadingListButtons` in
 * `audiobook_catalog/app/web/templates/index.html`:
 *
 *     const docId = `${session.displayName.toLowerCase()}_${bookId}`;
 *
 * Every existing reading-list document in production is filed under this exact
 * id. A change here does not migrate them, it orphans them — and it is NOT the
 * same order as `reviewDocId`. See the header.
 */
export function readingListDocId(displayName: string, bookId: string): string {
  return `${displayName.toLowerCase()}_${bookId}`;
}

/**
 * A reading-list document as it exists in the shared `readingLists`
 * collection.
 *
 * The first four fields are the audiobook site's and are load-bearing for it —
 * its own filter reads `status === 'tbr'` and `bookTitle`, and the community
 * page counts by `displayName`. The rest are this catalog's addition, the same
 * additive move `ReviewDoc` makes, and need **no rules change**:
 * `validReadingList()` asserts `displayName`, `bookId` and `status` are strings
 * and ignores everything else.
 */
export interface TbrDoc {
  displayName: string;
  /** Their key: `bookIdFromTitle(title)`, a slug of the title alone. */
  bookId: string;
  /** What that site shows in its own list. Written as this catalog spells it. */
  bookTitle: string;
  /** `'tbr'`. The only value either catalog writes today. */
  status: string;
  /** Display only, on their side. Empty string when we have no cover. */
  bookCover?: string;
  /** Ours: `normaliseTitle(cleanTitle)|normaliseTitle(primaryAuthor)`. */
  workKey?: string;
  /** Ours: which catalog recorded the intention. */
  source?: 'audio' | 'library';
  /**
   * Ours: the signed-in Google address.
   *
   * The audiobook site attributes by `displayName` — a localStorage string —
   * because it has no verified identity to use. This app does, and recording it
   * is what lets a TBR entry be joined to a real account later. Absent on every
   * document that site has written, which is why `isMyReview`'s display-name
   * fallback is not optional.
   */
  email?: string;
}

/**
 * Build the reading-list document for a book in *this* catalog.
 *
 * Mirrors `reviewDocFor` deliberately, down to the two keys and the refusal:
 *
 * ⚠️ **Throws on `UNKNOWN_AUTHOR`.** A TBR entry against a provisional
 * (authorless) work would be stamped with the provisional key and come loose
 * the day the author arrives, and the sentinel would exist in Firestore — the
 * one place `docs/info/edit-and-audit-design.md` §3.4 requires it never appear,
 * because "zero documents carry a provisional key" is the whole proof that
 * filling in an author later is a free key move. The route answers a friendly
 * 409 before this is reached; the throw is the backstop.
 */
export function tbrDocFor(params: {
  title: string;
  authors: string;
  displayName: string;
  email?: string | null;
  coverUrl?: string | null;
}): { id: string; doc: TbrDoc } {
  if (params.authors === UNKNOWN_AUTHOR) {
    throw new Error(
      'tbrDocFor refuses a provisional work: add the author first — an entry written now would come loose when it arrives.',
    );
  }
  const clean = cleanAudiobookTitle(params.title);
  // ⚠️ bookId off the title as *given*, not the cleaned one — the same rule
  // `reviewDocFor` states. If this row came from the audiobook catalog its
  // decorated title is what built the existing document id, and cleaning first
  // would write a second document beside the entry the person already has.
  const bookId = bookIdFromTitle(params.title);
  const doc: TbrDoc = {
    displayName: params.displayName,
    bookId,
    bookTitle: params.title,
    status: TBR_STATUS,
    workKey: workKeyFor(clean, params.authors),
    source: 'library',
  };
  if (params.email) doc.email = params.email;
  if (params.coverUrl) doc.bookCover = params.coverUrl;
  return { id: readingListDocId(params.displayName, bookId), doc };
}

/**
 * A cover URL that means the same thing on somebody else's site.
 *
 * ⚠️ **This catalog's `work.cover_url` is usually a site-relative path** —
 * `/covers/killer-s-mind-….jpg`, served by this Worker. Writing that into a
 * document the audiobook site also reads would store a URL that resolves
 * against *their* host and 404s. Nothing over there renders `bookCover` today
 * (it writes the field and never reads it back, measured 2026-08-17), so this
 * is a trap being closed before it is sprung rather than a bug being fixed —
 * and it is exactly the kind that would surface as "why are half the covers on
 * the reading list broken" long after anyone remembers who wrote them.
 *
 * An absolute URL, a protocol-relative one and a `data:` URI are all left
 * alone. Anything that cannot be resolved answers `null`: a document with no
 * cover is honest, a document with a broken one is not.
 */
export function absoluteCoverUrl(coverUrl: string | null | undefined, base: string): string | null {
  const raw = (coverUrl ?? '').trim();
  if (!raw) return null;
  if (/^(https?:)?\/\//.test(raw) || raw.startsWith('data:')) return raw;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

/** The fields of a reading-list document these rules read. Nothing else. */
export interface TbrLike {
  displayName?: string | null;
  email?: string | null;
  bookId?: string | null;
  bookTitle?: string | null;
  bookCover?: string | null;
  workKey?: string | null;
  status?: string | null;
}

/**
 * One TBR entry reduced to what a matcher needs: the id to delete it by, and
 * the two keys it can be found by.
 *
 * ⚠️ Deliberately carries no title. It is what the browser sends to
 * `POST /api/tbr/resolve`, and a server that echoed a client-supplied title
 * back would let a page print a string it never checked as though the catalog
 * had said it. The browser already holds the title it fetched.
 */
export interface TbrEntryRef {
  /** The Firestore document id — what a delete is issued against. */
  docId: string;
  /** The audiobook site's title-only slug. Every document has one. */
  bookId: string;
  /** The composite key, when the document carries one. */
  workKey: string | null;
}

/** One entry of this person's TBR, as the browser read it out of Firestore. */
export interface TbrEntry extends TbrEntryRef {
  title: string;
  coverUrl: string | null;
}

/**
 * This person's own TBR, out of a pile of reading-list documents.
 *
 * ⚠️ **Ownership is decided by `isMyReview`, the ONE implementation**, shared
 * with the review path, the Worker and `backfill-read-from-ratings.mjs`. These
 * documents have exactly the review problem: everything the audiobook site
 * wrote carries a `displayName` and no `email`, so the weak key is the only one
 * that reaches them — and a looser rule here would put a housemate's intentions
 * on this person's list. A second, nearly-identical predicate is precisely the
 * drift `titles.ts` records four author-splitters' worth of.
 *
 * Anything whose `status` is not `'tbr'` is dropped: that field is the
 * audiobook site's own little ladder and it may grow values this catalog has
 * never heard of. A document with no `bookId` is dropped too — it names no book
 * either catalog could reach.
 *
 * ⚠️ **Deduplicated on `workKey` where there is one, on `bookId` otherwise.**
 * "Finishing one format clears the intention" is the owner's rule, and its
 * mirror is that one intention is one row on screen even when it was recorded
 * twice — once here and once on the audiobook site, under two spellings of the
 * title. An entry carrying a `workKey` wins the tie, because it is the one this
 * catalog can match to a book.
 */
export function myTbrEntries(
  docs: readonly (TbrLike & { docId: string })[],
  me: { email?: string | null; reviewName?: string | null },
): TbrEntry[] {
  const byKey = new Map<string, TbrEntry>();

  for (const doc of docs) {
    if (!isMyReview(doc, me)) continue;
    if ((doc.status ?? '') !== TBR_STATUS) continue;

    const bookId = typeof doc.bookId === 'string' ? doc.bookId.trim() : '';
    if (!bookId) continue;

    const raw = typeof doc.workKey === 'string' ? doc.workKey.trim() : '';
    // A key with no `|` is not one of ours — `workKeyFor` always joins a folded
    // title and a folded author — and a bare title would collide two books
    // called "Gold". Treated as absent rather than trusted.
    const workKey = raw.includes('|') ? raw : null;

    const entry: TbrEntry = {
      docId: doc.docId,
      workKey,
      bookId,
      title: (typeof doc.bookTitle === 'string' && doc.bookTitle.trim()) || bookId,
      coverUrl: (typeof doc.bookCover === 'string' && doc.bookCover.trim()) || null,
    };

    const dedupeKey = workKey ?? `bookId:${bookId}`;
    const seen = byKey.get(dedupeKey);
    if (!seen) byKey.set(dedupeKey, entry);
    // Nothing to prefer between two documents under one key today; first wins,
    // and the second is still deleted when the intention is cleared because
    // clearing works from the document ids the caller fetched, not from this.
  }

  return [...byKey.values()];
}

/** What the match added to an entry: the book it named, and how it stands. */
export interface TbrMatched {
  /** The work this entry names, or null — the ordinary case for an audiobook. */
  workId: number | null;
  /**
   * This person's read state for that work.
   *
   * ⚠️ `null` is "no row", NOT 'unread'. Almost every book in the catalog has
   * no `user_book` row at all, and only an explicit 'read' clears an intention.
   */
  readState: string | null;
}

/**
 * Which entries the reader has already finished, and whose intention is
 * therefore spent.
 *
 * ⚠️ **`'read'` only.** `dnf` and `reference` are deliberately NOT cleared:
 * a did-not-finish is a more specific truth than "done with it" — the same
 * reading `deriveReadState`'s precedence rule 5 applies — and somebody who has
 * genuinely given up removes the entry with one press. `reading` obviously
 * stays: it is the intention in progress.
 *
 * This is what makes the feature span. A rating written on the audiobook site
 * marks the work read here (`observedRatingsFromReviews` → `POST
 * /api/reviews/observed`), and this rule then retires the TBR entry that rating
 * settled — whichever catalog recorded it, and whichever format was finished.
 *
 * Generic over the row rather than tied to one shape: the browser holds the
 * Firestore fields and the Worker's answer merged together, and a second copy
 * of "what counts as finished" is the drift this module exists to avoid.
 */
export function spentTbrEntries<T extends TbrMatched>(entries: readonly T[]): T[] {
  return entries.filter((e) => e.readState === 'read');
}

/** The entries still worth showing — everything the reader has not finished. */
export function outstandingTbrEntries<T extends TbrMatched>(entries: readonly T[]): T[] {
  return entries.filter((e) => e.readState !== 'read');
}
