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
import { signIn, signOutNow, watchAuth } from './lib/firebase.js';
import {
  Link,
  addPath,
  backTarget,
  collectionPath,
  navigate,
  seriesPath,
  useRoute,
  workPath,
  type Route,
} from './router.js';
import { CollectionPage } from './pages/CollectionPage.js';
import { ExportPage } from './pages/ExportPage.js';
import { PeoplePage } from './pages/PeoplePage.js';
import { ScanPage } from './pages/ScanPage.js';
import { SeriesDetailPage } from './pages/SeriesDetailPage.js';
import { SeriesPage } from './pages/SeriesPage.js';
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
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    }
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
            unpick them. Series and Wishlist stay because they are views you go
            to, not things you do.

            Real anchors rather than buttons, now that places have addresses:
            the target shows in the status bar and a long-press or middle-click
            opens it in its own tab. `a.chip` in styles.css keeps them looking
            exactly like the buttons they replaced. */}
        <nav className="topbar__nav">
          <Link to="/series" className={route.name === 'series' ? 'primary chip' : 'chip'}>
            Series
          </Link>
          <Link to="/wishlist" className={route.name === 'wishlist' ? 'primary chip' : 'chip'}>
            Wishlist
          </Link>
          {/* Owner-only, and both genuinely places rather than actions — one is
              a page that explains two file formats, the other is the guest list.
              Hidden rather than disabled for a reader: an entry that is visible
              and refuses is an invitation to wonder what is behind it, and there
              is nothing behind it for them. The routes are gated in `Screens`
              too, because hiding a link is not access control. */}
          {me.capabilities.includes('manageUsers') && (
            <Link to="/people" className={route.name === 'people' ? 'primary chip' : 'chip'}>
              People
            </Link>
          )}
          {me.capabilities.includes('editCatalog') && (
            <Link to="/export" className={route.name === 'export' ? 'primary chip' : 'chip'}>
              Export
            </Link>
          )}
        </nav>
        <button onClick={() => void signOutNow()}>Sign out</button>
      </header>

      <Screens
        route={route}
        me={me}
        // Re-read `/api/me` and start again from the collection. Only the People
        // screen calls it, and only when you have just changed your OWN role —
        // see the note there on why a plain refetch shows the opposite of what
        // happened.
        onSelfChanged={() => {
          navigate('/');
          void check();
        }}
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
  onSelfChanged,
}: {
  route: Route;
  me: Me;
  onSelfChanged: () => void;
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
      return <SeriesPage onOpenSeries={openSeries} />;

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

    case 'wishlist':
      return <WishlistPage me={me} onOpen={openWork} />;

    case 'add': {
      // Gated the same way the "+ Add books" button is. Without this, a reader
      // who typed the URL would get a screen whose every button 403s — a hole
      // that only opens once screens have addresses.
      if (!me.capabilities.includes('editCatalog')) return <NotFound />;
      const back = backTarget('/');
      return (
        <ScanPage
          onDone={back.go}
          backLabel={back.label}
          // The URL wins when it names a tab. Failing that: someone who may edit
          // the catalog but has no `scan` capability would otherwise land on a
          // camera they are not allowed to open. Same one button, same one
          // screen — it just opens on the tab that works.
          initialMode={route.mode ?? (me.capabilities.includes('scan') ? 'scan' : 'type')}
        />
      );
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
      return <PeoplePage me={me} onSelfChanged={onSelfChanged} />;

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
