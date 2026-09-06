#!/usr/bin/env node
/**
 * Ask the sibling audiobook catalog which of our books we already own on audio,
 * and cache the answer — in `audiobook_holding` (migration 0010) for the books
 * this catalog knows, and in `audiobook_series_holding` (migration 0090) for the
 * ones it does not.
 *
 * ## ⚠️ The second table exists because the first one structurally cannot answer
 *
 * `audiobook_holding.work_id` is `PRIMARY KEY REFERENCES work(id)`. A book owned
 * ONLY on audio has no work row here, so it cannot be written down at all, and
 * the series ladder drew it as a hole. Measured 2026-08-11: the household holds
 * all seven Stormlight Archive audiobooks and this catalog holds one of those
 * titles as an ebook, so `/series/The Stormlight Archive` reported six missing
 * books that are in the house. About 397 audiobook rows have no work row here.
 *
 * Phase 2 below therefore joins on `(series, index_sort)` — the only two things
 * a gap rung has — and never on a title. That is the point: containment matching
 * is what produced the flat lie "All 5 held on audio" on Tamer, and there is no
 * title comparison anywhere in phase 2 to produce another.
 *
 * ## Why a script and not a route
 *
 * The same reason `backfill:series-volumes` is a script, stated in the header of
 * `apps/worker/src/routes/series.ts`: the only source is
 * `audiobook_catalog/site/catalog.csv`, a **file on disk beside this repo**,
 * which a Worker cannot read and a script can. `docs/info/decisions.md` §2
 * records that an `alsoInAudio` flag was dropped from the scan screen for this — the
 * Worker holds no audiobook data, so the field would have answered `false` for
 * every book in the house. This is that flag, arrived at from the other side: a
 * script does the reading, the database carries the verdict, and the Worker
 * only ever reads a table.
 *
 * ## ⚠️ AMENDED 2026-09-05: the DECISIONS are no longer in this file
 *
 * Phases 1 and 2 moved to `packages/core/src/audiobook-sweep.ts`
 * (`planAudiobookSweep`), the CSV parse and row mapping to
 * `packages/core/src/audiobook-csv.ts`, the series-canon rule to
 * `packages/core/src/series-canon.ts`, and the SQL rendering to
 * `scripts/lib/audiobook-sql.mjs`. **One planner, two callers**: this script,
 * and the route/cron built on it in the later phases of
 * `catalog-platform/docs/info/audiobook-association-route.md`. The paragraph
 * above is still true of THIS file — it reads the disk and a Worker cannot —
 * but the reason the Worker can now do the job at all is that it fetches the
 * identical bytes from `audiobooks.heygabi.ai/catalog.csv` and runs the
 * identical planner over them.
 *
 * 🔴 **This script is NEVER retired** (§8). It is the only path that works when
 * the Worker is down, it is the recovery tool `docs/access/RECOVERY.md` assumes,
 * and it runs offline and before a deploy against a checkout. What it became is
 * a thin caller of the planner the route also uses — which is the point.
 *
 * ⚠️ The two callers differ in exactly ONE respect, stated out loud in §2.4:
 * this script reads `catalog-platform/data/series-canon.json` LIVE out of the
 * sibling checkout, and the Worker reads the copy materialised into
 * `packages/universes/generated/` at build time. When they disagree the ROUTE is
 * the stale one.
 *
 * ## ⚠️ Matching goes through `matchIndexedWork` and nothing else
 *
 * `audiobookIndex()` in `scripts/lib/audiobooks.mjs` wraps the project's ONE
 * matcher, and this script calls it rather than comparing strings itself.
 * `packages/core/src/matching.ts` opens with three wrong-game matches the sibling
 * Board Game Catalog shipped, every one from a second similarity function
 * drifting from the first. The author gate is what stops *Firefight* reaching a
 * different book called Firefight, and containment is what lets this library's
 * "Oathbound Healer - MM" meet the audiobook catalog's "Oathbound Healer".
 *
 * `matched_via` is stored and shown, because a containment match is a weaker
 * claim than an exact one and the page that displays it should say so.
 *
 * ## ⚠️ Our aliases are asked too, and that is where the yield is
 *
 * The index is built over the *audiobook* rows, which carry no aliases. Ours
 * live in `work_alias` on our side, so they only help if this script asks under
 * them — which it does, one extra `matchIndexedWork` call per alias rather than
 * a looser comparison. That distinction is the whole reason the alias table has
 * a `kind` column (migration 0005): a title alias is offered as a title and an
 * author alias as an author, never the other way round, because letting an
 * alternate title widen the *author* gate is the one thing `matching.ts` says
 * must not happen.
 *
 * Measured against production 2026-08-10: the printed name alone matched 35 of
 * 154 works; asking under the ten recorded aliases as well is what reaches the
 * five *He Who Fights with Monsters* volumes, which Audible files under
 * **Shirtaloon** and this catalog files under Travis Deverell.
 *
 * ## Usage
 *
 *     npm run backfill:audiobooks                        # dry run, local
 *     npm run backfill:audiobooks -- --commit
 *     npm run backfill:audiobooks -- --remote            # dry run, READ THE LIST
 *     npm run backfill:audiobooks -- --remote --commit
 *
 * Idempotent. A second run reports nothing new, and a work that no longer
 * matches is marked `stale_at` rather than deleted — migration 0003's rule,
 * because a row vanishing looks identical to the audiobook having gone away.
 *
 * ⚠️ Requires migrations 0010, **0090 and 0390**. Against a database without
 * them, every statement for that table fails with `no such table: …`.
 *
 * ## ⚠️ Since 0390 this writes `audiobook_edition_holding`, not the view
 *
 * `audiobook_holding` is now a VIEW picking one whole row per work, and a view
 * cannot be written. The rows live in `audiobook_edition_holding`, keyed
 * `(work_id, audio_key)` where `audio_key` is the sibling catalog's verbatim
 * title. That is what lets the household's TWO Elantris recordings both be
 * stored instead of one silently overwriting the other — and it is why the
 * lookup below is `lookupAll`, which shares every gate with `lookup` and only
 * declines to stop at the first answer.
 */

import { execute, parseFlags, query } from './lib/d1.mjs';
import {
  groupWorkAliases,
  planAudiobookSweep,
} from '../packages/core/src/audiobook-sweep.ts';
import { renderSweepStatements } from './lib/audiobook-sql.mjs';
import { AUDIOBOOK_CSV, loadAudiobooks } from './lib/audiobooks.mjs';
import { canonicalSeries } from './lib/series-canon.mjs';
// Reported, never written — see the block near the end of this file, and that
// module's header for why the CHECK constraint on `matched_via` makes writing a
// curated row a migration rather than an edit.
import { checkCuratedLinks, loadCuratedOverrides } from './lib/cross-catalog-overrides.mjs';

const flags = parseFlags();

// ---------------------------------------------------------------------------
// What we hold
// ---------------------------------------------------------------------------

// ⚠️ `query()` refuses SQL over 6000 characters and this is nowhere near it —
// but it returns one row per work, so the RESULT grows with the catalog while
// the query does not. That is the right way round; see the note on query().
// `series_index_sort` rides along for phase 2, where a work whose volume number
// agrees on both sides is what upgrades a series mapping from a guess to a fact.
const works = query(
  'SELECT id, title, authors, series, series_index_sort FROM work ORDER BY id',
  flags,
);

console.log(`${works.length} work(s) in the ${flags.remote ? 'REMOTE' : 'local'} database`);
if (works.length === 0) process.exit(0);

// ⚠️ The TABLE, not the view. Since migration 0390 `audiobook_holding` is a
// read-only VIEW showing one whole row per work; the rows live in
// `audiobook_edition_holding`, keyed `(work_id, audio_key)`, and this script is
// its only writer. Reading the view here would hide every second edition from
// the stale sweep below, which could then never mark one.
const existing = query(
  'SELECT work_id, audio_key, title, stale_at FROM audiobook_edition_holding',
  flags,
);

// The other names our books answer to. Scoped per work and kept apart by kind —
// see the header, and `WORK_ALIAS_KINDS` in packages/core/src/constants.ts.
//
// ⚠️ Grouped by `@lc/core`'s `groupWorkAliases` — the same call the planner
// makes — so the two counts printed here and the name pairs actually asked
// about cannot come from two different groupings.
const aliasRows = query('SELECT work_id, alias, kind FROM work_alias', flags);
const aliases = groupWorkAliases(
  aliasRows.map((a) => ({ workId: Number(a.work_id), alias: a.alias, kind: a.kind })),
);
console.log(
  `${aliasRows.length} alias row(s): ${aliases.titles.size} work(s) with another title,` +
    ` ${aliases.authors.size} with another author`,
);

// ---------------------------------------------------------------------------
// What the sibling catalog has
// ---------------------------------------------------------------------------

const audiobooks = loadAudiobooks();
console.log(`${audiobooks.length} audiobook row(s) read from ${AUDIOBOOK_CSV}`);

// ⚠️ Zero rows is not "we own no audiobooks" — it is "the file was not found",
// which in a git worktree is the ordinary case. Failing loudly here rather than
// writing a sweep that marks every existing row stale.
if (audiobooks.length === 0) {
  console.error(
    '\nNo audiobook rows were read. That is a missing file, not an empty catalog —\n' +
      'running on would mark every existing holding stale. Set LC_AUDIOBOOK_ROOT to\n' +
      'the audiobook_catalog checkout and try again.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The plan — DATA, not SQL
//
// ⚠️ Phases 1 and 2 live in `packages/core/src/audiobook-sweep.ts` now (phase 0
// of `catalog-platform/docs/info/audiobook-association-route.md`). They are the
// DECISIONS — which editions a work reaches, `VIA_RANK` tie-breaking, which
// rungs exist, `corroborated`, what goes stale — and the Worker has to reach
// the IDENTICAL ones, so they cannot live in a file only Node can run. Every
// rule and every measurement that justified it moved with them; read that file
// beside this header, not instead of it.
//
// What stayed here is the RENDERING. `planAudiobookSweep` hands back rows, and
// this file turns them into the same `lit()`-interpolated SQL it always built.
// A planner that returned SQL could only ever have had one caller — that is
// §2.3, and it is the whole hinge of the extraction.
//
// 🔴 `scope: { kind: 'all' }`, and only this caller may say so. The script IS
// the full sweep, so a row it did not reproduce is genuinely gone. The route's
// on-add hook passes `{ kind: 'works', ids }`, has looked at one book, and
// therefore marks NOTHING stale — §6.2 guard 3.
//
// ⚠️ `canonicalSeries` is INJECTED, and this caller injects the LIVE cross-repo
// read (`scripts/lib/series-canon.mjs`). The Worker injects the generated copy
// instead. §2.4 states that skew out loud and says the route is the stale side.
// ---------------------------------------------------------------------------

const existingRungs = query(
  'SELECT series, index_sort, stale_at FROM audiobook_series_holding',
  flags,
);

const plan = planAudiobookSweep({
  works: works.map((w) => ({
    id: w.id,
    title: w.title,
    authors: w.authors,
    series: w.series,
    seriesIndexSort: w.series_index_sort == null ? null : Number(w.series_index_sort),
  })),
  aliases,
  audiobooks,
  existingEditions: existing.map((r) => ({
    workId: Number(r.work_id),
    audioKey: r.audio_key,
    staleAt: r.stale_at,
  })),
  existingRungs: existingRungs.map((r) => ({
    series: r.series,
    indexSort: Number(r.index_sort),
    staleAt: r.stale_at,
  })),
  canonicalSeries,
  scope: { kind: 'all' },
});

const { report } = plan;
// ⚠️ The rendering lives in `scripts/lib/audiobook-sql.mjs` so it can be TESTED:
// this file reads two databases at import time, so nothing can import it. The
// statement order is part of the contract — edition upserts, edition stales,
// rung upserts, rung stales — and `scripts/test/backfill-audiobook-holdings.test.mjs`
// pins the exact SQL for a fixture plan.
const statements = renderSweepStatements(plan);

// ---------------------------------------------------------------------------
// ⚠️ Read the rows, not the totals.
//
// The review backfill's dry run said 860/860 matched while writing keys no print
// edition could ever meet (identity-and-reviews.md §5). What caught it was
// printing the values. So every match is printed with the name it matched, and
// the ones made by containment — the rung that shipped three wrong games in the
// sibling project — are printed in their own list to be read rather than
// skimmed.
// ---------------------------------------------------------------------------

const pct = (n) => `${((n / works.length) * 100).toFixed(0)}%`;
const byVia = (v) => report.byVia[v];

console.log('');
console.log(`matched an audiobook   ${report.matched.length}  (${pct(report.matched.length)})`);
console.log(`  exact title          ${byVia('exact')}`);
console.log(`  a recorded alias     ${byVia('alias')}`);
console.log(`  containment          ${byVia('containment')}`);
console.log(`  (of those, reached only through one of our aliases: ${report.viaAliasCount})`);
console.log(`no audiobook found     ${report.missed.length}  (${pct(report.missed.length)})`);
console.log('');
// ⚠️ Migration 0390's number, and the one to watch. Before it, a work with two
// recordings kept whichever the upsert wrote last — and for work 514 that was
// the edition with NO series, while the one that knew "Elantris, volume 1" was
// silently discarded. A count of 0 here does not mean the household owns no
// second editions; it means none of them cleared the matcher's unchanged gates.
console.log(`audio editions written ${report.liveEditions.length}`);
console.log(`works with >1 edition  ${report.multiEdition.length}`);
for (const m of report.multiEdition.sort((a, b) => a.work.title.localeCompare(b.work.title))) {
  console.log(`  ${m.work.title}  (work ${m.work.id})`);
  for (const e of m.editions) {
    const bits = [
      e.row.series ? `series "${e.row.series}"${e.row.seriesIndexDisplay ? ` ${e.row.seriesIndexDisplay}` : ''}` : 'no series',
      e.row.narrator ? `read by ${e.row.narrator}` : 'no narrator stated',
      `${e.via} ${e.similarity.toFixed(2)}`,
    ];
    console.log(`    "${e.row.rawTitle}"  —  ${bits.join(' · ')}`);
  }
}
console.log('');

// ---------------------------------------------------------------------------
// The hand-reviewed cross-catalog joins — reported, never written
// ---------------------------------------------------------------------------
//
// ⚠️ This sweep does NOT write curated rows and cannot: `matched_via` is
// `CHECK (matched_via IN ('exact','alias','containment'))` (migration 0390,
// inherited from 0010), so a 'curated' value needs a table rebuild plus its
// view, on two production databases. Migration 0110 already settled the shape
// that decision should take when somebody makes it — an owner-confirmed link
// got its OWN TABLE rather than a new enum value.
//
// What this DOES is say out loud whether the reviewed pairs still resolve. The
// four the owner named (2026-09-02) reach their audiobooks only because two
// `work_alias` rows exist — delete either and two of his four acceptance links
// vanish with nothing failing anywhere. One line per run is what makes that
// visible in the pipeline log instead of on the page, months later.
//
// ⚠️ NEVER THROWS. This script is pipeline STEP 11 (`_run_sibling_link`), which
// is required to produce exactly one named line on every path and to leave the
// holdings sweep unaffected by anything the overrides file does. A file that is
// missing, malformed or contradicted is a REPORT, not a failure — the thing
// that fails on it is `npm run check:cross-links`, run deliberately.
try {
  const curated = loadCuratedOverrides();
  if (curated.length === 0) {
    console.log('curated cross-links    none on file');
  } else {
    // ⚠️ The plan carries the live edition set as ROWS already — the NUL-joined
    // key it used internally never leaves `@lc/core`, so this file no longer
    // splits one apart. `stale_at` is null by construction: every entry here is
    // an edition THIS run stands behind.
    const holdingRows = report.liveEditions.map((e) => ({
      work_id: e.workId,
      audio_key: e.audioKey,
      stale_at: null,
    }));
    const { unknownWorkId, unresolved, resolved } = checkCuratedLinks(curated, works, holdingRows);
    console.log(
      `curated cross-links    ${resolved.length} resolved, ${unresolved.length} unresolved, ` +
        `${unknownWorkId.length} unknown work id(s)`,
    );
    for (const o of [...unresolved, ...unknownWorkId]) {
      console.log(`  ⚠️  work ${o.libraryWorkId} <-> "${o.audiobookTitle}" — run npm run check:cross-links`);
    }
  }
} catch (e) {
  // Named, not swallowed: "could not check" must never read as "all clear".
  console.log(`curated cross-links    NOT CHECKED — ${e.message}`);
}
console.log('');

for (const m of [...report.matched].sort((a, b) => a.work.title.localeCompare(b.work.title))) {
  const same = m.work.title === m.row.title;
  console.log(
    `  ${m.via.padEnd(11)} ${m.similarity.toFixed(2)}  ${m.work.title}` +
      (same ? '' : `\n${' '.repeat(20)}↳ "${m.row.title}" there`) +
      (m.alias ? `\n${' '.repeat(20)}↳ via our alias "${m.alias}"` : ''),
  );
}

const loose = report.matched.filter((m) => m.via === 'containment');
if (loose.length) {
  console.log('');
  console.log(`⚠️ ${loose.length} match(es) rest on containment — read these before committing:`);
  for (const m of loose) {
    console.log(`  "${m.work.title}"  ←→  "${m.row.title}"  (${m.similarity.toFixed(2)})`);
  }
}

if (report.missed.length) {
  console.log('');
  console.log('no audiobook:');
  for (const w of report.missed.sort((a, b) => a.title.localeCompare(b.title))) {
    console.log(`  ${w.title}`);
  }
}

if (report.editionsGoneStale) {
  console.log('');
  console.log(`${report.editionsGoneStale} existing edition(s) no longer match and will be marked stale.`);
}

// ---------------------------------------------------------------------------
// ⚠️ Read the `fold` list. It is the one that can be wrong.
//
// A `work_match` series had a book independently identified by title AND author
// AND volume number, so its rungs render as a flat AUDIO. A `fold` series has
// nothing behind it but two names folding together, renders AUDIO?, and is still
// counted as missing. Printed apart so the weaker list is read rather than
// skimmed — the same reason the containment matches above get their own block.
// ---------------------------------------------------------------------------

console.log('');
console.log(`series with audio rungs   ${report.rungs.length}`);
console.log(`  corroborated by a work  ${report.rungs.filter((r) => r.via === 'work_match').length}`);
console.log(`  series name only        ${report.rungs.filter((r) => r.via === 'fold').length}`);

for (const r of report.rungs.sort((a, b) => a.series.localeCompare(b.series))) {
  const renamed = r.abName !== r.series ? `  ("${r.abName}" there)` : '';
  console.log(
    `  ${r.via.padEnd(11)} ${r.series}  ${r.indexes.length} rung(s) [${r.indexes.join(',')}]` +
      `  ${r.fresh} new${renamed}`,
  );
}

const hedged = report.rungs.filter((r) => r.via === 'fold');
if (hedged.length) {
  console.log('');
  console.log(
    `⚠️ ${hedged.length} series map on the folded name alone — every rung renders AUDIO?:`,
  );
  for (const r of hedged) console.log(`  "${r.series}"  ←→  "${r.abName}"`);
}

if (report.rungsGoneStale) {
  console.log('');
  console.log(`${report.rungsGoneStale} audio rung(s) no longer match and will be marked stale.`);
}

console.log('');
console.log(`${statements.length} statement(s) to run.`);

if (!flags.commit) {
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.');
  process.exit(0);
}

const sent = execute(statements, flags);

// Confirm by re-reading. `execute` cannot report rows changed — see its comment
// in scripts/lib/d1.mjs; miniflare omits `meta.changes` entirely.
const after = query(
  `SELECT (SELECT COUNT(*) FROM audiobook_edition_holding) AS all_rows,
          (SELECT COUNT(*) FROM audiobook_edition_holding WHERE stale_at IS NULL) AS live_rows,
          (SELECT COUNT(*) FROM audiobook_holding) AS view_rows,
          (SELECT COUNT(*) FROM audiobook_series_holding) AS all_rungs,
          (SELECT COUNT(*) FROM audiobook_series_holding WHERE stale_at IS NULL) AS live_rungs`,
  flags,
)[0];

console.log(
  `\n${sent} statement(s) run. ${after.live_rows ?? 0} live edition(s) of ${after.all_rows} row(s)` +
    ` across ${after.view_rows} work(s) in the audiobook_holding view,` +
    ` and ${after.live_rungs ?? 0} live audio rung(s) of ${after.all_rungs}, in the` +
    ` ${flags.remote ? 'REMOTE' : 'local'} database.`,
);
