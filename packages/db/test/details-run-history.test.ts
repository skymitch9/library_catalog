/**
 * `detailsRunHistory` end to end, against real SQLite — the SHIPPED query, the
 * new `input_aliases` column (migration 0410), and `askedForWork` woven together.
 *
 * The pure `askedForWork` is pinned separately in `asked-for-work.test.ts`; this
 * file proves the SQL feeds it the right rows: that `input_aliases` round-trips
 * as JSON, that a done run under the title alone leaves a field asked, and that
 * adding a `work_alias` row re-opens exactly that field — the money decision the
 * whole build turns on.
 *
 * Real SQLite, not a stub, because the JSON round-trip and the `status='done'`
 * / title-join filters are decided in the SQL a TypeScript restatement would not
 * exercise (the reasoning `list-members.test.ts` and `audio-edition-count.test.ts`
 * share).
 */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { detailsRunHistory } from '../src/research.ts';

/** The narrow D1 surface `detailsRunHistory` and `listWorkAliases` touch: prepare().bind().all(). */
function d1(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      const bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          bound.push(...args);
          return api;
        },
        async all<T>() {
          return { results: stmt.all(...(bound as never[])) as T[] };
        },
      };
      return api;
    },
  } as unknown as D1Database;
}

/** Just enough of migrations 0001, 0005 and 0410 for the query to run. */
function fixture(): { db: DatabaseSync; d1: D1Database } {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE work (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE work_alias (
      id INTEGER PRIMARY KEY,
      work_id INTEGER NOT NULL,
      alias TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'title',
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT '2026-01-01 00:00:00'
    );
    CREATE TABLE research_run (
      id INTEGER PRIMARY KEY,
      work_id INTEGER NOT NULL,
      tier TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      input_title TEXT,
      input_aliases TEXT,
      unfilled TEXT,
      started_at TEXT,
      finished_at TEXT
    );
    INSERT INTO work (id, title) VALUES (490, 'The Ex Hex Duo');
  `);
  return { db, d1: d1(db) };
}

function addRun(
  db: DatabaseSync,
  row: {
    id: number;
    status: string;
    inputTitle: string;
    inputAliases: string | null;
    unfilled: string | null;
    finishedAt?: string;
  },
): void {
  db.prepare(
    `INSERT INTO research_run
       (id, work_id, tier, status, input_title, input_aliases, unfilled, started_at, finished_at)
     VALUES (?, 490, 'details', ?, ?, ?, ?, '2026-08-24 00:00:00', ?)`,
  ).run(
    row.id,
    row.status,
    row.inputTitle,
    row.inputAliases,
    row.unfilled,
    row.finishedAt ?? '2026-08-24 00:01:00',
  );
}

function addAlias(db: DatabaseSync, alias: string, kind = 'title'): void {
  db.prepare(`INSERT INTO work_alias (work_id, alias, kind) VALUES (490, ?, ?)`).run(alias, kind);
}

describe('detailsRunHistory — alias-aware, against real SQLite', () => {
  it('a done run under the title alone leaves both fields asked', async () => {
    const { db, d1: dbc } = fixture();
    addRun(db, {
      id: 1,
      status: 'done',
      inputTitle: 'The Ex Hex Duo',
      inputAliases: null,
      unfilled: ',series,description,',
    });

    const [history] = await detailsRunHistory(dbc);
    assert.equal(history.workId, 490);
    assert.deepEqual([...history.asked].sort(), ['description', 'series']);
  });

  it('⚠️ adding a title alias re-opens the fields that run never asked under', async () => {
    const { db, d1: dbc } = fixture();
    addRun(db, {
      id: 1,
      status: 'done',
      inputTitle: 'The Ex Hex Duo',
      inputAliases: null,
      unfilled: ',series,description,',
    });
    addAlias(db, 'The Ex Hex');

    const [history] = await detailsRunHistory(dbc);
    assert.deepEqual(history.asked, [], 'the new alias is a new question — both re-open');
  });

  it('⚠️ a run that DID ask under the alias keeps the fields asked (JSON round-trip)', async () => {
    const { db, d1: dbc } = fixture();
    addRun(db, {
      id: 1,
      status: 'done',
      inputTitle: 'The Ex Hex Duo',
      inputAliases: JSON.stringify(['The Ex Hex']),
      unfilled: ',series,description,',
    });
    addAlias(db, 'The Ex Hex');

    const [history] = await detailsRunHistory(dbc);
    assert.deepEqual([...history.asked].sort(), ['description', 'series']);
  });

  it('an author-kind alias does not re-open a title question', async () => {
    const { db, d1: dbc } = fixture();
    addRun(db, {
      id: 1,
      status: 'done',
      inputTitle: 'The Ex Hex Duo',
      inputAliases: null,
      unfilled: ',series,',
    });
    // Only title-kind aliases are identities for the ask; a pen name is not.
    addAlias(db, 'Erin Sterling', 'author');

    const [history] = await detailsRunHistory(dbc);
    assert.deepEqual(history.asked, ['series']);
  });

  it('an errored run has asked nothing, whatever it recorded', async () => {
    const { db, d1: dbc } = fixture();
    addRun(db, {
      id: 1,
      status: 'error',
      inputTitle: 'The Ex Hex Duo',
      inputAliases: null,
      unfilled: ',series,description,',
    });

    const [history] = await detailsRunHistory(dbc);
    assert.deepEqual(history.asked, []);
  });
});
