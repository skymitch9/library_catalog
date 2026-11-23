/**
 * Lending to an estate member who has never signed in — `GET /api/members`
 * and the copy writes, end to end through the real routes on a real SQLite
 * (every migration applied), with only the auth Worker's roster stubbed.
 *
 * What is pinned, and why each would be silent if wrong:
 *   * no email ever reaches the browser (the roster carries them server-side);
 *   * estate-only names go to `manageUsers` callers only, and the auth Worker
 *     is not even asked for anyone else;
 *   * KI-10: a garbled or unknown estate id is REFUSED IN WORDS — never saved
 *     as plain text with a 200 — on both PATCH and POST;
 *   * a refusal changes nothing: no copy write, and no placeholder account.
 */
import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser, Role } from '@lc/core';
import { findUserByEmail, upsertUserOnLogin } from '@lc/db';
import { realD1 } from '../../../../packages/db/test/real-d1.js';
import type { AppBindings, Env } from '../env.js';
import { catalogRoutes } from './catalog.js';
import { userRoutes } from './users.js';

const realFetch = globalThis.fetch;
let rosterCalls = 0;

/** Stub the auth Worker's `GET /api/estate/members`. */
function roster(body: unknown, status = 200) {
  globalThis.fetch = (async (url: string) => {
    assert.match(String(url), /\/api\/estate\/members$/);
    rosterCalls += 1;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

const ROSTER = {
  members: [
    { id: 101, email: 'sam@example.test', display_name: 'Samantha' },
    { id: 102, email: 'OWNER@example.test', display_name: 'Owner (estate)' },
    { id: 103, email: 'ranika@example.test', display_name: 'Ranika' },
    { id: 104, email: 'nameless@example.test', display_name: null },
  ],
};

let db: ReturnType<typeof realD1>;
let owner: AppUser;
let lentCopyId: number;
let ownedCopyId: number;
let workId: number;

beforeEach(async () => {
  rosterCalls = 0;
  db = realD1();
  owner = await upsertUserOnLogin(db.d1, { email: 'owner@example.test', firebaseUid: 'u1', displayName: 'The Owner' });
  // Ranika signed in once and was never approved: pending, so not offered locally.
  await upsertUserOnLogin(db.d1, { email: 'ranika@example.test', firebaseUid: 'u3', displayName: 'Ranika G' });
  db.sqlite
    .prepare(`INSERT INTO work (title, authors, primary_author, work_key) VALUES ('Dungeon Crawler Carl', 'Matt Dinniman', 'Matt Dinniman', 'dcc')`)
    .run();
  workId = Number((db.sqlite.prepare('SELECT id FROM work').get() as { id: number }).id);
  db.sqlite.prepare(`INSERT INTO copy (work_id, status) VALUES (?, 'lent')`).run(workId);
  db.sqlite.prepare(`INSERT INTO copy (work_id, status) VALUES (?, 'owned')`).run(workId);
  const ids = db.sqlite.prepare('SELECT id, status FROM copy ORDER BY id').all() as Array<{ id: number; status: string }>;
  lentCopyId = ids[0]!.id;
  ownedCopyId = ids[1]!.id;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function app(role: Role, as: AppUser = owner) {
  const a = new Hono<AppBindings>();
  a.use('*', async (c, next) => {
    c.set('user', { ...as, role });
    await next();
  });
  a.route('/api', userRoutes);
  a.route('/api', catalogRoutes);
  return a;
}

const env = () =>
  ({
    DB: db.d1,
    ESTATE_AUTH_URL: 'https://auth.example',
    ESTATE_APP: 'library',
    ESTATE_APP_TOKEN_LIBRARY: 'token-under-test',
  }) as unknown as Env;

async function patch(role: Role, copyId: number, body: unknown) {
  const res = await app(role).request(
    `/api/copies/${copyId}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    env(),
  );
  return { status: res.status, text: await res.clone().text(), json: (await res.json()) as Record<string, any> };
}

const copyRow = (id: number) =>
  ({
    ...(db.sqlite.prepare('SELECT status, person_user_id, person_name FROM copy WHERE id = ?').get(id) as object),
  }) as { status: string; person_user_id: number | null; person_name: string | null };
const userCount = () => (db.sqlite.prepare('SELECT COUNT(*) AS n FROM app_user').get() as { n: number }).n;

describe('GET /api/members', () => {
  it('🔴 an owner gets local + estate-only names, deduped, with NO email anywhere', async () => {
    roster(ROSTER);
    const res = await app('owner').request('/api/members', {}, env());
    assert.equal(res.status, 200);
    const text = await res.clone().text();
    assert.doesNotMatch(text, /@/, 'no email reaches the browser');
    const body = (await res.json()) as { members: Array<Record<string, unknown>>; estate: string };
    assert.equal(body.estate, 'ok');
    assert.deepEqual(body.members, [
      // Ranika's local row is pending, so she comes through the estate entry.
      { id: null, estateId: '103', displayName: 'Ranika' },
      { id: null, estateId: '101', displayName: 'Samantha' },
      // The owner is listed locally; the estate entry for the same email is dropped.
      { id: owner.id, estateId: null, displayName: 'The Owner' },
    ]);
    for (const m of body.members) assert.deepEqual(Object.keys(m).sort(), ['displayName', 'estateId', 'id']);
  });

  it('an ordinary editor gets the local list only, and the auth Worker is not asked', async () => {
    roster(ROSTER);
    const res = await app('contributor').request('/api/members', {}, env());
    const body = (await res.json()) as { members: unknown[]; estate: string };
    assert.equal(body.estate, 'not_requested');
    assert.deepEqual(body.members, [{ id: owner.id, estateId: null, displayName: 'The Owner' }]);
    assert.equal(rosterCalls, 0);
  });

  it('🔴 the auth Worker not deployed yet (404) is "unavailable", and local names still come', async () => {
    roster({ error: 'not_found' }, 404);
    const body = (await (await app('owner').request('/api/members', {}, env())).json()) as {
      members: unknown[];
      estate: string;
    };
    assert.equal(body.estate, 'unavailable');
    assert.equal(body.members.length, 1);
  });
});

describe('PATCH /api/copies/:id with personEstateId', () => {
  it('🔴 links an estate member who has never signed in, through a placeholder', async () => {
    roster(ROSTER);
    const before = userCount();
    const r = await patch('owner', lentCopyId, { personUserId: null, personName: 'Samantha', personEstateId: '101' });
    assert.equal(r.status, 200, r.text);
    const sam = await findUserByEmail(db.d1, 'sam@example.test');
    assert.ok(sam, 'a placeholder row exists');
    assert.equal(sam.placeholder, true);
    assert.equal(sam.role, 'pending');
    assert.equal(r.json.copy.person_user_id, sam.id, 'the response shows the link took');
    assert.equal(r.json.copy.person_name, 'Samantha', 'an owner sees the name');
    assert.equal(userCount(), before + 1);
    assert.deepEqual(copyRow(lentCopyId), { status: 'lent', person_user_id: sam.id, person_name: 'Samantha' });

    // Saving again links the SAME row — no second account.
    const again = await patch('owner', lentCopyId, { personUserId: null, personName: 'Samantha', personEstateId: '101' });
    assert.equal(again.json.copy.person_user_id, sam.id);
    assert.equal(userCount(), before + 1);

    // …and her first real sign-in claims that row.
    const signedIn = await upsertUserOnLogin(db.d1, {
      email: 'sam@example.test',
      firebaseUid: 'uid-sam',
      displayName: 'Sam Ellis',
    });
    assert.equal(signedIn.id, sam.id);
    assert.equal(signedIn.placeholder, false);
    assert.equal(signedIn.reviewName, 'Sam Ellis');
    assert.equal(signedIn.role, 'pending');
  });

  it('an estate pick for someone with a pending local row resolves to THAT row', async () => {
    roster(ROSTER);
    const ranika = await findUserByEmail(db.d1, 'ranika@example.test');
    const before = userCount();
    const r = await patch('owner', lentCopyId, { personName: 'Ranika', personEstateId: '103' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.copy.person_user_id, ranika!.id);
    assert.equal(userCount(), before);
  });

  it('🔴 KI-10: an UNKNOWN estate id is refused in words and nothing changes', async () => {
    roster(ROSTER);
    const before = userCount();
    const r = await patch('owner', lentCopyId, { personName: 'Samantha', personEstateId: '999' });
    assert.equal(r.status, 400);
    assert.equal(typeof r.json.detail, 'string');
    assert.match(r.json.detail, /not found among approved members/);
    assert.deepEqual(copyRow(lentCopyId), { status: 'lent', person_user_id: null, person_name: null });
    assert.equal(userCount(), before);
  });

  it('🔴 KI-10: a GARBLED estate id is refused with a human message, not stripped', async () => {
    roster(ROSTER);
    for (const bad of [101, '', { id: 1 }, null]) {
      const r = await patch('owner', lentCopyId, { personName: 'Samantha', personEstateId: bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
      const issues = r.json.detail as Array<{ path: string[]; message: string }>;
      assert.ok(Array.isArray(issues));
      assert.deepEqual(issues[0]!.path, ['personEstateId']);
      assert.match(issues[0]!.message, /pick the name again/, JSON.stringify(bad));
      assert.deepEqual(copyRow(lentCopyId), { status: 'lent', person_user_id: null, person_name: null });
    }
  });

  it('the estate roster unreachable → 503 in words, nothing saved, no account made', async () => {
    roster({}, 500);
    const before = userCount();
    const r = await patch('owner', lentCopyId, { personName: 'Samantha', personEstateId: '101' });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, 'estate_roster_unavailable');
    assert.match(r.json.detail, /could not be reached/);
    assert.equal(copyRow(lentCopyId).person_name, null);
    assert.equal(userCount(), before);
  });

  it('a contributor may not use an estate id — refused in words, roster not asked', async () => {
    roster(ROSTER);
    const before = userCount();
    const r = await patch('contributor', lentCopyId, { personName: 'Samantha', personEstateId: '101' });
    assert.equal(r.status, 403);
    assert.equal(r.json.capability, 'manageUsers');
    assert.match(r.json.detail, /owner or admin/);
    assert.equal(rosterCalls, 0);
    assert.equal(userCount(), before);
  });

  it('an OWNED copy is refused BEFORE any account is created', async () => {
    roster(ROSTER);
    const before = userCount();
    const r = await patch('owner', ownedCopyId, { personName: 'Samantha', personEstateId: '101' });
    assert.equal(r.status, 400);
    assert.match(r.json.detail, /lent out, borrowed or sold/);
    assert.equal(rosterCalls, 0);
    assert.equal(userCount(), before);
  });

  it('naming a local member AND an estate member in one save is refused', async () => {
    roster(ROSTER);
    const r = await patch('owner', lentCopyId, { personUserId: owner.id, personName: 'x', personEstateId: '101' });
    assert.equal(r.status, 400);
    assert.match(r.json.detail, /Pick one person/);
  });

  it('a typed name that matches nobody still saves as plain text, exactly as before', async () => {
    const r = await patch('contributor', lentCopyId, { personUserId: null, personName: 'A neighbour' });
    assert.equal(r.status, 200);
    assert.deepEqual(copyRow(lentCopyId), { status: 'lent', person_user_id: null, person_name: 'A neighbour' });
    assert.equal(rosterCalls, 0);
  });
});

describe('POST /api/copies with personEstateId (the lenient create schema)', () => {
  it('🔴 is resolved and linked, not stripped to plain text', async () => {
    roster(ROSTER);
    const res = await app('owner').request(
      '/api/copies',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workId, status: 'lent', personName: 'Samantha', personEstateId: '101' }),
      },
      env(),
    );
    assert.equal(res.status, 201);
    const body = (await res.json()) as { copy: { person_user_id: number | null; person_name: string } };
    const sam = await findUserByEmail(db.d1, 'sam@example.test');
    assert.equal(body.copy.person_user_id, sam!.id);
  });

  it('an unknown estate id on create is refused in words — no copy is created', async () => {
    roster(ROSTER);
    const copiesBefore = (db.sqlite.prepare('SELECT COUNT(*) AS n FROM copy').get() as { n: number }).n;
    const res = await app('owner').request(
      '/api/copies',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workId, status: 'lent', personName: 'Samantha', personEstateId: 'nope' }),
      },
      env(),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { detail: string };
    assert.equal(typeof body.detail, 'string');
    const copiesAfter = (db.sqlite.prepare('SELECT COUNT(*) AS n FROM copy').get() as { n: number }).n;
    assert.equal(copiesAfter, copiesBefore);
  });
});
