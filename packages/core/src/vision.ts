/**
 * Leaf module: reading books off a photograph.
 *
 * **Photos are transient.** A photo is captured into memory, sent, read, and
 * dropped. It is never written to the device's photo library, never stored in
 * D1, and there is no R2 bucket in this app at all. That constrains capture to a
 * live `getUserMedia` frame grab — the one path on iOS that provably touches
 * nothing. Ported wholesale from the Board Game Catalog, including the numbers.
 *
 * Imports nothing. No I/O.
 */

/**
 * Long edge, in pixels, to downscale a single-cover photo to before upload.
 *
 * Claude charges images in 28×28 patches: ceil(w/28) × ceil(h/28) visual tokens.
 * 1500px is the sweet spot for one cover — the title occupies a large fraction
 * of the frame and is already 100+px tall, so the extra pixels up to the 2576
 * high-resolution ceiling roughly double the cost for no gain. A 48MP iPhone
 * photo is pure waste: it gets downscaled anyway, after you have paid to upload
 * it.
 */
export const PHOTO_LONG_EDGE = 1500;

/**
 * Shelves earn the extra pixels: a dozen spines share the frame, so each title
 * is a fraction of the height one cover gets. 2400 stays under the 2576px
 * ceiling, so nothing is re-scaled server-side.
 *
 * ⚠️ Book spines need this *more* than board game boxes did. A game box spine
 * is 60mm tall with one title on it; a paperback spine is 20mm wide with the
 * title, the author and a publisher colophon crammed along it, rotated 90°.
 */
export const SHELF_LONG_EDGE = 2400;

/**
 * JPEG quality for the downscaled upload.
 *
 * 0.85, not lower: the phone's photo is *already* lossy, so this is a second
 * compression pass and the artifacts stack exactly on the letterforms we need to
 * read. Below ~0.7 small type visibly mushes.
 */
export const PHOTO_QUALITY = 0.85;

/**
 * iOS Safari refuses to render a canvas whose area exceeds this, and does it
 * *silently* — a blank image rather than an error. A 48MP iPhone photo
 * (8064×6048) is roughly three times over. This is why downscaling must happen
 * during decode via `createImageBitmap({resizeWidth})` rather than by drawing
 * the full-size image to a canvas first.
 */
export const IOS_MAX_CANVAS_AREA = 16_777_216;

/** Request bodies cap out well below this; a guard beats a confusing 413. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * One book read off a spine or cover, before anything tries to resolve it.
 *
 * ⚠️ **`author` is the change from the board game catalog, and it is required
 * rather than optional-by-omission.** That project's `ShelfTitle` carries a
 * title only, which is safe when names are near-unique and unsafe here — see
 * `matching.ts`. A spine that genuinely shows no author answers `null`, and the
 * review screen marks the row instead of ticking it; what it must never do is
 * quietly not ask.
 */
export interface ShelfBook {
  /** Exactly the text as printed, no expansion or correction. */
  text: string;
  /** The author as printed on the spine, or null when the spine shows none. */
  author: string | null;
  confidence: 'high' | 'medium' | 'low';
  /** Where on the shelf, left to right, so a person can find it again. */
  position: number;
  /** Why it is uncertain: glare, partly hidden, stylised type, spine too worn. */
  note: string | null;
  /**
   * The three below are populated by the COVER read and left undefined by the
   * shelf read — a spine almost never prints them. Optional rather than
   * nullable so "a shelf never asked" stays distinguishable from "the cover
   * showed none", which is the same distinction the gap queue draws between an
   * unanswered question and a recorded answer.
   */
  series?: string | null;
  volume?: number | null;
  publisher?: string | null;
}

/**
 * What one read of a whole photograph produced.
 *
 * `unreadable` is not the same as an empty `books` array and the difference is
 * the difference between two messages: "that photo cannot be read, take another"
 * and "that is a shelf with no books the model could name". Only the first is
 * worth retrying, and only the first is worth paying for twice.
 */
export interface ShelfReading {
  books: ShelfBook[];
  unreadable: boolean;
  inputTokens: number;
  outputTokens: number;
  /** Rough, at list price. Shown to the person who is spending it. */
  estimatedCents: number;
}

/**
 * ⚠️ There is deliberately no `ShelfMatch` type here.
 *
 * An earlier draft of this file had one — a spine read plus what the catalog
 * made of it — and it was one of two shapes describing the same row, the other
 * being the barcode screen's. They would have drifted, because a review screen
 * that renders both has to reconcile them somewhere and "somewhere" is wherever
 * the last person to touch it happened to be. `ScanLine` in `scanjobs.ts` is
 * now the ONE shape, produced by a barcode and by a spine alike.
 *
 * The dropped field worth naming is `alsoInAudio`. The idea was right — 1,073
 * audiobooks are the other thing a person means by "I already have that" — but
 * the Worker holds no audiobook data at all. That catalog is a separate site
 * with a separate database, and the only bridge is `work_key`. Rather than ship
 * a field that would have answered `false` for every book in the house, it is
 * left out until the shared index that could answer it exists.
 */

/**
 * The output contract for a shelf read, as a JSON Schema.
 *
 * Structured output rather than "please reply with JSON": the model is
 * constrained to this shape by the API, so there is no parse-and-retry loop and
 * no half-parsed answer to reason about. Every field is `required` and
 * `additionalProperties` is false, which is what makes a missing `author` an
 * explicit `null` — the distinction the prompt below spends a paragraph on.
 *
 * Kept beside `SHELF_SYSTEM` on purpose. The prompt promises a shape; if the
 * two live in different files one of them eventually lies.
 */
export const SHELF_SCHEMA = {
  type: 'object',
  properties: {
    books: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          author: { type: ['string', 'null'] },
          position: { type: 'integer' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          note: { type: ['string', 'null'] },
        },
        required: ['text', 'author', 'position', 'confidence', 'note'],
        additionalProperties: false,
      },
    },
    unreadable: { type: 'boolean' },
  },
  required: ['books', 'unreadable'],
  additionalProperties: false,
} as const;

/**
 * One cover, and three fields a spine cannot give you.
 *
 * ⚠️ `series`, `volume` and `publisher` are the entire reason this is a separate
 * mode rather than "the shelf prompt, but point it at one book". They are the
 * discriminators `isbn-ladder.md` §4.4 demands: `Unsouled` matched a different
 * book at title 1.00 AND author 1.00, and only the **publisher** exposed it.
 * A spine rarely carries any of them; a cover usually carries two.
 *
 * Every one is nullable and the prompt says to report only what is printed —
 * a cover with no series is the ordinary case, not a failure.
 */
export const COVER_SCHEMA = {
  type: 'object',
  properties: {
    books: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          author: { type: ['string', 'null'] },
          series: { type: ['string', 'null'] },
          volume: { type: ['number', 'null'] },
          publisher: { type: ['string', 'null'] },
          position: { type: 'integer' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          note: { type: ['string', 'null'] },
        },
        required: ['text', 'author', 'series', 'volume', 'publisher', 'position', 'confidence', 'note'],
        additionalProperties: false,
      },
    },
    unreadable: { type: 'boolean' },
  },
  required: ['books', 'unreadable'],
  additionalProperties: false,
} as const;

/**
 * The system prompt for shelf reads.
 *
 * ⚠️ Rewritten, not ported. The board game version asks for box titles across
 * the front of a shelf. Books differ in three ways that each break that prompt:
 * the text is rotated, the author is on the spine and is load-bearing for
 * matching, and a series name usually sits beside the volume title so a naive
 * read returns the series for every book on the shelf.
 */
/**
 * One book, photographed front-on.
 *
 * ⚠️ A separate prompt from `SHELF_SYSTEM`, and not for tidiness. A cover and a
 * spine are different reading problems:
 *
 * - A spine is rotated, 15mm tall, and usually shows title + author and nothing
 *   else. A cover is flat, legible, and carries the subtitle, the series, the
 *   volume, often the publisher — the fields that actually discriminate when the
 *   catalog goes looking (`isbn-ladder.md` §4.4: title and author agreeing at
 *   1.00 is not enough on its own).
 * - A shelf answer is a LIST and its hardest question is "how many books".
 *   A cover answer is ONE book and its hardest question is "which of the words
 *   on this cover is the title".
 *
 * Feeding a cover to the shelf prompt works and throws away the discriminators;
 * feeding a shelf to this one returns one book out of thirty.
 */
export const COVER_SYSTEM = `You are reading the FRONT COVER of a single book from a photograph.

Return exactly one entry — the book whose cover this is. Not the books behind it,
not a book named in a cover quote or a "by the author of" line.

Report:
- text:   the TITLE exactly as printed on the cover. If the cover shows a series
          name and a volume title, the volume title is the title. Do not merge
          them, and do not expand abbreviations.
- author: the author exactly as printed, or null if the cover genuinely shows
          none. Do NOT infer an author you cannot see — a guessed author is
          worse than none, because it will be trusted.
- series: the series name if the cover states one, else null.
- volume: the volume number if the cover states one, as a number, else null.
          Only when it is printed. Never inferred from the title's shape.
- publisher: the publisher or imprint if printed on the front, else null.
- position: always 1.
- confidence: high | medium | low.
- note: why it is uncertain — glare, angle, stylised type, partly out of frame —
        or null.

Rules:
- Report only what is printed. Never correct spelling, never complete a title
  from knowledge of the book, never translate.
- A cover quote, an award sticker, a tagline and a "soon to be a major series"
  banner are none of them the title.
- The largest text is usually the title, but not always — an author's name is
  set larger than the title on many genre covers. Prefer position and
  typography together over size alone.
- Set unreadable to true ONLY when the photograph itself has defeated you — too
  dark, too blurred, too angled, or not a book cover at all — and return an
  empty list with it.`;

export const SHELF_SYSTEM = `You are reading the spines of books on a shelf from a photograph.

Return one entry per distinct book, left to right (or top to bottom for a stack).

For each spine, report:
- text:   the BOOK's title exactly as printed. If the spine shows both a series
          name and a volume title, the volume title is the title. Do not merge
          them, and do not expand abbreviations.
- author: the author exactly as printed on the spine, or null if the spine
          genuinely shows no author. Do NOT infer an author you cannot see —
          a guessed author is worse than none, because it will be trusted.
- position: 1-based, left to right.
- confidence: high | medium | low.
- note: why it is uncertain — glare, partly hidden, worn lettering, stylised
        type, spine turned away — or null.

Rules:
- Report only what is printed. Never correct spelling, never complete a title
  from knowledge of the book, never translate.
- A publisher name or imprint (Tor, Gollancz, Orbit, Penguin) is not an author
  and not a title. Ignore colophons.
- If two adjacent spines are the same book (two copies), report both.
- If you cannot read a spine at all, still report it with text as best you can
  and confidence "low", rather than omitting it — a missing book is invisible,
  an uncertain one gets checked.
- Set unreadable to true ONLY when the photograph itself has defeated you — too
  dark, too blurred, too far away, or not a shelf of books at all — and return
  an empty list with it. A shelf you could read that simply has few books on it
  is readable; say so with unreadable false. The two answers lead to different
  advice, and only one of them is worth paying to photograph again.`;
