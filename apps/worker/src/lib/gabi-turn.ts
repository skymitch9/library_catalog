/**
 * One GABI turn, decided here so the route stays wiring.
 *
 * `docs/info/gabi-fixer-design.md` §3.2 describes the turn route as
 * *"deliberately the dullest thing in the design"*, and everything dull about it
 * lives in this file: the guards, the single model call, and the accounting row
 * that makes §7 measurable. `routes/gabi.ts` parses a body and maps an outcome
 * to a status code, which is all an entry point is allowed to do here.
 *
 * ## Why the model call is a PARAMETER
 *
 * `runGabiTurn(env, input, callModel)` takes the call rather than importing it.
 * Not a test hook bolted on afterwards — it is what lets the central claim be
 * *measured* rather than asserted: **exactly one model call per invocation**.
 * A test passes a counting stand-in and reads the number; `gabi-turn.test.ts`
 * does exactly that, and so does the layer beneath it (a counting `fetch`
 * through the real SDK). Two levels, because "the SDK made one HTTP request"
 * and "this function called the SDK once" are different failures.
 *
 * ## What this file refuses, and why each refusal exists
 *
 * | Refusal | Because |
 * |---|---|
 * | No `ANTHROPIC_API_KEY` | 503 with a sentence, copying `POST /works/:id/run` exactly. A missing key is a misconfiguration the caller can act on |
 * | More than `GABI_MAX_TURNS` messages | §3.2's fuse. "A runaway loop is the one way a conversational surface can spend real money, and a server-side count is the only place a browser bug cannot bypass" |
 * | An oversized body | The turn ceiling counts messages, not bytes. Twenty-four turns of enormous tool results is the same runaway wearing a different shape |
 * | A `tool_use` naming anything outside `GABI_TOOL_NAMES` | §4.1 guard 1. Default-deny, server-side, where a browser bug or a tampered tab cannot reach |
 * | A message whose role is not `user` or `assistant` | ⚠️ Opus 5 accepts mid-conversation `role: "system"` messages as an OPERATOR channel. The browser must never be able to write one — that is the difference between a conversation and an instruction |
 *
 * ⚠️ **None of these is an access-control boundary, and none of them pretends to
 * be.** The browser is already trusted to call every endpoint these tools ride;
 * every tool call is capability-checked server-side on its own route, and the
 * worst outcome of a forged conversation is that she spends her own key's money
 * on her own fabricated transcript. The trust boundary is unchanged by this
 * design — which is the point (§3.2). These guards exist to bound SPEND and to
 * keep a later phase's write tool from becoming reachable by accident.
 */

import {
  GABI_MAX_TURNS,
  gabiPanelEnabled,
  isGabiToolName,
} from '@lc/core';
import { recordGabiTurn } from '@lc/db';
import { GABI_EFFORT, GABI_MODEL, ResearchError, type GabiModelCall } from '@lc/research';
import type { Env } from '../env.js';

/**
 * The biggest conversation this route will carry, in bytes of JSON.
 *
 * ~256 KB is roughly 60k tokens — several times what §7.1 costs a six-turn
 * conversation at, and far past anything the panel produces in normal use. It is
 * a fuse, not a budget: the turn ceiling bounds how MANY times money is spent
 * and this bounds how much each one can cost.
 */
export const GABI_MAX_BODY_BYTES = 256_000;

export interface GabiTurnRequest {
  conversationId: string;
  messages: unknown[];
}

export type GabiTurnOutcome =
  | {
      ok: true;
      body: {
        conversationId: string;
        content: unknown[];
        stopReason: string | null;
        model: string;
        usage: {
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheCreationTokens: number;
          estimatedCents: number;
        };
      };
    }
  | { ok: false; status: 400 | 404 | 422 | 502 | 503 | 504; body: { error: string; detail: string } };

/** Every content block in every message, flattened. Junk-tolerant by design. */
function blocksOf(messages: unknown[]): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (typeof block === 'object' && block !== null) blocks.push(block as Record<string, unknown>);
    }
  }
  return blocks;
}

/**
 * The §4.1 guard, and the role guard beside it.
 *
 * Returns the refusal sentence, or `null` when the conversation is acceptable.
 * ⚠️ Worded, never a bare code: a person must be told what happened, what it
 * needs, and how to get it — and the likeliest reader of this particular
 * sentence is whoever is debugging a tool wrapper, not Samantha.
 */
export function inspectConversation(messages: unknown[]): string | null {
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) {
      return 'One of the messages in this conversation is not a message.';
    }
    const role = (message as { role?: unknown }).role;
    if (role !== 'user' && role !== 'assistant') {
      // ⚠️ `system` is the one that matters. Opus 5 takes a mid-conversation
      // system message as an operator instruction; a browser that could append
      // one would be writing GABI's rules rather than talking to it.
      return `Messages here are from the person or from GABI. '${String(role)}' is neither.`;
    }
  }

  for (const block of blocksOf(messages)) {
    const type = block['type'];
    if (type !== 'tool_use' && type !== 'tool_result') continue;
    // A `tool_result` carries no name in the API shape; if one is present
    // anyway it is checked, because an unchecked field is how a name gets past.
    const name = block['name'] ?? (type === 'tool_use' ? undefined : null);
    if (name === null || name === undefined) {
      if (type === 'tool_result') continue;
      return 'A tool call in this conversation has no name.';
    }
    if (!isGabiToolName(name)) {
      return `GABI has no tool called '${String(name)}'. That is not something it can do from here.`;
    }
  }

  return null;
}

/** How many tool calls the model asked for. The BROWSER runs them; this counts them. */
function countToolUse(content: unknown[]): number {
  return content.filter(
    (b) => typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'tool_use',
  ).length;
}

/**
 * Validate, spend once, write the row down.
 *
 * `userId` is the authenticated person — the route reads it from the request
 * context, so this function never has to know how authority is established.
 */
export async function runGabiTurn(
  env: Env,
  userId: number | null,
  input: GabiTurnRequest,
  callModel: GabiModelCall,
): Promise<GabiTurnOutcome> {
  const { conversationId, messages } = input;

  // ── Guards. Nothing below spends money until all of them pass. ─────────────

  if (!gabiPanelEnabled(env.GABI_PANEL)) {
    // ⚠️ The posture flag gates the ROUTE, not only the panel. Hiding a control
    // has never been the lock in this app (`/people` is the precedent, and its
    // comment says so); a route that stayed open on an instance whose panel is
    // off would be a money-spending surface with nothing in front of it.
    //
    // ⚠️ **404 and not 403, deliberately** — the repo's own disabled-not-open
    // idiom, the same one `EBOOK_INGEST_TOKEN`, `AUDIOBOOK_MAPPING_TOKEN` and
    // `DONOR_TOKEN` all use when their surface is switched off on an instance.
    // 403 in this app means one thing: your ROLE does not permit this
    // (`capabilityDenied`). Reusing it for "this feature does not exist here"
    // would collide two of the four causes the estate rule insists stay
    // distinct — and it would send somebody asking for a role that would not
    // help. The sentence still says what happened; it is never a bare status.
    return {
      ok: false,
      status: 404,
      body: {
        error: 'gabi_disabled',
        detail: 'GABI is not switched on for this library. Nothing is wrong with your account.',
      },
    };
  }

  if (typeof conversationId !== 'string' || conversationId.trim().length === 0 || conversationId.length > 100) {
    return {
      ok: false,
      status: 400,
      body: { error: 'bad_request', detail: 'Send a conversationId — a short string, minted once per conversation.' },
    };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      ok: false,
      status: 400,
      body: { error: 'bad_request', detail: 'Send { conversationId, messages: [...] } with at least one message.' },
    };
  }

  if (messages.length > GABI_MAX_TURNS) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'too_many_turns',
        detail: `This conversation has reached ${GABI_MAX_TURNS} turns, which is as far as one goes. Start a new one — nothing you have done is lost.`,
      },
    };
  }

  const bytes = JSON.stringify(messages).length;
  if (bytes > GABI_MAX_BODY_BYTES) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'conversation_too_large',
        detail: 'This conversation has grown too large to carry any further. Start a new one.',
      },
    };
  }

  const objection = inspectConversation(messages);
  if (objection) {
    return { ok: false, status: 400, body: { error: 'bad_request', detail: objection } };
  }

  if (!env.ANTHROPIC_API_KEY) {
    // Checked LAST of the guards and before any row is written: no key is a
    // misconfiguration, and recording it as a failed turn would put an error
    // against a conversation that has nothing wrong with it. Same shape and same
    // reasoning as `POST /research/works/:id/run`.
    return {
      ok: false,
      status: 503,
      body: {
        error: 'not_configured',
        detail:
          'No Anthropic API key on this library, so GABI cannot answer. Put ANTHROPIC_API_KEY in apps/worker/.dev.vars, then `npm run secrets:push`.',
      },
    };
  }

  // ── The one model call. ───────────────────────────────────────────────────

  try {
    const turn = await callModel(env.ANTHROPIC_API_KEY, { messages });

    await recordGabiTurn(env.DB, {
      conversationId,
      userId,
      model: turn.model,
      effort: GABI_EFFORT,
      turnIndex: messages.length,
      stopReason: turn.stopReason,
      inputTokens: turn.usage.inputTokens,
      outputTokens: turn.usage.outputTokens,
      cacheReadTokens: turn.usage.cacheReadTokens,
      cacheCreationTokens: turn.usage.cacheCreationTokens,
      toolCalls: countToolUse(turn.content),
      errorMessage: null,
    });

    return {
      ok: true,
      body: {
        conversationId,
        content: turn.content,
        // ⚠️ Returned rather than interpreted. `pause_turn` should not arise —
        // there are no server-side tools in GABI_TOOLS — but §8 says handle it
        // anyway and let the browser re-post rather than assume it cannot happen.
        stopReason: turn.stopReason,
        model: turn.model,
        usage: turn.usage,
      },
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const status = err instanceof ResearchError ? err.status : 502;

    // ⚠️ The failed turn is recorded too. A cost model built only from successes
    // is a guess wearing a measurement's clothes — a refusal, a timeout and a
    // classifier decline all happened, and a table that cannot see them cannot
    // answer "why is this conversation expensive?".
    await recordGabiTurn(env.DB, {
      conversationId,
      userId,
      model: GABI_MODEL,
      effort: GABI_EFFORT,
      turnIndex: messages.length,
      stopReason: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      toolCalls: null,
      errorMessage: detail.slice(0, 500),
    });

    return {
      ok: false,
      status: status === 422 || status === 502 || status === 504 || status === 503 ? status : 502,
      body: { error: 'gabi_failed', detail },
    };
  }
}
