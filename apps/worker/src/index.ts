/**
 * Worker entrypoint.
 *
 * Wiring only: mount middleware, mount routes, serve the SPA. Anything that
 * makes a decision belongs in `packages/` so the CLI can use it too.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppBindings, Env } from './env.js';
import { DETAILS_SWEEP_CRON, runDetailsSweep } from './lib/details-sweep.js';
import { indexBackstopOnRequest, indexPushAfterMutation } from './lib/index-push.js';
import { requireAuth } from './middleware/auth.js';
import { accessoryRoutes } from './routes/accessories.js';
import { adminCors, adminRoutes } from './routes/admin.js';
import { aliasRoutes } from './routes/aliases.js';
import { audiobookMappingRoutes } from './routes/audiobook-mapping.js';
import { catalogRoutes } from './routes/catalog.js';
import { coverRoutes } from './routes/covers.js';
import { crowdfundingRoutes, provenanceRoutes } from './routes/crowdfunding.js';
import { enrichRoutes } from './routes/enrich.js';
import { exportRoutes } from './routes/export.js';
import { healthRoutes } from './routes/health.js';
import { ingestRoutes } from './routes/ingest.js';
import { isbnRoutes } from './routes/isbn.js';
import { relationRoutes } from './routes/relations.js';
import { researchRoutes } from './routes/research.js';
import { reviewRoutes } from './routes/reviews.js';
import { scanCors, scanJobRoutes } from './routes/scan-jobs.js';
import { seriesRoutes } from './routes/series.js';
import { universeRoutes } from './routes/universes.js';
import { userRoutes } from './routes/users.js';
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
// audit. Owner-only, including the reads — see routes/crowdfunding.ts.
app.route('/api/crowdfunding', crowdfundingRoutes);
app.route('/api/isbn', isbnRoutes);
app.route('/api/enrich', enrichRoutes);
app.route('/api/research', researchRoutes);
app.route('/api/reviews', reviewRoutes);
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

export default {
  fetch: app.fetch,

  /**
   * The clock. This Worker's first and only scheduled job (owner ask
   * 2026-08-16), so there is nothing else here to dispatch between.
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
   * ⚠️ **An unrecognised cron does nothing, loudly.** The sibling Worker falls
   * through to its oldest job instead, which is right *there* because it had a
   * schedule before it had a dispatcher. Here, a cron this code does not know
   * about means `wrangler.toml` and `DETAILS_SWEEP_CRON` have drifted apart —
   * running the sweep anyway would hide exactly the mistake there is a test to
   * catch.
   *
   * `runDetailsSweep` never throws, so the `.catch` should be unreachable. It
   * is here because a scheduled invocation has no user, no response, and
   * (measured in the sibling project 2026-08-13) logs that defeated three
   * separate `wrangler tail` attempts — an unhandled rejection here would be
   * invisible in a way a request's never is.
   */
  scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron !== DETAILS_SWEEP_CRON) {
      console.error('cron fired that nothing handles', event.cron, 'expected', DETAILS_SWEEP_CRON);
      return;
    }

    const work = runDetailsSweep(env).then(
      (run) => console.log('details sweep', JSON.stringify(run)),
      (err) => console.error('details sweep failed', err),
    );
    ctx.waitUntil(work);
    return work;
  },
} satisfies ExportedHandler<Env>;
