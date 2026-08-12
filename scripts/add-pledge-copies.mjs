/**
 * Give the crowdfunded hardcovers the copy rows they never had.
 *
 * The owner, looking at the live site 2026-08-12: *"a lot of the kickstarter
 * books arent marked as preordered, such as most of the sanderson stuff."*
 *
 * ## What was actually wrong — worse than a wrong status
 *
 * All **nine** works linked to a crowdfunding pledge had **ZERO copy rows**.
 * Not a wrong status: nothing to hold a status at all. They each had an
 * `edition` — so the pledge and the printing were recorded — but no `copy`, so
 * nothing could be `preordered`, nothing appeared in the "on the way" count, and
 * the arrivals checklist had nothing to check off.
 *
 * The import that created them (`add-crowdfunded-works.mjs`) writes works, and
 * the pledge importer deliberately writes no work — between the two, the copy
 * fell down the gap.
 *
 * ⚠️ This is invisible on the shelf, which is why it survived: a work row IS
 * ownership in this catalog (108 copies against 224 works on 2026-08-11), so a
 * book with no copy still shows as held. Only the *preorder* half is lost.
 *
 * ## One copy each, on the HARDCOVER
 *
 * Five of the nine also carry an `ebook_epub` edition from the file ingest —
 * the household genuinely has those as files. The copy goes on the
 * `collectors` hardcover, because that is the thing the pledge bought. No copy
 * is created for the ebook editions: that would be inventing a second
 * acquisition, and the ~200 other ebook-only works have no copy row either.
 *
 * ## ⚠️ Every status below was READ off BackerKit on 2026-08-12, not inferred
 *
 *   "Your order has shipped"        -> owned       (+ tracking numbers listed)
 *   "Your order has been locked"    -> preordered  (survey done, not sent)
 *   "We received your order"        -> preordered
 *
 * The two Sanderson campaigns split on exactly this evidence, which is why the
 * owner saw some marked and others not: Four Secret Novels and Words of
 * Radiance have SHIPPED, Hoid's Storybook Collection has not.
 *
 *   node scripts/add-pledge-copies.mjs                 # dry run
 *   node scripts/add-pledge-copies.mjs --remote --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const flags = parseFlags();
const q = (sql) => query(sql, { remote: flags.remote });

/** workId -> [status, the BackerKit words it was read from]. */
const PLAN = [
  [28, 'owned', 'Four Secret Novels — Completed, "Your order has shipped", 12 tracking numbers'],
  [29, 'owned', 'Four Secret Novels — Completed, "Your order has shipped", 12 tracking numbers'],
  [31, 'owned', 'Four Secret Novels — Completed, "Your order has shipped", 12 tracking numbers'],
  [37, 'owned', 'Four Secret Novels — Completed, "Your order has shipped", 12 tracking numbers'],
  [220, 'owned', 'Words of Radiance Leatherbound — Completed, "Your order has shipped", 2 tracking numbers'],
  [219, 'preordered', "Hoid's Storybook Collection — Active, \"Your order has been locked\". NOT shipped"],
  [221, 'preordered', 'Primal Hunter Deluxe Box Set — Active, "We received your order"'],
  [222, 'preordered', 'DCC: Crocodile — Active, "Your order has been locked". Fulfilment early 2027'],
  [223, 'preordered', 'Ascend Online: Legacy of the Fallen — "We received your order"'],
];

const rows = q(
  `SELECT w.id wid, w.title, e.id eid, e.edition_name,
          (SELECT COUNT(*) FROM copy c WHERE c.work_id = w.id) copies
     FROM work w JOIN edition e ON e.work_id = w.id
    WHERE w.id IN (${PLAN.map(([id]) => id).join(',')})
      AND e.format = 'hardcover'
    ORDER BY w.id`,
);
const byWork = new Map(rows.map((r) => [Number(r.wid), r]));

console.log(`\n${flags.remote ? 'REMOTE' : 'local'} database\n`);
const todo = [];
for (const [wid, status, why] of PLAN) {
  const r = byWork.get(wid);
  if (!r) { console.log(`  ⚠️ SKIP work ${wid} — no hardcover edition found`); continue; }
  if (Number(r.copies) > 0) { console.log(`  skip  ${wid} ${String(r.title).slice(0, 34)} — already has ${r.copies} cop(y/ies)`); continue; }
  todo.push({ wid, eid: Number(r.eid), status, why, title: r.title });
  console.log(`  ${status.padEnd(11)} ${String(r.title).slice(0, 40).padEnd(42)} ed ${r.eid}`);
  console.log(`              ${why}`);
}

const owned = todo.filter((t) => t.status === 'owned').length;
const pre = todo.filter((t) => t.status === 'preordered').length;
console.log(`\n${todo.length} copies to create — ${owned} owned, ${pre} preordered\n`);

if (!flags.commit) { console.log('DRY RUN. Nothing written. Re-run with --commit.\n'); process.exit(0); }
if (!todo.length) { console.log('Nothing to do.\n'); process.exit(0); }

execute(
  todo.map(
    (t) =>
      `INSERT INTO copy (work_id, edition_id, status, vendor, notes)
       VALUES (${t.wid}, ${t.eid}, ${lit(t.status)}, 'Crowdfunding', ${lit(t.why)});`,
  ),
  { remote: flags.remote },
);

// Re-read rather than trust the batch — a copy insert silently wrote nothing
// once already today when it was built from the same in-memory view as its
// edition. This pass reads the database back.
const after = q(
  `SELECT w.id, w.title, c.status
     FROM work w JOIN copy c ON c.work_id = w.id
    WHERE w.id IN (${PLAN.map(([id]) => id).join(',')})
    ORDER BY w.id`,
);
console.log('verified by re-reading:');
for (const r of after) console.log(`  ${String(r.status).padEnd(11)} ${r.title}`);

const totals = q(
  `SELECT status, COUNT(*) n FROM copy GROUP BY status ORDER BY n DESC`,
);
console.log('\nwhole catalog now:');
for (const t of totals) console.log(`  ${String(t.status).padEnd(12)} ${t.n}`);
console.log(after.length === todo.length ? '\nAll copies confirmed.\n' : `\n⚠️ Expected ${todo.length}, read back ${after.length}.\n`);
