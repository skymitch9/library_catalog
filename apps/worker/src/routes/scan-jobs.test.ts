/**
 * Capability-gate regression test for the scan-jobs routes.
 *
 * ⚠️ Closes a NAMED gap from the 2026-08-16 testing audit: this repo's own
 * `/api/scan-jobs/shelf` and `/single` were found gated on `runResearch`
 * instead of the (then-new) `scanPhoto` capability — see the `⚠️` comment on
 * both routes in `scan-jobs.ts` and on `scanPhoto` in
 * `packages/core/src/capabilities.ts`. `capabilities.test.ts` pins the ROLE
 * MATRIX (who may hold `scanPhoto` vs `runResearch`) but nothing anywhere
 * pinned which capability string these ROUTES actually check — a mix-up
 * between two same-shaped capabilities is exactly the class of bug a
 * matrix-only test cannot see.
 *
 * These tests drive the real Hono routes end-to-end (no mocking of
 * `scanJobRoutes` or `requireCapability`) and read the capability name back
 * out of the 403 body that `capabilityDenied` (auth.ts) puts on the wire —
 * the same field a real client would see. Bodies are deliberately empty/
 * malformed so the "allowed past the gate" assertions 400 on schema
 * validation before any D1 access, and env can stay a stub: nothing under
 * test touches `c.env.DB` on either path exercised here.
 *
 * ⚠️ `scanPhoto` and `runResearch` hold the IDENTICAL role set today
 * (`['owner','admin','moderator']`), by design — see the comment on
 * `runResearch` in capabilities.ts. That means a role-only black-box check
 * (does a contributor get refused?) cannot tell the two capabilities apart:
 * a contributor is refused either way. What DOES tell them apart is the
 * `capability` field itself, which is why every assertion here is against
 * that field's exact value, not just the status code.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser } from '@lc/core';
import type { AppBindings, Env } from '../env.js';
import { scanJobRoutes } from './scan-jobs.js';

function userWith(role: AppUser['role']): AppUser {
  return {
    id: 1,
    email: 'test@example.com',
    firebaseUid: null,
    displayName: null,
    reviewName: null,
    photoUrl: null,
    role,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * A bare app carrying only scan-jobs, with a fake `requireAuth` that plants
 * the requested role and nothing else — `requireCapability` is real,
 * imported by `scan-jobs.ts` itself, not swapped out here.
 */
function appAs(role: AppUser['role']) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('user', userWith(role));
    await next();
  });
  app.route('/', scanJobRoutes);
  return app;
}

// Never dereferenced: every path below either 403s inside `requireCapability`
// (before the handler runs) or 400s on `safeParse` (before any DB call).
const stubEnv = {} as unknown as Env;

async function postJson(role: AppUser['role'], path: string, body: unknown) {
  return appAs(role).request(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    stubEnv,
  );
}

describe('scan-jobs capability gates — behaviour, not just the matrix', () => {
  describe('POST /shelf and /single require scanPhoto specifically', () => {
    for (const path of ['/shelf', '/single']) {
      it(`${path}: a contributor (scanBarcode yes, scanPhoto no) is refused BY THAT NAME`, async () => {
        const res = await postJson('contributor', path, {});
        assert.equal(res.status, 403);
        const body = (await res.json()) as { capability?: string };
        // The regression this guards: gating on 'runResearch' also 403s a
        // contributor, so the status code alone would not catch it — the
        // wire-level capability name is the only thing that does.
        assert.equal(body.capability, 'scanPhoto');
      });

      it(`${path}: a moderator clears the gate (fails only on the empty body, not on role)`, async () => {
        const res = await postJson('moderator', path, {});
        assert.notEqual(res.status, 403);
        assert.equal(res.status, 400); // photoSchema rejects the empty body — proof the handler ran
      });
    }
  });

  describe('POST /barcode requires scanBarcode, the free/cheap split', () => {
    it('a member (no scan capability at all) is refused as scanBarcode', async () => {
      const res = await postJson('member', '/barcode', {});
      assert.equal(res.status, 403);
      const body = (await res.json()) as { capability?: string };
      assert.equal(body.capability, 'scanBarcode');
    });

    it('a contributor clears the gate (fails only on the empty body, not on role)', async () => {
      const res = await postJson('contributor', '/barcode', {});
      assert.notEqual(res.status, 403);
      assert.equal(res.status, 400); // barcodeSchema rejects the empty body — proof the handler ran
    });
  });

  describe('the queue routes (GET /, GET /:id) require editCatalog', () => {
    it('a member is refused as editCatalog', async () => {
      const res = await appAs('member').request('/', {}, stubEnv);
      assert.equal(res.status, 403);
      const body = (await res.json()) as { capability?: string };
      assert.equal(body.capability, 'editCatalog');
    });
  });
});
