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
import { WorkPage } from './pages/WorkPage.js';

type Status = 'checking' | 'signed-out' | 'pending-approval' | 'ready' | 'error';

export function App() {
  const [status, setStatus] = useState<Status>('checking');
  const [me, setMe] = useState<Me | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Which book is open, or null for the collection.
   *
   * Deliberately not a router. Two screens do not need one; the sibling project
   * added its router when it had eight. Doing it now would buy the dependency,
   * a URL scheme and back-button semantics up front for what is one useState.
   */
  const [openWorkId, setOpenWorkId] = useState<number | null>(null);

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
        <strong>Library</strong>
        <span className="muted small">
          {me.displayName ?? me.email} · {me.role}
        </span>
        <button onClick={() => void signOutNow()}>Sign out</button>
      </header>
      {openWorkId === null ? (
        <CollectionPage me={me} onOpen={setOpenWorkId} />
      ) : (
        <WorkPage workId={openWorkId} me={me} onBack={() => setOpenWorkId(null)} />
      )}
    </>
  );
}
