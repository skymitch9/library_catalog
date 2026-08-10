/**
 * Leaf module: what an intake sweep remembers between one tap and the next.
 *
 * Imports `constants.ts` only. No I/O.
 *
 * ## Why the job exists at all
 *
 * `ScanPage` kept its results in React state, which is fine right up to the
 * moment a phone locks in the middle of a shelf. For barcodes that costs a
 * re-scan and nothing else — a barcode is free. For a **shelf photograph** it
 * costs an API call, so the reading has to survive a reload before anything is
 * allowed to pay for one. That ordering is the whole reason this file precedes
 * the vision route.
 *
 * ## One line shape, two producers
 *
 * A barcode and a spine arrive by completely different routes and end up in the
 * same review list, so they must agree on a row. `via` is the only field that
 * says which produced it, and the review screen keys most of its wording off
 * `state` rather than `via` — a person sorting a stack does not care how the
 * title was read, only whether it is right.
 *
 * ## ⚠️ Nothing in here is a decision
 *
 * Every line is a **proposal**, exactly as the barcode screen has always
 * treated them. `addedWorkId` is the only field that records a person having
 * acted, and only the client sets it, after the ordinary `POST /api/works`.
 * Phase 0 measured that a wrong ISBN resolves to a confident, well-formed,
 * wrong book; a spine read is weaker evidence than an ISBN, not stronger.
 */

import type { ScanMode, ScanStatus } from './constants.js';

/**
 * The marker written into `scan_job.photo_key`.
 *
 * The column is `NOT NULL` and predates the decision never to store a photo, so
 * it stays and says so. **There is no R2 bucket in this app and there must not
 * be one** — a photo goes from the upload request into the vision call and is
 * dropped. The sibling Board Game Catalog deleted its bucket after noticing the
 * objects were write-only: their entire purpose was to be deleted later, and
 * one code path forgetting to delete was all it would have taken to keep
 * photographs of someone's home indefinitely. Not writing it is a guarantee;
 * remembering to delete it was a habit.
 */
export const PHOTO_NOT_STORED = 'not-stored';

/** How a line got onto a job. */
export const SCAN_LINE_SOURCES = ['barcode', 'spine', 'manual'] as const;
export type ScanLineSource = (typeof SCAN_LINE_SOURCES)[number];

/**
 * What happened when we tried to resolve one line.
 *
 * `owned` and `skipped` are terminal without anyone doing anything, which is
 * what `isOutstanding` below keys on. The rest need a person.
 */
export const SCAN_LINE_STATES = [
  /** Already on our shelf — answered from D1, no network call. */
  'owned',
  /** Resolved to a candidate. A proposal, never an answer. */
  'found',
  /** Looked, found nothing. Half this library is not in Open Library. */
  'not_found',
  /** A Kindle ASIN. No free database indexes these; a different importer's job. */
  'unresolvable',
  /** Not a book code — a price add-on or a retail UPC. */
  'skipped',
  /** The lookup itself failed. Retryable, unlike the four above. */
  'error',
] as const;
export type ScanLineState = (typeof SCAN_LINE_STATES)[number];

/**
 * One book on one sweep.
 *
 * Stored as JSON in `scan_job.enriched` rather than as rows in a table, and
 * deliberately: a line is only ever read as part of its job, never queried
 * across jobs, and a table would buy indexes nothing needs at the cost of a
 * migration every time the review screen learns a new field.
 */
export interface ScanLine {
  /** 1-based, in arrival order — left to right along a shelf. */
  position: number;
  via: ScanLineSource;
  /** The scanned ISBN-13, when there was one. Null for a spine read. */
  code: string | null;
  /** Exactly what was read: the printed spine text, or the code itself. */
  text: string;
  /** The author as printed on the spine. Null when the spine showed none. */
  author: string | null;
  /** How sure the read was. Null for a barcode, which is not a reading. */
  confidence: 'high' | 'medium' | 'low' | null;
  /** Why the read is uncertain — glare, occlusion, worn lettering. */
  note: string | null;

  state: ScanLineState;
  /** A sentence for the person, when `state` alone would not explain itself. */
  detail: string | null;

  /** The work we already hold, if this line names one. */
  existingWorkId: number | null;
  existingTitle: string | null;

  /** The best proposal from the free rungs. All null when nothing resolved. */
  isbn13: string | null;
  resolvedTitle: string | null;
  resolvedAuthors: string | null;
  publisher: string | null;
  publishedYear: number | null;
  coverUrl: string | null;
  /**
   * How close the resolved title is to what was read, 0..1. Null when nothing
   * resolved, and **carried rather than enforced**: below
   * `MIN_SPINE_SIMILARITY` the review screen shows the match and declines to
   * dress it up, which tells the truth about what was found instead of quietly
   * dropping a name that is visibly on the shelf.
   */
  similarity: number | null;
  /** Set when a person retyped the title and asked again. */
  relookedUpAs: string | null;

  /** The work this line became. Only a person's action sets this. */
  addedWorkId: number | null;
  /** "I have looked at it and I do not want it." Also a person's action. */
  dismissed: boolean;
}

/** A sweep, as the API hands it back. */
export interface ScanJob {
  id: number;
  status: ScanStatus;
  mode: ScanMode;
  lines: ScanLine[];
  error: string | null;
  createdBy: number | null;
  createdAt: string;
  processedAt: string | null;
  reviewedAt: string | null;
}

/** A blank line, so the two producers cannot disagree about the defaults. */
export function blankLine(
  position: number,
  via: ScanLineSource,
  text: string,
): ScanLine {
  return {
    position,
    via,
    code: null,
    text,
    author: null,
    confidence: null,
    note: null,
    state: 'not_found',
    detail: null,
    existingWorkId: null,
    existingTitle: null,
    isbn13: null,
    resolvedTitle: null,
    resolvedAuthors: null,
    publisher: null,
    publishedYear: null,
    coverUrl: null,
    similarity: null,
    relookedUpAs: null,
    addedWorkId: null,
    dismissed: false,
  };
}

/**
 * Is this line still waiting for a person?
 *
 * ⚠️ `owned` and `skipped` are settled *by the answer itself* — a book we
 * already hold needs no decision, and a price barcode is not a book. Everything
 * else is outstanding until somebody adds it or dismisses it, including
 * `not_found` and `error`. That is the point: the rows worth coming back to are
 * exactly the ones that did not resolve cleanly, and an earlier version of this
 * rule in the sibling project closed the job when the *easy* ones were added,
 * taking the hard ones with it.
 */
export function isOutstanding(line: ScanLine): boolean {
  if (line.dismissed || line.addedWorkId !== null) return false;
  if (line.existingWorkId !== null) return false;
  return line.state !== 'owned' && line.state !== 'skipped';
}

export function outstandingCount(lines: readonly ScanLine[]): number {
  return lines.reduce((n, line) => n + (isOutstanding(line) ? 1 : 0), 0);
}

/**
 * A one-line summary for the queue, so a person can tell two sweeps apart
 * without opening either.
 *
 * Counts rather than titles: a shelf photo produces a dozen names and none of
 * them is *the* name of the job, whereas "14 read · 3 to sort" is the only
 * thing that decides whether it is worth reopening.
 */
export function jobSummary(job: Pick<ScanJob, 'lines' | 'status'>): string {
  const total = job.lines.length;
  if (total === 0) {
    return job.status === 'failed' ? 'nothing read' : 'nothing yet';
  }
  const left = outstandingCount(job.lines);
  const noun = total === 1 ? 'book' : 'books';
  return left === 0 ? `${total} ${noun} · all sorted` : `${total} ${noun} · ${left} to sort`;
}
