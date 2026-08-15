/**
 * One series, one open-web pass: the complete canonical volume list, if it can
 * be found at all.
 *
 * ## What this is for
 *
 * `packages/core/src/completeness.ts` already knows how to turn a list of
 * volumes into "here is what you are missing" — that arithmetic is free and
 * cannot be wrong. What it cannot do for itself is *find* the list: today that
 * comes from a person typing (`source: 'manual'`) or from the sibling
 * audiobook catalog's curated CSV (`source: 'audiobook_catalog'`), and 12 of 25
 * series in this household have no counterpart there at all. This is the rung
 * `details.ts` is for individual books, aimed at a whole series instead: ask a
 * model with a web-search tool to read a publisher's series page, a fan index,
 * or a retailer's listing, and report back every numbered volume it can
 * actually name.
 *
 * ## ⚠️ It proposes. It never writes, and it never decides anything is missing.
 *
 * Same rule as `details.ts`, for the same reason (`isbn-ladder.md` §4.4): a
 * wrong answer here would not merely mislabel one field, it would populate an
 * entire series' "missing" list with titles nobody asked for. Everything
 * returned here is a claim about what a source says exists; the caller decides
 * what to do with it, and `completeness.ts`'s existing rules about `wanted`,
 * `skipped` and audio holdings are what keep a proposed volume from turning into
 * an unwanted purchase on its own.
 *
 * ## Two shapes that will produce a wrong list if the model is not warned
 *
 * A still-releasing web serial or self-published series has no fixed length,
 * and its print compilations frequently do not match its own online numbering —
 * *The Wandering Inn* is the case this household actually owns, split into
 * half-volumes for print. Forcing a confident, single answer out of either shape
 * produces a number that sorts and filters and is quietly wrong, which is
 * exactly the failure this whole package exists to avoid. `openEnded` and the
 * two `note` fields are how the model is allowed to say "here is what I found,
 * and here is why you should not fully trust the shape of it" instead.
 */

import { APIUserAbortError } from '@anthropic-ai/sdk';
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
 * Same bound, same reasoning, as `RESEARCH_TIMEOUT_MS` in `details.ts` — a
 * ceiling the *caller* survives, not a guess at how long the model needs. See
 * that file's header for the full argument about `waitUntil`'s silent ~30s cut.
 */
export const SERIES_SCAN_TIMEOUT_MS = 90_000;

/** Same three-spelling check as `details.ts`'s `isAbort`, duplicated on purpose — see `covers.ts` for the precedent of each research rung standing on its own. */
function isAbort(err: unknown): boolean {
  if (err instanceof APIUserAbortError) return true;
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/** One volume, as a source described it. `index` and `title` are the only two required to mean anything. */
export interface RawSeriesVolume {
  /** Its place on the number line, as a plain number: "1", "2.5", "7". */
  index: string;
  /** Exactly how the source prints the number, when it prints one at all: "Book 7", "Vol. 07", "#3". */
  display: string | null;
  title: string;
  /** Null when the series' usual author wrote it — no need to repeat it every row. */
  authors: string | null;
  /** Four digits, or null. A nice-to-have; never guessed. */
  year: string | null;
  sourceUrl: string | null;
  /** Anything about this ONE volume worth a person reading — a retitle, a bind-up, a disputed number. */
  note: string | null;
}

export interface RawSeriesAnswer {
  /** False when the series could not be confidently identified. Then `volumes` is empty. */
  identified: boolean;
  /**
   * True when the source itself describes this as still being written, or when
   * the numbering online and the numbering in print visibly do not agree.
   */
  openEnded: boolean;
  /** Anything about the SERIES as a whole worth a person reading — sources disagreeing, a numbering quirk, why identified is false. */
  note: string | null;
  volumes: RawSeriesVolume[];
}

const SERIES_ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    identified: { type: 'boolean' },
    openEnded: { type: 'boolean' },
    note: { type: ['string', 'null'] },
    volumes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'string' },
          display: { type: ['string', 'null'] },
          title: { type: 'string' },
          authors: { type: ['string', 'null'] },
          year: { type: ['string', 'null'] },
          sourceUrl: { type: ['string', 'null'] },
          note: { type: ['string', 'null'] },
        },
        required: ['index', 'display', 'title', 'authors', 'year', 'sourceUrl', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['identified', 'openEnded', 'note', 'volumes'],
  additionalProperties: false,
} as const;

/**
 * Identical for every series, so it caches. The series goes in the user turn.
 *
 * Mirrors `details.ts`'s `SYSTEM_PROMPT` in shape and in the failures it is
 * written to avoid — the same catalog, the same "a wrong answer is worse than
 * none" rule, aimed at a whole run of books instead of one.
 */
const SYSTEM_PROMPT = `You are given the name of a book series and asked for its complete canonical volume list — every numbered book in the main line, with a title, and a year when you can find one cheaply.

## Identifying the series first

If you cannot confidently confirm which series this is — the name is generic, or more than one series by different authors could share it — set identified to false, return an empty volumes array, and say why in note. A list built for the wrong series is worse than no list: every title on it gets written into someone's catalog as though it belonged there.

## What counts as a volume

List only entries with a genuine place on the series' OWN numbering, as its publisher or author numbers it. A side story, a short, an anthology or an omnibus the series' own index does not number belongs in a note, not in volumes — unless you can state its number with real confidence.

Never invent a volume to fill a gap. If a source says a series has N books but you can only find titles for some of them, report the ones you can name and say in the top-level note that the run is not fully accounted for. Do not pad the list with placeholders.

## Two shapes that will mislead you if you are not careful

- A series still being written — especially a web serial or a self-published
  series releasing piece by piece — often has no fixed length, and its print
  compilations frequently do NOT map one-to-one onto how the author numbers it
  online. Set openEnded to true whenever a source describes the series as
  ongoing, OR the online numbering and the print numbering visibly disagree, and
  explain the mismatch in note rather than silently picking one convention and
  presenting it as settled.
- A series printed in split volumes — one numbered book divided into a Part 1
  and Part 2 for print, sold as a single volume elsewhere. If you find this,
  say so in note rather than choosing one convention and hiding the other.

## Sources

Prefer the publisher's or author's own series page, then a fan-maintained series index or wiki, then a retailer's series listing. sourceUrl on a volume is the page that actually named it — leave it null rather than reuse a series-level page you did not check for that specific volume. year is the year that volume was first published, as four digits; leave it null rather than guess. It is a nice-to-have, not a requirement, and a wrong year is worse than a missing one.

Do not report a numeric confidence and do not rank the volumes; a person reads note and sourceUrl and decides.`;

export interface SeriesScanKnownVolume {
  index: number;
  /** What the cover or a prior source says: "Book 7", "Volume 07". */
  display: string | null;
  title: string | null;
}

export interface SeriesScanInput {
  series: string;
  /** The author(s) already on file, so the model does not answer for a same-named series by somebody else. */
  authors: string | null;
  /**
   * What this catalog already has, for grounding only. The model is asked to
   * report the complete list regardless — this is not a filter on what it may
   * say, only context for a name that could otherwise mean more than one thing.
   */
  known: readonly SeriesScanKnownVolume[];
}

export interface SeriesScanResult {
  answer: RawSeriesAnswer;
  usage: Usage;
}

/**
 * Ask about one series. Throws `ResearchError` on anything the caller should
 * say out loud; the caller decides what, if anything, gets written to
 * `series_volume` and `series_check`.
 */
export async function researchSeriesVolumes(
  apiKey: string | undefined,
  input: SeriesScanInput,
): Promise<SeriesScanResult> {
  const client = createClient(apiKey);

  const knownLines = input.known
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((v) => `  ${v.display ?? v.index}${v.title ? ` — ${v.title}` : ''}`)
    .join('\n');

  const identity = [
    `Series: ${input.series}`,
    input.authors ? `Author (already recorded, treat as given): ${input.authors}` : null,
    knownLines
      ? `Already on file, for context only — report the complete list you find regardless:\n${knownLines}`
      : 'Nothing about this series is on file yet.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const stream = client.messages.stream(
    {
      model: RESEARCH_MODEL,
      // A series can run to dozens of volumes; the ceiling here is generous
      // because it is a token BUDGET, not a target — most series will use a
      // fraction of it. The wall-clock bound is `SERIES_SCAN_TIMEOUT_MS`.
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: RESEARCH_EFFORT,
        format: { type: 'json_schema', schema: SERIES_ANSWER_SCHEMA },
      },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [
        // A whole series' worth of pages to check, so a slightly wider budget
        // than the per-book rungs — still cheap at `RESEARCH_EFFORT`'s low tier.
        { type: 'web_search_20260209', name: 'web_search', max_uses: 6 },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 },
      ],
      messages: [
        {
          role: 'user',
          content: `${identity}

Find the complete canonical volume list for this series — the title of every
numbered book, and a year when it is cheap to confirm. Report the full list you
find, even for volumes already listed above as on file; that lets a mismatch in
numbering or title be seen instead of silently assumed away.`,
        },
      ],
    },
    { signal: AbortSignal.timeout(SERIES_SCAN_TIMEOUT_MS), maxRetries: 0 },
  );

  const message = await stream.finalMessage().catch((err: unknown) => {
    if (isAbort(err)) {
      throw new ResearchError(
        `The scan was still searching after ${Math.round(SERIES_SCAN_TIMEOUT_MS / 1000)}s and was stopped.`,
        504,
      );
    }
    throw err;
  });

  if (message.stop_reason === 'pause_turn') {
    throw new ResearchError('The scan used its whole search budget without finishing.', 502);
  }

  const answer = parseStructured<RawSeriesAnswer>(message);
  return { answer, usage: usageOf(message) };
}

/**
 * Roughly what one series scan costs, for showing before a scan rather than
 * only after. Same shape and same honesty as `COVER_CENTS_EACH`: token cost at
 * `RESEARCH_EFFORT`'s low tier is a couple of cents; web search is billed
 * separately at $10 per 1,000 searches, up to 6 more here. Call it 8 cents a
 * series, worst case, from list prices and the shape of the request — not a
 * measurement. Re-derive it from `usage` once real scans exist.
 */
export const SERIES_SCAN_CENTS_ESTIMATE = 8;
