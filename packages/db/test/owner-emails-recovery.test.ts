/**
 * OWNER_EMAILS is re-applied on every sign-in, not only at INSERT
 * (2026-08 audit HIGH, `apps/worker/src/env.ts:57`).
 *
 * The bug: OWNER_EMAILS forced `owner` only when a NEW app_user row was created.
 * An existing row's role was refreshed for name/photo/uid but never re-forced,
 * so the mechanism could not recover the one situation it is documented for — a
 * row that already EXISTS with the wrong role (e.g. an owner demoted by
 * mistake). The fix re-forces `owner` on sign-in for any listed email whose row
 * holds another role, with an audit row.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { upsertUserOnLogin } from '../src/users.ts';

type Row = {
  id: number;
  email: string;
  firebase_uid: string | null;
  display_name: string | null;
  review_name: string | null;
  photo_url: string | null;
  role: string;
  first_seen_at: string;
  approved_at: string | null;
};

/** One-row app_user fake with a change_log sink and a batch that applies UPDATE + INSERT. */
function fakeDb(row: Row) {
  const changeLog: Array<Record<string, unknown>> = [];
  const applyStmt = (sql: string, bound: unknown[]) => {
    if (/^\s*UPDATE app_user/i.test(sql) && /role = 'owner'/i.test(sql)) {
      // bind order: (display_name, photo_url, firebase_uid, approved_at, id)
      row.display_name = bound[0] as string | null;
      row.photo_url = bound[1] as string | null;
      row.firebase_uid = bound[2] as string | null;
      row.approved_at = bound[3] as string | null;
      row.role = 'owner';
    } else if (/^\s*UPDATE app_user/i.test(sql)) {
      row.display_name = bound[0] as string | null;
      row.photo_url = bound[1] as string | null;
      row.firebase_uid = bound[2] as string | null;
    } else if (/INSERT INTO change_log/i.test(sql)) {
      // VALUES (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
      changeLog.push({
        entity: bound[1],
        field: bound[3],
        oldJson: bound[4],
        newJson: bound[5],
        changedHow: bound[7],
        note: bound[8],
      });
    }
  };
  const db = {
    _changeLog: changeLog,
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        _sql: sql,
        bind(...args: unknown[]) {
          bound = args;
          stmt._bound = args;
          return stmt;
        },
        _bound: [] as unknown[],
        async first() {
          if (/SELECT .* FROM app_user WHERE email = \?/i.test(sql)) {
            return row.email === String(bound[0]).toLowerCase() ? { ...row } : null;
          }
          return null;
        },
        async run() {
          applyStmt(sql, bound);
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
    async batch(stmts: Array<{ _sql: string; _bound: unknown[] }>) {
      for (const s of stmts) applyStmt(s._sql, s._bound);
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return db as unknown as D1Database & { _changeLog: typeof changeLog };
}

const baseRow = (role: string): Row => ({
  id: 7,
  email: 'owner@example.test',
  firebase_uid: 'uid-7',
  display_name: 'The Owner',
  review_name: 'The Owner',
  photo_url: null,
  role,
  first_seen_at: '2026-01-01 00:00:00',
  approved_at: '2026-01-01 00:00:00',
});

describe('upsertUserOnLogin — OWNER_EMAILS recovery hatch', () => {
  it('re-forces owner on sign-in for a listed email whose existing row is demoted', async () => {
    const db = fakeDb(baseRow('member'));
    const user = await upsertUserOnLogin(db, {
      email: 'owner@example.test',
      firebaseUid: 'uid-7',
      displayName: 'The Owner',
      ownerEmails: ['owner@example.test'],
    });
    assert.equal(user.role, 'owner', 'the demoted listed email is restored to owner');
    // Audit row records the role change.
    const roleChange = db._changeLog.find((r) => r.field === 'role');
    assert.ok(roleChange, 'a change_log row must record the recovery');
    assert.equal(roleChange!.oldJson, JSON.stringify('member'));
    assert.equal(roleChange!.newJson, JSON.stringify('owner'));
    assert.equal(roleChange!.changedHow, 'auto');
  });

  it('does NOT touch the role of an email that is not in OWNER_EMAILS', async () => {
    const db = fakeDb(baseRow('member'));
    const user = await upsertUserOnLogin(db, {
      email: 'owner@example.test',
      firebaseUid: 'uid-7',
      displayName: 'The Owner',
      ownerEmails: ['someone-else@example.test'],
    });
    assert.equal(user.role, 'member');
    assert.equal(db._changeLog.length, 0);
  });

  it('is a no-op audit-wise when the listed email is already owner', async () => {
    const db = fakeDb(baseRow('owner'));
    const user = await upsertUserOnLogin(db, {
      email: 'owner@example.test',
      firebaseUid: 'uid-7',
      displayName: 'The Owner',
      ownerEmails: ['owner@example.test'],
    });
    assert.equal(user.role, 'owner');
    assert.equal(db._changeLog.length, 0, 'no role change, so no audit row');
  });
});
