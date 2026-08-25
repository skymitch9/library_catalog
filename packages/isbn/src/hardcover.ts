/**
 * Hardcover.app — the one free source that answers **description AND structured
 * series + volume in a single call**, and the free rung whose community skew
 * best matches what this catalogue actually holds.
 *
 * ## Why this exists when Open Library, Google Books and Wikidata are already asked
 *
 * Each of the others answers half the question. Open Library files series as an
 * unstructured `subjects`/`series` string; Google Books rarely populates
 * `seriesInfo` and its "series" here is only ever a HINT read out of a title;
 * Wikidata has the cleanest structured ordinal but only for books notable enough
 * to have an item at all — which is exactly wrong for the indie / LitRPG /
 * webnovel end of this library, the end the owner keeps finding gaps in.
 * Hardcover's contributors are largely ex-Goodreads genre readers, so its
 * coverage skews the way this catalogue does, and one request returns the blurb
 * and the series and the volume together.
 *
 * ## The schema, confirmed against the published SDL on 2026-08-25
 *
 * Read from `hardcoverapp/hardcover-docs@main/schema.graphql`, not from memory
 * and not from a blog post:
 *
 * | Path | Declared as |
 * |---|---|
 * | `query_root.editions(where:, limit:)` | `[editions!]!` |
 * | `editions.isbn_13` | `String` (filterable via `String_comparison_exp._eq`) |
 * | `editions.book` | `books!` |
 * | `books.description` | `String` |
 * | `books.book_series(...)` | `[book_series!]!` |
 * | `book_series.position` | `float8` — nullable, and **decimal**, so a 3.5 novella survives |
 * | `book_series.series` | `series` → `series.name: String!` |
 *
 * ⚠️ **`position` is a `float8`, so it can arrive as a JSON number OR as a
 * string** depending on how the server serialises the scalar. Both are read;
 * anything else is null rather than `NaN`.
 *
 * ## ⚠️ Injection safety: a GraphQL VARIABLE, never a built string
 *
 * The ISBN is stripped to bare digits AND passed as `$isbn` in `variables`. The
 * query text is a module constant that no caller input ever reaches. Building
 * the `where` clause by concatenation — which is how the vendor's own docs
 * spell it — would put caller text inside a query document, and a digits-only
 * guard is not a reason to skip the safe form.
 *
 * ## Terms and limits
 *
 * Free self-service key at `hardcover.app/account/api`, sent as
 * `Authorization: Bearer <token>`. Free tier is **5,000 requests/day, 60/min,
 * burst 10** (published 2026-08-25). Personal use and caching are permitted;
 * what the terms bar is training public/commercial models on the data and
 * republishing user-owned data commercially — neither of which this household
 * catalogue does. Queries have a 30-second server-side max; ours is capped far
 * below that.
 */

const HARDCOVER_GRAPHQL = 'https://api.hardcover.app/v1/graphql';

/** Well inside Hardcover's own 30s query ceiling, and inside the free ladder's
 * `waitUntil` budget even if every rung above it was slow. */
export const HARDCOVER_TIMEOUT_MS = 10_000;

/**
 * One request, one book. ⚠️ A module constant — no caller text is ever
 * interpolated into it; the ISBN travels in `variables`. See the header.
 *
 * `limit: 1` on the edition because we asked by a unique ISBN; `limit: 5` on
 * the series join because a book can legitimately belong to more than one
 * series (a main sequence and an omnibus/universe grouping) and we want the
 * first one that actually names itself, not the first row blindly.
 */
const HARDCOVER_QUERY = `query BookByIsbn13($isbn: String!) {
  editions(where: {isbn_13: {_eq: $isbn}}, limit: 1) {
    book {
      description
      book_series(limit: 5) {
        position
        series {
          name
        }
      }
    }
  }
}`;

export interface HardcoverBook {
  /** The book-level blurb, trimmed. Null when Hardcover has none. */
  description: string | null;
  /** The series NAME, from the structured join — never parsed out of a title. */
  series: string | null;
  /** `book_series.position`, a `float8`, so `1.5` is a real answer. */
  position: number | null;
}

/** The shape of the response, as far as we read it. */
interface HardcoverResponse {
  data?: {
    editions?: Array<{
      book?: {
        description?: string | null;
        book_series?: Array<{
          position?: number | string | null;
          series?: { name?: string | null } | null;
        } | null> | null;
      } | null;
    } | null> | null;
  } | null;
  errors?: Array<{ message?: string }> | null;
}

/** A `float8` off the wire: a number, or a numeric string. Never `NaN`. */
function readPosition(raw: number | string | null | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && /^-?\d+(?:\.\d+)?$/.test(raw.trim())) return Number(raw.trim());
  return null;
}

/**
 * Ask Hardcover for a book's description + series + volume by ISBN-13.
 *
 * Returns **null** when no edition with that ISBN exists (the ordinary miss —
 * that is what the paid rung behind this is still for), and an object with null
 * members when the edition exists but Hardcover holds no blurb and no series.
 * Those are genuinely different facts and the free ladder reports them
 * differently.
 *
 * Throws only on a transport/HTTP failure or a GraphQL error, which the free
 * ladder catches and turns into a NAMED skip.
 */
export async function lookupHardcover(
  isbn13: string,
  opts: { token: string; fetchImpl?: typeof fetch; userAgent?: string },
): Promise<HardcoverBook | null> {
  // Only bare digits ever leave here, and they leave as a VARIABLE — see the
  // header. A malformed ISBN costs no request at all.
  const digits = (isbn13 ?? '').replace(/[^0-9]/g, '');
  if (digits.length !== 13) return null;

  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(HARDCOVER_GRAPHQL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${opts.token}`,
      'User-Agent': opts.userAgent ?? 'library_catalog/1.0 (household book catalog)',
    },
    body: JSON.stringify({ query: HARDCOVER_QUERY, variables: { isbn: digits } }),
    signal: AbortSignal.timeout(HARDCOVER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`hardcover ${res.status}`);

  const body = (await res.json()) as HardcoverResponse;
  // ⚠️ GraphQL answers 200 with an `errors` array for a rejected query, a
  // missing scope or a top-level-limit refusal. Reading `data` past that would
  // report "Hardcover knows nothing about this book" for what is really a
  // broken request — the exact silent-failure shape the ladder's named skips
  // exist to prevent.
  const firstError = body.errors?.[0]?.message;
  if (firstError) throw new Error(`hardcover graphql: ${firstError}`);

  const book = body.data?.editions?.[0]?.book;
  if (!book) return null;

  const description = (book.description ?? '').trim() || null;

  // A book can sit in more than one series; take the first row that actually
  // names one rather than the first row, which may carry a null `series`.
  const named = (book.book_series ?? []).find((row) => (row?.series?.name ?? '').trim() !== '');
  const series = (named?.series?.name ?? '').trim() || null;
  const position = series ? readPosition(named?.position) : null;

  return { description, series, position };
}
