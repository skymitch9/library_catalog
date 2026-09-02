/**
 * billing-system.test.ts — the SYSTEM door, the switch for the one biller here
 * that has no human.
 *
 * The hourly details sweep (L8) is fired by a cron: no request, no email, no
 * session, so `/seen` has nobody to answer about. It resolves through the
 * estate's fourth principal, `system`, and switching `sweep.details` off is the
 * only control in the estate that stops an unattended hourly biller without a
 * deploy (design §2.5, §3.4, §7.1).
 *
 * 🔴 EVERY FAILURE HERE IS `null`, AND `null` SWEEPS. §3.5 row 3's fail-open,
 * chosen out loud: an unreachable directory must not silently halt a pipeline
 * nobody is watching. `[]` stays a different fact from `null` all the way down.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fetchSystemDenied } from './billing-system.js';
import type { Env } from '../env.js';

const ENV = {
  ESTATE_AUTH_URL: 'https://auth.example',
  ESTATE_APP: 'library',
  ESTATE_APP_TOKEN_LIBRARY: 'token-under-test',
} as unknown as Env;

function answering(body: unknown, status = 200) {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

test('a system deny-set rides through in the directory’s own order', async () => {
  const out = await fetchSystemDenied(ENV, {
    fetchImpl: answering({ site: 'library', system_denied: ['sweep.details'] }),
  });
  assert.deepEqual(out, ['sweep.details']);
});

test('🔴 an empty answer is [] — the directory replied and denied nothing', async () => {
  const out = await fetchSystemDenied(ENV, { fetchImpl: answering({ system_denied: [] }) });
  assert.deepEqual(out, []);
  assert.notEqual(out, null);
});

test('🔴 an absent system_denied is null — UNKNOWN, and unknown sweeps', async () => {
  // A pre-0016 auth Worker mid-deploy answers no such field. Reading it as []
  // would report "nothing is denied" on the strength of silence.
  assert.equal(await fetchSystemDenied(ENV, { fetchImpl: answering({ site: 'library' }) }), null);
});

test('⚠️ a malformed system_denied dies into null, not into a partial list', async () => {
  for (const junk of ['sweep.details', 42, { sweep: true }, null]) {
    assert.equal(
      await fetchSystemDenied(ENV, { fetchImpl: answering({ system_denied: junk }) }),
      null,
      `${JSON.stringify(junk)} should not survive`,
    );
  }
});

test('⚠️ non-string entries are dropped and the rest of the list still counts', async () => {
  const out = await fetchSystemDenied(ENV, {
    fetchImpl: answering({ system_denied: ['sweep.details', 7, '', 'research.details'] }),
  });
  assert.deepEqual(out, ['sweep.details', 'research.details']);
});

test('a non-2xx is null, not an exception — a scheduled run has no response to put one in', async () => {
  assert.equal(await fetchSystemDenied(ENV, { fetchImpl: answering({}, 401) }), null);
});

test('a thrown fetch is null too', async () => {
  const out = await fetchSystemDenied(ENV, {
    fetchImpl: (async () => {
      throw new Error('network');
    }) as typeof fetch,
  });
  assert.equal(out, null);
});

test('⚠️ an unconfigured door asks nothing and answers unknown', async () => {
  const calls: string[] = [];
  const spy = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  assert.equal(
    await fetchSystemDenied({ ESTATE_APP: 'library' } as unknown as Env, { fetchImpl: spy }),
    null,
    'no ESTATE_AUTH_URL',
  );
  assert.equal(
    await fetchSystemDenied(
      { ESTATE_AUTH_URL: 'https://auth.example', ESTATE_APP: 'library' } as unknown as Env,
      { fetchImpl: spy },
    ),
    null,
    'no bearer',
  );
  assert.equal(calls.length, 0, 'a half-configured door must not call the directory');
});

test('🔴 the bearer follows ESTATE_APP — padhard presents HER token, never the main library’s', async () => {
  // Estate credentials F-5: the friend instance asserting the main library's
  // identity made `ESTATE_APP_TOKEN_LIBRARY2` an orphan nothing ever presented.
  // The same pairing rule has to hold on this door.
  let seen: string | null = null;
  const spy = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen = new Headers(init?.headers).get('authorization');
    return new Response(JSON.stringify({ system_denied: [] }), { status: 200 });
  }) as typeof fetch;

  await fetchSystemDenied(
    {
      ESTATE_AUTH_URL: 'https://auth.example',
      ESTATE_APP: 'library2',
      ESTATE_APP_TOKEN_LIBRARY: 'his',
      ESTATE_APP_TOKEN_LIBRARY2: 'hers',
    } as unknown as Env,
    { fetchImpl: spy },
  );
  assert.equal(seen, 'Bearer hers');
});

test('⚠️ an unrecognised ESTATE_APP asks nothing — it will not assert an identity it cannot name', async () => {
  const calls: string[] = [];
  const out = await fetchSystemDenied(
    {
      ESTATE_AUTH_URL: 'https://auth.example',
      ESTATE_APP: 'libary',
      ESTATE_APP_TOKEN_LIBRARY: 'his',
    } as unknown as Env,
    {
      fetchImpl: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
    },
  );
  assert.equal(out, null);
  assert.equal(calls.length, 0);
});

test('the door is the estate’s, and the path is spelled once', async () => {
  let url: string | null = null;
  await fetchSystemDenied(ENV, {
    fetchImpl: (async (input: RequestInfo | URL) => {
      url = String(input);
      return new Response(JSON.stringify({ system_denied: [] }), { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(url, 'https://auth.example/api/estate/billing/policy');
});
