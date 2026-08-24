/**
 * Token gate on GET /api/peer/holdings (2026-08 audit HIGH,
 * `apps/worker/src/routes/peer.ts:120`).
 *
 * The bug: GET /api/peer/holdings performed NO token check, yet it is mounted
 * before the requireAuth blanket and classified everywhere as a token-gated
 * machine route — an unauthenticated public read of another household's
 * holdings. The route has zero callers (the series/work enrichment reads
 * peer_holding in SQL), so it can safely require the token like POST /push.
 *
 * These tests assert the same posture POST /push has: unset PEER_TOKEN → 404,
 * wrong/absent header → 404, correct header → 200 with results.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppBindings, Env } from '../env.js';
import { peerRoutes } from './peer.js';

const TOKEN = 'test-peer-token';

function app() {
  const a = new Hono<AppBindings>();
  a.route('/api/peer', peerRoutes);
  return a;
}

function stubDb() {
  return {
    prepare() {
      const stmt = {
        bind() {
          return stmt;
        },
        async all() {
          return { results: [{ work_key: '/works/1', peer_id: 'p', peer_label: 'Padhard' }] };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function envWith(overrides: Partial<Env> = {}): Env {
  return { DB: stubDb(), PEER_TOKEN: TOKEN, ESTATE_APP: 'library', ...overrides } as unknown as Env;
}

describe('GET /api/peer/holdings — peer token gate', () => {
  it('404s when no X-Peer-Token header is sent', async () => {
    const res = await app().request('/api/peer/holdings?keys=/works/1', {}, envWith());
    assert.equal(res.status, 404);
  });

  it('404s on a wrong token', async () => {
    const res = await app().request(
      '/api/peer/holdings?keys=/works/1',
      { headers: { 'X-Peer-Token': 'nope' } },
      envWith(),
    );
    assert.equal(res.status, 404);
  });

  it('404s when PEER_TOKEN is unset (door does not exist)', async () => {
    const res = await app().request(
      '/api/peer/holdings?keys=/works/1',
      { headers: { 'X-Peer-Token': TOKEN } },
      envWith({ PEER_TOKEN: undefined }),
    );
    assert.equal(res.status, 404);
  });

  it('200s with the correct token', async () => {
    const res = await app().request(
      '/api/peer/holdings?keys=/works/1',
      { headers: { 'X-Peer-Token': TOKEN } },
      envWith(),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { holdings: unknown[] };
    assert.equal(body.holdings.length, 1);
  });
});
