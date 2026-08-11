/**
 * Where the shared universe list meets this catalog's rows.
 *
 * ⚠️ **The only place the two are joined, on purpose.** `@lc/universes` is the
 * one package in this repo that depends on another checkout, and `@lc/db`
 * deliberately knows nothing about it (see the note on `CollectionFacets`). So
 * the composition lives here, in the worker, and every route that needs it
 * imports from this file rather than repeating the two-step.
 *
 * The two-step is always: read `(id, title, series)` for the rows the rest of
 * the filter allows, then ask the ONE lookup implementation about each of them.
 * Nothing resolves a universe in SQL — `packages/universes/src/catalog.ts`
 * carries the argument for why, and it is the same argument that made
 * `universes.fixtures.json` exist.
 */

import { listUniverseKeys, type CollectionQuery } from '@lc/db';
import {
  resolveUniverseName,
  universeIndex,
  universeMemberIds,
  universeNames,
  universeTally,
} from '@lc/universes';

/**
 * Fold a name from a query string or a URL segment onto the owner's spelling.
 *
 * ⚠️ null means "not one of the six". Callers filtering a list must treat that
 * as *no filter*, not as *a filter matching nothing* — a stale bookmark shows
 * the collection, which is what every other unrecognised value on
 * `/api/collection` already does.
 */
export function canonicalUniverse(asked: string | null | undefined): string | null {
  return resolveUniverseName(universeIndex, universeNames, asked);
}

/**
 * The ids to filter by, or `undefined` when no universe was asked for.
 *
 * One extra query, and only when the filter is on. It is not folded into
 * `listCollection` because the answer is not a column: it has to be worked out
 * in JavaScript before the statement that uses it can be built.
 */
export async function universeIdsFor(
  db: D1Database,
  query: CollectionQuery,
  asked: string | null | undefined,
): Promise<number[] | undefined> {
  const name = canonicalUniverse(asked);
  if (!name) return undefined;
  return universeMemberIds(universeIndex, await listUniverseKeys(db, query), name);
}

/**
 * How many books each universe holds under the current filter.
 *
 * Always all six with their zeroes — `universeTally` says why — and never a
 * count of the books in no universe, which is most of them and is the ordinary
 * answer rather than a worklist.
 */
export async function universeFacet(
  db: D1Database,
  query: CollectionQuery,
): Promise<{ name: string; count: number }[]> {
  return universeTally(universeIndex, await listUniverseKeys(db, query), universeNames);
}
