import { useEffect, useState } from 'react';
import { api, type Me, type WorkSummary } from '../api.js';
import { AddWork } from '../components/AddWork.js';
import { formatLabel } from '../lib/formats.js';

/**
 * The collection.
 *
 * Series-rooted ordering comes from SQL (`ORDER BY series, series_index_sort`),
 * not from the client — the sibling project's migration 0019 concluded that a
 * line belongs in a column, and this is the read side of that decision.
 */
export function CollectionPage({ me, onOpen }: { me: Me; onOpen: (id: number) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<WorkSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const canEdit = me.capabilities.includes('editCatalog');

  function reload() {
    setLoading(true);
    api
      .collection({ q })
      .then((r) => {
        setRows(r.rows);
        setTotal(r.total);
      })
      .finally(() => setLoading(false));
  }

  // Debounced so typing a title is one query, not one per keystroke against a
  // LIKE over the whole table.
  useEffect(() => {
    const t = setTimeout(reload, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <main>
      <div className="toolbar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or author…"
          aria-label="Search"
        />
        {canEdit && (
          <button className="primary" onClick={() => setAdding(true)}>
            Add a book
          </button>
        )}
      </div>

      {adding && (
        <AddWork
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            reload();
          }}
        />
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          {q ? 'Nothing matches that.' : 'Nothing here yet. Add the first book.'}
        </p>
      ) : (
        <>
          <p className="muted small">{total} works</p>
          <ul className="works">
            {rows.map((w) => (
              <li key={w.id}>
                <button className="row-open" onClick={() => onOpen(w.id)} aria-label={`Open ${w.title}`}>
                {w.coverUrl ? (
                  <img src={w.coverUrl} alt="" width={44} height={66} loading="lazy" />
                ) : (
                  <span className="cover-placeholder" aria-hidden="true" />
                )}
                <div>
                  <strong>{w.title}</strong>
                  {w.series && (
                    <span className="muted small">
                      {' '}
                      · {w.series}
                      {w.seriesIndexDisplay ? ` ${w.seriesIndexDisplay}` : ''}
                    </span>
                  )}
                  <div className="muted small">{w.authors}</div>
                  <div className="muted small">
                    {/* Formats are what makes "in audio and paperback but not ebook" a
                        query. Shown here because it is the question the shelf cannot
                        answer by being looked at. */}
                    {w.formats
                      ? w.formats.split(',').map(formatLabel).join(' · ')
                      : 'no edition recorded'}
                  </div>
                </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
