import { Hono } from 'hono';
import {
  COLLECTION_PAGE_SIZE,
  createCopySchema,
  createEditionSchema,
  createWorkSchema,
  setReadStateSchema,
  updateWorkSchema,
} from '@lc/core';
import {
  createCopy,
  createEdition,
  createWork,
  deleteCopy,
  deleteWork,
  getReadState,
  getWork,
  listCollection,
  listCopiesForWork,
  listEditionsForWork,
  setReadState,
  updateWork,
} from '@lc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * The catalog: works, their editions, the copies on the shelf, and read-state.
 *
 * Routes are thin — parse, authorise, delegate to `@lc/db`, serialise. Anything
 * that makes a decision belongs in `packages/`, so the CLI can use it too.
 */
export const catalogRoutes = new Hono<AppBindings>()
  .get('/collection', requireCapability('read'), async (c) => {
    const page = Math.max(0, Number(c.req.query('page') ?? '0') || 0);
    const { rows, total } = await listCollection(c.env.DB, {
      q: c.req.query('q'),
      series: c.req.query('series'),
      format: c.req.query('format'),
      status: c.req.query('status'),
      // Fixed server-side. A client asking for 5,000 would be handed the exact
      // payload paging exists to prevent.
      limit: COLLECTION_PAGE_SIZE,
      offset: page * COLLECTION_PAGE_SIZE,
    });
    return c.json({ rows, total, page, pageSize: COLLECTION_PAGE_SIZE });
  })

  .get('/works/:id', requireCapability('read'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

    const work = await getWork(c.env.DB, id);
    if (!work) return c.json({ error: 'not_found' }, 404);

    const user = c.get('user');
    const [editions, copies, reading] = await Promise.all([
      listEditionsForWork(c.env.DB, id),
      listCopiesForWork(c.env.DB, id),
      getReadState(c.env.DB, id, user.id),
    ]);

    return c.json({ work, editions, copies, reading });
  })

  .post('/works', requireCapability('editCatalog'), async (c) => {
    const parsed = createWorkSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    return c.json({ work: await createWork(c.env.DB, parsed.data) }, 201);
  })

  .patch('/works/:id', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

    const parsed = updateWorkSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    const work = await updateWork(c.env.DB, id, parsed.data);
    if (!work) return c.json({ error: 'not_found' }, 404);
    return c.json({ work });
  })

  .delete('/works/:id', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);
    const ok = await deleteWork(c.env.DB, id);
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  })

  .post('/editions', requireCapability('editCatalog'), async (c) => {
    const parsed = createEditionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    return c.json({ edition: await createEdition(c.env.DB, parsed.data) }, 201);
  })

  .post('/copies', requireCapability('editCatalog'), async (c) => {
    const parsed = createCopySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    return c.json({ copy: await createCopy(c.env.DB, parsed.data) }, 201);
  })

  .delete('/copies/:id', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);
    const ok = await deleteCopy(c.env.DB, id);
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  })

  /**
   * Read-state is per-person, so a `reader` may write their own and only their
   * own — the user id comes from the verified token, never from the body.
   *
   * There is no rating field here. Ratings go to Firestore through
   * /api/reviews/:workId/draft so one review serves both catalogs.
   */
  .put('/works/:id/reading', requireCapability('trackReading'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

    const parsed = setReadStateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    const user = c.get('user');
    return c.json({ reading: await setReadState(c.env.DB, id, user.id, parsed.data) });
  });
