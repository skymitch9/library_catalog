import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COLLECTION_PAGE_SIZES, COPY_STATUSES, EDITION_MEDIA, READ_STATES } from '@lc/core';
import { api, type CollectionFacets, type Me, type Stats, type WorkSummary } from '../api.js';
import { Pager } from '../components/Pager.js';
import { Shelf } from '../components/Shelf.js';
import { WorkList } from '../components/WorkList.js';
import { editionKindLabel, formatLabel, mediumLabel } from '../lib/formats.js';
import { loadPrefs, savePrefs } from '../lib/prefs.js';
import { ON_THE_WAY, statusLabel } from '../lib/statuses.js';
import { collectionPath, replaceUrl, type CollectionFilters } from '../router.js';

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
 *
 * ## Where the filters live
 *
 * In the URL, and this page is the only writer of them. `filters` is the parsed
 * query string and seeds the state below **once**; App keys this page on that
 * same string, so anything that changes the filters from outside — pressing Back
 * into an earlier search — remounts the page rather than leaving two sources of
 * truth to reconcile.
 *
 * Two things are layered underneath the URL and it is worth keeping them
 * straight. `sort`, `dir` and `pageSize` fall back to the **stored prefs** when
 * the URL is silent, so a bare `/` still opens the way this person likes it,
 * while a link they shared carries what they were looking at. `view` is prefs
 * only, on purpose — it is how the page looks, not what it is showing, and
 * nothing else depends on it.
 */
export function CollectionPage({
  me,
  filters,
  onOpen,
  onAdd,
}: {
  me: Me;
  /** The query string, parsed. Read once; see the note above. */
  filters: CollectionFilters;
  onOpen: (id: number) => void;
  /** Goes to the add screen — the one place all the ways of adding live. */
  onAdd: () => void;
}) {
  const prefs = useMemo(loadPrefs, []);

  const [q, setQ] = useState(filters.q);
  const [series, setSeries] = useState(filters.series);
  const [medium, setMedium] = useState(filters.medium);
  const [format, setFormat] = useState(filters.format);
  // The third format-ish axis — how fancy the printing is. Migration 0050.
  const [editionKind, setEditionKind] = useState(filters.editionKind);
  const [status, setStatus] = useState(filters.status);
  // The one filter about us rather than about the books — see `NEEDS_FILTERS`.
  const [needs, setNeeds] = useState(filters.needs);
  const [readState, setReadState] = useState(filters.readState);
  const [sort, setSort] = useState(filters.sort ?? prefs.sort);
  const [dir, setDir] = useState<'asc' | 'desc'>(filters.dir ?? prefs.dir);
  const [pageSize, setPageSize] = useState(filters.pageSize ?? prefs.pageSize);
  const [view, setView] = useState<'grid' | 'list'>(prefs.view);
  // Opened when a link arrives with one of them set. The collapsed panel shows
  // only a dot beside "Filters", which is enough of a reminder for a filter you
  // just applied and not enough of an explanation for a page somebody sent you.
  const [showFilters, setShowFilters] = useState(
    Boolean(
      filters.series ||
        filters.medium ||
        filters.format ||
        filters.editionKind ||
        filters.status ||
        filters.needs ||
        filters.readState,
    ),
  );

  // 0-based here, 1-based in the URL, converted at both edges. A `?page=0` in
  // the address bar meaning "the first page" is the kind of detail that leaks
  // out of an implementation and never gets put back.
  const [page, setPage] = useState(filters.page - 1);
  const [rows, setRows] = useState<WorkSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [facets, setFacets] = useState<CollectionFacets | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<WorkSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canEdit = me.capabilities.includes('editCatalog');
  const filtered = Boolean(
    q || series || medium || format || editionKind || status || needs || readState,
  );

  useEffect(() => savePrefs({ sort, dir, pageSize, view }), [sort, dir, pageSize, view]);

  const params = useMemo(
    () => ({
      q, series, medium, format, editionKind, status, needs, readState,
      sort, dir, page, pageSize,
    }),
    [q, series, medium, format, editionKind, status, needs, readState, sort, dir, page, pageSize],
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
  //
  // ⚠️ On a *change*, not on arrival — which is why this compares values rather
  // than just listing them as deps. The URL is allowed to come in with a page
  // already on it, and `/?q=dungeon&page=2` resetting itself to page 1 before the
  // first request went out is the shared link not working. Comparing is also
  // what makes it survive StrictMode's deliberate double-mount in dev.
  const filterKey = JSON.stringify([
    q,
    series,
    medium,
    format,
    editionKind,
    status,
    needs,
    readState,
    sort,
    dir,
    pageSize,
  ]);
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current === filterKey) return;
    lastFilterKey.current = filterKey;
    setPage(0);
  }, [filterKey]);

  // The filters go back into the query string so that opening a book and
  // pressing Back returns you to this search, on this page of it.
  //
  // ⚠️ `replaceUrl`, never `navigate` — read the comment on `replaceUrl` before
  // changing this. The search box is live, and a history entry per keystroke
  // would bury the Back button under ten copies of one search. The raw `q` is
  // used rather than the debounced one, so the address bar never disagrees with
  // the box.
  useEffect(() => {
    replaceUrl(
      collectionPath({
        q,
        series,
        medium,
        format,
        editionKind,
        status,
        needs,
        readState,
        sort,
        dir,
        pageSize,
        page: page + 1,
      }),
    );
  }, [q, series, medium, format, editionKind, status, needs, readState, sort, dir, pageSize, page]);

  useEffect(() => {
    api
      .facets({ q, medium, format, editionKind, status, needs, readState })
      .then(setFacets)
      .catch(() => setFacets(null));
  }, [q, medium, format, editionKind, status, needs, readState]);

  const loadHeader = useCallback(() => {
    api.stats().then(setStats).catch(() => setStats(null));
    api
      .collection({ sort: 'added', dir: 'desc', pageSize: 10 })
      .then((r) => setRecent(r.rows))
      .catch(() => setRecent([]));
  }, []);

  useEffect(loadHeader, [loadHeader]);

  // There is no afterWrite() any more. Adding happens on the scan screen now,
  // and coming back unmounts it and mounts this page fresh, so the list and the
  // stat strip refetch on their own — a manual refresh here would be a second
  // request for the data the mount already asked for.

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
          {/* ⚠️ Two numbers, not one. They were one — `wanted + preordered`
              under the word "wanted" — and the sibling Board Game Catalog shows
              what that becomes: 262 "wanted" over a wishlist of 25, because 236
              were pledges already paid for. A BackerKit import is expected here
              shortly and would do the same thing to this figure in an
              afternoon. `on the way` rather than "preordered" because that is
              what somebody would say out loud. */}
          {stats.wanted > 0 && <Stat n={stats.wanted} label="wanted" />}
          {stats.preordered > 0 && <Stat n={stats.preordered} label={ON_THE_WAY} />}
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
        {/* ⚠️ ONE entry point, and it goes to the scan screen.
            It used to open a type-it-in panel here while "Scan" sat separately
            in the top bar — two buttons for one act, in two different places.
            Adding now lands on the screen where every way of adding lives, with
            the barcode tab first and "Type it in" beside it.

            Nothing else goes here. If a new entry point seems necessary it
            almost certainly belongs on the screen it leads to — the sibling
            Board Game Catalog wrote that rule after this row reached five
            buttons of equal weight by accretion. */}
        {canEdit && (
          <button className="primary" onClick={onAdd}>
            + Add books
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

          {/* ⚠️ The coarse axis, and it means HAS — not ONLY.
              Same shape as every other control here (a `<select>` in a `.field`,
              exactly as the sibling Board Game Catalog builds its browse
              filters), because a segmented row of buttons among four dropdowns
              would be a second idiom for one job, and a native select is also
              the best thing a 360px phone can be handed.

              Both options are always offered, including at zero. Physical books
              are only starting to arrive and a BackerKit import is about to add
              a pile of them; a control that came and went with the data would be
              worse than one that currently reads "Physical (0)". */}
          <label className="field">
            <span className="field__label">Format</span>
            <select
              value={medium}
              onChange={(e) => setMedium(e.target.value)}
              title="Books that have an edition of this kind. A book held both ways is in both."
            >
              <option value="">Any format</option>
              {EDITION_MEDIA.map((m) => {
                const facet = facets?.media.find((f) => f.medium === m);
                return (
                  <option key={m} value={m}>
                    {mediumLabel(m)}
                    {facet ? ` (${facet.count})` : ''}
                  </option>
                );
              })}
            </select>
          </label>

          {/* The fine axis, kept beside the coarse one rather than replaced by
              it. Called "Edition" because that is the row it filters on, and
              because two controls both labelled "Format" is how a filter panel
              starts lying about itself. The two compose: Physical + EPUB is
              "on the shelf and also as a file", which is a real question. */}
          <label className="field">
            <span className="field__label">Edition</span>
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="">Any edition</option>
              {facets?.formats.map((f) => (
                <option key={f.format} value={f.format}>
                  {formatLabel(f.format)} ({f.count})
                </option>
              ))}
            </select>
          </label>

          {/* The third format-ish axis, and the one the owner asked for:
              *"for our sanity all editions should be collectors"*. `Format` is
              paper-or-file and `Edition` is the binding; this is whether the
              printing was sold as better than the standard one, which neither of
              the other two can express. A slipcased signed hardcover is all
              three at once.

              Called "Printing" and not "Edition" — that word is already two
              controls up, and two selects labelled the same thing is how a
              filter panel starts lying about itself. Same `<select>` in a
              `.field` as everything else on this row, for the reason `Format`
              gives: five dropdowns and one segmented button group would be two
              idioms for one job, and a native select is the best thing a 360px
              phone can be handed.

              ⚠️ **"Named, not sorted" is not a spare option — it is what keeps
              this column honest.** A NULL `edition_kind` means an *ordinary*
              printing, not an unexamined one (`EDITION_KINDS` in `@lc/core`
              argues it out), and the price of that rule is that an unrecognised
              special edition is filed as ordinary in silence. The rows where
              that could be wrong are the ones carrying a name with no kind, and
              this is that list. It is normally two long. */}
          <label className="field">
            <span className="field__label">Printing</span>
            <select
              value={editionKind}
              onChange={(e) => setEditionKind(e.target.value)}
              title="How fancy the printing is, rather than what it is made of"
            >
              <option value="">Any printing</option>
              <option value="collectors">
                {editionKindLabel('collectors')}
                {facets ? ` (${facets.kinds.collectors})` : ''}
              </option>
              <option value="unsorted">
                Named, not sorted{facets ? ` (${facets.kinds.unsorted})` : ''}
              </option>
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
              {/* ⚠️ Every status, straight off `COPY_STATUSES` — which is what
                  makes "show me what is on the way" a filter that already works
                  rather than a feature. `statusLabel` and not a title-case of
                  the enum: that printed "Preordered" here while the copy panel
                  printed "Pre-ordered", and two spellings read as two things. */}
              {COPY_STATUSES.map((s) => {
                const facet = facets?.statuses.find((f) => f.status === s);
                return (
                  <option key={s} value={s} disabled={!facet}>
                    {statusLabel(s)}
                    {facet ? ` (${facet.count})` : ''}
                  </option>
                );
              })}
            </select>
          </label>

          {/* ⚠️ The one control here that asks about US, not about the books.
              Everything else narrows the collection to a kind of book; this
              narrows it to the books whose record is not finished — and it is
              the way the owner works through them, so it lives beside the rest
              rather than on a screen of its own.

              A `<select>` in a `.field`, like every other filter on this row,
              because a segmented button group among five dropdowns would be a
              second idiom for one job and a native select is the best thing a
              360px phone can be handed.

              ⚠️ "Cover needed" is NOT "no cover". A stand-in has a URL and is
              still wrong — five books share one Illumicrate marketing
              photograph on purpose — and that is exactly the set this exists to
              surface. The note under the panel says so in words. */}
          <label className="field">
            <span className="field__label">Needs</span>
            <select
              value={needs}
              onChange={(e) => setNeeds(e.target.value)}
              title="Books whose record is not finished"
            >
              <option value="">Anything</option>
              <option value="cover">
                Cover needed{facets ? ` (${facets.needs.cover})` : ''}
              </option>
              <option value="watch">To check{facets ? ` (${facets.needs.watch})` : ''}</option>
              <option value="any">Either</option>
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
                setMedium('');
                setFormat('');
                setEditionKind('');
                setStatus('');
                setNeeds('');
                setReadState('');
              }}
            >
              Clear
            </button>
          )}

          {/* ⚠️ The one sentence that says which way the format filter cuts.
              It is written down because the answer is not guessable and the
              wrong guess is silent: "Physical" here is *has a physical edition*,
              so the same book on the shelf and on the Kindle is under both, and
              the two counts add up to more than the collection. Kept visible
              rather than hidden in a tooltip — a phone has no hover. */}
          <p className="controls__note muted">
            Format and Edition match a book that <b>has</b> one, not one that has only that.
            A book held on the shelf and on a screen is under both.
          </p>
          {/* ⚠️ Written down for the same reason the sentence above it is: the
              answer is not guessable and the wrong guess is silent. Somebody
              reading "Cover needed" will assume it means an empty cover, and
              the books it is most important to reach are the ones that have an
              image already. */}
          <p className="controls__note muted">
            <b>Cover needed</b> includes books wearing a stand-in — an image we know is not
            that book's own cover. <b>To check</b> is anything somebody left a note about.
          </p>
          {/* ⚠️ Same reason as the two notes above: the wrong guess is silent.
              Somebody will read "Collector's edition" and expect only the books
              whose printing was literally sold under that name, when it is the
              one bucket every exclusive, deluxe, premium, signed and
              leatherbound printing was normalised into — and the shop's own
              wording is still printed on the book page, unchanged. */}
          <p className="controls__note muted">
            <b>Collector's edition</b> is one bucket for every special printing — exclusive,
            deluxe, premium, signed, leatherbound. Each book page still shows the name the
            shop gave it. <b>Named, not sorted</b> is the short list to look at by hand.
          </p>
        </div>
      )}

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
          {/* No `onOpen`: the cards are real links now — see `WorkList`. The
              prop is still threaded to `Shelf`, which is still a button. */}
          <WorkList rows={rows} view={view} />
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
