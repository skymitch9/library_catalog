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
  /**
   * Outstanding work, riding along on `/api/me` — the sibling's pattern.
   *
   * ⚠️ `null` means the count could not be taken, and is NOT the same as `0`.
   * Zero hides the nav link; null shows it without a count. A failed query must
   * never look like a finished job.
   */
  chores: { missingDetails: number } | null;
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

/** A row of `work_alias`. `kind` decides which gate the name widens. */
export interface WorkAlias {
  id: number;
  workId: number;
  alias: string;
  kind: 'title' | 'author';
  source: 'openlibrary' | 'manual';
  createdAt: string;
}

/** A row of `app_user`, as the People screen sees it. */
export interface Person {
  id: number;
  email: string;
  displayName: string | null;
  reviewName: string | null;
  photoUrl: string | null;
  role: 'owner' | 'reader' | 'pending';
  firstSeenAt: string;
  approvedAt: string | null;
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

/**
 * A row of `book_accessory` — the things in the box that are not books.
 *
 * ⚠️ Only ever fetched for one work. There is no collection-wide accessory read
 * and there must not be one: *"we don't need ti publish that count on the main
 * page, just keep it each book."*
 */
export interface Accessory {
  id: number;
  workId: number;
  copyId: number | null;
  name: string;
  kind: string;
  isDigital: boolean;
  quantity: number;
  location: string | null;
  notes: string | null;
  pledgeId: number | null;
  campaignName: string | null;
  campaignPlatform: string | null;
  createdAt: string;
}

/**
 * One reward line that delivered this book.
 *
 * ⚠️ A work legitimately has **two** of these from one pledge — the deluxe
 * hardcover and the EPUB. The panel renders them as two rows on purpose; see
 * `listProvenanceForWork` in `@lc/db`.
 */
export interface Provenance {
  itemId: number;
  pledgeId: number;
  campaignId: number;
  campaignName: string;
  campaignUrl: string | null;
  campaignPlatform: 'kickstarter' | 'backerkit' | 'indiegogo';
  pledgePlatform: 'kickstarter' | 'backerkit' | 'indiegogo';
  account: string;
  tier: string | null;
  pledgedOn: string | null;
  status: 'pledged' | 'delivered' | 'partial' | 'cancelled' | 'refunded';
  editionId: number | null;
  /** 'none' = no printing can exist for this line (an audiobook), not "unmatched". */
  editionVerdict: 'none' | 'unknown' | null;
  format: string | null;
  formatHint: string | null;
  title: string | null;
  quantity: number;
  fulfilled: boolean;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Details queue and research
// ---------------------------------------------------------------------------

/** A `DETAIL_FIELDS` value. Mirrors `@lc/core`, which is where the list lives. */
export type DetailField = 'firstPublished' | 'series' | 'seriesIndex' | 'description';

export interface NeedsDetails {
  workId: number;
  title: string;
  authors: string;
  series: string | null;
  missing: DetailField[];
  missingLabels: string[];
  /** Proposals waiting on a decision. Counted server-side so a row can say so
   *  without being opened — a worklist you must expand row by row is not one. */
  pending: number;
  /** Fields already settled. Shown so the page can say what it is NOT asking. */
  answered: DetailField[];
  answeredLabels: string[];
}

/**
 * The per-field tally.
 *
 * ⚠️ The part of the queue page that carries information. Every work is missing
 * its year and its description, so the *list* says the same thing 116 times;
 * this says which questions are nearly closed and which are wide open, and it is
 * where already-answered work shows up as done rather than as absence.
 */
export interface FieldGapCount {
  field: DetailField;
  label: string;
  missing: number;
  /** A verdict says this book has no such thing. */
  none: number;
  /** A verdict says nobody knows. */
  unknown: number;
  filled: number;
  /** The field cannot apply — a volume number on a book with no series. */
  notApplicable: number;
}

/** What a run proposed about one field. Three kinds, and the third one matters. */
export interface FindingValue {
  kind: 'found' | 'none' | 'unknown';
  value?: string | number | null;
  /**
   * What the source says, in the model's words.
   *
   * ⚠️ This is deliberately where a confidence score would otherwise be. §4.4 of
   * `isbn-ladder.md`: a wrong answer scored 1.00 on title and 1.00 on author,
   * twice. A number invites ranking; a sentence naming the page invites reading.
   */
  basis?: string | null;
}

export interface ResearchFinding {
  id: number;
  runId: number;
  workId: number;
  field: string;
  value: FindingValue;
  sourceTier: 'official' | 'crowdfunding' | 'retail' | 'community';
  sourceUrl: string | null;
  /** Always null. See `FindingValue.basis`. */
  confidence: number | null;
  reviewState: 'pending' | 'accepted' | 'rejected';
  reviewedAt: string | null;
  createdAt: string;
}

export interface RunView {
  id: number;
  workId: number;
  status: 'queued' | 'running' | 'done' | 'error';
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCents: number;
  asked: string[];
  proposed: number;
  detail: string | null;
  model: string | null;
  effort: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface GapVerdictRow {
  id: number;
  workId: number;
  field: DetailField;
  verdict: 'none' | 'unknown';
  source: string;
  note: string | null;
  runId: number | null;
  decidedAt: string;
}

export interface QueueResponse {
  works: NeedsDetails[];
  summary: FieldGapCount[];
  /** Fields deliberately not asked about, each with the reason. */
  refused: { field: string; because: string }[];
  runs: RunView[];
  spent: {
    runs: number;
    errors: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCents: number;
  };
  model: string;
  centsEach: { low: number; high: number };
  /** False when no Anthropic key is configured, so the page can say so once. */
  configured: boolean;
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
  // Other names a book answers to
  // -------------------------------------------------------------------------

  aliases: (workId: number) => request<{ aliases: WorkAlias[] }>(`/api/works/${workId}/aliases`),

  /**
   * ⚠️ `kind` is required and has no client-side default, mirroring the schema.
   * A title alias helps a search find this book; an author alias stops the author
   * gate refusing it. Guessing which one somebody meant is how an alternate title
   * ends up widening the check that keeps wrong books out.
   */
  addAlias: (workId: number, body: { alias: string; kind: 'title' | 'author' }) =>
    request<{ aliases: WorkAlias[] }>(`/api/works/${workId}/aliases`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteAlias: (workId: number, aliasId: number) =>
    request<{ aliases: WorkAlias[] }>(`/api/works/${workId}/aliases/${aliasId}`, {
      method: 'DELETE',
    }),

  // -------------------------------------------------------------------------
  // Accessories — the things in the box that are not books
  //
  // ⚠️ Every one of these is scoped to a single work, and that is the feature.
  // There is no `api.accessoryCount()` and no collection-wide read, because the
  // owner asked for the count to stay off the main page. Adding one here is how
  // it would arrive there by accident.
  // -------------------------------------------------------------------------

  accessories: (workId: number) =>
    request<{ accessories: Accessory[] }>(`/api/works/${workId}/accessories`),

  addAccessory: (
    workId: number,
    body: {
      name: string;
      kind?: string;
      isDigital?: boolean;
      quantity?: number;
      copyId?: number | null;
      pledgeId?: number | null;
      location?: string | null;
      notes?: string | null;
    },
  ) =>
    request<{ accessories: Accessory[] }>(`/api/works/${workId}/accessories`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** ⚠️ A PATCH: send only what changed. Sending the whole object is safe too. */
  updateAccessory: (workId: number, accessoryId: number, body: Record<string, unknown>) =>
    request<{ accessories: Accessory[] }>(`/api/works/${workId}/accessories/${accessoryId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteAccessory: (workId: number, accessoryId: number) =>
    request<{ accessories: Accessory[] }>(`/api/works/${workId}/accessories/${accessoryId}`, {
      method: 'DELETE',
    }),

  // -------------------------------------------------------------------------
  // Crowdfunding provenance
  // -------------------------------------------------------------------------

  /** Where this book came from. Two rows for one pledge is the physical/digital pair. */
  provenance: (workId: number) =>
    request<{ provenance: Provenance[] }>(`/api/works/${workId}/provenance`),

  /** Owner-only, for the accessory form's "which pledge did this come in" picker. */
  pledgeOptions: () =>
    request<{ pledges: { id: number; label: string }[] }>('/api/crowdfunding/pledges'),

  /** ⚠️ Unlinks the reward line. It does not delete the book or the copy. */
  deletePledgeItem: (itemId: number) =>
    request<{ ok: true }>(`/api/crowdfunding/items/${itemId}`, { method: 'DELETE' }),

  /** Close an `unmatched` line by saying which printing it actually was. */
  matchPledgeItemEdition: (itemId: number, editionId: number | null) =>
    request<{ item: Record<string, unknown> }>(`/api/crowdfunding/items/${itemId}/edition`, {
      method: 'PUT',
      body: JSON.stringify({ editionId }),
    }),

  // -------------------------------------------------------------------------
  // People
  // -------------------------------------------------------------------------

  users: () => request<{ users: Person[] }>('/api/users'),

  /**
   * ⚠️ The server refuses the last owner demoting themselves, and refuses anyone
   * without `manageUsers` outright. The UI disables those buttons too, but the
   * server is the one that decides — see `apps/worker/src/routes/users.ts`.
   */
  setRole: (userId: number, role: 'owner' | 'reader' | 'pending') =>
    request<{ user: Person }>(`/api/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  /**
   * Download the whole catalog.
   *
   * ⚠️ Not a plain `<a download href="/api/export.json">`, and this is the one
   * place that differs from the sibling Board Game Catalog. That app is behind
   * Cloudflare Access, whose session is a **cookie**, so the browser attaches it
   * to an ordinary navigation and an anchor just works. Here the credential is a
   * Firebase **Bearer token** that only `request()` knows how to attach — an
   * anchor would arrive with no Authorization header and 401.
   *
   * ⚠️ And it would have looked fine locally. `middleware/auth.ts`'s dev bypass
   * answers without a token, so an anchor downloads perfectly on `:8787` and
   * fails the moment it is deployed. That is the exact shape of bug this
   * project's notes keep recording, so it is written down rather than discovered.
   *
   * The trade: the response is buffered into a Blob on this device before the
   * save dialog opens. The *server* still streams and pages — see
   * `packages/db/src/export.ts` — but the browser holds the finished file, which
   * for a household catalog is a few hundred kilobytes and for a very large one
   * would want the File System Access API instead (not available on iOS).
   */
  downloadExport: async (format: 'json' | 'csv'): Promise<{ filename: string; blob: Blob }> => {
    const token = await getIdToken(false);
    const res = await fetch(`/api/export.${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(res.status, null, body?.error ?? `HTTP ${res.status}`);
    }
    // The server names the file; the date in it is the server's, which is the one
    // the data is as of.
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const named = /filename="([^"]+)"/.exec(disposition)?.[1];
    return {
      filename: named ?? `library-catalog.${format}`,
      blob: await res.blob(),
    };
  },
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
  /**
   * ONE book, photographed front-on. Same shape as `scanShelf`, different
   * prompt — a cover also yields series, volume and publisher, which a spine
   * almost never prints and which are the discriminators a title and an author
   * cannot substitute for.
   *
   * ⚠️ Costs money, and the photo is never stored — see the route.
   */
  scanSingle: (data: string, mediaType: string) =>
    request<{
      job: ScanJob;
      unreadable: boolean;
      usage: { inputTokens: number; outputTokens: number; estimatedCents: number };
    }>('/api/scan-jobs/single', { method: 'POST', body: JSON.stringify({ data, mediaType }) }),

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
  // Details queue and research
  // -------------------------------------------------------------------------

  queue: () => request<QueueResponse>('/api/research/queue'),

  workFindings: (workId: number) =>
    request<{
      work: { id: number; title: string; authors: string };
      findings: ResearchFinding[];
      runs: RunView[];
      verdicts: GapVerdictRow[];
      missing: DetailField[];
    }>(`/api/research/works/${workId}/findings`),

  /**
   * ⚠️ Spends money, and takes 20–90 seconds. The request is held open for the
   * whole lookup on purpose — see apps/worker/src/lib/research-run.ts. The
   * outcome is written to `research_run` before the response is sent, so a
   * lookup whose response never arrives still shows up on the next poll.
   */
  runResearch: (workId: number) =>
    request<{ run: RunView; alreadyRunning: boolean; findings?: ResearchFinding[] }>(
      `/api/research/works/${workId}/run`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  /**
   * Accept or reject one proposal.
   *
   * ⚠️ Accepting applies it — to a blank column only, never over something
   * already recorded, and a `none`/`unknown` becomes a verdict rather than a
   * value. `applied` and `skipped` say in a sentence what actually happened.
   */
  reviewFinding: (findingId: number, reviewState: 'accepted' | 'rejected') =>
    request<{
      finding: ResearchFinding;
      applied: string | null;
      skipped: string | null;
      missing: DetailField[];
    }>(`/api/research/findings/${findingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ reviewState }),
    }),

  /** Free, and it demands a source. The honest way to close a gap by hand. */
  setVerdict: (
    workId: number,
    body: { field: DetailField; verdict: 'none' | 'unknown'; source: string; note?: string | null },
  ) =>
    request<{ verdict: GapVerdictRow; missing: DetailField[] }>(
      `/api/research/works/${workId}/verdict`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  deleteVerdict: (id: number) =>
    request<{ ok: true }>(`/api/research/verdicts/${id}`, { method: 'DELETE' }),
};
