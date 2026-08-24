/**
 * DELETE /works/:id/accessories/:accessoryId must be scoped by BOTH work and
 * accessory id (2026-08 audit HIGH, `apps/worker/src/routes/accessories.ts:96`).
 *
 * The bug: the DELETE keyed on the accessory id ALONE — the `:id` work segment
 * was never used as a scope — so a request naming the wrong work destroyed
 * another book's accessory row and answered 200. The fix threads the work id
 * into `deleteAccessory`, which now deletes `WHERE id = ? AND work_id = ?`.
 *
 * The stub models one accessory row (id 5, work 10). A DELETE whose bound
 * params match both id and work_id reports one change; a mismatch reports zero.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppBindings, Env } from '../env.js';
import { accessoryRoutes } from './accessories.js';

const ROW = { id: 5, work_id: 10 };

function stubDb() {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async run() {
          // DELETE FROM book_accessory WHERE id = ? AND work_id = ?
          if (/DELETE FROM book_accessory/i.test(sql)) {
            const [id, workId] = bound as [number, number];
            const hit = id === ROW.id && workId === ROW.work_id;
            return { meta: { changes: hit ? 1 : 0 } };
          }
          return { meta: { changes: 0 } };
        },
        async all() {
          // listAccessoriesForWork after the delete
          return { results: [] };
        },
        async first() {
          return null;
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function app() {
  const a = new Hono<AppBindings>();
  a.use('*', async (c, next) => {
    c.set('user', { id: 1, role: 'owner' } as never);
    await next();
  });
  a.route('/api', accessoryRoutes);
  return a;
}

function env(): Env {
  return { DB: stubDb(), ESTATE_APP: 'library' } as unknown as Env;
}

describe('DELETE /works/:id/accessories/:accessoryId — work scope', () => {
  it('deletes when the accessory belongs to the named work', async () => {
    const res = await app().request('/api/works/10/accessories/5', { method: 'DELETE' }, env());
    assert.equal(res.status, 200);
  });

  it('404s (deletes nothing) when the accessory belongs to a DIFFERENT work', async () => {
    // Accessory 5 lives on work 10; naming work 99 must not destroy it.
    const res = await app().request('/api/works/99/accessories/5', { method: 'DELETE' }, env());
    assert.equal(res.status, 404);
  });
});
