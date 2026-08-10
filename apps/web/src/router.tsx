/**
 * A router in a hundred lines, most of them comments.
 *
 * ## Why not a library
 *
 * Six screens, no nested layouts, no loaders, no data router. `react-router` is
 * ~20kB over the wire to replace `pushState` and one event listener, on an app
 * whose whole point is to open fast on a phone in front of a bookshelf. The
 * sibling Board Game Catalog reached fourteen routes on the same hand-rolled
 * file and has not needed one; this is a port of it.
 *
 * ## What the URL is for
 *
 * Two things, and the second is the one that was actually broken:
 *
 * 1. **Sending someone a book.** `/work/42` is a link.
 * 2. **The phone's Back button.** Installed to the home screen, a PWA with no
 *    history entries exits the app when Back is pressed — the most-used control
 *    on a phone, doing the most destructive thing it can. Every screen change
 *    now leaves a history entry, so Back goes back.
 *
 * Deep links work because the Worker serves index.html for any non-`/api` path
 * (see `apps/worker/src/index.ts`).
 *
 * ## ⚠️ `navigate` vs `replaceUrl` — the distinction is the whole design
 *
 * See the comment on `replaceUrl`. Collapsing the two would restore the broken
 * Back button in a new disguise.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  COLLECTION_PAGE_SIZES,
  COPY_STATUSES,
  EDITION_FORMATS,
  READ_STATES,
} from '@lc/core';
import { DEFAULT_PREFS, SORTS } from './lib/prefs.js';

/**
 * The three tabs the add screen owns. Kept here so `parse` can validate them.
 *
 * `photo` is the shelf camera. It is a *tab*, not a screen, for the reason
 * `/add` is one flat path at all: a standalone PWA on iOS re-prompts for camera
 * permission on every route change (WebKit #215884), and two of these three
 * tabs open a camera. Splitting them would ask twice.
 */
export type AddMode = 'scan' | 'photo' | 'type';
const ADD_MODES: readonly AddMode[] = ['scan', 'photo', 'type'];

/**
 * What the collection is showing, as opposed to which screen it is.
 *
 * It lives in the URL so that opening a book and pressing Back returns you to
 * the search you were in the middle of, rather than to an unfiltered page 1.
 *
 * The three presentation fields — sort, dir, pageSize — are `null` when the URL
 * says nothing, and the page falls back to the stored prefs for those. That
 * layering is deliberate: a **link** should carry the sort it was taken with, but
 * a **bare `/`** should still open the way this person likes it. `view` is
 * absent on purpose; nothing else on the page depends on it, so it stays a pure
 * preference rather than a thing to serialise. `pageSize` is here precisely
 * because something does depend on it — `?page=3` means nothing without it.
 */
export interface CollectionFilters {
  q: string;
  series: string;
  format: string;
  status: string;
  readState: string;
  sort: string | null;
  dir: 'asc' | 'desc' | null;
  pageSize: number | null;
  /** 1-based, as a person reads it. The page counts from 0 internally. */
  page: number;
}

export type Route =
  | { name: 'collection'; filters: CollectionFilters }
  | { name: 'work'; id: number }
  | { name: 'series' }
  | { name: 'seriesDetail'; series: string }
  | { name: 'wishlist' }
  // `?mode=` lets a caller land on the right tab of the add screen rather than
  // on the right screen and the wrong tab. Optional, and an unrecognised value
  // falls back to the screen's own default, so junk is harmless.
  //
  // `?job=` is what makes a sweep survive a locked phone: the screen writes the
  // job id into the URL as soon as the server mints one, so a reload — or a
  // link from the queue — reopens the same sweep with every line still on it.
  | { name: 'add'; mode: AddMode | null; job: number | null }
  | { name: 'scans' }
  // Two owner-only screens. They are routes rather than modals for the same
  // reason every other screen is: a URL you can bookmark, and a Back button that
  // leaves rather than dismissing something invisible. `App.tsx` gates both on a
  // capability, exactly as it gates `/add` — a screen with an address is a screen
  // a reader can type.
  | { name: 'export' }
  | { name: 'people' }
  | { name: 'notFound' };

/* -- reading the URL ------------------------------------------------------- */

/** A query parameter, but only if it is one of the values the page understands. */
function pick<T extends string>(search: string, key: string, allowed: readonly T[]): T | null {
  const raw = new URLSearchParams(search).get(key);
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

/** A page number, or 1. `Number(null)`, `Number('')` and `Number('abc')` all fail. */
function positiveInt(search: string, key: string): number {
  const n = Number(new URLSearchParams(search).get(key));
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function pageSizeOf(search: string): number | null {
  const n = Number(new URLSearchParams(search).get('size'));
  return COLLECTION_PAGE_SIZES.includes(n) ? n : null;
}

/**
 * A percent-encoded path segment, or '' if it is malformed.
 *
 * `decodeURIComponent` throws a URIError on a lone `%`, which a hand-edited URL
 * or a truncated share can easily contain — and an uncaught throw here would
 * blank the whole app rather than showing a not-found screen.
 */
function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
}

function parseCollection(search: string): CollectionFilters {
  const p = new URLSearchParams(search);
  return {
    q: p.get('q') ?? '',
    // Open-ended: series names come from the catalog, so there is no closed set
    // to check against. The server parameterises it, and a name that matches
    // nothing shows an empty list, which is the honest answer.
    series: p.get('series') ?? '',
    format: pick(search, 'format', EDITION_FORMATS) ?? '',
    status: pick(search, 'status', COPY_STATUSES) ?? '',
    readState: pick(search, 'read', READ_STATES) ?? '',
    sort: pick(search, 'sort', SORTS),
    dir: pick(search, 'dir', ['asc', 'desc'] as const),
    pageSize: pageSizeOf(search),
    page: positiveInt(search, 'page'),
  };
}

/**
 * The inverse of `parseCollection`, kept beside it so the parameter names have
 * one definition.
 *
 * Shipped defaults are omitted, so an ordinary browse is `/` and not
 * `/?q=&sort=series&page=1`. Note that the comparison is against
 * `DEFAULT_PREFS`, not against this person's stored prefs: somebody who has
 * chosen "sort by title" gets `/?sort=title` in the address bar, which is what
 * makes the link they copy show what they were looking at.
 */
export function collectionPath(f: CollectionFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.series) p.set('series', f.series);
  if (f.format) p.set('format', f.format);
  if (f.status) p.set('status', f.status);
  if (f.readState) p.set('read', f.readState);
  if (f.sort && f.sort !== DEFAULT_PREFS.sort) p.set('sort', f.sort);
  if (f.dir && f.dir !== DEFAULT_PREFS.dir) p.set('dir', f.dir);
  if (f.pageSize && f.pageSize !== DEFAULT_PREFS.pageSize) p.set('size', String(f.pageSize));
  if (f.page > 1) p.set('page', String(f.page));
  const qs = p.toString();
  return qs ? `/?${qs}` : '/';
}

export function workPath(id: number): string {
  return `/work/${id}`;
}

/**
 * ⚠️ Encoded, always. Real series names here include `Tamer: King of Dinosaurs`
 * and `Beneath the Dragoneye Moons` — a colon and spaces — and nothing stops a
 * future one containing a `/`, `?` or `#`. `encodeURIComponent` turns all of
 * them into a single safe segment, and `decodeSegment` puts them back; `parse`
 * splits on literal slashes, which an encoded `%2F` is not.
 */
export function seriesPath(name: string): string {
  return `/series/${encodeURIComponent(name)}`;
}

/**
 * ⚠️ The job id belongs in the URL, not only in React state.
 *
 * That is the whole persistence feature seen from the client side: the server
 * remembers the lines, and this remembers *which* sweep you were on. Without it
 * a reload lands on an empty scan screen with a finished job sitting invisibly
 * in the queue behind it.
 */
export function addPath(mode?: AddMode, job?: number | null): string {
  const p = new URLSearchParams();
  if (mode) p.set('mode', mode);
  if (job) p.set('job', String(job));
  const qs = p.toString();
  return qs ? `/add?${qs}` : '/add';
}

export const scansPath = '/scans';

function parse(pathname: string, search: string): Route {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  if (parts.length === 0) return { name: 'collection', filters: parseCollection(search) };

  if (parts[0] === 'work' && parts.length === 2) {
    const id = Number(parts[1]);
    if (Number.isInteger(id) && id > 0) return { name: 'work', id };
  }

  if (parts[0] === 'series') {
    if (parts.length === 1) return { name: 'series' };
    if (parts.length === 2) {
      const series = decodeSegment(parts[1]!);
      if (series) return { name: 'seriesDetail', series };
    }
  }

  if (parts[0] === 'wishlist' && parts.length === 1) return { name: 'wishlist' };

  // ⚠️ One flat route, no segment per tab. A standalone PWA on iOS re-prompts
  // for camera permission on every route change (WebKit #215884), and this is
  // the one screen that opens a camera — so switching between "Scan a barcode"
  // and "Type it in" must not change the path. The tab is a query parameter,
  // written with `replaceUrl`, for exactly that reason.
  if (parts[0] === 'add' && parts.length === 1) {
    const job = Number(new URLSearchParams(search).get('job'));
    return {
      name: 'add',
      mode: pick(search, 'mode', ADD_MODES),
      job: Number.isInteger(job) && job > 0 ? job : null,
    };
  }

  if (parts[0] === 'scans' && parts.length === 1) return { name: 'scans' };
  if (parts[0] === 'export' && parts.length === 1) return { name: 'export' };
  if (parts[0] === 'people' && parts.length === 1) return { name: 'people' };

  return { name: 'notFound' };
}

/* -- changing the URL ------------------------------------------------------ */

/**
 * What we remember about the entry we came from.
 *
 * One field, and it buys back the thing the `Screen` union used to do by hand:
 * a book opened from a series ladder says "← Beneath the Dragoneye Moons" and
 * goes there, a book opened from the collection says "← Collection". The
 * browser will not tell you what the previous entry was, so `navigate` writes
 * it down on the way past.
 *
 * It survives a reload — `history.state` is persisted with the entry — so a
 * hard refresh on a book page keeps its back button pointing where it did.
 * A pasted link has no state, and then the fallback path is used instead.
 */
interface NavState {
  from?: string;
}

/** The current URL as `navigate` would record it. */
function here(): string {
  return window.location.pathname + window.location.search;
}

export function navigate(to: string): void {
  window.history.pushState({ from: here() } satisfies NavState, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Rewrite the URL in place: no history entry, and no popstate.
 *
 * ⚠️ Do not "fix" this into `navigate`. The collection's filters are written
 * here on every change and the search box is live — a pushState per keystroke
 * would put ten entries in the history for a ten-character search, and Back
 * would be broken again in a way that is harder to see. What Back has to do is
 * return you to the search you left, and for that the collection URL only has
 * to be *correct at the moment you navigate away*, which replaceState gives for
 * free at one entry per screen.
 *
 * Withholding the popstate matters just as much: the page that owns this state
 * is already re-rendering from it, and telling the router would remount that
 * page underneath itself mid-keystroke.
 *
 * The existing state is carried through rather than cleared, so rewriting the
 * filters does not forget where this entry was reached from.
 */
export function replaceUrl(path: string): void {
  window.history.replaceState(window.history.state, '', path);
}

export function useRoute(): Route {
  const read = useCallback(() => parse(window.location.pathname, window.location.search), []);
  const [route, setRoute] = useState<Route>(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, [read]);

  return route;
}

/* -- going back ------------------------------------------------------------ */

/** What a path is called, so a back button can name where it goes. */
export function labelFor(path: string): string {
  const p = path.split('?')[0] ?? '/';
  if (p === '/' || p === '') return 'Collection';
  if (p === '/series') return 'Series';
  if (p === '/wishlist') return 'Wishlist';
  if (p === '/add') return 'Add books';
  if (p === '/scans') return 'Sweeps';
  if (p === '/export') return 'Export';
  if (p === '/people') return 'People';
  if (p.startsWith('/series/')) return decodeSegment(p.slice('/series/'.length)) || 'Series';
  // A book, and the path does not carry its title. "Back" is honest; inventing
  // "the last book" would be worse than saying less.
  return 'Back';
}

/**
 * Where a screen's own back button should go, and what it should say.
 *
 * Not a hook — it reads `window.history.state` at render time, and every screen
 * that calls it is re-rendered by `useRoute` when the route changes.
 *
 * The two cases differ in more than the label. Arriving from inside the app,
 * `history.back()` is the right move: it pops the entry rather than pushing a
 * third one, so Back does not oscillate between two screens. Arriving cold — a
 * pasted link, a bookmark — there is nothing to pop, and `back()` would leave
 * the site, so the fallback is pushed instead.
 */
export function backTarget(fallback: string): { label: string; go: () => void } {
  const from = (window.history.state as NavState | null)?.from;
  return from
    ? { label: labelFor(from), go: () => window.history.back() }
    : { label: labelFor(fallback), go: () => navigate(fallback) };
}

/* -- links ----------------------------------------------------------------- */

/**
 * An anchor that routes client-side but still behaves like a real link.
 *
 * Real, meaning: it has an href, so the status bar shows where it goes, "open
 * in new tab" works, and a middle click does what a middle click does. Modified
 * clicks are handed to the browser untouched.
 */
export function Link({
  to,
  children,
  className,
  title,
  'aria-label': ariaLabel,
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
  title?: string;
  'aria-label'?: string;
}) {
  return (
    <a
      href={to}
      className={className}
      title={title}
      aria-label={ariaLabel}
      onClick={(e) => {
        // Let modified clicks (new tab, new window, download) behave natively.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
