/**
 * Reaching the sibling ebook shelf from an owned-ebook shelf row — the ebook
 * counterpart to `audiobook-site.ts`.
 *
 * ## ⚠️ There is NO per-book deep link available from this catalog's data
 *
 * The ebook shelf (`audiobook_catalog/site/ebooks.html`) DOES deep-link to one
 * book, but only by an `#<anchor>` whose value is minted in the ebook manifest
 * (`scripts/build_ebook_manifest.ebook_anchor()`) — see `app/index_push.py`'s
 * `ebooks_detail_url`, which is explicit that "the anchor is NOT computed here".
 * That anchor is not a field this library catalog holds, and unlike the
 * audiobook site the ebook shelf has **no `#q=<title>` search-hash fallback**
 * (its search box is not driven by the URL). So the honest maximum is a link to
 * the shelf itself; it opens the corresponding catalog but does not scroll to
 * the specific book. If the manifest anchor is ever surfaced on `/api/works/:id`,
 * swap this for `<site>/#<anchor>` and the deep link lights up for free.
 *
 * The base URL mirrors `DEFAULT_EBOOKS_SITE_URL` in that repo's
 * `app/index_push.py`.
 */

/** Where the ebook shelf lives — `DEFAULT_EBOOKS_SITE_URL` in `app/index_push.py`. */
const EBOOK_SITE_URL = 'https://ebooks.heygabi.ai/';

/**
 * A link to the ebook shelf. ⚠️ NOT a per-book deep link — see the header: this
 * catalog cannot compute the manifest anchor the shelf deep-links by, so the link
 * lands on the shelf, not the specific book.
 */
export function ebookShelfUrl(): string {
  return EBOOK_SITE_URL;
}
