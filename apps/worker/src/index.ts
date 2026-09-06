/**
 * Worker entrypoint.
 *
 * Wiring only: mount middleware, mount routes, serve the SPA. Anything that
 * makes a decision belongs in `packages/` so the CLI can use it too.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppBindings, Env } from './env.js';
import {
  BILLING_FEATURES,
  billingPosture,
  billingSite,
  decideBilling,
} from './lib/billing-gate.js';
import { AUDIOBOOK_SWEEP_CRON, runAudiobookSweep } from './lib/audiobook-sweep-run.js';
import { fetchSystemDenied } from './lib/billing-system.js';
import { DETAILS_SWEEP_CRON, runDetailsSweep } from './lib/details-sweep.js';
import { indexBackstopOnRequest, indexPushAfterMutation } from './lib/index-push.js';
import { peerPushAfterMutation } from './lib/peer-push.js';
import { requireAuth } from './middleware/auth.js';
import { accessoryRoutes } from './routes/accessories.js';
import { adminCors, adminRoutes } from './routes/admin.js';
import { aliasRoutes } from './routes/aliases.js';
import { audiobookMappingRoutes } from './routes/audiobook-mapping.js';
import { audiobookSweepRoutes } from './routes/audiobook-sweep.js';
import { catalogRoutes } from './routes/catalog.js';
import { coverRoutes } from './routes/covers.js';
import { crowdfundingRoutes, provenanceRoutes } from './routes/crowdfunding.js';
import { donorRoutes } from './routes/donor.js';
import { peerRoutes } from './routes/peer.js';
import { enrichRoutes } from './routes/enrich.js';
import { exportRoutes } from './routes/export.js';
import { gabiRoutes } from './routes/gabi.js';
import { gabiDelegatedRoutes } from './routes/gabi-delegated.js';
import { gabiMemoryRoutes } from './routes/gabi-memory.js';
import { gabiNoteRoutes } from './routes/gabi-note.js';
import { healthRoutes } from './routes/health.js';
import { ingestRoutes } from './routes/ingest.js';
import { isbnRoutes } from './routes/isbn.js';
import { relationRoutes } from './routes/relations.js';
import { researchRoutes } from './routes/research.js';
import { reviewRoutes } from './routes/reviews.js';
import { scanCors, scanJobRoutes } from './routes/scan-jobs.js';
import { seriesRoutes } from './routes/series.js';
import { tbrRoutes } from './routes/tbr.js';
import { universeRoutes } from './routes/universes.js';
import { userRoutes } from './routes/users.js';
import { warningRoutes } from './routes/warnings.js';
import { watchRoutes } from './routes/watches.js';

const app = new Hono<AppBindings>();

/** The estate status page — apex only, GET-only, no Authorization needed. */
function healthCors() {
  return cors({
    origin: 'https://heygabi.ai',
    allowMethods: ['GET', 'OPTIONS'],
    maxAge: 600,
  });
}

// CORS for the estate status page (heygabi.ai/status) — apex only, GET-only.
// The route is already open by design; this only lets a BROWSER read it.
// Mounted before the route, same preflight reasoning as adminCors below.
app.use('/api/health', healthCors());
// Public — no token needed, so it can be curled to verify a deploy.
app.route('/api/health', healthRoutes);

// Shared-index pushers (lib/index-push.ts; design §7 step 4). ⚠️ Mounted
// BEFORE the ingest route, deliberately: the ebook importer creates works, so
// its mutations must pass through the after-mutation trigger too — a mount
// after `app.route('/api/ingest', …)` would never see them. Both are inert
// no-ops until the dispatcher sets INDEX_URL + INDEX_PUSH_TOKEN, and neither
// can touch a response: all index work runs on `waitUntil` after `next()`.
app.use('/api/*', indexPushAfterMutation());
app.use('/api/*', indexBackstopOnRequest());
app.use('/api/*', peerPushAfterMutation());

// ⚠️ Mounted BEFORE requireAuth, deliberately. The ebook importer is a script,
// not a person: no browser, no Google session, nothing to refresh a Firebase ID
// token with. It carries a shared secret instead and the route enforces that
// itself — see routes/ingest.ts for why the trade is acceptable and how narrow
// the route is kept to make it so. With EBOOK_INGEST_TOKEN unset it 404s rather
// than opening.
app.route('/api/ingest', ingestRoutes);

// ⚠️ Mounted BEFORE requireAuth, same reasoning as `/api/ingest` immediately
// above: the audiobook pipeline's Task Scheduler run is a script, not a
// person. See routes/audiobook-mapping.ts for how narrow the route is kept.
// With AUDIOBOOK_MAPPING_TOKEN unset it 404s rather than opening.
app.route('/api/machine/audiobook-mapping', audiobookMappingRoutes);

// ⚠️ Mounted BEFORE requireAuth, third of the machine routes: the caller is a
// sibling instance's hourly details sweep, not a person. X-Donor-Token gated;
// unset token OR wrong token both answer 404 — disabled/invisible, never open,
// and never advertised. Read-only, DETAIL_FIELDS values only. See routes/donor.ts.
app.route('/api/donor', donorRoutes);

// ⚠️ Mounted BEFORE requireAuth, FIFTH of the machine routes: peer instances
// push their holdings here on catalog mutations. Both sub-routes are X-Peer-Token
// gated; unset or wrong token = 404. (GET /holdings is token-gated too — it has
// no in-repo callers, and the series/work enrichment reads peer_holding via SQL,
// not through this route, so gating it costs nothing.)
app.route('/api/peer', peerRoutes);

// ⚠️ Mounted BEFORE requireAuth, FOURTH of the machine routes and the only one
// that can WRITE on somebody's behalf: the caller is the estate's Discord
// Worker relaying a person who has no browser session here (GABI Tier 1, owner
// approved 2026-08-17). Bearer-gated on ESTATE_APP_TOKEN_DISCORD — unset
// answers a worded 503, wrong answers a worded 401, and NEITHER is a licence to
// write: every writing verb resolves the on-behalf-of Firebase uid to an
// `app_user` row on THIS instance and checks that person's own capability, the
// same one the equivalent button is gated on. See routes/gabi-delegated.ts.
//
// ⚠️ Mounted BEFORE `/api/gabi` below, and the paths cannot collide: Hono
// matches the longer mount first regardless of order, but the ordering is
// written this way so a reader sees the machine door and the signed-in door
// beside each other rather than discovering the split later.
app.route('/api/gabi/delegated', gabiDelegatedRoutes);

// ⚠️ Mounted BEFORE requireAuth, SIXTH of the machine routes: the shared GABI
// conversation memory. The Discord Worker reads and writes the same conversation
// history the site panel uses, so both surfaces see one continuous conversation.
// Bearer-gated on ESTATE_APP_TOKEN_DISCORD — same secret as gabi-delegated, same
// failure direction (unset = 503, wrong = 401). The endpoint resolves a Firebase
// UID to an app_user and reads/writes under the 'shared' surface key.
app.route('/api/gabi/memory', gabiMemoryRoutes);

// CORS for the estate's federated admin page (exactly https://heygabi.ai —
// see routes/admin.ts). ⚠️ Before requireAuth on purpose: a preflight OPTIONS
// carries no bearer, so the blanket would 401 it. Only the preflight is
// answered here; the admin routes themselves mount AFTER the blanket below
// and stay behind it.
app.use('/api/admin/*', adminCors());

// CORS for the apex's "Add to Books →" affordance (catalog-platform's
// <estate-search scan>) — exactly https://heygabi.ai, POST-only, same
// before-the-blanket reasoning as adminCors immediately above: the preflight
// carries no bearer. See scan-jobs.ts's scanCors() for the full rationale.
app.use('/api/scan-jobs/barcode', scanCors());

// Everything else behind a verified Firebase ID token.
app.use('/api/*', requireAuth());
// The federated-admin surface (cross-origin twin of the People page's user
// routes — same gate, same write path, CORS-scoped mount).
app.route('/api/admin', adminRoutes);
// The audiobook sweep's operator verbs — run it now, and what did the last run
// decide (design §7.1). Mounted on the SAME `/api/admin` prefix as the
// federated user surface and therefore behind the same blanket `requireAuth`
// and the same one-origin CORS allowance; the routes gate themselves on
// `manageUsers` and word their own refusal. ⚠️ `/audiobooks/sweep` cannot
// collide with `adminRoutes`' `/users` or `/users/:id/role` — different first
// segment — so mount order carries no meaning here.
app.route('/api/admin', audiobookSweepRoutes);
app.route('/api', userRoutes);
app.route('/api', catalogRoutes);
// Mounted at /api too: `/works/:id/relations` and `/works/:id/aliases` each have
// one more segment than catalogRoutes' `/works/:id`, so none of the three can
// shadow another.
app.route('/api', relationRoutes);
app.route('/api', aliasRoutes);
// `/works/:id/accessories` and `/works/:id/provenance` — one more segment again,
// so they cannot shadow `/works/:id` either. ⚠️ There is deliberately no
// collection-wide accessory route: the owner asked for the count to stay off the
// main page, and the surest way to keep it off is for nothing to be able to ask.
app.route('/api', accessoryRoutes);
app.route('/api', provenanceRoutes);
// "This cover is not really the right cover, and I know it." Migration 0040.
// `/works/:id/cover` and `/works/:id/watches` are each one segment longer than
// catalogRoutes' `/works/:id`, so the same non-shadowing argument holds as for
// aliases and relations. ⚠️ The upload half needs an R2 binding this Worker does
// not have and answers 501 without it — see `env.ts` on `COVERS`, and note that
// this is NOT the scan-photo bucket that must never exist.
app.route('/api', coverRoutes);
app.route('/api', watchRoutes);
app.route('/api', exportRoutes);
app.route('/api/series', seriesRoutes);
// The tier above a series: one shared world, across the series in it. Mounted
// beside /api/series and not under it — a universe is not a kind of series, and
// nesting the address would suggest it was. See routes/universes.ts.
app.route('/api/universes', universeRoutes);
// Kickstarter / BackerKit / Indiegogo provenance and its physical-vs-digital
// audit. Gated `editCatalog` (contributor and up), including the reads — see
// routes/crowdfunding.ts.
app.route('/api/crowdfunding', crowdfundingRoutes);
app.route('/api/isbn', isbnRoutes);
app.route('/api/enrich', enrichRoutes);
app.route('/api/research', researchRoutes);
// The conversational fixer's one server-side surface — `POST /api/gabi/turn`,
// gated on `runResearch` because what it carries is a bill, not a write. Beside
// /api/research rather than under it: a conversation is not a kind of research
// run, and the loop it serves runs in the browser (gabi-fixer-design.md §3.1).
// ⚠️ Inert on any instance whose GABI_PANEL is not "on" — the route answers a
// worded 403 there, because hiding the panel was never the lock.
app.route('/api/gabi', gabiRoutes);
// Personal context notes — `POST /api/gabi/note`, the tool's server-side half.
// Gated on `read` because any signed-in user can save notes about themselves.
// Not a catalog mutation, not money-spending: a cheaper surface than the turn
// route, so it sits beside it with a lower gate.
app.route('/api/gabi/note', gabiNoteRoutes);
app.route('/api/reviews', reviewRoutes);
// The cross-catalog to-be-read list. Beside /api/reviews rather than under it:
// both are keys into the SAME Firebase project's collections and neither owns
// the other — an intention is not a kind of review. See routes/tbr.ts.
app.route('/api/tbr', tbrRoutes);
// Reader content warnings — the third key-derivation surface into the same
// Firebase project, beside reviews and the TBR for the same reason they are
// beside each other: none of the three owns the others, and all three exist to
// compute a document key the browser then writes with its own credentials. See
// routes/warnings.ts.
app.route('/api/warnings', warningRoutes);
// The intake queue: barcode sweeps and shelf photographs, both persisted so a
// locked phone does not lose the sweep. See routes/scan-jobs.ts.
app.route('/api/scan-jobs', scanJobRoutes);

app.notFound(async (c) => {
  // Unmatched /api/* is a genuine 404; anything else is an SPA route, so hand
  // back index.html and let the client router deal with it.
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'not_found', path: c.req.path }, 404);
  }
  const url = new URL(c.req.url);
  url.pathname = '/index.html';
  const res = await c.env.ASSETS.fetch(new Request(url, { headers: c.req.raw.headers }));

  // index.html names the content-hashed bundles, so a cached copy pins a browser
  // to a previous deploy's JavaScript. Safari did exactly that in the sibling
  // project: new assets were live, but the phone kept loading the old ones
  // because the file naming them was still in cache. The bundles are hashed and
  // cached hard by public/_headers; this one file must always be revalidated.
  const html = new Response(res.body, res);
  html.headers.set('Cache-Control', 'no-cache');
  return html;
});

app.onError((err, c) => {
  console.error('unhandled', err);
  return c.json({ error: 'internal', detail: err.message }, 500);
});

/**
 * L8 — the hourly details sweep, behind the `system` spending switch.
 *
 * 🔴 THE SWEEP IS THE ONE UNATTENDED BILLER IN THIS REPO. It has no user, so a
 * per-person rule cannot reach it; it resolves through the estate's `system`
 * principal and its own door (`lib/billing-system.ts`), and switching
 * `sweep.details` off for this site is the only way to stop it that is not a
 * deploy (billing design §2.5, §3.4, §7.1's clock-icon row).
 *
 * ⚠️ Shadow-first exactly like every other call site: `off` costs nothing and
 * asks nothing; `shadow` asks, logs the decision with `proceeded: true`, and
 * SWEEPS ANYWAY; `enforce` skips the sweep and says so in the log. There is no
 * person here to word a refusal to — the log line IS the refusal, which is why
 * it carries the same `evt: 'billing_policy'` shape the request paths emit and
 * can be grepped with one filter across both.
 *
 * 🔴 An unknown policy (directory down, door unconfigured, garbage body) SWEEPS
 * — §3.5 row 3's fail-open, chosen out loud. The wallet is bounded by
 * `SWEEP_LIMIT = 2` and `SWEEP_BUDGET`, not by this switch.
 */
async function sweepIfPolicyAllows(env: Env) {
  const posture = billingPosture(env.BILLING_POLICY);
  if (posture === 'off') return runDetailsSweep(env);

  const denied = await fetchSystemDenied(env);
  const { wouldDeny, proceeded, log } = decideBilling({
    posture,
    site: billingSite(env),
    feature: BILLING_FEATURES.sweep,
    denied,
  });

  if (log) {
    console.log(
      JSON.stringify({
        evt: 'billing_policy',
        posture,
        feature: BILLING_FEATURES.sweep,
        site: billingSite(env),
        // ⚠️ `system`, not `person`. A soak that could not tell the cron's
        // decisions from a household member's could not answer §4.2's flip
        // criterion for either.
        principal_kind: 'system',
        principal_value: null,
        would_deny: wouldDeny,
        proceeded,
        est_cents: '~4/hr',
      }),
    );
  }

  if (!proceeded) {
    return { skipped: 'billing_denied', feature: BILLING_FEATURES.sweep } as const;
  }
  return runDetailsSweep(env);
}

export default {
  fetch: app.fetch,

  /**
   * The clock. ⚠️ **TWO jobs now, dispatched on `event.cron` and nothing else**
   * — the hourly details sweep (owner ask 2026-08-16) and the four-hourly
   * audiobook association sweep (2026-09-05). The shape is the games Worker's
   * (`Board_Game_Catalog/apps/worker/src/index.ts:244`), which has dispatched
   * three crons through one handler since before this one had two.
   *
   * ⚠️ **The `else` is an ERROR, not a default.** A cron string this code does
   * not recognise means `wrangler.toml` and one of the two exported constants
   * have drifted apart, and the only correct response is to do nothing and say
   * so. The sibling Worker fell through to its OLDEST job instead — right there
   * only because it had a schedule before it had a dispatcher — and here that
   * would run the details sweep on the audiobook clock, hiding the exact
   * mistake `details-sweep.test.ts` and `audiobook-cron.test.ts` exist to
   * catch.
   *
   * ⚠️ **The promise is returned as well as registered, and that is not
   * belt-and-braces — `waitUntil` alone would be a bug.** A registered task is
   * cancelled about thirty seconds after the handler settles, and a details
   * lookup takes 20–90 seconds; `RESEARCH_TIMEOUT_MS` is 90s precisely because
   * they run that long. The sibling project put this work in `waitUntil` alone
   * and roughly half its runs were cancelled silently — no exception, nothing
   * in the catch, the run row stuck at `running` for eleven hours.
   * `routes/research.ts` awaits AND registers for the same reason; returning
   * the promise is a `scheduled()` handler's version of awaiting, because the
   * runtime keeps the invocation alive until it settles.
   *
   * Neither sweep throws, so both `.catch`es should be unreachable. They are
   * here because a scheduled invocation has no user, no response, and (measured
   * in the sibling project 2026-08-13) logs that defeated three separate
   * `wrangler tail` attempts — an unhandled rejection here would be invisible in
   * a way a request's never is.
   */
  scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === DETAILS_SWEEP_CRON) {
      const work = sweepIfPolicyAllows(env).then(
        (run) => console.log('details sweep', JSON.stringify(run)),
        (err) => console.error('details sweep failed', err),
      );
      ctx.waitUntil(work);
      return work;
    }

    if (event.cron === AUDIOBOOK_SWEEP_CRON) {
      // ⚠️ `{ kind: 'all' }` — the cron IS the full sweep, so a row it did not
      // reproduce is genuinely gone and it is the only trigger allowed to mark
      // anything stale (§6.2 guard 3). It is also the BACKSTOP: the on-add hook
      // answers "right away" and this catches whatever the hook missed, plus
      // everything the sibling catalog gained since the last tick.
      const work = runAudiobookSweep(env, { trigger: 'cron' }).then(
        (run) => console.log('audiobook sweep', JSON.stringify(run)),
        (err) => console.error('audiobook sweep failed', err),
      );
      ctx.waitUntil(work);
      return work;
    }

    console.error(
      'cron fired that nothing handles',
      event.cron,
      'expected one of',
      DETAILS_SWEEP_CRON,
      AUDIOBOOK_SWEEP_CRON,
    );
    return;
  },
} satisfies ExportedHandler<Env>;
