import { proposedAuthors, proposedTitle, type PreorderAnswer, type ScanLine } from '@lc/core';
import { api } from '../api.js';
import { arrivedPatch } from './statuses.js';
import { preorderQuestionFor, type PreorderQuestion } from './preorders.js';

/**
 * Turning one reviewed line into catalog rows.
 *
 * Extracted from `ScanPage` when the shelf photo arrived, because a spine and a
 * barcode now reach the same "Add" button and there must be exactly one thing
 * behind it. The alternative — a second copy in the photo path — is how one of
 * them quietly stops attaching to existing works.
 */

export interface AddedWork {
  workId: number;
  /** The title of the work we attached to, when we attached rather than created. */
  attachedTo: string | null;
  /**
   * A copy already on file was flipped `preordered` → `owned` instead of a new
   * copy being written. The caller says so on the row: "Copy added" would be a
   * lie, and the difference is the entire point of having asked.
   */
  preorderArrived: boolean;
}

/**
 * ⚠️ **Adding can stop and ask.** One outcome writes rows; the other writes
 * nothing at all and hands back a question.
 *
 * A discriminated union rather than a thrown signal or an `onAsk` callback, for
 * the reason the rest of this file is shaped the way it is: the caller is a button
 * handler, and a button handler that must catch a control-flow exception to stay
 * correct is one refactor away from swallowing it. This shape makes the second
 * case impossible to ignore — TypeScript will not let `workId` be read off it.
 */
export type AddOutcome =
  | { status: 'added'; added: AddedWork }
  | { status: 'ask-preorder'; question: PreorderQuestion };

/**
 * Add a reviewed line to the catalog.
 *
 * ## ⚠️ The universe is not decided here, and that is deliberate
 *
 * *"When a book enters it's automatically added to its verse"* is answered by
 * `createWork` / `updateWork` in `@lc/db`, beside `work_key` and `sort_title`,
 * because this is one of five ways a book enters — the others are the manual Add
 * form, the series-gap wishlist, the ebook importer's `/api/ingest` and
 * `POST /api/works`, and the ebook importer is where most of this catalog came
 * from. Deciding it here would have answered one fifth of the ask.
 *
 * What that buys the three cases this function actually distinguishes:
 *
 *   * **a second format of a book we already hold** — the early return below and
 *     the `existing.work` branch further down both attach to a row that already
 *     carries its universe. **Zero lookups**, because there is no new work
 *     — an ebook, an audiobook and a paperback are editions and copies of one
 *     `work`, and the universe lives on the work. Migration 0080 says why;
 *     an omnibus can collect works from different universes, so it could never
 *     have lived on the edition
 *   * **a genuinely new book** — one Map lookup against bundled JSON inside
 *     `createWork`. No extra request from here, and ⚠️ **never a model**
 *   * **a book the list has never heard of** — resolves to nothing, which is the
 *     ordinary answer for most books and is not a failure
 *
 * ⚠️ A scan carries **no series** — `ScanLine` has no such field — so a scanned
 * book resolves on its title alone at this moment. The series arrives later, and
 * `updateWork` re-resolves when it does. Nothing to do here either way.
 *
 * ⚠️ **Match before creating.** `POST /api/works` deliberately does not dedupe
 * — migration 0001 explains why the database stays permissive — so it is the
 * caller's job to ask. This catalog already holds 117 works imported from
 * ebooks, which makes scanning the paperback of one the *ordinary* case: skip
 * the check and every sweep quietly grows a second row for a book already on
 * the shelf, which is the "filed under already-yours, where it is lost" failure
 * the matcher exists to prevent, arriving through the front door.
 *
 * ## ⚠️ A book with a pre-order on file stops here and asks
 *
 * Called with no `answer` and pointed at a work that has a `preordered` copy, this
 * function **writes nothing** and returns `ask-preorder`. Call it again with the
 * person's answer to finish. The two outcomes are not interchangeable — see
 * `@lc/core/preorders.ts` for what each one costs when guessed — and this is the
 * same "a duplicate is a question, not a refusal" ruling applied to a second case.
 *
 * ⚠️ **The question is raised before the first write, never between two of them.**
 * The early return sits after the match and before `createWork`, so a prompt
 * nobody answers leaves the catalog exactly as it was. Answering re-runs this
 * function from the top: the match is idempotent — a work that matched once
 * matches again, so nothing is created twice — and a second `GET /works/match` is
 * cheaper than carrying half-written state across a button press.
 */
export async function addLineToCatalog(
  line: ScanLine,
  answer?: PreorderAnswer,
): Promise<AddOutcome> {
  /*
   * ⚠️ The duplicate case — a book we already hold, scanned again on purpose.
   *
   * The line already names the work, so there is nothing to match and nothing
   * to create: this is the *second copy* path, and it deliberately runs through
   * this same function rather than a shortcut beside it. The header explains
   * why, and it is not hypothetical — the whole reason a duplicate used to be a
   * dead end is that "already yours" had no route into the code that adds
   * things.
   *
   * No edition is written here either, and that is not laziness. A `owned`
   * barcode line got its state from an edition row that *already exists* with
   * that ISBN, so creating one would be a duplicate printing; a `owned` spine
   * line matched on title and author and has no ISBN to write. Migration 0001
   * makes `copy.edition_id` nullable for exactly this — "a copy can exist
   * before its exact printing is known".
   */
  if (line.existingWorkId !== null) {
    if (!answer) {
      const question = await preorderQuestionFor(line.existingWorkId, line.existingTitle);
      if (question) return { status: 'ask-preorder', question };
    }
    return {
      status: 'added',
      added: {
        workId: line.existingWorkId,
        attachedTo: line.existingTitle,
        preorderArrived: await recordArrival(line.existingWorkId, answer),
      },
    };
  }

  /*
   * ⚠️ `proposedTitle` / `proposedAuthors`, not `resolvedTitle ?? text`.
   *
   * The naive fallback treats a barcode line's `text` as a title, and a barcode
   * line's text is the *code* — so a board book whose ISBN resolved to nothing
   * would have been filed under "9780241361221" rather than refused. The
   * predicates live in `@lc/core` because the review screen gates its Add
   * button on the same question, and a button that offers what this function
   * then throws on is worse than either.
   */
  const title = proposedTitle(line);
  const authors = proposedAuthors(line);
  if (!title || !authors) {
    throw new Error('Type in the title and author first — nothing found this book for us.');
  }

  const existing = await api.matchWork(title, authors);

  /*
   * ⚠️ Asked HERE — after the match, before the first write.
   *
   * Only a work that already exists can have a pre-order against it, so the
   * `existing.work` branch is the only one that can ask, and a genuinely new book
   * pays nothing for this feature. Placed above `createWork` on purpose: the
   * question must never leave a half-added book behind if it goes unanswered.
   *
   * This is also the branch the arriving pre-orders in production will actually
   * come through. A pre-ordered hardcover has a *different* ISBN from any printing
   * on file, so `findEditionByIsbn13` misses and the line never reaches the review
   * screen as `owned` — it resolves through Open Library and matches on the work
   * key instead, exactly as the paperback-of-an-ebook case does.
   */
  if (existing.work && !answer) {
    const question = await preorderQuestionFor(existing.work.id, existing.work.title);
    if (question) return { status: 'ask-preorder', question };
  }

  /*
   * The cover rides along with the work, not only with the edition.
   *
   * ⚠️ This line used to create the work from `{ title, authors }` alone while
   * the edition below took `line.coverUrl`. Both statements looked right in
   * isolation, and the effect was invisible in code review: every list in the
   * app renders `work.cover_url`, so a barcode scan produced a book with a
   * perfectly good cover URL stored one table away and a blank tile on screen.
   * Measured before the fix — 143 editions carried 20 covers, and all 20
   * belonged to works showing none.
   */
  const work =
    existing.work ??
    (
      await api.createWork({
        title,
        authors,
        coverUrl: line.coverUrl ?? undefined,
        firstPublished: line.publishedYear ?? undefined,
      })
    ).work;

  // Attaching to a book we already hold is the ordinary case, and the scan may
  // be carrying the cover the existing row never got. Fill a gap, never
  // overwrite: a cover already on file was chosen deliberately or came from the
  // audiobook catalog, and a barcode is not a reason to replace it.
  if (existing.work && !existing.work.coverUrl && line.coverUrl) {
    await api.updateWork(work.id, { coverUrl: line.coverUrl });
  }

  /*
   * An edition, but only when there is something to say about one.
   *
   * A barcode gives an ISBN and a printing, so it earns a paperback edition. A
   * spine read gives neither: the format is a guess from the shape of the book
   * and the ISBN is unknown. Writing `format: 'paperback'` anyway would put an
   * invented fact in the column that `PHYSICAL_FORMATS` filters on — so a spine
   * with no resolved ISBN adds the work and the copy, and leaves the edition to
   * whoever later scans its barcode.
   *
   * ⚠️ **`paperback` here is a guess, and it is wrong often enough to be
   * reported from the shelf.** A barcode proves a printing exists and does not
   * say which one; a hardcover scanned off its own barcode lands here as a
   * paperback. That is still the right default — it is the commoner printing and
   * the alternative is interrupting every scan with a question — but it is only
   * defensible because it is now correctable. The fix is the Editions panel on
   * the book page (`components/Editions.tsx` → `PATCH /api/editions/:id`), which
   * did not exist when this line was written and is why the guess was, in
   * practice, permanent. If this ever stops being a one-tap correction, ask at
   * scan time instead.
   */
  if (line.isbn13) {
    await api.createEdition({
      workId: work.id,
      isbn13: line.isbn13,
      format: 'paperback',
      publisher: line.publisher ?? null,
      publishedYear: line.publishedYear ?? null,
      coverUrl: line.coverUrl ?? null,
      source: 'openlibrary',
    });
  }

  // A copy, because a person scanning a barcode or photographing a shelf is
  // looking at the book. This is the one place that inference is safe — unlike
  // the ebook importer, where a file existing says nothing about a shelf.
  const preorderArrived = await recordArrival(work.id, answer);

  return {
    status: 'added',
    added: {
      workId: work.id,
      attachedTo: existing.work ? work.title : null,
      preorderArrived,
    },
  };
}

/**
 * The book is in the person's hands. Say so, in whichever of the two ways is true.
 *
 * ⚠️ **`arrived` is a PATCH of the row that already exists, never a new copy plus
 * a tidy-up.** `updateCopy` in `@lc/db` spells out what a delete-and-recreate
 * would throw away — when it was ordered, what was paid, which shop, and the
 * `created_at` that makes "how long was this on the way" answerable — and
 * `arrivedPatch` is the one spelling of that transition, shared with the arrivals
 * checklist and the copies panel. A third spelling here is exactly the mistake
 * `STATUS_LABEL` exists to record.
 *
 * ⚠️ The arriving copy is **not** repointed at any edition created above. A
 * pre-ordered copy usually already names its printing — that is how the three
 * *Worlds Beyond Number* variant covers are told apart — and overwriting that with
 * the `paperback` an ISBN scan guesses would destroy better information than it
 * writes. The Editions panel is where a printing gets corrected.
 *
 * Returns whether a pre-order was received, so the caller can say the right thing.
 */
async function recordArrival(workId: number, answer: PreorderAnswer | undefined): Promise<boolean> {
  if (answer?.kind === 'arrived') {
    await api.updateCopy(answer.copyId, arrivedPatch(answer.acquiredOn));
    return true;
  }
  await api.createCopy({ workId, status: 'owned' });
  return false;
}
