/**
 * Typed access to the shared `<estate-search>` custom element
 * (`/estate/estate-search.js`).
 *
 * Sibling of estate-theme.ts, same job in the same shape: the implementation
 * lives in catalog-platform, is vendored here as a build artifact
 * (`scripts/sync-estate-search.mjs`), and this file only *loads and drives* it.
 * Nothing here re-implements any search behaviour — ranking, keyboard nav, the
 * debounced-abortable query, the sign-in flash fix and the load-bearing
 * "in catalog, not owned" copy all belong to the component, so a search
 * improvement made upstream reaches this app for free.
 *
 * ## ⚠️ What this is NOT
 *
 * It is not this catalog's search. `pages/CollectionPage.tsx` searches THIS
 * catalog server-side through `/api/collection?q=…`, with facets, sorting and
 * pagination over our own columns; the component cannot replicate any of that
 * and is not meant to. This is the ADDITIVE box: "do we own this on ANY shelf"
 * — audiobooks, books and board games at once, answered by the shared index
 * Worker at index.heygabi.ai.
 *
 * ## ⚠️ Why the element is created by hand instead of in JSX
 *
 * `.authAdapter` must be set BEFORE the element is connected to the document.
 * The component's `connectedCallback` runs `_bootAuthed()` immediately, and
 * that falls back to a dynamic `import('estate-auth.js')` when no adapter
 * property is present. React sets refs *after* the commit that inserts the
 * node, so any JSX shape — ref callback included — is already too late: the
 * boot would have fired, the import would 404 (we deliberately do not vendor
 * estate-auth.js), and the box would silently degrade to authless, which for
 * a library-scoped caller means "audiobooks only, forever".
 *
 * So: load the module, wait for the definition, `document.createElement`, set
 * properties, set attributes, add listeners, and only THEN append. See
 * components/EstateSearch.tsx.
 *
 * ## ⚠️ Why this app's own Firebase is the adapter
 *
 * The estate contract assumes one Firebase project estate-wide, and this app
 * already signs into it (`lib/firebase.ts` — projectId `audiobook-catalog`, the
 * same account that is the same person on the audiobook site and the apex). So
 * the index Worker will accept the token this app already holds. Vendoring
 * catalog-platform's `estate-auth.js` instead would put a SECOND Firebase SDK
 * loader, with its own app instance and its own session, on a page that already
 * has one — two sign-in states to disagree with each other, for no gain.
 *
 * This is the "reuse of the shared Firebase project's session" option
 * catalog-platform docs/TODO.md §0.5 flags as undecided. It is decided here in
 * this app's favour, and only for this app.
 */

import type { User } from 'firebase/auth';
import { getIdToken, signIn, signOutNow, watchAuth } from './firebase.js';
import { describeError } from './errors.js';

/** The tag name, in one place. The sync script checks the source still defines it. */
export const ESTATE_SEARCH_TAG = 'estate-search';

/**
 * One row of the index's answer, as far as this app cares.
 *
 * Deliberately partial: the component owns the full shape (index-worker's
 * `rows.ts`), and the only fields the router hook needs are which shelf the hit
 * came from and where it points. Re-declaring the rest here would be a second
 * copy of another repo's schema, drifting quietly.
 */
export interface EstateSearchHit {
  source?: 'audiobook' | 'library' | 'game';
  detail_url?: string | null;
}

/** `estate-search:select` — cancelable; preventDefault() takes over navigation. */
export interface EstateSelectDetail {
  url: string | null;
  hit: EstateSearchHit | null;
}

/**
 * The adapter surface the component expects, matching catalog-platform's
 * `estate-auth.js` exports. `handleRedirectResult` is optional there and is
 * omitted here — the component guards on `typeof … === 'function'`, and this
 * app has no redirect result of its own to complete: `App.tsx` re-checks
 * `/api/me` from `watchAuth`, which fires on the way back from Google anyway.
 */
export interface EstateAuthAdapter {
  watchAuth(cb: (user: User | null) => void): () => void;
  idToken(): Promise<string | null>;
  signIn(): Promise<{
    ok?: true;
    cancelled?: true;
    redirecting?: true;
    error?: string;
    ownerAction?: true;
  }>;
  signOutUser(): Promise<void>;
}

/** The custom element, once defined. Only the two JS-only properties are typed. */
export interface EstateSearchElement extends HTMLElement {
  authAdapter: EstateAuthAdapter | null;
  /** The per-site intake filter hook. Unset here — see components/EstateSearch.tsx. */
  intakeFilter: ((data: unknown, ctx: { kind: 'search' | 'universe' }) => unknown) | null;
}

/**
 * This app's Firebase, wearing estate-auth.js's clothes.
 *
 * The one place any translation happens is `signIn`: ours throws, theirs
 * returns a tagged result the component renders. A cancelled popup is not an
 * error and must not be shown as one — that is the same distinction
 * `describeError` exists to keep elsewhere.
 */
export function estateAuthAdapter(): EstateAuthAdapter {
  return {
    watchAuth,
    // The SDK caches and refreshes internally, so per-request is the intended
    // use rather than a cost — the same note estate-auth.js carries.
    idToken: () => getIdToken(),
    async signIn() {
      try {
        await signIn();
        // On localhost `signIn()` redirects and this line is not reached in
        // practice; `{ ok: true }` is the honest answer if it ever is.
        return { ok: true };
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
          return { cancelled: true };
        }
        return { error: describeError(err) };
      }
    },
    async signOutUser() {
      // A failed sign-out of an absent session is not news (estate-auth.js's
      // own words), and it must not throw inside the component's click handler.
      await signOutNow().catch(() => {});
    },
  };
}

/**
 * Where the vendored component is served from. `apps/web/public/` is copied to
 * the site root by Vite, so this path is the same in `vite dev` and in the
 * built bundle.
 */
const MODULE_URL: string = '/estate/estate-search.js';

let pending: Promise<void> | null = null;

/**
 * Load the component and resolve once `<estate-search>` is actually defined.
 *
 * ⚠️ The `: string` annotation on MODULE_URL above is load-bearing, not style:
 * with a literal type TypeScript tries to RESOLVE the specifier at build time
 * and fails, because the file is a public asset that does not exist until the
 * sync script runs. Widening to `string` makes it the runtime import it is.
 *
 * Memoised, and the memo is cleared on failure so a later mount can retry
 * rather than inheriting one bad network moment forever.
 */
export function loadEstateSearch(): Promise<void> {
  if (!pending) {
    pending = import(/* @vite-ignore */ MODULE_URL)
      .then(() => customElements.whenDefined(ESTATE_SEARCH_TAG))
      .then(() => undefined)
      .catch((err: unknown) => {
        pending = null;
        throw err;
      });
  }
  return pending;
}
