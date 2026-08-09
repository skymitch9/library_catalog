/**
 * How an `edition.format` is written for a person.
 *
 * ⚠️ One map, imported by both the collection list and the work page. The first
 * version had labels on the work page only, so the collection showed raw enum
 * values — `ebook_kepub · ebook_kindle · ebook_epub` — which is both ugly and
 * actively misleading, because it presents a Kindle *licence* as though it were
 * a file sitting beside the EPUB.
 */
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
