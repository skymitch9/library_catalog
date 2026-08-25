/**
 * The ISBN ladder.
 *
 * Replaces the Board Game Catalog's `packages/barcode/src/resolve.ts`. The
 * *shape* is ported and the rungs are not:
 *
 *   - one answer shape, whichever rung produced it
 *   - each rung in its own try/catch, appending to a `trace`
 *   - degrade, never break: a rung that throws is a rung that answered nothing
 *   - nothing writes without a human
 *
 * ## Rung order is measured, not assumed
 *
 * `catalog-platform/docs/LIBRARY_CATALOG.md` said its own claims about book APIs
 * were "knowledge, not measurement" and required a phase 0 to replace them. That
 * ran on 2026-08-09 and the numbers are in `docs/info/isbn-ladder.md`. The two
 * findings that set this file's order:
 *
 * | | |
 * |---|---|
 * | Open Library by ISBN-13 | **9 / 10**, with publisher, year, page count and a cover |
 * | Google Books, anonymous | **0 / 40 — HTTP 429 on every single call** |
 *
 * Google Books is not a free anonymous rung. The shared unauthenticated project
 * quota is exhausted, so it answers 429 regardless of what you ask. It is
 * therefore rung 2 **and gated on an API key**: with no key set it is skipped
 * silently rather than burning a subrequest to be refused.
 *
 * ## The trap this ladder cannot detect, and must not pretend to
 *
 * ⚠️ A wrong ISBN returns a *confident, well-formed, wrong book*. Measured: of
 * ten ISBNs typed from memory, three resolved to entirely different books
 * (Circe, Cloud Cuckoo Land, One Piece Vol. 93) with full metadata and a cover.
 * Nothing in the response marks them. The checksum passes, the database is
 * right, and the answer is wrong because the question was.
 *
 * The only defence is that a scan is a *proposal* — the review screen shows the
 * cover and the title and a person confirms. That is why `scan_job` exists and
 * why no rung here writes to the catalog.
 */

import { MIN_COVER_BYTES } from '@lc/core';
import type { EditionFormat } from '@lc/core';

/** One answer, whichever rung produced it. */
export interface BookCandidate {
  isbn13: string | null;
  title: string;
  /** As printed, in the order printed — `splitAuthors` owns any splitting. */
  authors: string;
  publisher: string | null;
  publishedYear: number | null;
  pages: number | null;
  language: string | null;
  coverUrl: string | null;
  /** Open Library's work id, when the rung knows it. Hardens the join later. */
  openlibraryWorkId: string | null;
  format: EditionFormat | null;
  source: 'openlibrary' | 'googlebooks' | 'bookcover-api';
  sourceUrl: string | null;
  /**
   * The blurb, when the rung that answered carries one. **Optional, and only
   * Google Books fills it** — Open Library's `/api/books?jscmd=data` has no
   * description field at all, and its work record does (see `workDescription`
   * in `works.ts`), which is a different call at a different level.
   *
   * ⚠️ Optional rather than `string | null` deliberately: `BookCandidate` is
   * constructed in four places across two packages, and a required field would
   * make adding a blurb to one rung a compile error in the three that cannot
   * supply one. `undefined` here means *this rung does not carry descriptions*;
   * `null` means *it does, and this book has none*. The free details ladder
   * reads it and needs to tell those apart.
   */
  description?: string | null;
}

export interface RungTrace {
  rung: string;
  ok: boolean;
  found: number;
  ms: number;
  /**
   * HTTP status or error message. 429 here means "quota", not "not found".
   * A detail starting with `REFUSED_PREFIX` means the rung ANSWERED and the
   * answer was refused as an aggregate — see the guard below.
   */
  detail?: string;
}

/**
 * ⚠️ The one-barcode-one-edition guard — the marker a refusal carries in the
 * trace, so callers can tell "the database has nothing" from "the database
 * answered with something that must not become an edition".
 *
 * The rule it enforces (`catalog-platform/docs/info/matching-thresholds.md`
 * §6, tier 1 — mechanical, no judgement):
 *
 *   - One barcode may create at most one edition and one copy. A lookup
 *     answer carrying more than one distinct ISBN-13 for one scanned barcode
 *     is refused outright, **not trimmed to its first entry**.
 *   - An Open Library `/works/…` (work-level) record may never be an edition
 *     source. Only edition-level (`/books/…`) records carry a printing's
 *     identity.
 *
 * Why: on 2026-08-13 barcodes resolved to work-level aggregates and produced
 * a phantom *Space Knight* carrying **6 editions with 6 unrelated ISBNs and
 * 6 copies** (works #300–#302, all three corrupted the same evening). An OL
 * work record aggregates every printing of every volume of a series, so any
 * series filed that way will do it again — this refusal is what stops it.
 */
export const REFUSED_PREFIX = 'refused:';

/** Did any rung refuse its answer as an aggregate? For the caller's message. */
export function wasRefused(trace: readonly RungTrace[]): boolean {
  return trace.some((t) => t.detail?.startsWith(REFUSED_PREFIX) ?? false);
}

/** Fold `978-1-63849-345-7`, `9781638493457` and stray spaces to one spelling. */
function foldIsbn(raw: string): string {
  return raw.replace(/[-\s]/g, '').toUpperCase();
}

export interface ResolveResult {
  candidates: BookCandidate[];
  trace: RungTrace[];
}

export interface ResolveOptions {
  /**
   * Google Books API key. **Without it rung 2 is skipped entirely.**
   * Anonymous calls returned 429 on 40 of 40 attempts on 2026-08-09.
   */
  googleBooksKey?: string | undefined;
  /** Identifies us to Open Library, which asks for one. Not authentication. */
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_UA = 'library_catalog (+https://github.com/private)';

async function timed<T>(
  rung: string,
  trace: RungTrace[],
  fn: () => Promise<T[]>,
): Promise<T[]> {
  const started = Date.now();
  try {
    const out = await fn();
    trace.push({ rung, ok: true, found: out.length, ms: Date.now() - started });
    return out;
  } catch (err) {
    trace.push({
      rung,
      ok: false,
      found: 0,
      ms: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Rung 1 — Open Library
// ---------------------------------------------------------------------------

interface OlAuthor {
  name?: string;
}
interface OlNamed {
  name?: string;
}
interface OlBook {
  title?: string;
  subtitle?: string;
  authors?: OlAuthor[];
  publishers?: OlNamed[];
  publish_date?: string;
  number_of_pages?: number;
  url?: string;
  cover?: { small?: string; medium?: string; large?: string };
  identifiers?: { isbn_13?: string[]; openlibrary?: string[] };
}

/** "August 31st 2010" and "2005" both appear in real responses. Take the year. */
function yearFrom(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = /\b(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})\b/.exec(raw);
  return m ? Number(m[1]) : null;
}

export async function lookupOpenLibraryByIsbn(
  isbn13: string,
  opts: ResolveOptions = {},
): Promise<BookCandidate[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&format=json&jscmd=data`,
    { headers: { 'User-Agent': opts.userAgent ?? DEFAULT_UA } },
  );
  if (!res.ok) throw new Error(`openlibrary ${res.status}`);

  const body = (await res.json()) as Record<string, OlBook>;
  const rec = body[`ISBN:${isbn13}`];
  if (!rec) return [];

  /*
   * ⚠️ The one-barcode-one-edition guard (see REFUSED_PREFIX above).
   *
   * A refusal is a THROW, not an empty return, on purpose: `timed` records it
   * in the trace with the `refused:` detail, which is how the scan path tells
   * the person what happened instead of showing the generic "not indexed" row.
   * An empty return here would be indistinguishable from "Open Library has
   * never heard of it", and the whole point is that it ANSWERED — wrongly for
   * this purpose — and must not be trimmed into looking like a clean hit.
   */
  const workLevel =
    /\/works\//.test(rec.url ?? '') ||
    (rec.identifiers?.openlibrary ?? []).some((k) => /^OL\d+W$/.test(k.replace(/^\/?works\//, '')));
  if (workLevel) {
    throw new Error(
      `${REFUSED_PREFIX} Open Library answered ISBN ${isbn13} with a work-level record, ` +
        'which aggregates every printing of every volume. Never an edition source.',
    );
  }
  const distinctIsbns = new Set((rec.identifiers?.isbn_13 ?? []).map(foldIsbn).filter(Boolean));
  if (distinctIsbns.size > 1) {
    throw new Error(
      `${REFUSED_PREFIX} Open Library answered one barcode with ${distinctIsbns.size} distinct ` +
        'ISBN-13s. One barcode is one printing; an answer carrying several is an aggregate.',
    );
  }

  const title = rec.subtitle ? `${rec.title ?? ''}` : (rec.title ?? '');
  if (!title) return [];

  return [
    {
      isbn13,
      title,
      authors: (rec.authors ?? []).map((a) => a.name ?? '').filter(Boolean).join(', '),
      publisher: (rec.publishers ?? []).map((p) => p.name ?? '').filter(Boolean).join(', ') || null,
      publishedYear: yearFrom(rec.publish_date),
      pages: rec.number_of_pages ?? null,
      language: null,
      coverUrl: rec.cover?.large ?? rec.cover?.medium ?? null,
      // The /api/books endpoint returns an *edition* key (OL…M), not a work key
      // (OL…W). Left null rather than storing the wrong kind of id in a column
      // whose whole purpose is to be the stable work identifier later.
      openlibraryWorkId: null,
      format: null,
      source: 'openlibrary',
      sourceUrl: rec.url ?? `https://openlibrary.org/isbn/${isbn13}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Rung 2 — Google Books (key required)
// ---------------------------------------------------------------------------

interface GbVolume {
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    pageCount?: number;
    language?: string;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    infoLink?: string;
    industryIdentifiers?: { type?: string; identifier?: string }[];
    description?: string;
  };
}

export async function lookupGoogleBooksByIsbn(
  isbn13: string,
  opts: ResolveOptions = {},
): Promise<BookCandidate[]> {
  if (!opts.googleBooksKey) return [];
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}&key=${opts.googleBooksKey}`;
  const res = await doFetch(url);
  if (!res.ok) throw new Error(`googlebooks ${res.status}`);

  const body = (await res.json()) as { items?: GbVolume[] };
  const vi = body.items?.[0]?.volumeInfo;
  if (!vi?.title) return [];

  const ids = vi.industryIdentifiers ?? [];

  // ⚠️ The one-barcode-one-edition guard, same rule as the Open Library rung
  // above (see REFUSED_PREFIX): a record answering one barcode with several
  // distinct ISBN-13s is an aggregate, and refusing beats trimming. Google's
  // records normally carry exactly one ISBN_13 beside an ISBN_10; more than
  // one 13 is the work-level shape wearing a different provider's clothes.
  const distinctIsbns = new Set(
    ids
      .filter((i) => i.type === 'ISBN_13')
      .map((i) => foldIsbn(i.identifier ?? ''))
      .filter(Boolean),
  );
  if (distinctIsbns.size > 1) {
    throw new Error(
      `${REFUSED_PREFIX} Google Books answered one barcode with ${distinctIsbns.size} distinct ` +
        'ISBN-13s. One barcode is one printing; an answer carrying several is an aggregate.',
    );
  }
  return [
    {
      isbn13: ids.find((i) => i.type === 'ISBN_13')?.identifier ?? isbn13,
      title: vi.subtitle ? `${vi.title}: ${vi.subtitle}` : vi.title,
      authors: (vi.authors ?? []).join(', '),
      publisher: vi.publisher ?? null,
      publishedYear: yearFrom(vi.publishedDate),
      pages: vi.pageCount ?? null,
      language: vi.language ?? null,
      // Google's thumbnails are http:// in the raw response often enough to be
      // worth forcing — a mixed-content image is a silently broken cover.
      coverUrl: (vi.imageLinks?.thumbnail ?? null)?.replace(/^http:/, 'https:') ?? null,
      openlibraryWorkId: null,
      format: null,
      source: 'googlebooks',
      sourceUrl: vi.infoLink ?? null,
      // `null`, never `undefined`: this rung DOES carry descriptions, so a book
      // with none is an answer ("Google has no blurb for this") rather than the
      // absence of the capability. See `description` on `BookCandidate`.
      description: (vi.description ?? '').trim() || null,
    },
  ];
}

// ---------------------------------------------------------------------------
// Covers
// ---------------------------------------------------------------------------

/**
 * The first cover any rung found, in rung order.
 *
 * ## ⚠️ Why this is not just `candidates[0].coverUrl`
 *
 * It was, and that is the whole reason board books had no covers. Rung 1 is
 * always first and Open Library answers for these ISBNs with **full metadata and
 * no cover**; Google Books, rung 2, holds the cover. `scan-jobs.ts` took
 * `candidates[0]` and with it Open Library's `null`, so the cover that had
 * already been fetched two lines below was thrown away.
 *
 * Measured 2026-08-10 over the 46 coverless works in production that carry an
 * ISBN: Open Library supplied **12**, and Google Books supplied **19 more** of the
 * 34 it missed. Every one of those 19 was reachable the whole time.
 *
 * Borrowing across rungs is safe *because the join is the ISBN* — a hard
 * identifier, not a title similarity. Every candidate here answered the same
 * `isbn:` query, so they are printings of the same edition and any cover among
 * them is a cover of it. That is emphatically not true of the title-search path
 * in `search.ts`, which is why this lives here and takes candidates rather than a
 * bare list of URLs.
 */
export function coverFrom(candidates: readonly BookCandidate[]): string | null {
  for (const c of candidates) if (c.coverUrl) return c.coverUrl;
  return null;
}

/**
 * The first description any rung found, in rung order — the exact sibling of
 * `coverFrom`, for the exact same reason.
 *
 * ⚠️ **Open Library's `jscmd=data` rung returns metadata with NO description**,
 * and Google Books (rung 2) carries one. Every consumer took `candidates[0]`
 * (rung 1) whole and so took its `null` description with it — paying the paid LLM
 * for a blurb Google had already handed us for free. This is `coverFrom`'s board-
 * book bug, one field over. Same ISBN join, so borrowing is safe. See
 * `bestCandidate`.
 */
export function descriptionFrom(candidates: readonly BookCandidate[]): string | null {
  for (const c of candidates) if (c.description) return c.description;
  return null;
}

/**
 * The one candidate to show/store from an ISBN lookup: rung 1 wins **identity**
 * (title, authors, ISBN, source), but every **supplementary** fact rung 1 lacks
 * is borrowed from a later rung that answered the same `isbn:` query.
 *
 * ## ⚠️ Why identity and supplements are treated differently
 *
 * Rung order encodes a trust order for *what the book IS* — Open Library's title
 * and author are preferred over Google's, which is why `resolveIsbn` puts OL
 * first and every consumer used `candidates[0]`. But that whole-record take also
 * discarded the *facts* OL simply does not carry (description, and often the
 * cover, year, page count, publisher). Those are not a matter of trust — they are
 * the same edition's facts, joined by a hard ISBN — so a `null` on the trusted
 * record should fall through to whichever rung has the value, never to the LLM.
 * `coverFrom` already did this for the cover alone; this generalises it to every
 * supplementary field, which is the "more direct fills, fewer LLM calls" the
 * owner asked for (2026-08-25).
 *
 * Identity fields (`title`, `authors`, `isbn13`, `source`, `sourceUrl`,
 * `format`, `openlibraryWorkId`) stay from `candidates[0]`. Supplementary fields
 * (`coverUrl`, `description`, `publishedYear`, `pages`, `publisher`, `language`)
 * coalesce across rungs. `series` is deliberately NOT here — no rung supplies a
 * structured series today; that needs a Wikidata/Hardcover rung (see
 * `docs/info/scan-metadata-fill-strategy.md`).
 */
export function bestCandidate(
  candidates: readonly BookCandidate[],
): BookCandidate | undefined {
  const first = candidates[0];
  if (!first) return undefined;
  const pick = <T>(get: (c: BookCandidate) => T | null | undefined): T | null => {
    for (const c of candidates) {
      const v = get(c);
      if (v !== null && v !== undefined && v !== '') return v;
    }
    return null;
  };
  return {
    ...first,
    coverUrl: pick((c) => c.coverUrl),
    description: pick((c) => c.description),
    publishedYear: pick((c) => c.publishedYear),
    pages: pick((c) => c.pages),
    publisher: pick((c) => c.publisher),
    language: pick((c) => c.language),
  };
}

/**
 * The smallest thing we will believe is a book cover.
 *
 * Open Library's 1×1 placeholder is **43 bytes** (measured 2026-08-10 on ISBN
 * 9781454965435). Real covers in the same sample ran 13,963 – 94,915 bytes and
 * Google's smallest thumbnail was 4,935. 1000 sits in a gap two orders of
 * magnitude wide, so it does not need to be precise to be safe.
 *
 * ⚠️ **Declared in `@lc/core` and imported here, not defined here**, since
 * migration 0040 added an upload path. A cover can now arrive as a URL to fetch
 * or as bytes to store, the two are checked by different functions in different
 * packages, and a floor that drifted between them would mean the same
 * 43-byte placeholder was refused down one path and stored down the other.
 * It is deliberately NOT re-exported: `MIN_COVER_BYTES` reachable from both
 * `@lc/core` and `@lc/isbn` is the shape that produced `TS2451` when
 * `EDITION_MEDIA` was declared twice (see `docs/TODO.md`). The import is in the
 * block at the top of this file.
 */

export interface CoverCheck {
  ok: boolean;
  bytes: number;
  status: number | string;
  contentType: string | null;
  /** Why it was rejected, for a log a person will actually read. */
  reason?: string;
}

/**
 * Fetch a cover URL and decide whether it is really an image of a book.
 *
 * ## ⚠️ The trap this exists for
 *
 * `https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg` returns **HTTP 200 and a
 * 1×1 pixel placeholder** when it has no cover — not a 404. Storing that looks
 * exactly like success: the column fills, the count goes up, the backfill reports
 * a clean sweep, and every tile on the page renders a blank dot. Measured
 * 2026-08-10: with `?default=false` that same ISBN returns **404**; without it,
 * **200 and 43 bytes**.
 *
 * So there are two defences and both are needed, because they fail differently:
 *
 *  1. `?default=false` on any `covers.openlibrary.org` URL — appended here rather
 *     than trusted to the caller, since forgetting it is silent.
 *  2. A size floor, which also catches an error page served as 200, a Google
 *     "image not available" gif, and a truncated response.
 *
 * A URL that cannot be verified is treated as no cover at all. ⚠️ Never store an
 * unverified URL: nothing in this system ever revisits a cover column, so a dead
 * link is permanent in a way a blank is not.
 */
export async function verifyCoverUrl(
  url: string,
  opts: { fetchImpl?: typeof fetch; userAgent?: string } = {},
): Promise<CoverCheck> {
  const doFetch = opts.fetchImpl ?? fetch;
  const guarded = /covers\.openlibrary\.org/.test(url) && !/default=false/.test(url)
    ? `${url}${url.includes('?') ? '&' : '?'}default=false`
    : url;

  try {
    const res = await doFetch(guarded, {
      headers: { 'User-Agent': opts.userAgent ?? DEFAULT_UA },
      redirect: 'follow',
    });
    if (!res.ok) {
      return { ok: false, bytes: 0, status: res.status, contentType: null, reason: `HTTP ${res.status}` };
    }
    const contentType = res.headers.get('content-type');
    const bytes = (await res.arrayBuffer()).byteLength;

    if (contentType && !/^image\//i.test(contentType)) {
      return { ok: false, bytes, status: res.status, contentType, reason: `not an image (${contentType})` };
    }
    if (bytes < MIN_COVER_BYTES) {
      return {
        ok: false,
        bytes,
        status: res.status,
        contentType,
        reason: `${bytes} bytes — a placeholder, not a cover`,
      };
    }
    return { ok: true, bytes, status: res.status, contentType };
  } catch (err) {
    return {
      ok: false,
      bytes: 0,
      status: 'ERR',
      contentType: null,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Rung 2.5 — Bookcover API (free, cover-only, no metadata)
// ---------------------------------------------------------------------------

/**
 * `bookcover.longitood.com` — a free aggregator that searches multiple sources
 * for a book cover by ISBN and returns a direct image URL. Unlike the other
 * rungs it provides NO metadata (title, author, pages, etc.) — only a cover.
 *
 * ## Why it is rung 2.5 and not rung 3
 *
 * It is faster than Open Library title search (rung 3 in the backfill script)
 * and keyed on ISBN, which is stronger evidence. But it is after Google Books
 * because Google returns full metadata alongside its cover, and this does not.
 *
 * ## Availability
 *
 * As of 2026-08-10 the API returned 522 (origin unreachable) on all requests.
 * It is kept as a rung because when it works it covers books that neither OL
 * nor Google hold. The ladder degrades gracefully: a 522 is caught, traced as
 * a miss, and the next rung proceeds.
 */
export async function lookupBookcoverApi(
  isbn: string,
  opts: ResolveOptions = {},
): Promise<BookCandidate[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `https://bookcover.longitood.com/bookcover/${isbn}`;
  const res = await doFetch(url, {
    headers: { 'User-Agent': opts.userAgent ?? DEFAULT_UA },
  });
  if (!res.ok) throw new Error(`bookcover-api ${res.status}`);

  const body = (await res.json()) as { url?: string };
  if (!body.url) return [];

  // This API returns only a cover URL — no title, author, or other metadata.
  // We build a minimal candidate so it integrates with `coverFrom`.
  return [
    {
      isbn13: isbn.length === 13 ? isbn : null,
      title: '',
      authors: '',
      publisher: null,
      publishedYear: null,
      pages: null,
      language: null,
      coverUrl: body.url.replace(/^http:/, 'https:'),
      openlibraryWorkId: null,
      format: null,
      source: 'bookcover-api',
      sourceUrl: url,
    },
  ];
}

/**
 * Ask every rung that can answer, in order, and return everything found.
 *
 * Does **not** stop at the first hit. Two rungs disagreeing about a publisher is
 * information for the review screen; silently taking rung 1's answer throws it
 * away. Ranking is the caller's job.
 */
export async function resolveIsbn(
  isbn13: string,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const trace: RungTrace[] = [];
  const candidates: BookCandidate[] = [];

  candidates.push(
    ...(await timed('openlibrary', trace, () => lookupOpenLibraryByIsbn(isbn13, opts))),
  );

  if (opts.googleBooksKey) {
    candidates.push(
      ...(await timed('googlebooks', trace, () => lookupGoogleBooksByIsbn(isbn13, opts))),
    );
  } else {
    trace.push({
      rung: 'googlebooks',
      ok: true,
      found: 0,
      ms: 0,
      detail: 'skipped: no GOOGLE_BOOKS_API_KEY (anonymous calls return 429)',
    });
  }

  // Rung 2.5: Bookcover API — only if no cover was found from the metadata rungs
  if (!coverFrom(candidates)) {
    candidates.push(
      ...(await timed('bookcover-api', trace, () => lookupBookcoverApi(isbn13, opts))),
    );
  } else {
    trace.push({
      rung: 'bookcover-api',
      ok: true,
      found: 0,
      ms: 0,
      detail: 'skipped: cover already found by earlier rung',
    });
  }

  return { candidates, trace };
}
