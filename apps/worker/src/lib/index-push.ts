/**
 * Pushing this catalog's projection to the shared index Worker.
 *
 * Design: catalog-platform/docs/info/index-worker-design.md §5 and §7 step 4;
 * working precedent: the games pusher (Board_Game_Catalog
 * apps/worker/src/lib/index-push.ts), ported rather than reinvented. Full
 * snapshot, PUT /api/push/library, bearer token — the index replaces this
 * source's rows wholesale, so there is no incremental state to fall behind and
 * a failed push simply leaves the previous snapshot standing.
 *
 * Two triggers, and the split is the design's — but the second differs from
 * the games catalog, honestly rather than cosmetically:
 *
 *  1. AFTER MUTATIONS (`indexPushAfterMutation`) — a successful write under a
 *     catalog-shaped route schedules a push via `waitUntil`, so the index is
 *     fresh within seconds of the shelf changing.
 *  2. A STALENESS BACKSTOP RIDING REQUEST TRAFFIC (`indexBackstopOnRequest`).
 *     ⚠️ The games backstop rides that repo's PROVEN half-hourly cron. THIS
 *     Worker has no cron at all — wrangler.toml says so and records the
 *     sibling's rule for when one arrives: a cron is not working until
 *     something it writes has rows. Declaring a new trigger here and calling
 *     it the backstop would be exactly the unproven-cron mistake that rule
 *     exists to stop. So the backstop's honest home is the traffic that
 *     provably exists: at most once per BACKSTOP_CHECK_INTERVAL_MS per
 *     isolate, an API request schedules (on `waitUntil`, after responding)
 *     one unauthenticated GET of the index's /api/health, and re-pushes only
 *     if the library source is empty or older than a day.
 *
 *     What that trades, stated: an untouched app pushes nothing — but an
 *     untouched app's CATALOG is not changing either, because every write
 *     path but one is an API route. The residual gaps, both inside the
 *     design's ≤24h-staleness tolerance once anyone next opens the app:
 *     backfill scripts that write D1 directly (they bypass every route, so
 *     no mutation push fires), and index-side `universes.json` edits (the
 *     index resolves universes on write, so they propagate on re-push —
 *     design §9 Q2 assumes roughly daily pushes, which the household's actual
 *     use of this app supplies). If Phase 5 ever lands its cover-health cron
 *     AND that cron proves itself by the sibling's rule, move the backstop
 *     onto it and delete this paragraph.
 *
 * ⚠️ Fails SOFT everywhere, on purpose: the index must never be able to stall
 * this catalog (design §5: no inbound pull, and no outbound dependency
 * either). `INDEX_URL` / `INDEX_PUSH_TOKEN` unset (true in production until
 * the dispatcher's deploy step) means every trigger logs one line and does
 * nothing. No throw from here ever reaches a route.
 */

import type { MiddlewareHandler } from 'hono';
import { buildIndexProjection } from '@lc/db';
import type { AppBindings, Env } from '../env.js';

/** How stale the backstop tolerates the index being before re-pushing. */
const BACKSTOP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How often one isolate will even LOOK at the index's health. An isolate
 * recycle resets the clock, which costs at worst an extra unauthenticated GET
 * — cheap by construction, so the throttle only has to be roughly right.
 */
const BACKSTOP_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Routes whose successful mutations can change what the projection reads
 * (`work` rows: title/authors/series/series_index/first_published/cover_url).
 *
 * `/api/works` also covers the sub-resources mounted under it — covers,
 * aliases, relations, accessories, watches — some of which never touch a
 * projected column; a spurious push costs one snapshot and nothing else.
 * `/api/ingest` is the ebook importer, which creates works while mounted
 * BEFORE requireAuth — this middleware must therefore be mounted before it
 * too (see index.ts). `/api/reviews`, `/api/users`, `/api/crowdfunding` are
 * deliberately absent: nothing they write travels. Missing a path here is a
 * ≤24h staleness bug, not a correctness bug — the backstop exists precisely
 * so this list does not have to be perfect forever.
 */
const ITEM_TOUCHING_PREFIXES = [
  '/api/works',
  '/api/ingest',
  '/api/enrich',
  '/api/research',
  '/api/scan-jobs',
  '/api/series',
];

export async function pushIndexSnapshot(env: Env): Promise<{ pushed: number } | { skipped: string }> {
  if (!env.INDEX_URL || !env.INDEX_PUSH_TOKEN) {
    return { skipped: 'INDEX_URL / INDEX_PUSH_TOKEN not configured' };
  }

  const rows = await buildIndexProjection(env.DB);
  // The index 422s an empty snapshot ("zero rows is a failed export, not an
  // empty catalog") — don't even send one.
  if (rows.length === 0) {
    return { skipped: 'projection produced zero rows — not pushing an empty snapshot' };
  }

  const res = await fetch(`${env.INDEX_URL}/api/push/library`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.INDEX_PUSH_TOKEN}`,
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(`index push failed: ${res.status} ${await res.text()}`);
  }
  return { pushed: rows.length };
}

/** The backstop body: one health GET; push only when missing or stale. */
export async function pushIndexIfStale(env: Env): Promise<{ pushed: number } | { skipped: string }> {
  if (!env.INDEX_URL || !env.INDEX_PUSH_TOKEN) {
    return { skipped: 'INDEX_URL / INDEX_PUSH_TOKEN not configured' };
  }

  const res = await fetch(`${env.INDEX_URL}/api/health`);
  if (!res.ok) {
    throw new Error(`index health check failed: ${res.status}`);
  }
  const health = (await res.json()) as {
    sources?: { library?: { rows?: number; pushed_at?: string | null } };
  };

  const library = health.sources?.library;
  const pushedAt = library?.pushed_at ? Date.parse(library.pushed_at) : Number.NaN;
  const fresh =
    (library?.rows ?? 0) > 0 && Number.isFinite(pushedAt) && Date.now() - pushedAt < BACKSTOP_MAX_AGE_MS;
  if (fresh) {
    return { skipped: `index is fresh (${library?.rows} rows, pushed ${library?.pushed_at})` };
  }
  return pushIndexSnapshot(env);
}

/**
 * After any successful item-touching mutation, schedule a snapshot push on
 * `waitUntil` — the response never waits for the index, and a push failure
 * lands in the log, not on the person saving a book.
 */
export function indexPushAfterMutation(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    await next();

    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    if (c.res.status >= 400) return;
    if (!ITEM_TOUCHING_PREFIXES.some((p) => c.req.path.startsWith(p))) return;
    if (!c.env.INDEX_URL || !c.env.INDEX_PUSH_TOKEN) return; // unconfigured: stay silent per-request

    c.executionCtx.waitUntil(
      pushIndexSnapshot(c.env).then(
        (r) => console.log('index push (mutation)', JSON.stringify(r)),
        (err) => console.error('index push (mutation) failed', err),
      ),
    );
  };
}

/** Last time THIS isolate ran the backstop check. Module state, reset on recycle. */
let lastBackstopCheckAt = 0;

/**
 * The request-riding staleness backstop — see the module header for why this
 * is not a cron here. Runs after the response on `waitUntil`; costs one
 * unauthenticated health GET per isolate-hour when the index is fresh.
 */
export function indexBackstopOnRequest(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    await next();

    if (!c.env.INDEX_URL || !c.env.INDEX_PUSH_TOKEN) return; // unconfigured: stay silent per-request
    const now = Date.now();
    if (now - lastBackstopCheckAt < BACKSTOP_CHECK_INTERVAL_MS) return;
    lastBackstopCheckAt = now;

    c.executionCtx.waitUntil(
      pushIndexIfStale(c.env).then(
        (r) => console.log('index push (backstop)', JSON.stringify(r)),
        (err) => console.error('index push (backstop) failed', err),
      ),
    );
  };
}
