import { Hono } from 'hono';
import { createWorkAliasSchema } from '@lc/core';
import { AliasError, addWorkAlias, deleteWorkAlias, listAliasesForWork } from '@lc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Other names a book answers to.
 *
 * Mounted at `/api` beside `catalogRoutes` and `relationRoutes`, on the same
 * reasoning `relations.ts` gives: `/works/:id/aliases` carries one more segment
 * than `/works/:id`, so nothing shadows anything, and one feature is one file.
 *
 * ## ⚠️ Why these routes exist at all
 *
 * `work_alias` shipped in migration 0001 and nothing wrote to it for three
 * phases. On 2026-08-10 the Open Library backfill missed five *He Who Fights with
 * Monsters* works because this catalog files them under Travis Deverell and Open
 * Library files them under the pen name Shirtaloon — and the author gate refused
 * every candidate, correctly. `docs/info/openlibrary-ids.md` §5 named an author
 * alias as the fix and there was no way to enter one.
 *
 * ⚠️ **This is not an edit path for `work.title` or `work.authors`.** Those two
 * derive `work_key`, the join to the shared Firestore reviews. An alias is
 * strictly an addition; see the header of `packages/db/src/aliases.ts`.
 *
 * Every write answers with the whole list, like `relations.ts`, so the page
 * redraws from the server rather than splicing its own guess into local state.
 */
export const aliasRoutes = new Hono<AppBindings>()
  .get('/works/:id/aliases', requireCapability('read'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);
    return c.json({ aliases: await listAliasesForWork(c.env.DB, id) });
  })

  .post('/works/:id/aliases', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);

    const parsed = createWorkAliasSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    try {
      await addWorkAlias(c.env.DB, id, parsed.data);
    } catch (err) {
      if (err instanceof AliasError) {
        return c.json({ error: 'bad_request', detail: err.message }, err.status);
      }
      throw err;
    }
    return c.json({ aliases: await listAliasesForWork(c.env.DB, id) }, 201);
  })

  .delete('/works/:id/aliases/:aliasId', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    const aliasId = Number(c.req.param('aliasId'));
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(aliasId) || aliasId <= 0) {
      return c.json({ error: 'bad_request' }, 400);
    }
    const ok = await deleteWorkAlias(c.env.DB, id, aliasId);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json({ aliases: await listAliasesForWork(c.env.DB, id) });
  });
