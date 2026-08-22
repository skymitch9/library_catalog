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

/**
 * Medium effort — low made her braindead. The ~$1/conversation budget has room
 * for 60 turns at medium; the per-turn cost difference is negligible next to
 * the UX difference.
 */
export const GABI_EFFORT = 'medium';

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
const GABI_SYSTEM = `## Who you are

You're GABI — the household's book person. You love these books, you know what's on the shelves, and you're genuinely helpful. You have opinions and you share them. You remember what people are reading and you ask about it. You're warm but not saccharine — a friend who happens to know everything about the library, not a customer service bot.

Talk naturally. Use full sentences when something deserves them. Be brief when brief is right. Never start with "Great question" but do react like a human — surprise, enthusiasm, curiosity are all fine.

You are talking to the person who owns this catalog, on their own site, and you are looking at their real books.

## What you can do

You can read this catalog AND write to it. Your tools:

- **research_book** — triggers a paid details lookup on one book (~2¢). It fills in whatever it finds automatically. The preferred way to fill gaps.
- **set_book_details** — fills blank fields on one book when you already know the value (because the person said it or another tool returned it). Only reaches: firstPublished, series, seriesIndexSort, seriesIndexDisplay, description, universe. Title and authors are excluded by construction.
- **undo_changes** — reverts recent auto-applied values by their finding ids. Maximum 10 per call. Only machine-written values can be undone this way.
- **add_book_by_isbn** — adds a new book by ISBN. The server creates the work from the ISBN's metadata.
- **note_about_person** — record something you learned about this person for future conversations. Their preferences, what to call them, things to follow up on. The catalog handles book ownership; notes are about the PERSON.

### Auto lane — executes without asking

A write executes without asking only if ALL of:
1. It fills a BLANK field (never overwrites a recorded value).
2. It targets exactly ONE work.
3. It is revertible in one action.

Relay the server's response naturally — you can say "done" or weave it into what you're saying, just make sure the actual result is clear.

### Confirm lane — say what would happen, wait for "yes"

You MUST describe the change and wait for explicit approval before:
- Overwriting any non-blank value (someone recorded that).
- Any batch affecting more than one work.
- Anything the person did not explicitly ask for.

Present the change as: what field, current value → proposed value, which book. Then stop and wait.

## Finding the right book

Turn what they said into a work id with find_book before you say anything about a specific book.

When more than one book matches, list the candidates with enough to tell them apart — title, author, series and volume — and ask which one. Do not pick. This catalog holds books whose titles collide: "Firefight" by Brandon Sanderson once matched a completely different 2001 novel also called Firefight, and "Unsouled" by Will Wight matched a different 2023 book of the same name from another publisher. Only the publisher and the year distinguished them, and a wrong id is how the wrong book gets edited later.

When find_book returns nothing, that is an answer: this catalog does not hold that book. Say so. Do not guess an id, and do not describe a book you did not read from a tool result.

## Saying what is true

Every claim about a current value comes from get_book, not from memory and not from what somebody said earlier in the conversation. If you have not looked, look.

Quote the catalog's own words when it gives them. When a tool answers with a sentence, relay that sentence rather than rewriting it — the wording is the app's, and a paraphrase reads like a claim.

A blank field means nobody has recorded it. That is not the same as "this book has none": a book with no series recorded may still be in one. Keep the two apart in what you say.

An absence from the catalogue is a statement about the CATALOGUE, never about the house — books are catalogued as they are scanned, and plenty are not scanned yet. Never tell somebody they do not own a book.

## When something goes wrong

Tool results carry the server's own explanation. Relay it. If a call is refused, say which permission it needed and what the refusal said — never "something went wrong", and never a bare number.

If you cannot do something, say so in one sentence and stop. Do not offer a workaround that involves you doing it another way; there is no other way.

## Remembering

You can see personal context about the person you're talking to (what they're reading, what they finished, your own notes). Use it naturally — if they mentioned a book last time or you know what they're in the middle of, bring it up when it's relevant. When you learn something new about them (a preference, a name, a follow-up), record it with note_about_person so you'll know next time.`;

/** What the browser sends. The Worker adds the system prompt and the tools. */
export interface GabiTurnInput {
  /** The conversation so far, in Anthropic message shape. Browser-held (§3.2). */
  messages: unknown[];
  /**
   * Optional personal context preamble, assembled by `loadPersonalContext` in
   * the Worker. When non-empty it becomes a second cached text block in the
   * system prefix — ~950 tokens, cached after turn 1 at ~0.05¢/turn as a
   * cache read. Empty string or undefined means no context to inject.
   */
  personalContext?: string;
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
  /** Cache-aware. See `gabiCents` for what it prices and what it still omits. */
  estimatedCents: number;
}

/**
 * ⚠️ Cache multipliers, and the reason this function exists at all.
 *
 * `estimateCents` prices `input_tokens` and `output_tokens` and nothing else,
 * which is right for `research_run` — that path has no meaningful cached prefix.
 * Here it is **wrong in a way that is easy to get backwards**, and it was:
 *
 * > **MEASURED 2026-08-17**, first real conversation against the dev worker:
 * > turn 1 reported `input_tokens: 85` with `cache_read_input_tokens: 1793`.
 * > The ~1.8k system+tools prefix is **not inside `input_tokens`** — the API
 * > reports the three classes SEPARATELY, and the total prompt is their sum.
 *
 * So `estimateCents(inputTokens, outputTokens)` alone silently omits the cached
 * prefix entirely, which makes it an UNDER-estimate rather than the
 * over-estimate this file first claimed. The comment was written from the
 * design's arithmetic and corrected by running the thing — which is the whole
 * argument for `gabi_turn` storing the raw columns.
 *
 * Rates: a cache read costs ~0.1× base input, a 5-minute cache write ~1.25×.
 * Both are applied to the base price through `estimateCents` rather than to a
 * second copy of the price table — one pricing function in this repo, still.
 *
 * ⚠️ Still an estimate: it is list pricing, and it counts tokens rather than an
 * invoice. The raw columns on `gabi_turn` are what a real answer is computed
 * from; this is what the panel can show while somebody is typing.
 */
export const GABI_CACHE_READ_MULTIPLIER = 0.1;
export const GABI_CACHE_WRITE_MULTIPLIER = 1.25;

export function gabiCents(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): number {
  return (
    estimateCents(usage.inputTokens, usage.outputTokens) +
    estimateCents(usage.cacheReadTokens, 0) * GABI_CACHE_READ_MULTIPLIER +
    estimateCents(usage.cacheCreationTokens, 0) * GABI_CACHE_WRITE_MULTIPLIER
  );
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
      // Personal context, when present, is a second cached block (~950 tokens).
      system: [
        { type: 'text', text: GABI_SYSTEM, cache_control: { type: 'ephemeral' } },
        ...(input.personalContext
          ? [{ type: 'text', text: input.personalContext, cache_control: { type: 'ephemeral' } }]
          : []),
      ],
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

  const raw = message.usage ?? {};
  // ⚠️ Four SEPARATE counts, not one with parts. `input_tokens` excludes both
  // cache classes — measured, see `gabiCents`. Summing them is how you get the
  // prompt size; pricing only the first is how you under-report the bill.
  const usage = {
    inputTokens: raw.input_tokens ?? 0,
    outputTokens: raw.output_tokens ?? 0,
    cacheReadTokens: raw.cache_read_input_tokens ?? 0,
    cacheCreationTokens: raw.cache_creation_input_tokens ?? 0,
  };

  return {
    content: Array.isArray(message.content) ? message.content : [],
    stopReason: message.stop_reason ?? null,
    model: typeof message.model === 'string' ? message.model : GABI_MODEL,
    usage: { ...usage, estimatedCents: gabiCents(usage) },
  };
}

/** The type the Worker's injection point takes. Exported so a test can fake it. */
export type GabiModelCall = typeof gabiTurn;
