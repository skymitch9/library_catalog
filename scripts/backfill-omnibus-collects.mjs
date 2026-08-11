/**
 * Move "what is inside this book" out of the edition NAME and into a column.
 *
 * ## Why this exists
 *
 * The owner, 2026-08-11: *"Omnibus is not edition information."* They are right,
 * and two production rows prove it. *White Sand* is work **90** and has two
 * printings, both `ebook_epub`:
 *
 *     107  edition_name = 'Volume 1'
 *     206  edition_name = 'Omnibus - collects volumes 1-3'   2024, 490pp
 *
 * `edition_name` is what the *shop* called a printing — "Illumicrate Exclusive",
 * "Signed Leatherbound". Neither of those two is that. They say which parts of
 * the story are between the covers, which migration 0050 identified as a
 * different axis and explicitly refused to fold into `edition_kind`. Migration
 * 0060 is the column it promised; this fills it.
 *
 * ## ⚠️ What this deliberately does NOT do
 *
 * **It creates no works and no `work_relation` rows.** An omnibus is arguably a
 * work containing three volume works — and in this catalog the three volumes are
 * **not rows**. Minting them would mean guessing three titles, and a guessed
 * title is a *permanent* duplicate: `POST /api/works` does not dedupe (migration
 * 0001 says why), the wrong row would collect its own copies and reviews, and
 * nothing would ever notice. So the honest statement gets recorded — "this
 * printing has volumes 1-3 in it" — and the statement that needs two rows waits
 * until there are two rows. When the volumes ever become real, the relation is
 * one tap in the Related panel and this column is still true.
 *
 * **It does not delete edition 107.** The owner has said to ignore that file: a
 * bare old download, superseded by the omnibus. "Ignore" is not "delete", and
 * this script does not decide that on their behalf. What it does is make the
 * supersession *legible* — once both rows carry `collects`, the Editions panel
 * reads "Contains Volume 1" against "Contains Volumes 1-3" and the relationship
 * between the two files is on the screen instead of in somebody's memory.
 *
 * **It does not touch `edition_name`.** Half of the 0050 ask was that the visible
 * listing keeps the vendor's own words. These two were typed by us rather than a
 * vendor, so there is a case for clearing them — but it is a decision, not a
 * backfill, and the panel now shows both lines without contradiction.
 *
 * ## Matched on the exact string, never on the id
 *
 * ⚠️ Ids move between databases. A local D1 restored from a different point has
 * different ids for the same books, and an `UPDATE … WHERE id = 206` against it
 * would rewrite an unrelated printing. Every statement below matches on
 * `edition_name` and re-checks `collects IS NULL`, so it is idempotent, safe in
 * any database, and writes **nothing at all** in one that does not hold these
 * rows. The same rule migration 0040 followed for the Percy Jackson covers.
 *
 * ## Running it
 *
 *   node scripts/backfill-omnibus-collects.mjs                    # dry run, local
 *   node scripts/backfill-omnibus-collects.mjs --remote           # dry run, production
 *   node scripts/backfill-omnibus-collects.mjs --remote --commit  # apply
 *
 * ⚠️ Migrate first. `collects` does not exist until 0060 has been applied, and a
 * run against an older schema fails with `no such column`.
 */

import { execute, parseFlags, query } from './lib/d1.mjs';

const { commit, remote } = parseFlags();

/** A SQL string literal. Doubling the quote is the whole of SQLite's escaping. */
const sql = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

/**
 * The names that are contents statements, and what each one actually says.
 *
 * ⚠️ Only strings already in production, and only ones whose meaning is not in
 * doubt. There is deliberately no pattern-matcher here: "Volume 1" is a contents
 * statement and "Volume 1 Exclusive Cover" is a contents statement *and* an
 * edition name, and a regex that tried to sort the second one would eventually
 * rewrite a printing nobody looked at. Thirteen distinct edition names exist in
 * the catalog; two of them are on this list, and the other eleven are handled by
 * `edition_kind` where they belong.
 */
const CONTENTS = new Map([
  ['Omnibus - collects volumes 1-3', 'Volumes 1-3'],
  ['Volume 1', 'Volume 1'],
]);

const NAMED = `
  SELECT e.id           AS id,
         e.work_id      AS workId,
         e.format       AS format,
         e.edition_name AS name,
         e.collects     AS collects,
         w.title        AS title
    FROM edition e
    JOIN work w ON w.id = e.work_id
   WHERE e.edition_name IS NOT NULL AND e.edition_name <> ''
   ORDER BY e.id
`;

const rows = query(NAMED, { remote });

const targets = [];
const already = [];
for (const r of rows) {
  const says = CONTENTS.get(String(r.name).trim());
  if (!says) continue;
  if (r.collects) already.push(r);
  else targets.push({ ...r, collects: says });
}

console.log(`\n${remote ? 'production' : 'local'}: ${rows.length} named edition(s)`);

console.log(`\nwill record what is inside (${targets.length}):`);
for (const r of targets) {
  console.log(
    `  ${String(r.id).padStart(4)}  ${String(r.collects).padEnd(14)}` +
      `"${String(r.name).slice(0, 40)}"`.padEnd(44) +
      String(r.title).slice(0, 28),
  );
}

if (already.length > 0) {
  console.log(`\nalready recorded, left alone (${already.length}):`);
  for (const r of already) {
    console.log(`  ${String(r.id).padStart(4)}  ${r.collects} — ${String(r.title).slice(0, 40)}`);
  }
}

/*
 * ⚠️ Said out loud every run, because it is the decision this script is most
 * likely to be blamed for later. A silent omission and a considered one look
 * identical in a log that does not name them.
 */
console.log(
  '\n⚠️ No works and no relations are created.\n' +
    "   White Sand's three volumes are not rows in this catalog, and inventing them\n" +
    '   would mean guessing three titles. A guessed title is a permanent duplicate.\n' +
    '   Record the omnibus fact now; link the volumes when they exist.',
);

if (!commit) {
  console.log('\nDry run. Re-run with --commit to write.');
  process.exit(0);
}

if (targets.length === 0) {
  console.log('\nNothing to do.');
  process.exit(0);
}

const statements = targets.map(
  (r) =>
    `UPDATE edition SET collects = ${sql(r.collects)}, updated_at = datetime('now')
      WHERE edition_name = ${sql(r.name)} AND collects IS NULL;`,
);

execute(statements, { remote });

/*
 * ⚠️ Confirm by RE-READING, never by trusting the statement count. `execute`
 * returns how many statements ran, not how many rows changed — local D1 omits
 * `meta.changes` entirely — and `docs/TODO.md` records this helper returning an
 * empty result over 99 live rows and a script reporting "nothing to do".
 */
const after = query(
  `SELECT (SELECT COUNT(*) FROM edition WHERE collects IS NOT NULL) AS recorded,
          (SELECT COUNT(*) FROM edition) AS total`,
  { remote },
)[0];

if (!after) {
  console.log(
    '\n⚠️ The confirming read returned NOTHING. The write may well have landed — this ' +
      'helper has returned an empty result over live rows before. Re-read by hand before ' +
      're-running; a second run is safe but a wrong conclusion is not.',
  );
  process.exit(1);
}

console.log(`\nnow: ${after.recorded} of ${after.total} editions record what is inside them.`);

if (Number(after.recorded) < targets.length) {
  console.log(
    `\n⚠️ That is not the arithmetic expected — ${targets.length} row(s) were written and ` +
      `only ${after.recorded} carry the column. Investigate before re-running.`,
  );
  process.exit(1);
}
