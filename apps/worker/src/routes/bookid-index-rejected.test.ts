/**
 * `/api/reviews/bookid-index` — the review bridge, and the `rejected` filter it
 * gained on **2026-09-07** (migration 0450).
 *
 * ## What this route is, and why the filter is not cosmetic
 *
 * It answers `bookId → work_key`: the audiobook site slugs a recording's title
 * into a document id, and this index is the only thing in the estate that can
 * turn that slug back into a book on these shelves. The browser sweep then
 * posts the review's rating to `/observed`, and `applyObservedRatings` writes a
 * `read_state` and a `rating_cached` against the work it names.
 *
 * 🔴 **So an un-filtered rejected recording writes a read state onto the wrong
 * book** — which is exactly what a rejection exists to stop, arriving through a
 * side door rather than through the shelf.
 *
 * ## What was MEASURED before it shipped (2026-09-06, both production D1s)
 *
 * | | `library-catalog` | `library-catalog-2nd` |
 * |---|---|---|
 * | `audiobook_match_review` rows, any verdict | **0** | **0** |
 * | live `containment` holdings this clause governs | **8** | **0** |
 *
 * So it filtered **nothing** on the day it shipped, on either instance. It was
 * held back for a year of sessions on the grounds that it *"would silently move
 * existing reviews / TBR entries and nobody had measured what that touches"* —
 * and the measurement is that it touches nothing until somebody presses *"Not
 * this one"*. The 8 it governs are works 249 and 334/347/445/446/447/448/449,
 * every one of which carries a rating that could only have arrived through this
 * index (their `work_key`s do not match the recordings' titles — measured).
 *
 * ## Why the SQL and not the route
 *
 * `BOOKID_INDEX_SELECT` is exported so this file runs the SHIPPED string
 * against real SQLite rather than a retyped copy of it — the pattern
 * `tbr-media-fold.test.ts` and `binding-clause.test.ts` already use. Mounting
 * Hono, faking a Firebase bearer and stubbing `requireCapability` would test
 * middleware wiring (`capability-wiring.test.ts`'s job) and not this predicate.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { bookIdFromTitle } from '@lc/core';

import { BOOKID_INDEX_SELECT } from './reviews.js';

/**
 * Just enough of migrations 0001, 0390 and 0450 for the shipped statement to
 * run. ⚠️ The `audiobook_holding` VIEW is 0390's own — its window, PARTITION
 * and ORDER BY — because "one best row per work" is what decides which
 * recording's key the verdict has to match.
 */
function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE work (
      id INTEGER PRIMARY KEY, work_key TEXT, title TEXT NOT NULL, authors TEXT
    );
    CREATE TABLE audiobook_edition_holding (
      work_id INTEGER NOT NULL, audio_key TEXT NOT NULL, title TEXT NOT NULL,
      raw_title TEXT, authors TEXT, series TEXT, index_display TEXT,
      cover_href TEXT, matched_via TEXT, title_similarity REAL, stale_at TEXT,
      PRIMARY KEY (work_id, audio_key)
    );
    CREATE VIEW audiobook_holding AS
    SELECT work_id, title, authors, series, index_display, cover_href,
           matched_via, title_similarity, stale_at, raw_title
      FROM (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY work_id
                 ORDER BY (series IS NULL), (index_display IS NULL), audio_key
               ) AS edition_rank
          FROM audiobook_edition_holding
      )
     WHERE edition_rank = 1;
    CREATE TABLE audiobook_match_review (
      work_id INTEGER NOT NULL, audio_key TEXT NOT NULL, verdict TEXT NOT NULL,
      decided_at TEXT, decided_by INTEGER, PRIMARY KEY (work_id, audio_key)
    );

    -- The real shape from the main instance: a work whose recording is matched
    -- by CONTAINMENT and whose work_key does NOT match the recording's title,
    -- so this index is the only path from that review to this book.
    INSERT INTO work (id, work_key, title, authors)
      VALUES (334, 'harry potter and the goblet of fire|j k rowling',
              'Harry Potter and the Goblet of Fire', 'J.K. Rowling');
    INSERT INTO audiobook_edition_holding
      (work_id, audio_key, title, raw_title, matched_via, title_similarity)
      VALUES (334, 'Harry Potter and the Goblet of Fire (Full-Cast Edition)',
              'Harry Potter and the Goblet of Fire',
              'Harry Potter and the Goblet of Fire (Full-Cast Edition)',
              'containment', 0.81);

    -- A second, unrelated book, so "the filter emptied the index" cannot pass
    -- as "the filter worked".
    INSERT INTO work (id, work_key, title, authors)
      VALUES (249, 'space knight book 1|michael-scott earle', 'Space Knight Book 1',
              'Michael-Scott Earle');
    INSERT INTO audiobook_edition_holding
      (work_id, audio_key, title, raw_title, matched_via, title_similarity)
      VALUES (249, 'Space Knight', 'Space Knight', 'Space Knight', 'containment', 0.80);
  `);
  return db;
}

/** The route's own loop, verbatim in shape: first slug wins. */
function indexFrom(db: DatabaseSync): Record<string, string> {
  const rows = db.prepare(BOOKID_INDEX_SELECT).all() as unknown as {
    work_key: string;
    raw_title: string | null;
    title: string;
  }[];
  const index: Record<string, string> = {};
  for (const row of rows) {
    const bookId = bookIdFromTitle(row.raw_title ?? row.title);
    if (bookId && !index[bookId]) index[bookId] = row.work_key;
  }
  return index;
}

const GOBLET = bookIdFromTitle('Harry Potter and the Goblet of Fire (Full-Cast Edition)');
const KNIGHT = bookIdFromTitle('Space Knight');

describe('/bookid-index — the shipped statement against real SQL', () => {
  /*
   * ⚠️ The control, and it is the load-bearing one. `NOT EXISTS` means an
   * absent row PASSES, and absence is what every recording in both catalogs
   * carries today. If this ever goes red the predicate has inverted and the
   * whole household's audiobook reviews stop reaching their books — silently,
   * because an empty index looks exactly like a sweep with nothing to do.
   */
  it('an UN-REVIEWED recording is in the index, as it always was', () => {
    const index = indexFrom(fixture());
    assert.equal(index[GOBLET], 'harry potter and the goblet of fire|j k rowling');
    assert.equal(index[KNIGHT], 'space knight book 1|michael-scott earle');
  });

  it('⚠️ a REJECTED recording is NOT in the index — migration 0450', () => {
    const db = fixture();
    db.exec(`
      INSERT INTO audiobook_match_review (work_id, audio_key, verdict)
        VALUES (334, 'Harry Potter and the Goblet of Fire (Full-Cast Edition)', 'rejected');
    `);
    const index = indexFrom(db);
    assert.equal(index[GOBLET], undefined, 'a review of it must no longer mark this book read');
    assert.equal(index[KNIGHT], 'space knight book 1|michael-scott earle', 'and only it is gone');
  });

  /*
   * A confirmed verdict changes WORDS only (§4.9.2). Filtering on "has a
   * verdict" instead of "has a REJECTED verdict" would delete the index the
   * first time the owner pressed the button he is being asked to press.
   */
  it('a CONFIRMED recording stays in the index', () => {
    const db = fixture();
    db.exec(`
      INSERT INTO audiobook_match_review (work_id, audio_key, verdict)
        VALUES (334, 'Harry Potter and the Goblet of Fire (Full-Cast Edition)', 'confirmed');
    `);
    assert.equal(indexFrom(db)[GOBLET], 'harry potter and the goblet of fire|j k rowling');
  });

  /*
   * ⚠️ The key is `COALESCE(raw_title, title)` because the VIEW exposes no
   * `audio_key` — 0390's own derivation, and `notRejectedSql`'s documented
   * requirement. A verdict filed against the CLEANED title must not withhold
   * a recording whose verbatim title is the one that matters; getting this
   * backwards is a filter that silently never fires.
   */
  it('the verdict is keyed on the VERBATIM title, not the cleaned one', () => {
    const db = fixture();
    db.exec(`
      INSERT INTO audiobook_match_review (work_id, audio_key, verdict)
        VALUES (334, 'Harry Potter and the Goblet of Fire', 'rejected');
    `);
    assert.equal(
      indexFrom(db)[GOBLET],
      'harry potter and the goblet of fire|j k rowling',
      'a verdict against the wrong key withholds nothing — deliberately, see §4.9.2',
    );
  });

  /*
   * The guard the qualified `ah.work_id` exists for. `notRejectedSql` builds a
   * correlated subquery over `audiobook_match_review amr`, a table that HAS a
   * `work_id` column, so an unqualified expression would resolve to the
   * subquery's own row, compare it to itself, and hold for everything.
   */
  it('⚠️ a rejection filed against ANOTHER work withholds nothing here', () => {
    const db = fixture();
    db.exec(`
      INSERT INTO audiobook_match_review (work_id, audio_key, verdict)
        VALUES (249, 'Harry Potter and the Goblet of Fire (Full-Cast Edition)', 'rejected');
    `);
    assert.equal(indexFrom(db)[GOBLET], 'harry potter and the goblet of fire|j k rowling');
  });

  it('a work with no work_key or no authors is still excluded, as before 0450', () => {
    const db = fixture();
    db.exec(`UPDATE work SET authors = NULL WHERE id = 334;`);
    assert.equal(indexFrom(db)[GOBLET], undefined);
    assert.equal(indexFrom(db)[KNIGHT], 'space knight book 1|michael-scott earle');
  });
});
