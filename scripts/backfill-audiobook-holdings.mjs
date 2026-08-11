#!/usr/bin/env node
/**
 * Ask the sibling audiobook catalog which of our books we already own on audio,
 * and cache the answer in `audiobook_holding` (migration 0010).
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
 * ⚠️ Requires migration 0010. Against a database without it every statement
 * fails with `no such table: audiobook_holding`.
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { AUDIOBOOK_CSV, audiobookIndex, loadAudiobooks } from './lib/audiobooks.mjs';

const flags = parseFlags();

// ---------------------------------------------------------------------------
// What we hold
// ---------------------------------------------------------------------------

// ⚠️ `query()` refuses SQL over 6000 characters and this is nowhere near it —
// but it returns one row per work, so the RESULT grows with the catalog while
// the query does not. That is the right way round; see the note on query().
const works = query('SELECT id, title, authors, series FROM work ORDER BY id', flags);

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
  for (const attempt of attempts(w)) {
    const hit = index.lookup(attempt.title, attempt.authors);
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
  `SELECT COUNT(*) AS all_rows,
          SUM(CASE WHEN stale_at IS NULL THEN 1 ELSE 0 END) AS live_rows
     FROM audiobook_holding`,
  flags,
)[0];

console.log(
  `\n${sent} statement(s) run. ${after.live_rows ?? 0} live holding(s) of ${after.all_rows} row(s)` +
    ` in the ${flags.remote ? 'REMOTE' : 'local'} database.`,
);
