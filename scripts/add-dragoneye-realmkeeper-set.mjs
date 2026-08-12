/**
 * Record the Beneath the Dragoneye Moons "Complete Realmkeeper Set" — eight
 * hardcovers, sixteen books, two bound in each.
 *
 * Kickstarter, $670, SHIPPED — in the house now.
 * https://www.kickstarter.com/projects/btdem/beneath-the-dragoneye-moons-complete-collectors-edition-set
 *
 * ## ⚠️ The modelling choice was the owner's, and it is option (c)
 *
 * Eight physical objects, sixteen books. Three ways to record that:
 *
 *   (a) one edition per hardcover, hung off the FIRST book of each pair.
 *       Honest about the object, but then book 2 shows no print copy while
 *       sitting in your hand.
 *   (b) eight new "Volume N" works, each `collects` two, joined by
 *       `work_relation.contains`. The Divine Dungeon omnibus precedent. Costs
 *       eight works that are not books.
 *   (c) **CHOSEN** — a hardcover edition on BOTH books of each pair, each
 *       carrying `collects` that names the shared binding.
 *
 * (c) wins because the question the shelf is actually asked is *"do I own this
 * book in print?"*, and only (c) answers it correctly for all sixteen. The cost
 * is that sixteen edition rows describe eight objects — which is exactly what
 * `collects` is for. Migration 0060: *"one EDITION, and what is bound into
 * it"*, deliberately free text because real bind-ups do not fit a number range.
 *
 * ## ⚠️ The pairing is SEQUENTIAL, and that is an assumption
 *
 * (1,2) (3,4) (5,6) (7,8) (9,10) (11,12) (13,14) (15,16). Nobody has confirmed
 * it against the campaign; it is the only sensible reading of "8 volumes with 2
 * books inside each" for a numbered series, but if the boxes pair differently
 * then all eight `collects` strings are wrong. They are prose in one column and
 * cost one UPDATE to fix — no key, no relation, no join depends on them.
 *
 * ## The four missing books came from the audiobook catalog
 *
 * The library held 12 of 16 as EPUBs; 7, 8, 11 and 14 had no row at all. Their
 * titles are taken from the sibling catalog, where the owner holds all sixteen
 * audiobooks — a real source, not a guess. Cross-checked against the owner's
 * Goodreads series link.
 *
 * ⚠️ Note the existing rows carry a `- MM` suffix (*"Oathbound Healer - MM"*).
 * That is pre-existing and is NOT touched here: `title` derives `work_key`, so
 * cleaning it is a migration, not an edit. Recorded as a separate observation.
 *
 *   node scripts/add-dragoneye-realmkeeper-set.mjs                 # dry run
 *   node scripts/add-dragoneye-realmkeeper-set.mjs --remote --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { primaryAuthor, sortTitleFor, workKeyFor } from '../packages/core/src/titles.ts';

const flags = parseFlags();
const q = (sql) => query(sql, { remote: flags.remote });

const SERIES = 'Beneath the Dragoneye Moons';
const AUTHOR = 'Selkie Myth';
const URL = 'https://www.kickstarter.com/projects/btdem/beneath-the-dragoneye-moons-complete-collectors-edition-set';

/** Titles for every rung, so `collects` can name both books by name. */
const TITLES = {
  1: 'Oathbound Healer', 2: 'Adventures in the Argo', 3: "Ranger's Dawn",
  4: 'Beyond the Wall', 5: 'Moonveiled Journeys', 6: 'Immortal Moments',
  7: 'Return to Remus', 8: 'New Horizons', 9: 'The Gladiator Gauntlet',
  10: 'Under Ashen Skies', 11: 'Mandate of Heaven', 12: 'The Phoenix Peaks',
  13: 'Moonfall', 14: 'Immortal War', 15: 'Rise from the Ashes',
  16: 'Of Gods and Dragons',
};

/** Absent from the library entirely. Titles from the audiobook catalog. */
const MISSING = [7, 8, 11, 14];

const existing = q(
  `SELECT id, title, CAST(series_index_sort AS REAL) i FROM work WHERE series = ${lit(SERIES)}`,
);
const idByVol = new Map(existing.map((r) => [Math.round(Number(r.i)), Number(r.id)]));

const toCreate = MISSING.filter((v) => !idByVol.has(v)).map((v) => {
  const t = TITLES[v];
  return { v, t, key: workKeyFor(t, AUTHOR), sort: sortTitleFor(t), primary: primaryAuthor(AUTHOR) };
});

console.log(`\n${flags.remote ? 'REMOTE' : 'local'} database`);
console.log(`\n${existing.length} of 16 already present. ${toCreate.length} to create:`);
for (const w of toCreate) console.log(`   #${w.v}  ${w.t}   [${w.key}]`);

const PAIRS = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16]];
console.log('\nEight hardcovers, sequential pairing (ASSUMED):');
for (const [i, [a, b]] of PAIRS.entries()) {
  console.log(`   Volume ${i + 1}:  #${a} ${TITLES[a]}  +  #${b} ${TITLES[b]}`);
}

if (!flags.commit) {
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.\n');
  process.exit(0);
}

if (toCreate.length) {
  execute(
    toCreate.map(
      (w) =>
        `INSERT INTO work (title, authors, primary_author, work_key, sort_title, series, series_index_sort, series_index_display)
         VALUES (${lit(w.t)}, ${lit(AUTHOR)}, ${lit(w.primary)}, ${lit(w.key)}, ${lit(w.sort)},
                 ${lit(SERIES)}, ${w.v}, ${lit(String(w.v))});`,
    ),
    { remote: flags.remote },
  );
}

// Re-read so the four new ids are known, and so a partially-applied earlier run
// is picked up rather than duplicated.
const all = q(`SELECT id, CAST(series_index_sort AS REAL) i FROM work WHERE series = ${lit(SERIES)}`);
const idOf = new Map(all.map((r) => [Math.round(Number(r.i)), Number(r.id)]));

const edStatements = [];
const copyPlan = [];
for (const [idx, [a, b]] of PAIRS.entries()) {
  const vol = idx + 1;
  const collects =
    `Realmkeeper Set volume ${vol} of 8 — one hardcover binding books ${a} and ${b}: ` +
    `${TITLES[a]} / ${TITLES[b]}. ⚠️ The same physical book carries the edition on both works.`;
  for (const v of [a, b]) {
    const id = idOf.get(v);
    if (!id) { console.log(`   ⚠️ no work for #${v} — skipped`); continue; }
    if (q(`SELECT id FROM edition WHERE work_id = ${id} AND format = 'hardcover'`).length) continue;
    edStatements.push(
      `INSERT INTO edition (work_id, format, edition_name, edition_kind, collects, source, source_url)
       VALUES (${id}, 'hardcover', ${lit(`Realmkeeper Set volume ${vol} of 8`)}, 'collectors',
               ${lit(collects)}, 'manual', ${lit(URL)});`,
    );
    copyPlan.push(id);
  }
}
if (edStatements.length) execute(edStatements, { remote: flags.remote });

// ⚠️ Copies go in their OWN pass, after re-reading the editions. An earlier
// script today built edition and copy statements from the same in-memory view
// and the copy silently found no edition; doing the read again is what makes
// this safe rather than hopeful.
const copyStatements = [];
for (const id of copyPlan) {
  const ed = q(`SELECT id FROM edition WHERE work_id = ${id} AND format = 'hardcover' LIMIT 1`);
  if (!ed.length) { console.log(`   ⚠️ work ${id} has no hardcover edition — no copy written`); continue; }
  const edId = Number(ed[0].id);
  if (q(`SELECT id FROM copy WHERE edition_id = ${edId}`).length) continue;
  copyStatements.push(
    `INSERT INTO copy (work_id, edition_id, status, vendor)
     VALUES (${id}, ${edId}, 'owned', 'Kickstarter');`,
  );
}
if (copyStatements.length) execute(copyStatements, { remote: flags.remote });

const check = q(
  `SELECT COUNT(DISTINCT w.id) works,
          SUM(CASE WHEN e.format='hardcover' THEN 1 ELSE 0 END) hardcovers,
          SUM(CASE WHEN c.status='owned' THEN 1 ELSE 0 END) owned
     FROM work w
     LEFT JOIN edition e ON e.work_id = w.id AND e.format = 'hardcover'
     LEFT JOIN copy c ON c.edition_id = e.id
    WHERE w.series = ${lit(SERIES)}`,
);
const r = check[0] ?? {};
console.log(`\nverified by re-reading: ${r.works} work(s), ${r.hardcovers} hardcover edition(s), ${r.owned} owned`);
console.log(`created ${toCreate.length} work(s), ${edStatements.length} edition(s), ${copyStatements.length} cop(y/ies).`);
console.log(r.hardcovers === 16 && r.owned === 16 ? 'All sixteen books now show a print copy.\n' : '⚠️ Expected 16 and 16.\n');
