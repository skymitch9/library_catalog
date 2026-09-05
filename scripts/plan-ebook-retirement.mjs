#!/usr/bin/env node
/**
 * Phase 5 of the ebook split, the irreversible half: **plan** it, re-measure
 * every precondition against the live database, and write the statements out as
 * a reviewable `.sql` file.
 *
 * Design of record: `catalog-platform/docs/info/ebook-split-design.md` sections
 * 3 and 6. Runbook: `docs/access/ebook-retirement.md`. The predicates and the
 * SQL shape live in [`lib/ebook-rows.mjs`](lib/ebook-rows.mjs).
 *
 * ## Why this GENERATES a file instead of running one
 *
 * Phase 5 removes works and editions from a live household catalog. That is the
 * **owner's go/no-go**, and the ceremony is the point: a ceremony you can hold
 * in your hand beats one that happens inside a process. So this goes to the edge
 * and stops.
 *
 *   1. Reads the **committed export** (`scripts/export-ebook-rows.mjs`). It
 *      never derives its own target list - the list the owner read is the list
 *      that runs.
 *   2. Re-measures every precondition **against the live database in this
 *      sitting**, and refuses on any failure, naming the rows.
 *   3. Writes the exact statements to
 *      `docs/archive/ebook-retirement-<instance>-<date>.sql`: ordered, chunked,
 *      commented with what each block is for and what the counts should become.
 *   4. Prints the ONE command that applies it, and the ONE that puts it back.
 *
 * The generated file is plain SQL. A person can read all of it, `git diff` it,
 * and refuse it. Nothing here writes to the database.
 *
 * ## Usage
 *
 *     npm run ebooks:plan -- --from docs/archive/ebook-rows-library-2026-09-05.json --remote
 *     npm run ebooks:plan -- --from docs/archive/ebook-rows-library2-2026-09-05.json --friend
 *
 * ## The preconditions, and why each one is here
 *
 * | Check | Why |
 * |---|---|
 * | the export exists, parses, and names THIS instance | the reversal path must exist before the thing it reverses |
 * | human-asserted `user_book` rows on the listed works == 0 | design section 3: *"if it is nonzero at execution time, re-measure and preserve those works"*. A read state a person typed is derivable from nothing |
 * | every listed work is still ebook-only | a work that grew a physical edition or a copy since the export is somebody's book now |
 * | every listed edition still matches the export's predicate | a row re-formatted or already gone means the reviewed list is not the live list |
 * | `EBOOK_INGEST_TOKEN` unset on the target | otherwise the next importer run puts them back and the retirement is a no-op with extra steps. ⚠️ The OWNER checks this, not this script - a Worker secret cannot be read back. The runbook has the command |
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { query, ROOT } from './lib/d1.mjs';
import {
  EDITION_REFERENCES,
  EXPORT_KIND,
  ebookEditionClause,
  ebookOnlyClause,
  retirementSql,
  unknownEditionReferences,
  unknownWorkReferences,
  WORK_DEPENDENTS,
} from './lib/ebook-rows.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
function value(flag, fallback = null) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}

const FROM = value('--from');
const FRIEND = has('--friend');
const REMOTE = has('--remote') || FRIEND;
const FLAGS = { remote: REMOTE, friend: FRIEND };
const INSTANCE = FRIEND ? 'library2' : 'library';
const DB_NAME = FRIEND ? 'library-catalog-2nd' : 'library-catalog';
const DB_LABEL = FRIEND ? 'FRIEND (padhard)' : REMOTE ? 'REMOTE' : 'local';
const ARCHIVE_DIR = path.join(ROOT, 'docs', 'archive');
/** Widest `IN (...)` list a `query()` call carries: it refuses SQL over 6000 chars. */
const PAGE = 150;

function die(reason) {
  console.error(`\n${reason}`);
  console.error('\nRunbook: docs/access/ebook-retirement.md');
  process.exit(1);
}

/** Every row of `table` whose `column` is in `ids`, read in `query()`-sized pages. */
function selectByIds(table, column, ids, columns, extra = '') {
  const out = [];
  for (let i = 0; i < ids.length; i += PAGE) {
    const slice = ids.slice(i, i + PAGE);
    out.push(
      ...query(
        `SELECT ${columns} FROM ${table} WHERE ${column} IN (${slice.join(', ')})${extra}`,
        FLAGS,
      ),
    );
  }
  return out;
}

if (!FROM) {
  die(
    'Needs --from <export file>.\n\n' +
      '  npm run ebooks:plan -- --from docs/archive/ebook-rows-library-2026-09-05.json --remote\n' +
      '  npm run ebooks:plan -- --from docs/archive/ebook-rows-library2-2026-09-05.json --friend',
  );
}

const abs = path.isAbsolute(FROM) ? FROM : path.join(ROOT, FROM);
if (!existsSync(abs)) die(`No export at ${abs}. Run \`npm run ebooks:export\` first and COMMIT it.`);
const data = JSON.parse(readFileSync(abs, 'utf8'));
if (data.kind !== EXPORT_KIND) die(`${abs} is not a ${EXPORT_KIND} export (kind=${data.kind}).`);
if (data.instance !== INSTANCE) {
  die(`That export is for instance '${data.instance}' and this run targets '${INSTANCE}'.`);
}

const workIds = data.works.map((w) => Number(w.id));
const editionIds = data.editions.map((e) => Number(e.id));
const includeManual = data.predicates?.includeManual ?? false;
const relExport = path.relative(ROOT, abs).split(path.sep).join('/');

console.log(`database: ${DB_LABEL} (${DB_NAME})`);
console.log(`export:   ${relExport}  (generated ${data.generatedAt})`);
console.log(`listed:   ${workIds.length} work(s), ${editionIds.length} ebook edition(s)`);
if (data.keptWorkIds?.length) console.log(`kept:     work ${data.keptWorkIds.join(', ')}`);

if (workIds.length === 0 && editionIds.length === 0) {
  console.log(`\n${INSTANCE}: 0 rows matched. Phase 5 is a no-op on this instance - nothing to plan.`);
  process.exit(0);
}

// --- precondition 0: this file knows the whole schema ----------------------

{
  const tables = query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%' ORDER BY name",
    FLAGS,
  ).map((r) => r.name);
  const fks = [];
  for (const t of tables) {
    for (const fk of query(
      `SELECT "table" AS ref, "from" AS col FROM pragma_foreign_key_list('${t}')`,
      FLAGS,
    )) {
      fks.push({ table: t, column: fk.col, references: fk.ref });
    }
  }
  const unknown = unknownWorkReferences(fks);
  if (unknown.length) {
    die(
      `REFUSING: ${unknown.length} table(s) reference work(id) and are not in WORK_DEPENDENTS:\n` +
        unknown.map((t) => `  ${t}`).join('\n') +
        '\n\nAdd them to scripts/lib/ebook-rows.mjs (and to the runbook) first.',
    );
  }
  const unknownEd = unknownEditionReferences(fks);
  if (unknownEd.length) {
    die(
      `REFUSING: ${unknownEd.length} column(s) reference edition(id) and are not in ` +
        `EDITION_REFERENCES:\n${unknownEd.map((t) => `  ${t}`).join('\n')}` +
        '\n\nAdd them to scripts/lib/ebook-rows.mjs (and to the runbook) first.',
    );
  }
  console.log(
    `\nprecondition 0  every work(id) reference known (${WORK_DEPENDENTS.length} table(s)) and` +
      ` every edition(id) reference known (${EDITION_REFERENCES.length}): [ok]`,
  );
}

// --- precondition 1: no human-asserted read states -------------------------

const human = selectByIds(
  'user_book ub JOIN work w ON w.id = ub.work_id',
  'ub.work_id',
  workIds,
  'ub.work_id, ub.read_state, ub.updated_at, w.title',
  " AND ub.read_state_how = 'human'",
);
if (human.length) {
  console.error(`\nREFUSING: ${human.length} human-asserted read state(s) on works in this list:`);
  for (const r of human) {
    console.error(`  work ${r.work_id}  ${r.read_state}  ${r.updated_at}  ${r.title}`);
  }
  die(
    'The design requires this to be 0 (section 3: "if it is nonzero at execution\n' +
      'time, re-measure and preserve those works").\n\n' +
      'Re-run the export with\n' +
      `  npm run ebooks:export -- ${FRIEND ? '--friend' : '--remote'} --keep ${[...new Set(human.map((r) => r.work_id))].join(',')}\n` +
      'commit the new file, and plan from that.',
  );
}
console.log('precondition 1  human-asserted read states on the listed works: 0  [ok]');

// --- precondition 2: every listed work is still ebook-only ------------------

const stillOnly = selectByIds('work w', 'w.id', workIds, 'w.id', ` AND ${ebookOnlyClause('w')}`).map(
  (r) => Number(r.id),
);
const drifted = workIds.filter((id) => !stillOnly.includes(id));
if (drifted.length) {
  const present = selectByIds('work', 'id', workIds, 'id').map((r) => Number(r.id));
  const gone = workIds.filter((id) => !present.includes(id));
  die(
    `REFUSING: ${drifted.length} listed work(s) are no longer ebook-only ` +
      `(a physical edition or a copy appeared): ${drifted.join(', ')}` +
      `${gone.length ? `\n  - of which ${gone.length} are no longer present at all: ${gone.join(', ')}` : ''}` +
      '\n\nRe-run the export, READ the new list, commit it, and plan from that.',
  );
}
console.log(`precondition 2  all ${workIds.length} listed work(s) still ebook-only: [ok]`);

// --- precondition 3: every listed edition still matches ---------------------

const liveEditions = selectByIds(
  'edition e',
  'e.id',
  editionIds,
  'e.id',
  ` AND ${ebookEditionClause('e', includeManual)}`,
).map((r) => Number(r.id));
const editionDrift = editionIds.filter((id) => !liveEditions.includes(id));
if (editionDrift.length) {
  die(
    `REFUSING: ${editionDrift.length} listed edition(s) no longer match the export's own ` +
      `predicate (already gone, or re-formatted): ${editionDrift.slice(0, 25).join(', ')}` +
      '\n\nRe-run the export and plan from the new file.',
  );
}
console.log(`precondition 3  all ${editionIds.length} listed edition(s) still match: [ok]`);

// --- precondition 4: nothing OUTSIDE the export hangs off those editions ----
//
// ⚠️ The export captures the dependents of the retired WORKS. The retirement
// also removes the ebook editions sitting on works that SURVIVE, and those have
// their own children: a `research_run`/`research_finding` keyed to one cascades
// away with it, and a `copy`/`pledge_item` keyed to one has its `edition_id`
// silently SET NULL. None of that is in the export, so none of it comes back on
// a restore. Measured 0 on both instances 2026-09-05 - re-measured here rather
// than assumed, and a refusal rather than a warning, because a reversal path
// with a hole in it is the one thing this whole ceremony exists to prevent.

const workIdSet = new Set(workIds);
const orphaned = [];
for (const { table, col, onDelete } of EDITION_REFERENCES) {
  const rows = selectByIds(table, col, editionIds, `id, work_id, ${col} AS ref`);
  const outside = rows.filter((r) => !workIdSet.has(Number(r.work_id)));
  if (outside.length) orphaned.push({ table, col, onDelete, rows: outside });
}
if (orphaned.length) {
  console.error('\nREFUSING: rows on SURVIVING works reference an edition this would remove,');
  console.error('and the export does not carry them, so a restore would not bring them back:');
  for (const o of orphaned) {
    console.error(
      `  ${o.table}.${o.col} (ON DELETE ${o.onDelete}): ${o.rows.length} row(s) - ` +
        `ids ${o.rows.slice(0, 10).map((r) => r.id).join(', ')}`,
    );
  }
  die(
    'Decide what those rows should become and record it in the runbook before\n' +
      'planning again. Do not widen the export without saying why in its header.',
  );
}
console.log('precondition 4  no un-exported row hangs off a retired edition: [ok]');

// --- the counts the runbook's "expected" column is checked against ----------

const before = {
  works: query('SELECT COUNT(*) AS n FROM work', FLAGS)[0].n,
  editions: query('SELECT COUNT(*) AS n FROM edition', FLAGS)[0].n,
  ebookEditions: query(
    `SELECT COUNT(*) AS n FROM edition e WHERE ${ebookEditionClause('e', includeManual)}`,
    FLAGS,
  )[0].n,
  ebookHoldings: query('SELECT COUNT(*) AS n FROM ebook_holding', FLAGS)[0].n,
};
const holdingsCleared = data.counts?.ebook_holding ?? 0;
const after = {
  works: before.works - workIds.length,
  editions: before.editions - editionIds.length,
  ebookEditions: before.ebookEditions - editionIds.length,
  ebookHoldings: before.ebookHoldings - holdingsCleared,
};
console.log('\nexpected after applying, measured now:');
console.log(`  work            ${before.works} -> ${after.works}`);
console.log(`  edition         ${before.editions} -> ${after.editions}`);
console.log(`  ebook editions  ${before.ebookEditions} -> ${after.ebookEditions}`);
console.log(`  ebook_holding   ${before.ebookHoldings} -> ${after.ebookHoldings}`);

// --- write the file --------------------------------------------------------

const stamp = new Date().toISOString().slice(0, 10);
const outFile = path.join(ARCHIVE_DIR, `ebook-retirement-${INSTANCE}-${stamp}.sql`);
const restoreCmd =
  `npm run ebooks:export -- --restore ${relExport} --commit ${FRIEND ? '--friend' : '--remote'}`;
const header = [
  `-- Ebook split, phase 5 - ${INSTANCE} (${DB_NAME})`,
  `-- Generated ${new Date().toISOString()} by scripts/plan-ebook-retirement.mjs`,
  `-- From the export: ${relExport} (generated ${data.generatedAt})`,
  '--',
  `-- ${workIds.length} ebook-only work(s) and ${editionIds.length} ebook edition(s).`,
  data.keptWorkIds?.length ? `-- KEPT, deliberately: work ${data.keptWorkIds.join(', ')}.` : null,
  `-- Expected after: work ${before.works} -> ${after.works}, edition ${before.editions} -> ${after.editions},`,
  `--                 ebook editions ${before.ebookEditions} -> ${after.ebookEditions},`,
  `--                 ebook_holding ${before.ebookHoldings} -> ${after.ebookHoldings}.`,
  '--',
  '-- Preconditions re-measured against the live database at generation time:',
  '--   human-asserted read states on these works: 0',
  '--   every listed work still ebook-only: yes',
  "--   every listed edition still matches the export's predicate: yes",
  '--',
  `-- REVERSAL:  ${restoreCmd}`,
  '--',
  '-- change_log rows about these works and editions are deliberately NOT touched.',
]
  .filter(Boolean)
  .join('\n');

mkdirSync(ARCHIVE_DIR, { recursive: true });
const sql = retirementSql({ workIds, editionIds, header });
writeFileSync(outFile, sql, 'utf8');

const rel = path.relative(ROOT, outFile).split(path.sep).join('/');
console.log(
  `\nwrote ${rel}  (${sql.split('\n').filter((l) => l.startsWith('DELETE')).length} statement(s))`,
);
console.log('\nREAD IT, then the owner runs exactly one command:\n');
console.log(
  `  npx wrangler d1 execute ${DB_NAME} --config apps/worker/wrangler.toml` +
    `${FRIEND ? ' --env friend' : ''} --remote --file ${rel}`,
);
console.log(`\nand the one that puts it back:\n\n  ${restoreCmd}`);
