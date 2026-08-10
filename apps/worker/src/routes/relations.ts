import { Hono } from 'hono';
import { createWorkRelationSchema } from '@lc/core';
import {
  RelationError,
  createWorkRelation,
  deleteWorkRelation,
  listRelatedWorks,
} from '@lc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Related books — same universe, companion, omnibus, reading order.
 *
 * Mounted at `/api` beside `catalogRoutes` rather than folded into it: these
 * three routes are one feature and `catalog.ts` is already the longest route
 * file in the app. Nothing collides — `/works/:id/relations` has one more
 * segment than `/works/:id`.
 *
 * ⚠️ Every link here is typed by a person, on purpose. No external source knows
 * that *The Divine Dungeon Complete Series* contains *Dungeon Born*, or that
 * nine of this house's Sanderson novellas share a universe; migration 0004 has
 * the measured reasoning. A feature that required an identifier to express those
 * would never have fired once on this catalog.
 */
export const relationRoutes = new Hono<AppBindings>()
  .get('/works/:id/relations', requireCapability('read'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);
    return c.json({ related: await listRelatedWorks(c.env.DB, id) });
  })

  /**
   * Link this book to another.
   *
   * Answers with the whole list rather than the created row, so the page redraws
   * from the server's idea of the truth. The alternative — splicing the new link
   * into local state — would show a directional relation from the end the client
   * guessed rather than the end it was stored at, and `contains` is exactly the
   * relation where that is a visible lie.
   */
  .post('/works/:id/relations', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);

    const parsed = createWorkRelationSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    try {
      await createWorkRelation(c.env.DB, id, parsed.data);
    } catch (err) {
      if (err instanceof RelationError) {
        return c.json({ error: 'bad_request', detail: err.message }, err.status as 400 | 404 | 500);
      }
      throw err;
    }
    return c.json({ related: await listRelatedWorks(c.env.DB, id) }, 201);
  })

  .delete('/relations/:relationId', requireCapability('editCatalog'), async (c) => {
    const relationId = Number(c.req.param('relationId'));
    if (!Number.isInteger(relationId) || relationId <= 0) {
      return c.json({ error: 'bad_request' }, 400);
    }
    const ok = await deleteWorkRelation(c.env.DB, relationId);
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });
