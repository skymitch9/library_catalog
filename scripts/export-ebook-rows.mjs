#!/usr/bin/env node
/**
 * Phase 5 of the ebook split, the reversible half: **export** the rows phase 5
 * retires, and **restore** them from that export.
 *
 * Design of record: `catalog-platform/docs/info/ebook-split-design.md` sections
 * 3 and 6. Runbook (preconditions, the owner's commands, the drill):
 * `docs/access/ebook-retirement.md`. The predicates, the dependent-table
 * allowlist and every decision this makes live in
 * [`lib/ebook-rows.mjs`](lib/ebook-rows.mjs) - read that file for the "what
 * counts as an ebook edition" rules and the measurement that changed the plan.
 *
 * ## What this file is FOR, and what it deliberately is not
 *
 * Phase 5 removes rows from a live household catalog. That removal is the
 * **owner's go/no-go** and is not automated here or anywhere - the statements
 * are written to a reviewable `.sql` by `scripts/plan-ebook-retirement.mjs`.
 * What IS automated is everything that makes his decision safe:
 *
 *   - the default mode reads the catalog and writes a dated JSON under
 *     `docs/archive/` holding every row phase 5 would touch - the ebook-only
 *     works, all ebook editions, and every dependent row that hangs off them.
 *     **Read-only.** It also re-measures the design's own precondition (zero
 *     human-asserted read states) and says so on screen and in the file.
 *   - `--restore` puts them back, ids and all.
 *
 * The export IS the reversal path; the restore is what makes that sentence
 * testable rather than aspirational. Both halves are exercised end to end
 * against a throwaway local D1 - see the runbook's drill section.
 *
 * ## Usage
 *
 *     npm run ebooks:export -- --remote                 # main, read-only
 *     npm run ebooks:export -- --friend                 # padhard (implies remote)
 *     npm run ebooks:export -- --remote --keep 358,359,360
 *     npm run ebooks:export -- --restore <file>         # dry run
 *     npm run ebooks:export -- --restore <file> --commit
 *
 * `--friend` implies `--remote`: there is no local copy of the second instance,
 * because both instances bind `DB` and miniflare keeps one local database per
 * binding name. `scripts/lib/d1.mjs` refuses that combination outright.
 *
 * ## What is exported and LEFT ALONE
 *
 * `change_log` rows about these works and editions are exported for the record
 * and never touched by anything here or in the generated SQL. They carry no
 * foreign key to `work`, they are the audit trail of what people did to these
 * rows, and an audit trail that disappears with its subject is not one.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { execute, query, ROOT } from './lib/d1.mjs';
import {
  EDITION_REFERENCES,
  EXPORT_KIND,
  EXPORT_VERSION,
  WORK_DEPENDENTS,
  ebookEditionClause,
  ebookOnlyClause,
  planRetirement,
  restoreStatements,
  unknownEditionReferences,
  unknownWorkReferences,
} from './lib/ebook-rows.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
function value(flag, fallback = null) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}

const RESTORE = value('--restore');
const COMMIT = has('--commit');
const FRIEND = has('--friend');
const REMOTE = has('--remote') || FRIEND;
const INCLUDE_MANUAL = has('--include-manual');
const FLAGS = { remote: REMOTE, friend: FRIEND };
const INSTANCE = FRIEND ? 'library2' : 'library';
const DB_LABEL = FRIEND
  ? 'FRIEND (padhard, library-catalog-2nd)'
  : REMOTE
    ? 'REMOTE (library-catalog)'
    : 'local';
const KEEP = (value('--keep', '') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);

const ARCHIVE_DIR = path.join(ROOT, 'docs', 'archive');
/** Widest `IN (...)` list a `query()` call carries: it refuses SQL over 6000 chars. */
const PAGE = 150;

function usage(reason) {
  console.error(`\n${reason}\n`);
  console.error('  npm run ebooks:export -- --remote');
  console.error('  npm run ebooks:export -- --friend');
  console.error('  npm run ebooks:export -- --remote --keep 358,359,360');
  console.error('  npm run ebooks:export -- --restore <file> [--commit]');
  console.error('\nRunbook: docs/access/ebook-retirement.md');
  process.exit(1);
}

/** Refuse to run at all against a schema `WORK_DEPENDENTS` does not fully know. */
function assertSchemaKnown() {
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
  const unknown = [
    ...unknownWorkReferences(fks),
    ...unknownEditionReferences(fks).map((c) => `${c}  (references edition)`),
  ];
  if (unknown.length) {
    console.error(
      `\nREFUSING: ${unknown.length} reference(s) to work(id)/edition(id) are not in the\n` +
        'WORK_DEPENDENTS / EDITION_REFERENCES allowlists:\n' +
        unknown.map((t) => `  ${t}`).join('\n') +
        '\nAdd them to scripts/lib/ebook-rows.mjs (and to the runbook) first - an\n' +
        'export that omits a dependent table is a reversal path with a hole in it.',
    );
    process.exit(1);
  }
}

/** Every row of `table` whose `column` is in `ids`, read in `query()`-sized pages. */
function selectByIds(table, column, ids, columns = '*') {
  const out = [];
  for (let i = 0; i < ids.length; i += PAGE) {
    const slice = ids.slice(i, i + PAGE);
    out.push(...query(`SELECT ${columns} FROM ${table} WHERE ${column} IN (${slice.join(', ')})`, FLAGS));
  }
  return out;
}

if (FRIEND && has('--local')) {
  usage('--friend is remote-only; there is no local copy of the second instance.');
}

console.log(`database: ${DB_LABEL}`);
console.log(`mode:     ${RESTORE ? 'restore' : 'export'}${RESTORE && !COMMIT ? '  (dry run)' : ''}`);
if (KEEP.length) console.log(`keeping:  work ${KEEP.join(', ')} - and their ebook editions and holdings`);
if (INCLUDE_MANUAL) console.log('!! --include-manual: hand-added ebook editions are IN SCOPE for this run');

assertSchemaKnown();

if (RESTORE) await runRestore(RESTORE);
else await runExport();

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

async function runExport() {
  const eClause = ebookEditionClause('e', INCLUDE_MANUAL);
  const wClause = ebookOnlyClause('w');

  const allWorks = query(`SELECT * FROM work w WHERE ${wClause} ORDER BY w.id`, FLAGS);
  const allEditions = query(`SELECT e.* FROM edition e WHERE ${eClause} ORDER BY e.id`, FLAGS);
  const plan = planRetirement({ works: allWorks, editions: allEditions, keep: KEEP });

  const kept = new Set(KEEP);
  const works = allWorks.filter((w) => !kept.has(Number(w.id)));
  const editions = allEditions.filter((e) => !kept.has(Number(e.work_id)));
  const workIds = plan.retireWorkIds;
  const editionIds = plan.retireEditionIds;

  // The precondition the design named, re-measured in THIS sitting.
  const humanRows = query(
    'SELECT ub.id, ub.work_id, ub.read_state, ub.updated_at, w.title FROM user_book ub' +
      ` JOIN work w ON w.id = ub.work_id WHERE ub.read_state_how = 'human' AND ${wClause}` +
      ' ORDER BY ub.work_id',
    FLAGS,
  );

  const dependents = {};
  for (const { table, cols } of WORK_DEPENDENTS) {
    if (table === 'edition') continue; // exported in its own section
    const rows = cols.flatMap((col) => selectByIds(table, col, workIds));
    // `work_relation` can match on both columns; a row matching both must not
    // be written twice. Keyed on the JSON because not every table has an `id`.
    const seen = new Set();
    dependents[table] = rows.filter((r) => {
      const k = JSON.stringify(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // Audit rows ABOUT these rows: exported for the record, never touched.
  const changeLog = [
    ...selectByIds('change_log', 'entity_id', workIds).filter((r) => r.entity === 'work'),
    ...selectByIds('change_log', 'entity_id', editionIds).filter((r) => r.entity === 'edition'),
  ];

  // Rows on SURVIVING works that hang off an edition this would retire. They
  // are NOT in this export (it is keyed on the retired works), so a nonzero
  // count here is a hole in the reversal path - recorded so the number is in
  // the file, and refused outright by `plan-ebook-retirement.mjs`.
  const workIdSet = new Set(workIds);
  const editionRefsOutside = Object.fromEntries(
    EDITION_REFERENCES.map(({ table, col }) => [
      `${table}.${col}`,
      selectByIds(table, col, editionIds, `id, work_id`).filter(
        (r) => !workIdSet.has(Number(r.work_id)),
      ).length,
    ]),
  );

  const payload = {
    kind: EXPORT_KIND,
    version: EXPORT_VERSION,
    instance: INSTANCE,
    database: FRIEND ? 'library-catalog-2nd' : 'library-catalog',
    generatedAt: new Date().toISOString(),
    predicates: {
      ebookOnlyWork: wClause,
      ebookEdition: eClause,
      includeManual: INCLUDE_MANUAL,
    },
    keptWorkIds: plan.keptWorkIds,
    preconditions: {
      humanAssertedReadStatesOnEbookOnlyWorks: humanRows.length,
      humanAssertedRows: humanRows,
      /** Rows on surviving works keyed to a retired edition; every one must be 0. */
      editionReferencesOutsideThisExport: editionRefsOutside,
    },
    counts: {
      works: works.length,
      editions: editions.length,
      editionsOnRetiredWorks: plan.editionsOnRetiredWorks,
      editionsOnSurvivingWorks: plan.editionsOnSurvivingWorks,
      ...Object.fromEntries(Object.entries(dependents).map(([t, r]) => [t, r.length])),
      changeLogRowsExportedNotTouched: changeLog.length,
    },
    works,
    editions,
    dependents,
    changeLog,
  };

  console.log('\ncensus:');
  for (const [k, v] of Object.entries(payload.counts)) console.log(`  ${k.padEnd(34)} ${v}`);
  console.log(
    `\nprecondition - user_book 'human' rows on ebook-only works: ${humanRows.length}` +
      (humanRows.length ? '   [BLOCKED] the design requires 0' : '   [ok]'),
  );
  for (const r of humanRows) {
    console.log(`  work ${r.work_id}  ${r.read_state}  ${r.updated_at}  ${r.title}`);
  }
  if (humanRows.length && !KEEP.length) {
    console.log(
      `\n  -> re-run with  --keep ${humanRows.map((r) => r.work_id).join(',')}  to preserve those works,\n` +
        '     or get the owner to say in writing that those read states are disposable.',
    );
  }

  if (works.length === 0 && editions.length === 0) {
    console.log(`\n${INSTANCE}: 0 rows matched. Phase 5 is a no-op on this instance.`);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(ARCHIVE_DIR, `ebook-rows-${INSTANCE}-${stamp}.json`);
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(
    `\nwrote ${path.relative(ROOT, file)}  (${works.length} work(s), ${editions.length} edition(s))`,
  );
  console.log('!! COMMIT that file before anything is removed. It is the reversal path.');
}

// ---------------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------------

async function runRestore(file) {
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!existsSync(abs)) usage(`No export at ${abs}.`);
  const data = JSON.parse(readFileSync(abs, 'utf8'));
  if (data.kind !== EXPORT_KIND) usage(`${abs} is not a ${EXPORT_KIND} export (kind=${data.kind}).`);
  if (data.instance !== INSTANCE) {
    console.error(
      `\nREFUSING: that export is for instance '${data.instance}' and this run targets '${INSTANCE}'.`,
    );
    process.exit(1);
  }
  console.log(`restoring from ${abs}  (generated ${data.generatedAt})`);

  const statements = restoreStatements(data);
  console.log(
    `\n${data.works.length} work(s), ${data.editions.length} edition(s), ` +
      `${statements.length - data.works.length - data.editions.length} dependent row(s) ` +
      `= ${statements.length} statement(s)`,
  );
  console.log(
    '!! INSERT OR IGNORE, and every row carries its ORIGINAL id - so a restore is\n' +
      '   idempotent, and the ids fifteen other tables join on come back unchanged.\n' +
      '   (Re-importing through /api/ingest/ebook cannot promise that: it mints ids.)',
  );

  if (!COMMIT) {
    console.log('\nDRY RUN. Nothing written. Re-run with --commit.');
    return;
  }
  if (statements.length) execute(statements, FLAGS);

  // Confirm by re-reading. `execute` returns statements run, not rows changed -
  // the local D1 omits meta.changes entirely, so a count from it would lie.
  const works = selectByIds('work', 'id', data.works.map((w) => Number(w.id)), 'id').length;
  const eds = selectByIds('edition', 'id', data.editions.map((e) => Number(e.id)), 'id').length;
  console.log(
    `\nre-read: ${works}/${data.works.length} work(s), ${eds}/${data.editions.length} edition(s) present.`,
  );
  if (works !== data.works.length || eds !== data.editions.length) {
    console.error('!! The re-read does not match the export. Investigate before anything else.');
    process.exitCode = 1;
  }
}
