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

export const ROLES = ['owner', 'reader', 'pending'] as const;
export type Role = (typeof ROLES)[number];

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
 */
export const SERIES_VOLUME_SOURCES = ['audiobook_catalog', 'openlibrary', 'manual'] as const;
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
