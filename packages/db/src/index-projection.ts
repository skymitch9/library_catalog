/**
 * The projection this catalog pushes to the shared index Worker
 * (catalog-platform/apps/index-worker — read its design doc,
 * catalog-platform/docs/info/index-worker-design.md §2/§4.1/§5, before
 * widening this).
 *
 * ⚠️ DEFAULT-DENY, BY EXPLICIT ALLOW-LIST — never `SELECT *` minus exclusions.
 * The columns below are the complete list of what leaves this catalog, and
 * every one is display data or a pointer. NEVER exported: copy counts, copy
 * status, prices, locations, `lent_to`-shaped facts, read-state, per-person
 * ratings, acquisition dates, ISBNs, ASINs, descriptions. **Ownership does not
 * travel** — the index points at /work/:id and THIS catalog answers
 * owned-versus-wishlist when the visitor arrives. `export.ts` is the wrong
 * wheel here on purpose — that is a full backup; this is written fresh.
 *
 * ⚠️ RAW display strings only: the index folds join keys ON ITS SIDE, once, on
 * write (its fold is pinned to this repo's `normaliseTitle`/`splitAuthors` by
 * catalog-platform/data/match-fold.fixtures.json). NO fold code exists in this
 * repo for the index, and none may be added — a second fold implementation is
 * exactly the drift the index was built to kill.
 *
 * ⚠️ The `?unknown` sentinel (@lc/core UNKNOWN_AUTHOR) is pushed RAW, on
 * purpose — do not pre-filter it here. The index's `creatorFoldOrNull`
 * refuses the sentinel before folding (folding it would yield plain
 * 'unknown', colliding with a real "Author Unknown" credit), so an authorless
 * work lands with `work_fold = NULL`: it can never claim to be the same WORK
 * as anything, and it joins in lookups by `title_fold` alone. Sending the
 * sentinel keeps that refusal path exercised by real traffic instead of
 * theoretical.
 */

/** Where a lookup hit sends the visitor. The custom domain from wrangler.toml. */
export const SITE_ORIGIN = 'https://library.heygabi.ai';

/**
 * Matches the index's push-row contract (rows.ts there, `.strict()` zod — an
 * unknown key is refused by name). `publisher`, `kind` and `parent_source_id`
 * are legitimately absent rather than null-stuffed: publisher is an
 * edition-level fact here (a work has no single publisher), and kind/parent
 * are the games catalog's expansion tree, which books replaced with the
 * `series` columns.
 */
export interface IndexProjectionRow {
  source_id: string;
  title: string;
  creator: string;
  series: string | null;
  series_index: number | null;
  year: number | null;
  format: 'book';
  cover_url: string | null;
  detail_url: string;
}

/**
 * `work.cover_url` stores SITE-RELATIVE paths for self-hosted covers
 * (`/covers/…`, served by this app's own origin) and absolute URLs for
 * R2-rehosted and remaining hotlinked ones. Inside this app a relative path
 * is fine; in the index it would resolve against index.heygabi.ai and 404
 * (caught by the local push probe, 2026-08-13: 114/116 local rows were
 * relative). Absolutise on the way out — pointer construction, exactly like
 * `detail_url`, not a transformation of catalog truth.
 */
function absoluteCoverUrl(coverUrl: string | null): string | null {
  if (coverUrl === null) return null;
  return coverUrl.startsWith('/') ? `${SITE_ORIGIN}${coverUrl}` : coverUrl;
}

interface ProjectionSourceRow {
  id: number;
  title: string;
  authors: string;
  series: string | null;
  series_index_sort: number | null;
  first_published: number | null;
  cover_url: string | null;
}

/**
 * Build the complete snapshot. Always the whole catalog — the index replaces
 * this source's rows wholesale on every push (design §5), which is what makes
 * the forgotten-re-run drift class (both existing library↔audiobook bridges)
 * structurally impossible. Wishlist works go too, exactly as the games
 * projection sends wanted items: one row per catalogued thing, and whether it
 * is owned is this catalog's answer, not the index's.
 */
export async function buildIndexProjection(db: D1Database): Promise<IndexProjectionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, title, authors, series, series_index_sort, first_published, cover_url
         FROM work
        ORDER BY id`,
    )
    .all<ProjectionSourceRow>();

  return results.map((row) => ({
    source_id: String(row.id),
    title: row.title,
    // The raw stored string, sentinel and all — see the module header.
    creator: row.authors,
    series: row.series,
    series_index: row.series_index_sort,
    year: row.first_published,
    // One value for the whole catalog: the index's format column answers
    // "which SITE is this row from" in a result list, not "which printing".
    // Hardcover-vs-paperback-vs-ebook is edition-level truth that stays here.
    format: 'book' as const,
    cover_url: absoluteCoverUrl(row.cover_url),
    detail_url: `${SITE_ORIGIN}/work/${row.id}`,
  }));
}

interface LatestUpdateRow {
  latest: string | null;
}

/**
 * Epoch ms of the most recently touched `work` row — a cheap fingerprint the
 * staleness backstop (`apps/worker/src/lib/index-push.ts`) compares against
 * the index's own `pushed_at` to catch writes that bypass every mutation
 * route. Built for the 2026-08-15 incident: a backfill script wrote `work`
 * directly via `wrangler d1 execute`, so no route ever ran and the 24h-age
 * backstop had no way to see that anything had changed — the index kept
 * serving a stale row ("Boba Fett still Part of Disney") until someone did an
 * unrelated mutation by hand to trigger a push.
 *
 * Not a new invariant, only a new reader of one: every path that can move a
 * projected column already bumps `work.updated_at` (`packages/db/src/works.ts`
 * and the backfill scripts under `/scripts`), because it was already needed
 * for `apply-pending-findings.mjs`'s own change-detection. A script that
 * skips the bump is invisible to this check exactly as it is invisible to
 * everything else that reads `updated_at` — see `scripts/backfill-years.mjs`,
 * fixed alongside this to stop being that gap.
 */
export async function getLatestSourceUpdateAt(db: D1Database): Promise<number | null> {
  const row = await db.prepare(`SELECT MAX(updated_at) AS latest FROM work`).first<LatestUpdateRow>();
  return sqliteTimeToMs(row?.latest ?? null);
}

/**
 * D1's `datetime('now')` writes `YYYY-MM-DD HH:MM:SS` — UTC, no zone marker.
 * Naive `Date.parse` reads that shape as *local* time (first documented at
 * `apps/worker/src/routes/scan-jobs.ts`'s `sqliteTime`, same fix, same
 * reason); say UTC explicitly rather than let the Worker's runtime zone
 * decide silently.
 */
function sqliteTimeToMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? null : ms;
}
