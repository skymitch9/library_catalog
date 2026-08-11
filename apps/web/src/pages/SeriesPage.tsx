import { useEffect, useMemo, useState } from 'react';
import { completenessSentence } from '@lc/core';
import { api, type SeriesSummary } from '../api.js';
import {
  replaceUrl,
  seriesListPath,
  type SeriesFilters,
  type SeriesSort,
} from '../router.js';

/**
 * Every series on the shelf, and what is missing from each.
 *
 * ## The gap count is two numbers, always, and never one
 *
 * A single "12 missing" would flatten the whole distinction this feature is
 * about. `certainGaps` is arithmetic over our own shelf — own book 2 and book 4
 * and there is a book 3 — and cannot be wrong. `attestedGaps` rests on the
 * audiobook catalog's curated series column. They are counted apart, coloured
 * apart, and explained apart on the detail page.
 *
 * ⚠️ Since 2026-08-11 **both counts already exclude rungs the household owns on
 * audio** — the exclusion lives in `seriesCompleteness`, not here, so this page
 * and the detail page cannot disagree about which books they are calling
 * missing. `onAudio` gets its own chip rather than being folded into either:
 * "you own it, just not here" is a third state and reads as neither of the
 * other two. See migration 0090 for the bug this fixed.
 *
 * ## ⚠️ Why this filters in the browser when the collection filters on the server
 *
 * The collection holds one page of a 157-row catalog, so a client-side sort
 * would order the page rather than the collection — the kind of wrong that looks
 * right, and the reason `CollectionPage` pushes every decision to SQL.
 *
 * `/api/series` is the opposite shape: it returns **every** series in one
 * response, because computing completeness needs all the rows anyway (see the
 * header of `packages/db/src/series.ts`). There is no page to be wrong about, and
 * a round trip per keystroke would re-run five queries and a group-by to filter
 * a list the browser is already holding. So the search box here is instant and
 * needs no debounce, and the day this list is long enough to want paging is the
 * day the endpoint should page — not the day the filter moves.
 *
 * ## What is deliberately absent
 *
 * There is no "% complete" bar, and there cannot be one honestly: a percentage
 * needs a denominator, and for 26 of this catalog's 27 series nothing on earth
 * has told us how long the series is. A bar reading 10/16 would be inventing
 * the 16 out of "the highest volume anybody happened to mention".
 *
 * There is also no A–Z jump and no letter grouping. The sibling Board Game
 * Catalog has neither across fourteen screens, and its reasoning holds: grouping
 * there is semantic, never an alphabetical bucket. A search box answers "take me
 * to *Cradle*" in four keystrokes; a letter index answers it in a scroll.
 */
export function SeriesPage({
  filters,
  onOpenSeries,
}: {
  /** The query string, parsed. Read once — App keys this page on it. */
  filters: SeriesFilters;
  onOpenSeries: (name: string) => void;
}) {
  const [rows, setRows] = useState<SeriesSummary[] | null>(null);
  const [withoutSeries, setWithoutSeries] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState(filters.q);
  const [sort, setSort] = useState<SeriesSort>(filters.sort);
  const [onlyGaps, setOnlyGaps] = useState(filters.gapsOnly);

  useEffect(() => {
    api
      .seriesList()
      .then((r) => {
        setRows(r.series);
        setWithoutSeries(r.withoutSeries);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // ⚠️ `replaceUrl`, never `navigate` — the search box is live, and a pushState
  // per keystroke buries the Back button under ten copies of one search. Same
  // rule, same reason, as `CollectionPage`; read the comment on `replaceUrl`
  // before changing it.
  useEffect(() => {
    replaceUrl(seriesListPath({ q, sort, gapsOnly: onlyGaps }));
  }, [q, sort, onlyGaps]);

  const shown = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    const matches = rows.filter((s) => {
      if (onlyGaps && s.gaps.length === 0) return false;
      // Name only. A series is a name — there is no author, no blurb and no
      // second field to search, and matching against the gap titles inside it
      // would make "moon" return series that merely contain a book called Moon.
      return needle === '' || s.series.toLowerCase().includes(needle);
    });
    return [...matches].sort(comparators[sort]);
  }, [rows, q, onlyGaps, sort]);

  if (error) return <main className="notice notice--bad">Could not load the series: {error}</main>;
  if (!rows) return <main className="muted">Loading…</main>;

  const withGaps = rows.filter((s) => s.gaps.length > 0).length;
  const certain = rows.reduce((n, s) => n + s.certainGaps, 0);
  const attested = rows.reduce((n, s) => n + s.attestedGaps, 0);
  const narrowed = Boolean(q.trim()) || onlyGaps;

  return (
    <main>
      <h2 className="page-title">Series</h2>

      <div className="stat-strip" role="group" aria-label="Series at a glance">
        <Stat n={rows.length} label="series" />
        <Stat n={withGaps} label="with gaps" />
        <Stat n={certain} label="certainly missing" />
        <Stat n={attested} label="missing on a source's word" />
      </div>

      <p className="muted small">
        {/* Said out loud rather than implied by an absence. "Certainly missing"
            needs no source and cannot be wrong; the other number is only as good
            as the audiobook catalog, and the detail page names it per volume. */}
        <strong>Certainly missing</strong> is worked out from the volume numbers you already
        own — a book 2 and a book 4 mean there is a book 3. Everything else rests on a named
        source, and nothing here ever guesses how long a series is.
        {withoutSeries > 0 && (
          <>
            {' '}
            {withoutSeries} {withoutSeries === 1 ? 'book is' : 'books are'} in no series at all.
          </>
        )}
      </p>

      {/* The same two rows the collection uses — a full-width search on its own
          line, then the controls under it — rather than a shape invented here.
          `.toolbar` and `.controls` are already responsive at 360px and already
          give every control the 44px target this app holds itself to. */}
      <div className="toolbar">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a series…"
          aria-label="Find a series"
        />
      </div>

      <div className="controls">
        <label className="field">
          <span className="field__label">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SeriesSort)}>
            <option value="name">Name</option>
            <option value="missing">Most missing</option>
            <option value="books">Most books</option>
            <option value="audio">Least on audio</option>
          </select>
        </label>

        <button className={onlyGaps ? 'primary' : ''} onClick={() => setOnlyGaps(!onlyGaps)}>
          {onlyGaps ? 'Showing gaps only' : 'Show gaps only'}
        </button>

        {narrowed && (
          <button
            onClick={() => {
              setQ('');
              setOnlyGaps(false);
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Only once the list is narrowed. On a full list it restates a number the
          stat strip is already showing two inches above it. */}
      {narrowed && (
        <p className="muted small">
          {shown.length} of {rows.length} series.
        </p>
      )}

      <ul className="works">
        {shown.map((s) => (
          <li key={s.series}>
            <button className="row-open" onClick={() => onOpenSeries(s.series)}>
              <div className="row-open__text">
                <div className="row-open__head">
                  <strong>{s.series}</strong>
                  {s.certainGaps > 0 && (
                    <span className="mark mark--gap">{s.certainGaps} missing</span>
                  )}
                  {s.attestedGaps > 0 && (
                    <span className="mark mark--attested">{s.attestedGaps} more listed</span>
                  )}
                  {/* ⚠️ Its own chip, not folded into either count above. These
                      books are in the house — they are simply not in this
                      catalog — and before migration 0090 they were being
                      reported as missing. */}
                  {s.onAudio > 0 && (
                    <span className="mark mark--attested">{s.onAudio} on audio</span>
                  )}
                </div>
                <div className="muted small">{completenessSentence(s)}</div>
                <Holdings s={s} />
                {!s.checked && (
                  <div className="muted small">
                    {/* "Nothing found" and "nobody looked" are different facts —
                        migration 0003 exists to keep them apart. */}
                    No source has been asked about this one yet.
                  </div>
                )}
                {/* Suppressed once a length has been recorded by hand: "only
                    your own volume numbers say anything here" stops being true
                    the moment somebody has said how long the series is. */}
                {s.checkOutcome === 'not_found' && s.knownTotal == null && (
                  <div className="muted small">
                    The audiobook catalog has never heard of it, so only your own volume
                    numbers say anything here.
                  </div>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {shown.length === 0 && (
        <p className="muted">
          {narrowed ? 'Nothing matches that.' : 'No series has a gap in it.'}
        </p>
      )}
    </main>
  );
}

/**
 * The orders offered, written once.
 *
 * ⚠️ Every one of them falls back to the name, and that is not tidiness. Twelve
 * of this catalog's 27 series hold exactly one book, so "most books" leaves a
 * dozen rows tied — and `Array.prototype.sort` is only stable within one call,
 * not across the re-sorts a filter change triggers. Without the tiebreak the
 * tied block reshuffles as you type.
 */
const byName = (a: SeriesSummary, b: SeriesSummary) =>
  a.series.localeCompare(b.series, undefined, { sensitivity: 'base' });

const comparators: Record<SeriesSort, (a: SeriesSummary, b: SeriesSummary) => number> = {
  name: byName,
  // Certain gaps first, then the ones resting on a source — the same ordering of
  // confidence the two marks and the detail page use. Collapsing them into one
  // total would rank a series with 6 unverified gaps above one with 5 certain.
  missing: (a, b) =>
    b.certainGaps - a.certainGaps || b.attestedGaps - a.attestedGaps || byName(a, b),
  books: (a, b) => b.owned - a.owned || byName(a, b),
  // ⚠️ "Least on audio" and not "most", because the useful question is which
  // series you have on the shelf but not in your ears. Series with nothing on
  // audio therefore sort first, and among them the biggest — the ones where
  // buying the audio would change the most.
  audio: (a, b) =>
    a.holdings.audio - b.holdings.audio || b.holdings.works - a.holdings.works || byName(a, b),
};

/**
 * What is on the shelf, in works.
 *
 * Zeroes are omitted. Rendering "0 in print" on all 27 rows would be three words
 * of noise per row saying nothing the absence does not already say — and against
 * this catalog it would be all 27, since every physical edition measured on
 * 2026-08-10 belongs to a work with no series.
 */
function Holdings({ s }: { s: SeriesSummary }) {
  const h = s.holdings;
  const parts = [
    h.physical > 0 && `${h.physical} in print`,
    h.ebook > 0 && `${h.ebook} as ebooks`,
    h.audio > 0 && `${h.audio} on audio`,
    // ⚠️ "owned", not "bought". The rule counts held copies as of 2026-08-11 —
    // see `holdings.ts` in `@lc/core`. The old wording claimed a purchase that
    // the data never evidenced.
    h.ownedTwice > 0 && `${h.ownedTwice} owned twice`,
  ].filter((p): p is string => Boolean(p));

  if (parts.length === 0) return null;
  return <div className="muted small">{parts.join(' · ')}</div>;
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="stat">
      <b>{n.toLocaleString()}</b>
      <span>{label}</span>
    </div>
  );
}
