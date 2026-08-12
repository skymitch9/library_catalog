/**
 * Record the print books found by the 2026-08-11 crowdfunding rescan.
 *
 * The rescan read all 61 Kickstarter pledges, all 3 Indiegogo pledges and both
 * BackerKit accounts, and found 14 book pledges the catalog had never heard of.
 * This writes the ones whose title AND author are certain.
 *
 * ## ⚠️ Most of these are EDITIONS, not new books
 *
 * The library already holds Tamer 7-11, Space Knight 5-6 and Monster Empire 2
 * as EPUBs. A print copy of a book we already hold is a second **edition** of
 * the same `work`, not a second work — that is the "bought twice" case
 * `docs/info/series-formats-and-audiobooks.md` describes, and minting a parallel
 * row would be the permanent duplicate migration 0060 warns about.
 *
 *   21 new works · 8 new editions on existing works · 29 copies
 *
 * ## Owner's answers, 2026-08-11 — every format here was stated, none inferred
 *
 *   Grimoire boxes   "All faux leather editions so lets just call them hard cover"
 *                    Ritualist = 1 book, Regicide & Rexus = 2, Raze & Ruthless = 2
 *   Tamer            "i dont think hard cover exist" -> paperback. Owns 1-10,
 *                    book 11 is still a preorder
 *   Space Knight     "yes Space knight has print copies, we own 1-9" -> paperback
 *   Ascend Online    Book 1 is in hand; its sequel Legacy of the Fallen is
 *                    already recorded as work 223
 *
 * ## What is NOT written here, and why
 *
 * ⚠️ **Worlds Beyond Number** — hardcover, preorder, confirmed. Held back only
 * because its AUTHOR is unknown, and `work_key` is derived from title + author.
 * A guessed author is a wrong key that silently fails to join and cannot be
 * fixed by an edit. Ask, then add.
 *
 * ⚠️ **Beneath the Dragoneye Moons Realmkeeper Set** — 8 hardcovers, 2 books
 * each, 16 volumes. The owner chose option (c): a hardcover edition on BOTH
 * books of each pair, with `collects` naming the shared binding, so every book
 * correctly answers "do I own this in print?". Held back for two reasons:
 * books **7, 8, 11 and 14 have no work row and no known title**, and the
 * **pairing is assumed** to be (1,2)(3,4)…(15,16) — sequential is the natural
 * reading but nobody has confirmed it.
 *
 *   node scripts/add-crowdfunding-rescan-books.mjs                 # dry run
 *   node scripts/add-crowdfunding-rescan-books.mjs --remote --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { primaryAuthor, sortTitleFor, workKeyFor } from '../packages/core/src/titles.ts';

const flags = parseFlags();
const q = (sql) => query(sql, { remote: flags.remote });

const KROUT = 'Dakota Krout';
const EARLE = 'Michael-Scott Earle';
const CHMIL = 'Luke Chmilenko';

/** `edition_name` is the campaign's own words; `edition_kind` normalises it. */
const GRIMOIRE = 'Kickstarter Grimoire Edition — faux leather';
const SIGNED_PB = 'Kickstarter signed paperback';

/**
 * NEW works. Titles follow the convention already in this catalog — the
 * existing rows are "Tamer: King of Dinosaurs Book 7", "Space Knight Book 5",
 * "Monster Empire Book 2", so the new ones match rather than inventing a second
 * naming style for the same series.
 */
const NEW = [
  // Completionist Chronicles, faux-leather Grimoire hardcovers.
  { t: 'Ritualist', a: KROUT, s: 'The Completionist Chronicles', i: 1, f: 'hardcover', k: 'collectors', n: GRIMOIRE, st: 'owned' },
  { t: 'Regicide', a: KROUT, s: 'The Completionist Chronicles', i: 2, f: 'hardcover', k: 'collectors', n: GRIMOIRE, st: 'preordered' },
  { t: 'Rexus: Side Quest', a: KROUT, s: 'The Completionist Chronicles', i: 3, f: 'hardcover', k: 'collectors', n: GRIMOIRE, st: 'preordered' },
  { t: 'Raze', a: KROUT, s: 'The Completionist Chronicles', i: 4, f: 'hardcover', k: 'collectors', n: GRIMOIRE, st: 'preordered' },
  { t: 'Ruthless', a: KROUT, s: 'The Completionist Chronicles', i: 5, f: 'hardcover', k: 'collectors', n: GRIMOIRE, st: 'preordered' },

  // Tamer 1-6. 7-11 already exist as EPUBs and are handled below.
  ...[1, 2, 3, 4, 5, 6].map((i) => ({
    t: `Tamer: King of Dinosaurs Book ${i}`, a: EARLE, s: 'Tamer: King of Dinosaurs',
    i, f: 'paperback', k: null, n: SIGNED_PB, st: 'owned',
  })),

  // Space Knight 1-4 and 7-9. 5-6 already exist as EPUBs.
  ...[1, 2, 3, 4, 7, 8, 9].map((i) => ({
    t: `Space Knight Book ${i}`, a: EARLE, s: 'Space Knight',
    i, f: 'paperback', k: null, n: 'Crowdfunded print copy', st: 'owned',
  })),

  { t: 'Monster Empire Book 1', a: EARLE, s: 'Monster Empire', i: 1, f: 'paperback', k: null, n: SIGNED_PB, st: 'owned' },
  { t: 'Ascend Online', a: CHMIL, s: 'Ascend Online', i: 1, f: 'hardcover', k: 'collectors', n: "Kickstarter Collector's Edition", st: 'owned' },

  /**
   * ⚠️ Added 2026-08-12, once the owner supplied the author. It was held out of
   * the first run for exactly that reason: `work_key` is
   * `normaliseTitle(title)|normaliseTitle(primaryAuthor(authors))`, so a guessed
   * author is a wrong key that silently fails to join and cannot be repaired by
   * editing the row.
   *
   * The illustrator is listed second and costs nothing: `workKeyFor` folds only
   * the PRIMARY author, so "Jadzia Axelrod, Sarah Webb" and "Jadzia Axelrod"
   * produce the identical key. Naming the artist on a graphic novel is worth a
   * field that changes no behaviour.
   *
   * Standalone — no series, no volume. Hardcover, and still a preorder.
   */
  { t: 'Worlds Beyond Number: The Official Graphic Novel', a: 'Jadzia Axelrod, Sarah Webb',
    s: null, i: null, f: 'hardcover', k: null, n: 'Kickstarter hardcover', st: 'preordered' },
];

/** EXISTING works that gain a print edition. Keyed by id, guarded on title. */
const ADD_EDITION = [
  { id: 73, expect: 'Tamer: King of Dinosaurs Book 7', f: 'paperback', k: null, n: SIGNED_PB, st: 'owned' },
  { id: 74, expect: 'Tamer: King of Dinosaurs Book 8', f: 'paperback', k: null, n: SIGNED_PB, st: 'owned' },
  { id: 75, expect: 'Tamer: King of Dinosaurs Book 9', f: 'paperback', k: null, n: SIGNED_PB, st: 'owned' },
  { id: 71, expect: 'Tamer: King of Dinosaurs Book 10', f: 'paperback', k: null, n: SIGNED_PB, st: 'owned' },
  // ⚠️ The one preorder among the Tamers. Not yet arrived.
  { id: 72, expect: 'Tamer: King of Dinosaurs Book 11', f: 'paperback', k: null, n: SIGNED_PB, st: 'preordered' },
  { id: 69, expect: 'Space Knight Book 5', f: 'paperback', k: null, n: 'Indiegogo print copy', st: 'owned' },
  { id: 70, expect: 'Space Knight Book 6', f: 'paperback', k: null, n: 'Indiegogo print copy', st: 'owned' },
  { id: 45, expect: 'Monster Empire Book 2', f: 'paperback', k: null, n: SIGNED_PB, st: 'owned' },
];

for (const w of NEW) {
  w.key = workKeyFor(w.t, w.a);
  w.sort = sortTitleFor(w.t);
  w.primary = primaryAuthor(w.a);
}

const existingKeys = new Set(q('SELECT work_key FROM work').map((r) => r.work_key));
const toCreate = NEW.filter((w) => !existingKeys.has(w.key));

console.log(`\n${flags.remote ? 'REMOTE' : 'local'} database\n`);
console.log(`NEW WORKS — ${toCreate.length} to create, ${NEW.length - toCreate.length} already present`);
for (const w of NEW) {
  const dup = existingKeys.has(w.key);
  console.log(`  ${dup ? 'skip  ' : 'create'}  ${w.s} #${w.i}  ${w.t}  [${w.f}, ${w.st}]`);
}

// Guard every existing-work edition on its title, so a shifted id cannot
// attach a paperback of Tamer 8 to something else entirely.
const rows = q(`SELECT id, title FROM work WHERE id IN (${ADD_EDITION.map((e) => e.id).join(',')})`);
const titleOf = new Map(rows.map((r) => [Number(r.id), r.title]));
const bad = ADD_EDITION.filter((e) => titleOf.get(e.id) !== e.expect);
const edTodo = ADD_EDITION.filter(
  (e) => titleOf.get(e.id) === e.expect &&
    !q(`SELECT id FROM edition WHERE work_id = ${e.id} AND format = ${lit(e.f)}`).length,
);

console.log(`\nEDITIONS ON EXISTING WORKS — ${edTodo.length} to add, ${bad.length} refused`);
for (const e of ADD_EDITION) {
  const t = titleOf.get(e.id);
  const state = t !== e.expect ? `⚠️ REFUSED — id ${e.id} is "${t ?? 'missing'}"` :
    edTodo.includes(e) ? 'add' : 'already has this format — skip';
  console.log(`  ${state.padEnd(34)} ${e.expect}  [${e.f}, ${e.st}]`);
}

if (bad.length) {
  console.log('\nRefusing to write while any title guard fails.\n');
  process.exit(1);
}
if (!flags.commit) {
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.\n');
  process.exit(0);
}

if (toCreate.length) {
  execute(
    toCreate.map(
      (w) =>
        // ⚠️ `lit(String(w.i))` would write the TEXT 'null' for a standalone —
        // String(null) is "null", and lit quotes it. Worlds Beyond Number is the
        // first entry here with no series, which is what surfaced it.
        `INSERT INTO work (title, authors, primary_author, work_key, sort_title, series, series_index_sort, series_index_display)
         VALUES (${lit(w.t)}, ${lit(w.a)}, ${lit(w.primary)}, ${lit(w.key)}, ${lit(w.sort)},
                 ${lit(w.s)}, ${w.i == null ? 'NULL' : w.i}, ${w.i == null ? 'NULL' : lit(String(w.i))});`,
    ),
    { remote: flags.remote },
  );
}

const made = q(
  `SELECT id, work_key FROM work WHERE work_key IN (${NEW.map((w) => lit(w.key)).join(',')})`,
);
const idOf = new Map(made.map((r) => [r.work_key, Number(r.id)]));

// ⚠️ source='manual', not 'crowdfunding' — the CHECK on edition.source allows
// only manual/openlibrary/googlebooks/kindle/file/research/cwa, and
// 'crowdfunding' failed a whole batch earlier today.
const edStatements = [];
for (const w of NEW) {
  const id = idOf.get(w.key);
  if (!id) continue;
  if (q(`SELECT id FROM edition WHERE work_id = ${id} AND format = ${lit(w.f)}`).length) continue;
  edStatements.push(
    `INSERT INTO edition (work_id, format, edition_name, edition_kind, source)
     VALUES (${id}, ${lit(w.f)}, ${lit(w.n)}, ${w.k ? lit(w.k) : 'NULL'}, 'manual');`,
  );
}
for (const e of edTodo) {
  edStatements.push(
    `INSERT INTO edition (work_id, format, edition_name, edition_kind, source)
     VALUES (${e.id}, ${lit(e.f)}, ${lit(e.n)}, ${e.k ? lit(e.k) : 'NULL'}, 'manual');`,
  );
}
if (edStatements.length) execute(edStatements, { remote: flags.remote });

// One copy per edition created above, carrying the owner's stated status.
const wanted = [
  ...NEW.map((w) => ({ workId: idOf.get(w.key), f: w.f, st: w.st })),
  ...edTodo.map((e) => ({ workId: e.id, f: e.f, st: e.st })),
].filter((x) => x.workId);

const copyStatements = [];
for (const x of wanted) {
  const ed = q(`SELECT id FROM edition WHERE work_id = ${x.workId} AND format = ${lit(x.f)} LIMIT 1`);
  if (!ed.length) continue;
  const edId = Number(ed[0].id);
  if (q(`SELECT id FROM copy WHERE edition_id = ${edId}`).length) continue;
  copyStatements.push(
    `INSERT INTO copy (work_id, edition_id, status, vendor)
     VALUES (${x.workId}, ${edId}, ${lit(x.st)}, 'Crowdfunding');`,
  );
}
if (copyStatements.length) execute(copyStatements, { remote: flags.remote });

const check = q(
  `SELECT w.series, COUNT(DISTINCT w.id) works,
          SUM(CASE WHEN c.status='owned' THEN 1 ELSE 0 END) owned,
          SUM(CASE WHEN c.status='preordered' THEN 1 ELSE 0 END) preordered
     FROM work w
     JOIN edition e ON e.work_id = w.id
     JOIN copy c ON c.edition_id = e.id
    WHERE w.series IN ('The Completionist Chronicles','Tamer: King of Dinosaurs','Space Knight','Monster Empire','Ascend Online')
      AND e.format IN ('hardcover','paperback')
    GROUP BY w.series ORDER BY w.series`,
);
console.log('\nverified by re-reading — print copies now on record:');
for (const r of check) {
  console.log(`  ${String(r.series).padEnd(30)} ${r.works} work(s), ${r.owned} owned, ${r.preordered} preordered`);
}
console.log(`\ncreated ${toCreate.length} work(s), ${edStatements.length} edition(s), ${copyStatements.length} cop(y/ies).\n`);
