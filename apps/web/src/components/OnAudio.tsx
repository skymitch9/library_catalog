import type { WorkAudiobookHolding } from '../api.js';
import { audiobookDetailUrl, resolveAudiobookCover } from '../lib/audiobook-site.js';
import { Cover } from './Cover.js';

/**
 * "Do we already own this on audio?" — surfacing migration 0010's
 * `audiobook_holding` cache on the one page it was invisible from.
 *
 * The gap this closes: the table has held a fresh row for both Harry Potters
 * (works 347 and 334) since the backfill, and the only place that showed up
 * was a "N on audio" chip on the *series* page — a book with no series, or a
 * series page nobody happened to open, hid the fact completely. See
 * `docs/HANDOFF.md`'s note on migration 0010 for why this is a cache and never
 * a source of truth: nothing here may be edited, only linked to.
 *
 * ⚠️ **Provenance is shown, never hidden — migration 0010's rule, repeated
 * here rather than softened.** `matched_via` is the whole reason a wrong match
 * gets noticed instead of quietly believed; 'containment' in particular is a
 * partial-title guess and says so in words, muted but not smaller print
 * pretending to be a footnote.
 *
 * ⚠️ **A stale holding is shown, not hidden.** `stale_at` means the sibling
 * catalog no longer agrees — the book may have been renamed, removed, or
 * re-filed over there — and hiding the section would look identical to "never
 * matched at all", which loses the fact that this WAS true once. A muted note
 * says so instead.
 */
export function OnAudio({
  holding,
  ourSeries,
}: {
  holding: WorkAudiobookHolding | null;
  /** This work's OWN series spelling, to show only when the two disagree. */
  ourSeries: string | null;
}) {
  if (!holding) return null;

  const cover = resolveAudiobookCover(holding.coverHref);
  const link = audiobookDetailUrl(holding.title);
  // Only worth a line when the two catalogs actually disagree — showing it
  // unconditionally would turn the ordinary case (same spelling) into noise.
  const seriesDiffers = holding.series && holding.series !== ourSeries;

  return (
    <section className="panel">
      <h3>On audio</h3>
      <div className="row-tight">
        {cover && <Cover src={cover} title={holding.title} size="row" />}
        <div style={{ flex: 1 }}>
          <p>
            You own this on audio —{' '}
            <a href={link} target="_blank" rel="noopener noreferrer">
              {holding.title}
            </a>
            {holding.indexDisplay && <span className="muted"> ({holding.indexDisplay})</span>}
          </p>
          {seriesDiffers && (
            <p className="muted small">
              Filed there under &ldquo;{holding.series}&rdquo;
              {ourSeries ? `, not "${ourSeries}"` : ''} — the two catalogs spell this series
              differently.
            </p>
          )}
          {holding.authors && <p className="muted small">{holding.authors}</p>}
          {/* ⚠️ Provenance, in words, never hidden — see the header comment. */}
          <p className="muted small">{matchProvenance(holding)}</p>
          {holding.staleAt && (
            <p className="muted small">
              May be out of date — the audiobook catalog no longer confirms this match.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The match's provenance as a sentence, honest about how sure it is.
 *
 * 'containment' gets the hedge in words rather than the ladder's bare '?' —
 * this page has room for a sentence and the owner is reading one book, not
 * scanning twenty rungs.
 */
function matchProvenance(holding: WorkAudiobookHolding): string {
  const pct =
    holding.titleSimilarity != null ? ` (${Math.round(holding.titleSimilarity * 100)}% title match)` : '';
  if (holding.matchedVia === 'exact') return `Matched by exact title${pct}.`;
  if (holding.matchedVia === 'alias') return `Matched by alternate title${pct}.`;
  if (holding.matchedVia === 'containment') {
    return `Matched by containment — a partial title match, worth a second look${pct}.`;
  }
  return `Matched via ${holding.matchedVia}${pct}.`;
}
