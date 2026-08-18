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
  signInWithCustomToken,
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
  // ⚠️ The estate-SSO bootstrap is kicked off HERE, and this is why no
  // component needed editing to gain single sign-on: watchAuth is the one
  // call every auth-aware surface in this app already makes at boot
  // (App.tsx, hooks, the estate-search adapter). Guarded to run once per
  // page load however many listeners subscribe, and never awaited — it
  // resolves on its own and fires this very listener when it succeeds,
  // which is what the UI already re-renders from.
  startEstateSso();
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
  // Let this sign-in travel to the rest of the estate (see the SSO section
  // below). Awaited because it is one fast request and a person who signs in
  // here may click straight through to another catalog; a failure is silent
  // and leaves this origin signed in regardless.
  await publishEstateSession();
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
  // Sign-out is LOCAL + COOKIE-CLEAR (design §9 Q4): this ends the session
  // here and stops it travelling, but an origin that has already localised
  // one keeps it until it ends naturally. Full single-sign-out would need
  // every origin to re-check the cookie on every load, which reintroduces
  // the "one page signs you out from under another" failure class the
  // audiobook site's v1 identity code died of. The security-relevant lever
  // is estate revocation, which shuts every door within minutes regardless.
  try {
    sessionStorage.removeItem(PUBLISH_MARK);
  } catch {
    /* storage unavailable — nothing was marked anyway */
  }
  try {
    await fetch(SESSION_URL, { method: 'DELETE', credentials: 'include' });
  } catch {
    /* local session is already gone; a stranded cookie expires on its own */
  }
}

// ==================== Estate SSO (sso-design.md §4.3, Phase 3) ====================
//
// THE PROBLEM: Firebase web auth state is per-ORIGIN (its own IndexedDB per
// origin), so a sign-in on heygabi.ai or audiobooks.heygabi.ai left this app
// signed out, and vice versa. The owner hit it directly — "Ebooks makes me
// login every time why is it not inheriting login from main page?"
//
// THE MECHANISM: an HttpOnly cookie on the PARENT domain (`.heygabi.ai`, set
// by auth.heygabi.ai) plus a Worker-minted Firebase custom token. Sign in
// interactively once, anywhere on the estate; every other origin trades that
// cookie for a short-lived custom token and calls signInWithCustomToken() to
// build its OWN ordinary local session. Because the result is an ordinary
// session, `watchAuth`, `currentUid()` and `getIdToken()` all keep working
// untouched — that is exactly why this shape beat relaying tokens through a
// hidden iframe (design §4.2 rejects that at length: it would have meant
// retrofitting a token-provider abstraction into three codebases).
//
// ⚠️ THIS IS NOT AUTHORITY, and the distinction matters more here than on
// the audiobook site because in THIS app the token IS the access control.
// Nothing about that changes: the Worker still verifies a real Firebase ID
// token against Google's keys and still consults the estate directory in
// ENFORCE mode on every request. The cookie only decides whether the browser
// gets a session at all — it moves the SIGN-IN, never the authority, and it
// can only ever produce a session the same person would get by tapping the
// Google button themselves. The mint route additionally refuses a revoked
// estate member outright, so revocation still shuts this door within minutes.
//
// ⚠️ SILENT BY DEFAULT, STATUS QUO ON FAILURE. Every path swallows its errors
// and returns false. No cookie, a Worker outage, an unset signing key, or a
// browser that partitions the cookie away all degrade to exactly today's
// behaviour: SignIn.tsx renders and works. Nothing here throws, blocks first
// paint, or is awaited by a render path.

const SESSION_URL = 'https://auth.heygabi.ai/api/session';
const SESSION_TOKEN_URL = 'https://auth.heygabi.ai/api/session/token';

/** Publish-once marker for this browser tab — see publishEstateSession. */
const PUBLISH_MARK = 'estate_sso_published';

/** Once-per-page-load guard: watchAuth has several callers, this has one run. */
let ssoStarted = false;

/**
 * Tell the estate this browser is signed in: POST our fresh Firebase ID
 * token to the auth Worker, which verifies it and sets the parent-domain
 * cookie every other estate origin later trades for a session of its own.
 *
 * ⚠️ Marked once per browser tab, deliberately. POST /api/session creates a
 * NEW session row on every call (one row per device is the intent), so
 * calling it per page load would spam D1 with a row per navigation. The
 * marker is kept only on success, so a failed publish retries rather than
 * silently never happening.
 *
 * Never throws.
 */
export async function publishEstateSession(): Promise<boolean> {
  try {
    const user = getAuth(firebaseApp()).currentUser;
    if (!user) return false;
    try {
      if (sessionStorage.getItem(PUBLISH_MARK)) return false;
    } catch {
      /* storage unavailable — publish anyway, at worst an extra row */
    }
    const token = await user.getIdToken();
    const res = await fetch(SESSION_URL, {
      method: 'POST',
      // ⚠️ Required in BOTH directions: without it the browser drops the
      // Set-Cookie on the way back and the mechanism silently no-ops while
      // every status code still reads 200.
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    try {
      sessionStorage.setItem(PUBLISH_MARK, '1');
    } catch {
      /* retry on the next page */
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Inherit a sign-in that happened on another estate surface: trade the
 * parent-domain cookie for a short-lived custom token and turn it into a
 * normal local Firebase session.
 *
 * Deliberately does NOT cache its failures — a negative answer goes stale
 * the moment the person signs in on another tab, and one small bodyless
 * fetch per signed-out page load is what makes inheritance feel instant.
 *
 * Never throws.
 */
export async function inheritEstateSession(): Promise<boolean> {
  try {
    const res = await fetch(SESSION_TOKEN_URL, { method: 'POST', credentials: 'include' });
    // 401 no_session (no cookie — the ordinary signed-out case), 403
    // estate_revoked and 503 token_signer_unset (the owner's console step
    // still pending) all land here, and all mean the same thing to this app:
    // stay signed out and render exactly what it renders today.
    if (!res.ok) return false;
    const body = (await res.json()) as { token?: unknown };
    if (typeof body?.token !== 'string') return false;
    await signInWithCustomToken(getAuth(firebaseApp()), body.token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the bootstrap once per page load: publish an existing local session so
 * it can travel, or inherit one from the estate when there is none here.
 *
 * Waits for Firebase to publish its restored session first — that first
 * answer is asynchronous, and treating the initial null as "signed out" is
 * the classic bug in this file's neighbourhood (see watchAuth's own warning
 * in the sibling games app).
 */
function startEstateSso(): void {
  if (ssoStarted) return;
  ssoStarted = true;
  void (async () => {
    try {
      const auth = getAuth(firebaseApp());
      const user = await new Promise<User | null>((resolve) => {
        if (auth.currentUser) return resolve(auth.currentUser);
        const unsub = onAuthStateChanged(auth, (u) => {
          unsub();
          resolve(u);
        });
      });
      if (user) {
        await publishEstateSession();
      } else {
        await inheritEstateSession();
      }
    } catch {
      /* silent by design — the app behaves exactly as it does today */
    }
  })();
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
