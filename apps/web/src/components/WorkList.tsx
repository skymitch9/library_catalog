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
 *
 * ## ⚠️ Why the card is a container and not a `<button>`
 *
 * It was one until the series name became a link. A `<button>`'s content model
 * forbids interactive descendants, so an `<a>` inside it is invalid HTML — and
 * this app is installed to a phone's home screen, where a browser's private
 * repair of bad markup is exactly the thing not to depend on. Nesting a *second*
 * button would be no better.
 *
 * So the card is a plain container, the title is a real link, and that link's
 * `::after` is stretched over the whole card to keep the tap target the size it
 * was — see `.card__open` in the stylesheet. The series link sits above the
 * overlay on `z-index`, which is what makes it reachable rather than swallowed:
 * there is no outer click handler left to stop, because there is no outer
 * handler at all.
 *
 * The side benefit is the one `Link` exists for. These are now real links: the
 * status bar shows where they go, middle-click opens a tab, and "copy link
 * address" works on a book in the grid.
 */

import type { WorkSummary } from '../api.js';
import { formatLabel } from '../lib/formats.js';
import { Link, seriesPath, workPath } from '../router.js';
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

/**
 * The series a book belongs to — and the way into it.
 *
 * ⚠️ A link only when there is a series to link to. `work.series` is null for a
 * standalone, and the whole component renders nothing then rather than an empty
 * anchor pointing at `/series/`.
 *
 * `.series-tag__link` is the treatment the book page already gives this exact
 * link (`WorkPage`), so arriving at a series from a card and from a book looks
 * like one affordance instead of two.
 */
function SeriesLine({ work }: { work: WorkSummary }) {
  if (!work.series) return null;
  return (
    <span className="series-tag">
      <Link
        to={seriesPath(work.series)}
        className="series-tag__link"
        title={`Every book in ${work.series}`}
      >
        {work.series}
        {/* The display value is what the cover says — "Book 2", "Volume 07",
            "Extra 3" — and is deliberately not derived from the sort index. */}
        {work.seriesIndexDisplay ? <b> {work.seriesIndexDisplay}</b> : null}
      </Link>
    </span>
  );
}

export function WorkList({ rows, view }: { rows: WorkSummary[]; view: 'grid' | 'list' }) {
  if (view === 'grid') {
    return (
      <ul className="grid">
        {rows.map((w) => (
          <li key={w.id}>
            <div className="card">
              <div className="card__art">
                <Cover src={w.coverUrl} title={w.title} authors={w.authors} size="grid" />
                {/* A column, because both can be true at once — see `.card__marks`. */}
                <span className="card__marks">
                  <ReadMark state={w.readState} />
                  <PreorderMark count={w.preordered} />
                </span>
              </div>
              <div className="card__text">
                <Link to={workPath(w.id)} className="card__open">
                  <strong className="card__title">{w.title}</strong>
                </Link>
                <span className="muted small">{w.authors}</span>
                <SeriesLine work={w} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="works">
      {rows.map((w) => (
        <li key={w.id}>
          <div className="row-open">
            <Cover src={w.coverUrl} title={w.title} size="row" />
            <div className="row-open__text">
              <div className="row-open__head">
                <Link to={workPath(w.id)} className="card__open">
                  <strong>{w.title}</strong>
                </Link>
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
          </div>
        </li>
      ))}
    </ul>
  );
}
