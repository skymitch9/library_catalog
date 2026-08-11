import { Hono } from 'hono';
import { createWatchSchema } from '@lc/core';
import {
  createWatch,
  deleteWatch,
  getWork,
  listOpenWatches,
  listWatchesForWork,
  resolveWatch,
} from '@lc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * "Needs my eyes." Migration 0040.
 *
 * Mounted at `/api` beside `aliasRoutes` and `relationRoutes` on the same
 * reasoning those two give: `/works/:id/watches` carries one more segment than
 * `/works/:id`, so nothing shadows anything.
 *
 * ## ⚠️ `editCatalog`, including to raise one — and `read` is not enough
 *
 * A watch is not a comment. It is an assertion that a row in the catalog may be
 * wrong, it appears as a mark on the collection, and it is the thing the owner
 * will work through later. Letting a `reader` raise one would make the owner's
 * to-do list writable by anybody with the URL. Resolving is the same capability
 * for the stronger version of the same reason: saying "I have checked this" is a
 * claim about the catalog's correctness.
 *
 * ## Every write answers with the whole list
 *
 * `aliases.ts` and `relations.ts` both do this, and the reason applies here
 * unchanged: the page redraws from the server instead of splicing its own guess
 * into local state, so a failed write cannot leave the screen showing something
 * the database does not hold.
 */
export const watchRoutes = new Hono<AppBindings>()
  /**
   * Everything currently open, across the catalog.
   *
   * The "let me work through these" read. ⚠️ Deliberately not paged: a watch
   * list long enough to need paging would mean the feature had stopped being a
   * short list of things to check and become a second backlog, and the right
   * response to that is to notice it, not to page it. `listOpenWatches` caps at
   * 200 as a guard, not as a page.
   */
  .get('/watches', requireCapability('read'), async (c) =>
    c.json({ watches: await listOpenWatches(c.env.DB) }),
  )

  .get('/works/:id/watches', requireCapability('read'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);
    return c.json({ watches: await listWatchesForWork(c.env.DB, id) });
  })

  .post('/works/:id/watches', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);

    const parsed = createWatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    // ⚠️ Checked before the insert rather than relying on the foreign key. The
    // FK would refuse it too, but as a 500 out of `onError` with a SQLite
    // message in it; a person typing a note deserves a 404.
    const work = await getWork(c.env.DB, id);
    if (!work) return c.json({ error: 'not_found' }, 404);

    await createWatch(c.env.DB, {
      workId: id,
      note: parsed.data.note,
      // From the verified token, never the body. "Who flagged this" is not
      // something a client gets to assert.
      raisedBy: c.get('user').id,
      // A person is pressing a button. `'auto'` is reserved for a research run
      // recording that it wrote a value it was unsure of — see migration 0040.
      raisedHow: 'human',
    });
    return c.json({ watches: await listWatchesForWork(c.env.DB, id) }, 201);
  })

  /** "I have looked at this." Resolved, not deleted — the history is the point. */
  .post('/works/:id/watches/:watchId/resolve', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    const watchId = Number(c.req.param('watchId'));
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(watchId) || watchId <= 0) {
      return c.json({ error: 'bad_request' }, 400);
    }
    const ok = await resolveWatch(c.env.DB, watchId, c.get('user').id);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json({ watches: await listWatchesForWork(c.env.DB, id) });
  })

  /**
   * Raised by mistake.
   *
   * ⚠️ Distinct from resolving, and both are offered. Resolving asserts somebody
   * looked and is a fact worth keeping; deleting says the mark should never have
   * existed. Collapsing them would make the history unreadable — every retracted
   * mistake would look like a question that was answered.
   */
  .delete('/works/:id/watches/:watchId', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    const watchId = Number(c.req.param('watchId'));
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(watchId) || watchId <= 0) {
      return c.json({ error: 'bad_request' }, 400);
    }
    const ok = await deleteWatch(c.env.DB, watchId);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json({ watches: await listWatchesForWork(c.env.DB, id) });
  });
