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
  CONDITIONS,
  COPY_STATUSES,
  EDITION_FORMATS,
  EDITION_SOURCES,
  RATING_MAX,
  RATING_MIN,
  READ_FORMATS,
  READ_STATES,
  ROLES,
  RUN_TIERS,
  SOURCE_TIERS,
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

export const updateCopySchema = createCopySchema.omit({ workId: true }).partial();

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
