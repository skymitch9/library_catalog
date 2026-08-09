import { Hono } from 'hono';
import { MIN_TITLE_SIMILARITY, titleSimilarity, primaryAuthor, normaliseTitle } from '@lc/core';
import { getWork } from '@lc/db';
import { searchOpenLibrary } from '@lc/isbn';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * "See what Open Library knows about this book."
 *
 * ## ⚠️ It proposes. It does not write.
 *
 * Same rule as the scan path, for the same measured reason: Open Library
 * answers a title query with a confident, well-formed, **wrong** book often
 * enough to matter. "Firefight" + "Brandon Sanderson" returns a different 2001
 * novel called Firefight; free-text "The Wandering Inn" + "pirateaba" returns
 * *Garden of Sanctuary*. Nothing in either response is marked as a guess.
 *
 * So every candidate is scored against what we already hold and returned with
 * that score. The client shows them and a person picks — or picks none, which
 * for this library is the common outcome.
 *
 * ## ⚠️ Expect nothing, most of the time
 *
 * Measured 2026-08-09 over 30 titles sampled across this household's own
 * catalog: **14 of 30** resolved. The misses are the Kindle Unlimited and
 * Audible-native indie half, which has no ISBN and no library record anywhere.
 * An empty answer here is the expected outcome, not a failure, and the route
 * says so rather than returning a bare empty array that reads like a bug.
 */
export const enrichRoutes = new Hono<AppBindings>().get(
  '/works/:id/candidates',
  requireCapability('editCatalog'),
  async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

    const work = await getWork(c.env.DB, id);
    if (!work) return c.json({ error: 'not_found' }, 404);

    // `searchOpenLibrary` applies `cleanAudiobookTitle` itself — measured to
    // take the hit rate from 5/30 to 14/30 — so the raw title is passed through
    // deliberately rather than pre-cleaned here.
    const found = await searchOpenLibrary(work.title, primaryAuthor(work.authors), {
      userAgent: 'library_catalog (private household catalog)',
    }).catch(() => []);

    const scored = found
      .map((candidate) => ({
        ...candidate,
        similarity: titleSimilarity(
          normaliseTitle(candidate.title),
          normaliseTitle(work.title),
        ),
        authorSimilarity: titleSimilarity(
          normaliseTitle(primaryAuthor(candidate.authors)),
          normaliseTitle(primaryAuthor(work.authors)),
        ),
      }))
      // The same floor a person-named title gets on the barcode path. Below it
      // the match is a guess, and offering guesses is how the wrong cover ends
      // up on the right book.
      .filter((candidate) => candidate.similarity >= MIN_TITLE_SIMILARITY)
      .sort((a, b) => b.similarity - a.similarity);

    return c.json({
      candidates: scored,
      // A sentence rather than an empty array, because "nothing found" is the
      // expected answer for about half this library and a person needs to know
      // that is normal.
      note:
        scored.length === 0
          ? 'Open Library has nothing matching. About half this library is not in it — mostly Kindle Unlimited and Audible-native titles. Fill it in by hand.'
          : null,
    });
  },
);
