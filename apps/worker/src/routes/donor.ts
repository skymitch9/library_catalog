import { Hono } from 'hono';
import {
  DETAIL_FIELDS,
  MIN_AUTHOR_SIMILARITY,
  MIN_TITLE_SIMILARITY,
  UNKNOWN_AUTHOR,
  normaliseTitle,
  titleSimilarity,
  workKeyFor,
  type DetailField,
} from '@lc/core';
import { findWorkByKey, getWork, listWorksForMatching, type Work } from '@lc/db';
import type { AppBindings } from '../env.js';
import { secretEquals } from '../lib/secret-equals.js';

/**
 * The donor endpoint: what THIS catalog already knows about a book, for a
 * sibling instance's details sweep to copy instead of paying an AI to rediscover.
 *
 * Owner ask 2026-08-16: *"before pinging the ai it checks other libraries for
 * answers. If I have Stormlight Archive don't have her look it up."* The friend
 * instance (padhard.heygabi.ai) has no ANTHROPIC_API_KEY; this route is how her
 * sweep heals details from the main library for free. Both instances carry the
 * route — reciprocity is just a `DONOR_URL` var flip on the main instance later.
 *
 * ## The gate: 404 for everything that is not the one legitimate caller
 *
 * `X-Donor-Token` must equal `DONOR_TOKEN` (a secret, set on both instances).
 * Unset token, absent header, wrong value — all answer 404, indistinguishable
 * from the route not existing. Deliberately NOT the ingest route's 404/401
 * split: ingest has a configurable client whose operator benefits from being
 * told "the token you sent is wrong"; this route's only caller is our own
 * sweep holding the same secret, so a mismatch is an attacker or a
 * misconfiguration, and neither is owed a hint that the door exists.
 * Comparison via `secretEquals`, the one timing-safe implementation.
 *
 * ## Matching: the canonical fold, and no guessing
 *
 * `workKeyFor` / `normaliseTitle` — the SAME one-implementation functions that
 * produce `work.work_key` (see CLAUDE.md; they are persisted-key producers and
 * are reused here, never reimplemented). With an author: exact `work_key`
 * lookup. Without one, or when the key misses: a unique normalised-title match
 * over the catalog (116 rows — one query, filtered in memory, the
 * `listWorksNeedingDetails` precedent). ⚠️ Two works sharing a folded title is
 * a NO-match, not a coin flip — a donor that guesses writes a wrong author's
 * details into someone else's catalog, which is exactly the §4.4 failure shape
 * (right title, wrong book) with no person in the loop to catch it.
 *
 * ## The answer
 *
 * Only `DETAIL_FIELDS` values, only the filled ones — this catalog's recorded
 * facts, never claims researched on demand. `seriesIndex` carries
 * `series_index_sort` (where the book files in the ladder); `series_index_display`
 * quotes a cover the caller does not hold, so it is deliberately not offered.
 * No match is still `200 {matched:false}`, so the caller can tell "donor
 * reachable, no answer" from "donor down" — the two mean different things to
 * its retry logic.
 *
 * ## The shortlist: `?candidates=1`, and only then
 *
 * Owner ask 2026-08-16 (the rung after this route shipped): *"have our ai model
 * do a back up search on donors for fuzzy match before going to web."* On an
 * exact MISS — and only when the caller asks — the reply carries up to
 * `CANDIDATE_LIMIT` rows this catalog holds that *might* be the same work,
 * each with the fields it could donate. The caller then pays for one small
 * Claude call to decide (`packages/research/src/donor-match.ts`); this route
 * still decides nothing.
 *
 * ⚠️ **The parameter is opt-in because the shortlist costs D1 reads.** A
 * donor-only instance (no `ANTHROPIC_API_KEY`, which is exactly the friend
 * instance's configuration) has nothing to judge with, so it never asks, and
 * its behaviour is byte-for-byte what it was before this existed.
 *
 * ⚠️ **Selection reuses the canonical similarity functions and adds none.**
 * `titleSimilarity` / `MIN_TITLE_SIMILARITY` / `MIN_AUTHOR_SIMILARITY` are the
 * ported-verbatim gate `matching.ts` warns against re-implementing ("that
 * project shipped three wrong-game matches ... every one came from a second
 * similarity function drifting from the first"). Filtering happens in memory
 * over the one `listWorksForMatching` read the exact rung already makes — 116
 * rows, the `listWorksNeedingDetails` precedent — rather than as a second
 * `LIKE` query, because a `LIKE` cannot fold the *query* the way the canonical
 * normaliser does and would therefore be a fourth matching rule.
 *
 * ⚠️ **A shared author alone never shortlists anything.** A candidate with no
 * word in common with the wanted title is dropped however well the author
 * matches — one author writes forty books, and offering all forty to a judge is
 * how the §4.4 failure (right author, wrong book) gets an opportunity.
 */

/**
 * One row that *might* be the same work, offered for a caller's judge to rule
 * on. Never a claim that it is — the whole point of the shortlist is that this
 * route still refuses to guess.
 */
export interface DonorCandidate {
  workId: number;
  title: string;
  /** Null for a work recorded without an author (migration 0120's sentinel, mapped out). */
  authors: string | null;
  /** The canonical folded title — what the exact rung compared and did not match. */
  fold: string;
  /** Why it made the list: the canonical title score, and whether the author lines agree. */
  titleScore: number;
  authorAgrees: boolean;
  /** Exactly what it could donate, so a confident verdict needs no second round trip. */
  details: Partial<Record<DetailField, string | number>>;
}

/** What one donor lookup says. Shared with the sweep's caller-side typing. */
export interface DonorDetailsReply {
  matched: boolean;
  /** The matched work, for the caller's audit line. Absent when `matched` is false. */
  workId?: number;
  title?: string;
  /** Only the filled DETAIL_FIELDS. `seriesIndex` is the sort position. */
  details: Partial<Record<DetailField, string | number>>;
  /**
   * Present only on a MISS, and only when the caller sent `candidates=1`.
   * Absent and empty mean the same thing to the caller — nothing to judge.
   */
  candidates?: DonorCandidate[];
}

/**
 * How many rows one miss may offer. Five, and the smallness is the feature:
 * every extra row is another chance for a judge to pick wrong, and the
 * shortlist rides in one prompt whose cost is the reason this rung exists.
 */
export const CANDIDATE_LIMIT = 5;

/** One row as `listWorksForMatching` returns it — the raw column, sentinel and all. */
interface MatchRow {
  id: number;
  title: string;
  authors: string;
}

/**
 * Rank the catalog against a title (and an author, when one was given), best
 * first. Pure and exported: this is the whole selection policy, so it is pinned
 * by tests directly rather than through a copy of itself.
 *
 * Two admissions, in this order:
 *
 * 1. `titleSimilarity >= MIN_TITLE_SIMILARITY` — the canonical floor for a
 *    title a caller named itself.
 * 2. the author lines agree AND *some* word of the title is shared. Lower bar
 *    on the title because the author is corroborating it; never zero, per the
 *    header.
 *
 * Ranked by the title score with a fixed bonus for an agreeing author, so a
 * same-author near-miss outranks a stranger's exact-looking title. Ties go to
 * the lower id, so the answer is stable across calls.
 */
export function rankCandidates(
  rows: readonly MatchRow[],
  title: string,
  author: string,
  limit = CANDIDATE_LIMIT,
): { row: MatchRow; titleScore: number; authorAgrees: boolean }[] {
  const wanted = title.trim();
  if (!wanted) return [];
  const scored: { row: MatchRow; titleScore: number; authorAgrees: boolean }[] = [];

  for (const row of rows) {
    const titleScore = titleSimilarity(row.title, wanted);
    const rowAuthor = row.authors === UNKNOWN_AUTHOR ? '' : (row.authors ?? '');
    const authorAgrees =
      author.trim() !== '' &&
      rowAuthor.trim() !== '' &&
      titleSimilarity(rowAuthor, author) >= MIN_AUTHOR_SIMILARITY;

    const admitted = titleScore >= MIN_TITLE_SIMILARITY || (authorAgrees && titleScore > 0);
    if (!admitted) continue;
    scored.push({ row, titleScore, authorAgrees });
  }

  scored.sort((a, b) => {
    const rank = (s: (typeof scored)[number]) => s.titleScore + (s.authorAgrees ? 0.5 : 0);
    const diff = rank(b) - rank(a);
    if (diff !== 0) return diff;
    return a.row.id - b.row.id;
  });
  return scored.slice(0, limit);
}

/**
 * The filled detail values of one work, in `DETAIL_FIELDS` order. Pure and
 * exported: this is the donor's whole editorial policy — what it will and will
 * not hand out — so it is pinned by tests directly.
 */
export function donorDetailsFor(
  work: Pick<Work, 'firstPublished' | 'series' | 'seriesIndexSort' | 'description'>,
): Partial<Record<DetailField, string | number>> {
  const details: Partial<Record<DetailField, string | number>> = {};
  const blank = (v: string | number | null) =>
    v == null || (typeof v === 'string' && v.trim() === '');
  for (const field of DETAIL_FIELDS) {
    switch (field) {
      case 'firstPublished':
        if (!blank(work.firstPublished)) details.firstPublished = work.firstPublished as number;
        break;
      case 'series':
        if (!blank(work.series)) details.series = work.series as string;
        break;
      case 'seriesIndex':
        // Sort only. Display quotes the cover, and the caller's copy of the
        // book has its own cover — see the header.
        //
        // ⚠️ This refusal is now the ODD ONE OUT and is kept deliberately, not
        // by inertia. Since 2026-08-19 both machines that WRITE the column
        // derive it (`seriesIndexDisplayFrom`), because nothing in this repo
        // has ever actually read a cover — so the donor withholding a value it
        // holds, while the caller writes a derivation of the same number, is
        // strictly worse for the caller: this catalog's 81 hand-quoted forms
        // (`Volume 07`, `Prequel`) are BETTER than what the caller will derive
        // without them. Widening this is logged in docs/TODO.md; it needs a key
        // wider than `DetailField`, which is why it is not a one-line change
        // and why it did not ride along with the convergence fix.
        if (work.seriesIndexSort != null) details.seriesIndex = work.seriesIndexSort;
        break;
      case 'description':
        if (!blank(work.description)) details.description = work.description as string;
        break;
    }
  }
  return details;
}

export const donorRoutes = new Hono<AppBindings>()
  .use('*', async (c, next) => {
    const expected = c.env.DONOR_TOKEN;
    const presented = c.req.header('X-Donor-Token') ?? '';
    // One answer for every way of being wrong — see the header. The body
    // matches the app's ordinary unmatched-/api/* shape on purpose.
    if (!expected || !presented || !secretEquals(presented, expected)) {
      return c.json({ error: 'not_found', path: c.req.path }, 404);
    }
    await next();
  })

  .get('/details', async (c) => {
    const title = (c.req.query('title') ?? '').trim();
    const author = (c.req.query('author') ?? '').trim();
    if (!title) {
      // The caller is our own sweep, so a 400 here means a bug there — say so
      // plainly rather than answering matched:false and hiding it.
      return c.json({ error: 'bad_request', detail: 'title is required' }, 400);
    }

    // Opt-in, because the shortlist costs reads a donor-only caller cannot use.
    const wantsCandidates = c.req.query('candidates') === '1';

    let work: Work | null = null;
    let all: MatchRow[] | null = null;
    if (author) {
      work = await findWorkByKey(c.env.DB, workKeyFor(title, author));
    }
    if (!work) {
      const wanted = normaliseTitle(title);
      all = await listWorksForMatching(c.env.DB);
      const hits = all.filter((w) => normaliseTitle(w.title) === wanted);
      // Exactly one, or nobody. Ambiguity must not guess — header.
      if (hits.length === 1) work = await getWork(c.env.DB, hits[0]!.id);
    }

    if (!work) {
      if (!wantsCandidates) {
        return c.json({ matched: false, details: {} } satisfies DonorDetailsReply, 200);
      }
      // The author path can reach here without having read the catalog yet.
      all ??= await listWorksForMatching(c.env.DB);
      const ranked = rankCandidates(all, title, author);
      const candidates: DonorCandidate[] = [];
      for (const hit of ranked) {
        const row = await getWork(c.env.DB, hit.row.id);
        if (!row) continue; // Deleted between the two reads. Not an error.
        const details = donorDetailsFor(row);
        // ⚠️ A candidate with nothing to donate is not a candidate — it is a
        // paid judgement whose best possible outcome is "yes, and I still have
        // nothing for you". Dropped here rather than judged and discarded.
        if (Object.keys(details).length === 0) continue;
        candidates.push({
          workId: row.id,
          title: row.title,
          authors: row.authors,
          fold: normaliseTitle(row.title),
          titleScore: hit.titleScore,
          authorAgrees: hit.authorAgrees,
          details,
        });
      }
      return c.json({ matched: false, details: {}, candidates } satisfies DonorDetailsReply, 200);
    }
    return c.json(
      {
        matched: true,
        workId: work.id,
        title: work.title,
        details: donorDetailsFor(work),
      } satisfies DonorDetailsReply,
      200,
    );
  });
