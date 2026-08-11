/**
 * @lc/universes — the shared fictional-universe list.
 *
 * ⚠️ THE DATA DOES NOT LIVE IN THIS REPO. It lives in
 * `catalog-platform/data/universes.json`, which both this catalog and
 * `audiobook_catalog` read. `scripts/sync-universes.mjs` materialises it into
 * `generated/` — a gitignored build artifact, rewritten on every build, test and
 * typecheck — because a bundler needs a static path and the checkout layout is
 * not guaranteed.
 *
 * ⚠️ Do not edit `generated/universes.json`. The editor is
 * `node tools/universes.mjs` in catalog-platform, and it refuses an edit that
 * cannot say why it happened. A local edit here is overwritten by the next
 * build, silently, which is the worst kind of lost work.
 *
 * ⚠️ If the import below fails to resolve, the sync has not run. Run
 * `node scripts/sync-universes.mjs` and read what it says — it names
 * `CATALOG_PLATFORM_DIR` and every path it tried.
 *
 * This is the ONLY package in the repo that depends on another repo. It is alone
 * on purpose: `@lc/core` promises "no I/O — safe to import anywhere", and a
 * build-generated file with a cross-repo provenance does not belong inside that
 * promise. Grep for `@lc/universes` to find every consumer.
 */

import document from '../generated/universes.json' with { type: 'json' };
import { buildUniverseIndex, type UniverseIndex, type UniversesDocument } from './lookup.js';

export * from './lookup.js';
/**
 * ⚠️ `catalog.ts` is a *caller* of the lookup, not part of the two-repo
 * contract. Read its header before adding to it: a function there costs nothing
 * on the Python side, and a function in `lookup.ts` costs a change in four
 * places.
 */
export * from './catalog.js';

/** The parsed list, exactly as catalog-platform holds it — comment keys and all. */
export const universesDocument = document as unknown as UniversesDocument;

/**
 * The prebuilt index. Six universes and ~50 keys, so building it at module load
 * costs nothing and no consumer has to remember to.
 */
export const universeIndex: UniverseIndex = buildUniverseIndex(universesDocument);

/** Canonical universe names, in the order the owner approved them. */
export const universeNames: string[] = universesDocument.universes.map((u) => u.name);

/**
 * ⚠️ Bump this in lockstep with `schemaVersion` in the data file. It exists so a
 * shape change in another repo fails here loudly instead of producing quietly
 * wrong answers.
 */
export const EXPECTED_SCHEMA_VERSION = 1;

export function assertSchemaVersion(): void {
  if (universesDocument.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    throw new Error(
      `The shared universe list is schemaVersion ${universesDocument.schemaVersion}, ` +
        `and this repo expects ${EXPECTED_SCHEMA_VERSION}. ` +
        'catalog-platform changed shape; update @lc/universes before shipping.',
    );
  }
}
