/* @jsxRuntime automatic @jsxImportSource react */
// ⚠️ The pragma is for `npm test`, not the app build — same story as
// `OnYourShelf.tsx`: tsx runs the test files from the repo root where no
// tsconfig sets `jsx`, so without it the JSX compiles to `React.createElement`
// and throws under `apps/web/test/ebook-shadow.test.ts`.
import { ebookAgreement, type EbookAgreement } from '@lc/core';
import type { WorkEbookHolding } from '../api.js';

/**
 * The ebook holding SHADOW — phase 4 of the ebook split
 * (`catalog-platform/docs/info/ebook-split-design.md`).
 *
 * The work page says "this book is an ebook" from its edition rows (the
 * Editions panel above this component). Migration 0310 caches the same fact
 * in `ebook_holding`, the shape that will survive phase 5's edition pruning.
 * Until that pruning, BOTH representations render — this panel is the
 * holding-derived answer, placed directly beside the edition-derived one,
 * saying in words whether the two agree. That visible agreement, on every
 * work, is the evidence phase 5 is gated on; a shadow nobody can see is not
 * a shadow, it is a hope.
 *
 * Render rules, in the house style:
 *
 *   • 'neither' (no ebook either way — most of the catalog) renders NOTHING.
 *     Same rule as `universe: null` and a shelf with no audio row at all.
 *   • 'both' renders the quiet confirmation — muted, one line, because
 *     agreement is the expected case and must not shout.
 *   • Either disagreement renders as a notice, in words, with the fix named —
 *     never a bare mismatch the reader has to interpret.
 *   • A stale holding is shown with a caveat, never hidden — 0310 inherits
 *     0010's rule verbatim.
 *
 * ⚠️ The verdict comes from `ebookAgreement` in `@lc/core` — the SAME function
 * the backfill's census prints, so this panel and the script's report cannot
 * disagree about what "agree" means.
 */
export function EbookShadow({
  editions,
  holding,
}: {
  /** The work's edition rows — only `format` is consulted. */
  editions: readonly { format: string }[];
  holding: WorkEbookHolding | null;
}) {
  const shadow = buildEbookShadow({
    editionFormats: editions.map((e) => e.format),
    holding,
  });
  if (!shadow) return null;

  return (
    <section className="panel">
      <h3>Ebook — shared pool (shadow)</h3>
      {shadow.agrees ? (
        <p className="muted small">{shadow.headline}</p>
      ) : (
        <p className="notice notice--bad small">{shadow.headline}</p>
      )}
      {shadow.notes.map((note) => (
        <p className="muted small" key={note}>
          {note}
        </p>
      ))}
    </section>
  );
}

/** What the panel will say — plain data, so the test needs no DOM. */
export interface EbookShadowView {
  verdict: EbookAgreement;
  agrees: boolean;
  headline: string;
  notes: string[];
}

/**
 * Exported for two callers only: the render above and
 * `apps/web/test/ebook-shadow.test.ts` — the `buildVersionEntries` pattern.
 * Returns null when there is nothing to show (no ebook by either record).
 */
export function buildEbookShadow({
  editionFormats,
  holding,
}: {
  editionFormats: readonly string[];
  holding: WorkEbookHolding | null;
}): EbookShadowView | null {
  const live = holding !== null && holding.staleAt === null;
  const verdict = ebookAgreement(editionFormats, live);
  if (verdict === 'neither' && !holding) return null;

  const formats = holding?.formats.map((f) => f.toUpperCase()).join(', ') ?? null;

  if (verdict === 'both') {
    return {
      verdict,
      agrees: true,
      headline: `The editions above and the pool holding cache agree: the household holds this as an ebook (${formats}).`,
      notes: [
        holding!.editionSource === 'manual'
          ? 'Derived from a hand-added edition — no file path recorded.'
          : 'Derived from the stored edition rows — no titles were re-matched.',
      ],
    };
  }

  if (verdict === 'edition_only') {
    return {
      verdict,
      agrees: false,
      headline:
        'The editions above record an ebook, but the pool holding cache has no live row for it — the cache is behind. Run `npm run backfill:ebooks` to rebuild it.',
      notes:
        holding?.staleAt != null
          ? [
              'A holding row exists but is marked stale — the last backfill no longer saw an ebook edition here. Re-running the backfill revives it.',
            ]
          : [],
    };
  }

  // 'holding_only', or a stale holding on a work with no ebook edition.
  const notes: string[] = [];
  if (holding?.staleAt != null) {
    notes.push(
      'This holding is marked stale — no edition backs it any more, and the backfill said so rather than deleting the record.',
    );
  }
  return {
    verdict,
    agrees: false,
    headline: verdict === 'holding_only'
      ? `The pool holding cache records an ebook (${formats}), but no edition above says so. Before phase 5 prunes the ebook editions this is a discrepancy to fix; after it, this cache IS the record.`
      : 'The pool holding cache once recorded an ebook here, but neither record is live now.',
    notes,
  };
}
