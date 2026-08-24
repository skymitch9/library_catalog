/**
 * The peer-push holdings query must use the canonical HELD_STATUSES set
 * (2026-08 audit HIGH, `apps/worker/src/lib/peer-push.ts:89`).
 *
 * The bug: the query hardcoded `c.status IN ('owned', 'preordered', 'borrowed')`,
 * which contradicts HELD_STATUSES (`['owned','lent']`) in both directions — it
 * advertised borrowed and not-yet-delivered (preordered) books to another
 * household as things we hold, and hid books we own but have lent out.
 *
 * `buildPeerPayload` builds the query as a string, so we capture the SQL the
 * stub DB is handed and assert the status set is exactly HELD_STATUSES.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HELD_STATUSES } from '@lc/core';
import { buildPeerPayload } from './peer-push.js';

function capturingDb(sqlSink: string[]) {
  return {
    prepare(sql: string) {
      sqlSink.push(sql);
      const stmt = {
        bind() {
          return stmt;
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

describe('buildPeerPayload — held-copy status set', () => {
  it('filters copies on the canonical HELD_STATUSES, not a hand-rolled list', async () => {
    const sql: string[] = [];
    await buildPeerPayload(capturingDb(sql), 'self', 'Self Library', 'https://self.test');

    const holdingsQuery = sql.find((s) => /FROM work w/i.test(s));
    assert.ok(holdingsQuery, 'expected the holdings query to run');

    // Every held status appears in the IN clause.
    for (const status of HELD_STATUSES) {
      assert.match(
        holdingsQuery!,
        new RegExp(`'${status}'`),
        `held status '${status}' must be in the peer-push filter`,
      );
    }

    // The wrong statuses from the pre-fix list must NOT appear.
    for (const wrong of ['preordered', 'borrowed']) {
      assert.doesNotMatch(
        holdingsQuery!,
        new RegExp(`'${wrong}'`),
        `'${wrong}' is not a held status and must not be advertised to peers`,
      );
    }
  });
});
