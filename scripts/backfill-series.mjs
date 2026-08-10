#!/usr/bin/env node
/**
 * Fill in `work.series`, `series_index_sort` and `series_index_display`.
 *
 * ## Why they are all null today
 *
 * The columns have existed since migration 0001 and the UI has always rendered
 * them. Nothing ever wrote them: the only importer this catalog has is
 * `scripts/import-ebooks.mjs`, which reads `audiobook_catalog/site/ebooks.json`,
 * and that manifest carries a title and an author and nothing else. Worse, the
 * importer runs `cleanAudiobookTitle` over the title before storing it, so the
 * one place the series *was* written down — the title itself, as
 * "Blackflame (Cradle Book 3)" — was being stripped and thrown away.
 *
 * ## The ladder, and what each rung actually yielded
 *
 * Measured 2026-08-10 over the 115 works in the local database (production had
 * 117 at the same date; the two differ by two hand-added test rows).
 *
 * | Rung | Source | Works |
 * |---|---|---|
 * | 1 | `scripts/series-overrides.json` — a person's answer | 0 (file is empty) |
 * | 2 | the book's own title, via `detectSeriesFromTitle` | 65 |
 * | 3 | the audiobook catalog's curated `series` column | 13 |
 * | — | no series found | 37 |
 *
 * Rung 2 reads the EPUB's `<dc:title>` rather than `work.title`, because
 * `work.title` has already had the series stripped out of it. The file on disk
 * still says "Blackflame (Cradle Book 3)".
 *
 * Rung 3 goes through `matchIndexedWork`, the project's one matcher, author gate
 * and all. It is what finds the *Beneath the Dragoneye Moons* volumes, which this
 * library files as "Oathbound Healer - MM" and the audiobook catalog as
 * "Oathbound Healer - Beneath the Dragoneye Moons, Book 1".
 *
 * ## ⚠️ It never touches the title
 *
 * `work.title` and `work.authors` re-derive `work_key` on write, which is the
 * key the shared Firestore reviews are filed under. Retitling "Blackflame" to
 * "Blackflame (Cradle Book 3)" would move that key and silently detach the book
 * from its reviews on both sites. The series goes in the series columns, where
 * it belongs and where the UI already looks for it.
 *
 * ## Usage
 *
 *     npm run backfill:series                     # dry run, local database
 *     npm run backfill:series -- --commit
 *     npm run backfill:series -- --remote --commit
 *
 * Idempotent: a work that already carries a series is left alone unless
 * `--force`, so a person's correction outranks a re-run.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { detectSeriesFromTitle } from '../packages/core/src/titles.ts';

import { execute, lit, parseFlags, query, ROOT } from './lib/d1.mjs';
import { readEpub } from './lib/epub.mjs';
import { audiobookIndex, loadAudiobooks, AUDIOBOOK_ROOT } from './lib/audiobooks.mjs';

const flags = parseFlags();
const FORCE = process.argv.includes('--force');
const EBOOK_ROOT = process.env.EBOOK_ROOT || 'C:/Users/nbasl/OpenAudible/books';

const overrides = (() => {
  const p = path.join(ROOT, 'scripts/series-overrides.json');
  if (!existsSync(p)) return {};
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  // "_" keys are the file's own documentation, the same convention
  // `scripts/author_shelf_aliases.json` uses in the audiobook repo.
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
})();

/** The manifest, as a second source for a title the database has already stripped. */
const manifestTitles = (() => {
  const p = path.join(AUDIOBOOK_ROOT, 'site/ebooks.json');
  if (!existsSync(p)) return new Map();
  const data = JSON.parse(readFileSync(p, 'utf8'));
  return new Map(
    (data.ebooks ?? []).map((e) => [String(e.path ?? '').split('\\').join('/'), e.title]),
  );
})();

// ---------------------------------------------------------------------------

const works = query(
  `SELECT w.id, w.title, w.authors, w.work_key, w.series, w.series_index_sort,
          w.series_index_display,
          (SELECT e.source_url FROM edition e
            WHERE e.work_id = w.id AND e.source_url IS NOT NULL
            ORDER BY e.id LIMIT 1) AS source_url
     FROM work w
    ORDER BY w.id`,
  flags,
);

console.log(`${works.length} work(s) in the ${flags.remote ? 'REMOTE' : 'local'} database`);
if (works.length === 0) process.exit(0);

const abIndex = audiobookIndex(loadAudiobooks());

/** The title the FILE claims, which still carries the series the database lost. */
function richestTitle(work) {
  const rel = String(work.source_url ?? '').split('\\').join('/');
  if (rel) {
    const file = path.join(EBOOK_ROOT, rel);
    if (existsSync(file)) {
      try {
        const epub = readEpub(file, { cover: false });
        if (epub?.title) return epub.title;
      } catch { /* fall through to the manifest */ }
    }
    const fromManifest = manifestTitles.get(rel);
    if (fromManifest) return fromManifest;
  }
  return work.title;
}

const stats = { already: 0, override: 0, title: 0, audiobook: 0, none: 0 };
const misses = [];
const updates = [];
const found = [];

let n = 0;
for (const w of works) {
  if (n++ >= flags.limit) break;

  if (w.series && !FORCE) {
    stats.already++;
    continue;
  }

  let hit = null;
  let via = null;

  const override = overrides[w.work_key];
  if (override?.series) {
    hit = {
      series: override.series,
      index: override.index ?? null,
      display: override.display ?? null,
    };
    via = 'override';
  }

  if (!hit) {
    const parsed = detectSeriesFromTitle(richestTitle(w));
    if (parsed.series) {
      hit = { series: parsed.series, index: parsed.index, display: parsed.display };
      via = 'title';
    }
  }

  if (!hit) {
    const ab = abIndex.lookup(w.title, w.authors);
    if (ab?.row.series) {
      hit = {
        series: ab.row.series,
        index: ab.row.seriesIndexSort,
        display: ab.row.seriesIndexDisplay,
      };
      via = 'audiobook';
    }
  }

  if (!hit) {
    stats.none++;
    misses.push(`${w.title} — ${w.authors}`);
    continue;
  }

  stats[via]++;
  found.push({ id: w.id, title: w.title, via, ...hit });

  const same =
    w.series === hit.series &&
    w.series_index_sort === hit.index &&
    w.series_index_display === hit.display;
  if (!same) updates.push({ id: w.id, ...hit });
}

// ---------------------------------------------------------------------------

console.log('');
console.log(`from series-overrides.json  ${stats.override}`);
console.log(`from the book's own title   ${stats.title}`);
console.log(`from the audiobook catalog  ${stats.audiobook}`);
console.log(`already had one             ${stats.already}`);
console.log(`no series found             ${stats.none}`);

// ⚠️ Read the values, not the totals. The review backfill's dry run looked
// perfect at 860/860 and was writing keys no print edition could match;
// docs/info/identity-and-reviews.md §5 records that reading the output is what
// caught it. The same discipline applies to a series name.
const bySeries = new Map();
for (const f of found) bySeries.set(f.series, (bySeries.get(f.series) ?? 0) + 1);
console.log('');
console.log(`${bySeries.size} distinct series:`);
for (const [name, count] of [...bySeries].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ${name}`);
}

if (misses.length) {
  console.log('');
  console.log('No series found for:');
  for (const m of misses) console.log(`  ${m}`);
}

console.log('');
console.log(`${updates.length} row(s) to update`);
if (updates.length === 0) process.exit(0);

if (!flags.commit) {
  for (const u of found) {
    console.log(`  ${u.title}  ->  ${u.series} ${u.display ?? ''} (${u.via})`);
  }
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.');
  process.exit(0);
}

const sent = execute(
  updates.map(
    (u) =>
      `UPDATE work SET series = ${lit(u.series)}, series_index_sort = ${lit(u.index)},` +
      ` series_index_display = ${lit(u.display)}, updated_at = datetime('now')` +
      ` WHERE id = ${lit(u.id)};`,
  ),
  flags,
);

// Confirm by re-reading. `execute` cannot report rows changed — see its comment.
const after = query(
  `SELECT COUNT(*) AS total, COUNT(series) AS with_series,
          COUNT(DISTINCT series) AS distinct_series
     FROM work`,
  flags,
)[0];
console.log(
  `\n${sent} statement(s) run. ${after.with_series} of ${after.total} work(s) now carry one of` +
    ` ${after.distinct_series} series in the ${flags.remote ? 'REMOTE' : 'local'} database.`,
);
