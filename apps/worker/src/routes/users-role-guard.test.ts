/**
 * Last-owner guard on the role-write path (2026-08 audit HIGH,
 * `apps/worker/src/routes/users.ts:90`).
 *
 * The bug: the last-owner guard only fired when the actor was editing THEMSELVES
 * (`userId === actor.id`). Neither role-write route inspected the target's
 * current role, so an `admin` could demote every *other* `owner` — reaching
 * `countOwners() == 0`, after which no role in the app can ever mint an `owner`
 * again (an admin cannot grant `owner`).
 *
 * The fix moves the guard into `setUserRole` (the one role-write path) and keys
 * it on the TARGET's current role: any write that would demote the final owner
 * is refused, whoever the actor is.
 *
 * These tests exercise the route with a stubbed D1 that reports the target as an
 * `owner` and the owner count, and assert:
 *   - admin demoting the LAST owner (count 1) → 400 (was 200 before the fix);
 *   - admin demoting an owner when TWO owners remain → allowed;
 *   - promoting/keeping owner is never blocked.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppBindings, Env } from '../env.js';
import { userRoutes } from './users.js';

type Role = 'owner' | 'admin' | 'member' | 'guest' | 'pending' | 'contributor';

/**
 * D1 stub for the role-write path. `targetRole` is what the target user's row
 * currently holds; `ownerCount` is what `countOwners()` returns. The UPDATE and
 * change-log writes are no-ops, and the post-write re-read returns the row at
 * its NEW role.
 */
function stubDb(targetRole: Role, ownerCount: number, newRole: Role) {
  const baseRow = {
    id: 2,
    email: 'target@example.test',
    firebase_uid: 'uid-target',
    display_name: 'Target',
    review_name: null,
    photo_url: null,
    first_seen_at: '2026-01-01 00:00:00',
    approved_at: '2026-01-01 00:00:00',
    approved_by: 1,
  };
  let written = false;
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first() {
          if (sql.includes("COUNT(*) AS n FROM app_user WHERE role = 'owner'")) {
            return { n: ownerCount };
          }
          if (sql.includes('FROM app_user WHERE id = ?')) {
            // before-read: current role; after-read: new role
            return { ...baseRow, role: written ? newRole : targetRole };
          }
          return null;
        },
        async run() {
          written = true;
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
    async batch(_stmts: unknown[]) {
      written = true;
      return [];
    },
  } as unknown as D1Database;
}

function envWith(db: D1Database): Env {
  return { DB: db, ESTATE_APP: 'library' } as unknown as Env;
}

function app(actorRole: Role) {
  const a = new Hono<AppBindings>();
  a.use('*', async (c, next) => {
    c.set('user', {
      id: 1,
      email: 'actor@example.test',
      displayName: 'Actor',
      role: actorRole,
    } as never);
    await next();
  });
  a.route('/api', userRoutes);
  return a;
}

async function patchRole(actorRole: Role, targetRole: Role, ownerCount: number, newRole: Role) {
  const a = app(actorRole);
  return a.request(
    '/api/users/2/role',
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    },
    envWith(stubDb(targetRole, ownerCount, newRole)),
  );
}

describe('PATCH /api/users/:id/role — last-owner guard on the TARGET', () => {
  it('refuses an admin demoting the last owner (count 1) with 400', async () => {
    const res = await patchRole('admin', 'owner', 1, 'member');
    assert.equal(res.status, 400);
    const body = (await res.json()) as { detail?: string };
    assert.match(body.detail ?? '', /last owner/i);
  });

  it('allows an admin demoting an owner while two owners remain', async () => {
    const res = await patchRole('admin', 'owner', 2, 'member');
    assert.equal(res.status, 200);
  });

  it('never blocks a write that keeps/creates an owner', async () => {
    // owner promoting: target is member, new role owner — guard must not fire.
    const res = await patchRole('owner', 'member', 1, 'owner');
    assert.equal(res.status, 200);
  });
});
