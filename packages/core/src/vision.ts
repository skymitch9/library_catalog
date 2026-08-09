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
}

/**
 * A shelf read once we have tried to match it against what we already hold.
 *
 * `existingWorkId` is the point of the whole screen — re-adding books you
 * already own is the obvious failure mode of bulk intake, so it is resolved
 * before anyone is asked to tick anything. `alsoInAudio` is this catalog's
 * addition: 1,073 audiobooks are the other thing a person means by "I already
 * have that".
 */
export interface ShelfMatch {
  book: ShelfBook;
  existingWorkId: number | null;
  existingTitle: string | null;
  /** Matched against the audiobook catalog on `workKey`. Never a write target. */
  alsoInAudio: boolean;
  /** Best guess from the free ISBN rungs, when one was found. */
  isbn13: string | null;
  resolvedTitle: string | null;
  resolvedAuthor: string | null;
  coverUrl: string | null;
  /**
   * How well the resolved title matches what was read, 0..1. Null when nothing
   * resolved. Below `MIN_SPINE_SIMILARITY` the match is a guess and must not be
   * acted on without a person looking at it.
   */
  similarity: number | null;
}

/**
 * The system prompt for shelf reads.
 *
 * ⚠️ Rewritten, not ported. The board game version asks for box titles across
 * the front of a shelf. Books differ in three ways that each break that prompt:
 * the text is rotated, the author is on the spine and is load-bearing for
 * matching, and a series name usually sits beside the volume title so a naive
 * read returns the series for every book on the shelf.
 */
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
  an uncertain one gets checked.`;
