/**
 * The audiobook sweep, on demand — §7.1 of
 * `catalog-platform/docs/info/audiobook-association-route.md`.
 *
 * | Route | Does |
 * |---|---|
 * | `POST /api/admin/audiobooks/sweep` | run it now. Body `{ dryRun?: boolean }` |
 * | `GET  /api/admin/audiobooks/sweep` | what the last run decided |
 *
 * ## ⚠️ `dryRun` is not a convenience — it is the instrument
 *
 * It computes the whole plan and writes nothing, which is the same mechanism
 * shadow mode uses (§8 phase 2) and the ONLY way to answer the phase-1 gate:
 * *does the route's plan on the live snapshot equal the script's plan on the
 * same CSV?* A `POST … {"dryRun":true}` beside `npm run backfill:audiobooks --
 * --remote` is that comparison, and it costs nothing to run wrong.
 *
 * ## ⚠️ Never a bare status
 *
 * The estate rule: a refusal says three things — **what happened**, **what it
 * needs (by name)**, and **how to get it**. `capabilityDenied` in the auth
 * middleware says the first two; this file adds the third, because the person
 * most likely to meet this refusal is a household member who pressed something
 * on an admin page and has no idea `manageUsers` is a word. The four causes stay
 * distinct — not signed in / awaiting approval / insufficient role / revoked —
 * because their fixes differ, and `requireAuth` upstream already separates the
 * first from the rest.
 *
 * There is deliberately **no UI control** for these routes yet. Preferring not
 * to render a control somebody cannot use is the estate rule; a curl-only
 * surface is the honest form of that while the whole feature is in shadow.
 *
 * ## Why these live at `/api/admin` rather than beside `/api/series`
 *
 * They are operator verbs, not catalogue reads: one starts a job that can write
 * across the whole catalogue, and the other reports on a background process.
 * The `/api/admin` mount already carries the cross-origin allowance for the
 * estate's one admin page and sits behind the blanket `requireAuth`, so a page
 * there can grow a button without a second CORS surface being invented for it.
 */

import { Hono, type Context } from 'hono';
import { audiobookHoldingCounts, latestAudiobookSweepRun, readAudiobookSnapshot } from '@lc/db';
import type { AppBindings } from '../env.js';
import { refuseUnlessAdmin as refuseUnlessAdminWith } from '../lib/admin-refusal.js';
import { audiobookSweepMode, runAudiobookSweep } from '../lib/audiobook-sweep-run.js';

/**
 * The gate, worded.
 *
 * `manageUsers` is the library's owner-or-admin capability and therefore what
 * "admin" means in §7.1. It is checked by name rather than by role so that
 * adding a role later does not mean auditing this route — the same reasoning
 * `requireCapability` carries.
 *
 * ⚠️ **The BODY of this moved to `lib/admin-refusal.ts` on 2026-09-06**, when
 * the two standing audits gained admin routes and would otherwise have carried
 * a second and third copy of it. The wording below is unchanged, character for
 * character, and `audiobook-sweep.test.ts` still pins it; what changed is that
 * there is now one implementation of *"what a refused operator verb says"*
 * rather than one per route file.
 */
export function refuseUnlessAdmin(c: Context<AppBindings>) {
  return refuseUnlessAdminWith(c, {
    job: 'Running the audiobook sweep',
    reassurance:
      'it is a background job and there is nothing to see on a page.',
  });
}

export const audiobookSweepRoutes = new Hono<AppBindings>()
  /**
   * Run it now.
   *
   * ⚠️ `trigger: 'admin'` — which is not cosmetic. §6.3 keeps the trigger on
   * every audit row precisely because it is the only way to tell later whether
   * the on-add hook is working or the cron (or a person) is quietly carrying the
   * whole feature.
   *
   * ⚠️ `scope: { kind: 'all' }`. This route is a FULL sweep and may therefore
   * mark rows stale — it has looked at the whole catalogue, so a row it did not
   * reproduce is genuinely gone. The on-add hook's scoped run is the other case
   * and it stales nothing (§6.2 guard 3).
   *
   * It cannot throw: `runAudiobookSweep` never rejects, so there is no failure
   * shape here that could reach `app.onError` and answer a bare 500.
   */
  .post('/audiobooks/sweep', async (c) => {
    const refusal = refuseUnlessAdmin(c);
    if (refusal) return refusal;

    const body = (await c.req.json().catch(() => null)) as { dryRun?: unknown } | null;
    // ⚠️ Anything but an explicit `true` is a real run — a typo in the body must
    // never silently turn a requested write into a rehearsal, and the reverse
    // (a rehearsal read as a write) is the direction that can damage. So the
    // parse is strict and the default is the safe-to-repeat one only when asked.
    const dryRun = body?.dryRun === true;

    const result = await runAudiobookSweep(c.env, { trigger: 'admin', dryRun });

    // ⚠️ 200 even for `state: 'failed'`, deliberately. The REQUEST succeeded and
    // the answer is the report; an HTTP error here would put a refused sweep and
    // a broken route in the same bucket, which is exactly the distinction §6.2's
    // run rows exist to keep. The state word is the verdict, in the body, where
    // a person can read it.
    return c.json({
      ok: result.state !== 'failed',
      ...result,
      // Said in words, so a reader never has to know the vocabulary.
      says: describeState(result.state, result.detail),
    });
  })

  /**
   * What happened last time, and what the catalogue holds now.
   *
   * The same facts `/api/health` publishes, plus the run's own detail — health
   * is the unauthenticated summary and this is the operator's full view. One
   * fact, one home: both read `audiobook_sweep_run`, and neither computes a
   * number the other does not.
   */
  .get('/audiobooks/sweep', async (c) => {
    const refusal = refuseUnlessAdmin(c);
    if (refusal) return refusal;

    const [run, snapshot, counts] = await Promise.all([
      latestAudiobookSweepRun(c.env.DB),
      readAudiobookSnapshot(c.env.DB),
      audiobookHoldingCounts(c.env.DB),
    ]);

    return c.json({
      mode: audiobookSweepMode(c.env),
      lastRun: run,
      snapshot,
      holdings: counts,
      says: run
        ? describeState(run.state, describeDetail(run.detail))
        : 'The sweep has never run on this instance. Until it does, audiobook ' +
          'associations come only from the audiobook pipeline’s STEP 11.',
    });
  });

function describeDetail(detail: unknown): string | null {
  if (detail && typeof detail === 'object' && 'detail' in detail) {
    const value = (detail as { detail: unknown }).detail;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

/**
 * The verdict, in a sentence.
 *
 * ⚠️ Every one of these is a state somebody will meet at three in the morning
 * wondering why a book has no audio chip, and the five silences are NOT
 * interchangeable: a refused fetch, a 304, an in-sync catalogue and a switch
 * left off all look identical from the holding table.
 */
function describeState(state: string, detail: string | null): string {
  switch (state) {
    case 'applied':
      return 'The sweep ran and updated the catalogue.';
    case 'in-sync':
      return 'The sweep ran and found nothing to change — the catalogue already agreed ' +
        'with the audiobook catalog.';
    case 'shadow':
      return 'The sweep computed the whole plan and wrote nothing. That is shadow mode ' +
        '(or a dry run): the plan is recorded so it can be compared against the script ' +
        'before anything is allowed to write.';
    case 'skipped':
      return detail === 'unchanged'
        ? 'Nothing was done because the audiobook catalog has not changed since the last ' +
          'time it was read.'
        : detail === 'mode off'
          ? 'The sweep is switched off on this instance (AUDIOBOOK_SWEEP_MODE), so nothing ' +
            'ran and nothing was written.'
          : `Nothing was done: ${detail ?? 'no reason was recorded'}.`;
    case 'failed':
      return `The sweep refused to write, and that is the safe outcome: ${detail ?? 'no reason was recorded'}. ` +
        'Nothing in the catalogue was changed.';
    case 'running':
      return 'A run is in flight, or one was cancelled before it could finish.';
    default:
      return `The last run recorded the state '${state}'.`;
  }
}
