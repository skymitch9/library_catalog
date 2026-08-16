import { useState } from 'react';
import { api, ApiError, type DeletionReport } from '../api.js';
import { describeError } from '../lib/errors.js';

/**
 * Delete this record — after being shown, precisely, what dies with it.
 *
 * ## Why this exists
 *
 * Until now there was no way to delete a work from the UI at all; every bad
 * record was removed in raw SQL, and the cascade took its editions and copies
 * with no log. This panel is the honest version of that operation: the server
 * writes whole-row `__row__` audit entries for the work AND every cascaded
 * edition and copy before anything goes, so a mistaken delete can be
 * reconstructed from the Changes log.
 *
 * ## ⚠️ The refusal is the feature
 *
 * Work #139 is the lesson this panel is built around: two edition rows looked
 * like duplicates, but the two *copies* under them were real books the owner
 * owns. A duplicate edition and a duplicate copy are different bugs. So the
 * server refuses outright — no force flag — while any copy records property
 * (everything except a plain wish; signed copies always). The path through is
 * deliberately manual: look at each copy in the Copies panel, remove or move
 * it knowingly, and only then does the record itself become deletable.
 *
 * ## What it shows before asking
 *
 * The preview is fetched from `GET /works/:id/deletion` and the server
 * RECOMPUTES it when the DELETE arrives, so the dialog can never authorise
 * more than the truth at that moment. Editions and copies die by
 * `ON DELETE CASCADE` and the dialog says so in words. Reviews are the one
 * thing that survives: they live in Firestore keyed by title+author, and
 * re-adding the book under the same identity reattaches them.
 */
export function DeleteWork({
  workId,
  canEdit,
  onDeleted,
}: {
  workId: number;
  canEdit: boolean;
  /** Where to go once the page's subject no longer exists. */
  onDeleted: () => void;
}) {
  const [report, setReport] = useState<DeletionReport | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  if (!canEdit) return null;

  async function preview() {
    setBusy(true);
    setSaid(null);
    try {
      const { report } = await api.workDeletionReport(workId);
      setReport(report);
      setOpen(true);
    } catch (err) {
      setSaid(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    setBusy(true);
    setSaid(null);
    try {
      await api.deleteWork(workId);
      // The page's subject no longer exists; there is nothing here to update.
      onDeleted();
    } catch (err) {
      // The 409 carries a FRESH report — state can move between the preview
      // and the press, and the refusal names what it saw, not what we did.
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { report?: DeletionReport } | null;
        if (body?.report) setReport(body.report);
        setSaid(typeof err.detail === 'string' ? err.detail : 'Deletion refused.');
      } else {
        setSaid(describeError(err));
      }
      setBusy(false);
    }
  }

  const blocked = (report?.blockers.length ?? 0) > 0;

  return (
    <section className="panel">
      <div className="panel__head">
        <h3>Delete this record</h3>
      </div>

      {!open && (
        <>
          <p className="muted small">
            Remove this book from the catalog entirely — for a record that should never have
            existed, like a phantom from a bad scan. A duplicate of another book is a different
            problem: deleting it loses whichever facts this row had and the other lacks.
          </p>
          <div className="row-tight">
            <button className="chip danger" disabled={busy} onClick={() => void preview()}>
              {busy ? 'Checking what this would destroy…' : 'Delete this record…'}
            </button>
          </div>
        </>
      )}

      {open && report && (
        <div className="stack">
          {/* What dies, before anything can. The database cascades, so this
              is one stroke — the dialog must not imply the printings survive. */}
          <p>
            Deleting <b>{report.title}</b> removes, in one stroke:
          </p>
          <ul>
            <li>
              <b>{report.editions}</b> printing{report.editions === 1 ? '' : 's'} (the database
              deletes them with the work — <code>ON DELETE CASCADE</code>)
            </li>
            <li>
              <b>{report.copies.length}</b> cop{report.copies.length === 1 ? 'y' : 'ies'}
              {report.copies.length > 0 && ':'}
              {report.copies.length > 0 && (
                <ul>
                  {report.copies.map((c) => (
                    <li key={c.id}>
                      {c.status}
                      {c.isSigned && (
                        <b> — signed{c.editionNotes ? ` (${c.editionNotes})` : ''}</b>
                      )}
                      {c.location && <span className="muted"> · {c.location}</span>}
                      {c.lentTo && <span className="muted"> · lent to {c.lentTo}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
            {report.traces.map((t) => (
              <li key={t.what}>
                <b>{t.rows}</b> {t.what}
              </li>
            ))}
          </ul>

          {report.reviewEvidence && (
            <p className="muted small">
              This book appears to have reviews. They live in the shared review store keyed by
              title and author, so deleting the record here does <b>not</b> delete them — but this
              catalog forgets the book they attach to. Re-adding it under the same title and
              author reattaches them.
            </p>
          )}

          {blocked ? (
            <>
              <p className="notice notice--bad">
                <b>Deletion is blocked.</b>{' '}
                {report.blockers.length === 1
                  ? 'A copy of this book records'
                  : `${report.blockers.length} copies of this book record`}{' '}
                real property — owned, lent, pre-ordered, borrowed, sold, or signed. A duplicate
                <i> edition</i> and a duplicate <i>copy</i> are different bugs: if this record is
                a duplicate of another book, its copies describe real objects that belong on the
                right record. Remove or re-home each copy from the Copies panel above (every
                removal is logged whole-row); only a record whose copies are plain wishes can be
                deleted directly.
              </p>
              <div className="row-tight">
                <button disabled={busy} onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted small">
                The full record — this work and every printing and copy above — is written to the
                change log first, as the undo material. Nothing here is reversible from the UI
                yet, but nothing is lost silently either.
              </p>
              <div className="row-tight">
                <button className="chip danger" disabled={busy} onClick={() => void destroy()}>
                  {busy
                    ? 'Deleting…'
                    : `Delete this record${report.editions > 0 ? ` and its ${report.editions} printing${report.editions === 1 ? '' : 's'}` : ''}`}
                </button>
                <button disabled={busy} onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {said && <p className="notice notice--bad">{said}</p>}
    </section>
  );
}
