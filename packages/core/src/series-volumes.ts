/**
 * The audiobook catalog's answer to *"what volumes does this series have?"*, as
 * a decision — the DATA, never the SQL.
 *
 * The audiobook rung of `scripts/backfill-series-volumes.mjs` moved here whole
 * on 2026-09-05 (platform inventory §7 row #2: *"same input, same fetch, same
 * instance pair — once the CSV fetch and the shared parser exist, this costs one
 * function"*). Read that script's header for the *why* behind every rule below;
 * this file is the same rules with the I/O taken out.
 *
 * ## ⚠️ The one rule, carried over verbatim
 *
 * Every row this plans carries `source = 'audiobook_catalog'` and is a claim
 * that *some volume exists*, never a claim about how long the series is.
 * **`series_check.known_total` is NEVER written here** — the sibling catalog is
 * a record of what this household bought, not of what a publisher printed, so
 * its highest volume is a FLOOR. Reading it as a total would produce "6 of 12"
 * with nothing behind the 12: the lie that looks like data. There is no field
 * for it in `SeriesCheckRow` precisely so no caller can pass one.
 *
 * ## ⚠️ The fold is `normaliseTitle` and NOTHING else
 *
 * This library spells it "All The Skills"; the audiobook catalog spells it "All
 * the Skills". They meet through `normaliseTitle` — the project's ONE fold, the
 * same one `work_key` is built from — and through nothing else.
 *
 * 🔴 **Deliberately NOT `canonicalSeries` first**, which is what
 * `audiobook-sweep.ts`'s phase 2 folds with. That is not an oversight and the
 * two must not be "made consistent" by somebody tidying: this half writes
 * `series_volume`, whose rows the series page joins to `work.series` **by
 * name**, and the script has folded with `normaliseTitle` alone since 2026-08-10
 * — so widening the fold here would silently re-file existing rows under a
 * different series name than the ones already on both instances. If that
 * widening is ever wanted it is a measured change of its own with a row count
 * beside it, not a side effect of this conversion.
 *
 * The name **stored** is always this catalog's spelling, so `series_volume`
 * joins `work.series` exactly and no fold runs at read time.
 *
 * ## 🔴 This returns ROWS, not statements
 *
 * The same hinge `audiobook-sweep.ts` records: the script interpolates SQL
 * through `wrangler d1 execute`, a Worker binds prepared statements, and if this
 * returned SQL only one of the two callers could use it. `packages/db`'s
 * `seriesVolumeStatements` is the ONE rendering both consume.
 *
 * ⚠️ **`writes` is ORDERED, and the order is part of the contract**: per series,
 * its volume upserts and then its `series_check` row, series by series. That is
 * the order the script has always run them in, and the script's dry-run output
 * counts them.
 */

import type { AudiobookRow } from './audiobook-csv.js';
import { normaliseTitle } from './titles.js';

/** The `series_volume.source` / `series_check.source` value this rung writes. */
export const AUDIOBOOK_VOLUME_SOURCE = 'audiobook_catalog';

/** What `series_volume.source_url` records. A path, not a URL — it always was. */
export const AUDIOBOOK_VOLUME_SOURCE_URL = 'audiobook_catalog/site/catalog.csv';

/** One of our works, as this planner needs it. Volume numbers ride along for the report. */
export interface SeriesVolumeWork {
  series: string | null;
  seriesIndexSort: number | null;
}

/** A `series_volume` row as it stands today. `source` is what protects a `manual` row. */
export interface ExistingSeriesVolume {
  series: string;
  indexSort: number;
  source: string;
}

export interface SeriesVolumeSweepInput {
  works: readonly SeriesVolumeWork[];
  audiobooks: readonly AudiobookRow[];
  existing: readonly ExistingSeriesVolume[];
}

/** One `series_volume` row to write. */
export interface SeriesVolumeRow {
  series: string;
  indexSort: number;
  indexDisplay: string | null;
  title: string | null;
  authors: string | null;
  source: typeof AUDIOBOOK_VOLUME_SOURCE;
  sourceUrl: typeof AUDIOBOOK_VOLUME_SOURCE_URL;
}

/**
 * One `series_check` row to write.
 *
 * ⚠️ **There is no `knownTotal` field and there must not be one.** See the
 * header: a floor is not a total, and the only defence that survives a refactor
 * is the absence of the field.
 */
export interface SeriesCheckRow {
  series: string;
  source: typeof AUDIOBOOK_VOLUME_SOURCE;
  outcome: 'ok' | 'not_found';
  volumesSeen: number;
}

/** One write, in the order the sweep has always run them. */
export type SeriesVolumeWrite =
  | { kind: 'volume'; row: SeriesVolumeRow }
  | { kind: 'check'; row: SeriesCheckRow };

/** What the planner decided about one of our series. */
export interface SeriesVolumeReportEntry {
  series: string;
  outcome: 'ok' | 'not_found';
  /** Volumes this run had not seen before. */
  added: number;
  /** Our own highest volume number in that series, or null when we number none. */
  top: number | null;
  /** The sibling catalog's highest numbered volume, or null when it knows none. */
  abTop: number | null;
  /** What the audiobook catalog calls the series, when that differs. */
  abName: string | null;
}

/**
 * Everything the script prints and everything the run row records.
 *
 * ⚠️ The script's dry-run output is the acceptance test for this conversion, so
 * every number it prints is derivable from here. Drop a field and the script's
 * output changes.
 */
export interface SeriesVolumeReport {
  /** Our series considered — the script's `N series in the … database`. */
  seriesCount: number;
  audiobookCount: number;
  /** Series the sibling catalog knows. */
  found: number;
  /** Series it has never heard of — recorded as `not_found`, not as silence. */
  notFound: number;
  /** Volumes this run had not seen before, across every series. */
  newVolumes: number;
  /**
   * Rows left alone because a person entered them. A hand-entered row outranks
   * the CSV and is skipped ENTIRELY rather than upserted — the SQL would leave
   * it alone anyway, and not sending the statement keeps the dry run honest.
   */
  manualSkipped: number;
  entries: SeriesVolumeReportEntry[];
}

export interface SeriesVolumePlan {
  writes: SeriesVolumeWrite[];
  report: SeriesVolumeReport;
}

function volumeKey(series: string, index: number): string {
  return `${series}|${index}`;
}

/**
 * Decide the whole series-volume refresh, and write nothing.
 *
 * Idempotent by construction: the upsert keys on `(series, index_sort)` and a
 * second run over the same CSV proposes the identical set, with
 * `report.newVolumes` back to zero.
 */
export function planSeriesVolumes(input: SeriesVolumeSweepInput): SeriesVolumePlan {
  const { works, audiobooks, existing } = input;

  const known = new Set(existing.map((r) => volumeKey(r.series, Number(r.indexSort))));
  const manual = new Set(
    existing
      .filter((r) => r.source === 'manual')
      .map((r) => volumeKey(r.series, Number(r.indexSort))),
  );

  /**
   * Our series, with our own top volume — the script's
   * `GROUP BY series ORDER BY series` over `work`.
   *
   * ⚠️ Sorted by code point, NOT `localeCompare`: SQLite's default collation is
   * BINARY, and this list decides the ORDER of the statements. The script's
   * printed report sorts separately with `localeCompare`, exactly as it always
   * did.
   */
  const tops = new Map<string, number | null>();
  for (const w of works) {
    if (w.series == null) continue;
    const index = w.seriesIndexSort == null ? null : Number(w.seriesIndexSort);
    const prev = tops.get(w.series);
    if (prev === undefined) tops.set(w.series, index);
    else if (index != null && (prev == null || index > prev)) tops.set(w.series, index);
  }
  const ours = [...tops.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  /** Folded series name -> every audiobook row filed under it. */
  const abBySeries = new Map<string, AudiobookRow[]>();
  for (const row of audiobooks) {
    if (!row.series) continue;
    const key = normaliseTitle(row.series);
    const list = abBySeries.get(key);
    if (list) list.push(row);
    else abBySeries.set(key, [row]);
  }

  const writes: SeriesVolumeWrite[] = [];
  const entries: SeriesVolumeReportEntry[] = [];
  let found = 0;
  let notFound = 0;
  let newVolumes = 0;
  let manualSkipped = 0;

  for (const series of ours) {
    const top = tops.get(series) ?? null;
    const hits = abBySeries.get(normaliseTitle(series)) ?? [];

    if (hits.length === 0) {
      notFound += 1;
      entries.push({ series, outcome: 'not_found', added: 0, top, abTop: null, abName: null });
      writes.push({
        kind: 'check',
        row: {
          series,
          source: AUDIOBOOK_VOLUME_SOURCE,
          outcome: 'not_found',
          volumesSeen: 0,
        },
      });
      continue;
    }

    found += 1;

    // ⚠️ Only numbered rows become volumes. An audiobook row with a series and
    // no index is real (a boxed set, a companion) but has no place on the number
    // line, and `series_volume.index_sort` is NOT NULL precisely so that such a
    // row cannot become a volume nobody can name.
    const numbered = hits.filter((h) => typeof h.seriesIndexSort === 'number');
    const seen = new Map<number, AudiobookRow>();
    for (const h of numbered) {
      const index = h.seriesIndexSort as number;
      if (!seen.has(index)) seen.set(index, h);
    }

    let added = 0;
    for (const [index, row] of [...seen].sort((a, b) => a[0] - b[0])) {
      const key = volumeKey(series, index);
      // A hand-entered row outranks the CSV and is skipped entirely.
      if (manual.has(key)) {
        manualSkipped += 1;
        continue;
      }
      if (!known.has(key)) added += 1;
      writes.push({
        kind: 'volume',
        row: {
          series,
          indexSort: index,
          indexDisplay: row.seriesIndexDisplay,
          title: row.title,
          authors: row.authors,
          source: AUDIOBOOK_VOLUME_SOURCE,
          sourceUrl: AUDIOBOOK_VOLUME_SOURCE_URL,
        },
      });
    }
    newVolumes += added;

    writes.push({
      kind: 'check',
      row: {
        series,
        source: AUDIOBOOK_VOLUME_SOURCE,
        outcome: 'ok',
        // ⚠️ `seen.size`, not the number of statements: a series whose only
        // volumes are `manual` rows was still SEEN, and saying otherwise would
        // make a person's own answer look like the source going quiet.
        volumesSeen: seen.size,
      },
    });

    entries.push({
      series,
      outcome: 'ok',
      added,
      top,
      abTop: seen.size === 0 ? null : Math.max(...seen.keys()),
      abName: (hits[0] as AudiobookRow).series,
    });
  }

  return {
    writes,
    report: {
      seriesCount: ours.length,
      audiobookCount: audiobooks.length,
      found,
      notFound,
      newVolumes,
      manualSkipped,
      entries,
    },
  };
}
