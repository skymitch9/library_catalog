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

/**
 * How a *medium* is written for a person — the coarse question, one step above
 * `formatLabel`.
 *
 * ⚠️ `audio` appears here and NOT in `EditionMedium`, and the asymmetry is on
 * purpose. `@lc/core` has two media because an audiobook is not an edition of
 * anything in this database; this map has three because the series page shows
 * all three side by side and the third one needs a word. Everything that
 * *stores* or *counts* by medium must use the two-value type; only display
 * reaches for this.
 */
export const MEDIUM_LABEL: Record<string, string> = {
  physical: 'Print',
  ebook: 'Ebook',
  audio: 'Audio',
};

export function mediumLabel(medium: string): string {
  return MEDIUM_LABEL[medium] ?? medium;
}
