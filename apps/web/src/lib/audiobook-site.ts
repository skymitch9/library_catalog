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
 */
export function audiobookDetailUrl(title: string): string {
  const params = new URLSearchParams({ q: title });
  return AUDIOBOOK_SITE_URL + '#' + params.toString();
}
