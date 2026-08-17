import Anthropic from '@anthropic-ai/sdk';

/**
 * Shared Claude plumbing. One model, one pricing table, one JSON extractor.
 *
 * Every call from here costs real money, so the rules are the same throughout:
 * structured output rather than prose to parse, effort chosen per call rather
 * than defaulted high, and the system prompt cached because it is byte-identical
 * for every book.
 */

/**
 * ⚠️ Also written into `research_run.model` on every run, which is why the
 * column exists: a finding accepted six months from now should be traceable to
 * the model that proposed it.
 */
export const RESEARCH_MODEL = 'claude-opus-5';

/**
 * Cheap on purpose.
 *
 * These are dull, widely-agreed facts — a publication year, a series name, two
 * sentences about a book. `low` is the setting for exactly that, and Claude
 * Opus 5 is unusually strong at the low end. Recorded in `research_run.effort`
 * beside the model so a future comparison has both halves.
 */
export const RESEARCH_EFFORT = 'low';

export class ResearchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * `overrides.fetch` exists so a test can count HTTP calls to the Messages API
 * without spending money — the GABI turn route's central claim is *exactly one
 * model call per invocation* (design §3.2), and the only honest way to check a
 * claim about calls is to count them. It is passed straight to the SDK, which
 * uses it for every request; production passes nothing and gets the platform's.
 */
export function createClient(
  apiKey: string | undefined,
  overrides?: { fetch?: typeof fetch },
): Anthropic {
  if (!apiKey) {
    throw new ResearchError(
      'No Anthropic API key configured. Put ANTHROPIC_API_KEY in apps/worker/.dev.vars and run `npm run secrets:push`.',
      503,
    );
  }
  return new Anthropic(overrides?.fetch ? { apiKey, fetch: overrides.fetch } : { apiKey });
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  estimatedCents: number;
}

/**
 * Rough cost in cents.
 *
 * ⚠️ Claude Opus 5 list pricing, $5 / MTok in and $25 / MTok out. It is an
 * *estimate* and the UI says so: server-side web search is billed separately
 * from tokens, and this number does not include it. Cost visibility is the whole
 * reason `input_tokens` and `output_tokens` are columns on `research_run` rather
 * than something the browser holds — see the head of that table in migration
 * 0001.
 */
export function estimateCents(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * 500 + (outputTokens / 1_000_000) * 2500;
}

export function usageOf(message: {
  usage?: { input_tokens?: number; output_tokens?: number };
}): Usage {
  const inputTokens = message.usage?.input_tokens ?? 0;
  const outputTokens = message.usage?.output_tokens ?? 0;
  return { inputTokens, outputTokens, estimatedCents: estimateCents(inputTokens, outputTokens) };
}

/**
 * Pull the JSON payload out of a structured-outputs response.
 *
 * `stop_reason` is checked before the content, because a refusal and a
 * truncation both leave something that looks parseable-ish and is not, and
 * quietly returning half a result is worse than failing loudly.
 */
export function parseStructured<T>(message: {
  stop_reason?: string | null;
  stop_details?: { category?: string | null } | null;
  content: { type: string; text?: string }[];
}): T {
  if (message.stop_reason === 'refusal') {
    throw new ResearchError(
      `Claude declined this request${
        message.stop_details?.category ? ` (${message.stop_details.category})` : ''
      }.`,
      422,
    );
  }
  if (message.stop_reason === 'max_tokens') {
    throw new ResearchError('The answer was cut off before it finished.', 502);
  }

  const text = message.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new ResearchError('Claude returned no text to parse.', 502);

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ResearchError('Claude returned text that was not valid JSON.', 502);
  }
}
