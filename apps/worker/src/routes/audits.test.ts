/**
 * The two audits' admin routes, and their key on `/api/health`.
 *
 * Three claims, all estate rules rather than local preferences:
 *
 *   - **A person never sees a bare HTTP status.** Every refusal says what
 *     happened, what it needs BY NAME, and how to get it — and the four causes
 *     stay distinct, because "awaiting approval" and "your role is too low" have
 *     different fixes and sending somebody to ask for the wrong one wastes an
 *     evening.
 *   - **The refusal is the SAME shape the audiobook sweep's routes use.** Since
 *     2026-09-06 that is literally true — one `lib/admin-refusal.ts`, three
 *     callers — and this file pins it from the audits' side so a change to the
 *     shared wording cannot quietly land on only one route.
 *   - **`/api/health` is ADDITIVE and can never go red over an audit.** The
 *     audits' tables are migration 0480; an un-migrated instance must still
 *     answer `ok`, with keys that say "never run" rather than lying.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppBindings, Env } from '../env.js';
import { auditRoutes } from './audits.js';
import { healthRoutes } from './health.js';

type Role = 'owner' | 'admin' | 'moderator' | 'contributor' | 'member' | 'guest' | 'pending';

const PATHS = ['/api/admin/audits/cover-health', '/api/admin/audits/series-aggregates'] as const;

/**
 * A database that answers every read this file's routes make.
 * `auditRow` is what `latestAuditRun` finds; `null` means "never run".
 */
function stubDb(auditRow: Record<string, unknown> | null = null) {
  const touched: string[] = [];
  const db = {
    prepare(sql: string) {
      touched.push(sql);
      const stmt = {
        bind() {
          return stmt;
        },
        async first() {
          if (/FROM sqlite_master/.test(sql)) return { n: 1 };
          if (/FROM audit_run WHERE audit/.test(sql)) return auditRow;
          if (/FROM audiobook_sweep_run/.test(sql)) return null;
          if (/FROM audiobook_snapshot/.test(sql)) return null;
          if (/COUNT\(\*\) AS total FROM work/.test(sql)) return { total: 411 };
          if (/COUNT\(\*\) AS total/.test(sql)) return { total: 411, missing: 4 };
          if (/audiobook_edition_holding/.test(sql)) return { editions: 0, rungs: 0 };
          return null;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
    _touched: touched,
  };
  return db as unknown as D1Database & { _touched: string[] };
}

function app(role: Role) {
  const a = new Hono<AppBindings>();
  a.use('*', async (c, next) => {
    c.set('user', { id: 1, email: 'a@b.test', displayName: 'A', role } as never);
    await next();
  });
  a.route('/api/admin', auditRoutes);
  return a;
}

function envWith(db: D1Database): Env {
  return { DB: db, SITE_ORIGIN: 'https://library.heygabi.ai' } as unknown as Env;
}

// ---------------------------------------------------------------------------

describe('the refusal — never a bare status', () => {
  for (const path of PATHS) {
    for (const role of ['member', 'contributor', 'moderator', 'guest'] as const) {
      it(`${path} refuses a ${role} in WORDS, naming the capability and the way out`, async () => {
        const res = await app(role).request(path, { method: 'POST' }, envWith(stubDb()));
        assert.equal(res.status, 403);
        const body = (await res.json()) as {
          capability?: string;
          role?: string;
          detail?: string;
        };
        assert.equal(body.capability, 'manageUsers');
        assert.equal(body.role, role);
        // What happened, what it needs, how to get it.
        assert.match(body.detail ?? '', /owner-or-admin/);
        assert.match(body.detail ?? '', new RegExp(`'${role}'`));
        assert.match(body.detail ?? '', /People page/);
        // …and what it costs the asker to hand it over: nothing, because these
        // two audits change nothing at all.
        assert.match(body.detail ?? '', /read-only/);
      });
    }

    it(`${path} tells a PENDING account it is awaiting approval — a different fix`, async () => {
      // Sending somebody with an unapproved account to ask for a higher role is
      // sending them to ask for something that would not help.
      const res = await app('pending').request(path, { method: 'POST' }, envWith(stubDb()));
      assert.equal(res.status, 403);
      const body = (await res.json()) as { detail?: string };
      assert.match(body.detail ?? '', /waiting for an owner to approve/);
      assert.ok(!/owner-or-admin job/.test(body.detail ?? ''), 'that is the other refusal');
    });

    it(`${path} refuses the GET as well as the POST — reading is not free either`, async () => {
      const res = await app('member').request(path, {}, envWith(stubDb()));
      assert.equal(res.status, 403);
    });
  }

  it('🔴 a refused caller never reaches the database', async () => {
    const db = stubDb();
    await app('member').request(PATHS[0], { method: 'POST' }, envWith(db));
    assert.deepEqual(db._touched, [], 'the gate ran after the work, not before it');
  });

  for (const role of ['owner', 'admin'] as const) {
    it(`an ${role} is let through`, async () => {
      const res = await app(role).request(PATHS[1], { method: 'POST' }, envWith(stubDb()));
      assert.equal(res.status, 200);
      const body = (await res.json()) as { audit?: string; state?: string };
      assert.equal(body.audit, 'series-aggregates');
      assert.ok(body.state);
    });
  }
});

describe('the answer is a REPORT, not an HTTP status', () => {
  it('a run that REFUSED still answers 200, with ok:false and the reason in words', async () => {
    // ⚠️ The REQUEST succeeded and the answer is the report. An HTTP error here
    // would put "the audit refused" and "the route is broken" in one bucket,
    // which is exactly the distinction the run row exists to keep.
    const db = {
      prepare() {
        const stmt = {
          bind() {
            return stmt;
          },
          async first() {
            return { id: 1, total: 0 };
          },
          async run() {
            return { meta: { changes: 1 } };
          },
          async all() {
            return { results: [] };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;

    const res = await app('owner').request(PATHS[1], { method: 'POST' }, envWith(db));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; state: string; says: string };
    assert.equal(body.ok, false);
    assert.equal(body.state, 'failed');
    assert.match(body.says, /refused/);
  });

  it('GET on an audit that has NEVER run says exactly that, and names the cron', async () => {
    const res = await app('owner').request(PATHS[0], {}, envWith(stubDb(null)));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { lastRun: unknown; says: string; cron: string };
    assert.equal(body.lastRun, null);
    assert.match(body.says, /never run on this instance/);
    assert.equal(body.cron, '47 9 * * *');
  });

  it('🔴 GET on a CLEAN run does not read as "never run"', async () => {
    // The two silences this whole vocabulary exists to separate.
    const res = await app('owner').request(
      PATHS[0],
      {},
      envWith(
        stubDb({
          id: 3,
          audit: 'cover-health',
          trigger: 'cron',
          started_at: '2026-09-06 09:47:00',
          finished_at: '2026-09-06 09:47:31',
          state: 'ok',
          detail_json: JSON.stringify({ detail: null, findings: { broken: 0 } }),
        }),
      ),
    );
    const body = (await res.json()) as { says: string };
    assert.match(body.says, /found nothing/);
    assert.match(body.says, /not the same thing as never having run/);
  });

  it('GET on a FAILED run says nothing was measured', async () => {
    const res = await app('owner').request(
      PATHS[1],
      {},
      envWith(
        stubDb({
          id: 4,
          audit: 'series-aggregates',
          trigger: 'cron',
          started_at: '2026-09-06 09:47:00',
          finished_at: '2026-09-06 09:47:01',
          state: 'failed',
          detail_json: JSON.stringify({ detail: 'empty-read', findings: null }),
        }),
      ),
    );
    const body = (await res.json()) as { says: string };
    assert.match(body.says, /REFUSED/);
    assert.match(body.says, /empty-read/);
    assert.match(body.says, /not evidence/);
  });
});

describe('/api/health carries both audits, additively', () => {
  async function health(db: D1Database) {
    const a = new Hono<AppBindings>().route('/', healthRoutes);
    const res = await a.request('/', {}, envWith(db));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it('both keys exist, at the top level and under `detail`', async () => {
    const { status, body } = await health(stubDb(null));
    assert.equal(status, 200);
    const detail = body.detail as Record<string, unknown>;
    for (const key of ['coverHealth', 'seriesAggregates']) {
      assert.ok(body[key], `${key} missing from the top level`);
      assert.ok(detail[key], `${key} missing from detail`);
    }
  });

  it('⚠️ nothing that was there before was removed', async () => {
    const { body } = await health(stubDb(null));
    for (const key of ['ok', 'version', 'database', 'universes', 'gabi', 'estate', 'audiobookSweep', 'time', 'service', 'detail']) {
      assert.ok(key in body, `${key} was dropped from /api/health`);
    }
  });

  it('"never run" is null-shaped, not zero-shaped', async () => {
    // A zero would read as "ran and found nothing", which is the opposite fact.
    const { body } = await health(stubDb(null));
    const ch = body.coverHealth as Record<string, unknown>;
    assert.equal(ch.lastRunAt, null);
    assert.equal(ch.state, null);
    assert.equal(ch.findings, null);
  });

  it('a completed run reports its state, its age and its COUNTS', async () => {
    const { body } = await health(
      stubDb({
        id: 9,
        audit: 'cover-health',
        trigger: 'cron',
        started_at: '2026-09-06 09:47:00',
        finished_at: '2026-09-06 09:47:33',
        state: 'findings',
        detail_json: JSON.stringify({
          detail: null,
          findings: { broken: 2, unreachable: 1, checked: 250 },
        }),
      }),
    );
    const ch = body.coverHealth as Record<string, unknown>;
    assert.equal(ch.state, 'findings');
    assert.equal(ch.trigger, 'cron');
    assert.equal((ch.findings as Record<string, number>).broken, 2);
    assert.equal(typeof ch.ageHours, 'number');
  });

  it('🔴 an UN-MIGRATED instance still answers ok — the audits cannot fail health', async () => {
    // `audit_run` is migration 0480. A `/status` page that goes red over a
    // background job's bookkeeping teaches people to ignore it.
    const db = {
      prepare(sql: string) {
        const stmt = {
          bind() {
            return stmt;
          },
          async first() {
            if (/FROM sqlite_master/.test(sql)) return { n: 1 };
            if (/audit_run/.test(sql)) throw new Error('D1_ERROR: no such table: audit_run');
            return null;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
          async all() {
            return { results: [] };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;

    const { status, body } = await health(db);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal((body.coverHealth as Record<string, unknown>).state, null);
  });
});
