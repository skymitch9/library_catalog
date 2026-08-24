/**
 * `GET /api/gabi/memory` and `PUT /api/gabi/memory` — the shared conversation
 * memory endpoint.
 *
 * Four things that would be silently wrong:
 *
 *   1. **The bearer gate fails CLOSED.** Unset secret = 503, wrong/absent = 401.
 *   2. **An unknown Firebase UID is a 404**, not an empty record — the Discord
 *      bot must distinguish "nobody here" from "nothing remembered yet".
 *   3. **A malformed PUT body is 400**, never a 500 from a failed parse.
 *   4. **The route is mounted and reachable** at the expected path.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppBindings, Env } from '../env.js';
import { gabiMemoryRoutes } from './gabi-memory.js';

const TOKEN = 'test-discord-bearer';

function app() {
  const a = new Hono<AppBindings>();
  a.route('/api/gabi/memory', gabiMemoryRoutes);
  return a;
}

/**
 * D1 stub answering the queries this endpoint makes.
 * `user` controls what `findUserByFirebaseUid` returns.
 * `record` controls what `loadPanelConversation` returns from gabi_conversation.
 */
function stubDb(
  user: { id: number; firebase_uid: string } | null = null,
  record: string | null = null,
) {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first() {
          if (sql.includes('WHERE firebase_uid = ?')) {
            return user && user.firebase_uid === bound[0]
              ? {
                  id: user.id,
                  email: 'someone@example.test',
                  firebase_uid: user.firebase_uid,
                  display_name: 'Someone',
                  review_name: null,
                  photo_url: null,
                  role: 'member',
                  first_seen_at: '2026-01-01 00:00:00',
                  approved_at: '2026-01-01 00:00:00',
                }
              : null;
          }
          if (sql.includes('FROM gabi_conversation WHERE storage_key = ?')) {
            return record ? { record } : null;
          }
          return null;
        },
        async run() {
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function envWith(overrides: Partial<Env> = {}): Env {
  return {
    DB: stubDb(),
    ESTATE_APP_TOKEN_DISCORD: TOKEN,
    ESTATE_APP: 'library',
    ...overrides,
  } as unknown as Env;
}

function bearerHeader(token = TOKEN) {
  return { Authorization: `Bearer ${token}` };
}

// ── 1. the bearer gate ──────────────────────────────────────────────────────

describe('the bearer gate fails closed', () => {
  it('GET without auth → 401', async () => {
    const res = await app().request('/api/gabi/memory?person=abc12345678', {}, envWith());
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'unauthenticated');
  });

  it('PUT without auth → 401', async () => {
    const res = await app().request(
      '/api/gabi/memory',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ person: 'abc12345678', turns: [], updatedAt: null }),
      },
      envWith(),
    );
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'unauthenticated');
  });

  it('GET with wrong bearer → 401', async () => {
    const res = await app().request(
      '/api/gabi/memory?person=abc12345678',
      { headers: bearerHeader('wrong-value') },
      envWith(),
    );
    assert.equal(res.status, 401);
  });

  it('GET with token unset → 503', async () => {
    const res = await app().request(
      '/api/gabi/memory?person=abc12345678',
      { headers: bearerHeader() },
      envWith({ ESTATE_APP_TOKEN_DISCORD: undefined }),
    );
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'not_configured');
  });
});

// ── 2. unknown user ─────────────────────────────────────────────────────────

describe('unknown Firebase UID → 404', () => {
  it('GET with auth + unknown user → 404', async () => {
    const db = stubDb(null);
    const res = await app().request(
      '/api/gabi/memory?person=unknownuid1234',
      { headers: bearerHeader() },
      envWith({ DB: db }),
    );
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'unknown_user');
  });

  it('PUT with auth + unknown user → 404', async () => {
    const db = stubDb(null);
    const res = await app().request(
      '/api/gabi/memory',
      {
        method: 'PUT',
        headers: { ...bearerHeader(), 'content-type': 'application/json' },
        body: JSON.stringify({ person: 'unknownuid1234', turns: [], updatedAt: null }),
      },
      envWith({ DB: db }),
    );
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'unknown_user');
  });
});

// ── 3. malformed body ───────────────────────────────────────────────────────

describe('malformed body → 400', () => {
  it('GET without person param → 400', async () => {
    const res = await app().request(
      '/api/gabi/memory',
      { headers: bearerHeader() },
      envWith(),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'bad_request');
  });

  it('PUT with missing person → 400', async () => {
    const db = stubDb({ id: 1, firebase_uid: 'validuid12345678' });
    const res = await app().request(
      '/api/gabi/memory',
      {
        method: 'PUT',
        headers: { ...bearerHeader(), 'content-type': 'application/json' },
        body: JSON.stringify({ turns: [] }),
      },
      envWith({ DB: db }),
    );
    assert.equal(res.status, 400);
  });

  it('PUT with non-array turns → 400', async () => {
    const db = stubDb({ id: 1, firebase_uid: 'validuid12345678' });
    const res = await app().request(
      '/api/gabi/memory',
      {
        method: 'PUT',
        headers: { ...bearerHeader(), 'content-type': 'application/json' },
        body: JSON.stringify({ person: 'validuid12345678', turns: 'not-an-array' }),
      },
      envWith({ DB: db }),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string; detail: string };
    assert.equal(body.error, 'bad_request');
    assert.match(body.detail, /turns/i);
  });
});

// ── 4. happy path ───────────────────────────────────────────────────────────

describe('the route exists and returns data', () => {
  it('GET with auth + known user → 200 with empty turns when nothing stored', async () => {
    const db = stubDb({ id: 42, firebase_uid: 'knownuid12345678' });
    const res = await app().request(
      '/api/gabi/memory?person=knownuid12345678',
      { headers: bearerHeader() },
      envWith({ DB: db }),
    );
    assert.equal(res.status, 200);
    // ⚠️ The Discord caller reads `{ ok, record }` — the shape this must return.
    // (It previously returned `{ turns, updatedAt }`, which the caller ignored,
    // so the shared memory was silently invisible on the Discord side.)
    const body = (await res.json()) as {
      ok: boolean;
      record: { turns: unknown[]; updatedAt: unknown };
    };
    assert.equal(body.ok, true);
    assert.deepEqual(body.record.turns, []);
    assert.equal(body.record.updatedAt, null);
  });

  it('PUT with auth + known user + valid body → 200 { ok: true }', async () => {
    const db = stubDb({ id: 42, firebase_uid: 'knownuid12345678' });
    const res = await app().request(
      '/api/gabi/memory',
      {
        method: 'PUT',
        headers: { ...bearerHeader(), 'content-type': 'application/json' },
        body: JSON.stringify({
          person: 'knownuid12345678',
          turns: [
            { role: 'user', text: 'hello', at: Date.now() },
            { role: 'assistant', text: 'hi there', at: Date.now() },
          ],
          updatedAt: new Date().toISOString(),
        }),
      },
      envWith({ DB: db }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
  });
});
