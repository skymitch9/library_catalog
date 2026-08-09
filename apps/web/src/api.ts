/**
 * The API client. One place that knows how a request is authenticated, so
 * nothing else has to.
 */

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
}

export const api = {
  me: () => request<Me>('/api/me'),

  collection: (params: { q?: string; series?: string; format?: string; page?: number }) => {
    const u = new URLSearchParams();
    if (params.q) u.set('q', params.q);
    if (params.series) u.set('series', params.series);
    if (params.format) u.set('format', params.format);
    if (params.page) u.set('page', String(params.page));
    return request<{ rows: WorkSummary[]; total: number; page: number; pageSize: number }>(
      `/api/collection?${u}`,
    );
  },

  work: (id: number) => request<Record<string, unknown>>(`/api/works/${id}`),

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
};
