import { useCallback, useEffect, useState } from 'react';
import { completenessSentence } from '@lc/core';
import { api, type SeriesCompleteness } from '../api.js';

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
 * ## What is deliberately absent
 *
 * There is no "% complete" bar, and there cannot be one honestly: a percentage
 * needs a denominator, and for 24 of this catalog's 25 series nothing on earth
 * has told us how long the series is. A bar reading 10/16 would be inventing
 * the 16 out of "the highest volume anybody happened to mention".
 */
export function SeriesPage({
  onOpenSeries,
}: {
  onOpenSeries: (name: string) => void;
}) {
  const [rows, setRows] = useState<SeriesCompleteness[] | null>(null);
  const [withoutSeries, setWithoutSeries] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [onlyGaps, setOnlyGaps] = useState(false);

  const load = useCallback(() => {
    api
      .seriesList()
      .then((r) => {
        setRows(r.series);
        setWithoutSeries(r.withoutSeries);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(load, [load]);

  if (error) return <main className="notice notice--bad">Could not load the series: {error}</main>;
  if (!rows) return <main className="muted">Loading…</main>;

  const shown = onlyGaps ? rows.filter((s) => s.gaps.length > 0) : rows;
  const withGaps = rows.filter((s) => s.gaps.length > 0).length;
  const certain = rows.reduce((n, s) => n + s.certainGaps, 0);
  const attested = rows.reduce((n, s) => n + s.attestedGaps, 0);

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

      <div className="controls">
        <button className={onlyGaps ? 'primary' : ''} onClick={() => setOnlyGaps(!onlyGaps)}>
          {onlyGaps ? 'Showing gaps only' : 'Show gaps only'}
        </button>
      </div>

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
                </div>
                <div className="muted small">{completenessSentence(s)}</div>
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

      {shown.length === 0 && <p className="muted">No series has a gap in it.</p>}
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
