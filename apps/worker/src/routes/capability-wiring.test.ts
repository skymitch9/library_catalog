/**
 * Route → capability WIRING, for every route file under `routes/`.
 *
 * ⚠️ Closes the second half of the 2026-08-16 testing audit's named gap. The
 * first half — `scan-jobs.test.ts` — was written when `/shelf` and `/single`
 * were found gated on `runResearch` instead of `scanPhoto`; that file stays as
 * it is and is the idiom this one follows. Sixteen other route files had no
 * such test at all, which is how the sibling repo (catalog-platform) shipped a
 * `requireApprover()` that checked a flag but not status: the gate looked
 * right on the page, and nothing anywhere exercised it.
 *
 * ## What this pins, and what it deliberately does NOT
 *
 * `capabilities.test.ts` pins the ROLE MATRIX — who holds `editCatalog`. This
 * file pins the WIRING — which capability string each route actually checks.
 * They are different failures and neither test can see the other's:
 *
 * - Swap `requireCapability('editCatalog')` for `requireCapability('read')` on
 *   a mutating route and the matrix test still passes.
 * - Delete the guard entirely and the matrix test still passes.
 *
 * So the assertions here are read off the WIRE, from the `capability` field
 * that `capabilityDenied` (middleware/auth.ts) puts in the 403 body — the same
 * field a real client sees. A status code alone is not enough: `editCatalog`,
 * `manageWishlist` and `scanBarcode` hold the identical role set today, as do
 * `scanPhoto`/`runResearch`/`reviewFindings` and `trackReading`/
 * `suggestWishlist`. Mixing up two same-shaped capabilities refuses and admits
 * exactly the same people, and only the NAME tells them apart.
 *
 * ## How the roles are chosen
 *
 * Derived from `CAPABILITY_MATRIX` rather than hardcoded, on purpose — the
 * matrix is somebody else's test. `deniedRole` is the highest role that does
 * NOT hold the capability (so the refusal is as tight as the ladder allows)
 * and `floorRole` is the lowest that does. A route whose guard is removed
 * stops 403ing the denied role; a route whose guard is tightened starts 403ing
 * the floor role. Both directions bite.
 *
 * ## Why a stub env is safe
 *
 * `requireCapability` runs before the handler, so every refusal is decided
 * before anything touches `c.env`. The admitted-past-the-gate assertions only
 * check "not 403" — the handler is then free to 400 on a schema, 501 on a
 * missing binding, 503 on a missing API key, or blow up on the DB stub, and
 * all four are proof the gate let it through. `stubDb` throws on ANY property
 * access so a handler that reaches the database is loud rather than silently
 * returning undefined, and `onError` below turns that into a status instead of
 * console noise.
 *
 * ⚠️ The two money-spending routes (`POST /research/works/:id/run`,
 * `POST /series/:name/scan`) both check `ANTHROPIC_API_KEY` as their first act
 * and answer 503 without one — verified before this test was written. Nothing
 * here can bill the vision or LLM API.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { CAPABILITY_MATRIX, ROLES, type AppUser, type Capability, type Role } from '@lc/core';
import type { AppBindings, Env } from '../env.js';
import { accessoryRoutes } from './accessories.js';
import { adminRoutes } from './admin.js';
import { aliasRoutes } from './aliases.js';
import { audiobookMappingRoutes } from './audiobook-mapping.js';
import { catalogRoutes } from './catalog.js';
import { coverRoutes } from './covers.js';
import { crowdfundingRoutes, provenanceRoutes } from './crowdfunding.js';
import { enrichRoutes } from './enrich.js';
import { exportRoutes } from './export.js';
import { gabiRoutes } from './gabi.js';
import { healthRoutes } from './health.js';
import { ingestRoutes } from './ingest.js';
import { isbnRoutes } from './isbn.js';
import { relationRoutes } from './relations.js';
import { researchRoutes } from './research.js';
import { reviewRoutes } from './reviews.js';
import { scanJobRoutes } from './scan-jobs.js';
import { seriesRoutes } from './series.js';
import { tbrRoutes } from './tbr.js';
import { universeRoutes } from './universes.js';
import { userRoutes } from './users.js';
import { warningRoutes } from './warnings.js';
import { watchRoutes } from './watches.js';

// ── roles, derived from the matrix ──────────────────────────────────────────

/** The highest role that does NOT hold `capability`. */
function deniedRole(capability: Capability): Role {
  const allowed = CAPABILITY_MATRIX[capability] as readonly Role[];
  const role = ROLES.find((r) => !allowed.includes(r));
  assert.ok(role, `every role holds '${capability}' — nothing can be refused`);
  return role;
}

/** The lowest role that DOES hold `capability`. */
function floorRole(capability: Capability): Role {
  const allowed = CAPABILITY_MATRIX[capability] as readonly Role[];
  const role = [...ROLES].reverse().find((r) => allowed.includes(r));
  assert.ok(role, `no role holds '${capability}'`);
  return role;
}

function userWith(role: Role): AppUser {
  return {
    id: 1,
    email: 'test@example.com',
    firebaseUid: null,
    displayName: null,
    reviewName: null,
    photoUrl: null,
    role,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:00:00.000Z',
  };
}

// ── the fake world ──────────────────────────────────────────────────────────

/**
 * Any touch is a throw. A handler that reaches D1 has, by definition, already
 * cleared the gate — which is the only thing being asserted on that side.
 */
const stubDb = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(`DB_TOUCHED(${String(prop)}) — the handler ran, so the gate admitted it`);
    },
  },
);

/**
 * Deliberately holds nothing but `DB`: no `ANTHROPIC_API_KEY` (so the two
 * spending routes 503), no `COVERS` (so the upload route 501), no `INDEX_URL`
 * (so `pushIndexSnapshot` skips without a fetch), no ingest tokens (so the two
 * machine surfaces 404 rather than opening).
 */
const stubEnv = { DB: stubDb } as unknown as Env;

type SubApp = Hono<AppBindings>;

/**
 * A bare app carrying ONE route file, with a fake `requireAuth` that plants
 * the role and nothing else — `requireCapability` is real, imported by the
 * route file itself, never swapped out.
 *
 * ⚠️ Mounted alone ON PURPOSE, which is what makes this file test each route's
 * OWN declared gate. The composed app in `index.ts` does not behave this way;
 * `mount-order.test.ts` is where that is pinned, and why.
 */
function appAs(routes: SubApp, role: Role | null): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  if (role !== null) {
    app.use('*', async (c, next) => {
      c.set('user', userWith(role));
      await next();
    });
  }
  app.route('/', routes);
  // A handler that blew up on `stubDb` is a PASS for the admitted assertions.
  // Answering it here keeps that out of the console and out of 403's way. 500
  // rather than a distinct sentinel because Hono's status type refuses 599 —
  // nothing here asserts on the value, only that it is not 403.
  app.onError((err, c) => c.json({ error: 'handler_ran', detail: err.message }, 500));
  return app;
}

async function call(routes: SubApp, role: Role, method: string, path: string, body?: unknown) {
  const init: RequestInit =
    method === 'GET' || method === 'DELETE'
      ? { method }
      : {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        };
  return appAs(routes, role).request(path, init, stubEnv);
}

// ── the table ───────────────────────────────────────────────────────────────

interface Wired {
  /** The route file's exported sub-app. */
  routes: SubApp;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Concrete path, relative to the sub-app (not to its mount point). */
  path: string;
  /** The capability name that must appear in the 403 body. */
  capability: Capability;
  /** Skip the admitted-past-the-gate half, with a reason. */
  skipAdmitted?: string;
}

/**
 * ⚠️ EVERY route in `routes/` appears here or in one of the named exemptions
 * further down. A new route with no row is a route with no wiring test, which
 * is the condition this file exists to end — `route-coverage.test.ts` is not a
 * thing, so the discipline is: add the row in the same commit as the route.
 */
const WIRED: Wired[] = [
  // ── accessories.ts (mounted at /api) ──
  { routes: accessoryRoutes, method: 'GET', path: '/works/1/accessories', capability: 'read' },
  { routes: accessoryRoutes, method: 'POST', path: '/works/1/accessories', capability: 'editCatalog' },
  { routes: accessoryRoutes, method: 'PATCH', path: '/works/1/accessories/2', capability: 'editCatalog' },
  { routes: accessoryRoutes, method: 'DELETE', path: '/works/1/accessories/2', capability: 'editCatalog' },

  // ── admin.ts (/api/admin) — the federated twin of users.ts ──
  { routes: adminRoutes, method: 'GET', path: '/users', capability: 'manageUsers' },
  { routes: adminRoutes, method: 'PATCH', path: '/users/2/role', capability: 'manageUsers' },
  { routes: adminRoutes, method: 'POST', path: '/index-push', capability: 'manageUsers' },

  // ── aliases.ts (/api) ──
  { routes: aliasRoutes, method: 'GET', path: '/works/1/aliases', capability: 'read' },
  { routes: aliasRoutes, method: 'POST', path: '/works/1/aliases', capability: 'editCatalog' },
  { routes: aliasRoutes, method: 'DELETE', path: '/works/1/aliases/2', capability: 'editCatalog' },

  // ── catalog.ts (/api) — the big one ──
  { routes: catalogRoutes, method: 'GET', path: '/collection', capability: 'read' },
  { routes: catalogRoutes, method: 'GET', path: '/collection/facets', capability: 'read' },
  { routes: catalogRoutes, method: 'GET', path: '/stats', capability: 'read' },
  { routes: catalogRoutes, method: 'GET', path: '/wishlist', capability: 'read' },
  { routes: catalogRoutes, method: 'GET', path: '/works/match?title=x', capability: 'read' },
  { routes: catalogRoutes, method: 'GET', path: '/works/1', capability: 'read' },
  { routes: catalogRoutes, method: 'GET', path: '/works/1/changes', capability: 'read' },
  // ⚠️ A POST gated on `read` — the loosest capability there is, and the only
  // WRITE in this repo a `guest` may make. Deliberate per the route's own
  // comment (design §5.2: it records an observation, grants nothing, and is
  // never authoritative) and reported to the owner unchanged. Pinned here so
  // that if it is ever tightened, that is a decision and not a drift.
  { routes: catalogRoutes, method: 'POST', path: '/works/1/reviews-seen', capability: 'read' },
  // ⚠️ `suggestWishlist`, not `editCatalog` — a member must be able to create
  // the bare `work` row behind an ask. See the route's comment.
  { routes: catalogRoutes, method: 'POST', path: '/works', capability: 'suggestWishlist' },
  { routes: catalogRoutes, method: 'POST', path: '/copies', capability: 'suggestWishlist' },
  // ⚠️ `read`, and it is the loosest gate in this file on a route that answers
  // with rows about a person. It is safe at `read` for exactly one reason: the
  // id comes from the verified token and the route takes NO parameter, so it
  // can only ever answer about the caller. If it ever grows a `?userId=`, this
  // row is wrong and the gate has to move with it.
  { routes: catalogRoutes, method: 'GET', path: '/copies/with-me', capability: 'read' },
  { routes: catalogRoutes, method: 'PATCH', path: '/works/1', capability: 'editCatalog' },
  { routes: catalogRoutes, method: 'GET', path: '/works/1/deletion', capability: 'editCatalog' },
  { routes: catalogRoutes, method: 'DELETE', path: '/works/1', capability: 'editCatalog' },
  { routes: catalogRoutes, method: 'POST', path: '/editions', capability: 'editCatalog' },
  { routes: catalogRoutes, method: 'PATCH', path: '/editions/1', capability: 'editCatalog' },
  { routes: catalogRoutes, method: 'DELETE', path: '/editions/1', capability: 'editCatalog' },
  { routes: catalogRoutes, method: 'PUT', path: '/works/1/reading', capability: 'trackReading' },

  // ── covers.ts (/api) ──
  // `read` and not `editCatalog`: it reports a property of the DEPLOYMENT.
  { routes: coverRoutes, method: 'GET', path: '/cover-storage', capability: 'read' },
  { routes: coverRoutes, method: 'GET', path: '/works/1/covers', capability: 'editCatalog' },
  { routes: coverRoutes, method: 'PUT', path: '/works/1/cover', capability: 'editCatalog' },
  { routes: coverRoutes, method: 'PATCH', path: '/works/1/cover-status', capability: 'editCatalog' },
  { routes: coverRoutes, method: 'POST', path: '/works/1/cover', capability: 'editCatalog' },
  { routes: coverRoutes, method: 'DELETE', path: '/works/1/cover', capability: 'editCatalog' },

  // ── crowdfunding.ts (/api/crowdfunding) — blanket `.use('*')`, READS INCLUDED ──
  // ⚠️ The blanket is the whole gate here: no route below carries its own
  // `requireCapability`, so if `.use('*', …)` is ever dropped or narrowed,
  // household financial detail (what was paid, from which login) opens to
  // everyone with `read`. The nested paths are in the table deliberately —
  // they are what proves the wildcard actually reaches that deep.
  { routes: crowdfundingRoutes, method: 'GET', path: '/', capability: 'editCatalog' },
  { routes: crowdfundingRoutes, method: 'GET', path: '/pledges', capability: 'editCatalog' },
  { routes: crowdfundingRoutes, method: 'GET', path: '/1', capability: 'editCatalog' },
  { routes: crowdfundingRoutes, method: 'POST', path: '/', capability: 'editCatalog' },
  { routes: crowdfundingRoutes, method: 'POST', path: '/pledges', capability: 'editCatalog' },
  { routes: crowdfundingRoutes, method: 'POST', path: '/pledges/1/items', capability: 'editCatalog' },
  { routes: crowdfundingRoutes, method: 'PUT', path: '/items/1/edition', capability: 'editCatalog' },
  { routes: crowdfundingRoutes, method: 'DELETE', path: '/items/1', capability: 'editCatalog' },
  { routes: crowdfundingRoutes, method: 'DELETE', path: '/pledges/1', capability: 'editCatalog' },
  { routes: crowdfundingRoutes, method: 'DELETE', path: '/1', capability: 'editCatalog' },
  // The provenance read is the deliberate exception: `read`, because it is
  // stripped of the money and only says where a book came from.
  { routes: provenanceRoutes, method: 'GET', path: '/works/1/provenance', capability: 'read' },

  // ── enrich.ts (/api/enrich) ──
  { routes: enrichRoutes, method: 'GET', path: '/works/1/candidates', capability: 'editCatalog' },

  // ── export.ts (/api) — blanket `.use('*')`, the whole catalog in one file ──
  // The stream is built lazily, so the admitted half would hand back a 200
  // whose body throws on read. Nothing is proved by consuming it.
  { routes: exportRoutes, method: 'GET', path: '/export.json', capability: 'editCatalog', skipAdmitted: 'lazy stream — a 200 here proves nothing the 403 half does not' },
  { routes: exportRoutes, method: 'GET', path: '/export.csv', capability: 'editCatalog', skipAdmitted: 'lazy stream — see /export.json' },

  // ── isbn.ts (/api/isbn) ──
  // `scanBarcode`, the free half of the 2026-08-16 scan split. The DB lookup
  // comes before any Open Library call, so the admitted half stays offline.
  { routes: isbnRoutes, method: 'GET', path: '/9780765326355', capability: 'scanBarcode' },

  // ── relations.ts (/api) ──
  { routes: relationRoutes, method: 'GET', path: '/works/1/relations', capability: 'read' },
  { routes: relationRoutes, method: 'POST', path: '/works/1/relations', capability: 'editCatalog' },
  { routes: relationRoutes, method: 'DELETE', path: '/relations/2', capability: 'editCatalog' },

  // ── research.ts (/api/research) ──
  { routes: researchRoutes, method: 'GET', path: '/queue', capability: 'read' },
  { routes: researchRoutes, method: 'GET', path: '/works/1/findings', capability: 'read' },
  { routes: researchRoutes, method: 'GET', path: '/pending', capability: 'read' },
  { routes: researchRoutes, method: 'GET', path: '/auto-applied', capability: 'read' },
  { routes: researchRoutes, method: 'POST', path: '/undo', capability: 'reviewFindings' },
  { routes: researchRoutes, method: 'PATCH', path: '/findings/1', capability: 'reviewFindings' },
  { routes: researchRoutes, method: 'POST', path: '/works/1/verdict', capability: 'reviewFindings' },
  { routes: researchRoutes, method: 'DELETE', path: '/verdicts/1', capability: 'reviewFindings' },
  // ⚠️ Spends money. Safe to admit only because the route's first act is the
  // `ANTHROPIC_API_KEY` check, and `stubEnv` has none — it 503s.
  { routes: researchRoutes, method: 'POST', path: '/works/1/run', capability: 'runResearch' },

  // ── gabi.ts (/api/gabi) — the conversational fixer's one route ──
  // ⚠️ `runResearch`, NOT `editCatalog`: the route spends her Anthropic key, and
  // that is the risk it carries. The WRITING risk sits on the tool endpoints,
  // each behind its own gate — routes/research.ts's header makes the same split
  // for the same reason. Both hold identical role sets today, so this row is the
  // only thing that can tell them apart if somebody swaps one for the other.
  //
  // Safe to admit past the gate: `stubEnv` has no `GABI_PANEL`, so the posture
  // guard answers 404 (disabled, not open) as its first act — before the key
  // check, before D1, and long before anything could bill Anthropic.
  { routes: gabiRoutes, method: 'POST', path: '/turn', capability: 'runResearch' },

  // ── reviews.ts (/api/reviews) ──
  { routes: reviewRoutes, method: 'GET', path: '/collection', capability: 'read' },
  { routes: reviewRoutes, method: 'GET', path: '/1/keys', capability: 'read' },
  { routes: reviewRoutes, method: 'POST', path: '/1/draft', capability: 'trackReading' },
  { routes: reviewRoutes, method: 'POST', path: '/1/observed', capability: 'trackReading' },
  { routes: reviewRoutes, method: 'POST', path: '/observed', capability: 'trackReading' },

  // ── tbr.ts (/api/tbr) ──
  // Both are `read`: this route writes nothing at all. The TBR document itself
  // is written and deleted by the browser with the person's own Firebase
  // credentials (routes/tbr.ts), exactly as a review is.
  { routes: tbrRoutes, method: 'GET', path: '/collection', capability: 'read' },
  { routes: tbrRoutes, method: 'GET', path: '/1/keys', capability: 'read' },
  { routes: tbrRoutes, method: 'POST', path: '/resolve', capability: 'read' },

  // ── warnings.ts (/api/warnings) ──
  // ⚠️ `read` for the keys and `trackReading` for the draft — the SAME pair
  // reviews declares, and for the same reason: neither route writes anything.
  // The warning document itself is written and deleted by the browser with the
  // person's own Firebase credentials, gated by `firestore.rules`. The
  // `moderateContent` capability this feature adds is deliberately NOT wired to
  // a route: it gates an affordance in the UI, and the real gate on the delete
  // is `canDeleteUserWarning()` in the audiobook catalog's rules — see
  // `packages/core/src/capabilities.ts`.
  { routes: warningRoutes, method: 'GET', path: '/1/keys', capability: 'read' },
  { routes: warningRoutes, method: 'POST', path: '/1/draft', capability: 'trackReading' },

  // ── scan-jobs.ts (/api/scan-jobs) ──
  // ⚠️ `GET /`, `POST /barcode`, `POST /shelf` and `POST /single` are pinned by
  // `scan-jobs.test.ts` — the audit's first half — and are NOT repeated here.
  // These are the six that file does not reach.
  { routes: scanJobRoutes, method: 'GET', path: '/1', capability: 'editCatalog' },
  { routes: scanJobRoutes, method: 'POST', path: '/1/enrich', capability: 'editCatalog' },
  { routes: scanJobRoutes, method: 'POST', path: '/1/lines/0/lookup', capability: 'editCatalog' },
  { routes: scanJobRoutes, method: 'PATCH', path: '/1/lines/0', capability: 'editCatalog' },
  { routes: scanJobRoutes, method: 'POST', path: '/1/done', capability: 'editCatalog' },
  { routes: scanJobRoutes, method: 'DELETE', path: '/1', capability: 'editCatalog' },

  // ── series.ts (/api/series) — blanket `.use('*', read)` PLUS per-route gates ──
  // The blanket is a floor, not the whole story: the stronger per-route
  // capability is what a refusal must name for anyone above the floor.
  { routes: seriesRoutes, method: 'GET', path: '/', capability: 'read' },
  { routes: seriesRoutes, method: 'GET', path: '/Mistborn', capability: 'read' },
  { routes: seriesRoutes, method: 'POST', path: '/Mistborn/volumes', capability: 'editCatalog' },
  { routes: seriesRoutes, method: 'DELETE', path: '/Mistborn/volumes/1', capability: 'editCatalog' },
  { routes: seriesRoutes, method: 'PUT', path: '/Mistborn/total', capability: 'editCatalog' },
  { routes: seriesRoutes, method: 'POST', path: '/Mistborn/skips', capability: 'editCatalog' },
  { routes: seriesRoutes, method: 'DELETE', path: '/Mistborn/skips/1', capability: 'editCatalog' },
  { routes: seriesRoutes, method: 'POST', path: '/Mistborn/audio-link', capability: 'editCatalog' },
  { routes: seriesRoutes, method: 'DELETE', path: '/Mistborn/audio-link', capability: 'editCatalog' },
  // ⚠️ Spends money — same 503-without-a-key protection as /research/works/:id/run.
  { routes: seriesRoutes, method: 'POST', path: '/Mistborn/scan', capability: 'runResearch' },

  // ── universes.ts (/api/universes) — blanket `.use('*', read)` ──
  { routes: universeRoutes, method: 'GET', path: '/cosmere', capability: 'read' },

  // ── users.ts (/api) ──
  { routes: userRoutes, method: 'GET', path: '/users', capability: 'manageUsers' },
  { routes: userRoutes, method: 'PATCH', path: '/users/2/role', capability: 'manageUsers' },

  // ── watches.ts (/api) ──
  { routes: watchRoutes, method: 'GET', path: '/watches', capability: 'read' },
  { routes: watchRoutes, method: 'GET', path: '/works/1/watches', capability: 'read' },
  { routes: watchRoutes, method: 'POST', path: '/works/1/watches', capability: 'editCatalog' },
  { routes: watchRoutes, method: 'POST', path: '/works/1/watches/2/resolve', capability: 'editCatalog' },
  { routes: watchRoutes, method: 'DELETE', path: '/works/1/watches/2', capability: 'editCatalog' },
];

describe('every route declares a capability, and the wire says which', () => {
  for (const route of WIRED) {
    const label = `${route.method} ${route.path}`;

    it(`${label} refuses BY NAME as '${route.capability}'`, async () => {
      const role = deniedRole(route.capability);
      const res = await call(route.routes, role, route.method, route.path);
      assert.equal(res.status, 403, `${label}: expected 403 for '${role}' — is the guard still there?`);
      const body = (await res.json()) as { error?: string; capability?: string; role?: string };
      assert.equal(body.error, 'forbidden');
      // ⚠️ THE assertion. Several capabilities share a role set, so the status
      // code cannot tell them apart — only this field can.
      assert.equal(
        body.capability,
        route.capability,
        `${label}: refused as '${body.capability}', expected '${route.capability}'`,
      );
      assert.equal(body.role, role);
    });

    if (route.skipAdmitted === undefined) {
      it(`${label} admits '${floorRole(route.capability)}' past the gate`, async () => {
        const role = floorRole(route.capability);
        const res = await call(route.routes, role, route.method, route.path);
        assert.notEqual(
          res.status,
          403,
          `${label}: '${role}' holds '${route.capability}' but was refused — the gate is tighter than it declares`,
        );
      });
    }
  }
});

/**
 * The three routes in `catalog.ts` whose capability cannot be known from the
 * route alone — it depends on the copy's own `status` — and so is decided
 * inline with `can()` + `capabilityDenied` instead of `requireCapability`.
 *
 * ⚠️ These are the rows a declarative test would silently skip, and exactly
 * where a missing guard would be invisible: `PATCH /copies/:id` and
 * `DELETE /copies/:id` carry NO middleware at all. If the inline check were
 * deleted, every assertion in the block above would still pass.
 *
 * ⚠️ Also pinned here: `manageWishlist` and `editCatalog` hold the IDENTICAL
 * role set today (contributor+), so no role-based test can distinguish the
 * wishlist branch from the catalog branch. The capability NAME is the only
 * evidence the branch ran, which is the same argument `scan-jobs.test.ts`
 * makes about `scanPhoto` vs `runResearch`.
 */
describe('catalog.ts copies — the gates decided inside the handler', () => {
  /** A D1 stub that answers `getCopy` with one row and nothing else. */
  function dbWithCopy(status: string) {
    const row = {
      id: 1,
      work_id: 1,
      edition_id: null,
      status,
      location: null,
      acquired_on: null,
      price_paid_cents: null,
      currency: 'USD',
      vendor: null,
      condition: null,
      is_signed: 0,
      edition_notes: null,
      lent_to: null,
      person_user_id: null,
      person_name: null,
      notes: null,
    };
    return {
      prepare: () => ({
        bind: () => ({
          first: async () => row,
        }),
      }),
    };
  }

  async function copyCall(method: 'PATCH' | 'DELETE', role: Role, status: string, body?: unknown) {
    const env = { DB: dbWithCopy(status) } as unknown as Env;
    const init: RequestInit =
      method === 'DELETE'
        ? { method }
        : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) };
    return appAs(catalogRoutes, role).request('/copies/1', init, env);
  }

  it('POST /copies upgrades to editCatalog when the body is not a wishlist ask', async () => {
    // Past the `suggestWishlist` floor (member holds it), refused inline by NAME.
    const res = await call(catalogRoutes, 'member', 'POST', '/copies', {
      workId: 1,
      status: 'owned',
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { capability?: string };
    assert.equal(body.capability, 'editCatalog');
  });

  it('POST /copies stays on suggestWishlist for a wanted copy', async () => {
    const res = await call(catalogRoutes, 'guest', 'POST', '/copies', {
      workId: 1,
      status: 'wanted',
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { capability?: string };
    assert.equal(body.capability, 'suggestWishlist');
  });

  for (const method of ['PATCH', 'DELETE'] as const) {
    it(`${method} /copies/:id names manageWishlist on a wishlist row`, async () => {
      const res = await copyCall(method, 'member', 'wanted');
      assert.equal(res.status, 403, `${method} /copies/:id: no refusal — is the inline check still there?`);
      const body = (await res.json()) as { capability?: string };
      assert.equal(body.capability, 'manageWishlist');
    });

    it(`${method} /copies/:id names editCatalog on a held row`, async () => {
      const res = await copyCall(method, 'member', 'owned');
      assert.equal(res.status, 403, `${method} /copies/:id: no refusal — is the inline check still there?`);
      const body = (await res.json()) as { capability?: string };
      assert.equal(body.capability, 'editCatalog');
    });
  }

  it('PATCH /copies/:id names manageWishlist when the row LEAVES the wishlist', async () => {
    // wanted → owned is a promotion. The old status is the wishlist one, so
    // curating, not cataloguing, is what is being done.
    const res = await copyCall('PATCH', 'member', 'wanted', { status: 'owned' });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { capability?: string };
    assert.equal(body.capability, 'manageWishlist');
  });
});

/**
 * The routes with NO capability gate — each one on purpose, each one named.
 *
 * ⚠️ This block is the reason "no `requireCapability` in the file" is not by
 * itself a finding. It is also where an accidental hole would show up: a
 * fifth entry appearing in `routes/` with no gate and no row here.
 */
describe('the deliberately ungated surfaces', () => {
  it('health is public — no user in context at all, and it still answers', async () => {
    // `role: null` plants NO user. A `requireCapability` anywhere on this path
    // would throw on `c.get('user')` rather than 403, so this bites either way.
    const res = await appAs(healthRoutes, null).request('/', {}, stubEnv);
    assert.notEqual(res.status, 403);
    assert.notEqual(res.status, 401);
  });

  it('GET /me is ungated by design — the lowest role still gets an answer', async () => {
    // Every role must reach it: it is how the browser learns it is `pending`
    // and renders the request screen instead of a bare 403.
    for (const role of ROLES) {
      const res = await appAs(userRoutes, role).request('/me', {}, stubEnv);
      assert.notEqual(res.status, 403, `GET /me refused '${role}' — the request screen has nothing to render`);
    }
  });

  it('POST /ingest/ebook is shared-secret, not capability — and 404s when off', async () => {
    // Mounted BEFORE requireAuth in index.ts: there is no user to gate on.
    const res = await appAs(ingestRoutes, null).request(
      '/ebook',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      stubEnv,
    );
    assert.equal(res.status, 404, 'with EBOOK_INGEST_TOKEN unset this must 404, never open');
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'ingest_disabled');
  });

  it('POST /ingest/ebook 401s on a wrong token rather than admitting it', async () => {
    const env = { DB: stubDb, EBOOK_INGEST_TOKEN: 'right' } as unknown as Env;
    const res = await appAs(ingestRoutes, null).request(
      '/ebook',
      { method: 'POST', headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' }, body: '{}' },
      env,
    );
    assert.equal(res.status, 401);
  });

  it('GET /machine/audiobook-mapping is shared-secret too, and 404s when off', async () => {
    const res = await appAs(audiobookMappingRoutes, null).request('/', {}, stubEnv);
    assert.equal(res.status, 404, 'with AUDIOBOOK_MAPPING_TOKEN unset this must 404, never open');
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'audiobook_mapping_disabled');
  });

  it('GET /machine/audiobook-mapping 401s on a wrong token', async () => {
    const env = { DB: stubDb, AUDIOBOOK_MAPPING_TOKEN: 'right' } as unknown as Env;
    const res = await appAs(audiobookMappingRoutes, null).request(
      '/',
      { headers: { authorization: 'Bearer wrong' } },
      env,
    );
    assert.equal(res.status, 401);
  });
});

/**
 * A `pending` account is the one that matters most to get right — it is
 * somebody who has signed in and been approved by nobody. It must reach
 * `/me` (to be told so) and NOTHING else.
 */
describe('a pending account reaches /me and nothing else', () => {
  it('/me answers', async () => {
    const res = await appAs(userRoutes, 'pending').request('/me', {}, stubEnv);
    assert.notEqual(res.status, 403);
  });

  for (const route of WIRED) {
    it(`${route.method} ${route.path} refuses it`, async () => {
      const res = await call(route.routes, 'pending', route.method, route.path);
      assert.equal(res.status, 403, `a pending account got past ${route.method} ${route.path}`);
      const body = (await res.json()) as { role?: string; detail?: string };
      assert.equal(body.role, 'pending');
      // ⚠️ Not a bare status: a person must be told they are AWAITING approval,
      // not merely refused. The two have different fixes.
      assert.match(String(body.detail), /awaiting approval/i);
    });
  }
});
