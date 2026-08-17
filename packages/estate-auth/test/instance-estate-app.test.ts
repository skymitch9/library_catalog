/**
 * WHICH estate consumer each instance is — the F-5 fix, pinned.
 *
 * The bug this file exists to prevent, in full, because it was invisible for a
 * day and cost nothing to introduce: `gate.ts` declared `app: 'library'` in the
 * posture and read a hard-coded `ESTATE_APP_TOKEN_LIBRARY`, on BOTH wrangler
 * environments. One build, two Workers, one identity. So
 * `padhard.heygabi.ai` — a SECOND household's catalog — knocked on the estate
 * directory wearing the main library's badge; the `ESTATE_APP_TOKEN_LIBRARY2`
 * secret the auth Worker had held since 2026-08-16 was an orphan nothing ever
 * presented; and `vis_library2` (auth-worker migration 0007, DEFAULT 0,
 * written precisely so that "another household's shelf" is granted by hand)
 * described a door nobody ever knocked on.
 *
 * Nothing failed. No test went red, no log line looked wrong, no request 500'd
 * — a hard-coded identity is indistinguishable from a correct one until you
 * ask which instance is speaking. That is why the guards below are shaped the
 * way they are: every one of them fails on the MUTATION, not on the symptom.
 *
 *   1. re-hard-code `'library'` in the gate           → the log/identity tests
 *   2. re-hard-code the `ESTATE_APP_TOKEN_LIBRARY` read → the bearer test
 *   3. make an unrecognised ESTATE_APP fall back to `library` → the typo test
 *   4. set both wrangler envs to the same app         → the wrangler.toml test
 *
 * ⚠️ These do NOT prove the pairing is right. The app id is config; the
 * DIRECTORY resolves identity from the token's VALUE (`identifyApp` walks
 * `CONSUMER_APPS` and compares bytes). A right name over a wrong value is a
 * 401 the gate reports as `estate_unreachable`. The only proof of the value is
 * a live `/seen` — `wrangler tail --env friend` on a real sign-in reading
 * `"app":"library2"` together with `"src":"seen"`. See
 * docs/access/second-instance.md.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, test } from 'node:test';
import {
  APP_TOKEN_VAR,
  ESTATE_APPS,
  LIBRARY_POSTURE,
  describeEstateGate,
  estateGateCheck,
  resolveEstateApp,
  type GateEnv,
  type GateSubject,
} from '../src/gate.js';

const NOW = Date.parse('2026-08-17T12:00:00.000Z');

function subject(overrides: Partial<GateSubject> = {}): GateSubject {
  return {
    email: 'sam@example.com',
    firebaseUid: 'uid-2',
    displayName: 'Sam',
    role: 'member',
    approvedAt: '2026-08-16T00:00:00.000Z',
    estateStatus: null,
    estateCheckedAt: null,
    estateVisibilityJson: null,
    ...overrides,
  };
}

/** Records the Authorization header so a wrong bearer is visible, never printed. */
function seenFetch(status = 'approved') {
  const bearers: (string | null)[] = [];
  const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? null;
    bearers.push(auth);
    return new Response(JSON.stringify({ status, visibility: [] }), { status: 200 });
  }) as typeof fetch;
  return { impl, bearers };
}

const MAIN_ENV: GateEnv = {
  ESTATE_CHECK: 'enforce',
  ESTATE_AUTH_URL: 'https://auth.example',
  ESTATE_APP: 'library',
  ESTATE_APP_TOKEN_LIBRARY: 'main-bearer',
};

const FRIEND_ENV: GateEnv = {
  ESTATE_CHECK: 'enforce',
  ESTATE_AUTH_URL: 'https://auth.example',
  ESTATE_APP: 'library2',
  ESTATE_APP_TOKEN_LIBRARY2: 'friend-bearer',
};

// ── the resolver ────────────────────────────────────────────────────────────

test('unset ESTATE_APP is the posture default — the main instance is unchanged', () => {
  assert.deepEqual(resolveEstateApp(undefined), {
    app: 'library',
    tokenVar: 'ESTATE_APP_TOKEN_LIBRARY',
    invalid: null,
  });
  assert.deepEqual(resolveEstateApp(''), resolveEstateApp(undefined));
  assert.equal(LIBRARY_POSTURE.app, 'library', 'the declared posture is still the default identity');
});

test('library2 resolves to the LIBRARY2 secret name — same name both sides, per §6', () => {
  assert.deepEqual(resolveEstateApp('library2'), {
    app: 'library2',
    tokenVar: 'ESTATE_APP_TOKEN_LIBRARY2',
    invalid: null,
  });
  assert.deepEqual(resolveEstateApp(' library2 '), resolveEstateApp('library2'));
});

test('a typo does NOT fall back to `library` — that fallback IS the bug', () => {
  // ⚠️ The opposite of parseEstateMode/resolveDefaultRole on purpose. For those
  // two the safe answer is a working default; here the "default" would be the
  // main library's identity, asserted by an instance that is not it.
  for (const raw of ['libary2', 'LIBRARY2', 'library 2', 'games', 'audiobook', 'index']) {
    const out = resolveEstateApp(raw);
    assert.equal(out.app, null, `${raw} must not resolve to an identity`);
    assert.equal(out.tokenVar, null);
    assert.equal(out.invalid, raw.trim());
  }
});

test('the allowlist is THIS repo, not the whole estate directory', () => {
  // `games`/`index`/`audiobook` are real CONSUMER_APPS on the auth Worker and
  // must stay unreachable from here: one var edit should never let the library
  // catalog present itself as the audiobook site's consumer.
  assert.deepEqual([...ESTATE_APPS], ['library', 'library2']);
  assert.deepEqual(Object.keys(APP_TOKEN_VAR).sort(), ['library', 'library2']);
});

// ── the gate: which badge, which bearer ─────────────────────────────────────

describe('the gate asserts the identity its env declares', () => {
  it('main: logs app `library` and presents the LIBRARY bearer', async () => {
    const { impl, bearers } = seenFetch();
    const out = await estateGateCheck(MAIN_ENV, subject(), { fetchImpl: impl, nowMs: NOW });
    assert.equal(out.performed, true);
    assert.equal(JSON.parse(out.logLine ?? 'null').app, 'library');
    assert.deepEqual(bearers, ['Bearer main-bearer']);
  });

  it('friend: logs app `library2` and presents the LIBRARY2 bearer', async () => {
    const { impl, bearers } = seenFetch();
    const out = await estateGateCheck(FRIEND_ENV, subject(), { fetchImpl: impl, nowMs: NOW });
    assert.equal(out.performed, true);
    assert.equal(
      JSON.parse(out.logLine ?? 'null').app,
      'library2',
      'her tail line still says `library` — the app id has been hard-coded again',
    );
    assert.deepEqual(
      bearers,
      ['Bearer friend-bearer'],
      'her instance presented the wrong bearer — the token var has been hard-coded again',
    );
  });

  it('MUTATION GUARD: a library2 env holding only the LIBRARY token is OFF, not wrong', async () => {
    // The pre-fix state of her Worker, exactly: ESTATE_APP_TOKEN_LIBRARY set,
    // ESTATE_APP_TOKEN_LIBRARY2 absent. If the gate ever reads whichever token
    // it can find, this goes green and F-5 is back. It must instead behave as
    // OFF and NAME the secret it wanted — which is also the state her Worker
    // sits in between this deploy and the conductor piping her bearer, and the
    // reason that window is safe rather than a lockout.
    const { impl, bearers } = seenFetch();
    const out = await estateGateCheck(
      { ...FRIEND_ENV, ESTATE_APP_TOKEN_LIBRARY2: undefined, ESTATE_APP_TOKEN_LIBRARY: 'main-bearer' },
      subject(),
      { fetchImpl: impl, nowMs: NOW },
    );
    assert.equal(out.performed, false);
    assert.equal(out.skipReason, 'estate_config_unset');
    assert.equal(out.deny, null, 'a missing bearer must never refuse anyone');
    assert.deepEqual(bearers, [], 'no /seen call may be attempted with a borrowed bearer');
    const line = JSON.parse(out.logLine ?? 'null');
    assert.equal(line.app, 'library2');
    assert.deepEqual(line.missing, ['ESTATE_APP_TOKEN_LIBRARY2']);
  });

  it('an unrecognised ESTATE_APP is OFF, loud, and refuses nobody', async () => {
    const { impl, bearers } = seenFetch();
    const out = await estateGateCheck(
      { ...FRIEND_ENV, ESTATE_APP: 'libary2' },
      subject(),
      { fetchImpl: impl, nowMs: NOW },
    );
    assert.equal(out.performed, false);
    assert.equal(out.skipReason, 'estate_app_unrecognised');
    assert.equal(out.deny, null);
    assert.equal(out.wouldDeny, false);
    assert.deepEqual(bearers, []);
    const line = JSON.parse(out.logLine ?? 'null');
    assert.equal(line.event, 'estate_app_unrecognised');
    assert.equal(line.estate_app_raw, 'libary2');
    assert.equal(line.app, null, 'an unnameable instance must not claim an identity');
    assert.deepEqual(line.allowed, ['library', 'library2']);
  });
});

// ── the outside-observable signal ───────────────────────────────────────────

describe('/api/health can answer "which consumer is that Worker?" with no sign-in', () => {
  it('reports the identity, the secret NAME, the mode — and never a value', () => {
    assert.deepEqual(describeEstateGate(MAIN_ENV), {
      mode: 'enforce',
      app: 'library',
      tokenVar: 'ESTATE_APP_TOKEN_LIBRARY',
      configured: true,
    });
    assert.deepEqual(describeEstateGate(FRIEND_ENV), {
      mode: 'enforce',
      app: 'library2',
      tokenVar: 'ESTATE_APP_TOKEN_LIBRARY2',
      configured: true,
    });
    // No key of the answer may carry key material, now or after an edit.
    for (const env of [MAIN_ENV, FRIEND_ENV]) {
      const json = JSON.stringify(describeEstateGate(env));
      assert.doesNotMatch(json, /main-bearer|friend-bearer/, 'health must never carry a token value');
    }
  });

  it('`configured` goes false the moment either half is missing — the inert state is visible', () => {
    assert.equal(describeEstateGate({ ...FRIEND_ENV, ESTATE_APP_TOKEN_LIBRARY2: undefined }).configured, false);
    assert.equal(describeEstateGate({ ...FRIEND_ENV, ESTATE_AUTH_URL: undefined }).configured, false);
    // Wrong slot: her token under the main instance's name buys nothing.
    assert.equal(
      describeEstateGate({
        ...FRIEND_ENV,
        ESTATE_APP_TOKEN_LIBRARY2: undefined,
        ESTATE_APP_TOKEN_LIBRARY: 'main-bearer',
      }).configured,
      false,
    );
    const typo = describeEstateGate({ ...FRIEND_ENV, ESTATE_APP: 'libary2' });
    assert.equal(typo.app, null);
    assert.equal(typo.configured, false);
  });
});

// ── the config of record ────────────────────────────────────────────────────

/**
 * The same guard `details-sweep.test.ts` puts on the cron string and
 * `instance-default-theme.test.ts` puts on the theme: read wrangler.toml and
 * fail if the posture of record drifts from what the code needs.
 */
const WRANGLER = readFileSync(
  fileURLToPath(new URL('../../../apps/worker/wrangler.toml', import.meta.url).href),
  'utf8',
);

/** A TOML table's body — header to the next header, `#` lines never terminate. */
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
  return match[1];
}

describe('wrangler.toml declares one identity per instance, and they differ', () => {
  it('the main instance is `library`', () => {
    assert.equal(tomlString(tomlTable('[vars]'), 'ESTATE_APP'), 'library');
  });

  it('the friend instance is `library2`', () => {
    assert.equal(
      tomlString(tomlTable('[env.friend.vars]'), 'ESTATE_APP'),
      'library2',
      'padhard is asserting the main library’s identity again — this is F-5',
    );
  });

  it('two instances never share one identity, whatever the values become', () => {
    const main = tomlString(tomlTable('[vars]'), 'ESTATE_APP');
    const friend = tomlString(tomlTable('[env.friend.vars]'), 'ESTATE_APP');
    assert.notEqual(main, friend, 'both wrangler envs name the same estate consumer');
    for (const app of [main, friend]) {
      assert.ok(
        (ESTATE_APPS as readonly string[]).includes(app),
        `wrangler.toml declares ESTATE_APP = "${app}", which the gate would treat as OFF`,
      );
    }
  });

  it('the gate is the only reader — nothing hard-codes a token name beside it', () => {
    // Cheap structural guard: if a second file starts reading a bearer
    // directly, the identity stops being one decision in one place.
    const gate = readFileSync(fileURLToPath(new URL('../src/gate.ts', import.meta.url).href), 'utf8');
    const reads = [...gate.matchAll(/env\.ESTATE_APP_TOKEN_[A-Z0-9_]+/g)].map((m) => m[0]);
    assert.deepEqual(
      [...new Set(reads)].sort(),
      ['env.ESTATE_APP_TOKEN_LIBRARY', 'env.ESTATE_APP_TOKEN_LIBRARY2'],
      'gate.ts reads a bearer it should not, or has stopped reading one it should',
    );
    // …and both reads must live inside the single switch that APP_TOKEN_VAR
    // selects, never in estateGateCheck itself.
    const check = gate.slice(gate.indexOf('export async function estateGateCheck'));
    assert.doesNotMatch(
      check,
      /env\.ESTATE_APP_TOKEN_/,
      'estateGateCheck reads a bearer directly again — that is how the hard-code came back',
    );
  });
});
