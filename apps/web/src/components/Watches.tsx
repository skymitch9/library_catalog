import { useState } from 'react';
import { api, type Watch } from '../api.js';
import { describeError } from '../lib/errors.js';

/**
 * "I'll check — put a watch on this so I verify later."
 *
 * The owner's own words, about two books recording contradictory series. This
 * is the panel that makes that sentence a thing the app can do.
 *
 * ## ⚠️ The note is the feature, not the mark
 *
 * A flag with no reason is one you find weeks later and have to investigate from
 * scratch — which is the work the flag was supposed to save. So the note is
 * required, by the schema and by the button below, and the panel shows it in
 * full rather than as a truncated preview: the whole point of opening this book
 * is to read what past-you was worried about.
 *
 * ## Resolve and delete are both offered, and they are different
 *
 * "I looked at this and it is fine" is a fact worth keeping; a resolved watch
 * stays visible here, greyed, and stops counting towards the mark. "I raised
 * this by mistake" leaves no such fact and deletes the row. Collapsing the two
 * would make every retraction read as an answered question.
 */
export function Watches({
  workId,
  watches,
  canEdit,
  onChanged,
}: {
  workId: number;
  watches: Watch[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const open = watches.filter((w) => !w.resolvedAt);
  const done = watches.filter((w) => w.resolvedAt);

  // ⚠️ Nothing at all when there is nothing to say and nobody who could add
  // one. A reader still sees an open watch — it is a warning about the record
  // they are reading, and hiding it would let a contradictory series pass as
  // settled fact.
  if (!canEdit && open.length === 0) return null;

  async function run(what: () => Promise<unknown>) {
    setBusy(true);
    setSaid(null);
    try {
      await what();
      onChanged();
    } catch (err) {
      setSaid(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const add = () => {
    const trimmed = note.trim();
    if (!trimmed) {
      setSaid('Say what needs checking — a mark with no reason is one you cannot act on later.');
      return;
    }
    return run(async () => {
      await api.addWatch(workId, trimmed);
      setNote('');
      setAdding(false);
    });
  };

  return (
    <section className="panel">
      <div className="panel__head">
        <h3>
          To check {open.length > 0 && <span className="count">({open.length})</span>}
        </h3>
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)} disabled={busy}>
            Add a note
          </button>
        )}
      </div>

      {open.length === 0 && done.length === 0 && (
        <p className="muted small">
          Nothing flagged. Add a note when something about this book looks wrong and you want to
          come back to it.
        </p>
      )}

      {adding && (
        <div className="stack">
          <label className="field">
            <span className="field__label">What needs checking?</span>
            <textarea
              value={note}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. series contradicts #215 — both cite a real source"
              disabled={busy}
            />
          </label>
          <div className="row-tight">
            <button className="primary" onClick={add} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setNote('');
                setSaid(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {(open.length > 0 || done.length > 0) && (
        <ul className="plain">
          {[...open, ...done].map((w) => (
            <li key={w.id} className={w.resolvedAt ? 'muted' : undefined}>
              <p>{w.note}</p>
              <div className="row-tight">
                <span className="muted small">
                  {w.resolvedAt ? `Checked ${w.resolvedAt.slice(0, 10)}` : w.createdAt.slice(0, 10)}
                  {w.raisedByName ? ` · ${w.raisedByName}` : ''}
                  {/* ⚠️ Shown only when a machine raised it. `decided_how`'s rule
                      from migration 0013, applied here: a value a run wrote
                      unread must stay distinguishable from one a person
                      asserted, and the moment to say so is when it is free. */}
                  {w.raisedHow === 'auto' ? ' · raised automatically' : ''}
                </span>
                {canEdit && !w.resolvedAt && (
                  <button
                    className="chip"
                    disabled={busy}
                    onClick={() => run(() => api.resolveWatch(workId, w.id))}
                  >
                    I've checked it
                  </button>
                )}
                {canEdit && (
                  <button
                    className="chip danger"
                    disabled={busy}
                    onClick={() => run(() => api.deleteWatch(workId, w.id))}
                    title="Raised by mistake — removes it without recording that anybody looked"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {said && <p className="muted small">{said}</p>}
    </section>
  );
}
