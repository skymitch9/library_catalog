import { Hono } from 'hono';
import { z } from 'zod';
import { EDITION_FORMATS, workKeyFor } from '@lc/core';
import { createEdition, createWork, findEditionBySourceUrl, findWorkByKey } from '@lc/db';
import type { AppBindings } from '../env.js';

/**
 * Machine ingest for ebooks.
 *
 * Called by `scripts/import-ebooks.mjs`, which reads the manifest the audiobook
 * pipeline publishes at `audiobook_catalog/site/ebooks.json` (built by its sync
 * step 1b from each EPUB's embedded OPF metadata).
 *
 * ## Why a machine token rather than a person's
 *
 * The owner's requirement is unattended import: *"I want this to be automated
 * and seamless without intervention."* A Firebase ID token cannot do that — it
 * belongs to a person, expires in an hour, and needs a browser to refresh.
 *
 * This route was built once for the Calibre-Web pipeline, verified against
 * production, then removed with it. It is restored rather than rewritten
 * because the shape was already reasoned about and tested; only the payload
 * changed, from a Calibre book id to the manifest's file path.
 *
 * ## ⚠️ Mounted OUTSIDE the Firebase auth middleware
 *
 * It has to be, and everything about it is narrowed to make that acceptable:
 *
 *   - **Unset token means disabled, not open.** A deployment that never sets
 *     `EBOOK_INGEST_TOKEN` has no ingest endpoint at all — it 404s. The failure
 *     direction matters more than the feature, and a 404 invites less probing
 *     than a 401.
 *   - **Constant-time comparison.** A `===` on a secret leaks its length and,
 *     over enough requests, its content.
 *   - **It can create a work and an ebook edition. That is all.** No reads, no
 *     copies, no reviews, no users, no deletes. A leaked token cannot exfiltrate
 *     the collection, because nothing here returns any of it.
 *   - **Physical formats are refused at the schema.** This endpoint exists for
 *     files. A cron that could silently add hardcovers to a catalog of physical
 *     books is a strictly worse thing to leak.
 *
 * ## What it deliberately does not do
 *
 * It does not create a `copy`. A file existing is good evidence of a licence,
 * but *"we own this"* is a claim about us, and migration 0001's
 * catalog/collection split says an automated process does not make those
 * unasked. The owner ticks that box.
 */

/** Only formats that are an actual file. `ebook_kindle` is a licence, not a file. */
const INGESTABLE_FORMATS = EDITION_FORMATS.filter(
  (f) => f.startsWith('ebook_') && f !== 'ebook_kindle',
);

const ingestEbookSchema = z.object({
  title: z.string().trim().min(1),
  authors: z.string().trim().min(1),
  series: z.string().trim().nullable().optional(),
  seriesIndexSort: z.number().nullable().optional(),
  format: z.enum(INGESTABLE_FORMATS as unknown as [string, ...string[]]),
  /**
   * Where the file is, relative to the audiobook library root. The one fact the
   * importer knows that no lookup ever could, so it is worth carrying.
   */
  sourcePath: z.string().trim().max(500).nullable().optional(),
  isbn13: z
    .string()
    .regex(/^97[89]\d{10}$/)
    .nullable()
    .optional(),
  asin: z
    .string()
    .regex(/^B[0-9A-Z]{9}$/)
    .nullable()
    .optional(),
  publisher: z.string().trim().nullable().optional(),
  /** Sent so a mismatch is visible. NOT trusted — see below. */
  workKey: z.string().optional(),
});

/**
 * Timing-safe string comparison.
 *
 * Workers has no `crypto.timingSafeEqual`, so this is the manual form: compare
 * every byte regardless of where the first difference falls, and fold the length
 * check into the same result rather than short-circuiting on it.
 */
function secretEquals(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export const ingestRoutes = new Hono<AppBindings>()
  .use('*', async (c, next) => {
    const expected = c.env.EBOOK_INGEST_TOKEN;
    if (!expected) {
      // Not 401. A 401 advertises a door worth trying; this says the feature is
      // off, which is both true and less interesting.
      return c.json({ error: 'ingest_disabled' }, 404);
    }
    const header = c.req.header('Authorization') ?? '';
    const token = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] ?? '';
    if (!token || !secretEquals(token, expected)) {
      return c.json({ error: 'unauthenticated' }, 401);
    }
    await next();
  })

  .post('/ebook', async (c) => {
    const parsed = ingestEbookSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }
    const input = parsed.data;

    // ⚠️ The key is recomputed here, never taken from the request.
    //
    // The importer sends its own so a drift is *visible*, but trusting it would
    // let a client that had fallen out of step write keys the rest of the system
    // cannot find — and `work_key` is the bridge to the audiobook catalog's
    // reviews, so a bad one does not throw, it makes a book's reviews invisible.
    const key = workKeyFor(input.title, input.authors);
    const keyMismatch = input.workKey !== undefined && input.workKey !== key;

    let work = await findWorkByKey(c.env.DB, key);
    let createdWork = false;

    if (!work) {
      work = await createWork(c.env.DB, {
        title: input.title,
        authors: input.authors,
        series: input.series ?? null,
        seriesIndexSort: input.seriesIndexSort ?? null,
        seriesIndexDisplay:
          input.seriesIndexSort != null
            ? `Book ${Number(input.seriesIndexSort).toString().replace(/\.0$/, '')}`
            : null,
      });
      createdWork = true;
    }

    // ⚠️ Idempotent on the EDITION too, not just the work.
    //
    // The first version matched `work_key` and stopped there, so re-importing a
    // manifest created a second edition of the same format for every book that
    // already had one — 83 duplicates in production before this was caught. An
    // unattended importer runs repeatedly by definition, so "runs twice" is the
    // normal case and has to be a no-op.
    if (input.sourcePath) {
      const already = await findEditionBySourceUrl(c.env.DB, work.id, input.sourcePath);
      if (already) {
        return c.json(
          { workId: work.id, editionId: already.id, createdWork, createdEdition: false, workKey: key },
          200,
        );
      }
    }

    const edition = await createEdition(c.env.DB, {
      workId: work.id,
      format: input.format as (typeof EDITION_FORMATS)[number],
      isbn13: input.isbn13 ?? null,
      asin: input.asin ?? null,
      publisher: input.publisher ?? null,
      source: 'file',
      sourceUrl: input.sourcePath ?? null,
      currency: 'USD',
    } as Parameters<typeof createEdition>[1]);

    return c.json(
      {
        workId: work.id,
        editionId: edition.id,
        createdWork,
        createdEdition: true,
        workKey: key,
        // Surfaced rather than logged: a container log nobody reads is where
        // this class of bug goes to hide.
        ...(keyMismatch ? { warning: 'work_key_mismatch', sent: input.workKey } : {}),
      },
      201,
    );
  });
