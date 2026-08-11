import { useState } from 'react';
import { EDITION_FORMATS, PHYSICAL_FORMATS } from '@lc/core';
import { ApiError, api } from '../api.js';
import { formatLabel } from '../lib/formats.js';

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
  isbn13: string | null;
  isbn10?: string | null;
  asin: string | null;
  publisher: string | null;
  published_year: number | null;
  pages: number | null;
  source: string;
  source_url: string | null;
}

/** Zod issues, a friendly conflict string, or nothing useful — say the best of them. */
function describe(err: unknown): string {
  if (err instanceof ApiError) {
    if (typeof err.detail === 'string') return err.detail;
    if (Array.isArray(err.detail)) {
      const issues = err.detail as { path?: unknown[]; message?: string }[];
      const said = issues
        .map((i) => `${(i.path ?? []).join('.') || 'value'}: ${i.message ?? 'is invalid'}`)
        .join('; ');
      if (said) return said;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
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
  editions,
  canEdit,
  onChanged,
}: {
  editions: EditionView[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
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
      setError(describe(err));
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
                    <strong>{formatLabel(e.format)}</strong>
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
    </section>
  );
}

/**
 * Correct one printing.
 *
 * Every field is held as a string and converted on the way out, which is the
 * sibling catalog's form pattern and is what makes "cleared" expressible: an
 * empty box sends an explicit `null`, and `updateEdition` in `@lc/db`
 * distinguishes that from an absent key. A `number | null` in state cannot
 * represent the half-typed "19" that a year passes through on its way to 1997.
 */
function EditionForm({
  edition,
  onCancel,
  onSaved,
}: {
  edition: EditionView;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => ({
    format: edition.format,
    editionName: edition.edition_name ?? '',
    publisher: edition.publisher ?? '',
    publishedYear: edition.published_year?.toString() ?? '',
    pages: edition.pages?.toString() ?? '',
    isbn13: edition.isbn13 ?? '',
    isbn10: edition.isbn10 ?? '',
    asin: edition.asin ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // '' means "cleared", and has to travel as an explicit null: `optionalText`
      // would fold an empty string to null anyway, but `isbn13` and `asin` are
      // regex-checked and would reject one. Numbers are the same story from the
      // other side — `Number('')` is 0, which is a year the schema accepts.
      const text = (s: string) => (s.trim() === '' ? null : s.trim());
      const num = (s: string) => (s.trim() === '' ? null : Number(s));

      await api.updateEdition(edition.id, {
        format: form.format,
        editionName: text(form.editionName),
        publisher: text(form.publisher),
        publishedYear: num(form.publishedYear),
        pages: num(form.pages),
        isbn13: text(form.isbn13),
        isbn10: text(form.isbn10),
        asin: text(form.asin),
      });
      onSaved();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack edition-form">
      <label className="field">
        <span className="field__label">Format</span>
        <select value={form.format} onChange={(e) => set('format', e.target.value)}>
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

      {/* Shown, not editable. `EDITION_SOURCES` says `manual` outranks every
          importer and is never overwritten — correcting an Open Library row by
          hand does not make it a hand-typed row, and rewriting the provenance
          would lose the only record of where the untouched columns came from. */}
      <p className="muted small">Recorded from {edition.source}. Correcting it does not change that.</p>

      {error && <p className="notice notice--bad small">{error}</p>}

      <div className="row-tight">
        <button className="primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save edition'}
        </button>
        <button onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
