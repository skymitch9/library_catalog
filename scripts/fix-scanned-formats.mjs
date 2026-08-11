/**
 * Correct the format on physical editions created by a barcode scan.
 *
 * ## Why these are wrong
 *
 * `apps/web/src/lib/catalog-add.ts` writes `format: 'paperback'` for every
 * barcode, with a comment reasoning that a barcode proves a printing exists but
 * not which one. That reasoning is sound and the chosen default was still
 * wrong: everything actually scanned has been a board book or a hardcover, so
 * the guess was incorrect on essentially every row it wrote.
 *
 * The user's rule, stated 2026-08-10: **a board book counts as a hardcover.**
 * They are boards, not card covers, and the catalog has no separate board-book
 * format — inventing one would fragment `PHYSICAL_FORMATS` for no gain.
 *
 * ## ⚠️ Scope, and why it is dated
 *
 * This converts `paperback` editions created ON a given day only. It is NOT
 * "make every paperback a hardcover" — real paperbacks exist and more are
 * coming from the Barnes & Noble import (four Wandering Inn volumes are
 * genuinely paperback). Restricting by creation date is what keeps a blunt
 * correction from becoming a lie about books it was never meant to touch.
 *
 * The user has said they will not scan any softcover book until the add path
 * stops guessing, so for the dated window the correction is safe.
 *
 * ## Running it
 *
 *   node scripts/fix-scanned-formats.mjs --remote                    # dry run
 *   node scripts/fix-scanned-formats.mjs --remote --commit           # apply
 *   node scripts/fix-scanned-formats.mjs --remote --day 2026-08-11   # pick the day
 */

import { execute, parseFlags, query } from './lib/d1.mjs';

const { commit, remote } = parseFlags();

const dayArg = process.argv.indexOf('--day');
const day = dayArg >= 0 && process.argv[dayArg + 1] ? process.argv[dayArg + 1] : null;

if (!day && !/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) {
  // Default to the only day physical editions exist on, but say so out loud
  // rather than quietly picking one.
  const days = query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS n
       FROM edition WHERE format = 'paperback'
      GROUP BY DATE(created_at) ORDER BY day DESC`,
    { remote },
  );
  if (days.length === 0) {
    console.log('No paperback editions at all. Nothing to do.');
    process.exit(0);
  }
  console.log('Paperback editions by creation day:');
  for (const d of days) console.log(`  ${d.day}  ${d.n}`);
  if (days.length > 1 && !day) {
    console.log('\n⚠️ More than one day has paperbacks. Pass --day YYYY-MM-DD to choose.');
    process.exit(1);
  }
}

const targetDay = day ?? query(
  `SELECT DATE(created_at) AS day FROM edition WHERE format = 'paperback'
    GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 1`,
  { remote },
)[0]?.day;

const rows = query(
  `SELECT e.id AS id, w.title AS title
     FROM edition e JOIN work w ON w.id = e.work_id
    WHERE e.format = 'paperback' AND DATE(e.created_at) = '${targetDay}'
    ORDER BY e.id`,
  { remote },
);

console.log(`\n${remote ? 'production' : 'local'}: ${rows.length} paperback edition(s) created ${targetDay}`);
for (const r of rows.slice(0, 8)) console.log(`  ${String(r.id).padStart(4)}  ${r.title}`);
if (rows.length > 8) console.log(`  ... and ${rows.length - 8} more`);

if (!commit) {
  console.log('\nDry run. Re-run with --commit to write.');
  process.exit(0);
}
if (rows.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

execute(
  rows.map(
    (r) =>
      `UPDATE edition SET format = 'hardcover', updated_at = datetime('now') WHERE id = ${r.id} AND format = 'paperback';`,
  ),
  { remote },
);

/*
 * ⚠️ Confirm by re-reading. `execute` returns statements run, not rows changed,
 * and local D1 omits `meta.changes` entirely — a previous backfill in this repo
 * reported "0 rows updated" over a run that had just written 114.
 */
const after = query(
  `SELECT format, COUNT(*) AS n FROM edition GROUP BY format ORDER BY n DESC`,
  { remote },
);
console.log(`\nwrote ${rows.length}. Formats now:`);
for (const f of after) console.log(`  ${String(f.n).padStart(4)}  ${f.format}`);
