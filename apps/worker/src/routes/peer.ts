/**
 * Cross-library ownership visibility — the peer push/query surface.
 *
 * Each instance can be configured with N peers (other instances of this same
 * app). Peers push their full holdings (work_key + display metadata) here on
 * catalog mutations; this endpoint upserts into `peer_holding` and the series
 * + work routes join against that table to show "In the Padhard Library" badges.
 *
 * ## Security
 *
 * Same as the donor route: `X-Peer-Token` must equal `PEER_TOKEN` (a shared
 * secret, same value on all instances). Wrong/absent token = 404, same as the
 * donor route's "this door does not exist" posture. Comparison via
 * `secretEquals` (timing-safe).
 *
 * ## Push contract
 *
 * `POST /api/peer/push` — full snapshot from one peer. The body carries a
 * `peerId`, `peerLabel`, and `holdings[]` array. This endpoint REPLACES all
 * rows for that `peer_id` wholesale (delete + insert in a batch), same as the
 * index-push pattern ("a failed push leaves the previous snapshot standing").
 *
 * ## Query
 *
 * `GET /api/peer/holdings?keys=key1,key2,...` — batch lookup. Returns which
 * of the given work_keys are held by any peer. Used by the series page to
 * annotate gap rungs without a cross-instance fetch on page load.
 */

import { Hono } from 'hono';
import type { AppBindings } from '../env.js';
import { secretEquals } from '../lib/secret-equals.js';

export interface PeerHoldingRow {
  work_key: string;
  peer_id: string;
  peer_label: string;
  title: string | null;
  cover_url: string | null;
  detail_url: string | null;
  formats: string | null;
  series: string | null;
  series_index: number | null;
  pushed_at: string;
}

export interface PeerPushPayload {
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
}

const peer = new Hono<AppBindings>();

/**
 * Receive a full holdings snapshot from a peer. Replaces all existing rows
 * for that peer_id.
 */
peer.post('/push', async (c) => {
  const env = c.env;
  const token = env.PEER_TOKEN;
  if (!token) return c.notFound();

  const header = c.req.header('X-Peer-Token') ?? '';
  if (!secretEquals(header, token)) return c.notFound();

  const body = await c.req.json<PeerPushPayload>();
  if (!body.peerId || !body.peerLabel || !Array.isArray(body.holdings)) {
    return c.json({ error: 'invalid payload' }, 400);
  }

  const db = env.DB;
  const now = new Date().toISOString();

  // Delete all existing rows for this peer, then insert the new snapshot.
  // Batched in a single transaction for atomicity.
  const stmts: D1PreparedStatement[] = [];

  stmts.push(
    db.prepare('DELETE FROM peer_holding WHERE peer_id = ?').bind(body.peerId)
  );

  for (const h of body.holdings) {
    stmts.push(
      db.prepare(
        `INSERT INTO peer_holding (work_key, peer_id, peer_label, title, cover_url, detail_url, formats, series, series_index, pushed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        h.work_key,
        body.peerId,
        body.peerLabel,
        h.title,
        h.cover_url,
        h.detail_url,
        h.formats,
        h.series,
        h.series_index,
        now,
      )
    );
  }

  await db.batch(stmts);

  return c.json({ received: body.holdings.length, peerId: body.peerId });
});

/**
 * Batch query: which of these work_keys does any peer hold?
 * Used by series/work routes to annotate gaps without cross-instance latency.
 */
peer.get('/holdings', async (c) => {
  const keysParam = c.req.query('keys');
  if (!keysParam) return c.json({ holdings: [] });

  const keys = keysParam.split(',').filter(Boolean);
  if (keys.length === 0) return c.json({ holdings: [] });

  // D1 doesn't support array parameters, so build a WHERE IN with placeholders
  const placeholders = keys.map(() => '?').join(',');
  const stmt = c.env.DB.prepare(
    `SELECT work_key, peer_id, peer_label, title, cover_url, detail_url, formats
     FROM peer_holding
     WHERE work_key IN (${placeholders})`
  ).bind(...keys);

  const { results } = await stmt.all<PeerHoldingRow>();
  return c.json({ holdings: results ?? [] });
});

export { peer as peerRoutes };
