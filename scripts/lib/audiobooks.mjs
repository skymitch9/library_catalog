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

import { cleanTitleWithSeries, parseVolumeNumber } from '../../packages/core/src/titles.ts';
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

/** RFC4180 enough for this file: quoted fields, doubled quotes, embedded newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/**
 * Every audiobook row, with its title already stripped of Audible's decoration.
 *
 * The strip uses `cleanTitleWithSeries` and not the bare heuristic, for the
 * reason `docs/info/identity-and-reviews.md` §5 records: Audible writes the same
 * series suffix three ways inside one series and only the exact strip catches
 * all three.
 */
export function loadAudiobooks() {
  if (!existsSync(CSV)) return [];
  const rows = parseCsv(readFileSync(CSV, 'utf8'));
  const header = rows[0] ?? [];
  const at = Object.fromEntries(header.map((h, i) => [h, i]));

  return rows.slice(1)
    .filter((r) => r.length >= header.length && (r[at.title] ?? '').trim())
    .map((r, n) => {
      const rawTitle = r[at.title] ?? '';
      const series = (r[at.series] ?? '').trim() || null;
      return {
        // `matchIndexedWork` wants an id; nothing here reads it back.
        id: n + 1,
        rawTitle,
        title: cleanTitleWithSeries(rawTitle, series),
        authors: (r[at.author] ?? '').trim(),
        series,
        seriesIndexSort: parseVolumeNumber(r[at.series_index_sort] ?? ''),
        // Same value, under the field name `MatchableWork` reads (see
        // matching.ts). Kept as a second field rather than a rename so every
        // existing `.seriesIndexSort` reader here stays untouched — this one
        // exists solely so `buildWorkIndex` can see it for ambiguous-fold
        // disambiguation (the Space Knight case).
        seriesIndex: parseVolumeNumber(r[at.series_index_sort] ?? ''),
        seriesIndexDisplay: (r[at.series_index_display] ?? '').trim() || null,
        // Who read it. The one field that tells two recordings of the same book
        // apart at a glance — a fourteen-name full cast against "Jack Garrett"
        // — and the reason `audiobook_edition_holding` (migration 0390) can
        // show WHICH edition each row is. Read verbatim; the CSV states it as
        // one comma-joined string and splitting it here would invent a
        // structure that catalog does not itself draw.
        narrator: (r[at.narrator] ?? '').trim() || null,
        coverHref: (r[at.cover_href] ?? '').trim() || null,
        year: (r[at.year] ?? '').trim() || null,
        genre: (r[at.genre] ?? '').trim() || null,
        description: (r[at.desc] ?? '').trim() || null,
      };
    });
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
