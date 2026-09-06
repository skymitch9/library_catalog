/**
 * Data repair: one ISBN sitting on **two different volumes of the same series**.
 *
 * The writer half is fixed in `packages/core/src/matching.ts`
 * (`seriesVolumeNumber` / `numberedTitleAgrees`, pinned by
 * `packages/core/test/numbered-title.test.ts`) and wired into rungs 1 and 2 of
 * `scripts/backfill-missing-isbns.mjs`. **This is the data half**, modelled on
 * `fix-foreign-isbns-2026-09-05.mjs`: dry run by default, `--commit` gated,
 * asserted from-values, one `change_log` row per changed field.
 *
 * ## The defect it looks for
 *
 * Measured 2026-09-06 in the `--remote` dry run of the ISBN backfill: Google
 * Books proposed the **same** ISBN `9781986619233` for *Space Knight* books
 * **5, 6, 7, 8 and 9**. The rung's title gate is `titleSimilarity >= 0.80`, and
 * `titleSimilarity` drops words of one character and weighs a digit like any
 * other word — so *"space knight book 5"* against *"space knight book 7"*
 * shares every word it can see and scores **1.00**. Five different books, one
 * identifier, nothing in the response marking it.
 *
 * ## ⚠️ Why this script found nothing, and why that is the RIGHT answer
 *
 * `migrations/0001_init.sql` line 234:
 *
 *     CREATE UNIQUE INDEX idx_edition_isbn13 ON edition(isbn13) WHERE isbn13 IS NOT NULL;
 *
 * The index is **catalog-wide**, so a second work can never receive an ISBN a
 * first one already holds — four of those five writes were refused by the
 * database. Measured 2026-09-06 on both production instances, and this script
 * re-measures it on every run rather than quoting the number:
 *
 * | | works sharing an ISBN with another work |
 * |---|---|
 * | main `library-catalog` | **0** |
 * | padhard `library-catalog-2nd` | **0** |
 *
 * 🔴 **A zero here is a result, not an absence of work** — and it is emphatically
 * NOT evidence that the ladder proposed the right ISBN. An index is a
 * **backstop, not a gate**: it refuses the SECOND write and says nothing at all
 * about whether the FIRST one was right. The one Space Knight ISBN that did land
 * (ed#344, *Book 3*) was cleared for an unrelated reason — the owner's
 * crowdfunding ruling, tier C of `fix-foreign-isbns-2026-09-05.mjs`, applied
 * 2026-09-06 02:32:09Z. Nobody has established which volume `9781986619233`
 * actually belongs to.
 *
 * This script therefore exists for two reasons, both real:
 *
 *   1. **To keep measuring.** The index is a partial index on ONE column; a
 *      future ISBN written from a different door (an import, a person typing,
 *      a restored backup that predates the index) can still create the shape.
 *   2. **To be ready with a rule rather than a judgement**, so the repair is
 *      reviewable before there is anything to review.
 *
 * ## The rule, when a group IS found
 *
 * Within one shared-ISBN group in one series, the identifier can be right for at
 * most ONE volume, and the data alone cannot say which. So:
 *
 *   - **Exactly one member has `source = 'manual'`** → that is where a person
 *     put it; keep it, clear the automated members. Same standard as
 *     `fix-foreign-isbns`: `'manual'` outranks everything and is never
 *     overwritten automatically.
 *   - **Zero or more than one manual member** → 🔴 **REFUSE the whole group and
 *     print it.** Guessing which volume owns an identifier is exactly the
 *     failure that created this defect, and doing it in the repair would be
 *     worse than doing it in the writer.
 *
 * ⚠️ It writes NULL, never a corrected ISBN. NULL is a gap the ladder can find
 * later; a plausible number is a silent one — the same reasoning as its two
 * sibling repair scripts.
 *
 *   node scripts/fix-same-isbn-series-2026-09-05.mjs --remote            # dry run, main
 *   node scripts/fix-same-isbn-series-2026-09-05.mjs --remote --friend   # dry run, padhard
 *   node scripts/fix-same-isbn-series-2026-09-05.mjs --remote --commit   # apply (owner)
 *
 * ⚠️ `--all-series` widens the group test from *"same series"* to *"any two
 * works"*. Off by default because two works legitimately sharing an ISBN across
 * series is a different question (an omnibus, a re-titled reissue) that wants a
 * person, not this rule.
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const BATCH = 'fix-2026-09-05-same-isbn-series';

const WHY =
  'This ISBN sat on more than one work in the same series. A title-search rung matched a ' +
  'numbered volume against a different volume of the same series: titleSimilarity drops ' +
  'one-character words and weighs a digit like any other word, so "space knight book 5" and ' +
  '"space knight book 7" score 1.00 and pass the 0.80 gate. Measured 2026-09-06: Google Books ' +
  'proposed 9781986619233 for Space Knight books 5, 6, 7, 8 and 9. The writer can no longer do ' +
  'this — packages/core/src/matching.ts numberedTitleAgrees now requires the volume number to ' +
  'agree (or the candidate to carry none) on rungs 1 and 2 of ' +
  'scripts/backfill-missing-isbns.mjs. NULL rather than a corrected ISBN because nothing in the ' +
  'data says which volume the identifier belongs to, and a plausible number is a silent one. ' +
  'Evidence and rule: scripts/fix-same-isbn-series-2026-09-05.mjs.';

const flags = parseFlags();
const allSeries = process.argv.includes('--all-series');
const target = { remote: flags.remote, friend: flags.friend };
const q = (sql) => query(sql, target);
const where = flags.friend ? 'padhard' : flags.remote ? 'production' : 'local';

/**
 * ⚠️ `changed_by` is a real `app_user(id)` and the instances do NOT share one.
 * On main, 1 is the owner. On padhard, user 1 is HER, and stamping her name on a
 * repair she did not make would be a lie in the one table written to be trusted.
 * Copied deliberately from `fix-foreign-isbns-2026-09-05.mjs` rather than
 * inferred — it is the same fact about the same two databases.
 */
const CHANGED_BY = flags.friend ? 'NULL' : '1';

// ---------------------------------------------------------------------------
// 1. Measure. Every run re-measures both signatures; nothing is asserted from
//    this file's header.
// ---------------------------------------------------------------------------
console.log(`\n${where}: looking for one ISBN on two works${allSeries ? '' : ' of the same series'}.`);

/**
 * Every ISBN that appears on more than one WORK, with the rows that carry it.
 *
 * ⚠️ `COUNT(DISTINCT work_id)`, not `COUNT(*)`: one work legitimately has two
 * edition rows for one printing in some import shapes, and that is not this
 * defect.
 */
const shared = q(
  `SELECT e.isbn13, COUNT(DISTINCT e.work_id) AS works
     FROM edition e
    WHERE e.isbn13 IS NOT NULL
    GROUP BY e.isbn13
   HAVING COUNT(DISTINCT e.work_id) > 1
    ORDER BY e.isbn13`,
);

console.log(`  ISBNs carried by more than one work: ${shared.length}`);
if (shared.length === 0) {
  console.log(
    '\n  ⚠️ That zero is what the UNIQUE index guarantees, not what the ladder got right.\n' +
      '     migrations/0001_init.sql:234 —\n' +
      '       CREATE UNIQUE INDEX idx_edition_isbn13 ON edition(isbn13) WHERE isbn13 IS NOT NULL\n' +
      '     is catalog-wide, so the SECOND write of a duplicate is refused by the database. It\n' +
      '     says nothing about whether the FIRST one was right, and four of the five Space Knight\n' +
      '     proposals never reached a row at all.',
  );
  console.log('\nNothing to do. That is a result, not a failure.');
  process.exit(0);
}

/*
 * Load the members of each group, with the series and volume number that decide
 * whether it is the defect this script is about.
 */
const isbnList = shared.map((r) => lit(r.isbn13)).join(',');
const members = q(
  `SELECT e.id AS edition_id, e.isbn13, e.source, e.edition_name,
          w.id AS work_id, w.title, w.series, w.series_index_sort
     FROM edition e JOIN work w ON w.id = e.work_id
    WHERE e.isbn13 IN (${isbnList})
    ORDER BY e.isbn13, e.id`,
);

const groups = new Map();
for (const m of members) {
  if (!groups.has(m.isbn13)) groups.set(m.isbn13, []);
  groups.get(m.isbn13).push(m);
}

// ---------------------------------------------------------------------------
// 2. Plan, one group at a time. A group this rule cannot settle is REFUSED and
//    printed, never guessed at.
// ---------------------------------------------------------------------------
const stmts = [];
const refused = [];
let cleared = 0;

for (const [isbn13, rows] of groups) {
  const works = [...new Set(rows.map((r) => r.work_id))];
  if (works.length < 2) continue;

  const seriesNames = [...new Set(rows.map((r) => r.series ?? '(none)'))];
  const sameSeries = seriesNames.length === 1 && seriesNames[0] !== '(none)';
  if (!sameSeries && !allSeries) {
    refused.push({
      isbn13,
      rows,
      why:
        'the works are not in one series (' + seriesNames.join(' / ') + '). Two works sharing an ' +
        'ISBN across series is a different question — an omnibus, a re-titled reissue — and wants ' +
        'a person. Pass --all-series to include it.',
    });
    continue;
  }

  console.log(`\n  ${isbn13} — ${works.length} works, series ${JSON.stringify(seriesNames[0])}`);
  for (const r of rows) {
    console.log(
      `      work #${r.work_id} ed#${r.edition_id} vol ${r.series_index_sort ?? '—'} ` +
        `source=${JSON.stringify(r.source)} ${r.title}`,
    );
  }

  const manual = rows.filter((r) => r.source === 'manual');
  if (manual.length !== 1) {
    refused.push({
      isbn13,
      rows,
      why:
        `${manual.length} of the ${rows.length} rows read source='manual'. The rule keeps the one ` +
        'a PERSON put the identifier on and clears the automated rest; with none or several there ' +
        'is nothing to keep it on, and guessing which volume owns an ISBN is the exact failure ' +
        'this repair exists for.',
    });
    continue;
  }

  const keep = manual[0];
  console.log(`      → keep ed#${keep.edition_id} (source 'manual' — a person put it there)`);
  for (const r of rows) {
    if (r.edition_id === keep.edition_id) continue;
    console.log(`      → clear ed#${r.edition_id} (work #${r.work_id}): isbn13 ${isbn13} -> NULL`);
    cleared++;
    stmts.push(
      `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
        VALUES (${lit(BATCH)}, 'edition', ${r.edition_id}, 'isbn13', ${lit(JSON.stringify(isbn13))}, 'null', ${CHANGED_BY}, 'auto', ${lit(WHY)});`,
      // ⚠️ The asserted from-value lives in the WHERE clause here rather than in
      // a pre-read, because the target set is discovered rather than listed: a
      // row that moved between the SELECT above and this UPDATE simply does not
      // match, and the re-read in step 4 catches it.
      `UPDATE edition SET isbn13 = NULL, updated_at = datetime('now')
        WHERE id = ${r.edition_id} AND isbn13 = ${lit(isbn13)};`,
    );
  }
}

if (refused.length > 0) {
  console.log(`\n🔴 ${refused.length} group(s) REFUSED — read them, do not widen the rule to fit:`);
  for (const g of refused) {
    console.log(`   ${g.isbn13}: ${g.why}`);
    for (const r of g.rows) {
      console.log(
        `      work #${r.work_id} ed#${r.edition_id} source=${JSON.stringify(r.source)} ` +
          `series=${JSON.stringify(r.series)} ${r.title}`,
      );
    }
  }
}

console.log(
  `\n${where}: ${cleared} isbn13(s) to null, ${cleared} change_log row(s), ` +
    `${refused.length} group(s) refused.`,
);

if (cleared === 0) {
  console.log('Nothing to write.');
  process.exit(0);
}

if (!flags.commit) {
  console.log(`[dry run] ${stmts.length} statement(s) would run. Pass --commit to write.`);
  process.exit(0);
}

execute(stmts, target);

// ---------------------------------------------------------------------------
// 3. Confirm by re-reading. `execute` returns statements run, never rows
//    changed — the local D1 omits `meta.changes` entirely, so a counter here
//    would lie in exactly the direction that hides a no-op.
// ---------------------------------------------------------------------------
const after = q(
  `SELECT e.isbn13, COUNT(DISTINCT e.work_id) AS works
     FROM edition e
    WHERE e.isbn13 IS NOT NULL
    GROUP BY e.isbn13
   HAVING COUNT(DISTINCT e.work_id) > 1`,
);
const stillShared = after.filter((r) => groups.has(r.isbn13));
if (stillShared.length > 0) {
  throw new Error(
    `${stillShared.length} ISBN(s) are still on more than one work: ` +
      stillShared.map((r) => r.isbn13).join(', '),
  );
}
const logged = q(`SELECT COUNT(*) AS n FROM change_log WHERE batch_id = ${lit(BATCH)}`);
console.log(`\nAfter: change_log holds ${logged[0]?.n} row(s) for ${BATCH}.`);
