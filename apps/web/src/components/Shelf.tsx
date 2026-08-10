/**
 * A horizontal strip of covers — "recently added", and nothing else yet.
 *
 * ## ⚠️ Why "recently added" is `created_at` and not a file date
 *
 * The audiobook catalog keeps `site/additions_log.json` as an append-only record
 * precisely because it learned that file modification times lie: a re-sync, a
 * folder move or a metadata rewrite all touch mtime and none of them means the
 * book is new. Here the equivalent honest answer already exists — `work.created_at`
 * is when the row was catalogued, written once by SQLite and never updated after.
 *
 * That does mean the whole ebook import shares one timestamp, which is *correct*:
 * they were catalogued together. `id` breaks the tie so the order is stable
 * between requests rather than arbitrary.
 */

import type { WorkSummary } from '../api.js';
import { Cover } from './Cover.js';

export function Shelf({
  title,
  rows,
  onOpen,
  action,
}: {
  title: string;
  rows: WorkSummary[];
  onOpen: (id: number) => void;
  action?: React.ReactNode;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="shelf">
      <div className="shelf__head">
        <h2>{title}</h2>
        {action}
      </div>
      <ul className="shelf__strip">
        {rows.map((w) => (
          <li key={w.id}>
            <button className="shelf__item" onClick={() => onOpen(w.id)} aria-label={`Open ${w.title}`}>
              <Cover src={w.coverUrl} title={w.title} authors={w.authors} size="grid" />
              <span className="shelf__title">{w.title}</span>
              <span className="muted small">{w.authors}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
