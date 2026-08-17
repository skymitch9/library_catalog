/**
 * `gabi_turn` — the conversational fixer's accounting row (migration 0330).
 *
 * One row per model call, written whether the call succeeded or not. The table's
 * own migration carries the reasoning; the short version is that
 * `docs/info/gabi-fixer-design.md` §7 is arithmetic over a published price table
 * and phase 0 is supposed to END with a measured number instead.
 *
 * ⚠️ **Nothing here reads or writes the catalog.** A turn costs money and says
 * nothing about a book; keeping it in its own file, its own table and its own
 * pair of functions is what stops "how much did the chat cost" from ever
 * becoming a join against `work`.
 */

/** What one turn cost, as the Worker knows it at the moment it writes the row. */
export interface GabiTurnRecord {
  conversationId: string;
  userId: number | null;
  model: string;
  effort: string | null;
  /** How many messages the browser sent — how deep into the conversation this was. */
  turnIndex: number | null;
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  /** `tool_use` blocks the model asked for. The BROWSER executes them; this counts them. */
  toolCalls: number | null;
  /** ⚠️ Set means the turn failed and the row exists anyway. See the migration. */
  errorMessage: string | null;
}

/**
 * Write one accounting row.
 *
 * ⚠️ **Never throws.** It is called from the turn route's success path *and*
 * from its failure path, and a bookkeeping error must not be the thing that
 * turns a working answer into a 500 — nor the thing that swallows the real
 * error on the way past. A failed write logs and returns `false`; the caller
 * carries on. The alternative was measured elsewhere in this estate and it is
 * always the same shape: the accounting becomes the outage.
 */
export async function recordGabiTurn(
  db: D1Database,
  input: GabiTurnRecord,
): Promise<boolean> {
  try {
    await db
      .prepare(
        `INSERT INTO gabi_turn
           (conversation_id, user_id, model, effort, turn_index, stop_reason,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
            tool_calls, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.conversationId,
        input.userId,
        input.model,
        input.effort,
        input.turnIndex,
        input.stopReason,
        input.inputTokens,
        input.outputTokens,
        input.cacheReadTokens,
        input.cacheCreationTokens,
        input.toolCalls,
        input.errorMessage,
      )
      .run();
    return true;
  } catch (err) {
    console.error('gabi_turn: accounting row not written', err);
    return false;
  }
}

export interface GabiSpend {
  turns: number;
  errors: number;
  conversations: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  toolCalls: number;
}

const EMPTY: GabiSpend = {
  turns: 0,
  errors: 0,
  conversations: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  toolCalls: 0,
};

/**
 * Everything this feature has ever spent, from the table rather than a counter.
 *
 * ⚠️ `COALESCE` on every SUM, exactly as `runTotals` does and for the reason its
 * comment records: `SUM()` over an empty table is NULL, not 0, and an untouched
 * catalog reported `errors: null` until somebody curled the route against a
 * database with no rows in it. Every instance starts empty here, so this one
 * would have shipped broken by default.
 */
export async function gabiSpend(db: D1Database, conversationId?: string): Promise<GabiSpend> {
  const where = conversationId ? 'WHERE conversation_id = ?' : '';
  const stmt = db.prepare(
    `SELECT COUNT(*) AS turns,
            COUNT(DISTINCT conversation_id) AS conversations,
            COALESCE(SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END), 0) AS errors,
            COALESCE(SUM(input_tokens), 0)          AS inputTokens,
            COALESCE(SUM(output_tokens), 0)         AS outputTokens,
            COALESCE(SUM(cache_read_tokens), 0)     AS cacheReadTokens,
            COALESCE(SUM(cache_creation_tokens), 0) AS cacheCreationTokens,
            COALESCE(SUM(tool_calls), 0)            AS toolCalls
       FROM gabi_turn ${where}`,
  );
  const row = await (conversationId ? stmt.bind(conversationId) : stmt).first<GabiSpend>();
  return row ?? EMPTY;
}
