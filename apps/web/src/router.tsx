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
  EDITION_KINDS,
  EDITION_MEDIA,
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
export type AddMode = 'scan' | 'single' | 'photo' | 'type';
const ADD_MODES: readonly AddMode[] = ['scan', 'single', 'photo', 'type'];

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
/**
 * The values the "needs attention" control accepts.
 *
 * ⚠️ Kept here rather than in `@lc/core` on purpose: unlike `EDITION_FORMATS` or
 * `COPY_STATUSES` these are not a domain vocabulary that anything stores — they
 * are three canned queries, defined once as SQL in `NEEDS_CLAUSE`
 * (`packages/db/src/works.ts`) and once as a URL word here. Promoting them to a
 * shared constant would imply a column somewhere holds one, and none does.
 */
export const NEEDS_FILTERS = ['cover', 'watch', 'author', 'any'] as const;
export type NeedsFilter = (typeof NEEDS_FILTERS)[number];

/**
 * The values the "Printing" control accepts. Migration 0050.
 *
 * ⚠️ **Half stored vocabulary, half canned query, and the join is deliberate.**
 * `EDITION_KINDS` comes from `@lc/core` because a column really does hold those
 * values — the rule `NEEDS_FILTERS` states just above, applied in the other
 * direction. `'unsorted'` is appended here and nowhere else, because nothing
 * stores it: it is the query "named, but nothing has said what kind", defined
 * once as SQL in `KIND_CLAUSE` (`packages/db/src/works.ts`) and once as a URL
 * word here. Promoting it into `EDITION_KINDS` would imply a row could BE
 * unsorted, and the whole point of that column is that a null means ordinary.
 */
export const EDITION_KIND_FILTERS = [...EDITION_KINDS, 'unsorted'] as const;
export type EditionKindFilter = (typeof EDITION_KIND_FILTERS)[number];

/**
 * The values the physical-shelf narrowing accepts.
 *
 * `hide` excludes books held only as an ebook file; `show` explicitly includes
 * them (overriding the default). When NEITHER is in the URL, the collection
 * defaults to hiding ebooks — physical books only — matching the "Recently
 * Added" strip. A one-word vocabulary rather than `?ebookOnly=1`, because `show`
 * now means "I explicitly asked to see everything" and `hide` means the
 * narrowing is active.
 */
export const EBOOK_ONLY_FILTERS = ['hide', 'show'] as const;
export type EbookOnlyFilter = (typeof EBOOK_ONLY_FILTERS)[number];

export interface CollectionFilters {
  q: string;
  series: string;
  /** The coarse axis — `physical` or `ebook`. Narrower than `format`, not instead of it. */
  medium: string;
  /**
   * `hide`, `show`, or empty — whether to leave out the books held only as an
   * ebook file.
   *
   * ⚠️ The one filter here with **no control of its own**, and that is on
   * purpose rather than an omission. It is what "Recently added" means now that
   * ebooks have their own site, and "See all" carries it into the list so the
   * strip and the list it expands into cannot disagree. It is in the URL like
   * every other filter so Back returns to the same shelf, and **Clear turns it
   * off**, which is the whole escape hatch it needs: nothing about it is
   * discoverable, so nothing about it may be inescapable.
   *
   * When empty (no URL param), the page defaults to hiding ebooks. `show`
   * is the explicit opt-in to see everything, used by "Show them here too".
   */
  ebookOnly: string;
  format: string;
  /**
   * How fancy the printing is — `collectors`, `unsorted`, or empty.
   *
   * A third axis beside `medium` and `format`, and orthogonal to both: a
   * slipcased signed hardcover is physical, a hardcover, and a collector's
   * edition, and none of the three implies another.
   */
  editionKind: string;
  status: string;
  /**
   * What is still outstanding — `cover`, `watch`, `any`, or empty.
   *
   * ⚠️ The one filter that is about **us** rather than about the books. It is in
   * the URL like the rest so "the books still needing a cover" is a link that
   * can be sent, bookmarked, or come back to after pressing Back out of one.
   */
  needs: string;
  /**
   * One shared fictional world — `The Cosmere`, `Runnerverse` — or empty.
   *
   * ⚠️ The tier **above** `series`, and it composes with it rather than
   * replacing it. It is open-ended in the URL like `series` is, but for the
   * opposite reason: series names come from the catalog and have no closed set,
   * while universe names come from a shared list in another repo that this
   * bundle deliberately does not carry. The server folds `cosmere` onto
   * `The Cosmere` and ignores anything that is not one of the six, so an
   * unrecognised value shows the collection.
   */
  universe: string;
  readState: string;
  sort: string | null;
  dir: 'asc' | 'desc' | null;
  pageSize: number | null;
  /** 1-based, as a person reads it. The page counts from 0 internally. */
  page: number;
}

/**
 * How the series list is ordered.
 *
 * ⚠️ `name` is the default and must stay the default. "Most missing first" looks
 * like the more useful order and is not: it reorders itself every time a book is
 * bought or a source is consulted, so the series you were looking at a moment
 * ago is somewhere else, and a list you cannot form a habit about is a list you
 * have to read end to end every time. The other orders are what the control is
 * for — chosen, and then visible in the URL.
 */
export const SERIES_SORTS = ['name', 'missing', 'books', 'audio'] as const;
export type SeriesSort = (typeof SERIES_SORTS)[number];

/**
 * What the series list is showing.
 *
 * In the URL for the same reason the collection's filters are: opening a series
 * and pressing Back returns you to the list you had narrowed, not to all of it.
 */
export interface SeriesFilters {
  q: string;
  sort: SeriesSort;
  gapsOnly: boolean;
}

export type Route =
  | { name: 'collection'; filters: CollectionFilters }
  | { name: 'work'; id: number }
  | { name: 'series'; filters: SeriesFilters }
  | { name: 'seriesDetail'; series: string }
  // The tier above a series. A screen of its own rather than a filtered
  // collection, because what it has to show is the *spread* — the same world
  // across several series plus a handful of standalones — and a flat list of
  // books sorted by series is not that. `/?universe=` exists too and is the
  // other half of the pair: this page groups, that one filters.
  | { name: 'universe'; universe: string }
  | { name: 'wishlist' }
  // What this person means to read next, across every catalog. A screen of its
  // own rather than a filter on the collection, and the reason is not layout:
  // the list is NOT a subset of these shelves. It lives in the shared
  // `readingLists` collection and most of it is audiobooks this catalog does
  // not hold, so there is nothing for `/api/collection` to filter — see
  // pages/TbrPage.tsx.
  | { name: 'tbr' }
  // `?field=` narrows the worklist to one question. A query parameter and not a
  // segment, for the same reason the collection's filters are: it is what the
  // page is *showing*, not which page it is, and switching it must not put an
  // entry in the history for every click.
  | { name: 'queue'; field: string | null }
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
    // Open-ended for a different reason than `series` — see the field's note.
    // The six names live in `@lc/universes`, which reads another repo at build
    // time; importing it here to validate one query parameter would put a
    // cross-repo build artifact in the phone's bundle to duplicate a check the
    // server already makes.
    universe: p.get('universe') ?? '',
    medium: pick(search, 'medium', EDITION_MEDIA) ?? '',
    // Closed vocabulary, checked here, so `?ebooks=maybe` is simply the whole
    // collection rather than a state the page has no rendering for.
    ebookOnly: pick(search, 'ebooks', EBOOK_ONLY_FILTERS) ?? '',
    format: pick(search, 'format', EDITION_FORMATS) ?? '',
    editionKind: pick(search, 'kind', EDITION_KIND_FILTERS) ?? '',
    status: pick(search, 'status', COPY_STATUSES) ?? '',
    needs: pick(search, 'needs', NEEDS_FILTERS) ?? '',
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
  if (f.universe) p.set('universe', f.universe);
  if (f.medium) p.set('medium', f.medium);
  // `?ebooks=hide` in the address bar, `ebookOnly` in the API — the same
  // shortening `readState` → `?read=` and `editionKind` → `?kind=` already use,
  // and safe for the same reason: this function and `parseCollection` are the
  // only two places that spell either name.
  if (f.ebookOnly) p.set('ebooks', f.ebookOnly);
  if (f.format) p.set('format', f.format);
  if (f.editionKind) p.set('kind', f.editionKind);
  if (f.status) p.set('status', f.status);
  if (f.needs) p.set('needs', f.needs);
  if (f.readState) p.set('read', f.readState);
  if (f.sort && f.sort !== DEFAULT_PREFS.sort) p.set('sort', f.sort);
  if (f.dir && f.dir !== DEFAULT_PREFS.dir) p.set('dir', f.dir);
  if (f.pageSize && f.pageSize !== DEFAULT_PREFS.pageSize) p.set('size', String(f.pageSize));
  if (f.page > 1) p.set('page', String(f.page));
  const qs = p.toString();
  return qs ? `/?${qs}` : '/';
}

/**
 * The collection, filtered to one universe and to nothing else.
 *
 * Built through `collectionPath` rather than by hand, because that function is
 * the one definition of the parameter names — a second place spelling
 * `?universe=` is a second place to misspell it.
 */
export function collectionInUniversePath(universe: string): string {
  return collectionPath({
    q: '',
    series: '',
    universe,
    medium: '',
    // A universe spans catalogs and a link into it is a link to the whole world
    // this shelf holds, so it carries no shelf narrowing of its own.
    ebookOnly: '',
    format: '',
    editionKind: '',
    status: '',
    needs: '',
    readState: '',
    sort: null,
    dir: null,
    pageSize: null,
    page: 1,
  });
}

export function workPath(id: number): string {
  return `/work/${id}`;
}

function parseSeriesList(search: string): SeriesFilters {
  return {
    q: new URLSearchParams(search).get('q') ?? '',
    sort: pick(search, 'sort', SERIES_SORTS) ?? 'name',
    gapsOnly: new URLSearchParams(search).get('gaps') === '1',
  };
}

/**
 * The inverse of `parseSeriesList`, kept beside it.
 *
 * Defaults are omitted so an ordinary visit is `/series` and not
 * `/series?q=&sort=name`. ⚠️ It must stay exactly `/series` in that case: the
 * top bar highlights the tab by comparing route names, but `labelFor` and the
 * back button compare paths, and a bare visit that rewrote itself to
 * `/series?sort=name` would put a second, differently-spelled entry in the
 * history for the same screen.
 */
export function seriesListPath(f: SeriesFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.sort !== 'name') p.set('sort', f.sort);
  if (f.gapsOnly) p.set('gaps', '1');
  const qs = p.toString();
  return qs ? `/series?${qs}` : '/series';
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
 * ⚠️ Encoded, for the reason `seriesPath` gives — `CAL Verse` and
 * `The Cosmere` both carry a space, and the shared list is edited in another
 * repo, so nothing here can promise what a future name contains.
 *
 * The name is the id. The server folds spellings onto the owner's, so
 * `/universe/cosmere` and `/universe/The%20Cosmere` are one page; minting a
 * surrogate key for a list this repo does not own would be a third place the
 * spellings could drift.
 */
export function universePath(name: string): string {
  return `/universe/${encodeURIComponent(name)}`;
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
export const tbrPath = '/tbr';
/** The details queue, optionally narrowed to one question. */
export function queuePath(field?: string | null): string {
  return field ? `/queue?field=${encodeURIComponent(field)}` : '/queue';
}

function parse(pathname: string, search: string): Route {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  if (parts.length === 0) return { name: 'collection', filters: parseCollection(search) };

  if (parts[0] === 'work' && parts.length === 2) {
    const id = Number(parts[1]);
    if (Number.isInteger(id) && id > 0) return { name: 'work', id };
  }

  if (parts[0] === 'series') {
    if (parts.length === 1) return { name: 'series', filters: parseSeriesList(search) };
    if (parts.length === 2) {
      const series = decodeSegment(parts[1]!);
      if (series) return { name: 'seriesDetail', series };
    }
  }

  // Singular, beside `/series/:name` rather than under it: a universe is not a
  // kind of series, and `/series/The Cosmere/…` would say it was.
  if (parts[0] === 'universe' && parts.length === 2) {
    const universe = decodeSegment(parts[1]!);
    if (universe) return { name: 'universe', universe };
  }

  if (parts[0] === 'wishlist' && parts.length === 1) return { name: 'wishlist' };

  if (parts[0] === 'tbr' && parts.length === 1) return { name: 'tbr' };

  if (parts[0] === 'queue' && parts.length === 1) {
    // Open-ended rather than checked against a list: the field set lives in
    // `@lc/core` and grows, and a name matching nothing simply shows an empty
    // worklist — which is the honest answer, not an error.
    return { name: 'queue', field: new URLSearchParams(search).get('field') };
  }

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
  if (p === '/tbr') return 'My TBR';
  if (p === '/queue') return 'What is missing';
  if (p === '/add') return 'Add books';
  if (p === '/scans') return 'Sweeps';
  if (p === '/export') return 'Export';
  if (p === '/people') return 'People';
  if (p.startsWith('/series/')) return decodeSegment(p.slice('/series/'.length)) || 'Series';
  // The name is the whole label — "← The Cosmere" reads as a place, where
  // "← Universe" would name a category and tell you nothing about which one.
  if (p.startsWith('/universe/')) return decodeSegment(p.slice('/universe/'.length)) || 'Back';
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
