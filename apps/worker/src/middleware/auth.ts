import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { can, type Capability } from '@lc/core';
import { upsertUserOnLogin } from '@lc/db';
import { parseOwnerEmails, type AppBindings, type Env } from '../env.js';

/**
 * Firebase Auth (Google SSO) authenticates; this file authorises.
 *
 * ## ⚠️ Why not Cloudflare Access, which the Board Game Catalog uses
 *
 * Because the owner's requirement is **one account across this catalog and
 * `audiobook_catalog`**, and that site's identity is Firebase Google sign-in on
 * the `audiobook-catalog` project. Cloudflare Access is a second, unrelated
 * Google SSO: the same person signing into both would be two records with no way
 * to tell they were one, which is exactly the duplicate this must not create.
 *
 * `LIBRARY_CATALOG.md` §8 phase 1 already said "Worker + D1 + **Firebase auth**",
 * so this is the design's own answer, not a deviation from it.
 *
 * ## What is verified
 *
 * A Firebase ID token is an RS256 JWT signed by Google:
 *
 *     iss  https://securetoken.google.com/<projectId>
 *     aud  <projectId>
 *     sub  the Firebase uid
 *     keys https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com
 *
 * `jose` handles rotation, expiry and signature. What it cannot check is that
 * the project is the *right* project — so `FIREBASE_PROJECT_ID` is asserted in
 * both `issuer` and `audience`, and a token from any other Firebase project
 * fails closed.
 *
 * ## ⚠️ The one thing that must NOT be copied from the audiobook site
 *
 * `audiobook_catalog/site/identity.js` signs out of Firebase Auth immediately
 * after capturing the identity, and keeps the session in `localStorage`. That is
 * deliberate there — its Firestore rules never check `request.auth`, so a live
 * token could only expire and poison writes. It also means its "identity" is a
 * string a browser can set, and its own `isAdmin()` comment says so in as many
 * words: *"PRESENTATION ONLY … it is not, and cannot be, an access control."*
 *
 * This app must keep the token live and send it, because here it IS the access
 * control. The web client refreshes it; see apps/web/src/lib/firebase.ts.
 */

interface Identity {
  email: string;
  uid: string | null;
  name: string | null;
  picture: string | null;
}

// Cached per isolate: the JWKS client refetches on rotation by itself, and
// building one per request would add a round trip to every call.
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwksCache) {
    jwksCache = createRemoteJWKSet(
      new URL(
        'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
      ),
    );
  }
  return jwksCache;
}

function readBearer(req: Request): string | null {
  const header = req.headers.get('Authorization');
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1] ?? null;
}

async function resolveIdentity(req: Request, env: Env): Promise<Identity | null> {
  // Local development bypass. Double-gated: the variable must be set AND the
  // environment must not be production.
  if (env.ENVIRONMENT !== 'production' && env.DEV_EMAIL) {
    return {
      email: env.DEV_EMAIL,
      uid: 'dev-uid',
      name: env.DEV_NAME ?? 'Local Dev',
      picture: null,
    };
  }

  const projectId = (env.FIREBASE_PROJECT_ID ?? '').trim();
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID is not set (docs/access/deploy.md step 3).');
  }

  const token = readBearer(req);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });

    const email = typeof payload['email'] === 'string' ? payload['email'] : null;
    if (!email) return null;

    // A Google account whose email is unverified is not an identity — Firebase
    // will happily mint a token for one, and email is our join key to the other
    // catalog. Refuse rather than merge someone into an account they proved
    // nothing about.
    if (payload['email_verified'] === false) return null;

    return {
      email,
      uid: typeof payload.sub === 'string' ? payload.sub : null,
      name: typeof payload['name'] === 'string' ? payload['name'] : null,
      picture: typeof payload['picture'] === 'string' ? payload['picture'] : null,
    };
  } catch {
    // Expired, wrong audience, bad signature, wrong project — all the same here.
    return null;
  }
}

/** Verifies identity and attaches the catalog user to the request context. */
export function requireAuth(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    let identity: Identity | null;
    try {
      identity = await resolveIdentity(c.req.raw, c.env);
    } catch (err) {
      return c.json({ error: 'misconfigured', detail: (err as Error).message }, 500);
    }

    if (!identity) return c.json({ error: 'unauthenticated' }, 401);

    const user = await upsertUserOnLogin(c.env.DB, {
      email: identity.email,
      firebaseUid: identity.uid,
      displayName: identity.name,
      photoUrl: identity.picture,
      ownerEmails: parseOwnerEmails(c.env.OWNER_EMAILS),
    });

    c.set('user', user);
    await next();
  };
}

/**
 * Gate a route on a capability rather than a role, so adding a role later does
 * not mean auditing every route.
 */
export function requireCapability(capability: Capability): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const user = c.get('user');
    if (!can(user.role, capability)) {
      return c.json(
        {
          error: 'forbidden',
          capability,
          role: user.role,
          detail:
            user.role === 'pending'
              ? 'Your account is awaiting approval by an owner.'
              : 'Your role does not permit this action.',
        },
        403,
      );
    }
    await next();
  };
}
