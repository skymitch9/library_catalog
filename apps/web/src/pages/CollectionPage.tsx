import { useCallback, useEffect, useMemo, useState } from 'react';
import { COLLECTION_PAGE_SIZES, COPY_STATUSES, READ_STATES } from '@lc/core';
import { api, type CollectionFacets, type Me, type Stats, type WorkSummary } from '../api.js';
import { AddWork } from '../components/AddWork.js';
import { Pager } from '../components/Pager.js';
import { Shelf } from '../components/Shelf.js';
import { WorkList } from '../components/WorkList.js';
import { formatLabel } from '../lib/formats.js';
import { loadPrefs, savePrefs } from '../lib/prefs.js';

/**
 * The collection.
 *
 * ## Everything that decides an order or a page happens on the server
 *
 * Series-rooted ordering comes from SQL (`ORDER BY series, series_index_sort`),
 * not from the client — the sibling project's migration 0019 concluded that a
 * line belongs in a column, and this is the read side of that decision. Sorting
 * and paging follow it for the same reason plus one more: this page holds 50
 * rows of a 117-row catalog, so a client-side sort would order the page rather
 * than the collection, which is the kind of wrong that looks right.
 *
 * ## Two requests, not one
 *
 * The list reloads on every debounced keystroke; the facets only when a filter
 * changes. Folding them together would recompute three GROUP BYs to send bytes
 * nothing redrew — see the note on `/api/collection/facets`.
 */
export function CollectionPage({ me, onOpen }: { me: Me; onOpen: (id: number) => void }) {
  const prefs = useMemo(loadPrefs, []);

  const [q, setQ] = useState('');
  const [series, setSeries] = useState('');
  const [format, setFormat] = useState('');
  const [status, setStatus] = useState('');
  const [readState, setReadState] = useState('');
  const [sort, setSort] = useState(prefs.sort);
  const [dir, setDir] = useState<'asc' | 'desc'>(prefs.dir);
  const [pageSize, setPageSize] = useState(prefs.pageSize);
  const [view, setView] = useState<'grid' | 'list'>(prefs.view);
  const [showFilters, setShowFilters] = useState(false);

  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<WorkSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [facets, setFacets] = useState<CollectionFacets | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<WorkSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canEdit = me.capabilities.includes('editCatalog');
  const filtered = Boolean(q || series || format || status || readState);

  useEffect(() => savePrefs({ sort, dir, pageSize, view }), [sort, dir, pageSize, view]);

  const params = useMemo(
    () => ({ q, series, format, status, readState, sort, dir, page, pageSize }),
    [q, series, format, status, readState, sort, dir, page, pageSize],
  );

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .collection(params)
      .then((r) => {
        setRows(r.rows);
        setTotal(r.total);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [params]);

  // Debounced, so typing a title is one query and not one per keystroke against
  // a LIKE over the whole table.
  useEffect(() => {
    const t = setTimeout(reload, 220);
    return () => clearTimeout(t);
  }, [reload]);

  // A filter change moves you back to the first page. Staying on page 3 of a
  // list that now has one page shows an empty screen that looks like a failure.
  useEffect(() => {
    setPage(0);
  }, [q, series, format, status, readState, sort, dir, pageSize]);

  useEffect(() => {
    api.facets({ q, format, status, readState }).then(setFacets).catch(() => setFacets(null));
  }, [q, format, status, readState]);

  const loadHeader = useCallback(() => {
    api.stats().then(setStats).catch(() => setStats(null));
    api
      .collection({ sort: 'added', dir: 'desc', pageSize: 10 })
      .then((r) => setRecent(r.rows))
      .catch(() => setRecent([]));
  }, []);

  useEffect(loadHeader, [loadHeader]);

  function afterWrite() {
    setAdding(false);
    reload();
    loadHeader();
  }

  return (
    <main>
      {stats && (
        <div className="stat-strip" role="group" aria-label="Collection at a glance">
          {/* Every one of these is counted by the database on this request.
              A literal here was shipped once in this household and was wrong by
              a wide margin. */}
          <Stat n={stats.works} label="books" />
          <Stat n={stats.series} label="series" />
          <Stat n={stats.authors} label="authors" />
          <Stat n={stats.editions} label="editions" />
          {stats.wanted > 0 && <Stat n={stats.wanted} label="wanted" />}
          {stats.readStates
            .filter((r) => r.readState === 'read')
            .map((r) => (
              <Stat key={r.readState} n={r.count} label="read" />
            ))}
        </div>
      )}

      <div className="toolbar">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Title, author or series…"
          aria-label="Search"
        />
        <button
          onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
          aria-label={view === 'grid' ? 'Show as a list' : 'Show as a grid'}
          title={view === 'grid' ? 'Show as a list' : 'Show as a grid'}
        >
          {view === 'grid' ? '☰' : '▦'}
        </button>
        {canEdit && (
          <button className="primary" onClick={() => setAdding(true)}>
            Add
          </button>
        )}
      </div>

      <div className="controls">
        <label className="field">
          <span className="field__label">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="series">Series</option>
            <option value="title">Title</option>
            <option value="author">Author</option>
            <option value="added">Date added</option>
          </select>
        </label>

        <button
          onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}
          aria-label={dir === 'asc' ? 'Sorting ascending' : 'Sorting descending'}
          title={dir === 'asc' ? 'Ascending' : 'Descending'}
        >
          {dir === 'asc' ? '↑ A–Z' : '↓ Z–A'}
        </button>

        <label className="field">
          <span className="field__label">Per page</span>
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {COLLECTION_PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <button
          className={filtered ? 'primary' : ''}
          aria-expanded={showFilters}
          onClick={() => setShowFilters(!showFilters)}
        >
          Filters{filtered ? ' •' : ''}
        </button>
      </div>

      {showFilters && (
        <div className="controls controls--filters">
          <label className="field">
            <span className="field__label">Series</span>
            <select value={series} onChange={(e) => setSeries(e.target.value)}>
              <option value="">All series</option>
              {facets?.series.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.count})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Format</span>
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="">Any format</option>
              {facets?.formats.map((f) => (
                <option key={f.format} value={f.format}>
                  {formatLabel(f.format)} ({f.count})
                </option>
              ))}
            </select>
          </label>

          {/* ⚠️ Filters WORKS by whether any copy has this status — which is
              why the wishlist is its own screen and not this control. A wanted
              hardcover of a book already held as an EPUB is invisible here; the
              work is in the collection either way. Kept because "show me the
              books with something lent out" is a real question this answers. */}
          <label className="field">
            <span className="field__label">Copies</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              {COPY_STATUSES.map((s) => {
                const facet = facets?.statuses.find((f) => f.status === s);
                return (
                  <option key={s} value={s} disabled={!facet}>
                    {s[0]?.toUpperCase() + s.slice(1)}
                    {facet ? ` (${facet.count})` : ''}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Read</span>
            <select value={readState} onChange={(e) => setReadState(e.target.value)}>
              <option value="">Any state</option>
              {READ_STATES.map((s) => (
                <option key={s} value={s}>
                  {s === 'dnf' ? 'Did not finish' : s[0]?.toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </label>

          {filtered && (
            <button
              onClick={() => {
                setQ('');
                setSeries('');
                setFormat('');
                setStatus('');
                setReadState('');
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {adding && <AddWork onClose={() => setAdding(false)} onAdded={afterWrite} />}

      {/* The strip is a way in, not a filter. It would be noise on top of a
          search you are already reading the results of. */}
      {!filtered && page === 0 && (
        <Shelf
          title="Recently added"
          rows={recent}
          onOpen={onOpen}
          action={
            <button
              className="link"
              onClick={() => {
                setSort('added');
                setDir('desc');
              }}
            >
              See all
            </button>
          }
        />
      )}

      {error ? (
        <p className="notice notice--bad">Could not load the collection: {error}</p>
      ) : loading && rows.length === 0 ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          {filtered ? 'Nothing matches that.' : 'Nothing here yet. Add the first book.'}
        </p>
      ) : (
        <div className={loading ? 'results results--stale' : 'results'}>
          <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
          <WorkList rows={rows} view={view} onOpen={onOpen} />
          <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </div>
      )}
    </main>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="stat">
      <b>{n.toLocaleString()}</b>
      <span>{label}</span>
    </div>
  );
}
