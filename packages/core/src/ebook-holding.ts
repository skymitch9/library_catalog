/**
 * Leaf module: deriving `ebook_holding` rows (migration 0310) from edition
 * rows, and checking that the two sources agree.
 *
 * Imports `constants.ts` only. No I/O.
 *
 * ## Why the derivation is pure and lives here
 *
 * `scripts/backfill-ebook-holdings.mjs` is the ONLY writer of `ebook_holding`,
 * but the decision of what a holding row says — which formats count, how a
 * multi-edition work collapses to one row, which `edition_source` wins — is a
 * domain rule, and domain rules live in `@lc/core` where `npm test` can pin
 * them without a database. The script does the I/O; this decides.
 *
 * ## ⚠️ Derivation is by stored key, never by re-derivation
 *
 * The input is edition rows carrying `work_id` — a stored foreign key. No
 * title is folded, no matcher runs, no `work_key` is recomputed. That is the
 * phase-4 contract from the ebook split design: the holding rows must be a
 * faithful projection of what the ingest already stored, so that the shadow
 * comparison ("do editions and holdings agree?") is comparing two records of
 * the SAME fact, not two opinions produced by two algorithms. Re-matching is
 * phase 5+'s problem, and it will look like `backfill-audiobook-holdings.mjs`
 * when it comes.
 */

import { EBOOK_FILE_FORMATS } from './constants.js';

/** What the derivation needs to know about an edition row. */
export interface EbookEditionInput {
  workId: number;
  /** `edition.format` — e.g. 'ebook_epub'. Non-ebook-file formats are ignored. */
  format: string;
  /** `edition.source` — 'file' from the ingest, 'manual' from a person, etc. */
  source: string;
  /** `edition.source_url` — the manifest-relative path, or null. */
  sourceUrl: string | null;
}

/** One planned `ebook_holding` row — plain data, ready to be written. */
export interface EbookHoldingPlan {
  workId: number;
  /** Manifest-spelling formats ('epub', 'pdf'), sorted, deduplicated. */
  formats: string[];
  /** The first non-null path among the deriving editions, or null. */
  sourcePath: string | null;
  /** 'file' when ANY deriving edition is file-sourced — the stronger evidence. */
  editionSource: 'file' | 'manual';
}

/**
 * `'ebook_epub'` → `'epub'` — the manifest's own spelling
 * (`build_ebook_manifest.py` emits the bare extension). Stored that way so the
 * holding reads as a fact about the POOL ("an epub file exists"), not about
 * this catalog's enum.
 */
export function manifestFormat(editionFormat: string): string {
  return editionFormat.replace(/^ebook_/, '');
}

/**
 * Collapse ebook file editions to one holding plan per work.
 *
 * ⚠️ Only `EBOOK_FILE_FORMATS` count. `ebook_kindle` is a licence with no
 * bytes in the pool — the same exclusion every "the file exists" surface
 * already makes — and physical formats are what this catalog is FOR, never
 * pool inventory.
 *
 * One row per work, migration 0310's rule: work #90's two epub editions are
 * one holding whose `formats` is `['epub']`.
 */
export function deriveEbookHoldings(
  editions: readonly EbookEditionInput[],
): EbookHoldingPlan[] {
  const fileFormats = EBOOK_FILE_FORMATS as readonly string[];
  const byWork = new Map<number, EbookHoldingPlan>();

  for (const e of editions) {
    if (!fileFormats.includes(e.format)) continue;
    const plan = byWork.get(e.workId) ?? {
      workId: e.workId,
      formats: [],
      sourcePath: null,
      editionSource: 'manual' as const,
    };
    const fmt = manifestFormat(e.format);
    if (!plan.formats.includes(fmt)) plan.formats.push(fmt);
    if (plan.sourcePath === null && e.sourceUrl) plan.sourcePath = e.sourceUrl;
    // 'file' outranks 'manual': a file the pipeline saw is stronger evidence
    // than a hand-typed row, and the column records the strongest.
    if (e.source === 'file') plan.editionSource = 'file';
    byWork.set(e.workId, plan);
  }

  for (const plan of byWork.values()) plan.formats.sort();
  return [...byWork.values()].sort((a, b) => a.workId - b.workId);
}

/**
 * The shadow comparison — do the two records of "this work is held as an
 * ebook" say the same thing?
 *
 *   • `edition` side: does the work carry at least one ebook FILE edition?
 *   • `holding` side: does a live (non-stale) `ebook_holding` row exist?
 *
 * Four honest answers, because "agree" has two shapes and each disagreement
 * has a different fix:
 *
 *   • 'both'         — agree, the work is an ebook both ways (the 126).
 *   • 'neither'      — agree, it is not (the ordinary case; render nothing).
 *   • 'edition_only' — the holding cache is behind: run `backfill:ebooks`.
 *   • 'holding_only' — the editions are gone but the holding stands. Wrong
 *                      today; EXPECTED after phase 5 prunes the editions —
 *                      at which point this value stops being a discrepancy
 *                      and becomes the whole point of the table.
 */
export type EbookAgreement = 'both' | 'neither' | 'edition_only' | 'holding_only';

export function ebookAgreement(
  editionFormats: readonly string[],
  hasLiveHolding: boolean,
): EbookAgreement {
  const fileFormats = EBOOK_FILE_FORMATS as readonly string[];
  const editionSaysEbook = editionFormats.some((f) => fileFormats.includes(f));
  if (editionSaysEbook && hasLiveHolding) return 'both';
  if (!editionSaysEbook && !hasLiveHolding) return 'neither';
  return editionSaysEbook ? 'edition_only' : 'holding_only';
}
