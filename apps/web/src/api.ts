/**
 * The API client. One place that knows how a request is authenticated, so
 * nothing else has to.
 */

import type { ScanJob, ScanLine } from '@lc/core';
import { getIdToken } from './lib/firebase.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Every call carries a Firebase ID token.
 *
 * On a 401 the token is refreshed once and the request retried once — a token
 * expiring mid-session is ordinary, and making the user sign in again for it
 * would be the worst possible response. Twice would be a loop, so it is exactly
 * once: a second 401 means the session is genuinely gone.
 */
async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = await getIdToken(retried);
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401 && !retried) return request<T>(path, init, true);

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; detail?: unknown } | null;
    throw new ApiError(res.status, body?.detail, body?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface Me {
  email: string;
  displayName: string | null;
  role: 'owner' | 'reader' | 'pending';
  capabilities: string[];
  reviewName: string | null;
}

export interface WorkSummary {
  id: number;
  title: string;
  subtitle: string | null;
  authors: string;
  series: string | null;
  seriesIndexDisplay: string | null;
  coverUrl: string | null;
  formats: string | null;
  copyCount: number;
  createdAt: string;
  /** This reader's state, not the household's. Null when nobody has set one. */
  readState: string | null;
}

/**
 * What the collection screen can ask for.
 *
 * ⚠️ Every one of these is *validated again on the server* — the sort key
 * against an allowlist, the page size against a menu. This type is a
 * convenience, not a contract: `packages/db/src/works.ts` is where an unknown
 * value is decided about.
 */
export interface CollectionParams {
  q?: string;
  series?: string;
  format?: string;
  status?: string;
  readState?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface CollectionFacets {
  series: { name: string; count: number }[];
  formats: { format: string; count: number }[];
  statuses: { status: string; count: number }[];
}

export interface Stats {
  works: number;
  editions: number;
  copies: number;
  series: number;
  authors: number;
  withCover: number;
  /** Copies with a wishlist status. Counted by the database, like everything here. */
  wanted: number;
  formats: { format: string; count: number }[];
  readStates: { readState: string; count: number }[];
}

/**
 * A series and what is missing from it.
 *
 * ⚠️ Mirrors `SeriesCompleteness` in `@lc/core`, which is where the rules live.
 * The web app imports the *functions* — `completenessSentence`,
 * `gapEvidenceLabel` — rather than re-wording anything here, so the sentence a
 * page prints and the arithmetic behind it cannot drift.
 */
export interface SeriesGap {
  index: number;
  volumeId: number | null;
  workId: number | null;
  wanted: boolean;
  evidence: 'interior' | 'earlier' | 'attested' | 'implied';
  title: string | null;
  authors: string | null;
  display: string | null;
  source: string | null;
  sourceUrl: string | null;
  note: string | null;
  staleAt: string | null;
}

export interface SeriesCompleteness {
  series: string;
  owned: number;
  unnumbered: number;
  lowestOwned: number | null;
  highestOwned: number | null;
  highestKnown: number | null;
  gaps: SeriesGap[];
  wanted: number;
  certainGaps: number;
  attestedGaps: number;
  knownTotal: number | null;
  knownTotalSource: string | null;
  openEnded: boolean;
  checked: boolean;
  checkOutcome: string | null;
  checkSource: string | null;
}

export interface SeriesLadderEntry {
  index: number;
  volumeId: number | null;
  display: string | null;
  title: string | null;
  authors: string | null;
  workId: number | null;
  wanted: boolean;
  coverUrl: string | null;
  readState: string | null;
  source: string | null;
  sourceUrl: string | null;
  note: string | null;
  staleAt: string | null;
}

export interface SeriesReport {
  completeness: SeriesCompleteness;
  ladder: SeriesLadderEntry[];
  unnumbered: { workId: number; title: string; display: string | null }[];
}

export interface WishlistRow {
  copyId: number;
  workId: number;
  title: string;
  authors: string;
  series: string | null;
  seriesIndexDisplay: string | null;
  coverUrl: string | null;
  status: string;
  vendor: string | null;
  pricePaidCents: number | null;
  currency: string;
  notes: string | null;
  createdAt: string;
  formats: string | null;
}

export interface RelatedWork {
  relationId: number;
  workId: number;
  title: string;
  authors: string;
  series: string | null;
  seriesIndexDisplay: string | null;
  coverUrl: string | null;
  relation: 'same_universe' | 'companion' | 'contains' | 'precedes';
  outgoing: boolean;
  note: string | null;
}

function collectionQuery(params: CollectionParams): string {
  const u = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // `page: 0` and `q: ''` both mean "no opinion"; sending them adds noise to
    // the URL and, for an empty q, an unnecessary LIKE over the whole table.
    if (value === undefined || value === null || value === '' || value === 0) continue;
    u.set(key, String(value));
  }
  return u.toString();
}

export const api = {
  me: () => request<Me>('/api/me'),

  collection: (params: CollectionParams) =>
    request<{
      rows: WorkSummary[];
      total: number;
      page: number;
      pageSize: number;
      sort: string;
      dir: 'asc' | 'desc';
    }>(`/api/collection?${collectionQuery(params)}`),

  /** Counted against the same filter the list uses, so the numbers agree. */
  facets: (params: CollectionParams) =>
    request<CollectionFacets>(`/api/collection/facets?${collectionQuery(params)}`),

  /** ⚠️ Always from the database. No count in this app is ever a literal. */
  stats: () => request<Stats>('/api/stats'),

  work: (id: number) => request<Record<string, unknown>>(`/api/works/${id}`),

  /**
   * "Do we already hold this book?" Ask before creating one.
   *
   * ⚠️ `createWork` does NOT dedupe — the schema allows two works with one key
   * on purpose. Skipping this check means scanning the paperback of a book you
   * already hold as an ebook silently produces a second row for the same book.
   */
  matchWork: (title: string, authors: string) =>
    request<{ work: { id: number; title: string; authors: string } | null }>(
      `/api/works/match?title=${encodeURIComponent(title)}&authors=${encodeURIComponent(authors)}`,
    ),

  /**
   * ⚠️ A PUT, so it REPLACES the whole read-state row. Send the dates back with
   * it or they are cleared — the endpoint is `.strict()` and will also reject any
   * key it does not know, including `rating` (ratings go through reviewDraft).
   */
  setReading: (
    id: number,
    body: {
      readState: string;
      startedOn?: string | null;
      finishedOn?: string | null;
      readFormat?: string | null;
      notes?: string | null;
    },
  ) => request<Record<string, unknown>>(`/api/works/${id}/reading`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }),

  createWork: (body: unknown) =>
    request<{ work: WorkSummary }>('/api/works', { method: 'POST', body: JSON.stringify(body) }),


  createEdition: (body: unknown) =>
    request<{ edition: { id: number } }>('/api/editions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createCopy: (body: unknown) =>
    request<{ copy: { id: number } }>('/api/copies', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  scan: (code: string) => request<Record<string, unknown>>(`/api/isbn/${encodeURIComponent(code)}`),

  /** Proposals only — see apps/worker/src/routes/enrich.ts. */
  enrichCandidates: (workId: number) =>
    request<{
      candidates: {
        title: string;
        authors: string;
        publisher: string | null;
        publishedYear: number | null;
        coverUrl: string | null;
        openlibraryWorkId: string | null;
        similarity: number;
        authorSimilarity: number;
      }[];
      note: string | null;
    }>(`/api/enrich/works/${workId}/candidates`),

  updateWork: (id: number, body: unknown) =>
    request<Record<string, unknown>>(`/api/works/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /** The Worker builds the review document; the browser writes it. See routes/reviews.ts. */
  reviewDraft: (workId: number, body: { rating: number; text: string; editionLabel?: string }) =>
    request<{ collection: string; docId: string; doc: Record<string, unknown> }>(
      `/api/reviews/${workId}/draft`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  reviewKeys: (workId: number) =>
    request<{ collection: string; workKey: string; legacyBookId: string }>(
      `/api/reviews/${workId}/keys`,
    ),

  // -------------------------------------------------------------------------
  // Series completeness
  // -------------------------------------------------------------------------

  seriesList: () =>
    request<{ series: SeriesCompleteness[]; withoutSeries: number }>('/api/series'),

  series: (name: string) =>
    request<SeriesReport>(`/api/series/${encodeURIComponent(name)}`),

  /** Hand-entered: "this series has a book 14". Always stored as `manual`. */
  addSeriesVolume: (
    name: string,
    body: {
      indexSort: number;
      indexDisplay?: string | null;
      title?: string | null;
      authors?: string | null;
      source: 'manual';
      sourceUrl?: string | null;
      note?: string | null;
    },
  ) =>
    request<SeriesReport>(`/api/series/${encodeURIComponent(name)}/volumes`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteSeriesVolume: (name: string, id: number) =>
    request<SeriesReport>(`/api/series/${encodeURIComponent(name)}/volumes/${id}`, {
      method: 'DELETE',
    }),

  /**
   * ⚠️ The only way a series length enters this app, and the server refuses it
   * without a source. `knownTotal: null` withdraws the claim.
   */
  setSeriesTotal: (
    name: string,
    body: { knownTotal: number | null; knownTotalSource?: string | null; note?: string | null },
  ) =>
    request<SeriesReport>(`/api/series/${encodeURIComponent(name)}/total`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  // -------------------------------------------------------------------------
  // Wishlist
  // -------------------------------------------------------------------------

  /**
   * ⚠️ Copies, not works. A wanted hardcover of a book already held as an EPUB
   * is a real wish and a work-level filter cannot express it — see the route.
   */
  wishlist: (status?: string) =>
    request<{ rows: WishlistRow[]; statuses: string[] }>(
      `/api/wishlist${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    ),

  /** A PATCH: `{ status: 'owned' }` promotes a wish without losing the rest. */
  updateCopy: (id: number, body: Record<string, unknown>) =>
    request<{ copy: Record<string, unknown> }>(`/api/copies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteCopy: (id: number) => request<{ ok: true }>(`/api/copies/${id}`, { method: 'DELETE' }),

  // -------------------------------------------------------------------------
  // Related books
  // -------------------------------------------------------------------------

  relations: (workId: number) =>
    request<{ related: RelatedWork[] }>(`/api/works/${workId}/relations`),

  /** Answers with the whole list, so a directional link is drawn from the end it was stored at. */
  addRelation: (
    workId: number,
    body: { toWorkId: number; relation: string; note?: string | null },
  ) =>
    request<{ related: RelatedWork[] }>(`/api/works/${workId}/relations`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteRelation: (relationId: number) =>
    request<{ ok: true }>(`/api/relations/${relationId}`, { method: 'DELETE' }),

  // -------------------------------------------------------------------------
  // Scan jobs — the intake queue
  //
  // ⚠️ Every one of these is a *proposal*. Nothing here writes to the catalog;
  // `patchScanLine({ addedWorkId })` records that the ordinary create endpoints
  // already did. See apps/worker/src/routes/scan-jobs.ts.
  // -------------------------------------------------------------------------

  /** `open` narrows to sweeps that still want attention. */
  scanJobs: (open = true) =>
    request<{ jobs: ScanJob[] }>(`/api/scan-jobs${open ? '?open=1' : ''}`),

  scanJob: (id: number) => request<{ job: ScanJob }>(`/api/scan-jobs/${id}`),

  /**
   * One barcode, appended to an open sweep. Omit `jobId` to start one.
   *
   * `duplicate: true` means the server refused a code the job already holds —
   * not an error. A book left in front of the lens is the ordinary case.
   */
  scanBarcode: (code: string, jobId: number | null) =>
    request<{ job: ScanJob; index: number; line: ScanLine; duplicate: boolean }>(
      '/api/scan-jobs/barcode',
      { method: 'POST', body: JSON.stringify({ code, jobId }) },
    ),

  /**
   * ⚠️ Costs money, and the photo is never stored — see the route.
   * `usage.estimatedCents` comes back so the screen can say what it cost.
   */
  scanShelf: (data: string, mediaType: string) =>
    request<{
      job: ScanJob;
      unreadable: boolean;
      usage: { inputTokens: number; outputTokens: number; estimatedCents: number };
    }>('/api/scan-jobs/shelf', { method: 'POST', body: JSON.stringify({ data, mediaType }) }),

  /** `q` is the corrected title. Without it, the spine's own words are used. */
  lookupScanLine: (jobId: number, index: number, q?: string) =>
    request<{ job: ScanJob; index: number; line: ScanLine; found: boolean }>(
      `/api/scan-jobs/${jobId}/lines/${index}/lookup${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      { method: 'POST' },
    ),

  patchScanLine: (
    jobId: number,
    index: number,
    body: { addedWorkId?: number | null; dismissed?: boolean; text?: string; author?: string | null },
  ) =>
    request<{ job: ScanJob; index: number; line: ScanLine }>(
      `/api/scan-jobs/${jobId}/lines/${index}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  finishScanJob: (id: number) =>
    request<{ job: ScanJob }>(`/api/scan-jobs/${id}/done`, { method: 'POST' }),

  deleteScanJob: (id: number) =>
    request<{ ok: true }>(`/api/scan-jobs/${id}`, { method: 'DELETE' }),
};
