import { useEffect, useState } from 'react';
import { UNKNOWN_AUTHOR, workKeyFor } from '@lc/core';
import { ApiError, api } from '../api.js';
import { describeError } from '../lib/errors.js';
import { countReviewDocs, restampReviews } from '../lib/reviews.js';

/**
 * Edit title & author — the deliberately heavier surface.
 *
 * ## ⚠️ Why this panel is ceremonial where `WorkFields` is casual
 *
 * `work_key` derives from these two fields and is the join to ~870 audiobook
 * reviews in the shared Firestore store. Editing them moves the join, so the
 * move must CARRY the reviews or not happen — `docs/info/edit-and-audit-
 * design.md` §5 is the contract, and the server enforces its half on
 * `PATCH /api/works/:id` (409 unless the attestation is coherent). This
 * panel is the client half:
 *
 *  1. On open, the LIVE CHECK: the same two Firestore queries the review
 *     panel runs, keeping doc ids. Save stays disabled until it resolves —
 *     ⚠️ a failed check is never treated as zero. That is the silent-
 *     staleness trap wearing one more costume.
 *  2. On save, if the folded key moves: restamp the docs FIRST (Firestore),
 *     then PATCH with `keyMove`. Order is load-bearing — see
 *     `restampReviews`. A retitle that does not move the folded key
 *     ("gold" → "Gold") skips the ceremony; the key is the join, not the
 *     spelling.
 *
 * ## The provisional book — the light mode
 *
 * A book added without an author (authors null) can have NO reviews by
 * construction — `reviewDocFor` refuses the sentinel, so no document ever
 * carried its key. Filling the author in is always a free move: no check,
 * no ceremony, and the panel says so. This is the remediation path that
 * "Add without an author" promises.
 *
 * ## ⚠️ The known wart, accepted — not a bug
 *
 * After a retitle, a FUTURE review written from this side derives its doc id
 * from the new title and lands beside the person's old review as a sibling
 * (doc ids are `bookIdFromTitle(title)_{name}` and are never rewritten —
 * rewriting would delete-and-recreate other people's documents). Reading
 * stays correct — the ceremony restamps `workKey`, so both docs join this
 * work. The owner accepted this on 2026-08-13 rather than buying a
 * read-before-every-review-write dedupe; do not "fix" it here without that
 * design getting its own review.
 */

type Check =
  | { state: 'pending' }
  | { state: 'failed' }
  | { state: 'done'; collection: string; ids: string[] };

export function EditTitleAuthor({
  workId,
  work,
  canEdit,
  onSaved,
}: {
  workId: number;
  work: { title: string; authors: string | null; workKey: string };
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(work.title);
  const [authors, setAuthors] = useState(work.authors ?? '');
  const [check, setCheck] = useState<Check>({ state: 'pending' });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const provisional = work.authors === null;

  useEffect(() => {
    if (provisional) return;
    let live = true;
    setCheck({ state: 'pending' });
    (async () => {
      try {
        const keys = await api.reviewKeys(workId);
        // A real (non-provisional) book always gets both keys; the held state
        // only exists for authorless books, which take the branch above.
        if (keys.workKey === null || keys.legacyBookId === null) throw new Error('held');
        const { ids } = await countReviewDocs(keys.collection, keys.workKey, keys.legacyBookId);
        if (!live) return;
        setCheck({ state: 'done', collection: keys.collection, ids });
        // Feed the evidence floor while we are here — the check IS a review
        // fetch, and the floor is what catches a future false zero. Failure
        // is silent; nothing was promised.
        api.reviewsSeen(workId, ids.length).catch(() => undefined);
      } catch {
        if (live) setCheck({ state: 'failed' });
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, provisional]);

  if (!canEdit) return null;

  const save = async () => {
    const nextTitle = title.trim();
    const nextAuthors = authors.trim() === '' ? null : authors.trim();
    if (!nextTitle) {
      setSaid('A book needs a title.');
      return;
    }

    // Delta-only, so the audit log records what changed and nothing else.
    const patch: Record<string, unknown> = {};
    if (nextTitle !== work.title) patch.title = nextTitle;
    if (nextAuthors !== work.authors) patch.authors = nextAuthors;
    if (Object.keys(patch).length === 0) {
      return;
    }

    setBusy(true);
    setSaid(null);
    try {
      const newKey = workKeyFor(nextTitle, nextAuthors ?? UNKNOWN_AUTHOR);

      if (provisional || newKey === work.workKey) {
        // Free by construction (provisional — zero docs can carry the old
        // key), or no key move at all (spelling-only edit). Plain PATCH.
        await api.updateWork(workId, patch);
      } else {
        if (check.state !== 'done') {
          setSaid('The review check has not finished — save stays off until it has.');
          return;
        }
        // ⚠️ Firestore first, then the PATCH. See restampReviews for why a
        // crash between the two degrades safely and re-running is idempotent.
        const restamped = await restampReviews(check.collection, check.ids, newKey);
        await api.updateWork(workId, {
          ...patch,
          keyMove: {
            expectedOldKey: work.workKey,
            reviewsFound: check.ids.length,
            restamped,
          },
        });
      }
      onSaved();
    } catch (err) {
      // The server's refusals carry their reason in `detail` — the code alone
      // ('stale_key') would send somebody to the docs for what one sentence
      // can say here.
      if (err instanceof ApiError && typeof err.detail === 'string') setSaid(err.detail);
      else setSaid(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const checkLine = provisional
    ? null
    : check.state === 'pending'
      ? 'Checking whether reviews follow this book…'
      : check.state === 'failed'
        ? 'Could not check the review link — close and try again. Saving stays off: a failed check is not a zero.'
        : check.ids.length === 0
          ? 'No reviews follow this book — safe to edit.'
          : `${check.ids.length} review${check.ids.length === 1 ? '' : 's'} follow this book — they will be carried to the new name.`;

  // The folded key only moves when title/author change enough to matter; a
  // pure spelling fix needs no resolved check either.
  const wouldMoveKey =
    !provisional &&
    workKeyFor(title.trim() || work.title, (authors.trim() || UNKNOWN_AUTHOR)) !== work.workKey;
  const saveBlocked = busy || (wouldMoveKey && check.state !== 'done');

  return (
    <section className="panel">
      <div className="section-head">
        <h3>{provisional ? 'Author' : 'Title & author'}</h3>
      </div>

      <div className="stack">
          {provisional ? (
            <p className="muted small">
              This book has no author recorded, so nothing can be attached to it yet — filling
              the author in is always safe.
            </p>
          ) : (
            <p className="muted small">{checkLine}</p>
          )}

          {/* Author first on a provisional book — it is the one ask. */}
          {provisional && (
            <label className="field">
              <span className="field__label">Author</span>
              <input
                value={authors}
                onChange={(e) => setAuthors(e.target.value)}
                placeholder="As printed on the book"
                autoFocus
              />
              <span className="muted small">Add the author to unlock reviews.</span>
            </label>
          )}

          <label className="field">
            <span className="field__label">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>

          {!provisional && (
            <label className="field">
              <span className="field__label">Author</span>
              <input
                value={authors}
                onChange={(e) => setAuthors(e.target.value)}
                placeholder="As printed, in the order printed"
              />
              <span className="muted small">
                Clearing this marks the book as author-unknown — refused if reviews follow it.
              </span>
            </label>
          )}

          <div className="controls">
            <button className="primary" disabled={saveBlocked} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

      {said && <p className="muted small">{said}</p>}
    </section>
  );
}
