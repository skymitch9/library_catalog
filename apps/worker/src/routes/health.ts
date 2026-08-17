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
 * materialised at build time, and this line makes a missing or empty list
 * visible in one curl rather than months later in a wrong answer. (It was
 * written when nothing else read the list; the collection filter, the facets
 * and `/api/universes/:name` all do now — so this is no longer the list's only
 * exercise, but it is still its only *unauthenticated* one.)
 *
 * ⚠️ **`count` is the length of the BUNDLED list, never a row count.** Both
 * instances answer 16 because both run the same bundle over the same file —
 * that is the single-writer contract being observable, not two databases
 * agreeing by luck. There is no `universe` table in either D1 and there must
 * never be one; `packages/core/test/universes-single-writer.test.ts` is the
 * guard, and `docs/info/universes.md` §7 is the contract.
 *
 * ⚠️ Envelope normalization (estate item 5, 2026-08-14): also answers
 * `{ ok, service, version, time, detail }`, `detail` holding this route's
 * pre-existing shape verbatim. `version`/`database`/`universes`/`time` stay
 * at the top level too — additive only, nothing removed this pass; see
 * catalog-platform's docs/info/health-envelope.md for the transition plan.
 */
export const healthRoutes = new Hono<AppBindings>().get('/', async (c) => {
  const database = (await isDatabaseReachable(c.env.DB)) ? 'up' : 'down';
  const ok = database === 'up';
  // The pre-envelope shape, unchanged — nested under `detail` AND kept at
  // the top level (additive transition, see file header). Spread FIRST so
  // the explicit envelope fields after it are an intentional override, not
  // a silently-shadowed duplicate (tsc flags the reverse order, TS2783).
  const legacy = {
    ok,
    version: c.env.APP_VERSION ?? 'unknown',
    database,
    universes: { count: universeNames.length, schemaVersion: universesDocument.schemaVersion },
    time: new Date().toISOString(),
  };
  return c.json(
    {
      ...legacy,
      service: 'library-catalog',
      detail: legacy,
    },
    ok ? 200 : 503,
  );
});
