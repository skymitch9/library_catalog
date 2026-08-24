/**
 * `gabi_conversation` — GABI's rolling memory for the site chat panel
 * (migration 0350).
 *
 * ⚠️ **THE STORAGE IS THIS REPO'S; THE SHAPE IS NOT.** Every record written
 * here is `ConversationRecord` from `@lc/gabi-conv` — materialised from
 * catalog-platform's `@platform/gabi-conversation`, byte-for-byte the shape
 * GABI's Discord surface writes into its Durable Object. This file is a
 * *store*: it decides where the bytes live and nothing about what they mean.
 * The window, the cap, the clip and the "aged out means deleted" rule are all
 * upstream, which is the whole point of the unification.
 *
 * ## The write budget, and the defect class it does not repeat
 *
 * The Discord side records this arithmetic in `gateway.ts` because a Durable
 * Object once wrote a row per gateway frame. D1 has no such ceiling to trip,
 * but the same discipline applies for a plainer reason — every write is
 * latency inside a request somebody is waiting on:
 *
 * | | Writes |
 * |---|---|
 * | `loadPanelConversation()` | **0** on the normal path. The prune is in memory. Its one possible write is a DELETE of a fully aged-out row — the garbage collection the privacy posture requires |
 * | `savePanelConversation()` | **1**, and only on an ANSWERED turn that produced prose |
 * | `sweepPanelConversations()` | **1** statement, and only when a save happens — see its own note |
 *
 * A turn that only asked for tools writes nothing here: it is a step inside an
 * exchange, not an exchange. That is decided in `@lc/gabi-conv`'s
 * `panelExchange()`, so the rule has one implementation and this file simply
 * obeys the empty array.
 *
 * ⚠️ **Never throws.** Same posture as `recordGabiTurn` next door, and for the
 * same reason its header gives: a memory that cannot be read must degrade into
 * *GABI does not remember this time*, never into a chat panel that returns 500.
 * The accounting becoming the outage is a shape this estate has measured
 * before. Every failure here logs and returns the do-nothing answer.
 */

import {
  appendTurns,
  conversationStorageKey,
  pruneConversation,
  CONVERSATION_WINDOW_MS,
  type ConversationKey,
  type ConversationRecord,
  type ConversationTurn,
} from '@lc/gabi-conv';

/** What a load gives the caller: the window, already pruned. */
export interface PanelMemory {
  turns: ConversationTurn[];
  /** True when a row existed and was deleted for being wholly outside the window. */
  collected: boolean;
}

const EMPTY: PanelMemory = { turns: [], collected: false };

/**
 * Read the window, and garbage-collect a row that has nothing left inside it.
 *
 * ⚠️ The DELETE is not an optimisation and must not be "tidied" into a
 * scheduled job. `pruneConversation()` returns `null` when a record has aged
 * out entirely and **every caller is required to answer that by deleting the
 * key** — an empty-but-present row leaves a key per person per instance
 * forever, and that key still says who talked to her and where.
 */
export async function loadPanelConversation(
  db: D1Database,
  key: ConversationKey,
  now: number = Date.now(),
): Promise<PanelMemory> {
  const sk = conversationStorageKey(key);
  try {
    const row = await db
      .prepare('SELECT record FROM gabi_conversation WHERE storage_key = ?')
      .bind(sk)
      .first<{ record: string }>();
    if (!row) return EMPTY;

    // ⚠️ A record that will not parse is treated as ABSENT, exactly as an
    // unknown shape version is upstream: guessing at a shape you do not
    // recognise is how one bad write becomes a permanent wrong answer.
    let stored: ConversationRecord | null = null;
    try {
      stored = JSON.parse(row.record) as ConversationRecord;
    } catch {
      stored = null;
    }

    const pruned = pruneConversation(stored, now);
    if (!pruned) {
      await db.prepare('DELETE FROM gabi_conversation WHERE storage_key = ?').bind(sk).run();
      return { turns: [], collected: true };
    }
    return { turns: pruned.turns, collected: false };
  } catch (err) {
    console.error('gabi_conversation: memory not read', err);
    return EMPTY;
  }
}

/**
 * Append one answered exchange and re-apply both limits.
 *
 * Returns what was actually persisted, so the caller can report it honestly
 * rather than assume the write landed.
 *
 * ⚠️ Re-reads before appending rather than trusting what the load returned.
 * Two tabs open on the same catalog are the same memory by design (one row per
 * person per instance), so a stale in-memory copy is a real possibility and the
 * cost of the extra read is one D1 statement on a path that is already making a
 * model call.
 */
export async function savePanelConversation(
  db: D1Database,
  key: ConversationKey,
  added: readonly ConversationTurn[],
  now: number = Date.now(),
): Promise<{ saved: boolean; turns: number }> {
  if (added.length === 0) return { saved: false, turns: 0 };
  const sk = conversationStorageKey(key);
  try {
    const row = await db
      .prepare('SELECT record FROM gabi_conversation WHERE storage_key = ?')
      .bind(sk)
      .first<{ record: string }>();

    let stored: ConversationRecord | null = null;
    if (row) {
      try {
        stored = JSON.parse(row.record) as ConversationRecord;
      } catch {
        stored = null;
      }
    }

    const next = appendTurns(stored, key, added, now);
    if (!next) {
      await db.prepare('DELETE FROM gabi_conversation WHERE storage_key = ?').bind(sk).run();
      return { saved: false, turns: 0 };
    }

    // ⚠️ INSERT … ON CONFLICT DO UPDATE, not "delete then insert". The two-
    // statement form has a window in which the memory does not exist, and D1
    // gives no transaction across separate statements on this path.
    await db
      .prepare(
        `INSERT INTO gabi_conversation (storage_key, surface, space, person, record, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(storage_key) DO UPDATE SET record = excluded.record,
                                                updated_at = excluded.updated_at`,
      )
      .bind(sk, key.surface, key.space, key.person, JSON.stringify(next), now)
      .run();
    return { saved: true, turns: next.turns.length };
  } catch (err) {
    console.error('gabi_conversation: memory not written', err);
    return { saved: false, turns: 0 };
  }
}

/**
 * Replace the stored window with exactly the given turns.
 *
 * ⚠️ Distinct from `savePanelConversation`, which APPENDS one just-said exchange
 * onto whatever is stored. A caller that already holds the authoritative full
 * window (the Discord side of `PUT /api/gabi/memory`) must REPLACE, not append —
 * appending the whole window on top of the stored window duplicates every turn
 * on every save. Building from `appendTurns(null, …)` starts from an empty base,
 * so the persisted record becomes precisely the provided window (still pruned,
 * clipped and windowed the same way a normal write is).
 *
 * Returns what was actually persisted, like `savePanelConversation`. An empty
 * `turns` (or a window that prunes to nothing) deletes the key rather than
 * leaving an empty-but-present row — the same privacy posture the load path has.
 */
export async function replacePanelConversation(
  db: D1Database,
  key: ConversationKey,
  turns: readonly ConversationTurn[],
  now: number = Date.now(),
): Promise<{ saved: boolean; turns: number }> {
  const sk = conversationStorageKey(key);
  try {
    // Start from an empty base: the result is exactly `turns`, not `turns`
    // stacked on top of what was already stored.
    const next = appendTurns(null, key, turns, now);
    if (!next) {
      await db.prepare('DELETE FROM gabi_conversation WHERE storage_key = ?').bind(sk).run();
      return { saved: false, turns: 0 };
    }

    // Same INSERT … ON CONFLICT DO UPDATE as savePanelConversation — never a
    // delete-then-insert, which has a window in which the memory does not exist.
    await db
      .prepare(
        `INSERT INTO gabi_conversation (storage_key, surface, space, person, record, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(storage_key) DO UPDATE SET record = excluded.record,
                                                updated_at = excluded.updated_at`,
      )
      .bind(sk, key.surface, key.space, key.person, JSON.stringify(next), now)
      .run();
    return { saved: true, turns: next.turns.length };
  } catch (err) {
    console.error('gabi_conversation: memory not replaced', err);
    return { saved: false, turns: 0 };
  }
}

/**
 * Delete every row whose window closed.
 *
 * ⚠️ **THE GARBAGE COLLECTION THAT `loadPanelConversation` CANNOT DO.** A
 * record is only collected on read, so a person who chats once and never
 * returns leaves half an hour of their words in the table indefinitely. That is
 * the privacy posture failing quietly, which is the worst way for a privacy
 * posture to fail — nothing is broken, nothing is logged, and the row is simply
 * still there.
 *
 * ⚠️ It runs on the SAVE path rather than on a cron, deliberately. This repo's
 * free cron slots are contended (a prior deploy in the estate FAILED on exactly
 * that), and a sweep that only runs when somebody is chatting is a sweep whose
 * frequency is proportional to the only thing that creates rows. One indexed
 * DELETE against a table with at most one row per person per instance is
 * cheaper than the model call it rides beside by orders of magnitude.
 *
 * ⚠️ It is a SEPARATE statement from the save and its failure is swallowed
 * separately, so a sweep that fails never costs somebody their answer.
 */
export async function sweepPanelConversations(
  db: D1Database,
  now: number = Date.now(),
): Promise<number> {
  try {
    const res = await db
      .prepare('DELETE FROM gabi_conversation WHERE updated_at < ?')
      .bind(now - CONVERSATION_WINDOW_MS)
      .run();
    return res.meta?.changes ?? 0;
  } catch (err) {
    console.error('gabi_conversation: sweep failed', err);
    return 0;
  }
}
