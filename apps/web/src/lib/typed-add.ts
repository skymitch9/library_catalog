/**
 * What pressing **Save** on `/add?mode=type` actually writes — the decision half,
 * lifted out of `AddWork.tsx` so a `node:test` process can run it.
 *
 * This repo has no jsdom and no vitest (see `add-modes.test.ts`), and
 * `AddWork.tsx` reaches `api.js` → `lib/firebase.ts`, which reads
 * `import.meta.env` at module scope and takes a `tsx --test` process down at
 * import. So the sequence lives here behind an injected `TypedAddDeps` and the
 * component keeps only the form state and the JSX.
 *
 * ## ⚠️ Why this file exists at all: the 2026-08-13 intake bugs
 *
 * `docs/TODO.md` recorded three defects found by adding five books by hand and
 * reading the rows back. The 2026-09-05 audit repaired the five rows and said
 * in as many words that it had **not** re-tested the bugs. This module is where
 * each of the three is now pinned by a test (`apps/web/test/typed-add.test.ts`):
 *
 *  1. **The typed ISBN is not stored.** Fixed in the component 2026-08-13 for
 *     the ISBN-13 case, and `readTypedIsbn` closes the two shapes that fix
 *     missed — see its own header.
 *  2. **"AND WE…" defaulted to record-no-copy.** `DEFAULT_TYPED_INTENT` is the
 *     one place that answer is written now, so the default cannot drift back by
 *     somebody editing a JSX default in passing.
 *  3. **A save can fail silently.** `saveTypedWork` never swallows: every step
 *     that does not land comes back as a `TypedAddProblem`, and
 *     `typedAddOutcome` is what the component branches on so a partial save
 *     cannot be reported as a clean one.
 */
import { classifyScannedCode } from '@lc/core';

/**
 * What the "And we…" dropdown opens on.
 *
 * ⚠️ **`'owned'`, and the reason is bug 2 of 2026-08-13.** For a scanning
 * session — where every book is physically in your hands — *"just catalogue it
 * — record no copy"* is the one answer that is never what you meant, and it
 * fails silently: the book appears in the catalog and simply is not owned. It
 * produced #269 *Who Goes Roar?* with `copies = 0`.
 *
 * The empty answer is still offered by the dropdown, because it is a real thing
 * to mean. It is just no longer the thing you get by not choosing.
 */
export const DEFAULT_TYPED_INTENT = 'owned' as const;

/** `''` is "just catalogue it — record no copy", and writes no `copy` row. */
export type TypedIntent = '' | 'owned' | 'wanted';

/**
 * What the ISBN box actually holds when Save is pressed.
 *
 * ⚠️ **Three answers, not two, and the third is the point.** The component used
 * to test `/^97[89]\d{10}$/` against the digits and do nothing at all when it
 * did not match — so *"I typed an identifier and the catalog kept none of it"*
 * was indistinguishable from *"I left the box empty"*. Both of the shapes that
 * test rejects are shapes a person genuinely types off the back of a book:
 *
 *   * an **ISBN-10** — printed on every book old enough to have one, and on
 *     plenty that are not. *Who Goes Roar?* (#269) prints `1-83642-280-6`
 *     beside its 13-digit form, and the 10-digit form was silently dropped.
 *   * a **mistyped 13-digit code** — `/^97[89]\d{10}$/` never checked the check
 *     digit, so one wrong keystroke stored a well-formed ISBN belonging to
 *     nothing, on the row of a book that will now never re-match. That is the
 *     failure `docs/info/isbn-ladder.md` §7 is a whole post-mortem about.
 *
 * `classifyScannedCode` is the catalog's one answer to "what is this code" —
 * the same function the scan loop and the ebook importer ask — so the typed box
 * and the barcode cannot disagree about `9781974712557`.
 */
export type UnusableReason = 'price_addon' | 'not_bookland' | 'bad_checksum';

export type TypedIsbn =
  /** The box was empty. Nothing was claimed, so nothing is owed. */
  | { kind: 'none' }
  | { kind: 'isbn13'; isbn13: string }
  /** Something was typed and it is not an ISBN. ⚠️ Must be SAID, never dropped. */
  | { kind: 'unusable'; typed: string; reason: UnusableReason };

export function readTypedIsbn(raw: string): TypedIsbn {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'none' };

  const code = classifyScannedCode(trimmed);
  if (code.kind === 'isbn13') return { kind: 'isbn13', isbn13: code.isbn13 };
  // An ASIN is not an ISBN and must never be stored as one (`isAsin`'s header).
  // It reaches a person as the same sentence a bad checksum does, because the
  // action is the same: that is not the number on the barcode.
  if (code.kind === 'asin') return { kind: 'unusable', typed: trimmed, reason: 'not_bookland' };
  return { kind: 'unusable', typed: trimmed, reason: code.reason };
}

/**
 * A step of the save that did not land, in a shape the caller cannot ignore.
 *
 * ⚠️ **The work itself is never in here.** If `createWork` fails, nothing was
 * written and `saveTypedWork` throws — the ordinary error path, and the form is
 * still standing with everything the person typed. A `TypedAddProblem` always
 * means *the book IS in the catalog and something beside it is not*, which is
 * the state that used to be reported as plain success.
 */
export type TypedAddProblem =
  | { kind: 'isbn-not-an-isbn'; typed: string; reason: UnusableReason }
  | { kind: 'isbn-not-recorded'; detail: string }
  | { kind: 'copy-not-recorded'; detail: string; intent: 'owned' | 'wanted' };

export interface TypedAddResult {
  workId: number;
  /** The ISBN that reached an `edition` row, when one did. */
  isbn13: string | null;
  /** Empty on a clean save. Anything in here must be shown to a person. */
  problems: TypedAddProblem[];
}

/**
 * The network calls, injected — so this module never imports `api.js` and so a
 * test can make any one of them fail on purpose.
 */
export interface TypedAddDeps {
  createWork: (body: unknown) => Promise<{ work: { id: number } }>;
  createEdition: (body: unknown) => Promise<unknown>;
  createCopy: (body: unknown) => Promise<unknown>;
  /** `lib/errors.ts`'s `describeError`, passed in because it reaches `api.js`. */
  describeError: (err: unknown) => string;
}

export interface TypedAddInput {
  title: string;
  /** ⚠️ Explicit `null` for the deliberate authorless add, never `''`. */
  authors: string | null;
  series: string | null;
  isbn: string;
  intent: TypedIntent;
}

/**
 * Create the work, then record what else the person told us — reporting every
 * part that did not land.
 *
 * ## ⚠️ Nothing here throws once the work exists, and that is the fix
 *
 * The shipped sequence let `createCopy` throw straight out of the handler. The
 * person then saw a request error with no mention of the book, and the obvious
 * response — press Save again — created a **second work**, because
 * `POST /api/works` deliberately does not dedupe (migration 0001). So a failing
 * copy is a `TypedAddProblem`, not an exception: the book is in, the form must
 * stop offering Save, and the sentence must name what is missing.
 *
 * The ISBN is attempted before the copy for the same reason it always was: it
 * is the identifier the book carries, and the one thing that could ever
 * re-match a board book no service knows.
 */
export async function saveTypedWork(
  deps: TypedAddDeps,
  input: TypedAddInput,
): Promise<TypedAddResult> {
  const { work } = await deps.createWork({
    title: input.title.trim(),
    authors: input.authors === null ? null : input.authors.trim(),
    series: input.series?.trim() || null,
  });

  const problems: TypedAddProblem[] = [];
  let isbn13: string | null = null;

  const typed = readTypedIsbn(input.isbn);
  if (typed.kind === 'unusable') {
    problems.push({ kind: 'isbn-not-an-isbn', typed: typed.typed, reason: typed.reason });
  } else if (typed.kind === 'isbn13') {
    try {
      await deps.createEdition({ workId: work.id, isbn13: typed.isbn13 });
      isbn13 = typed.isbn13;
    } catch (err) {
      /*
       * ⚠️ Still not fatal — losing the ISBN is a nuisance, losing the whole
       * book because its ISBN was already on another row would be the bulk
       * intake path failing at the one thing it exists to do. What changed is
       * that it is now REPORTED: the old `setNote` here was overwritten by the
       * panel closing on the very next line.
       */
      problems.push({ kind: 'isbn-not-recorded', detail: deps.describeError(err) });
    }
  }

  // A copy with no `edition_id` is what migration 0001 made nullable for.
  if (input.intent !== '') {
    try {
      await deps.createCopy({ workId: work.id, status: input.intent });
    } catch (err) {
      problems.push({
        kind: 'copy-not-recorded',
        detail: deps.describeError(err),
        intent: input.intent,
      });
    }
  }

  return { workId: work.id, isbn13, problems };
}

/**
 * The person-facing sentence for one problem.
 *
 * Every one of them says the same three things the estate's refusal rule asks
 * for — what happened, what it cost, and what to do next — and every one of
 * them leads with the fact that the book **is** in the catalog, because that is
 * the thing somebody about to press Save a second time needs to know first.
 */
export function typedAddProblemSentence(problem: TypedAddProblem): string {
  switch (problem.kind) {
    case 'isbn-not-an-isbn':
      return (
        `The book was added, but “${problem.typed}” is not an ISBN — ` +
        (problem.reason === 'price_addon'
          ? 'that is the short price code beside the barcode. '
          : problem.reason === 'not_bookland'
            ? 'that is a product code, not a book number. '
            : 'the check digit does not match, so a digit is wrong somewhere. ') +
        'Nothing was recorded for it. Add it from the book page once you have the number off the back of the book.'
      );
    case 'isbn-not-recorded':
      return `The book was added, but its ISBN was not recorded — ${problem.detail} Add it from the book page.`;
    case 'copy-not-recorded':
      return (
        `The book was added, but ${problem.intent === 'owned' ? 'your copy was not recorded, so it is catalogued and not owned' : 'it was not put on the wishlist'} — ` +
        `${problem.detail} ⚠️ Do not press Save again — that would add the book a second time. ` +
        `Open the book page and add ${problem.intent === 'owned' ? 'the copy' : 'the want'} there.`
      );
  }
}

export type TypedAddOutcome =
  | { kind: 'clean'; workId: number }
  /** ⚠️ The caller must show these and must NOT report a plain success. */
  | { kind: 'partial'; workId: number; sentences: string[] };

/**
 * What the caller is allowed to say about the save it just ran.
 *
 * ⚠️ **This is bug 3's whole fix in one function.** The old handler set a note
 * and then called `onAdded()`, which unmounts the panel — so the sentence was
 * written to state that was thrown away in the same tick, and a save that lost
 * the ISBN looked exactly like one that did not. A caller branching on this
 * cannot make that mistake: `partial` carries no path back to "added".
 */
export function typedAddOutcome(result: TypedAddResult): TypedAddOutcome {
  if (result.problems.length === 0) return { kind: 'clean', workId: result.workId };
  return {
    kind: 'partial',
    workId: result.workId,
    sentences: result.problems.map(typedAddProblemSentence),
  };
}
