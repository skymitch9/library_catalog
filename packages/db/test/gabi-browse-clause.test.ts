/**
 * `BROWSE_HELD_PHYSICAL_CLAUSE` — the predicate deciding which of the owner's
 * books GABI may point a person at (`browse-works`, 2026-08-19).
 *
 * ## Why this runs real SQL, exactly as `ebook-only-clause.test.ts` does
 *
 * The decision is made in SQL, so a TypeScript restatement would agree with
 * itself and prove nothing about the text that ships. `node:sqlite` costs a
 * schema stub and answers the real question — and the row shape it exists to
 * pin is the one a reader nods past: **a held copy with no `edition` row at
 * all**, which was 177 of 390 copies when this was written.
 *
 * ⚠️ SQLite, not D1 — this pins the *predicate*, not D1's binding order.
 * The clause is imported rather than retyped, so the SQL under test is
 * byte-for-byte the SQL that runs in production.
 */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { HELD_STATUSES, PHYSICAL_FORMATS } from '@lc/core';

import { BROWSE_HELD_PHYSICAL_CLAUSE } from '../src/gabi-browse.ts';
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
      edition_id INTEGER REFERENCES edition(id),
      status TEXT NOT NULL DEFAULT 'owned'
    );
  `);
  return db;
}

function addWork(db: DatabaseSync, id: number, title: string): void {
  db.prepare('INSERT INTO work (id, title) VALUES (?, ?)').run(id, title);
}

/** Returns the new edition's id, so a copy can be linked to this exact one. */
function addEdition(db: DatabaseSync, workId: number, format: string): number {
  db.prepare('INSERT INTO edition (work_id, format) VALUES (?, ?)').run(workId, format);
  const row = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
  return row.id;
}

function addCopy(
  db: DatabaseSync,
  workId: number,
  status = 'owned',
  editionId: number | null = null,
): void {
  db.prepare('INSERT INTO copy (work_id, status, edition_id) VALUES (?, ?, ?)').run(
    workId,
    status,
    editionId,
  );
}

/** The titles `browse-works` would hand out, under the clause exactly as it ships. */
function offered(db: DatabaseSync): string[] {
  const rows = db
    .prepare(`SELECT w.title AS title FROM work w WHERE ${BROWSE_HELD_PHYSICAL_CLAUSE} ORDER BY w.id`)
    .all(...HELD_STATUSES, ...PHYSICAL_FORMATS) as { title: string }[];
  return rows.map((r) => r.title);
}

describe('BROWSE_HELD_PHYSICAL_CLAUSE — what is actually on the shelf', () => {
  it('offers a held copy of a physical printing, and nothing that is not one', () => {
    const db = fixture();

    // 1. The ordinary case: a paperback, owned.
    addWork(db, 1, 'Owned paperback');
    addCopy(db, 1, 'owned', addEdition(db, 1, 'paperback'));

    // 2. ⚠️ THE ROW THIS TEST EXISTS FOR: a held copy with NO edition link.
    //    177 of 390 copies were in this state when the verb shipped — what a
    //    spine photo leaves behind before anybody types the printing in. A
    //    predicate that required a physical `edition` row would hide six books
    //    the household demonstrably has on a shelf.
    addWork(db, 2, 'Photographed, printing not typed in yet');
    addCopy(db, 2, 'owned', null);

    // 3. A lent book is still ours — HELD_STATUSES, not 'owned' alone. Pointing
    //    somebody at it is a fair suggestion; the site says who has it.
    addWork(db, 3, 'Lent hardcover');
    addCopy(db, 3, 'lent', addEdition(db, 3, 'hardcover'));

    // 4. Held only as a file. The errand this gate exists to prevent: nobody
    //    should be sent to a bookcase for an EPUB.
    addWork(db, 4, 'Kindle only');
    addCopy(db, 4, 'owned', addEdition(db, 4, 'ebook_epub'));

    // 5. Wanted, not had. A wishlist row is a decision about a book, not a book.
    addWork(db, 5, 'On the wishlist');
    addCopy(db, 5, 'wanted', addEdition(db, 5, 'hardcover'));

    // 6. Pre-ordered — paid for and not here. Same answer, different reason.
    addWork(db, 6, 'On its way');
    addCopy(db, 6, 'preordered', addEdition(db, 6, 'hardcover'));

    // 7. Sold, and borrowed: one has left, the other never arrived.
    addWork(db, 7, 'Sold on');
    addCopy(db, 7, 'sold', addEdition(db, 7, 'paperback'));
    addWork(db, 8, 'Borrowed from a friend');
    addCopy(db, 8, 'borrowed', addEdition(db, 8, 'paperback'));

    // 9. A printing recorded with no copy behind it. The catalog knows the book
    //    exists in hardcover; the house does not have one.
    addWork(db, 9, 'Printing known, copy not owned');
    addEdition(db, 9, 'hardcover');

    // 10. A bare work row.
    addWork(db, 10, 'Bare work row');

    assert.deepEqual(offered(db), [
      'Owned paperback',
      'Photographed, printing not typed in yet',
      'Lent hardcover',
    ]);
    db.close();
  });

  it('offers a book held BOTH ways — the shelf copy is what qualifies it', () => {
    const db = fixture();
    addWork(db, 1, 'Shelf and Kindle');
    addCopy(db, 1, 'owned', addEdition(db, 1, 'ebook_epub'));
    assert.deepEqual(offered(db), [], 'the file alone is not an object on a shelf');

    addCopy(db, 1, 'owned', addEdition(db, 1, 'hardcover'));
    assert.deepEqual(offered(db), ['Shelf and Kindle']);
    db.close();
  });

  it('⚠️ a physical EDITION on the work is not enough — the held copy must be the physical one', () => {
    // The case the coarser "has a physical edition anywhere" form gets wrong:
    // the house owns the file, and merely knows a hardcover exists. Both forms
    // returned 341 works live on 2026-08-19, so this difference is theoretical
    // TODAY and is the whole reason the strict form was chosen — it stays right
    // when the ebook importer starts linking its copies.
    const db = fixture();
    addWork(db, 1, 'Own the file, know of the hardcover');
    addEdition(db, 1, 'hardcover');
    addCopy(db, 1, 'owned', addEdition(db, 1, 'ebook_epub'));
    assert.deepEqual(offered(db), []);
    db.close();
  });

  it('counts every physical format, including mass market', () => {
    const db = fixture();
    for (const [i, format] of PHYSICAL_FORMATS.entries()) {
      addWork(db, i + 1, format);
      addCopy(db, i + 1, 'owned', addEdition(db, i + 1, format));
    }
    assert.deepEqual(offered(db), [...PHYSICAL_FORMATS]);
    db.close();
  });

  it('treats every non-physical format as a file, including the Kindle licence', () => {
    const db = fixture();
    for (const [i, format] of ['ebook_kindle', 'ebook_pdf', 'ebook_azw3'].entries()) {
      addWork(db, i + 1, `Only ${format}`);
      addCopy(db, i + 1, 'owned', addEdition(db, i + 1, format));
    }
    assert.deepEqual(offered(db), []);
    db.close();
  });

  it('⚠️ EBOOK_ONLY_CLAUSE cannot stand in for this — beside a held copy it is a no-op', () => {
    // Checked before the clause was written, and pinned here so nobody
    // "simplifies" this predicate into a reuse of that one. Its third conjunct
    // is `NOT EXISTS (copy)`, so once a held copy is required the whole
    // conjunction is false and `hide` degenerates to TRUE — a filter that reads
    // as protection and applies none.
    const db = fixture();
    addWork(db, 1, 'Kindle only, and owned');
    addCopy(db, 1, 'owned', addEdition(db, 1, 'ebook_epub'));

    const hide = EBOOK_ONLY_CLAUSE.hide;
    assert.ok(hide);
    const survives = db
      .prepare(`SELECT w.title AS title FROM work w WHERE ${hide}`)
      .all(...PHYSICAL_FORMATS, ...PHYSICAL_FORMATS) as { title: string }[];
    assert.deepEqual(
      survives.map((r) => r.title),
      ['Kindle only, and owned'],
      'EBOOK_ONLY_CLAUSE lets this through — which is why browse-works has its own clause',
    );
    assert.deepEqual(offered(db), [], 'and this clause does not');
    db.close();
  });

  it('binds its lists rather than inlining them', () => {
    // The vocabulary is not caller-supplied, but the habit is what keeps it
    // that way — `works.ts` makes the same promise one file over.
    assert.doesNotMatch(BROWSE_HELD_PHYSICAL_CLAUSE, /'owned'|'lent'|'hardcover'|'paperback'/);
    assert.equal(
      (BROWSE_HELD_PHYSICAL_CLAUSE.match(/\?/g) ?? []).length,
      HELD_STATUSES.length + PHYSICAL_FORMATS.length,
    );
  });
});
