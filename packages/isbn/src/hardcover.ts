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
 * | `series.books_count` | `Int!` — re-read from the same SDL on 2026-08-25 |
 *
 * ⚠️ **`position` is a `float8`, so it can arrive as a JSON number OR as a
 * string** depending on how the server serialises the scalar. Both are read;
 * anything else is null rather than `NaN`.
 *
 * ## ⚠️ Hardcover files UNIVERSES as series, and this catalogue does not
 *
 * Measured live on 2026-08-25: ISBN 9780765326355 (*The Way of Kings*) answers
 * `book_series` = **[The Stormlight Archive #1, The Cosmere #7]**. Both are real
 * `series` rows to Hardcover. To this estate they are two different TIERS — a
 * universe sits one level ABOVE a series, is held in
 * `catalog-platform/data/universes.json`, and reaches this repo through
 * `@lc/universes`. Writing *The Cosmere* into `work.series` files a book on the
 * wrong shelf and hides the shelf it belongs on.
 *
 * Taking the first named row therefore depended on Hardcover's ordering, which
 * is not a promise anybody made. `pickSeries` decides instead, and this module
 * stays free of the universe list: the caller passes a PREDICATE, so `@lc/isbn`
 * keeps its "no cross-repo data" property and the one universe normaliser in
 * the estate is not duplicated here.
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
          books_count
        }
      }
    }
  }
}`;

/** One `book_series` row that actually names a series. */
export interface HardcoverSeriesEntry {
  /** `series.name` — `String!` in the SDL, so never empty once it is named. */
  name: string;
  /** `book_series.position`, a `float8`, so `1.5` is a real answer. */
  position: number | null;
  /**
   * `series.books_count` — how many books Hardcover files under that series.
   *
   * ⚠️ Declared `Int!`, but read defensively as nullable: this rung must not
   * throw on a shape change in a field it only uses to BREAK A TIE.
   */
  booksCount: number | null;
}

export interface HardcoverBook {
  /** The book-level blurb, trimmed. Null when Hardcover has none. */
  description: string | null;
  /** The series NAME, from the structured join — never parsed out of a title. */
  series: string | null;
  /** `book_series.position`, a `float8`, so `1.5` is a real answer. */
  position: number | null;
  /**
   * EVERY named `book_series` row, in the order Hardcover returned them.
   *
   * ⚠️ The single `series`/`position` above is one CHOICE made over this list
   * by `pickSeries`. The list is kept so a caller can say something specific
   * about what it declined — "only a universe was named" is a different fact
   * from "Hardcover knows no series", and the free ladder reports them apart.
   */
  seriesEntries: HardcoverSeriesEntry[];
  /**
   * The names dropped for being universes, in the order they arrived. Empty
   * when the caller passed no predicate, which is the default.
   */
  universesDropped: string[];
}

/** The shape of the response, as far as we read it. */
interface HardcoverResponse {
  data?: {
    editions?: Array<{
      book?: {
        description?: string | null;
        book_series?: Array<{
          position?: number | string | null;
          series?: { name?: string | null; books_count?: number | string | null } | null;
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

/** What `pickSeries` decided, and what it declined. */
export interface HardcoverSeriesPick {
  /** The series to write, or null when there is nothing this catalogue would file. */
  chosen: HardcoverSeriesEntry | null;
  /** Names dropped for being universes, in arrival order. */
  universesDropped: string[];
}

/**
 * Choose ONE series from everything Hardcover named — the whole of the tier
 * decision, in one pure function so it can be tested without a request.
 *
 * The rule, in order:
 *
 * 1. **Drop every universe.** A universe is not a series here, and a universe
 *    written into `work.series` is a wrong answer, not a rough one.
 * 2. **Prefer the smallest `books_count`.** Among genuine series the smaller
 *    set is the more specific one — the sub-series or the main sequence rather
 *    than a publisher's omnibus grouping. It is also the second line of defence
 *    for a universe the shared list has not learned yet: a universe is always
 *    the bigger set.
 * 3. **Ties go to the FIRST**, so the answer stays stable across calls when
 *    Hardcover has nothing to separate two rows.
 * 4. **All universes ⇒ no series at all.** Answering "no series" is correct;
 *    answering with the universe is the bug. The caller says so by name.
 *
 * ⚠️ `isUniverseName` is INJECTED rather than imported. `@lc/isbn` must not
 * depend on `@lc/universes` — that package is the one place in the repo that
 * reads a file generated from another checkout, and pulling it in here would
 * spread the cross-repo dependency into every consumer of the ISBN ladder. It
 * also keeps the estate's single universe normaliser single: the predicate the
 * Worker passes folds names with `normaliseUniverseText`, and nothing in this
 * file writes a second fold.
 *
 * ⚠️ A missing `booksCount` sorts LAST, not first. An unknown size is not
 * evidence of a small set, and a rung that guessed the other way would prefer
 * exactly the rows Hardcover knows least about.
 */
export function pickSeries(
  entries: readonly HardcoverSeriesEntry[],
  isUniverseName: (name: string) => boolean = () => false,
): HardcoverSeriesPick {
  const universesDropped: string[] = [];
  const candidates: HardcoverSeriesEntry[] = [];
  for (const entry of entries) {
    if (isUniverseName(entry.name)) universesDropped.push(entry.name);
    else candidates.push(entry);
  }

  let chosen: HardcoverSeriesEntry | null = null;
  for (const entry of candidates) {
    if (chosen === null) {
      chosen = entry;
      continue;
    }
    const best = chosen.booksCount ?? Number.POSITIVE_INFINITY;
    const here = entry.booksCount ?? Number.POSITIVE_INFINITY;
    // Strictly smaller only, so a tie keeps the earlier row.
    if (here < best) chosen = entry;
  }

  return { chosen, universesDropped };
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
 *
 * ⚠️ `opts.isUniverseName` is how a caller keeps a UNIVERSE out of
 * `work.series` — see `pickSeries`. Omitting it is the honest default (no
 * universe list, no universe filtering) and is what a caller with no catalogue
 * of its own should do; the Worker's free ladder always passes one.
 */
export async function lookupHardcover(
  isbn13: string,
  opts: {
    token: string;
    fetchImpl?: typeof fetch;
    userAgent?: string;
    /** True for a name this catalogue files as a UNIVERSE, not a series. */
    isUniverseName?: (name: string) => boolean;
  },
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

  // A book can sit in more than one series — and on this catalogue's data one
  // of them is regularly a UNIVERSE. Read every row that actually NAMES a
  // series (a row can carry a null `series`), then let `pickSeries` decide.
  const seriesEntries: HardcoverSeriesEntry[] = [];
  for (const row of book.book_series ?? []) {
    const name = (row?.series?.name ?? '').trim();
    if (!name) continue;
    seriesEntries.push({
      name,
      position: readPosition(row?.position),
      booksCount: readPosition(row?.series?.books_count),
    });
  }

  const pick = pickSeries(seriesEntries, opts.isUniverseName);

  return {
    description,
    series: pick.chosen?.name ?? null,
    position: pick.chosen?.position ?? null,
    seriesEntries,
    universesDropped: pick.universesDropped,
  };
}
