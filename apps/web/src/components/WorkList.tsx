/**
 * The collection, as a cover grid or as rows.
 *
 * Two views, because they answer different questions and the audiobook catalog
 * learned the same thing (`#ab-toggle-view`): a grid is how you find a book you
 * would recognise by its cover, and a list is how you read a series in order.
 * Neither is a better default for both.
 *
 * The whole card and the whole row are the tap target — 44px is not enough on a
 * phone held in one hand in front of a shelf, and a link inside a row is a miss.
 */

import type { WorkSummary } from '../api.js';
import { formatLabel } from '../lib/formats.js';
import { Cover } from './Cover.js';

/**
 * Paid for and not here yet.
 *
 * ⚠️ There is no `owned` counterpart and there should not be one. Being owned is
 * what being in the collection *means*, so a badge saying it on all 140 rows is
 * a badge nobody reads — the rule the sibling Board Game Catalog settled on
 * after doing exactly that. Only the exceptions earn ink, and a book in the post
 * is an exception: it is the one row on the page you cannot go and fetch.
 *
 * The word is "Pre-ordered" and not "on the way", which is the phrasing used for
 * *counts*. A badge names the status of the thing it sits on; a number in the
 * stat strip is a sentence about the shelf.
 */
function PreorderMark({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="mark mark--preordered" title="Paid for and still on its way">
      Pre-ordered
    </span>
  );
}

/** A finished book earns a mark; everything else stays quiet. */
function ReadMark({ state }: { state: string | null }) {
  if (!state || state === 'unread') return null;
  const label =
    state === 'read' ? 'Read' :
    state === 'reading' ? 'Reading' :
    state === 'dnf' ? 'DNF' :
    state === 'reference' ? 'Reference' : state;
  return <span className={`mark mark--${state}`}>{label}</span>;
}

function SeriesLine({ work }: { work: WorkSummary }) {
  if (!work.series) return null;
  return (
    <span className="series-tag">
      {work.series}
      {/* The display value is what the cover says — "Book 2", "Volume 07",
          "Extra 3" — and is deliberately not derived from the sort index. */}
      {work.seriesIndexDisplay ? <b> {work.seriesIndexDisplay}</b> : null}
    </span>
  );
}

export function WorkList({
  rows,
  view,
  onOpen,
}: {
  rows: WorkSummary[];
  view: 'grid' | 'list';
  onOpen: (id: number) => void;
}) {
  if (view === 'grid') {
    return (
      <ul className="grid">
        {rows.map((w) => (
          <li key={w.id}>
            <button className="card" onClick={() => onOpen(w.id)} aria-label={`Open ${w.title}`}>
              <div className="card__art">
                <Cover src={w.coverUrl} title={w.title} authors={w.authors} size="grid" />
                {/* A column, because both can be true at once — see `.card__marks`. */}
                <span className="card__marks">
                  <ReadMark state={w.readState} />
                  <PreorderMark count={w.preordered} />
                </span>
              </div>
              <div className="card__text">
                <strong className="card__title">{w.title}</strong>
                <span className="muted small">{w.authors}</span>
                <SeriesLine work={w} />
              </div>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="works">
      {rows.map((w) => (
        <li key={w.id}>
          <button className="row-open" onClick={() => onOpen(w.id)} aria-label={`Open ${w.title}`}>
            <Cover src={w.coverUrl} title={w.title} size="row" />
            <div className="row-open__text">
              <div className="row-open__head">
                <strong>{w.title}</strong>
                <ReadMark state={w.readState} />
                <PreorderMark count={w.preordered} />
              </div>
              <div className="muted small">{w.authors}</div>
              <div className="row-open__meta">
                <SeriesLine work={w} />
                {/* Formats are what makes "in audio and paperback but not ebook"
                    a query. Shown because it is the question the shelf cannot
                    answer by being looked at. */}
                <span className="muted small">
                  {w.formats
                    ? w.formats.split(',').map(formatLabel).join(' · ')
                    : 'no edition recorded'}
                </span>
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
