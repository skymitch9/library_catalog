/**
 * The sibling audiobook catalog's `catalog.csv`, parsed into rows.
 *
 * ⚠️ **Lifted VERBATIM from `scripts/lib/audiobooks.mjs`** (2026-09-05, phase 0
 * of `catalog-platform/docs/info/audiobook-association-route.md`). The parser and
 * the row mapping are the **row identity** — what a "row" of the audiobook
 * catalog IS — and two copies of that would be two different ideas of it. The
 * script now calls this; nothing else about the script changed, and the phase-0
 * gate is that its dry-run output is byte-identical before and after.
 *
 * ## Why this is in `@lc/core` and not in `scripts/`
 *
 * A Cloudflare Worker cannot read a file beside the repo, but it CAN fetch
 * `https://audiobooks.heygabi.ai/catalog.csv` — measured 2026-09-05: the live
 * bytes equal the on-disk bytes apart from line endings. `parseCsv` below
 * already discards `\r` (`else if (c !== '\r') cur += c`), so **CRLF and LF
 * produce identical rows** and the two transports cannot disagree about what
 * the catalog says. That equivalence is what makes "one canonical
 * implementation" true rather than aspirational, and
 * `packages/core/test/audiobook-csv.test.ts` pins it.
 *
 * ⚠️ No I/O here, per this package's promise. The disk read stays in
 * `scripts/lib/audiobooks.mjs`; the fetch will live in the Worker. Both hand
 * this function text.
 */

import { cleanTitleWithSeries, parseVolumeNumber } from './titles.js';

/**
 * One row of the audiobook catalog, with its title already stripped of
 * Audible's decoration.
 *
 * Structurally a `MatchableWork` (see `matching.ts`), which is why `id`,
 * `seriesIndex` and `series` are here — `buildWorkIndex` reads exactly those.
 */
export interface AudiobookRow {
  /** `matchIndexedWork` wants an id; nothing here reads it back. */
  id: number;
  /** The sibling catalog's verbatim string — `audio_key` / `raw_title`. */
  rawTitle: string;
  title: string;
  authors: string;
  series: string | null;
  seriesIndexSort: number | null;
  /**
   * Same value as `seriesIndexSort`, under the field name `MatchableWork`
   * reads. Kept as a second field rather than a rename so every existing
   * `.seriesIndexSort` reader stays untouched — this one exists solely so
   * `buildWorkIndex` can see it for ambiguous-fold disambiguation (the Space
   * Knight case).
   */
  seriesIndex: number | null;
  seriesIndexDisplay: string | null;
  narrator: string | null;
  coverHref: string | null;
  year: string | null;
  genre: string | null;
  description: string | null;
}

/** RFC4180 enough for this file: quoted fields, doubled quotes, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
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
 * Every audiobook row of a `catalog.csv`, with its title already stripped of
 * Audible's decoration.
 *
 * The strip uses `cleanTitleWithSeries` and not the bare heuristic, for the
 * reason `docs/info/identity-and-reviews.md` §5 records: Audible writes the same
 * series suffix three ways inside one series and only the exact strip catches
 * all three.
 *
 * ⚠️ A header-only file yields `[]`, and so does an empty string. The CALLER
 * decides what zero rows means — `backfill-audiobook-holdings.mjs` treats it as
 * a missing file and refuses to run, because running on would mark every
 * existing holding stale.
 */
export function parseAudiobookCsv(text: string): AudiobookRow[] {
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  const at: Record<string, number | undefined> = Object.fromEntries(
    header.map((h, i) => [h, i]),
  );
  const col = (r: string[], name: string): string | undefined => r[at[name] ?? -1];

  return rows.slice(1)
    .filter((r) => r.length >= header.length && (col(r, 'title') ?? '').trim())
    .map((r, n) => {
      const rawTitle = col(r, 'title') ?? '';
      const series = (col(r, 'series') ?? '').trim() || null;
      return {
        id: n + 1,
        rawTitle,
        title: cleanTitleWithSeries(rawTitle, series),
        authors: (col(r, 'author') ?? '').trim(),
        series,
        seriesIndexSort: parseVolumeNumber(col(r, 'series_index_sort') ?? ''),
        seriesIndex: parseVolumeNumber(col(r, 'series_index_sort') ?? ''),
        seriesIndexDisplay: (col(r, 'series_index_display') ?? '').trim() || null,
        // Who read it. The one field that tells two recordings of the same book
        // apart at a glance — a fourteen-name full cast against "Jack Garrett"
        // — and the reason `audiobook_edition_holding` (migration 0390) can
        // show WHICH edition each row is. Read verbatim; the CSV states it as
        // one comma-joined string and splitting it here would invent a
        // structure that catalog does not itself draw.
        narrator: (col(r, 'narrator') ?? '').trim() || null,
        coverHref: (col(r, 'cover_href') ?? '').trim() || null,
        year: (col(r, 'year') ?? '').trim() || null,
        genre: (col(r, 'genre') ?? '').trim() || null,
        description: (col(r, 'desc') ?? '').trim() || null,
      };
    });
}
