/**
 * `POST /api/gabi/turn`, and the per-instance POSTURE that decides whether it
 * exists at all.
 *
 * Three ways this feature can be silently wrong, one group each:
 *
 *   1. **The posture drifts.** `GABI_PANEL` is the answer to "does GABI exist on
 *      this site?", and the two instances serve the SAME bundle from the same
 *      commit — so the only thing separating them is two lines in
 *      `wrangler.toml`. This file reads that file and fails if the design's §2
 *      scoping ("Her instance only … The main library is out of scope") ever
 *      stops being what is deployed. It is the same guard
 *      `instance-default-theme.test.ts` puts on `DEFAULT_THEME` and
 *      `details-sweep.test.ts` puts on the cron string, and it exists because
 *      all three are settings whose drift nothing else would notice.
 *   2. **The route stops answering the way the lib decides.** A handler that
 *      swallowed an outcome's status, or wrapped its body, would turn a worded
 *      refusal into a bare one.
 *   3. **The gate moves.** Covered next door in `capability-wiring.test.ts`,
 *      which asserts the refusal names `runResearch` off the wire — `scanPhoto`,
 *      `runResearch` and `reviewFindings` hold identical role sets, so only the
 *      NAME can tell them apart.
 *
 * ⚠️ Nothing here can spend money: `stubEnv` holds no `ANTHROPIC_API_KEY`, and
 * the posture guard refuses before the key is even looked at.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { gabiPanelEnabled, type AppUser, type Role } from '@lc/core';
import type { AppBindings, Env } from '../env.js';
import { gabiRoutes } from './gabi.js';
import { healthRoutes } from './health.js';

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url).href), 'utf8');
}

const WRANGLER = repoFile('apps/worker/wrangler.toml');

/**
 * A TOML table's body — from its header to the next header, skipping comment
 * lines as terminators so a `# [something]` in prose cannot end a section early.
 * Lifted from `apps/web/test/instance-default-theme.test.ts`, deliberately: the
 * two files pin two different vars in the same file the same way.
 */
function tomlTable(header: string): string {
  const lines = WRANGLER.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);
  assert.notEqual(start, -1, `wrangler.toml has no ${header} table`);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim().startsWith('#') && /^\s*\[/.test(line)) break;
    body.push(line);
  }
  return body.join('\n');
}

function tomlString(body: string, key: string): string {
  const match = body.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm'));
  assert.ok(match, `expected ${key} in that wrangler.toml table`);
  return match[1]!;
}

// ── the world, minus everything that costs money ────────────────────────────

const stubDb = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(`DB_TOUCHED(${String(prop)}) — nothing in this file should reach D1`);
    },
  },
);

function envWith(overrides: Partial<Env> = {}): Env {
  return { DB: stubDb, ...overrides } as unknown as Env;
}

function userWith(role: Role): AppUser {
  return {
    id: 1,
    email: 'sam@example.com',
    firebaseUid: null,
    displayName: 'Sam',
    reviewName: null,
    photoUrl: null,
    role,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:00:00.000Z',
  };
}

async function turn(env: Env, role: Role, body: unknown) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('user', userWith(role));
    await next();
  });
  app.route('/', gabiRoutes);
  app.onError((err, c) => c.json({ error: 'handler_ran', detail: err.message }, 500));
  const res = await app.request(
    '/turn',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    env,
  );
  return { status: res.status, body: (await res.json()) as { error?: string; detail?: string } };
}

// ── 1. the posture ──────────────────────────────────────────────────────────

describe('⚠️ the per-instance posture: HER instance only, and wrangler.toml says so', () => {
  it('the friend instance has the panel ON — that is the whole feature', () => {
    const flag = tomlString(tomlTable('[env.friend.vars]'), 'GABI_PANEL');
    assert.equal(
      gabiPanelEnabled(flag),
      true,
      `[env.friend.vars] GABI_PANEL is "${flag}" — the panel is off on the one instance it is for`,
    );
  });

  it('⚠️ the MAIN instance has it ON — owner decision 2026-08-17 superseding §12.8', () => {
    // §12.8's v1-no held for exactly one day: the owner ordered "Add it to my
    // catalog for my wife to use" (2026-08-17; Amber is admin here, measured),
    // exercising his recorded "we can always change later". The spend on this
    // instance is the OWNER'S key. This test still pins the posture BOTH ways:
    // turning it back off is equally an owner decision, not a deploy artifact.
    const flag = tomlString(tomlTable('[vars]'), 'GABI_PANEL');
    assert.equal(
      gabiPanelEnabled(flag),
      true,
      `[vars] GABI_PANEL is "${flag}" — the main catalog's panel posture changed ` +
        'without an owner decision recorded here. The last recorded decision (2026-08-17) is ON.',
    );
  });

  it('the flag is DECLARED on both, so "is it on here?" is never an absence', () => {
    // Unset already means off, so this is about legibility rather than safety:
    // the posture of record should be readable in one file without knowing that
    // a missing line means something.
    for (const table of ['[vars]', '[env.friend.vars]']) {
      assert.match(tomlTable(table), /^\s*GABI_PANEL\s*=/m, `${table} does not declare GABI_PANEL`);
    }
  });

  it('the hostname the panel lights on is the one the friend env claims', () => {
    // Ties the posture to the site a person will actually visit — the same
    // pairing instance-default-theme.test.ts asserts for `hearts`.
    assert.equal(tomlString(tomlTable('[[env.friend.routes]]'), 'pattern'), 'padhard.heygabi.ai');
  });
});

describe('/api/health reports the posture, with no sign-in', () => {
  async function health(env: Env) {
    const app = new Hono<AppBindings>();
    app.route('/', healthRoutes);
    const res = await app.request('/', {}, env);
    return (await res.json()) as { gabi?: { panel?: boolean }; detail?: { gabi?: { panel?: boolean } } };
  }

  it('says true where the flag is on', async () => {
    // The route reads D1 for `database`, so this uses a stub that answers rather
    // than the throwing one — the posture is what is under test, not health.
    const db = { prepare: () => ({ first: async () => ({ ok: 1 }) }) } as unknown as D1Database;
    const body = await health({ DB: db, GABI_PANEL: 'on', APP_VERSION: 'x' } as unknown as Env);
    assert.equal(body.gabi?.panel, true);
    assert.equal(body.detail?.gabi?.panel, true, 'the envelope copy disagrees with the top level');
  });

  it('says false where it is unset — the curl a deploy is verified with', async () => {
    const db = { prepare: () => ({ first: async () => ({ ok: 1 }) }) } as unknown as D1Database;
    const body = await health({ DB: db, APP_VERSION: 'x' } as unknown as Env);
    assert.equal(body.gabi?.panel, false);
  });
});

// ── 2. the route ────────────────────────────────────────────────────────────

describe('the route hands back what the lib decided, unwrapped', () => {
  it('⚠️ 404 with a sentence where the posture is off — the disabled-not-open idiom', async () => {
    const out = await turn(envWith({ GABI_PANEL: 'off' }), 'owner', {
      conversationId: 'c',
      messages: [{ role: 'user', content: 'hello' }],
    });
    assert.equal(out.status, 404);
    assert.equal(out.body.error, 'gabi_disabled');
    assert.match(String(out.body.detail), /not switched on/i);
  });

  it('503 with the fix where the posture is on and no key is configured', async () => {
    const out = await turn(envWith({ GABI_PANEL: 'on' }), 'owner', {
      conversationId: 'c',
      messages: [{ role: 'user', content: 'hello' }],
    });
    assert.equal(out.status, 503);
    assert.equal(out.body.error, 'not_configured');
    assert.match(String(out.body.detail), /ANTHROPIC_API_KEY/);
  });

  it('400 on a body that is not a conversation — never a bare status', async () => {
    const out = await turn(envWith({ GABI_PANEL: 'on' }), 'owner', {});
    assert.equal(out.status, 400);
    assert.ok(String(out.body.detail).length > 20, 'the refusal did not say anything');
  });

  it('a garbled body is a 400, not a 500 — JSON.parse failure is a user error here', async () => {
    const app = new Hono<AppBindings>();
    app.use('*', async (c, next) => {
      c.set('user', userWith('owner'));
      await next();
    });
    app.route('/', gabiRoutes);
    const res = await app.request(
      '/turn',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' },
      envWith({ GABI_PANEL: 'on' }),
    );
    assert.equal(res.status, 400);
  });
});

// ── 3. one route, and only one ──────────────────────────────────────────────

describe('⚠️ there is exactly ONE gabi route, and that is the architecture', () => {
  it('nothing else is mounted under /api/gabi', () => {
    // A second route here would be the first step back toward a server-side
    // loop, which the design refuses on subrequest arithmetic (§3.1 option A):
    // a six-turn conversation that researches one book and patches two fields is
    // ~40 of the 50 an invocation gets, and going over TERMINATES the invocation
    // rather than throwing. Read off the source, because the mounted app's
    // router does not enumerate.
    const source = repoFile('apps/worker/src/routes/gabi.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    // ⚠️ The path must start with `/` — without that, `c.get('user')` matches
    // and the assertion reports a route that does not exist. Caught by running it.
    const declared = [...source.matchAll(/\.(get|post|patch|put|delete)\(\s*'(\/[^']*)'/g)].map(
      (m) => `${m[1]!.toUpperCase()} ${m[2]}`,
    );
    assert.deepEqual(declared, ['POST /turn'], `gabi.ts now declares: ${declared.join(', ')}`);
  });

  it('and it is gated on runResearch — the capability that means "this costs money"', () => {
    const source = repoFile('apps/worker/src/routes/gabi.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(source, /requireCapability\('runResearch'\)/);
    // ⚠️ NOT editCatalog. The route spends her key; the WRITING risk is carried
    // by the tool endpoints, each behind its own gate, reached by her browser
    // with her own token. routes/research.ts's header makes the same split.
    assert.doesNotMatch(source, /requireCapability\('editCatalog'\)/);
  });
});
