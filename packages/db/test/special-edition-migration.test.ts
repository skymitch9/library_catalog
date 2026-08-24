/**
 * Migration 0430 — the special-edition copy booleans — run against a real
 * SQLite, the way `ebook-only-clause.test.ts` runs the shipping SQL rather than
 * a restatement of it.
 *
 * ## What it pins
 *
 * 1. ⚠️ **It round-trips EXISTING rows.** A copy written before 0430 (the
 *    common case — production has copies already) must read `0` for all three
 *    new flags after the ALTERs run, never NULL. `NOT NULL DEFAULT 0` is what
 *    makes that true, and this proves it by inserting the row BEFORE applying
 *    the migration.
 * 2. **The toggle write.** A new copy can set any of the three to 1, and an
 *    UPDATE can flip one without disturbing the others — the SQL shape
 *    `createCopy`/`updateCopy` emit.
 * 3. ⚠️ **The CHECK holds.** `2` is refused, exactly as `is_signed`'s has since
 *    migration 0001 — these mirror it byte-for-byte.
 *
 * The migration TEXT is read from disk and applied statement by statement, so a
 * change to `0430_special_editions.sql` that broke any of the above would turn
 * this red.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(here, '../../../migrations/0430_special_editions.sql'),
  'utf8',
);

/** The executable statements of a migration — comment lines and blanks removed. */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A copy table as migration 0001 shipped it — is_signed present, the three not. */
function preMigrationCopyTable(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE copy (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'owned',
      is_signed INTEGER NOT NULL DEFAULT 0 CHECK (is_signed IN (0, 1))
    );
  `);
  return db;
}

function applyMigration(db: DatabaseSync): void {
  for (const stmt of statements(migrationSql)) db.exec(stmt);
}

describe('migration 0430 — special-edition copy booleans', () => {
  it('the file adds exactly the three columns, as ALTER (no rebuild)', () => {
    const stmts = statements(migrationSql);
    assert.equal(stmts.length, 3, 'three ADD COLUMN statements, nothing else');
    for (const s of stmts) assert.match(s, /^ALTER TABLE copy ADD COLUMN/);
    assert.ok(stmts.some((s) => /sprayed_edges/.test(s)));
    assert.ok(stmts.some((s) => /leatherbound/.test(s)));
    assert.ok(stmts.some((s) => /slipcase/.test(s)));
  });

  it('⚠️ a copy written BEFORE the migration reads 0 for all three after it — not NULL', () => {
    const db = preMigrationCopyTable();
    db.prepare("INSERT INTO copy (work_id, status, is_signed) VALUES (1, 'owned', 1)").run();
    applyMigration(db);
    const row = db
      .prepare('SELECT is_signed, sprayed_edges, leatherbound, slipcase FROM copy WHERE id = 1')
      .get() as Record<string, number>;
    // node:sqlite returns a null-prototype object; spread to compare by value.
    assert.deepEqual({ ...row }, { is_signed: 1, sprayed_edges: 0, leatherbound: 0, slipcase: 0 });
  });

  it('a new copy can record any of the three, and one flips without touching the rest', () => {
    const db = preMigrationCopyTable();
    applyMigration(db);
    db.prepare(
      'INSERT INTO copy (work_id, leatherbound, sprayed_edges) VALUES (1, 1, 1)',
    ).run();
    // The toggle write: mark slipcase on, leave the other two exactly as they were.
    db.prepare('UPDATE copy SET slipcase = 1 WHERE id = 1').run();
    const row = db
      .prepare('SELECT sprayed_edges, leatherbound, slipcase FROM copy WHERE id = 1')
      .get() as Record<string, number>;
    assert.deepEqual({ ...row }, { sprayed_edges: 1, leatherbound: 1, slipcase: 1 });
  });

  it('⚠️ the CHECK refuses anything but 0/1 — the is_signed guarantee, for all three', () => {
    const db = preMigrationCopyTable();
    applyMigration(db);
    for (const col of ['sprayed_edges', 'leatherbound', 'slipcase']) {
      assert.throws(
        () => db.prepare(`INSERT INTO copy (work_id, ${col}) VALUES (1, 2)`).run(),
        /CHECK/i,
        `${col} must reject 2`,
      );
    }
  });
});
