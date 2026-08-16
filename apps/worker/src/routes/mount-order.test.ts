/**
 * ⚠️⚠️ THIS FILE PINS A LIVE DEFECT, NOT A DESIGN. ⚠️⚠️
 *
 * Found 2026-08-16 while closing the testing audit's route→capability gap.
 * Nothing here should be read as approval of the behaviour it describes; it is
 * written down so it cannot go back to being invisible, and so the day it is
 * fixed, this file fails and gets deleted rather than quietly agreeing.
 *
 * ## The defect, in one sentence
 *
 * `routes/export.ts` gates itself with a blanket `.use('*',
 * requireCapability('editCatalog'))`, and `index.ts` mounts it at the BARE
 * `/api` prefix — so Hono registers that middleware as `/api/*`, and it
 * therefore also runs for every sub-app mounted AFTER it in `index.ts`.
 *
 * ## What that actually does
 *
 * Eight surfaces are effectively ANDed with `editCatalog` (contributor+),
 * regardless of what they declare:
 *
 *     /api/series  /api/universes  /api/crowdfunding  /api/isbn
 *     /api/enrich  /api/research   /api/reviews       /api/scan-jobs
 *
 * For most of them nothing changes — `editCatalog`, `scanBarcode` and
 * `manageWishlist` share a role set, and `scanPhoto`/`runResearch`/
 * `reviewFindings` are strictly narrower. The ones that DO change:
 *
 * | route                          | declares       | actually needs |
 * |--------------------------------|----------------|----------------|
 * | GET  /api/series, /api/series/:name | read      | editCatalog    |
 * | GET  /api/universes/:name      | read           | editCatalog    |
 * | GET  /api/research/queue, /pending, /auto-applied, /works/:id/findings | read | editCatalog |
 * | GET  /api/reviews/collection, /api/reviews/:workId/keys | read | editCatalog |
 * | POST /api/reviews/:workId/draft, /:workId/observed, /observed | trackReading | editCatalog |
 *
 * So a `member` or a `guest` — the two rungs below contributor — are refused,
 * with a 403 naming `editCatalog`, on routes the code says they may use. It
 * fails CLOSED, which is why nothing has broken loudly: it is an
 * over-restriction, never an escalation. But it is still the audit's target
 * class exactly — **the capability that governs a route is not the capability
 * the route declares** — and it is invisible on the page, because the owner
 * holds `editCatalog` and never meets it.
 *
 * The split it produces is the tell: `PUT /api/works/:id/reading` (catalog.ts,
 * mounted BEFORE export) lets a member set their own read-state, while
 * `POST /api/reviews/:workId/draft` (mounted after) refuses the same member
 * the review that goes with it. Both declare `trackReading`.
 *
 * ## Not fixed here, on purpose
 *
 * Changing an auth gate is never a side effect of adding tests. Two candidate
 * fixes exist and they are the owner's call, not this file's:
 *   1. drop `.use('*')` in export.ts and put `requireCapability('editCatalog')`
 *      on each of its two routes, or
 *   2. mount `exportRoutes` last in `index.ts`.
 * (1) is the real fix — (2) only moves the blast radius.
 *
 * ## What this file tests
 *
 * `index.ts` has no exported app and its `requireAuth` needs a live D1, so the
 * composed app cannot be driven directly. The replica below therefore mirrors
 * `index.ts`'s mount order — and the FIRST test reads `index.ts`'s source and
 * asserts the replica still matches it, so the replica cannot drift into
 * testing a composition that no longer exists.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppUser, Role } from '@lc/core';
import type { AppBindings, Env } from '../env.js';
import { accessoryRoutes } from './accessories.js';
import { aliasRoutes } from './aliases.js';
import { catalogRoutes } from './catalog.js';
import { coverRoutes } from './covers.js';
import { crowdfundingRoutes, provenanceRoutes } from './crowdfunding.js';
import { enrichRoutes } from './enrich.js';
import { exportRoutes } from './export.js';
import { isbnRoutes } from './isbn.js';
import { relationRoutes } from './relations.js';
import { researchRoutes } from './research.js';
import { reviewRoutes } from './reviews.js';
import { scanJobRoutes } from './scan-jobs.js';
import { seriesRoutes } from './series.js';
import { universeRoutes } from './universes.js';
import { userRoutes } from './users.js';
import { watchRoutes } from './watches.js';

/**
 * The mounts that sit BEHIND `requireAuth` in `index.ts`, in order. The three
 * that sit in front of it (`/api/health`, `/api/ingest`,
 * `/api/machine/audiobook-mapping`) and `/api/admin` are excluded: they are
 * not part of the composition under test and are covered in
 * `capability-wiring.test.ts`.
 */
const MOUNTS: [string, string, Hono<AppBindings>][] = [
  ['/api', 'userRoutes', userRoutes],
  ['/api', 'catalogRoutes', catalogRoutes],
  ['/api', 'relationRoutes', relationRoutes],
  ['/api', 'aliasRoutes', aliasRoutes],
  ['/api', 'accessoryRoutes', accessoryRoutes],
  ['/api', 'provenanceRoutes', provenanceRoutes],
  ['/api', 'coverRoutes', coverRoutes],
  ['/api', 'watchRoutes', watchRoutes],
  ['/api', 'exportRoutes', exportRoutes], // ⚠️ the leak point
  ['/api/series', 'seriesRoutes', seriesRoutes],
  ['/api/universes', 'universeRoutes', universeRoutes],
  ['/api/crowdfunding', 'crowdfundingRoutes', crowdfundingRoutes],
  ['/api/isbn', 'isbnRoutes', isbnRoutes],
  ['/api/enrich', 'enrichRoutes', enrichRoutes],
  ['/api/research', 'researchRoutes', researchRoutes],
  ['/api/reviews', 'reviewRoutes', reviewRoutes],
  ['/api/scan-jobs', 'scanJobRoutes', scanJobRoutes],
];

const stubDb = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(`DB_TOUCHED(${String(prop)}) — the handler ran, so the gates admitted it`);
    },
  },
);
const stubEnv = { DB: stubDb } as unknown as Env;

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

/** `index.ts`'s composition, with only `requireAuth` swapped for a role plant. */
function composedAs(role: Role) {
  const app = new Hono<AppBindings>();
  app.use('/api/*', async (c, next) => {
    c.set('user', userWith(role));
    await next();
  });
  for (const [prefix, , routes] of MOUNTS) app.route(prefix, routes);
  app.onError((err, c) => c.json({ error: 'handler_ran', detail: err.message }, 500));
  return app;
}

async function get(role: Role, path: string) {
  const res = await composedAs(role).request(path, {}, stubEnv);
  let body: { capability?: string } = {};
  try {
    body = (await res.json()) as { capability?: string };
  } catch {
    /* a stream or a non-JSON error page — status is all this needs */
  }
  return { status: res.status, capability: body.capability };
}

describe('index.ts mount order', () => {
  /**
   * The replica above is only evidence if it still matches the real file. This
   * reads `index.ts` and compares, so a mount added, removed or REORDERED
   * there fails here rather than silently making the rest of this file test a
   * composition that no longer exists.
   */
  it('the replica still matches index.ts, mount for mount and in order', () => {
    const source = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url).href), 'utf8');
    const found = [...source.matchAll(/app\.route\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/g)].map(
      (m) => [m[1], m[2]] as [string, string],
    );

    // The four in front of the blanket `requireAuth`, dropped in the same order
    // they appear — see MOUNTS' comment for why they are out of scope here.
    const behindAuth = found.filter(
      ([, name]) =>
        name !== 'healthRoutes' && name !== 'ingestRoutes' && name !== 'audiobookMappingRoutes' && name !== 'adminRoutes',
    );

    assert.deepEqual(
      behindAuth,
      MOUNTS.map(([prefix, name]) => [prefix, name]),
      'index.ts mounts changed — update MOUNTS in this file and re-check the leak below',
    );
  });

  /**
   * ⚠️ The leak point itself. `exportRoutes` is mounted at the BARE `/api`,
   * and it is the only sub-app that both carries a blanket `.use('*')` and is
   * mounted there. That combination is the whole defect; this test is what
   * fails first if either half changes.
   */
  it('export.ts must NEVER regain a blanket .use(*) — it is mounted at bare /api', () => {
    // ⚠️ Inverted 2026-08-16 when the defect was fixed. It used to assert the
    // blanket gate was PRESENT (characterising the bug). It now asserts the
    // opposite, because the combination that caused the leak — a blanket
    // `.use('*')` in a sub-app mounted at the BARE `/api` prefix — is still
    // one edit away at any time, and nothing else would catch it.
    const raw = readFileSync(fileURLToPath(new URL('./export.ts', import.meta.url).href), 'utf8');
    // ⚠️ Strip comments before asserting. The docblock in export.ts EXPLAINS the
    // old bug and therefore quotes `.use('*', requireCapability(...))` verbatim —
    // a naive grep of the raw file matches that prose and fails on correct code.
    // Caught immediately when this test was inverted; the lesson is that a
    // source-grep test must look at code, not at the file.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(
      source,
      /\.use\('\*'/,
      "export.ts has a blanket .use('*') again. Mounted at bare /api, Hono registers that " +
        'as /api/* and runs it for EVERY sub-app mounted after it — series, universes, ' +
        'crowdfunding, isbn, enrich, research, reviews, scan-jobs. Guard each route instead.',
    );
    assert.match(
      source,
      /\.get\('\/export\.json',\s*requireCapability\('editCatalog'\)/,
      'export.json lost its own guard — the export must stay editCatalog-only',
    );
    assert.match(
      source,
      /\.get\('\/export\.csv',\s*requireCapability\('editCatalog'\)/,
      'export.csv lost its own guard — the export must stay editCatalog-only',
    );
    const bare = MOUNTS.filter(([prefix]) => prefix === '/api').map(([, name]) => name);
    assert.ok(bare.includes('exportRoutes'), 'exportRoutes is still mounted at bare /api');
  });
});

/**
 * ⚠️ CHARACTERISATION, NOT APPROVAL. Every assertion below records what the
 * composed Worker does TODAY. Each one is wrong, in the sense that it
 * contradicts what the route itself declares — see the file header's table.
 *
 * When the owner fixes export.ts, this whole `describe` fails. That is the
 * intended outcome: delete it then, and let `capability-wiring.test.ts` (which
 * mounts each sub-app alone and therefore already asserts the CORRECT gate)
 * stand as the only statement.
 */
describe('⚠️ DEFECT: export.ts\'s blanket gate leaks onto everything mounted after it', () => {
  // The routes the leak used to reach. Kept as the regression surface.
  const leaked: [string, string][] = [
    ['/api/series', 'read'],
    ['/api/series/Mistborn', 'read'],
    ['/api/universes/cosmere', 'read'],
    ['/api/research/queue', 'read'],
    ['/api/research/pending', 'read'],
    ['/api/reviews/collection', 'read'],
    ['/api/reviews/1/keys', 'read'],
  ];

  for (const [path, declares] of leaked) {
    it(`GET ${path} declares '${declares}' and is no longer refused as 'editCatalog'`, async () => {
      const res = await get('member', path);
      assert.notEqual(
        res.capability,
        'editCatalog',
        `${path}: refused as 'editCatalog' again — export.ts's gate is leaking across the ` +
          `bare-/api mount. This route declares '${declares}'.`,
      );
    });
  }

  it('a guest is no longer refused as editCatalog on a route `read` names them for', async () => {
    const res = await get('guest', '/api/universes/cosmere');
    assert.notEqual(res.capability, 'editCatalog', 'the leak is back');
  });

  it('a contributor is still admitted everywhere — the fix must not have narrowed anything', async () => {
    for (const [path] of leaked) {
      const res = await get('contributor', path);
      assert.notEqual(res.status, 403, `${path}: a contributor is now refused — the fix narrowed something it should not have`);
    }
  });

  /**
   * The contrast that proves it is mount ORDER and nothing else: these two
   * declare the same capabilities as leaked routes above and are mounted
   * BEFORE `exportRoutes`, so they behave as declared.
   */
  it('routes mounted BEFORE exportRoutes are untouched', async () => {
    const changes = await get('member', '/api/works/1/changes'); // catalog.ts, `read`
    assert.notEqual(changes.status, 403, 'GET /api/works/:id/changes declares `read` and must admit a member');

    const watches = await get('guest', '/api/watches'); // watches.ts, `read`
    assert.notEqual(watches.status, 403, 'GET /api/watches declares `read` and must admit a guest');
  });

  /**
   * The split the defect produces inside one capability — the clearest single
   * symptom, and the one most likely to be reported as "reviews are broken for
   * her but read-state works".
   */
  it('trackReading is whole again — read-state and its review agree', async () => {
    // ⚠️ THE SHARPEST SYMPTOM THE DEFECT PRODUCED, kept as the sharpest guard.
    // PUT /api/works/:id/reading is mounted BEFORE exportRoutes and POST
    // /api/reviews/:id/draft AFTER, and both declare `trackReading` — so a
    // member could mark a book read but not write the review that goes with
    // it. One capability, split in half by mount order alone.
    const reading = await get('member', '/api/works/1/changes');
    assert.notEqual(reading.status, 403, 'the earlier half must still admit a member');

    const draft = await composedAs('member').request(
      '/api/reviews/1/draft',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      stubEnv,
    );
    const body = (await draft.json().catch(() => ({}))) as { capability?: string };
    assert.notEqual(
      body.capability,
      'editCatalog',
      'reviews/draft declares trackReading but was refused as editCatalog — the halves have split again',
    );
  });
});
