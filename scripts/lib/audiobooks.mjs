/**
 * The sibling catalog, read as data.
 *
 * `audiobook_catalog/site/catalog.csv` is the one place in this household where
 * series names and volume numbers have been curated by a person rather than
 * inferred, and `site/covers/` holds an image for nearly every row. Both are
 * tracked in that repo deliberately (its deploy ships them from git), so they
 * are on disk beside this one and need no network call.
 *
 * ⚠️ This module reads. It never writes into `audiobook_catalog` — that repo's
 * pipeline owns those files and runs three times a day.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { parseAudiobookCsv } from '../../packages/core/src/audiobook-csv.ts';
import {
  buildWorkIndex,
  matchIndexedWork,
  matchIndexedWorkAll,
} from '../../packages/core/src/matching.ts';
import { ROOT } from './d1.mjs';

/**
 * Where the sibling catalog is checked out.
 *
 * Normally the repo next door, which is true of the main checkout and of every
 * measurement recorded in this project. ⚠️ It is **not** true in a git worktree:
 * those live under `library_catalog/.claude/worktrees/<name>`, so `../` lands
 * three directories too deep and `loadAudiobooks()` silently returns `[]` — a
 * zero-row read that looks exactly like "the sibling catalog knows nothing about
 * any of these books". `LC_AUDIOBOOK_ROOT` is the same escape hatch
 * `LC_D1_PERSIST_TO` is in `d1.mjs`, and exists for the same reason: a worktree
 * on Windows.
 */
export const AUDIOBOOK_ROOT = process.env.LC_AUDIOBOOK_ROOT
  ? path.resolve(process.env.LC_AUDIOBOOK_ROOT)
  : path.resolve(ROOT, '../audiobook_catalog');
const CSV = path.join(AUDIOBOOK_ROOT, 'site/catalog.csv');

/** The CSV this module reads, so a caller can say where it looked when it is empty. */
export const AUDIOBOOK_CSV = CSV;

/**
 * Every audiobook row, with its title already stripped of Audible's decoration.
 *
 * ⚠️ **The parsing and the row mapping are NOT here any more.** They moved
 * verbatim to `packages/core/src/audiobook-csv.ts` (`parseAudiobookCsv`) on
 * 2026-09-05, phase 0 of
 * `catalog-platform/docs/info/audiobook-association-route.md`, so the Worker —
 * which cannot read this file off disk but can fetch the identical bytes from
 * `audiobooks.heygabi.ai/catalog.csv` — parses it with the same code rather
 * than a second copy of it. The row mapping IS the row identity; two copies
 * would be two different ideas of what a row is, which is the drift
 * `packages/core/src/matching.ts` opens by banning.
 *
 * **What stayed here is the I/O and only the I/O**: where the checkout is, that
 * a missing file reads as `[]`, and the `LC_AUDIOBOOK_ROOT` escape hatch. That
 * is the split `@lc/core`'s "no I/O — safe to import anywhere" promise requires,
 * and it is why an offline run, a run before a deploy and a recovery run all
 * still work exactly as they did.
 */
export function loadAudiobooks() {
  if (!existsSync(CSV)) return [];
  return parseAudiobookCsv(readFileSync(CSV, 'utf8'));
}

/**
 * Ask the audiobook catalog about a book, through the project's ONE matcher.
 *
 * ⚠️ Deliberately `matchIndexedWork` rather than a fresh comparison. Its author
 * gate is what stops "Firefight" reaching a different book called Firefight, and
 * `packages/core/src/matching.ts` opens with three wrong-game matches the sibling
 * project shipped from exactly the second-similarity-function mistake.
 *
 * Containment matters here rather than being a nicety: this library files
 * *Beneath the Dragoneye Moons* volumes as "Oathbound Healer - MM", and the
 * audiobook row is "Oathbound Healer". Nothing exact would ever meet.
 */
export function audiobookIndex(rows) {
  const index = buildWorkIndex(rows);
  return {
    /**
     * `seriesIndex` is OUR side's volume number (`work.series_index_sort`),
     * optional and only ever consulted when the fold is already ambiguous —
     * see `disambiguateByVolume` in matching.ts and the Space Knight case it
     * documents. Omitting it just means an ambiguous fold refuses, same as
     * before this parameter existed.
     */
    lookup(title, authors, seriesIndex) {
      const m = matchIndexedWork(index, title, authors, seriesIndex);
      return m ? { row: m.work, via: m.via, similarity: m.titleSimilarity } : null;
    },

    /**
     * Every audiobook row that passes, strongest rung first — for
     * `audiobook_edition_holding` (migration 0390), which is keyed per edition
     * and so can store the two Elantris recordings instead of losing one to a
     * primary-key collision.
     *
     * ⚠️ `matchIndexedWorkAll`, and nothing else. It shares `matchIndexedWork`'s
     * rungs, author gate and refusals exactly — the header above bans a second
     * comparison here for the reason `packages/core/src/matching.ts` opens
     * with, and that ban applies with more force to the multi-result form: a
     * looser gate here would not produce one wrong match, it would produce a
     * list of them under a work the owner already trusts.
     *
     * `[0]` is the row `lookup` would have returned, so a caller that wants one
     * answer and a caller that wants the set never disagree about which is
     * best. Returns `[]` for nothing, so it is always iterable.
     */
    lookupAll(title, authors, seriesIndex) {
      return matchIndexedWorkAll(index, title, authors, seriesIndex).map((m) => ({
        row: m.work,
        via: m.via,
        similarity: m.titleSimilarity,
      }));
    },
  };
}

/** Absolute path of a `cover_href` from the CSV, or null when the file is gone. */
export function audiobookCoverPath(coverHref) {
  if (!coverHref) return null;
  const p = path.join(AUDIOBOOK_ROOT, 'site', coverHref);
  return existsSync(p) ? p : null;
}
