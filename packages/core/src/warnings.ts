/**
 * Leaf module: reader-contributed **content warnings**, shared with the
 * audiobook catalog.
 *
 * Imports `constants.ts`, `reviews.ts` and `titles.ts` (all leaves, and none of
 * them `index.ts` — see CLAUDE.md). No I/O.
 *
 * ## The requirement
 *
 * The owner, 2026-08-17: *"port content warning feature over to all physical
 * book and the ebook site."* A note somebody adds on either site must be
 * visible on both, exactly as a review or a TBR entry is.
 *
 * ## ⚠️ The store already existed — and so did the trap
 *
 * `audiobook_catalog/site/user-warnings.js` writes
 * `user_content_warnings/{bookId}_{displayNameLower}_{topicId}` with
 * `{ bookId, bookTitle, label, displayName, authorUid, createdAt }`, dev lane
 * `user_content_warnings_dev` via `col()`. So this catalog joins that store
 * rather than inventing a second one — the same move `reviews.ts` and `tbr.ts`
 * make, for the same reason: one store cannot diverge from itself.
 *
 * **The trap is that `bookId` is a slug of the title as the AUDIOBOOK catalog
 * spells it, and this catalog spells the same book differently.** Measured
 * against production D1 on 2026-08-17: of the **92** works with an
 * `audiobook_holding` row, **33** are filed under a different title on the
 * other site, and **27 of those produce a different `bookId`** (the other six
 * differ only in punctuation, which `bookIdFromTitle` folds away) —
 *
 *     ours  "Sunrise on the Reaping"
 *     them  "Sunrise on the Reaping - A Hunger Games Novel"
 *     ours  "World's Only Hero"
 *     them  "World's Only Hero: An Apocalyptic LitRPG Adventure"
 *
 * — so `bookIdFromTitle(work.title)` alone would file this catalog's notes
 * under a key the audiobook site never asks about, and would find none of the
 * notes written there. Both halves fail silently, and both look exactly like
 * "nobody has added a warning yet".
 *
 * ## The identity join, and why it is NOT `workKey`
 *
 * Reviews span by a second field — `workKey` — which `backfill-review-keys.mjs`
 * stamped onto all 870 documents (`docs/info/identity-and-reviews.md` §7.6).
 * **That mechanism is unavailable here**: a warning document carries no
 * `workKey`, this catalog cannot run a backfill over documents the other site
 * writes from now on, and `user_content_warnings` was measured **empty in both
 * lanes** on 2026-08-17, so there is nothing to backfill anyway.
 *
 * What this catalog *does* have is the other side's own spelling of the title:
 * `audiobook_holding.title` (migration 0010) is *"what the AUDIOBOOK catalog
 * itself calls the book"* — `routes/audiobook-mapping.ts` already leans on
 * exactly that sentence for the reverse direction. Slugging it with the same
 * `bookIdFromTitle` that site uses reproduces its `bookId` byte for byte.
 *
 * So the join is: **the audiobook holding's title is the write key; this
 * catalog's own title is a fallback candidate for reads.**
 *
 * `workKey` still rides along on every document written here — additive, no
 * rules change (`validUserWarning()` asserts `label`, `bookId` and
 * `displayName` and ignores the rest) — so that a future sweep has the key it
 * would need. Nothing reads it yet, and nothing should pretend it does.
 */

import { MAX_WARNING_LABEL, UNKNOWN_AUTHOR } from './constants.js';
import { bookIdFromTitle } from './reviews.js';
import { cleanAudiobookTitle, workKeyFor } from './titles.js';

/**
 * ⚠️ **PORTED VERBATIM** from `addUserWarning` in
 * `audiobook_catalog/site/user-warnings.js`:
 *
 *     const docId = `${bookId}_${session.displayName.toLowerCase()}_${bookIdFromTitle(trimmed)}`.slice(0, 900);
 *
 * Three parts, and each one is load-bearing:
 *
 * - **`bookId` first** — note the contrast with `readingListDocId`, which puts
 *   the display name first (`tbr.ts` §2). The two orders are different because
 *   the two collections are, and neither may be "harmonised".
 * - **the folded display name** — one document per person.
 * - **the label slugged as a topic id** — this is the whole dedupe rule:
 *   re-adding the same topic overwrites the same document rather than filing a
 *   second one. Two people may both warn about the same thing; one person
 *   cannot warn about it twice.
 *
 * The 900-character clamp is Firestore's document-id limit (1,500 bytes) with
 * room to spare, and it is copied rather than recomputed for the same reason
 * everything else here is: a document id is an identity, not a formatting
 * choice.
 */
export function userWarningDocId(bookId: string, displayName: string, label: string): string {
  return `${bookId}_${displayName.toLowerCase()}_${bookIdFromTitle(label)}`.slice(0, 900);
}

/**
 * A warning document as it exists in the shared `user_content_warnings`
 * collection.
 *
 * The first four fields are the audiobook site's and are load-bearing for it.
 * `authorUid` is the 2026-08-17 delete binding — `firestore.rules`'
 * `canDeleteUserWarning()` compares it against `request.auth.uid`, so a note
 * written without one can only be removed by a moderator. The rest are this
 * catalog's additions and need no rules change.
 */
export interface UserWarningDoc {
  /** Their key. Slug of the title as the AUDIOBOOK catalog spells it. */
  bookId: string;
  /** What that site shows beside the note. The spelling `bookId` came from. */
  bookTitle: string;
  /** ≤ 80 characters, trimmed. `validUserWarning()` enforces the same bound. */
  label: string;
  displayName: string;
  /**
   * The author's Firebase uid — what the delete rule binds to.
   *
   * ⚠️ Stamped from the **verified token** here, not from a client claim: this
   * app keeps its Firebase session (`docs/info/identity-and-reviews.md` §2),
   * so the Worker already knows the uid the browser will write with. Omitted
   * rather than faked when it is unknown, exactly as the audiobook site omits
   * it for a legacy session — a note nobody can prove is theirs is one only a
   * moderator can take down, and the UI says so rather than letting it surface
   * as a PERMISSION_DENIED.
   */
  authorUid?: string;
  /** Ours: `normaliseTitle(cleanTitle)|normaliseTitle(primaryAuthor)`. */
  workKey?: string;
  /** Ours: which catalog recorded it. */
  source?: 'audio' | 'library';
  /** Ours: the signed-in Google address. See `ReviewDoc.email`. */
  email?: string;
}

/**
 * Every `bookId` a warning about this work could be filed under, and the one a
 * note written here must use.
 *
 * ⚠️ **`writeBookId` is the audiobook catalog's spelling whenever this catalog
 * knows it.** That is what makes a note added on the library visible on the
 * audiobook site: its book page asks `where bookId == bookIdFromTitle(its own
 * title)` and nothing else. Writing under our spelling would produce a
 * document neither site's reader can find but this one — a silo, not a note.
 */
export interface WarningKeys {
  /** The id a note written on THIS site is filed under. */
  writeBookId: string;
  /**
   * Every id to query, `writeBookId` first. Deduplicated, never empty.
   *
   * ⚠️ **This list is the alias layer, and it is why nothing had to be
   * rekeyed** when migration 0340 moved the write key from the cleaned title to
   * the raw one. Every spelling this catalog has ever filed under stays in the
   * read set forever, so a note written under yesterday's key is still found
   * today. Add to this list; never replace it.
   */
  bookIds: string[];
  /**
   * The exact title to look the PUBLISHED pipeline warnings up under, or null.
   *
   * `audiobook_catalog/site/content_warnings.json` is keyed by that catalog's
   * **full title string**, not a slug, so this is the holding's title verbatim.
   * Null when there is no holding: measured 2026-08-17 against the live file
   * (339 keys) and production D1 (92 holdings), matching on this catalog's own
   * title reached **zero** additional books — so the fallback would buy nothing
   * and could only mis-key two different books with one name.
   */
  publishedTitle: string | null;
}

/**
 * The identity join, in one function.
 *
 * @param title this catalog's own spelling — the fallback candidate.
 * @param audiobookRawTitle `audiobook_holding.raw_title` (migration 0340) — the
 *   sibling catalog's string **verbatim**. ⚠️ This is the canonical key when it
 *   is known; everything else here is a fallback or an alias.
 * @param audiobookTitle `audiobook_holding.title` — the same row's title with
 *   Audible's series decoration stripped. A read alias, never the write key.
 * @param audiobookTitleStale `stale_at IS NOT NULL` — the sibling catalog no
 *   longer confirms the match.
 *
 * ## ⚠️ RAW, not cleaned — migration 0340, and the bug it closes
 *
 * This function shipped on 2026-08-17 taking only `audiobookTitle`, on the
 * belief that `audiobook_holding.title` was "the other side's own spelling".
 * **It is not.** Migration 0010 stores that column already stripped by
 * `cleanTitleWithSeries`, which is right for showing a person the name that
 * matched and wrong for a key. Measured against production the same day:
 *
 *     ours            "Onyx Storm (The Empyrean)"
 *     holding.title   "Onyx Storm"                      <- what this used
 *     catalog.csv     "Onyx Storm - Empyrean, Book 3"   <- what BOTH other
 *                                                          surfaces key on
 *
 * **18 of the 92 holdings** matched an entry in `content_warnings.json` only
 * after folding — the whole Percy Jackson set, *Words of Radiance*, *Onyx
 * Storm*, two *Dungeon Crawler Carl* volumes — so their published warnings
 * reached the physical book as nothing at all, and a note added here would have
 * filed under a slug the audiobook site never queries.
 *
 * The third surface settles it: `audiobook_catalog`'s ebook shelf publishes
 * `audiobook_title` per manifest row as *"a raw title, never a slug"*
 * (`scripts/build_ebook_manifest.py`). Keying on the cleaned title here meant an
 * ebook and a paperback of one book filed under two different ids. One work, one
 * key, every format — that is the whole requirement, and the raw title is the
 * only spelling all three surfaces can agree on.
 *
 * ## ⚠️ A stale holding is READ but never WRITTEN to
 *
 * The split is deliberate and both halves have precedent in this repo. A stale
 * holding means the audiobook catalog no longer confirms that title exists over
 * there, so:
 *
 * - **Reads keep it.** A note may already sit under that key, and hiding it
 *   would look identical to "nobody added one" — the same reasoning
 *   `OtherVersions.tsx` gives for showing a stale holding to a person.
 * - **Writes refuse it.** Filing a new note under a spelling that side has
 *   stopped confirming buries it. `routes/audiobook-mapping.ts` excludes stale
 *   rows from its outbound join for the same reason: better to answer with our
 *   own key than to propagate one already flagged as doubtful.
 *
 * ## ⚠️ `matched_via` is deliberately NOT a write gate, and that was measured
 *
 * A containment match is a claim (migration 0010), so blocking writes on it
 * looked like the cautious move. Production says otherwise — all four
 * containment rows, 2026-08-17:
 *
 * | work | matched to | verdict |
 * |---|---|---|
 * | Harry Potter and the Goblet of Fire | …*(Full-Cast Edition)* | the SAME work, another edition — the exact case the owner asked to unify |
 * | Harry Potter and the Sorcerer's Stone | …*(Full-Cast Edition)* | same |
 * | Tamer: King of Dinosaurs Book 11 | *Tamer: King of Dinosaurs* | wrong volume — but already **stale**, so already write-excluded |
 * | Space Knight Book 1 | *Space Knight* | over-shares with Book 2 |
 *
 * So the rule would refuse two matches it should welcome, add nothing to the
 * one it would catch by staleness anyway, and still miss the real over-share:
 * *Space Knight Book 2* reaches the same title on the **exact** rung, through an
 * owner-authored `work_alias`. The mapping is reviewable — `matched_via`,
 * `title_similarity` and `via_alias` are stored per row and printed by the
 * backfill — and that is where an over-share is corrected, not by a read-time
 * heuristic in here.
 */
export function warningKeysFor(params: {
  title: string;
  audiobookRawTitle?: string | null;
  audiobookTitle?: string | null;
  audiobookTitleStale?: boolean;
}): WarningKeys {
  const ours = bookIdFromTitle(params.title);

  // ⚠️ Raw first, and the fallback is not cosmetic: every `audiobook_holding`
  // row written before migration 0340 has `raw_title` NULL, and NULL means "not
  // recorded", never "same as `title`". Falling back to the cleaned title
  // reproduces the pre-0340 behaviour for those rows rather than losing the
  // holding entirely — they recover their real key the next time
  // `npm run backfill:audiobooks` runs.
  const rawTitle = (params.audiobookRawTitle ?? '').trim();
  const cleanedTitle = (params.audiobookTitle ?? '').trim();
  const theirTitle = rawTitle || cleanedTitle;

  const theirs = theirTitle ? bookIdFromTitle(theirTitle) : '';
  const live = theirs && !params.audiobookTitleStale ? theirs : '';
  const writeBookId = live || ours;

  // Every id this work's notes could sit under, newest convention first. The
  // cleaned-title id is in here precisely BECAUSE it used to be the write key:
  // dropping it would orphan anything filed between the feature shipping and
  // 0340 landing. An alias costs one Firestore query; an orphan is invisible.
  const alsoCleaned = cleanedTitle ? bookIdFromTitle(cleanedTitle) : '';
  const bookIds: string[] = [];
  for (const id of [writeBookId, theirs, alsoCleaned, ours]) {
    if (id && !bookIds.includes(id)) bookIds.push(id);
  }

  return {
    writeBookId,
    bookIds,
    // The published file is the audiobook pipeline's own, keyed by its own raw
    // titles — a stale holding's title is still the title those entries were
    // filed under, so it is offered for the same reason a stale holding is
    // shown at all. The page names the title it looked under.
    publishedTitle: theirTitle || null,
  };
}

/**
 * Build the warning document for a book in *this* catalog.
 *
 * Mirrors `reviewDocFor` and `tbrDocFor` down to the refusal:
 *
 * ⚠️ **Throws on `UNKNOWN_AUTHOR`.** A note against a provisional (authorless)
 * work would carry the provisional `workKey` and come loose the day the author
 * arrives — and the sentinel would exist in Firestore, the one place
 * `docs/info/edit-and-audit-design.md` §3.4 requires it never appear. The route
 * answers a friendly refusal before this is reached; the throw is the backstop.
 *
 * ⚠️ **Throws on an over-long or empty label.** `validUserWarning()` in
 * `firestore.rules` refuses `label.size() > 80` outright, so a document built
 * past that bound is a guaranteed PERMISSION_DENIED dressed up as a bug. The
 * schema refuses first; this is the backstop for a caller that skipped it.
 */
export function warningDocFor(params: {
  title: string;
  authors: string;
  label: string;
  displayName: string;
  email?: string | null;
  authorUid?: string | null;
  /** `audiobook_holding.raw_title` — the key spelling. See `warningKeysFor`. */
  audiobookRawTitle?: string | null;
  audiobookTitle?: string | null;
  audiobookTitleStale?: boolean;
}): { id: string; doc: UserWarningDoc } {
  if (params.authors === UNKNOWN_AUTHOR) {
    throw new Error(
      'warningDocFor refuses a provisional work: add the author first — a note written now would come loose when it arrives.',
    );
  }
  const label = params.label.trim();
  if (!label) throw new Error('warningDocFor refuses an empty note.');
  if (label.length > MAX_WARNING_LABEL) {
    throw new Error(
      `warningDocFor refuses a note longer than ${MAX_WARNING_LABEL} characters — firestore.rules rejects it.`,
    );
  }

  const keys = warningKeysFor({
    title: params.title,
    audiobookRawTitle: params.audiobookRawTitle,
    audiobookTitle: params.audiobookTitle,
    audiobookTitleStale: params.audiobookTitleStale,
  });

  // ⚠️ `bookTitle` is the spelling `writeBookId` was derived FROM, not always
  // this catalog's own. The audiobook site prints this string beside the note,
  // and printing our title against their slug would show a book name that does
  // not match the page it is on. Since 0340 that spelling is the RAW one, so
  // the fallback chain has to follow `warningKeysFor`'s exactly — raw, then
  // cleaned, then ours — or the printed name and the id it was built from
  // disagree, which is the one thing this field exists to prevent.
  const theirBookTitle = (params.audiobookRawTitle ?? '').trim() || params.audiobookTitle || null;
  const bookTitle =
    keys.writeBookId === bookIdFromTitle(params.title)
      ? params.title
      : (theirBookTitle ?? params.title);

  const doc: UserWarningDoc = {
    bookId: keys.writeBookId,
    bookTitle,
    label,
    displayName: params.displayName,
    workKey: workKeyFor(cleanAudiobookTitle(params.title), params.authors),
    source: 'library',
  };
  if (params.authorUid) doc.authorUid = params.authorUid;
  if (params.email) doc.email = params.email;

  return { id: userWarningDocId(keys.writeBookId, params.displayName, label), doc };
}

/** The fields of a warning document these rules read. Nothing else. */
export interface WarningLike {
  authorUid?: string | null;
  displayName?: string | null;
}

/**
 * May this person take this note down — and if not, what do they need?
 *
 * ⚠️ **This is UX, not the gate.** The gate is `canDeleteUserWarning()` in
 * `audiobook_catalog/firestore.rules`: the delete succeeds only when the
 * document's `authorUid` equals the caller's live Firebase uid, or the caller
 * holds `moderator`/`admin` in the **estate's `site_roles` collection**. This
 * function decides which affordance to draw and which worded refusal to show,
 * and it fails closed — a caller that lies about `canModerate` is refused by
 * the rules, and the refusal is worded by `describeStoreError`.
 *
 * ⚠️ **`canModerate` is this catalog's `moderateContent` capability, and
 * `site_roles` is a DIFFERENT record.** A library moderator with no `site_roles`
 * document will see the affordance and be refused by Firestore. That is stated
 * in words rather than hidden, because the fix — ask for the estate-wide
 * moderator role — is not something the person could guess from a silent
 * button.
 *
 * The refusal wording is ported from `deleteUserWarning` in
 * `site/user-warnings.js`, including the distinction that matters most: a note
 * with a matching NAME but no `authorUid` predates the binding and is not
 * self-deletable, and saying so ("add it again and it becomes yours") is the
 * difference between a dead end and an instruction.
 */
export type WarningDeleteVerdict =
  | { allowed: true; via: 'author' | 'moderator' }
  | { allowed: false; reason: string };

export function warningDeleteVerdict(
  warning: WarningLike,
  me: { uid?: string | null; displayName?: string | null; canModerate?: boolean },
): WarningDeleteVerdict {
  const uid = me.uid ?? null;
  const authored = !!warning.authorUid && !!uid && warning.authorUid === uid;
  if (authored) return { allowed: true, via: 'author' };
  if (me.canModerate) return { allowed: true, via: 'moderator' };

  const mine = (me.displayName ?? '').trim().toLowerCase();
  const theirs = (warning.displayName ?? '').trim().toLowerCase();
  if (!mine || mine !== theirs) {
    return { allowed: false, reason: 'You can only remove notes you added.' };
  }
  if (!uid) {
    return {
      allowed: false,
      reason:
        'Sign in with Google again to remove this — this session cannot prove the note is yours. ' +
        'A site moderator can take it down for you.',
    };
  }
  return {
    allowed: false,
    reason:
      'This note was added before removals were tied to your account, so only a site moderator can ' +
      'take it down. Add it again and it becomes yours to remove.',
  };
}

/** One published warning, as `content_warnings.json` carries it. */
export interface PublishedWarning {
  label: string;
  source_url?: string | null;
}

/** One book's entry in that file. `warnings: []` means "looked, found none". */
export interface PublishedWarningEntry {
  warnings?: PublishedWarning[] | null;
  /** Unix seconds. Absence means the pipeline has never looked. */
  checked_at?: number | null;
}

/**
 * The published warnings for a book, from the audiobook pipeline's own file.
 *
 * ⚠️ **An empty `warnings` array is NOT the same as no entry**, and collapsing
 * the two would throw away the more useful of the two facts. An entry with zero
 * warnings means the pipeline looked and found nothing; no entry at all means
 * nobody has looked. The page says which.
 *
 * Pure, and exported for the browser and for the test — the fetch itself lives
 * in `apps/web/src/lib/warnings.ts`, because this file does no I/O.
 */
export function publishedWarningsFor(
  file: Record<string, PublishedWarningEntry> | null,
  publishedTitle: string | null,
): { checked: boolean; warnings: PublishedWarning[] } {
  if (!file || !publishedTitle) return { checked: false, warnings: [] };
  const entry = file[publishedTitle];
  if (!entry) return { checked: false, warnings: [] };
  const warnings = (entry.warnings ?? []).filter(
    (w): w is PublishedWarning => !!w && typeof w.label === 'string' && w.label.trim().length > 0,
  );
  return { checked: true, warnings };
}
