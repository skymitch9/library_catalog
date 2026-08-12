/**
 * Give two series the one matching book they need to stop saying AUDIO?.
 *
 * ## The problem this solves
 *
 * `audiobook_series_holding.series_matched_via` is `'work_match'` only when a
 * book we hold matches an audiobook row on title AND author, under that series,
 * with the SAME volume number on both sides. One such book corroborates the
 * name mapping and the numbering together, and the whole series may then render
 * AUDIO. Without it the series is `'fold'` — the names merely normalise alike —
 * and every rung wears the AUDIO? hedge and still counts as missing.
 *
 * Six series were `'fold'` after the 2026-08-11 backfill. **Only two of them are
 * fixable, and the other four must stay hedged** — see the bottom of this file.
 *
 * ## Why an alias and not a retitle
 *
 * Both fixable cases are the same shape: we hold the right book at the right
 * volume, and only the *title string* differs from the audiobook's.
 *
 *   work 100  "Onyx Storm (The Empyrean)"  vs  "Onyx Storm - Empyrean, Book 3"
 *   work  38  "All The Skills - 5"         vs  "All the Skills 5: A Deck-Buil…"
 *
 * Retitling would be the obvious move and is the wrong one: `work.title` derives
 * `work_key` and the Firestore review id, and unlike this morning's title-case
 * pass these are NOT case-only edits — `normaliseTitle('Onyx Storm (The
 * Empyrean)') !== normaliseTitle('Onyx Storm')`. That is a migration, and it
 * would orphan any review.
 *
 * `work_alias` is the mechanism built for exactly this. The audiobook backfill
 * asks under our aliases — one extra `matchIndexedWork` call each, not a looser
 * comparison — which is why the table has a `kind` column: a title alias is
 * offered as a title. Nothing about the work itself changes.
 *
 * ⚠️ `source = 'manual'`, deliberately. Migration 0001: *"'openlibrary' may be
 * re-imported and overwritten; 'manual' is a person's answer and a re-import
 * must never delete it."* These are researched answers, not scraped ones.
 *
 * ## ⚠️ The four this does NOT touch, and why the hedge is CORRECT for them
 *
 * In each, we own no volume in BOTH formats, so nothing can corroborate the
 * numbering and AUDIO? is the honest answer:
 *
 *   Space Knight       we hold 5, 6      audio has 1, 2        no shared volume
 *   Arcane Pathfinder  we hold 5         audio has 1-4         no shared volume
 *   Legion             we hold 1, 2      audio has only the
 *                                        omnibus at rung 4     no shared volume
 *   Dungeon Crawler    we hold Crocodile audio has 1-8, and
 *   Carl               (unnumbered)      Crocodile is not
 *                                        among them            no shared volume
 *
 * Do not "fix" these by loosening the matcher. The absence of a shared book is
 * the evidence, and inventing corroboration is how a hedge becomes a lie.
 *
 *   node scripts/add-audio-corroboration-aliases.mjs                   # dry run
 *   node scripts/add-audio-corroboration-aliases.mjs --remote --commit
 *
 * Then re-run `npm run backfill:audiobooks -- --remote --commit`, which is what
 * actually re-reads the aliases and promotes the rows.
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const flags = parseFlags();

/** Each entry: we hold this book, at this volume, and the audiobook agrees. */
const ALIASES = [
  {
    workId: 100,
    expectTitle: 'Onyx Storm (The Empyrean)',
    alias: 'Onyx Storm',
    why: 'audiobook row is "Onyx Storm - Empyrean, Book 3", Rebecca Yarros, vol 3 — same book, same volume',
  },
  {
    workId: 38,
    expectTitle: 'All The Skills - 5',
    // ⚠️ The SUBTITLE is load-bearing here and "All the Skills 5" alone failed.
    // The matcher folds the audiobook's trailing " - <series>, Book N" away but
    // keeps the colon subtitle, so the alias has to carry it. Onyx Storm matched
    // on the bare title only because it has no subtitle to keep. Measured: the
    // short form scored no match, this one is what the second run is testing.
    alias: 'All the Skills 5: A Deck-Building LitRPG',
    why: 'audiobook row is "All the Skills 5: A Deck-Building LitRPG - All the Skills, Book 5", Honour Rae, vol 5 — same book, same volume',
  },
];

const q = (sql) => query(sql, { remote: flags.remote });

const ids = ALIASES.map((a) => a.workId).join(',');
const works = q(
  `SELECT id, title, authors, series, series_index_display AS vol FROM work WHERE id IN (${ids})`,
);
const byId = new Map(works.map((w) => [Number(w.id), w]));

console.log(`\n${flags.remote ? 'REMOTE' : 'local'} database\n`);

const todo = [];
let refused = 0;
for (const a of ALIASES) {
  const w = byId.get(a.workId);
  if (!w) {
    console.log(`  ⚠️ work ${a.workId} does not exist — refusing`);
    refused++;
    continue;
  }
  // ⚠️ Guard on the title, so a shifted id can never alias the wrong book.
  if (w.title !== a.expectTitle) {
    console.log(`  ⚠️ work ${a.workId} is "${w.title}", expected "${a.expectTitle}" — refusing`);
    refused++;
    continue;
  }
  const existing = q(
    `SELECT id FROM work_alias WHERE work_id = ${lit(a.workId)} AND alias = ${lit(a.alias)} AND kind = 'title'`,
  );
  console.log(`  work ${a.workId}  ${w.title}`);
  console.log(`     ${w.authors} · ${w.series} vol ${w.vol}`);
  console.log(`     + title alias "${a.alias}"  ${existing.length ? '(already present — skipping)' : ''}`);
  console.log(`     ${a.why}`);
  if (!existing.length) todo.push(a);
}

console.log(`\n${todo.length} alias(es) to add, ${refused} refused\n`);

if (!flags.commit) {
  console.log('DRY RUN. Nothing written. Re-run with --commit.\n');
  process.exit(refused ? 1 : 0);
}
if (refused) {
  console.log('Refusing to write while any entry failed its title guard.\n');
  process.exit(1);
}
if (!todo.length) {
  console.log('Nothing to do.\n');
  process.exit(0);
}

execute(
  todo.map(
    (a) =>
      `INSERT INTO work_alias (work_id, alias, kind, source) VALUES ` +
      `(${lit(a.workId)}, ${lit(a.alias)}, 'title', 'manual');`,
  ),
  { remote: flags.remote },
);

const after = q(
  `SELECT work_id, alias, kind, source FROM work_alias WHERE work_id IN (${ids}) AND kind = 'title'`,
);
console.log('verified by re-reading:');
for (const r of after) console.log(`  work ${r.work_id}  "${r.alias}"  kind=${r.kind} source=${r.source}`);
const ok = todo.every((a) => after.some((r) => Number(r.work_id) === a.workId && r.alias === a.alias));
console.log(ok ? '\nAll aliases confirmed.\n' : '\n⚠️ Re-read does not match what was written.\n');
process.exit(ok ? 0 : 1);
