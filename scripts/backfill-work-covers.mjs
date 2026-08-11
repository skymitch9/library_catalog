/**
 * Lift a cover from an edition up onto its work.
 *
 * ## Why this exists
 *
 * `catalog-add.ts` used to create the work from `{ title, authors }` alone
 * while the edition beside it took `line.coverUrl`. Both statements read
 * correctly on their own. But every list in the app renders `work.cover_url`,
 * so a barcode scan produced a book with a perfectly good cover URL stored one
 * table away and a blank tile on screen.
 *
 * Measured before the fix: 143 editions carried 20 covers, and **all 20**
 * belonged to works showing none. The add path is fixed going forward; this
 * script is for the books already in the catalog.
 *
 * ## What it will not do
 *
 * ⚠️ It only fills works whose `cover_url` is null or empty. A cover already on
 * file was either chosen deliberately or came from the audiobook catalog, and a
 * print edition's thumbnail is not a reason to replace it. This script is
 * therefore safe to re-run: a second pass has nothing left to match.
 *
 * When a work has several editions with covers, the lowest edition id wins —
 * arbitrary, but deterministic, which matters more here than being clever.
 *
 * ## Running it
 *
 *   node scripts/backfill-work-covers.mjs                      # dry run, local
 *   node scripts/backfill-work-covers.mjs --remote             # dry run, production
 *   node scripts/backfill-work-covers.mjs --remote --commit    # apply
 */

import { execute, parseFlags, query } from './lib/d1.mjs';

const { commit, remote, limit } = parseFlags();

/** D1 takes no bind parameters through `--file`, so the value goes in escaped. */
function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const CANDIDATES = `
  SELECT w.id                AS id,
         w.title             AS title,
         (SELECT e.cover_url
            FROM edition e
           WHERE e.work_id = w.id
             AND e.cover_url IS NOT NULL
             AND e.cover_url <> ''
           ORDER BY e.id
           LIMIT 1)          AS cover
    FROM work w
   WHERE (w.cover_url IS NULL OR w.cover_url = '')
     AND EXISTS (SELECT 1
                   FROM edition e2
                  WHERE e2.work_id = w.id
                    AND e2.cover_url IS NOT NULL
                    AND e2.cover_url <> '')
   ORDER BY w.id
`;

const rows = query(CANDIDATES, { remote }).filter((r) => r.cover);
const targets = Number.isFinite(limit) ? rows.slice(0, limit) : rows;

console.log(`${remote ? 'production' : 'local'}: ${targets.length} work(s) with a stranded cover`);
for (const r of targets.slice(0, 10)) {
  console.log(`  ${String(r.id).padStart(4)}  ${r.title}`);
}
if (targets.length > 10) console.log(`  ... and ${targets.length - 10} more`);

if (!commit) {
  console.log('\nDry run. Re-run with --commit to write.');
  process.exit(0);
}

if (targets.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

execute(
  targets.map(
    (r) =>
      `UPDATE work SET cover_url = ${sqlText(r.cover)}, updated_at = datetime('now') WHERE id = ${r.id} AND (cover_url IS NULL OR cover_url = '');`,
  ),
  { remote },
);

/*
 * ⚠️ Confirm by re-reading, never by trusting the statement count.
 *
 * `execute` returns how many statements ran, not how many rows changed, and
 * local D1 omits `meta.changes` entirely — a previous backfill reported
 * "0 rows updated" over a run that had just written 114. A counter that lies
 * about a no-op looks exactly like the bug it was meant to disprove.
 */
const left = query(CANDIDATES, { remote }).filter((r) => r.cover).length;
const covered = query(
  `SELECT COUNT(*) AS n FROM work WHERE cover_url IS NOT NULL AND cover_url <> ''`,
  { remote },
);

console.log(`\nwrote ${targets.length}; ${left} still stranded; ${covered[0]?.n} work(s) now have a cover`);
if (left > 0) console.log('⚠️ Some rows did not take. Investigate before re-running.');
