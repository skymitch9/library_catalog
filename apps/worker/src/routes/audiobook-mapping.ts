import { Hono } from 'hono';
import { editionMedium } from '@lc/core';
import type { AppBindings } from '../env.js';

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
 */

const PHYSICAL_FORMAT_LABEL: Record<string, string> = {
  hardcover: 'Hardcover',
  paperback: 'Paperback',
  mass_market: 'Mass market',
};

/** `EDITION_FORMATS` → the audiobook side's format label. See header above. */
function formatLabelsFor(rawFormats: readonly string[]): string[] {
  const labels = new Set<string>();
  for (const format of rawFormats) {
    if (editionMedium(format) === 'ebook') {
      labels.add('Ebook');
    } else {
      labels.add(PHYSICAL_FORMAT_LABEL[format] ?? format);
    }
  }
  // Stable, sensible order: physical formats as they're likely to be shelved,
  // Ebook last — rather than whatever order SQLite's group_concat happened to
  // return, which is otherwise insertion order and not meaningful here.
  const order = ['Hardcover', 'Paperback', 'Mass market', 'Ebook'];
  return order.filter((l) => labels.has(l));
}

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

    const rows = results.map((r) => ({
      workId: r.workId,
      audiobookTitle: r.audiobookTitle,
      formats: formatLabelsFor((r.rawFormats ?? '').split(',').filter(Boolean)),
    }));

    return c.json({ rows, generatedAt: new Date().toISOString() });
  });
