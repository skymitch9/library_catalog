/**
 * Run the details queue to the end, offline.
 *
 * ## Why this is not just the button on the queue page
 *
 * `DetailsQueuePage` already has a bulk runner, and it is the right one for
 * ordinary use. It cannot finish this job:
 *
 * ```js
 * const outstanding = shown.filter((w) => runs[w.workId] === undefined);
 * ```
 *
 * `runs` comes from `latestRuns`, one row per work that has **ever** been looked
 * up. So the button offers only books that have never been asked. Measured
 * 2026-08-10, right after the pre-auto-apply backlog was applied: 66 works still
 * hold a gap, and the button said **"Look up 5"**. The other 61 were invisible
 * to it because they were looked up weeks ago.
 *
 * ⚠️ **And their remaining gap exists precisely because that older run
 * succeeded.** `detailFieldsFor` refuses to ask "which volume is this?" of a book
 * with no series — the question is unaskable until the series is known. Applying
 * the backlog filled in 32 series names, and 57 volume-number questions came into
 * existence the moment it did. A second pass is not a retry here; it is the next
 * rung of a ladder that could not be climbed before.
 *
 * The per-row button does reach them, at one click and up to ninety seconds
 * each. This does the same thing without a person present.
 *
 * ## How it talks to production
 *
 * The same trick as `apply-pending-findings.mjs`, and the same reason: the rules
 * are imported, never reimplemented. `claimRun` and `runDetailsResearch` are the
 * Worker's own functions — the route does nothing this does not — so this run
 * gets the guard against buying one answer twice, the `DETAIL_FIELDS` ordering,
 * `applyFinding`'s writes-only-into-a-blank rule, and `decided_how = 'auto'` on
 * every row, for free and by construction.
 *
 * They want a `D1Database`. They get an in-memory `node:sqlite` mirror of the
 * four tables they touch, and every change is diffed back to production after
 * each book.
 *
 * ⚠️ **Flushed per book, not at the end.** Each lookup is a paid Anthropic call.
 * A crash on book 50 that discarded 49 books' answers would have spent the money
 * and kept nothing, which is the one failure mode worth engineering against
 * here. It also makes the script resumable: a work whose gaps are filled is not
 * offered again, so re-running continues rather than restarts.
 *
 * ⚠️ **The `work` diff is restricted to the four detail columns** and fails the
 * run if anything else moves. `updateWork` rewrites all thirteen from a row it
 * read earlier, and other jobs were writing `cover_url` on this catalog the same
 * afternoon; a full-row replay would have quietly undone them.
 *
 * ## Money
 *
 * Every run's tokens are recorded on `research_run`, so the total here is read
 * back out of the database rather than accumulated in a variable — the same
 * reason the queue page's counter comes from the run log. Prints an estimate
 * before it starts and the real figure when it stops.
 *
 * ## Usage
 *
 *     tsx scripts/research-queue.mjs --remote                  # estimate only
 *     tsx scripts/research-queue.mjs --remote --commit          # run the lot
 *     tsx scripts/research-queue.mjs --remote --commit --limit 5
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { estimateCents } from '@lc/research';

import { claimRun, gapsFor, runDetailsResearch } from '../apps/worker/src/lib/research-run.ts';
import { execute, lit, parseFlags, query, ROOT } from './lib/d1.mjs';

/** Recorded as the authority behind every value. See apply-pending-findings.mjs. */
const OWNER_USER_ID = 1;

/** Mirrored whole. All four are small, and three of them get written to. */
const MIRRORED = ['work', 'research_run', 'research_finding', 'gap_verdict'];

/** The only `work` columns `applyFinding` may reach. */
const SAFE_COLUMNS = new Set([
  'first_published',
  'series',
  'series_index_sort',
  'description',
  'updated_at',
]);

// ---------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------

/**
 * ⚠️ `.dev.vars` is gitignored, so a worktree does not have one — and this
 * script is most useful from a worktree. Falls back to the main checkout, found
 * through git rather than guessed, so nothing has to be copied around.
 */
function anthropicKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;

  const candidates = [path.join(ROOT, 'apps/worker/.dev.vars')];
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    candidates.push(path.join(path.dirname(common), 'apps/worker/.dev.vars'));
  } catch {
    // Not a git checkout, or git is missing. The first candidate still applies.
  }

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*ANTHROPIC_API_KEY\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const value = match[1].trim().replace(/^["']|["']$/g, '');
      if (value) return value;
    }
  }

  throw new Error(
    'No ANTHROPIC_API_KEY. Set it in the environment, or put it in apps/worker/.dev.vars ' +
      `(looked in: ${candidates.join(', ')}).`,
  );
}

// ---------------------------------------------------------------------------
// A D1Database over node:sqlite
// ---------------------------------------------------------------------------

function makeShim(db) {
  const statement = (sql, params) => ({
    bind: (...next) => statement(sql, next),
    async first(column) {
      const row = db.prepare(sql).get(...params);
      if (row === undefined) return null;
      return column === undefined ? row : (row[column] ?? null);
    },
    async all() {
      return { results: db.prepare(sql).all(...params), success: true, meta: {} };
    },
    async run() {
      // RETURNING makes a write a read as far as node:sqlite is concerned, and
      // `.run()` on one throws.
      if (/\breturning\b/i.test(sql)) {
        const results = db.prepare(sql).all(...params);
        return { results, success: true, meta: { changes: results.length } };
      }
      const info = db.prepare(sql).run(...params);
      return {
        results: [],
        success: true,
        meta: {
          changes: Number(info.changes ?? 0),
          last_row_id: Number(info.lastInsertRowid ?? 0),
        },
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
// Mirror, and diff it back
// ---------------------------------------------------------------------------

function buildMirror({ remote }) {
  const names = MIRRORED.map((t) => `'${t}'`).join(', ');
  const schema = query(
    `SELECT sql FROM sqlite_master WHERE tbl_name IN (${names}) AND sql IS NOT NULL ORDER BY type DESC`,
    { remote },
  );
  if (schema.length === 0) throw new Error('no schema came back — is the database migrated?');

  // ⚠️ Foreign keys OFF explicitly: node:sqlite turns them ON, unlike SQLite,
  // and `research_finding` references `app_user` and `edition`, which are not
  // mirrored. With enforcement on, the INSERT will not even prepare.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const { sql } of schema) db.exec(sql);

  const snapshots = new Map();
  for (const table of MIRRORED) {
    const rows = query(`SELECT * FROM ${table}`, { remote });
    if (rows.length > 0) {
      const columns = Object.keys(rows[0]);
      const stmt = db.prepare(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      );
      for (const row of rows) stmt.run(...columns.map((c) => row[c] ?? null));
    }
    // Inserting explicit ids into an AUTOINCREMENT table leaves sqlite_sequence
    // at the maximum, so the mirror mints the same next id production would.
    snapshots.set(table, new Map(rows.map((r) => [r.id, { ...r }])));
    console.log(`  ${table}: ${rows.length} row(s)`);
  }

  return { db, snapshots };
}

/**
 * Statements that would make production look like the mirror, and update the
 * snapshot so the next flush only sees what is new after this one.
 */
function diff(db, table, snapshot) {
  const statements = [];
  for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
    const columns = Object.keys(row);
    const before = snapshot.get(row.id);

    if (!before) {
      statements.push(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES ` +
          `(${columns.map((c) => lit(row[c] ?? null)).join(', ')});`,
      );
    } else {
      const changed = columns.filter((c) => (row[c] ?? null) !== (before[c] ?? null));
      if (changed.length === 0) continue;
      if (table === 'work') {
        const stray = changed.filter((c) => !SAFE_COLUMNS.has(c));
        if (stray.length > 0) {
          throw new Error(
            `work #${row.id}: the run changed ${stray.join(', ')}, which this script does not ` +
              'write. Read the header before widening SAFE_COLUMNS.',
          );
        }
      }
      statements.push(
        `UPDATE ${table} SET ${changed.map((c) => `${c} = ${lit(row[c] ?? null)}`).join(', ')} ` +
          `WHERE id = ${lit(row.id)};`,
      );
    }
    snapshot.set(row.id, { ...row });
  }
  return statements;
}

function flush(db, snapshots, { remote, commit }) {
  // `work` first: the values, then the verdicts, then the run and its findings.
  // A flush that dies halfway should leave the catalog holding the answer rather
  // than a run claiming to have written one.
  const order = ['work', 'gap_verdict', 'research_run', 'research_finding'];
  const statements = order.flatMap((t) => diff(db, t, snapshots.get(t)));
  if (statements.length === 0 || !commit) return statements.length;
  for (let i = 0; i < statements.length; i += 40) {
    execute(statements.slice(i, i + 40), { remote });
  }
  return statements.length;
}

// ---------------------------------------------------------------------------

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

async function main() {
  const { commit, remote, limit } = parseFlags();
  const where = remote ? 'PRODUCTION' : 'the LOCAL dev database';
  console.log(`Mirroring ${where}…`);

  const { db, snapshots } = buildMirror({ remote });
  const shim = makeShim(db);
  const env = { DB: shim, ANTHROPIC_API_KEY: commit ? anthropicKey() : 'estimate-only' };

  // Asked of the policy rather than of SQL, so the list can never disagree with
  // what `claimRun` will accept.
  const allWorks = db.prepare('SELECT id, title FROM work ORDER BY id').all();
  const todo = [];
  for (const work of allWorks) {
    const gaps = await gapsFor(shim, work.id);
    if (gaps && gaps.length > 0) todo.push({ ...work, gaps });
  }

  const spentBefore = db
    .prepare(
      'SELECT COUNT(*) AS runs, COALESCE(SUM(input_tokens),0) AS tin, COALESCE(SUM(output_tokens),0) AS tout FROM research_run',
    )
    .get();
  const centsBefore = estimateCents(spentBefore.tin, spentBefore.tout);
  const perRun = spentBefore.runs > 0 ? centsBefore / spentBefore.runs : 2;

  const chosen = Number.isFinite(limit) ? todo.slice(0, limit) : todo;
  console.log(
    `\n${todo.length} work(s) still hold a gap; ${chosen.length} will be looked up.\n` +
      `Spent so far: ${money(centsBefore)} over ${spentBefore.runs} run(s), ` +
      `${perRun.toFixed(2)}¢ each.\n` +
      `Estimate for this run: ${money(chosen.length * perRun)} ` +
      `(published band ${money(chosen.length * 2)}–${money(chosen.length * 8)}), ` +
      `web search billed separately.`,
  );
  const byField = {};
  for (const w of chosen) for (const g of w.gaps) byField[g] = (byField[g] ?? 0) + 1;
  console.log(`Questions: ${Object.entries(byField).map(([f, n]) => `${f} ${n}`).join(', ')}`);

  if (!commit) {
    console.log('\nEstimate only. Nothing was asked and nothing was written. Add --commit.');
    return;
  }

  let done = 0;
  let failed = 0;
  for (const work of chosen) {
    done += 1;
    const label = `[${done}/${chosen.length}] #${work.id} ${work.title}`;

    const claim = await claimRun(shim, work.id, OWNER_USER_ID);
    if (claim.kind !== 'claimed') {
      console.log(`${label} — skipped (${claim.kind}).`);
      continue;
    }

    const started = Date.now();
    const run = await runDetailsResearch(env, claim.run.id, work.id, claim.fields, OWNER_USER_ID);
    const secs = ((Date.now() - started) / 1000).toFixed(0);

    if (!run || run.status === 'error') {
      failed += 1;
      console.log(`${label} — FAILED in ${secs}s: ${run?.errorMessage ?? 'no run row'}`);
    } else {
      console.log(
        `${label} — ${secs}s, ${run.result?.applied ?? 0}/${run.result?.proposed ?? 0} written. ` +
          `${run.result?.detail ?? ''}`,
      );
    }

    // ⚠️ Per book. The call is already paid for; losing it to a later crash is
    // the failure this guards.
    const written = flush(db, snapshots, { remote, commit });
    if (written > 0) console.log(`      flushed ${written} statement(s)`);
  }

  // ⚠️ Read back out of the database, not accumulated here — the same reason the
  // queue page counts from `research_run`.
  const after = query(
    'SELECT COUNT(*) AS runs, COALESCE(SUM(input_tokens),0) AS tin, COALESCE(SUM(output_tokens),0) AS tout FROM research_run',
    { remote },
  )[0];
  const centsAfter = estimateCents(after.tin, after.tout);

  console.log(
    `\nRan ${done} lookup(s), ${failed} failed.\n` +
      `This run cost ${money(centsAfter - centsBefore)} in tokens ` +
      `(${after.tin - spentBefore.tin} in, ${after.tout - spentBefore.tout} out).\n` +
      `Research has now cost ${money(centsAfter)} in total over ${after.runs} run(s).\n` +
      '⚠️ Tokens only. Anthropic bills its server-side web searches separately.',
  );

  const left = query(
    `SELECT COUNT(*) AS n FROM research_finding WHERE review_state = 'pending'`,
    { remote },
  )[0];
  console.log(`${left.n} finding(s) left pending — a value that could not be used.`);
}

await main();
