/**
 * Reshape Worlds Beyond Number: ONE book, THREE variant covers.
 *
 * ## The owner's diagnosis, and it is the right one
 *
 * *"The confusing part about this is that it's all the same book with different
 * cover art. So maybe we call Series Worlds Beyond Number, Book 'The Wizard,
 * The Witch, The Wild One', number it book 1 and put somewhere its a prelude,
 * then for editions we put that we have an edition for The Wizard, an edition
 * for the Witch, an Edition for the Wild One."*
 *
 * Three works would have been three lies — there is one 240-page graphic novel
 * and three printings of it that differ only in the jacket. That is exactly what
 * `edition` is for: migration 0060 defines an edition name as *"how this
 * printing differs from the standard one"*, and names variant jackets as the
 * canonical case.
 *
 *   work    Worlds Beyond Number #1  "The Wizard, The Witch, The Wild One"
 *   edition The Wizard variant cover      + preordered copy
 *   edition The Witch variant cover       + preordered copy
 *   edition The Wild One variant cover    + preordered copy
 *
 * ⚠️ Three editions of one format is legal and precedented — there is NO unique
 * index on `(work_id, format)`, only partial unique indexes on `isbn13` and
 * `asin`, and works 139, 163 and 203 already carry two hardcovers each.
 *
 * ## ⚠️ The title change moves `work_key`, and that was checked
 *
 * `Worlds Beyond Number: The Official Graphic Novel` -> `The Wizard, The Witch,
 * The Wild One` is not case-only, so the key moves:
 *
 *   worlds beyond number the official graphic novel|jadzia axelrod
 *     ->  wizard the witch the wild one|jadzia axelrod        (normaliseTitle drops the leading "The")
 *
 * Safe because the work is hours old and carries nothing: `user_book` 0,
 * `work_alias` 0, and no Firestore review can exist for a book that has not
 * shipped. Had any been non-zero the right move would have been a `work_alias`,
 * never a silent rename — the rule the eight `- MM` titles followed this morning.
 *
 * ## Why "prelude" goes in `series_index_display`
 *
 * `series_index_sort` stays the number 1 so the ladder orders correctly;
 * `series_index_display` is free text and already carries values like
 * "Complete Series" and "7.75" elsewhere in this catalog. It is the most
 * visible place a reader will see it, which is what the owner asked for.
 *
 * The description is the one the research run found and the owner approved —
 * it names Umora and the 240 pages, which the campaign blurb does not.
 *
 *   node scripts/fix-worlds-beyond-number.mjs                 # dry run
 *   node scripts/fix-worlds-beyond-number.mjs --remote --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { sortTitleFor, workKeyFor } from '../packages/core/src/titles.ts';

const flags = parseFlags();
const q = (sql) => query(sql, { remote: flags.remote });

const ID = 258;
const OLD_TITLE = 'Worlds Beyond Number: The Official Graphic Novel';
const TITLE = 'The Wizard, The Witch, The Wild One';
const AUTHORS = 'Jadzia Axelrod, Sarah Webb';
const SERIES = 'Worlds Beyond Number';
const DISPLAY = '1 · Prelude';
const DESC =
  'A 240-page hardcover graphic novel adaptation of the Worlds Beyond Number ' +
  'actual-play podcast, set in the world of Umora. It tells how the three main ' +
  'characters — Suvi the wizard, Ame the witch, and Eursulon the wild one — first ' +
  'met as children, during a summer adventure that changed their lives. ' +
  '⚠️ A prelude to the saga: the same book is sold with three variant covers, one ' +
  'per character, and this household has all three — see the Editions panel.';

/** One per variant jacket. The book inside is identical. */
const COVERS = ['The Wizard', 'The Witch', 'The Wild One'];

const w = q(`SELECT id, title, authors, work_key,
                    (SELECT COUNT(*) FROM user_book WHERE work_id = ${ID}) ub,
                    (SELECT COUNT(*) FROM work_alias WHERE work_id = ${ID}) al
               FROM work WHERE id = ${ID}`)[0];

if (!w) { console.error(`work ${ID} does not exist`); process.exit(1); }

const newKey = workKeyFor(TITLE, AUTHORS);
console.log(`\n${flags.remote ? 'REMOTE' : 'local'} database\n`);
console.log(`  work ${ID}`);
console.log(`     title   ${w.title}\n          -> ${TITLE}`);
console.log(`     key     ${w.work_key}\n          -> ${newKey}`);
console.log(`     series  ${SERIES} #${DISPLAY}`);
console.log(`     guards  user_book=${w.ub}  aliases=${w.al}  (both must be 0 to rename)`);

if (w.title !== OLD_TITLE && w.title !== TITLE) {
  console.error(`\n⚠️ REFUSED — title is "${w.title}", expected "${OLD_TITLE}"\n`);
  process.exit(1);
}
if (Number(w.ub) > 0 || Number(w.al) > 0) {
  console.error('\n⚠️ REFUSED — this work carries a review or an alias; use a work_alias, not a rename.\n');
  process.exit(1);
}

const eds = q(`SELECT id, edition_name FROM edition WHERE work_id = ${ID} ORDER BY id`);
console.log(`\n  editions now: ${eds.length}`);
for (const e of eds) console.log(`     ${e.id}  ${e.edition_name}`);
console.log('  editions wanted:');
for (const c of COVERS) console.log(`     ${c} variant cover  (+ preordered copy)`);

if (!flags.commit) { console.log('\nDRY RUN. Nothing written. Re-run with --commit.\n'); process.exit(0); }

execute(
  [
    `UPDATE work SET title = ${lit(TITLE)}, sort_title = ${lit(sortTitleFor(TITLE))},
            work_key = ${lit(newKey)}, series = ${lit(SERIES)}, series_index_sort = 1,
            series_index_display = ${lit(DISPLAY)}, description = ${lit(DESC)},
            updated_at = datetime('now')
      WHERE id = ${ID};`,
  ],
  { remote: flags.remote },
);

// Rename the existing hardcover to the first variant, then add the others.
const first = eds[0];
if (first) {
  execute(
    [`UPDATE edition SET edition_name = ${lit(`${COVERS[0]} variant cover`)}, updated_at = datetime('now')
        WHERE id = ${Number(first.id)};`],
    { remote: flags.remote },
  );
}
const have = new Set(
  q(`SELECT edition_name FROM edition WHERE work_id = ${ID}`).map((r) => r.edition_name),
);
const add = COVERS.map((c) => `${c} variant cover`).filter((n) => !have.has(n));
if (add.length) {
  execute(
    add.map(
      (n) =>
        `INSERT INTO edition (work_id, format, edition_name, edition_kind, publisher, published_year, source)
         VALUES (${ID}, 'hardcover', ${lit(n)}, 'collectors', 'Skybound', 2027, 'manual');`,
    ),
    { remote: flags.remote },
  );
}

// ⚠️ Copies in a SEPARATE pass, after re-reading the editions — the same fix
// that turned "1 edition, 0 copies" into 16/16 on the Dragoneye set.
const copyStatements = [];
for (const e of q(`SELECT id FROM edition WHERE work_id = ${ID}`)) {
  const edId = Number(e.id);
  if (q(`SELECT id FROM copy WHERE edition_id = ${edId}`).length) continue;
  copyStatements.push(
    `INSERT INTO copy (work_id, edition_id, status, vendor)
     VALUES (${ID}, ${edId}, 'preordered', 'Kickstarter');`,
  );
}
if (copyStatements.length) execute(copyStatements, { remote: flags.remote });

const after = q(
  `SELECT w.title, w.series, w.series_index_display vol, w.work_key,
          e.id ed, e.edition_name, e.publisher, e.published_year, c.status
     FROM work w JOIN edition e ON e.work_id = w.id
     LEFT JOIN copy c ON c.edition_id = e.id
    WHERE w.id = ${ID} ORDER BY e.id`,
);
console.log('\nverified by re-reading:');
if (after[0]) {
  console.log(`  ${after[0].title}  —  ${after[0].series} #${after[0].vol}`);
  console.log(`  key ${after[0].work_key}`);
}
for (const r of after) {
  console.log(`     ed ${r.ed}  ${String(r.edition_name).padEnd(28)} ${r.publisher} ${r.published_year}  ${r.status ?? 'NO COPY'}`);
}
const ok = after.length === 3 && after.every((r) => r.status === 'preordered');
console.log(ok ? '\nOne book, three variant covers, three preorders.\n' : '\n⚠️ Expected 3 editions each with a preordered copy.\n');
process.exit(ok ? 0 : 1);
