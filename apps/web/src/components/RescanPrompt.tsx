import { rescanQuestionText, rescanSentence, type RescanAnswer } from '@lc/core';
import type { IsbnConflict, RescanQuestion } from '../lib/rescans.js';

/**
 * "This book is already in the catalog, but this barcode is not — what am I
 * holding?"
 *
 * ## ⚠️ The shipped prompt pattern, applied to its second case
 *
 * Same shape as `PreorderPrompt`: raised by an Add that wrote nothing, every
 * button names its writes, wording lives in `@lc/core/rescan.ts` beside the
 * rule. The one deliberate difference: this prompt HAS a way out ("Never
 * mind"). The pre-order prompt refuses dismissal because both its answers
 * record something the person already did; here, several answers *create*
 * things, and a person who realises at the shelf that they are not sure yet
 * must be able to put the scanner down without writing anything.
 *
 * ## What each button writes
 *
 * | Button | Writes |
 * |---|---|
 * | This is [printing] — record the ISBN | `edition.isbn13`, link the copy. **No new rows.** |
 * | I have two of it | the ISBN + one new `copy` |
 * | A different printing I own | new `edition` + new `copy` |
 * | A different book | a new work — the match was a name collision |
 *
 * The first is the owner's case (the deliberately ISBN-less slipcase volumes)
 * and renders first, primary, one per candidate row.
 */
export function RescanPrompt({
  question,
  busy,
  onAnswer,
  onDismiss,
}: {
  question: RescanQuestion;
  busy: boolean;
  onAnswer: (answer: RescanAnswer) => void;
  onDismiss: () => void;
}) {
  const q = question;
  return (
    <div className="stack notice" style={{ gap: '0.3rem' }}>
      <div>
        <span className="mark mark--gap" style={{ position: 'static' }}>
          new barcode, known book
        </span>
      </div>
      <strong>{rescanSentence(q.title, q.isbn13)}</strong>
      <div className="muted small">{rescanQuestionText()}</div>

      <div className="stack" style={{ gap: '0.3rem' }}>
        {/* The owner's case: printings recorded before anyone had the barcode,
            waiting for exactly this scan. One button per candidate row, so two
            ISBN-less printings are never one unanswerable button. */}
        {q.fillTargets.map((t) => (
          <button
            key={t.editionId}
            className="primary"
            disabled={busy}
            onClick={() =>
              onAnswer({ kind: 'fill', editionId: t.editionId, linkCopyId: q.linkCopyId })
            }
          >
            This is the {t.label} already on the shelf — record this ISBN on it
          </button>
        ))}

        {/* A spine-added book: copies on the shelf, no printing row at all.
            "This is my copy" creates the row and links the copy — the moment
            "which printing is this?" becomes answerable. */}
        {q.bareCopy && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => onAnswer({ kind: 'fill', editionId: null, linkCopyId: q.linkCopyId })}
          >
            This is my copy — record this as its printing
          </button>
        )}

        {q.fillTargets.map((t) => (
          <button
            key={`copy-${t.editionId}`}
            disabled={busy}
            onClick={() =>
              onAnswer({ kind: 'extra-copy', editionId: t.editionId, alsoFillIsbn: true })
            }
          >
            I have two of the {t.label} — record the ISBN and a second copy
          </button>
        ))}
        {q.bareCopy && (
          <button
            disabled={busy}
            onClick={() => onAnswer({ kind: 'extra-copy', editionId: null, alsoFillIsbn: false })}
          >
            A second copy — add it with this printing
          </button>
        )}

        {/* The #341 case, which the owner said "won't be a 1-off": two real,
            different printings of one book, both on the shelf. Only offered
            when a printing row exists to be different FROM. */}
        {!q.bareCopy && (
          <button disabled={busy} onClick={() => onAnswer({ kind: 'new-printing' })}>
            A different printing I own — add it as a new edition and copy
          </button>
        )}

        <button disabled={busy} onClick={() => onAnswer({ kind: 'different-book' })}>
          A different book that happens to match by name — add it separately
        </button>

        {/* The way out the pre-order prompt deliberately lacks — see the header. */}
        <button disabled={busy} onClick={onDismiss}>
          Never mind — write nothing
        </button>
      </div>
    </div>
  );
}

/**
 * The UNIQUE index said another printing already holds this ISBN — the
 * Realmkeeper shape, one physical volume described by two catalog rows. Never
 * surfaced as a raw constraint violation: the person is offered the slipcase
 * treatment (the fact goes into this row's `edition_name`; the ISBN stays
 * where it is), or a clean exit. Nothing has been written when this shows.
 */
export function IsbnTakenPrompt({
  conflict,
  busy,
  onAnswer,
  onDismiss,
}: {
  conflict: IsbnConflict;
  busy: boolean;
  onAnswer: (answer: RescanAnswer) => void;
  onDismiss: () => void;
}) {
  const holderName = conflict.holder?.title
    ? `“${conflict.holder.title}”${conflict.holder.editionName ? ` (${conflict.holder.editionName})` : ''}`
    : 'another printing in the catalog';

  return (
    <div className="stack notice" style={{ gap: '0.3rem' }}>
      <div>
        <span className="mark mark--gap" style={{ position: 'static' }}>
          ISBN already recorded
        </span>
      </div>
      <strong>
        Barcode {conflict.isbn13} is already recorded on {holderName}.
      </strong>
      <div className="muted small">
        One physical volume can be two catalog rows — an omnibus holding two books carries one
        barcode. The ISBN stays where it is; this row can carry the fact in its edition name.
      </div>

      <div className="stack" style={{ gap: '0.3rem' }}>
        {conflict.editionId !== null && (
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              onAnswer({
                kind: 'fill-note',
                editionId: conflict.editionId as number,
                holderTitle: conflict.holder?.title ?? null,
              })
            }
          >
            Note the shared ISBN on this printing’s name
          </button>
        )}
        <button disabled={busy} onClick={onDismiss}>
          Leave it — write nothing
        </button>
      </div>
    </div>
  );
}
