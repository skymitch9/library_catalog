/**
 * `replacePanelConversation` overwrites the stored window; it does not append
 * (2026-08 audit HIGH, `apps/worker/src/routes/gabi-memory.ts:139`).
 *
 * The bug: `PUT /api/gabi/memory` passed the caller's FULL conversation window
 * to `savePanelConversation`, which APPENDS — so every Discord save re-appended
 * the whole stored window and the shared record filled with duplicated turns.
 *
 * These tests use a tiny in-memory D1 fake (one row keyed by storage_key) to
 * show the contrast:
 *   - `replacePanelConversation` called twice with the same 2-turn window leaves
 *     2 turns stored (the fix);
 *   - `savePanelConversation` called twice with the same window leaves 4 (the
 *     append behaviour the route wrongly used).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConversationKey, ConversationTurn } from '@lc/gabi-conv';
import { replacePanelConversation, savePanelConversation } from '../src/gabi-conversation.ts';

/** A one-row in-memory store implementing just the statements these paths run. */
function fakeD1() {
  const store = new Map<string, string>();
  return {
    _store: store,
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first() {
          if (/SELECT record FROM gabi_conversation/i.test(sql)) {
            const rec = store.get(String(bound[0]));
            return rec ? { record: rec } : null;
          }
          return null;
        },
        async run() {
          if (/^\s*INSERT INTO gabi_conversation/i.test(sql)) {
            // bind order: (sk, surface, space, person, record, updated_at)
            store.set(String(bound[0]), String(bound[4]));
          } else if (/DELETE FROM gabi_conversation/i.test(sql)) {
            store.delete(String(bound[0]));
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database & { _store: Map<string, string> };
}

const KEY: ConversationKey = { surface: 'shared', space: 'library', person: '42' };

function window2(now: number): ConversationTurn[] {
  return [
    { role: 'user', text: 'hello', at: now },
    { role: 'assistant', text: 'hi there', at: now },
  ] as ConversationTurn[];
}

function storedTurnCount(db: D1Database & { _store: Map<string, string> }): number {
  const rec = db._store.get([KEY.surface, KEY.space, KEY.person].join(':'));
  // storage_key format is internal; just read the single stored row.
  const only = rec ?? [...db._store.values()][0];
  if (!only) return 0;
  return (JSON.parse(only) as { turns: unknown[] }).turns.length;
}

describe('replacePanelConversation vs savePanelConversation', () => {
  it('replace: saving the same full window twice keeps 2 turns (no duplication)', async () => {
    const db = fakeD1();
    const now = Date.now();
    await replacePanelConversation(db, KEY, window2(now), now);
    await replacePanelConversation(db, KEY, window2(now), now);
    assert.equal(storedTurnCount(db), 2);
  });

  it('save (append): the same full window twice duplicates to 4 turns — the bug', async () => {
    const db = fakeD1();
    const now = Date.now();
    await savePanelConversation(db, KEY, window2(now), now);
    await savePanelConversation(db, KEY, window2(now), now);
    assert.equal(storedTurnCount(db), 4);
  });
});
