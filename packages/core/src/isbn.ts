/**
 * Leaf module: what counts as a book's barcode, and what does not.
 *
 * This is the file that makes barcode-first safe. Imports nothing. No I/O.
 *
 * ## Why this exists at all, when the board game catalog has no equivalent
 *
 * The Board Game Catalog's finding was that barcodes are a weak primitive:
 * GameUPC resolved 2 of 4 real games, and crowdfunded editions often carry no
 * retail barcode at all. **For books that reverses.** Every trade book published
 * since roughly 2007 carries an ISBN-13 printed as a Bookland EAN-13, and the
 * free databases indexing ISBNs are far deeper. So barcode is the strategy here,
 * not the fifth phase — which means the *filter* has to be right, because the
 * scanner is pointed at a page that has more than one barcode on it.
 *
 * ## The trap this file exists for
 *
 * A book usually carries **two barcodes side by side**: the Bookland EAN-13
 * (978/979 + the ISBN) and a 5-digit EAN-5 price add-on. Mass-market paperbacks
 * often carry a *third*, a separate retail UPC-A. A scanner sweeping the back
 * cover will read whichever it locks onto first, and only one of the three is a
 * book identifier.
 *
 * The rule is therefore **accept nothing but a checksum-valid 978/979 EAN-13,
 * and on anything else keep scanning** — do not look it up, do not warn, do not
 * guess. A lookup on a price add-on is a wasted round trip; a lookup on the
 * retail UPC is worse, because UPC databases will happily answer with something.
 */

/** Digits only. Strips hyphens, spaces and the trailing X of an ISBN-10. */
function digits(raw: string): string {
  return raw.replace(/[^0-9Xx]/g, '').toUpperCase();
}

/**
 * EAN-13 check digit: weights alternate 1,3 from the left over the first 12.
 * Shared by every EAN-13, Bookland or not.
 */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = first12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidIsbn13(raw: string): boolean {
  const s = digits(raw);
  if (!/^\d{13}$/.test(s)) return false;
  return ean13CheckDigit(s.slice(0, 12)) === s.charCodeAt(12) - 48;
}

/**
 * ISBN-10 check: weights 10..1, modulo 11, with X standing for 10.
 *
 * Needed because pre-2007 books print only this, and half a real shelf is
 * pre-2007.
 */
export function isValidIsbn10(raw: string): boolean {
  const s = digits(raw);
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (s.charCodeAt(i) - 48) * (10 - i);
  const last = s[9] === 'X' ? 10 : s.charCodeAt(9) - 48;
  return (sum + last) % 11 === 0;
}

/**
 * **The scanner's gate.** True only for a barcode that is actually a book.
 *
 * `978` is the original Bookland prefix; `979` is its continuation, allocated
 * once 978 filled up (and `9790` is sheet music — accepted, because a scanned
 * score is still a thing you own and the databases index it).
 *
 * Everything else the camera sees on a back cover — the 5-digit price add-on,
 * the retail UPC-A, a library barcode, the publisher's own SKU sticker — fails
 * here, and the caller's contract is to **keep scanning** rather than to report
 * an error. A wrong-format read is the normal case, not an exception.
 */
export function isBooklandEan13(raw: string): boolean {
  const s = digits(raw);
  return /^97[89]\d{10}$/.test(s) && isValidIsbn13(s);
}

/**
 * Convert at the edge, so nothing downstream ever sees two formats.
 *
 * Prefix 978, drop the old check digit, recompute. Returns null rather than
 * throwing for anything that is not a valid ISBN-10 or ISBN-13 — callers are in
 * a scan loop and a throw there is a crash on a shelf.
 *
 * ⚠️ Note what this does NOT do: it does not convert 979-prefixed ISBN-13s
 * back to ISBN-10, because they have no ISBN-10 form. Any code assuming a
 * round trip is wrong.
 */
export function toIsbn13(raw: string): string | null {
  const s = digits(raw);
  if (isValidIsbn13(s)) return s;
  if (!isValidIsbn10(s)) return null;
  const body = '978' + s.slice(0, 9);
  return body + String(ean13CheckDigit(body));
}

/** The ISBN-10 form, when one exists. Null for 979 and for invalid input. */
export function toIsbn10(raw: string): string | null {
  const s = digits(raw);
  if (isValidIsbn10(s)) return s;
  if (!isValidIsbn13(s) || !s.startsWith('978')) return null;
  const body = s.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (body.charCodeAt(i) - 48) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return body + (check === 10 ? 'X' : String(check));
}

/**
 * An Amazon ASIN, which is **not an ISBN** and must never be stored as one.
 *
 * Kindle-native titles carry a `B0…` ASIN that no ISBN database knows. Amazon
 * also uses the plain ISBN-10 as the ASIN for print books, which is why this
 * checks the `B` form specifically — a 10-digit numeric "ASIN" is an ISBN-10
 * wearing a different hat, and `toIsbn13` should have it instead.
 *
 * Measured relevance, not assumed: 16 of 30 titles sampled from this
 * household's own library have no Open Library record at all, and they are
 * overwhelmingly the Kindle Unlimited / Audible-native ones. For those rows this
 * is the only identifier that exists. See docs/info/isbn-ladder.md.
 */
export function isAsin(raw: string): boolean {
  return /^B[0-9A-Z]{9}$/.test(raw.trim().toUpperCase());
}

/** Pretty-print for display only. Never store the hyphenated form. */
export function formatIsbn13(isbn13: string): string {
  const s = digits(isbn13);
  if (!/^\d{13}$/.test(s)) return isbn13;
  return `${s.slice(0, 3)}-${s.slice(3, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12)}`;
}

/**
 * What a scanned code actually is.
 *
 * One function rather than three call sites each deciding for themselves, so the
 * scan loop, the manual-entry box and the ebook importer cannot disagree about
 * whether `9781974712557` is worth a lookup.
 */
export type ScannedCode =
  | { kind: 'isbn13'; isbn13: string; isbn10: string | null }
  | { kind: 'asin'; asin: string }
  | { kind: 'ignore'; raw: string; reason: 'price_addon' | 'not_bookland' | 'bad_checksum' };

export function classifyScannedCode(raw: string): ScannedCode {
  const trimmed = raw.trim();

  if (isAsin(trimmed)) return { kind: 'asin', asin: trimmed.toUpperCase() };

  const s = digits(trimmed);

  // The price add-on. Five digits, printed immediately beside the real barcode,
  // and the single most common thing a sweep locks onto by mistake.
  if (/^\d{5}$/.test(s)) return { kind: 'ignore', raw: trimmed, reason: 'price_addon' };

  const isbn13 = toIsbn13(s);
  if (isbn13 && isBooklandEan13(isbn13)) {
    return { kind: 'isbn13', isbn13, isbn10: toIsbn10(isbn13) };
  }

  // A well-formed EAN-13 that is not 978/979 is a retail UPC — a real product
  // code for a real product, which is exactly why it must not be looked up.
  if (/^\d{13}$/.test(s) && isValidIsbn13(s)) {
    return { kind: 'ignore', raw: trimmed, reason: 'not_bookland' };
  }

  return { kind: 'ignore', raw: trimmed, reason: 'bad_checksum' };
}
