import { Hono } from 'hono';
import { z } from 'zod';
import {
  EDITION_FORMATS,
  MIN_AUTHOR_SIMILARITY,
  bestSimilarity,
  foldAuthorNames,
  normaliseTitle,
  primaryAuthor,
  seriesIndexDisplayFrom,
  splitSeriesPrefix,
  workKeyFor,
} from '@lc/core';
import {
  createEdition,
  createWork,
  findEditionBySourceUrl,
  findWorkByKey,
  getWork,
  listWorkAliases,
  type Work,
} from '@lc/db';
import type { AppBindings } from '../env.js';
import { secretEquals } from '../lib/secret-equals.js';

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

/** How an incoming row found its work, reported so the importer can say so. */
type MatchedVia = 'key' | 'alias' | 'series_prefix';

/**
 * Match an incoming title to an existing work when the exact key missed.
 *
 * ## Why the exact key is not enough — the 2026-08-14 duplicates
 *
 * The first full manifest import created 18 works, 13 of them duplicates, in
 * two classes this function now closes:
 *
 *   1. **OPF series prefix.** The EPUB says `"Beneath the Dragoneye Moons:
 *      Immortal War"`; the catalog says `"Immortal War"` with the series in
 *      its own column. Four works minted.
 *   2. **A renamed work leaves its old key behind.** The eight `"… - MM"`
 *      titles were stripped off their works on 2026-08-12 — a deliberate key
 *      move — so the unchanged OPF titles re-imported as eight new works.
 *      That is what `work_alias` exists for: the merge records the old
 *      spelling as a title alias, and this lookup honours it.
 *
 * ## Order and gates
 *
 * Alias first — it is asserted by a person or a merge, not inferred
 * (`matchIndexedWork` ranks the same way). The author gate uses
 * `bestSimilarity` over `foldAuthorNames` at `MIN_AUTHOR_SIMILARITY`, the one
 * implementation — it is what lets `"Rik Hoskin"` meet `"Julius Gopez Rik
 * Hoskin"` while an unrelated author still fails. A contested alias (two
 * gated works claiming one folded title) matches nobody, `buildWorkIndex`'s
 * rule 2.
 *
 * The series-prefix arm is exact-key on the remainder PLUS a fold-equality
 * check of the prefix against the candidate's recorded `series` — never the
 * bare split, which would read `"Tamer: King of Dinosaurs"` as series
 * "Tamer". See `splitSeriesPrefix`.
 */
async function findFallbackWork(
  db: D1Database,
  title: string,
  authors: string,
): Promise<{ work: Work; via: MatchedVia } | null> {
  const titleKey = normaliseTitle(title);
  const authorKey = normaliseTitle(primaryAuthor(authors));

  const aliases = await listWorkAliases(db);
  const authorAliases = new Map<number, string[]>();
  for (const a of aliases) {
    if (a.kind !== 'author') continue;
    const list = authorAliases.get(a.workId);
    if (list) list.push(a.alias);
    else authorAliases.set(a.workId, [a.alias]);
  }

  const claimants = new Set<number>();
  for (const a of aliases) {
    // Absent kind means 'title' — every row written before migration 0005.
    if (a.kind === 'author') continue;
    if (normaliseTitle(a.alias) === titleKey) claimants.add(a.workId);
  }
  const gated: Work[] = [];
  for (const workId of claimants) {
    const candidate = await getWork(db, workId);
    if (!candidate) continue;
    const keys = foldAuthorNames(candidate.authors ?? '', authorAliases.get(workId) ?? []);
    if (bestSimilarity(authorKey, keys) >= MIN_AUTHOR_SIMILARITY) gated.push(candidate);
  }
  if (gated.length === 1) return { work: gated[0] as Work, via: 'alias' };
  if (gated.length > 1) return null; // contested — belongs to nobody

  const split = splitSeriesPrefix(title);
  if (split) {
    const candidate = await findWorkByKey(db, workKeyFor(split.title, authors));
    if (candidate?.series && normaliseTitle(candidate.series) === normaliseTitle(split.series)) {
      return { work: candidate, via: 'series_prefix' };
    }
  }

  return null;
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
    let matchedVia: MatchedVia | null = work ? 'key' : null;
    let createdWork = false;

    // ⚠️ Match before minting. The exact key missing does NOT yet mean the book
    // is new — see findFallbackWork for the two classes of duplicate this
    // route created before it looked any further than the key.
    if (!work) {
      const fallback = await findFallbackWork(c.env.DB, input.title, input.authors);
      if (fallback) {
        work = fallback.work;
        matchedVia = fallback.via;
      }
    }

    if (!work) {
      work = await createWork(c.env.DB, {
        title: input.title,
        authors: input.authors,
        series: input.series ?? null,
        seriesIndexSort: input.seriesIndexSort ?? null,
        // ⚠️ The literal that used to be here is now `seriesIndexDisplayFrom`
        // in `@lc/core` — because `applyFinding` needs the SAME string and a
        // second copy of it is how the two writers would quietly start
        // printing different things for the same number. Its header carries the
        // reasoning this route established and research now inherits.
        seriesIndexDisplay:
          input.seriesIndexSort != null ? seriesIndexDisplayFrom(input.seriesIndexSort) : null,
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
          {
            workId: work.id,
            editionId: already.id,
            createdWork,
            createdEdition: false,
            workKey: key,
            matchedVia,
          },
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
        // How an existing work was found (null for a creation) — surfaced so
        // the importer's report can say WHICH mechanism attached a row rather
        // than lumping every attach together.
        matchedVia,
        // Surfaced rather than logged: a container log nobody reads is where
        // this class of bug goes to hide.
        ...(keyMismatch ? { warning: 'work_key_mismatch', sent: input.workKey } : {}),
      },
      201,
    );
  });
