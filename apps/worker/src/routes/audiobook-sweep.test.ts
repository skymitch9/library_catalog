/**
 * The audiobook sweep's admin routes — §7.1.
 *
 * Two claims, and both are estate rules rather than local preferences:
 *
 *   - **A person never sees a bare HTTP status.** A refusal says what happened,
 *     what it needs by name, and how to get it — and the four causes stay
 *     distinct, because "awaiting approval" and "your role is too low" have
 *     different fixes and sending somebody to ask for the wrong one wastes an
 *     evening.
 *   - **`dryRun` writes nothing.** It is the phase-1 gate's instrument, and an
 *     instrument that could write is not one.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppBindings, Env } from '../env.js';
import { audiobookSweepRoutes } from './audiobook-sweep.js';
import { healthRoutes } from './health.js';

type Role = 'owner' | 'admin' | 'moderator' | 'contributor' | 'member' | 'guest' | 'pending';

const HEADER =
  'title,series,series_index_display,series_index_sort,author,narrator,year,genre,' +
  'duration_hhmm,cover_href,companion_files,desc,library_work_id,library_formats,universe,series_gap';

const CSV =
  `${HEADER}\n` +
  'The Primal Hunter 1,The Primal Hunter,1,1,Zogarth,Travis Baldree,2021,LitRPG,12:00,' +
  'covers/Zogarth/ph1.jpg,,A book,,,,';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * @param opts.snapshotEtag what `audiobook_snapshot` already holds. ⚠️ Needed to
 *   exercise `force`: with no stored etag there is no `If-None-Match` to skip,
 *   so a route that ignored the flag entirely would pass anyway.
 */
function stubDb(opts: { snapshotEtag?: string } = {}) {
  const written: string[] = [];
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          binds = args;
          return stmt;
        },
        async first() {
          // `isDatabaseReachable` — health's own liveness probe.
          if (/FROM sqlite_master/.test(sql)) return { n: 1 };
          if (/INSERT INTO audiobook_sweep_run/.test(sql)) return { id: 1 };
          if (/FROM audiobook_snapshot/.test(sql)) {
            return opts.snapshotEtag
              ? { etag: opts.snapshotEtag, fetched_at: '2026-09-06 04:23:00', row_count: 1 }
              : null;
          }
          // The gate counters — one aggregate, three numbers (added 2026-09-06).
          if (/plan_ticks/.test(sql)) return { plan_ticks: 5, sv_ticks: 3, cron_ticks: 4 };
          if (/FROM audiobook_sweep_run ORDER BY id DESC/.test(sql)) {
            return {
              id: 7,
              trigger: 'cron',
              started_at: '2026-09-05 23:23:00',
              finished_at: '2026-09-05 23:23:04',
              state: 'shadow',
              detail_json: JSON.stringify({ detail: 'shadow — nothing written' }),
            };
          }
          if (/COUNT\(\*\) FROM audiobook_edition_holding/.test(sql)) {
            return { editions: 412, rungs: 780 };
          }
          return null;
        },
        async run() {
          if (!/audiobook_sweep_run|audiobook_snapshot/.test(sql)) written.push(sql);
          void binds;
          return { meta: { changes: 1 } };
        },
        async all() {
          if (/FROM work ORDER BY id/.test(sql)) {
            return {
              results: [
                {
                  id: 1,
                  title: 'The Primal Hunter 1',
                  authors: 'Zogarth',
                  series: 'The Primal Hunter',
                  series_index_sort: 1,
                },
              ],
            };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
    async batch(statements: unknown[]) {
      written.push(`BATCH(${statements.length})`);
      return statements.map(() => ({ success: true }));
    },
    _written: written,
  };
  return db as unknown as D1Database & { _written: string[] };
}

function app(role: Role) {
  const a = new Hono<AppBindings>();
  a.use('*', async (c, next) => {
    c.set('user', { id: 1, email: 'a@b.test', displayName: 'A', role } as never);
    await next();
  });
  a.route('/api/admin', audiobookSweepRoutes);
  return a;
}

function envWith(db: D1Database, mode = 'shadow'): Env {
  return { DB: db, AUDIOBOOK_SWEEP_MODE: mode } as unknown as Env;
}

// ---------------------------------------------------------------------------

describe('the refusal — never a bare status', () => {
  for (const role of ['member', 'contributor', 'moderator', 'guest'] as const) {
    it(`refuses a ${role} in WORDS, naming the capability and the way out`, async () => {
      const res = await app(role).request(
        '/api/admin/audiobooks/sweep',
        { method: 'POST' },
        envWith(stubDb()),
      );
      assert.equal(res.status, 403);
      const body = (await res.json()) as { capability?: string; role?: string; detail?: string };
      assert.equal(body.capability, 'manageUsers');
      assert.equal(body.role, role);
      // What happened, what it needs, how to get it.
      assert.match(body.detail ?? '', /owner-or-admin/);
      assert.match(body.detail ?? '', new RegExp(`'${role}'`));
      assert.match(body.detail ?? '', /People page/);
    });
  }

  it('⚠️ tells a PENDING account it is awaiting approval — a different fix', async () => {
    // Sending somebody with an unapproved account to ask for a higher role is
    // sending them to ask for something that would not help.
    const res = await app('pending').request(
      '/api/admin/audiobooks/sweep',
      { method: 'POST' },
      envWith(stubDb()),
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { detail?: string };
    assert.match(body.detail ?? '', /waiting for an owner to approve/);
    assert.ok(!/owner-or-admin job/.test(body.detail ?? ''), 'that is the other refusal');
  });

  it('refuses the GET as well as the POST — reading is not free either', async () => {
    const res = await app('member').request('/api/admin/audiobooks/sweep', {}, envWith(stubDb()));
    assert.equal(res.status, 403);
  });

  it('a refused caller never reaches the database', async () => {
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response(CSV, { status: 200 });
    }) as typeof fetch;
    const db = stubDb();
    await app('member').request('/api/admin/audiobooks/sweep', { method: 'POST' }, envWith(db));
    assert.equal(fetched, false);
    assert.deepEqual(db._written, []);
  });
});

describe('POST — dryRun writes nothing', () => {
  it('🔴 `{"dryRun":true}` computes a plan and writes NOTHING, even in enforce', async () => {
    globalThis.fetch = (async () =>
      new Response(CSV, { status: 200, headers: { etag: '"x"' } })) as typeof fetch;
    const db = stubDb();
    const res = await app('owner').request(
      '/api/admin/audiobooks/sweep',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      },
      envWith(db, 'enforce'),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { state: string; plan: unknown; says: string };
    assert.equal(body.state, 'shadow');
    assert.ok(body.plan, 'a dry run still produces the plan — that is the point of it');
    assert.deepEqual(db._written, [], 'a dry run wrote to the catalogue');
    assert.match(body.says, /wrote nothing/);
  });

  it('⚠️ only an explicit `true` is a dry run — a typo is a real run', async () => {
    // The dangerous direction is a rehearsal read as a write. A truthy string
    // like "false" must not be what decides it, either way.
    globalThis.fetch = (async () =>
      new Response(CSV, { status: 200, headers: { etag: '"x"' } })) as typeof fetch;
    const db = stubDb();
    const res = await app('owner').request(
      '/api/admin/audiobooks/sweep',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dryRun: 'false' }),
      },
      envWith(db, 'enforce'),
    );
    const body = (await res.json()) as { state: string };
    assert.notEqual(body.state, 'shadow');
  });

  it('an admin run in SHADOW mode writes nothing, whatever the body says', async () => {
    globalThis.fetch = (async () =>
      new Response(CSV, { status: 200, headers: { etag: '"x"' } })) as typeof fetch;
    const db = stubDb();
    const res = await app('admin').request(
      '/api/admin/audiobooks/sweep',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      envWith(db, 'shadow'),
    );
    const body = (await res.json()) as { state: string };
    assert.equal(body.state, 'shadow');
    assert.deepEqual(db._written, []);
  });

  it('a refused sweep answers 200 with the reason in WORDS, not an HTTP error', async () => {
    // ⚠️ The request succeeded; the sweep refused. An HTTP error would put a
    // refused sweep and a broken route in one bucket — the exact distinction
    // §6.2's run rows exist to keep.
    globalThis.fetch = (async () =>
      new Response(HEADER, { status: 200, headers: { etag: '"x"' } })) as typeof fetch;
    const res = await app('owner').request(
      '/api/admin/audiobooks/sweep',
      { method: 'POST' },
      envWith(stubDb(), 'enforce'),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; state: string; says: string };
    assert.equal(body.ok, false);
    assert.equal(body.state, 'failed');
    assert.match(body.says, /refused to write, and that is the safe outcome/);
    assert.match(body.says, /Nothing in the catalogue was changed/);
  });
});

describe('🔴 POST — `force`, the flag that lets a dry run answer the gate', () => {
  /** An origin that behaves like the real one: 304 to a conditional GET, 200 otherwise. */
  function conditionalOrigin(etag: string) {
    const seen: (Record<string, string> | undefined)[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      seen.push(headers);
      if (headers && headers['If-None-Match'] === etag) return new Response(null, { status: 304 });
      return new Response(CSV, { status: 200, headers: { etag } });
    }) as typeof fetch;
    return seen;
  }

  it('without it, a dry run against an unchanged CSV returns `plan: null` — the bug', async () => {
    // Measured in production 2026-09-06: the route documented as *"the ONLY way
    // to answer the phase-1 gate"* answered `skipped` / `unchanged` for a day,
    // because the origin's etag had not moved since 04:23Z.
    conditionalOrigin('"abc"');
    const res = await app('owner').request(
      '/api/admin/audiobooks/sweep',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      },
      envWith(stubDb({ snapshotEtag: '"abc"' }), 'enforce'),
    );
    const body = (await res.json()) as { state: string; plan: unknown; detail: string };
    assert.equal(body.state, 'skipped');
    assert.equal(body.detail, 'unchanged');
    assert.equal(body.plan, null);
  });

  it('`{"dryRun":true,"force":true}` skips If-None-Match and ALWAYS returns a plan', async () => {
    const seen = conditionalOrigin('"abc"');
    const db = stubDb({ snapshotEtag: '"abc"' });
    const res = await app('owner').request(
      '/api/admin/audiobooks/sweep',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dryRun: true, force: true }),
      },
      envWith(db, 'enforce'),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { state: string; plan: unknown; says: string };
    assert.deepEqual(seen[0], {}, 'force must not send the stored etag');
    assert.equal(body.state, 'shadow');
    assert.ok(body.plan, 'the whole reason the flag exists');
    assert.deepEqual(db._written, [], 'and it is still a rehearsal');
  });

  it('⚠️ only an explicit `true` forces — `"true"` is not a forced fetch', async () => {
    // Same strictness as `dryRun`, for a different reason: a string that quietly
    // means `false` sends somebody back to the `plan: null` this flag ends.
    const seen = conditionalOrigin('"abc"');
    const res = await app('owner').request(
      '/api/admin/audiobooks/sweep',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dryRun: true, force: 'true' }),
      },
      envWith(stubDb({ snapshotEtag: '"abc"' }), 'enforce'),
    );
    const body = (await res.json()) as { state: string };
    assert.deepEqual(seen[0], { 'If-None-Match': '"abc"' });
    assert.equal(body.state, 'skipped');
  });

  it('⚠️ force WITHOUT dryRun is a real run — the flags are independent', async () => {
    // `force` decides what is fetched; `dryRun` and the mode decide what is
    // written. Conflating them is how a rehearsal turns out to have written.
    conditionalOrigin('"abc"');
    const db = stubDb({ snapshotEtag: '"abc"' });
    const res = await app('owner').request(
      '/api/admin/audiobooks/sweep',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true }),
      },
      envWith(db, 'enforce'),
    );
    const body = (await res.json()) as { state: string };
    assert.equal(body.state, 'applied');
    assert.ok(db._written.length > 0, 'a non-dry forced run is a real sweep');
  });
});

describe('/api/health — additive only, and it can never fail the check', () => {
  it('carries detail.audiobookSweep with the mode and the last run', async () => {
    const app = new Hono<AppBindings>();
    app.route('/api/health', healthRoutes);
    const res = await app.request('/api/health', {}, envWith(stubDb(), 'shadow'));
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      detail: { audiobookSweep: Record<string, unknown> };
    };
    const line = body.detail.audiobookSweep;
    assert.equal(line.mode, 'shadow');
    assert.equal(line.state, 'shadow');
    assert.equal(line.trigger, 'cron');
    assert.equal(line.editionsLive, 412);
    assert.equal(line.rungsLive, 780);
    assert.equal(typeof line.seriesCanonEntries, 'number');
  });

  it('🔴 carries the GATE counters, so the page answers the flip question itself', async () => {
    // Every other field here reads the LATEST run row — which is why the
    // 2026-09-06 flip attempt had to go to two production databases with a
    // `wrangler d1 execute` to find out that one `304` was hiding every plan
    // before it.
    const app = new Hono<AppBindings>();
    app.route('/api/health', healthRoutes);
    const res = await app.request('/api/health', {}, envWith(stubDb(), 'shadow'));
    const body = (await res.json()) as {
      detail: { audiobookSweep: { gate: Record<string, unknown> } };
    };
    const gate = body.detail.audiobookSweep.gate;
    assert.equal(gate.required, 42);
    assert.equal(gate.planTicks, 5);
    assert.equal(gate.seriesVolumeTicks, 3);
    assert.equal(gate.cronPlanTicks, 4);
    // ⚠️ NOT MEASURED, never zero: a divergence is the route's plan against the
    // script's, and the Worker has never seen the script's side.
    assert.equal(gate.divergences, null);
  });

  it('🔴 an instance without migration 0470 still answers ok', async () => {
    // An additive key that can take the status page red is not additive. Both
    // instances answer this route before they are migrated, every deploy.
    const broken = {
      prepare(sql: string) {
        const stmt = {
          bind: () => stmt,
          async first() {
            // The database is UP and `work` exists — this instance simply has
            // not had migration 0470 applied yet, which is the ordinary state
            // between a deploy and a migrate.
            if (/FROM sqlite_master/.test(sql)) return { n: 1 };
            throw new Error('D1_ERROR: no such table: audiobook_sweep_run');
          },
          async run() {
            throw new Error('D1_ERROR');
          },
          async all() {
            return { results: [] };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;

    const app = new Hono<AppBindings>();
    app.route('/api/health', healthRoutes);
    const res = await app.request('/api/health', {}, envWith(broken, 'shadow'));
    const body = (await res.json()) as {
      ok: boolean;
      detail: {
        audiobookSweep: {
          mode: string;
          state: unknown;
          editionsLive: unknown;
          gate: Record<string, unknown>;
        };
      };
    };
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    // The posture is still readable — it is a var, not a row.
    assert.equal(body.detail.audiobookSweep.mode, 'shadow');
    assert.equal(body.detail.audiobookSweep.state, null);
    assert.equal(body.detail.audiobookSweep.editionsLive, null);
    // ⚠️ The counters degrade to NULL, not to 0. "The table is not there" and
    // "42 are required and none have happened" are different facts, and a zero
    // would read as the second while meaning the first.
    assert.equal(body.detail.audiobookSweep.gate.planTicks, null);
    assert.equal(body.detail.audiobookSweep.gate.seriesVolumeTicks, null);
    assert.equal(body.detail.audiobookSweep.gate.required, 42);
  });

  it('⚠️ publishes no edition title and no narrator', async () => {
    const app = new Hono<AppBindings>();
    app.route('/api/health', healthRoutes);
    const res = await app.request('/api/health', {}, envWith(stubDb(), 'shadow'));
    const text = await res.text();
    assert.ok(!/narrator/i.test(text), 'the unauthenticated route named a narrator');
    assert.ok(!/Primal Hunter/.test(text), 'the unauthenticated route named a recording');
  });
});

describe('GET — the last run', () => {
  it('reports the mode, the last run and the live counts, worded', async () => {
    const res = await app('owner').request(
      '/api/admin/audiobooks/sweep',
      {},
      envWith(stubDb(), 'shadow'),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      mode: string;
      lastRun: { state: string } | null;
      holdings: { editionsLive: number; rungsLive: number };
      says: string;
    };
    assert.equal(body.mode, 'shadow');
    assert.equal(body.lastRun?.state, 'shadow');
    assert.equal(body.holdings.editionsLive, 412);
    assert.match(body.says, /wrote nothing/);
  });
});
