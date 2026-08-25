/**
 * Reaching the sibling ebook shelf from an owned-ebook shelf row — the ebook
 * counterpart to `audiobook-site.ts`.
 *
 * ## The deep link is by TITLE (`#q=<title>`), NOT by the manifest anchor
 *
 * The ebook shelf (`audiobook_catalog/site/ebooks.html`) also deep-links to one
 * book by an `#<anchor>` whose value is minted in the ebook manifest
 * (`scripts/build_ebook_manifest.ebook_anchor()` — `"b-" + sha256(rel_path)[:12]`,
 * whose docstring EXPLICITLY forbids a second copy). That anchor is not a field
 * this library catalog holds, and it must never be recomputed here. So instead
 * we use the shelf's OTHER deep-link form — the `#q=<title>` search-hash added
 * 2026-08-24, the exact counterpart to the audiobook site's `audiobookDetailUrl`
 * (`#q=<title>`): the shelf reads the hash on load, drops the title into its
 * search box, and surfaces the matching book(s). It lands ON the book by putting
 * it alone in the search, not by a per-book URL that does not exist.
 *
 * The base URL mirrors `DEFAULT_EBOOKS_SITE_URL` in that repo's
 * `app/index_push.py`.
 */

/** Where the ebook shelf lives — `DEFAULT_EBOOKS_SITE_URL` in `app/index_push.py`. */
const EBOOK_SITE_URL = 'https://ebooks.heygabi.ai/';

/**
 * A link to this book on the ebook shelf via its title search-hash — the ebook
 * counterpart to `audiobookDetailUrl`. The shelf's `#q=` reader decodes the
 * fragment with `URLSearchParams`, so either `%20` (this `encodeURIComponent`)
 * or `+` decodes to a space; the matching book is then filtered in by title.
 */
export function ebookShelfUrl(title: string): string {
  return `${EBOOK_SITE_URL}#q=${encodeURIComponent(title)}`;
}
