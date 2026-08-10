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

export const exportRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('editCatalog'))

  .get('/export.json', (c) =>
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

  .get('/export.csv', (c) =>
    new Response(textStream(exportCsvChunks(c.env.DB, c.get('user').id)), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename('csv')}"`,
        'Cache-Control': 'no-store',
      },
    }),
  );
