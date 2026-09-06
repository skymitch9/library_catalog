/**
 * The cover-health audit's guards.
 *
 * ⚠️ **Every test here is about a run that must not LIE.** This audit writes
 * nothing, so it cannot damage the catalog — but it feeds an unauthenticated
 * `/api/health` key that a person will read as *"the covers are fine"*, and a
 * refused run reported as clean is the silent-staleness trap the estate's rules
 * exist to kill. The assertions are therefore on the STATE and on what reached
 * the run row, not only on the return value.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  COVER_HEALTH_CAP,
  COVER_HEALTH_CONCURRENCY,
  describeCoverHealth,
  runCoverHealthAudit,
} from './cover-health-run.js';
import type { Env } from '../env.js';

// ---------------------------------------------------------------------------
// A fake D1 holding one `work` table
// ---------------------------------------------------------------------------

interface Row {
  id: number;
  title: string;
  cover_url: string | null;
}

interface FakeState {
  rows: Row[];
  runRows: { id: number; audit: string; trigger: string; state: string; detail: unknown }[];
  /** Anything that was not an audit_run write — there must never be any. */
  otherWrites: string[];
}

function fakeEnv(rows: Row[], envOver: Partial<Env> = {}, dbOver: Partial<D1Database> = {}) {
  const state: FakeState = { rows, runRows: [], otherWrites: [] };

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
        if (/COUNT\(\*\) AS total/.test(sql)) {
          return {
            total: state.rows.length,
            missing: state.rows.filter((r) => !r.cover_url).length,
          };
        }
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
        if (/FROM work/.test(sql) && /cover_url IS NOT NULL/.test(sql)) {
          return { results: state.rows.filter((r) => r.cover_url) };
        }
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
    ...envOver,
  } as unknown as Env;

  return { env, state };
}

function works(n: number, coverUrl: string | null = '/covers/a.jpg'): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    title: `Book ${i + 1}`,
    cover_url: coverUrl,
  }));
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(answer: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (url: unknown) => answer(String(url))) as typeof fetch;
}

function image(bytes = 84_000): Response {
  return new Response(null, {
    status: 200,
    headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes) },
  });
}

// ---------------------------------------------------------------------------

describe('🔴 the empty-read guard — zero works is a REFUSAL, not a clean catalog', () => {
  it('reads zero works → failed: empty-read, and nothing was probed', async () => {
    // The AUDIO-B precedent, and the shape phase 0 actually measured: one
    // `--remote` run returned `0 work(s)` and EXITED 0. Reporting that as `ok`
    // would put "audited, clean" on an unauthenticated status page about a
    // catalog nobody read.
    let fetched = false;
    stubFetch(() => {
      fetched = true;
      return image();
    });
    const { env, state } = fakeEnv([]);
    const result = await runCoverHealthAudit(env, { trigger: 'cron' });
    assert.equal(result.state, 'failed');
    assert.equal(result.detail, 'empty-read');
    assert.equal(fetched, false);
    assert.equal(state.runRows[0]!.state, 'failed');
  });

  it('⚠️ works that exist but have NO cover is `ok`, not a refusal', async () => {
    // Nothing was wrong; there was simply nothing to ask. The two must not be
    // the same word — one means "check the database", the other means "run the
    // cover ladder".
    const { env } = fakeEnv(works(5, null));
    const result = await runCoverHealthAudit(env, { trigger: 'cron' });
    assert.equal(result.state, 'ok');
    assert.equal(result.detail, 'no covers to check');
    assert.equal(result.findings?.missingCover, 5);
    assert.equal(result.findings?.checked, 0);
  });

  it('a database that has gone away is a recorded failure, never a throw', async () => {
    const { env } = fakeEnv(works(3), {}, {
      prepare() {
        throw new Error('D1_ERROR: no such table: audit_run');
      },
    } as Partial<D1Database>);
    const result = await runCoverHealthAudit(env, { trigger: 'cron' });
    assert.equal(result.state, 'failed');
    assert.equal(result.runId, null, 'no run row could be opened');
    assert.match(result.detail ?? '', /run row failed/);
  });
});

describe('🔴 it writes NOTHING to any catalog table', () => {
  it('a run full of broken covers touches only audit_run', async () => {
    // The audit's whole contract. A broken URL is a QUESTION — blanking one
    // loses where the cover came from, which `docs/TODO.md`'s padhard 356 row
    // says in as many words.
    stubFetch(() => new Response(null, { status: 404 }));
    const { env, state } = fakeEnv(works(10));
    const result = await runCoverHealthAudit(env, { trigger: 'cron' });
    assert.equal(result.state, 'findings');
    assert.deepEqual(state.otherWrites, []);
  });
});

describe('the three counts stay three', () => {
  it('an ANSWER that is not a cover is `broken`', async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    const { env } = fakeEnv(works(4));
    const result = await runCoverHealthAudit(env, { trigger: 'cron' });
    assert.equal(result.findings?.broken, 4);
    assert.equal(result.findings?.unreachable, 0);
  });

  it('🔴 NO answer at all is `unreachable` — counted apart from broken', async () => {
    // A Worker with flaky egress must not file every cover in the catalog as
    // broken and send the next person hunting four hundred dead covers that
    // were all fine.
    globalThis.fetch = (async () => {
      throw new Error('network is unreachable');
    }) as typeof fetch;
    const { env } = fakeEnv(works(4));
    const result = await runCoverHealthAudit(env, { trigger: 'cron' });
    assert.equal(result.findings?.unreachable, 4);
    assert.equal(result.findings?.broken, 0);
    assert.equal(result.state, 'findings');
  });

  it('`missingCover` is counted apart from both, and is never a finding', async () => {
    stubFetch(() => image());
    const { env } = fakeEnv([...works(3), ...works(2, null).map((r) => ({ ...r, id: r.id + 10 }))]);
    const result = await runCoverHealthAudit(env, { trigger: 'cron' });
    assert.equal(result.state, 'ok');
    assert.equal(result.findings?.missingCover, 2);
    assert.equal(result.findings?.withCover, 3);
  });

  it('every cover healthy is `ok` with no findings', async () => {
    stubFetch(() => image());
    const { env } = fakeEnv(works(6));
    const result = await runCoverHealthAudit(env, { trigger: 'cron' });
    assert.equal(result.state, 'ok');
    assert.equal(result.findingRows.length, 0);
    assert.equal(result.findings?.broken, 0);
  });
});

describe('the per-tick cap and its rotation', () => {
  it(`the cap is ${COVER_HEALTH_CAP} and the pool is ${COVER_HEALTH_CONCURRENCY}`, () => {
    assert.equal(COVER_HEALTH_CAP, 250);
    assert.equal(COVER_HEALTH_CONCURRENCY, 6);
  });

  it('never probes more than the cap, and says how many it deferred', async () => {
    let probes = 0;
    stubFetch(() => {
      probes += 1;
      return image();
    });
    const { env } = fakeEnv(works(10));
    const result = await runCoverHealthAudit(env, { trigger: 'cron', cap: 4, tick: 0 });
    assert.equal(probes, 4);
    assert.equal(result.findings?.checked, 4);
    assert.equal(result.findings?.deferred, 6);
  });

  it('🔴 successive ticks look at DIFFERENT covers — a fixed window would never see the rest', async () => {
    const seen: string[][] = [];
    for (const tick of [0, 1, 2]) {
      const urls: string[] = [];
      stubFetch((url) => {
        urls.push(url);
        return image();
      });
      const { env } = fakeEnv(
        works(9).map((r) => ({ ...r, cover_url: `/covers/${r.id}.jpg` })),
      );
      await runCoverHealthAudit(env, { trigger: 'cron', cap: 3, tick });
      seen.push(urls.sort());
    }
    assert.notDeepEqual(seen[0], seen[1]);
    assert.notDeepEqual(seen[1], seen[2]);
    assert.equal(new Set(seen.flat()).size, 9, 'three ticks did not cover the catalog');
  });

  it('the concurrency pool still probes every row in the window exactly once', async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      return image();
    });
    const { env } = fakeEnv(works(25).map((r) => ({ ...r, cover_url: `/covers/${r.id}.jpg` })));
    await runCoverHealthAudit(env, { trigger: 'cron', cap: 25, tick: 0 });
    assert.equal(urls.length, 25);
    assert.equal(new Set(urls).size, 25);
  });
});

describe('the run row', () => {
  it('carries the trigger — the only way to tell the clock from a person later', async () => {
    stubFetch(() => image());
    const { env, state } = fakeEnv(works(2));
    await runCoverHealthAudit(env, { trigger: 'admin' });
    assert.equal(state.runRows[0]!.audit, 'cover-health');
    assert.equal(state.runRows[0]!.trigger, 'admin');
  });

  it('🔴 carries COUNTS and IDS — never a title and never a URL', async () => {
    // `audit_run.detail_json` is read back by `/api/health`, which is
    // unauthenticated on purpose. One careless spread away from publishing the
    // household's shelf.
    stubFetch(() => new Response(null, { status: 404 }));
    const { env, state } = fakeEnv([
      { id: 1, title: 'A Very Private Book', cover_url: '/covers/secret.jpg' },
    ]);
    await runCoverHealthAudit(env, { trigger: 'cron' });
    const json = JSON.stringify(state.runRows[0]!.detail);
    assert.ok(!/A Very Private Book/.test(json), 'a title reached the run row');
    assert.ok(!/secret\.jpg/.test(json), 'a cover URL reached the run row');
    assert.match(json, /"sampleIds":\[1\]/);
  });

  it('the sample id list is bounded — an outage cannot write 400 ids to a status page', async () => {
    stubFetch(() => new Response(null, { status: 500 }));
    const { env, state } = fakeEnv(works(60));
    await runCoverHealthAudit(env, { trigger: 'cron' });
    const detail = state.runRows[0]!.detail as { findings: { sampleIds: number[] } };
    assert.equal(detail.findings.sampleIds.length, 20);
  });

  it('a refusal is RECORDED, not thrown away — a refused run is still a run', async () => {
    const { env, state } = fakeEnv([]);
    await runCoverHealthAudit(env, { trigger: 'cron' });
    assert.equal(state.runRows.length, 1);
    assert.equal(state.runRows[0]!.state, 'failed');
    const detail = state.runRows[0]!.detail as { detail: string };
    assert.equal(detail.detail, 'empty-read');
  });
});

describe('it never rejects', () => {
  it('every shape of bad news settles', async () => {
    const answers: Array<() => Response | never> = [
      () => new Response(null, { status: 500 }),
      () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      () => image(43),
      () => {
        throw new Error('boom');
      },
    ];
    for (const answer of answers) {
      stubFetch(() => answer());
      const { env } = fakeEnv(works(3));
      await assert.doesNotReject(() => runCoverHealthAudit(env, { trigger: 'cron' }));
    }
  });
});

describe('what a person is told — never a bare status, never a false all-clear', () => {
  it('a REFUSAL says it measured nothing', async () => {
    const { env } = fakeEnv([]);
    const said = describeCoverHealth(await runCoverHealthAudit(env, { trigger: 'cron' }));
    assert.match(said, /refused/);
    assert.match(said, /NOT.*evidence/s);
  });

  it('a clean run says how many it checked AND how many are deferred', async () => {
    stubFetch(() => image());
    const { env } = fakeEnv(works(10));
    const said = describeCoverHealth(
      await runCoverHealthAudit(env, { trigger: 'cron', cap: 4, tick: 0 }),
    );
    assert.match(said, /Checked 4 of 10/);
    assert.match(said, /6 are queued/);
  });

  it('a findings run warns before anybody blanks a URL to make the number go down', async () => {
    globalThis.fetch = (async () => {
      throw new Error('timeout');
    }) as typeof fetch;
    const { env } = fakeEnv(works(2));
    const said = describeCoverHealth(await runCoverHealthAudit(env, { trigger: 'cron' }));
    assert.match(said, /may be an outage/);
    assert.match(said, /never blank a URL/);
  });
});
