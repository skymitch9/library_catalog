/**
 * One-off: blank `series` (and its now-meaningless index) on the two works
 * whose series value was literally the universe name — "Cosmere" (id 25) and
 * "The Cosmere" (id 30). catalog-platform's own universes.json `notes` on The
 * Cosmere has flagged this since 2026-08-11: "a universe masquerading as a
 * series, spelled two ways... those two works need a real series (or none)
 * once this lands."
 *
 * Owner, 2026-08-15, via coordinator (revising an earlier "leave the series
 * alone" instruction): blank the series and let the universe carry the
 * association instead — NON-DESTRUCTIVELY. This script is that non-
 * destruction guarantee: old values land in `change_log.old_json` before the
 * UPDATE, exactly the shape `scripts/merge-ebook-import-duplicates.mjs`
 * already established for a one-off owner-directed correction (`changed_by
 * NULL, changed_how 'human'` — a person's decision, executed by script).
 *
 * `universe`/`universe_how` are written back UNCHANGED ('The Cosmere' /
 * 'list') — the same answer `packages/db/src/works.ts`'s own re-derivation
 * (`universeOnUpdate`) would produce once catalog-platform/data/universes.json
 * carries title overrides for both exact titles (this script's sibling change
 * in catalog-platform adds them), so this UPDATE does not silently disagree
 * with what the live PATCH route would compute.
 *
 * The 3rd Arcanum Unbounded row lives in audiobook_catalog, not here — fixed
 * separately via `python -m app.tools.edit_overrides`.
 *
 *   node scripts/blank-cosmere-series-2026-08-15.mjs --remote            # dry run
 *   node scripts/blank-cosmere-series-2026-08-15.mjs --remote --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const flags = parseFlags();
const q = (sql) => query(sql, { remote: flags.remote });

const IDS = [25, 30];

const rows = q(`SELECT id, title, series, series_index_sort, series_index_display, universe, universe_how
                  FROM work WHERE id IN (${IDS.join(',')})`);

if (rows.length !== IDS.length) {
  throw new Error(`expected ${IDS.length} rows, found ${rows.length} — refusing to guess which changed since this was written`);
}

console.log(`${flags.remote ? 'production' : 'local'}: ${rows.length} row(s) to correct\n`);

const WHY =
  "Owner, 2026-08-15, via coordinator (revising an earlier 'leave the series alone' instruction): blank the series and let the universe carry the association, non-destructively. 'Cosmere'/'The Cosmere' were never a real series — a universe masquerading as one, spelled two ways (catalog-platform data/universes.json The Cosmere notes, since 2026-08-11). series_index blanked alongside it: an index with no series is meaningless. The universe (The Cosmere) is unchanged — catalog-platform now carries a title override for this exact title so it still resolves.";

const batch = 'blank-cosmere-series-2026-08-15';
const stmts = [];

for (const row of rows) {
  console.log(`  #${row.id} ${row.title}`);
  console.log(`      series ${JSON.stringify(row.series)} -> null, index ${JSON.stringify(row.series_index_display)} -> null`);
  console.log(`      universe ${JSON.stringify(row.universe)} (${row.universe_how}) unchanged\n`);

  const oldJson = JSON.stringify({
    series: row.series,
    series_index_sort: row.series_index_sort,
    series_index_display: row.series_index_display,
  });
  const newJson = JSON.stringify({ series: null, series_index_sort: null, series_index_display: null });

  stmts.push(
    `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
      VALUES (${lit(batch)}, 'work', ${row.id}, 'series+series_index', ${lit(oldJson)}, ${lit(newJson)}, NULL, 'human', ${lit(WHY)});`,
    `UPDATE work
        SET series = NULL,
            series_index_sort = NULL,
            series_index_display = NULL,
            universe = 'The Cosmere',
            universe_how = 'list',
            updated_at = datetime('now')
      WHERE id = ${row.id};`,
  );
}

if (!flags.commit) {
  console.log(`[dry run] ${stmts.length} statement(s) would run. Pass --commit to write.`);
  process.exit(0);
}

execute(stmts, { remote: flags.remote });

const after = q(`SELECT id, title, series, series_index_sort, series_index_display, universe, universe_how
                    FROM work WHERE id IN (${IDS.join(',')})`);
console.log('\nAfter:');
for (const row of after) {
  console.log(`  #${row.id} ${row.title} — series=${JSON.stringify(row.series)} universe=${row.universe} (${row.universe_how})`);
}
const stillWrong = after.filter((r) => r.series !== null);
if (stillWrong.length) throw new Error(`${stillWrong.length} row(s) still carry a series after commit`);
console.log('\nOK: both rows now carry no series, universe unchanged.');
