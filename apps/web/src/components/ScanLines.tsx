import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MIN_SPINE_SIMILARITY,
  isAddable,
  lookupProgress,
  needsLookup,
  outstandingCount,
  overlapSentence,
  proposedTitle,
  searchText,
  type PreorderAnswer,
  type RescanAnswer,
  type ScanJob,
  type ScanLine,
  type ScanStatus,
} from '@lc/core';
import { api } from '../api.js';
import { addLineToCatalog } from '../lib/catalog-add.js';
import type { PreorderQuestion } from '../lib/preorders.js';
import type { IsbnConflict, RescanQuestion } from '../lib/rescans.js';
import { Link, workPath } from '../router.js';
import { PreorderPrompt } from './PreorderPrompt.js';
import { IsbnTakenPrompt, RescanPrompt } from './RescanPrompt.js';

/**
 * The review list — one row per book a sweep found, and the only place a book
 * gets into the catalog from a scan.
 *
 * ## ⚠️ Every row is a proposal, and the row says which kind
 *
 * A barcode row and a spine row look almost the same and are worth very
 * different amounts of trust, so the difference is on the row rather than in a
 * heading: a barcode carries its ISBN, a spine carries what was printed on it
 * plus how sure the read was. Phase 0 measured a wrong ISBN resolving to a
 * confident, well-formed, wrong book — three of ten — and a spine is weaker
 * evidence than an ISBN. Nothing here is ticked in advance and nothing is
 * added without a tap.
 *
 * ## ⚠️ The first lookup happens on its own
 *
 * This screen drives the automatic first pass, and that is why it polls. The
 * server does one chunk per invocation and parks the job at `read`; this
 * component notices there is more to do and asks for the next one. Ported from
 * the sibling Board Game Catalog, down to the shape of the guard:
 *
 * - **keyed on `${id}:${done}`, not on the id.** Each distinct point of
 *   progress is asked for exactly once, so a chunk that advances triggers the
 *   next and a chunk that advances nothing stops rather than spinning.
 * - **progress, not a spinner.** "5 of 14 looked up" is the difference between
 *   working and the stall that used to look identical to it.
 * - the manual lookup button **stays**, as the repair bench. Automatic asks
 *   with the words the camera read; a person asks with the right ones.
 *
 * ## ⚠️ A weak match is shown, not hidden
 *
 * Below `MIN_SPINE_SIMILARITY` the row is marked "loose match" and still
 * offered. Dropping it would be tidier and worse: the book is visibly on the
 * shelf, and a false negative costs a tap while a false positive costs a wrong
 * book in the catalog wearing someone else's cover. Nothing about the lookup
 * becoming automatic changed this — an automatic proposal is still a proposal.
 *
 * ## ⚠️ A duplicate is a question, not a refusal
 *
 * A row that matched something we already hold used to render **no buttons at
 * all** — "Already yours", full stop. The owner's complaint: *"it is up to the
 * end user to deal with duplicates, not just the system, because currently we
 * have to leave the scan page, find the book, and add a second copy instead of
 * using the already-built features."* Owning one copy and buying a second is
 * ordinary, and the scan is how you would say so. So the row now names the book
 * it matched, links to it, and offers a second owned copy inline — one tap on a
 * button that says what it does, never automatically.
 *
 * ## ⚠️ A pre-order on file is a THIRD reason to stop, and the only one that BLOCKS
 *
 * The owner again, in the same shape as the duplicate ask: *"if I add a book
 * that's in pre-order status there is a prompt asking me if this is the received
 * pre-order or different."* Unlike the two prompts above it is not a warning with
 * the ordinary buttons underneath — **both answers write, and they write different
 * rows** — so it replaces the buttons until it is answered. Nothing has been
 * written when it appears; see `addLineToCatalog`, which returns the question
 * instead of a work. `@lc/core/preorders.ts` carries what guessing either way
 * costs, and `PreorderPrompt.tsx` why there is no way to dismiss it.
 *
 * ## ⚠️ An overlap raises the SAME prompt, for a different reason
 *
 * A book can be already-yours in a second way: you hold the omnibus, and this is
 * one of the volumes printed inside it. That is not a duplicate — no object on
 * the shelf is this object — and it is not a reason to refuse the add, because
 * owning volume 1 *and* the omnibus is a choice people make on purpose. It is a
 * reason to **say so while the person is deciding**, which is the whole
 * difference between this and a report they read afterwards.
 *
 * So it renders inside the same block as the duplicate prompt and above the same
 * buttons. `line.overlap` is filled by the scan routes from
 * `work_relation.contains`; `overlapSentence` in `@lc/core` is the wording, kept
 * beside the rule so the two cannot drift.
 *
 * ## ⚠️ The rule the last three fixes all come from
 *
 * **What a row offers follows what the row needs, not how the row arrived.**
 * Three separate dead ends were all the same defect wearing different clothes —
 * an already-owned book, an unresolved board book, and a shop barcode each
 * rendered a row with no buttons on it, because the gates asked `via === 'spine'`
 * and `state === 'found'` instead of asking what was missing. The system having
 * no answer is never a reason for the person to have no options. `isAddable`,
 * `searchText` and `proposedTitle` in `@lc/core` are that rule made explicit,
 * and the review screen and `catalog-add.ts` both read them so a button can
 * never offer something the add path then refuses.
 */

/** Slow enough not to be a nuisance, fast enough that a shelf read feels live. */
const POLL_MS = 2500;

/**
 * Statuses that still change with nobody touching anything.
 *
 * ⚠️ `read` is deliberately **not** here. It means "lines exist, not all looked
 * up" — a pass has paused between chunks — and the thing that moves it on is
 * this component asking, not time passing. Polling it would burn a request
 * every 2.5s on a job that is waiting for us.
 */
const IN_FLIGHT: ReadonlySet<ScanStatus> = new Set(['uploaded', 'reading', 'enriching']);

function Similarity({ line }: { line: ScanLine }) {
  if (line.similarity === null) return null;
  const loose = line.similarity < MIN_SPINE_SIMILARITY;
  return (
    <span className={loose ? 'mark mark--gap' : 'mark'} style={{ position: 'static' }}>
      {loose ? 'loose match' : 'close match'} {line.similarity.toFixed(2)}
    </span>
  );
}

function LineRow({
  line,
  index,
  jobId,
  onJob,
  awaiting,
}: {
  line: ScanLine;
  index: number;
  jobId: number;
  onJob: (job: ScanJob) => void;
  /** The automatic pass owns this line right now. Its buttons would race it. */
  awaiting: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // ⚠️ `proposedTitle`, not `line.text` — a barcode line's text is the code,
  // and pre-filling the title box with "9780241361221" invites somebody to
  // catalog a book by that name.
  const [draft, setDraft] = useState(proposedTitle(line) ?? '');
  const [draftAuthor, setDraftAuthor] = useState(line.author ?? '');
  /**
   * The pre-order question, raised by an Add that found one and wrote nothing.
   *
   * ⚠️ Row state rather than page state, and it has to be: a sweep can hold two
   * books that each have a pre-order on file, and a single shared prompt would
   * answer for whichever row was tapped last.
   */
  const [preorder, setPreorder] = useState<PreorderQuestion | null>(null);
  /**
   * The rescan question — a barcode the catalog has never seen, on a book it
   * already holds. Row state for the reason `preorder` is: two rows can each
   * be asking, and a shared prompt would answer for whichever was tapped last.
   */
  const [rescanQ, setRescanQ] = useState<RescanQuestion | null>(null);
  /**
   * The rescan answer already given — carried so the pre-order prompt's
   * answer re-runs the SAME add ("a second copy of that edition" must not
   * degrade to the ordinary attach when the person then says which pre-order
   * arrived). Same reasoning as `authorless` below.
   */
  const [rescanAnswer, setRescanAnswer] = useState<RescanAnswer | null>(null);
  /** The UNIQUE index refusal, dressed as the choice it actually is. */
  const [conflict, setConflict] = useState<IsbnConflict | null>(null);
  /** Said after the fact, because "Copy added" would be the wrong sentence. */
  const [arrived, setArrived] = useState(false);
  /** What a rescan answer wrote — "ISBN recorded" — for the result chip. */
  const [summary, setSummary] = useState<string | null>(null);
  /**
   * The person pressed "Add without an author" — carried as state so the
   * pre-order prompt's answer re-runs the SAME add, not the ordinary one
   * (which would refuse for the missing author it was deliberately skipping).
   */
  const [authorless, setAuthorless] = useState(false);

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Add this row — or discover that it needs a question answered first.
   *
   * ⚠️ Still ONE path for every kind of row, including the duplicate and the
   * arriving pre-order. See `catalog-add.ts`: a line that already names a work
   * adds a second copy to it rather than matching or creating anything, and a
   * work with a pre-order on file comes back as a question with **nothing
   * written**. `answer` is that question coming back; the second call runs the
   * same function from the top.
   */
  const add = (
    answer?: PreorderAnswer,
    withoutAuthor = authorless,
    rescan: RescanAnswer | undefined = rescanAnswer ?? undefined,
  ) =>
    run('add', async () => {
      setAuthorless(withoutAuthor);
      if (rescan) setRescanAnswer(rescan);
      const outcome = await addLineToCatalog(line, answer, { withoutAuthor, rescan });
      if (outcome.status === 'ask-rescan') {
        // Nothing was written. The rescan question comes FIRST — it decides
        // which rows exist at all; the pre-order question is asked afterwards
        // by the answers that write a copy.
        setRescanQ(outcome.question);
        return;
      }
      if (outcome.status === 'ask-preorder') {
        // Nothing was written, so nothing is recorded on the line either. The
        // row now shows the prompt in place of its buttons.
        setRescanQ(null);
        setPreorder(outcome.question);
        return;
      }
      if (outcome.status === 'ask-isbn-taken') {
        // The UNIQUE index refused the fill and named the row that holds the
        // ISBN. Still nothing written; the person chooses the slipcase
        // treatment or walks away.
        setRescanQ(null);
        setPreorder(null);
        setConflict(outcome.conflict);
        return;
      }
      setPreorder(null);
      setRescanQ(null);
      setConflict(null);
      setRescanAnswer(null);
      setArrived(outcome.added.preorderArrived);
      setSummary(outcome.added.summary);
      // Recorded on the line only after the catalog write succeeded. The other
      // order would mark a book added that is not in the catalog.
      onJob((await api.patchScanLine(jobId, index, { addedWorkId: outcome.added.workId })).job);
    });

  /** Walk away from a question that has written nothing. The row's buttons return. */
  const dropQuestions = () => {
    setRescanQ(null);
    setConflict(null);
    setRescanAnswer(null);
  };

  const lookup = (q?: string) =>
    run('lookup', async () => {
      onJob((await api.lookupScanLine(jobId, index, q)).job);
      setEditing(false);
    });

  const dismiss = () =>
    run('dismiss', async () => {
      onJob((await api.patchScanLine(jobId, index, { dismissed: !line.dismissed })).job);
    });

  const saveEdit = () =>
    run('edit', async () => {
      const patched = await api.patchScanLine(jobId, index, {
        text: draft.trim(),
        author: draftAuthor.trim() || null,
      });
      onJob(patched.job);
      // Correcting the read is only ever the first half of the intent — the
      // reason to retype a spine is to ask again with the right words.
      onJob((await api.lookupScanLine(jobId, index, draft.trim())).job);
      setEditing(false);
    });

  const settled = line.addedWorkId !== null || line.dismissed;
  const owned = line.state === 'owned';
  /*
   * ⚠️ **An overlap is a second REASON to raise the duplicate prompt, not a
   * second prompt.**
   *
   * The row already knows how to say "here is what you have — add it, or leave
   * it", and an omnibus is the other way that sentence becomes true: you own the
   * *text* without owning *this object*. So this renders inside the same block,
   * above the same buttons, and changes nothing about what they do.
   *
   * ⚠️ It must not block, and it does not. The owner's position all session:
   * *tell me, then let me decide*. They own volume 1 and the omnibus deliberately
   * in some cases, and a feature that refused that would be worse than the report
   * it replaces.
   *
   * `overlap` is optional on the wire — jobs written before the field existed
   * have no key for it — so this is `?? []` rather than a non-null assertion.
   */
  const overlaps = line.overlap ?? [];
  const overlapNote = overlapSentence(overlaps);
  /*
   * ⚠️ The gating rule, in three lines, and it is the fix for two separate
   * complaints: **what a row offers follows what the row needs, never how the
   * row arrived.** Gating on `via` and on `state === 'found'` is what made an
   * already-owned book and an unresolved board book both render zero buttons —
   * the system had no answer, so the person was given no options.
   */
  const addable = isAddable(line);
  const canSearch = !line.dismissed && searchText(line) !== null;
  const canType = !line.dismissed && line.state !== 'skipped';

  return (
    <li className={settled ? 'muted' : undefined}>
      {line.coverUrl ? (
        <img src={line.coverUrl} alt="" width={44} height={66} loading="lazy" />
      ) : (
        <span className="scan-line__blank" aria-hidden="true" />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* What the sweep actually read. Kept visible even after a lookup
            succeeded: "the spine said X, the database says Y" is the whole
            judgement being asked for, and hiding half of it makes the row
            impossible to check. */}
        <div className="muted small">
          #{line.position} · {line.via === 'barcode' ? line.code : `“${line.text}”`}
          {line.author ? ` · ${line.author}` : ''}
          {line.confidence ? ` · ${line.confidence} confidence` : ''}
        </div>

        {owned && (
          <>
            <strong>Already in the library{line.existingTitle ? `: ${line.existingTitle}` : ''}</strong>
            {line.existingWorkId !== null && (
              <div className="small">
                <Link to={workPath(line.existingWorkId)}>Open it</Link>
              </div>
            )}
            {/* Says what the buttons are for. Without it "Another copy" beside
                "Already in the library" reads as an offer to duplicate the
                *record*, which is the opposite of what it does. */}
            {!settled && (
              <div className="muted small">
                Scanned again — add a second owned copy if you have two, or leave it.
              </div>
            )}
          </>
        )}

        {line.state === 'found' && (
          <>
            <strong>{line.resolvedTitle}</strong>
            <div className="muted small">{line.resolvedAuthors}</div>
            <div className="muted small">
              {[line.publisher, line.publishedYear, line.isbn13].filter(Boolean).join(' · ')}
            </div>
            <div className="row-tight">
              <Similarity line={line} />
              {line.relookedUpAs && (
                <span className="muted small">asked as “{line.relookedUpAs}”</span>
              )}
            </div>
          </>
        )}

        {/* ⚠️ `proposedTitle` first, so a barcode row that somebody has just
            typed a title into shows the title rather than continuing to show
            the code back at them. Falls through to the code when nobody has
            said what the book is, which is the honest thing to show. */}
        {!owned && line.state !== 'found' && (
          <strong>{proposedTitle(line) ?? line.code ?? line.text}</strong>
        )}

        {/*
          ⚠️ Below the identification and above the buttons, on purpose, and on
          BOTH kinds of row — a book can be an overlap without being a duplicate
          (the omnibus is on the shelf, this volume is not) and can be both at
          once (you own the volume separately *and* inside the omnibus).

          It names the book and stops. No verdict, no default, and the buttons
          below are the ones that were already there: "Add" / "Not wanted" on a
          new book, "Add 2nd copy" / "Leave it" on one we hold.
        */}
        {overlapNote && !settled && (
          <div className="stack" style={{ gap: '0.15rem', marginTop: '0.25rem' }}>
            <div>
              <span className="mark mark--gap" style={{ position: 'static' }}>
                also inside something you own
              </span>
            </div>
            <strong>{overlapNote}</strong>
            <div className="muted small">
              {/* The one thing the person needs to know to decide, and the
                  reason this is not a refusal: owning both is a real choice
                  somebody makes on purpose. */}
              Some books are worth having both ways. Add it if you want it separately, or
              leave it.
            </div>
            {overlaps.map((o) => (
              <div className="small" key={o.workId}>
                <Link to={workPath(o.workId)}>Open {o.title}</Link>
              </div>
            ))}
          </div>
        )}

        {/*
          ⚠️ Raised by pressing Add, not by the row arriving, and the difference
          is deliberate. It costs a request to find out whether a book has a
          pre-order, and asking that of fifteen rows on a shelf sweep would spend
          fifteen requests to warn about none. It is asked once, of the one book
          somebody has just said they are adding — and at that moment nothing has
          been written, so the two answers are still both available.
        */}
        {preorder && !settled && (
          <PreorderPrompt
            question={preorder}
            busy={busy !== null}
            onAnswer={(answer) => void add(answer)}
          />
        )}

        {/*
          ⚠️ Raised the same way the pre-order prompt is — by pressing Add, with
          nothing written — and for the same kind of reason: a barcode the
          catalog has never seen, on a book it already holds, is FOUR different
          facts and only the person holding the object knows which. The silent
          answer used to be "new edition + new copy", which is how a rescan of
          an ISBN-less printing minted a duplicate instead of filling the blank.
        */}
        {rescanQ && !preorder && !conflict && !settled && (
          <RescanPrompt
            question={rescanQ}
            busy={busy !== null}
            onAnswer={(rescan) => void add(undefined, authorless, rescan)}
            onDismiss={dropQuestions}
          />
        )}

        {/* The UNIQUE-index refusal, offered as the slipcase treatment rather
            than surfaced as a constraint violation. Realmkeeper: one omnibus
            volume, one barcode, two catalog rows. */}
        {conflict && !settled && (
          <IsbnTakenPrompt
            conflict={conflict}
            busy={busy !== null}
            onAnswer={(rescan) => void add(undefined, authorless, rescan)}
            onDismiss={dropQuestions}
          />
        )}

        {/* While the pass owns this line, its `detail` is the *previous*
            answer — or the placeholder written when the photo was read — and
            showing it beside "Looking up…" says two contradictory things. */}
        {line.detail && !awaiting && <div className="muted small">{line.detail}</div>}
        {line.note && <div className="muted small">Read: {line.note}</div>}
        {error && <div className="muted small">{error}</div>}

        {editing && (
          <div className="row" style={{ marginTop: '0.4rem' }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Title as printed"
              placeholder="Title"
            />
            <input
              value={draftAuthor}
              onChange={(e) => setDraftAuthor(e.target.value)}
              aria-label="Author as printed"
              placeholder="Author"
            />
            <button onClick={() => void saveEdit()} disabled={busy !== null || !draft.trim()}>
              {busy === 'edit' ? 'Asking…' : 'Save and look up'}
            </button>
          </div>
        )}
      </div>

      <div className="row-tight" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {line.addedWorkId !== null ? (
          <Link to={workPath(line.addedWorkId)} className="chip">
            {/* ⚠️ Each outcome gets its own words. "Copy added" over a received
                pre-order would report the very thing the prompt was asked to
                prevent — a second copy — and "Added" over an ISBN fill would
                claim a row was created when the whole point was that none was.
                `summary` is the rescan outcomes saying what they wrote. */}
            {arrived ? 'Pre-order received' : (summary ?? (owned ? 'Copy added' : 'Added'))}
          </Link>
        ) : preorder || rescanQ || conflict ? (
          /* The prompt above is the row's only control while it is up. Leaving
             Add beside it would offer a third answer to a two-answer question,
             and pressing it would simply raise the same prompt again. */
          <span className="muted small">Answer above</span>
        ) : awaiting ? (
          /* The automatic pass has this row. No buttons: every one of them
             would race a write that is already in flight, and the answer is
             seconds away. `aria-live` so a screen reader hears it land. */
          <span className="muted small" aria-live="polite">
            Looking up…
          </span>
        ) : (
          <>
            {/* Search when there is something to search *with*.
                ⚠️ Not `via === 'spine'`, which is what this used to say. A
                barcode's ladder has run, so re-asking with the code is the same
                question — but the instant somebody types a title into the row,
                a title search is a completely new question and the button has
                to be there. `searchText` is null in the first case and not in
                the second, which is the whole distinction. */}
            {canSearch && (
              <button onClick={() => void lookup()} disabled={busy !== null}>
                {busy === 'lookup' ? 'Looking…' : line.state === 'found' ? 'Again' : 'Look up'}
              </button>
            )}

            {/* ⚠️ Every row, not just a spine. Typing the book in is the
                universal escape hatch, and withholding it from barcode rows is
                what made an unresolved board book a dead end — no title, no way
                to give it one, no way to add it. The scanned ISBN survives the
                edit; see `unresolve` in the route. */}
            {canType && (
              <button onClick={() => setEditing((v) => !v)} disabled={busy !== null}>
                {editing ? 'Cancel' : line.state === 'found' || owned ? 'Edit' : 'Type it in'}
              </button>
            )}

            {/* ⚠️ ONE tap, and the label carries the whole confirmation.
                This was a two-step confirm until it became clear the thing it
                was guarding against cannot happen: the route already refuses a
                second line for a code the job holds ("one code is one line,
                whatever arrives"), so an `owned` row never means "you waved the
                same book past the lens twice" — it means the *catalog* already
                has this book. A button that says what it does is deliberate
                enough, and a confirm step on top of it is one more thing to tap
                through on a screen whose entire complaint was too many taps. */}
            {owned && addable && (
              <button onClick={() => void add()} disabled={busy !== null}>
                {busy === 'add' ? 'Adding…' : 'Add 2nd copy'}
              </button>
            )}

            {/* ⚠️ `isAddable`, not `state === 'found'`. The old gate meant "only
                books a service recognised", which is exactly the set that
                excludes a board book. A row with a title and an author is
                addable however it got them — including from the keyboard. */}
            {!owned && addable && (
              <button
                className="primary"
                onClick={() => void add(undefined, false)}
                disabled={busy !== null}
              >
                {busy === 'add' ? 'Adding…' : 'Add'}
              </button>
            )}

            {/* ⚠️ The deliberate second action (design §3.4.4): a row with a
                title and NO author is not a dead end, but authorless must
                never be the default — the button says on it what it does.
                The book lands flagged (Needs → Author) and its reviews stay
                held until the author arrives; adding it later is always safe
                by construction. */}
            {!owned && !addable && proposedTitle(line) !== null && !line.dismissed && (
              <button onClick={() => void add(undefined, true)} disabled={busy !== null}>
                {busy === 'add' ? 'Adding…' : 'Add without an author'}
              </button>
            )}

            {/* Leaving a row alone has to stay one tap, or a sweep full of books
                you already own is worse than no sweep at all. */}
            {line.state !== 'skipped' && (
              <button onClick={() => void dismiss()} disabled={busy !== null}>
                {line.dismissed ? 'Undo' : owned ? 'Leave it' : 'Not wanted'}
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function ScanLines({
  job,
  onJob,
  empty,
}: {
  job: ScanJob;
  onJob: (job: ScanJob) => void;
  /** What to say when the sweep has found nothing yet. Differs per tab. */
  empty: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const progress = lookupProgress(job.lines);
  const working = IN_FLIGHT.has(job.status);
  const stalled = !working && progress.done < progress.total;

  /*
   * Poll while the server is doing something. Only while — an idle job costs
   * nothing, and a dropped poll is not worth an error box because the next one
   * is 2.5 seconds away.
   *
   * ⚠️ `onJob` here is the same setter every row's buttons use, so a poll
   * landing mid-action shows the server's view for a moment and the action's
   * own response corrects it. Both converge on the same row; neither writes.
   */
  useEffect(() => {
    if (!working) return;
    const id = job.id;
    const timer = setInterval(() => {
      void api
        .scanJob(id)
        .then((r) => onJob(r.job))
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [job.id, working, onJob]);

  /**
   * Ask for the next chunk, automatically, until the sweep is looked up.
   *
   * ⚠️ Keyed on `${id}:${done}` rather than on the id, and that key is the
   * whole safety of it: each distinct point of progress is asked for exactly
   * once, so a chunk that advances triggers the next one and a chunk that
   * advances nothing stops rather than spinning. Open Library being down
   * therefore costs one wasted chunk, not an infinite retry loop.
   *
   * Not gated on `status === 'read'`, on purpose: a sweep created before this
   * feature existed sits at `review` with lines nobody ever looked up, and
   * reopening it should finish the job rather than make a person press
   * fourteen buttons.
   */
  const attempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (working || job.status === 'done' || job.status === 'failed') return;
    if (progress.done >= progress.total) return;
    const key = `${job.id}:${progress.done}`;
    if (attempted.current.has(key)) return;
    attempted.current.add(key);
    void api
      .enrichScanJob(job.id)
      .then((r) => onJob(r.job))
      .catch(() => undefined);
  }, [job.id, job.status, working, progress.done, progress.total, onJob]);

  /**
   * "Try that again."
   *
   * Deliberately does **not** clear the attempted keys. It bypasses the guard
   * by calling directly, so one press is one attempt: if it advances, the
   * effect picks the chain back up at the new progress point; if it does not,
   * nothing fires on its own and the button is still here.
   */
  const [retrying, setRetrying] = useState(false);
  const retry = useCallback(async () => {
    setRetrying(true);
    setError(null);
    try {
      onJob((await api.enrichScanJob(job.id)).job);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  }, [job.id, onJob]);

  if (job.lines.length === 0) {
    return <p className="muted small">{working ? 'Reading…' : empty}</p>;
  }

  const left = outstandingCount(job.lines);

  return (
    <>
      <p className="muted small">
        {job.lines.length} {job.lines.length === 1 ? 'book' : 'books'} ·{' '}
        {left === 0 ? 'all sorted' : `${left} still to sort`}
        {/* Progress, not a spinner. A shelf arrives over several passes, and a
            number that moves is the difference between "working" and a stall
            that looks exactly like it. */}
        {progress.done < progress.total &&
          ` · ${working ? 'looking up' : 'looked up'} ${progress.done} of ${progress.total}`}
      </p>

      {stalled && (
        <p className="row-tight">
          <button onClick={() => void retry()} disabled={retrying}>
            {retrying ? 'Asking…' : `Look up the remaining ${progress.total - progress.done}`}
          </button>
        </p>
      )}
      {error && <p className="notice notice--bad">{error}</p>}

      <ul className="works scan-lines">
        {/*
         * Newest first. A sweep appends, so the book just scanned landed at the
         * end of the array and sat below the fold — exactly the one you want to
         * confirm while it is still in your hand. An automatic first pass makes
         * this more important, not less: rows now fill themselves in, and the
         * one worth watching is the one that just arrived.
         *
         * ⚠️ Pair the position BEFORE reversing. `index` is the array offset the
         * server patches (`patchScanLine`/`lookupScanLine` take it verbatim), so
         * a display-order index would confirm, rename or dismiss a different
         * book than the row you tapped. `.map()` builds a new array, so the
         * `.reverse()` below mutates that copy and never `job.lines` itself.
         * A duplicate accepted with `allowDuplicate` is appended to the end,
         * which means it lands at the TOP here — which is what you want.
         */}
        {job.lines
          .map((line, i) => ({ line, i }))
          .reverse()
          .map(({ line, i }) => (
            <LineRow
              key={`${line.via}-${line.code ?? line.text}-${i}`}
              line={line}
              index={i}
              jobId={job.id}
              onJob={onJob}
              awaiting={working && needsLookup(line)}
            />
          ))}
      </ul>
    </>
  );
}
