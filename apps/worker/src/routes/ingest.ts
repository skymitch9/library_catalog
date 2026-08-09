import { Hono } from 'hono';
import { z } from 'zod';
import { EDITION_FORMATS, workKeyFor } from '@lc/core';
import { createEdition, createWork, findWorkByKey } from '@lc/db';
import type { AppBindings } from '../env.js';

/**
 * Machine ingest for the ebook pipeline.
 *
 * Called by `scripts/index_cwa_library.py`, which runs on a cron inside the
 * `ebook-sync` container and reads Calibre-Web Automated's library. See
 * `docs/EBOOK_PIPELINE.md`.
 *
 * ## ⚠️ This route is mounted OUTSIDE the Firebase auth middleware
 *
 * It has to be: the caller is a cron in a container with no browser, no Google
 * session, and nothing to refresh an ID token with. It authenticates with a
 * shared secret instead, and everything about the route is narrowed to make that
 * an acceptable trade:
 *
 *   - **Unset token means disabled, not open.** A deployment that never sets
 *     `EBOOK_INGEST_TOKEN` has no ingest endpoint at all. The failure direction
 *     matters more than the feature.
 *   - **Constant-time comparison.** A `===` on a secret leaks its length and,
 *     over enough requests, its content. Cheap to do right.
 *   - **It can create a work and an ebook edition. That is all.** No reads, no
 *     copies, no reviews, no users. A leaked token cannot exfiltrate the
 *     collection, because there is nothing here that returns it.
 *   - **Physical formats are refused.** This endpoint exists for files CWA
 *     holds. A cron that can silently add hardcovers to a catalog of physical
 *     books is a strictly worse thing to leak.
 *
 * ## What it deliberately does not do
 *
 * It does not create a `copy`. An ebook file existing is good evidence we hold a
 * licence, but *"we own this"* is a claim about us, and the catalog/collection
 * split (migration 0001) says an automated process does not get to make those
 * unasked. The owner ticks the box.
 */

/** Only formats that are an actual file. `ebook_kindle` is a licence, not a file. */
const INGESTABLE_FORMATS = EDITION_FORMATS.filter((f) => f.startsWith('ebook_') && f !== 'ebook_kindle');

const ingestEbookSchema = z.object({
  cwaBookId: z.number().int().positive(),
  title: z.string().trim().min(1),
  authors: z.string().trim().min(1),
  series: z.string().trim().nullable().optional(),
  seriesIndexSort: z.number().nullable().optional(),
  format: z.enum(INGESTABLE_FORMATS as unknown as [string, ...string[]]),
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
  // Sent by the indexer so a mismatch is visible. NOT trusted — see below.
  workKey: z.string().optional(),
});

/**
 * Timing-safe string comparison.
 *
 * Workers has no `crypto.timingSafeEqual`, so this is the manual form: compare
 * every byte regardless of where the first difference is, and fold the length
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
      // Not 401. A 401 invites guessing at a door that is not there; this says
      // the feature is off, which is the truth and is also less interesting.
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
    // The indexer sends its own so a drift is *visible*, but trusting it would
    // let a Python port that has fallen out of step write keys the rest of the
    // system cannot find — which is precisely the failure `npm run check:fold`
    // exists to catch, and this is the second line of that defence.
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
        // Calibre's series_index is a float: 2.0, or 2.5 for a novella. Printed
        // back without the trailing .0, because "Book 2.0" is not what a cover
        // says and this column is the one a person reads.
        seriesIndexDisplay:
          input.seriesIndexSort != null
            ? `Book ${Number(input.seriesIndexSort).toString().replace(/\.0$/, '')}`
            : null,
      });
      createdWork = true;
    }

    const edition = await createEdition(c.env.DB, {
      workId: work.id,
      format: input.format as (typeof EDITION_FORMATS)[number],
      isbn13: input.isbn13 ?? null,
      asin: input.asin ?? null,
      publisher: input.publisher ?? null,
      cwaBookId: input.cwaBookId,
      source: 'cwa',
      currency: 'USD',
    } as Parameters<typeof createEdition>[1]);

    return c.json(
      {
        workId: work.id,
        editionId: edition.id,
        createdWork,
        workKey: key,
        // Surfaced rather than logged: the indexer prints it, and a container
        // log nobody reads is where this class of bug goes to hide.
        ...(keyMismatch ? { warning: 'work_key_mismatch', sent: input.workKey } : {}),
      },
      201,
    );
  });
