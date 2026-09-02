import { useState } from 'react';
import {
  EDITION_FORMATS,
  EDITION_KINDS,
  PHYSICAL_FORMATS,
  appendNoBarcodeNote,
  hasNoBarcodeNote,
  stripNoBarcodeNote,
} from '@lc/core';
import { api } from '../api.js';
import { describeError } from '../lib/errors.js';
import { editionKindLabel, formatLabel } from '../lib/formats.js';

/**
 * The printings of one book — and the only place `edition.format` has ever been
 * changeable from this app.
 *
 * ## Why this panel exists
 *
 * ⚠️ **A format was write-once, and it is guessed.** `addLineToCatalog` writes
 * `format: 'paperback'` for every barcode it resolves, deliberately: a barcode
 * proves a printing exists and does not say which one. That guess is right most
 * of the time and wrong often enough to matter — the case that prompted this was
 * a hardcover, scanned off its own barcode, filed as a paperback, with nothing
 * anywhere in the UI able to correct it. `updateEditionSchema` had existed in
 * `@lc/core` since the beginning with no route and no control behind it.
 *
 * The rest of the fields are here because the same wall is directly behind them:
 * a publisher or a year typed wrong by an importer had no more of a fix than a
 * format did.
 *
 * ## The edit idiom is the sibling catalog's
 *
 * Per-row **Edit** swapping the row in place for a form, one form component that
 * would serve create and edit alike, `Save …` / `Cancel`, a present-participle
 * busy label, and a two-click confirm rather than `window.confirm` for the
 * destructive one. That is `CopyRow`/`CopyForm` in the Board Game Catalog, in
 * this app's class vocabulary — `panel`, `field`, `stack`, `row-tight`, `chip`
 * are what the shared design language is called here, and its buttons already
 * carry a 44px minimum, so the markup differs from the sibling's while the
 * behaviour and the rendered control do not.
 */

export interface EditionView {
  id: number;
  format: string;
  edition_name?: string | null;
  /**
   * The canonical bucket — `'collectors'` or null for an ordinary printing.
   * Migration 0050. ⚠️ Null is NOT "unknown"; see `EDITION_KINDS` in `@lc/core`.
   */
  edition_kind?: string | null;
  /**
   * What is bound inside this object — "Volumes 1-3". Migration 0060.
   *
   * ⚠️ A third axis, and not a tidier `edition_name`. The name is what the shop
   * called the printing, the kind is whether it is a special one, and this is
   * which parts of the story are between the covers. *White Sand* is the whole
   * reason: "Omnibus - collects volumes 1-3" was in the name field, where nothing
   * could read it.
   */
  collects?: string | null;
  isbn13: string | null;
  isbn10?: string | null;
  asin: string | null;
  publisher: string | null;
  published_year: number | null;
  pages: number | null;
  /**
   * This printing's OWN jacket — owner 2026-09-02: *"we should also add being
   * able to set the covers for the alternate editions too."*
   *
   * ⚠️ **Not new storage.** `edition.cover_url` has existed since migration
   * `0001` and `EDITION_COLS` has always selected it; what was missing was any
   * way to SET it and anywhere that READ it. So this ask needs no migration —
   * measured, not assumed (`migrations/0001_init.sql` line 214).
   *
   * ⚠️ Null means *this printing has no cover of its own*, and every reader falls
   * back to the work cover. It is never filled in from the work: a borrowed
   * jacket on a specific printing is the same class of fabrication as a borrowed
   * edition name (see `shelf-view.ts` on work 220).
   */
  cover_url?: string | null;
  source: string;
  source_url: string | null;
}

/**
 * Two-click delete, ported from the sibling catalog's `ConfirmButton`.
 *
 * Not `window.confirm`: a native dialog blocks the page and reads as heavier
 * than the action deserves. Local to this file because deleting a printing is
 * the only place in this app that currently needs one — a second caller is the
 * moment it moves somewhere shared, not before.
 */
function ConfirmButton({
  label,
  confirmLabel,
  disabled,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button className="chip" disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }

  return (
    <span className="row-tight">
      <button className="chip danger" disabled={disabled} onClick={onConfirm}>
        {confirmLabel}
      </button>
      <button className="chip" disabled={disabled} onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}

export function Editions({
  workId,
  editions,
  canEdit,
  onChanged,
}: {
  workId: number;
  editions: EditionView[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: number) {
    setBusyId(id);
    setError(null);
    try {
      await api.deleteEdition(id);
      if (editingId === id) setEditingId(null);
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel">
      <h3>Editions</h3>

      {editions.length === 0 ? (
        <p className="muted small">No printing recorded yet.</p>
      ) : (
        <ul className="plain">
          {editions.map((e) =>
            editingId === e.id ? (
              <li key={e.id}>
                <EditionForm
                  edition={e}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => {
                    setEditingId(null);
                    onChanged();
                  }}
                />
              </li>
            ) : (
              <li key={e.id}>
                <div className="copy">
                  <div className="copy__text">
                    {/* ⚠️ The canonical kind and the vendor's own words, side by
                        side and both shown. The owner asked for exactly this:
                        *"Keep the original name on the visible listing but for
                        our sanity all editions should be collectors."* The chip
                        is what the filter and the counts agree with; the line
                        under it is still the shop's wording, unedited. Only the
                        exceptions get a chip — an ordinary printing has a null
                        kind and shows nothing, because a "Standard" badge on 220
                        rows is a badge nobody reads. */}
                    <strong className="edition-head">
                      {formatLabel(e.format)}
                      {e.edition_kind && (
                        <span className="mark mark--kind">{editionKindLabel(e.edition_kind)}</span>
                      )}
                    </strong>
                    <span className="muted small">
                      {[
                        e.edition_name,
                        e.publisher,
                        e.published_year,
                        e.pages ? `${e.pages}pp` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {/* Its own line, not folded into the run above. "Volumes
                        1-3" is the difference between two printings that
                        otherwise look identical — both *White Sand* rows are
                        `ebook_epub` with no publisher — so burying it between a
                        page count and a year is how it stops being read. */}
                    {e.collects && <span className="muted small">Contains {e.collects}</span>}
                    <span className="muted small">
                      {e.isbn13 && <>ISBN {e.isbn13} </>}
                      {e.isbn10 && !e.isbn13 && <>ISBN {e.isbn10} </>}
                      {e.asin && <>ASIN {e.asin} </>}
                      {/* Where the row came from, because a re-sync may overwrite an
                          imported row and must never overwrite a typed one. */}
                      <em>from {e.source}</em>
                    </span>
                    {e.source_url && <span className="path small muted">{e.source_url}</span>}
                  </div>
                  {canEdit && (
                    <div className="copy__actions">
                      <button
                        className="chip"
                        disabled={busyId === e.id}
                        onClick={() => setEditingId(e.id)}
                      >
                        Edit
                      </button>
                      <ConfirmButton
                        label="Delete"
                        confirmLabel={busyId === e.id ? 'Deleting…' : 'Really delete?'}
                        disabled={busyId === e.id}
                        onConfirm={() => void remove(e.id)}
                      />
                    </div>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {error && <p className="notice notice--bad small">{error}</p>}

      {/*
        Said here rather than left to be discovered, because it is the specific
        mistake this panel was built to undo: every barcode scan files its book
        as a paperback.

        ⚠️ Shown only while a paperback is actually on the row, which is both
        narrower and self-clearing — it appears on exactly the rows that might be
        wrong, and goes away the moment somebody corrects one. An earlier version
        printed it under every edition, including EPUBs, where it is a non
        sequitur: nothing scans a barcode into an ebook.
      */}
      {canEdit && editions.some((e) => e.format === 'paperback') && (
        <p className="muted small">
          A scanned book is recorded as a paperback until someone says otherwise.
        </p>
      )}

      {/* ⚠️ The by-hand door — for the printings that can never be scanned in.
          70 physical editions carry no ISBN (Kickstarter and campaign
          printings mostly), and several verified copies carry no barcode at
          all; describing those was an ask-for-SQL job until this button. No
          field but the format is required — an ISBN-less printing is a normal
          row here, not a defective one — and a same-format sibling that
          carries nothing to tell it apart is refused by the server with
          advice, not stored. */}
      {canEdit &&
        (addingNew ? (
          <EditionForm
            edition={null}
            workId={workId}
            onCancel={() => setAddingNew(false)}
            onSaved={() => {
              setAddingNew(false);
              onChanged();
            }}
          />
        ) : (
          <div className="row-tight">
            <button onClick={() => setAddingNew(true)}>Add a printing</button>
          </div>
        ))}
    </section>
  );
}

/**
 * Correct one printing — or describe a brand-new one (`edition: null`).
 *
 * One component for both, the sibling catalog's pattern this file's header
 * already names; two forms would be two places for the field reasoning below
 * to drift apart. Create mode requires only the format — an ISBN-less printing
 * is the *normal* case for the crowdfunded half of this shelf, so nothing here
 * may treat a blank identifier as an error.
 *
 * Every field is held as a string and converted on the way out, which is the
 * sibling catalog's form pattern and is what makes "cleared" expressible: an
 * empty box sends an explicit `null`, and `updateEdition` in `@lc/db`
 * distinguishes that from an absent key. A `number | null` in state cannot
 * represent the half-typed "19" that a year passes through on its way to 1997.
 */
function EditionForm({
  edition,
  workId,
  onCancel,
  onSaved,
}: {
  /** Null means "describe a new printing" — create instead of correct. */
  edition: EditionView | null;
  /** Required when `edition` is null; the create needs a work to belong to. */
  workId?: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => ({
    format: edition?.format ?? '',
    editionName: edition?.edition_name ?? '',
    editionKind: edition?.edition_kind ?? '',
    collects: edition?.collects ?? '',
    publisher: edition?.publisher ?? '',
    publishedYear: edition?.published_year?.toString() ?? '',
    pages: edition?.pages?.toString() ?? '',
    isbn13: edition?.isbn13 ?? '',
    isbn10: edition?.isbn10 ?? '',
    asin: edition?.asin ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (edition === null && form.format === '') {
      setError('Say what kind of object it is — the format is the one required fact.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // '' means "cleared", and has to travel as an explicit null: `optionalText`
      // would fold an empty string to null anyway, but `isbn13` and `asin` are
      // regex-checked and would reject one. Numbers are the same story from the
      // other side — `Number('')` is 0, which is a year the schema accepts.
      const text = (s: string) => (s.trim() === '' ? null : s.trim());
      const num = (s: string) => (s.trim() === '' ? null : Number(s));

      const fields = {
        format: form.format,
        editionName: text(form.editionName),
        // '' is the "Ordinary printing" option and clears the column, which is
        // a real answer here rather than an absence — see `EDITION_KINDS`. It
        // has to travel as an explicit null for `updateEdition` in `@lc/db` to
        // tell it from a field this form never mentioned.
        editionKind: text(form.editionKind),
        collects: text(form.collects),
        publisher: text(form.publisher),
        publishedYear: num(form.publishedYear),
        pages: num(form.pages),
        isbn13: text(form.isbn13),
        isbn10: text(form.isbn10),
        asin: text(form.asin),
      };

      if (edition === null) {
        // A person typing IS the manual source — the provenance rank that no
        // importer may overwrite (`EDITION_SOURCES`).
        await api.createEdition({ workId, source: 'manual', ...fields });
      } else {
        await api.updateEdition(edition.id, fields);
      }
      onSaved();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack edition-form">
      <label className="field">
        <span className="field__label">Format</span>
        <select value={form.format} onChange={(e) => set('format', e.target.value)}>
          {/* Create mode starts unchosen and stays honest about it: defaulting
              a hand-described printing to paperback would be the scan path's
              guess repeated where nothing forces a guess. Edit mode never
              renders this option — the row already has a format. */}
          {edition === null && <option value="">Choose…</option>}
          {/* Physical first — this is the group somebody is reaching for when
              they open this form, because a wrong format is nearly always a
              hardcover that a barcode called a paperback. */}
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

      {/*
        ⚠️ The second field that matters, and for a reason the format list cannot
        fix. Real editions arriving in this house include a Barnes & Noble
        "Special" and a "BN Exclusive", campaign-exclusive and slipcased
        hardcovers, and signed and numbered copies — none of which is a `format`,
        and none of which should become one. `EDITION_FORMATS` answers *what the
        object is made of*, which is the question `PHYSICAL_FORMATS` and the
        collection facets need a closed set for. Everything that makes a printing
        special beyond that is prose, and it belongs here.
      */}
      <label className="field">
        <span className="field__label">Edition</span>
        <input
          value={form.editionName}
          onChange={(e) => set('editionName', e.target.value)}
          placeholder="“BN Exclusive”, “Deluxe”, “Signed and numbered”, “Slipcased”"
        />
      </label>

      {/*
        ⚠️ **This control is the "fix them one off if needed" half of the ask**,
        and the feature is not finished without it. `classifyEdition` in
        `@lc/core` reads the name above and files almost every named printing in
        this catalog automatically; it deliberately refuses the two *White Sand*
        rows, because an omnibus and a "Volume 1" describe what is *inside* a
        book rather than how it was printed. Every such judgement has
        to be over-rulable from the page, or the rule becomes the only opinion
        that exists.

        Kept as its own field rather than derived from the name on save: renaming
        a printing must not silently re-file it, and clearing a name must not
        un-file it. `updateEdition` in `@lc/db` says the same thing from the
        other side.

        "Ordinary printing" is the empty value and is a real answer, not a blank.
      */}
      <label className="field">
        <span className="field__label">Printing</span>
        <select value={form.editionKind} onChange={(e) => set('editionKind', e.target.value)}>
          <option value="">Ordinary printing</option>
          {EDITION_KINDS.map((k) => (
            <option key={k} value={k}>
              {editionKindLabel(k)}
            </option>
          ))}
        </select>
      </label>

      {/*
        ⚠️ The third axis, and the one that had nowhere to live until migration
        0060. An omnibus is **not** a special printing — 0050 refused to make it
        an `edition_kind` and said so in writing — and it is not an edition name
        either, because an edition name is what the shop called it. It is what is
        printed inside the object, and until this box existed both *White Sand*
        rows were carrying it in the name field where nothing could read it.

        Empty is the ordinary case by a wide margin: 227 of 229 printings are the
        whole work and nothing else.

        ⚠️ This records a fact about the OBJECT. Saying that the omnibus contains
        three books this catalog also holds as their own rows is a different
        statement, it lives in the Related panel as `contains`, and it is the one
        the scanner's overlap warning can read. Fill both in when both are true.
      */}
      <label className="field">
        <span className="field__label">Contains</span>
        <input
          value={form.collects}
          onChange={(e) => set('collects', e.target.value)}
          placeholder="“Volumes 1-3”, “Books 1-3 and two short stories”"
        />
      </label>

      <div className="edition-form__pair">
        <label className="field">
          <span className="field__label">Publisher</span>
          <input value={form.publisher} onChange={(e) => set('publisher', e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Year</span>
          <input
            inputMode="numeric"
            value={form.publishedYear}
            onChange={(e) => set('publishedYear', e.target.value)}
          />
        </label>
      </div>

      <div className="edition-form__pair">
        <label className="field">
          <span className="field__label">Pages</span>
          <input
            inputMode="numeric"
            value={form.pages}
            onChange={(e) => set('pages', e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">ISBN-13</span>
          <input
            inputMode="numeric"
            value={form.isbn13}
            onChange={(e) => set('isbn13', e.target.value)}
            placeholder="9780765326355"
          />
        </label>
      </div>

      <div className="edition-form__pair">
        <label className="field">
          <span className="field__label">ISBN-10</span>
          <input value={form.isbn10} onChange={(e) => set('isbn10', e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">ASIN</span>
          <input
            value={form.asin}
            onChange={(e) => set('asin', e.target.value)}
            placeholder="B0…"
          />
        </label>
      </div>

      {/*
        ⚠️ "No barcode on the object" recorded as an OBSERVED fact — 0040's
        distinction, one row over: a blank isbn13 means nobody has looked, and
        this note means somebody looked and there is nothing to scan. The
        crowdfunded printings this shelf is full of frequently carry none, and
        without the note every blank reads as an unanswered question that
        future passes keep re-asking. The tick writes into the edition name
        (`edition` has no notes column) in the ONE spelling `@lc/core` owns,
        matching the rows the owner already verified at the shelf — so the
        checkbox state IS the name text, visible above, never a hidden flag
        travelling apart from its value.
        Offered only while it can be true: a physical format with no ISBN-13
        typed. Ticked rows keep showing it even mid-edit of the ISBN field so
        unticking stays possible.
      */}
      {(PHYSICAL_FORMATS as readonly string[]).includes(form.format) &&
        (form.isbn13.trim() === '' || hasNoBarcodeNote(form.editionName)) && (
          <label className="row-tight">
            <input
              type="checkbox"
              checked={hasNoBarcodeNote(form.editionName)}
              onChange={(e) =>
                set(
                  'editionName',
                  e.target.checked
                    ? appendNoBarcodeNote(form.editionName.trim() === '' ? null : form.editionName)
                    : (stripNoBarcodeNote(form.editionName) ?? ''),
                )
              }
            />
            <span>
              No barcode printed on this copy — checked the object. The blank ISBN becomes a
              recorded fact instead of a gap.
            </span>
          </label>
        )}

      {/* Shown, not editable. `EDITION_SOURCES` says `manual` outranks every
          importer and is never overwritten — correcting an Open Library row by
          hand does not make it a hand-typed row, and rewriting the provenance
          would lose the only record of where the untouched columns came from. */}
      {edition !== null && (
        <p className="muted small">
          Recorded from {edition.source}. Correcting it does not change that.
        </p>
      )}

      {error && <p className="notice notice--bad small">{error}</p>}

      <div className="row-tight">
        <button className="primary" onClick={() => void save()} disabled={busy}>
          {busy
            ? edition === null
              ? 'Adding…'
              : 'Saving…'
            : edition === null
              ? 'Add printing'
              : 'Save edition'}
        </button>
        <button onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
