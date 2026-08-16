/**
 * "Search every shelf" — the shared `<estate-search>` element, in the top bar.
 *
 * A thin wrapper and nothing more: it loads the vendored custom element,
 * configures it, listens for its two events, and hands the one event that
 * matters to THIS app's router. Every search behaviour — ranking, grouping,
 * keyboard nav, the debounce, the sign-in flash fix, the copy — belongs to the
 * component in catalog-platform, so an improvement made there arrives here on
 * the next build. See lib/estate-search.ts for the loader and the auth adapter.
 *
 * ## ⚠️ ADDITIVE. It does not replace this catalog's own search.
 *
 * `pages/CollectionPage.tsx` searches THESE books server-side through
 * `/api/collection?q=…`, with facets, sorts and pagination over our own
 * columns. That is a different question and it stays exactly as it is. This box
 * answers the one the collection page cannot: "do we own this on ANY shelf" —
 * audiobooks, the library and the board games at once, from the shared index.
 * If you find yourself teaching this component about our filters, stop.
 *
 * ## ⚠️ THIS APP HAS NO react-router-dom
 *
 * It ships a hand-rolled pushState router (`src/router.tsx`) whose navigate
 * equivalent is the exported `navigate(to: string)`. `onEstateSelect` below
 * calls exactly that. A wrapper reaching for `useNavigate` or `<Link>` would be
 * wrong — there is nothing to reach for.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ESTATE_SEARCH_TAG,
  estateAuthAdapter,
  loadEstateSearch,
  type EstateSearchElement,
  type EstateSelectDetail,
} from '../lib/estate-search.js';
import { navigate } from '../router.js';

/**
 * The helper line under the box.
 *
 * Overridden rather than left at the component's default because the default is
 * written for the apex's front door, where there is no other search on the
 * page. Here there is, a few pixels away, and the one thing a reader needs to
 * know is which box does which job.
 */
const HINT =
  'Every shelf at once — audiobooks, these books, and the board games. ' +
  'The box on the collection page searches only the books catalogued here.';

/**
 * `estate-search:select` — the SPA hook the component exists to offer.
 *
 * The event is cancelable and fires INSTEAD of the component's default
 * `window.open(url, '_blank')`. So: a hit from this catalog is routed
 * client-side, and a hit from the audiobook site or the games catalog is left
 * alone to open in its own tab, which is right — those are other origins and we
 * cannot render them.
 *
 * ⚠️ The test is `hit.source === 'library'`, the index's own word for which
 * shelf answered — NOT a comparison of URL origins. Origins disagree with
 * themselves in dev: `detail_url` is minted as `https://library.heygabi.ai/work/
 * 42` by packages/db/src/index-projection.ts and is that in every environment,
 * while `window.location.origin` is localhost:5174 under `vite dev`. Matching
 * on origin would send you to another tab on your own machine.
 */
function onEstateSelect(event: Event): void {
  const detail = (event as CustomEvent<EstateSelectDetail>).detail;
  const url = detail?.url;
  if (!url || detail?.hit?.source !== 'library') return;

  let path: string;
  try {
    const parsed = new URL(url, window.location.origin);
    path = parsed.pathname + parsed.search;
  } catch {
    // A detail_url we cannot parse is not something to swallow: let the
    // component do what it would have done, which is try to open it.
    return;
  }

  event.preventDefault();
  navigate(path);
}

/**
 * ⚠️ WORKAROUND FOR AN UPSTREAM BUG, found by opening the panel in a browser.
 *
 * `estate-search.js` hides its barcode/shelf-scan row with the `hidden`
 * attribute and then styles it `.es-scan-row { display: flex; … }` — an author
 * rule, which beats the UA stylesheet's `[hidden] { display: none }`. So the
 * two scan buttons render on EVERY embed that does not ask for them, including
 * this one, and they cannot work: their logic lives in `estate-scan.js`, which
 * is only fetched when the `scan` attribute is set and which this app does not
 * vendor. Two visible controls that can only fail is exactly what "never a dead
 * button" forbids.
 *
 * The sibling `.es-camera-stage[hidden] { display: none; }` sits four lines
 * below it in the same stylesheet, so the omission is an oversight rather than
 * an intent — but catalog-platform is another repo, and this app must not wait
 * on it to render honestly.
 *
 * ⚠️ This is the ONE rule allowed inside the component's shadow root, and it
 * only re-asserts an attribute the component itself set. It does not change any
 * behaviour, and it becomes a harmless no-op the moment upstream adds the
 * guard. Anything beyond this belongs in catalog-platform.
 */
function guardHiddenScanRow(el: EstateSearchElement): void {
  const root = el.shadowRoot;
  if (!root) return;
  const style = document.createElement('style');
  style.textContent = '.es-scan-row[hidden] { display: none !important; }';
  root.appendChild(style);
}

/**
 * Put the cursor in the box, once it is usable.
 *
 * The second and last reach into the component's shadow root, and a read-only
 * one. Fully guarded: a component that stops having a search input loses the
 * focus, not the panel.
 */
function focusSearchInput(event: Event): void {
  const el = event.currentTarget as EstateSearchElement | null;
  el?.shadowRoot?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
}

/** The top-bar control that opens the panel. Icon-only; the words are in the label. */
export function EstateSearchToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="estate-toggle"
      aria-expanded={open}
      aria-controls="estate-search-panel"
      aria-label="Search every shelf"
      title="Search every shelf"
      onClick={onToggle}
    >
      {/* Drawn inline so it inherits currentColor in every theme — the same
          rule ThemeCog's gear follows. */}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="6.25" stroke="currentColor" strokeWidth="1.8" />
        <path d="M15.6 15.6 20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}

type PanelState = 'loading' | 'ready' | 'failed';

/**
 * The panel itself, mounted below the top bar while it is open.
 *
 * Unmounting on close is deliberate: the element's `disconnectedCallback`
 * aborts any in-flight request and clears its timers, so closing the panel
 * genuinely stops it. The module stays cached, so reopening costs nothing.
 */
export function EstateSearchPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let el: EstateSearchElement | null = null;

    void loadEstateSearch()
      .then(() => {
        if (cancelled || !hostRef.current) return;
        el = document.createElement(ESTATE_SEARCH_TAG) as EstateSearchElement;

        // ⚠️ PROPERTIES AND ATTRIBUTES BEFORE `appendChild`, always. The element
        // boots in `connectedCallback`, and an adapter set afterwards is an
        // adapter set too late — see lib/estate-search.ts for the whole story.
        el.authAdapter = estateAuthAdapter();
        // `intakeFilter` is left unset on purpose. It exists to let a host
        // NARROW the answer (a library app dropping non-library rows), and
        // narrowing is the one thing this box must not do: the entire reason it
        // is here is the shelves this app cannot see.
        el.setAttribute('auth', 'authed');
        el.setAttribute('hint', HINT);
        // No `source` attribute: the default is 'all', and any preset could only
        // narrow. No `scan` either — scanning here is /add's own screen, with
        // the catalog's add-to-shelf flow behind it.
        el.addEventListener('estate-search:select', onEstateSelect);
        // ⚠️ NOT `appendChild` then `focus()`. The box boots NEUTRAL — the input
        // is `disabled` until the auth adapter's first callback (the component's
        // sign-in flash fix), and focusing a disabled input silently does
        // nothing. `estate-search:auth` is the component's own word for "I am
        // usable now", so the focus hangs off that rather than off a guess about
        // Firebase's timing. Measured in a browser: the naive version never
        // focused, once.
        el.addEventListener('estate-search:auth', focusSearchInput, { once: true });
        guardHiddenScanRow(el);

        host.appendChild(el);
        setState('ready');
      })
      .catch((err: unknown) => {
        console.warn('[estate-search] the shared component did not load:', err);
        if (!cancelled) setState('failed');
      });

    return () => {
      cancelled = true;
      if (el) {
        el.removeEventListener('estate-search:select', onEstateSelect);
        el.removeEventListener('estate-search:auth', focusSearchInput);
        el.remove();
      }
    };
  }, []);

  return (
    <section id="estate-search-panel" className="estate-panel" aria-label="Search every shelf">
      <div ref={hostRef} />
      {state === 'loading' && <p className="muted small estate-panel__note">Loading…</p>}
      {/* ⚠️ Never a bare failure, and never a dead box. The script is a build
          artifact synced from catalog-platform; if it is absent the honest
          answer names the one search that still works. */}
      {state === 'failed' && (
        <p className="muted small estate-panel__note">
          The estate search could not load, so only this catalog can be searched right now —
          use the search box on the collection page. Reloading usually fixes it.
        </p>
      )}
    </section>
  );
}
