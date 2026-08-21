import { useCallback, useState } from 'react';
import { api } from '../api.js';
import { describeError } from '../lib/errors.js';
import { addToTbr } from '../lib/tbr.js';

export interface BulkActionBarProps {
  selected: Set<number>;
  onClear: () => void;
  /** Called after bulk actions complete so the page can refresh its data. */
  onDone: () => void;
}

/**
 * Fixed bottom bar showing bulk actions when books are selected.
 *
 * Two actions: "Add to TBR" and "Mark as Read". Both loop per-book — there are
 * no bulk endpoints — and report progress as they go. Failures are counted
 * rather than interrupting the batch: seeing "3 of 12 failed" is more useful
 * than stopping at the first.
 */
export function BulkActionBar({ selected, onClear, onDone }: BulkActionBarProps) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const count = selected.size;
  if (count === 0) return null;

  const markAsRead = useCallback(async () => {
    setBusy(true);
    const ids = Array.from(selected);
    let done = 0;
    let failed = 0;

    for (const id of ids) {
      setProgress(`Marking as read: ${done + 1} of ${ids.length}…`);
      try {
        await api.setReading(id, { readState: 'read' });
      } catch {
        failed++;
      }
      done++;
    }

    setBusy(false);
    if (failed > 0) {
      setProgress(`Done — ${failed} of ${ids.length} failed.`);
      setTimeout(() => setProgress(null), 4000);
    } else {
      setProgress(null);
    }
    onClear();
    onDone();
  }, [selected, onClear, onDone]);

  const addAllToTbr = useCallback(async () => {
    setBusy(true);
    const ids = Array.from(selected);
    let done = 0;
    let failed = 0;
    let skipped = 0;

    for (const id of ids) {
      setProgress(`Adding to TBR: ${done + 1} of ${ids.length}…`);
      try {
        const keys = await api.tbrKeys(id);
        if (!keys.docId || !keys.doc || keys.held) {
          skipped++;
        } else {
          await addToTbr(keys.collection, keys.docId, keys.doc);
        }
      } catch {
        failed++;
      }
      done++;
    }

    setBusy(false);
    const parts: string[] = [];
    if (failed > 0) parts.push(`${failed} failed`);
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (parts.length > 0) {
      setProgress(`Done — ${parts.join(', ')}.`);
      setTimeout(() => setProgress(null), 4000);
    } else {
      setProgress(null);
    }
    onClear();
    onDone();
  }, [selected, onClear, onDone]);

  return (
    <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
      <span className="bulk-bar__count">
        {count} {count === 1 ? 'book' : 'books'} selected
      </span>

      {progress ? (
        <span className="bulk-bar__progress">{progress}</span>
      ) : (
        <>
          <button className="primary" disabled={busy} onClick={() => void addAllToTbr()}>
            Add to TBR
          </button>
          <button className="primary" disabled={busy} onClick={() => void markAsRead()}>
            Mark as Read
          </button>
        </>
      )}

      <button disabled={busy} onClick={onClear}>
        Cancel
      </button>
    </div>
  );
}
