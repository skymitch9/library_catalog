/**
 * Which edition row an add writes — the decision half of the edition step in
 * `lib/catalog-add.ts`, lifted out so a `node:test` process can run it.
 *
 * Same reason `lib/typed-add.ts` exists: `catalog-add.ts` imports `api.js` →
 * `lib/firebase.ts`, which reads `import.meta.env` at module scope and takes a
 * `tsx --test` process down at import. So the rule lives here behind an
 * injected `createEdition`, and `catalog-add.ts` keeps the network sequence.
 *
 * ## ⚠️ THE RULE (owner-approved 2026-10-27)
 *
 * | the add | edition written |
 * |---|---|
 * | a **new** book, ISBN known | one, with that ISBN (`source: 'openlibrary'`, as before) |
 * | a **new** book, no ISBN | one, `isbn13: null`, `source: 'manual'` |
 * | a book we already hold, ISBN known, shelf target | one, with that ISBN (unchanged) |
 * | a book we already hold, no ISBN | **none** (unchanged — a copy of a known work whose printing is unknown) |
 * | a WANT attaching to a book we already hold | **none**, ISBN or not (unchanged — #139) |
 *
 * ⚠️ **Why a new book with no ISBN now earns its edition.** The old rule wrote
 * an edition only when the line carried an ISBN-13, on the argument that a
 * spine or photo add only *guessed* its format. That stopped being true when
 * the scan-time format toggle arrived (`AddBookPanel.tsx`, `lib/scan-format.ts`):
 * the format is now the person's explicit choice, not an inference. And an
 * edition-less new book is the 2026-08-13 failure again — five hand-added
 * books landed with `editions = 0` and became unmatchable. Measured again
 * 2026-10-24/28: works 541–545 were added through the panel without an ISBN and
 * each got a copy with `edition_id = NULL` and zero editions; the owner had to
 * add editions by hand for 546/547.
 *
 * An ISBN-less edition on a brand-new work cannot collide with anything —
 * `idx_edition_isbn13` ignores NULLs and the work has no other edition for the
 * blank-sibling refusal to match — so no new 409 handling is needed.
 */
import type { EditionFormat, ScanLine } from '@lc/core';
import { DEFAULT_SCAN_FORMAT } from './scan-format.js';

/** The `POST /api/editions` body this module can produce. */
export interface EditionBody {
  workId: number;
  isbn13: string | null;
  format: EditionFormat;
  publisher: string | null;
  publishedYear: number | null;
  coverUrl: string | null;
  source: 'openlibrary' | 'manual';
}

/**
 * The edition a reviewed line earns, or `null` when it earns none.
 *
 * ⚠️ `format` defaults here as well as at the toggle, deliberately — see the
 * note on `editionFromLine`'s former home in `catalog-add.ts`: a required
 * parameter would turn "somebody forgot to thread it through" into an
 * `undefined` in a schema. `DEFAULT_SCAN_FORMAT` is the one place the word
 * `paperback` is written.
 */
export function editionForAdd(
  workId: number,
  line: Pick<ScanLine, 'isbn13' | 'publisher' | 'publishedYear' | 'coverUrl'>,
  opts: {
    /** True when the add attaches to a work the catalog already holds. */
    attached: boolean;
    /** True on the Wishlist target. */
    wishlist: boolean;
    format?: EditionFormat;
  },
): EditionBody | null {
  const format = opts.format ?? DEFAULT_SCAN_FORMAT;
  // ⚠️ The load-bearing half of the wishlist path — unchanged. A want on a
  // book we hold writes no printing, so it can never mint one beside the
  // ISBN-less crowdfunded/slipcase rows (#139).
  if (opts.wishlist && opts.attached) return null;

  const isbn13 = line.isbn13 ?? null;
  // A book we already hold, with nothing to say about which printing this is:
  // the copy goes on the work, unlinked, exactly as before.
  if (!isbn13 && opts.attached) return null;

  return {
    workId,
    isbn13,
    format,
    publisher: line.publisher ?? null,
    publishedYear: line.publishedYear ?? null,
    coverUrl: line.coverUrl ?? null,
    // An ISBN-less row is the person's assertion (their format choice), not a
    // lookup's — `manual` is the honest source, and it outranks every later
    // automated write.
    source: isbn13 ? 'openlibrary' : 'manual',
  };
}

/**
 * Write the edition `editionForAdd` decides on, returning its id (or `null`
 * when none is owed). `createEdition` is injected so a test can count calls;
 * errors (the ISBN `isbn_taken` / `indistinguishable_printing` 409s) propagate
 * exactly as they did when this was inline.
 */
export async function mintEditionForAdd(
  createEdition: (body: EditionBody) => Promise<{ edition: { id: number } }>,
  ...args: Parameters<typeof editionForAdd>
): Promise<number | null> {
  const body = editionForAdd(...args);
  if (!body) return null;
  return (await createEdition(body)).edition.id;
}
