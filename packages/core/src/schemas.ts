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
  CROWDFUNDING_PLATFORMS,
  DETAIL_FIELDS,
  PLEDGE_ITEM_VERDICTS,
  PLEDGE_STATUSES,
  EDITION_FORMATS,
  EDITION_SOURCES,
  FINDING_REVIEW_STATES,
  GAP_VERDICTS,
  RATING_MAX,
  RATING_MIN,
  READ_FORMATS,
  READ_STATES,
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
});
export type CreateWork = z.infer<typeof createWorkSchema>;

export const updateWorkSchema = createWorkSchema.partial();

export const createEditionSchema = z.object({
  workId: z.number().int().positive(),
  isbn13: isbn13Schema.nullable().optional(),
  isbn10: optionalText,
  asin: asinSchema.nullable().optional(),
  format: editionFormatSchema.default('paperback'),
  editionName: optionalText,
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

export const updateEditionSchema = createEditionSchema.omit({ workId: true }).partial();

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
