/**
 * Worker entrypoint.
 *
 * Wiring only: mount middleware, mount routes, serve the SPA. Anything that
 * makes a decision belongs in `packages/` so the CLI can use it too.
 */

import { Hono } from 'hono';
import type { AppBindings, Env } from './env.js';
import { requireAuth } from './middleware/auth.js';
import { catalogRoutes } from './routes/catalog.js';
import { enrichRoutes } from './routes/enrich.js';
import { healthRoutes } from './routes/health.js';
import { ingestRoutes } from './routes/ingest.js';
import { isbnRoutes } from './routes/isbn.js';
import { reviewRoutes } from './routes/reviews.js';
import { userRoutes } from './routes/users.js';

const app = new Hono<AppBindings>();

// Public — no token needed, so it can be curled to verify a deploy.
app.route('/api/health', healthRoutes);


// ⚠️ Mounted BEFORE requireAuth, deliberately. The ebook importer is a script,
// not a person: no browser, no Google session, nothing to refresh a Firebase ID
// token with. It carries a shared secret instead and the route enforces that
// itself — see routes/ingest.ts for why the trade is acceptable and how narrow
// the route is kept to make it so. With EBOOK_INGEST_TOKEN unset it 404s rather
// than opening.
app.route('/api/ingest', ingestRoutes);

// Everything else behind a verified Firebase ID token.
app.use('/api/*', requireAuth());
app.route('/api', userRoutes);
app.route('/api', catalogRoutes);
app.route('/api/isbn', isbnRoutes);
app.route('/api/enrich', enrichRoutes);
app.route('/api/reviews', reviewRoutes);

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
} satisfies ExportedHandler<Env>;
