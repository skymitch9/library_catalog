import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COLLECTION_PAGE_SIZES, COPY_STATUSES, EDITION_MEDIA, READ_STATES } from '@lc/core';
import {
  api,
  type CollectionFacets,
  type DuplicatesResponse,
  type Me,
  type Stats,
  type WorkSummary,
} from '../api.js';
import { describeError } from '../lib/errors.js';
import {
  duplicateAuthorLabel,
  duplicateRowDetail,
  duplicatesEmptyMessage,
  duplicatesSummary,
} from '../lib/duplicates-view.js';
import { BulkActionBar } from '../components/BulkActionBar.js';
import { Pager } from '../components/Pager.js';
import { Shelf } from '../components/Shelf.js';
import { WorkList } from '../components/WorkList.js';
import { mediumLabel } from '../lib/formats.js';
import { loadPrefs, savePrefs } from '../lib/prefs.js';
import { syncReadStatesFromRatings, type ReadSyncResult } from '../lib/read-sync.js';
import { ON_THE_WAY, statusLabel } from '../lib/statuses.js';
import {
  BINDING_FILTERS,
  EDITION_KIND_FILTERS,
  Link,
  collectionPath,
  replaceUrl,
  universePath,
  workPath,
  type CollectionFilters,
} from '../router.js';

/**
 * How each format/binding type is written in the multi-type selector. One label
 * per `BINDING_FILTERS` key — the coarse `ebook` and the copy-flag `leatherbound`
 * / cross-catalog `audiobook` have no `formatLabel` entry, so the map is here.
 */
const BINDING_LABEL: Record<string, string> = {
  hardcover: 'Hardcover',
  leatherbound: 'Leatherbound',
  paperback: 'Paperback',
  mass_market: 'Mass market',
  ebook: 'Ebook',
  audiobook: 'Audiobook',
};

/**
 * How each printing kind is written in the same Type control. Two entries, the
 * same words the retired "Printing" select used — `collectors` is the one bucket
 * for every special printing, `unsorted` is the "named, nothing sorted it yet"
 * review list. `editionKindLabel` lived in `lib/formats`; inlined here because
 * `unsorted` was never one of its keys (it is a canned query, not a stored kind).
 */
const KIND_LABEL: Record<string, string> = {
  collectors: "Collector's edition",
  unsorted: 'Named, not sorted',
};

/**
 * The one Type dropdown's checkboxes, the owner's ask of 2026-08-24: the
 * binding/cover types and the printing kinds, in one list, **deduped**. There is
 * nothing to actually dedupe today — `BINDING_FILTERS` and `EDITION_KIND_FILTERS`
 * share no value — but the removed `format` (Edition) select's physical values
 * WERE duplicates of the binding types, and folding it into `bindings` (rather
 * than adding a second `hardcover` row) is where the dedup happens. `group` says
 * which state array a box drives: a binding token or a printing kind.
 */
const TYPE_OPTIONS: { value: string; label: string; group: 'binding' | 'kind' }[] = [
  ...BINDING_FILTERS.map((v) => ({ value: v, label: BINDING_LABEL[v] ?? v, group: 'binding' as const })),
  ...EDITION_KIND_FILTERS.map((v) => ({ value: v, label: KIND_LABEL[v] ?? v, group: 'kind' as const })),
];

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
  // The tier above the series. Composes with it rather than replacing it.
  const [universe, setUniverse] = useState(filters.universe);
  const [medium, setMedium] = useState(filters.medium);
  // The physical shelf. No control of its own — "See all" under the strip is
  // what sets it, and Clear is what turns it off. See `CollectionFilters`.
  const [ebookOnly, setEbookOnly] = useState(filters.ebookOnly);
  // The two halves of the one "Type" dropdown (owner ask 2026-08-24): the
  // binding/cover types and the printing kinds. Kept as two arrays because they
  // are two orthogonal axes in the data and two query params on the wire; the
  // Type control below drives both, and `collectionFilter` ORs them into one
  // group. Replaces the old `format`, `editionKind` and `bindings` states.
  const [bindings, setBindings] = useState<string[]>(filters.bindings);
  const [editionKinds, setEditionKinds] = useState<string[]>(filters.editionKinds);
  const [status, setStatus] = useState(filters.status);
  // The one filter about us rather than about the books — see `NEEDS_FILTERS`.
  const [needs, setNeeds] = useState(filters.needs);
  // ⚠️ Not a narrowing of the list — it REPLACES it. See the render below and
  // `CollectionFilters.duplicates`; the board-game filter this copies is a
  // WHERE clause because its answer is a list, and this answer is groups.
  const [duplicates, setDuplicates] = useState(filters.duplicates);
  // A SEPARATE narrowing from `duplicates` above: books owned in 2+ physical
  // copies across editions (owner ask 2026-08-24). Unlike `duplicates` it does
  // NOT replace the grid — it filters it, so it composes with everything and
  // rides the normal collection query. Its own state + param so the two "twice"
  // controls never interfere.
  const [ownedTwice, setOwnedTwice] = useState(filters.ownedTwice);
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
        filters.universe ||
        filters.medium ||
        filters.bindings.length ||
        filters.editionKinds.length ||
        filters.status ||
        filters.needs ||
        filters.duplicates ||
        filters.ownedTwice ||
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

  // The duplicates read, fetched only when the checkbox is on. `null` is "not
  // asked yet", which the render tells apart from "asked, nothing there" — the
  // distinction the empty state's count exists to make.
  const [dupes, setDupes] = useState<DuplicatesResponse | null>(null);
  const [dupesError, setDupesError] = useState<string | null>(null);

  // -- Multi-select mode --
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  // Scroll to the top when the page changes, and move focus to the list
  // region so a keyboard user lands where the new content starts rather than
  // staying mid-page. The ref sits on the results wrapper; the heading is
  // implicit (the pager above the list is the first focusable landmark).
  const listTopRef = useRef<HTMLDivElement>(null);
  const prevPageRef = useRef(page);
  useEffect(() => {
    if (prevPageRef.current === page) return;
    prevPageRef.current = page;
    window.scrollTo({ top: 0, behavior: 'instant' });
    listTopRef.current?.focus();
  }, [page]);

  const canEdit = me.capabilities.includes('editCatalog');
  // ⚠️ `ebookOnly` counts as filtered, which is what hides the strip once "See
  // all" has expanded it. A strip captioned "Recently added" sitting on top of
  // the same list it just opened is the noise this flag exists to prevent.
  const filtered = Boolean(
    q ||
      series ||
      universe ||
      medium ||
      ebookOnly ||
      bindings.length ||
      editionKinds.length ||
      status ||
      needs ||
      duplicates ||
      readState,
  );

  useEffect(() => savePrefs({ sort, dir, pageSize, view }), [sort, dir, pageSize, view]);

  // Default to hiding ebooks unless the user has explicitly set a filter that
  // implies they want to see them. The strip already does this with a hard-coded
  // `ebookOnly: 'hide'`; the grid follows the same rule so the unfiltered
  // collection is physical books only. Selecting "Ebook" in the medium or format
  // dropdown, or clicking "Show them here too", clears this — and Clear resets
  // it, because Clear sets ebookOnly back to '' which lands here again.
  //
  // `'show'` is the explicit opt-in: send nothing to the API so ebooks appear.
  // `''` (default) means no user choice → hide. `'hide'` means explicitly set.
  const effectiveEbookOnly = ebookOnly === 'show' ? '' : ebookOnly || 'hide';

  const params = useMemo(
    () => ({
      q, series, universe, medium, ebookOnly: effectiveEbookOnly,
      binding: bindings.join(','), editionKind: editionKinds.join(','),
      status, needs, readState,
      // Owned 2+ physical — a narrowing of the grid. `0` when off, dropped by
      // `collectionQuery`.
      owned2: ownedTwice ? 1 : 0,
      sort, dir, page, pageSize,
    }),
    [q, series, universe, medium, effectiveEbookOnly, bindings, editionKinds, status, needs, readState, ownedTwice, sort, dir, page, pageSize],
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
      .catch((err: unknown) => setError(describeError(err)))
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
    universe,
    medium,
    ebookOnly,
    bindings.join(','),
    editionKinds.join(','),
    status,
    needs,
    readState,
    ownedTwice,
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
        universe,
        medium,
        ebookOnly,
        bindings,
        editionKinds,
        status,
        needs,
        duplicates,
        ownedTwice,
        readState,
        sort,
        dir,
        pageSize,
        page: page + 1,
      }),
    );
  }, [q, series, universe, medium, ebookOnly, bindings, editionKinds, status, needs, duplicates, ownedTwice, readState, sort, dir, pageSize, page]);

  // ⚠️ Fetched only while the box is ticked, and re-fetched every time it is
  // ticked rather than cached: the whole point of the screen is to go and fix
  // what it found, so a stale list would still be showing a pair the person
  // just merged. It is one request over five columns, not a keystroke loop.
  useEffect(() => {
    if (!duplicates) {
      setDupes(null);
      setDupesError(null);
      return;
    }
    let live = true;
    setDupesError(null);
    api
      .duplicates()
      .then((r) => {
        if (live) setDupes(r);
      })
      .catch((err: unknown) => {
        if (live) setDupesError(describeError(err));
      });
    return () => {
      live = false;
    };
  }, [duplicates]);

  useEffect(() => {
    api
      .facets({
        q,
        series,
        universe,
        medium,
        ebookOnly: effectiveEbookOnly,
        binding: bindings.join(','),
        editionKind: editionKinds.join(','),
        status,
        needs,
        readState,
        owned2: ownedTwice ? 1 : 0,
      })
      .then(setFacets)
      .catch(() => setFacets(null));
    // ⚠️ **Every param that narrows the LIST is in here too, or the counts stop
    // describing the list they label** — "Ebook (126)" over a physical shelf
    // holding 32 of them is the disagreement `collectionFilter` exists as one
    // builder to prevent.
    //
    // ⚠️ `owned2` was missed when the checkbox landed (F3, 2026-08-25): the grid
    // narrowed to the books held twice while the Series dropdown still read
    // "Cradle (6)" over the whole ~1,100-work collection, so picking a facet
    // that said six gave an empty list. It is threaded end to end — the server
    // already read it (`collectionQueryFrom` is shared with `/collection`, and
    // every facet variant is built from `collectionFilter`), so this call was
    // the only half missing. `facet-list-agreement.test.ts` now pins the rule.
    //
    // ⚠️ `series` was missing for the same reason and with the same effect,
    // found while fixing F3: every facet variant EXCEPT the series one is built
    // from the query it is handed, so with no series in it "Ebook (126)" was
    // counted over the whole collection beside a six-book Cradle shelf. The
    // series facet itself is unaffected — `collectionFacets` drops the series
    // clause server-side before counting it, which is the whole point of
    // `withoutSeries`.
    //
    // ⚠️ `duplicates` is deliberately NOT here: it REPLACES the grid with
    // groups rather than filtering it, so it is not a narrowing at all. Nor are
    // `sort`, `dir`, `page` and `pageSize` — they order and slice the list
    // without changing which books are in it.
  }, [q, series, universe, medium, effectiveEbookOnly, bindings, editionKinds, status, needs, readState, ownedTwice]);

  const loadHeader = useCallback(() => {
    api.stats().then(setStats).catch(() => setStats(null));
    // ⚠️ `ebookOnly: 'hide'` — the strip is the PHYSICAL shelf. Owner,
    // 2026-08-18: *"in the library site its showing recently added for ebooks,
    // remove those. this should just be physical books now since we have an
    // ebook site."* Ebooks live at ebooks.heygabi.ai; this catalog still holds
    // their rows because the split's prune phase has not run, and the rows are
    // what the series pages and the "also as an ebook" chip read. So the strip
    // narrows and nothing is deleted — `EBOOK_ONLY_CLAUSE` in `@lc/db` carries
    // the census and the reason this is not `medium: 'physical'`.
    //
    // Hard-coded rather than read from the filter state: the strip is not a view
    // of this page's filter, it is the way in — it renders only when nothing is
    // filtered at all.
    api
      .collection({ sort: 'added', dir: 'desc', pageSize: 10, ebookOnly: 'hide' })
      .then((r) => setRecent(r.rows))
      .catch(() => setRecent([]));
  }, []);

  useEffect(loadHeader, [loadHeader]);

  /**
   * ⚠️ A rating on the audiobook site means the book was read, and this is the
   * only place that can find that out for the whole shelf at once.
   *
   * The book page derives it for one book when you open it; nobody opens 258
   * book pages. `lib/read-sync.ts` carries the reasoning, the once-per-session
   * guard and every reason a failure here is silent. This page is where it runs
   * because it is the landing screen and it owns both things the answer changes:
   * the "read" stat above and the Read filter below.
   *
   * ⚠️ Refs for the two reloaders. `reload` is rebuilt whenever a filter or a
   * keystroke changes `params`, and listing it as a dependency would restart
   * this effect on every character typed — the sweep itself would no-op on the
   * session flag, but the effect churn is the kind of thing that later grows a
   * real request inside it.
   */
  const reloadRef = useRef(reload);
  const loadHeaderRef = useRef(loadHeader);
  useEffect(() => {
    reloadRef.current = reload;
    loadHeaderRef.current = loadHeader;
  }, [reload, loadHeader]);

  const [readSync, setReadSync] = useState<ReadSyncResult | null>(null);
  useEffect(() => {
    void syncReadStatesFromRatings(me)
      .then((result) => {
        // `null` is "did not run"; an empty `marked` is "ran, nothing to say",
        // which is the answer on every session after the first. Neither is worth
        // a line on screen or a refetch.
        if (!result || result.marked.length === 0) return;
        setReadSync(result);
        loadHeaderRef.current();
        reloadRef.current();
      })
      .catch(() => {
        /* Firestore unreachable, or the API refused. The shelf is still the shelf. */
      });
  }, [me]);

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
          {/* ⚠️ There is deliberately NO "series with gaps" figure here, and it
              is not an oversight — it was built on 2026-08-11 and removed on
              2026-08-12 at the owner's request. Twice now this strip has grown a
              link to the cross-series list to replace the Series button that
              left the top bar, and twice that has been the wrong answer to the
              question it was solving.

              The standing decision: **a gap is answered on the series it belongs
              to, reached from the book that prompted the question.** Every stat
              here describes the shelf you have; a count of what you lack, on the
              collection screen, is a worklist nobody asked for — and a single
              number cannot say WHICH series anyway, so it can only ever be a
              button to somewhere else. `/series` remains a live route for deep
              links and the back button; it just has no entry point, on purpose.
              See `docs/info/completeness-wishlist-relations.md` §1.7. */}
          {stats.readStates
            .filter((r) => r.readState === 'read')
            .map((r) => (
              <Stat key={r.readState} n={r.count} label="read" />
            ))}
        </div>
      )}

      {/* ⚠️ Said out loud, and only when something actually changed. A read
          state that appeared without explanation reads as the app claiming you
          asserted something you did not — the same reason the book page prints
          "Marked read from your audiobook rating" rather than quietly showing a
          chip. It names where to undo it, because the undo is real: pressing any
          chip on a book page stamps 'human' and no sweep may touch it again. */}
      {readSync && readSync.marked.length > 0 && (
        <p className="muted small">
          Marked {readSync.marked.length}{' '}
          {readSync.marked.length === 1 ? 'book' : 'books'} read, from{' '}
          {readSync.considered.toLocaleString()} ratings you have written on the audiobook
          site. Change any of them on the book&rsquo;s own page and it stays changed.
        </p>
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
        <button
          className={selectMode ? 'primary' : ''}
          onClick={() => {
            if (selectMode) clearSelection();
            else setSelectMode(true);
          }}
          aria-pressed={selectMode}
          title={selectMode ? 'Exit select mode' : 'Select multiple books'}
        >
          {selectMode ? '✓ Selecting' : '☐ Select'}
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

          {/* ⚠️ The tier ABOVE the series, sitting directly under it because
              that is the ladder of scope: book, series, world. It composes with
              the series filter rather than replacing it — picking The Cosmere
              and then *Secret Projects* is a real narrowing, not a
              contradiction.

              Same `<select>` in a `.field` as every other control here, for the
              reason `Format` gives: seven dropdowns and one segmented row would
              be two idioms for one job, and a native select is the best thing a
              360px phone can be handed.

              ⚠️ **There is no "in no universe" option and there must not be
              one.** Most of this catalog belongs to no shared world and is
              correctly filed — it is largely children's picture books — so that
              option would be a four-figure worklist made of rows with nothing
              wrong with them. The settled reading elsewhere in this app is the
              same: a NULL `cover_status` means nobody looked, a NULL
              `edition_kind` means ordinary, and neither gets a control.

              All six are always offered, zeroes included, the rule `Format`
              states: physical books are still arriving and a world that is all
              audiobooks today will not be forever. */}
          <label className="field">
            <span className="field__label">Universe</span>
            <select
              value={universe}
              onChange={(e) => setUniverse(e.target.value)}
              title="A shared world, across the series in it"
            >
              <option value="">Any universe</option>
              {facets?.universes.map((u) => (
                <option key={u.name} value={u.name}>
                  {u.name} ({u.count})
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

          {/* ⚠️ ONE consolidated "Type" control — a dropdown of checkboxes, the
              owner's ask of 2026-08-24: *"the type filter needs to be a dropdown
              with checkboxes in it … Remove the printing filter, and move the
              printing options into the same checkbox dropdown."* It replaces
              THREE controls that used to sit here — the "Edition" (exact
              `format`) select, the old "Type" binding checkboxes, and the
              "Printing" (`editionKind`) select — folding all of them into one
              list. The coarse "Format" (medium) select above stays; it answers a
              different question (paper-or-file), and the panel note says which
              way each cuts.

              ⚠️ The options are the DEDUPED union of the binding/cover types and
              the printing kinds (`TYPE_OPTIONS`). "Deduped" is why the removed
              Edition select's physical values do not reappear as second
              `hardcover`/`paperback` rows: those fold into the binding tokens on
              parse (`legacyFormatBinding`), so each value shows once.

              ⚠️ EXISTS and OR, like the filters around it — a checked box means
              the book HAS an edition/copy of that type or kind, and any one box
              matching is enough (`collectionFilter` ORs them). No facet counts:
              a GROUP BY per box per keystroke is the cost the facets note warns
              against, and the old binding checkboxes carried none either.

              A dropdown rather than a loose row of checkboxes because the owner
              asked for a dropdown, and because eight boxes inline crowd the phone
              panel the other filters share. `TypeFilter` is the disclosure; its
              chrome is drawn from the same `--et-*` tokens as the selects beside
              it, and it is keyboard-reachable (Escape closes, outside-click
              closes). */}
          <TypeFilter
            options={TYPE_OPTIONS}
            selected={[...bindings, ...editionKinds]}
            onChange={(next) => {
              setBindings(next.filter((v) => (BINDING_FILTERS as readonly string[]).includes(v)));
              setEditionKinds(
                next.filter((v) => (EDITION_KIND_FILTERS as readonly string[]).includes(v)),
              );
            }}
          />

          {/* ⚠️ Filters WORKS by whether any copy has this status — which is
              why the wishlist is its own screen and not this control. A wanted
              hardcover of a book already held as an EPUB is invisible here; the
              work is in the collection either way. Kept because "show me the
              books with something lent out" is a real question this answers.

              ⚠️ **It is also the "show sold" control**, and deliberately not a
              second widget beside it. Since 2026-08-23 (owner decision #3) the
              collection hides a work whose copies are ALL sold — the book has
              left the house and nothing was deleted, `NOT_ONLY_SOLD` in
              `@lc/db` — and picking "Sold" here is how you get them back. A
              separate "show sold" checkbox would be a second way to say one
              thing, and the two would disagree the first time either moved.

              ⚠️ Its count is taken with the hiding clause dropped, so the
              option is never disabled by the very rule it exists to lift. */}
          <label className="field">
            <span className="field__label">Copies</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status — sold hidden</option>
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
              {/* The remediation queue for "Add without an author" (0120).
                  Derived from the row itself — authors is the sentinel — so
                  this count and the card mark cannot disagree. */}
              <option value="author">
                Author unknown{facets ? ` (${facets.needs.author})` : ''}
              </option>
              <option value="any">Any of these</option>
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

          {/* ⚠️ Placed here, last before Clear, because that is where the
              Board Game Catalog puts it — `apps/web/src/pages/CollectionPage.tsx:299`
              there, a `.check-inline` checkbox reading "We own 2+", after the
              other filters and before the Clear button. The owner asked to
              mimic that filter rather than design one, so the position and the
              shape of the control are the sibling's; only the words differ,
              because it answers a different question here (see
              `packages/core/src/duplicates.ts`).

              `.row-tight` and not `.check-inline`: this app's checkbox grammar
              is `.row-tight` + a `<span>` (Copies.tsx, WorkFields.tsx), and
              importing the sibling's class name to hold the sibling's layout
              would be a second idiom for one job. Same placement, this app's
              chrome. */}
          <label className="row-tight" title="Books that look like the same work recorded twice">
            <input
              type="checkbox"
              checked={duplicates}
              onChange={(e) => setDuplicates(e.target.checked)}
            />
            <span>Recorded twice</span>
          </label>

          {/* A SEPARATE control from "Recorded twice": that finds duplicate
              RECORDS (two rows for one book); this narrows to books you own in
              2+ PHYSICAL copies across editions (owner ask 2026-08-24). Two
              different questions, two checkboxes — folding them together once hid
              the record-finder and narrowed the whole collection by surprise. */}
          <label className="row-tight" title="Books you own two or more physical copies of, across editions">
            <input
              type="checkbox"
              checked={ownedTwice}
              onChange={(e) => setOwnedTwice(e.target.checked)}
            />
            <span>Owned 2+ (physical)</span>
          </label>

          {filtered && (
            <button
              onClick={() => {
                setQ('');
                setSeries('');
                setUniverse('');
                setMedium('');
                // The only way back to the whole catalog from a "See all" —
                // this narrowing has no control of its own, so Clear is its
                // escape hatch and must not forget it.
                setEbookOnly('');
                setBindings([]);
                setEditionKinds([]);
                setStatus('');
                setNeeds('');
                setDuplicates(false);
                setOwnedTwice(false);
                setReadState('');
              }}
            >
              Clear
            </button>
          )}

          {/* The other half of the pair, and only once a world is chosen. This
              control gives a flat, sortable, pageable list; the universe page
              gives the *spread* — the same world grouped across its series,
              with each heading a way into that series' own ladder. Neither
              replaces the other, so the way across is a link rather than a
              choice made for the reader.

              A `.chip` and not a `<p>`: it is somewhere to go, and everything
              else on this row is a control. */}
          {universe && (
            <p className="controls__note">
              <Link to={universePath(universe)} className="chip">
                See {universe} grouped by series →
              </Link>
            </p>
          )}

          {/* ⚠️ Written down for the reason the three notes below it are: the
              wrong guess is silent, and here the wrong guess is the damaging
              one. Somebody reading "Universe (6)" over a catalog of hundreds
              will read the other hundreds as unclassified — as a backlog. They
              are not. A picture book belongs to no shared world, that is the
              correct answer, and nothing in this app will ever ask anybody to
              fix it. */}
          {/* ⚠️ Written down for the reason the three notes below it are: the
              wrong guess is silent, and this is the guess the sibling catalog
              would lead a person to make. There, "duplicates" means TWO COPIES;
              here two copies is an ordinary holding and is never flagged. Said
              in words, on the screen, rather than left to be discovered from an
              empty result. */}
          {duplicates && (
            <p className="controls__note muted">
              <b>Recorded twice</b> means the same book is in the catalog as two separate
              records — usually one typed with its series in the title and one without.
              Owning two copies of a book is <b>not</b> a duplicate and is never listed
              here. Nothing is merged for you: open each record and decide.
            </p>
          )}

          <p className="controls__note muted">
            A <b>universe</b> is the tier above a series — one world shared across several
            of them, like Elantris and Mistborn both being the Cosmere. Most books belong to
            none, which is the ordinary answer and not a gap.
          </p>

          {/* ⚠️ The one sentence that says which way Format and Type cut. It is
              written down because the answer is not guessable and the wrong guess
              is silent: "Physical" here is *has a physical edition*, so the same
              book on the shelf and on the Kindle is under both, and the two counts
              add up to more than the collection. The Type boxes are OR-ed — any
              one ticked box matching is enough — so ticking several widens rather
              than narrows. Kept visible rather than hidden in a tooltip — a phone
              has no hover. */}
          <p className="controls__note muted">
            <b>Format</b> and <b>Type</b> match a book that <b>has</b> one, not one that has
            only that — a book held on the shelf and on a screen is under both. Tick more than
            one Type box and you get the books matching <b>any</b> of them.
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
              "Collector's edition" and "Named, not sorted" are the two printing
              boxes now living inside the Type dropdown. Somebody will read
              "Collector's edition" and expect only the books whose printing was
              literally sold under that name, when it is the one bucket every
              exclusive, deluxe, premium, signed and leatherbound printing was
              normalised into — and the shop's own wording is still printed on the
              book page, unchanged. */}
          <p className="controls__note muted">
            In <b>Type</b>, <b>Collector's edition</b> is one bucket for every special
            printing — exclusive, deluxe, premium, signed, leatherbound. Each book page still
            shows the name the shop gave it. <b>Named, not sorted</b> is the short list to look
            at by hand.
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
          /* ⚠️ Written down for the reason the filter panel's four notes are:
             the wrong guess is silent. Somebody who added an ebook and does not
             see it here would read this strip as broken. Worded and NOT a link
             — ebooks.heygabi.ai is permission-gated and this app cannot see who
             holds that grant, so a link here would offer half the household a
             door that refuses them. */
          note={
            <>
              Physical books only. The household's ebooks have their own shelf now — they
              are on the ebooks site, not in this catalog's recent additions.
            </>
          }
          action={
            <button
              className="link"
              onClick={() => {
                setSort('added');
                setDir('desc');
                // ⚠️ The third line, and it is what makes "See all" honest:
                // without it the list you land on is a DIFFERENT list from the
                // strip you clicked, with the ebooks back in it.
                setEbookOnly('hide');
              }}
            >
              See all
            </button>
          }
        />
      )}

      {/* ⚠️ The narrowing "See all" applied, said out loud, with its own way
          out. It is the one filter with no control in the panel, so without
          this line a shorter list has no visible cause — and a count that
          quietly disagrees with the catalog is the silent-wrong-guess this page
          writes notes to prevent everywhere else. The button is the escape
          hatch a person will actually find; Clear is the other one.

          Only when the user EXPLICITLY set it (via "See all") — in the default
          case the strip's own note already says "Physical books only", and
          doubling it would be noise. */}
      {ebookOnly === 'hide' && (
        <p className="controls__note muted">
          Physical books only — books held <b>only</b> as an ebook file are on the ebooks
          site.{' '}
          <button className="link" onClick={() => setEbookOnly('show')}>
            Show them here too
          </button>
        </p>
      )}

      {/* ⚠️ The duplicates view REPLACES the grid rather than narrowing it, and
          the pager goes with it. A person merging by hand has to see the two
          records side by side; a flat page ordered by series would put them
          wherever their series happened to fall, which is how the pair came to
          exist. The sibling's filter can stay a WHERE clause because its answer
          is still a list — see the route's comment. */}
      {duplicates ? (
        dupesError ? (
          <p className="notice notice--bad">Could not look for duplicates: {dupesError}</p>
        ) : !dupes ? (
          <p className="muted">Looking for duplicates…</p>
        ) : dupes.groups.length === 0 ? (
          <p className="muted">{duplicatesEmptyMessage(dupes.totalWorks)}</p>
        ) : (
          <div className="results" aria-label="Duplicate records">
            <p className="muted">{duplicatesSummary(dupes.groups)}</p>
            {dupes.groups.map((group) => (
              <div key={group.key} className="panel">
                <ul className="plain">
                  {group.works.map((w) => (
                    <li key={w.id} className="row-tight">
                      {/* A real link, like the cards in `WorkList` — the whole
                          deliverable is being able to open both records and
                          decide. There is deliberately no merge button: merging
                          moves `work_key`, which the audiobook catalog's reviews
                          join on, and that is a migration rather than a click. */}
                      <Link to={workPath(w.id)}>{w.title}</Link>
                      <span className="muted small">{duplicateAuthorLabel(w.authors)}</span>
                      <span className="muted small">{duplicateRowDetail(w)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      ) : error ? (
        <p className="notice notice--bad">Could not load the collection: {error}</p>
      ) : loading && rows.length === 0 ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          {filtered ? 'Nothing matches that.' : 'Nothing here yet. Add the first book.'}
        </p>
      ) : (
        <div
          ref={listTopRef}
          tabIndex={-1}
          className={loading ? 'results results--stale' : 'results'}
          aria-label="Book list"
        >
          <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
          {/* No `onOpen`: the cards are real links now — see `WorkList`. The
              prop is still threaded to `Shelf`, which is still a button. */}
          <WorkList
            rows={rows}
            view={view}
            selectMode={selectMode}
            selected={selected}
            onToggleSelect={toggleSelect}
          />
          <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </div>
      )}

      <BulkActionBar selected={selected} onClear={clearSelection} onDone={reload} />
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

/**
 * The consolidated "Type" filter — a disclosure button that opens a panel of
 * checkboxes (owner ask, 2026-08-24). It sits in the filter row looking like the
 * `<select>`s beside it, but a native `<select multiple>` is a poor phone control
 * and cannot show "3 selected", so this is a button + `--et-*`-themed panel.
 *
 * ⚠️ It works a FLAT token list — the caller merges its two state arrays
 * (bindings + editionKinds) into `selected` and splits `onChange`'s result back.
 * The component neither knows nor cares which axis a token belongs to; the label
 * comes from `options`.
 *
 * Keyboard + dismissal: the button toggles, Escape closes and returns focus to
 * it, a click or focus outside the control closes it. The checkboxes are native,
 * so Tab and Space already work inside the panel.
 */
function TypeFilter({
  options,
  selected,
  onChange,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on a click or focus that lands outside the control, and on Escape.
  // Both listeners are attached only while open, so a filter panel full of
  // controls is not paying for a document-level handler it does not need.
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('focusin', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('focusin', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // "Any type" when nothing is ticked; the labels themselves while they still
  // fit; a count once there are too many to read at a glance in the button.
  const chosen = options.filter((o) => selected.includes(o.value));
  const summary =
    chosen.length === 0
      ? 'Any type'
      : chosen.length <= 2
        ? chosen.map((o) => o.label).join(', ')
        : `${chosen.length} selected`;

  const toggle = (value: string, checked: boolean) =>
    onChange(checked ? [...selected, value] : selected.filter((v) => v !== value));

  return (
    <div className={`field type-filter${chosen.length ? ' type-filter--active' : ''}`} ref={rootRef}>
      <span className="field__label" id="type-filter-label">
        Type
      </span>
      <button
        ref={buttonRef}
        type="button"
        className="type-filter__button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-labelledby="type-filter-label"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="type-filter__summary">{summary}</span>
        <span aria-hidden="true" className="type-filter__caret">
          ▾
        </span>
      </button>
      {open && (
        <div className="type-filter__panel" role="group" aria-labelledby="type-filter-label">
          {options.map((o) => (
            <label className="row-tight" key={o.value}>
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={(e) => toggle(o.value, e.target.checked)}
              />
              <span>{o.label}</span>
            </label>
          ))}
          {chosen.length > 0 && (
            <button type="button" className="link type-filter__clear" onClick={() => onChange([])}>
              Clear types
            </button>
          )}
        </div>
      )}
    </div>
  );
}
