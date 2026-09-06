/**
 * The estate series canon, bound to the BUNDLE-READY copy.
 *
 * The rule lives in `@lc/core` (`packages/core/src/series-canon.ts`), which is
 * I/O-free and holds no data. The DATA lives in
 * `catalog-platform/data/series-canon.json` and is materialised into
 * `generated/` by `scripts/sync-universes.mjs` on every build, test and
 * typecheck — that script's own comment says this entry exists "so a future
 * Worker feature has a bundle-ready copy without adding a second sync
 * mechanism". This is that feature.
 *
 * ⚠️ **This is the WORKER's copy, and it is the one that can be stale.**
 * `scripts/lib/series-canon.mjs` reads the sibling checkout LIVE, because a
 * hand-run backfill has no `prebuild` step to guarantee `generated/` is
 * current. A Worker cannot read across repos at runtime, so its canon is as
 * fresh as the last deploy and the script's is as fresh as the last `git pull`
 * of catalog-platform. They can disagree.
 *
 * `catalog-platform/docs/info/audiobook-association-route.md` §2.4 accepts that
 * skew with a guard, and `seriesCanonEntryCount` below exists FOR the guard:
 * the sweep's status line reports it, so a deploy that shipped an empty or
 * stale canon is visible in one curl rather than as a page full of hedged
 * rungs months later. ⚠️ Do not delete it because nothing imports it yet — the
 * `/api/health` line is step 10 of the same build.
 *
 * ⚠️ If the import below fails to resolve, the sync has not run. Run
 * `node scripts/sync-universes.mjs` and read what it says.
 */

import document from '../generated/series-canon.json' with { type: 'json' };
import {
  buildSeriesCanonMap,
  canonicalSeriesIn,
  type SeriesCanonDocument,
  type SeriesCanonMap,
} from '@lc/core';

/** The parsed canon, exactly as catalog-platform holds it — comment keys and all. */
export const seriesCanonDocument = document as unknown as SeriesCanonDocument;

/**
 * The prebuilt variant -> canonical map. Three entries today and a handful of
 * spellings, so building it at module load costs nothing and no consumer has to
 * remember to.
 */
export const seriesCanonMap: SeriesCanonMap = buildSeriesCanonMap(seriesCanonDocument);

/**
 * How many spellings this bundle knows about.
 *
 * ⚠️ The staleness guard of §2.4. **Zero is the number that means something**:
 * it says the bundle shipped with no canon at all, which degrades every series
 * fold to plain `normaliseTitle` and hedges rungs that should be flat — a
 * failure that is otherwise invisible for months.
 */
export const seriesCanonEntryCount: number = seriesCanonMap.size;

/**
 * Fold a series name onto its canonical spelling, using the bundled canon.
 *
 * An unknown name comes back unchanged — see `@lc/core`'s header for why that
 * differs from `canonicalName`'s null.
 */
export function canonicalSeries(name: string): string;
export function canonicalSeries(name: string | null | undefined): string | null | undefined;
export function canonicalSeries(name: string | null | undefined): string | null | undefined {
  return canonicalSeriesIn(seriesCanonMap, name);
}
