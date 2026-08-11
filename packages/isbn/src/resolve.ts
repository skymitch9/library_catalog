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
  source: 'openlibrary' | 'googlebooks';
  sourceUrl: string | null;
}

export interface RungTrace {
  rung: string;
  ok: boolean;
  found: number;
  ms: number;
  /** HTTP status or error message. 429 here means "quota", not "not found". */
  detail?: string;
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
 * The smallest thing we will believe is a book cover.
 *
 * Open Library's 1×1 placeholder is **43 bytes** (measured 2026-08-10 on ISBN
 * 9781454965435). Real covers in the same sample ran 13,963 – 94,915 bytes and
 * Google's smallest thumbnail was 4,935. 1000 sits in a gap two orders of
 * magnitude wide, so it does not need to be precise to be safe.
 */
export const MIN_COVER_BYTES = 1000;

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

  return { candidates, trace };
}
