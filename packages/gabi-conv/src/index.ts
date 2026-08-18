/**
 * `@lc/gabi-conv` — GABI's conversation substrate for this catalog.
 *
 * ⚠️ THE IMPLEMENTATION DOES NOT LIVE IN THIS REPO. The canonical module is
 * `catalog-platform/packages/gabi-conversation/` — the record shape, the
 * 30-minute sliding window, the 20-turn cap, the 600-character clip, the
 * storage-key rule and the Messages-API alternation enforcement, shared with
 * GABI's Discord surface so an upgrade to how she remembers lands once and
 * serves both. `scripts/sync-gabi-conversation.mjs` materialises its source
 * into `generated/` — a gitignored build artifact, rewritten on every build,
 * test and typecheck. Do not edit `generated/`.
 *
 * ⚠️ If the import below fails to resolve, the sync has not run. Run
 * `node scripts/sync-gabi-conversation.mjs` and read what it says — it names
 * `CATALOG_PLATFORM_DIR` and every path it tried.
 *
 * `src/panel.ts` is this repo's own consumption logic — which key a site chat
 * belongs to, and which remembered turns a given browser tab is *not* already
 * carrying. Local code wrapping the canonical module, the same shape as
 * `@lc/estate-auth`'s `gate.ts` and `@lc/universes`' `catalog.ts`.
 *
 * ⚠️ **This is the THIRD package in this repo with a cross-repo dependency**,
 * after `@lc/universes` and `@lc/estate-auth`. It is deliberately not inside
 * `@lc/core`: that package promises "no I/O, safe to import anywhere", and a
 * build-generated file with cross-repo provenance does not belong inside that
 * promise. `docs/info/universes.md` makes the argument in full.
 */

export * from '../generated/index.js';
export * from './panel.js';
