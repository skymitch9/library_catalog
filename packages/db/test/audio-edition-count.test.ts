/**
 * `audioEditionCountSql` — the ONE definition of *"how many audiobook
 * recordings of this book does the household hold?"*
 *
 * Owner, 2026-08-23: *"have it say 2 on the physical and ebook libraries; on
 * audiobook have them be different since they're different files being
 * served."* Two surfaces in this repo say that number — the work page and the
 * series ladder's chip — and the whole point of a shared fragment is that they
 * cannot come to disagree. So the fragment is IMPORTED here and run as SQL,
 * never restated in TypeScript: a restatement would agree with itself and prove
 * nothing about the text that ships (the same reasoning as
 * `ebook-only-clause.test.ts`, and for the same reason).
 *
 * ⚠️ SQLite, not D1 — so this pins the PREDICATE and the arithmetic, not D1's
 * binding order and not the surrounding statements.
 *
 * The case that earns the file is the last one: **a stale edition must not be
 * counted.** `listAudioEditions` deliberately returns stale rows so the page can
 * caveat them, so "count the list" is the obvious-looking implementation and it
 * is wrong — it would promote a holding the sibling catalog has withdrawn back
 * into "you own this".
 */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { audioEditionCountSql } from '../src/works.ts';

/**
 * Just enough of migrations 0001 and 0390 for the fragment to run — the table,
 * and the VIEW over it copied verbatim from
 * `migrations/0390_audiobook_edition_holding.sql` (columns trimmed to the ones
 * present here; the `ROW_NUMBER()` window, its PARTITION and its ORDER BY are
 * byte-for-byte the shipped ones, because they are what the last test asserts).
 */
function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE work (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE audiobook_edition_holding (
      work_id       INTEGER NOT NULL REFERENCES work(id),
      audio_key     TEXT    NOT NULL,
      title         TEXT    NOT NULL,
      narrator      TEXT,
      series        TEXT,
      index_display TEXT,
      stale_at      TEXT,
      PRIMARY KEY (work_id, audio_key)
    );
    CREATE VIEW audiobook_holding AS
    SELECT work_id, title, series, index_display, stale_at
      FROM (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY work_id
                 ORDER BY (series IS NULL), (index_display IS NULL), audio_key
               ) AS edition_rank
          FROM audiobook_edition_holding
      )
     WHERE edition_rank = 1;
    -- Migration 0450 — the fragment consults it now, and a fixture without it
    -- fails loudly rather than quietly, which is the right failure but not the
    -- point of the file: what runs here has to be what ships.
    CREATE TABLE audiobook_match_review (
      work_id   INTEGER NOT NULL REFERENCES work(id),
      audio_key TEXT NOT NULL,
      verdict   TEXT NOT NULL CHECK (verdict IN ('confirmed', 'rejected')),
      PRIMARY KEY (work_id, audio_key)
    );
  `);
  return db;
}

/** "Not this one" — one verdict, migration 0450, keyed on the recording. */
function reject(db: DatabaseSync, workId: number, audioKey: string): void {
  db.prepare(
    "INSERT INTO audiobook_match_review (work_id, audio_key, verdict) VALUES (?, ?, 'rejected')",
  ).run(workId, audioKey);
}

function addWork(db: DatabaseSync, id: number, title: string): void {
  db.prepare('INSERT INTO work (id, title) VALUES (?, ?)').run(id, title);
}

function addEdition(
  db: DatabaseSync,
  workId: number,
  audioKey: string,
  opts: { narrator?: string; staleAt?: string } = {},
): void {
  db.prepare(
    'INSERT INTO audiobook_edition_holding (work_id, audio_key, title, narrator, stale_at)' +
      ' VALUES (?, ?, ?, ?, ?)',
  ).run(workId, audioKey, audioKey, opts.narrator ?? null, opts.staleAt ?? null);
}

/** The number as the work page asks it — one work, a bound placeholder. */
function countForWork(db: DatabaseSync, workId: number): number {
  const row = db.prepare(`SELECT ${audioEditionCountSql('?1')} AS n`).get(workId) as { n: number };
  return row.n;
}

/**
 * The number as the SERIES LADDER asks it — a correlated subquery against an
 * outer column, in one round trip for every work at once. This is the second
 * shape, and running BOTH is the point of the test: one fragment, two call
 * shapes, and they must agree row for row.
 */
function countsAcrossWorks(db: DatabaseSync): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT w.id AS id, ${audioEditionCountSql('w.id')} AS n FROM work w ORDER BY w.id`,
    )
    .all() as Array<{ id: number; n: number }>;
  return new Map(rows.map((r) => [r.id, r.n]));
}

describe('audioEditionCountSql', () => {
  it('is 0 for a book with no audiobook at all — the ordinary case here', () => {
    const db = fixture();
    // 75% of this catalog, measured 2026-08-10: children's board books and
    // fan-translated light novels no English recording exists for.
    addWork(db, 1, 'Goodnight Moon');

    assert.equal(countForWork(db, 1), 0);
  });

  it('is 1 for the ordinary matched book', () => {
    const db = fixture();
    addWork(db, 2, 'Onyx Storm');
    addEdition(db, 2, 'Onyx Storm');

    assert.equal(countForWork(db, 2), 1);
  });

  it('is 2 for the case migration 0390 exists for — two Elantris recordings', () => {
    const db = fixture();
    addWork(db, 514, 'Elantris');
    // The household's real pair: a fourteen-name full cast, and Jack Garrett
    // reading the Tenth Anniversary edition. `catalog.csv` lines 995 and 996.
    addEdition(db, 514, 'Elantris', { narrator: 'James Konicek, Danny Gavigan, …' });
    addEdition(db, 514, 'Elantris - Tenth Anniversary Special Edition', {
      narrator: 'Jack Garrett',
    });

    assert.equal(countForWork(db, 514), 2);
  });

  it('EXCLUDES a stale edition — the case that earns this file', () => {
    const db = fixture();
    addWork(db, 3, 'Oathbound Healer');
    addEdition(db, 3, 'Oathbound Healer');
    // Marked, never deleted (migration 0010's rule, inherited by 0390). The row
    // is still on record and `listAudioEditions` still returns it with a
    // caveat — but it is not a book we hold, so it is not in the number.
    addEdition(db, 3, 'Oathbound Healer - MM', { staleAt: '2026-08-23 04:00:00' });

    assert.equal(
      countForWork(db, 3),
      1,
      'a stale edition is history, not a recording the household holds',
    );
  });

  /*
   * ⚠️ Migration 0450, and the second reason this number is not
   * `listAudioEditions.length`. A stale row is the OTHER catalog withdrawing a
   * match; a rejected row is the OWNER saying it was never this book. Both are
   * still on record, both are still rendered somewhere with words attached, and
   * neither is a recording the household holds — so neither is in the count.
   *
   * ⚠️ Only the literal 'rejected' filters. 'confirmed' is words, and an absent
   * row (every recording in both catalogs today) must count normally, or the
   * badge would read 0 everywhere.
   */
  it('EXCLUDES a recording the owner rejected — 0450', () => {
    const db = fixture();
    addWork(db, 514, 'Elantris');
    addEdition(db, 514, 'Elantris', { narrator: 'full cast' });
    addEdition(db, 514, 'Elantris - Tenth Anniversary Special Edition', {
      narrator: 'Jack Garrett',
    });
    assert.equal(countForWork(db, 514), 2);

    reject(db, 514, 'Elantris - Tenth Anniversary Special Edition');
    assert.equal(countForWork(db, 514), 1, 'a match judged wrong is not a book we hold');
  });

  it('a CONFIRMED verdict does not change the count — it is words only', () => {
    const db = fixture();
    addWork(db, 5, 'Onyx Storm');
    addEdition(db, 5, 'Onyx Storm - Empyrean, Book 3');
    db.prepare(
      "INSERT INTO audiobook_match_review (work_id, audio_key, verdict)" +
        " VALUES (5, 'Onyx Storm - Empyrean, Book 3', 'confirmed')",
    ).run();

    assert.equal(countForWork(db, 5), 1);
  });

  it('is 0, not 1, when every edition is stale', () => {
    const db = fixture();
    addWork(db, 4, 'Under Ashen Skies');
    addEdition(db, 4, 'Under Ashen Skies', { staleAt: '2026-08-23 04:00:00' });

    // ⚠️ The ladder never reaches this row (its own read is filtered to live
    // holdings), which is exactly why `toAudiobookRef` floors the ref at 1
    // rather than trusting the column to be non-zero there.
    assert.equal(countForWork(db, 4), 0);
  });

  it('counts each work separately when asked for all of them at once', () => {
    const db = fixture();
    addWork(db, 10, 'None');
    addWork(db, 11, 'One');
    addWork(db, 12, 'Two');
    addEdition(db, 11, 'One');
    addEdition(db, 12, 'Two — full cast');
    addEdition(db, 12, 'Two — solo');
    addEdition(db, 12, 'Two — withdrawn', { staleAt: '2026-08-23 04:00:00' });

    assert.deepEqual(
      [...countsAcrossWorks(db)],
      [
        [10, 0],
        [11, 1],
        [12, 2],
      ],
      'the ladder shape and the work-page shape must agree row for row',
    );
  });

  it('does not leak a count from a neighbouring work', () => {
    const db = fixture();
    addWork(db, 20, 'Mistborn');
    addWork(db, 21, 'Mistborn: The Final Empire');
    addEdition(db, 21, 'Mistborn: The Final Empire');

    // The two titles the 0.6 containment floor keeps apart (KI-6). If the
    // fragment ever lost its `work_id` predicate, this is the pair that would
    // make it look like both are held.
    assert.equal(countForWork(db, 20), 0);
    assert.equal(countForWork(db, 21), 1);
  });
});

/**
 * ⚠️ **Two recordings are ONE rung held.** The count exists so a chip can say
 * "2"; the series page's coverage arithmetic — `SeriesHoldings.audio`,
 * `completeness.onAudio`, `gapsCountingAudio` — counts rungs, and a volume the
 * household owns twice on audio must not make a 5-book series look 6/5 covered.
 *
 * The separation is structural rather than careful: the ladder reads the
 * `audiobook_holding` VIEW, which is one whole row per work by construction, and
 * `edition_count` rides along that row as a display fact. This pins the
 * construction, so a future change to the view (or to the count) that broke it
 * fails here rather than on a series page nobody happened to open.
 */
describe('two recordings, one rung — the coverage arithmetic must not move', () => {
  it('the view yields ONE row for a work with two live editions', () => {
    const db = fixture();
    addWork(db, 514, 'Elantris');
    addEdition(db, 514, 'Elantris');
    addEdition(db, 514, 'Elantris - Tenth Anniversary Special Edition');

    const rows = db.prepare('SELECT work_id FROM audiobook_holding').all();
    assert.equal(rows.length, 1, 'one rung held on audio, whatever the count says');
    assert.equal(countForWork(db, 514), 2, 'and the count still says two recordings');
  });

  it('adding a second edition does not add a work to the ladder', () => {
    const db = fixture();
    addWork(db, 100, 'One recording');
    addWork(db, 101, 'Two recordings');
    addEdition(db, 100, 'One recording');
    addEdition(db, 101, 'Two recordings — full cast');

    const before = db.prepare('SELECT COUNT(*) AS n FROM audiobook_holding').get() as { n: number };
    addEdition(db, 101, 'Two recordings — solo');
    const after = db.prepare('SELECT COUNT(*) AS n FROM audiobook_holding').get() as { n: number };

    assert.equal(before.n, 2);
    assert.equal(after.n, 2, 'the number of works held on audio is unchanged — 0390 all over');
    assert.deepEqual(
      [...countsAcrossWorks(db)],
      [
        [100, 1],
        [101, 2],
      ],
      'only the per-rung recording count moved',
    );
  });

  it('the view still prefers the series-bearing row, count or no count', () => {
    const db = fixture();
    addWork(db, 514, 'Elantris');
    addEdition(db, 514, 'Elantris');
    // The Tenth Anniversary edition is the one that KNOWS the series — the whole
    // reason migration 0390 exists. Adding a count must not disturb the rank.
    db.prepare(
      'UPDATE audiobook_edition_holding SET series = ?, index_display = ?' +
        ' WHERE work_id = ? AND audio_key = ?',
    ).run('Elantris', '1', 514, 'Elantris');
    addEdition(db, 514, 'Elantris - Tenth Anniversary Special Edition');

    const row = db.prepare('SELECT title, series FROM audiobook_holding').get() as {
      title: string;
      series: string | null;
    };
    assert.equal(row.series, 'Elantris');
  });
});
