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
 * `audiobook_catalog/app/web/templates/index.html`, which since 2026-08-18
 * reads:
 *
 *     const docId = `${uid}_${bookId}`;
 *
 * ## The key moved from a display name to an ACCOUNT, and that was a migration
 *
 * Owner's order, 2026-08-18, verbatim: *"Make tbr keyed to account"*.
 *
 * ⚠️ **THIS SUPERSEDES THE "MAY NOT BE HARMONISED" NOTE** that stood in this
 * file's header and in `docs/info/tbr.md` §2. That note was right about the
 * mechanism — changing a persisted key does not migrate documents, it orphans
 * them — and wrong only about what follows from it. What follows is that you
 * MIGRATE them, which `audiobook_catalog/scripts/migrate_tbr_to_uid.py` did:
 * 234 documents enumerated, 181 moved, 53 left in place because their owner is
 * a retired v1 passphrase account with no Firebase uid to key to.
 *
 * The old key filed every list under a string anybody can choose, so two
 * members who picked the same display name shared one document per book — each
 * saw and could delete the other's intentions. No Firestore rule could close
 * that; a display name identifies nobody.
 *
 * ⚠️ NOT case-folded, unlike the old key. A uid is case-sensitive, and folding
 * one builds an id that matches nothing and silently loses the entry.
 *
 * ⚠️ Still the REVERSE of `reviewDocId` — that much is unchanged and still
 * deliberate. Only the left-hand half became an account. `test/tbr.test.ts`
 * pins both facts.
 */
export function readingListDocId(uid: string, bookId: string): string {
  return `${uid}_${bookId}`;
}

/**
 * The id this collection used BEFORE the 2026-08-18 account migration.
 *
 * ⚠️ **READ-ONLY, AND NOT DEAD CODE.** 53 live documents still carry it — see
 * `readingListDocId`. A reader that could not build this id would show those
 * people an empty list.
 *
 * ⚠️ **NEVER WRITE THROUGH IT.** `firestore.rules` refuses a legacy-shaped id
 * that carries a `uid` field, so an attempt fails loudly rather than quietly
 * re-opening the hole one book at a time — but the rule is the backstop, not
 * the design. The write path is `readingListDocId`, always.
 *
 * **REMOVAL CONDITION**, so this does not become permanent by inattention:
 * delete this function, its callers, and the `uid`-less branch of
 * `myTbrEntries` once `migrate_tbr_to_uid.py --report` prints zero uid-less
 * documents. A number in one command, not a judgement call.
 */
export function legacyReadingListDocId(displayName: string, bookId: string): string {
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
  /**
   * ⚠️ **The account this intention belongs to** — the Firebase uid, and since
   * 2026-08-18 the left-hand half of the document id as well.
   *
   * This is what `myTbrEntries` attributes by and what `firestore.rules` pins
   * the id to (they must name the same account, and both must be the caller —
   * either half alone is a hole). `displayName` stays alongside it because
   * three surfaces still render and count by name, but it is no longer the
   * identity.
   *
   * Absent on the 53 pre-migration documents whose owner has no Firebase
   * account, which is exactly why the name fallback is not optional.
   */
  uid?: string;
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
  /**
   * ⚠️ **The account, and it is REQUIRED.** Since 2026-08-18 an entry without
   * one cannot be written: it would be filed under a display name, which is
   * the shape the migration removed. The Worker takes it from the verified
   * token (`user.firebaseUid`), never from anything the browser sent.
   *
   * A caller with no uid is a caller with no verified account, and the honest
   * answer for them is a refusal rather than a document filed under a string —
   * see the throw below, which is the same shape as the provisional-key one.
   */
  uid: string;
  email?: string | null;
  coverUrl?: string | null;
}): { id: string; doc: TbrDoc } {
  if (params.authors === UNKNOWN_AUTHOR) {
    throw new Error(
      'tbrDocFor refuses a provisional work: add the author first — an entry written now would come loose when it arrives.',
    );
  }
  // ⚠️ The same refusal, for the same reason: a document written under a key
  // that identifies nobody is worse than no document. Before 2026-08-18 this
  // was the ONLY thing that could happen, and it is what the migration undid.
  if (!params.uid) {
    throw new Error(
      'tbrDocFor refuses an entry with no account: a TBR keyed to a display name is the bug the 2026-08-18 migration removed.',
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
    uid: params.uid,
    bookId,
    bookTitle: params.title,
    status: TBR_STATUS,
    workKey: workKeyFor(clean, params.authors),
    source: 'library',
  };
  if (params.email) doc.email = params.email;
  if (params.coverUrl) doc.bookCover = params.coverUrl;
  return { id: readingListDocId(params.uid, bookId), doc };
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

/**
 * Is this reading-list document MINE?
 *
 * ⚠️ **THE ORDER IS THE WHOLE POINT, and it is why this is not `isMyReview`.**
 * Since the 2026-08-18 account migration a TBR document can carry a `uid`, and
 * when it does that account is the answer — exactly, and with no fallback.
 * The display-name comparison is consulted ONLY for a document with no `uid`,
 * i.e. one of the 53 the migration could not move.
 *
 * Applying the name fallback to an account-keyed document would hand a
 * name-sharer somebody else's list again and undo the migration while every
 * other test still passed. That is the single most expensive thing to get
 * wrong in this file, so it is pinned by its own test.
 *
 * ⚠️ Reviews still go through `isMyReview` and MUST keep doing so: all 884
 * review documents carry no uid (measured 2026-08-18), so that store has no
 * account key to prefer and the weak one is all there is. Two predicates that
 * look alike but are not interchangeable — the same hazard `titles.ts` records
 * for its four author-splitters, and stated here for the same reason.
 */
export function ownsTbrDoc(
  doc: { uid?: string | null; displayName?: string | null; email?: string | null },
  me: { uid?: string | null; email?: string | null; reviewName?: string | null },
): boolean {
  const docUid = typeof doc.uid === 'string' ? doc.uid.trim() : '';
  if (docUid) {
    const myUid = typeof me.uid === 'string' ? me.uid.trim() : '';
    return !!myUid && docUid === myUid;
  }
  // Legacy, uid-less: the pre-migration rule, unchanged — email when both
  // sides have one, display name otherwise. See isMyReview for why.
  return isMyReview(doc, me);
}

/** The fields of a reading-list document these rules read. Nothing else. */
export interface TbrLike {
  /** The account, on everything written since 2026-08-18. */
  uid?: string | null;
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
 * ⚠️ **Ownership is decided by `ownsTbrDoc`** — the ACCOUNT when the document
 * carries one, and only then the weak display-name key, for the 53 documents
 * that have no account to carry (2026-08-18, "Make tbr keyed to account").
 * Read its header: the order is not a preference, it is the fix. Before the
 * migration this used `isMyReview` outright, and a housemate who shared a
 * display name genuinely did see this person's intentions.
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
  me: { uid?: string | null; email?: string | null; reviewName?: string | null },
): TbrEntry[] {
  return myReadingListEntries(docs, me, TBR_STATUS);
}

/**
 * The same list, at any `status` the shared store holds — `READING_LIST_STATUSES`.
 *
 * ⚠️ **`myTbrEntries` IS this function with `'tbr'` bound**, so there is one
 * ownership rule, one dedupe rule and one `bookId` guard between them. Added
 * 2026-08-26 for the owner's ask — *"can we also add a filter in each of the
 * search bars for tbr and other read states"* — and written this way round
 * rather than as a second reader for the reason `tbrFoldKey`'s header gives:
 * a second definition of "these documents are mine" is a second thing to get
 * out of step, and this one carries the whole account migration in it.
 *
 * ⚠️ **A status this catalog does not know is still DROPPED.** The caller picks
 * from `READING_LIST_STATUSES`, which is measured against the live collection
 * rather than assumed; anything else selects nothing, which is the honest
 * answer for a value only the sibling site understands.
 *
 * ⚠️ **`'read'` here means the DOCUMENT says read** — a state the audiobook
 * site writes and this catalog never has (measured: 162 documents, all
 * sibling-written). It is not `user_book.read_state`, which has its own filter;
 * see `READING_LIST_STATUSES` for why the two must not be folded together.
 */
export function myReadingListEntries(
  docs: readonly (TbrLike & { docId: string })[],
  me: { uid?: string | null; email?: string | null; reviewName?: string | null },
  status: string,
): TbrEntry[] {
  const byKey = new Map<string, TbrEntry>();

  for (const doc of docs) {
    if (!ownsTbrDoc(doc, me)) continue;
    if ((doc.status ?? '') !== status) continue;

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

/* ── ONE BOOK, ONE ROW — the media fold, 2026-08-26 ──────────────────────── */

/**
 * Which shelves a folded book can actually be reached on, and under what name.
 *
 * ⚠️ **Only the formats that EXIST get a link.** The owner's ask was *"we need
 * to have it single count with a link to all formats"* — all the formats it has,
 * not a row of three buttons two of which apologise. A `null` here is the
 * catalog saying it holds no such copy, which is a fact; a dead link would be a
 * claim.
 *
 * `audio.title` and `ebook.title` are the SIBLING catalog's own spelling
 * (`audiobook_holding.title`, `ebook_holding.title`) rather than this one's,
 * because both sites' only per-book link is a title search-hash
 * (`audiobookDetailUrl` / `ebookShelfUrl`) — searching them for *this* catalog's
 * spelling finds the right thing far less often, which is the same lesson
 * `DriveLinks` records for Drive.
 */
export interface TbrGroupFormats {
  /**
   * The physical shelf. `state` is the household's, not the person's:
   * `'owned'` when a copy is held or lent, `'wanted'` when only a wishlist copy
   * exists, `'none'` when the work is in the catalog with no copy at all.
   */
  physical: { workId: number; state: 'owned' | 'wanted' | 'none' } | null;
  /**
   * An `audiobook_holding` row exists for the matched work (migration
   * 0010/0390).
   *
   * ⚠️ `rawTitle` is that catalog's title **verbatim** (migration 0340) and it
   * is what the link searches on, because the stripped `title` loses the
   * volume — measured in `audiobookDetailUrl`'s header, 824 → 886 books of
   * 1,087 reached uniquely. Optional: `null` where the column was never
   * backfilled and absent from a response cached before this field, and both
   * mean "use `title`".
   */
  audio: { title: string; rawTitle?: string | null } | null;
  /** An `ebook_holding` row exists for the matched work (migration 0310). */
  ebook: { title: string } | null;
}

/**
 * One TBR document, with everything the fold is allowed to key on.
 *
 * ⚠️ Everything optional here is the CATALOG's answer, filled in by
 * `resolveTbrEntries` — never by the browser. The document itself carries only
 * `bookId`, `workKey` and `title`.
 */
export interface TbrFoldable {
  docId: string;
  bookId: string;
  /** The composite key, when the DOCUMENT carries one (library-written only). */
  workKey: string | null;
  /** The title as the document spells it. */
  title?: string | null;
  /** The work this catalog matched the entry to, if any. */
  workId?: number | null;
  /** ⚠️ The matched WORK's own `work_key` — not the document's. */
  workWorkKey?: string | null;
  /** The matched work's author string. */
  authors?: string | null;
  /** This catalog's title for the matched work. */
  workTitle?: string | null;
  /** This catalog's cover for the matched work. */
  workCoverUrl?: string | null;
  /** The cover the DOCUMENT carries — the sibling catalog's, usually. */
  coverUrl?: string | null;
  readState?: string | null;
  formats?: TbrGroupFormats | null;
}

/**
 * The key that decides whether two TBR documents are the same BOOK.
 *
 * ## ⚠️ The bug this exists to fix
 *
 * Owner, 2026-08-26: *"for the tbr list, it's double counting if something is
 * owned in multiple media sources. So if a book is audio, physical and ebook or
 * any combination we need to have it single count with a link to all formats."*
 *
 * A `readingLists` document id is `` `${uid}_${bookId}` `` and `bookId` is
 * `bookIdFromTitle(title)` — a slug of the title **as that catalog spells it**.
 * The audiobook site says *Firefight - The Reckoners, Book 2*, this one says
 * *Firefight*, so one intention becomes two documents and every surface that
 * counts documents counts it twice.
 *
 * ## ⚠️ FOLDING AT READ TIME, NEVER BY RE-KEYING THE STORE
 *
 * The obvious-looking fix — make both catalogs write one id — is a **migration**
 * of a persisted key, and §8 of `docs/info/tbr.md` already did one of those. It
 * would also be wrong: the audiobook site has no author for most rows and so
 * cannot build the composite key at all. So the documents stay exactly where
 * they are and the fold happens on the way out.
 *
 * ## The rungs, strongest first
 *
 * | # | Key | Reaches |
 * |---|---|---|
 * | 1 | the matched WORK's `work_key` | anything the catalog could resolve — including an audiobook-written document bridged through `audiobook_holding` / `ebook_holding` |
 * | 2 | the DOCUMENT's own `workKey` | library-written documents for books this catalog no longer holds |
 * | 3 | `workKeyFor(cleanAudiobookTitle(title), authors)` | an entry with a known author but no stored key |
 * | 4 | `bookId` — i.e. no fold | everything else |
 *
 * ⚠️ **Rung 4 is a REFUSAL, and it is the point.** There is no title-only rung:
 * two books called *Gold* are two books, and `myTbrEntries` already records why
 * a key with no `|` in it is not trusted. An entry that cannot be folded
 * honestly stays its own row — a list that is right and slightly long beats one
 * that quietly merges two different books. **No new matcher was written for
 * this**; every rung is `@lc/core`'s existing `titles.ts`.
 */
export function tbrFoldKey(row: TbrFoldable): string {
  const composite = (raw: string | null | undefined): string | null => {
    const key = typeof raw === 'string' ? raw.trim() : '';
    // The same guard `myTbrEntries` applies: `workKeyFor` always joins a folded
    // title to a folded author, so a value with no `|` is not one of ours.
    return key.includes('|') ? key : null;
  };

  const fromWork = composite(row.workWorkKey);
  if (fromWork) return `work:${fromWork}`;

  const fromDoc = composite(row.workKey);
  if (fromDoc) return `work:${fromDoc}`;

  const authors = typeof row.authors === 'string' ? row.authors.trim() : '';
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  if (authors && authors !== UNKNOWN_AUTHOR && title) {
    return `work:${workKeyFor(cleanAudiobookTitle(title), authors)}`;
  }

  return `book:${row.bookId}`;
}

/** One book, however many documents and formats recorded the intention. */
export interface TbrGroup<T extends TbrFoldable> extends TbrMatched {
  /** `tbrFoldKey`'s answer — stable, and what the count counts. */
  key: string;
  /** Every document that folded here, in the order they arrived. */
  entries: T[];
  /**
   * ⚠️ **EVERY document id in the group.** Taking a book off the list deletes
   * all of them: the person meant the book, not one catalog's copy of it, and
   * leaving the other document behind would light the sibling site's
   * `✓ To Be Read` button for a book they just cleared.
   */
  docIds: string[];
  workId: number | null;
  /**
   * ⚠️ **`'read'` if ANY document in the group is read.** *"Finishing one format
   * clears the intention"* is the owner's own rule (`docs/info/tbr.md` §5) and
   * this is where it lands once a book is several documents.
   */
  readState: string | null;
  title: string;
  authors: string | null;
  /** This catalog's cover, first non-null across the group. */
  workCoverUrl: string | null;
  /** The sibling catalog's cover, first non-null. Needs `resolveAudiobookCover`. */
  docCoverUrl: string | null;
  formats: TbrGroupFormats;
}

/** Owned beats wanted beats nothing, when two documents disagree. */
function mergePhysical(
  a: TbrGroupFormats['physical'],
  b: TbrGroupFormats['physical'],
): TbrGroupFormats['physical'] {
  if (!a) return b;
  if (!b) return a;
  const rank = { owned: 2, wanted: 1, none: 0 } as const;
  return rank[b.state] > rank[a.state] ? b : a;
}

/**
 * Fold a person's TBR onto one row per BOOK.
 *
 * ⚠️ **Pure, and deliberately the ONLY implementation.** Both the Worker (over
 * the catalog's own answer) and the browser (over that answer merged with the
 * Firestore titles) call this, so the number the route reports and the number of
 * cards on screen cannot come to disagree — the estate's "one fact, one home"
 * rule applied to a count rather than a document.
 *
 * Group order is first-seen order; entry order inside a group is the same. The
 * winner of every field is the FIRST non-null, which makes the result stable
 * against a re-fetch that returns the documents in another order only insofar as
 * the caller's own order is stable — the caller passes them in the order it read
 * them, and no field here is a tiebreak worth more than that.
 */
export function groupTbrEntries<T extends TbrFoldable>(rows: readonly T[]): TbrGroup<T>[] {
  const groups = new Map<string, TbrGroup<T>>();

  for (const row of rows) {
    const key = tbrFoldKey(row);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        entries: [],
        docIds: [],
        workId: null,
        readState: null,
        title: '',
        authors: null,
        workCoverUrl: null,
        docCoverUrl: null,
        formats: { physical: null, audio: null, ebook: null },
      };
      groups.set(key, group);
    }

    group.entries.push(row);
    group.docIds.push(row.docId);

    if (group.workId === null && typeof row.workId === 'number') group.workId = row.workId;
    if (group.authors === null && row.authors) group.authors = row.authors;
    if (group.workCoverUrl === null && row.workCoverUrl) group.workCoverUrl = row.workCoverUrl;
    if (group.docCoverUrl === null && row.coverUrl) group.docCoverUrl = row.coverUrl;

    // ⚠️ 'read' is sticky and beats everything: one finished format spends the
    // whole intention. 'reading' beats a bare row for the same reason in
    // miniature — the page says "you are reading this", and it is still true
    // when a second document says nothing at all.
    const state = row.readState ?? null;
    if (state === 'read') group.readState = 'read';
    else if (group.readState !== 'read' && state === 'reading') group.readState = 'reading';
    else if (group.readState === null) group.readState = state;

    const f = row.formats;
    if (f) {
      group.formats.physical = mergePhysical(group.formats.physical, f.physical);
      group.formats.audio = group.formats.audio ?? f.audio;
      group.formats.ebook = group.formats.ebook ?? f.ebook;
    }
  }

  // ⚠️ The title is chosen in a SECOND pass, not as the documents arrive: this
  // catalog's spelling wins over the sibling's wherever the group has one, and
  // the entry that carries it is not necessarily the first. The audiobook
  // packaging ("… - The Reckoners, Book 2") is what the person would otherwise
  // read on a card for a book this catalog knows plainly as *Firefight*.
  for (const group of groups.values()) {
    const fromCatalog = group.entries.find((e) => !!e.workTitle)?.workTitle;
    const fromDoc = group.entries.find((e) => !!e.title)?.title;
    group.title = fromCatalog || fromDoc || group.entries[0]?.bookId || '';
  }

  return [...groups.values()];
}
