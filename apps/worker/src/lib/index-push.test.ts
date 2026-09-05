/**
 * `decidePushForStaleness` — the data-aware staleness gate (2026-08-15 fix
 * for the "Boba Fett still Part of Disney" class: backfill scripts write D1
 * directly, bypassing every mutation route, and a clock-only backstop cannot
 * tell that happened). Pure function, no D1/fetch, so these pin the decision
 * table directly rather than standing up a fake Worker environment.
 *
 * …and, from 2026-09-05, `resolveIndexSource` plus the two live callers with
 * `fetch` and D1 faked. The pure function cannot pin the two things the
 * federation bug actually lived in — WHICH URL is PUT and WHICH health key is
 * read — so those get a fake environment, deliberately, small as it is.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  decidePushForStaleness,
  pushIndexIfStale,
  pushIndexSnapshot,
  resolveIndexSource,
  type StalenessCheckInput,
} from './index-push.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.parse('2026-08-15T12:00:00.000Z');

function input(overrides: Partial<StalenessCheckInput> = {}): StalenessCheckInput {
  return {
    rows: 500,
    pushedAtIso: new Date(NOW - HOUR_MS).toISOString(), // pushed 1h ago
    latestSourceUpdateMs: NOW - 2 * HOUR_MS, // last data change 2h ago — before the push
    nowMs: NOW,
    maxAgeMs: DAY_MS,
    ...overrides,
  };
}

test('skips when the index is fresh and nothing has changed since the last push', () => {
  const decision = decidePushForStaleness(input());
  assert.equal(decision.push, false);
});

test('pushes when the index reports zero rows', () => {
  const decision = decidePushForStaleness(input({ rows: 0 }));
  assert.equal(decision.push, true);
  assert.match(decision.reason, /zero rows/);
});

test('pushes when rows is null/undefined (health shape missing the source)', () => {
  assert.equal(decidePushForStaleness(input({ rows: null })).push, true);
  assert.equal(decidePushForStaleness(input({ rows: undefined })).push, true);
});

test('pushes when pushed_at is missing', () => {
  const decision = decidePushForStaleness(input({ pushedAtIso: null }));
  assert.equal(decision.push, true);
  assert.match(decision.reason, /pushed_at/);
});

test('pushes when pushed_at does not parse', () => {
  const decision = decidePushForStaleness(input({ pushedAtIso: 'not-a-date' }));
  assert.equal(decision.push, true);
  assert.match(decision.reason, /pushed_at/);
});

test('pushes when the last push is older than maxAgeMs (the original clock check)', () => {
  const decision = decidePushForStaleness(
    input({ pushedAtIso: new Date(NOW - 25 * HOUR_MS).toISOString(), latestSourceUpdateMs: null }),
  );
  assert.equal(decision.push, true);
  assert.match(decision.reason, /old/);
});

test('⚠️ THE FIX: pushes when data moved after the last push, even though the push is young', () => {
  // A push landed 5 minutes ago (well inside the 24h tolerance), but a
  // backfill script touched `work` 1 minute ago — after that push. The old
  // clock-only check would call this fresh and skip; that is exactly the
  // incident (Boba Fett stayed stale until someone triggered a mutation by
  // hand). The fix must push here.
  const decision = decidePushForStaleness(
    input({
      pushedAtIso: new Date(NOW - 5 * 60_000).toISOString(),
      latestSourceUpdateMs: NOW - 60_000,
    }),
  );
  assert.equal(decision.push, true);
  assert.match(decision.reason, /source data changed/);
});

test('does not push when data last changed BEFORE the last push', () => {
  const decision = decidePushForStaleness(
    input({
      pushedAtIso: new Date(NOW - 60_000).toISOString(),
      latestSourceUpdateMs: NOW - 5 * 60_000,
    }),
  );
  assert.equal(decision.push, false);
});

test('does not push when data changed exactly at the push instant (not strictly after)', () => {
  const pushedAt = NOW - 60_000;
  const decision = decidePushForStaleness(
    input({ pushedAtIso: new Date(pushedAt).toISOString(), latestSourceUpdateMs: pushedAt }),
  );
  assert.equal(decision.push, false);
});

test('treats a null latestSourceUpdateMs (empty work table) as "nothing to compare" rather than forcing a push', () => {
  const decision = decidePushForStaleness(input({ latestSourceUpdateMs: null }));
  assert.equal(decision.push, false);
});

/* ────────────────────────────────────────────────────────────────────────────
 * The SOURCE — federation phase 2, 2026-09-05. Owner: *"in the universe and
 * series tab it's not pulling Padhard library"*. Two instances push into one
 * index and each must land under its OWN source.
 * ──────────────────────────────────────────────────────────────────────────── */

test('resolveIndexSource: main pushes as `library`', () => {
  assert.equal(resolveIndexSource('library'), 'library');
});

test('resolveIndexSource: padhard pushes as `library2`, NOT as library', () => {
  assert.equal(resolveIndexSource('library2'), 'library2');
});

test('resolveIndexSource: unset/blank falls back to `library` (matches resolveEstateApp)', () => {
  assert.equal(resolveIndexSource(undefined), 'library');
  assert.equal(resolveIndexSource(''), 'library');
  assert.equal(resolveIndexSource('   '), 'library');
  assert.equal(resolveIndexSource(' library2 '), 'library2'); // trimmed, not refused
});

test('resolveIndexSource: a future third instance federates with no code change', () => {
  assert.equal(resolveIndexSource('library3'), 'library3');
});

test('⚠️ resolveIndexSource: anything not a plain path segment is REFUSED, not pushed', () => {
  // This value is interpolated into a URL path. `null` means "push nothing and
  // say why" — the inert direction, this module's rule everywhere.
  for (const bad of ['../games', 'Library', 'lib rary', 'library/2', '2library', 'a'.repeat(33)]) {
    assert.equal(resolveIndexSource(bad), null, `${bad} must not resolve to a source`);
  }
});

/* The two live callers, with fetch and D1 faked — what the pure function above
 * cannot pin: which URL is actually PUT, and which health key is actually read. */

interface Captured {
  url: string;
  init?: RequestInit;
}

function fakeEnv(overrides: Record<string, unknown> = {}) {
  const db = {
    prepare() {
      return {
        all: async () => ({
          results: [
            {
              id: 7,
              title: 'A Book',
              authors: 'Someone',
              series: null,
              series_index_sort: null,
              first_published: null,
              cover_url: null,
            },
          ],
        }),
        first: async () => ({ latest: '2026-09-05 00:00:00' }),
      };
    },
  };
  return {
    INDEX_URL: 'https://index.test',
    INDEX_PUSH_TOKEN: 'not-a-real-token',
    SITE_ORIGIN: 'https://padhard.test',
    DB: db,
    ...overrides,
  };
}

/** Swap `globalThis.fetch`, capture calls, always restore. */
async function withFetch(
  handler: (url: string) => Response,
  body: (calls: Captured[]) => Promise<void>,
) {
  const calls: Captured[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url);
  }) as typeof globalThis.fetch;
  try {
    await body(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test('pushIndexSnapshot PUTs /api/push/library2 when ESTATE_APP is library2', async () => {
  await withFetch(
    () => new Response('{}', { status: 200 }),
    async (calls) => {
      const result = await pushIndexSnapshot(
        fakeEnv({ ESTATE_APP: 'library2' }) as never,
      );
      assert.equal(calls[0]?.url, 'https://index.test/api/push/library2');
      assert.equal(calls[0]?.init?.method, 'PUT');
      assert.deepEqual(result, { pushed: 1, source: 'library2' });
    },
  );
});

test('pushIndexSnapshot PUTs /api/push/library on the main instance', async () => {
  await withFetch(
    () => new Response('{}', { status: 200 }),
    async (calls) => {
      const result = await pushIndexSnapshot(fakeEnv({ ESTATE_APP: 'library' }) as never);
      assert.equal(calls[0]?.url, 'https://index.test/api/push/library');
      assert.deepEqual(result, { pushed: 1, source: 'library' });
    },
  );
});

test('pushIndexSnapshot refuses to push at all when ESTATE_APP is unusable', async () => {
  await withFetch(
    () => new Response('{}', { status: 200 }),
    async (calls) => {
      const result = await pushIndexSnapshot(fakeEnv({ ESTATE_APP: '../games' }) as never);
      assert.equal(calls.length, 0, 'nothing may be sent');
      assert.match((result as { skipped: string }).skipped, /not a usable index source/);
    },
  );
});

test('🔴 the backstop reads ITS OWN health key — padhard is not made fresh by main’s rows', async () => {
  // The index is fresh for `library` and has never heard from `library2`.
  // Before the fix this read `sources.library` unconditionally and padhard
  // would have skipped its own FIRST push, forever.
  const health = JSON.stringify({
    sources: {
      library: { rows: 448, pushed_at: new Date().toISOString() },
      library2: { rows: 0, pushed_at: null },
    },
  });
  await withFetch(
    (url) => new Response(url.endsWith('/api/health') ? health : '{}', { status: 200 }),
    async (calls) => {
      const result = await pushIndexIfStale(fakeEnv({ ESTATE_APP: 'library2' }) as never);
      assert.deepEqual(result, { pushed: 1, source: 'library2' });
      assert.equal(calls.at(-1)?.url, 'https://index.test/api/push/library2');
    },
  );
});

test('the backstop still skips when THIS source is genuinely fresh', async () => {
  const health = JSON.stringify({
    sources: {
      library: { rows: 0, pushed_at: null }, // main is stale; irrelevant here
      library2: { rows: 12, pushed_at: new Date().toISOString() },
    },
  });
  await withFetch(
    () => new Response(health, { status: 200 }),
    async (calls) => {
      const result = await pushIndexIfStale(fakeEnv({ ESTATE_APP: 'library2' }) as never);
      assert.match((result as { skipped: string }).skipped, /source library2/);
      assert.equal(calls.length, 1, 'health only — no push');
    },
  );
});
