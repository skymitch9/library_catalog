/**
 * The universe list, applied to a catalog's rows.
 *
 * ⚠️ **Nothing here is part of the two-implementation contract.**
 * `lookup.ts` is — every function in it has a twin in
 * `audiobook_catalog/app/core/universes.py`, and `universes.fixtures.json` pins
 * the pair together. This file is a *caller* of that contract: it walks rows of
 * a catalog and asks `universeFor` about each one. The Python side has no
 * equivalent and needs none, because a static build groups its rows in a
 * template. Adding a function here therefore costs nothing on the other side;
 * adding one to `lookup.ts` costs a change in four places.
 *
 * ## Why the answer is worked out over rows rather than in SQL
 *
 * A universe is not a column. It is a hand-written list of series names and
 * exact titles held in another repo, with exclusions that must be checked first,
 * matched after a normalisation that folds curly apostrophes — see
 * `normaliseUniverseText`. All of that is *already implemented once*, in
 * `universeFor`, and re-expressing it as a WHERE clause would make it exist a
 * third time in a third language.
 *
 * This estate has shipped that exact bug: `resolve_author_link` (Python) and
 * `_resolveAuthorFolder` (JS) split author strings identically until they did
 * not, and a promote failed silently. So the catalog hands over the two columns
 * the lookup reads, the one implementation decides, and SQL is given a list of
 * ids. The cost is a few hundred rows of `(id, title, series)` per request; the
 * benefit is that a filter and the count labelling it cannot disagree, because
 * one function produced both.
 */

import { normaliseUniverseText, universeFor, type UniverseIndex } from './lookup.js';

/**
 * The least a row has to be for the lookup to answer about it.
 *
 * Deliberately not `Work` or `CollectionRow` — this package must not learn what
 * a catalog row looks like, and both catalogs' rows are different shapes.
 */
export interface UniverseCandidate {
  id: number;
  title?: string | null;
  series?: string | null;
}

/**
 * The ids of the rows belonging to one universe.
 *
 * ⚠️ An empty array is a real answer — "this catalog holds nothing from that
 * universe" — and callers must not read it as "no filter". Most of this
 * catalog is children's picture books, so an empty answer is ordinary.
 */
export function universeMemberIds(
  index: UniverseIndex,
  rows: readonly UniverseCandidate[],
  universeName: string,
): number[] {
  const ids: number[] = [];
  for (const row of rows) {
    if (universeFor(index, { title: row.title ?? null, series: row.series ?? null }) === universeName) {
      ids.push(row.id);
    }
  }
  return ids;
}

/**
 * How many rows each universe holds.
 *
 * ⚠️ **Every name, always, zeroes included** — the rule `CollectionFacets.media`
 * states in `@lc/db`: a control that comes and goes with the data is worse than
 * one that reads "Maasverse (0)". Today that universe is nineteen audiobooks and
 * no printed book at all, and it will not always be.
 *
 * ⚠️ **There is no "no universe" bucket and there must not be one.** Absence is
 * the ordinary answer here, not a gap: 145 of the audiobook catalog's 1,075 rows
 * resolve, and this catalog is largely picture books that rightly resolve to
 * nothing. Counting the remainder would put a four-figure worklist on screen
 * describing books that are perfectly filed. Same settled reading as a NULL
 * `cover_status` ("nobody looked") and a NULL `edition_kind` ("ordinary").
 *
 * Ordered by `names`, which is the order the owner approved them in.
 */
export function universeTally(
  index: UniverseIndex,
  rows: readonly UniverseCandidate[],
  names: readonly string[],
): { name: string; count: number }[] {
  const counts = new Map<string, number>(names.map((n) => [n, 0]));
  for (const row of rows) {
    const hit = universeFor(index, { title: row.title ?? null, series: row.series ?? null });
    if (hit !== null && counts.has(hit)) counts.set(hit, counts.get(hit)! + 1);
  }
  return names.map((name) => ({ name, count: counts.get(name) ?? 0 }));
}

/**
 * A name a caller typed, folded onto the owner's spelling — or null.
 *
 * `canonicalUniverseName` answers from the alias map, which is where
 * `cosmere → The Cosmere` and `arand multiverse → Runnerverse` live. The
 * fallback exists so a universe is reachable by its own name even if nobody
 * ever wrote an alias for it: the map is hand-maintained, and a canonical name
 * missing from it would otherwise 404 its own page.
 *
 * ⚠️ null means "no such universe", and every caller must treat it as *no
 * filter asked for* rather than *filter matching nothing*. A stale bookmark
 * should show the collection, which is the rule the sort allowlist,
 * `MEDIUM_CLAUSE`, `KIND_CLAUSE` and `NEEDS_CLAUSE` all already follow.
 */
export function resolveUniverseName(
  index: UniverseIndex,
  names: readonly string[],
  asked: string | null | undefined,
): string | null {
  const wanted = normaliseUniverseText(asked);
  if (!wanted) return null;
  const alias = index.canonicalNames.get(wanted);
  if (alias !== undefined) return alias;
  return names.find((n) => normaliseUniverseText(n) === wanted) ?? null;
}
