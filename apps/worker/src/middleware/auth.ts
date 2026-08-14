import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { can, type Capability, type Role } from '@lc/core';
import {
  grantEstateDefaultRole,
  readEstateCache,
  upsertUserOnLogin,
  writeEstateCache,
} from '@lc/db';
import { estateGateCheck, parseEstateMode, type GateOutcome } from '@lc/estate-auth';
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
  // environment must be EXACTLY 'development'.
  //
  // ⚠️ This was `!== 'production'` until 2026-08-13, which fails OPEN. Any
  // environment that is not the exact string 'production' — unset, misspelled,
  // a `staging` or `preview` deploy, anything added later — turned the auth
  // bypass ON. Requiring the affirmative value fails CLOSED instead: an
  // unrecognised environment gets real authentication, which is the safe
  // direction for a mistake to fall.
  //
  // The board game catalog hardened its identical copy of this function and
  // this one never got the change — the drift was found by an estate-wide auth
  // review, not by anything failing. That divergence is the argument for
  // `estate-auth-design.md`'s shared module: two copies of an auth check are
  // two chances to harden only one.
  //
  // Safe for local dev because `apps/worker/.dev.vars` sets
  // ENVIRONMENT = "development" (verified before this change), and
  // wrangler.toml sets "production" for the deployed Worker.
  if (env.ENVIRONMENT === 'development' && env.DEV_EMAIL) {
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

    // ── Estate auth (estate-auth-design.md §3.1 / §5.2 / §14.5) ────────────
    //
    // After local auth has fully resolved — including the OWNER_EMAILS
    // recovery hatch inside upsertUserOnLogin, which must never sit behind
    // the estate — ask the directory (cached /seen) and act at ESTATE_CHECK
    // strength. `off` costs nothing; `shadow` logs the would-verdict and
    // changes no response; `enforce` acts on the gate's directives below.
    //
    // The COMPUTE step sits in a try/catch: no estate hiccup (a D1 error on
    // the cache read, a bug in the gate) may break a request local auth
    // already passed — an unexpected throw degrades to local-only auth,
    // loudly (§6 row 1's direction: open for the admitted; strangers are
    // still locally `pending` and gated by capabilities). The ACT step runs
    // outside it, so an enforce refusal is deterministic, never swallowed.
    let estate: GateOutcome | null = null;
    try {
      const parsed = parseEstateMode(c.env.ESTATE_CHECK);
      if (parsed.mode !== 'off' || !parsed.recognised) {
        const cache =
          parsed.mode !== 'off'
            ? await readEstateCache(c.env.DB, user.id)
            : { status: null, checkedAt: null, visibilityJson: null };
        estate = await estateGateCheck(c.env, {
          email: user.email,
          firebaseUid: user.firebaseUid,
          displayName: user.displayName,
          role: user.role,
          approvedAt: user.approvedAt,
          estateStatus: cache.status,
          estateCheckedAt: cache.checkedAt,
          estateVisibilityJson: cache.visibilityJson,
        });
        // The §5.2 cache columns — status + visibility together, one stamp
        // (§4.5's one-answer rule). Bookkeeping, never enforcement.
        if (estate.refresh) {
          await writeEstateCache(c.env.DB, user.id, {
            status: estate.refresh.status,
            checkedAt: estate.refresh.checkedAt,
            visibilityJson:
              estate.refresh.visibility === null
                ? null
                : JSON.stringify(estate.refresh.visibility),
          });
        }
        if (estate.logLine) console.log(estate.logLine);
      }
    } catch (err) {
      console.error('estate_gate: error swallowed — proceeding on local auth', err);
      estate = null;
    }

    // Enforce directives (both null outside enforce). Grant before deny is
    // arbitrary — the verdicts are mutually exclusive.
    if (estate?.autoGrant) {
      try {
        // §5.4: the WHERE inside re-checks `pending AND never-decided`, so a
        // concurrent local decision wins; the change_log audit row
        // (changed_how='auto', estate-actor convention) lands in the same
        // atomic batch, only if the grant did.
        const role = estate.autoGrant.role as Role;
        const granted = await grantEstateDefaultRole(c.env.DB, { userId: user.id, role });
        if (granted) {
          console.log(
            `estate_enforce: default-granted '${role}' to ${user.email} (estate-wide approval, §5.4; audit row written)`,
          );
          user.role = role;
          user.approvedAt = new Date().toISOString();
        }
        // Not granted = a concurrent local decision won; proceed on it.
      } catch (err) {
        // A failed grant leaves the person locally pending — the capability
        // layer shows the request screen, nothing is lost but this request.
        console.error('estate_enforce: default-grant failed — proceeding as pending', err);
      }
    }
    if (estate?.deny) {
      // 403 estate_revoked (computed, never stored — role left intact for
      // re-approval, §3.1 row 1) or 503 estate_unreachable (named, §6 row 1).
      return c.json(estate.deny.body, estate.deny.status);
    }

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
