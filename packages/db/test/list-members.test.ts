/**
 * `listMembers` — the OR-1 name-picker roster, exercised against real SQLite.
 *
 * Two properties are the whole point, and both are silent when wrong:
 *
 *   1. ⚠️ **It answers `{ id, displayName }` and NOTHING else.** The row in the
 *      table carries email, photo, role and timestamps; a picker that leaked any
 *      of those would look identical on the card and hand a contributor the
 *      estate's contact sheet. So this asserts the exact key SET of each object,
 *      not just that the name is present.
 *   2. ⚠️ **Only approved members with a name appear.** A `pending` row is an
 *      unapproved account and must never be offered; a row with no display name
 *      (or a whitespace one) cannot be picked by the name-matching field and is
 *      left out rather than offered blank.
 *
 * Real SQLite, not a stub, because both facts are decided in the SQL `WHERE`
 * and `SELECT` — a TypeScript restatement would agree with itself and prove
 * nothing about the text that ships. The function is imported and run through a
 * tiny D1 shim, so what executes is byte-for-byte what the Worker calls.
 */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { listMembers } from '../src/users.ts';

/**
 * The narrowest D1 surface `listMembers` touches — `prepare(sql).all()`. node's
 * `StatementSync.all()` is synchronous; D1's is a promise, so it is wrapped.
 */
function d1(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      const bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          bound.push(...args);
          return api;
        },
        async all<T>() {
          return { results: stmt.all(...(bound as never[])) as T[] };
        },
      };
      return api;
    },
  } as unknown as D1Database;
}

function fixture(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE app_user (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT,
      photo_url TEXT,
      role TEXT NOT NULL,
      approved_at TEXT
    );
  `);
  const add = (
    id: number,
    role: string,
    displayName: string | null,
    email = `u${id}@example.com`,
  ) =>
    db
      .prepare('INSERT INTO app_user (id, email, display_name, photo_url, role) VALUES (?,?,?,?,?)')
      .run(id, email, displayName, 'https://photo/x.png', role);

  add(1, 'owner', 'Zed Owner');
  add(2, 'contributor', 'Amy Contributor');
  add(3, 'member', 'Bob Member');
  add(4, 'guest', 'Cara Guest');
  add(5, 'pending', 'Pat Pending'); // unapproved — must be absent
  add(6, 'member', null); // no name — cannot be picked, must be absent
  add(7, 'member', '   '); // whitespace only — same
  return d1(db);
}

describe('listMembers — the narrow name-picker roster', () => {
  it('returns ONLY id + displayName, nothing about the person besides', async () => {
    const members = await listMembers(fixture());
    for (const m of members) {
      assert.deepEqual(
        Object.keys(m).sort(),
        ['displayName', 'id'],
        `a member leaked more than {id, displayName}: ${JSON.stringify(m)}`,
      );
    }
  });

  it('excludes pending, name-less and whitespace-only rows', async () => {
    const members = await listMembers(fixture());
    const ids = members.map((m) => m.id);
    assert.deepEqual(ids.sort((a, b) => a - b), [1, 2, 3, 4], 'only the four named, approved rows');
    assert.ok(!ids.includes(5), 'a pending account must never be offered');
    assert.ok(!ids.includes(6), 'a row with no display name cannot be picked');
    assert.ok(!ids.includes(7), 'a whitespace-only name cannot be picked');
  });

  it('orders by display name, case-folded, so the datalist reads', async () => {
    const members = await listMembers(fixture());
    assert.deepEqual(
      members.map((m) => m.displayName),
      ['Amy Contributor', 'Bob Member', 'Cara Guest', 'Zed Owner'],
    );
  });
});
