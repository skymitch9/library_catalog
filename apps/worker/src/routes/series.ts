import { Hono } from 'hono';
import { createSeriesVolumeSchema, setSeriesTotalSchema, skipSeriesGapSchema } from '@lc/core';
import {
  deleteManualSeriesVolume,
  getSeriesReport,
  listSeries,
  setSeriesTotal,
  skipSeriesGap,
  unskipSeriesGap,
  upsertSeriesVolume,
} from '@lc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Series, and what is missing from them.
 *
 * Reading is `read`; the two writes are `editCatalog`, because both are
 * assertions about the world that the whole feature's credibility rests on.
 *
 * ⚠️ There is no `POST /backfill` here, unlike the sibling project's
 * `components.ts`. That route exists there because the sweep calls
 * BoardGameGeek and a Worker is where the token lives. This app's only series
 * source is `audiobook_catalog/site/catalog.csv` — a **file on disk beside this
 * repo**, which a Worker cannot read and a script can. So the sweep is
 * `npm run backfill:series-volumes`, and putting a route in front of it would
 * mean uploading a 1,075-row CSV to a Worker to hand it back to the database it
 * came from.
 */
export const seriesRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('read'))

  /** Every series, with its gaps worked out. Counted live, never cached. */
  .get('/', async (c) => c.json(await listSeries(c.env.DB, c.get('user').id)))

  /**
   * One series, with the ladder the page draws.
   *
   * The name is the id, URL-encoded. It is what `work.series` stores and what
   * `series_volume.series` joins on; minting a surrogate key for it would mean a
   * third place the two spellings could drift apart.
   */
  .get('/:name', async (c) => {
    const name = decodeURIComponent(c.req.param('name'));
    const report = await getSeriesReport(c.env.DB, c.get('user').id, name);
    if (!report) return c.json({ error: 'not_found' }, 404);
    return c.json(report);
  })

  /**
   * "This series has a book 14, and here is how I know."
   *
   * The hand-entry path, and the reason the feature is not hostage to an API.
   * Half this library is absent from Open Library (isbn-ladder.md §4.2) and 12
   * of 25 series are absent from the sibling catalog, so for those series a
   * person typing what they know is not a fallback — it is the only rung.
   *
   * Forced to `manual`: whatever the body claims, a volume that arrived through
   * a person's browser was entered by a person. Letting the client name its own
   * source would let a typo wear the audiobook catalog's authority.
   */
  .post('/:name/volumes', requireCapability('editCatalog'), async (c) => {
    const name = decodeURIComponent(c.req.param('name'));
    const parsed = createSeriesVolumeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    await upsertSeriesVolume(c.env.DB, name, { ...parsed.data, source: 'manual' });
    return c.json(await getSeriesReport(c.env.DB, c.get('user').id, name));
  })

  /**
   * Withdraw a hand-entered volume.
   *
   * Scoped to `manual` rows in `@lc/db` — an imported row is marked, never
   * deleted (migration 0003). A 404 here therefore means either "no such row" or
   * "that one came from an import", and both answers are "you cannot delete it".
   */
  .delete('/:name/volumes/:id', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);
    const ok = await deleteManualSeriesVolume(c.env.DB, id);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    const name = decodeURIComponent(c.req.param('name'));
    return c.json(await getSeriesReport(c.env.DB, c.get('user').id, name));
  })

  /**
   * "This series is N books long, and here is the source."
   *
   * ⚠️ The only way a total can ever enter this system, and it costs a source
   * string to say it — `setSeriesTotalSchema` refuses the number without one.
   * That refusal is the feature: with no total the app says "10 of at least 16",
   * which is what the evidence supports, and this is the single endpoint that
   * can upgrade that sentence to a claim about the whole series.
   *
   * `knownTotal: null` withdraws it and clears the source with it.
   */
  .put('/:name/total', requireCapability('editCatalog'), async (c) => {
    const name = decodeURIComponent(c.req.param('name'));
    const parsed = setSeriesTotalSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    await setSeriesTotal(
      c.env.DB,
      name,
      parsed.data.knownTotal,
      parsed.data.knownTotalSource ?? null,
      parsed.data.note ?? null,
    );
    return c.json(await getSeriesReport(c.env.DB, c.get('user').id, name));
  })

  /**
   * "I am never buying that one." — migration 0081.
   *
   * ⚠️ Deliberately NOT `/api/works/:id/gap-verdicts`, which is the other half of
   * this idea and cannot serve here. That one is keyed `(work_id, field)` and
   * answers "this book we own has no series"; a series gap has no work row at
   * all — that is what makes it a gap — so the key has to be the series and the
   * number, which is the only thing a rung is guaranteed to have.
   *
   * ⚠️ Unlike every other write in this file it costs no *source*, because it is
   * a decision rather than a claim: the owner is the only authority on what the
   * owner intends to buy. `skipSeriesGapSchema` still requires a `reason`, for a
   * different job — see its header.
   *
   * An upsert, so re-recording it with a better reason is this same request.
   */
  .post('/:name/skips', requireCapability('editCatalog'), async (c) => {
    const name = decodeURIComponent(c.req.param('name'));
    const parsed = skipSeriesGapSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    await skipSeriesGap(
      c.env.DB,
      name,
      parsed.data.indexSort,
      parsed.data.reason,
      parsed.data.note ?? null,
      c.get('user').id,
    );
    return c.json(await getSeriesReport(c.env.DB, c.get('user').id, name));
  })

  /**
   * Change your mind — the rung goes back to being missing.
   *
   * The index is in the path and it is a decimal: the three shorts this was
   * built for are 6.5, 11.5 and 13.5. `Number.isFinite` and not `isInteger`.
   */
  .delete('/:name/skips/:index', requireCapability('editCatalog'), async (c) => {
    const index = Number(c.req.param('index'));
    if (!Number.isFinite(index)) return c.json({ error: 'bad_request' }, 400);
    const name = decodeURIComponent(c.req.param('name'));
    const ok = await unskipSeriesGap(c.env.DB, name, index);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json(await getSeriesReport(c.env.DB, c.get('user').id, name));
  });
