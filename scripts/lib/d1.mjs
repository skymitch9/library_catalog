/**
 * Talking to D1 from a backfill script.
 *
 * ## Why these go through wrangler and not the API
 *
 * Everything that makes a *decision* goes through the Worker — `/api/works`,
 * `/api/ingest` — because that is where the invariants live. A backfill of
 * `cover_url` and `series` decides nothing: it fills columns the catalog already
 * models, computes no `work_key`, and touches nothing the review bridge joins
 * on. Going through the API would buy a token, a capability grant and a route
 * for that, and buy nothing back.
 *
 * ⚠️ The one column this must never write is `work.title` or `work.authors`.
 * Those re-derive `work_key`, which is a migration and not a backfill — see
 * `packages/db/src/works.ts`.
 *
 * ## The exit-code trap
 *
 * wrangler on Windows prints its result and then sometimes exits non-zero on a
 * libuv teardown quirk (CLAUDE.md). So these functions decide success by whether
 * the output parsed, never by the exit code.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = path.join(ROOT, 'apps/worker/wrangler.toml');
const DB_NAME = 'library-catalog';

function runWrangler(args) {
  // `shell: true` is needed to find npx.cmd on Windows, and it is why every
  // argument is quoted here rather than trusted — a path under
  // "OneDrive\Documents" is one directory rename away from containing a space.
  const quoted = args.map((a) => `"${String(a).split('"').join('\\"')}"`);
  try {
    return execFileSync('npx', ['wrangler', ...quoted], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: true,
    });
  } catch (err) {
    // Non-zero exit with usable stdout is the Windows teardown quirk; a genuine
    // failure has the reason on stderr and nothing parseable on stdout.
    const out = err?.stdout ?? '';
    if (typeof out === 'string' && out.includes('[')) return out;
    throw new Error(`wrangler failed: ${err?.stderr || err?.message || err}`);
  }
}

/**
 * Run SQL from a temp file and return every statement's rows.
 *
 * ⚠️ Always a file, never `--command`, and never for the reason it looks like.
 * `--command` puts the SQL through a shell, and this shell is PowerShell: the
 * first multi-line SELECT written that way arrived at wrangler with literal
 * `\n` two-character sequences in it and failed to parse. It is the same
 * quoting failure `git commit -m` produces on this machine, which CLAUDE.md
 * already bans for the same reason.
 */
function runSql(sql, { remote }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lc-d1-'));
  const file = path.join(dir, 'query.sql');
  try {
    writeFileSync(file, sql.endsWith('\n') ? sql : sql + '\n', 'utf8');
    const out = runWrangler([
      'd1', 'execute', DB_NAME,
      '--config', CONFIG,
      remote ? '--remote' : '--local',
      '--file', file,
      '--json',
    ]);
    const start = out.indexOf('[');
    if (start < 0) throw new Error(`no JSON in wrangler output:\n${out}`);
    return JSON.parse(out.slice(start));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Rows from one SELECT. `remote` false is the local dev database. */
export function query(sql, { remote }) {
  return runSql(sql, { remote })[0]?.results ?? [];
}

/** A SQL string literal. Doubling the quote is the whole of SQLite's escaping. */
export function lit(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`refusing to write ${value} as a number`);
    return String(value);
  }
  return `'${String(value).split("'").join("''")}'`;
}

/**
 * Run a batch of statements.
 *
 * Written to a file rather than passed as one `--command`, because a shell that
 * has to carry 117 UPDATE statements containing apostrophes and em dashes is the
 * exact quoting failure `git commit -m` produces on this machine.
 */
export function execute(statements, { remote }) {
  if (statements.length === 0) return 0;
  const results = runSql(statements.join('\n'), { remote });

  const failed = results.filter((r) => r?.success === false).length;
  if (failed) throw new Error(`${failed} of ${statements.length} statement(s) failed`);

  // ⚠️ Returns how many statements ran, NOT how many rows changed.
  //
  // `meta.changes` is absent entirely from the local (miniflare) D1's response —
  // measured 2026-08-10, every statement comes back `{"meta":{"duration":0}}` —
  // so summing it reported "0 rows updated" over a run that had just written 114.
  // `scripts/import-ebooks.mjs` records the same lesson from the other side: a
  // counter that lies about a no-op looks exactly like the bug it was meant to
  // disprove. Callers must confirm by re-reading the database, and both backfills
  // here do.
  return statements.length;
}

/**
 * `--commit` and `--remote`, parsed the same way by every script here.
 *
 * Dry run against the LOCAL database is the default, matching every other
 * importer in this project: the safe rehearsal must be the thing that happens
 * when you forget a flag.
 */
export function parseFlags(argv = process.argv.slice(2)) {
  return {
    commit: argv.includes('--commit'),
    remote: argv.includes('--remote'),
    limit: (() => {
      const i = argv.indexOf('--limit');
      return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : Infinity;
    })(),
  };
}

export { ROOT };
