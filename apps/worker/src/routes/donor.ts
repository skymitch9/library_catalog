import { Hono } from 'hono';
import { DETAIL_FIELDS, normaliseTitle, workKeyFor, type DetailField } from '@lc/core';
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
 */

/** What one donor lookup says. Shared with the sweep's caller-side typing. */
export interface DonorDetailsReply {
  matched: boolean;
  /** The matched work, for the caller's audit line. Absent when `matched` is false. */
  workId?: number;
  title?: string;
  /** Only the filled DETAIL_FIELDS. `seriesIndex` is the sort position. */
  details: Partial<Record<DetailField, string | number>>;
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

    let work: Work | null = null;
    if (author) {
      work = await findWorkByKey(c.env.DB, workKeyFor(title, author));
    }
    if (!work) {
      const wanted = normaliseTitle(title);
      const all = await listWorksForMatching(c.env.DB);
      const hits = all.filter((w) => normaliseTitle(w.title) === wanted);
      // Exactly one, or nobody. Ambiguity must not guess — header.
      if (hits.length === 1) work = await getWork(c.env.DB, hits[0]!.id);
    }

    if (!work) {
      return c.json({ matched: false, details: {} } satisfies DonorDetailsReply, 200);
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
