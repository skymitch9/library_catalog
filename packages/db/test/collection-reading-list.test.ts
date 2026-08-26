/**
 * `CollectionQuery.readingListIds` — the reading-list narrowing, against real SQL.
 *
 * Owner, 2026-08-26: *"can we also add a filter in each of the search bars for
 * tbr and other read states"*.
 *
 * ## Why this runs the shipped statements rather than reasoning about them
 *
 * The narrowing is made in SQL, by a clause built with **string concatenation**
 * (`workIdsClause`, inlined because D1 caps a statement at 100 bound parameters
 * and a reading list can carry three hundred ids). Two things about that are
 * only provable by running it:
 *
 *   1. ⚠️ **The empty case.** `w.id IN ()` is not valid SQLite, so an empty list
 *      has to become `0 = 1` — and getting it backwards answers an empty TBR
 *      with the WHOLE COLLECTION, which reads as the control being ignored
 *      rather than as a filter that found nothing. That is the expensive
 *      direction, and no type can catch it.
 *   2. ⚠️ **`undefined` ≠ `[]`.** "Nobody asked" and "asked, nothing matched"
 *      must stay distinguishable end to end, exactly as `universeIds` requires.
 *
 * And two more that are about composition rather than the clause:
 *
 *   3. It ANDs with every other filter — it narrows, it never widens, so a
 *      reading list plus a series is the intersection.
 *   4. ⚠️ **The facet counts honour it.** This is F3 (2026-08-25) in a new
 *      place: "Cradle (6)" over a 40-book to-read list would be six books that
 *      are almost certainly not on it, and picking that facet gives an empty
 *      grid under a number that promised six. It narrows harder than any other
 *      filter on the page, so it is the worst one to leave out.
 *
 * Real SQLite through the same tiny D1 shim `tbr-media-fold.test.ts` uses, so
 * what runs here is the text that ships.
 */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { collectionFacets, listCollection } from '../src/works.ts';

/** The minimal async D1 surface `listCollection`/`collectionFacets` call. */
function shim(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a;
          return stmt;
        },
        async first<T>() {
          return (sqlite.prepare(sql).get(...(args as never[])) as T) ?? null;
        },
        async all<T>() {
          return { results: sqlite.prepare(sql).all(...(args as never[])) as T[] };
        },
      };
      return stmt;
    },
  } as never;
}

/**
 * Just enough of migration 0001 (plus the tables `collectionFilter` and the
 * facets touch) for the shipped statements to run.
 */
function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE work (
      id INTEGER PRIMARY KEY, work_key TEXT, title TEXT NOT NULL, subtitle TEXT,
      sort_title TEXT, authors TEXT, primary_author TEXT, series TEXT,
      series_index_sort REAL, series_index_display TEXT, first_published INTEGER,
      openlibrary_work_id TEXT, description TEXT, cover_url TEXT,
      cover_status TEXT, illustrator TEXT, multi_volume_printing INTEGER DEFAULT 0,
      universe TEXT, universe_how TEXT,
      created_at TEXT DEFAULT '2026-01-01', updated_at TEXT DEFAULT '2026-01-01'
    );
    CREATE TABLE edition (
      id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, format TEXT NOT NULL,
      edition_name TEXT, edition_kind TEXT, isbn13 TEXT, source TEXT
    );
    CREATE TABLE copy (
      id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, edition_id INTEGER,
      status TEXT NOT NULL DEFAULT 'owned', leatherbound INTEGER DEFAULT 0
    );
    CREATE TABLE user_book (user_id INTEGER, work_id INTEGER, read_state TEXT);
    CREATE TABLE work_watch (
      id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, note TEXT, resolved_at TEXT
    );
  `);

  // Four books. 1 and 2 share a series so the series facet has something to
  // count; 3 and 4 stand alone.
  const rows: [number, string, string | null][] = [
    [1, 'Firefight', 'The Reckoners'],
    [2, 'Steelheart', 'The Reckoners'],
    [3, 'Warbreaker', null],
    [4, 'Elantris', null],
  ];
  for (const [id, title, series] of rows) {
    db.prepare(
      `INSERT INTO work (id, title, sort_title, authors, primary_author, series, work_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, title, title, 'Brandon Sanderson', 'brandon sanderson', series, `${title.toLowerCase()}|brandon sanderson`);
    db.prepare(`INSERT INTO edition (work_id, format) VALUES (?, 'hardcover')`).run(id);
    db.prepare(`INSERT INTO copy (work_id, status) VALUES (?, 'owned')`).run(id);
  }
  return db;
}

const BASE = { limit: 50, offset: 0 } as const;

describe('the reading-list narrowing, in SQL', () => {
  it('undefined is "nobody asked" — the whole collection', async () => {
    const db = fixture();
    const { rows, total } = await listCollection(shim(db), { ...BASE });
    assert.equal(total, 4);
    assert.equal(rows.length, 4);
  });

  it('a list of ids narrows to exactly those works', async () => {
    const db = fixture();
    const { rows, total } = await listCollection(shim(db), {
      ...BASE,
      readingListIds: [2, 4],
    });
    assert.equal(total, 2);
    assert.deepEqual(rows.map((r) => r.id).sort(), [2, 4]);
  });

  it('⚠️ AN EMPTY LIST RETURNS NOTHING, never the whole collection', async () => {
    // The expensive direction. `w.id IN ()` is invalid SQLite, so the empty
    // case is `0 = 1`; a clause that fell back to "no clause" would answer an
    // empty TBR with all four books and read as the filter being ignored.
    const db = fixture();
    const { rows, total } = await listCollection(shim(db), {
      ...BASE,
      readingListIds: [],
    });
    assert.equal(total, 0);
    assert.equal(rows.length, 0);
  });

  it('⚠️ [] and undefined are NOT the same query', async () => {
    const db = fixture();
    const asked = await listCollection(shim(db), { ...BASE, readingListIds: [] });
    const notAsked = await listCollection(shim(db), { ...BASE });
    assert.notEqual(asked.total, notAsked.total);
  });

  it('an id this catalogue does not hold simply matches nothing', async () => {
    const db = fixture();
    const { total } = await listCollection(shim(db), { ...BASE, readingListIds: [999] });
    assert.equal(total, 0);
  });

  it('it ANDs with the other filters — it narrows, it never widens', async () => {
    const db = fixture();
    // Three books on the list, but only two are in The Reckoners.
    const { rows } = await listCollection(shim(db), {
      ...BASE,
      readingListIds: [1, 2, 3],
      series: 'The Reckoners',
    });
    assert.deepEqual(rows.map((r) => r.id).sort(), [1, 2]);
  });

  it('it composes with the free-text search, both ways round', async () => {
    const db = fixture();
    const both = await listCollection(shim(db), {
      ...BASE,
      readingListIds: [1, 2],
      q: 'steelheart',
    });
    assert.deepEqual(both.rows.map((r) => r.id), [2]);
    // The same search, over a list that does not hold it.
    const neither = await listCollection(shim(db), {
      ...BASE,
      readingListIds: [3, 4],
      q: 'steelheart',
    });
    assert.equal(neither.total, 0);
  });

  it('⚠️ THE FACET COUNTS HONOUR IT — F3, in a new place', async () => {
    const db = fixture();
    // Only Firefight is on the list, so the series facet must read
    // "The Reckoners (1)" and not (2). A count taken over the whole collection
    // is a number the grid beneath it breaks.
    const facets = await collectionFacets(shim(db), { ...BASE, readingListIds: [1] });
    const reckoners = facets.series.find((f) => f.name === 'The Reckoners');
    assert.equal(reckoners?.count, 1);
  });

  it('⚠️ the facets go to zero for an empty list, like the grid', async () => {
    const db = fixture();
    const facets = await collectionFacets(shim(db), { ...BASE, readingListIds: [] });
    assert.deepEqual(facets.series, []);
    // `media` always renders both entries, zeroes included — that rule is
    // unchanged and is what stops the control appearing and disappearing.
    for (const m of facets.media) assert.equal(m.count, 0);
  });

  it('a list of 150 ids is one statement, not a bind-parameter failure', async () => {
    // ⚠️ The reason the clause is inlined rather than bound: D1 caps a statement
    // at 100 bound parameters and a real to-read list is bigger than that
    // (measured 2026-08-26 — 359 entries on one account). A bound version would
    // pass every test written with four books and fail the day it shipped.
    const db = fixture();
    const ids = Array.from({ length: 150 }, (_, i) => i + 1);
    const { total } = await listCollection(shim(db), { ...BASE, readingListIds: ids });
    assert.equal(total, 4);
  });
});
