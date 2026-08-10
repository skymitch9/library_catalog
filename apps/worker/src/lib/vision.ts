import Anthropic from '@anthropic-ai/sdk';
import { SHELF_SCHEMA, SHELF_SYSTEM, type ShelfBook, type ShelfReading } from '@lc/core';

/**
 * Reading books off a photograph.
 *
 * The only place in this app that spends money. Everything else — Open Library,
 * the barcode ladder, the whole collection API — is free, so this file carries
 * the cost discipline that the rest of the codebase does not need.
 *
 * ## ⚠️ Photos are transient and there is no bucket
 *
 * A photograph arrives in a request body, becomes an image block on the call
 * below, and is gone when this function returns. It is never written to D1,
 * never written to R2, and `apps/worker/wrangler.toml` has no R2 binding at all
 * — deliberately, so that no future code path *can* forget to delete one.
 *
 * ## ⚠️ It proposes. It does not write.
 *
 * A vision read is weaker evidence than an ISBN, and an ISBN already resolves
 * to a confident, well-formed, wrong book often enough that the barcode screen
 * refuses to auto-add (measured, phase 0: three of ten). A spine gives a title
 * at an angle, half-occluded, usually with the series name printed larger than
 * the volume title. Nothing here reaches the catalog without a person.
 *
 * ## Why it lives in the Worker rather than in `packages/`
 *
 * `packages/core` is a leaf with no I/O by contract, and this is a network
 * call. `packages/isbn` is the free ladder and has no business holding a
 * credential. One route consumes this; when a second one does, it moves.
 * The *prompt* and its output schema are in `@lc/core` — they are pure data,
 * and keeping them beside the types they produce is what stops the two drifting.
 */

/**
 * The model.
 *
 * `claude-opus-5`: $5 / MTok in, $25 / MTok out. Reading print off a photograph
 * is perception rather than reasoning, which is what `effort: 'low'` below is
 * for — but the *perception* has to be good, and a cheaper model reading a
 * paperback spine at an angle is a false economy when each call is a person
 * standing in front of a bookshelf waiting for an answer.
 */
export const VISION_MODEL = 'claude-opus-5';

/** List price, in cents per million tokens. Kept beside the model it prices. */
const CENTS_PER_MTOK_IN = 500;
const CENTS_PER_MTOK_OUT = 2500;

/**
 * Ceiling for one shelf read, covering thinking *and* the JSON.
 *
 * ⚠️ On `claude-opus-5` thinking is **on by default** — omitting the parameter
 * runs adaptive thinking, unlike the previous generation where omitting it
 * meant none. So `max_tokens` is a budget for both, and a value sized for the
 * JSON alone truncates mid-answer. 8000 holds a dense shelf (twenty-plus
 * entries at ~40 tokens each) with room for low-effort reasoning in front of it.
 *
 * Thinking is deliberately left on rather than disabled. Disabling it is
 * cheaper, and it has a documented failure mode that would land squarely here:
 * with thinking off the model can leak `<thinking>` tags into its visible
 * output, which for a structured-output call is a malformed answer we have
 * already paid for. Low effort with thinking on costs less than one retry.
 */
const MAX_TOKENS = 8000;

export class VisionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when trying the same photo again is a reasonable thing to do. */
    readonly retryable = false,
  ) {
    super(message);
  }
}

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMediaType = (typeof MEDIA_TYPES)[number];

export function isPhotoMediaType(v: string): v is PhotoMediaType {
  return (MEDIA_TYPES as readonly string[]).includes(v);
}

export interface Photo {
  /** Raw base64, no `data:` prefix — the client strips it before sending. */
  data: string;
  mediaType: PhotoMediaType;
}

function estimateCents(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * CENTS_PER_MTOK_IN +
    (outputTokens / 1_000_000) * CENTS_PER_MTOK_OUT
  );
}

/**
 * Turn an upstream failure into something the person holding the phone can act
 * on.
 *
 * ⚠️ The authentication branch exists because the sibling project got it wrong
 * once: a rejected API key surfaced as "could not read that photo", which sent
 * someone to check their lighting and camera angle when the actual problem was
 * a rotated key that had never been pushed to production. **An authentication
 * failure has nothing to do with the photograph and must never be described as
 * though it does.**
 */
function explain(err: unknown): VisionError {
  if (err instanceof VisionError) return err;

  const status = (err as { status?: number })?.status;

  if (status === 401 || status === 403) {
    return new VisionError(
      'The Anthropic API key was rejected. This is a configuration problem, not a problem with your photo — the key was probably rotated without being pushed. Run `npm run secrets:push`.',
      503,
    );
  }
  if (status === 429) {
    return new VisionError('Rate limited by the Anthropic API. Wait a moment and try again.', 429, true);
  }
  if (status === 413) {
    return new VisionError('That photo is too large for the model. Take a wider, lower-resolution shot.', 413);
  }

  const detail = err instanceof Error ? err.message : String(err);
  return new VisionError(`Could not read that photo: ${detail}`, 502, true);
}

/**
 * Read every book you can off one photograph of a shelf.
 *
 * Deliberately does no resolving. Matching the titles against the catalog and
 * the free ISBN rungs is instant and costs nothing; asking the model to look
 * fifteen books up would take minutes and be charged per search.
 */
export async function readShelf(apiKey: string | undefined, photo: Photo): Promise<ShelfReading> {
  if (!apiKey) {
    throw new VisionError(
      'No Anthropic API key is configured, so photos cannot be read. Set ANTHROPIC_API_KEY in .dev.vars and run `npm run secrets:push`.',
      503,
    );
  }

  const client = new Anthropic({ apiKey });

  let message;
  try {
    message = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: MAX_TOKENS,
      output_config: {
        // Reading large print off a photograph is perception, not reasoning.
        effort: 'low',
        // Structured output, so there is no "please reply with JSON", no
        // extract-the-code-fence, and no retry-on-bad-parse. The API constrains
        // the answer to SHELF_SCHEMA or fails loudly.
        format: { type: 'json_schema', schema: SHELF_SCHEMA as unknown as Record<string, unknown> },
      },
      // ⚠️ No `cache_control` here on purpose. SHELF_SYSTEM is around 400
      // tokens and the minimum cacheable prefix on this model is 512, so a
      // breakpoint would be silently ignored — `cache_creation_input_tokens: 0`
      // and no error. A marker that does nothing is worse than no marker,
      // because the next person reads it as evidence that caching is working.
      system: SHELF_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: photo.mediaType, data: photo.data },
            },
            { type: 'text', text: 'List every book you can read on this shelf.' },
          ],
        },
      ],
    });
  } catch (err) {
    throw explain(err);
  }

  // ⚠️ Check why it stopped BEFORE reading content. A refusal and a truncation
  // both leave content that looks nearly parseable, and half an answer that
  // silently becomes "the shelf has four books on it" is worse than an error.
  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category;
    throw new VisionError(
      `The model declined to read that image${category ? ` (${category})` : ''}. Photograph the shelf rather than anything else in the room.`,
      422,
    );
  }
  if (message.stop_reason === 'max_tokens') {
    throw new VisionError(
      'That shelf produced more than one answer can hold. Photograph it in two halves.',
      502,
    );
  }

  const text = message.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new VisionError('The model returned nothing to read.', 502, true);

  let parsed: { books?: ShelfBook[]; unreadable?: boolean };
  try {
    parsed = JSON.parse(text) as { books?: ShelfBook[]; unreadable?: boolean };
  } catch {
    throw new VisionError('The model returned text that was not valid JSON.', 502, true);
  }

  const inputTokens = message.usage.input_tokens ?? 0;
  const outputTokens = message.usage.output_tokens ?? 0;

  return {
    // Sorted, then renumbered on the way out by the caller — the model is asked
    // for left-to-right positions and mostly obliges, but a gap or a repeat in
    // its numbering must not become a gap or a repeat in the review list.
    books: (parsed.books ?? []).slice().sort((a, b) => a.position - b.position),
    unreadable: parsed.unreadable ?? false,
    inputTokens,
    outputTokens,
    estimatedCents: estimateCents(inputTokens, outputTokens),
  };
}
