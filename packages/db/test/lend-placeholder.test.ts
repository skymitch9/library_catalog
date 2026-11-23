/**
 * Lend placeholders (migration 0490) — an `app_user` row for an approved
 * estate member who has never signed in here, so a lent copy can LINK to them.
 *
 * 🔴 The safety property is that a placeholder is INERT: it grants nothing,
 * pre-decides nothing, and the person's real first sign-in ends in exactly the
 * state a fresh first sign-in would have. Every test here runs the shipping
 * SQL against a real SQLite with every migration applied (`real-d1.ts`),
 * because each guarantee is decided inside an INSERT/UPDATE's WHERE.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { memberDisplayNames } from '../src/editions.ts';
import {
  PlaceholderRefusedError,
  ensureLendPlaceholder,
  findUserByEmail,
  grantEstateDefaultRole,
  listMembers,
  listUsers,
  listedMemberEmails,
  setUserRole,
  upsertUserOnLogin,
} from '../src/users.ts';
import { realD1 } from './real-d1.ts';

const OWNER = 'owner@example.test';
const SAM = 'sam@example.test';

async function withOwner() {
  const db = realD1();
  const owner = await upsertUserOnLogin(db.d1, {
    email: OWNER,
    firebaseUid: 'uid-owner',
    displayName: 'The Owner',
  });
  assert.equal(owner.role, 'owner', 'fixture: the first sign-in bootstraps the owner');
  return { ...db, owner };
}

/** The columns a sign-in decides — everything the gate and the review bridge read. */
function signInState(sqlite: ReturnType<typeof realD1>['sqlite'], email: string) {
  return sqlite
    .prepare(
      `SELECT role, approved_at IS NULL AS unapproved, approved_by, review_name, display_name,
              firebase_uid, photo_url, placeholder, estate_status
         FROM app_user WHERE email = ?`,
    )
    .get(email);
}

describe('migration 0490', () => {
  it('existing rows read placeholder = 0, never NULL', async () => {
    const { sqlite } = await withOwner();
    const row = sqlite.prepare('SELECT placeholder FROM app_user WHERE email = ?').get(OWNER) as {
      placeholder: number;
    };
    assert.equal(row.placeholder, 0);
  });
});

describe('ensureLendPlaceholder — creating one', () => {
  it('writes the inert shape: pending, unapproved, no uid/photo/review name', async () => {
    const { d1, sqlite, owner } = await withOwner();
    const { user, created } = await ensureLendPlaceholder(d1, {
      email: SAM,
      displayName: 'Samantha (estate)',
      actorId: owner.id,
    });
    assert.equal(created, true);
    assert.equal(user.placeholder, true);
    assert.deepEqual(
      { ...(signInState(sqlite, SAM) as object) },
      {
        role: 'pending',
        unapproved: 1,
        approved_by: null,
        review_name: null,
        display_name: 'Samantha (estate)',
        firebase_uid: null,
        photo_url: null,
        placeholder: 1,
        estate_status: null,
      },
    );
    const audit = sqlite
      .prepare(`SELECT field, changed_by, changed_how, note FROM change_log WHERE entity = 'app_user' AND entity_id = ?`)
      .all(user.id) as Array<{ field: string; changed_by: number; changed_how: string; note: string }>;
    assert.equal(audit.length, 1, 'one audit row for the creation');
    assert.equal(audit[0]!.field, '__row__');
    assert.equal(audit[0]!.changed_by, owner.id);
    assert.equal(audit[0]!.changed_how, 'human');
    assert.match(audit[0]!.note, new RegExp(`lend placeholder created by user ${owner.id}`));
  });

  it('🔴 (b) refused into an EMPTY table — the bootstrap owner rule is neither triggered nor used up', async () => {
    const { d1, sqlite } = realD1();
    await assert.rejects(
      ensureLendPlaceholder(d1, { email: SAM, displayName: 'Sam', actorId: 1 }),
      PlaceholderRefusedError,
    );
    const n = sqlite.prepare('SELECT COUNT(*) AS n FROM app_user').get() as { n: number };
    assert.equal(n.n, 0, 'nothing was written');
    const log = sqlite.prepare('SELECT COUNT(*) AS n FROM change_log').get() as { n: number };
    assert.equal(log.n, 0, 'and no orphan audit row');
    // …and the bootstrap is still there for the real first sign-in.
    const first = await upsertUserOnLogin(d1, { email: OWNER, displayName: 'The Owner' });
    assert.equal(first.role, 'owner');
  });

  it('🔴 (b) refused when rows exist but no owner does', async () => {
    const { d1, sqlite } = realD1();
    sqlite.prepare(`INSERT INTO app_user (email, role) VALUES ('x@example.test', 'member')`).run();
    await assert.rejects(
      ensureLendPlaceholder(d1, { email: SAM, displayName: 'Sam', actorId: 1 }),
      PlaceholderRefusedError,
    );
    assert.equal(await findUserByEmail(d1, SAM), null);
  });

  it('(d) the same placeholder twice is ONE row and ONE audit row', async () => {
    const { d1, sqlite, owner } = await withOwner();
    const a = await ensureLendPlaceholder(d1, { email: SAM, displayName: 'Sam', actorId: owner.id });
    const b = await ensureLendPlaceholder(d1, { email: SAM, displayName: 'Sam', actorId: owner.id });
    assert.equal(a.user.id, b.user.id);
    assert.equal(b.created, false);
    const n = sqlite.prepare('SELECT COUNT(*) AS n FROM app_user WHERE email = ?').get(SAM) as { n: number };
    assert.equal(n.n, 1);
    const log = sqlite
      .prepare(`SELECT COUNT(*) AS n FROM change_log WHERE entity = 'app_user' AND entity_id = ?`)
      .get(a.user.id) as { n: number };
    assert.equal(log.n, 1);
  });

  it('(e) a mixed-case email resolves to the existing lower-cased row, never a second one', async () => {
    const { d1, sqlite, owner } = await withOwner();
    const real = await upsertUserOnLogin(d1, { email: SAM, firebaseUid: 'uid-sam', displayName: 'Sam' });
    const got = await ensureLendPlaceholder(d1, {
      email: '  Sam@Example.TEST ',
      displayName: 'Samantha',
      actorId: owner.id,
    });
    assert.equal(got.user.id, real.id);
    assert.equal(got.created, false);
    assert.equal(got.user.placeholder, false, 'an existing real account is used as it is');
    const n = sqlite.prepare('SELECT COUNT(*) AS n FROM app_user').get() as { n: number };
    assert.equal(n.n, 2);
  });

  it('a placeholder created with a mixed-case email is stored lower-cased', async () => {
    const { d1, sqlite, owner } = await withOwner();
    await ensureLendPlaceholder(d1, { email: 'SAM@example.test', displayName: 'Sam', actorId: owner.id });
    const row = sqlite.prepare('SELECT email FROM app_user WHERE placeholder = 1').get() as { email: string };
    assert.equal(row.email, SAM);
  });
});

describe('🔴 (a) a placeholder + first sign-in ≡ a fresh first sign-in', () => {
  for (const google of [
    { label: 'Google supplies a name', displayName: 'Sam Ellis', photoUrl: 'https://photo/s.png' },
    { label: 'Google supplies NO name', displayName: null, photoUrl: null },
  ]) {
    it(google.label, async () => {
      const fresh = await withOwner();
      await upsertUserOnLogin(fresh.d1, {
        email: SAM,
        firebaseUid: 'uid-sam',
        displayName: google.displayName,
        photoUrl: google.photoUrl,
      });

      const lent = await withOwner();
      await ensureLendPlaceholder(lent.d1, {
        email: SAM,
        displayName: 'Samantha (as the estate spells it)',
        actorId: lent.owner.id,
      });
      const claimed = await upsertUserOnLogin(lent.d1, {
        email: 'Sam@Example.test',
        firebaseUid: 'uid-sam',
        displayName: google.displayName,
        photoUrl: google.photoUrl,
      });

      assert.deepEqual(signInState(lent.sqlite, SAM), signInState(fresh.sqlite, SAM));
      assert.equal(claimed.placeholder, false);
      assert.equal(claimed.role, 'pending');
      assert.equal(claimed.reviewName, google.displayName ?? SAM, 'review_name is the INSERT branch’s choice');
      assert.notEqual(claimed.reviewName, 'Samantha (as the estate spells it)');
    });
  }

  it('the estate default-grant then applies exactly as for a new row', async () => {
    const { d1 } = await withOwner();
    const ph = await ensureLendPlaceholder(d1, { email: SAM, displayName: 'Sam', actorId: 1 });
    const u = await upsertUserOnLogin(d1, { email: SAM, firebaseUid: 'uid-sam', displayName: 'Sam' });
    assert.equal(u.id, ph.user.id);
    assert.equal(await grantEstateDefaultRole(d1, { userId: u.id, role: 'member' }), true);
  });

  it('a second sign-in after the claim is an ordinary existing-row sign-in', async () => {
    const { d1, sqlite } = await withOwner();
    await ensureLendPlaceholder(d1, { email: SAM, displayName: 'Sam', actorId: 1 });
    await upsertUserOnLogin(d1, { email: SAM, firebaseUid: 'uid-sam', displayName: 'Sam Ellis' });
    await upsertUserOnLogin(d1, { email: SAM, firebaseUid: 'uid-sam', displayName: 'Sam E.' });
    const row = sqlite.prepare('SELECT review_name, display_name FROM app_user WHERE email = ?').get(SAM) as {
      review_name: string;
      display_name: string;
    };
    assert.equal(row.review_name, 'Sam Ellis', 'review_name is never moved once set');
    assert.equal(row.display_name, 'Sam E.');
    const claims = sqlite
      .prepare(`SELECT COUNT(*) AS n FROM change_log WHERE field = 'placeholder'`)
      .get() as { n: number };
    assert.equal(claims.n, 1, 'the claim is audited once');
  });

  it('an owner who approved the placeholder before they signed in keeps that decision', async () => {
    const { d1, owner } = await withOwner();
    const ph = await ensureLendPlaceholder(d1, { email: SAM, displayName: 'Sam', actorId: owner.id });
    await setUserRole(d1, { userId: ph.user.id, role: 'member', approvedBy: owner.id });
    const u = await upsertUserOnLogin(d1, { email: SAM, firebaseUid: 'uid-sam', displayName: 'Sam' });
    assert.equal(u.role, 'member');
    assert.equal(u.placeholder, false, 'still cleared — the flag keys on placeholder, not on role');
    assert.equal(u.reviewName, 'Sam');
  });
});

describe('🔴 (c) OWNER_EMAILS recovery on a placeholder row', () => {
  it('forces owner on the first sign-in, as it would for a new row, and audits both', async () => {
    const { d1, sqlite, owner } = await withOwner();
    const ph = await ensureLendPlaceholder(d1, {
      email: 'second-owner@example.test',
      displayName: 'Second',
      actorId: owner.id,
    });
    const u = await upsertUserOnLogin(d1, {
      email: 'second-owner@example.test',
      firebaseUid: 'uid-2',
      displayName: 'Second Owner',
      ownerEmails: ['Second-Owner@example.test'],
    });
    assert.equal(u.role, 'owner');
    assert.ok(u.approvedAt);
    assert.equal(u.placeholder, false);
    assert.equal(u.reviewName, 'Second Owner');
    const fields = (
      sqlite
        .prepare(`SELECT field FROM change_log WHERE entity = 'app_user' AND entity_id = ? ORDER BY id`)
        .all(ph.user.id) as Array<{ field: string }>
    ).map((r) => r.field);
    assert.deepEqual(fields, ['__row__', 'placeholder', 'role']);
  });
});

describe('readers of app_user', () => {
  it('listMembers never offers a placeholder (it is pending) and listedMemberEmails agrees', async () => {
    const { d1, owner } = await withOwner();
    await ensureLendPlaceholder(d1, { email: SAM, displayName: 'Sam', actorId: owner.id });
    const members = await listMembers(d1);
    assert.deepEqual(
      members.map((m) => m.displayName),
      ['The Owner'],
    );
    assert.deepEqual([...(await listedMemberEmails(d1))], [OWNER]);
  });

  it('memberDisplayNames resolves a placeholder’s name, so the lent card shows it', async () => {
    const { d1, owner } = await withOwner();
    const ph = await ensureLendPlaceholder(d1, { email: SAM, displayName: 'Sam', actorId: owner.id });
    const names = await memberDisplayNames(d1, [ph.user.id]);
    assert.equal(names.get(ph.user.id), 'Sam');
  });

  it('listUsers carries the flag so the People page can tell a borrower from a sign-up', async () => {
    const { d1, owner } = await withOwner();
    await ensureLendPlaceholder(d1, { email: SAM, displayName: 'Sam', actorId: owner.id });
    const users = await listUsers(d1);
    assert.deepEqual(
      users.map((u) => [u.email, u.placeholder]),
      [
        [SAM, true],
        [OWNER, false],
      ],
    );
  });
});
