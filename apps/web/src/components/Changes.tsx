import { useState } from 'react';
import { api, type ChangeView } from '../api.js';

/**
 * The Changes panel — `change_log` read back, newest first, grouped by save.
 *
 * Visible to `read` (it is a household); written by no one — audit rows land
 * only in the same `db.batch()` as the mutation they describe, and there is
 * no write route. Loaded on demand rather than with the page: most visits
 * never open it, and the book page already makes enough requests.
 *
 * `__row__` rows are the whole-row events: creation (old null) and deletion
 * (new null — though a deleted book's page is gone, so in practice the panel
 * shows creations). They render as sentences rather than diffs, because
 * "added by Shane, 12 Aug" is the fact wanted; the row JSON is the undo
 * material, not reading matter.
 */

/** A stored value, shortened for a panel row. */
function short(v: unknown): string {
  if (v === null || v === undefined) return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

export function Changes({ workId }: { workId: number }) {
  const [open, setOpen] = useState(false);
  const [changes, setChanges] = useState<ChangeView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && changes === null) {
      api
        .workChanges(workId)
        .then((r) => setChanges(r.changes))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <section className="panel">
      <div className="section-head">
        <h3>Changes</h3>
        <button onClick={toggle} aria-expanded={open}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open && error && <p className="muted small">Could not load the history: {error}</p>}
      {open && !error && changes === null && <p className="muted small">Loading…</p>}
      {open && changes !== null && changes.length === 0 && (
        <p className="muted small">
          No changes recorded. The log starts when this feature shipped — silence before that
          is absence of records, not absence of edits.
        </p>
      )}

      {open && changes !== null && changes.length > 0 && (
        <ul className="reviews">
          {changes.map((ch) => (
            <li key={ch.id}>
              <div className="row-tight">
                <strong>
                  {ch.field === '__row__'
                    ? ch.newValue === null
                      ? 'Deleted'
                      : 'Added'
                    : ch.field}
                </strong>
                <span className="muted small">
                  {ch.createdAt}
                  {' · '}
                  {/* 'auto' rows are the details queue and the importers —
                      recorded and distinguished, never skipped. A person's
                      name only when the account still exists. */}
                  {ch.changedHow === 'human' ? (ch.changedByName ?? 'someone') : 'automatic'}
                </span>
              </div>
              {ch.field !== '__row__' && (
                <p className="small">
                  {short(ch.oldValue)} → {short(ch.newValue)}
                </p>
              )}
              {ch.note && <p className="muted small">{ch.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
