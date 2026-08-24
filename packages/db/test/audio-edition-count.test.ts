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

/** Just enough of migrations 0001 and 0390 for the fragment to run. */
function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE work (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE audiobook_edition_holding (
      work_id   INTEGER NOT NULL REFERENCES work(id),
      audio_key TEXT    NOT NULL,
      title     TEXT    NOT NULL,
      narrator  TEXT,
      series    TEXT,
      stale_at  TEXT,
      PRIMARY KEY (work_id, audio_key)
    );
  `);
  return db;
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
