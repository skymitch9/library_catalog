/**
 * The estate series canon, as the audiobook-holdings backfill reads it.
 *
 * `catalog-platform/data/series-canon.json` records CROSS-CATALOG
 * series-spelling drift — a series spelled one way in
 * `audiobook_catalog/site/catalog.csv` and another way in this repo's D1
 * `work.series`. It is not universe data (see `catalog-platform/docs/
 * UNIVERSES.md` §8) and this module is deliberately its own small file rather
 * than folded into `scripts/lib/platform-repo.mjs`, for the same reason
 * `scripts/lib/audiobooks.mjs` is its own file: one module per sibling-repo
 * concern, so a failure names the concern that broke.
 *
 * ## Why LIVE, not the `packages/universes/generated/` copy
 *
 * `scripts/sync-universes.mjs` also materialises `series-canon.json` into
 * `packages/universes/generated/`, riding along with the universe list and the
 * fold-pinning fixtures — see the comment in that file. That path exists for
 * the Worker bundle, which cannot reach across repos at runtime and needs a
 * `prebuild` step to have already run. This module's caller,
 * `scripts/backfill-audiobook-holdings.mjs`, is a **hand-run script** with no
 * such guarantee — `npm run backfill:audiobooks` carries no `pre` hook, so a
 * generated copy could be hours or commits stale. Reading the sibling checkout
 * directly, the same way `scripts/lib/audiobooks.mjs` reads
 * `audiobook_catalog/site/catalog.csv`, is both simpler and always current.
 *
 * ## Why warn-and-continue, not fail-the-build
 *
 * `scripts/sync-universes.mjs` FAILS the build when catalog-platform is
 * missing, because a Worker bundled with an empty universe list would ship a
 * silently wrong answer to production for months. Nothing here ships anywhere
 * on its own: this is one input to a backfill script whose whole output is
 * reviewed as a dry-run diff before every `--commit`, and whose actual job
 * (matching individual audiobooks to works, migration 0010/0090's phase 1) has
 * nothing to do with series-name folding. A missing or malformed series canon
 * degrades the fold to plain `normaliseTitle` — exactly the behaviour before
 * this file existed — and is reported once, loudly, rather than stopping the
 * whole backfill over reference data for a feature it does not need. This is
 * the SAME choice `audiobook_catalog/app/core/universes.py` makes for its own
 * live cross-repo read, and for the same reason.
 *
 * ## ⚠️ Since 2026-09-05 this module is a THIN WRAPPER — the rule moved
 *
 * `normText`, the map build and the lookup are now
 * `packages/core/src/series-canon.ts`, so the Worker and this script fold a
 * series name with the same code rather than two copies of it (phase 0 of
 * `catalog-platform/docs/info/audiobook-association-route.md`, §9 step 3).
 * **What stayed here is the LIVE read and the warn-and-degrade posture** — the
 * two things that are true of a hand-run script and false of a Worker. The
 * Worker's bundle-ready binding is `@lc/universes`' `seriesCanonMap`, over the
 * generated copy; §2.4 of that design states the resulting skew out loud, and
 * says the route is the stale side.
 *
 * `normText` is re-exported unchanged so every existing importer keeps working.
 */

import { readFileSync, existsSync } from 'node:fs';
import {
  buildSeriesCanonMap,
  canonicalSeriesIn,
  normText,
} from '../../packages/core/src/series-canon.ts';
import { resolvePlatformRepo } from './platform-repo.mjs';

export { normText };

let cached = null; // Map<normalised variant, canonical> | null, built once per process

/** Load the estate canon once per process. Never throws — see the header. */
function loadMap() {
  if (cached) return cached;

  let dir;
  try {
    ({ dir } = resolvePlatformRepo());
  } catch (err) {
    console.warn(
      `\n[WARN] series-canon: ${err.message}\n` +
        '[WARN] series-canon: continuing with NO cross-catalog series folds — series ' +
        'names will only be compared with normaliseTitle, same as before this file existed.\n',
    );
    cached = new Map();
    return cached;
  }

  const path = `${dir}/data/series-canon.json`;
  if (!existsSync(path)) {
    console.warn(
      `\n[WARN] series-canon: ${path} does not exist. Continuing with NO cross-catalog series folds.\n`,
    );
    cached = new Map();
    return cached;
  }

  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    cached = buildSeriesCanonMap(doc);
    console.log(`series-canon: ${cached.size} spelling(s) across ${doc.entries?.length ?? 0} entries, from ${path}`);
  } catch (err) {
    console.warn(`\n[WARN] series-canon: could not read/parse ${path} (${err.message}). Continuing with NO folds.\n`);
    cached = new Map();
  }
  return cached;
}

/**
 * Fold a series name onto its estate-canon canonical spelling.
 *
 * ⚠️ An unknown name is returned UNCHANGED, not null — a series with no
 * recorded cross-catalog drift is still a series, correctly spelled, and this
 * must hand it back rather than erase it. Callers still run the result through
 * `normaliseTitle` themselves; this only removes the DECORATION-shaped drift
 * (`"[publication order]"`, `"(Full-Cast Editions)"`, `"The … Series"`) that
 * `normaliseTitle` alone does not.
 */
export function canonicalSeries(name) {
  return canonicalSeriesIn(loadMap(), name);
}

/** For tests: force a reload on the next canonicalSeries() call. */
export function _resetSeriesCanonCache() {
  cached = null;
}
