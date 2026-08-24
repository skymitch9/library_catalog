import { Hono } from 'hono';
import {
  confirmAudioSeriesSchema,
  createSeriesVolumeSchema,
  setSeriesTotalSchema,
  skipSeriesGapSchema,
} from '@lc/core';
import {
  audioSeriesCandidates,
  confirmAudioSeries,
  deleteManualSeriesVolume,
  getSeriesReport,
  listSeries,
  setSeriesTotal,
  skipSeriesGap,
  suggestSeriesNames,
  unconfirmAudioSeries,
  unskipSeriesGap,
  upsertSeriesVolume,
} from '@lc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';
import { ResearchError, runSeriesScan } from '../lib/series-scan.js';

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
   * Autocomplete for the editor's series field — distinct names from our own
   * `work.series` and the audiobook catalog's `audiobook_series_holding.series`,
   * each tagged with where it came from. Static path, declared before `/:name`
   * so "suggest" is never read as a series name.
   *
   * Read-only; `q` is a substring. Typing an EXISTING name is what groups a work
   * with the rest of its series, and seeing an `audiobook`-tagged name is the cue
   * that a confirmable audio equivalence exists.
   */
  .get('/suggest', async (c) => {
    const q = c.req.query('q') ?? '';
    return c.json({ suggestions: await suggestSeriesNames(c.env.DB, q) });
  })

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

    // Enrich gap rungs with peer holdings (migration 0370).
    // A gap rung is one with workId === null and wanted === false.
    const gapIndices = report.ladder
      .filter((r) => r.workId === null && !r.wanted)
      .map((r) => r.index);

    let peerHoldings: Array<{
      work_key: string;
      peer_id: string;
      peer_label: string;
      title: string | null;
      cover_url: string | null;
      detail_url: string | null;
      formats: string | null;
      series_index: number | null;
    }> = [];

    if (gapIndices.length > 0) {
      // Query peer_holding by series name + matching indices
      const placeholders = gapIndices.map(() => '?').join(',');
      const { results } = await c.env.DB.prepare(
        `SELECT work_key, peer_id, peer_label, title, cover_url, detail_url, formats, series_index
         FROM peer_holding
         WHERE series = ? AND series_index IN (${placeholders})`
      ).bind(name, ...gapIndices).all();
      peerHoldings = (results ?? []) as typeof peerHoldings;
    }

    // Group by series_index for fast lookup
    const peerByIndex = new Map<number, typeof peerHoldings>();
    for (const ph of peerHoldings) {
      if (ph.series_index === null) continue;
      const existing = peerByIndex.get(ph.series_index) ?? [];
      existing.push(ph);
      peerByIndex.set(ph.series_index, existing);
    }

    // Attach peer info to each gap rung
    const enrichedLadder = report.ladder.map((entry) => {
      if (entry.workId !== null || entry.wanted) return entry;
      const peers = peerByIndex.get(entry.index);
      if (!peers || peers.length === 0) return entry;
      return {
        ...entry,
        peerHoldings: peers.map((p) => ({
          peerId: p.peer_id,
          peerLabel: p.peer_label,
          title: p.title,
          coverUrl: p.cover_url,
          detailUrl: p.detail_url,
          formats: p.formats,
        })),
      };
    });

    return c.json({
      ...report,
      ladder: enrichedLadder,
      configured: Boolean(c.env.ANTHROPIC_API_KEY),
    });
  })

  /**
   * Research this series' complete volume list on the open web, and write down
   * what a source says. Costs money; same gate as `POST /works/:id/run`.
   *
   * ⚠️ Unlike that route this is NOT auto-apply in the sense `research-run.ts`
   * means it — nothing here touches `work`. It writes `series_volume` and
   * `series_check` rows exactly as `upsertSeriesVolume`/`recordSeriesCheck`
   * already do for the audiobook-catalog import; see `lib/series-scan.ts` for
   * why that is a difference in KIND from auto-apply, not merely in degree.
   *
   * Re-running is allowed and expected — a series bought into further, or a
   * publisher page that changes, is exactly what "scan again" is for. Every
   * upsert stamps a fresh `last_seen_at`/`checked_at`; nothing here can touch a
   * `manual` row's `source`, per `upsertSeriesVolume`'s own rule.
   */
  .post('/:name/scan', requireCapability('runResearch'), async (c) => {
    const name = decodeURIComponent(c.req.param('name'));

    // Checked before any work happens, exactly as `/works/:id/run` does — a
    // missing key is a misconfiguration to report, not a scan that ran and
    // failed.
    if (!c.env.ANTHROPIC_API_KEY) {
      return c.json(
        {
          error: 'not_configured',
          detail:
            'No Anthropic API key. Put ANTHROPIC_API_KEY in apps/worker/.dev.vars, then `npm run secrets:push`.',
        },
        503,
      );
    }

    const user = c.get('user');
    try {
      const work = runSeriesScan(c.env, user.id, name);
      // Registered AND awaited — see `lib/series-scan.ts`'s header for why both.
      c.executionCtx.waitUntil(work);
      const outcome = await work;

      return c.json({
        // ⚠️ `configured` stamped here too, exactly as the GET handler stamps
        // it — this response is what `onScanned` feeds straight into the
        // page's state, and without this the button's own successful run
        // would make itself look unconfigured on the very next render.
        report: outcome.report ? { ...outcome.report, configured: true } : null,
        identified: outcome.identified,
        volumesWritten: outcome.volumesWritten,
        note: outcome.note,
        estimatedCents: outcome.estimatedCents,
      });
    } catch (err) {
      if (err instanceof ResearchError) {
        return c.json({ error: 'research_failed', detail: err.message }, err.status as 400 | 422 | 502 | 503 | 504);
      }
      throw err;
    }
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
   * "I am never buying that one." — migration 0100.
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
  })

  /**
   * "That IS the same series — I own those on audio." — migration 0110.
   *
   * ⚠️ The one write in this file that asserts something checkable **and takes
   * the owner's word for it**, and the reason it is allowed is that no automatic
   * rule can reach the answer. `series_matched_via = 'work_match'` needs a volume
   * present in *both* catalogs agreeing on its number, and the whole purpose of
   * `audiobook_series_holding` is the volumes they do not share — so the series
   * that most need the answer are structurally the least able to earn it. Both
   * hedged series measured on 2026-08-12 had an empty overlap.
   *
   * ⚠️ It does NOT become `work_match`. `AudioSeriesMatch` gains `'owner'`, the
   * rung leaves the missing count, and `gapAudioLabel` says who settled it — the
   * standing rule that a claim the app cannot evidence must look different from
   * one it can.
   *
   * ⚠️ The body's `audiobookSeries` is checked against a live rung and a mapping
   * no rung carries is a 404. Without that this endpoint would unhedge books
   * against a series name the sibling catalog has never used.
   */
  /**
   * What the editor's audio-equivalence control needs for one series: the works
   * it would fold across, the audiobook-series it can be linked to (exactly the
   * mappings `POST /audio-link` will accept), and the current link if any.
   *
   * `read`, like the rest of this file's GETs — it exposes no more than the
   * series page already does, and it is what lets the editor say "this links all
   * N books" before the owner commits.
   */
  .get('/:name/audio-candidates', async (c) => {
    const name = decodeURIComponent(c.req.param('name'));
    return c.json(await audioSeriesCandidates(c.env.DB, name));
  })

  .post('/:name/audio-link', requireCapability('editCatalog'), async (c) => {
    const name = decodeURIComponent(c.req.param('name'));
    const parsed = confirmAudioSeriesSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    const ok = await confirmAudioSeries(
      c.env.DB,
      name,
      parsed.data.audiobookSeries,
      parsed.data.note ?? null,
      c.get('user').id,
    );
    if (!ok) return c.json({ error: 'not_found', detail: 'no live audio rung for that mapping' }, 404);
    return c.json(await getSeriesReport(c.env.DB, c.get('user').id, name));
  })

  /** Withdraw it — every rung it was holding up goes back to being missing. */
  .delete('/:name/audio-link', requireCapability('editCatalog'), async (c) => {
    const name = decodeURIComponent(c.req.param('name'));
    const ok = await unconfirmAudioSeries(c.env.DB, name);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json(await getSeriesReport(c.env.DB, c.get('user').id, name));
  });
