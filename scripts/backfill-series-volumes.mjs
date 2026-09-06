#!/usr/bin/env node
/**
 * Ask the audiobook catalog what volumes each of our series has, and record the
 * answer — including the answer "it has never heard of it".
 *
 * ## What this is, and what it is deliberately not
 *
 * `packages/core/src/completeness.ts` already answers *"you own Cradle 1, 2 and
 * 4, so 3 is missing"* with no data source at all, and that answer cannot be
 * wrong. This script exists for the other half — *"the series has a book 14 and
 * you stop at 13"* — which is not derivable and must never be guessed.
 *
 * ⚠️ **The one rule.** Every row it writes carries `source =
 * 'audiobook_catalog'` and is a claim that *some volume exists*, never a claim
 * about how long the series is. `series_check.known_total` is left NULL by this
 * script and by every script: the sibling catalog is a record of what this
 * household bought, not of what a publisher printed, so its highest volume is a
 * floor. Reading it as a total would produce "6 of 12" with nothing behind the
 * 12 — the lie that looks like data.
 *
 * ## ⚠️ AMENDED 2026-09-05: the AUDIOBOOK RUNG'S DECISIONS ARE NOT IN THIS FILE
 *
 * Rung 1 moved to `packages/core/src/series-volumes.ts` (`planSeriesVolumes`)
 * and its SQL to `packages/db/src/series-volumes.ts`, so the CRON can reach the
 * identical rows — platform inventory §7 row #2: *"same input, same fetch, same
 * instance pair — once the CSV fetch and the shared parser exist, this costs one
 * function"*. The audiobook sweep's four-hourly tick
 * (`apps/worker/src/lib/audiobook-sweep-run.ts`) now plans this half from the
 * same parsed CSV it already fetches, under the same `AUDIOBOOK_SWEEP_MODE`.
 *
 * 🔴 **This script is NEVER retired**, for the three reasons the audiobook
 * backfill's header gives: it is the only path that works when the Worker is
 * down, it is what `docs/access/RECOVERY.md` assumes, and it runs offline
 * against a checkout. It is ALSO the more capable instrument — **rung 2 below,
 * Open Library, is script-only** and stays here.
 *
 * ⚠️ The two callers differ in exactly one respect, and it is the same one §2.4
 * of the association design already states: this script reads the CSV off DISK
 * out of the sibling checkout; the Worker fetches the identical bytes from
 * `audiobooks.heygabi.ai/catalog.csv`. When they disagree the ROUTE is the
 * staler side.
 *
 * ## The measured yield, 2026-08-10
 *
 * 1,075 audiobook rows, 331 distinct curated series. Against this library's 25:
 *
 * | | |
 * |---|---|
 * | series the sibling catalog knows | **12** |
 * | series it has never heard of | **13** — recorded as `not_found`, not as silence |
 *
 * The 13 misses are the light novels (High School DxD, Blade Dance), Cradle,
 * and the one-offs. They are a real answer and are written to `series_check` so
 * the next session does not re-ask, exactly as `series-overrides.json` records
 * "researched, no series" separately from "nobody has looked".
 *
 * ⚠️ Re-measured 2026-09-05 with the conversion: **MAIN 139 series — 32 known,
 * 107 never heard of; padhard 313 series — 44 known, 269 never heard of.** The
 * catalogue grew; the shape of the answer did not.
 *
 * ## ⚠️ Name matching, and why it is `normaliseTitle` and nothing else
 *
 * This library spells it "All The Skills"; the audiobook catalog spells it "All
 * the Skills". Those must meet. They meet through `normaliseTitle` — the
 * project's ONE fold, the same one `work_key` is built from — and through
 * nothing else. A bespoke comparison here would be the second matching rule this
 * codebase keeps warning about, and `packages/core/src/matching.ts` opens with
 * three wrong matches the sibling project shipped from exactly that mistake.
 *
 * The name **stored** is always this catalog's spelling, so `series_volume`
 * joins `work.series` exactly and no fold is needed at read time.
 *
 * ## Usage
 *
 *     npm run backfill:series-volumes                    # dry run, local
 *     npm run backfill:series-volumes -- --commit
 *     npm run backfill:series-volumes -- --remote --commit
 *     npm run backfill:series-volumes -- --remote --friend    # padhard, dry
 *
 * Idempotent: the upsert keys on (series, index_sort) and a second run reports
 * nothing to write. It never touches a `manual` row — a person's answer is not
 * a CSV's to overwrite.
 */

import { planSeriesVolumes } from '../packages/core/src/series-volumes.ts';
import { seriesVolumeStatements } from '../packages/db/src/series-volumes.ts';

import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { loadAudiobooks } from './lib/audiobooks.mjs';
import { renderStatements } from './lib/sweep-sql.mjs';

const flags = parseFlags();

// ---------------------------------------------------------------------------
// What we hold
//
// ⚠️ Read as WORKS, not as a GROUP BY, because the planner groups them — the
// route reads the same rows out of D1 and the two must not group them two ways.
// The count printed below is the number of distinct series, exactly as before.
// ---------------------------------------------------------------------------

const works = query(
  `SELECT series, series_index_sort FROM work WHERE series IS NOT NULL ORDER BY id`,
  flags,
);

const existing = query('SELECT series, index_sort, source FROM series_volume', flags);
const known = new Set(existing.map((r) => `${r.series}|${r.index_sort}`));
const manual = new Set(
  existing.filter((r) => r.source === 'manual').map((r) => `${r.series}|${r.index_sort}`),
);

const audiobooks = loadAudiobooks();

// ---------------------------------------------------------------------------
// Rung 1 — the sibling catalog. THE DECISIONS ARE IN `@lc/core`.
// ---------------------------------------------------------------------------

const plan = planSeriesVolumes({
  works: works.map((w) => ({
    series: w.series,
    seriesIndexSort: w.series_index_sort == null ? null : Number(w.series_index_sort),
  })),
  audiobooks,
  existing: existing.map((r) => ({
    series: r.series,
    indexSort: Number(r.index_sort),
    source: r.source,
  })),
});

console.log(
  `${plan.report.seriesCount} series in the ${flags.remote ? 'REMOTE' : 'local'} database`,
);
if (plan.report.seriesCount === 0) process.exit(0);
console.log(`${audiobooks.length} audiobook row(s) read from the sibling catalog`);

const statements = renderStatements(seriesVolumeStatements(plan));
const report = plan.report.entries;
const found = plan.report.found;
const notFound = plan.report.notFound;
let newVolumes = plan.report.newVolumes;

// ---------------------------------------------------------------------------
// Rung 2: Open Library, for the works that carry an id
//
// 🔴 SCRIPT-ONLY, and it is why the script is the more capable instrument. It
// makes one HTTP call per work carrying an Open Library id, serially, with a
// politeness delay — 45 works is ten seconds and a thousand would be minutes,
// which is a cron tick's whole subrequest budget spent on the smaller half of
// the answer. The Worker does rung 1 and defers this one to a person.
//
// ⚠️ READ THE EDITION RECORDS, NOT THE SEARCH INDEX. This rung was nearly not
// built, on a measurement that used the wrong source — and the difference is
// the whole point of it:
//
//   | source consulted                        | Cradle volumes found |
//   | search.json titles ("(Volume N)" in the name) | 3 — [2,4,5]     |
//   | /works/<id>/editions.json series+subtitle     | **12 — all of them** |
//
// The index is impoverished and the edition records are not. It is the same
// trap covers-and-series §3.1 records for the `series` field, met again from a
// different direction, and it is worth stating twice: **anything that concludes
// "Open Library does not know" from search.json is reading the wrong endpoint.**
//
// What Open Library still cannot do is enumerate a series it has not already
// linked to a work we hold: `series:"Cradle"` is a fuzzy full-text match that
// returns Cat's Cradle, and `/series/<name>` is the *lists* endpoint, which
// rejects anything that is not an `OL…L` id. So this rung is only ever as broad
// as `work.openlibrary_work_id` is populated.
//
// It attests volumes the same way the audiobook rung does. It NEVER writes a
// series length: `series_check.known_total` stays NULL, because nothing here
// can say how long a series is.
// ---------------------------------------------------------------------------

const olReport = [];
const mismatches = [];

if (!process.argv.includes('--no-openlibrary')) {
  const { editionsOfWork } = await import('../packages/isbn/src/works.ts');
  const { seriesMentioned, volumeStatedIn } = await import('../packages/core/src/corroboration.ts');

  const withIds = query(
    `SELECT id, title, series, series_index_sort, openlibrary_work_id
       FROM work
      WHERE openlibrary_work_id IS NOT NULL AND series IS NOT NULL
      ORDER BY series, series_index_sort`,
    flags,
  );
  console.log(`\n${withIds.length} work(s) carry an Open Library id — asking for their editions`);

  const olSeen = new Map(); // series -> Set(volume)
  for (const w of withIds) {
    let editions = [];
    try {
      editions = await editionsOfWork(w.openlibrary_work_id, { limit: 50 });
    } catch (e) {
      console.warn(`  [skip] ${w.title}: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    // Every string on the edition that could name the series and its volume.
    // Open Library puts it in `series` sometimes and in `subtitle` others — the
    // covers-and-series §3.1 finding, and the reason both are read here.
    for (const ed of editions) {
      for (const text of [...(ed.series ?? []), ed.subtitle ?? ''].filter(Boolean)) {
        if (!seriesMentioned(text, w.series)) continue;
        const vol = volumeStatedIn(text);
        if (vol === null) continue;
        if (!olSeen.has(w.series)) olSeen.set(w.series, new Set());
        olSeen.get(w.series).add(vol);

        // ⚠️ The cross-check. Advisory ONLY — it never writes to
        // work.series_index_sort. Our value is the one a person set or a file
        // stated; Open Library holds duplicate and mislabelled work records
        // (Skysworn had two, and `Unsouled` matched a different book entirely at
        // title 1.0 / author 1.0). A disagreement is a question for a human, not
        // a correction to apply, so it is printed and nothing more.
        if (w.series_index_sort != null && vol !== w.series_index_sort) {
          mismatches.push({ title: w.title, series: w.series, ours: w.series_index_sort, theirs: vol, text });
        }
      }
    }
    await new Promise((r) => setTimeout(r, 120)); // be a polite client
  }

  for (const [series, vols] of olSeen) {
    let added = 0;
    for (const v of [...vols].sort((a, b) => a - b)) {
      const key = `${series}|${v}`;
      if (manual.has(key)) continue; // a person's row outranks a fetched one
      if (!known.has(key)) added++;
      statements.push(
        `INSERT INTO series_volume (series, index_sort, source, source_url)` +
          ` VALUES (${lit(series)}, ${lit(v)}, 'openlibrary', 'https://openlibrary.org/')` +
          ` ON CONFLICT(series, index_sort) DO UPDATE SET` +
          ` source = CASE WHEN series_volume.source = 'manual' THEN series_volume.source` +
          ` ELSE excluded.source END;`,
      );
    }
    newVolumes += added;
    olReport.push({ series, top: Math.max(...vols), count: vols.size, added });
  }
}

// ---------------------------------------------------------------------------
// ⚠️ Read the rows, not the totals.
//
// The review backfill's dry run said 860/860 matched and was writing keys no
// print edition could ever meet (docs/info/identity-and-reviews.md §5). What
// caught it was printing the values. So this prints, per series, what the
// sibling catalog claims and how it compares with our shelf — because "the CSV
// tops out below where we already are" is the shape of a bad match, not a gap.
// ---------------------------------------------------------------------------

console.log('');
console.log(`the sibling catalog knows  ${found}`);
console.log(`never heard of it          ${notFound}`);
console.log('');

for (const r of [...report].sort((a, b) => a.series.localeCompare(b.series))) {
  if (r.outcome === 'not_found') {
    console.log(`  --   ${r.series}  (recorded as not_found)`);
    continue;
  }
  const beyond = r.abTop != null && r.top != null && r.abTop > r.top ? `  +${r.abTop - r.top} beyond our top` : '';
  const under = r.abTop != null && r.top != null && r.abTop < r.top ? '  ⚠️ tops out BELOW our top' : '';
  const renamed = r.abName !== r.series ? `  ("${r.abName}" there)` : '';
  // ⚠️ `theirs→-` where this printed `theirs→-Infinity` until 2026-09-05. The
  // old text came from `Math.max()` over an empty set: the sibling catalog KNOWS
  // the series but numbers none of its rows (The Hunger Games, on MAIN). It also
  // made that line claim "⚠️ tops out BELOW our top", which is a different and
  // untrue fact — a catalog that numbers nothing has no top to compare.
  console.log(
    `  ok   ${r.series}  ours→${r.top ?? '-'}  theirs→${r.abTop ?? '-'}  ${r.added} new${beyond}${under}${renamed}`,
  );
}

if (olReport.length) {
  console.log('');
  console.log('open library:');
  for (const r of olReport.sort((a, b) => a.series.localeCompare(b.series))) {
    console.log(`  ${r.series}  states volume(s) up to ${r.top}  (${r.count} named, ${r.added} new)`);
  }
}

// ⚠️ The cross-check output is the point of the second rung, not the volumes.
// Our series_index_sort stays authoritative — this is a question, not a patch.
console.log('');
if (mismatches.length === 0) {
  console.log('cross-check: no disagreement between our series_index_sort and Open Library');
} else {
  console.log(`cross-check: ⚠️ ${mismatches.length} disagreement(s) — OUR VALUE IS KEPT, look at these:`);
  for (const m of mismatches) {
    console.log(`  ${m.title}  —  ours ${m.ours}, Open Library ${m.theirs}   ("${m.text}")`);
  }
}

console.log('');
console.log(`${newVolumes} volume(s) this run has not seen before, ${statements.length} statement(s)`);

if (!flags.commit) {
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.');
  process.exit(0);
}

const sent = execute(statements, flags);

// Confirm by re-reading. `execute` cannot report rows changed — see its comment
// in scripts/lib/d1.mjs; miniflare omits `meta.changes` entirely.
const after = query(
  `SELECT (SELECT COUNT(*) FROM series_volume) AS volumes,
          (SELECT COUNT(DISTINCT series) FROM series_volume) AS series,
          (SELECT COUNT(*) FROM series_check) AS checked,
          (SELECT COUNT(*) FROM series_check WHERE outcome = 'not_found') AS not_found`,
  flags,
)[0];

console.log(
  `\n${sent} statement(s) run. ${after.volumes} attested volume(s) across ${after.series} series;` +
    ` ${after.checked} series checked, ${after.not_found} with nothing found, in the` +
    ` ${flags.remote ? 'REMOTE' : 'local'} database.`,
);
