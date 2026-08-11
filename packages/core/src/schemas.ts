/**
 * Zod schemas: the API's write contract.
 *
 * ⚠️ Imports `constants.ts` (a leaf) and NOTHING from `index.ts`. index.ts
 * re-exports this file; importing back from it makes every `z.enum()` here
 * receive `undefined` at module-init time, and every write endpoint starts
 * returning 500 with a misleading message. Typecheck does not catch it.
 */

import { z } from 'zod';
import {
  ACCESSORY_KINDS,
  CONDITIONS,
  COPY_STATUSES,
  COVER_STATUSES,
  CROWDFUNDING_PLATFORMS,
  DETAIL_FIELDS,
  PLEDGE_ITEM_VERDICTS,
  PLEDGE_STATUSES,
  EDITION_FORMATS,
  EDITION_KINDS,
  EDITION_SOURCES,
  FINDING_REVIEW_STATES,
  GAP_VERDICTS,
  RATING_MAX,
  RATING_MIN,
  READ_FORMATS,
  READ_STATES,
  REVIEW_SOURCES,
  ROLES,
  RUN_TIERS,
  SERIES_VOLUME_SOURCES,
  SOURCE_TIERS,
  WORK_ALIAS_KINDS,
  WORK_RELATIONS,
} from './constants.js';

export const roleSchema = z.enum(ROLES);
export const editionFormatSchema = z.enum(EDITION_FORMATS);
export const copyStatusSchema = z.enum(COPY_STATUSES);
export const conditionSchema = z.enum(CONDITIONS);
export const readStateSchema = z.enum(READ_STATES);
export const readFormatSchema = z.enum(READ_FORMATS);
export const editionSourceSchema = z.enum(EDITION_SOURCES);
export const editionKindSchema = z.enum(EDITION_KINDS);
export const sourceTierSchema = z.enum(SOURCE_TIERS);
export const runTierSchema = z.enum(RUN_TIERS);
export const workRelationSchema = z.enum(WORK_RELATIONS);
export const workAliasKindSchema = z.enum(WORK_ALIAS_KINDS);
export const seriesVolumeSourceSchema = z.enum(SERIES_VOLUME_SOURCES);
export const detailFieldSchema = z.enum(DETAIL_FIELDS);
export const accessoryKindSchema = z.enum(ACCESSORY_KINDS);
export const crowdfundingPlatformSchema = z.enum(CROWDFUNDING_PLATFORMS);
export const pledgeStatusSchema = z.enum(PLEDGE_STATUSES);
export const pledgeItemVerdictSchema = z.enum(PLEDGE_ITEM_VERDICTS);
export const gapVerdictSchema = z.enum(GAP_VERDICTS);
export const findingReviewStateSchema = z.enum(FINDING_REVIEW_STATES);
export const coverStatusSchema = z.enum(COVER_STATUSES);

/** Trim, and treat an empty string as absent — a blank form field is not a value. */
const optionalText = z
  .string()
  .trim()
  .transform((s) => (s === '' ? null : s))
  .nullable()
  .optional();

/**
 * Digits only, 13 long, 978/979. The checksum is NOT asserted here.
 *
 * Deliberate: `classifyScannedCode` in `isbn.ts` owns that decision, and a
 * second checksum implementation living in a schema is exactly the drift this
 * codebase keeps warning about. The route calls the classifier and rejects
 * before it ever reaches zod; this shape is the last line, not the first.
 */
export const isbn13Schema = z
  .string()
  .trim()
  .regex(/^97[89]\d{10}$/, 'must be a 13-digit ISBN beginning 978 or 979');

export const asinSchema = z
  .string()
  .trim()
  .regex(/^B[0-9A-Z]{9}$/, 'must be a 10-character ASIN beginning with B');

export const createWorkSchema = z.object({
  title: z.string().trim().min(1),
  subtitle: optionalText,
  /** As printed, in the order printed. Split by `splitAuthors`, never by the caller. */
  authors: z.string().trim().min(1),
  series: optionalText,
  seriesIndexSort: z.number().nullable().optional(),
  seriesIndexDisplay: optionalText,
  firstPublished: z.number().int().min(1).max(2200).nullable().optional(),
  openlibraryWorkId: optionalText,
  description: optionalText,
  coverUrl: optionalText,
  /**
   * Whether the cover we hold is really this book's. Migration 0040.
   *
   * ⚠️ **Only ever meaningful alongside `coverUrl`.** `updateWork` pairs them:
   * a patch that moves the URL without saying the status clears the status, so
   * a 'standin' can never survive onto a replacement image. Sending a status
   * with no URL still works and is the ordinary case — marking a cover that is
   * already there as wrong.
   */
  coverStatus: coverStatusSchema.nullable().optional(),
});
export type CreateWork = z.infer<typeof createWorkSchema>;

export const updateWorkSchema = createWorkSchema.partial();

// ---------------------------------------------------------------------------
// Covers and watches — "this is not right, and I know it"
// ---------------------------------------------------------------------------

/**
 * Point a book at a cover somebody found, without hosting the image.
 *
 * ⚠️ The URL is **fetched and checked** before it is stored — see the route.
 * `docs/info/covers-and-series.md` and `verifyCoverUrl` both state the rule this
 * enforces: nothing in this system ever revisits a cover column, so an
 * unverified URL is a dead link that is permanent in a way a blank is not.
 *
 * `status` travels with the URL rather than being a second call, because that
 * pairing is the entire point of migration 0040 — the Percy Jackson case is
 * "set this image AND record that it is wrong", and two requests could do the
 * first and fail the second.
 */
export const setCoverSchema = z.object({
  url: z.string().trim().url('that is not a URL'),
  status: coverStatusSchema.nullable().optional(),
});
export type SetCover = z.infer<typeof setCoverSchema>;

/** Mark the cover already on a book as right, wrong, or unassessed again. */
export const setCoverStatusSchema = z.object({
  status: coverStatusSchema.nullable(),
});
export type SetCoverStatus = z.infer<typeof setCoverStatusSchema>;

/**
 * "Needs my eyes, and here is why."
 *
 * ⚠️ `note` is required and non-empty, for the same reason `setGapVerdictSchema`
 * requires a source: the note IS the watch. A mark with no reason is one the
 * owner finds weeks later and cannot act on, so the schema refuses to create
 * one rather than storing a mark that will have to be re-investigated from
 * scratch.
 */
export const createWatchSchema = z.object({
  note: z.string().trim().min(1, 'say what needs checking — the note is the whole point'),
});
export type CreateWatch = z.infer<typeof createWatchSchema>;

export const createEditionSchema = z.object({
  workId: z.number().int().positive(),
  isbn13: isbn13Schema.nullable().optional(),
  isbn10: optionalText,
  asin: asinSchema.nullable().optional(),
  format: editionFormatSchema.default('paperback'),
  editionName: optionalText,
  /**
   * The canonical bucket beside the free-text name. Migration 0050.
   *
   * ⚠️ **No `.default()`, unlike `format` and `source`.** NULL is a real and
   * common value here — it means an ordinary printing, which 220 of 237 rows in
   * production are — so a default would be indistinguishable from the thing it
   * defaults to and would only remove the caller's ability to say "clear it".
   * `EDITION_KINDS` carries the full argument for why NULL means ordinary rather
   * than unassessed.
   */
  editionKind: editionKindSchema.nullable().optional(),
  /**
   * What is printed **inside** this object — "Volumes 1-3", "Books 1-3 plus two
   * shorts". Migration 0060.
   *
   * ⚠️ A different axis from both `editionName` and `editionKind`, and the two
   * *White Sand* rows are why the column exists: "Omnibus - collects volumes
   * 1-3" and "Volume 1" were sitting in `editionName`, which is supposed to hold
   * what the *vendor* called the printing. An omnibus is an ordinary trade
   * printing — see the refusal at the foot of migration 0050 — so it must not be
   * an `editionKind` either.
   *
   * Free text, and deliberately not a number range: this house holds bind-ups of
   * unnumbered novellas and one leatherbound *edition* delivered as two physical
   * volumes, which is the opposite case.
   */
  collects: optionalText,
  publisher: optionalText,
  publishedYear: z.number().int().min(1).max(2200).nullable().optional(),
  pages: z.number().int().positive().nullable().optional(),
  language: optionalText,
  coverUrl: optionalText,
  source: editionSourceSchema.default('manual'),
  sourceUrl: optionalText,
  /** The Calibre book id in the CWA library. Stable; a filesystem path is not. */
  cwaBookId: z.number().int().positive().nullable().optional(),
});
export type CreateEdition = z.infer<typeof createEditionSchema>;

/**
 * Change a printing in place — which is how a hardcover stops being filed as a
 * paperback.
 *
 * ⚠️ **This is the fix for a wrong `format`, and a wrong `format` is not an edge
 * case.** `addLineToCatalog` writes `format: 'paperback'` for every barcode,
 * because a barcode proves a printing exists and not which one it is. That guess
 * is right more often than not and wrong often enough that it must be
 * correctable; until this schema was wired up there was no route, no query and
 * no control that could change it.
 *
 * `workId` is omitted rather than made optional. Moving a printing to a
 * different book is not an edit — the copies, the reviews and the read-state all
 * hang off the work, and re-pointing one column would leave every one of them
 * behind. Delete it and add it to the right book.
 *
 * `.partial()` over a schema carrying `.default()`s, exactly as
 * `updateCopySchema` does. ⚠️ Zod wraps each field as
 * `ZodOptional<ZodDefault<…>>` and an absent key short-circuits at the
 * `ZodOptional`, so the default never fires: `{ format: 'hardcover' }` changes
 * the format and does **not** silently reset `source` to `manual`. That
 * behaviour is what makes a one-field PATCH safe, and it is the same behaviour
 * the wishlist's `{ status: 'owned' }` promotion already depends on.
 */
export const updateEditionSchema = createEditionSchema.omit({ workId: true }).partial();
export type UpdateEdition = z.infer<typeof updateEditionSchema>;

export const createCopySchema = z.object({
  workId: z.number().int().positive(),
  editionId: z.number().int().positive().nullable().optional(),
  status: copyStatusSchema.default('owned'),
  location: optionalText,
  acquiredOn: optionalText,
  pricePaidCents: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().trim().length(3).default('USD'),
  vendor: optionalText,
  condition: conditionSchema.nullable().optional(),
  isSigned: z.boolean().default(false),
  editionNotes: optionalText,
  lentTo: optionalText,
  notes: optionalText,
});
export type CreateCopy = z.infer<typeof createCopySchema>;

/**
 * Change a copy — which is how a wishlist entry becomes a book on the shelf.
 *
 * `.partial()`, so a PATCH that sends only `{ status: 'owned' }` promotes a
 * wanted copy without clearing the shop it was going to be bought from. That is
 * deliberately unlike `setReadStateSchema`, which is a PUT and replaces: a copy
 * accumulates facts over its life (price, vendor, condition, where it ended up)
 * and a promotion must not be a way to lose them.
 */
export const updateCopySchema = createCopySchema.omit({ workId: true }).partial();
export type UpdateCopy = z.infer<typeof updateCopySchema>;

/**
 * Read-state only. There is no `rating` field here on purpose.
 *
 * Ratings go to Firestore through the review bridge (`reviews.ts`) so one
 * review serves both catalogs. A rating arriving on this endpoint would be a
 * second, D1-only copy — the exact divergence the bridge exists to prevent.
 *
 * ⚠️ `.strict()` is load-bearing, and was added after watching this endpoint
 * accept `{"readState":"read","rating":5}` with a 200 and quietly drop the
 * rating. Zod strips unknown keys by default, so the caller was told it had
 * succeeded. A client that posts a rating here is *wrong* and needs to be told
 * so — a 400 is a bug report, a silent strip is a rating that vanishes and a
 * user who thinks they rated a book.
 */
export const setReadStateSchema = z
  .object({
    readState: readStateSchema,
    startedOn: optionalText,
    finishedOn: optionalText,
    readFormat: readFormatSchema.nullable().optional(),
    notes: optionalText,
  })
  .strict();
export type SetReadState = z.infer<typeof setReadStateSchema>;

/**
 * What the web app posts when someone rates a book.
 *
 * The Worker does not write this to D1. It validates, resolves the work, and
 * hands back the document id and payload for the browser to write to Firestore
 * with the user's own credentials — see docs/info/identity-and-reviews.md for
 * why the write happens client-side rather than through a service account.
 */
export const submitReviewSchema = z.object({
  workId: z.number().int().positive(),
  rating: z
    .number()
    .min(RATING_MIN)
    .max(RATING_MAX)
    .refine((r) => (r * 2) % 1 === 0, 'ratings are in half-star steps'),
  text: z.string().max(1000).default(''),
  editionLabel: optionalText,
});

/**
 * A rating the browser has just **observed** in Firestore for the signed-in
 * person, reported back so the read state can be derived from it.
 *
 * ## ⚠️ Why this is a separate endpoint from `submitReviewSchema`
 *
 * `/draft` is asked for a document *before* the browser writes it, and its
 * `cacheRating` call accepts being wrong if that write then fails — the cache is
 * only ever used for sorting, and says so. A read state is not that: it is shown
 * to the person as a fact about their own life, and deriving one from a review
 * that never landed would be a visible lie. So this endpoint reports what
 * Firestore *actually holds*, read back after the write, and it is also the only
 * path by which a review written on the **audiobook site** can ever reach this
 * database — the Worker cannot see Firestore, and the browser is the one thing
 * that sees both.
 *
 * ## ⚠️ Trust
 *
 * The Worker does not verify this rating against Firestore, and cannot without a
 * service account (see `routes/reviews.ts` for why there is none). That grants
 * no new authority: the same capability already lets the caller `PUT
 * /works/:id/reading` and set 'read' outright. This is a more convenient way to
 * do something already permitted, not a way to do something new.
 *
 * `.strict()` for the same reason `setReadStateSchema` has it — a client sending
 * a field this does not model is a bug report, not something to strip in silence.
 */
export const observedRatingSchema = z
  .object({
    rating: z
      .number()
      .min(RATING_MIN)
      .max(RATING_MAX)
      .refine((r) => (r * 2) % 1 === 0, 'ratings are in half-star steps'),
    /**
     * Which catalog the review was written from. ⚠️ Load-bearing rather than
     * decorative: the owner reads far more audiobooks than physical books, so
     * `'audio'` is the common case and is the most accurate thing this app will
     * ever know about how a given book was actually consumed.
     */
    source: z.enum(REVIEW_SOURCES).nullable().optional(),
  })
  .strict();
export type ObservedRatingInput = z.infer<typeof observedRatingSchema>;

export const updateRoleSchema = z.object({ role: roleSchema });

// ---------------------------------------------------------------------------
// Other names a work answers to
// ---------------------------------------------------------------------------

/**
 * Add one alias to one work.
 *
 * ⚠️ `kind` has no default, unlike almost every other create schema here. The
 * two kinds are not interchangeable — an `author` alias widens the check that
 * refuses a wrong book, and a `title` alias widens the check that finds one — so
 * "which of the two did you mean" is the whole content of the request and a
 * default would be a guess made silently. `createSeriesVolumeSchema` withholds a
 * default from `source` for the same reason.
 *
 * `source` DOES default to `manual`, because this endpoint is only ever a person:
 * an importer writing `openlibrary` rows would go through a script, and the
 * distinction exists so a re-import cannot delete a person's answer.
 *
 * Two characters minimum, matching the floor `buildWorkIndex` applies when it
 * folds an alias — a one-character alias is silently dropped there, and accepting
 * one here would store a row that can never fire.
 */
export const createWorkAliasSchema = z.object({
  alias: z.string().trim().min(2).max(200),
  kind: workAliasKindSchema,
  source: z.enum(['openlibrary', 'manual']).default('manual'),
});
export type CreateWorkAlias = z.infer<typeof createWorkAliasSchema>;

// ---------------------------------------------------------------------------
// Relations between works
// ---------------------------------------------------------------------------

/**
 * Link two books that belong together without sharing a series.
 *
 * `toWorkId` and not a title: a relation is between two catalog rows, and
 * resolving a typed name to a row is the picker's job on the way in. Accepting a
 * string here would let a typo create a link to a book that does not exist.
 */
export const createWorkRelationSchema = z.object({
  toWorkId: z.number().int().positive(),
  relation: workRelationSchema,
  note: z.string().trim().max(200).nullish(),
});
export type CreateWorkRelation = z.infer<typeof createWorkRelationSchema>;

// ---------------------------------------------------------------------------
// Series completeness
// ---------------------------------------------------------------------------

/**
 * A volume of a series that some source says exists.
 *
 * ⚠️ `source` has no default. Every other create schema here defaults to
 * `'manual'`, and that would be exactly wrong: the value of this table is that
 * every row can name who said so, and a default is how a row acquires a source
 * it never had. The importer sends `audiobook_catalog`; the hand-entry form
 * sends `manual` and is the only caller that may.
 */
export const createSeriesVolumeSchema = z.object({
  indexSort: z.number(),
  indexDisplay: optionalText,
  title: optionalText,
  authors: optionalText,
  source: seriesVolumeSourceSchema,
  sourceUrl: optionalText,
  note: optionalText,
});
export type CreateSeriesVolume = z.infer<typeof createSeriesVolumeSchema>;

/**
 * A person asserting how long a series is.
 *
 * ⚠️ `.refine()` and not two optional fields. A total with no source is the one
 * write this whole feature exists to refuse — it is indistinguishable from data
 * once stored, and there is no later pass that could tell them apart. Clearing
 * it is `knownTotal: null`, which is why both are nullable rather than optional.
 */
export const setSeriesTotalSchema = z
  .object({
    knownTotal: z.number().int().positive().nullable(),
    knownTotalSource: optionalText,
    note: optionalText,
  })
  .refine((v) => v.knownTotal == null || Boolean(v.knownTotalSource), {
    message: 'a series length needs a source — where does the number come from?',
    path: ['knownTotalSource'],
  });
export type SetSeriesTotal = z.infer<typeof setSeriesTotalSchema>;

/**
 * "I am never buying that one." — see migration 0081.
 *
 * ⚠️ `reason` is required, and it is the one required string in this file that
 * is **not** an evidence rail. `series_volume.source`, `known_total_source` and
 * `gap_verdict.source` all exist because their claims could be false; this one
 * cannot be, since the owner is the only authority on what the owner intends to
 * buy. It is required so that "why is 11.5 greyed out" has an answer in six
 * months — *"Patreon-only short, not sold"* rather than a silent absence.
 *
 * `indexSort` is a plain number, not an integer: the three Completionist
 * Chronicles shorts this was built for are 6.5, 11.5 and 13.5.
 */
export const skipSeriesGapSchema = z.object({
  indexSort: z.number(),
  reason: z.string().trim().min(2).max(200),
  note: optionalText,
});
export type SkipSeriesGap = z.infer<typeof skipSeriesGapSchema>;

// ---------------------------------------------------------------------------
// Research and gap verdicts
// ---------------------------------------------------------------------------

/**
 * Accept or reject one proposed finding.
 *
 * ⚠️ `pending` is absent on purpose. A review is a decision; "un-deciding" a
 * finding back to pending would leave no record that anyone had looked, which is
 * the state this whole feature exists to distinguish from.
 */
export const reviewFindingSchema = z.object({
  reviewState: z.enum(['accepted', 'rejected']),
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

/**
 * A person writing down an answer by hand: "this is a standalone, and here is
 * how I know".
 *
 * ⚠️ `source` is required and non-empty, matching the NOT NULL in migration
 * 0005 and the rule `series-overrides.json` already states: an entry with no
 * source is a bug, not a shortcut. It is the free way to close a gap — no model
 * call, no cost — and that is exactly why it must not be the careless way.
 */
export const setGapVerdictSchema = z.object({
  field: detailFieldSchema,
  verdict: gapVerdictSchema,
  source: z.string().trim().min(1, 'a verdict needs a source — how do you know?'),
  note: optionalText,
});
export type SetGapVerdict = z.infer<typeof setGapVerdictSchema>;

// ---------------------------------------------------------------------------
// Accessories — the things in the box that are not books
// ---------------------------------------------------------------------------

/**
 * Record a plushie, a pin, an art print.
 *
 * ⚠️ `copyId` is optional and NOT defaulted to anything. Migration 0011's header
 * has the reasoning: the accessory genuinely belongs to the *copy* — two backers
 * at two tiers get different piles — but this catalog holds 120 works and **4
 * copies**, so requiring one would make the feature fire on four books. Sending
 * `null` means "we have this, nobody has said which copy"; the server refuses a
 * `copyId` belonging to a different work.
 *
 * ⚠️ `isDigital` defaults to `false` rather than being required, and that is the
 * one guess made here. A plushie is the case this feature was asked for; a PDF
 * art book is the case that has to be *said*. The form ticks a box, the importer
 * sends the field explicitly, and the audit lists what is unticked so the guess
 * is visible rather than silent.
 */
export const createAccessorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: accessoryKindSchema.default('other'),
  isDigital: z.boolean().default(false),
  quantity: z.number().int().positive().default(1),
  copyId: z.number().int().positive().nullable().optional(),
  pledgeId: z.number().int().positive().nullable().optional(),
  location: optionalText,
  notes: optionalText,
});
export type CreateAccessory = z.infer<typeof createAccessorySchema>;

/**
 * Change one.
 *
 * `.partial()` for the reason `updateCopySchema` is: a PATCH that only moves an
 * accessory to a different shelf must not clear the note explaining what it is.
 */
export const updateAccessorySchema = createAccessorySchema.partial();
export type UpdateAccessory = z.infer<typeof updateAccessorySchema>;

// ---------------------------------------------------------------------------
// Crowdfunding provenance
// ---------------------------------------------------------------------------

/**
 * A campaign — a fact about the world.
 *
 * `externalId` is what makes a re-scan an upsert instead of a duplicate library,
 * so it is offered on every write even though it is nullable.
 */
export const createCampaignSchema = z.object({
  platform: crowdfundingPlatformSchema,
  name: z.string().trim().min(1).max(300),
  creator: optionalText,
  url: optionalText,
  externalId: optionalText,
  launchedOn: optionalText,
  fundedOn: optionalText,
  notes: optionalText,
});
export type CreateCampaign = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = createCampaignSchema.partial();

/**
 * Our pledge on a campaign.
 *
 * ⚠️ `account` is required and non-empty, and no other field here is. **There are
 * two BackerKit accounts.** A pledge with no account cannot be reconciled against
 * a scan of either of them, and the next scan of the other one would duplicate
 * everything. Migration 0010's `UNIQUE (campaign_id, platform, account)` refuses
 * the duplicate; this refuses the row that would slip past it.
 *
 * ⚠️ `platform` is required and is deliberately NOT inherited from the campaign.
 * Backing on Kickstarter and completing through a BackerKit pledge manager is one
 * campaign and one pledge, found by a scan of BackerKit — inheriting would file
 * it under the wrong account's sweep.
 */
export const createPledgeSchema = z.object({
  campaignId: z.number().int().positive(),
  platform: crowdfundingPlatformSchema,
  account: z.string().trim().min(1, 'which account backed this? there are two BackerKit logins'),
  tier: optionalText,
  pledgedOn: optionalText,
  amountCents: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().trim().length(3).default('USD'),
  managerUrl: optionalText,
  status: pledgeStatusSchema.default('pledged'),
  notes: optionalText,
});
export type CreatePledge = z.infer<typeof createPledgeSchema>;

export const updatePledgeSchema = createPledgeSchema.omit({ campaignId: true }).partial();

/**
 * One book a pledge delivered.
 *
 * ⚠️ **Two of these against one `workId` is correct and expected**, and the
 * schema must not be "helpfully" tightened to prevent it. One Kickstarter pledge
 * routinely yields a deluxe hardcover *and* an EPUB of the same novel; migration
 * 0010's `IFNULL` unique index is what allows the pair while still refusing an
 * exact re-insert. Anything that deduped on `workId` here would delete half of
 * every pledge in this catalog.
 *
 * `formatHint` is the campaign's own words and is kept even after `editionId` is
 * filled in — it is the evidence for the match, and the only thing re-readable
 * when a match turns out to be wrong.
 */
export const createPledgeItemSchema = z.object({
  workId: z.number().int().positive(),
  editionId: z.number().int().positive().nullable().optional(),
  copyId: z.number().int().positive().nullable().optional(),
  /**
   * ⚠️ "There is no printing to match", as opposed to "nobody has matched it".
   * An audiobook reward line takes `'none'`: `EDITION_FORMATS` has no audiobook
   * value and never will. Without it the audit's queue can never empty.
   */
  editionVerdict: pledgeItemVerdictSchema.nullable().optional(),
  formatHint: optionalText,
  title: optionalText,
  quantity: z.number().int().positive().default(1),
  fulfilled: z.boolean().default(false),
  externalRef: optionalText,
  notes: optionalText,
});
export type CreatePledgeItem = z.infer<typeof createPledgeItemSchema>;

export const updatePledgeItemSchema = createPledgeItemSchema.omit({ workId: true }).partial();

// ---------------------------------------------------------------------------
// API contracts for identity
// ---------------------------------------------------------------------------

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  database: z.enum(['up', 'down']),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const meResponseSchema = z.object({
  email: z.string(),
  displayName: z.string().nullable(),
  role: roleSchema,
  capabilities: z.array(z.string()),
  /**
   * The name this person's reviews are filed under on the audiobook site.
   *
   * Sent because the browser writes reviews directly to Firestore and the
   * document id is `{bookId}_{displayNameLower}` — get this wrong and you write
   * a second review beside your own rather than updating it.
   */
  reviewName: z.string().nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
