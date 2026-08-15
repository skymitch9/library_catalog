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
 * which a Worker cannot read and a script can. `docs/HANDOFF.md` records that an
 * `alsoInAudio` flag was dropped from the scan screen for exactly this — the
 * Worker holds no audiobook data, so the field would have answered `false` for
 * every book in the house. This is that flag, arrived at from the other side: a
 * script does the reading, the database carries the verdict, and the Worker
 * only ever reads a table.
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
 * ⚠️ Requires migrations 0010 **and 0090**. Against a database without either,
 * every statement for that table fails with `no such table: …`.
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { normaliseTitle } from '../packages/core/src/titles.ts';
import { AUDIOBOOK_CSV, audiobookIndex, loadAudiobooks } from './lib/audiobooks.mjs';
import { canonicalSeries } from './lib/series-canon.mjs';

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

const existing = query(
  'SELECT work_id, title, stale_at FROM audiobook_holding',
  flags,
);
const held = new Map(existing.map((r) => [Number(r.work_id), r]));

// The other names our books answer to. Scoped per work and kept apart by kind —
// see the header, and `WORK_ALIAS_KINDS` in packages/core/src/constants.ts.
const aliasRows = query('SELECT work_id, alias, kind FROM work_alias', flags);
const titleAliases = new Map();
const authorAliases = new Map();
for (const a of aliasRows) {
  const into = a.kind === 'author' ? authorAliases : titleAliases;
  const list = into.get(Number(a.work_id));
  if (list) list.push(a.alias);
  else into.set(Number(a.work_id), [a.alias]);
}
console.log(
  `${aliasRows.length} alias row(s): ${titleAliases.size} work(s) with another title,` +
    ` ${authorAliases.size} with another author`,
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

const index = audiobookIndex(audiobooks);

// ---------------------------------------------------------------------------

const statements = [];
const matched = [];
const missed = [];

/** Strongest first. A rung that claims less never displaces one that claims more. */
const VIA_RANK = { exact: 0, alias: 1, containment: 2 };

/**
 * Every name pair worth asking under: the printed one first, then the recorded
 * aliases.
 *
 * ⚠️ The printed pair is always tried first and wins ties, so a work with
 * aliases can only ever gain a match, never have one replaced by a weaker route.
 */
function attempts(w) {
  const titles = [null, ...(titleAliases.get(Number(w.id)) ?? [])];
  const authors = [null, ...(authorAliases.get(Number(w.id)) ?? [])];
  const out = [];
  for (const t of titles) {
    for (const a of authors) {
      out.push({
        title: t ?? w.title,
        authors: a ?? w.authors,
        // Which alias, if any, this attempt is spending. Null for the printed
        // pair; the alias string when one is in play, so the row can record it.
        alias: t && a ? `${t} / ${a}` : (t ?? a),
      });
    }
  }
  return out;
}

for (const w of works) {
  let best = null;
  // Our own volume number, when we have one — see `attempts` above for why
  // title/author are per-attempt but this is not: an alias never changes
  // which physical book #w is, so its volume number is the same on every
  // attempt. Only ever consulted by an ambiguous-fold match (Space Knight);
  // every other match is unaffected. See matching.ts `disambiguateByVolume`.
  const seriesIndex = w.series_index_sort == null ? null : Number(w.series_index_sort);
  for (const attempt of attempts(w)) {
    const hit = index.lookup(attempt.title, attempt.authors, seriesIndex);
    if (!hit) continue;
    const better =
      !best ||
      VIA_RANK[hit.via] < VIA_RANK[best.via] ||
      (VIA_RANK[hit.via] === VIA_RANK[best.via] && hit.similarity > best.similarity);
    if (better) best = { ...hit, alias: attempt.alias };
    // Nothing beats an exact match on the printed name; stop asking.
    if (best.via === 'exact' && best.alias === null) break;
  }

  if (!best) {
    missed.push(w);
    continue;
  }
  matched.push({ work: w, ...best });

  statements.push(
    `INSERT INTO audiobook_holding (work_id, title, authors, series, index_display,` +
      ` index_sort, cover_href, matched_via, title_similarity, via_alias)` +
      ` VALUES (${lit(w.id)}, ${lit(best.row.title)}, ${lit(best.row.authors)},` +
      ` ${lit(best.row.series)}, ${lit(best.row.seriesIndexDisplay)},` +
      ` ${lit(best.row.seriesIndexSort)}, ${lit(best.row.coverHref)},` +
      ` ${lit(best.via)}, ${lit(Number(best.similarity.toFixed(4)))}, ${lit(best.alias)})` +
      ` ON CONFLICT(work_id) DO UPDATE SET` +
      ` title = excluded.title, authors = excluded.authors, series = excluded.series,` +
      ` index_display = excluded.index_display, index_sort = excluded.index_sort,` +
      ` cover_href = excluded.cover_href, matched_via = excluded.matched_via,` +
      ` title_similarity = excluded.title_similarity, via_alias = excluded.via_alias,` +
      ` last_seen_at = datetime('now'), stale_at = NULL;`,
  );
}

// A holding whose work no longer matches anything. Marked, never deleted.
const matchedIds = new Set(matched.map((m) => Number(m.work.id)));
const goneStale = [...held.values()].filter(
  (r) => !matchedIds.has(Number(r.work_id)) && !r.stale_at,
);
for (const r of goneStale) {
  statements.push(
    `UPDATE audiobook_holding SET stale_at = datetime('now')` +
      ` WHERE work_id = ${lit(r.work_id)} AND stale_at IS NULL;`,
  );
}

// ---------------------------------------------------------------------------
// Phase 2 — the rungs with no work row at all (migration 0090)
//
// ⚠️ Joined on `(series, index_sort)` and on nothing else. A gap rung has no
// title — `completeness.ts` cannot even name an `interior` hole — so there is
// nothing to match, which is exactly why this is safe: containment matching is
// what shipped three wrong games in the sibling project and the flat "All 5
// held on audio" claim here, and there is none of it below.
//
// ## The fold, and why it is `normaliseTitle`
//
// The two catalogs disagree about spelling: "All the Skills" there, "All The
// Skills" here. Three folds exist in this estate and only one is right for this:
//
//   • `normaliseTitle` — the project's ONE fold, and ALREADY the series-name
//     fold: `backfill-series-volumes.mjs` has resolved these same two spellings
//     with it since it was written, and the rows it writes are what this table
//     annotates. A second rule here would be the second-matching-function
//     mistake `matching.ts` opens with.
//   • `normaliseUniverseText` — keeps leading articles ON PURPOSE, because the
//     universe list holds "The Cosmere" and "Cosmere" as different entries.
//     Measured over this CSV's 331 series spellings, that is disqualifying:
//     `Dark Healer` and `The Dark Healer` are one series written twice, and this
//     fold is what merges them.
//   • `bookIdFromTitle` — a Firestore document id. Not a comparison at all.
//
// ⚠️ It folds for COMPARISON only. What is stored is our spelling, so the read
// path joins `work.series` exactly and no fold runs in the Worker — the same
// decision `series_volume` made, for the same reason.
//
// Measured 2026-08-11: 331 raw spellings fold to 329 keys, and both collisions
// are one series spelled two ways. Nothing distinct was conflated.
//
// ⚠️ `normaliseTitle` folds case and whitespace, not DECORATION. Three series
// — Ascend Online, Harry Potter, Fae & Alchemy — built ZERO audio rungs before
// 2026-08-14 because one catalog spells them plainly and the other adds a
// bracketed or parenthetical suffix ("Ascend Online [publication order]",
// "Harry Potter (Full-Cast Editions)"), and `normaliseTitle` alone does not
// strip that. `canonicalSeries` (scripts/lib/series-canon.mjs) folds the
// estate's known cross-catalog spellings onto one form FIRST, and
// `normaliseTitle` still runs after it — same two-step shape
// `canonicalize_series()` + tag-derived value has in audiobook_catalog's own
// corrections layer. See catalog-platform/docs/UNIVERSES.md §8.
// ---------------------------------------------------------------------------

/** Folded audiobook series name -> its rows. */
const abBySeries = new Map();
for (const row of audiobooks) {
  if (!row.series) continue;
  const key = normaliseTitle(canonicalSeries(row.series));
  const list = abBySeries.get(key);
  if (list) list.push(row);
  else abBySeries.set(key, [row]);
}

const existingRungs = query(
  'SELECT series, index_sort, stale_at FROM audiobook_series_holding',
  flags,
);
const rungKey = (series, index) => `${series}|${index}`;

/**
 * Which of our series a work-level match has already proved.
 *
 * ⚠️ Both halves, and the second is the one that matters. A work matched by
 * `matching.ts` proves the two SERIES NAMES mean one series; the same work
 * carrying the same volume number on both sides additionally proves the two
 * catalogs NUMBER it alike. Only that pair earns `work_match` and an unhedged
 * AUDIO chip — everything else says AUDIO?, because a series whose numbering we
 * have never seen agree is a series whose book 4 might be somebody else's 3.
 *
 * Folded through `canonicalSeries` first, same as `abBySeries` above — a
 * decoration-only spelling difference must not be the reason a series stays
 * hedged as AUDIO? forever.
 */
const corroborated = new Set();
for (const m of matched) {
  if (!m.work.series || !m.row.series) continue;
  if (normaliseTitle(canonicalSeries(m.work.series)) !== normaliseTitle(canonicalSeries(m.row.series))) continue;
  if (m.work.series_index_sort == null || m.row.seriesIndexSort == null) continue;
  if (Number(m.work.series_index_sort) !== Number(m.row.seriesIndexSort)) continue;
  corroborated.add(m.work.series);
}

const ourSeries = [...new Set(works.map((w) => w.series).filter(Boolean))].sort();
const rungReport = [];
const liveRungs = new Set();

for (const series of ourSeries) {
  const hits = abBySeries.get(normaliseTitle(canonicalSeries(series))) ?? [];
  const numbered = hits.filter((h) => typeof h.seriesIndexSort === 'number');
  if (numbered.length === 0) continue;

  const via = corroborated.has(series) ? 'work_match' : 'fold';

  // One row per index — the same rule `backfill-series-volumes.mjs` applies, so
  // the two tables cannot end up describing different rungs. First wins.
  const seen = new Map();
  for (const h of numbered) if (!seen.has(h.seriesIndexSort)) seen.set(h.seriesIndexSort, h);

  for (const [index, row] of [...seen].sort((a, b) => a[0] - b[0])) {
    liveRungs.add(rungKey(series, index));
    statements.push(
      `INSERT INTO audiobook_series_holding (series, index_sort, title, authors,` +
        ` audiobook_series, index_display, cover_href, series_matched_via)` +
        ` VALUES (${lit(series)}, ${lit(index)}, ${lit(row.title)}, ${lit(row.authors)},` +
        ` ${lit(row.series)}, ${lit(row.seriesIndexDisplay)}, ${lit(row.coverHref)}, ${lit(via)})` +
        ` ON CONFLICT(series, index_sort) DO UPDATE SET` +
        ` title = excluded.title, authors = excluded.authors,` +
        ` audiobook_series = excluded.audiobook_series,` +
        ` index_display = excluded.index_display, cover_href = excluded.cover_href,` +
        ` series_matched_via = excluded.series_matched_via,` +
        ` last_seen_at = datetime('now'), stale_at = NULL;`,
    );
  }

  rungReport.push({
    series,
    via,
    abName: hits[0].series,
    indexes: [...seen.keys()].sort((a, b) => a - b),
    fresh: [...seen.keys()].filter(
      (i) => !existingRungs.some((r) => rungKey(r.series, r.index_sort) === rungKey(series, i)),
    ).length,
  });
}

// Marked, never deleted — the other catalog renaming a series must not look like
// the audiobook having been returned.
const rungsGoneStale = existingRungs.filter(
  (r) => !liveRungs.has(rungKey(r.series, r.index_sort)) && !r.stale_at,
);
for (const r of rungsGoneStale) {
  statements.push(
    `UPDATE audiobook_series_holding SET stale_at = datetime('now')` +
      ` WHERE series = ${lit(r.series)} AND index_sort = ${lit(r.index_sort)}` +
      ` AND stale_at IS NULL;`,
  );
}

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
const byVia = (v) => matched.filter((m) => m.via === v).length;

console.log('');
console.log(`matched an audiobook   ${matched.length}  (${pct(matched.length)})`);
console.log(`  exact title          ${byVia('exact')}`);
console.log(`  a recorded alias     ${byVia('alias')}`);
console.log(`  containment          ${byVia('containment')}`);
console.log(`  (of those, reached only through one of our aliases: ${matched.filter((m) => m.alias).length})`);
console.log(`no audiobook found     ${missed.length}  (${pct(missed.length)})`);
console.log('');

for (const m of [...matched].sort((a, b) => a.work.title.localeCompare(b.work.title))) {
  const same = m.work.title === m.row.title;
  console.log(
    `  ${m.via.padEnd(11)} ${m.similarity.toFixed(2)}  ${m.work.title}` +
      (same ? '' : `\n${' '.repeat(20)}↳ "${m.row.title}" there`) +
      (m.alias ? `\n${' '.repeat(20)}↳ via our alias "${m.alias}"` : ''),
  );
}

const loose = matched.filter((m) => m.via === 'containment');
if (loose.length) {
  console.log('');
  console.log(`⚠️ ${loose.length} match(es) rest on containment — read these before committing:`);
  for (const m of loose) {
    console.log(`  "${m.work.title}"  ←→  "${m.row.title}"  (${m.similarity.toFixed(2)})`);
  }
}

if (missed.length) {
  console.log('');
  console.log('no audiobook:');
  for (const w of missed.sort((a, b) => a.title.localeCompare(b.title))) {
    console.log(`  ${w.title}`);
  }
}

if (goneStale.length) {
  console.log('');
  console.log(`${goneStale.length} existing holding(s) no longer match and will be marked stale.`);
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
console.log(`series with audio rungs   ${rungReport.length}`);
console.log(`  corroborated by a work  ${rungReport.filter((r) => r.via === 'work_match').length}`);
console.log(`  series name only        ${rungReport.filter((r) => r.via === 'fold').length}`);

for (const r of rungReport.sort((a, b) => a.series.localeCompare(b.series))) {
  const renamed = r.abName !== r.series ? `  ("${r.abName}" there)` : '';
  console.log(
    `  ${r.via.padEnd(11)} ${r.series}  ${r.indexes.length} rung(s) [${r.indexes.join(',')}]` +
      `  ${r.fresh} new${renamed}`,
  );
}

const hedged = rungReport.filter((r) => r.via === 'fold');
if (hedged.length) {
  console.log('');
  console.log(
    `⚠️ ${hedged.length} series map on the folded name alone — every rung renders AUDIO?:`,
  );
  for (const r of hedged) console.log(`  "${r.series}"  ←→  "${r.abName}"`);
}

if (rungsGoneStale.length) {
  console.log('');
  console.log(`${rungsGoneStale.length} audio rung(s) no longer match and will be marked stale.`);
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
  `SELECT (SELECT COUNT(*) FROM audiobook_holding) AS all_rows,
          (SELECT COUNT(*) FROM audiobook_holding WHERE stale_at IS NULL) AS live_rows,
          (SELECT COUNT(*) FROM audiobook_series_holding) AS all_rungs,
          (SELECT COUNT(*) FROM audiobook_series_holding WHERE stale_at IS NULL) AS live_rungs`,
  flags,
)[0];

console.log(
  `\n${sent} statement(s) run. ${after.live_rows ?? 0} live holding(s) of ${after.all_rows} row(s),` +
    ` and ${after.live_rungs ?? 0} live audio rung(s) of ${after.all_rungs}, in the` +
    ` ${flags.remote ? 'REMOTE' : 'local'} database.`,
);
