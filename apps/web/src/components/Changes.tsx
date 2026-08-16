import { useState } from 'react';
import { api, type ChangeView } from '../api.js';
import { describeError } from '../lib/errors.js';

/**
 * The Changes panel — `change_log` read back, newest first, grouped by save.
 *
 * Visible to `read` (it is a household); written by no one — audit rows land
 * only in the same `db.batch()` as the mutation they describe, and there is
 * no write route. Loaded on demand rather than with the page: most visits
 * never open it, and the book page already makes enough requests.
 *
 * ## ⚠️ Grouped by `batch_id`, and the first real corpus is why
 *
 * Checked against the 19 rows production held on 2026-08-13 (two merges, two
 * key-move fixes, three owner corrections, written as raw SQL while clearing
 * the queue): read flat they are 19 unrelated lines; grouped they are six
 * coherent events — "the retitle", "the merge" — which is the design's own
 * claim (§4.1: "batch_id still groups a save into one event for display"),
 * tested against real data for the first time. Batch ids there are
 * hand-written slugs ('owner-14'), not UUIDs; nothing here may parse them.
 *
 * That corpus also holds `work_key` rows whose note says NO restamp was
 * performed — a key moved on the owner's word with reviews unproven either
 * way. The note is the record; it renders verbatim, because "what happened"
 * includes what deliberately did not.
 *
 * ⚠️ Scoped to THIS work. A merge's reparenting rows live under the edition
 * and copy entities and the merged-away work's id, so the surviving book's
 * panel does not show the merge — a cross-entity event view is a different
 * read (`listChangesForEntity`'s header says so) and is not smuggled in here.
 */

/** A stored value, shortened for a panel row. */
function short(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (v === '') return '""';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

/** Consecutive rows sharing a batch are one event. Input is newest-first. */
function groupByBatch(changes: ChangeView[]): ChangeView[][] {
  const groups: ChangeView[][] = [];
  for (const ch of changes) {
    const last = groups[groups.length - 1];
    if (last && last[0]!.batchId === ch.batchId) last.push(ch);
    else groups.push([ch]);
  }
  return groups;
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
        .catch((err: unknown) => setError(describeError(err)));
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
          {groupByBatch(changes).map((group) => {
            const head = group[0]!;
            return (
              <li key={head.batchId + head.id}>
                <div className="row-tight">
                  <strong>
                    {group.length === 1 && head.field === '__row__'
                      ? head.newValue === null
                        ? 'Deleted'
                        : 'Added'
                      : `${group.length} field${group.length === 1 ? '' : 's'} changed`}
                  </strong>
                  <span className="muted small">
                    {head.createdAt}
                    {' · '}
                    {/* 'auto' rows are the details queue and the importers —
                        recorded and distinguished, never skipped. A person's
                        name only when the account still exists. */}
                    {head.changedHow === 'human' ? (head.changedByName ?? 'someone') : 'automatic'}
                  </span>
                </div>
                {group.map((ch) => (
                  <div key={ch.id}>
                    {ch.field !== '__row__' && (
                      <p className="small">
                        <b>{ch.field}</b>: {short(ch.oldValue)} → {short(ch.newValue)}
                      </p>
                    )}
                    {/* The note is often the whole story — 'reviews restamped:
                        3', or 'KEY MOVE, no restamp performed'. Verbatim. */}
                    {ch.note && <p className="muted small">{ch.note}</p>}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
