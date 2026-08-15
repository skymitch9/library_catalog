/**
 * One-off, from the 2026-08-15 estate-wide librarian sweep (universes + orphans).
 *
 * Two series-field corrections found by diffing every `work.series` spelling in
 * this catalog against itself and against `audiobook_catalog/site/catalog.csv`
 * and the board-game D1 `item.series` column:
 *
 *   #164  series  "World of Eric Carle" -> "The World of Eric Carle"
 *         Two other works (#125, #182) already carry the leading article, so
 *         one publisher series was rendering as two on the series page. The
 *         plain-form-wins rule in catalog-platform data/series-canon.json does
 *         NOT apply here: this is not decoration, it is a missing article, and
 *         the publisher's own name for the line is "The World of Eric Carle".
 *         Kept out of the estate series canon on purpose — that file is for
 *         drift BETWEEN catalogs, and no other catalog holds this series.
 *
 *   #45   series_index_display  "Book 2" -> "2"
 *         Its own sibling #256 displays "1". `series_index_sort` is already 2
 *         and is untouched, so nothing about ordering changes; this is the
 *         display string only, and it is the same class of defect as an index
 *         that carries its own label.
 *
 * Non-destructive in the same shape as scripts/blank-cosmere-series-2026-08-15.mjs:
 * the prior value lands in `change_log.old_json` before each UPDATE, with
 * `changed_by NULL, changed_how 'human'` — a person's decision, executed by a
 * script. `universe`/`universe_how` are not touched: neither series is claimed
 * by any universe, so re-resolution would return the same NULL either way.
 *
 *   node scripts/fix-series-spelling-2026-08-15.mjs --remote            # dry run
 *   node scripts/fix-series-spelling-2026-08-15.mjs --remote --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const flags = parseFlags();
const q = (sql) => query(sql, { remote: flags.remote });

const BATCH = 'fix-series-spelling-2026-08-15';

const EDITS = [
  {
    id: 164,
    field: 'series',
    from: 'World of Eric Carle',
    to: 'The World of Eric Carle',
    why: "Estate librarian sweep 2026-08-15: one publisher series spelled two ways inside this catalog. Works #125 and #182 already carry 'The World of Eric Carle'; #164 carried it without the leading article, so the series page rendered the same line twice. The publisher's own name for the line carries the article. Not added to catalog-platform data/series-canon.json because that file exists for drift BETWEEN catalogs and no other catalog in the estate holds this series.",
  },
  {
    id: 45,
    field: 'series_index_display',
    from: 'Book 2',
    to: '2',
    why: "Estate librarian sweep 2026-08-15: the display index carried its own label. Sibling work #256 in the same series displays '1'. series_index_sort was already 2 and is deliberately left untouched, so ordering does not change — this is the rendered string only.",
  },
];

const ids = EDITS.map((e) => e.id);
const rows = q(`SELECT id, title, series, series_index_display, series_index_sort FROM work WHERE id IN (${ids.join(',')})`);
if (rows.length !== ids.length) {
  throw new Error(`expected ${ids.length} rows, found ${rows.length} — refusing to guess which changed since this was written`);
}
const byId = new Map(rows.map((r) => [r.id, r]));

console.log(`${flags.remote ? 'production' : 'local'}: ${EDITS.length} correction(s)\n`);

const stmts = [];
for (const edit of EDITS) {
  const row = byId.get(edit.id);
  if (row[edit.field] !== edit.from) {
    throw new Error(`#${edit.id} ${edit.field} is ${JSON.stringify(row[edit.field])}, expected ${JSON.stringify(edit.from)} — refusing to overwrite a value this script was not written against`);
  }
  console.log(`  #${row.id} ${row.title}`);
  console.log(`      ${edit.field} ${JSON.stringify(edit.from)} -> ${JSON.stringify(edit.to)}\n`);

  stmts.push(
    `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
      VALUES (${lit(BATCH)}, 'work', ${row.id}, ${lit(edit.field)}, ${lit(JSON.stringify({ [edit.field]: edit.from }))}, ${lit(JSON.stringify({ [edit.field]: edit.to }))}, NULL, 'human', ${lit(edit.why)});`,
    `UPDATE work SET ${edit.field} = ${lit(edit.to)}, updated_at = datetime('now') WHERE id = ${row.id};`,
  );
}

if (!flags.commit) {
  console.log(`[dry run] ${stmts.length} statement(s) would run. Pass --commit to write.`);
  process.exit(0);
}

execute(stmts, { remote: flags.remote });

const after = q(`SELECT id, title, series, series_index_display, series_index_sort FROM work WHERE id IN (${ids.join(',')})`);
console.log('\nAfter:');
for (const row of after) console.log(`  #${row.id} ${row.title} — series=${JSON.stringify(row.series)} index_display=${JSON.stringify(row.series_index_display)} index_sort=${row.series_index_sort}`);
const wrong = EDITS.filter((e) => after.find((r) => r.id === e.id)[e.field] !== e.to);
if (wrong.length) throw new Error(`${wrong.length} row(s) did not take the new value`);
console.log('\nOK: both corrections are live.');
