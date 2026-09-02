import {
  appendSharedIsbnNote,
  proposedAuthors,
  proposedTitle,
  workCreateFrom,
  type EditionFormat,
  type PreorderAnswer,
  type RescanAnswer,
  type ScanLine,
} from '@lc/core';
import { api } from '../api.js';
import { DEFAULT_SCAN_FORMAT } from './scan-format.js';
import { arrivedPatch } from './statuses.js';
import { preorderQuestionFor, type PreorderQuestion } from './preorders.js';
import {
  isbnTakenFrom,
  rescanQuestionFor,
  type IsbnConflict,
  type RescanQuestion,
} from './rescans.js';

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
  /**
   * What a rescan answer actually wrote, when it was not a plain add — "ISBN
   * recorded", "Copy + ISBN recorded". Null for the ordinary outcomes, whose
   * words the row already knows. Same reasoning as `preorderArrived`: the row
   * must be able to say which thing happened, or the prompt taught nothing.
   */
  summary: string | null;
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
  | { status: 'ask-preorder'; question: PreorderQuestion }
  /**
   * The scanned barcode is not on file but the book is — the rescan question
   * (`@lc/core/rescan.ts`). Nothing written; call again with `opts.rescan`.
   */
  | { status: 'ask-rescan'; question: RescanQuestion }
  /**
   * A fill answer hit the catalog-wide UNIQUE index: another printing already
   * carries the ISBN. Not an error to surface raw — one physical volume can
   * be two catalog rows (the Realmkeeper set), and the person standing there
   * gets offered the slipcase treatment. Nothing was written.
   */
  | { status: 'ask-isbn-taken'; conflict: IsbnConflict };

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
  /**
   * ⚠️ `withoutAuthor` is the deliberate second action (design §3.4.4 —
   * migration 0120), never a fallback this function reaches for on its own.
   * The ordinary Add still requires title AND author; this flag is the person
   * having pressed a button that says on it what it does. The work is created
   * with `authors: null`, gets the provisional key, and lands in the
   * Needs→Author remediation queue by construction — the null IS the flag.
   */
  opts?: {
    withoutAuthor?: boolean;
    /**
     * ⚠️ The answer to a `ask-rescan` question, carried back on the re-run —
     * never synthesised. See `@lc/core/rescan.ts` for the four outcomes and
     * what guessing any of them costs.
     */
    rescan?: RescanAnswer;
    /**
     * ⚠️ The binding to write on any edition this add creates — the scan-time
     * toggle's value (Kiro's ask, `docs/TODO.md`, built 2026-09-02).
     *
     * Optional and defaulting to `paperback`, so every caller that predates the
     * toggle keeps exactly the behaviour it had. It is a PERSON'S assertion
     * about the object in their hands, which is why it beats the lookup's
     * opinion by default — `line.researchFormat` is shown beside it on the row
     * and is only ever applied by somebody tapping it.
     */
    format?: EditionFormat;
  },
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
        // ⚠️ The second copy is linked to the printing whose identifier
        // answered the scan (`existingEditionId`), because an `owned` barcode
        // line matched a specific edition and that fact is free right now.
        // 177 of 265 production copies have a NULL `edition_id`; this is the
        // moment those NULLs used to be minted. Null for a spine match, which
        // names a work and never a printing.
        preorderArrived: await recordArrival(
          line.existingWorkId,
          answer,
          line.existingEditionId ?? null,
        ),
        summary: null,
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
  // Null only down the deliberate path — a missing author is otherwise still
  // the refusal it always was.
  const authors = opts?.withoutAuthor ? null : proposedAuthors(line);
  if (!title || (!authors && !opts?.withoutAuthor)) {
    throw new Error('Type in the title and author first — nothing found this book for us.');
  }

  // A null author matches against the PROVISIONAL key server-side, so scanning
  // the same authorless board book twice attaches a copy instead of minting a
  // second provisional work. Two different authorless books with one title
  // will still collide here — that is the collision the real key exists to
  // prevent, and it is exactly why authorless is a flagged, temporary state.
  const existing = await api.matchWork(title, authors);
  const rescan = opts?.rescan;
  // ⚠️ Resolved ONCE, here, and passed down — never re-read per branch. Four
  // branches below can create an edition and they must all write the same
  // binding; a second `opts?.format ?? …` in one of them is how they drift.
  const format = opts?.format ?? DEFAULT_SCAN_FORMAT;

  /*
   * ⚠️ **A rescan is a question, not a second copy** — asked HERE, after the
   * match and before any write.
   *
   * A barcode line whose ISBN missed `findEditionByIsbn13` but whose book the
   * catalog holds used to fall straight through to `createEdition` +
   * `createCopy`: a new printing and a new copy, silently, every time. That is
   * backwards for the commonest reason the ISBN is missing — the printing is
   * already on file, recorded before anyone had the barcode (60+ crowdfunded
   * and slipcase rows carry exactly that promise in
   * `docs/isbn-barcode-worklist.md`). So the add stops and asks the four-way
   * question in `@lc/core/rescan.ts`, and `rescanQuestionFor` returning null —
   * a work with no physical presence, the paperback-of-an-ebook case — is what
   * keeps the ordinary attach free of a pointless tap.
   *
   * Same contract as the pre-order prompt below: nothing has been written when
   * the question comes back, and answering re-runs this function from the top.
   */
  if (existing.work && line.isbn13 && !rescan) {
    const question = await rescanQuestionFor(existing.work.id, existing.work.title, line.isbn13);
    if (question) return { status: 'ask-rescan', question };
  }

  /*
   * The rescan answers that repair or extend the EXISTING book. `different-book`
   * is deliberately not here — it falls through to `createWork` below with the
   * match ignored, which is all "a different book" means.
   */
  if (rescan && rescan.kind !== 'different-book' && line.isbn13) {
    if (!existing.work) {
      // The question named a book that no longer matches — an edit or a delete
      // raced the answer. Refuse loudly; re-adding re-asks against what is
      // there now.
      throw new Error('The book this question was about has changed — press Add again.');
    }
    return applyRescanAnswer(existing.work, line, line.isbn13, rescan, answer, format);
  }

  /** Attaching to the matched work, or creating one despite the match? */
  const attachWork = rescan?.kind === 'different-book' ? null : existing.work;

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
   * key instead, exactly as the paperback-of-an-ebook case does. (When the work
   * has physical rows the rescan question above fires first, and its copy-writing
   * answers ask this same question through `applyRescanAnswer`.)
   */
  if (attachWork && !answer) {
    const question = await preorderQuestionFor(attachWork.id, attachWork.title);
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
    attachWork ??
    (
      await api.createWork(workCreateFrom(line, title, authors))
    ).work;

  // Attaching to a book we already hold is the ordinary case, and the scan may
  // be carrying the cover the existing row never got. Fill a gap, never
  // overwrite: a cover already on file was chosen deliberately or came from the
  // audiobook catalog, and a barcode is not a reason to replace it.
  if (attachWork && !attachWork.coverUrl && line.coverUrl) {
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
  let editionId: number | null = null;
  if (line.isbn13) {
    editionId = (
      await api.createEdition(editionFromLine(work.id, line, line.isbn13, format))
    ).edition.id;
  }

  // A copy, because a person scanning a barcode or photographing a shelf is
  // looking at the book. This is the one place that inference is safe — unlike
  // the ebook importer, where a file existing says nothing about a shelf.
  // Linked to the edition just created, when one was: the scan proved the
  // printing, and an unlinked copy here is a NULL somebody has to repair later.
  const preorderArrived = await recordArrival(work.id, answer, editionId);

  return {
    status: 'added',
    added: {
      workId: work.id,
      attachedTo: attachWork ? work.title : null,
      preorderArrived,
      summary: null,
    },
  };
}

/**
 * The pre-order arriving, inside a rescan answer that writes no new copy.
 * Flip-or-nothing, where `recordArrival` is flip-or-create: a `fill` means
 * "the object was already counted", so `another` correctly writes no copy —
 * and `arrived` still must not leave the flip undone. The flipped copy keeps
 * whatever printing it already names, per the standing warning on
 * `recordArrival`.
 */
async function flipIfArrived(answer: PreorderAnswer | undefined): Promise<boolean> {
  if (answer?.kind !== 'arrived') return false;
  await api.updateCopy(answer.copyId, arrivedPatch(answer.acquiredOn));
  return true;
}

/**
 * The edition a barcode line earns, in one spelling.
 *
 * ⚠️ **`format` is now a PARAMETER, and that is the whole of Kiro's ask.** It
 * used to be the string `'paperback'` written here, five call sites deep, with a
 * comment saying the guess was defensible only because it was correctable
 * later. It is now the choice the person made on the scan-time toggle before
 * they started, defaulting to `paperback` when a caller does not say — so every
 * existing caller and every existing test keeps the behaviour it had.
 *
 * ⚠️ It defaults **here** as well as at the toggle, deliberately: five call
 * sites in this file reach this function, and a required parameter would have
 * turned "somebody forgot to thread it through" into a compile error today and
 * an `undefined` in a schema tomorrow. `DEFAULT_SCAN_FORMAT` is the one place
 * the word `paperback` is written.
 */
function editionFromLine(
  workId: number,
  line: ScanLine,
  isbn13: string,
  format: EditionFormat = DEFAULT_SCAN_FORMAT,
) {
  return {
    workId,
    isbn13,
    format,
    publisher: line.publisher ?? null,
    publishedYear: line.publishedYear ?? null,
    coverUrl: line.coverUrl ?? null,
    source: 'openlibrary',
  };
}

/**
 * Carry out a rescan answer against the book the question was about.
 *
 * ⚠️ **Ask-returns always precede the first write** in every branch, the same
 * ordering rule the pre-order prompt lives by: an unanswered question must
 * leave the catalog exactly as it was, and answering re-runs from the top.
 * The one deliberate partial: `extra-copy` still writes its copy when the
 * side-fill of the ISBN loses a race to another row — the copy is what the
 * person asserted, and the summary says what happened to the ISBN.
 */
async function applyRescanAnswer(
  work: { id: number; title: string },
  line: ScanLine,
  isbn13: string,
  rescan: Exclude<RescanAnswer, { kind: 'different-book' }>,
  answer: PreorderAnswer | undefined,
  /**
   * The scan-time toggle's binding, carried in rather than re-derived. Every
   * branch below that CREATES an edition writes it; the branches that fill an
   * ISBN onto a row somebody already recorded leave that row's own format
   * alone, because a person chose it and a toggle is not a reason to overwrite
   * a recorded value.
   */
  format: EditionFormat,
): Promise<AddOutcome> {
  const added = (summary: string | null, preorderArrived = false): AddOutcome => ({
    status: 'added',
    added: { workId: work.id, attachedTo: work.title, preorderArrived, summary },
  });
  const conflict = (editionId: number | null, holder: IsbnConflict['holder']): AddOutcome => ({
    status: 'ask-isbn-taken',
    conflict: { editionId, workId: work.id, attachedTo: work.title, isbn13, holder },
  });

  /*
   * ⚠️ The pre-order question composes with every answer except the note.
   *
   * The copy-writing answers need it for the reason the ordinary attach does.
   * `fill` needs it for a subtler one: the production pre-orders (the variant
   * covers, the campaign tiers) are recorded against ISBN-less printings —
   * exactly the rows `fill` targets — so "this is the printing on file" and
   * "this is the pre-order arriving" are usually BOTH true of the book in
   * hand. Filling without asking would record the ISBN and leave the copy
   * "on the way" forever, the phantom `@lc/core/preorders.ts` exists to
   * prevent. Asked before the first write, as always; `another` against a
   * `fill` writes no copy, because the object was already counted.
   */
  if (!answer && rescan.kind !== 'fill-note') {
    const question = await preorderQuestionFor(work.id, work.title);
    if (question) return { status: 'ask-preorder', question };
  }

  /*
   * "The book I already have." ⚠️ The owner's case, and the one that must work
   * flawlessly: the ISBN lands on the row that has none, the unlinked copy
   * learns its printing, and NOTHING is created — the object was already
   * counted. The slipcase volumes' blank ISBNs are deliberate, which is why
   * this only ever runs off a button that named the row.
   */
  if (rescan.kind === 'fill') {
    if (rescan.editionId !== null) {
      try {
        await api.updateEdition(rescan.editionId, { isbn13 });
      } catch (err) {
        const taken = isbnTakenFrom(err);
        if (taken) return conflict(rescan.editionId, taken.holder);
        throw err;
      }
      if (rescan.linkCopyId !== null) {
        await api.updateCopy(rescan.linkCopyId, { editionId: rescan.editionId });
      }
      return added('ISBN recorded', await flipIfArrived(answer));
    }

    // No printing row existed — a spine-added book. The scan is the moment
    // "which printing is this?" finally has an answer, so the row is created
    // and the copy linked. Still no new copy.
    let editionId: number;
    try {
      editionId = (
        await api.createEdition(editionFromLine(work.id, line, isbn13, format))
      ).edition.id;
    } catch (err) {
      const taken = isbnTakenFrom(err);
      if (taken) return conflict(null, taken.holder);
      throw err;
    }
    if (rescan.linkCopyId !== null) {
      await api.updateCopy(rescan.linkCopyId, { editionId });
    }
    return added('Printing recorded', await flipIfArrived(answer));
  }

  /*
   * The slipcase treatment, chosen by a person after the UNIQUE index said no:
   * the ISBN stays on the row that holds it, and the fact goes into THIS
   * row's `edition_name` — `edition` has no notes column; that lives on
   * `copy`. Fetched fresh so the note APPENDS to whatever the name says now.
   */
  if (rescan.kind === 'fill-note') {
    const detail = (await api.work(work.id)) as unknown as {
      editions?: { id: number; edition_name?: string | null }[];
    };
    const current = detail.editions?.find((e) => e.id === rescan.editionId);
    await api.updateEdition(rescan.editionId, {
      editionName: appendSharedIsbnNote(current?.edition_name ?? null, isbn13, rescan.holderTitle),
    });
    return added('Shared ISBN noted');
  }

  /* "A second copy of that edition." */
  if (rescan.kind === 'extra-copy') {
    let editionId = rescan.editionId;
    let summary = 'Copy added';

    if (editionId === null) {
      // Spine-added book, no printing row: the second copy brings one.
      try {
        editionId = (
        await api.createEdition(editionFromLine(work.id, line, isbn13, format))
      ).edition.id;
      } catch (err) {
        const taken = isbnTakenFrom(err);
        if (taken) return conflict(null, taken.holder);
        throw err;
      }
      summary = 'Copy + printing recorded';
    } else if (rescan.alsoFillIsbn) {
      // "This barcode is that edition, and I have two" — both facts recorded.
      // ⚠️ Losing the ISBN to a race does NOT lose the copy: the copy is the
      // assertion, the fill is the bonus, and the summary says which landed.
      try {
        await api.updateEdition(editionId, { isbn13 });
        summary = 'Copy + ISBN recorded';
      } catch (err) {
        if (!isbnTakenFrom(err)) throw err;
        summary = 'Copy added — ISBN already on another printing';
      }
    }

    const preorderArrived = await recordArrival(work.id, answer, editionId);
    return added(preorderArrived ? null : summary, preorderArrived);
  }

  /* "A different printing I own" — the #341 two-hardcovers case. */
  let editionId: number;
  try {
    editionId = (
      await api.createEdition(editionFromLine(work.id, line, isbn13, format))
    ).edition.id;
  } catch (err) {
    const taken = isbnTakenFrom(err);
    if (taken) {
      // A "new" printing wearing an ISBN another row already owns is not new —
      // it is that row. No note to offer here (there is no edition of ours to
      // note it on), so the refusal names the holder and stops.
      throw new Error(
        taken.holder?.title
          ? `That ISBN is already recorded on “${taken.holder.title}” — open that book and add the copy there.`
          : 'That ISBN is already recorded on another printing in the catalog.',
      );
    }
    throw err;
  }
  const preorderArrived = await recordArrival(work.id, answer, editionId);
  return added(preorderArrived ? null : 'New printing added', preorderArrived);
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
async function recordArrival(
  workId: number,
  answer: PreorderAnswer | undefined,
  /**
   * The printing the new copy is a copy OF, when the scan proved one — the
   * edition just created for this line, or the edition whose ISBN answered
   * the scan. Null when only the work is known (a spine line). ⚠️ Only the
   * `createCopy` branch reads it; the arriving pre-order keeps the edition it
   * already names, per the warning above.
   */
  editionId: number | null,
): Promise<boolean> {
  if (answer?.kind === 'arrived') {
    await api.updateCopy(answer.copyId, arrivedPatch(answer.acquiredOn));
    return true;
  }
  await api.createCopy({ workId, status: 'owned', editionId: editionId ?? undefined });
  return false;
}
