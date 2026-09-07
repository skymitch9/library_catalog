/**
 * The worded 401 — this repo's half of an ESTATE-WIDE fix, 2026-09-06.
 *
 * `Board_Game_Catalog`'s KNOWN_ISSUES KI-6 recorded that its `requireAuth()`
 * answered the bare 27-byte `{"error":"unauthenticated"}` with no sentence,
 * and named this repo in as many words: *"`bookbuddy/library_catalog` has the
 * identical line … so this is an estate-wide shape, not a board-catalog
 * defect. A fix should land on both Workers in one pass or it becomes the
 * drift it is trying to remove."* It landed on three — the index Worker too.
 *
 * ⚠️ THE WORDS ARE NOT WRITTEN IN THIS REPO. `estateSignInRefusal()` lives in
 * `catalog-platform/packages/estate-auth/src/refusals.ts` and is materialised
 * into `packages/estate-auth/generated/` by `scripts/sync-estate-auth.mjs`.
 * That module's own suite pins how the sentence is COMPOSED; what this file
 * pins is what THIS Worker puts on the wire — that all three clauses arrive,
 * and that the machine-readable code did not move while words were added.
 *
 * ⚠️ Why the code matters as much as the words: `tools/estate-probes` asserts
 * `json.error === 'unauthenticated'` across BOTH instances' unauthenticated
 * edge (`library-worker.mjs`, `library2-worker.mjs`), and the apex's
 * `assets/estate-search.js` branches its status line on the same string. A
 * "nicer" code here breaks four things that have nothing to do with wording.
 *
 * No D1 is touched: `requireAuth()` returns before `upsertUserOnLogin`, so the
 * env stub below is never dereferenced.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppBindings, Env } from '../env.js';
import { requireAuth } from './auth.js';

/** Enough env to reach the verifier; DB is never read on this path. */
function envWith(): Env {
  return {
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    ENVIRONMENT: 'production',
  } as unknown as Env;
}

function app() {
  const a = new Hono<AppBindings>();
  a.use('/api/*', requireAuth());
  a.get('/api/anything', (c) => c.json({ reached: true }));
  return a;
}

describe('KI-6 (closed 2026-09-06): the tokenless 401 is a sentence, not a bare code', () => {
  it('still answers 401 with the FROZEN `unauthenticated` code', async () => {
    const res = await app().request('/api/anything', {}, envWith());
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'unauthenticated');
  });

  it('⚠️ `detail` carries all three clauses — what happened, what it needs, how to get it', async () => {
    const res = await app().request('/api/anything', {}, envWith());
    const body = (await res.json()) as { detail?: string };
    assert.equal(typeof body.detail, 'string');
    assert.match(body.detail ?? '', /not signed in/i, 'what happened');
    assert.match(body.detail ?? '', /library catalog/i, 'names the surface refused');
    assert.match(body.detail ?? '', /estate account/i, 'what it needs');
    assert.match(body.detail ?? '', /https:\/\/heygabi\.ai/, 'how to get it');
  });

  it('🔴 is never again the bare 27-byte body KI-6 measured', async () => {
    const res = await app().request('/api/anything', {}, envWith());
    const text = await res.text();
    assert.notEqual(text, '{"error":"unauthenticated"}');
    assert.ok(text.length > 27, `body is still bare (${text.length} bytes)`);
  });

  it('the clauses also travel as their own fields, for a client that renders them apart', async () => {
    const res = await app().request('/api/anything', {}, envWith());
    const body = (await res.json()) as { what?: string; needs?: string; how?: string };
    assert.equal(typeof body.what, 'string');
    assert.equal(typeof body.needs, 'string');
    assert.equal(typeof body.how, 'string');
  });

  it('⚠️ a MISCONFIGURED verifier is still a 500, never worded as a permission problem', async () => {
    // The standing rule the sibling repos state the same way: an outage or a
    // config error must not send somebody asking for access they already have.
    const a = new Hono<AppBindings>();
    a.use('/api/*', requireAuth());
    a.get('/api/anything', (c) => c.json({ reached: true }));
    const res = await a.request('/api/anything', {}, {} as unknown as Env);
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'misconfigured');
  });
});
