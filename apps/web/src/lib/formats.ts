/**
 * How an `edition.format` is written for a person.
 *
 * ⚠️ One map, imported by both the collection list and the work page. The first
 * version had labels on the work page only, so the collection showed raw enum
 * values — `ebook_kepub · ebook_kindle · ebook_epub` — which is both ugly and
 * actively misleading, because it presents a Kindle *licence* as though it were
 * a file sitting beside the EPUB.
 */
import { PHYSICAL_FORMATS } from '@lc/core';

export const FORMAT_LABEL: Record<string, string> = {
  hardcover: 'Hardcover',
  paperback: 'Paperback',
  mass_market: 'Mass market',
  ebook_epub: 'EPUB',
  ebook_mobi: 'MOBI',
  ebook_azw3: 'AZW3',
  ebook_kepub: 'KEPUB',
  ebook_pdf: 'PDF',
  // ⚠️ Not "Kindle file". No bytes exist on our side — see migration 0002.
  ebook_kindle: 'Kindle (licence)',
};

export function formatLabel(format: string): string {
  return FORMAT_LABEL[format] ?? format;
}

/** A printing you can hold. The list itself lives in `@lc/core`, once. */
export function isPhysicalFormat(format: string): boolean {
  return (PHYSICAL_FORMATS as readonly string[]).includes(format);
}

/**
 * Is there any point offering to find this book in Google Drive?
 *
 * ⚠️ **Format is the authority here, and an ISBN is deliberately NOT a reason to
 * hide the links.** The request that prompted this was *"if a book has an isbn
 * number or is labeled as physical it wont need a link to the google drive"* —
 * and the ISBN half of that would be actively wrong on this catalog. An ebook
 * can legitimately carry an ISBN; `edition.isbn13` is written back by every
 * successful scan and by the Open Library enrichment path, so an ISBN says
 * "somebody identified this printing", never "this printing is made of paper".
 * Hiding on ISBN would eventually blank the Drive links on the ~140 imported
 * ebooks that are the only reason the links exist. `format` is the column that
 * actually distinguishes paper from a file, and `PHYSICAL_FORMATS` is the one
 * list that says which is which.
 *
 * So: **show the links only when the book has at least one non-physical
 * edition.** A file or a licence is recorded, so there may be something in Drive
 * to find.
 *
 * ⚠️ **A work with no editions at all is treated as "nothing to find", not as
 * "unknown".** That is the one judgement call in this function. It is right for
 * the case that produces such works today: a spine read from a shelf photograph
 * deliberately creates no edition row — `addLineToCatalog` explains why, the
 * format would be an invention — and that book is, by construction, a physical
 * book somebody photographed on a shelf. Showing it three Drive links is exactly
 * the noise being complained about. The cost when this is wrong is that a
 * hand-typed work with no edition recorded loses a generic Drive search until
 * someone records what form they have, which is a fact worth recording anyway.
 */
export function shouldShowDriveLinks(editions: readonly { format: string }[]): boolean {
  return editions.some((e) => !isPhysicalFormat(e.format));
}
