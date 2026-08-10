import { Hono } from 'hono';
import {
  MIN_TITLE_SIMILARITY,
  bestSimilarity,
  foldAuthorNames,
  foldTitleNames,
  normaliseTitle,
  primaryAuthor,
} from '@lc/core';
import { getWork, listAliasesForWork } from '@lc/db';
import { searchOpenLibrary } from '@lc/isbn';
import type { BookCandidate } from '@lc/isbn';
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
 *
 * ## Aliases are asked about too
 *
 * A work's `work_alias` rows are extra *names to search under* and extra names to
 * score against. That is what makes the alias panel on the book page do something
 * you can see: add "Shirtaloon" to a *He Who Fights with Monsters* volume, press
 * "Look it up" again, and candidates appear where the pen name previously made
 * the query return nothing at all.
 *
 * ⚠️ Capped at `MAX_QUERIES` combinations. Aliases are entered by hand and there
 * will never be many, but a page that fans out one HTTP request per stored name
 * is one bad paste away from hammering openlibrary.org from a Worker.
 */
const MAX_QUERIES = 4;

export const enrichRoutes = new Hono<AppBindings>().get(
  '/works/:id/candidates',
  requireCapability('editCatalog'),
  async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

    const work = await getWork(c.env.DB, id);
    if (!work) return c.json({ error: 'not_found' }, 404);

    const aliases = await listAliasesForWork(c.env.DB, id);
    const titleAliases = aliases.filter((a) => a.kind === 'title').map((a) => a.alias);
    const authorAliases = aliases.filter((a) => a.kind === 'author').map((a) => a.alias);

    // Printed names for the query, folded names for the score. The catalog's own
    // name is first in both lists, so a work with no aliases behaves exactly as
    // it did before this paragraph existed.
    const queryTitles = [work.title, ...titleAliases];
    const queryAuthors = [primaryAuthor(work.authors), ...authorAliases.map(primaryAuthor)];
    const ourTitleKeys = foldTitleNames(work.title, titleAliases);
    const ourAuthorKeys = foldAuthorNames(work.authors, authorAliases);

    const pairs: { title: string; author: string }[] = [];
    for (const title of queryTitles) {
      for (const author of queryAuthors) {
        if (pairs.length < MAX_QUERIES) pairs.push({ title, author });
      }
    }

    // Deduplicated across queries by Open Library work id — the pen-name query
    // and the catalog-name query overlap whenever both find anything, and the
    // same record twice in the list reads as two candidates to choose between.
    const seen = new Map<string, BookCandidate>();
    for (const pair of pairs) {
      // `searchOpenLibrary` applies `cleanAudiobookTitle` itself — measured to
      // take the hit rate from 5/30 to 14/30 — so the raw title is passed through
      // deliberately rather than pre-cleaned here.
      const found = await searchOpenLibrary(pair.title, pair.author, {
        userAgent: 'library_catalog (private household catalog)',
      }).catch(() => []);
      for (const candidate of found) {
        const key = candidate.openlibraryWorkId ?? `${candidate.title}|${candidate.authors}`;
        if (!seen.has(key)) seen.set(key, candidate);
      }
    }

    const scored = [...seen.values()]
      .map((candidate) => ({
        ...candidate,
        // Best agreement with ANY name we know this book by, so a candidate
        // titled with the alias is not penalised for not matching the shelf.
        similarity: bestSimilarity(normaliseTitle(candidate.title), ourTitleKeys),
        authorSimilarity: bestSimilarity(
          normaliseTitle(primaryAuthor(candidate.authors)),
          ourAuthorKeys,
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
          ? authorAliases.length + titleAliases.length > 0
            ? 'Open Library has nothing matching, under this book’s own name or the other names recorded for it.'
            : 'Open Library has nothing matching. About half this library is not in it — mostly Kindle Unlimited and Audible-native titles. Fill it in by hand. If it is filed elsewhere under a pen name or another title, add that under “Also known as” and try again.'
          : null,
    });
  },
);
