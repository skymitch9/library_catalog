import { Hono } from 'hono';
import { isDatabaseReachable } from '@lc/db';
import { universeNames, universesDocument } from '@lc/universes';
import type { AppBindings } from '../env.js';

/**
 * Unauthenticated on purpose: this is the endpoint you curl to prove the
 * deployment works before sign-in is even configured.
 *
 * ⚠️ `universes` is here for one reason: it is the only thing that proves the
 * shared list was actually bundled. It comes from catalog-platform, is
 * materialised at build time, and NOTHING ELSE reads it yet — surfacing
 * universes in the UI is a separate job. A dependency nobody exercises is a
 * dependency that breaks quietly, and this line makes a missing or empty list
 * visible in one curl rather than months later in a wrong answer.
 */
export const healthRoutes = new Hono<AppBindings>().get('/', async (c) => {
  const database = (await isDatabaseReachable(c.env.DB)) ? 'up' : 'down';
  return c.json(
    {
      ok: database === 'up',
      version: c.env.APP_VERSION ?? 'unknown',
      database,
      universes: { count: universeNames.length, schemaVersion: universesDocument.schemaVersion },
      time: new Date().toISOString(),
    },
    database === 'up' ? 200 : 503,
  );
});
