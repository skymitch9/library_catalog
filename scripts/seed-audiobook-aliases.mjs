#!/usr/bin/env node
/**
 * Assert the other names a handful of our books answer to in the audiobook
 * catalog, so `backfill:audiobooks` can reach rows the matcher cannot.
 *
 * ## Why an alias and not a looser matcher
 *
 * `packages/core/src/matching.ts` deliberately refuses to bridge these, and each
 * refusal is correct on its own terms:
 *
 * | Ours | Theirs | Why the matcher will not bridge it |
 * |---|---|---|
 * | `Tamer: King of Dinosaurs Book 9` | `Tamer: King of Dinosaurs 9 Kickstarter Edition` | containment ratio is 25/45 = **0.56**, under the ported 0.6 floor |
 * | `Tamer: King of Dinosaurs Book 10` | `Tamer: King of Dinosaurs 10 Kickstarter Edition` | the same, 26/46 |
 * | `The Primal Hunter` | `The Primal Hunter - A LitRPG Adventure` | 13/32 = 0.41 |
 *
 * Lowering that floor to catch them is exactly what this project's history says
 * not to do — it is the rung that shipped three wrong games in the sibling Board
 * Game Catalog. "Kickstarter Edition" and "A LitRPG Adventure" are decoration a
 * *person* can see through and a similarity score cannot. An alias records that
 * judgement as an asserted fact, attributable and reversible, which is what the
 * `work_alias` table is for.
 *
 * ## ⚠️ It will not write an alias that does not work
 *
 * Every row below is checked against the audiobook catalog through the project's
 * ONE matcher before anything is written. An alias that reaches nothing is
 * reported and skipped rather than stored — a dead alias is invisible clutter
 * that looks like a fix.
 *
 * ## Usage
 *
 *     node scripts/seed-audiobook-aliases.mjs                    # dry run, local
 *     node scripts/seed-audiobook-aliases.mjs --remote           # dry run, production
 *     node scripts/seed-audiobook-aliases.mjs --remote --commit  # apply
 *
 * Idempotent: `work_alias` is UNIQUE (work_id, alias) and this uses
 * `INSERT OR IGNORE`, so a second run writes nothing.
 *
 * ⚠️ Needs LC_AUDIOBOOK_ROOT when run from a git worktree — see
 * `scripts/lib/audiobooks.mjs`.
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { AUDIOBOOK_CSV, audiobookIndex, loadAudiobooks } from './lib/audiobooks.mjs';

const flags = parseFlags();

/**
 * The assertions. Keyed on the work's printed title rather than an id, because
 * an id is meaningless in a diff and this file is meant to be reviewed by a
 * person who knows the books.
 */
const ASSERTIONS = [
  {
    title: 'Tamer: King of Dinosaurs Book 9',
    alias: 'Tamer: King of Dinosaurs 9 Kickstarter Edition',
    kind: 'title',
  },
  {
    title: 'Tamer: King of Dinosaurs Book 10',
    alias: 'Tamer: King of Dinosaurs 10 Kickstarter Edition',
    kind: 'title',
  },
  {
    title: 'The Primal Hunter',
    alias: 'The Primal Hunter - A LitRPG Adventure',
    kind: 'title',
  },
];

const audiobooks = loadAudiobooks();
if (audiobooks.length === 0) {
  console.error(
    `No audiobook rows read from ${AUDIOBOOK_CSV}.\n` +
      'Set LC_AUDIOBOOK_ROOT to the audiobook_catalog checkout and try again.',
  );
  process.exit(1);
}
const index = audiobookIndex(audiobooks);
console.log(`${audiobooks.length} audiobook row(s) read`);

const titles = ASSERTIONS.map((a) => lit(a.title)).join(', ');
const works = query(
  `SELECT id, title, authors FROM work WHERE title IN (${titles})`,
  flags,
);
const byTitle = new Map(works.map((w) => [w.title, w]));

const existing = new Set(
  query('SELECT work_id, alias FROM work_alias', flags).map((r) => `${r.work_id} ${r.alias}`),
);

const statements = [];
for (const a of ASSERTIONS) {
  const work = byTitle.get(a.title);
  if (!work) {
    console.log(`  SKIP  no work titled "${a.title}"`);
    continue;
  }

  // ⚠️ Prove it reaches something before storing it.
  const hit = index.lookup(a.alias, work.authors);
  if (!hit) {
    console.log(`  SKIP  "${a.alias}" reaches no audiobook row — not writing a dead alias`);
    continue;
  }
  if (existing.has(`${work.id} ${a.alias}`)) {
    console.log(`  have  ${work.title}  ->  "${a.alias}"`);
    continue;
  }

  console.log(
    `  ADD   ${work.title}\n          -> "${a.alias}"` +
      `\n          reaches "${hit.row.title}" (${hit.via}, ${hit.similarity.toFixed(2)})`,
  );
  statements.push(
    `INSERT OR IGNORE INTO work_alias (work_id, alias, kind, source)` +
      ` VALUES (${lit(work.id)}, ${lit(a.alias)}, ${lit(a.kind)}, 'manual');`,
  );
}

console.log(`\n${statements.length} alias row(s) to write.`);
if (!flags.commit) {
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.');
  process.exit(0);
}
if (statements.length === 0) process.exit(0);

execute(statements, flags);

// Confirm by re-reading — `execute` returns statements run, not rows changed.
const after = query('SELECT COUNT(*) AS n FROM work_alias', flags)[0];
console.log(`\n${after?.n} alias row(s) in the ${flags.remote ? 'REMOTE' : 'local'} database.`);
