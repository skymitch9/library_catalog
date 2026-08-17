/**
 * The shell: sign in, then the collection.
 *
 * Phase 1 is deliberately small — add and browse works by hand, with no external
 * dependency at all. The same bar the sibling project set for its phase 1: it
 * has to be useful before anything clever is wired in.
 *
 * ## ⚠️ Why this asks the API first instead of Firebase first
 *
 * The obvious shape is: watch Firebase auth state, and show the sign-in screen
 * until there is a user. That was the first version, and it made the app
 * **impossible to run locally**.
 *
 * `apps/worker/src/middleware/auth.ts` has a dev bypass gated on
 * `ENVIRONMENT !== 'production'` and `DEV_EMAIL`, so the API answers without a
 * token. But a Firebase-first client never gets as far as asking: it sits on the
 * sign-in screen waiting for a Google popup that cannot complete against
 * `localhost` without extra setup. A dev bypass on one side of the wire only is
 * not a dev bypass.
 *
 * So the order is inverted: **ask `/api/me` first, and treat a 200 as signed
 * in** — whether that came from a verified Firebase token or the dev bypass, the
 * server has already decided, and the server is the one that decides. Firebase
 * is still watched, so signing out still works and a token expiring still lands
 * you back on the sign-in screen.
 *
 * This also removes a real failure in production: the old flow could show the
 * app to someone whose Firebase session was live but whose `/api/me` returned
 * 403, because it trusted the client's idea of who was signed in.
 */

import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { api, ApiError, type Me } from './api.js';
import { describeError } from './lib/errors.js';
import { signIn, signOutNow, watchAuth } from './lib/firebase.js';
import {
  Link,
  addPath,
  backTarget,
  collectionPath,
  navigate,
  seriesListPath,
  seriesPath,
  useRoute,
  workPath,
  type Route,
} from './router.js';
import { EstateSearchPanel, EstateSearchToggle } from './components/EstateSearch.js';
import { ThemeCog } from './components/ThemeCog.js';
import { CollectionPage } from './pages/CollectionPage.js';
import { ScanJobsPage } from './pages/ScanJobsPage.js';
import { ExportPage } from './pages/ExportPage.js';
import { PeoplePage } from './pages/PeoplePage.js';
import { DetailsQueuePage } from './pages/DetailsQueuePage.js';
import { ScanPage } from './pages/ScanPage.js';
import { SeriesDetailPage } from './pages/SeriesDetailPage.js';
import { SeriesPage } from './pages/SeriesPage.js';
import { TbrPage } from './pages/TbrPage.js';
import { UniversePage } from './pages/UniversePage.js';
import { WishlistPage } from './pages/WishlistPage.js';
import { WorkPage } from './pages/WorkPage.js';

type Status = 'checking' | 'signed-out' | 'pending-approval' | 'ready' | 'error';

/**
 * ## Which screen is showing — now the URL's answer, not this file's
 *
 * This used to be a `Screen` tagged union in `useState`, with the book screen
 * carrying a `from: Screen` so its back button could name where it came from.
 * It worked, and it was invisible: nothing was linkable, and an installed PWA
 * with no history entries **exits the app** when the phone's Back button is
 * pressed. See `router.tsx`.
 *
 * The nesting the union did by hand now falls out of the history stack — a book
 * opened from a series ladder goes back to the ladder because that is the
 * previous entry — and the *label* on that button comes from `backTarget`,
 * which reads the `from` path `navigate` recorded on the way past.
 */
export function App() {
  const [status, setStatus] = useState<Status>('checking');
  const [me, setMe] = useState<Me | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether the estate-wide search panel is open.
   *
   * ⚠️ Lifted here rather than owned by the component because its two halves
   * live on opposite sides of the header: the toggle is a control INSIDE the
   * sticky top bar, the panel is a full-width strip BELOW it. Nothing else
   * depends on it, so it is state and not a route — unlike every screen, this
   * is a box you open and close, not a place you go.
   */
  const [estateOpen, setEstateOpen] = useState(false);
  const route = useRoute();

  const check = useCallback(async () => {
    try {
      setMe(await api.me());
      setStatus('ready');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setStatus('signed-out');
      } else if (err instanceof ApiError && err.status === 403) {
        // Not an error to shout about — the ordinary first visit for the second
        // person in the house.
        setStatus('pending-approval');
      } else {
        setError(describeError(err));
        setStatus('error');
      }
    }
  }, []);

  /**
   * Re-read `/api/me` for the nav's chore count, without disturbing sign-in.
   *
   * ⚠️ `useCallback` with no deps is load-bearing, not tidiness. This is passed
   * to the details queue, which lists it as a dependency of its own `load`; an
   * inline arrow would be a new function every render and would spin that page
   * in a fetch loop.
   *
   * ⚠️ It also must not touch `status`. `check()` sets sign-in state from the
   * same call, so reusing it here would let one stale response during a background
   * refresh bounce a signed-in person to the sign-in screen. A failure here is
   * simply ignored: the nav keeps its old count, which is a stale badge rather
   * than a lost session.
   */
  const refreshChores = useCallback(() => {
    void api
      .me()
      .then(setMe)
      .catch(() => {});
  }, []);

  // Re-check whenever Firebase's idea of the user changes, so signing in or out
  // takes effect without a reload.
  useEffect(
    () =>
      watchAuth((user) => {
        setFirebaseUser(user);
        void check();
      }),
    [check],
  );

  if (status === 'checking') return <main className="centre">Loading…</main>;

  if (status === 'error') {
    return (
      <main className="centre">
        <h1>Something went wrong</h1>
        <p className="muted">{error}</p>
        <button onClick={() => void check()}>Try again</button>
      </main>
    );
  }

  if (status === 'signed-out') {
    return (
      <main className="centre">
        <h1>Library</h1>
        <p className="muted">Our books, on the shelf and on the Kindle.</p>
        <button className="primary" onClick={() => void signIn()}>
          Sign in with Google
        </button>
        <p className="muted small">
          The same Google account as the audiobook catalog. Signing in here does not
          create a second one.
        </p>
      </main>
    );
  }

  if (status === 'pending-approval' || !me) {
    return (
      <main className="centre">
        <h1>Waiting for approval</h1>
        <p className="muted">
          Signed in as {firebaseUser?.email ?? 'this account'}. An owner needs to let
          you in.
        </p>
        <button onClick={() => void signOutNow()}>Sign out</button>
      </main>
    );
  }

  return (
    <>
      <header className="topbar">
        <Link to="/" className="topbar__brand">
          The Library
        </Link>
        <span className="muted small topbar__who">{me.displayName ?? me.email}</span>
        {/* ⚠️ Places, not actions — and "Scan" used to be here, which broke that.
            Adding belongs next to the thing being added to, so it is one button
            on the collection header and every *way* of adding is a tab on the
            screen it leads to. Hoisting it up here as well makes the top bar a
            second, competing menu for the same job; the sibling Board Game
            Catalog reached five equal-weight entry points that way and had to
            unpick them. Wishlist stays because it is a view you go to, not a
            thing you do.

            ⚠️ SERIES WAS HERE AND WAS REMOVED, 2026-08-11, at the owner's ask:
            *"remove the series button from the top of the page ... and place
            that information inside of each clickable series instead"*, then
            *"what if just hid the page and then ported the data"*.

            It cost almost nothing to remove because both halves already
            existed: a book page opens its own series through `onOpenSeries`
            (WorkPage's series-tag button), and SeriesDetailPage already draws
            the ladder, the gaps, the skipped rungs and the on-audio counts. So
            a series is reached from the book that prompted the question, which
            is where the question is actually asked.

            ⚠️ `/series` IS STILL A LIVE ROUTE and must stay one — deep links,
            bookmarks, the back button out of a series page, and `backTarget`
            below all resolve to it. This removed the *button*, not the page.
            What has no home in the nav any more is the cross-series view: the
            four aggregate stats and the search / sort / gaps-only filters on
            SeriesPage. Reachable by typing /series, not by browsing.

            Real anchors rather than buttons, now that places have addresses:
            the target shows in the status bar and a long-press or middle-click
            opens it in its own tab. `a.chip` in styles.css keeps them looking
            exactly like the buttons they replaced. */}
        <nav className="topbar__nav">
          {/* A place, like the others: "what is missing" is a view of the
              catalog, not an action performed on it. Shown to readers as well as
              owners — seeing what the shelf does not know costs nothing; the
              buttons that spend money are gated on the page itself.

              ⚠️ Ordered BEFORE Wishlist and People deliberately. It is the only
              entry here that changes from day to day, and the only one carrying
              a number, so it is the one worth reading first; the other three are
              stable places you go when you already know you want them. It also
              keeps the count away from the right-hand edge, where a thumb and
              the "Sign out" button both live.

              Shown only while there is something behind it, with the count on
              the face — the sibling's rule: "a screen with nothing on it does
              not earn a permanent slot, and this is a better answer to a
              360px-wide phone than shrinking the type until five links fit."

              `chores == null` means the count could not be taken, and shows the
              link WITHOUT a number. Treating that as zero would hide a worklist
              because a query failed. */}
          {(me.chores == null || me.chores.missingDetails > 0) && (
            <Link to="/queue" className={route.name === 'queue' ? 'primary chip' : 'chip'}>
              Missing{me.chores ? ` (${me.chores.missingDetails})` : ''}
            </Link>
          )}
          {/* ⚠️ A place, like Wishlist beside it — and shown to everyone who
              can track their own reading, because the list is theirs and not
              the catalog's. It sits BEFORE Wishlist: what you mean to read next
              is a more frequent question than what you mean to buy, and the two
              are easy to confuse, so the one that is about reading comes first.

              Gated on `trackReading` for the same reason the read-state chips
              are: without it there is nothing to add and nothing to clear, and
              an entry that opens an empty screen is worse than no entry. */}
          {me.capabilities.includes('trackReading') && (
            <Link to="/tbr" className={route.name === 'tbr' ? 'primary chip' : 'chip'}>
              My TBR
            </Link>
          )}
          <Link to="/wishlist" className={route.name === 'wishlist' ? 'primary chip' : 'chip'}>
            Wishlist
          </Link>
          {/* ⚠️ NO "People" CHIP HERE — removed from the nav 2026-08-16 at the
              owner's request ("remove /people from the nav on library and
              games; keep the page just hide it from nav"). The route, the
              page and its capability gate are all UNTOUCHED: /people still
              resolves, still renders, and is still refused to anyone without
              `manageUsers` by the guard in `Screens` below. This hides the
              door, it does not lock it — and hiding was never the lock, which
              is why that guard stays exactly where it is.

              Reaching it now means typing the URL. That is the point: the
              page went read-only earlier the same day (roles are granted on
              heygabi.ai/admin, the one place that owns them), so a permanent
              nav slot pointed at a screen that can only *show* you things,
              while the chip's presence implied it was where you go to act.

              ⚠️ Do not "restore the missing link" — its absence is the
              feature. If it ever comes back, it needs the owner's word.

              Export stays: owner-only, and genuinely a place rather than an
              action — a page explaining two file formats. Hidden rather than
              disabled for a reader, because an entry that is visible and
              refuses invites wondering what is behind it, and there is
              nothing behind it for them. */}
          {me.capabilities.includes('editCatalog') && (
            <Link to="/export" className={route.name === 'export' ? 'primary chip' : 'chip'}>
              Export
            </Link>
          )}
        </nav>
        {/* ⚠️ ADDITIVE, and NOT this catalog's search. The collection page's own
            box searches THESE books server-side with facets and pagination and
            is untouched; this one asks the shared index at index.heygabi.ai
            whether we own a thing on ANY shelf — audiobooks, books, board
            games. See components/EstateSearch.tsx.

            Beside the cog rather than in the nav for the reason the nav chips
            give above: those are places you go, and this is a tool you open. */}
        <EstateSearchToggle open={estateOpen} onToggle={() => setEstateOpen((o) => !o)} />
        {/* The settings cog — the estate theme dropdown and light/dark/auto
            live here (ThemeCog.tsx). Beside "Sign out" because both are
            about the person, not the catalog; the nav chips stay places. */}
        <ThemeCog />
        <button onClick={() => void signOutNow()}>Sign out</button>
      </header>

      {estateOpen && <EstateSearchPanel />}

      <Screens
        route={route}
        me={me}
        // Just the nav's chore count, and deliberately NOT `check()`: the
        // details queue calls this after every book it fills in, and `check()`
        // sets sign-in status from the same response.
        onChoresChanged={refreshChores}
      />
    </>
  );
}

const openWork = (workId: number) => navigate(workPath(workId));
const openSeries = (series: string) => navigate(seriesPath(series));

/**
 * The route table. Every later feature adds a case here.
 *
 * ⚠️ Three of these are `key`ed, and all for the same reason: the page seeds
 * its own state from its props once, so arriving at a *different* book, series
 * or search has to be a new page rather than the old one holding the old data.
 * Without the key React reuses one WorkPage across every book you open, and a
 * half-filled copy form follows you to the next.
 */
function Screens({
  route,
  me,
  onChoresChanged,
}: {
  route: Route;
  me: Me;
  /** Re-read the nav's "Missing (N)" count. Must be a stable reference. */
  onChoresChanged: () => void;
}) {
  switch (route.name) {
    case 'work': {
      // Reads the `from` recorded by whichever `navigate` got us here, so a
      // book opened from a ladder still says "← Beneath the Dragoneye Moons".
      // A pasted link has no such record and falls back to the collection.
      const back = backTarget('/');
      return (
        <WorkPage
          key={route.id}
          workId={route.id}
          me={me}
          onBack={back.go}
          backLabel={back.label}
          onOpen={openWork}
          onOpenSeries={openSeries}
        />
      );
    }

    case 'series':
      return (
        // Keyed by the filters, exactly as the collection is and for the same
        // two reasons: the page seeds its state from its props once, and typing
        // in the search box does not come through here — it uses `replaceUrl`,
        // which fires no popstate. So this key changes only when something
        // outside the page changed the filters, which pressing Back into an
        // earlier search is.
        <SeriesPage
          key={seriesListPath(route.filters)}
          filters={route.filters}
          onOpenSeries={openSeries}
        />
      );

    case 'seriesDetail': {
      const back = backTarget('/series');
      return (
        <SeriesDetailPage
          key={route.series}
          name={route.series}
          me={me}
          onBack={back.go}
          backLabel={back.label}
          onOpen={openWork}
        />
      );
    }

    case 'universe': {
      // Falls back to the collection rather than to `/series`: a universe is
      // the tier above a series, not one of them, and the way in is almost
      // always a book page or the collection's own universe filter.
      const back = backTarget('/');
      return (
        <UniversePage
          // Keyed on the name, for the reason the series ladder is: arriving at
          // a *different* universe has to be a new page rather than the old one
          // holding the previous world's books while the fetch is in flight.
          key={route.universe}
          name={route.universe}
          onBack={back.go}
          backLabel={back.label}
        />
      );
    }

    case 'wishlist':
      return <WishlistPage me={me} onOpen={openWork} />;

    // Gated the same way its nav chip is, and for the reason `/add` carries: a
    // screen with an address is a screen anybody can type. Without
    // `trackReading` there is no list to show and nothing that could be
    // cleared, so it genuinely is not a page for them.
    case 'tbr':
      if (!me.capabilities.includes('trackReading')) return <NotFound />;
      return <TbrPage me={me} />;

    case 'queue':
      // Keyed on the field so switching question remounts rather than keeping
      // the previous list's expanded rows and half-typed verdict forms.
      return (
        <DetailsQueuePage
          key={route.field ?? 'all'}
          me={me}
          field={route.field}
          onChoresChanged={onChoresChanged}
        />
      );

    case 'add': {
      // Gated the same way the "+ Add books" button is. Without this, a reader
      // who typed the URL would get a screen whose every button 403s — a hole
      // that only opens once screens have addresses.
      if (!me.capabilities.includes('editCatalog')) return <NotFound />;
      const back = backTarget('/');
      return (
        <ScanPage
          // ⚠️ Keyed on the job, so arriving at a *different* sweep from the
          // queue is a new page rather than the old one holding the old lines.
          // Same reason WorkPage is keyed on its id.
          key={route.job ?? 'new'}
          onDone={back.go}
          backLabel={back.label}
          // The URL wins when it names a tab. Failing that: someone who may edit
          // the catalog but has no `scanBarcode` capability would otherwise land
          // on a camera they are not allowed to open. Same one button, same one
          // screen — it just opens on the tab that works.
          initialMode={route.mode ?? (me.capabilities.includes('scanBarcode') ? 'scan' : 'type')}
          initialJobId={route.job}
          // A shelf/cover photograph is the thing in the app that spends money,
          // so it is gated on `scanPhoto` — split from `scanBarcode` 2026-08-16
          // specifically because a barcode is free and a photo is not.
          canSpend={me.capabilities.includes('scanPhoto')}
        />
      );
    }

    case 'scans': {
      if (!me.capabilities.includes('editCatalog')) return <NotFound />;
      return <ScanJobsPage canSpend={me.capabilities.includes('scanPhoto')} />;
    }
    // Gated the same way their nav entries are, and for the reason `/add`
    // carries: a screen with an address is a screen anybody can type. Answering
    // "Not a page" rather than a permission notice is deliberate — for a reader
    // these two genuinely are not pages.
    case 'export':
      if (!me.capabilities.includes('editCatalog')) return <NotFound />;
      return <ExportPage />;

    case 'people':
      if (!me.capabilities.includes('manageUsers')) return <NotFound />;
      return <PeoplePage me={me} />;

    case 'collection':
      return (
        // Keyed by the filters, for the reason above and one more: typing in the
        // search box does NOT come through here — the page rewrites the URL with
        // `replaceUrl`, which fires no popstate — so this key only changes when
        // something outside the page changed the filters. Pressing Back into a
        // different search is exactly that, and has to remount.
        <CollectionPage
          key={collectionPath(route.filters)}
          me={me}
          filters={route.filters}
          onOpen={openWork}
          onAdd={() => navigate(addPath())}
        />
      );

    default:
      return <NotFound />;
  }
}

/** A URL that means nothing. Says so, and offers the one way out. */
function NotFound() {
  return (
    <main className="centre">
      <h1>Not a page</h1>
      <p className="muted">There is nothing at this address.</p>
      <Link to="/" className="chip">
        Back to the collection
      </Link>
    </main>
  );
}
