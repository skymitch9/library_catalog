/**
 * estate-members.test.ts — the estate roster door for the lend picker.
 *
 * 🔴 EVERY FAILURE HERE IS `null` (UNKNOWN), and `null` is not `[]`. The save
 * path refuses on `null`; the picker says "estate list unavailable". A failure
 * collapsed into `[]` would read as "nobody is approved" — false, silently.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fetchEstateMembers } from './estate-members.js';
import type { Env } from '../env.js';

const ENV = {
  ESTATE_AUTH_URL: 'https://auth.example/',
  ESTATE_APP: 'library',
  ESTATE_APP_TOKEN_LIBRARY: 'token-under-test',
} as unknown as Env;

function answering(body: unknown, status = 200) {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

test('a well-formed roster rides through, ids as text, emails lower-cased', async () => {
  const out = await fetchEstateMembers(ENV, {
    fetchImpl: answering({
      members: [
        { id: 7, email: 'Sam@Example.TEST ', display_name: ' Samantha ' },
        { id: 'abc', email: 'ran@example.test', display_name: null },
      ],
    }),
  });
  assert.deepEqual(out, [
    { estateId: '7', email: 'sam@example.test', displayName: 'Samantha' },
    { estateId: 'abc', email: 'ran@example.test', displayName: null },
  ]);
});

test('🔴 an empty roster is [] — the directory answered', async () => {
  assert.deepEqual(await fetchEstateMembers(ENV, { fetchImpl: answering({ members: [] }) }), []);
});

test('🔴 a 404 (auth Worker not deployed yet) is null, not []', async () => {
  assert.equal(await fetchEstateMembers(ENV, { fetchImpl: answering({}, 404) }), null);
});

test('a non-200 success code is null too', async () => {
  assert.equal(await fetchEstateMembers(ENV, { fetchImpl: answering({ members: [] }, 204) }), null);
});

test('⚠️ a body without a members array is null', async () => {
  for (const body of [{}, { members: 'x' }, { members: null }, null, []]) {
    assert.equal(
      await fetchEstateMembers(ENV, { fetchImpl: answering(body) }),
      null,
      JSON.stringify(body),
    );
  }
});

test('⚠️ malformed elements are dropped and the rest still count', async () => {
  const out = await fetchEstateMembers(ENV, {
    fetchImpl: answering({
      members: [
        null,
        'sam',
        { id: 1, email: 'no-at-sign', display_name: 'A' },
        { id: -3, email: 'a@b.test', display_name: 'B' },
        { id: 1.5, email: 'a@b.test', display_name: 'B' },
        { id: '', email: 'a@b.test', display_name: 'B' },
        { id: 2, email: 42, display_name: 'C' },
        { id: 3, email: 'c@d.test', display_name: 99 },
        { id: 4, email: 'ok@d.test', display_name: 'Okay' },
        { id: 4, email: 'dupe@d.test', display_name: 'Dupe id' },
      ],
    }),
  });
  assert.deepEqual(out, [{ estateId: '4', email: 'ok@d.test', displayName: 'Okay' }]);
});

test('a thrown fetch (network, timeout) is null', async () => {
  const out = await fetchEstateMembers(ENV, {
    fetchImpl: (async () => {
      throw new Error('timeout');
    }) as typeof fetch,
  });
  assert.equal(out, null);
});

test('presents this instance’s bearer to the members route', async () => {
  const seen: Array<{ url: string; auth: string | null }> = [];
  await fetchEstateMembers(
    { ...ENV, ESTATE_APP: 'library2', ESTATE_APP_TOKEN_LIBRARY2: 'friend-token' } as unknown as Env,
    {
      fetchImpl: (async (url: string, init?: RequestInit) => {
        seen.push({ url, auth: new Headers(init?.headers).get('Authorization') });
        return new Response(JSON.stringify({ members: [] }));
      }) as unknown as typeof fetch,
    },
  );
  assert.deepEqual(seen, [{ url: 'https://auth.example/api/estate/members', auth: 'Bearer friend-token' }]);
});

test('⚠️ an unconfigured door asks nothing and answers unknown', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}');
  }) as typeof fetch;
  assert.equal(await fetchEstateMembers({ ...ENV, ESTATE_APP_TOKEN_LIBRARY: '' } as unknown as Env, { fetchImpl }), null);
  assert.equal(await fetchEstateMembers({ ...ENV, ESTATE_AUTH_URL: '' } as unknown as Env, { fetchImpl }), null);
  assert.equal(await fetchEstateMembers({ ...ENV, ESTATE_APP: 'nonsense' } as unknown as Env, { fetchImpl }), null);
  assert.equal(calls, 0);
});
