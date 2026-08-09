import { useEffect, useState } from 'react';
import { api, type Me } from '../api.js';
import { Enrich } from '../components/Enrich.js';
import { Reviews } from '../components/Reviews.js';
import { formatLabel } from '../lib/formats.js';

/**
 * One book: what it is, which printings we hold, and what we thought.
 *
 * The three sections mirror the schema's three layers deliberately —
 * work / edition / copy — because that split is the thing a person has to
 * understand to use this app correctly. "I own the paperback but not the ebook"
 * is only answerable if the page shows editions and copies as different things.
 */

interface WorkDetail {
  work: {
    id: number;
    title: string;
    subtitle: string | null;
    authors: string;
    series: string | null;
    seriesIndexDisplay: string | null;
    firstPublished: number | null;
    coverUrl: string | null;
    workKey: string;
  };
  editions: {
    id: number;
    format: string;
    isbn13: string | null;
    asin: string | null;
    publisher: string | null;
    published_year: number | null;
    pages: number | null;
    source: string;
  }[];
  copies: {
    id: number;
    status: string;
    location: string | null;
    condition: string | null;
    lent_to: string | null;
    is_signed: number;
  }[];
  reading: {
    read_state: string;
    started_on: string | null;
    finished_on: string | null;
    read_format: string | null;
  } | null;
}

const READ_STATES = [
  ['unread', 'Unread'],
  ['reading', 'Reading'],
  ['read', 'Read'],
  ['dnf', 'Did not finish'],
  ['reference', 'Reference'],
] as const;

export function WorkPage({
  workId,
  me,
  onBack,
}: {
  workId: number;
  me: Me;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .work(workId)
      .then((d) => setDetail(d as unknown as WorkDetail))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);

  async function setReadState(state: string) {
    if (!detail) return;
    // A PUT replaces the whole read-state, so the dates have to travel with it —
    // sending only `readState` silently clears them, which is the schema's
    // documented behaviour and easy to get wrong here.
    await api.setReading(workId, {
      readState: state,
      startedOn: detail.reading?.started_on ?? null,
      finishedOn:
        state === 'read' && !detail.reading?.finished_on
          ? new Date().toISOString().slice(0, 10)
          : (detail.reading?.finished_on ?? null),
      readFormat: detail.reading?.read_format ?? null,
    });
    load();
  }

  if (error) return <main>Could not load that book: {error}</main>;
  if (!detail) return <main className="muted">Loading…</main>;

  const { work, editions, copies, reading } = detail;
  const canTrack = me.capabilities.includes('trackReading');

  return (
    <main>
      <button onClick={onBack}>← Collection</button>

      <div className="work-head">
        {work.coverUrl ? (
          <img src={work.coverUrl} alt="" width={96} height={144} />
        ) : (
          <span className="cover-placeholder large" aria-hidden="true" />
        )}
        <div>
          <h2>{work.title}</h2>
          {work.subtitle && <p className="muted">{work.subtitle}</p>}
          <p>{work.authors}</p>
          {work.series && (
            <p className="muted small">
              {work.series}
              {work.seriesIndexDisplay ? ` · ${work.seriesIndexDisplay}` : ''}
            </p>
          )}
        </div>
      </div>

      {canTrack && (
        <section className="panel">
          <h3>Your reading</h3>
          <div className="row-tight" role="group" aria-label="Read state">
            {READ_STATES.map(([value, label]) => (
              <button
                key={value}
                className={reading?.read_state === value ? 'primary chip' : 'chip'}
                aria-pressed={reading?.read_state === value}
                onClick={() => void setReadState(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {reading?.finished_on && (
            <p className="muted small">
              Finished {reading.finished_on}
              {reading.read_format ? ` (${reading.read_format})` : ''}
            </p>
          )}
        </section>
      )}

      <section className="panel">
        <h3>Editions</h3>
        {editions.length === 0 ? (
          <p className="muted small">No printing recorded yet.</p>
        ) : (
          <ul className="plain">
            {editions.map((e) => (
              <li key={e.id}>
                <strong>{formatLabel(e.format)}</strong>
                <span className="muted small">
                  {[e.publisher, e.published_year, e.pages ? `${e.pages}pp` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <div className="muted small">
                  {e.isbn13 && <>ISBN {e.isbn13} </>}
                  {e.asin && <>ASIN {e.asin} </>}
                  {/* Where the row came from, because a re-sync may overwrite an
                      imported row and must never overwrite a typed one. */}
                  <em>from {e.source}</em>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h3>Copies</h3>
        {copies.length === 0 ? (
          <p className="muted small">
            Nothing recorded as owned. An edition existing is not the same as a copy on
            the shelf.
          </p>
        ) : (
          <ul className="plain">
            {copies.map((c) => (
              <li key={c.id}>
                <strong>{c.status}</strong>
                <span className="muted small">
                  {[c.location, c.condition, c.is_signed ? 'signed' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {c.lent_to && <div className="muted small">Lent to {c.lent_to}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {me.capabilities.includes('editCatalog') && (
        <Enrich workId={workId} hasCover={!!work.coverUrl} onApplied={load} />
      )}

      <Reviews workId={workId} me={me} />
    </main>
  );
}
