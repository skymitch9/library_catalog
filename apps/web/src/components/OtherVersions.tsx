import type { ReactNode } from 'react';
import type { WorkAudiobookHolding } from '../api.js';
import { audiobookDetailUrl, resolveAudiobookCover } from '../lib/audiobook-site.js';
import { Cover } from './Cover.js';

/**
 * "Other versions available" — every OTHER catalog's copy of this same book,
 * each entry a hyperlink to the counterpart record and ALWAYS labeled with
 * the format that media is in (owner's exact spec, 2026-08-14: "both sites
 * say other versions available and then have a hyperlink to the record and
 * always say the form the media is in").
 *
 * Formerly `OnAudio` (2026-08-14 rename to a REFRAME, not just new copy):
 * this used to be the one-and-only audiobook section; it is now the first of
 * what may become several entries, so it is built as a list from the start —
 * `buildVersionEntries` is where a second version type (a future sibling
 * catalog) gets appended, additively, without touching the render below.
 * Today there is exactly one possible entry: the `audiobook_holding` cache
 * (migration 0010).
 *
 * The gap this closes (unchanged from `OnAudio`): the table has held a fresh
 * row for both Harry Potters (works 347 and 334) since the backfill, and the
 * only place that showed up was a "N on audio" chip on the *series* page — a
 * book with no series, or a series page nobody happened to open, hid the fact
 * completely. See `docs/HANDOFF.md`'s note on migration 0010 for why this is
 * a cache and never a source of truth: nothing here may be edited, only
 * linked to.
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
export function OtherVersions({
  holding,
  ourSeries,
}: {
  holding: WorkAudiobookHolding | null;
  /** This work's OWN series spelling, to show only when the two disagree. */
  ourSeries: string | null;
}) {
  const entries = buildVersionEntries({ holding, ourSeries });
  if (entries.length === 0) return null;

  return (
    <section className="panel">
      <h3>Other versions available</h3>
      {entries.map((entry, i) => (
        <div className="row-tight" style={i === 0 ? undefined : { marginTop: 10 }} key={entry.key}>
          {entry.cover && <Cover src={entry.cover} title={entry.title} size="row" />}
          <div style={{ flex: 1 }}>
            <p>
              {/* ALWAYS present — the owner's exact spec, not a nice-to-have. */}
              {entry.formatLabel} —{' '}
              <a href={entry.href} target="_blank" rel="noopener noreferrer">
                {entry.title}
              </a>
              {entry.indexDisplay && <span className="muted"> ({entry.indexDisplay})</span>}
            </p>
            {entry.extra}
          </div>
        </div>
      ))}
    </section>
  );
}

/**
 * One row of the list — one other-catalog copy of this book. Deliberately a
 * plain data shape (not JSX) so `buildVersionEntries` stays a pure function a
 * future version type can extend without importing React.
 */
interface VersionEntry {
  key: string;
  /** ALWAYS present. See the component header. */
  formatLabel: string;
  href: string;
  title: string;
  cover: string | null;
  indexDisplay: string | null;
  extra: ReactNode;
}

function buildVersionEntries({
  holding,
  ourSeries,
}: {
  holding: WorkAudiobookHolding | null;
  ourSeries: string | null;
}): VersionEntry[] {
  const entries: VersionEntry[] = [];
  if (holding) entries.push(audiobookEntry(holding, ourSeries));
  // Future version types (a second sibling catalog) are appended here,
  // additively — see the component header.
  return entries;
}

function audiobookEntry(holding: WorkAudiobookHolding, ourSeries: string | null): VersionEntry {
  // Only worth a line when the two catalogs actually disagree — showing it
  // unconditionally would turn the ordinary case (same spelling) into noise.
  const seriesDiffers = holding.series && holding.series !== ourSeries;

  return {
    key: 'audiobook',
    formatLabel: 'Audiobook',
    href: audiobookDetailUrl(holding.title),
    title: holding.title,
    cover: resolveAudiobookCover(holding.coverHref),
    indexDisplay: holding.indexDisplay,
    extra: (
      <>
        {seriesDiffers && (
          <p className="muted small">
            Filed there under &ldquo;{holding.series}&rdquo;
            {ourSeries ? `, not "${ourSeries}"` : ''} — the two catalogs spell this series
            differently.
          </p>
        )}
        {holding.authors && <p className="muted small">{holding.authors}</p>}
        {/* ⚠️ Provenance, in words, never hidden — see the component header. */}
        <p className="muted small">{matchProvenance(holding)}</p>
        {holding.staleAt && (
          <p className="muted small">
            May be out of date — the audiobook catalog no longer confirms this match.
          </p>
        )}
      </>
    ),
  };
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
