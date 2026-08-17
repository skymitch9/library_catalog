/**
 * Firebase: Google sign-in, the ID token the Worker verifies, and direct
 * Firestore access to the shared `reviews` collection.
 *
 * ## ⚠️ The one deliberate difference from `audiobook_catalog/site/identity.js`
 *
 * That file signs out of Firebase Auth **immediately** after capturing the
 * identity, and keeps a display name in `localStorage`:
 *
 *     // Google is only used to capture identity — the site's Firestore rules
 *     // never check auth. Detach immediately so a persisted auth session can't
 *     // later expire and poison Firestore writes with PERMISSION_DENIED.
 *     try { await signOut(auth); } catch (e) {}
 *
 * That is correct *there*. It is wrong here, and the difference is not a
 * preference: on that site identity is presentation (its own `isAdmin()` says
 * "PRESENTATION ONLY … it is not, and cannot be, an access control"), whereas
 * here the token IS the access control — the Worker verifies its signature
 * against Google's keys before it will answer anything.
 *
 * So this app keeps the session, and `getIdToken()` below refreshes it. The
 * failure that motivated the detach — an expired token poisoning writes — is
 * handled by refreshing rather than by discarding: `getIdToken(true)` on a 401,
 * once, then give up and re-prompt.
 *
 * Both apps still sign into the SAME project, so the same Google account is the
 * same person on both. That is the whole point, and it survives this difference
 * because it depends on the project and the email, not on session lifetime.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

/**
 * The audiobook catalog's Firebase config, verbatim.
 *
 * ⚠️ `projectId` must stay `audiobook-catalog`. It is what makes one Google
 * account one person across both sites, and it must match
 * `FIREBASE_PROJECT_ID` in the Worker's wrangler.toml or every request 401s.
 *
 * These values are public by design — a Firebase web config is shipped to every
 * browser and is not a secret. Access control is `firestore.rules` plus, here,
 * the Worker's token verification.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyDgAblkxzVxl7nFbd7jXOo6PpuNPsJw11Y',
  authDomain: 'auth.heygabi.ai',
  projectId: 'audiobook-catalog',
};

let app: FirebaseApp | null = null;

export function firebaseApp(): FirebaseApp {
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}

export function firestore(): Firestore {
  return getFirestore(firebaseApp());
}

/**
 * The collection to read and write.
 *
 * Mirrors `col()` in `audiobook_catalog/site/fb-env.js` exactly: that site's dev
 * lane reads `*_dev` collections so experiments never touch prod data. A
 * mismatch here is silent in both directions — dev writes polluting the live
 * site, or a live review invisible in dev — so the rule is copied rather than
 * re-derived.
 */
export function reviewsCollection(): string {
  const dev =
    window.location.pathname.includes('/dev/') ||
    ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return dev ? 'reviews_dev' : 'reviews';
}

export function watchAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(getAuth(firebaseApp()), cb);
}

export async function signIn(): Promise<void> {
  const auth = getAuth(firebaseApp());
  const provider = new GoogleAuthProvider();
  // On localhost Chrome's COOP blocks popup communication — the sibling site
  // hit this and the fix is a redirect, not a retry.
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (isLocal) {
    await signInWithRedirect(auth, provider);
    return;
  }
  await signInWithPopup(auth, provider);
}

/**
 * The signed-in person's Firebase uid, or null.
 *
 * ⚠️ **This is the id `firestore.rules` compares against, and nothing else
 * is.** `canDeleteUserWarning()` allows a delete when the document's
 * `authorUid` equals `request.auth.uid`; a display name proves nothing (Google
 * lets anyone set theirs to any string), and this app's own `app_user.id` is a
 * D1 row the rules have never heard of. Used by `ContentNotes` to decide which
 * delete affordance to draw — the same question `liveUid()` answers on the
 * audiobook site, answered here from the session this app deliberately keeps.
 */
export function currentUid(): string | null {
  return getAuth(firebaseApp()).currentUser?.uid ?? null;
}

export async function signOutNow(): Promise<void> {
  await signOut(getAuth(firebaseApp()));
}

/**
 * The bearer token for the Worker.
 *
 * `forceRefresh` is exposed rather than always-on because Firebase already
 * refreshes on its own schedule and forcing it on every request adds a network
 * round trip to every API call. The caller forces it exactly once, on a 401.
 */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const user = getAuth(firebaseApp()).currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}
