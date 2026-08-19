import { Hono } from 'hono';
import { normaliseTitle } from '@lc/core';
import type { AppBindings } from '../env.js';
import { crossCatalogFormatLabels } from '../lib/format-labels.js';

/**
 * Machine export for the audiobook pipeline's "Other versions available"
 * stamp (owner, 2026-08-14): for every work this catalog has already matched
 * to an audiobook (`audiobook_holding`, migration 0010), hand back the join
 * key that side can match on and which physical/ebook formats we hold.
 *
 * ## Why a machine token, mirroring `routes/ingest.ts`
 *
 * The audiobook pipeline runs unattended (Task Scheduler, three times a day —
 * see that repo's `docs/access/PIPELINE.md`). A Firebase ID token belongs to a
 * person, expires in an hour, and needs a browser to refresh; this needs
 * neither. Same shape as the ebook importer's token, narrowed the same way:
 *
 *   - **Unset token means disabled, not open** — 404, not 401. See
 *     `routes/ingest.ts` for why the failure direction matters.
 *   - **Constant-time comparison** (`secretEquals`, ported verbatim).
 *   - **Read-only, and narrow in what it reads.** No reviews, no copies, no
 *     personal fields — titles, work ids and format lists only, and only for
 *     works this catalog has ALREADY linked to an audiobook. A leaked token
 *     exfiltrates a join table, not the collection.
 *
 * ## ⚠️ Mounted OUTSIDE the Firebase auth middleware
 *
 * Same reasoning as `routes/ingest.ts`: a script cannot hold a Firebase
 * session, so it holds a shared secret instead and the route enforces that
 * itself.
 *
 * ## The join key
 *
 * `audiobookTitle` is `audiobook_holding.title` — what the AUDIOBOOK catalog
 * itself calls the book, cached here the last time the matcher ran (see
 * migration 0010's header). It is deliberately NOT this catalog's own
 * `work.title`: the audiobook pipeline's join has to compare against its OWN
 * strings, and the two titles are documented to differ (`OtherVersions.tsx`'s
 * `seriesDiffers` note is the series-column version of the same fact).
 *
 * ⚠️ **`foldedTitle` was added 2026-08-14.** A byte-exact join on
 * `audiobookTitle` alone reached only 37 of ~90 mapped pairs: the cached
 * title and the audiobook catalog's live title drift in DECORATION (case, a
 * curly quote, "&" vs "and") without becoming a different book, and an exact
 * string test cannot tell that apart from an actual rename. `foldedTitle` is
 * `normaliseTitle(audiobookTitle)` — the SAME identity fold `work_key` and
 * every other cross-catalog join in this estate already trusts — computed
 * once, HERE, so the audiobook pipeline (Python) only ever compares strings
 * and never re-derives the fold with a second implementation (see
 * `titles.ts`'s header on why a second fold is how this estate's bugs start).
 *
 * A `foldedTitle` of `null` is not "unfoldable" — `normaliseTitle` never
 * fails — it is a **collision tombstone**: two DIFFERENT holdings folded to
 * the identical key (see the collision handling inside the route below).
 * Rather than hand out an ambiguous key and let either side guess which row
 * it means, both rows withhold `foldedTitle` and fall back to their own
 * exact `audiobookTitle` — the pre-2026-08-14 behaviour, for those two rows
 * only.
 *
 * ⚠️ **Stale holdings are excluded.** `stale_at IS NOT NULL` means the
 * audiobook catalog no longer confirms this match — the title cached here may
 * no longer exist over there under that spelling. Handing it out as a join
 * key would let the audiobook pipeline stamp a link that is already known to
 * be questionable; better to answer nothing than to propagate a fact this
 * catalog has already flagged as doubtful. (`OtherVersions.tsx` still shows a
 * stale *inbound* holding rather than hiding it — the two are not the same
 * choice: that is a human reading one book page, mid-sentence about a match
 * that USED to be confirmed; this is an unattended join deciding what to
 * write into another catalog's data file.)
 *
 * ## Format mapping
 *
 * `edition.format`'s six values collapse to what the audiobook side actually
 * asked for: each `PHYSICAL_FORMATS` value keeps its own label (a hardcover
 * and a paperback are different things worth two links), and every ebook_*
 * format — file or Kindle licence alike — folds to one `'Ebook'`, because
 * "do we also have this to read" is the honest granularity a *different*
 * catalog's UI needs, not which of five ebook variants. Mirrors
 * `apps/web/src/lib/formats.ts` `FORMAT_LABEL`'s physical spellings exactly,
 * so the word is the same wherever a person reads it in this estate.
 *
 * ⚠️ **The mapping moved to `lib/format-labels.ts` on 2026-08-19** — unchanged,
 * but no longer private, because `routes/gabi-delegated.ts`'s `browse-works`
 * verb became its second caller and a second spelling of these four words would
 * silently un-match rows in two other repos. The reasoning above is why the
 * labels are what they are; that file is where they live.
 */

/** Timing-safe string comparison — ported verbatim from `routes/ingest.ts`. */
function secretEquals(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

interface MappingRow {
  workId: number;
  audiobookTitle: string;
  rawFormats: string | null; // group_concat(DISTINCT edition.format)
}

export const audiobookMappingRoutes = new Hono<AppBindings>()
  .use('*', async (c, next) => {
    const expected = c.env.AUDIOBOOK_MAPPING_TOKEN;
    if (!expected) {
      // Not 401 — see `routes/ingest.ts`'s header on why "off" answers 404.
      return c.json({ error: 'audiobook_mapping_disabled' }, 404);
    }
    const header = c.req.header('Authorization') ?? '';
    const token = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] ?? '';
    if (!token || !secretEquals(token, expected)) {
      return c.json({ error: 'unauthenticated' }, 401);
    }
    await next();
  })

  .get('/', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT w.id AS workId, ah.title AS audiobookTitle,
              (SELECT group_concat(DISTINCT e.format) FROM edition e WHERE e.work_id = w.id) AS rawFormats
         FROM audiobook_holding ah
         JOIN work w ON w.id = ah.work_id
        WHERE ah.stale_at IS NULL
        ORDER BY w.id`,
    ).all<MappingRow>();

    // How many LIVE rows fold to each key. A count of 1 is the ordinary case
    // — that row's `foldedTitle` is unambiguous and goes out as-is. A count
    // of 2+ is a genuine collision: two different holdings whose titles are
    // indistinguishable once decoration is folded away. See the header above
    // for why the answer is "withhold both", never "pick one".
    const foldCounts = new Map<string, number>();
    for (const r of results) {
      const key = normaliseTitle(r.audiobookTitle);
      foldCounts.set(key, (foldCounts.get(key) ?? 0) + 1);
    }

    const collisions = [...foldCounts].filter(([, n]) => n > 1);
    if (collisions.length > 0) {
      // One log line, read via `wrangler tail` — never thrown, since a
      // collision degrades two rows to exact-match, it does not stall the
      // route. See routes/ingest.ts's failure-posture precedent.
      console.log(
        `[audiobook-mapping] ${collisions.length} folded-title collision(s), ` +
          `withholding foldedTitle: ${collisions.map(([key, n]) => `"${key}" (${n})`).join(', ')}`,
      );
    }

    const rows = results.map((r) => {
      const key = normaliseTitle(r.audiobookTitle);
      const ambiguous = (foldCounts.get(key) ?? 0) > 1;
      return {
        workId: r.workId,
        audiobookTitle: r.audiobookTitle,
        foldedTitle: ambiguous ? null : key,
        formats: crossCatalogFormatLabels((r.rawFormats ?? '').split(',').filter(Boolean)),
      };
    });

    return c.json({ rows, generatedAt: new Date().toISOString() });
  });
