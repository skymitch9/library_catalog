import { useState } from 'react';
import {
  EDITION_FORMATS,
  PHYSICAL_FORMATS,
  appendNoBarcodeNote,
  newPrintingNeedsName,
  printingQuestionText,
  rescanQuestionText,
  rescanSentence,
  type RescanAnswer,
  type RescanEdition,
} from '@lc/core';
import { formatLabel } from '../lib/formats.js';
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

/** One printing the picker can point at. Labelled by `printingLabel` — the ONE spelling. */
export interface PrintingOption {
  editionId: number;
  label: string;
}

/** What a hand-described new printing carries up to the caller, which does the network. */
export interface NewPrintingDetails {
  format: string;
  editionName: string | null;
  publisher: string | null;
  publishedYear: number | null;
}

/**
 * "Which printing is this?" — asked with no barcode in hand.
 *
 * ## ⚠️ The rescan question's third caller, deliberately in this file
 *
 * The scan path, the rescan prompt above, and this picker all answer the same
 * question, and keeping them one vocabulary is the whole design
 * (`@lc/core/rescan.ts`, "manual picker" section). 70 physical editions carry
 * no ISBN and several verified copies carry no barcode at all — those books
 * can only ever be described by hand, and until this existed the route for
 * that was asking for SQL.
 *
 * Same contract as `RescanPrompt`: nothing is written until a button that
 * names its writes is pressed, and "never mind" writes nothing. The caller
 * does the network; this component only asks.
 *
 * | Button | The caller then writes |
 * |---|---|
 * | It’s the [printing] | `copy.edition_id` — no new rows |
 * | A different printing — describe it | a new `edition` (named — see `newPrintingNeedsName`) + the link |
 * | Not sure (`allowUnlinked`) | the copy with `edition_id` null — honest, and repairable later |
 */
export function EditionPickerPrompt({
  candidates,
  editions,
  fixedFormat,
  allowUnlinked,
  busy,
  onPick,
  onNewPrinting,
  onUnlinked,
  onDismiss,
}: {
  candidates: PrintingOption[];
  /** The work's full edition list — the needs-a-name rule reads it. */
  editions: readonly RescanEdition[];
  /** Set when a form upstream already named the format; null lets the person choose. */
  fixedFormat: string | null;
  /** "Not sure" still records the copy, unlinked — the AddCopy case. */
  allowUnlinked: boolean;
  busy: boolean;
  onPick: (editionId: number) => void;
  onNewPrinting: (details: NewPrintingDetails) => void;
  onUnlinked?: () => void;
  onDismiss: () => void;
}) {
  const [describing, setDescribing] = useState(false);

  return (
    <div className="stack notice" style={{ gap: '0.3rem' }}>
      <div>
        <span className="mark mark--gap" style={{ position: 'static' }}>
          which printing?
        </span>
      </div>
      <div className="muted small">{printingQuestionText()}</div>

      {!describing ? (
        <div className="stack" style={{ gap: '0.3rem' }}>
          {candidates.map((t) => (
            <button
              key={t.editionId}
              className="primary"
              disabled={busy}
              onClick={() => onPick(t.editionId)}
            >
              It’s the {t.label}
            </button>
          ))}

          <button disabled={busy} onClick={() => setDescribing(true)}>
            A different printing{candidates.length ? ' — none of these' : ''} — describe it
          </button>

          {allowUnlinked && (
            <button disabled={busy} onClick={onUnlinked}>
              Not sure — record the copy without naming its printing
            </button>
          )}

          <button disabled={busy} onClick={onDismiss}>
            Never mind — write nothing
          </button>
        </div>
      ) : (
        <NewPrintingForm
          editions={editions}
          fixedFormat={fixedFormat}
          busy={busy}
          onCreate={onNewPrinting}
          onBack={() => setDescribing(false)}
        />
      )}
    </div>
  );
}

/**
 * Describe the printing that is not on file — by hand, because for these books
 * there is nothing to scan.
 *
 * ⚠️ A same-format sibling requires a name (`newPrintingNeedsName`): two rows
 * both saying only "hardcover" are indistinguishable forever, which is the
 * #139 residue shape. The server refuses the blank one too
 * (`indistinguishable_printing`); this form just says so before the round
 * trip. The first printing of a format needs no name — the format is its
 * description.
 *
 * The no-barcode tick records an **observed fact** in the edition name, in the
 * exact spelling the owner-verified rows already use — so a blank ISBN on that
 * row reads as "checked, nothing to scan" instead of an unanswered question.
 */
function NewPrintingForm({
  editions,
  fixedFormat,
  busy,
  onCreate,
  onBack,
}: {
  editions: readonly RescanEdition[];
  fixedFormat: string | null;
  busy: boolean;
  onCreate: (details: NewPrintingDetails) => void;
  onBack: () => void;
}) {
  const [format, setFormat] = useState(fixedFormat ?? '');
  const [name, setName] = useState('');
  const [publisher, setPublisher] = useState('');
  const [year, setYear] = useState('');
  const [noBarcode, setNoBarcode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsName = format !== '' && newPrintingNeedsName(editions, format);
  const physical = (PHYSICAL_FORMATS as readonly string[]).includes(format);

  function submit() {
    if (!format) {
      setError('Say what kind of object it is — the format is the one required fact.');
      return;
    }
    if (needsName && name.trim() === '') {
      setError(
        `A ${formatLabel(format).toLowerCase()} is already on file — name what makes this one ` +
          'different (“Kickstarter Grimoire Edition”, “Target exclusive”), or two rows will be ' +
          'indistinguishable forever.',
      );
      return;
    }
    // Refused here rather than silently dropped: JSON turns NaN into null on
    // the wire, so a mistyped year would otherwise vanish with a 200 — the
    // strip-lie this codebase keeps finding.
    if (year.trim() !== '' && !Number.isInteger(Number(year))) {
      setError('The year needs to be a number, or left blank.');
      return;
    }
    setError(null);
    const trimmed = name.trim() === '' ? null : name.trim();
    onCreate({
      format,
      // The tick is the observed fact; it travels in the name because
      // `edition` has no notes column. One spelling, from @lc/core.
      editionName: noBarcode && physical ? appendNoBarcodeNote(trimmed) : trimmed,
      publisher: publisher.trim() === '' ? null : publisher.trim(),
      publishedYear: year.trim() === '' ? null : Number(year),
    });
  }

  return (
    <div className="stack" style={{ gap: '0.3rem' }}>
      {fixedFormat === null ? (
        <label className="field">
          <span className="field__label">Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="">Choose…</option>
            <optgroup label="Physical">
              {PHYSICAL_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {formatLabel(f)}
                </option>
              ))}
            </optgroup>
            <optgroup label="Files and licences">
              {EDITION_FORMATS.filter((f) => !PHYSICAL_FORMATS.includes(f)).map((f) => (
                <option key={f} value={f}>
                  {formatLabel(f)}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      ) : (
        <p className="muted small">A new, different {formatLabel(fixedFormat).toLowerCase()}.</p>
      )}

      <label className="field">
        <span className="field__label">Edition{needsName ? '' : ' (optional)'}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="“Kickstarter Grimoire Edition”, “Target exclusive — foil case”"
        />
      </label>

      <div className="row-tight">
        <input
          value={publisher}
          onChange={(e) => setPublisher(e.target.value)}
          placeholder="Publisher"
          aria-label="Publisher"
        />
        <input
          inputMode="numeric"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="Year"
          aria-label="Year"
          style={{ maxWidth: '6rem' }}
        />
      </div>

      {physical && (
        <label className="row-tight">
          <input
            type="checkbox"
            checked={noBarcode}
            onChange={(e) => setNoBarcode(e.target.checked)}
          />
          <span>
            No barcode printed on it — checked the object. Recorded so the blank ISBN reads as a
            fact, not a gap.
          </span>
        </label>
      )}

      {error && <p className="notice notice--bad small">{error}</p>}

      <div className="row-tight">
        <button className="primary" disabled={busy} onClick={submit}>
          {busy ? 'Adding…' : 'Add this printing'}
        </button>
        <button disabled={busy} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
