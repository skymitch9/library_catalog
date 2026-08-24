/**
 * The 507/508 fix, pinned against real SQL.
 *
 * `deriveAudiobookHoldingFromSeriesLink` is what makes a book owned only via a
 * CONFIRMED series link (its title too junky to have matched the per-work cache)
 * finally read "owned on audio" on the work page. The properties that matter are
 * the ones a restatement in TypeScript could not prove, so the real functions run
 * here against an in-memory SQLite through a tiny D1 shim — the shipped SQL, its
 * JOIN, and migration 0110's rename guard, exercised rather than reasoned about.
 *
 *   1. A confirmed link surfaces the matching rung as a holding.
 *   2. NO link → nothing (the human-in-the-loop gate holds).
 *   3. A STALE rung → nothing (a withdrawn recording is not a claim).
 *   4. The rename guard: a link whose stored audiobook_series no longer matches
 *      the live rung surfaces nothing — the confirmation was about a pair of
 *      names, and one of them changed.
 *   5. `matchedVia` is the honest 'series_link', never an evidence value.
 *
 * `audioSeriesCandidates` and `suggestSeriesNames` — what the editor's controls
 * read — are pinned alongside, because a candidate the confirm route would 404 on
 * is the one bug those functions exist to prevent.
 */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import {
  SERIES_LINK_MATCHED_VIA,
  audioSeriesCandidates,
  deriveAudiobookHoldingFromSeriesLink,
  suggestSeriesNames,
} from '../src/index.ts';

/** The minimal async D1 surface the three functions call, over node:sqlite. */
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

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE work (id INTEGER PRIMARY KEY, title TEXT, series TEXT, series_index_sort REAL);
    CREATE TABLE audiobook_series_holding (
      series             TEXT NOT NULL,
      index_sort         REAL NOT NULL,
      title              TEXT NOT NULL,
      authors            TEXT,
      audiobook_series   TEXT NOT NULL,
      index_display      TEXT,
      cover_href         TEXT,
      series_matched_via TEXT NOT NULL DEFAULT 'work_match',
      stale_at           TEXT,
      PRIMARY KEY (series, index_sort)
    );
    CREATE TABLE audiobook_series_link (
      series           TEXT PRIMARY KEY,
      audiobook_series TEXT NOT NULL,
      note             TEXT,
      confirmed_by     INTEGER,
      confirmed_at     TEXT NOT NULL DEFAULT '2026-08-24 21:53:06'
    );
  `);
  // The real household case: works 507/508 with junk/typo titles, the audiobook
  // catalog's curated Empyrean rungs, no per-work edition rows.
  db.prepare('INSERT INTO work VALUES (?,?,?,?)').run(507, 'Fourth Wing - The Empyrean #1', 'The Empyrean', 1);
  db.prepare('INSERT INTO work VALUES (?,?,?,?)').run(508, 'Iron flame', 'The Empyrean', 2);
  const rung = db.prepare(
    'INSERT INTO audiobook_series_holding (series,index_sort,title,authors,audiobook_series,index_display,cover_href,stale_at) VALUES (?,?,?,?,?,?,?,?)',
  );
  rung.run('The Empyrean', 1, 'Fourth Wing', 'Rebecca Yarros', 'The Empyrean', '1', 'covers/Yarros/Fourth Wing.jpg', null);
  rung.run('The Empyrean', 2, 'Iron Flame', 'Rebecca Yarros', 'The Empyrean', '2', null, null);
  rung.run('The Empyrean', 3, 'Onyx Storm', 'Rebecca Yarros', 'The Empyrean', '3', null, null);
  return db;
}

function confirm(db: DatabaseSync, series: string, audiobookSeries: string): void {
  db.prepare('INSERT INTO audiobook_series_link (series,audiobook_series) VALUES (?,?)').run(
    series,
    audiobookSeries,
  );
}

describe('deriveAudiobookHoldingFromSeriesLink — the 507/508 fix', () => {
  it('surfaces the matching rung once the series is confirmed', async () => {
    const db = fixture();
    confirm(db, 'The Empyrean', 'The Empyrean');

    const h = await deriveAudiobookHoldingFromSeriesLink(shim(db), 'The Empyrean', 1);
    assert.ok(h, 'a confirmed series must surface the rung');
    assert.equal(h!.title, 'Fourth Wing');
    assert.equal(h!.authors, 'Rebecca Yarros');
    assert.equal(h!.series, 'The Empyrean'); // their spelling
    assert.equal(h!.indexDisplay, '1');
    assert.equal(h!.coverHref, 'covers/Yarros/Fourth Wing.jpg');
    assert.equal(h!.matchedVia, SERIES_LINK_MATCHED_VIA);
    assert.equal(h!.titleSimilarity, null, 'there was no title match to score');
    assert.equal(h!.staleAt, null);
  });

  it('resolves 508 to Iron Flame by volume number, junk title notwithstanding', async () => {
    const db = fixture();
    confirm(db, 'The Empyrean', 'The Empyrean');
    const h = await deriveAudiobookHoldingFromSeriesLink(shim(db), 'The Empyrean', 2);
    assert.equal(h!.title, 'Iron Flame');
  });

  it('surfaces NOTHING without a confirmed link — the human gate holds', async () => {
    const db = fixture();
    const h = await deriveAudiobookHoldingFromSeriesLink(shim(db), 'The Empyrean', 1);
    assert.equal(h, null);
  });

  it('surfaces nothing for a STALE rung — a withdrawn recording is not a claim', async () => {
    const db = fixture();
    confirm(db, 'The Empyrean', 'The Empyrean');
    db.prepare('UPDATE audiobook_series_holding SET stale_at = ? WHERE series = ? AND index_sort = ?').run(
      '2026-08-24 04:00:00',
      'The Empyrean',
      1,
    );
    const h = await deriveAudiobookHoldingFromSeriesLink(shim(db), 'The Empyrean', 1);
    assert.equal(h, null);
  });

  it('honours migration 0110s rename guard — a stale name mapping surfaces nothing', async () => {
    const db = fixture();
    // The owner confirmed "The Empyrean" = "The Empyrean", then the sibling
    // catalog refiled the rungs under a new name. The confirmation named a pair;
    // one half moved, so the link no longer authorises these rungs.
    confirm(db, 'The Empyrean', 'The Empyrean');
    db.prepare('UPDATE audiobook_series_holding SET audiobook_series = ? WHERE series = ?').run(
      'Empyrean (Reissue)',
      'The Empyrean',
    );
    const h = await deriveAudiobookHoldingFromSeriesLink(shim(db), 'The Empyrean', 1);
    assert.equal(h, null, 'the JOIN on audiobook_series must fail once the names diverge');
  });

  it('returns null for a work with no series or no volume number', async () => {
    const db = fixture();
    confirm(db, 'The Empyrean', 'The Empyrean');
    assert.equal(await deriveAudiobookHoldingFromSeriesLink(shim(db), null, 1), null);
    assert.equal(await deriveAudiobookHoldingFromSeriesLink(shim(db), 'The Empyrean', null), null);
  });
});

describe('audioSeriesCandidates — what the editor confirm control reads', () => {
  it('offers only mappings the confirm route will accept, with the fold size', async () => {
    const db = fixture();
    const c = await audioSeriesCandidates(shim(db), 'The Empyrean');
    assert.equal(c.works, 2, 'two library works fold under this series');
    assert.equal(c.linked, null);
    assert.deepEqual(c.candidates, [{ audiobookSeries: 'The Empyrean', rungs: 3 }]);
  });

  it('reports the standing link once confirmed', async () => {
    const db = fixture();
    confirm(db, 'The Empyrean', 'The Empyrean');
    const c = await audioSeriesCandidates(shim(db), 'The Empyrean');
    assert.equal(c.linked!.audiobookSeries, 'The Empyrean');
  });

  it('excludes stale rungs from the candidate list', async () => {
    const db = fixture();
    db.prepare('UPDATE audiobook_series_holding SET stale_at = ?').run('2026-08-24 04:00:00');
    const c = await audioSeriesCandidates(shim(db), 'The Empyrean');
    assert.deepEqual(c.candidates, []);
  });
});

describe('suggestSeriesNames — the editor field autocomplete', () => {
  it('merges names from both catalogs and tags a shared one with both sources', async () => {
    const db = fixture();
    // A library-only series and an audiobook-only one, plus the shared Empyrean.
    db.prepare('INSERT INTO work VALUES (?,?,?,?)').run(1, 'Cradle 1', 'Cradle', 1);
    db.prepare(
      'INSERT INTO audiobook_series_holding (series,index_sort,title,audiobook_series) VALUES (?,?,?,?)',
    ).run('Stormlight', 1, 'The Way of Kings', 'The Stormlight Archive');

    const all = await suggestSeriesNames(shim(db), '');
    const byName = new Map(all.map((s) => [s.name, s.sources.sort()]));
    assert.deepEqual(byName.get('The Empyrean'), ['audiobook', 'library']);
    assert.deepEqual(byName.get('Cradle'), ['library']);
    assert.deepEqual(byName.get('Stormlight'), ['audiobook']);
  });

  it('filters case-insensitively by substring', async () => {
    const db = fixture();
    const hits = await suggestSeriesNames(shim(db), 'empyr');
    assert.deepEqual(
      hits.map((s) => s.name),
      ['The Empyrean'],
    );
  });
});
