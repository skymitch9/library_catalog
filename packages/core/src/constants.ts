/**
 * Leaf module: the closed sets the rest of the package builds on.
 *
 * ⚠️ These live here rather than in index.ts so `schemas.ts` can import them
 * without a cycle. index.ts re-exports schemas.ts, so a schemas.ts that imported
 * back from index.ts would find the constants still `undefined` when zod tried
 * to build enums out of them at module-init time — and every write endpoint
 * would return 500 with a misleading message. **Typecheck does not catch it.**
 * Carried across from the Board Game Catalog, where it happened.
 *
 * Nothing under src/ may import from index.ts.
 */

/**
 * ⚠️ The stored stand-in for "no author recorded". Migration 0120.
 *
 * Chosen to be impossible: `normaliseTitle`'s output alphabet is [a-z0-9 ]
 * (titles.ts — every other character is folded to a space or dropped), so no
 * real author can ever fold to a string containing '?'. That single character
 * is the entire collision proof: `gold|?unknown` cannot equal any key
 * `workKeyFor` derives from a real author, **including an author literally
 * credited as "Unknown" or "Author Unknown"** — those fold to 'unknown',
 * without the '?'. The proof needs `workKeyFor`'s sentinel branch to hold
 * (folding the sentinel itself would yield plain 'unknown'); `core.test.ts`
 * asserts both halves, so deleting the branch fails a test rather than
 * silently colliding every authorless book with real "Unknown"-credited ones.
 *
 * It exists in exactly three places: this constant, the two mapping points in
 * `@lc/db` (`toWork` reads it out as null; `createWork`/`updateWork` write
 * null back in as it), and the database file itself. Above the row boundary
 * the app type is `string | null`, so the compiler finds every reader that
 * must handle an unknown author.
 *
 * ⚠️ It must NEVER appear in Firestore. `reviewDocFor` throws on it, and that
 * refusal is what makes filling the author in later a free key move — zero
 * review documents can ever carry a provisional key, so zero can be orphaned.
 * See docs/info/edit-and-audit-design.md §3.
 */
export const UNKNOWN_AUTHOR = '?unknown';

/**
 * ⚠️ Mirrored by a CHECK constraint on `app_user.role` — migration 0300 is the
 * current definition (0008 defined the previous four-value ladder: `owner`,
 * `manager`, `reader`, `pending`). Adding a value here without a migration
 * means the role is assignable in the UI, passes zod, and then fails at the
 * write with a bare SQLITE_CONSTRAINT.
 *
 * ## The ladder — redesigned 2026-08-16, owner-approved verbatim ("Role
 * matrix approved")
 *
 * `guest < member < contributor < moderator < admin < owner`, **cumulative**:
 * each rung has everything the one below it, plus more. `ROLE_LADDER` below
 * is the ordered list that claim is checked against; `canGrantRole` in
 * capabilities.ts is the escalation rule built on it.
 *
 * `manager` and `reader` are gone, migrated rather than dropped out from under
 * anyone: migration 0300 rewrites every stored `manager` to `moderator` and
 * every stored `reader` to `member`, chosen so **no existing user loses a
 * capability** — see the CAPABILITY_MATRIX comment in capabilities.ts, where
 * `manager`'s old row is a strict subset of `moderator`'s new one. `guest`,
 * `contributor` and `admin` are new; nobody is migrated into them
 * automatically — they are assigned by hand from the People page exactly like
 * every other role above `pending`.
 *
 * `admin` is new and holds `manageUsers` (capabilities.ts), ending the old
 * rule that `manager` — now `moderator` — could do anything to the catalog and
 * nothing to the guest list: that rule now belongs to `moderator`, and `admin`
 * is the delegate for the guest list itself, capped so it can never mint
 * another `admin` or an `owner` (see `canGrantRole`).
 *
 * `pending` is unchanged and is **not** a ladder rung — it is a STATUS
 * (awaiting approval), and `ROLE_LADDER` deliberately excludes it. Nothing
 * here compares `pending`'s "rank" against another role's; the request screen
 * the capability layer already shows a pending person is enough.
 */
export const ROLES = [
  'owner',
  'admin',
  'moderator',
  'contributor',
  'member',
  'guest',
  'pending',
] as const;
export type Role = (typeof ROLES)[number];

/**
 * The ladder, strictly ordered low → high, with `pending` excluded on purpose
 * — see the block above. `canGrantRole` (capabilities.ts) and anything else
 * that needs to compare "is X above Y" reads this array, not `ROLES`, so
 * `pending` can never accidentally be ranked against a real role.
 */
export const ROLE_LADDER = [
  'guest',
  'member',
  'contributor',
  'moderator',
  'admin',
  'owner',
] as const;
export type LadderRole = (typeof ROLE_LADDER)[number];

/**
 * What a printing is.
 *
 * This one column is what makes *"I own this in audio and paperback but not
 * ebook"* a query rather than a feature. Audiobooks are NOT here: they live in
 * `audiobook_catalog`, are pipeline-fed three times a day, and are read-only to
 * this app. The two meet through `workKey`, not by merging.
 */
export const EDITION_FORMATS = [
  'hardcover',
  'paperback',
  'mass_market',
  // The five ebook file formats. Added for the Calibre-Web Automated pipeline,
  // which was built and run on 2026-08-09 and is currently PAUSED — see the
  // "ebook pipeline" section of docs/HANDOFF.md, and the removed
  // docs/EBOOK_PIPELINE.md in git history.
  //
  // Kept rather than reverted because the 81 works it catalogued are still in
  // the collection and still hold these values, and because ebooks are expected
  // to come back. Unused values in an enum cost nothing; a migration that has to
  // be undone costs a table rebuild.
  'ebook_epub',
  'ebook_mobi',
  'ebook_azw3',
  'ebook_kepub',
  'ebook_pdf',
  // ⚠️ A LICENCE, not a file. A book in the Amazon library with an ASIN and no
  // bytes we hold. Phase 0 measured this population as large — 16 of 30 sampled
  // titles have no Open Library record and are overwhelmingly Kindle Unlimited
  // or Audible-native. They are real editions and must be catalogable without
  // pretending a file exists, because nothing can send one to a device.
  'ebook_kindle',
] as const;
export type EditionFormat = (typeof EDITION_FORMATS)[number];

/** Formats you can hold. Everything else is a licence or a file. */
export const PHYSICAL_FORMATS: readonly EditionFormat[] = [
  'hardcover',
  'paperback',
  'mass_market',
];

/**
 * Which shelf a printing lives on — a thing you can hold, or a thing you cannot.
 *
 * ⚠️ Deliberately two values and not three. **There is no `audio` medium**, and
 * there must not be one: open question 5 in `docs/HANDOFF.md` settles it, and
 * `EDITION_FORMATS` above says why. Audiobooks are not editions of anything in
 * this database; they are rows in the sibling catalog, cached into
 * `audiobook_holding` (migration 0010) and joined by `work_id`. A third medium
 * here would be the first step towards `edition.format = 'audiobook'`, which is
 * the merge that catalog's owner has already refused.
 *
 * `PHYSICAL_FORMATS` is the closed list of things with mass. Everything else in
 * the enum is a file or a licence, which for the question this answers — *do we
 * have this on the shelf, or on a screen?* — are the same answer.
 *
 * ⚠️ **Derived from `PHYSICAL_FORMATS`, never listed twice.** `ebook` is defined
 * as *not physical* rather than as its own list, so a format added to
 * `EDITION_FORMATS` tomorrow lands on one side of this line without anybody
 * remembering to widen a second array. That is also why `editionMedium` is
 * total: every `EditionFormat` is one or the other, with no third bucket for a
 * value to fall into unnoticed.
 *
 * ⚠️ This block was declared **twice** after two branches added it
 * independently, and git merged both without raising a conflict — the duplicate
 * only surfaced as `TS2451: Cannot redeclare`. If you are about to add a coarse
 * medium helper, it already exists; use this one.
 */
export const EDITION_MEDIA = ['physical', 'ebook'] as const;
export type EditionMedium = (typeof EDITION_MEDIA)[number];

export function editionMedium(format: string): EditionMedium {
  return (PHYSICAL_FORMATS as readonly string[]).includes(format) ? 'physical' : 'ebook';
}

/**
 * Formats that are a file CWA can hold, convert and send to a device.
 *
 * ⚠️ `ebook_kindle` is deliberately absent: it is an Amazon licence with no
 * bytes on our side. Anything that offers "send to my reader" must gate on this
 * list, or it will offer to send a file that does not exist.
 */
export const EBOOK_FILE_FORMATS: readonly EditionFormat[] = [
  'ebook_epub',
  'ebook_mobi',
  'ebook_azw3',
  'ebook_kepub',
  'ebook_pdf',
];

/** Whether this is a thing you can hold. The one test; nothing re-lists it. */
export function isPhysicalFormat(format: string): boolean {
  return (PHYSICAL_FORMATS as readonly string[]).includes(format);
}

/** Which side of the line a format falls on. Total over `EditionFormat`. */
export function mediumOf(format: string): EditionMedium {
  return isPhysicalFormat(format) ? 'physical' : 'ebook';
}

export const COPY_STATUSES = [
  'owned',
  'wanted',
  'preordered',
  'lent',
  'sold',
  'borrowed',
] as const;
export type CopyStatus = (typeof COPY_STATUSES)[number];

/**
 * The statuses that mean "we do not have this yet, and we mean to".
 *
 * ⚠️ Two values, not one. A pre-order is a wishlist entry that has already been
 * paid for, and collapsing it into `wanted` would make the wishlist offer to buy
 * a book that is on its way. `sold`, `lent` and `borrowed` are deliberately not
 * here: they describe a book that exists in this house's orbit.
 */
export const WISHLIST_STATUSES: readonly CopyStatus[] = ['wanted', 'preordered'];

/**
 * Statuses that mean a copy is on the shelf right now.
 *
 * `lent` counts: the book is ours, it is just in someone else's hands. `sold` and
 * `borrowed` do not — one has left and the other never arrived.
 */
export const HELD_STATUSES: readonly CopyStatus[] = ['owned', 'lent'];

/**
 * How two books can be connected without sharing a series.
 *
 * See migration 0004 for the case behind each one; every value was chosen from a
 * pair of works actually in this catalog, not from a taxonomy.
 */
export const WORK_RELATIONS = [
  /** Same fictional world, no reading order implied. The Cosmere. */
  'same_universe',
  /** A guide, a sampler, an art book, a side story. */
  'companion',
  /** An omnibus or a bind-up, and the books printed inside it. */
  'contains',
  /** Reading order across a series boundary — prequel to sequel. */
  'precedes',
] as const;
export type WorkRelation = (typeof WORK_RELATIONS)[number];

/**
 * ⚠️ The relations where which end is which is the entire meaning.
 *
 * A symmetric relation is stored with the lower id first so A↔B and B↔A collapse
 * onto one row. Doing that to a directional one turns a true statement into a
 * false one — see the comment on `work_relation.relation` in migration 0004.
 */
export const DIRECTIONAL_WORK_RELATIONS: readonly WorkRelation[] = ['contains', 'precedes'];

export function isDirectionalRelation(relation: WorkRelation): boolean {
  return DIRECTIONAL_WORK_RELATIONS.includes(relation);
}

/**
 * Who said a volume of a series exists.
 *
 * There is deliberately no 'inferred' and no 'guess'. A volume with no source has
 * no business being a row — see the head of migration 0003.
 *
 * ⚠️ `claude_research` joined the other three in migration 0200, which rebuilt
 * `series_volume` and `series_check` to widen their CHECK constraints — this
 * array and those two CHECKs must be edited together, or a row this app would
 * happily write is refused by the database with a constraint error instead.
 */
export const SERIES_VOLUME_SOURCES = [
  'audiobook_catalog',
  'openlibrary',
  'manual',
  'claude_research',
] as const;
export type SeriesVolumeSource = (typeof SERIES_VOLUME_SOURCES)[number];

/**
 * What an alias in `work_alias` is an alias *of*.
 *
 * ⚠️ Two values and not one free-form string, and the reason is the author gate.
 * `matching.ts` refuses a title match whose author contradicts, and that refusal
 * is the check that keeps a differently-titled book by somebody else out of this
 * catalog. An untyped alias tried against both fields would let an alternate
 * *title* widen the *author* gate, which is the one thing that must not happen.
 *
 * - `title` — the book is printed under another name. *Northern Lights* / *The
 *   Golden Compass*. This is what migration 0001 built the table for.
 * - `author` — the book is filed elsewhere under another name. *He Who Fights
 *   with Monsters* is **Travis Deverell** here and **Shirtaloon** on Open
 *   Library; *White Sand*'s `authors` names the artist and the scriptwriter and
 *   omits Brandon Sanderson entirely.
 *
 * See migration 0005 for the measured cases behind each.
 */
export const WORK_ALIAS_KINDS = ['title', 'author'] as const;
export type WorkAliasKind = (typeof WORK_ALIAS_KINDS)[number];

/**
 * Who said so. `manual` is a person's answer and no importer may overwrite it —
 * the same rule `scripts/series-overrides.json` follows.
 */
export const WORK_ALIAS_SOURCES = ['openlibrary', 'manual'] as const;
export type WorkAliasSource = (typeof WORK_ALIAS_SOURCES)[number];

export const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'poor'] as const;
export type Condition = (typeof CONDITIONS)[number];

/**
 * What came in the box that is not a book.
 *
 * ⚠️ Closed so the panel can group and the audit can count, with `other` as a
 * deliberate escape hatch — a list of merch cannot be complete. A row that cannot
 * be filed is a row an import drops; `other` plus the free-text `name` is never
 * wrong. Must match the CHECK in migration 0011.
 *
 * ⚠️ `standee`, `model`, `dust_jacket` and `slipcase` come from the purchase
 * scan, not from a taxonomy. **The Primal Hunter box set is one book product and
 * roughly twenty-three accessories.** On a pledge like that the accessories are
 * the pledge, and filing them all as `other` would make the panel useless at
 * exactly the moment it matters most.
 */
export const ACCESSORY_KINDS = [
  'plush',
  'pin',
  'art_print',
  'bookmark',
  'sticker',
  'poster',
  'map',
  'card',
  'dice',
  'coin',
  'patch',
  'apparel',
  'bag',
  'sleeve',
  'slipcase',
  /** Measured: a V1 dust jacket delivered by a later campaign's pledge. */
  'dust_jacket',
  'standee',
  /** A 3D print file or a figure. Measured: an STL among the rewards. */
  'model',
  'signed_plate',
  'audio',
  'other',
] as const;
export type AccessoryKind = (typeof ACCESSORY_KINDS)[number];

/**
 * "Asked and answered" about a reward line's printing.
 *
 * ⚠️ The same two values as `GAP_VERDICTS`, for the same reason, and there is
 * deliberately no `found`: a found printing is `pledge_item.edition_id`, and a
 * verdict beside it would be a second copy of the same fact.
 *
 * The case that forced it is measured: one pledge routinely delivers **ebook +
 * print + audiobook together**, and the audiobook line can never have an
 * `edition` — `EDITION_FORMATS` has no audiobook value and never will (audio
 * lives in `audiobook_catalog`). Without a verdict it would sit in the audit's
 * "no printing" queue forever, and a queue that cannot empty is a queue nobody
 * reads.
 */
export const PLEDGE_ITEM_VERDICTS = ['none', 'unknown'] as const;
export type PledgeItemVerdict = (typeof PLEDGE_ITEM_VERDICTS)[number];

/**
 * Where a pledge was made.
 *
 * Three, and no `gamefound` — that is a board game platform and this catalog has
 * never seen a book on it. Must match the CHECK in migration 0010.
 */
export const CROWDFUNDING_PLATFORMS = ['kickstarter', 'backerkit', 'indiegogo'] as const;
export type CrowdfundingPlatform = (typeof CROWDFUNDING_PLATFORMS)[number];

/**
 * Where a pledge stands.
 *
 * `partial` exists because it is the ordinary state of a book pledge: the ebook
 * arrives at once and the hardcover eighteen months later. Collapsing it into
 * `pledged` or `delivered` would make one of the two lines lie.
 */
export const PLEDGE_STATUSES = [
  'pledged',
  'delivered',
  'partial',
  'cancelled',
  'refunded',
] as const;
export type PledgeStatus = (typeof PLEDGE_STATUSES)[number];

/**
 * Where a book stands with one reader.
 *
 * `reference` is not a synonym for unread: a cookbook, a rulebook or a field
 * guide is *used*, never finished, and filing it as unread makes every
 * "what haven't I read" list wrong forever.
 */
export const READ_STATES = ['unread', 'reading', 'read', 'dnf', 'reference'] as const;
export type ReadState = (typeof READ_STATES)[number];

/** How a reader actually consumed it, when they know. */
export const READ_FORMATS = ['print', 'ebook', 'audio'] as const;
export type ReadFormat = (typeof READ_FORMATS)[number];

/**
 * How a read state came to say what it says. Migration 0070.
 *
 * ⚠️ Not `DECISION_MODES`, though the shape is identical and the temptation is
 * obvious. 'auto' answers *"was it read before it was applied"*; this answers
 * *"on what evidence"*, and the evidence kind is the part worth keeping. There
 * is one kind today and there are obvious future ones — an import, a Goodreads
 * shelf — and every one of them must stay distinguishable from a rating. Spend
 * 'auto' here and there is nothing left to tell the second source apart with.
 *
 * - `'human'`  — somebody pressed a read-state chip. `setReadState` is the only
 *                writer that stamps it, and nothing may overrule it.
 * - `'rating'` — derived from a rating this person left, on either catalog. See
 *                `deriveReadState` in `readstate.ts`.
 * - `NULL`     — the row predates the column, or exists only because
 *                `cacheRating` minted it. Deliberately not backfilled; see the
 *                head of migration 0070.
 */
export const READ_STATE_SOURCES = ['human', 'rating'] as const;
export type ReadStateSource = (typeof READ_STATE_SOURCES)[number];

/**
 * How a work's shared fictional universe came to say what it says. Migration
 * 0080.
 *
 * Same shape and the same reasoning as `READ_STATE_SOURCES` above — the evidence
 * kind, not `DECISION_MODES`' "was it reviewed". A second machine source is
 * foreseeable here (an LLM pass over the seriesless remainder is the obvious
 * one) and it has to stay distinguishable from the hand-curated list.
 *
 * - `'list'`  — `universeFor` matched `catalog-platform/data/universes.json`.
 *               Re-resolvable: `scripts/backfill-universes.mjs` rewrites exactly
 *               these rows when the list grows.
 * - `'human'` — somebody said so. Nothing may overrule it. ⚠️ Meaningful even
 *               when the universe is NULL — that pair is a person saying "this
 *               book is in no universe", and it must survive a later title or
 *               series edit that would otherwise re-resolve the row.
 * - `NULL`    — nobody has decided. Every row that predates 0080, and every row
 *               the list has nothing to say about.
 *
 * ⚠️ The *values* this describes are universe names owned by another repo, so
 * there is deliberately no enum of them here — see `docs/info/universes.md` §1.
 * `universeNames` in `@lc/universes` is the live list; a copy in this leaf would
 * be the drift that moving the list out of this repo exists to prevent.
 */
export const UNIVERSE_SOURCES = ['list', 'human'] as const;
export type UniverseSource = (typeof UNIVERSE_SOURCES)[number];

/**
 * Which catalog a review was written from, and therefore what it is a review
 * *of*. Stored on the shared Firestore document as `source`.
 *
 * ⚠️ This is not bookkeeping — it is the honesty guard. An audiobook review is
 * partly a review of a **narrator**; a print review is not. Porting both into
 * one place without recording which is which would make "5 stars" on a paperback
 * mean something it never said. The book page renders "audiobook" beside every
 * one of them, always. See `reviews.ts`, which owns the rest of that contract.
 *
 * ⚠️ It lives here, in the leaf, rather than beside `ReviewDoc`, for one narrow
 * reason: `schemas.ts` needs `z.enum()` over it, and `schemas.ts` may import
 * `constants.ts` and nothing else. The alternative — a second copy of the list
 * inside a schema — is the failure mode this whole file exists to prevent.
 */
export const REVIEW_SOURCES = ['audio', 'library'] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

/** Where an edition's facts came from. 'manual' outranks all and is never overwritten. */
export const EDITION_SOURCES = [
  'manual',
  'openlibrary',
  'googlebooks',
  'kindle',
  'file',
  'research',
  /** Ingested from the Calibre-Web Automated library. */
  'cwa',
] as const;
export type EditionSource = (typeof EDITION_SOURCES)[number];

/**
 * Research source priority. Lower index wins on a conflicting claim.
 *
 * The tiers are the board game catalog's; only the domain lists change (see
 * packages/research/src/tiers.ts). `allowed_domains` is what makes tier ordering
 * real rather than a prompt preference, and it ports unchanged.
 */
export const SOURCE_TIERS = ['official', 'crowdfunding', 'retail', 'community'] as const;
export type SourceTier = (typeof SOURCE_TIERS)[number];

/**
 * The one finding origin that is not a web claim at all: a value copied from a
 * sibling instance of this same app (the donor-first details sweep, owner ask
 * 2026-08-16 — *"before pinging the ai it checks other libraries"*).
 *
 * ⚠️ Deliberately NOT added to `SOURCE_TIERS`. That list is the enum the
 * research model answers from (`packages/research/src/details.ts` puts it in
 * the tool schema) and the conflict ranking `tierRank` orders — a model must
 * never be able to claim its answer came from the donor, and "another catalog
 * the owner curates" does not sit anywhere on a web-source trust ladder.
 * `research_finding.source_tier` accepts it via migration 0320.
 */
export const DONOR_SOURCE_TIER = 'donor' as const;

/**
 * The donor's second rung: a value copied from the sibling instance where the
 * canonical key did **not** match and an AI judge said the two rows are the
 * same WORK anyway (owner ask 2026-08-16 — *"have our ai model do a back up
 * search on donors for fuzzy match before going to web"*). Migration 0321.
 *
 * ⚠️ A separate value from `DONOR_SOURCE_TIER`, and the separation is
 * load-bearing rather than decorative. `'donor'` means *the canonical
 * `work_key` (or a unique folded title) matched* — an identity this codebase
 * computes and can re-check. This one means *a model was asked whether two
 * differently-named rows are the same book*, which is exactly the §4.4 failure
 * shape (right title, wrong book) the donor route otherwise refuses to guess
 * at. One column tells the two apart for ever, in SQL, without joining to the
 * run that produced them.
 *
 * It is also the **mechanical** half: `autoApplyFindings` refuses to apply a
 * finding wearing this tier unless its caller opts in by name, so a judged
 * match that was not confident stays `pending` for a person no matter which
 * later run sweeps the work. See `apps/worker/src/lib/research-run.ts`.
 */
export const DONOR_FUZZY_SOURCE_TIER = 'donor_fuzzy' as const;

/**
 * What `research_finding.source_tier` may actually hold: one of the model's
 * four tiers, or either donor rung. Must match migration 0321's CHECK list
 * (which extends 0320's).
 */
export type FindingSourceTier =
  | SourceTier
  | typeof DONOR_SOURCE_TIER
  | typeof DONOR_FUZZY_SOURCE_TIER;

/**
 * What a `research_run` can be a run *of*. Three name a source tier; `details`
 * does not — it is a single cheap open-web pass, not a search restricted to a
 * publisher's domain. Kept as a separate list so nothing may treat 'details' as
 * somewhere a claim came from.
 *
 * Must match the CHECK constraint in migration 0001.
 */
export const RUN_TIERS = ['official', 'crowdfunding', 'retail', 'details'] as const;
export type RunTier = (typeof RUN_TIERS)[number];

/**
 * The facts the details queue asks a book for.
 *
 * ⚠️ A closed, short list, and the shortness is the feature. Measured against
 * production on 2026-08-10, **every** column on `work` and `edition` is null on
 * almost every row — 116 of 116 works have no `first_published`, 117 of 117
 * editions have no ISBN. A queue built from "which columns are null" would
 * therefore list the whole catalog against every column and tell nobody
 * anything. `packages/core/src/gaps.ts` carries the field-by-field reasoning for
 * what is on this list and, more importantly, what is refused.
 */
export const DETAIL_FIELDS = [
  'firstPublished',
  'series',
  'seriesIndex',
  'description',
] as const;
export type DetailField = (typeof DETAIL_FIELDS)[number];

/**
 * What a `gap_verdict` row says (migration 0005).
 *
 * Both values mean *asked and answered*, which is the distinction the whole
 * table exists to draw. There is deliberately no `found` — a found value is
 * written into the column it belongs in, and a verdict row beside it would be a
 * second copy of the same fact.
 *
 * Modelled on `scripts/series-overrides.json`, whose `verdict` of
 * `series` / `standalone` / `unknown` is the same three-way distinction: the
 * value goes in the column, and the other two go here.
 */
export const GAP_VERDICTS = [
  /** This book genuinely has no such thing. A true standalone has no series. */
  'none',
  /** Somebody looked and nobody knows. Distinct from nobody having looked. */
  'unknown',
] as const;
export type GapVerdict = (typeof GAP_VERDICTS)[number];

/** Where a `research_finding` stands. Must match the CHECK in migration 0001. */
export const FINDING_REVIEW_STATES = ['pending', 'accepted', 'rejected'] as const;
export type FindingReviewState = (typeof FINDING_REVIEW_STATES)[number];

/**
 * Whether a decision was read before it was made. Migration 0013.
 *
 * ⚠️ This is a different question from *who* decided, and the two must not be
 * collapsed. `reviewed_by` / `decided_by` answer "on whose authority" — and
 * under auto-apply that is still a real person, the one who pressed Look up.
 * This answers "did anybody actually look at the value", and under auto-apply
 * the answer is no.
 *
 * `accepted` used to imply both. Now it implies only the first, and anything
 * auditing the catalog has to read this column to tell a machine's guess from a
 * person's assertion. NULL means undecided, or decided before 0013 existed —
 * deliberately not backfilled, because an invented 'human' would be
 * indistinguishable from an observed one.
 */
export const DECISION_MODES = ['human', 'auto'] as const;
export type DecisionMode = (typeof DECISION_MODES)[number];

/**
 * Whether the image we hold is really this book's cover. Migration 0040.
 *
 * ⚠️ **"Has a cover" and "has the right cover" are different questions**, and
 * everything written before 0040 could only ask the first. `collectionStats`
 * counts `cover_url IS NOT NULL`, the backfills skip a filled column, and
 * `Enrich` refuses to overwrite one — all correct for a *missing* cover and all
 * silently wrong for a *wrong* one. A stand-in has a URL and passes every one of
 * those tests.
 *
 * NULL means nobody has assessed it, and is **not** 'ok'. Same rule
 * `GAP_VERDICTS` and `DECISION_MODES` follow: "we looked and it is fine" and
 * "nobody has looked" are different facts, and only one of them is a reason to
 * look again. Nothing was backfilled to 'ok' by the migration.
 */
export const COVER_STATUSES = [
  /** Somebody looked, and this is the book's own cover. */
  'ok',
  /** We know it is not the right image, and are holding it until one exists. */
  'standin',
] as const;
export type CoverStatus = (typeof COVER_STATUSES)[number];

/**
 * What kind of printing this is, beyond what it is made of. Migration 0050.
 *
 * ⚠️ **This is the canonical counterpart to `edition_name`, and it does NOT
 * replace it.** The owner's words, 2026-08-11: *"Let's normalize any edition to
 * collectors edition. Keep the original name on the visible listing but for our
 * sanity all editions should be collectors and we can fix them one off if
 * needed."*
 *
 * The problem it solves is countable. Measured against production the same day:
 * **17 editions carry a name, spelled 13 different ways** — "Illumicrate
 * Exclusive", "Year of Sanderson premium hardcover", "B&N Exclusive Edition",
 * "Campaign-only exclusive hardcover, signed extras", "Collector's Edition",
 * "Deluxe Edition", "Signed Leatherbound" and six more. Every one of them is
 * prose typed by a vendor or a campaign, so *"show me the fancy ones"* was
 * thirteen `LIKE` patterns and would be fourteen the next time somebody invents
 * a word. This column is the one bucket they all fall into; `edition_name` keeps
 * its exact text and stays what the UI prints.
 *
 * ## ⚠️ NULL means ORDINARY, not "nobody has looked"
 *
 * **This is a deliberate departure from `COVER_STATUSES`, `GAP_VERDICTS` and
 * `DECISION_MODES` above, and the asymmetry is the whole reason it is safe.**
 * Those three describe a *question that was asked*, so NULL honestly means
 * unasked. This one describes what a book **is**, and the default state of a
 * book is ordinary: 220 editions in production have no name at all — 115
 * `ebook_epub`, 101 `hardcover`, 4 `paperback` — and are plain printings. Backfilling them to an
 * `'unknown'` would mint 220 pieces of work that nobody will ever do, and a
 * "needs attention" list that is 93% noise is a list that gets ignored — which
 * is exactly what `DETAIL_FIELDS` says about a queue built from "which columns
 * are null".
 *
 * The same rule `copy.is_signed` already follows by defaulting to 0 rather than
 * NULL, and the rule `CollectionRow.preordered` states in words: **only the
 * exceptions earn a mark.**
 *
 * ⚠️ The cost of that choice is real and is paid for elsewhere. A newly imported
 * special edition that nothing recognises is silently filed as ordinary, because
 * "ordinary" and "unexamined" now look identical in the column. What makes that
 * recoverable is that they are *not* identical in the table: a special printing
 * is **named** — that is how anybody knows it is special — so the rows where
 * NULL might be wrong are exactly the rows with an `edition_name` and no kind,
 * and the collection's **"Named, not sorted"** filter is that query. It is one
 * click, it is normally two rows long, and it is what "we can fix them one off"
 * means in practice.
 *
 * ## Why one value and not five
 *
 * Because the ask was to *stop* distinguishing them. "Illumicrate Exclusive",
 * "Deluxe Edition" and "Signed Leatherbound" are three names for one shelf, and
 * splitting them back into `exclusive` / `deluxe` / `signed` would rebuild the
 * thirteen-way problem with tidier spelling. The name is still there for anyone
 * who wants to know which.
 *
 * Deliberately NO CHECK constraint, following `gap_verdict.field` (0007),
 * `research_finding.decided_how` (0013) and `work.cover_status` (0040): the set
 * may grow — `omnibus` is the obvious candidate and is discussed in migration
 * 0050 — a CHECK would make each addition a table rebuild, and an unrecognised
 * value simply fails to match any filter.
 */
export const EDITION_KINDS = [
  /**
   * A printing sold as better than the standard one: collector's, deluxe,
   * exclusive, premium, limited, signed, numbered, leatherbound, slipcased.
   *
   * ⚠️ It is about **how the object was made and sold**, never about what is
   * inside it. An omnibus and a "Volume 1" are ordinary printings that happen to
   * describe their contents, and calling either a collector's edition would be
   * plainly false — see `classifyEdition` in `crowdfunding.ts`.
   */
  'collectors',
] as const;
export type EditionKind = (typeof EDITION_KINDS)[number];

/**
 * Image types an uploaded cover may be, checked against the file's own **magic
 * bytes** and never against the type the browser declared.
 *
 * ⚠️ A `Content-Type` on a multipart part is a claim by the client, so it can
 * say `image/jpeg` over an HTML error page, a PDF, or a script. It is used only
 * to fail fast; `sniffImageType` is what decides. SVG is deliberately absent —
 * it is a document that can carry script, and nothing here needs a vector cover.
 */
export const COVER_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
] as const;
export type CoverImageType = (typeof COVER_IMAGE_TYPES)[number];

export const SCAN_MODES = ['shelf', 'single', 'isbn', 'file'] as const;
export type ScanMode = (typeof SCAN_MODES)[number];

export const SCAN_STATUSES = [
  'uploaded',
  'reading',
  'read',
  'enriching',
  'review',
  'done',
  'failed',
] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

/**
 * How many works one page of the collection holds.
 *
 * Fixed on the server rather than sent by the client, for the reason the board
 * game catalog fixed it: letting a caller ask for 500 hands it the exact payload
 * the page size exists to prevent. 50 rather than that project's 25 because a
 * book is a row, not a card with a tree under it.
 */
export const COLLECTION_PAGE_SIZE = 50;

/**
 * The page sizes a person may choose from.
 *
 * An allowlist and not a clamp, and the difference is the whole point: a menu
 * the server defines cannot be asked for 5,000, which is the request
 * `COLLECTION_PAGE_SIZE` exists to refuse. The audiobook catalog offers the same
 * ladder from its own `#ab-page-size` control, minus its "All" option — that
 * site renders a static file it already holds in the browser, while this one
 * would be asking a Worker to serialise the entire catalog into one response.
 */
export const COLLECTION_PAGE_SIZES: readonly number[] = [10, 25, 50, 100, 200];

/**
 * Rating scale, in half stars.
 *
 * ⚠️ **This is the audiobook catalog's scale, deliberately.** Its
 * `validReview()` Firestore rule enforces `rating >= 0.5 && rating <= 5`, and
 * its `submitReview` additionally requires half-star steps. A review written
 * here must satisfy that rule unchanged, because it is written to the same
 * collection. Inventing a 1–10 scale here — which is what the board game catalog
 * uses — would make every ported review either rejected by the rules or silently
 * rescaled, and a rescaled rating is a lie that cannot be undone.
 */
export const RATING_MIN = 0.5;
export const RATING_MAX = 5;
export const RATING_STEP = 0.5;

/**
 * How many observed ratings one `POST /api/reviews/observed` may carry.
 *
 * The whole-library sweep sends every rating the signed-in person has written,
 * which is 383 for the heaviest reviewer in the house today and grows slowly.
 * A cap exists so the endpoint has a stated shape rather than an implied one;
 * the browser chunks at this number rather than assuming it will never be hit.
 *
 * ⚠️ Not a D1 limit and must not be confused with one. `applyObservedRatings`
 * chunks its own `IN (…)` lists far smaller than this, because bound parameters
 * per statement are the constraint there and this is a payload size.
 */
export const OBSERVED_RATINGS_MAX = 500;

/**
 * The one `status` value either catalog writes to a `readingLists` document.
 *
 * ⚠️ **The audiobook site's vocabulary, not ours** — its TBR button writes
 * `status: 'tbr'` and its own filter reads `data.status === 'tbr'`
 * (`app/web/templates/index.html`), while `firestore.rules`' `validReadingList`
 * accepts any string. So this is a shared spelling to match exactly, and a
 * document carrying anything else is something that site knows about and this
 * catalog does not: `myTbrEntries` drops it rather than guessing.
 */
export const TBR_STATUS = 'tbr';

/**
 * How many TBR entries one `POST /api/tbr/resolve` may carry.
 *
 * Same reasoning as `OBSERVED_RATINGS_MAX` above — a stated shape rather than
 * an implied one — and the same number, because both are "everything one person
 * has ever recorded" and the heaviest list in the house is a few hundred.
 */
export const TBR_ENTRIES_MAX = 500;

/**
 * The longest a reader-contributed content warning may be.
 *
 * ⚠️ **Not a preference — `firestore.rules` enforces it.** `validUserWarning()`
 * refuses `label.size() > 80` outright, so a longer note is a guaranteed
 * PERMISSION_DENIED that would read as "the site is broken" rather than as "too
 * long". `MAX_WARNING_LABEL` in `audiobook_catalog/site/user-warnings.js` is the
 * same number for the same reason; both sides state the limit to the person
 * before the write, and this constant is what lets `schemas.ts` do that here
 * (it may import `constants.ts` and nothing else).
 */
export const MAX_WARNING_LABEL = 80;
