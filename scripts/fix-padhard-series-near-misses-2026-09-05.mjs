#!/usr/bin/env node
/**
 * One-off, from the owner ask of 2026-09-05 16:37 Phoenix:
 * *"We need to fix all the series that have warnings too, list those and let's
 * fix them."*
 *
 * ## What the warning IS
 *
 * The apex `/series/` page's "A DECISION IS WAITING" card is the estate index's
 * `series_pending` queue (`catalog-platform/apps/index-worker/migrations/
 * 0004_series_registry.sql`). A NEAR miss — two series names sharing the index's
 * `seriesNearKey` (decoration stripped) but NOT sharing a fold — is **never
 * merged**; the candidate registers as its own slug and a human is asked. Read
 * live from `index_catalog` on 2026-09-05, six rows were open:
 *
 * | candidate_fold | candidate | closest | source |
 * |---|---|---|---|
 * | `once upon a broken heart 1` | "Once Upon a Broken Heart (#1)" | "Once Upon a Broken Heart" | library2 |
 * | `good girl s guide to murder 2` | "A Good Girl's Guide to Murder (#2)" | "A Good Girl's Guide to Murder" | library2 |
 * | `good girl s guide to murder 3` | "A Good Girl's Guide to Murder (#3)" | "A Good Girl's Guide to Murder" | library2 |
 * | `asphodel series` | "The Asphodel Series" | "Asphodel" | library2 |
 * | `emily wilde` | "Emily Wilde" | "Emily Wilde Series" | library2 |
 * | `skyward` | "Skyward" | "The Skyward Series" | **library** |
 *
 * ⚠️ **Only the first FOUR are fixable here, and the last two are not padhard's
 * fault at all.** For `emily wilde` and `skyward` this catalog already holds the
 * plain, undecorated spelling that `catalog-platform/data/series-canon.json`'s
 * `canonicalRule` says wins; the decorated *"Emily Wilde Series"* / *"The
 * Skyward Series"* are the AUDIOBOOK catalog's, measured in its
 * `site/catalog.csv`. Those two are cross-catalog drift, which is what
 * `series-canon.json` exists for (the *"The Fae & Alchemy Series"* entry is the
 * precedent) — a different repo and a different change. Note also that
 * `skyward`'s candidate source is **`library`**, not `library2`, so "all six are
 * on Samantha's library" is not quite true.
 *
 * ## What produced the four
 *
 * ⚠️ **Not an importer.** Every one of these `series` values was written
 * `changed_by NULL, changed_how 'auto'` — by the free-details ladder
 * (`apps/worker/src/lib/free-details.ts`), within twenty seconds of the work
 * being added. `readSeriesLabel` handles `Name (N)` and `Name #N` but fell
 * through on the COMBINED `Name (#N)`, because it handed `parseVolumeNumber`
 * the token `"#2"`. Fixed in the same commit as this script, with tests. The
 * Asphodel pair is the same class from the other side: the ladder answered
 * *"Asphodel"* for one work and *"The Asphodel Series"* for another an hour
 * later, so the drift is WITHIN one catalog, which `series-canon.json`'s
 * `_scope.crossCatalogOnly` says is not its business — it is a data fix.
 *
 * ## What this script does NOT do
 *
 * `series_index_sort` is **already correct on all four rows** (1, 2, 3 and 2
 * respectively — measured before writing), so nothing about ordering changes.
 * `series_index_display` is NULL on all four AND on every sibling in each
 * series, and `docs/info/volume-numbers.md` makes the printed form OPTIONAL
 * (owner rule 2026-08-19) — a `(#N)` marker from a metadata API is not a
 * printed form, so filling the display column from it would invent one. Left
 * NULL.
 *
 * ⚠️ **It does not clear the apex card either, and cannot.** `series_pending`
 * rows are keyed on `candidate_fold` and STAY once written (the migration's own
 * words: "Resolved rows STAY … a queue that re-asks a question a human already
 * answered is a queue nobody reads"). Fixing the data removes the CAUSE — the
 * next push folds these rows onto the existing slugs and no new candidate is
 * queued — but the six open rows are cleared only by an approver resolving
 * them: `POST https://index.heygabi.ai/api/series/pending/<candidate_fold>`
 * with `{"action":"merge","into":"<slug>"}` or `{"action":"separate"}`, which
 * needs owner standing. That is the owner's step and is reported, not faked.
 *
 * ## Usage
 *
 *     npx tsx scripts/fix-padhard-series-near-misses-2026-09-05.mjs --remote --friend
 *     npx tsx scripts/fix-padhard-series-near-misses-2026-09-05.mjs --remote --friend --commit
 *     ... --remote            # MAIN: reports 0 matched (measured 0 on 2026-09-05)
 *
 * Keyed on (id, title, old series) so it can be pointed at either instance and
 * refuses anything it was not written against. Idempotent: a second run finds
 * no row at the old spelling and exits 0.
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const flags = parseFlags();
const q = (sql) => query(sql, flags);

const BATCH = 'owner-2026-09-05-padhard-series-near-misses';

/**
 * ⚠️ `changed_by` is NULL, deliberately, and the note says why.
 *
 * The rows are Samantha's (padhard `app_user` id 1 created every one of them),
 * but she did not make THIS decision — the owner did, in the ask quoted below,
 * and the value being corrected was written by the machine (`changed_by NULL,
 * changed_how 'auto'`). Stamping her id on a librarian correction she never saw
 * would be a false entry in an append-only audit log. Same shape as
 * `scripts/fix-series-spelling-2026-08-15.mjs`: "a person's decision, executed
 * by a script".
 */
const CHANGED_BY = null;

const NOTE_PREFIX =
  'Owner ask 2026-09-05 16:37 Phoenix: "We need to fix all the series that have ' +
  'warnings too, list those and let\'s fix them." The estate index\'s near-miss queue ' +
  'saw two series where there is one. The old value was written changed_how \'auto\' by ' +
  'the free-details ladder, whose readSeriesLabel fell through on the combined ' +
  '"Name (#N)" form (fixed in the same commit). Rows are Samantha\'s (padhard app_user ' +
  '1); the decision is the owner\'s, so changed_by is NULL rather than falsely hers. ' +
  'series_index_sort was already correct and is untouched. ';

const EDITS = [
  {
    id: 568,
    title: 'Once Upon a Broken Heart',
    from: 'Once Upon a Broken Heart (#1)',
    to: 'Once Upon a Broken Heart',
    why: 'Works 567 (A Curse for True Love, sort 3) and 569 (Ballad of Never After, sort 2) already carry the bare name, same author (Stephanie Garber). sort was already 1.',
  },
  {
    id: 551,
    title: 'Good Girl, Bad Blood',
    from: "A Good Girl's Guide to Murder (#2)",
    to: "A Good Girl's Guide to Murder",
    why: 'Work 159 (A Good Girl\'s Guide to Murder, sort 1) already carries the bare name, same author (Holly Jackson). sort was already 2.',
  },
  {
    id: 549,
    title: 'As Good As Dead',
    from: "A Good Girl's Guide to Murder (#3)",
    to: "A Good Girl's Guide to Murder",
    why: 'Work 159 (A Good Girl\'s Guide to Murder, sort 1) already carries the bare name, same author (Holly Jackson). sort was already 3.',
  },
  {
    id: 396,
    title: 'Lost to Witchcraft',
    from: 'The Asphodel Series',
    to: 'Asphodel',
    why: "Work 399 (Enamored in Death, sort 3) carries 'Asphodel', same author (Molly Tullis). The plain undecorated form wins — catalog-platform/data/series-canon.json's canonicalRule, applied here as a within-catalog data fix because both spellings are in THIS database and that file is cross-catalog only. sort was already 2.",
  },
];

const label = flags.friend ? 'padhard (library-catalog-2nd)' : 'main (library-catalog)';

const ids = EDITS.map((e) => e.id).join(',');
const rows = q(
  `SELECT id, title, authors, series, series_index_display, series_index_sort
     FROM work WHERE id IN (${ids})`,
);
const byId = new Map(rows.map((r) => [Number(r.id), r]));

const todo = [];
for (const edit of EDITS) {
  const row = byId.get(edit.id);
  if (!row) continue;
  if (row.title !== edit.title) continue; // a different catalog's row at that id
  if (row.series === edit.to) {
    console.log(`  have  #${row.id} ${row.title} — already "${edit.to}"`);
    continue;
  }
  if (row.series !== edit.from) {
    throw new Error(
      `#${row.id} series is ${JSON.stringify(row.series)}, expected ${JSON.stringify(edit.from)} — ` +
        'refusing to overwrite a value this script was not written against',
    );
  }
  todo.push({ edit, row });
}

console.log(`\n${label}: ${todo.length} series name(s) to correct\n`);
if (todo.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

const stmts = [];
for (const { edit, row } of todo) {
  console.log(`  #${row.id} ${row.title} (${row.authors})`);
  console.log(`      series ${JSON.stringify(edit.from)} -> ${JSON.stringify(edit.to)}`);
  console.log(
    `      series_index_sort ${row.series_index_sort} and series_index_display ` +
      `${JSON.stringify(row.series_index_display)} unchanged\n`,
  );
  stmts.push(
    `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
       VALUES (${lit(BATCH)}, 'work', ${row.id}, 'series', ${lit(JSON.stringify(edit.from))}, ${lit(JSON.stringify(edit.to))}, ${CHANGED_BY === null ? 'NULL' : CHANGED_BY}, 'human', ${lit(NOTE_PREFIX + edit.why)});`,
    `UPDATE work SET series = ${lit(edit.to)}, updated_at = datetime('now') WHERE id = ${row.id};`,
  );
}

if (!flags.commit) {
  console.log(`[dry run] ${stmts.length} statement(s) would run. Pass --commit to write.`);
  process.exit(0);
}

execute(stmts, flags);

const after = q(`SELECT id, title, series, series_index_display, series_index_sort FROM work WHERE id IN (${ids})`);
console.log('After:');
for (const row of after) {
  console.log(`  #${row.id} ${row.title} — series=${JSON.stringify(row.series)} display=${JSON.stringify(row.series_index_display)} sort=${row.series_index_sort}`);
}
const wrong = todo.filter(({ edit }) => after.find((r) => Number(r.id) === edit.id)?.series !== edit.to);
if (wrong.length) throw new Error(`${wrong.length} row(s) did not take the new value`);

const [n] = q(`SELECT COUNT(*) AS n FROM change_log WHERE batch_id = ${lit(BATCH)}`);
console.log(`\nOK: ${todo.length} correction(s) live, ${n.n} change_log row(s) in batch ${BATCH}.`);
console.log(
  '\n⚠️ The apex card is NOT cleared by this. The six series_pending rows stay open\n' +
    '   until an approver resolves each one — see this file\'s header.',
);
