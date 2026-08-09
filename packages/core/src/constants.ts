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
  // The five file formats Calibre-Web Automated converts to and manages. See
  // docs/EBOOK_PIPELINE.md — CWA is the ebook storage and conversion engine
  // underneath this catalog, and an edition it holds has to be nameable here.
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
