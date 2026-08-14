/**
 * @lc/estate-auth — estate auth for this catalog.
 *
 * ⚠️ THE IMPLEMENTATION DOES NOT LIVE IN THIS REPO. The canonical module is
 * `catalog-platform/packages/estate-auth/` (the ONE verifier + the §3.1
 * combination table + the /seen client — see estate-auth-design.md §8.1, §14.2,
 * and its 31 unit tests in that repo). `scripts/sync-estate-auth.mjs`
 * materialises its source into `generated/` — a gitignored build artifact,
 * rewritten on every build, test and typecheck — for exactly the reason the
 * module exists at all: two repos once held two copies of `auth.ts` and only
 * one got a security hardening (design §1.1). Do not edit `generated/`.
 *
 * ⚠️ If the import below fails to resolve, the sync has not run. Run
 * `node scripts/sync-estate-auth.mjs` and read what it says — it names
 * `CATALOG_PLATFORM_DIR` and every path it tried.
 *
 * `src/gate.ts` is this repo's own consumption logic (the §14.5 gate — all
 * three ESTATE_CHECK modes, enforce included since the wave-2 build) — local
 * code wrapping the canonical module, the same shape as `@lc/universes`'
 * `catalog.ts` wrapping the shared list.
 */

export * from '../generated/index.js';
export * from './gate.js';
