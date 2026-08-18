/**
 * `EBOOK_ONLY_CLAUSE.hide` — the predicate behind "Recently added shows physical
 * books only" (owner, 2026-08-18).
 *
 * ## Why this test runs real SQL and not a JavaScript restatement
 *
 * The decision this clause makes is *which of the owner's books he can see*, and
 * it is made in SQL. A test that re-implemented the same three conjuncts in
 * TypeScript would agree with itself and prove nothing about the text that
 * ships; `node:sqlite` costs a schema stub and answers the real question. It is
 * also the only way to pin the row shape that nearly broke this: **a work with a
 * copy and no `edition` row at all.** Six of those were live on the morning
 * this shipped, five of them catalogued in that same hour, and every one would
 * have vanished from the strip under the obvious-looking `medium=physical`.
 *
 * ⚠️ SQLite, not D1 — so this pins the *predicate*, not the binding order or
 * the rest of `collectionFilter`. The clause is imported rather than retyped, so
 * the SQL under test is byte-for-byte the SQL that runs in production.
 */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { PHYSICAL_FORMATS } from '@lc/core';

import { EBOOK_ONLY_CLAUSE } from '../src/works.ts';

/** Just enough of migration 0001 for the three tables the clause touches. */
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
      status TEXT NOT NULL DEFAULT 'owned'
    );
  `);
  return db;
}

function addWork(db: DatabaseSync, id: number, title: string): void {
  db.prepare('INSERT INTO work (id, title) VALUES (?, ?)').run(id, title);
}

function addEdition(db: DatabaseSync, workId: number, format: string): void {
  db.prepare('INSERT INTO edition (work_id, format) VALUES (?, ?)').run(workId, format);
}

function addCopy(db: DatabaseSync, workId: number, status = 'owned'): void {
  db.prepare('INSERT INTO copy (work_id, status) VALUES (?, ?)').run(workId, status);
}

/** The titles the shelf would show, under the clause exactly as it ships. */
function visible(db: DatabaseSync): string[] {
  const clause = EBOOK_ONLY_CLAUSE.hide;
  assert.ok(clause, 'the vocabulary is one word and it is "hide"');
  const rows = db
    .prepare(`SELECT w.title AS title FROM work w WHERE ${clause} ORDER BY w.id`)
    // Two EXISTS subqueries, one spelling of PHYSICAL_FORMATS each — the same
    // double bind `collectionFilter` pushes.
    .all(...PHYSICAL_FORMATS, ...PHYSICAL_FORMATS) as { title: string }[];
  return rows.map((r) => r.title);
}

describe('EBOOK_ONLY_CLAUSE.hide — the physical shelf', () => {
  it('drops a work held only as an ebook file, and keeps everything else', () => {
    const db = fixture();

    // 1. Ebook-only: an ebook edition, no physical edition, no copy. The 94.
    addWork(db, 1, 'Ebook only');
    addEdition(db, 1, 'ebook_epub');

    // 2. Both: on the shelf AND on the Kindle. The 32. ⚠️ This is the row that
    //    an "every edition is physical" reading would wrongly drop — the
    //    household routinely owns a book both ways and those are the
    //    interesting rows, not the ones to hide.
    addWork(db, 2, 'Shelf and Kindle');
    addEdition(db, 2, 'ebook_epub');
    addEdition(db, 2, 'hardcover');
    addCopy(db, 2);

    // 3. Physical, plainly.
    addWork(db, 3, 'Paperback');
    addEdition(db, 3, 'paperback');
    addCopy(db, 3);

    // 4. ⚠️ THE ONE THAT MATTERS: a copy, and no edition row at all. What a
    //    spine photo leaves behind before anybody types the printing in. Five
    //    of these were catalogued in the hour this shipped.
    addWork(db, 4, 'Photographed, printing not typed in yet');
    addCopy(db, 4);

    // 5. Nothing at all — no edition, no copy. None exist today; if one ever
    //    does it is not provably an ebook, so it stays. The failure mode of a
    //    mis-measured row is that it is still SHOWN, which is the right way
    //    round for a shelf.
    addWork(db, 5, 'Bare work row');

    assert.deepEqual(visible(db), [
      'Shelf and Kindle',
      'Paperback',
      'Photographed, printing not typed in yet',
      'Bare work row',
    ]);
    db.close();
  });

  it('keeps an ebook-only work the moment a copy appears on it', () => {
    const db = fixture();
    addWork(db, 1, 'Ebook, then somebody bought the paperback');
    addEdition(db, 1, 'ebook_epub');
    assert.deepEqual(visible(db), []);

    // A `wanted` copy counts too, and deliberately: the wishlist row is a
    // decision this household made about a book, which is exactly the thing the
    // physical catalog is for. `copy.status` is not read by this clause.
    addCopy(db, 1, 'wanted');
    assert.deepEqual(visible(db), ['Ebook, then somebody bought the paperback']);
    db.close();
  });

  it('treats every non-physical format as ebook, including the Kindle licence', () => {
    const db = fixture();
    // ⚠️ `ebook_kindle` is an Amazon licence with no bytes on our side, and
    // `editionMedium` in @lc/core puts it on the not-physical side by defining
    // ebook as the NEGATION of PHYSICAL_FORMATS. A second list would be a
    // second place to forget a format; this clause inherits that discipline via
    // PHYSICAL_FORMATS and must keep it.
    for (const [i, format] of ['ebook_kindle', 'ebook_pdf', 'ebook_azw3'].entries()) {
      addWork(db, i + 1, `Only ${format}`);
      addEdition(db, i + 1, format);
    }
    assert.deepEqual(visible(db), []);
    db.close();
  });

  it('keeps every physical format', () => {
    const db = fixture();
    for (const [i, format] of PHYSICAL_FORMATS.entries()) {
      addWork(db, i + 1, format);
      addEdition(db, i + 1, format);
      // ⚠️ Paired with an ebook edition on purpose: the clause must key on the
      // physical edition existing, not on the ebook one being absent.
      addEdition(db, i + 1, 'ebook_epub');
    }
    assert.deepEqual(visible(db), [...PHYSICAL_FORMATS]);
    db.close();
  });

  it('is the whole catalog when nobody asked — an unknown value adds no clause', () => {
    // The map is the allowlist. `collectionFilter` looks the caller's word up in
    // it and adds nothing on a miss, so `?ebooks=maybe` shows the collection
    // rather than 400ing — the rule the sort allowlist, MEDIUM_CLAUSE,
    // KIND_CLAUSE and NEEDS_CLAUSE all follow.
    assert.deepEqual(Object.keys(EBOOK_ONLY_CLAUSE), ['hide']);
    assert.equal(EBOOK_ONLY_CLAUSE['physical'], undefined);
    assert.equal(EBOOK_ONLY_CLAUSE['1'], undefined);
  });
});
