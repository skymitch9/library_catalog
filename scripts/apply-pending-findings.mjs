/**
 * Accept the backlog of research findings that predate auto-apply.
 *
 * ## Why this script exists at all
 *
 * `POST /api/research/works/:id/run` writes what it finds — that is auto-apply,
 * shipped 2026-08-10. But every finding produced *before* that change is still
 * sitting at `review_state = 'pending'`, waiting for a person to press Use.
 * Measured against production the same day: **162 findings across 61 works**,
 * every one of them already paid for. The catalog is holding 162 answers it
 * bought and never wrote down.
 *
 * The two ways to clear that both cost money or lie about provenance:
 *
 * | Route | Why not |
 * |---|---|
 * | Re-run the lookup | `autoApplyFindings` would sweep the backlog up with it, but a run is a paid Anthropic call. Buying an answer we already own. |
 * | `PATCH /findings/:id` | Stamps `decided_how = 'human'`. Nobody read these. That column exists precisely so a machine's guess never masquerades as a person's assertion (migration 0013). |
 *
 * So: run the real `autoApplyFindings`, offline, for free, stamped `auto`.
 *
 * ## ⚠️ The rules are imported, never reimplemented
 *
 * This is the whole design constraint. `applyFinding` carries three rules that
 * are each one line of code and several paragraphs of reasoning — writes only
 * into a blank, turns `none`/`unknown` into a verdict rather than a value, and
 * cannot reach `title` or `authors`. `autoApplyFindings` adds a fourth: apply in
 * `DETAIL_FIELDS` order, because a volume number is refused when the work has no
 * series yet and a model is free to answer `seriesIndex` first. Both bugs were
 * found by running the code, not by reading it. A script that rebuilt the write
 * by hand would reintroduce them, so this imports the function the Worker calls.
 *
 * That function wants a `D1Database`. It gets one:
 *
 * 1. The three tables it touches — `work`, `research_finding`, `gap_verdict` —
 *    are copied out of the target database, DDL and all, into an in-memory
 *    SQLite (`node:sqlite`). Real SQL, real constraints, real `ON CONFLICT`.
 * 2. A thin `prepare/bind/first/all/run` shim runs the Worker's queries against
 *    that mirror, and records every statement that writes.
 * 3. What actually goes back to production is derived from the *result*: a diff
 *    of each `work` row, plus the captured `research_finding` and `gap_verdict`
 *    writes.
 *
 * ⚠️ **Step 3 narrows the `work` write on purpose.** `updateWork` UPDATEs all
 * thirteen columns from a row it read at the start; replaying that verbatim
 * would stamp a stale `cover_url` back over one another job had just written.
 * Other agents were editing covers on this catalog the same afternoon. The diff
 * touches only columns that actually changed, and `assertOnlySafeColumns` fails
 * the run if a column outside the four detail fields ever appears in one.
 *
 * ## Undo
 *
 * Nothing special is needed. Every row this writes is `decided_how = 'auto'`, so
 * `GET /api/research/auto-applied` lists it and `POST /api/research/undo` takes
 * it back — the same safety net the live auto-apply path has, because it is
 * literally the same rows.
 *
 * ## Usage
 *
 *     tsx scripts/apply-pending-findings.mjs                    # dry run, LOCAL
 *     tsx scripts/apply-pending-findings.mjs --remote           # dry run, PRODUCTION
 *     tsx scripts/apply-pending-findings.mjs --remote --limit 5 # rehearse five works
 *     tsx scripts/apply-pending-findings.mjs --remote --commit  # write
 *
 * Dry run is the default, matching every other backfill here. `--commit`
 * re-reads the database afterwards and prints what it found, because
 * `execute()` returns statements run and not rows changed — see `lib/d1.mjs`.
 */

import { DatabaseSync } from 'node:sqlite';

import { autoApplyFindings } from '../apps/worker/src/lib/research-run.ts';
import { execute, lit, parseFlags, query } from './lib/d1.mjs';

/**
 * Who to record as having asked.
 *
 * ⚠️ Not the same question as `decided_how`. `decided_how = 'auto'` says nobody
 * read the value; `reviewed_by` says whose request caused it to be written. The
 * live route passes the signed-in user for exactly this reason, and the owner is
 * who asked for this backlog to be cleared.
 */
const OWNER_USER_ID = 1;

/** The only `work` columns `applyFinding` is allowed to reach. */
const SAFE_COLUMNS = new Set([
  'first_published',
  'series',
  'series_index_sort',
  'description',
  'updated_at',
]);

const MIRRORED = ['work', 'research_finding', 'gap_verdict'];

// ---------------------------------------------------------------------------
// A D1Database over node:sqlite, that remembers what it wrote
// ---------------------------------------------------------------------------

const WRITES = /^\s*(insert|update|delete|replace)\b/i;

/**
 * Substitute bound parameters into SQL, so a captured statement can be replayed
 * somewhere that has no parameter binding.
 *
 * ⚠️ String-aware. A naive `split('?')` would happily rewrite a `?` that lives
 * inside a quoted literal. None of the Worker's SQL has one today; a future one
 * would be a silent corruption rather than an error, which is not a bet worth
 * taking on a script that writes to production.
 */
function materialise(sql, params) {
  let out = '';
  let inString = false;
  let next = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      inString = !inString;
      out += ch;
      continue;
    }
    if (ch === '?' && !inString) {
      if (next >= params.length) throw new Error(`not enough parameters for: ${sql}`);
      out += lit(params[next++]);
      continue;
    }
    out += ch;
  }
  if (next !== params.length) {
    throw new Error(`${params.length} parameters for ${next} placeholders in: ${sql}`);
  }
  return out;
}

function makeShim(db, captured) {
  const remember = (sql, params) => {
    if (WRITES.test(sql)) captured.push({ sql, params });
  };

  const statement = (sql, params) => ({
    bind: (...next) => statement(sql, next),
    async first(column) {
      remember(sql, params);
      const row = db.prepare(sql).get(...params);
      if (row === undefined) return null;
      return column === undefined ? row : (row[column] ?? null);
    },
    async all() {
      remember(sql, params);
      const results = db.prepare(sql).all(...params);
      return { results, success: true, meta: {} };
    },
    async run() {
      remember(sql, params);
      // A statement with RETURNING is a read as far as node:sqlite is concerned,
      // and `.run()` on one throws. Everything else reports its change count,
      // which `deleteAutoVerdict` and `deleteWork` both branch on.
      if (/\breturning\b/i.test(sql)) {
        const results = db.prepare(sql).all(...params);
        return { results, success: true, meta: { changes: results.length } };
      }
      const info = db.prepare(sql).run(...params);
      return {
        results: [],
        success: true,
        meta: { changes: Number(info.changes ?? 0), last_row_id: Number(info.lastInsertRowid ?? 0) },
      };
    },
  });

  return {
    prepare: (sql) => statement(sql, []),
    async batch(statements) {
      const out = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
    async exec(sql) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
}

// ---------------------------------------------------------------------------
// Copying the target database's shape and rows into the mirror
// ---------------------------------------------------------------------------

function insertRows(db, table, rows) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const stmt = db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  );
  for (const row of rows) {
    stmt.run(...columns.map((c) => (row[c] === undefined ? null : row[c])));
  }
}

function buildMirror({ remote }) {
  const names = MIRRORED.map((t) => `'${t}'`).join(', ');
  const schema = query(
    `SELECT sql FROM sqlite_master WHERE tbl_name IN (${names}) AND sql IS NOT NULL ORDER BY type DESC`,
    { remote },
  );
  if (schema.length === 0) throw new Error('no schema came back — is the database migrated?');

  // ⚠️ Foreign keys OFF, explicitly — `node:sqlite` turns them ON by default,
  // unlike SQLite itself. `research_finding` references `research_run`,
  // `edition` and `app_user`, none of which are mirrored, and with enforcement
  // on the INSERT fails to even *prepare*: "no such table: main.app_user".
  // Copying three more tables over the wire to satisfy a constraint no rule here
  // reads would be the wrong fix.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const { sql } of schema) db.exec(sql);

  // Only the works that have something pending. 61 of 219, and every query in
  // `applyFinding` is by primary key, so the rest cannot be reached.
  const works = query(
    `SELECT * FROM work WHERE id IN (SELECT DISTINCT work_id FROM research_finding WHERE review_state = 'pending')`,
    { remote },
  );
  const findings = query(
    `SELECT * FROM research_finding WHERE work_id IN (SELECT DISTINCT work_id FROM research_finding WHERE review_state = 'pending')`,
    { remote },
  );
  const verdicts = query(
    `SELECT * FROM gap_verdict WHERE work_id IN (SELECT DISTINCT work_id FROM research_finding WHERE review_state = 'pending')`,
    { remote },
  );

  insertRows(db, 'work', works);
  insertRows(db, 'research_finding', findings);
  insertRows(db, 'gap_verdict', verdicts);

  return { db, works, findings, verdicts };
}

/**
 * ⚠️ The guard that makes the narrowed write safe.
 *
 * `applyFinding` can only reach four columns, and this proves it did rather than
 * assuming it. If a future edit widens it — to `cover_url`, say — this fails the
 * run instead of quietly shipping a column this script was never reviewed to
 * write.
 */
function assertOnlySafeColumns(changed, workId) {
  const stray = changed.filter((c) => !SAFE_COLUMNS.has(c));
  if (stray.length > 0) {
    throw new Error(
      `work #${workId}: applyFinding changed ${stray.join(', ')}, which this script does not write. ` +
        'Read the header before widening SAFE_COLUMNS.',
    );
  }
}

function workUpdates(db, before) {
  const statements = [];
  for (const original of before) {
    const now = db.prepare('SELECT * FROM work WHERE id = ?').get(original.id);
    const changed = Object.keys(original).filter(
      (c) => c !== 'updated_at' && (now[c] ?? null) !== (original[c] ?? null),
    );
    if (changed.length === 0) continue;
    assertOnlySafeColumns(changed, original.id);
    const sets = changed.map((c) => `${c} = ${lit(now[c] ?? null)}`);
    sets.push(`updated_at = datetime('now')`);
    statements.push(`UPDATE work SET ${sets.join(', ')} WHERE id = ${lit(original.id)};`);
  }
  return statements;
}

// ---------------------------------------------------------------------------

async function main() {
  const { commit, remote, limit } = parseFlags();
  const where = remote ? 'PRODUCTION' : 'the LOCAL dev database';
  console.log(`Reading ${where}…`);

  const { db, works, findings } = buildMirror({ remote });
  const pending = findings.filter((f) => f.review_state === 'pending');
  console.log(
    `${pending.length} pending finding(s) across ${works.length} work(s), ` +
      `already paid for by ${new Set(pending.map((f) => f.run_id)).size} past run(s).`,
  );
  if (pending.length === 0) {
    console.log('Nothing to apply.');
    return;
  }

  // ⚠️ Refuse to touch anything a person already settled. `applyFinding` guards
  // values — it writes only into a blank — but `setGapVerdict` is an upsert, so
  // a `none`/`unknown` finding could overwrite a verdict somebody wrote by hand.
  // Measured 2026-08-10: zero overlap in production. Checked anyway, because the
  // day it is not zero is the day it matters.
  const humanVerdicts = query(
    `SELECT work_id, field FROM gap_verdict WHERE decided_how IS NULL OR decided_how <> 'auto'`,
    { remote },
  );
  const settled = new Set(humanVerdicts.map((v) => `${v.work_id}:${v.field}`));
  const clashes = pending.filter((f) => settled.has(`${f.work_id}:${f.field}`));
  if (clashes.length > 0) {
    console.log(
      `\nSkipping ${clashes.length} finding(s): a person already answered that question.`,
    );
    for (const f of clashes) console.log(`  work #${f.work_id} ${f.field}`);
    db.exec(
      `DELETE FROM research_finding WHERE id IN (${clashes.map((f) => f.id).join(', ')})`,
    );
  }

  const before = works.map((w) => ({ ...w }));
  const captured = [];
  const shim = makeShim(db, captured);

  const workIds = [...new Set(pending.map((f) => f.work_id))].sort((a, b) => a - b);
  const chosen = Number.isFinite(limit) ? workIds.slice(0, limit) : workIds;

  const applied = [];
  const skipped = [];
  let unusable = 0;

  for (const workId of chosen) {
    const report = await autoApplyFindings(shim, workId, OWNER_USER_ID);
    for (const line of report.applied) applied.push(`#${workId} ${line}`);
    for (const line of report.skipped) skipped.push(`#${workId} ${line}`);
    unusable += report.unusable;
  }

  // Findings and verdicts replay as captured — both are already narrow. Work
  // rows do not; see the header.
  const findingWrites = captured
    .filter((c) => /research_finding/.test(c.sql))
    .map((c) => materialise(c.sql, c.params).trim().replace(/;?$/, ';'));
  const verdictWrites = captured
    .filter((c) => /gap_verdict/.test(c.sql))
    .map((c) => materialise(c.sql, c.params).trim().replace(/;?$/, ';'));
  const valueWrites = workUpdates(db, before);

  console.log(`\nWould write ${applied.length} value(s) across ${chosen.length} work(s):`);
  for (const line of applied) console.log(`  ${line}`);
  if (skipped.length > 0) {
    console.log(`\nSkipped ${skipped.length}:`);
    for (const line of skipped) console.log(`  ${line}`);
  }
  if (unusable > 0) {
    console.log(`\n${unusable} finding(s) stay pending — the value could not be used.`);
  }
  console.log(
    `\nSQL: ${valueWrites.length} work update(s), ${verdictWrites.length} verdict write(s), ` +
      `${findingWrites.length} finding mark(s).`,
  );

  if (!commit) {
    console.log('\nDry run. Nothing was written. Add --commit to write.');
    return;
  }

  // Order matters if this dies halfway: write the answers first, mark the
  // findings last. A half-run then leaves findings pending — re-runnable — rather
  // than accepted with nothing behind them.
  console.log(`\nWriting to ${where}…`);
  const batches = [...valueWrites, ...verdictWrites, ...findingWrites];
  for (let i = 0; i < batches.length; i += 40) {
    execute(batches.slice(i, i + 40), { remote });
    console.log(`  ${Math.min(i + 40, batches.length)}/${batches.length}`);
  }

  // ⚠️ Confirmed by re-reading, never by the return of `execute()`, which counts
  // statements and not rows.
  const after = query(
    `SELECT review_state, COALESCE(decided_how, 'null') AS decided_how, COUNT(*) AS n
       FROM research_finding GROUP BY 1, 2 ORDER BY 1, 2`,
    { remote },
  );
  console.log('\nFindings now:');
  for (const row of after) console.log(`  ${row.review_state} / ${row.decided_how}: ${row.n}`);
}

await main();
