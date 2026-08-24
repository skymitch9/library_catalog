/**
 * Pushing this catalog's owned work_keys to configured peer instances.
 *
 * Same trigger pattern as index-push: fire after catalog mutations via
 * `waitUntil`, so peer_holding tables across the network stay fresh within
 * seconds of a shelf change.
 *
 * ## Design
 *
 * Full snapshot, POST /api/peer/push, bearer token — same as the index push,
 * the peer replaces this source's rows wholesale. No incremental state to
 * drift.
 *
 * PEERS is a JSON array in wrangler.toml [vars], parsed at runtime:
 * ```json
 * [{"id":"padhard","label":"the Padhard Library","url":"https://padhard.heygabi.ai"}]
 * ```
 * The outbound auth token is NOT in PEERS (it is a public [vars] block). It is
 * the `PEER_TOKEN` secret — a single shared value across all instances — sent
 * as the `X-Peer-Token` header below.
 *
 * ⚠️ Fails SOFT everywhere, on purpose: a peer being down must never stall
 * this catalog. Unset PEERS or empty array = no-op.
 */

import type { MiddlewareHandler } from 'hono';
import { HELD_STATUSES } from '@lc/core';
import type { AppBindings, Env } from '../env.js';

/**
 * The held-copy set as a SQL literal list, e.g. `'owned','lent'`. Built from the
 * canonical `HELD_STATUSES` constant (fixed, code-defined values — no user
 * input, so interpolation is safe) so the peer push advertises exactly the
 * books we actually hold.
 */
const HELD_STATUSES_SQL = HELD_STATUSES.map((s) => `'${s}'`).join(', ');

export interface PeerConfig {
  id: string;
  label: string;
  url: string;
}

/**
 * Parse the PEERS JSON config. Returns [] if unset or invalid.
 */
export function parsePeers(env: Env): PeerConfig[] {
  const raw = (env as unknown as Record<string, unknown>).PEERS as string | undefined;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is PeerConfig =>
        typeof p.id === 'string' &&
        typeof p.label === 'string' &&
        typeof p.url === 'string'
    );
  } catch {
    return [];
  }
}

/**
 * Build the peer push payload from this catalog's held works.
 * Only includes works that have at least one copy with a "held" status.
 */
export async function buildPeerPayload(
  db: D1Database,
  selfId: string,
  selfLabel: string,
  siteOrigin: string,
): Promise<{
  peerId: string;
  peerLabel: string;
  holdings: Array<{
    work_key: string;
    title: string | null;
    cover_url: string | null;
    detail_url: string | null;
    formats: string | null;
    series: string | null;
    series_index: number | null;
  }>;
}> {
  // Query all works that have at least one HELD copy — the canonical
  // HELD_STATUSES set ('owned','lent'). ⚠️ The old list ('owned','preordered',
  // 'borrowed') was wrong in both directions: it advertised preordered (not yet
  // delivered) and borrowed (someone else's book we hold) to peers as things we
  // own, and it HID 'lent' — a book we own that is just in someone else's hands.
  const { results } = await db.prepare(`
    SELECT DISTINCT
      w.work_key,
      w.title,
      w.cover_url,
      w.id,
      w.series,
      w.series_index_sort,
      GROUP_CONCAT(DISTINCT e.format) as formats
    FROM work w
    JOIN copy c ON c.work_id = w.id
    LEFT JOIN edition e ON e.id = c.edition_id
    WHERE c.status IN (${HELD_STATUSES_SQL})
      AND w.work_key IS NOT NULL
      AND w.work_key != ''
    GROUP BY w.id
  `).all<{
    work_key: string;
    title: string | null;
    cover_url: string | null;
    id: number;
    series: string | null;
    series_index_sort: number | null;
    formats: string | null;
  }>();

  const holdings = (results ?? []).map((r) => {
    // Normalise formats: group into physical/ebook
    let formatLabel: string | null = null;
    if (r.formats) {
      const fmts = r.formats.split(',');
      const hasPhysical = fmts.some((f) =>
        ['hardcover', 'paperback', 'mass_market'].includes(f)
      );
      const hasEbook = fmts.some((f) =>
        ['ebook_epub', 'ebook_kindle', 'ebook_pdf'].includes(f)
      );
      if (hasPhysical && hasEbook) formatLabel = 'physical,ebook';
      else if (hasPhysical) formatLabel = 'physical';
      else if (hasEbook) formatLabel = 'ebook';
    }

    // Absolutise cover URL
    let coverUrl = r.cover_url;
    if (coverUrl && coverUrl.startsWith('/')) {
      coverUrl = `${siteOrigin}${coverUrl}`;
    }

    return {
      work_key: r.work_key,
      title: r.title,
      cover_url: coverUrl,
      detail_url: `${siteOrigin}/work/${r.id}`,
      formats: formatLabel,
      series: r.series,
      series_index: r.series_index_sort,
    };
  });

  return { peerId: selfId, peerLabel: selfLabel, holdings };
}

/**
 * Push this catalog's holdings to all configured peers.
 * Returns a summary per peer.
 */
export async function pushToPeers(env: Env): Promise<Array<{ peer: string; result: string }>> {
  const peers = parsePeers(env);
  if (peers.length === 0) return [];

  // Outbound auth: the shared PEER_TOKEN secret, sent as X-Peer-Token. This is
  // the value the RECEIVING instance checks against its own env.PEER_TOKEN in
  // routes/peer.ts. ⚠️ REQUIREMENT: the network uses ONE shared token, so
  // `sky.PEER_TOKEN` and `padhard.PEER_TOKEN` MUST be the SAME value (they
  // already are). Rotating it means re-minting on BOTH workers, same value.
  // If it is unset we must NOT send an empty token — skip the push entirely.
  const peerToken = env.PEER_TOKEN;
  if (!peerToken) {
    return [{ peer: '*', result: 'PEER_TOKEN not set — outbound peer push skipped' }];
  }

  const selfId = (env as unknown as Record<string, unknown>).PEER_SELF_ID as string | undefined;
  const selfLabel = (env as unknown as Record<string, unknown>).PEER_SELF_LABEL as string | undefined;
  const siteOrigin = (env as unknown as Record<string, unknown>).SITE_ORIGIN as string | undefined;

  if (!selfId || !selfLabel || !siteOrigin) {
    return [{ peer: '*', result: 'PEER_SELF_ID / PEER_SELF_LABEL / SITE_ORIGIN not configured' }];
  }

  const payload = await buildPeerPayload(env.DB, selfId, selfLabel, siteOrigin);
  const results: Array<{ peer: string; result: string }> = [];

  for (const p of peers) {
    try {
      const res = await fetch(`${p.url}/api/peer/push`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Peer-Token': peerToken,
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const body = await res.json<{ received: number }>();
        results.push({ peer: p.id, result: `pushed ${body.received} holdings` });
      } else {
        results.push({ peer: p.id, result: `HTTP ${res.status}` });
      }
    } catch (e) {
      results.push({ peer: p.id, result: `error: ${e}` });
    }
  }

  return results;
}

/**
 * Middleware: after a successful mutation on item-touching routes, push
 * holdings to all peers via `waitUntil`. Same pattern as `indexPushAfterMutation`.
 */
const ITEM_TOUCHING_PREFIXES = [
  '/api/works',
  '/api/ingest',
  '/api/enrich',
  '/api/research',
  '/api/scan-jobs',
  '/api/series',
];

export function peerPushAfterMutation(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    await next();

    // Only fire on successful writes to item-touching routes
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    if (c.res.status < 200 || c.res.status >= 300) return;

    const path = new URL(c.req.url).pathname;
    if (!ITEM_TOUCHING_PREFIXES.some((p) => path.startsWith(p))) return;

    const peers = parsePeers(c.env);
    if (peers.length === 0) return;

    // Fire and forget via waitUntil
    c.executionCtx.waitUntil(
      pushToPeers(c.env).then((r) => {
        for (const { peer, result } of r) {
          console.log(`[peer-push] ${peer}: ${result}`);
        }
      }).catch((e) => {
        console.error('[peer-push] failed:', e);
      })
    );
  };
}
