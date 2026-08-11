/**
 * Create the handful of works a crowdfunding import needs and refuses to mint.
 *
 * ## Why this is a separate script and not part of the importer
 *
 * `import-crowdfunding.mjs` deliberately creates no `work` row: a campaign's
 * spelling of a title ("Tamer: King of Dinosaurs Book 11 -- Ebook, print, and
 * audio") is exactly what mints a duplicate of a book already on the shelf. That
 * refusal is correct and stays.
 *
 * But it leaves five real books stranded, and with them 31 accessories, because
 * `book_accessory.work_id` is NOT NULL. So the titles are written out **by hand,
 * once, in their proper form** — not scraped from a reward name — and this
 * script only does the insert.
 *
 * ## ⚠️ The one rule that matters here
 *
 * `work_key` is produced by `workKeyFor` and by nothing else. It is the join to
 * Firestore reviews and the key the matcher dedupes on; a hand-rolled version
 * that differs by one character writes a book nobody can find. Same for
 * `primaryAuthor`. Both are imported from `@lc/core` — see CLAUDE.md, "each is
 * the ONE implementation".
 *
 * Re-running is safe: a title whose `work_key` already exists is skipped.
 *
 *   node scripts/add-crowdfunded-works.mjs --remote
 *   node scripts/add-crowdfunded-works.mjs --remote --commit
 */

import { primaryAuthor, workKeyFor } from '../packages/core/src/titles.ts';
import { execute, parseFlags, query } from './lib/d1.mjs';

const { commit, remote } = parseFlags();

/**
 * Verified absent from production before writing this list: no work exists by
 * Zogarth, Dinniman or Chmilenko, and none matching Words of Radiance or Fires
 * of December. Titles are the published ones, not the reward names.
 */
const WORKS = [
  { title: 'Fires of December', authors: 'Brandon Sanderson' },
  { title: 'Words of Radiance', authors: 'Brandon Sanderson', series: 'The Stormlight Archive', index: 2 },
  { title: 'The Primal Hunter', authors: 'Zogarth', series: 'The Primal Hunter', index: 1 },
  { title: 'Dungeon Crawler Carl: Crocodile', authors: 'Matt Dinniman', series: 'Dungeon Crawler Carl' },
  { title: 'Ascend Online: Legacy of the Fallen', authors: 'Luke Chmilenko', series: 'Ascend Online' },
];

const sql = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const existing = new Set(query('SELECT work_key FROM work', { remote }).map((r) => r.work_key));

const todo = [];
for (const w of WORKS) {
  const key = workKeyFor(w.title, w.authors);
  if (existing.has(key)) {
    console.log(`  skip (already held)  ${w.title}`);
    continue;
  }
  todo.push({ ...w, key, primary: primaryAuthor(w.authors) });
}

console.log(`\n${remote ? 'production' : 'local'}: ${todo.length} work(s) to create`);
for (const w of todo) console.log(`  ${w.title} — ${w.primary}  [${w.key}]`);

if (!commit) {
  console.log('\nDry run. Re-run with --commit to write.');
  process.exit(0);
}
if (todo.length === 0) process.exit(0);

execute(
  todo.map(
    (w) =>
      `INSERT INTO work (title, authors, primary_author, work_key, series, series_index_sort, series_index_display)
       VALUES (${sql(w.title)}, ${sql(w.authors)}, ${sql(w.primary)}, ${sql(w.key)}, ${sql(w.series ?? null)}, ${w.index ?? 'NULL'}, ${sql(w.index != null ? String(w.index) : null)});`,
  ),
  { remote },
);

// ⚠️ Confirm by re-reading — `execute` returns statements run, not rows changed.
const after = query(
  `SELECT id, title FROM work WHERE work_key IN (${todo.map((w) => sql(w.key)).join(',')}) ORDER BY id`,
  { remote },
);
console.log(`\nwrote ${todo.length}; ${after.length} confirmed present:`);
for (const r of after) console.log(`  ${String(r.id).padStart(4)}  ${r.title}`);
if (after.length !== todo.length) console.log('⚠️ Count mismatch — investigate before re-running the import.');
