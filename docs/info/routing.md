# Routing and the URL scheme — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-10** — every row of the route table below was driven
> in a browser against the built assets on `127.0.0.1:8791`.

Every screen this app grows from here adds a row to one table:
`apps/web/src/router.tsx`. Read that file's comments before adding one — this
page is the summary, not the reasoning.

## Why there is a router at all

Two problems, and the second is the one that forced it.

1. Nothing was linkable. You could not send someone a book.
2. **Installed to a home screen, a PWA with no history entries exits the app
   when the phone's Back button is pressed.** The most-used control on a phone,
   doing the most destructive thing available to it, on every screen.

## Why it is hand-rolled

Six routes, no nested layouts, no loaders. `react-router` is about 20kB over
the wire to replace `pushState` and one `popstate` listener, on an app whose
job is to open fast in front of a bookshelf. It is a port of the sibling Board
Game Catalog's `apps/web/src/router.tsx`, which has reached fourteen routes on
the same file without needing one.

## The table

| URL | Screen | Notes |
|---|---|---|
| `/` | Collection | Filters live in the query string; see below |
| `/work/:id` | One book | A **page**, not a modal. Deliberate, and settled |
| `/series` | Every series | |
| `/series/:name` | One series ladder | `encodeURIComponent`, always — `Tamer%3A%20King%20of%20Dinosaurs` |
| `/wishlist` | Wishlist | |
| `/add` | Add books | `?mode=scan\|type` picks the tab. **One flat path** — see below |
| anything else | "Not a page" | |

Collection query parameters, all optional, all forgiving of junk:

| Param | Values | Default |
|---|---|---|
| `q` | free text | — |
| `series` | free text (names come from the catalog) | — |
| `format` | an `EDITION_FORMATS` value | — |
| `status` | a `COPY_STATUSES` value | — |
| `read` | a `READ_STATES` value | — |
| `sort` | `series\|title\|author\|added` | stored prefs, then `series` |
| `dir` | `asc\|desc` | stored prefs, then `asc` |
| `size` | a `COLLECTION_PAGE_SIZES` value | stored prefs, then 50 |
| `page` | **1-based** | 1 |

An unrecognised value falls back to the default rather than erroring, and
anything equal to the *shipped* default is omitted, so an ordinary browse is
`/` and not `/?q=&sort=series&page=1`.

## ⚠️ The four things that will bite

**1. `navigate` pushes; `replaceUrl` replaces and fires no popstate. Do not
collapse them.** The collection rewrites the URL on every filter change and the
search box is live — a `pushState` per keystroke puts ten entries in the history
for a ten-character search and breaks Back in a new disguise. Measured: nine
keystrokes, `history.length` unchanged. Withholding the popstate matters just as
much, or the page that owns the state gets remounted underneath itself
mid-keystroke.

**2. `page` is 1-based in the URL and 0-based in `CollectionPage`.** Converted at
both edges. `?page=0` meaning "the first page" is an implementation detail
leaking into an address.

**3. The reset-to-page-1-on-filter-change effect must compare values, not just
list them as deps.** It has to fire on a *change*, never on arrival, or
`/?q=dungeon&page=2` resets itself before the first request goes out and the
shared link silently does not work. The value comparison is also what survives
StrictMode's double mount in dev.

**4. `/add` is one flat path with the tab in the query string.** A standalone
PWA on iOS re-prompts for camera permission on every route change (WebKit
#215884), and this is the only screen that opens a camera. Switching tabs uses
`replaceUrl`, so the path never changes and Back leaves the screen rather than
undoing a tab switch.

## How a back button knows where it goes

`navigate` writes the departing path into `history.state.from`. `backTarget(fallback)`
reads it and returns a label plus a `go()`:

- **state present** — arrived from inside the app. `history.back()`, so Back pops
  rather than pushing a third entry. Label comes from the path: `/series/Foo` →
  `Foo`, `/wishlist` → `Wishlist`, `/work/9` → `Back` (the path does not carry a
  title, and inventing one would be worse than saying less).
- **state absent** — a pasted link or a bookmark. `back()` would leave the site,
  so the fallback path is pushed instead.

`history.state` is persisted with the entry, so a hard refresh on `/work/62`
still knows it came from the ladder. This is what replaced the old
`Screen.from` union in `App.tsx`, and it preserves its behaviour: a book opened
from a series ladder returns to the ladder, not to the collection.

## Deep links

No worker change was needed. `apps/worker/src/index.ts`'s `notFound` already
serves `index.html` for any non-`/api` path, with `Cache-Control: no-cache` on
it; the `[assets]` binding's default `not_found_handling` passes unmatched paths
through to the Worker. Verified: `/`, `/work/1`, `/series`,
`/series/Tamer%3A%20King%20of%20Dinosaurs`, `/wishlist`, `/add?mode=type` and
`/nonsense/deep/path` all return `index.html`; `/api/nope` still returns a JSON
404.

## Where the state actually lives

| Thing | Home | Why |
|---|---|---|
| filters, search, sort, dir, page size, page | the URL | so Back and a shared link both work |
| `sort`, `dir`, `pageSize` when the URL is silent | `localStorage` prefs | a bare `/` should open the way this person likes it |
| `view` (grid/list) | `localStorage` prefs only | it is how the page looks, not what it shows, and nothing else depends on it |

`App.tsx` keys `CollectionPage` on `collectionPath(route.filters)`, `WorkPage` on
the id and `SeriesDetailPage` on the name. Without those keys React reuses one
page instance across every book you open and its half-filled forms follow you.
