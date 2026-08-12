/**
 * Record the Dungeon Crawler Carl V2 & V3 limited-edition hardcover Kickstarter.
 *
 * The owner, 2026-08-11, after the series showed AUDIO? on all eight rungs:
 * *"I own this https://www.kickstarter.com/projects/dinniman/
 * dungeon-crawler-carl-v2-and-v3-limited-edition-hardcovers"*.
 *
 * ## What this fixes, and why it is not a matcher change
 *
 * Dungeon Crawler Carl was one of three series still hedged at `AUDIO?`. The
 * hedge was CORRECT: the only DCC row we held was work 222, *Crocodile* — the
 * graphic novel side-story about Florin DuPont, deliberately unnumbered — so
 * nothing in this catalog agreed with the audiobook catalog about a volume
 * number, and `series_matched_via` stayed `'fold'`.
 *
 * These two books are the missing corroboration. Our *Carl's Doomsday Scenario*
 * at volume 2 and *The Dungeon Anarchist's Cookbook* at volume 3 meet the
 * audiobook rows of the same name at the same numbers, so one run of
 * `backfill:audiobooks` should promote all eight rungs to a confident `AUDIO`.
 *
 * ⚠️ Nothing about the matcher is being loosened. The evidence changed.
 *
 * ## ⚠️ Derived columns are derived HERE, by the same functions
 *
 * `work_key`, `sort_title` and `primary_author` are normally computed inside
 * `packages/db/src/works.ts` and nowhere else — see CLAUDE.md, "each is the ONE
 * implementation". This script writes SQL directly, so it imports the very same
 * helpers rather than reimplementing them. A hand-rolled `work_key` here would
 * silently fail to join to the audiobook bridge, which is the whole point.
 *
 * `universe` is deliberately left NULL: DCC is in no shared universe, and NULL
 * is the ordinary case, not "nobody looked".
 *
 * ## Titles are written by hand, on purpose
 *
 * `import-crowdfunding.mjs` refuses to mint works from reward names because a
 * campaign's spelling ("V2 & V3 LIMITED Edition Hardcovers!") is exactly what
 * creates a duplicate of a book already on the shelf. Same rule here: these are
 * the published titles, taken from the campaign's own update text, not from the
 * tier name.
 *
 *   node scripts/add-dcc-kickstarter.mjs              # dry run
 *   node scripts/add-dcc-kickstarter.mjs --remote --commit
 *
 * Then: npm run backfill:audiobooks -- --remote --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { primaryAuthor, sortTitleFor, workKeyFor } from '../packages/core/src/titles.ts';

const flags = parseFlags();
const q = (sql) => query(sql, { remote: flags.remote });

const AUTHOR = 'Matt Dinniman';
const SERIES = 'Dungeon Crawler Carl';
const CAMPAIGN = 'Dungeon Crawler Carl - V2 & V3 LIMITED Edition Hardcovers!';
const URL = 'https://www.kickstarter.com/projects/dinniman/dungeon-crawler-carl-v2-and-v3-limited-edition-hardcovers';

const BOOKS = [
  { title: "Carl's Doomsday Scenario", index: 2 },
  { title: "The Dungeon Anarchist's Cookbook", index: 3 },
];

for (const b of BOOKS) {
  b.key = workKeyFor(b.title, AUTHOR);
  b.sort = sortTitleFor(b.title);
  b.primary = primaryAuthor(AUTHOR);
}

const existing = new Set(q('SELECT work_key FROM work').map((r) => r.work_key));
const todo = BOOKS.filter((b) => !existing.has(b.key));

console.log(`\n${flags.remote ? 'REMOTE' : 'local'} database\n`);
for (const b of BOOKS) {
  const dup = existing.has(b.key);
  console.log(`  ${dup ? 'ALREADY PRESENT — skipping' : 'create'}  ${SERIES} #${b.index}  ${b.title}`);
  console.log(`      work_key=${b.key}`);
  console.log(`      sort_title=${b.sort}  primary_author=${b.primary}`);
}

// Does the campaign already exist? Re-running must not mint a second one.
const camp = q(`SELECT id FROM crowdfunding_campaign WHERE url = ${lit(URL)}`);
console.log(`\n  campaign row: ${camp.length ? `already present (id ${camp[0].id})` : 'will be created'}`);
// ⚠️ NO `crowdfunding_pledge` OR `pledge_item` ROW IS WRITTEN, on purpose. Those
// carry a tier, an amount and a pledge date, and none of the three is known
// here — the owner named the project, not their pledge. Writing a pledge with
// invented or NULL money in it would look like an import that had run, and the
// next reader would trust it. The provenance that IS known lives on the
// edition: source='crowdfunding' and source_url pointing at the campaign.
// If the pledge is ever wanted, read it off the Kickstarter account and add it.
console.log('  pledge/tier/amount: NOT recorded — unknown, see the comment in this file');
console.log(`  ${todo.length} work(s) to create\n`);

if (!flags.commit) {
  console.log('DRY RUN. Nothing written. Re-run with --commit.\n');
  process.exit(0);
}

if (!camp.length) {
  execute(
    [
      `INSERT INTO crowdfunding_campaign (platform, name, creator, url)
       VALUES ('kickstarter', ${lit(CAMPAIGN)}, ${lit(AUTHOR)}, ${lit(URL)});`,
    ],
    { remote: flags.remote },
  );
}

if (todo.length) {
  execute(
    todo.map(
      (b) =>
        `INSERT INTO work (title, authors, primary_author, work_key, sort_title, series, series_index_sort, series_index_display)
         VALUES (${lit(b.title)}, ${lit(AUTHOR)}, ${lit(b.primary)}, ${lit(b.key)}, ${lit(b.sort)},
                 ${lit(SERIES)}, ${b.index}, ${lit(String(b.index))});`,
    ),
    { remote: flags.remote },
  );
}

const made = q(
  `SELECT id, title, work_key FROM work WHERE work_key IN (${BOOKS.map((b) => lit(b.key)).join(',')}) ORDER BY series_index_sort`,
);
const idOf = new Map(made.map((r) => [r.work_key, Number(r.id)]));

// One hardcover edition per book, marked as the limited edition it is. The
// `collectors` kind is the estate's normalised value for a special printing —
// the campaign's own name for it stays visible in `edition_name`.
const needEdition = made.filter(
  (r) => !q(`SELECT id FROM edition WHERE work_id = ${Number(r.id)}`).length,
);
if (needEdition.length) {
  execute(
    needEdition.map(
      (r) =>
        // ⚠️ source='manual', NOT 'crowdfunding'. The CHECK on edition.source
        // allows only manual/openlibrary/googlebooks/kindle/file/research/cwa,
        // and 'crowdfunding' failed the whole batch on the first run. This is a
        // hand-entered record, so 'manual' is both legal and honest; the
        // campaign it came from is in source_url.
        `INSERT INTO edition (work_id, format, edition_name, edition_kind, source, source_url)
         VALUES (${Number(r.id)}, 'hardcover', ${lit('Kickstarter limited edition hardcover')},
                 'collectors', 'manual', ${lit(URL)});`,
    ),
    { remote: flags.remote },
  );
}

const eds = q(
  `SELECT id, work_id FROM edition WHERE work_id IN (${made.map((r) => Number(r.id)).join(',')})`,
);
const needCopy = eds.filter((e) => !q(`SELECT id FROM copy WHERE edition_id = ${Number(e.id)}`).length);
if (needCopy.length) {
  execute(
    needCopy.map(
      (e) =>
        `INSERT INTO copy (work_id, edition_id, status, vendor)
         VALUES (${Number(e.work_id)}, ${Number(e.id)}, 'owned', 'Kickstarter');`,
    ),
    { remote: flags.remote },
  );
}

console.log('verified by re-reading:');
const final = q(
  `SELECT w.id, w.title, w.series_index_display AS vol,
          (SELECT COUNT(*) FROM edition e WHERE e.work_id = w.id) AS eds,
          (SELECT COUNT(*) FROM copy c JOIN edition e2 ON e2.id = c.edition_id WHERE e2.work_id = w.id) AS copies
     FROM work w WHERE w.work_key IN (${BOOKS.map((b) => lit(b.key)).join(',')})
    ORDER BY w.series_index_sort`,
);
for (const r of final) {
  console.log(`  ${String(r.id).padStart(4)}  #${r.vol}  ${r.title}  editions=${r.eds} copies=${r.copies}`);
}
const ok = final.length === BOOKS.length && final.every((r) => Number(r.eds) >= 1 && Number(r.copies) >= 1);
console.log(ok ? '\nBoth books present with an owned hardcover copy.\n' : '\n⚠️ Re-read does not match.\n');
console.log('Next: npm run backfill:audiobooks -- --remote --commit\n');
process.exit(ok ? 0 : 1);
