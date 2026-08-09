/**
 * The shell: sign in, then the collection.
 *
 * Phase 1 is deliberately small — add and browse works by hand, with no external
 * dependency at all. The same bar the sibling project set for its phase 1: it
 * has to be useful before anything clever is wired in.
 */

import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { api, ApiError, type Me } from './api.js';
import { signIn, signOutNow, watchAuth } from './lib/firebase.js';
import { CollectionPage } from './pages/CollectionPage.js';

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => watchAuth(setUser), []);

  useEffect(() => {
    if (!user) {
      setMe(null);
      return;
    }
    api
      .me()
      .then(setMe)
      .catch((err: unknown) => {
        // A `pending` account is not an error state to shout about — it is the
        // ordinary first visit for the second person in the house.
        if (err instanceof ApiError && err.status === 403) setMe(null);
        else setError(err instanceof Error ? err.message : String(err));
      });
  }, [user]);

  if (user === undefined) return <main className="centre">Loading…</main>;

  if (user === null) {
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

  if (error) return <main className="centre">Something went wrong: {error}</main>;

  if (!me) {
    return (
      <main className="centre">
        <h1>Waiting for approval</h1>
        <p className="muted">
          Signed in as {user.email}. An owner needs to let you in.
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
      <CollectionPage me={me} />
    </>
  );
}
