/**
 * The peer-push holdings query must use the canonical HELD_STATUSES set
 * (2026-08 audit HIGH, `apps/worker/src/lib/peer-push.ts:89`).
 *
 * The bug: the query hardcoded `c.status IN ('owned', 'preordered', 'borrowed')`,
 * which contradicts HELD_STATUSES (`['owned','lent']`) in both directions — it
 * advertised borrowed and not-yet-delivered (preordered) books to another
 * household as things we hold, and hid books we own but have lent out.
 *
 * `buildPeerPayload` builds the query as a string, so we capture the SQL the
 * stub DB is handed and assert the status set is exactly HELD_STATUSES.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HELD_STATUSES } from '@lc/core';
import { buildPeerPayload, parsePeers, pushToPeers } from './peer-push.js';
import type { Env } from '../env.js';

/** A stub D1 that returns no rows — enough for buildPeerPayload to run. */
function emptyDb() {
  const stmt = {
    bind() {
      return stmt;
    },
    async all() {
      return { results: [] };
    },
  };
  return { prepare: () => stmt } as unknown as D1Database;
}

/** A fake, NON-real token value used only to prove header wiring. */
const FAKE_PEER_TOKEN = 'test-token-not-the-real-secret';

function capturingDb(sqlSink: string[]) {
  return {
    prepare(sql: string) {
      sqlSink.push(sql);
      const stmt = {
        bind() {
          return stmt;
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

describe('buildPeerPayload — held-copy status set', () => {
  it('filters copies on the canonical HELD_STATUSES, not a hand-rolled list', async () => {
    const sql: string[] = [];
    await buildPeerPayload(capturingDb(sql), 'self', 'Self Library', 'https://self.test');

    const holdingsQuery = sql.find((s) => /FROM work w/i.test(s));
    assert.ok(holdingsQuery, 'expected the holdings query to run');

    // Every held status appears in the IN clause.
    for (const status of HELD_STATUSES) {
      assert.match(
        holdingsQuery!,
        new RegExp(`'${status}'`),
        `held status '${status}' must be in the peer-push filter`,
      );
    }

    // The wrong statuses from the pre-fix list must NOT appear.
    for (const wrong of ['preordered', 'borrowed']) {
      assert.doesNotMatch(
        holdingsQuery!,
        new RegExp(`'${wrong}'`),
        `'${wrong}' is not a held status and must not be advertised to peers`,
      );
    }
  });
});

describe('parsePeers — token is no longer part of the PEERS shape', () => {
  it('parses entries that carry only id/label/url (no token field)', () => {
    const env = {
      PEERS: JSON.stringify([
        { id: 'padhard', label: 'the Padhard Library', url: 'https://padhard.test' },
      ]),
    } as unknown as Env;

    const peers = parsePeers(env);
    assert.equal(peers.length, 1, 'a token-less peer entry must still parse');
    const first = peers[0]!;
    assert.equal(first.id, 'padhard');
    assert.equal(first.url, 'https://padhard.test');
    assert.ok(!('token' in first), 'parsed peer must not carry a token field');
  });

  it('returns [] for unset PEERS', () => {
    assert.deepEqual(parsePeers({} as unknown as Env), []);
  });
});

describe('pushToPeers — outbound token comes from the PEER_TOKEN secret', () => {
  function baseEnv(overrides: Record<string, unknown>): Env {
    return {
      DB: emptyDb(),
      PEERS: JSON.stringify([
        { id: 'padhard', label: 'the Padhard Library', url: 'https://padhard.test' },
      ]),
      PEER_SELF_ID: 'sky',
      PEER_SELF_LABEL: "Sky's Library",
      SITE_ORIGIN: 'https://self.test',
      ...overrides,
    } as unknown as Env;
  }

  it('sends env.PEER_TOKEN as the X-Peer-Token header', async () => {
    const originalFetch = globalThis.fetch;
    let sentToken: string | null = null;
    let called = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      called += 1;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      sentToken = headers['X-Peer-Token'] ?? null;
      return { ok: true, async json() { return { received: 0 }; } } as unknown as Response;
    }) as typeof fetch;

    try {
      await pushToPeers(baseEnv({ PEER_TOKEN: FAKE_PEER_TOKEN }));
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(called, 1, 'the push must be sent to the one configured peer');
    assert.equal(sentToken, FAKE_PEER_TOKEN, 'X-Peer-Token must be env.PEER_TOKEN');
  });

  it('skips the push (does not send an empty token) when PEER_TOKEN is unset', async () => {
    const originalFetch = globalThis.fetch;
    let called = 0;
    globalThis.fetch = (async () => {
      called += 1;
      return { ok: true, async json() { return { received: 0 }; } } as unknown as Response;
    }) as typeof fetch;

    let results: Array<{ peer: string; result: string }>;
    try {
      results = await pushToPeers(baseEnv({ PEER_TOKEN: undefined }));
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(called, 0, 'no request may be sent when PEER_TOKEN is unset');
    assert.match(results[0]!.result, /PEER_TOKEN not set/, 'skip must be reported by name');
  });
});
