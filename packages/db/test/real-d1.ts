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
  const exec = (sql: string, bound: Bound) => {
    const r = sqlite.prepare(sql).run(...bound);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
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
        return (sqlite.prepare(sql).get(...bound) as T | undefined) ?? null;
      },
      async all<T>() {
        return { success: true, results: sqlite.prepare(sql).all(...bound) as T[], meta: {} };
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
