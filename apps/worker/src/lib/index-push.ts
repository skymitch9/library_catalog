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
 * Three triggers, and the split is the design's — but the second differs from
 * the games catalog, honestly rather than cosmetically:
 *
 *  1. AFTER MUTATIONS (`indexPushAfterMutation`) — a successful write under a
 *     catalog-shaped route schedules a push via `waitUntil`, so the index is
 *     fresh within seconds of the shelf changing.
 *  2. A DATA-AWARE STALENESS BACKSTOP RIDING REQUEST TRAFFIC
 *     (`indexBackstopOnRequest`). ⚠️ The games backstop rides that repo's
 *     PROVEN half-hourly cron. THIS Worker has no cron at all —
 *     wrangler.toml says so and records the sibling's rule for when one
 *     arrives: a cron is not working until something it writes has rows.
 *     Declaring a new trigger here and calling it the backstop would be
 *     exactly the unproven-cron mistake that rule exists to stop. So the
 *     backstop's honest home is the traffic that provably exists: at most
 *     once per BACKSTOP_CHECK_INTERVAL_MS per isolate, an API request
 *     schedules (on `waitUntil`, after responding) one unauthenticated GET of
 *     the index's /api/health, and re-pushes if EITHER the library source is
 *     empty/older than a day OR `work.updated_at`'s high-water mark has moved
 *     past the index's last `pushed_at` (`pushIndexIfStale`, comparing
 *     against `getLatestSourceUpdateAt` — see index-projection.ts). That
 *     second condition is the 2026-08-15 fix: a clock-only staleness check
 *     cannot tell that a backfill script wrote D1 directly (bypassing every
 *     route, so no mutation push fired) — it just waited out the same 24h
 *     either way. Comparing data against data closes that class: ANY
 *     out-of-band write becomes pushable within one backstop tick of normal
 *     traffic, with no human trick required.
 *  3. A MANUAL FORCE (`POST /api/admin/index-push`, routes/admin.ts) — gated
 *     exactly like the rest of that surface (`requireCapability('manageUsers')`
 *     + the federated-admin CORS mount), for the case a person wants the push
 *     to happen now rather than on the next backstop tick.
 *
 *     What the request-riding shape trades, stated: an untouched app pushes
 *     nothing — but an untouched app's CATALOG is not changing either,
 *     because every write path but one is an API route or a script that
 *     bumps `updated_at` (now covered by trigger 2). The one residual gap:
 *     index-side `universes.json` edits (the index resolves universes on
 *     write, so they propagate on re-push — design §9 Q2 assumes roughly
 *     daily pushes, which the household's actual use of this app supplies).
 *     If Phase 5 ever lands its cover-health cron AND that cron proves itself
 *     by the sibling's rule, move the backstop onto it and delete this
 *     paragraph.
 *
 * ⚠️ Fails SOFT everywhere, on purpose: the index must never be able to stall
 * this catalog (design §5: no inbound pull, and no outbound dependency
 * either). `INDEX_URL` / `INDEX_PUSH_TOKEN` unset (true in production until
 * the dispatcher's deploy step) means every trigger logs one line and does
 * nothing. No throw from here ever reaches a route.
 */

import type { MiddlewareHandler } from 'hono';
import { buildIndexProjection, getLatestSourceUpdateAt } from '@lc/db';
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

/** What `pushIndexIfStale` needs to decide, stripped of D1/fetch so the
 *  decision itself is a pure function — see `decidePushForStaleness`. */
export interface StalenessCheckInput {
  /** Row count the index reports for this source, from /api/health. */
  rows: number | null | undefined;
  /** `pushed_at` the index reports for this source, from /api/health. */
  pushedAtIso: string | null | undefined;
  /** `getLatestSourceUpdateAt(env.DB)` — epoch ms, or null if `work` is empty. */
  latestSourceUpdateMs: number | null;
  nowMs: number;
  maxAgeMs: number;
}

export type StalenessDecision = { push: boolean; reason: string };

/**
 * The gate itself, pulled out of `pushIndexIfStale` so it can be unit tested
 * without a live index or a D1 binding. Four ways to decide "push":
 *
 *  1. the index has no rows for this source (first push / wiped),
 *  2. the index's `pushed_at` is missing or unparseable,
 *  3. the last push is older than `maxAgeMs` (the original clock check), or
 *  4. ⚠️ THE FIX: `work`'s own last-modified fact is newer than the index's
 *     `pushed_at` — i.e. something changed the catalog after the index last
 *     heard from it, regardless of how young that push is. This is what
 *     catches a backfill script that wrote D1 directly ten minutes ago: the
 *     age check alone would call a five-minute-old push "fresh" and skip,
 *     exactly the bug this exists to close.
 *
 * Anything else is genuinely fresh: the index has rows, it heard from us
 * recently, and nothing has moved since.
 */
export function decidePushForStaleness(input: StalenessCheckInput): StalenessDecision {
  const { rows, pushedAtIso, latestSourceUpdateMs, nowMs, maxAgeMs } = input;

  if (!rows || rows <= 0) {
    return { push: true, reason: 'index reports zero rows for this source' };
  }

  const pushedAtMs = pushedAtIso ? Date.parse(pushedAtIso) : Number.NaN;
  if (!Number.isFinite(pushedAtMs)) {
    return { push: true, reason: 'index reported no valid pushed_at' };
  }

  const ageMs = nowMs - pushedAtMs;
  if (ageMs >= maxAgeMs) {
    return { push: true, reason: `last push is ${Math.round(ageMs / 3_600_000)}h old (>${maxAgeMs / 3_600_000}h)` };
  }

  if (latestSourceUpdateMs !== null && latestSourceUpdateMs > pushedAtMs) {
    return {
      push: true,
      reason: `source data changed at ${new Date(latestSourceUpdateMs).toISOString()}, after the last push`,
    };
  }

  return { push: false, reason: `index is fresh (${rows} rows, pushed ${pushedAtIso})` };
}

/**
 * The backstop body: one health GET, one cheap MAX(updated_at) read, push
 * only when `decidePushForStaleness` says to.
 */
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

  const latestSourceUpdateMs = await getLatestSourceUpdateAt(env.DB);
  const decision = decidePushForStaleness({
    rows: library?.rows,
    pushedAtIso: library?.pushed_at,
    latestSourceUpdateMs,
    nowMs: Date.now(),
    maxAgeMs: BACKSTOP_MAX_AGE_MS,
  });

  if (!decision.push) {
    return { skipped: decision.reason };
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
