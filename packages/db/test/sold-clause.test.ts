/**
 * `NOT_ONLY_SOLD` — the predicate behind "the collection hides sold books"
 * (owner decision #3, 2026-08-23: *"Sold stays as a record … the collection
 * view hides sold copies by default. Nothing is deleted."*).
 *
 * ## Why this runs real SQL, like `ebook-only-clause.test.ts` beside it
 *
 * The decision this clause makes is *which of the owner's books he can see*,
 * and it is made in SQL. A TypeScript restatement would agree with itself and
 * prove nothing about the text that ships. The clause is imported rather than
 * retyped, so what is exercised here is byte-for-byte what runs.
 *
 * ## The two rows that would have broken it
 *
 * 1. ⚠️ **A work with NO copies at all.** That is most of this catalog — the
 *    ebook import made 800-odd works and not one `copy` row. The obvious
 *    spelling ("has an unsold copy") empties the collection.
 * 2. ⚠️ **A work sold in one form and kept in another.** One `sold` row must
 *    not remove a book that is still on the shelf in hardcover — the same
 *    error as `HELD_STATUSES` counting `owned` alone, which the collection
 *    query's own comment already warns about.
 *
 * ⚠️ SQLite, not D1 — so this pins the PREDICATE, not the binding order or the
 * rest of `collectionFilter`.
 */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { NOT_ONLY_SOLD } from '../src/works.ts';

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE work (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE copy (
      id INTEGER PRIMARY KEY,
      work_id INTEGER NOT NULL REFERENCES work(id),
      status TEXT NOT NULL DEFAULT 'owned'
    );
  `);
  return db;
}

function addWork(db: DatabaseSync, id: number, title: string, statuses: string[] = []): void {
  db.prepare('INSERT INTO work (id, title) VALUES (?, ?)').run(id, title);
  for (const s of statuses) {
    db.prepare('INSERT INTO copy (work_id, status) VALUES (?, ?)').run(id, s);
  }
}

/** The titles the collection would show, under the clause exactly as it ships. */
function visible(db: DatabaseSync): string[] {
  return db
    .prepare(`SELECT w.title AS title FROM work w WHERE ${NOT_ONLY_SOLD} ORDER BY w.id`)
    .all()
    .map((r) => String((r as { title: string }).title));
}

describe('NOT_ONLY_SOLD — what stays on the shelf', () => {
  it('a work whose every copy is sold is hidden', () => {
    const db = fixture();
    addWork(db, 1, 'Gone', ['sold']);
    assert.deepEqual(visible(db), []);
  });

  it('two sold copies and nothing else is still gone', () => {
    const db = fixture();
    addWork(db, 1, 'Both Gone', ['sold', 'sold']);
    assert.deepEqual(visible(db), []);
  });

  it('⚠️ a work with NO copies at all is untouched — that is most of the catalog', () => {
    const db = fixture();
    addWork(db, 1, 'Imported Ebook', []);
    assert.deepEqual(
      visible(db),
      ['Imported Ebook'],
      'a clause reading "has an unsold copy" would empty the collection',
    );
  });

  it('⚠️ sold in paperback, kept in hardcover — the book is still here', () => {
    const db = fixture();
    addWork(db, 1, 'Half Sold', ['sold', 'owned']);
    assert.deepEqual(visible(db), ['Half Sold']);
  });

  it('every other status survives on its own', () => {
    const db = fixture();
    addWork(db, 1, 'Shelf', ['owned']);
    addWork(db, 2, 'Lent', ['lent']);
    addWork(db, 3, 'Borrowed', ['borrowed']);
    addWork(db, 4, 'Wanted', ['wanted']);
    addWork(db, 5, 'Preordered', ['preordered']);
    assert.deepEqual(visible(db), ['Shelf', 'Lent', 'Borrowed', 'Wanted', 'Preordered']);
  });

  it('a sold copy beside a wish still shows — a wish is not an absence of the book', () => {
    // He sold the paperback and wants the hardcover. The row he is waiting on
    // is the reason the work must stay findable.
    const db = fixture();
    addWork(db, 1, 'Sold, Rewanted', ['sold', 'wanted']);
    assert.deepEqual(visible(db), ['Sold, Rewanted']);
  });

  it('the mixed shelf, all at once', () => {
    const db = fixture();
    addWork(db, 1, 'Kept', ['owned']);
    addWork(db, 2, 'Sold Off', ['sold']);
    addWork(db, 3, 'No Copies', []);
    addWork(db, 4, 'Half Sold', ['sold', 'lent']);
    assert.deepEqual(visible(db), ['Kept', 'No Copies', 'Half Sold']);
  });
});
