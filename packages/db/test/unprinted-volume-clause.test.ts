/**
 * `UNPRINTED_VOLUME_SQL` — the free rung's whole selection policy.
 *
 * ## What it is for
 *
 * A work that files at volume 3 and prints nothing owes research **nothing**:
 * the number is in `series_index_sort`, and the printed form is a derivation of
 * it. The rung that closes those rows costs no lookup and no money, so the only
 * thing that can go wrong is picking the WRONG rows — which is what this pins.
 *
 * ⚠️ It exists because the state is not hypothetical and not self-healing. The
 * friend instance's `:07` tick on 2026-08-19 paid for two books, succeeded on
 * both (*"Filled in 1 of 1: Volume number set to 1"*), wrote only the sort, and
 * recorded `seriesIndex` as **asked** — so `planSweep` would never have offered
 * either book again. A run that worked stranded the book it worked on.
 *
 * ## Why real SQL rather than a restatement
 *
 * Same reason as `ebook-only-clause.test.ts`: this decision is made in SQL, and
 * a TypeScript re-implementation of the same four conjuncts would agree with
 * itself and prove nothing about the text that ships. The constant is imported,
 * so what runs here is byte-for-byte what runs in production.
 *
 * ⚠️ SQLite, not D1 — so this pins the predicate, not the binding.
 */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { UNPRINTED_VOLUME_SQL } from '../src/research.ts';

/** Just enough of migrations 0001 and 0007 for the two tables the clause reads. */
function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE work (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      series TEXT,
      series_index_sort REAL,
      series_index_display TEXT
    );
    CREATE TABLE gap_verdict (
      id INTEGER PRIMARY KEY,
      work_id INTEGER NOT NULL,
      field TEXT NOT NULL,
      verdict TEXT NOT NULL
    );
  `);
  return db;
}

function add(
  db: DatabaseSync,
  id: number,
  title: string,
  series: string | null,
  sort: number | null,
  display: string | null,
): void {
  db.prepare('INSERT INTO work VALUES (?, ?, ?, ?, ?)').run(id, title, series, sort, display);
}

function picked(db: DatabaseSync, limit = 10): number[] {
  return (db.prepare(UNPRINTED_VOLUME_SQL).all(limit) as { id: number }[]).map((r) => r.id);
}

describe('UNPRINTED_VOLUME_SQL', () => {
  it('picks exactly the rows that sort and do not print', () => {
    const db = fixture();
    add(db, 7, 'Bitten (Deluxe Limited Edition)', 'Bitten', 1, null);
    add(db, 46, 'Adapt', 'A Touch of Power', 2, null);
    assert.deepEqual(picked(db), [7, 46]);
  });

  it('treats a display of nothing but spaces as blank', () => {
    // The whole codebase's `isBlankDetail` reading, and the reason `trim` is in
    // the clause: a row holding "   " prints nothing, so it is not filled.
    const db = fixture();
    add(db, 1, 'Padded', 'Line', 3, '   ');
    assert.deepEqual(picked(db), [1]);
  });

  it('leaves alone anything that already prints', () => {
    const db = fixture();
    add(db, 1, 'Numbered', 'Line', 3, 'Book 3');
    add(db, 2, 'Hand-quoted', 'Line', 7, 'Volume 07');
    assert.deepEqual(picked(db), []);
  });

  it('leaves alone a work with no volume number to print', () => {
    // ⚠️ The rung DERIVES; it does not invent. With no sort there is nothing to
    // derive from, and this row is a real research question rather than a
    // formatting one.
    const db = fixture();
    add(db, 1, 'Unnumbered', 'Line', null, null);
    assert.deepEqual(picked(db), []);
  });

  it('refuses a volume number belonging to no series', () => {
    // ⚠️ Matches `detailFieldsFor`, which will not ask "which volume is this?"
    // of a book with no series. Printing "Book 3" on a standalone would state a
    // position in a line the catalog does not believe in.
    const db = fixture();
    add(db, 1, 'Orphan sort', null, 3, null);
    add(db, 2, 'Blank series', '   ', 3, null);
    assert.deepEqual(picked(db), []);
  });

  it('respects a recorded verdict, like everything else in this queue', () => {
    const db = fixture();
    add(db, 1, 'Answered', 'Line', 3, null);
    add(db, 2, 'Unanswered', 'Line', 4, null);
    db.prepare('INSERT INTO gap_verdict VALUES (1, 1, ?, ?)').run('seriesIndex', 'none');
    // A verdict on a DIFFERENT field must not shield the row.
    db.prepare('INSERT INTO gap_verdict VALUES (2, 2, ?, ?)').run('description', 'unknown');
    assert.deepEqual(picked(db), [2]);
  });

  it('honours the limit and orders by id, so a tick cannot run away', () => {
    // The limit is the subrequest ceiling in disguise — see PRINTED_FORM_LIMIT.
    // Stable ordering means the same four come back until they are fixed, and
    // then the next four, rather than a random walk that never finishes.
    const db = fixture();
    for (const id of [5, 1, 9, 3, 7]) add(db, id, `Book ${id}`, 'Line', id, null);
    assert.deepEqual(picked(db, 3), [1, 3, 5]);
  });

  it('keeps a half-volume as a half-volume', () => {
    // `series_index_sort` is REAL on purpose so a novella can file at 2.5. The
    // clause must not quietly filter or round it.
    const db = fixture();
    add(db, 1, 'Novella', 'Line', 2.5, null);
    const rows = db.prepare(UNPRINTED_VOLUME_SQL).all(10) as { sort: number }[];
    assert.equal(rows[0]?.sort, 2.5);
  });
});
