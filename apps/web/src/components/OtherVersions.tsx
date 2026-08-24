/* @jsxRuntime automatic @jsxImportSource react */
// ⚠️ The pragma is for `npm test`, not the app build. tsx/esbuild runs the
// test files from the repo root, where no tsconfig sets `jsx`, so without it
// the JSX here compiles to `React.createElement` and throws "React is not
// defined" under `apps/web/test/other-versions.test.ts`. Vite and tsc both
// already use the automatic runtime (`jsx: react-jsx`), so this changes
// nothing for the shipped bundle — it only makes the test runner agree.
import type { ReactNode } from 'react';
import type { WorkAudioEdition, WorkAudiobookHolding } from '../api.js';
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
 * Today the entries are the audiobook ones: normally the single
 * `audiobook_holding` row (migration 0010), and — since migration 0390 — one
 * per audiobook EDITION when the household owns more than one recording of the
 * same book.
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
  editions = [],
  audioEditionCount,
  ourSeries,
}: {
  holding: WorkAudiobookHolding | null;
  /**
   * Every audiobook edition of this work — migration 0390. Optional and
   * defaulting to empty, so a caller that has not been taught about it (or an
   * API response predating the field) renders exactly what it rendered before.
   */
  editions?: WorkAudioEdition[];
  /**
   * How many recordings the household holds now — `countAudioEditions` in
   * `@lc/db`. See `audioCountLine` for why this is not `editions.length`.
   */
  audioEditionCount?: number;
  /** This work's OWN series spelling, to show only when the two disagree. */
  ourSeries: string | null;
}) {
  const entries = buildVersionEntries({ holding, editions, ourSeries });
  if (entries.length === 0) return null;
  const countLine = audioCountLine(audioEditionCount);

  return (
    <section className="panel">
      <h3>Other versions available</h3>
      {/* The owner's ask, 2026-08-23: SAY THE NUMBER. The rows already show it
          to anybody who counts them, and counting is exactly what he should not
          have to do — "2 audiobooks" is the fact, in words, above the list. */}
      {countLine && <p className="muted small">{countLine}</p>}
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
 * *"You own 2 audiobooks of this book."* — or nothing at all.
 *
 * Owner's decision, 2026-08-23: *"have it say 2 on the physical and ebook
 * libraries; on audiobook have them be different since they're different files
 * being served."* This is the physical library's half of it.
 *
 * ⚠️ **Silent below two, on purpose.** "You own 1 audiobook of this book" is a
 * sentence that adds nothing to a list already showing exactly that one
 * audiobook, and this app's standing habit is to say more as the shelf gets
 * more interesting, not to narrate the ordinary case (see `signatureShared` on
 * the series page, and every other zero-omission on the work page).
 *
 * ⚠️ **The number comes from the SERVER's count, never from `editions.length`.**
 * They are different questions and can legitimately differ:
 *
 *   - `editions` carries **stale** rows so each can be shown with a caveat — a
 *     match the sibling catalog has withdrawn is still worth seeing, because
 *     hiding it looks identical to "never matched";
 *   - this line claims the household **owns** them, so it counts only what that
 *     catalog still confirms (`stale_at IS NULL`, in `audioEditionCountSql`).
 *
 * So one live edition and one withdrawn one renders **two rows and no count
 * line**, which is the honest pair of answers rather than a contradiction.
 *
 * `undefined` — an API response predating the field — renders nothing, the same
 * rule `editions` itself follows.
 *
 * Exported for the same two callers `buildVersionEntries` is: the render above,
 * and `apps/web/test/other-versions.test.ts`, which pins 1-vs-2 without a DOM.
 */
export function audioCountLine(count: number | undefined): string | null {
  if (count == null || count < 2) return null;
  return `You own ${count} audiobooks of this book.`;
}

/**
 * One row of the list — one other-catalog copy of this book. Deliberately a
 * plain data shape (not JSX) so `buildVersionEntries` stays a pure function a
 * future version type can extend without importing React.
 */
export interface VersionEntry {
  key: string;
  /** ALWAYS present. See the component header. */
  formatLabel: string;
  href: string;
  title: string;
  cover: string | null;
  indexDisplay: string | null;
  extra: ReactNode;
}

/**
 * Exported for two callers only: the render above, and
 * `apps/web/test/other-versions.test.ts`, which pins the render conditions
 * (nothing for a work with no counterpart; the format label ALWAYS present)
 * without needing a DOM.
 */
export function buildVersionEntries({
  holding,
  editions = [],
  ourSeries,
}: {
  holding: WorkAudiobookHolding | null;
  editions?: WorkAudioEdition[];
  ourSeries: string | null;
}): VersionEntry[] {
  const entries: VersionEntry[] = [];

  /**
   * ⚠️ The list REPLACES the single row only when it genuinely says more.
   *
   * `holding` is the `audiobook_holding` view — one whole row, the same row
   * `editions[0]` is (both are ordered series-first), and the field five other
   * callers already trust. Rendering the list for a one-edition book would
   * change nothing visible while making this component depend on a field an
   * older cached API response may not carry. So the list is used exactly when
   * it adds a fact: the household owns more than one recording.
   */
  if (editions.length > 1) {
    for (const edition of editions) entries.push(audioEditionEntry(edition, ourSeries));
  } else if (holding) {
    entries.push(audiobookEntry(holding, ourSeries));
  }

  // Future version types (a second sibling catalog) are appended here,
  // additively — see the component header.
  return entries;
}

/**
 * One row per audiobook edition — migration 0390's visible half.
 *
 * The narrator is the point. Two recordings of one book differ by who read it
 * far more legibly than by anything else the row carries: the household's two
 * *Elantris* audiobooks are a fourteen-name full cast and Jack Garrett, and
 * without that line the two entries read as a duplicate rather than a choice.
 */
function audioEditionEntry(edition: WorkAudioEdition, ourSeries: string | null): VersionEntry {
  const seriesDiffers = edition.series && edition.series !== ourSeries;

  return {
    key: `audiobook:${edition.audioKey}`,
    formatLabel: 'Audiobook',
    href: audiobookDetailUrl(edition.title),
    title: edition.title,
    cover: resolveAudiobookCover(edition.coverHref),
    indexDisplay: edition.indexDisplay,
    extra: (
      <>
        {edition.narrator && <p className="muted small">Read by {edition.narrator}</p>}
        {seriesDiffers && (
          <p className="muted small">
            Filed there under &ldquo;{edition.series}&rdquo;
            {ourSeries ? `, not "${ourSeries}"` : ''} — the two catalogs spell this series
            differently.
          </p>
        )}
        {edition.authors && <p className="muted small">{edition.authors}</p>}
        {/* ⚠️ Provenance, in words, never hidden — see the component header. */}
        <p className="muted small">{matchProvenance(edition)}</p>
        {edition.staleAt && (
          <p className="muted small">
            May be out of date — the audiobook catalog no longer confirms this match.
          </p>
        )}
      </>
    ),
  };
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
function matchProvenance(holding: {
  matchedVia: string;
  titleSimilarity: number | null;
}): string {
  const pct =
    holding.titleSimilarity != null ? ` (${Math.round(holding.titleSimilarity * 100)}% title match)` : '';
  if (holding.matchedVia === 'exact') return `Matched by exact title${pct}.`;
  if (holding.matchedVia === 'alias') return `Matched by alternate title${pct}.`;
  if (holding.matchedVia === 'containment') {
    return `Matched by containment — a partial title match, worth a second look${pct}.`;
  }
  return `Matched via ${holding.matchedVia}${pct}.`;
}
