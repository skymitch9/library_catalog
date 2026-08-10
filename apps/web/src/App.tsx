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
import { CollectionPage } from './pages/CollectionPage.js';
import { ScanPage } from './pages/ScanPage.js';
import { SeriesDetailPage } from './pages/SeriesDetailPage.js';
import { SeriesPage } from './pages/SeriesPage.js';
import { WishlistPage } from './pages/WishlistPage.js';
import { WorkPage } from './pages/WorkPage.js';

type Status = 'checking' | 'signed-out' | 'pending-approval' | 'ready' | 'error';

/**
 * Which screen is showing.
 *
 * ⚠️ Still not a router, and the reason has not changed — there is no URL
 * scheme, no dependency and no back-button contract to maintain. What HAS
 * changed is that there are now five screens rather than two, and five booleans
 * would let two of them be true at once. So the state that was `openWorkId` plus
 * `scanning` becomes one tagged union: exactly one screen, by construction.
 *
 * The nesting is deliberate rather than a stack. A book opened from a series
 * ladder remembers the series it came from, so "← " goes back to the ladder
 * and not to the collection; a book opened from the collection has nowhere else
 * to go back to.
 */
type Screen =
  | { name: 'collection' }
  | { name: 'scan' }
  | { name: 'wishlist' }
  | { name: 'series' }
  | { name: 'series-detail'; series: string }
  | { name: 'work'; workId: number; from: Screen };

/** What the back button on a book page says, so it names where it goes. */
function backLabelFor(from: Screen): string {
  switch (from.name) {
    case 'series-detail':
      return from.series;
    case 'series':
      return 'Series';
    case 'wishlist':
      return 'Wishlist';
    default:
      return 'Collection';
  }
}

export function App() {
  const [status, setStatus] = useState<Status>('checking');
  const [me, setMe] = useState<Me | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'collection' });

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

  /** Open a book, remembering where it was opened from. */
  const openWork = (workId: number) =>
    setScreen((from) => ({ name: 'work', workId, from: from.name === 'work' ? from.from : from }));
  const openSeries = (series: string) => setScreen({ name: 'series-detail', series });

  return (
    <>
      <header className="topbar">
        <button className="topbar__brand" onClick={() => setScreen({ name: 'collection' })}>
          The Library
        </button>
        <span className="muted small topbar__who">{me.displayName ?? me.email}</span>
        {/* ⚠️ Places, not actions — and "Scan" used to be here, which broke that.
            Adding belongs next to the thing being added to, so it is one button
            on the collection header and every *way* of adding is a tab on the
            screen it leads to. Hoisting it up here as well makes the top bar a
            second, competing menu for the same job; the sibling Board Game
            Catalog reached five equal-weight entry points that way and had to
            unpick them. Series and Wishlist stay because they are views you go
            to, not things you do. */}
        <nav className="topbar__nav">
          <button
            className={screen.name === 'series' ? 'primary chip' : 'chip'}
            onClick={() => setScreen({ name: 'series' })}
          >
            Series
          </button>
          <button
            className={screen.name === 'wishlist' ? 'primary chip' : 'chip'}
            onClick={() => setScreen({ name: 'wishlist' })}
          >
            Wishlist
          </button>
        </nav>
        <button onClick={() => void signOutNow()}>Sign out</button>
      </header>

      {screen.name === 'scan' ? (
        <ScanPage
          onDone={() => setScreen({ name: 'collection' })}
          // Someone who may edit the catalog but has no `scan` capability would
          // otherwise land on a camera they are not allowed to open. Same one
          // button, same one screen — it just opens on the tab that works.
          initialMode={me.capabilities.includes('scan') ? 'scan' : 'type'}
        />
      ) : screen.name === 'wishlist' ? (
        <WishlistPage me={me} onOpen={openWork} />
      ) : screen.name === 'series' ? (
        <SeriesPage onOpenSeries={openSeries} />
      ) : screen.name === 'series-detail' ? (
        <SeriesDetailPage
          name={screen.series}
          me={me}
          onBack={() => setScreen({ name: 'series' })}
          onOpen={openWork}
        />
      ) : screen.name === 'work' ? (
        <WorkPage
          workId={screen.workId}
          me={me}
          onBack={() => setScreen(screen.from)}
          backLabel={backLabelFor(screen.from)}
          onOpen={openWork}
          onOpenSeries={openSeries}
        />
      ) : (
        <CollectionPage me={me} onOpen={openWork} onAdd={() => setScreen({ name: 'scan' })} />
      )}
    </>
  );
}
