/**
 * Last rung of the cover ladder: ask Claude to go and find one.
 *
 * ## When this is the right tool, and when it is waste
 *
 * Only after Open Library and Google Books have both answered "no cover" for a
 * real ISBN. Measured against production 2026-08-10, that leaves 21 works of
 * 228 — board books, a Korean-language picture book, and six crowdfunding
 * placeholder works with no edition and therefore no ISBN at all. Those are
 * exactly the rows the free rungs are worst at, and exactly the rows where a
 * general web search has something the ISBN databases do not.
 *
 * ⚠️ **This rung costs money per book and the free rungs do not.** It is opt-in
 * per run (`--llm`), never automatic, and never part of the scan path. A book
 * added tomorrow gets its cover from `coverFrom` in `@lc/isbn` for nothing; this
 * is for the residue.
 *
 * ## ⚠️ A proposed URL is not a cover
 *
 * **This function returns a claim, and the caller must verify it before storing
 * it.** An LLM asked for an image URL can produce one that is well-formed,
 * plausible, on the right domain, and 404 — indistinguishable from a real one
 * until a person opens the page. `verifyCoverUrl` in `@lc/isbn` is the check:
 * fetch it, confirm an image content-type, confirm it is bigger than Open
 * Library's 43-byte placeholder. Nothing here writes to the database and nothing
 * here should be trusted without that fetch.
 *
 * The verification lives with the caller rather than here so this package stays
 * a leaf that only talks to Anthropic — and so the same verifier guards the
 * openlibrary, googlebooks and LLM rungs alike, which is the point.
 */

import {
  RESEARCH_EFFORT,
  RESEARCH_MODEL,
  ResearchError,
  createClient,
  parseStructured,
  usageOf,
  type Usage,
} from './client.js';

/** Same bound, same reasoning, as `RESEARCH_TIMEOUT_MS` in details.ts. */
export const COVER_TIMEOUT_MS = 90_000;

const COVER_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    /** Direct link to the image file itself, never to a page containing it. */
    url: { type: ['string', 'null'] },
    /** Where it came from, so a person reviewing the run can judge it. */
    source: { type: ['string', 'null'] },
    /** The model's own read on whether this is the right book. */
    confidence: { type: 'string', enum: ['high', 'low'] },
    note: { type: 'string' },
  },
  required: ['found', 'url', 'source', 'confidence', 'note'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You find cover images for books in a private household library catalogue.

You are given a book that two ISBN databases could not supply a cover for. These
are usually children's board books, foreign-language editions, or small-press
titles that are poorly indexed.

Return a DIRECT link to the cover image file — a URL ending in .jpg, .jpeg,
.png or .webp that returns the image itself. A link to a product page, a search
results page, or an HTML page that displays the image is useless and counts as
not found.

Rules that matter more than finding something:

- If you cannot find a direct image URL for THIS book, set found=false. That is
  a correct and useful answer. A wrong cover is worse than a blank one, because
  nothing in this system ever revisits a cover once it is stored.
- Never construct, guess, or pattern-match a URL. Only return a URL you actually
  saw in a search result or on a page you fetched.
- Match the edition loosely but the book exactly. A different printing of the
  same title by the same author is fine; a different book that shares a title is
  not.
- Set confidence=low whenever you are unsure it is the same book, and say why in
  the note. The caller shows low-confidence proposals to a person.`;

export interface CoverProposal {
  found: boolean;
  url: string | null;
  source: string | null;
  confidence: 'high' | 'low';
  note: string;
}

export interface CoverSearchInput {
  title: string;
  authors: string;
  /** Helps disambiguate when the title is generic. Optional — many have none. */
  isbn?: string | null;
}

export interface CoverSearchResult {
  proposal: CoverProposal;
  usage: Usage;
}

/**
 * Ask Claude for one book's cover.
 *
 * ⚠️ The returned `url` is **unverified**. See the header — fetch it through
 * `verifyCoverUrl` before it goes anywhere near the database.
 */
export async function findCover(
  apiKey: string | undefined,
  input: CoverSearchInput,
): Promise<CoverSearchResult> {
  const client = createClient(apiKey);

  const identity = [
    `Title: ${input.title}`,
    `Author: ${input.authors}`,
    input.isbn ? `ISBN: ${input.isbn}` : 'ISBN: none recorded',
  ].join('\n');

  const stream = client.messages.stream(
    {
      model: RESEARCH_MODEL,
      // A URL, a source and a sentence. The ceiling is really a time bound.
      max_tokens: 3000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: RESEARCH_EFFORT,
        format: { type: 'json_schema', schema: COVER_SCHEMA },
      },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 2 },
      ],
      messages: [
        {
          role: 'user',
          content: `${identity}

Find a direct cover image URL for this book. Prefer a publisher or library page
over a retailer, because retailer image hosts frequently refuse requests that do
not come from their own site — a URL that cannot be fetched is not a cover.

If you cannot find one, say so.`,
        },
      ],
    },
    { signal: AbortSignal.timeout(COVER_TIMEOUT_MS), maxRetries: 0 },
  );

  const message = await stream.finalMessage();

  if (message.stop_reason === 'pause_turn') {
    throw new ResearchError('The cover search used its whole budget without finishing.', 502);
  }

  return { proposal: parseStructured<CoverProposal>(message), usage: usageOf(message) };
}

/**
 * Roughly what one cover search costs, for printing before a run rather than
 * discovering after.
 *
 * ⚠️ **Two costs, and only one of them is in `estimateCents`.** Tokens are Claude
 * Opus 5 list pricing, $5/MTok in and $25/MTok out; a low-effort call with a few
 * search results in context lands near the 2 cents `RESEARCH_CENTS_EACH.low`
 * already records for the sibling lookup. Server-side **web search is billed
 * separately at $10 per 1,000 searches** — a cent per search, so up to 4 more
 * cents at the `max_uses` above.
 *
 * Call it **6 cents a book, worst case**. That is an estimate from list prices
 * and the shape of the request, not a measurement of this function — no sweep
 * has been run. Print it, do not trust it to three decimal places, and re-derive
 * it from `usage` once a real run exists.
 */
export const COVER_CENTS_EACH = 6;
