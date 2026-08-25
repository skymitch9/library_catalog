/**
 * `OWNED_TWICE_PHYSICAL` — the predicate behind the "Owned 2+ (physical)"
 * checkbox (owner ask, 2026-08-24: *"i want the recorded twice to show me any
 * book i own 2 of in physical, even if different editions."*).
 *
 * ## Why this runs real SQL, like `sold-clause.test.ts` beside it
 *
 * The clause decides which of the owner's books the filter surfaces, and it is
 * made in SQL. A TypeScript restatement would agree with itself and prove
 * nothing about the text that ships. The clause is imported, not retyped, so
 * what runs here is byte-for-byte what runs in production. SQLite, not D1, so
 * this pins the PREDICATE, not the binding order or the rest of
 * `collectionFilter`.
 *
 * ## The rows that pin the rule
 *
 * 1. ⚠️ **Two physical copies across DIFFERENT editions** — the exact case the
 *    owner named ("even if different editions"): a hardcover of one printing and
 *    a paperback of another are two copies of the one book.
 * 2. ⚠️ **A physical copy beside an ebook copy** counts as ONE physical — a book
 *    owned once in print and once on Kindle is not owned twice in physical.
 * 3. ⚠️ **A copy with no edition yet** is a physical object on the shelf whose
 *    printing nobody has typed in, so it counts.
 * 4. ⚠️ **`lent` counts, `wanted`/`sold`/etc. do not** — `HELD_STATUSES`, so the
 *    filter agrees with `ownedMoreThanOnce` and the series "Bought more than once".
 */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { OWNED_TWICE_PHYSICAL } from '../src/works.ts';

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE work (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE edition (
      id INTEGER PRIMARY KEY,
      work_id INTEGER NOT NULL REFERENCES work(id),
      format TEXT NOT NULL
    );
    CREATE TABLE copy (
      id INTEGER PRIMARY KEY,
      work_id INTEGER NOT NULL REFERENCES work(id),
      edition_id INTEGER REFERENCES edition(id),
      status TEXT NOT NULL DEFAULT 'owned'
    );
  `);
  return db;
}

let nextEdition = 1;

/** Add a work, then its copies as `[status, format|null]` pairs. A `format`
 * mints an edition of that printing; `null` leaves `edition_id` unset. */
function addWork(
  db: DatabaseSync,
  id: number,
  title: string,
  copies: Array<[string, string | null]> = [],
): void {
  db.prepare('INSERT INTO work (id, title) VALUES (?, ?)').run(id, title);
  for (const [status, format] of copies) {
    let editionId: number | null = null;
    if (format !== null) {
      editionId = nextEdition++;
      db.prepare('INSERT INTO edition (id, work_id, format) VALUES (?, ?, ?)').run(
        editionId,
        id,
        format,
      );
    }
    db.prepare('INSERT INTO copy (work_id, edition_id, status) VALUES (?, ?, ?)').run(
      id,
      editionId,
      status,
    );
  }
}

/** The titles the filter would surface, under the clause exactly as it ships. */
function matched(db: DatabaseSync): string[] {
  return db
    .prepare(`SELECT w.title AS title FROM work w WHERE ${OWNED_TWICE_PHYSICAL} ORDER BY w.id`)
    .all()
    .map((r) => String((r as { title: string }).title));
}

describe('OWNED_TWICE_PHYSICAL — books owned in 2+ physical copies', () => {
  it('two owned physical copies of one printing shows', () => {
    const db = fixture();
    addWork(db, 1, 'Doubled', [['owned', 'hardcover'], ['owned', 'hardcover']]);
    assert.deepEqual(matched(db), ['Doubled']);
  });

  it('⚠️ two physical copies across DIFFERENT editions shows — the case the owner named', () => {
    const db = fixture();
    addWork(db, 1, 'Two Printings', [['owned', 'hardcover'], ['owned', 'paperback']]);
    assert.deepEqual(matched(db), ['Two Printings']);
  });

  it('one physical copy does not', () => {
    const db = fixture();
    addWork(db, 1, 'Single', [['owned', 'hardcover']]);
    assert.deepEqual(matched(db), []);
  });

  it('⚠️ print + ebook is ONE physical, not two — the Kindle copy is not counted', () => {
    const db = fixture();
    addWork(db, 1, 'Print And Kindle', [['owned', 'hardcover'], ['owned', 'ebook']]);
    assert.deepEqual(matched(db), []);
  });

  it('two ebook copies is not "twice in physical"', () => {
    const db = fixture();
    addWork(db, 1, 'Two Files', [['owned', 'ebook'], ['owned', 'ebook']]);
    assert.deepEqual(matched(db), []);
  });

  it('⚠️ copies with no edition yet count — they are physical objects on the shelf', () => {
    const db = fixture();
    addWork(db, 1, 'Unfiled Pair', [['owned', null], ['owned', null]]);
    assert.deepEqual(matched(db), ['Unfiled Pair']);
  });

  it('a null-edition copy beside a hardcover counts as two physical', () => {
    const db = fixture();
    addWork(db, 1, 'Scan Plus Filed', [['owned', null], ['owned', 'hardcover']]);
    assert.deepEqual(matched(db), ['Scan Plus Filed']);
  });

  it('⚠️ lent counts — a book lent out is still owned', () => {
    const db = fixture();
    addWork(db, 1, 'One Lent', [['owned', 'paperback'], ['lent', 'paperback']]);
    assert.deepEqual(matched(db), ['One Lent']);
  });

  it('wanted / preordered / sold / borrowed do not count', () => {
    const db = fixture();
    addWork(db, 1, 'Owned Plus Wish', [['owned', 'hardcover'], ['wanted', 'hardcover']]);
    addWork(db, 2, 'Owned Plus Sold', [['owned', 'hardcover'], ['sold', 'hardcover']]);
    addWork(db, 3, 'Owned Plus Preorder', [['owned', 'hardcover'], ['preordered', 'hardcover']]);
    addWork(db, 4, 'Owned Plus Borrowed', [['owned', 'hardcover'], ['borrowed', 'hardcover']]);
    assert.deepEqual(matched(db), []);
  });

  it('a work with no copies at all does not match', () => {
    const db = fixture();
    addWork(db, 1, 'Imported Ebook', []);
    assert.deepEqual(matched(db), []);
  });

  it('the mixed shelf, all at once', () => {
    const db = fixture();
    addWork(db, 1, 'Two HC', [['owned', 'hardcover'], ['owned', 'hardcover']]);
    addWork(db, 2, 'One HC', [['owned', 'hardcover']]);
    addWork(db, 3, 'HC + Mass Market', [['owned', 'hardcover'], ['owned', 'mass_market']]);
    addWork(db, 4, 'HC + Ebook', [['owned', 'hardcover'], ['owned', 'ebook']]);
    addWork(db, 5, 'No Copies', []);
    assert.deepEqual(matched(db), ['Two HC', 'HC + Mass Market']);
  });
});
