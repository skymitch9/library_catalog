/**
 * Dungeon Crawler Carl book 1 — two hardcovers, Limited Edition and Standard.
 *
 * https://www.kickstarter.com/projects/dinniman/dungeon-crawler-carl-v1-hardcover-editions
 *
 * The owner's order:
 *     Dungeon Crawler Carl V1 - Limited Edition    1
 *     Dungeon Crawler Carl V1 - Standard           1
 *
 * ## ⚠️ THE SWEEP COULD NOT HAVE FOUND THIS, and that is the finding
 *
 * *"i did a late pledge directly on the site pledge manager so thats why we
 * didnt see it."*
 *
 * The 2026-08-12 crowdfunding rescan read all 61 successful Kickstarter pledges
 * and reported itself complete. **A late pledge made through a creator's own
 * pledge manager never appears on the Kickstarter backings page at all** — there
 * is no row to paginate to. So "61 of 61, complete" was true of the backings
 * page and false of what the household actually bought.
 *
 * Any future crowdfunding audit has to treat the backings page as one source
 * rather than the source. Late pledges and pledge-manager purchases need asking
 * about, because no amount of careful scrolling will surface them.
 *
 * ## Two editions, one book — the same shape as Worlds Beyond Number
 *
 * Limited and Standard are two printings of the SAME novel, so they are two
 * `edition` rows on one `work`, not two works. The owner has both; that is a
 * legitimate "bought twice", which is what `copy` counts and what the ×2 mark
 * on the collection reads.
 *
 * ⚠️ This also fills the hole that made Dungeon Crawler Carl hedge at AUDIO? for
 * most of the day. Book 1 was the missing corroboration all along — it was
 * eventually promoted by adding books 2 and 3 instead, and those two turned out
 * to be an unshipped preorder. This is the honest version of that fix.
 *
 *   node scripts/add-dcc-v1-hardcovers.mjs                 # dry run
 *   node scripts/add-dcc-v1-hardcovers.mjs --remote --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { primaryAuthor, sortTitleFor, workKeyFor } from '../packages/core/src/titles.ts';

const flags = parseFlags();
const q = (sql) => query(sql, { remote: flags.remote });

const TITLE = 'Dungeon Crawler Carl';
const AUTHOR = 'Matt Dinniman';
const SERIES = 'Dungeon Crawler Carl';
const URL = 'https://www.kickstarter.com/projects/dinniman/dungeon-crawler-carl-v1-hardcover-editions';

const EDITIONS = [
  { name: 'V1 Limited Edition hardcover', kind: 'collectors' },
  { name: 'V1 Standard hardcover', kind: null },
];

const key = workKeyFor(TITLE, AUTHOR);
const existing = q(`SELECT id, title FROM work WHERE work_key = ${lit(key)}`);

console.log(`\n${flags.remote ? 'REMOTE' : 'local'} database\n`);
console.log(`  work  ${SERIES} #1  "${TITLE}"  —  ${existing.length ? `already exists (id ${existing[0].id})` : 'will be created'}`);
console.log(`  key   ${key}`);
for (const e of EDITIONS) console.log(`  edition  ${e.name}${e.kind ? `  [${e.kind}]` : ''}  + owned copy`);

if (!flags.commit) { console.log('\nDRY RUN. Nothing written. Re-run with --commit.\n'); process.exit(0); }

if (!existing.length) {
  execute(
    [
      `INSERT INTO work (title, authors, primary_author, work_key, sort_title, series, series_index_sort, series_index_display)
       VALUES (${lit(TITLE)}, ${lit(AUTHOR)}, ${lit(primaryAuthor(AUTHOR))}, ${lit(key)},
               ${lit(sortTitleFor(TITLE))}, ${lit(SERIES)}, 1, '1');`,
    ],
    { remote: flags.remote },
  );
}

const wid = Number(q(`SELECT id FROM work WHERE work_key = ${lit(key)}`)[0].id);

const have = new Set(q(`SELECT edition_name FROM edition WHERE work_id = ${wid}`).map((r) => r.edition_name));
const add = EDITIONS.filter((e) => !have.has(e.name));
if (add.length) {
  execute(
    add.map(
      (e) =>
        `INSERT INTO edition (work_id, format, edition_name, edition_kind, source, source_url)
         VALUES (${wid}, 'hardcover', ${lit(e.name)}, ${e.kind ? lit(e.kind) : 'NULL'}, 'manual', ${lit(URL)});`,
    ),
    { remote: flags.remote },
  );
}

// ⚠️ Copies in a separate pass after re-reading the editions — building both
// from one in-memory view silently wrote zero copies earlier today.
const copies = [];
for (const e of q(`SELECT id, edition_name FROM edition WHERE work_id = ${wid}`)) {
  const eid = Number(e.id);
  if (q(`SELECT id FROM copy WHERE edition_id = ${eid}`).length) continue;
  copies.push(
    `INSERT INTO copy (work_id, edition_id, status, vendor, notes)
     VALUES (${wid}, ${eid}, 'owned', 'Kickstarter',
             'DCC V1 Hardcover Editions. LATE PLEDGE through the creator pledge manager, which is why it never appeared on the Kickstarter backings page.');`,
  );
}
if (copies.length) execute(copies, { remote: flags.remote });

const after = q(
  `SELECT w.id, w.title, w.series_index_display vol, e.edition_name, e.edition_kind, c.status
     FROM work w JOIN edition e ON e.work_id = w.id LEFT JOIN copy c ON c.edition_id = e.id
    WHERE w.id = ${wid} ORDER BY e.id`,
);
console.log('\nverified by re-reading:');
for (const r of after) {
  console.log(`  #${r.vol}  ${r.title}  —  ${r.edition_name} [${r.edition_kind ?? 'ordinary'}]  ${r.status ?? 'NO COPY'}`);
}
const ok = after.length === 2 && after.every((r) => r.status === 'owned');
console.log(ok ? '\nBook 1 recorded: two hardcovers, both owned.\n' : '\n⚠️ Expected two owned hardcovers.\n');
process.exit(ok ? 0 : 1);
