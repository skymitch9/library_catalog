/**
 * One cheap question: **is the donor's row the same WORK as ours?**
 *
 * Owner ask 2026-08-16, immediately after the donor-first sweep landed: *"have
 * our ai model do a back up search on donors for fuzzy match before going to
 * web."* The ladder the sweep now walks is:
 *
 * | Rung | What it is | What it costs |
 * |---|---|---|
 * | 1. exact | `work_key`, or a unique folded title (`routes/donor.ts`) | one fetch, no model |
 * | 2. **judged** | a ≤5-row shortlist from the donor, this one call | one fetch + ~0.1¢ |
 * | 3. web | `researchDetails` — the open-web pass | ~2¢ (`RESEARCH_CENTS_EACH.low`) |
 *
 * ## Why this is a separate call and a separate (small) model
 *
 * `details.ts` buys *facts nobody here holds*, with web search, on the biggest
 * model, and it is priced accordingly. This buys **an identity decision between
 * rows we already hold both sides of** — two titles and two author lines, no
 * search, no browsing, one short answer. That is the shape Haiku is for, and
 * the whole point of the rung is that it must be cheap enough to be worth
 * trying *before* the expensive one. A rung that cost the same as rung 3 would
 * be a rung with no reason to exist.
 *
 * ## ⚠️ It decides identity. It never proposes a value.
 *
 * The model is shown titles and authors and nothing else: never the details it
 * would be authorising a copy of. It cannot "improve" a description or pick a
 * year, and it is never asked to — the values come from the donor's own
 * catalog, exactly as they do on rung 1. Keeping the judge blind to them is
 * what stops this becoming a second, unaudited research pass.
 *
 * ## ⚠️ Three answers, and the third is the useful one
 *
 * `same` / `different` / `unsure`, plus a coarse `confidence`. Only
 * `same` + `high` is allowed to write anything without a person (the caller
 * enforces that — `judgedOutcome` in `details-sweep.ts`); everything else
 * leaves a **pending** proposal a person decides on and falls through to rung
 * 3. That is the games matcher's confirm-first rule, and it is here because
 * this rung persists real data into someone's catalog: isbn-ladder.md §4.4
 * records a wrong answer scoring 1.00 on title *and* 1.00 on author, twice, and
 * only a human reading the publisher caught it.
 */

import {
  ResearchError,
  createClient,
  parseStructured,
  usageOf,
  type Usage,
} from './client.js';

/**
 * ⚠️ Haiku on purpose — see the header. Written into `research_run.model` (as
 * part of `donor+<model>`) so a value copied six months from now is traceable
 * to the judge that admitted it.
 */
export const DONOR_JUDGE_MODEL = 'claude-haiku-4-5';

/**
 * How long the judge may take before it is written off.
 *
 * Far below `RESEARCH_TIMEOUT_MS` (90s) because this call has no search and no
 * browsing to do — it is one short answer about two names. A judge that is
 * slow is a judge that has eaten the window rung 3 still needs, and rung 3 is
 * the one that can actually answer.
 */
export const DONOR_JUDGE_TIMEOUT_MS = 20_000;

/** One row the donor offered, as the judge is allowed to see it. */
export interface DonorJudgeCandidate {
  workId: number;
  title: string;
  authors: string | null;
}

export interface DonorJudgeInput {
  /** The book THIS catalog is missing details for. */
  title: string;
  authors: string | null;
  /** The donor's shortlist. Capped by the donor; ≤5 in practice. */
  candidates: readonly DonorJudgeCandidate[];
}

/**
 * The verdict, deliberately coarse.
 *
 * `confidence` is three words rather than a number because a number invites a
 * threshold nobody calibrated — the same argument `ResearchFinding.confidence`
 * makes by being permanently null. There is exactly one threshold here and it
 * is stated in words: `same` + `high`, and nothing else, may write unattended.
 */
export interface DonorJudgeVerdict {
  verdict: 'same' | 'different' | 'unsure';
  /** Which candidate, by the donor's work id. Null when `different`. */
  workId: number | null;
  confidence: 'high' | 'medium' | 'low';
  /** One sentence, kept for the finding's basis and the run's detail line. */
  why: string;
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['same', 'different', 'unsure'] },
    // ⚠️ Nullable integer rather than "omit when different": a model that may
    // leave a field out will sometimes leave it out when it mattered.
    workId: { type: ['integer', 'null'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    why: { type: 'string' },
  },
  required: ['verdict', 'workId', 'confidence', 'why'],
  additionalProperties: false,
} as const;

/**
 * Byte-identical for every book, so it caches if it is ever long enough to
 * (Haiku's cacheable minimum is 4096 tokens, and this is nowhere near it — the
 * `cache_control` is deliberately absent rather than present and inert).
 */
const SYSTEM_PROMPT = `You decide whether two catalog rows describe the SAME published WORK.

You are given one book from a personal library, and a short list of candidate rows from a
second personal library. Exactly one candidate may be the same work; usually none is.

Same work means the same text by the same author — a different printing, a different
edition, a subtitle added or dropped, a series name in the title or not, an omnibus
listed under its first volume's name. Translations and re-titles of the same text count.

NOT the same work:
- A different book that happens to share a title. Books called "Gold", "Firefight" or
  "Unsouled" exist several times over, by different authors and different publishers.
- A different volume of the same series. Book 2 is not book 1, however similar the titles.
- A companion, guide, art book, sampler or side story, versus the novel it accompanies.
- An omnibus versus one of the individual volumes printed inside it.

Answer with one verdict:
- "same"      — one candidate is the same work. Put its workId in workId.
- "different" — none of them is. workId must be null.
- "unsure"    — you cannot settle it. Put the closest candidate's workId in workId if
                there is one, otherwise null.

Then rate your own certainty:
- "high"   — the author matches and the title differences are the ordinary ones above.
- "medium" — probably, but something does not line up: an author you cannot confirm,
             a volume number that may or may not be part of the title, a common title.
- "low"    — a guess.

Only "same" with "high" is ever acted on without a person, so use "high" strictly:
if two candidates both fit, or the author cannot be reconciled, that is "unsure", not
"same". A wrong "same" writes another book's facts into someone's catalog, where they
look completely correct.

why is one plain sentence saying what decided it — name the author or the title
difference you relied on.`;

export interface DonorJudgeResult {
  verdict: DonorJudgeVerdict;
  usage: Usage;
}

/**
 * Roughly what one judgement costs, in cents.
 *
 * ⚠️ **Not `estimateCents`** — that one is Claude Opus 5's list price ($5/$25
 * per MTok) and this call runs on Haiku 4.5 ($1/$5). Charging the judge at
 * Opus rates would overstate it fivefold on the one screen anybody reads cost
 * from. Measured shape: ~550 tokens in, ~120 out ⇒ **≈0.12¢ a book**, against
 * ~2¢ for the web pass it is trying to avoid.
 */
export function estimateJudgeCents(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * 100 + (outputTokens / 1_000_000) * 500;
}

/**
 * Ask once. Throws `ResearchError` on anything the caller should record; the
 * caller (the sweep) never lets it escape into `scheduled()`.
 */
export async function judgeDonorMatch(
  apiKey: string | undefined,
  input: DonorJudgeInput,
): Promise<DonorJudgeResult> {
  if (input.candidates.length === 0) {
    throw new ResearchError('Nothing to judge — the donor offered no candidates.', 400);
  }
  const client = createClient(apiKey);

  const ours = [`Title: ${input.title}`, `Author: ${input.authors ?? '(not recorded)'}`].join('\n');
  const theirs = input.candidates
    .map(
      (c) =>
        `- workId ${c.workId}: "${c.title}" by ${c.authors && c.authors.trim() ? c.authors : '(not recorded)'}`,
    )
    .join('\n');

  const message = await client.messages.create(
    {
      model: DONOR_JUDGE_MODEL,
      // One short structured answer. Generous enough for the `why` sentence and
      // nothing more; a bigger ceiling here only buys latency.
      max_tokens: 500,
      output_config: { format: { type: 'json_schema', schema: VERDICT_SCHEMA } },
      system: [{ type: 'text', text: SYSTEM_PROMPT }],
      messages: [
        {
          role: 'user',
          content: `Our book:
${ours}

Candidates from the other library:
${theirs}

Is one of them the same work as our book?`,
        },
      ],
    },
    // Same reasoning as `researchDetails`: a call that runs away must FAIL, not
    // hang — a pending promise in a scheduled handler is killed silently.
    { signal: AbortSignal.timeout(DONOR_JUDGE_TIMEOUT_MS), maxRetries: 0 },
  );

  const verdict = parseStructured<DonorJudgeVerdict>(
    message as unknown as {
      stop_reason?: string | null;
      stop_details?: { category?: string | null } | null;
      content: { type: string; text?: string }[];
    },
  );
  return { verdict, usage: usageOf(message) };
}
