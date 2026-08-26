/**
 * `resolveTbrEntries` — the THIRD rung, and the formats row, against real SQL.
 *
 * Owner, 2026-08-26: *"for the tbr list, it's double counting if something is
 * owned in multiple media sources. So if a book is audio, physical and ebook or
 * any combination we need to have it single count with a link to all formats."*
 *
 * The fold itself is pure and lives in `@lc/core` (`tbr-fold.test.ts` pins it).
 * What CANNOT be proved there is the half that only D1 can answer: an entry the
 * audiobook site wrote carries a slug of *its* spelling of the title, and the
 * only thing in this estate that can turn that back into a work is the bridge
 * cache the audiobook and ebook pipelines already fill. So the shipped SQL runs
 * here against an in-memory SQLite through the same tiny D1 shim
 * `audio-series-link.test.ts` uses — the real statements, the real UNION, the
 * real stale-row guard, exercised rather than reasoned about.
 *
 * The five properties that earn the file:
 *
 *   1. A key match and a bridge match land on the SAME `workWorkKey`, which is
 *      the whole reason the two documents fold into one card.
 *   2. ⚠️ The bridge NEVER overrides a match the first two rungs made — it is a
 *      third rung, so nothing that worked before can change.
 *   3. ⚠️ A STALE holding bridges nothing. A recording the sibling catalog has
 *      withdrawn must not merge two live entries.
 *   4. An entry nothing can place stays unmatched, with a null fold key — the
 *      refusal, which is the expensive one to get wrong in the other direction.
 *   5. The formats row is read off `copy` / `audiobook_holding` / `ebook_holding`
 *      and says `owned` / `wanted` / `none` by `HELD_STATUSES` and
 *      `WISHLIST_STATUSES`, never by a second spelling of them.
 */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { resolveTbrEntries } from '../src/tbr.ts';

/** The minimal async D1 surface `resolveTbrEntries` calls, over node:sqlite. */
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
 * Just enough of migrations 0001, 0010/0390 and 0310 for the shipped statements
 * to run. ⚠️ The `audiobook_holding` VIEW is copied from
 * `migrations/0390_audiobook_edition_holding.sql` — its `ROW_NUMBER()` window,
 * PARTITION and ORDER BY are the shipped ones, because "one best row per work"
 * is exactly what test 1 leans on.
 */
function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE work (
      id INTEGER PRIMARY KEY, work_key TEXT, title TEXT NOT NULL, authors TEXT,
      series TEXT, series_index_display TEXT, cover_url TEXT
    );
    CREATE TABLE user_book (user_id INTEGER, work_id INTEGER, read_state TEXT);
    CREATE TABLE copy (id INTEGER PRIMARY KEY, work_id INTEGER, status TEXT NOT NULL);
    CREATE TABLE audiobook_edition_holding (
      work_id INTEGER NOT NULL, audio_key TEXT NOT NULL, title TEXT NOT NULL,
      raw_title TEXT, authors TEXT, series TEXT, index_display TEXT,
      cover_href TEXT, stale_at TEXT, PRIMARY KEY (work_id, audio_key)
    );
    CREATE VIEW audiobook_holding AS
    SELECT work_id, title, authors, series, index_display, cover_href,
           stale_at, raw_title
      FROM (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY work_id
                 ORDER BY (series IS NULL), (index_display IS NULL), audio_key
               ) AS edition_rank
          FROM audiobook_edition_holding
      )
     WHERE edition_rank = 1;
    CREATE TABLE ebook_holding (
      work_id INTEGER PRIMARY KEY, title TEXT NOT NULL, authors TEXT, formats TEXT
    );

    -- The book at the centre of the report: held on paper AND on audio.
    INSERT INTO work (id, work_key, title, authors, cover_url)
      VALUES (12, 'firefight|brandon sanderson', 'Firefight', 'Brandon Sanderson',
              '/covers/firefight.jpg');
    INSERT INTO copy (id, work_id, status) VALUES (1, 12, 'owned');
    INSERT INTO audiobook_edition_holding (work_id, audio_key, title, raw_title)
      VALUES (12, 'k1', 'Firefight - The Reckoners, Book 2',
              'Firefight - The Reckoners, Book 2');

    -- A wishlist-only work, to prove 'wanted' is not 'owned'.
    INSERT INTO work (id, work_key, title, authors)
      VALUES (13, 'calamity|brandon sanderson', 'Calamity', 'Brandon Sanderson');
    INSERT INTO copy (id, work_id, status) VALUES (2, 13, 'wanted');

    -- An ebook the household holds, whose ebook-shelf spelling differs.
    INSERT INTO work (id, work_key, title, authors)
      VALUES (14, 'blackflame|will wight', 'Blackflame', 'Will Wight');
    INSERT INTO ebook_holding (work_id, title, formats)
      VALUES (14, 'Blackflame (Cradle Book 3)', 'epub');
  `);
  return db;
}

const paper = { docId: 'uid_firefight', bookId: 'firefight', workKey: 'firefight|brandon sanderson' };
/** What the audiobook site wrote: a slug of ITS title, and no key at all. */
const audio = {
  docId: 'uid_firefight-the-reckoners-book-2',
  bookId: 'firefight-the-reckoners-book-2',
  workKey: null,
};

describe('resolveTbrEntries — the bridge rung', () => {
  it('⚠️ the audiobook document reaches the SAME work as the paperback one', async () => {
    const db = fixture();
    const out = await resolveTbrEntries(shim(db), 1, [paper, audio]);

    assert.equal(out[0]?.workId, 12);
    assert.equal(out[0]?.matchedVia, 'work_key');
    assert.equal(out[1]?.workId, 12, 'bridged through audiobook_holding.title');
    assert.equal(out[1]?.matchedVia, 'audio_bridge');
    // ⚠️ THE LINE THAT FIXES THE DOUBLE COUNT: one fold key between them.
    assert.equal(out[0]?.workWorkKey, 'firefight|brandon sanderson');
    assert.equal(out[1]?.workWorkKey, out[0]?.workWorkKey);
  });

  it('the VERBATIM raw_title bridges too, not only the cleaned title', async () => {
    const db = fixture();
    db.exec(`
      UPDATE audiobook_edition_holding SET title = 'Firefight' WHERE work_id = 12;
    `);
    // `title` now matches the catalog's spelling, so the entry can only arrive
    // through `raw_title` — the column migration 0340 added and 0390 kept.
    const out = await resolveTbrEntries(shim(db), 1, [audio]);
    assert.equal(out[0]?.workId, 12);
    assert.equal(out[0]?.matchedVia, 'audio_bridge');
  });

  it('the EBOOK shelf bridges by its own spelling', async () => {
    const db = fixture();
    const out = await resolveTbrEntries(shim(db), 1, [
      { docId: 'uid_bf', bookId: 'blackflame-cradle-book-3', workKey: null },
    ]);
    assert.equal(out[0]?.workId, 14);
    assert.equal(out[0]?.matchedVia, 'ebook_bridge');
    assert.equal(out[0]?.workWorkKey, 'blackflame|will wight');
  });

  it('⚠️ a STALE holding bridges NOTHING — a withdrawn recording is not a claim', async () => {
    const db = fixture();
    db.exec(`UPDATE audiobook_edition_holding SET stale_at = '2026-08-01' WHERE work_id = 12;`);
    const out = await resolveTbrEntries(shim(db), 1, [audio]);
    assert.equal(out[0]?.workId, null);
    assert.equal(out[0]?.matchedVia, null);
    assert.equal(out[0]?.workWorkKey, null);
  });

  it('⚠️ an entry nothing can place stays UNMATCHED rather than being guessed at', async () => {
    const db = fixture();
    const out = await resolveTbrEntries(shim(db), 1, [
      { docId: 'uid_court', bookId: 'the-court-of-the-dead', workKey: null },
    ]);
    assert.equal(out[0]?.workId, null);
    assert.equal(out[0]?.formats, null);
  });

  it('⚠️ the bridge is a THIRD rung — it cannot change an existing match', async () => {
    const db = fixture();
    // Point the audiobook cache at the WRONG work. The paperback entry matches
    // on its key, rung 1, and must be untouched by anything the cache says.
    db.exec(`
      INSERT INTO audiobook_edition_holding (work_id, audio_key, title)
        VALUES (13, 'k9', 'Firefight');
    `);
    const out = await resolveTbrEntries(shim(db), 1, [paper]);
    assert.equal(out[0]?.workId, 12);
    assert.equal(out[0]?.matchedVia, 'work_key');
  });

  it('the read state still comes back per entry, for THIS person only', async () => {
    const db = fixture();
    db.exec(`
      INSERT INTO user_book (user_id, work_id, read_state) VALUES (1, 12, 'read');
      INSERT INTO user_book (user_id, work_id, read_state) VALUES (2, 13, 'read');
    `);
    const out = await resolveTbrEntries(shim(db), 1, [paper, audio]);
    // ⚠️ Both documents carry it, which is what lets the fold spend the whole
    // intention no matter which format was finished.
    assert.equal(out[0]?.readState, 'read');
    assert.equal(out[1]?.readState, 'read');

    const other = await resolveTbrEntries(shim(db), 1, [
      { docId: 'uid_cal', bookId: 'calamity', workKey: 'calamity|brandon sanderson' },
    ]);
    assert.equal(other[0]?.readState, null, "somebody else's read state is not mine");
  });
});

describe('resolveTbrEntries — the formats row', () => {
  it('an owned copy and a live recording are BOTH reported', async () => {
    const db = fixture();
    const out = await resolveTbrEntries(shim(db), 1, [paper]);
    assert.deepEqual(out[0]?.formats, {
      physical: { workId: 12, state: 'owned' },
      // ⚠️ The SIBLING catalog's spelling, because its only per-book link is a
      // title search-hash and this catalog's spelling finds it far less often.
      audio: { title: 'Firefight - The Reckoners, Book 2' },
      ebook: null,
    });
  });

  it("a wishlist copy reads 'wanted', never 'owned'", async () => {
    const db = fixture();
    const out = await resolveTbrEntries(shim(db), 1, [
      { docId: 'uid_cal', bookId: 'calamity', workKey: 'calamity|brandon sanderson' },
    ]);
    assert.deepEqual(out[0]?.formats?.physical, { workId: 13, state: 'wanted' });
    assert.equal(out[0]?.formats?.audio, null);
  });

  it("⚠️ a work with no copy at all reads 'none' — a real answer, not a gap", async () => {
    const db = fixture();
    const out = await resolveTbrEntries(shim(db), 1, [
      { docId: 'uid_bf', bookId: 'blackflame', workKey: 'blackflame|will wight' },
    ]);
    assert.deepEqual(out[0]?.formats, {
      physical: { workId: 14, state: 'none' },
      audio: null,
      ebook: { title: 'Blackflame (Cradle Book 3)' },
    });
  });

  it("⚠️ 'lent' is owned; 'sold' and 'borrowed' are neither", async () => {
    const db = fixture();
    // The book is ours, it is just in someone else's hands — HELD_STATUSES.
    db.exec(`UPDATE copy SET status = 'lent' WHERE work_id = 12;`);
    let out = await resolveTbrEntries(shim(db), 1, [paper]);
    assert.equal(out[0]?.formats?.physical?.state, 'owned');

    db.exec(`UPDATE copy SET status = 'sold' WHERE work_id = 12;`);
    out = await resolveTbrEntries(shim(db), 1, [paper]);
    assert.equal(out[0]?.formats?.physical?.state, 'none');

    db.exec(`UPDATE copy SET status = 'borrowed' WHERE work_id = 12;`);
    out = await resolveTbrEntries(shim(db), 1, [paper]);
    assert.equal(out[0]?.formats?.physical?.state, 'none');
  });

  it('⚠️ an owned copy beats a wanted one on the same work', async () => {
    const db = fixture();
    db.exec(`INSERT INTO copy (id, work_id, status) VALUES (3, 12, 'wanted');`);
    const out = await resolveTbrEntries(shim(db), 1, [paper]);
    // Otherwise the row order of `copy` would decide whether the owner is told
    // he owns his own paperback.
    assert.equal(out[0]?.formats?.physical?.state, 'owned');
  });

  it('a STALE recording is not offered as a format link either', async () => {
    const db = fixture();
    db.exec(`UPDATE audiobook_edition_holding SET stale_at = '2026-08-01' WHERE work_id = 12;`);
    const out = await resolveTbrEntries(shim(db), 1, [paper]);
    assert.equal(out[0]?.formats?.audio, null);
    assert.equal(out[0]?.formats?.physical?.state, 'owned');
  });

  it('an empty list asks the database nothing', async () => {
    assert.deepEqual(await resolveTbrEntries(shim(fixture()), 1, []), []);
  });
});
