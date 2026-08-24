/**
 * Parse a LibraryThing `thingTitle` response. Extracted here, pure and
 * import-safe, so it can be unit-tested — the backfill script runs on import
 * and cannot be imported by a test.
 *
 * ## The REAL response shape — measured live 2026-08-24
 *
 * `GET https://www.librarything.com/api/<key>/thingTitle/<title>` answers
 * `Content-Type: text/xml` with a single `<idlist>` root. LibraryThing does its
 * own fuzzy title match server-side and returns the ONE best-matching work's
 * ISBNs — a flat list of every edition's ISBN-10, with no per-item structure:
 *
 * ```xml
 * <?xml version="1.0" encoding="utf-8"?>
 * <idlist>
 *   <title>Title omitted per vendor terms</title>
 *   <link>https://www.librarything.com/work/825739</link>
 *   <isbn>0812550706</isbn>
 *   <isbn>0765342294</isbn>
 *   ... (187 for "Enders Game")
 *   <license>By using this service you agree to its license. See</license>
 * </idlist>
 * ```
 *
 * ⚠️ **There is no title or author to gate on.** The `<title>` is literally
 * `"Title omitted per vendor terms"` on every hit (Amazon/vendor licensing),
 * and no author appears anywhere. That is WHY the rung cannot compute a real
 * title-similarity score — the data to compare against is not in the response.
 *
 * A MISS (no title match) is a bare marker, no `<isbn>` elements at all:
 *
 * ```xml
 * <idlist><unknownID/></idlist>
 * ```
 *
 * ## What "not a response we can read" looks like
 *
 * The KEYLESS `thingISBN` endpoint (and the site generally) sits behind a
 * Cloudflare bot check that answers an HTML challenge page ("Attention
 * Required! | Cloudflare"), not XML — measured 403 on 2026-08-24. Any body that
 * is not an `<idlist>` document (a Cloudflare page, an empty string, a
 * truncated read) is treated as "could not read a response" and yields no
 * ISBNs, never a throw and never a fabricated hit.
 *
 * @param {unknown} xml  the raw response body
 * @returns {string[]}   the ISBN strings in the response, or [] for a miss /
 *                       an unreadable body. Values are NOT validated here — the
 *                       caller runs each through the ISBN-13 checksum.
 */
export function parseThingTitleIsbns(xml) {
  if (typeof xml !== 'string' || xml.length === 0) return [];

  // A real answer is an <idlist> document. A Cloudflare challenge page, an
  // empty body or any other HTML is not one, so we read nothing from it rather
  // than scraping stray digits out of markup that was never an API response.
  if (!/<idlist[\s>]/i.test(xml)) return [];

  // A miss carries <unknownID/> and no <isbn> elements; the match below simply
  // finds nothing, which is the same [] a caller wants for "not found".
  return [...xml.matchAll(/<isbn>\s*([^<]+?)\s*<\/isbn>/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean);
}
