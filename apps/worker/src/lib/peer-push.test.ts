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
import {
  _resetRegistryMemo,
  buildPeerPayload,
  parsePeers,
  pushToPeers,
  resolvePeers,
} from './peer-push.js';
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

/* --------------------------------------------------------------------------
 * resolvePeers — the SET stays in PEERS, the NAMES come from the registry
 *
 * 🔴 THE ACCESS RULE IS THE POINT AND IS TESTED FIRST. A peer entry lets this
 * catalog read another household's holdings and theirs read ours. The estate's
 * rule is that access-increasing changes are the owner's explicit call, so a
 * catalog appearing in the directory must NEVER enrol itself into a peer
 * network. Everything else here is about names and hosts.
 * ------------------------------------------------------------------------ */

/** The anonymous `/api/catalogs` answer, shaped as the live route returns it. */
function registryBody(extra: Array<Record<string, unknown>> = []) {
  return {
    ok: true,
    catalogs: [
      { id: 'audiobook', push_source: 'audiobook', kind: 'audio', label: 'Shared audiobooks', owner: null, holding: 'digital', shared: true, host: 'audiobooks.test' },
      { id: 'library', push_source: 'library', kind: 'books', label: "Skylar's library", owner: 'Skylar', holding: 'physical', shared: false, host: 'self.test' },
      { id: 'library2', push_source: 'library2', kind: 'books', label: "Samantha's library", owner: 'Samantha', holding: 'physical', shared: false, host: 'padhard.test' },
      ...extra,
    ],
    counts: 'none',
  };
}

function registryFetch(body: unknown, { ok = true }: { ok?: boolean } = {}) {
  return (async () => ({ ok, async json() { return body; } }) as unknown as Response) as typeof fetch;
}

function peerEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    DB: emptyDb(),
    INDEX_URL: 'https://index.test',
    SITE_ORIGIN: 'https://self.test',
    PEERS: JSON.stringify([
      { id: 'padhard', label: 'the Padhard Library', url: 'https://padhard.test' },
    ]),
    ...overrides,
  } as unknown as Env;
}

const AMBER = {
  id: 'library3',
  push_source: 'library3',
  kind: 'books',
  label: "Amber's Library",
  owner: 'Amber',
  holding: 'physical',
  shared: false,
  host: 'amber.test',
};

describe('resolvePeers — the registry names the peers PEERS already named', () => {
  it('🔴 a registry catalog that is NOT in PEERS is never added — peering is access-increasing', async () => {
    _resetRegistryMemo();
    const { peers, notes } = await resolvePeers(peerEnv(), {
      fetchImpl: registryFetch(registryBody([AMBER])),
      now: 1,
    });
    assert.equal(peers.length, 1, 'the SET is PEERS and only PEERS');
    assert.ok(!peers.some((p) => p.url.includes('amber')), 'library3 must not enrol itself');
    // ⚠️ SAID, NOT DONE: it has to be visible that the network is smaller than
    // the estate on purpose, or nobody ever notices that it is.
    assert.ok(notes.some((n) => /library3/.test(n) && /access-increasing/.test(n)));
  });

  it('takes the host and the label from the registry, matching on host', async () => {
    _resetRegistryMemo();
    const { peers, source } = await resolvePeers(peerEnv(), {
      fetchImpl: registryFetch(registryBody()),
      now: 1,
    });
    assert.equal(source, 'registry');
    assert.equal(peers[0]!.label, "Samantha's library", 'the label comes from the one home for it');
    assert.equal(peers[0]!.url, 'https://padhard.test');
    assert.equal(peers[0]!.id, 'padhard', 'the local id is NOT rewritten — it is only a log handle');
  });

  it('an explicit `catalog` field wins over the host match', async () => {
    _resetRegistryMemo();
    const env = peerEnv({
      PEERS: JSON.stringify([
        { id: 'padhard', label: 'stale name', url: 'https://old-host.test', catalog: 'library2' },
      ]),
    });
    const { peers } = await resolvePeers(env, { fetchImpl: registryFetch(registryBody()), now: 1 });
    assert.equal(peers[0]!.url, 'https://padhard.test', 'a rehost follows the registry without a redeploy');
    assert.equal(peers[0]!.label, "Samantha's library");
  });

  it("⚠️ a peer that resolves onto THIS instance's own host is refused", async () => {
    _resetRegistryMemo();
    const env = peerEnv({
      PEERS: JSON.stringify([{ id: 'oops', label: 'me', url: 'https://x.test', catalog: 'library' }]),
    });
    const { peers, notes } = await resolvePeers(env, { fetchImpl: registryFetch(registryBody()), now: 1 });
    assert.equal(peers[0]!.url, 'https://x.test', 'the static value is kept rather than pointed at ourselves');
    assert.ok(notes.some((n) => /own host/.test(n)));
  });

  it('an unreachable registry falls back to the static values, and SAYS so', async () => {
    _resetRegistryMemo();
    const { peers, source, notes } = await resolvePeers(peerEnv(), {
      fetchImpl: (async () => {
        throw new Error('network');
      }) as unknown as typeof fetch,
      now: 1,
    });
    assert.equal(source, 'static');
    assert.equal(peers[0]!.url, 'https://padhard.test', 'routing is unchanged by a directory outage');
    assert.match(notes.join('\n'), /registry unreachable/);
  });

  it('⚠️ "not configured" and "unreachable" are different sentences', async () => {
    _resetRegistryMemo();
    const { notes } = await resolvePeers(peerEnv({ INDEX_URL: undefined }), {
      fetchImpl: registryFetch(registryBody()),
      now: 1,
    });
    assert.match(notes.join('\n'), /no INDEX_URL/);
    assert.ok(!/unreachable/.test(notes.join('\n')), 'an instance that never asked has no outage');
  });

  it('a refusal from the directory is a fallback, not an empty estate', async () => {
    _resetRegistryMemo();
    const { peers, source } = await resolvePeers(peerEnv(), {
      fetchImpl: registryFetch({ error: 'nope' }, { ok: false }),
      now: 1,
    });
    assert.equal(source, 'static');
    assert.equal(peers.length, 1);
  });

  it('no peers configured = no directory call at all', async () => {
    _resetRegistryMemo();
    let called = 0;
    const { peers, notes } = await resolvePeers(peerEnv({ PEERS: '[]' }), {
      fetchImpl: (async () => {
        called += 1;
        return { ok: true, async json() { return registryBody(); } } as unknown as Response;
      }) as typeof fetch,
      now: 1,
    });
    assert.deepEqual(peers, []);
    assert.deepEqual(notes, []);
    assert.equal(called, 0, 'a catalog that peers with nobody must not ask on every mutation');
  });

  it("the memo holds for the registry's own TTL, and caches the FAILURE too", async () => {
    _resetRegistryMemo();
    let called = 0;
    const failing = (async () => {
      called += 1;
      throw new Error('down');
    }) as unknown as typeof fetch;
    await resolvePeers(peerEnv(), { fetchImpl: failing, now: 1000 });
    await resolvePeers(peerEnv(), { fetchImpl: failing, now: 1000 + 60_000 });
    // ⚠️ Without caching the failure, an unreachable directory turns every
    // catalog mutation into a 2-second wait — an outage that presents as "the
    // site got slow", which is the hardest kind to diagnose.
    assert.equal(called, 1, 'the failure is memoised, not retried per mutation');
    await resolvePeers(peerEnv(), { fetchImpl: failing, now: 1000 + 11 * 60_000 });
    assert.equal(called, 2, "and it does expire — 10 minutes, the registry's own TTL");
  });
});

describe('pushToPeers — the registry notes travel with the results', () => {
  it('pushes to the REGISTRY-resolved host, and the notes come last', async () => {
    _resetRegistryMemo();
    const originalFetch = globalThis.fetch;
    const sent: string[] = [];
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('/api/catalogs')) {
        return { ok: true, async json() { return registryBody(); } } as unknown as Response;
      }
      sent.push(String(url));
      return { ok: true, async json() { return { received: 3 }; } } as unknown as Response;
    }) as typeof fetch;

    let results: Array<{ peer: string; result: string }>;
    try {
      results = await pushToPeers({
        DB: emptyDb(),
        INDEX_URL: 'https://index.test',
        SITE_ORIGIN: 'https://self.test',
        PEER_SELF_ID: 'sky',
        PEER_SELF_LABEL: "Sky's Library",
        PEER_TOKEN: FAKE_PEER_TOKEN,
        PEERS: JSON.stringify([
          { id: 'padhard', label: 'stale', url: 'https://old.test', catalog: 'library2' },
        ]),
      } as unknown as Env);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.deepEqual(sent, ['https://padhard.test/api/peer/push'], 'the rehost followed the registry');
    // ⚠️ results[0] must still be the FIRST PEER's outcome: every caller reads
    // it that way, and a diagnostic line that displaced it would be a report
    // about the reporter.
    assert.equal(results[0]!.peer, 'padhard');
    assert.match(results[0]!.result, /pushed 3 holdings/);
    assert.ok(results.slice(1).every((r) => r.peer === 'registry'));
  });
});
