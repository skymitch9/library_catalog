/**
 * A REAL SQLite behind the D1 surface `@lc/db` uses — every migration in
 * `migrations/` applied from disk, in order, into `:memory:`.
 *
 * For tests whose guarantee lives in the SQL itself (an INSERT … WHERE NOT
 * EXISTS, a `changes()` guard, a column default), where a regex fake would
 * agree with itself and prove nothing about the text that ships. Not a
 * `.test.ts`, so the suite glob does not run it as a test.
 *
 * `batch()` runs its statements in order inside one transaction, which is the
 * property D1 documents and the `changes()` / `last_insert_rowid()` guards in
 * `users.ts` and `changes.ts` lean on.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');

export interface RealD1 {
  d1: D1Database;
  sqlite: DatabaseSync;
}

export function realD1(): RealD1 {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  return { d1: wrap(sqlite), sqlite };
}

type Bound = Array<string | number | null>;

function wrap(sqlite: DatabaseSync): D1Database {
  // node:sqlite hands back null-prototype rows; D1 hands back plain objects.
  const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T;
  /** Run one statement the way D1 reports it: rows (for RETURNING/SELECT) + meta. */
  const exec = (sql: string, bound: Bound) => {
    const rows = sqlite.prepare(sql).all(...bound).map((r) => plain<Record<string, unknown>>(r));
    const meta = sqlite.prepare('SELECT changes() AS changes, last_insert_rowid() AS last_row_id').get() as {
      changes: number;
      last_row_id: number;
    };
    const isWrite = /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql);
    return {
      success: true,
      results: rows,
      meta: { changes: isWrite ? Number(meta.changes) : 0, last_row_id: Number(meta.last_row_id) },
    };
  };
  const make = (sql: string) => {
    let bound: Bound = [];
    const stmt = {
      _sql: sql,
      get _bound() {
        return bound;
      },
      bind(...args: unknown[]) {
        bound = args.map((a) => (a === undefined ? null : (a as string | number | null)));
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        const out = exec(sql, bound).results;
        return out.length > 0 ? (out[0] as T) : null;
      },
      async all<T>() {
        return { success: true, results: exec(sql, bound).results as T[], meta: {} };
      },
      async run() {
        return exec(sql, bound);
      },
    };
    return stmt;
  };
  return {
    prepare: make,
    async batch(stmts: Array<{ _sql: string; _bound: Bound }>) {
      sqlite.exec('BEGIN');
      try {
        const out = stmts.map((s) => exec(s._sql, s._bound));
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  } as unknown as D1Database;
}
