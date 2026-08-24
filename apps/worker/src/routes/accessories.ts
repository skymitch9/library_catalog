import { Hono } from 'hono';
import { createAccessorySchema, updateAccessorySchema } from '@lc/core';
import {
  AccessoryError,
  addAccessory,
  deleteAccessory,
  listAccessoriesForWork,
  updateAccessory,
} from '@lc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * The plushies, pins and art prints that came with a book.
 *
 * Mounted at `/api` beside `catalogRoutes`, `relationRoutes` and `aliasRoutes`, on
 * the reasoning `relations.ts` gives: `/works/:id/accessories` carries one more
 * segment than `/works/:id`, so nothing shadows anything, and one feature is one
 * file.
 *
 * ## ⚠️ There is no collection-wide read here, deliberately
 *
 * *"we don't need ti publish that count on the main page, just keep it each
 * book."* — the owner, 2026-08-10. Every route below is scoped to one work.
 * Adding a `GET /api/accessories` that the grid could count would be the feature
 * the owner asked not to have, arriving by accident.
 *
 * Every write answers with the whole list, like `aliases.ts` and `relations.ts`,
 * so the panel redraws from the server rather than splicing its own guess into
 * local state.
 */
export const accessoryRoutes = new Hono<AppBindings>()
  .get('/works/:id/accessories', requireCapability('read'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);
    return c.json({ accessories: await listAccessoriesForWork(c.env.DB, id) });
  })

  .post('/works/:id/accessories', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);

    const parsed = createAccessorySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    try {
      await addAccessory(c.env.DB, id, parsed.data);
    } catch (err) {
      if (err instanceof AccessoryError) {
        return c.json({ error: 'bad_request', detail: err.message }, err.status);
      }
      throw err;
    }
    return c.json({ accessories: await listAccessoriesForWork(c.env.DB, id) }, 201);
  })

  /**
   * Change one.
   *
   * ⚠️ A PATCH, not a PUT, and `updateAccessorySchema` is `.partial()` — ticking
   * "digital" must not clear the note saying which tier it came in. Same rule as
   * `PATCH /api/copies/:id`.
   */
  .patch('/works/:id/accessories/:accessoryId', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    const accessoryId = Number(c.req.param('accessoryId'));
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(accessoryId) || accessoryId <= 0) {
      return c.json({ error: 'bad_request' }, 400);
    }

    const parsed = updateAccessorySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    try {
      const updated = await updateAccessory(c.env.DB, accessoryId, parsed.data);
      if (!updated) return c.json({ error: 'not_found' }, 404);
      // Scoped to the work as well as the id, so a stale page cannot edit a row
      // belonging to a different book by guessing a number — the rule
      // `deleteWorkAlias` follows.
      if (updated.workId !== id) return c.json({ error: 'not_found' }, 404);
    } catch (err) {
      if (err instanceof AccessoryError) {
        return c.json({ error: 'bad_request', detail: err.message }, err.status);
      }
      throw err;
    }
    return c.json({ accessories: await listAccessoriesForWork(c.env.DB, id) });
  })

  .delete('/works/:id/accessories/:accessoryId', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    const accessoryId = Number(c.req.param('accessoryId'));
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(accessoryId) || accessoryId <= 0) {
      return c.json({ error: 'bad_request' }, 400);
    }
    // Scoped by BOTH work id and accessory id, so a request naming the wrong
    // work cannot delete another book's accessory row.
    const ok = await deleteAccessory(c.env.DB, id, accessoryId);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json({ accessories: await listAccessoriesForWork(c.env.DB, id) });
  });
