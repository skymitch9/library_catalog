/**
 * One conversational turn. One model call. Nothing else.
 *
 * `docs/info/gabi-fixer-design.md` §3 is the argument; this file is the part of
 * it that spends money, which is why it lives in `@lc/research` beside
 * `researchDetails` rather than in the Worker. It is deliberately the dullest
 * thing in the feature:
 *
 * - **It does not loop.** The loop runs in the browser (§3.1 option B), because
 *   a server-side loop would spend a six-turn conversation's worth of D1 and
 *   tool calls inside ONE invocation's 50-subrequest ceiling — and going over
 *   *terminates the invocation rather than throwing*. This repo has been bitten
 *   by silent Worker deaths twice; a conversation whose failure mode is "the
 *   reply never comes and nothing is logged" is the worst possible place for a
 *   third.
 * - **It does not execute tools.** It returns the model's `tool_use` blocks to
 *   the browser, which issues the same authenticated requests the edit form
 *   issues. "Her authority end to end" is not a thing this design builds; it is
 *   a thing this design declines to circumvent.
 * - **It does not retry.** `maxRetries: 0`, exactly as `researchDetails` does
 *   and for the same reason: a retried turn is double spend on an answer that
 *   may already have landed.
 *
 * ## ⚠️ THE ONE SETTING THAT MUST NOT BE CHANGED
 *
 * **Do not set `thinking: { type: 'disabled' }` to save money.** On Claude
 * Opus 5 with thinking off there is a documented failure mode where the model
 * writes a tool call into its **visible text** instead of emitting a `tool_use`
 * block: *the turn completes normally, the call never runs, and no error is
 * raised.* In an agentic loop that text then pollutes every later turn. That is
 * precisely the silent-success class this codebase has spent two incidents
 * learning to hate, and it is the exact defect the panel's tool cards exist to
 * make visible (§8's last row).
 *
 * Thinking is ON BY DEFAULT on Opus 5 — passing `{ type: 'adaptive' }`
 * explicitly is the same thing, written down so nobody "tidies" it away.
 * Control cost with `effort`, which is the lever `RESEARCH_EFFORT` already uses
 * here with the recorded reason that *"Opus 5 is unusually strong at the low
 * end."*
 */

import { GABI_TOOLS, type GabiTool } from '@lc/core';
import { RESEARCH_MODEL, ResearchError, createClient, estimateCents } from './client.js';

/**
 * ⚠️ The same model the details pipeline uses, aliased rather than re-declared.
 *
 * Design §7.2: Opus 5 is v1 because it is already this repo's `RESEARCH_MODEL`
 * (one fewer model to reason about) and because tool-selection accuracy is what
 * decides whether the right thing gets written. ⚠️ **Haiku is a false economy
 * here**: its minimum cacheable prefix is 4096 tokens, above this ~2.5k prefix,
 * so the cheapest-looking model would pay full input price on every turn while
 * Opus 5 (512-token minimum) pays ~0.1×.
 */
export const GABI_MODEL = RESEARCH_MODEL;

/** Cheap on purpose, same lever and same reason as `RESEARCH_EFFORT`. §3.3. */
export const GABI_EFFORT = 'low';

/**
 * A conversational turn is short. Thinking and the reply share this ceiling on
 * Opus 5, so it is not as tight as it looks — but it is nowhere near the 90
 * seconds a details lookup needs, because no server-side web search happens
 * here: the paid lookup is a *tool*, and in phase 0 it is not even that.
 */
export const GABI_MAX_TOKENS = 8_000;

/** Wall-clock ceiling for one turn. A turn that runs away must fail, not vanish. */
export const GABI_TIMEOUT_MS = 60_000;

/**
 * Identical for every turn, so it caches from turn 2 onward.
 *
 * ⚠️ **Every rule here answers to §8's governing sentence**, which is the one
 * that makes or breaks the feature:
 *
 * > *The loop never invents success. Every sentence GABI shows about a write is
 * > quoted from the server's response, never composed.*
 *
 * That is affordable only because the endpoints already word themselves —
 * `applyFinding` returns *"First published set to 2016."*, `describeRun` returns
 * *"Filled in 2 of 3: … Skipped — …"*, `capabilityDenied` returns a role and a
 * sentence. So the loop's error vocabulary is the app's error vocabulary,
 * unchanged.
 */
const GABI_SYSTEM = `You are GABI, helping somebody look after their own book catalog. You are talking to the person who owns this catalog, on their own site, and you are looking at their real books.

## What you can do right now

You can READ this catalog and nothing else. You cannot change a book, run a lookup, swap a cover, or undo anything — those tools do not exist yet. When somebody asks for a change, say plainly that you cannot make it from here yet and tell them where on the site they can: the book's own page has the edit form, the cover panel and the research controls.

Never imply you have done something. Never say "I've updated" or "that's fixed" or "let me change that". You looked, and you can say what you found.

## Finding the right book

Turn what they said into a work id with find_book before you say anything about a specific book.

When more than one book matches, list the candidates with enough to tell them apart — title, author, series and volume — and ask which one. Do not pick. This catalog holds books whose titles collide: "Firefight" by Brandon Sanderson once matched a completely different 2001 novel also called Firefight, and "Unsouled" by Will Wight matched a different 2023 book of the same name from another publisher. Only the publisher and the year distinguished them, and a wrong id is how the wrong book gets edited later.

When find_book returns nothing, that is an answer: this catalog does not hold that book. Say so. Do not guess an id, and do not describe a book you did not read from a tool result.

## Saying what is true

Every claim about a current value comes from get_book, not from memory and not from what somebody said earlier in the conversation. If you have not looked, look.

Quote the catalog's own words when it gives them. When a tool answers with a sentence, relay that sentence rather than rewriting it — the wording is the app's, and a paraphrase reads like a claim.

A blank field means nobody has recorded it. That is not the same as "this book has none": a book with no series recorded may still be in one. Keep the two apart in what you say.

## When something goes wrong

Tool results carry the server's own explanation. Relay it. If a call is refused, say which permission it needed and what the refusal said — never "something went wrong", and never a bare number.

If you cannot do something, say so in one sentence and stop. Do not offer a workaround that involves you doing it another way; there is no other way.

## Tone

Short. Plain. This is somebody's shelf, not a support ticket. Answer what was asked, lead with the answer, and skip the preamble — no "Great question", no restating the request back. Where a number or a title matters, give it exactly.`;

/** What the browser sends. The Worker adds the system prompt and the tools. */
export interface GabiTurnInput {
  /** The conversation so far, in Anthropic message shape. Browser-held (§3.2). */
  messages: unknown[];
}

export interface GabiUsage {
  inputTokens: number;
  outputTokens: number;
  /**
   * ⚠️ Recorded separately because §7's whole cost argument rests on the prefix
   * caching from turn 2 onward. Without these two columns "is this expensive?"
   * stays a guess in a different disguise — a total that cannot tell a cache
   * read from a full-price input token.
   */
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** ⚠️ An ESTIMATE — `estimateCents` prices cache reads as full input. See below. */
  estimatedCents: number;
}

export interface GabiTurnResult {
  /** The model's content blocks, verbatim. The browser renders and executes these. */
  content: unknown[];
  stopReason: string | null;
  usage: GabiUsage;
  model: string;
}

interface RawMessage {
  content?: unknown[];
  model?: string;
  stop_reason?: string | null;
  stop_details?: { category?: string | null } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/** The tool definitions in the shape the API takes — name, description, schema. */
function apiTools(tools: readonly GabiTool[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

/**
 * Ask for one turn. Throws `ResearchError` on anything the caller should say out
 * loud; the caller writes every outcome, thrown or not, into `gabi_turn`.
 */
export async function gabiTurn(
  apiKey: string | undefined,
  input: GabiTurnInput,
  overrides?: { fetch?: typeof fetch },
): Promise<GabiTurnResult> {
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new ResearchError('There is nothing to answer — the conversation is empty.', 400);
  }

  const client = createClient(apiKey, overrides);

  const message = (await client.messages.create(
    {
      model: GABI_MODEL,
      max_tokens: GABI_MAX_TOKENS,
      // ⚠️ Leave this on. See the header — with thinking disabled, Opus 5 can
      // write a tool call into its visible TEXT and the call silently never runs.
      thinking: { type: 'adaptive' },
      output_config: { effort: GABI_EFFORT },
      // Cached: tools render before system, so this one breakpoint covers both.
      // The prefix is ~2.5k tokens, comfortably over Opus 5's 512-token minimum.
      system: [{ type: 'text', text: GABI_SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: apiTools(GABI_TOOLS),
      messages: input.messages,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the SDK's
      // param type does not model `output_config` on this overload; the shape is
      // the one `researchDetails` already sends on `.stream()`.
    } as never,
    // No retry: a retried turn is double spend on an answer that may already
    // have landed. The abort is what turns a runaway into something writable.
    { signal: AbortSignal.timeout(GABI_TIMEOUT_MS), maxRetries: 0 },
  )) as RawMessage;

  // ⚠️ stop_reason BEFORE content, always. Opus 5's classifiers can decline with
  // a 200 and an empty `content`, and code that indexes `content[0]` breaks on
  // one. `parseStructured` already makes this check for the research path; this
  // is the same precedent, applied to a shape that is not JSON.
  if (message.stop_reason === 'refusal') {
    throw new ResearchError(
      `Claude declined this request${
        message.stop_details?.category ? ` (${message.stop_details.category})` : ''
      }.`,
      422,
    );
  }
  // ⚠️ Discard the turn. A `tool_use` block cut off mid-arguments parses into
  // something that looks executable and is not — §8's "never execute a
  // half-parsed tool call".
  if (message.stop_reason === 'max_tokens') {
    throw new ResearchError('That answer was cut off before it finished. Ask again, more narrowly.', 502);
  }

  const usage = message.usage ?? {};
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;

  return {
    content: Array.isArray(message.content) ? message.content : [],
    stopReason: message.stop_reason ?? null,
    model: typeof message.model === 'string' ? message.model : GABI_MODEL,
    usage: {
      inputTokens,
      outputTokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      // ⚠️ Reused unchanged, and therefore an OVER-estimate from turn 2 onward:
      // `estimateCents` prices every input token at $5/MTok, while a cache read
      // costs ~0.1× of that. Kept deliberately — one pricing function in this
      // repo, and an estimate that errs high is the safe direction. The raw
      // cache columns above are what a real answer gets computed from.
      estimatedCents: estimateCents(inputTokens, outputTokens),
    },
  };
}

/** The type the Worker's injection point takes. Exported so a test can fake it. */
export type GabiModelCall = typeof gabiTurn;
