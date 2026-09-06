/**
 * A `SweepPlan` rendered as the SQL this project's scripts have always written.
 *
 * ⚠️ **This is the half of the audiobook sweep that the Worker will NOT use.**
 * `planAudiobookSweep` (`packages/core/src/audiobook-sweep.ts`) returns ROWS,
 * because the script interpolates SQL strings and runs them through
 * `wrangler d1 execute` while a Worker binds prepared statements — a planner
 * that returned SQL could only ever have had one caller (§2.3 of
 * `catalog-platform/docs/info/audiobook-association-route.md`). So this file is
 * the script's renderer and `packages/db/src/audiobook-holdings.ts` will be the
 * Worker's binder, over one identical plan.
 *
 * ## Why it is its own module rather than lines in the backfill
 *
 * `scripts/backfill-audiobook-holdings.mjs` reads two databases at import time,
 * so nothing can import it to test it. Extracting the rendering is what lets
 * `scripts/test/backfill-audiobook-holdings.test.mjs` pin the exact SQL for a
 * fixture plan — the phase-0 regression net. "The plan is right" and "the SQL
 * written from it is right" are two different claims and the second one had no
 * test at all before this.
 *
 * ⚠️ **The statement ORDER is part of the contract**: edition upserts, edition
 * stales, rung upserts, rung stales. The script prints `statements.length` and
 * the dry-run output is compared byte for byte across the extraction.
 *
 * ⚠️ Everything here is `lit()`-interpolated, which is safe for exactly the
 * reason `scripts/lib/d1.mjs` gives: these run through a temp FILE, never
 * `--command`, because this shell is PowerShell and a multi-line statement
 * passed as an argument arrives with literal `\n` sequences in it.
 */

import { lit } from './d1.mjs';

/**
 * Every statement for one plan, in the order the script has always run them.
 *
 * Idempotent by construction: every INSERT carries its `ON CONFLICT … DO UPDATE`
 * and sets `last_seen_at = datetime('now'), stale_at = NULL`, so a second run
 * inside one minute produces the same rows. **Marked, never deleted** —
 * migration 0010's rule: a row vanishing looks identical to the audiobook having
 * gone away.
 */
export function renderSweepStatements(plan) {
  const statements = [];

  for (const e of plan.editionUpserts) {
    statements.push(
      // ⚠️ `raw_title` is `e.rawTitle`, NOT `e.title` — migration 0340. `title` is
      // stripped by `cleanTitleWithSeries` and is what a person is shown;
      // `raw_title` is the sibling catalog's verbatim string and is the one the
      // content-warning key is derived from, because that is what the audiobook
      // site and `content_warnings.json` are both keyed by. Migration 0390 reuses
      // that same string as `audio_key`, so the edition identity here and the
      // warning identity there cannot drift apart.
      `INSERT INTO audiobook_edition_holding (work_id, audio_key, title, raw_title, authors,` +
        ` series, index_display, index_sort, cover_href, narrator, matched_via,` +
        ` title_similarity, via_alias)` +
        ` VALUES (${lit(e.workId)}, ${lit(e.audioKey)}, ${lit(e.title)}, ${lit(e.rawTitle)},` +
        ` ${lit(e.authors)}, ${lit(e.series)}, ${lit(e.indexDisplay)},` +
        ` ${lit(e.indexSort)}, ${lit(e.coverHref)}, ${lit(e.narrator)},` +
        ` ${lit(e.matchedVia)}, ${lit(e.titleSimilarity)}, ${lit(e.viaAlias)})` +
        ` ON CONFLICT(work_id, audio_key) DO UPDATE SET` +
        ` title = excluded.title, raw_title = excluded.raw_title,` +
        ` authors = excluded.authors, series = excluded.series,` +
        ` index_display = excluded.index_display, index_sort = excluded.index_sort,` +
        ` cover_href = excluded.cover_href, narrator = excluded.narrator,` +
        ` matched_via = excluded.matched_via,` +
        ` title_similarity = excluded.title_similarity, via_alias = excluded.via_alias,` +
        ` last_seen_at = datetime('now'), stale_at = NULL;`,
    );
  }

  // An EDITION that no longer matches. Marked, never deleted — migration 0010's
  // rule, applied one row finer: a work can keep one recording and lose another,
  // and only the row that went away may be marked.
  for (const s of plan.editionStales) {
    statements.push(
      `UPDATE audiobook_edition_holding SET stale_at = datetime('now')` +
        ` WHERE work_id = ${lit(s.workId)} AND audio_key = ${lit(s.audioKey)}` +
        ` AND stale_at IS NULL;`,
    );
  }

  for (const r of plan.rungUpserts) {
    statements.push(
      `INSERT INTO audiobook_series_holding (series, index_sort, title, authors,` +
        ` audiobook_series, index_display, cover_href, series_matched_via)` +
        ` VALUES (${lit(r.series)}, ${lit(r.indexSort)}, ${lit(r.title)}, ${lit(r.authors)},` +
        ` ${lit(r.audiobookSeries)}, ${lit(r.indexDisplay)}, ${lit(r.coverHref)}, ${lit(r.seriesMatchedVia)})` +
        ` ON CONFLICT(series, index_sort) DO UPDATE SET` +
        ` title = excluded.title, authors = excluded.authors,` +
        ` audiobook_series = excluded.audiobook_series,` +
        ` index_display = excluded.index_display, cover_href = excluded.cover_href,` +
        ` series_matched_via = excluded.series_matched_via,` +
        ` last_seen_at = datetime('now'), stale_at = NULL;`,
    );
  }

  // Marked, never deleted — the other catalog renaming a series must not look like
  // the audiobook having been returned.
  for (const s of plan.rungStales) {
    statements.push(
      `UPDATE audiobook_series_holding SET stale_at = datetime('now')` +
        ` WHERE series = ${lit(s.series)} AND index_sort = ${lit(s.indexSort)}` +
        ` AND stale_at IS NULL;`,
    );
  }

  return statements;
}
