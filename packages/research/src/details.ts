/**
 * One book, one open-web pass, a handful of proposed facts.
 *
 * ## What this is for
 *
 * `docs/info/isbn-ladder.md` §4.2 is the reason this exists at all: **roughly
 * half this library is not in Open Library.** Sixteen of thirty sampled titles
 * have no record anywhere free — the Kindle Unlimited and Audible-native indie
 * half, with no ISBN and no library entry. The free ladder answers those with
 * nothing, and it will keep answering with nothing however many rungs are added.
 * A model with a search tool can read a publisher's own page, a series index, a
 * retailer listing; that is the gap it fills.
 *
 * ## ⚠️ It proposes. It never writes.
 *
 * Everything here returns findings. Nothing here touches `work`. That is the
 * project's hardest-won rule and it is not a style preference — §4.4 of the same
 * document records **a wrong answer scoring 1.00 on title and 1.00 on author**,
 * twice, in two different series, with only the publisher and the year giving it
 * away. `/api/enrich` has worked this way since phase 2 and this follows it
 * exactly: a person reads the value, the source and the basis, and presses Use.
 *
 * ## ⚠️ "I could not find out" is an answer
 *
 * Three outcomes per field, not two — `found`, `none`, `unknown`. A model that
 * can only say "here is a value" will produce one for a self-published LitRPG
 * nobody has catalogued, because that is what the shape of the request asks of
 * it. Letting it say `unknown` is what makes the empty answer cheap and the
 * confident one meaningful. `scripts/series-overrides.json` reached the same
 * three-way split by hand for the same reason.
 */

import { APIUserAbortError } from '@anthropic-ai/sdk';
import {
  DETAIL_FIELDS,
  SOURCE_TIERS,
  type DetailField,
  type FindingKind,
  type SourceTier,
} from '@lc/core';
import {
  RESEARCH_EFFORT,
  RESEARCH_MODEL,
  ResearchError,
  createClient,
  parseStructured,
  usageOf,
  type Usage,
} from './client.js';

/**
 * How long one lookup may run before it is stopped and called a failure.
 *
 * ⚠️ Not a guess at how long the model needs — a ceiling the *caller* survives.
 * The route awaits this promise and also hands it to `executionCtx.waitUntil`,
 * and Cloudflare cancels a `waitUntil` task about thirty seconds after the
 * response is returned. That cancellation is silent: nothing throws, nothing
 * reaches a catch, and the run row sits at `running` for ever. The sibling
 * project watched a run stay `running` for eleven hours that way.
 *
 * So the call is stopped *before* the platform would stop it, because a lookup
 * that throws is a lookup that gets written down.
 */
export const RESEARCH_TIMEOUT_MS = 90_000;

/**
 * An `AbortSignal.timeout` firing, however it reached us.
 *
 * Three spellings on purpose. The SDK wraps an aborted request in its own
 * `APIUserAbortError`, whose message is the unhelpful "Request was aborted." and
 * whose `name` is plain `Error` — so neither a name check nor the message alone
 * is enough, and a bare `instanceof` misses a `DOMException` raised before the
 * SDK is involved.
 */
function isAbort(err: unknown): boolean {
  if (err instanceof APIUserAbortError) return true;
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/** One field, answered. `value` is always a string; the caller coerces. */
export interface RawFinding {
  field: DetailField;
  kind: FindingKind;
  value: string | null;
  basis: string | null;
  sourceUrl: string | null;
  sourceTier: SourceTier;
}

export interface RawAnswer {
  /** False when the model could not tell which book this is. Then `findings` is empty. */
  identified: boolean;
  /**
   * Which name the model actually recognised the book by — the primary title,
   * or one of the `Also known as` lines it was given. Null when it did not say,
   * or when there were no aliases to choose between.
   *
   * ⚠️ A LABEL, never a value. Nothing is written to `work` from it; the caller
   * uses it only to attribute an alias-sourced answer in the run record, so a
   * book found under a pen name or a bind-up title reads as *"identified as
   * 'The Ex Hex'"* rather than silently as its catalogued title. It cannot move
   * `work.title` — that would re-derive `work_key` and orphan the shared reviews,
   * the rule the whole alias feature exists to respect (`aliases.ts` header).
   */
  matchedTitle: string | null;
  note: string | null;
  findings: RawFinding[];
}

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    identified: { type: 'boolean' },
    matchedTitle: { type: ['string', 'null'] },
    note: { type: ['string', 'null'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: [...DETAIL_FIELDS] },
          kind: { type: 'string', enum: ['found', 'none', 'unknown'] },
          // ⚠️ String even for the year and the volume number. A union of
          // `["integer","string","null"]` is the kind of schema that makes a
          // model hedge between two shapes; one shape, coerced once on our side,
          // is fewer places to be wrong.
          value: { type: ['string', 'null'] },
          basis: { type: ['string', 'null'] },
          sourceUrl: { type: ['string', 'null'] },
          sourceTier: { type: 'string', enum: [...SOURCE_TIERS] },
        },
        required: ['field', 'kind', 'value', 'basis', 'sourceUrl', 'sourceTier'],
        additionalProperties: false,
      },
    },
  },
  required: ['identified', 'matchedTitle', 'note', 'findings'],
  additionalProperties: false,
} as const;

/**
 * Identical for every book, so it caches. The book goes in the user turn.
 *
 * Every rule below is here because of something measured in this catalog, not
 * because it sounded prudent. The §4.2 and §4.4 references are
 * `docs/info/isbn-ladder.md`.
 */
const SYSTEM_PROMPT = `You look up a small number of plain facts about one book and report only what a source states.

## Identifying the book

If you cannot confidently tell which book this is — the right title AND the right
author AND, where one is given, the right series — set identified to false, return
an empty findings array, and say why in note. A different book's details are far
worse than none: they get written into someone's catalog and look correct.

Two real failures from this catalog, both worth having in mind:

- "Firefight" by Brandon Sanderson matched a completely different 2001 novel also
  called Firefight. Same title, same author name, wrong book. Only the publisher
  and the year distinguished them.
- "Unsouled" by Will Wight (Hidden Gnome Publishing, 2016) matched a different
  2023 book also called Unsouled, from a different publisher.

So when a title is generic or a name is shared, say which publisher and which year
you are looking at in the basis, and if two candidates fit, choose neither.

## Other names this book is known by

The identity block may carry one or more "Also known as" lines. These are extra,
equally valid names the SAME book answers to — a pen name, a bind-up or omnibus
title, a title from another market, a series the household files it under. A match
on any one of them is a real identification, not a near miss: "The Ex Hex Duo" and
"The Ex Hex" are the same McRae bind-up, and finding the facts under the alias is
exactly why the alias was recorded.

So treat every "Also known as" line as a name to search under, and if the book you
settle on is the one an alias names, set identified to true. Set matchedTitle to
the exact name — primary title or an "Also known as" line — you actually
recognised it by, so the record can say which one paid off. If no alias was given,
or you matched on the primary title, set matchedTitle to the primary title. Set it
to null only when identified is false.

The identification bar is unchanged: right book, right author, right series where
given. An alias widens the names you may match on; it never lowers the certainty
required.

## Three answers per field, and the third one matters

For each field you were asked about, return exactly one finding with a kind:

- "found"   — a source states it. Put the value in value.
- "none"    — this book genuinely has no such thing. A true standalone has no
              series; a bind-up or a side story may genuinely have no volume
              number. Only use this when the absence is itself attested.
- "unknown" — you looked and could not settle it. Set value to null.

"unknown" is a useful, expected answer, not a failure. Roughly half of this
collection is Kindle Unlimited or Audible-native self-published work with no
library record anywhere. For those, unknown is usually the honest answer and you
should give it rather than reaching for a plausible-looking value.

Never guess. A guessed year sorts, filters and looks exactly like a fact.

## The fields

- firstPublished — the year the WORK was first published in any edition, as four
  digits. Not the year of a reprint, a box set or the edition someone happens to
  hold. If the only date you can find is a reissue, say so in basis and use
  unknown rather than the reissue year.
- series — the name of the series this book belongs to, as printed: "Cradle",
  "The Stormlight Archive". Not "Cradle Series", not "Cradle (Books 1-12)". A
  genuine standalone is kind "none".
- seriesIndex — this book's place in that series, as a number: "1", "2.5", "7".
  A side story, an "Extra", an omnibus or a sampler with no place on the number
  line is kind "none", not "1".
- description — one or two plain sentences saying what the book is and what
  happens in it. Not marketing copy, not a review, no score, no spoilers past the
  premise.

## Sources

Prefer the publisher's or author's own pages, then the series' own index or wiki,
then a retailer listing. Set sourceUrl to the page you actually took the fact
from, and sourceTier to what that page is:

- "official"     — the publisher's or the author's own site.
- "crowdfunding" — a Kickstarter, Patreon or BackerKit page for the book.
- "retail"       — Amazon, Kobo, a bookshop.
- "community"    — a wiki, a fan index, Goodreads, a forum.

basis is one sentence saying what the page states, in your words — for example
"Hidden Gnome Publishing's own Cradle page lists Unsouled as book 1, June 2016".
Do not report a numeric confidence and do not rank your answers; a person reads
the basis and the source and decides.`;

export interface ResearchInput {
  title: string;
  authors: string;
  /** Passed when known, so the model does not propose a different series. */
  series: string | null;
  /**
   * Other title names this same book answers to — `work_alias` rows of kind
   * `title`. Each becomes an "Also known as" line the model may match on, so a
   * book catalogued as "The Ex Hex Duo" can be found under the bind-up title
   * "The Ex Hex" the alias records. The caller caps and de-duplicates this; the
   * prompt sends them verbatim. Empty (the default) reproduces the exact
   * pre-alias prompt, so a work with no aliases is unaffected.
   */
  titleAliases?: readonly string[];
  /** Only the fields still missing. Anything recorded is never re-asked. */
  fields: readonly DetailField[];
}

export interface ResearchResult {
  answer: RawAnswer;
  usage: Usage;
}

/**
 * Ask about one book. Throws `ResearchError` on anything the caller should say
 * out loud; the caller writes every outcome, thrown or not, into `research_run`.
 */
export async function researchDetails(
  apiKey: string | undefined,
  input: ResearchInput,
): Promise<ResearchResult> {
  if (input.fields.length === 0) {
    throw new ResearchError('Nothing to look up — this book has no open questions.', 400);
  }
  const client = createClient(apiKey);

  // "Also known as" lines, one per alias, verbatim. Deduped and stripped of any
  // alias that merely repeats the primary title so the model is never handed the
  // same name twice. The caller already caps the count.
  const aliasLines = [...new Set(input.titleAliases ?? [])]
    .map((a) => a.trim())
    .filter((a) => a !== '' && a !== input.title.trim())
    .map((a) => `Also known as: ${a}`);

  const identity = [
    `Title: ${input.title}`,
    `Author: ${input.authors}`,
    ...aliasLines,
    input.series ? `Series (already recorded, treat as given): ${input.series}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const asked = input.fields.join(', ');

  const stream = client.messages.stream(
    {
      model: RESEARCH_MODEL,
      // Four short facts and a two-sentence description. Generous, but every
      // token the model is allowed is time this call is allowed to take.
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: RESEARCH_EFFORT,
        format: { type: 'json_schema', schema: ANSWER_SCHEMA },
      },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [
        // No allowed_domains. Unlike the tiered pass this schema also supports,
        // the whole job here is to *find* whichever page knows — restricting the
        // search to a publisher we have not identified yet would be circular.
        //
        // These budgets are a WALL-CLOCK cost, not a subrequest one: search and
        // fetch run on Anthropic's side, so they cost the Worker nothing against
        // its 50-subrequest ceiling and everything against the timeout above.
        { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 2 },
      ],
      messages: [
        {
          role: 'user',
          content: `${identity}

Look up exactly these fields for this book: ${asked}.

Return one finding per field, in that order. Answer from the search results where
you can; open a page only when the snippet is not enough. Anything you cannot
settle is kind "unknown" — that is a fine answer here.`,
        },
      ],
    },
    // A lookup that runs away must *fail*, not vanish. Without this the promise
    // stays pending until something outside kills it, and on a Worker that kill
    // is silent. Aborting throws, which lands in a catch and gets written down.
    // No retry: a timeout retried twice is three times the wall clock this
    // exists to bound, and it is three times the money.
    { signal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS), maxRetries: 0 },
  );

  const message = await stream.finalMessage().catch((err: unknown) => {
    if (isAbort(err)) {
      throw new ResearchError(
        `The lookup was still searching after ${Math.round(RESEARCH_TIMEOUT_MS / 1000)}s and was stopped.`,
        504,
      );
    }
    throw err;
  });

  if (message.stop_reason === 'pause_turn') {
    throw new ResearchError('The lookup used its whole search budget without finishing.', 502);
  }

  const answer = parseStructured<RawAnswer>(message);
  return { answer, usage: usageOf(message) };
}

/** Roughly what one of these costs, for showing before a bulk run rather than after. */
export const RESEARCH_CENTS_EACH = { low: 2, high: 8 };
