/**
 * The Illumicrate exclusive Percy Jackson set — a one-off, imported by hand.
 *
 * ## Why this is its own script and not the crowdfunding importer
 *
 * Illumicrate is a **shop**, not a campaign. The test recorded in
 * `docs/info/crowdfunding-and-accessories.md` is whether the money bought a
 * promise or a product, and this bought a product — so it belongs in
 * `copy.vendor` / `copy.acquired_on` / `copy.price_paid_cents`, exactly like the
 * Barnes & Noble orders, and NOT in `crowdfunding_pledge`. Same reasoning that
 * keeps B&N out of the pledge tables.
 *
 * The user's instruction was explicit: this vendor is a one-off, so do not scan
 * the rest of their site — use the announcement page and stop.
 *
 * ## ⚠️ What is observed and what is not
 *
 * The vendor page never lists the individual volumes. It says only "Percy
 * Jackson and the Olympians series". The five titles below are the standard
 * contents of that series, **supplied here, not read off the page**. Everything
 * else — royal hardback, redesigned covers, foil, printed edges, illustrated
 * endpapers, the digital signature, the author letter in book one, £125 — is on
 * the page.
 *
 * ⚠️ **"Digitally signed" is not signed.** It is a printed reproduction, so
 * `copy.is_signed` stays 0 and the fact goes in `edition_notes`. The user
 * confirmed that choice: "You can put the digitally signed bit in the edition
 * notes."
 *
 * ## The author letter
 *
 * Book one, and only book one, ships an author letter. That is the case
 * `book_accessory.copy_id` exists for: it belongs to a specific copy in a
 * specific set, not to the abstract work.
 *
 *   node scripts/import-illumicrate-percy-jackson.mjs --remote
 *   node scripts/import-illumicrate-percy-jackson.mjs --remote --commit
 */

import { primaryAuthor, workKeyFor } from '../packages/core/src/titles.ts';
import { execute, parseFlags, query } from './lib/d1.mjs';

const { commit, remote } = parseFlags();

const AUTHORS = 'Rick Riordan';
const SERIES = 'Percy Jackson and the Olympians';
const EDITION_NAME = 'Illumicrate Exclusive';
const VENDOR = 'Illumicrate';
const NOTES =
  'Illumicrate exclusive reprint. Royal hardback, redesigned covers (art by Sijahongart, design by Chattynora), foil embossing, digitally printed edges, illustrated endpapers. Digitally signed by the author — a printed reproduction, NOT a hand signature, so is_signed stays 0.';

const BOOKS = [
  { index: 1, title: 'The Lightning Thief' },
  { index: 2, title: 'The Sea of Monsters' },
  { index: 3, title: "The Titan's Curse" },
  { index: 4, title: 'The Battle of the Labyrinth' },
  { index: 5, title: 'The Last Olympian' },
];

/** £125 for five books. Recorded per copy, in pence, with the currency named. */
const SET_PRICE_PENCE = 12500;
const PER_COPY_PENCE = Math.round(SET_PRICE_PENCE / BOOKS.length);

const sql = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const held = new Set(query('SELECT work_key FROM work', { remote }).map((r) => r.work_key));

const plan = BOOKS.map((b) => ({
  ...b,
  key: workKeyFor(b.title, AUTHORS),
  primary: primaryAuthor(AUTHORS),
})).map((b) => ({ ...b, exists: held.has(b.key) }));

console.log(`\n${remote ? 'production' : 'local'} — Illumicrate Percy Jackson set`);
for (const b of plan) {
  console.log(`  ${b.index}. ${b.title}${b.exists ? '   (work already held — will attach an edition only)' : ''}`);
}
console.log(`\n  edition_name: ${EDITION_NAME}   vendor: ${VENDOR}   ${PER_COPY_PENCE}p per copy of ${SET_PRICE_PENCE}p`);
console.log('  accessory: author letter, attached to the copy of book 1 only');

if (!commit) {
  console.log('\nDry run. Re-run with --commit to write.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Works. Only the ones we do not already hold — attaching an exclusive edition
// to a book already on the shelf is the ordinary case, not an error.
// ---------------------------------------------------------------------------
const newWorks = plan.filter((b) => !b.exists);
if (newWorks.length) {
  execute(
    newWorks.map(
      (b) =>
        `INSERT INTO work (title, authors, primary_author, work_key, series, series_index_sort, series_index_display)
         VALUES (${sql(b.title)}, ${sql(AUTHORS)}, ${sql(b.primary)}, ${sql(b.key)}, ${sql(SERIES)}, ${b.index}, ${sql(String(b.index))});`,
    ),
    { remote },
  );
}

const ids = new Map(
  query(
    `SELECT id, work_key FROM work WHERE work_key IN (${plan.map((b) => sql(b.key)).join(',')})`,
    { remote },
  ).map((r) => [r.work_key, r.id]),
);
for (const b of plan) {
  if (!ids.has(b.key)) throw new Error(`work missing after insert: ${b.title}`);
}

// ---------------------------------------------------------------------------
// One edition each, then one owned copy each.
// ---------------------------------------------------------------------------
execute(
  plan.map(
    (b) =>
      `INSERT INTO edition (work_id, format, edition_name, publisher, source)
       VALUES (${ids.get(b.key)}, 'hardcover', ${sql(EDITION_NAME)}, ${sql(VENDOR)}, 'manual');`,
  ),
  { remote },
);

const editions = new Map(
  query(
    `SELECT id, work_id FROM edition WHERE edition_name = ${sql(EDITION_NAME)}`,
    { remote },
  ).map((r) => [r.work_id, r.id]),
);

execute(
  plan.map(
    (b) =>
      `INSERT INTO copy (work_id, edition_id, status, vendor, price_paid_cents, currency, condition, is_signed, edition_notes)
       VALUES (${ids.get(b.key)}, ${editions.get(ids.get(b.key)) ?? 'NULL'}, 'owned', ${sql(VENDOR)}, ${PER_COPY_PENCE}, 'GBP', 'new', 0, ${sql(NOTES)});`,
    ),
    { remote },
);

// ---------------------------------------------------------------------------
// The author letter — book one's copy only.
// ---------------------------------------------------------------------------
const book1 = ids.get(plan[0].key);
const copy1 = query(
  `SELECT id FROM copy WHERE work_id = ${book1} AND vendor = ${sql(VENDOR)} ORDER BY id DESC LIMIT 1`,
  { remote },
)[0]?.id;

execute(
  [
    `INSERT INTO book_accessory (work_id, copy_id, name, kind, notes)
     VALUES (${book1}, ${copy1 ?? 'NULL'}, 'Author letter (Illumicrate exclusive)', 'other', 'Ships in book one of the set only.');`,
  ],
  { remote },
);

// ⚠️ Confirm by re-reading. `execute` returns statements run, not rows changed.
const check = query(
  `SELECT w.title AS title, e.edition_name AS ed, c.id AS copy_id,
          (SELECT COUNT(*) FROM book_accessory a WHERE a.work_id = w.id) AS acc
     FROM work w
     JOIN edition e ON e.work_id = w.id AND e.edition_name = ${sql(EDITION_NAME)}
     LEFT JOIN copy c ON c.work_id = w.id AND c.vendor = ${sql(VENDOR)}
    ORDER BY w.series_index_sort`,
  { remote },
);
console.log(`\nconfirmed ${check.length} of ${BOOKS.length}:`);
for (const r of check) console.log(`  ${r.title} — ${r.ed} — copy ${r.copy_id} — ${r.acc} accessory`);
if (check.length !== BOOKS.length) console.log('⚠️ Count mismatch — investigate before re-running.');
