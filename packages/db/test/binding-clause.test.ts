/**
 * `BINDING_CLAUSE` — the multi-type format selector (owner ask, 2026-08-24).
 *
 * ## Why this runs real SQL, like `ebook-only-clause.test.ts` beside it
 *
 * The clause decides which of the owner's books a chosen type shows, and it is
 * made in SQL — one predicate reaching across `edition`, the `copy.leatherbound`
 * flag (migration 0430) and the cached `audiobook_holding`. A TypeScript
 * restatement would agree with itself and prove nothing about the text that
 * ships. The clauses are imported, so what runs here is byte-for-byte what runs.
 *
 * ## The two rows that make it subtle
 *
 * 1. ⚠️ **Leather ⊂ hardcover, AND leather its own type.** A leatherbound copy
 *    with no hardcover edition row must still answer `hardcover` (a leatherbound
 *    copy IS a hardcover) while also being the only thing `leatherbound` returns.
 * 2. ⚠️ **A stale audiobook holding is not "have it on audio".** Readers filter
 *    on `stale_at IS NULL`, and this clause must too.
 *
 * ⚠️ SQLite, not D1 — so this pins the PREDICATE, not the binding order or the
 * rest of `collectionFilter`. The multi-select OR is exercised the way the
 * worker builds it: `(clauseA OR clauseB)`.
 */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { EDITION_KINDS } from '@lc/core';
import { BINDING_CLAUSE, KIND_CLAUSE } from '../src/works.ts';

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE work (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE edition (
      id INTEGER PRIMARY KEY,
      work_id INTEGER NOT NULL REFERENCES work(id),
      format TEXT NOT NULL DEFAULT 'paperback'
    );
    CREATE TABLE copy (
      id INTEGER PRIMARY KEY,
      work_id INTEGER NOT NULL REFERENCES work(id),
      leatherbound INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE audiobook_holding (
      work_id INTEGER PRIMARY KEY REFERENCES work(id),
      title TEXT NOT NULL,
      stale_at TEXT
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
function addCopy(db: DatabaseSync, workId: number, leatherbound = 0): void {
  db.prepare('INSERT INTO copy (work_id, leatherbound) VALUES (?, ?)').run(workId, leatherbound);
}
function addAudio(db: DatabaseSync, workId: number, staleAt: string | null): void {
  db.prepare('INSERT INTO audiobook_holding (work_id, title, stale_at) VALUES (?, ?, ?)').run(
    workId,
    'X',
    staleAt,
  );
}

/** The titles a chosen set of types would show — the worker's OR of their clauses. */
function visible(db: DatabaseSync, types: string[]): string[] {
  const chosen = types.map((t) => BINDING_CLAUSE[t]).filter((c): c is string => Boolean(c));
  const where = chosen.length > 0 ? `(${chosen.join(' OR ')})` : '1 = 1';
  return db
    .prepare(`SELECT w.title AS title FROM work w WHERE ${where} ORDER BY w.id`)
    .all()
    .map((r) => String((r as { title: string }).title));
}

describe('BINDING_CLAUSE — the multi-type format selector', () => {
  it('hardcover matches a hardcover EDITION', () => {
    const db = fixture();
    addWork(db, 1, 'HC');
    addEdition(db, 1, 'hardcover');
    assert.deepEqual(visible(db, ['hardcover']), ['HC']);
  });

  it('⚠️ hardcover ALSO matches a leatherbound COPY with no hardcover edition — leather ⊂ hardcover', () => {
    const db = fixture();
    addWork(db, 1, 'Leather only');
    addEdition(db, 1, 'paperback'); // a paperback edition on file
    addCopy(db, 1, 1); // but the copy in hand is leatherbound
    assert.deepEqual(
      visible(db, ['hardcover']),
      ['Leather only'],
      'a leatherbound copy IS a hardcover, even with no hardcover edition row',
    );
  });

  it('leatherbound is the SUBSET — only the leatherbound copies, not every hardcover', () => {
    const db = fixture();
    addWork(db, 1, 'Plain HC');
    addEdition(db, 1, 'hardcover');
    addWork(db, 2, 'Leather');
    addCopy(db, 2, 1);
    assert.deepEqual(visible(db, ['leatherbound']), ['Leather']);
    // And hardcover returns BOTH — the superset.
    assert.deepEqual(visible(db, ['hardcover']), ['Plain HC', 'Leather']);
  });

  it('paperback and mass_market match their exact edition format', () => {
    const db = fixture();
    addWork(db, 1, 'PB');
    addEdition(db, 1, 'paperback');
    addWork(db, 2, 'MM');
    addEdition(db, 2, 'mass_market');
    assert.deepEqual(visible(db, ['paperback']), ['PB']);
    assert.deepEqual(visible(db, ['mass_market']), ['MM']);
  });

  it('ebook matches any non-physical edition, not a physical one', () => {
    const db = fixture();
    addWork(db, 1, 'Epub');
    addEdition(db, 1, 'ebook_epub');
    addWork(db, 2, 'Kindle');
    addEdition(db, 2, 'ebook_kindle');
    addWork(db, 3, 'Paper');
    addEdition(db, 3, 'paperback');
    assert.deepEqual(visible(db, ['ebook']), ['Epub', 'Kindle']);
  });

  it('⚠️ audiobook matches a LIVE holding, never a stale one', () => {
    const db = fixture();
    addWork(db, 1, 'Live');
    addAudio(db, 1, null);
    addWork(db, 2, 'Returned');
    addAudio(db, 2, '2026-08-01T00:00:00Z');
    assert.deepEqual(visible(db, ['audiobook']), ['Live']);
  });

  it('several types OR together — a book of ANY chosen type shows', () => {
    const db = fixture();
    addWork(db, 1, 'HC');
    addEdition(db, 1, 'hardcover');
    addWork(db, 2, 'Epub');
    addEdition(db, 2, 'ebook_epub');
    addWork(db, 3, 'PB');
    addEdition(db, 3, 'paperback');
    assert.deepEqual(visible(db, ['hardcover', 'ebook']), ['HC', 'Epub']);
  });

  it('EXISTS, not "only" — a book on the shelf AND on the Kindle is under both', () => {
    const db = fixture();
    addWork(db, 1, 'Both');
    addEdition(db, 1, 'hardcover');
    addEdition(db, 1, 'ebook_epub');
    assert.deepEqual(visible(db, ['hardcover']), ['Both']);
    assert.deepEqual(visible(db, ['ebook']), ['Both']);
  });

  it('⚠️ an unknown type adds no clause — a stale bookmark shows the collection', () => {
    const db = fixture();
    addWork(db, 1, 'A');
    addWork(db, 2, 'B');
    assert.equal(BINDING_CLAUSE['board_book'], undefined);
    // Unknown alone → no clause → everything; unknown beside a real one → just the real one's rows.
    assert.deepEqual(visible(db, ['board_book']), ['A', 'B']);
    addEdition(db, 1, 'hardcover');
    assert.deepEqual(visible(db, ['board_book', 'hardcover']), ['A']);
  });
});

// ---------------------------------------------------------------------------
// ⚠️ F15 — a checkbox that matches nothing looks exactly like one that works
// ---------------------------------------------------------------------------
//
// The Type control's options are built from
// `EDITION_KIND_FILTERS = [...EDITION_KINDS, 'unsorted']`, so it AUTO-EXPANDS
// the day a kind is added — and `EDITION_KINDS`' own doc in `@lc/core` invites
// exactly that: *"the set is expected to grow; `omnibus` is the obvious
// candidate"*, and *"an unrecognised value simply fails to match any filter"*.
//
// `KIND_CLAUSE` does NOT auto-expand. The old "Printing" `<select>` hard-coded
// its two options, so adding a kind changed nothing on screen; the new dropdown
// adds a box automatically. Tick a box whose clause is missing and the result is
// IDENTICAL to leaving it unticked — no error, no empty list, nothing to notice.
//
// Today `EDITION_KINDS === ['collectors']` and this is clean. It goes live on
// the one-line change its own doc invites, which is why the tripwire is here
// rather than a note.

describe('every filterable printing kind has a clause (F15)', () => {
  it('⚠️ KIND_CLAUSE covers EDITION_KINDS plus `unsorted`, exactly', () => {
    const expected = [...EDITION_KINDS, 'unsorted'].sort();
    assert.deepEqual(
      Object.keys(KIND_CLAUSE).sort(),
      expected,
      'the Type control renders a box per EDITION_KIND_FILTERS; a kind with no ' +
        'clause here renders a control that silently matches nothing',
    );
  });

  it('and `unsorted` is in it — it is a filter, not a stored value', () => {
    // The one member that is NOT an `edition_kind` value: it asks for named
    // printings nothing has classified, which is where a missed special edition
    // hides.
    assert.ok(KIND_CLAUSE['unsorted']);
    assert.ok(!(EDITION_KINDS as readonly string[]).includes('unsorted'));
  });
});
