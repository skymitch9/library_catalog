import { CAPABILITY_MATRIX, ROLE_LADDER, type Capability, type Role } from '@lc/core';
import { ApiError } from '../api.js';
import { describeUnavailable } from './error-wording.js';

/**
 * Turns a failed request into a sentence a person can act on.
 *
 * `docs/info/ROLES.md` §1e (audiobook_catalog, the canonical copy of this
 * standard) sets the bar: **nobody sees a bare HTTP status.** Every refusal
 * says what happened, what it needs (naming the role), and how to get it; a
 * network/server failure must never read as a permission problem.
 *
 * This is the ONE place that decodes an `ApiError` into words — every screen
 * that shows an error routes through here rather than printing `err.message`
 * (which, before this existed, was the server's machine code: `'forbidden'`,
 * `'unauthenticated'`, or a bare `HTTP 500` when the body was not JSON).
 */

/** What each capability lets you do, in the words a refusal should use. */
const CAPABILITY_LABEL: Record<Capability, string> = {
  read: 'Viewing the collection',
  trackReading: 'Tracking your reading',
  suggestWishlist: 'Asking for a book',
  editCatalog: 'Adding or editing books',
  manageWishlist: 'Editing the wishlist',
  scanBarcode: 'Scanning a barcode',
  scanPhoto: 'Scanning a photo',
  runResearch: 'Running research',
  reviewFindings: 'Reviewing research findings',
  moderateContent: "Removing someone else's content note",
  manageUsers: 'Managing people',
};

/** The lowest rung on the ladder that already holds this capability. */
function minRoleFor(capability: Capability): Role {
  const allowed = CAPABILITY_MATRIX[capability] as readonly Role[];
  for (const role of ROLE_LADDER) {
    if (allowed.includes(role)) return role;
  }
  return 'owner';
}

function humanizeCode(code: string | undefined): string | null {
  if (!code) return null;
  return code.replace(/_/g, ' ');
}

interface ForbiddenBody {
  error?: string;
  capability?: string;
  role?: string;
  detail?: unknown;
}

/**
 * The human sentence for a failed `api.*` call. Safe to call on anything a
 * `catch` block might see — an `ApiError` from `request()`, a `TypeError`
 * from `fetch` itself (offline, DNS, CORS), or an ordinary `Error`.
 */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = (err.body ?? null) as ForbiddenBody | null;

    // Not signed in — or a token that expired mid-session; `request()` already
    // retried once with a fresh token before this could surface.
    if (err.status === 401) {
      return 'Your session has expired. Sign in again to continue.';
    }

    if (err.status === 403) {
      // capabilityDenied() in the Worker's auth middleware is the one shape
      // every role refusal takes — see apps/worker/src/middleware/auth.ts.
      if (body?.error === 'forbidden') {
        if (body.role === 'pending') {
          return 'Your account is waiting to be approved by an owner or admin.';
        }
        const capability = body.capability as Capability | undefined;
        if (capability && capability in CAPABILITY_LABEL) {
          const needs = minRoleFor(capability);
          return `${CAPABILITY_LABEL[capability]} needs the ${needs} role. Ask an owner or admin to grant it.`;
        }
        return 'Your role does not allow that. Ask an owner or admin for access.';
      }
      // estate_revoked — computed, never stored (see auth.ts). Quiet and
      // non-accusatory on purpose: never explain the enforcement to the
      // person it just applied to.
      if (body?.error === 'estate_revoked') {
        return 'This account no longer has access here.';
      }
      return 'You do not have permission to do that.';
    }

    // The body says WHICH 503 this is: `scan_unavailable` is the scan service
    // being unconfigured (an outage with nothing to do with the person asking,
    // whose sentence the Worker already wrote), while `estate_unreachable`
    // keeps the access wording because it is the one 503 that really is about
    // not being able to CHECK access. `error-wording.ts` holds the decision —
    // it is a leaf so a test can reach it without Vite.
    if (err.status === 503) {
      return describeUnavailable(body);
    }

    if (err.status === 404) {
      return 'That could not be found.';
    }

    if (err.status >= 500) {
      return 'The server had a problem. Try again in a moment.';
    }

    // Ordinary validation / business refusals (400/409/422/…) — the route
    // usually already wrote a sentence into `detail`; fall back to a
    // de-snaked version of the error code rather than the raw code itself.
    if (typeof body?.detail === 'string' && body.detail) return body.detail;
    // A zod `.safeParse` failure's `issues` array, passed through as `detail`
    // — say which field and what was wrong with it rather than "bad request".
    if (Array.isArray(body?.detail)) {
      const issues = body.detail as { path?: unknown[]; message?: string }[];
      const said = issues
        .map((i) => `${(i.path ?? []).join('.') || 'value'}: ${i.message ?? 'is invalid'}`)
        .join('; ');
      if (said) return said;
    }
    return humanizeCode(body?.error) ?? `Something went wrong (${err.status}).`;
  }

  // fetch() itself throws a TypeError for "failed to fetch" — offline, a
  // dropped connection, CORS. That is never a permission failure.
  if (err instanceof TypeError) {
    return "Couldn't reach the server. Check your connection and try again.";
  }

  return err instanceof Error ? err.message : String(err);
}
