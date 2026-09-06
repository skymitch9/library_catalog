/**
 * The bare-series alarm's guards.
 *
 * ⚠️ **The alarm's normal answer is EMPTY**, which is exactly what makes it
 * dangerous to get wrong: an alarm that is broken and an alarm that has nothing
 * to say produce the same silence. Every test here is about keeping those two
 * apart — a refused run must never be reported as a clean one, and a clean one
 * must never be reported as a refusal.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeSeriesAggregates, runSeriesAggregateAudit } from './series-aggregates-run.js';
import type { Env } from '../env.js';

interface WorkRow {
  id: number;
  title: string;
  authors: string;
  editions: number;
  copies: number;
}

interface FakeState {
  seriesNames: string[];
  works: WorkRow[];
  totalWorks: number;
  runRows: { id: number; audit: string; trigger: string; state: string; detail: unknown }[];
  otherWrites: string[];
}

function fakeEnv(over: Partial<FakeState> = {}, dbOver: Partial<D1Database> = {}) {
  const state: FakeState = {
    seriesNames: ['The Wandering Inn', 'Space Knight', 'Dungeon Crawler Carl'],
    works: [],
    totalWorks: 411,
    runRows: [],
    otherWrites: [],
    ...over,
  };

  const stmt = (sql: string) => {
    let binds: unknown[] = [];
    const api = {
      bind(...args: unknown[]) {
        binds = args;
        return api;
      },
      async first() {
        if (/INSERT INTO audit_run/.test(sql)) {
          const id = state.runRows.length + 1;
          state.runRows.push({
            id,
            audit: String(binds[0]),
            trigger: String(binds[1]),
            state: 'running',
            detail: null,
          });
          return { id };
        }
        if (/COUNT\(\*\) AS total FROM work/.test(sql)) return { total: state.totalWorks };
        return null;
      },
      async run() {
        if (/UPDATE audit_run/.test(sql)) {
          const row = state.runRows.find((r) => r.id === binds[2]);
          if (row) {
            row.state = String(binds[0]);
            row.detail = JSON.parse(String(binds[1]));
          }
          return { meta: { changes: 1 } };
        }
        state.otherWrites.push(sql);
        return { meta: { changes: 1 } };
      },
      async all() {
        if (/UNION/.test(sql)) return { results: state.seriesNames.map((s) => ({ series: s })) };
        if (/HAVING COUNT/.test(sql)) return { results: state.works };
        return { results: [] };
      },
    };
    return api;
  };

  const env = {
    SITE_ORIGIN: 'https://library.heygabi.ai',
    DB: {
      prepare: (sql: string) => stmt(sql),
      async batch(statements: unknown[]) {
        state.otherWrites.push(`BATCH(${statements.length})`);
        return statements.map(() => ({ success: true }));
      },
      ...dbOver,
    },
  } as unknown as Env;

  return { env, state };
}

/** The 2026-08-13 shape: an OL aggregate titled with the bare series name. */
const PHANTOM: WorkRow = {
  id: 300,
  title: 'Space Knight',
  authors: 'Unknown',
  editions: 6,
  copies: 6,
};

/** The legitimate hit: a volume 1 genuinely titled with its series name. */
const WANDERING_INN: WorkRow = {
  id: 12,
  title: 'The Wandering Inn',
  authors: 'pirateaba',
  editions: 2,
  copies: 3,
};

// ---------------------------------------------------------------------------

describe('🔴 the empty-read guard — and the denominator it uses', () => {
  it('zero WORKS is failed: empty-read', async () => {
    const { env, state } = fakeEnv({ totalWorks: 0, works: [] });
    const result = await runSeriesAggregateAudit(env, { trigger: 'cron' });
    assert.equal(result.state, 'failed');
    assert.equal(result.detail, 'empty-read');
    assert.equal(state.runRows[0]!.state, 'failed');
  });

  it('🔴 zero MULTI-EDITION works is `ok` — that is the clean answer, not a refusal', async () => {
    // The distinction the guard's denominator exists for. Since the 2026-08-13
    // cleanup this set has been empty in production, so `ok` with zero flagged
    // is the answer this audit gives every single night. Reporting it as a
    // refusal would make the alarm cry wolf forever.
    const { env } = fakeEnv({ totalWorks: 411, works: [] });
    const result = await runSeriesAggregateAudit(env, { trigger: 'cron' });
    assert.equal(result.state, 'ok');
    assert.equal(result.findings?.multiEditionWorks, 0);
    assert.equal(result.findings?.flagged, 0);
  });

  it('a database that has gone away is a recorded failure, never a throw', async () => {
    const { env } = fakeEnv({}, {
      prepare() {
        throw new Error('D1_ERROR: no such table');
      },
    } as Partial<D1Database>);
    const result = await runSeriesAggregateAudit(env, { trigger: 'cron' });
    assert.equal(result.state, 'failed');
    assert.ok(result.detail);
  });

  it('a read that fails AFTER the run row opened is recorded on that row', async () => {
    // ⚠️ The failure is raised from `.all()`/`.first()`, not from `prepare()`,
    // because that is how D1 actually fails: preparing a statement is local and
    // the round trip is what breaks. A fake that threw synchronously out of
    // `prepare` would model a shape the runtime does not produce — and it would
    // strand the sibling promises of the read's `Promise.all` as unhandled
    // rejections, which is a bug in the FAKE rather than in the runner.
    const state: { runRows: { state: string; detail: unknown }[] } = { runRows: [] };
    const env = {
      SITE_ORIGIN: 'https://library.heygabi.ai',
      DB: {
        prepare(sql: string) {
          let binds: unknown[] = [];
          const api = {
            bind(...args: unknown[]) {
              binds = args;
              return api;
            },
            async first() {
              if (/INSERT INTO audit_run/.test(sql)) return { id: 1 };
              throw new Error('D1_ERROR: the read blew up');
            },
            async run() {
              if (/UPDATE audit_run/.test(sql)) {
                state.runRows.push({
                  state: String(binds[0]),
                  detail: JSON.parse(String(binds[1])),
                });
                return { meta: { changes: 1 } };
              }
              throw new Error('D1_ERROR: the read blew up');
            },
            async all() {
              throw new Error('D1_ERROR: the read blew up');
            },
          };
          return api;
        },
      },
    } as unknown as Env;

    const result = await runSeriesAggregateAudit(env, { trigger: 'cron' });
    assert.equal(result.state, 'failed');
    assert.match(result.detail ?? '', /read failed/);
    assert.equal(state.runRows[0]!.state, 'failed');
  });
});

describe('🔴 it writes NOTHING to any catalog table', () => {
  it('even when it flags the phantom shape', async () => {
    // A hit is a QUESTION, never an instruction. *The Wandering Inn* is
    // legitimately titled with its series name; auto-acting on this list would
    // delete a real book.
    const { env, state } = fakeEnv({ works: [PHANTOM, WANDERING_INN] });
    const result = await runSeriesAggregateAudit(env, { trigger: 'cron' });
    assert.equal(result.state, 'findings');
    assert.deepEqual(state.otherWrites, []);
  });
});

describe('the alarm fires on the right shape', () => {
  it('flags a bare series title carrying 2+ editions', async () => {
    const { env } = fakeEnv({ works: [PHANTOM, WANDERING_INN] });
    const result = await runSeriesAggregateAudit(env, { trigger: 'cron' });
    assert.deepEqual(result.findings?.flaggedIds.sort((a, b) => a - b), [12, 300]);
    assert.equal(result.flaggedRows.length, 2);
  });

  it('does not flag a title carrying a volume number', async () => {
    const { env } = fakeEnv({
      works: [{ id: 88, title: 'Dungeon Crawler Carl 2', authors: 'M D', editions: 2, copies: 2 }],
    });
    const result = await runSeriesAggregateAudit(env, { trigger: 'cron' });
    assert.equal(result.state, 'ok');
    assert.equal(result.findings?.flagged, 0);
  });

  it('reports the fold size — an empty series list would otherwise look clean', async () => {
    const { env } = fakeEnv({ works: [PHANTOM] });
    const result = await runSeriesAggregateAudit(env, { trigger: 'cron' });
    assert.equal(result.findings?.seriesKeys, 3);
  });
});

describe('the run row', () => {
  it('is named, triggered, and carries ids not titles', async () => {
    const { env, state } = fakeEnv({ works: [PHANTOM] });
    await runSeriesAggregateAudit(env, { trigger: 'admin' });
    assert.equal(state.runRows[0]!.audit, 'series-aggregates');
    assert.equal(state.runRows[0]!.trigger, 'admin');
    const json = JSON.stringify(state.runRows[0]!.detail);
    assert.ok(!/Space Knight/.test(json), 'a title reached the run row');
    assert.ok(!/Unknown/.test(json), 'an author reached the run row');
    assert.match(json, /"flaggedIds":\[300\]/);
  });

  it('⚠️ flaggedIds is NOT truncated — the list is meant to be empty', async () => {
    // Unlike the cover audit's sample, every flagged row here deserves an
    // eyeball, and a truncated list would hide the ones after the twentieth
    // exactly when something has gone badly wrong.
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...PHANTOM,
      id: 300 + i,
    }));
    const { env } = fakeEnv({ works: many });
    const result = await runSeriesAggregateAudit(env, { trigger: 'cron' });
    assert.equal(result.findings?.flaggedIds.length, 30);
  });
});

describe('it never rejects', () => {
  it('settles on a clean catalog, a flagged one, and a broken database', async () => {
    const cases = [
      fakeEnv({ works: [] }),
      fakeEnv({ works: [PHANTOM] }),
      fakeEnv({}, {
        prepare() {
          throw new Error('gone');
        },
      } as Partial<D1Database>),
    ];
    for (const { env } of cases) {
      await assert.doesNotReject(() => runSeriesAggregateAudit(env, { trigger: 'cron' }));
    }
  });
});

describe('what a person is told', () => {
  it('a REFUSAL says nothing was measured', async () => {
    const { env } = fakeEnv({ totalWorks: 0 });
    const said = describeSeriesAggregates(
      await runSeriesAggregateAudit(env, { trigger: 'cron' }),
      'production',
    );
    assert.match(said, /refused/);
    assert.match(said, /NOT.*evidence/s);
  });

  it('a CLEAN run says so, and says it is the expected answer', async () => {
    const { env } = fakeEnv({ works: [] });
    const said = describeSeriesAggregates(
      await runSeriesAggregateAudit(env, { trigger: 'cron' }),
      'production',
    );
    assert.match(said, /Clean/);
    assert.match(said, /expected answer/);
  });

  it('a FINDINGS run says a person decides, and that nothing was changed', async () => {
    const { env } = fakeEnv({ works: [PHANTOM] });
    const said = describeSeriesAggregates(
      await runSeriesAggregateAudit(env, { trigger: 'cron' }),
      'production',
    );
    assert.match(said, /#\s*300/);
    assert.match(said, /Nothing has been changed/);
    assert.match(said, /a person decides/);
  });
});
