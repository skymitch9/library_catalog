/**
 * Reaching the sibling audiobook site from a `audiobook_holding` row —
 * migration 0010's cache. Two ports, not inventions, each verified against the
 * sibling repo (`audiobook_catalog`) rather than guessed:
 *
 *   - `resolveAudiobookCover` mirrors `site/covers-base.js` `coverUrl()`
 *     byte-for-byte. `cover_href` resolves against that catalog's OWN cover
 *     bucket, `covers.heygabi.ai` — **not** `bookcovers.heygabi.ai`, which is
 *     this catalog's bucket (see `apps/worker/wrangler.toml`'s
 *     `COVERS_BASE_URL` and its "NOT covers.heygabi.ai" warning, the same
 *     confusion in the other direction). `scripts/covers-from-audiobooks.mjs`
 *     already reads from the same `covers.heygabi.ai` host for the same
 *     reason.
 *   - `audiobookDetailUrl` mirrors `app/index_push.py` `detail_url_for()`:
 *     the site's only book anchor is a hash search
 *     (`site/index.html` `_parseHash`, key `q`, read with `URLSearchParams`
 *     and filtered by `_applySearch` as a token-substring match — not an
 *     exact-match route), so `<site>/#q=<title>` is a link that lands on the
 *     book by putting it alone in the search box, not a deep link to a
 *     per-book URL that does not exist.
 *
 * ## ⚠️ The query is the VERBATIM title when we hold one (2026-09-02)
 *
 * Owner report: *"the audiobook link is a SEARCH, and on a series-named title
 * it finds 16 books"*. `_applySearch` is an **AND of substring tests** over
 * each card's own text, so a query is only as specific as the tokens in it —
 * and this catalog stores the sibling's title **twice**: `title`, stripped of
 * Audible's decoration, and `raw_title` / `audioKey`, that catalog's own
 * verbatim string (migrations 0340 / 0390). Stripping the decoration is
 * exactly what throws the volume away, so the cleaned form of *"The Wandering
 * Inn - The Wandering Inn, Book 1"* is the bare **series** name.
 *
 * **Measured 2026-09-02** by replaying the site's own `_normalize` / `_tokens`
 * / `matchesAll` over the **1,087** cards `site/index.html` ships — not by
 * reasoning about the regexes:
 *
 * | query | lands on exactly ONE book | ≥10 books (a wall) | 0 books (dead) | mean |
 * |---|---|---|---|---|
 * | the cleaned `title` (before) | 824 | 48 | 1 | 2.20 |
 * | the verbatim raw title (now) | **886** | **17** | **0** | **1.74** |
 *
 * Narrower on 122 books and wider on exactly one — and that one is the case
 * that matters most: *"A Court of Wings and Ruin (1 of 3) [Dramatized
 * Adaptation] - …, Book 3"* cleans to a string **no card contains**, so its
 * link was a **dead search (0 results)** and the verbatim query lands on the
 * one right book. Adding tokens can never widen a conjunction, so this is a
 * one-way ratchet: the verbatim query is never less specific than the cleaned
 * one.
 *
 * ⚠️ **It does NOT close the reported case, and pretending otherwise would be
 * the fabrication this file exists to avoid.** *The Wandering Inn* goes 16 →
 * **14**: every token volume 1's verbatim title has (`the`, `wandering`,
 * `inn,`, `book`, `1`, `-`) is also a substring of its 15 siblings' cards, and
 * a **numeral can never discriminate under substring matching** (`1` is inside
 * `16`, `2021`, `45:21`). No query composed of that book's own words can
 * exclude them. Recorded with its numbers as **KI-14**; what would settle it
 * is an anchor on the sibling site, not a cleverer query here.
 *
 * ⚠️ Callers pass the verbatim title where they hold one and **nothing** where
 * they do not — a wish-list book this catalog has never matched is a genuine
 * search, and `WorkAudiobookHolding.rawTitle` is `null` on the series-link
 * rung (which carries no Audible string at all). The fallback is today's
 * behaviour exactly, so no caller can be made worse by the absence.
 */

/** The sibling catalog's own R2 cover bucket. See the header above. */
const AUDIOBOOK_COVER_BASE = 'https://covers.heygabi.ai/';

/** Where the site itself lives — `DEFAULT_SITE_URL` in `app/index_push.py`. */
const AUDIOBOOK_SITE_URL = 'https://audiobooks.heygabi.ai/';

/**
 * Match Python's `urllib.parse.quote(safe='/')` exactly, so a cover has ONE
 * canonical URL whichever side built it — `encodeURIComponent` leaves
 * `!'()*` unescaped; `quote()` percent-encodes them. Ported from
 * `covers-base.js`'s `enc`.
 */
function quotePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Resolve an `audiobook_holding.cover_href` (relative to
 * `audiobook_catalog/site/`, e.g. `covers/J.k. Rowling/Harry Potter…jpg`) to a
 * fetchable URL — or `null` for no cover.
 *
 * ⚠️ Some historic hrefs arrive already percent-encoded; encoding an already-
 * encoded value double-encodes it and the CDN 503s (`covers-base.js`'s own
 * comment, measured live in that repo on 2026-08-13). So: decode first if it
 * looks encoded, then encode exactly once.
 */
export function resolveAudiobookCover(href: string | null): string | null {
  const cover = (href ?? '').trim();
  if (!cover) return null;
  if (/^(https?:)?\/\//.test(cover) || cover.startsWith('data:')) return cover;
  let rel = cover.startsWith('covers/') ? cover.slice('covers/'.length) : cover;
  if (/%[0-9A-Fa-f]{2}/.test(rel)) {
    try {
      rel = decodeURIComponent(rel);
    } catch {
      // A literal '%' that is not a valid escape — leave it raw, same as the
      // site's own `coverUrl()`.
    }
  }
  const encoded = rel
    .replace(/^\/+/, '')
    .split('/')
    .map(quotePathSegment)
    .join('/');
  return AUDIOBOOK_COVER_BASE.replace(/\/+$/, '') + '/' + encoded;
}

/**
 * A link to this book on the audiobook site. `URLSearchParams` here matches
 * Python's `urlencode()` byte-for-byte (space → `+`), which is what the site's
 * own hash writer (`_writeHash`) and reader (`_parseHash`) both use — see the
 * header above.
 *
 * @param title        Our spelling — the fallback, and the whole query for a
 *                     book this catalog holds no audiobook row for.
 * @param verbatimTitle That catalog's OWN string for this recording
 *                     (`audiobook_holding.raw_title` / `audioKey`), when we
 *                     have one. Preferred, because it is the string the site's
 *                     own cards carry — see the measurement in the header.
 *                     `null`/`undefined`/blank falls back to `title`.
 */
export function audiobookDetailUrl(title: string, verbatimTitle?: string | null): string {
  // ⚠️ Trim, then fall back — an empty raw title is "not recorded", never a
  // reason to link at an empty search box.
  const q = (verbatimTitle ?? '').trim() || title;
  const params = new URLSearchParams({ q });
  return AUDIOBOOK_SITE_URL + '#' + params.toString();
}
