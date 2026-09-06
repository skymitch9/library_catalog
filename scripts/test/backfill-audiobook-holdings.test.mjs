/**
 * The phase-0 regression net: the SQL `npm run backfill:audiobooks` writes.
 *
 * `planAudiobookSweep` returning the right ROWS and this script writing the
 * right SQL FROM them are two different claims, and only the first had a test.
 * The gate for the extraction was that the script's `--remote` dry-run output
 * was byte-identical before and after — but a dry run prints
 * `statements.length` and never the statements, so **the SQL text itself was
 * unproven by the very instrument that proved everything else.** This file is
 * the other half.
 *
 * ⚠️ Pinned as whole strings on purpose. A test that rebuilds the statement
 * from the same pieces the renderer uses cannot fail, which is the trap
 * `identity-and-reviews.md` §5 records from the review backfill: a dry run said
 * 860/860 while writing keys no print edition could ever meet.
 *
 * What is load-bearing here, in the order it will bite:
 *
 *   - the four groups run in ORDER — edition upserts, edition stales, rung
 *     upserts, rung stales — because a stale UPDATE running before its INSERT
 *     would immediately un-stale the row it just marked;
 *   - `ON CONFLICT … DO UPDATE … stale_at = NULL` on every INSERT, which is what
 *     makes a second run inside one minute produce the same rows;
 *   - `raw_title` is the sibling catalog's verbatim string and `audio_key` is
 *     the same string — migration 0390 reusing 0340's content-warning key;
 *   - an apostrophe is doubled and a null is a bare NULL, never `'null'`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderSweepStatements } from '../lib/audiobook-sql.mjs';

/** One edition row, with every column populated. */
const EDITION = {
  workId: 514,
  audioKey: 'Elantris - Tenth Anniversary Special Edition',
  title: 'Elantris',
  rawTitle: 'Elantris - Tenth Anniversary Special Edition',
  authors: 'Brandon Sanderson',
  series: 'Elantris',
  indexDisplay: 'Book 1',
  indexSort: 1,
  coverHref: 'covers/Brandon Sanderson/Elantris.jpg',
  narrator: 'Jack Garrett',
  matchedVia: 'exact',
  titleSimilarity: 1,
  viaAlias: null,
};

const RUNG = {
  series: 'The Primal Hunter',
  indexSort: 2,
  title: 'The Primal Hunter 2',
  authors: 'Zogarth',
  audiobookSeries: 'The Primal Hunter',
  indexDisplay: '2',
  coverHref: 'covers/Zogarth/The Primal Hunter 2.jpg',
  seriesMatchedVia: 'work_match',
};

const FIXTURE_PLAN = {
  editionUpserts: [EDITION],
  editionStales: [{ workId: 72, audioKey: 'Tamer: King of Dinosaurs' }],
  rungUpserts: [RUNG],
  rungStales: [{ series: 'A Series Nobody Holds Any More', indexSort: 4 }],
};

const EXPECTED_EDITION_UPSERT =
  "INSERT INTO audiobook_edition_holding (work_id, audio_key, title, raw_title, authors," +
  " series, index_display, index_sort, cover_href, narrator, matched_via," +
  " title_similarity, via_alias)" +
  " VALUES (514, 'Elantris - Tenth Anniversary Special Edition', 'Elantris'," +
  " 'Elantris - Tenth Anniversary Special Edition', 'Brandon Sanderson', 'Elantris', 'Book 1'," +
  " 1, 'covers/Brandon Sanderson/Elantris.jpg', 'Jack Garrett', 'exact', 1, NULL)" +
  " ON CONFLICT(work_id, audio_key) DO UPDATE SET" +
  " title = excluded.title, raw_title = excluded.raw_title," +
  " authors = excluded.authors, series = excluded.series," +
  " index_display = excluded.index_display, index_sort = excluded.index_sort," +
  " cover_href = excluded.cover_href, narrator = excluded.narrator," +
  " matched_via = excluded.matched_via," +
  " title_similarity = excluded.title_similarity, via_alias = excluded.via_alias," +
  " last_seen_at = datetime('now'), stale_at = NULL;";

const EXPECTED_EDITION_STALE =
  "UPDATE audiobook_edition_holding SET stale_at = datetime('now')" +
  " WHERE work_id = 72 AND audio_key = 'Tamer: King of Dinosaurs'" +
  " AND stale_at IS NULL;";

const EXPECTED_RUNG_UPSERT =
  "INSERT INTO audiobook_series_holding (series, index_sort, title, authors," +
  " audiobook_series, index_display, cover_href, series_matched_via)" +
  " VALUES ('The Primal Hunter', 2, 'The Primal Hunter 2', 'Zogarth'," +
  " 'The Primal Hunter', '2', 'covers/Zogarth/The Primal Hunter 2.jpg', 'work_match')" +
  " ON CONFLICT(series, index_sort) DO UPDATE SET" +
  " title = excluded.title, authors = excluded.authors," +
  " audiobook_series = excluded.audiobook_series," +
  " index_display = excluded.index_display, cover_href = excluded.cover_href," +
  " series_matched_via = excluded.series_matched_via," +
  " last_seen_at = datetime('now'), stale_at = NULL;";

const EXPECTED_RUNG_STALE =
  "UPDATE audiobook_series_holding SET stale_at = datetime('now')" +
  " WHERE series = 'A Series Nobody Holds Any More' AND index_sort = 4" +
  " AND stale_at IS NULL;";

describe('renderSweepStatements — the rendered SQL for a fixture plan', () => {
  const rendered = renderSweepStatements(FIXTURE_PLAN);

  it('renders exactly four statements, in the contracted order', () => {
    assert.deepEqual(rendered, [
      EXPECTED_EDITION_UPSERT,
      EXPECTED_EDITION_STALE,
      EXPECTED_RUNG_UPSERT,
      EXPECTED_RUNG_STALE,
    ]);
  });

  it('⚠️ every INSERT clears stale_at, which is what makes a re-run idempotent', () => {
    for (const s of rendered.filter((x) => x.startsWith('INSERT'))) {
      assert.match(s, /ON CONFLICT\(/);
      assert.match(s, /last_seen_at = datetime\('now'\), stale_at = NULL;$/);
    }
  });

  it('⚠️ every stale UPDATE is guarded by `stale_at IS NULL` — never re-stamped', () => {
    for (const s of rendered.filter((x) => x.startsWith('UPDATE'))) {
      assert.match(s, /AND stale_at IS NULL;$/);
    }
  });

  it('writes the TABLE, never the view — `audiobook_holding` cannot be written', () => {
    for (const s of rendered) {
      assert.ok(!/INTO audiobook_holding\b/.test(s));
      assert.ok(!/UPDATE audiobook_holding\b/.test(s));
    }
  });

  it('nothing is DELETEd — marked, never deleted (migration 0010)', () => {
    for (const s of rendered) assert.ok(!/^DELETE/i.test(s));
  });
});

describe('the literals', () => {
  it("doubles an apostrophe rather than escaping it — SQLite's whole escaping rule", () => {
    const [sql] = renderSweepStatements({
      editionUpserts: [{ ...EDITION, title: "Howl's Moving Castle", viaAlias: "O'Brien" }],
      editionStales: [],
      rungUpserts: [],
      rungStales: [],
    });
    assert.match(sql, /'Howl''s Moving Castle'/);
    assert.match(sql, /'O''Brien'/);
  });

  it('writes a null column as a bare NULL, never the string "null"', () => {
    const [sql] = renderSweepStatements({
      editionUpserts: [
        { ...EDITION, series: null, indexDisplay: null, indexSort: null, narrator: null, coverHref: null },
      ],
      editionStales: [],
      rungUpserts: [],
      rungStales: [],
    });
    assert.ok(!/'null'/.test(sql));
    assert.match(sql, /'Brandon Sanderson', NULL, NULL, NULL, NULL, NULL, 'exact'/);
  });

  it('writes title_similarity as a number, unquoted', () => {
    const [sql] = renderSweepStatements({
      editionUpserts: [{ ...EDITION, titleSimilarity: 0.8571 }],
      editionStales: [],
      rungUpserts: [],
      rungStales: [],
    });
    assert.match(sql, /'exact', 0\.8571, NULL\)/);
  });

  it('an empty plan renders nothing at all', () => {
    assert.deepEqual(
      renderSweepStatements({
        editionUpserts: [],
        editionStales: [],
        rungUpserts: [],
        rungStales: [],
      }),
      [],
    );
  });
});
