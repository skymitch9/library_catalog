import { useState } from 'react';
import { CONDITIONS, COPY_STATUSES, EDITION_FORMATS, PHYSICAL_FORMATS } from '@lc/core';
import { api } from '../api.js';
import { formatLabel } from '../lib/formats.js';
import { STATUS_LABEL, arrivedPatch } from '../lib/statuses.js';

/**
 * The copies of one book — and the only place `copy.status` has ever been
 * writable from this app.
 *
 * ## The distinction the panel exists to keep visible
 *
 * An **edition** is a printing that exists in the world; a **copy** is one we
 * have, want, lent or sold. The catalog holds 118 editions and, until this
 * panel, **zero copies of any status** — every book in it was known as a file
 * with nothing recorded about whether it is on a shelf.
 *
 * ⚠️ Recording a wish must therefore not require an edition, and it does not:
 * `copy.edition_id` is nullable precisely so a copy can exist before its exact
 * printing is known (migration 0001). Wanting *the hardcover of Cradle 1* when
 * no hardcover edition is catalogued is the ordinary case, not an edge one.
 *
 * ## Physical formats are first-class here
 *
 * Physical books are being added to this catalog shortly. The format select
 * offers the three physical formats first and creates an `edition` row when one
 * is chosen, because "I want it in hardcover" is a statement about a printing
 * and belongs on the printing. Choosing nothing is allowed and common: a wish
 * with no format is "I want this book, in whatever comes".
 */

export interface CopyView {
  id: number;
  status: string;
  location: string | null;
  condition: string | null;
  lent_to: string | null;
  is_signed: number;
  edition_id: number | null;
  notes: string | null;
  /** Null until it turns up. `arrivedPatch` fills it, and only when it is null. */
  acquired_on: string | null;
}

export function Copies({
  workId,
  copies,
  editions,
  canEdit,
  onChanged,
}: {
  workId: number;
  copies: CopyView[];
  editions: { id: number; format: string }[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState<null | 'owned' | 'wanted'>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function change(copyId: number, body: Record<string, unknown>) {
    setBusy(copyId);
    setError(null);
    try {
      await api.updateCopy(copyId, body);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(copyId: number) {
    setBusy(copyId);
    setError(null);
    try {
      await api.deleteCopy(copyId);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const wanted = copies.filter((c) => c.status === 'wanted' || c.status === 'preordered');

  return (
    <section className="panel">
      <h3>Copies</h3>

      {copies.length === 0 ? (
        <p className="muted small">
          Nothing recorded. An edition existing is not the same as a copy on the shelf — and
          nor is it the same as wanting one.
        </p>
      ) : (
        <ul className="plain">
          {copies.map((c) => (
            <li key={c.id}>
              <div className="copy">
                <div className="copy__text">
                  <strong>{STATUS_LABEL[c.status] ?? c.status}</strong>
                  <span className="muted small">
                    {[
                      c.edition_id
                        ? formatLabel(editions.find((e) => e.id === c.edition_id)?.format ?? '')
                        : null,
                      c.location,
                      c.condition,
                      c.is_signed ? 'signed' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {c.lent_to && <span className="muted small">Lent to {c.lent_to}</span>}
                  {c.notes && <span className="muted small">{c.notes}</span>}
                </div>
                {canEdit && (
                  <div className="copy__actions">
                    {/* ⚠️ Offered only on a copy that is actually on its way, and
                        it is not a shortcut for the select beside it: the select
                        writes `status` alone, where arriving also dates the copy.
                        The wishlist's checklist is where a whole parcel is
                        settled; this is for meeting one book on its own page. */}
                    {c.status === 'preordered' && (
                      <button
                        className="chip primary"
                        disabled={busy === c.id}
                        onClick={() => void change(c.id, arrivedPatch(c.acquired_on))}
                      >
                        It arrived
                      </button>
                    )}
                    <label className="field">
                      <span className="field__label">Status</span>
                      <select
                        value={c.status}
                        disabled={busy === c.id}
                        onChange={(e) => void change(c.id, { status: e.target.value })}
                      >
                        {COPY_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s] ?? s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="chip" disabled={busy === c.id} onClick={() => void remove(c.id)}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="notice notice--bad small">{error}</p>}

      {canEdit && (
        <>
          <div className="row-tight">
            <button onClick={() => setAdding(adding === 'owned' ? null : 'owned')}>
              {adding === 'owned' ? 'Cancel' : 'Record a copy'}
            </button>
            {/* Offered even when a copy is already recorded: wanting a second
                form of a book you own is the normal case here, not an error. */}
            <button
              className={wanted.length ? '' : 'primary'}
              onClick={() => setAdding(adding === 'wanted' ? null : 'wanted')}
            >
              {adding === 'wanted' ? 'Cancel' : 'Want this'}
            </button>
          </div>

          {adding && (
            <AddCopy
              workId={workId}
              intent={adding}
              editions={editions}
              onSaved={() => {
                setAdding(null);
                onChanged();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * Record a copy — owned, or wanted.
 *
 * One form for both, because they differ only in the status it starts on and in
 * which fields are worth asking for. Two forms would be two places to fix the
 * "create the edition first" step below.
 */
function AddCopy({
  workId,
  intent,
  editions,
  onSaved,
}: {
  workId: number;
  intent: 'owned' | 'wanted';
  editions: { id: number; format: string }[];
  onSaved: () => void;
}) {
  const [format, setFormat] = useState('');
  const [location, setLocation] = useState('');
  const [condition, setCondition] = useState('');
  const [vendor, setVendor] = useState('');
  const [notes, setNotes] = useState('');
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // ⚠️ A format names a *printing*, so an owned copy has to point at an
      // `edition` row. Reusing an existing edition of the same format rather
      // than minting a second one: this catalog learned that lesson the
      // expensive way — `findEditionBySourceUrl` in `@lc/db` exists because an
      // importer created 83 duplicate editions by not checking.
      //
      // ⚠️ **A wish creates no edition**, and that is load-bearing rather than
      // lazy. `reportFor` in `@lc/db` decides whether a work is held or merely
      // wished for by asking whether it has any edition at all — the only signal
      // available while `copy` is an empty table. Minting an edition for a wish
      // would make a brand-new wished-for book read as owned the moment somebody
      // said which format they wanted. The format is recorded on the copy
      // instead, which is where a fact about one specific copy belongs.
      let editionId: number | null = null;
      if (format && intent === 'owned') {
        const existing = editions.find((e) => e.format === format);
        editionId =
          existing?.id ??
          (await api.createEdition({ workId, format, source: 'manual' })).edition.id;
      }

      await api.createCopy({
        workId,
        editionId,
        status: intent,
        location: location.trim() || null,
        condition: condition || null,
        vendor: vendor.trim() || null,
        isSigned: signed,
        editionNotes: format && intent === 'wanted' ? `wanted as ${formatLabel(format)}` : null,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <label className="field">
        <span className="field__label">Format</span>
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="">
            {intent === 'wanted' ? 'Any — whatever comes' : 'Not recorded'}
          </option>
          {/* Physical first, because that is what a copy on a shelf is, and
              because the physical half of this collection is about to arrive. */}
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

      {intent === 'owned' && (
        <>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Where it lives — “living room shelf 3”"
            aria-label="Location"
          />
          <label className="field">
            <span className="field__label">Condition</span>
            <select value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value="">Not recorded</option>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c.replace('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="row-tight">
            <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} />
            <span>Signed</span>
          </label>
        </>
      )}

      <input
        value={vendor}
        onChange={(e) => setVendor(e.target.value)}
        placeholder={intent === 'wanted' ? 'Where to get it' : 'Where it came from'}
        aria-label="Vendor"
      />
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes"
        aria-label="Notes"
      />

      {error && <p className="notice notice--bad small">{error}</p>}
      <button className="primary" onClick={() => void save()} disabled={busy}>
        {busy ? 'Saving…' : intent === 'wanted' ? 'Add to the wishlist' : 'Record it'}
      </button>
    </div>
  );
}
