import { Hono } from 'hono';
import { exportCsvChunks, exportJsonChunks } from '@lc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Downloads. Wiring only — what goes in the file is decided in
 * `packages/db/src/export.ts`, including why the backup is JSON and the
 * spreadsheet is CSV.
 *
 * ⚠️ Gated on `editCatalog` rather than `read`. A reader may browse the shelf;
 * taking a copy of the whole database, email addresses and all, is an owner's
 * act. The sibling Board Game Catalog draws the line in the same place.
 */

/**
 * An async generator of text, as a streaming response body.
 *
 * `pull` rather than `start`: the consumer asks for the next chunk when it is
 * ready for one, so the generator only runs a query when the socket can take the
 * rows. Doing it in `start` would run the whole export as fast as D1 can answer
 * and queue every chunk in memory — which is the thing paging the tables was for.
 */
function textStream(chunks: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    async cancel() {
      // A cancelled download must not leave the generator mid-query. `return()`
      // runs its `finally` blocks and lets D1 go.
      await chunks.return(undefined as never);
    },
  });
}

/** `library-catalog-2026-08-10.json`, so a folder of them sorts by date. */
function filename(ext: string): string {
  return `library-catalog-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

/**
 * ⚠️ PER-ROUTE GUARDS, NEVER `.use('*')` HERE — and the reason is a real bug,
 * not a style preference.
 *
 * This sub-app used to gate itself with `.use('*', requireCapability(
 * 'editCatalog'))`. It is mounted in index.ts at the BARE `/api` prefix, so
 * Hono registered that middleware as `/api/*` — and ran it for **every
 * sub-app mounted after it**: series, universes, crowdfunding, isbn, enrich,
 * research, reviews and scan-jobs. Eight of them.
 *
 * Measured 2026-08-16, not reasoned: a `member` got
 * `403 {"capability":"editCatalog"}` on `GET /api/series`, `/api/universes/:name`,
 * the whole research queue, and `GET /api/reviews/collection` — all of which
 * declare `read` — and could not `POST /api/reviews/:workId/draft`, which
 * declares `trackReading`. The sharpest symptom: `PUT /api/works/:id/reading`
 * is mounted BEFORE export, so the same member could mark a book read but not
 * write the review that goes with it.
 *
 * It failed CLOSED — an over-restriction, never an escalation — which is
 * exactly why nothing broke loudly and nobody noticed: every current account
 * holds `editCatalog` or better (measured: 1 admin, 2 owners, zero lesser
 * roles), so it refused nobody. It would have bitten the first `member` added
 * — which is precisely what the second-household plan does.
 *
 * The fix is per-route guards, so this sub-app's gate can only ever apply to
 * this sub-app's routes. ⚠️ Mounting it last was the tempting one-line
 * alternative and was REJECTED: it only moves the blast radius to whatever is
 * mounted after it next, and leaves the trap armed for the next author.
 *
 * `routes/mount-order.test.ts` pins this; it fails if a blanket `.use('*')`
 * returns here.
 */
export const exportRoutes = new Hono<AppBindings>()
  .get('/export.json', requireCapability('editCatalog'), (c) =>
    new Response(textStream(exportJsonChunks(c.env.DB)), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename('json')}"`,
        // Generated per request from live rows. A cached backup is a backup of
        // whenever the cache was filled, which is the one property a backup
        // must not have.
        'Cache-Control': 'no-store',
      },
    }),
  )

  .get('/export.csv', requireCapability('editCatalog'), (c) =>
    new Response(textStream(exportCsvChunks(c.env.DB, c.get('user').id)), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename('csv')}"`,
        'Cache-Control': 'no-store',
      },
    }),
  );
