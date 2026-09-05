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
 * ⚠️ **Whose key pays follows the INSTANCE, not the run** — the same custody rule
 * `backfill-missing-covers.mjs` carries, and for the same reason. Until
 * 2026-08-23 this script read `ANTHROPIC_API_KEY` with no idea which catalogue
 * it was aimed at, so a padhard run would have been billed to the OWNER, and
 * silently: nothing printed a key name. It now reads
 * `ANTHROPIC_API_KEY_FRIEND_SAM` under `--friend`, prints which NAME it used,
 * and **refuses to fall back** to the main key rather than quietly spending the
 * wrong person's money. `--llm-key-from=main` is the one deliberate, explicit
 * way out of that, and it says so loudly on every run.
 *
 * ⚠️ And the second half of the same defect: `--friend` was **parsed and then
 * dropped**. `buildMirror`/`flush` passed only `{ remote }` to `query`/`execute`,
 * so `dbName` fell to `library-catalog` whatever was asked for — a `--friend`
 * run would have mirrored MAIN, spent money on MAIN's gaps and written the
 * answers back to MAIN, while its own output said padhard. The key was never the
 * only thing that was instance-blind here.
 *
 * ## Usage
 *
 *     tsx scripts/research-queue.mjs --remote                  # estimate only
 *     tsx scripts/research-queue.mjs --remote --commit          # run the lot
 *     tsx scripts/research-queue.mjs --remote --commit --limit 5
 *     tsx scripts/research-queue.mjs --friend --remote          # padhard, estimate only
 *     tsx scripts/research-queue.mjs --friend --remote --commit --llm-key-from=main
 *     tsx scripts/research-queue.mjs --remote --commit --ignore-policy  # spend despite a switched-off feature
 *
 * ## ⚠️ The spending gate (L11)
 *
 * This was the one library money path with **no gate at all** — it hard-codes
 * `OWNER_USER_ID = 1` and no capability check ever ran. The identity is
 * unchanged (it is the authority recorded against every value, not an
 * authorisation), but a `--commit` run now asks the estate whether details
 * research is switched off for this catalogue (`cli.backfill` — see
 * `lib/billing-cli.mjs`) before it claims the first run. An estimate spends
 * nothing and is not gated. `--ignore-policy` goes through anyway: a guard with
 * a deliberate escape hatch, never a CLI that refuses its operator.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { estimateCents } from '@lc/research';

import { claimRun, gapsFor, runDetailsResearch } from '../apps/worker/src/lib/research-run.ts';
import { CLI_FEATURE_SETS, checkCliBilling } from './lib/billing-cli.mjs';
import { execute, lit, parseFlags, query, ROOT } from './lib/d1.mjs';

/**
 * Recorded as the authority behind every value. See apply-pending-findings.mjs.
 *
 * ⚠️ **This is a PROVENANCE stamp, not an authorisation**, and the spending
 * gate below is deliberately NOT resolved against it. The estate's own doors
 * take either a person (through `/seen`, which needs a session this script does
 * not have) or the app's token; this script presents the app's token and is
 * answered for the SITE. Teaching it to assert a person's identity from a
 * hard-coded id would be an app claiming a human it never authenticated —
 * exactly the direction the estate refuses to move in without the owner.
 */
const OWNER_USER_ID = 1;

/**
 * Mirrored whole. All small, and most get written to.
 *
 * ⚠️ **`work_alias` and `change_log` were added 2026-08-24 because the code the
 * mirror stands in for grew to touch them, and their absence was not a missing
 * feature but a crash and a half-write:**
 *
 *   - `claimRun` became alias-aware (migration 0410): it reads `work_alias` via
 *     `listAliasesForWork` to send "Also known as" lines. A mirror without the
 *     table threw `no such table: work_alias` before a single lookup ran.
 *   - `updateWork` writes an audit row to `change_log` (migration 0120) in the
 *     SAME `db.batch()` as the `work` UPDATE. A mirror without the table failed
 *     that batch — and because the batch was non-atomic, it left `work.series`
 *     written while the audit row it was supposed to travel with never landed.
 *     That partial write is exactly what `makeShim.batch`'s transaction (below)
 *     and the append-only guard in `diff` now prevent.
 *
 * `work_alias` is read-only on this path (claimRun reads it, nothing writes it),
 * so it mirrors and diffs back to nothing; it is here so the read cannot crash.
 * `change_log` is APPEND-only — `diff` may only INSERT new audit rows, never
 * rewrite or delete an existing one, and it throws if a seeded row ever changes.
 */
const MIRRORED = [
  'work',
  'research_run',
  'research_finding',
  'gap_verdict',
  'work_alias',
  'change_log',
];

/**
 * The `work` columns this script will write.
 *
 * The four detail fields, plus the timestamp — and then two derived columns,
 * which are here for a reason found by the guard rather than by reading.
 *
 * ⚠️ `updateWork` recomputes `sort_title`, `primary_author` **and `work_key`**
 * from title and authors on every single update, whatever the patch asked for.
 * So a stored value that has drifted from its derivation gets silently corrected
 * the first time anything touches the row. The guard caught this on work #224
 * and stopped the run: *"the run changed sort_title, which this script does not
 * write."*
 *
 * Checked across all 224 works before widening anything:
 *
 * | Column | Stored disagrees with derived |
 * |---|---|
 * | `sort_title` | **5** — works 224–228, the ones just created for the crowdfunding import |
 * | `primary_author` | 0 |
 * | `work_key` | 0 |
 *
 * The five are new rows whose `sort_title` kept its leading article, so they
 * sort under "The". Letting the correction through is what the live route would
 * do anyway, and it fixes them.
 *
 * ⚠️ **`work_key` stays out, and must.** It is the join to 860 audiobook
 * reviews, and a silent rewrite would move a book's reviews rather than break
 * visibly. It agrees everywhere today; the day it does not, this script must
 * stop and say so rather than paper over it. Same for `title` and `authors`,
 * which are what it is derived from.
 */
const SAFE_COLUMNS = new Set([
  'first_published',
  'series',
  'series_index_sort',
  'description',
  'updated_at',
  'sort_title',
  'primary_author',
]);

// ---------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------

/**
 * A misconfiguration is not a crash, and must not read like one.
 *
 * ⚠️ Every refusal in this file is a person having typed the wrong thing, or a
 * drop-box being blank — answers, not faults. Thrown, they arrive as a Node
 * stack trace with the sentence that matters buried in it, which is the same
 * mistake as showing somebody a bare HTTP status. So they print and exit,
 * matching `backfill-missing-covers.mjs`. A genuine bug still throws and still
 * gets its stack.
 */
function fatal(message) {
  console.error(`⚠️ ${message}`);
  process.exit(1);
}

/**
 * ⚠️ **The escape hatch from the whose-key-pays rule, spelled the same way
 * `backfill-missing-covers.mjs` spells it** — one name for one idea, so nobody
 * has to remember two.
 *
 * `--llm-key-from=main` makes a `--friend` run spend `ANTHROPIC_API_KEY` instead
 * of `ANTHROPIC_API_KEY_FRIEND_SAM`. Long and ugly on purpose: the default
 * (refuse, never fall back) is a custody rule, and an exception you can take by
 * accident is not an exception, it is a bug. Validated up front so a typo in the
 * one flag that redirects a bill costs nothing.
 */
function keyOverride({ friend, commit }) {
  const arg = process.argv.find((a) => a === '--llm-key-from' || a.startsWith('--llm-key-from='));
  if (!arg) return false;
  const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1).trim() : '';
  if (value !== 'main') {
    fatal(
      `--llm-key-from: the only accepted value is "main"` +
        (value ? `, not "${value}".` : ' — it takes an "=", e.g. --llm-key-from=main.') +
        '\n   It exists to bill a --friend run to the OWNER\'s ANTHROPIC_API_KEY. There is' +
        '\n   nothing else to point it at: the default already reads the key belonging to' +
        '\n   whichever instance the run is aimed at.',
    );
  }
  if (!friend) {
    fatal(
      '--llm-key-from=main does nothing without --friend: a main-instance run already\n' +
        '   reads ANTHROPIC_API_KEY. Stopping rather than pretending the flag changed something.',
    );
  }
  if (!commit) {
    fatal(
      '--llm-key-from=main does nothing without --commit: an estimate asks nothing and\n' +
        '   spends nothing. Stopping rather than pretending the flag changed something.',
    );
  }
  return true;
}

/**
 * The NAME of the key this run may spend — the instance's, or the owner's when
 * the override was typed out in full.
 *
 * ⚠️ Padhard's spend goes on HER key. `apps/worker/.dev.vars` lines 79–85 settle
 * that, and the line is a **drop-box that lives blank**: the runbook
 * (`docs/access/second-instance.md`) pastes a key in, pipes it to
 * `wrangler secret put ANTHROPIC_API_KEY --env friend`, then blanks it again.
 * Her Worker holds the key; a secret store cannot be read back. So an empty line
 * is the resting state and not a misconfiguration — see `KNOWN_ISSUES.md` KI-7.
 */
function keyNameFor({ friend, overridden }) {
  if (overridden) return 'ANTHROPIC_API_KEY';
  return friend ? 'ANTHROPIC_API_KEY_FRIEND_SAM' : 'ANTHROPIC_API_KEY';
}

/**
 * ⚠️ `.dev.vars` is gitignored, so a worktree does not have one — and this
 * script is most useful from a worktree. Falls back to the main checkout, found
 * through git rather than guessed, so nothing has to be copied around.
 *
 * ⚠️ **The env-var short-circuit is per-NAME too.** It used to read
 * `process.env.ANTHROPIC_API_KEY` before anything else, which under `--friend`
 * is precisely the silent fallback this function exists to refuse — an exported
 * shell variable would have billed padhard to the owner with nothing printed.
 *
 * ⚠️ **Never falls back to another name.** If the name it was told to use is
 * empty, it throws and says which name and why; it does not go looking for a key
 * that would work.
 */
function anthropicKey(keyName) {
  if (process.env[keyName]) return process.env[keyName];

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
      const match = new RegExp(`^\\s*${keyName}\\s*=\\s*(.*)$`).exec(line);
      if (!match) continue;
      const value = match[1].trim().replace(/^["']|["']$/g, '');
      if (value) return value;
    }
  }

  return fatal(
    `No ${keyName}. Set it in the environment, or put it in apps/worker/.dev.vars ` +
      `(looked in: ${candidates.join(', ')}).` +
      (keyName === 'ANTHROPIC_API_KEY_FRIEND_SAM'
        ? '\n\n   ⚠️ That line is a DROP-BOX and blank is its resting state, not a fault:' +
          '\n   paste her key after the `=`, run, then blank it again. Runbook:' +
          '\n   docs/access/second-instance.md. KNOWN_ISSUES.md KI-7.' +
          '\n   ⚠️ Do NOT substitute ANTHROPIC_API_KEY here — that bills padhard to the' +
          '\n   owner. If that IS the decision, it has a flag that says so out loud:' +
          '\n   --llm-key-from=main. Never a quiet edit of this line.'
        : ''),
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
    /**
     * ⚠️ **Atomic: every statement in a batch commits together or none does.**
     *
     * D1's own `db.batch()` runs on one session and is all-or-nothing, and the
     * code this mirror stands in for leans on that: `updateWork` batches the
     * `work` UPDATE beside its `change_log` audit INSERT precisely so a change
     * and its record cannot separate. The pre-fix shim ran each statement on
     * its own, so a failing audit insert left the `work` row already written —
     * the exact partial write a prior run produced (`work.series` on
     * production, no audit row, the rest of the flush aborted).
     *
     * node:sqlite is synchronous, so wrapping the loop in a transaction on the
     * in-memory db gives the same guarantee. `last_insert_rowid()` in a later
     * statement still sees an earlier INSERT — it is the same connection, the
     * same session — so `changeLogInsert`'s creation path is unaffected.
     */
    async batch(statements) {
      const out = [];
      db.exec('BEGIN');
      try {
        for (const s of statements) out.push(await s.run());
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
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

function buildMirror({ remote, friend }) {
  const names = MIRRORED.map((t) => `'${t}'`).join(', ');
  const schema = query(
    `SELECT sql FROM sqlite_master WHERE tbl_name IN (${names}) AND sql IS NOT NULL ORDER BY type DESC`,
    { remote, friend },
  );
  if (schema.length === 0) throw new Error('no schema came back — is the database migrated?');

  // ⚠️ Foreign keys OFF explicitly: node:sqlite turns them ON, unlike SQLite,
  // and `research_finding` references `app_user` and `edition`, which are not
  // mirrored. With enforcement on, the INSERT will not even prepare.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const { sql } of schema) db.exec(sql);

  const snapshots = new Map();
  for (const table of MIRRORED) {
    const rows = query(`SELECT * FROM ${table}`, { remote, friend });
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
      // ⚠️ `change_log` is APPEND-only (migration 0120): it exists to record
      // what happened and an audit log something can rewrite is not one. New
      // rows are INSERTed above; an existing row that appears to have CHANGED is
      // never something to diff back — it is a bug, so stop rather than issue an
      // UPDATE against production's audit trail.
      if (table === 'change_log') {
        throw new Error(
          `change_log #${row.id}: an existing audit row changed (${changed.join(', ')}). ` +
            'This table is append-only and must never be rewritten. Something is wrong.',
        );
      }
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

function flush(db, snapshots, { remote, friend, commit }) {
  // ⚠️ `research_run` first, and this order is a constraint rather than a
  // preference. **D1 enforces foreign keys**, and both `gap_verdict.run_id` and
  // `research_finding.run_id` point at the run this book just produced. Writing
  // the verdict first fails the whole batch — and wrangler reports that as a
  // bare non-zero exit with nothing on stderr, so it costs a dumped .sql file to
  // find out why. Parents before children, then.
  //
  // The instinct it overrides was to write `work` first, so a half-flush left
  // the catalog holding the answer rather than a run claiming to have written
  // one. That still holds between `work` and the findings; the run row simply
  // has to precede anything referencing it.
  //
  // `work_alias` is read-only here and diffs to nothing; it is in the order so
  // the set matches MIRRORED. `change_log` comes last: its audit rows are the
  // record of the `work` write above them, and appending them in the same call
  // is what makes the pair atomic on production too (see below).
  const order = [
    'research_run',
    'work',
    'gap_verdict',
    'research_finding',
    'work_alias',
    'change_log',
  ];
  const statements = order.flatMap((t) => diff(db, t, snapshots.get(t)));
  if (statements.length === 0 || !commit) return statements.length;
  try {
    // ⚠️ **One `execute` call per book, NOT chunked.** A `wrangler d1 execute
    // --file` runs its whole file as one all-or-nothing batch — the FK-ordering
    // note above depends on exactly that ("writing the verdict first fails the
    // whole batch"). The pre-fix code split the statements into blocks of 40,
    // which made a book's `work` UPDATE and its `change_log` audit INSERT land
    // in DIFFERENT batches, so a failure between them could leave `work.series`
    // written with no audit row — the same split the in-memory `batch` now
    // closes. A single book's diff is a handful of statements (one run, one
    // work update, a few findings/verdicts/audit rows), comfortably one batch;
    // the per-book flush (money-safety) is unchanged, atomicity is now WITHIN
    // it. `execute` still fails loudly if any statement is rejected.
    execute(statements, { remote, friend });
  } catch (err) {
    // ⚠️ wrangler reports a rejected batch as a bare non-zero exit with nothing
    // on stderr, so the statement that broke is otherwise unknowable — and this
    // runs unattended, after money has already been spent. Keep the SQL.
    const dump = path.join(tmpdir(), `lc-flush-${Date.now()}.sql`);
    writeFileSync(dump, statements.join('\n') + '\n', 'utf8');
    throw new Error(`${err.message}\nThe batch that failed is at ${dump}`);
  }
  return statements.length;
}

// ---------------------------------------------------------------------------

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

async function main() {
  const { commit, remote, friend, limit } = parseFlags();

  /*
   * ⚠️ Named and printed BEFORE the mirror is built, and before a single call is
   * made. The whole defect this replaces was that nothing said which key was
   * being spent, so the wrong answer was indistinguishable from the right one
   * until the invoice arrived. `dbName` in `lib/d1.mjs` refuses `--friend`
   * without `--remote` for the mirror-image reason.
   */
  const overridden = keyOverride({ friend, commit });
  const keyName = keyNameFor({ friend, overridden });
  const whose = overridden
    ? "the OWNER's key — billed to him, for padhard's books"
    : friend
      ? "padhard — Samantha's own key"
      : "main instance — the owner's key";

  const where = remote ? 'PRODUCTION' : 'the LOCAL dev database';
  const which = friend ? 'library-catalog-2nd (padhard)' : 'library-catalog (main)';
  console.log(`Target: ${where} ${which}`);
  console.log(`key in use: ${keyName}  (${whose})${commit ? '' : '  — estimate only, nothing is spent'}`);
  if (overridden) {
    console.log(
      `⚠️ OVERRIDE ACTIVE — --llm-key-from=main.\n` +
        `   This is a --friend run (${which}) and it is NOT using\n` +
        `   ANTHROPIC_API_KEY_FRIEND_SAM. Every cent below lands on ${keyName}.\n` +
        `   Without this flag the run refuses to fall back; that default is unchanged.`,
    );
  }

  /*
   * ⚠️ Resolved BEFORE the mirror, not with the `env` object below it. Building
   * the mirror is four full remote table reads; discovering after all of them
   * that the drop-box is blank wastes the slow part of the run to reach an
   * answer that was knowable in a file read. Fail fast, and fail before the
   * expensive thing.
   *
   * ⚠️ Only called under `--commit`, so an estimate against padhard still works
   * with her line blank — an estimate asks nothing and spends nothing. The env
   * property keeps the Worker's own name whatever the source key was called:
   * `runDetailsResearch` reads `env.ANTHROPIC_API_KEY` and knows nothing about
   * instances.
   */
  const apiKey = commit ? anthropicKey(keyName) : 'estimate-only';

  console.log(`Mirroring ${where} ${which}…`);
  const { db, snapshots } = buildMirror({ remote, friend });
  const shim = makeShim(db);
  const env = { DB: shim, ANTHROPIC_API_KEY: apiKey };

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

  // ⚠️ THE SPENDING GATE — L11, §9 Q5. Asked at the exact point this run stops
  // being an estimate and starts being a bill, and before the first `claimRun`:
  // a claim that is then abandoned leaves a run row nobody asked for.
  const gate = await checkCliBilling({
    friend,
    features: CLI_FEATURE_SETS.researchQueue,
    label: 'Details research run',
  });
  if (gate.blocked) return;

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
    const written = flush(db, snapshots, { remote, friend, commit });
    if (written > 0) console.log(`      flushed ${written} statement(s)`);
  }

  // ⚠️ Read back out of the database, not accumulated here — the same reason the
  // queue page counts from `research_run`.
  const after = query(
    'SELECT COUNT(*) AS runs, COALESCE(SUM(input_tokens),0) AS tin, COALESCE(SUM(output_tokens),0) AS tout FROM research_run',
    { remote, friend },
  )[0];
  const centsAfter = estimateCents(after.tin, after.tout);

  console.log(
    `\nRan ${done} lookup(s), ${failed} failed.\n` +
      `This run cost ${money(centsAfter - centsBefore)} in tokens ` +
      `(${after.tin - spentBefore.tin} in, ${after.tout - spentBefore.tout} out) on ${keyName}` +
      (overridden ? ` (⚠️ --llm-key-from=main — padhard's books, the owner's key)` : '') +
      `.\n` +
      `Research has now cost ${money(centsAfter)} in total over ${after.runs} run(s).\n` +
      '⚠️ Tokens only. Anthropic bills its server-side web searches separately.',
  );

  const left = query(
    `SELECT COUNT(*) AS n FROM research_finding WHERE review_state = 'pending'`,
    { remote, friend },
  )[0];
  console.log(`${left.n} finding(s) left pending — a value that could not be used.`);
}

/**
 * ⚠️ Run `main()` ONLY when invoked as the entry point (`tsx
 * scripts/research-queue.mjs`), never on import. The mirror shim and its
 * atomicity are unit-tested (`scripts/test/research-queue.test.mjs`), and a
 * test that imports `makeShim` must not kick off a real run that shells out to
 * wrangler. `realpathSync` normalises Windows drive-letter casing and symlinks
 * so the comparison holds from a worktree.
 */
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

export { makeShim, buildMirror, diff, flush, MIRRORED, SAFE_COLUMNS };

if (isEntryPoint()) await main();
