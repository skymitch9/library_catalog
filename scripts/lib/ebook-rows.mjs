/**
 * Phase 5 of the ebook split, as pure functions: which rows it is about, what
 * the export contains, and what the SQL that retires them looks like.
 *
 * Design of record: `catalog-platform/docs/info/ebook-split-design.md` sections
 * 3 and 6. Runbook: `docs/access/ebook-retirement.md`.
 *
 * ## Why a lib and not two scripts that import each other
 *
 * There are two entry points - `scripts/export-ebook-rows.mjs` (export and
 * restore) and `scripts/plan-ebook-retirement.mjs` (check the preconditions and
 * write the `.sql`) - and the second needs the first's predicates. Importing one
 * CLI from another **runs it**: the first attempt at this did exactly that and
 * silently overwrote a `--keep` export with a non-`--keep` one on the way to
 * planning from it. One shared module, no top-level side effects, and every
 * decision in here is unit-testable with no database
 * (`scripts/test/ebook-rows.test.mjs`).
 *
 * ## What counts as "an ebook edition"
 *
 * `format IN EBOOK_FILE_FORMATS` - the five file formats - **and**
 * `source_url IS NOT NULL`, i.e. a row carrying a manifest-relative path, which
 * is the ebook importer's signature and nothing else's (measured 2026-09-05:
 * **zero** ebook editions on either instance carry an `http...` source_url).
 *
 *   - **`ebook_kindle` is never included.** An Amazon licence with no bytes on
 *     our side; there is no file for the ebooks site to have taken over, so it
 *     stays. Zero rows on either instance today.
 *   - **A hand-added ebook edition is not included by default.** One exists on
 *     main - edition 318, `source='manual'`, no `source_url` - and it is
 *     somebody's judgement, not the importer's output. `includeManual` widens
 *     the predicate to every file-format ebook edition.
 *
 * ## The measurement that changed the plan
 *
 * The design expected the retirement to run through `import-ebooks.mjs --prune
 * --force-prune`, whose predicate is `source = 'file'`. At design time
 * (2026-08-16) that matched **126 of the 127** ebook editions. **Measured
 * 2026-09-05 it matches 26**: the 2026-08-20 details/ISBN sweep rewrote
 * `edition.source` on 101 of the importer's own rows to `openlibrary` (34),
 * `research` (55) and `googlebooks` (11), while leaving the manifest-relative
 * path in `source_url`. Same rows, same files, a different word in one column.
 * So these predicates key on `source_url`, which nothing rewrote.
 */

import { EBOOK_FILE_FORMATS, PHYSICAL_FORMATS } from '../../packages/core/src/constants.ts';
import { lit } from './d1.mjs';

const PHYS_LIST = PHYSICAL_FORMATS.map((f) => `'${f}'`).join(', ');
const EBOOK_FILE_LIST = EBOOK_FILE_FORMATS.map((f) => `'${f}'`).join(', ');

/** File format of the export. Bumped only when a reader would need to care. */
export const EXPORT_KIND = 'library_catalog/ebook-retirement';
export const EXPORT_VERSION = 1;

/**
 * "An ebook edition phase 5 retires", as SQL over an aliased `edition`.
 *
 * @param {string} alias table alias, e.g. `'e'`
 * @param {boolean} includeManual drop the `source_url` requirement
 */
export function ebookEditionClause(alias, includeManual = false) {
  const base = `${alias}.format IN (${EBOOK_FILE_LIST})`;
  return includeManual ? base : `${base} AND ${alias}.source_url IS NOT NULL`;
}

/**
 * "An ebook-ONLY work", as SQL over an aliased `work` - the same three tests
 * `EBOOK_ONLY_CLAUSE` in `packages/db/src/works.ts` makes, in the same order:
 * it has a non-physical edition, it has no physical edition, and nobody owns a
 * copy of it.
 *
 * Deliberately the **non-physical** test and not the file-format one: a work
 * whose only edition is an `ebook_kindle` licence is just as much a work with
 * nothing on a shelf, and the site's "Recently added" filter already treats it
 * so. Keeping the two predicates identical is what makes "the site already
 * hides exactly these" a true sentence rather than a hopeful one.
 */
export function ebookOnlyClause(alias) {
  return (
    `EXISTS (SELECT 1 FROM edition e WHERE e.work_id = ${alias}.id AND e.format NOT IN (${PHYS_LIST}))` +
    ` AND NOT EXISTS (SELECT 1 FROM edition e WHERE e.work_id = ${alias}.id AND e.format IN (${PHYS_LIST}))` +
    ` AND NOT EXISTS (SELECT 1 FROM copy c WHERE c.work_id = ${alias}.id)`
  );
}

/**
 * Every table with a foreign key to `work(id)`, and the column(s) that hold it.
 *
 * An ALLOWLIST, not a discovery - default-deny, per the estate rule. The
 * tripwire (`unknownWorkReferences`) proves it is complete against the live
 * schema; this list decides what the export contains and what the generated SQL
 * names, so it must be READ rather than derived.
 *
 * ⚠️ **The order is RESTORE order - parents before children - and it is
 * load-bearing.** `research_run` comes before `research_finding` and
 * `gap_verdict` because both carry a `run_id`; `copy` comes before
 * `pledge_item` and `book_accessory` because both carry a `copy_id`; `edition`
 * comes first because four tables carry an `edition_id`. Measured the hard way
 * on 2026-09-05: the first draft listed `gap_verdict` before `research_run` and
 * the local seed died on a foreign-key violation halfway through. `retirementSql`
 * walks this list **reversed**, which is the same constraint read backwards.
 */
export const WORK_DEPENDENTS = [
  { table: 'edition', cols: ['work_id'] },
  { table: 'ebook_holding', cols: ['work_id'] },
  { table: 'user_book', cols: ['work_id'] },
  { table: 'work_alias', cols: ['work_id'] },
  { table: 'work_relation', cols: ['from_work_id', 'to_work_id'] },
  { table: 'work_watch', cols: ['work_id'] },
  { table: 'copy', cols: ['work_id'] },
  { table: 'alias_check', cols: ['work_id'] },
  { table: 'audiobook_edition_holding', cols: ['work_id'] },
  { table: 'audiobook_match_review', cols: ['work_id'] },
  { table: 'book_accessory', cols: ['work_id'] },
  { table: 'pledge_item', cols: ['work_id'] },
  { table: 'research_run', cols: ['work_id'] },
  { table: 'research_finding', cols: ['work_id'] },
  { table: 'gap_verdict', cols: ['work_id'] },
];

/**
 * Every table with a foreign key to `edition(id)`, what it does on delete, and
 * therefore what retiring an ebook edition would do to it.
 *
 * ⚠️ **This is the hole the work-side allowlist cannot see.** The export
 * captures dependents of the RETIRED WORKS. The retirement also removes the
 * ebook editions sitting on works that SURVIVE (36 of them on main), and those
 * editions have their own children: a `research_run` or `research_finding`
 * keyed to one **cascades away with it**, and a `copy` or `pledge_item` keyed
 * to one has its `edition_id` **silently set to NULL**. None of that is in the
 * export, so none of it would come back on a restore.
 *
 * Measured 2026-09-05 against production main: **all four are 0**, so today the
 * reversal path is whole. It is not guaranteed to stay 0, which is why
 * `plan-ebook-retirement.mjs` re-measures and REFUSES rather than assuming.
 */
export const EDITION_REFERENCES = [
  { table: 'research_run', col: 'edition_id', onDelete: 'CASCADE' },
  { table: 'research_finding', col: 'edition_id', onDelete: 'CASCADE' },
  { table: 'copy', col: 'edition_id', onDelete: 'SET NULL' },
  { table: 'pledge_item', col: 'edition_id', onDelete: 'SET NULL' },
];

/**
 * Which `work(id)`-referencing tables the live schema has that `WORK_DEPENDENTS`
 * does not name. Empty is the only acceptable answer, and both entry points
 * refuse to run otherwise.
 *
 * ⚠️ An allowlist goes stale the day a migration adds a sixteenth table with a
 * `work_id`. An export that silently omits a dependent table is a reversal path
 * with a hole in it, and a retirement that omits one leaves orphans behind (or,
 * on a database with foreign keys ON, fails halfway through a batch).
 *
 * @param {{table: string, references: string}[]} foreignKeys every FK row read
 *   from `pragma_foreign_key_list`, tagged with the table it was read from.
 */
export function unknownWorkReferences(foreignKeys) {
  const known = new Set(WORK_DEPENDENTS.map((d) => d.table));
  const seen = new Set();
  for (const fk of foreignKeys) {
    if (fk.references !== 'work') continue;
    if (known.has(fk.table)) continue;
    seen.add(fk.table);
  }
  return [...seen].sort();
}

/**
 * The same tripwire for `edition(id)`: which `<table>.<column>` pairs point at
 * an edition and are not in `EDITION_REFERENCES`. Empty is the only acceptable
 * answer, for the same reason - a reference nobody listed is a row that
 * disappears (or is quietly NULLed) with no entry in the reversal path.
 *
 * @param {{table: string, column: string, references: string}[]} foreignKeys
 */
export function unknownEditionReferences(foreignKeys) {
  const known = new Set(EDITION_REFERENCES.map((d) => `${d.table}.${d.col}`));
  const seen = new Set();
  for (const fk of foreignKeys) {
    if (fk.references !== 'edition') continue;
    const key = `${fk.table}.${fk.column}`;
    if (known.has(key)) continue;
    seen.add(key);
  }
  return [...seen].sort();
}

/** An `INSERT OR IGNORE` for one row, columns taken from the row itself. */
export function insertStatement(table, row) {
  const cols = Object.keys(row);
  if (cols.length === 0) throw new Error(`refusing to insert an empty row into ${table}`);
  return (
    `INSERT OR IGNORE INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) ` +
    `VALUES (${cols.map((c) => lit(row[c])).join(', ')});`
  );
}

/**
 * `DELETE ... WHERE <column> IN (...)`, chunked so no single statement grows
 * past what one D1 batch carries comfortably. Returns statement STRINGS -
 * nothing in this module executes one.
 */
export function clearByIds(table, column, ids, chunk = 150) {
  const out = [];
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    out.push(`DELETE FROM ${table} WHERE ${column} IN (${slice.join(', ')});`);
  }
  return out;
}

/**
 * The retirement set, given what the catalog holds and what the owner keeps.
 *
 * ⚠️ `keep` exists because the design's own precondition can FAIL, and this is
 * exactly the failure it planned for: *"Zero `'human'`-asserted rows are
 * affected (measured - that is the number that had to be zero for deletion to
 * be allowed; if it is nonzero at execution time, re-measure and preserve those
 * works)"*. Measured 2026-09-05 it is **3**, not 0.
 *
 * A kept work keeps EVERYTHING - its row, its ebook editions, its holding -
 * because a read state that says "I read this" is about a book, and a book with
 * no edition left is a worse record of that than one carrying an ebook edition
 * nothing serves any more.
 *
 * @param {{works: {id: number}[], editions: {id: number, work_id: number}[], keep?: number[]}} input
 */
export function planRetirement({ works, editions, keep = [] }) {
  const kept = new Set(keep.map(Number));
  const retireWorkIds = works.map((w) => Number(w.id)).filter((id) => !kept.has(id));
  const doomed = new Set(retireWorkIds);
  const keptWorkIds = works.map((w) => Number(w.id)).filter((id) => kept.has(id));

  // An edition is in scope if its work is (it would cascade anyway) OR if it is
  // an ebook edition on a work that SURVIVES - that second half is the "demote
  // to holdings, then prune" of design section 3, and it is the only reason
  // this is not simply a list of works.
  const retireEditionIds = editions
    .filter((e) => !kept.has(Number(e.work_id)))
    .map((e) => Number(e.id));

  return {
    retireWorkIds,
    keptWorkIds,
    retireEditionIds,
    editionsOnRetiredWorks: editions.filter((e) => doomed.has(Number(e.work_id))).length,
    editionsOnSurvivingWorks: editions.filter(
      (e) => !doomed.has(Number(e.work_id)) && !kept.has(Number(e.work_id)),
    ).length,
  };
}

/**
 * The statements a restore runs, in foreign-key-safe order: `work`, then
 * `edition`, then every other dependent table.
 *
 * ⚠️ `INSERT OR IGNORE`, and every row carries its ORIGINAL id - so a restore is
 * idempotent, and the ids that fifteen other tables join on come back
 * unchanged. Re-importing through `/api/ingest/ebook` cannot promise that: it
 * mints new ids, which is why the design's stated reversal ("re-import the
 * exported JSON through the same ingest route") is the weaker of the two.
 */
export function restoreStatements(data) {
  const statements = [];
  for (const w of data.works ?? []) statements.push(insertStatement('work', w));
  for (const e of data.editions ?? []) statements.push(insertStatement('edition', e));
  for (const { table } of WORK_DEPENDENTS) {
    if (table === 'edition') continue;
    for (const row of data.dependents?.[table] ?? []) statements.push(insertStatement(table, row));
  }
  return statements;
}

/**
 * The whole retirement `.sql` file, in dependency-safe order: the ebook
 * editions, then everything hanging off the ebook-only works, then the works.
 *
 * ⚠️ `change_log` is never named. Those rows carry no foreign key to `work`,
 * they are the audit trail of what people did to these rows, and an audit trail
 * that disappears with its subject is not an audit trail.
 *
 * @param {{workIds: number[], editionIds: number[], header: string}} input
 */
export function retirementSql({ workIds, editionIds, header }) {
  const lines = [header.trimEnd(), ''];

  if (editionIds.length) {
    lines.push(
      '-- 1. The ebook editions. Includes the ones on works that SURVIVE (the',
      '--    works with physical presence): design section 3 replaces those',
      '--    editions with `ebook_holding` rows, which are already in place.',
      ...clearByIds('edition', 'id', editionIds),
      '',
    );
  }

  if (workIds.length) {
    lines.push(
      '-- 2. Everything that hangs off the ebook-only works, CHILDREN FIRST',
      '--    (`WORK_DEPENDENTS` reversed - it is written parent-first for the',
      '--    restore). Foreign keys are ON in D1 (measured: PRAGMA foreign_keys',
      '--    = 1) and every one of these would cascade anyway; they are spelled',
      '--    out so the file says what it does, and so a run against a database',
      '--    with foreign keys OFF leaves nothing orphaned.',
    );
    for (const { table, cols } of [...WORK_DEPENDENTS].reverse()) {
      if (table === 'edition') continue; // block 1 already covered the ebook rows
      for (const col of cols) lines.push(...clearByIds(table, col, workIds));
    }
    lines.push('', '-- 3. The works themselves.', ...clearByIds('work', 'id', workIds), '');
  }

  lines.push('-- end.');
  return `${lines.join('\n')}\n`;
}
