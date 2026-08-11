/**
 * Finding a book by name, for everything that has no barcode: ebooks, Kindle
 * rows carrying only a `B0…` ASIN, pre-ISBN books, and spines off a shelf photo.
 *
 * ## ⚠️ Read this before trusting a result from here
 *
 * Measured against this household's own library on 2026-08-09 — 30 titles
 * sampled across `audiobook_catalog/site/catalog.csv`, full numbers in
 * `docs/info/isbn-ladder.md`:
 *
 * | Query | Open Library hits |
 * |---|---|
 * | title verbatim from the catalog | 5 / 30 |
 * | title through `cleanAudiobookTitle` | **14 / 30** |
 * | cleaned, as free text rather than fielded | 15 / 30 |
 *
 * Three things follow, and all three are load-bearing:
 *
 * **1. Always clean the title first.** Nearly tripling the hit rate comes from
 * removing text that is not printed on the book. This function does it for you;
 * do not pass a pre-cleaned title and do not skip it.
 *
 * **2. Roughly half this library is simply not in Open Library.** That is not a
 * bug in the query — the misses are overwhelmingly Kindle Unlimited and
 * Audible-native indie titles (Selkie Myth, Shemer Kuznits, Mashton, Michael-
 * Scott Earle) that have no ISBN and no library record anywhere. This directly
 * contradicts the design's assumption that "for 500 trade paperbacks Open
 * Library is complete and research must never fire". For *trade* books it is;
 * for this collection's centre of gravity it is not, and the research tier will
 * fire far more often than budgeted. Do not treat a miss as an error.
 *
 * **3. Free text is not the upgrade it looks like.** It scored one hit higher
 * and bought that with wrong answers: "The Wandering Inn" + "pirateaba" returned
 * *Garden of Sanctuary*, and "Awaken Online: Flame" returned *Awaken Online* —
 * the wrong volume of the right series, which is the single worst failure this
 * catalog can have, because it files a book you do not own as one you do. It
 * also *lost* a hit the fielded query found. Fielded is the default; free text
 * is offered as a second rung whose results must clear the similarity gate.
 */

import { cleanAudiobookTitle } from '@lc/core';
import type { BookCandidate, ResolveOptions } from './resolve.js';
import { schedule } from './throttle.js';

interface OlSearchDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  cover_i?: number;
  publisher?: string[];
  number_of_pages_median?: number;
}

const FIELDS =
  'key,title,author_name,first_publish_year,isbn,cover_i,publisher,number_of_pages_median';

function toCandidate(d: OlSearchDoc): BookCandidate | null {
  if (!d.title) return null;
  return {
    // The search index returns every ISBN ever attached to the work, across all
    // its editions, in no meaningful order. Picking one would be inventing a
    // printing. Left null — the *work* was found, the edition was not.
    isbn13: null,
    title: d.title,
    authors: (d.author_name ?? []).join(', '),
    publisher: d.publisher?.[0] ?? null,
    publishedYear: d.first_publish_year ?? null,
    pages: d.number_of_pages_median ?? null,
    language: null,
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
    // This IS a work key (OL…W) — unlike the /api/books endpoint's edition key.
    openlibraryWorkId: d.key?.replace(/^\/works\//, '') ?? null,
    format: null,
    source: 'openlibrary',
    sourceUrl: d.key ? `https://openlibrary.org${d.key}` : null,
  };
}

/**
 * ⚠️ Every search goes through `schedule`, and that is load-bearing.
 *
 * The automatic lookup pass calls this eight times at once from a single
 * `Promise.all`. The queue in `throttle.ts` turns that into one request at a
 * time — read its header before changing anything here, and do not add a
 * caller that reaches Open Library around it.
 */
async function olSearch(url: string, opts: ResolveOptions): Promise<BookCandidate[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await schedule(() =>
    doFetch(url, {
      headers: { 'User-Agent': opts.userAgent ?? 'library_catalog (+private)' },
    }),
  );
  if (!res.ok) throw new Error(`openlibrary search ${res.status}`);
  const body = (await res.json()) as { docs?: OlSearchDoc[] };
  return (body.docs ?? []).map(toCandidate).filter((c): c is BookCandidate => c !== null);
}

/**
 * Fielded search: title and author in their own parameters. The default.
 *
 * `limit` is 5 rather than 1 because the caller runs every result through
 * `matchIndexedWork`'s similarity gate, and the right answer is not reliably
 * first — "Firefight" + "Brandon Sanderson" put a different 2001 Firefight at
 * the top of the list.
 */
export async function searchOpenLibrary(
  title: string,
  author: string | null,
  opts: ResolveOptions = {},
): Promise<BookCandidate[]> {
  const u = new URL('https://openlibrary.org/search.json');
  u.searchParams.set('title', cleanAudiobookTitle(title));
  if (author) u.searchParams.set('author', author);
  u.searchParams.set('limit', '5');
  u.searchParams.set('fields', FIELDS);
  return olSearch(u.toString(), opts);
}

/**
 * Free-text search. A second rung, never a replacement — see the header.
 *
 * Use only when the fielded query returned nothing, and only with the result
 * put through the same similarity gate as a spine read. It is the rung that
 * answered "The Wandering Inn" with a different book by the same author.
 */
export async function searchOpenLibraryFreeText(
  title: string,
  author: string | null,
  opts: ResolveOptions = {},
): Promise<BookCandidate[]> {
  const u = new URL('https://openlibrary.org/search.json');
  u.searchParams.set('q', `${cleanAudiobookTitle(title)} ${author ?? ''}`.trim());
  u.searchParams.set('limit', '5');
  u.searchParams.set('fields', FIELDS);
  return olSearch(u.toString(), opts);
}
