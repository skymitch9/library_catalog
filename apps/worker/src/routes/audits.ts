/**
 * The two standing audits, on demand.
 *
 * | Route | Does |
 * |---|---|
 * | `POST /api/admin/audits/cover-health` | probe this tick's window of cover URLs now |
 * | `GET  /api/admin/audits/cover-health` | what the last run decided |
 * | `POST /api/admin/audits/series-aggregates` | run the bare-series alarm now |
 * | `GET  /api/admin/audits/series-aggregates` | what the last run decided |
 *
 * ## ⚠️ There is no `dryRun` here, and its absence is the point
 *
 * The audiobook sweep's `dryRun` exists because that sweep WRITES: it needed a
 * way to compute a plan and not apply it. **These two audits write nothing,
 * ever** — a POST here is already a rehearsal, and every run of it is safe to
 * repeat. Adding a `dryRun` flag would imply a mode in which they do something
 * else, which would be a lie about a read-only job.
 *
 * ## What the POST returns that the run row does not
 *
 * The **titled list**. `audit_run.detail_json` carries counts and ids only,
 * because `/api/health` reads it back unauthenticated (migration 0480 says so at
 * length). A caller here has proved `manageUsers`, so the response carries the
 * work titles and the reasons — which is the difference between *"14 broken"*
 * and something a person can act on. ⚠️ None of it is persisted.
 *
 * ## Why these live at `/api/admin`
 *
 * Operator verbs, not catalogue reads — the same reasoning the audiobook sweep's
 * routes carry. The `/api/admin` mount already has the estate admin page's CORS
 * allowance and sits behind the blanket `requireAuth`, so a page there can grow
 * a button without inventing a second cross-origin surface for it.
 *
 * There is deliberately **no UI control** yet. Preferring not to render a
 * control somebody cannot use is the estate rule, and a curl-only surface is the
 * honest form of that until somebody asks for a page.
 */

import { Hono } from 'hono';
import { latestAuditRun } from '@lc/db';
import type { AppBindings } from '../env.js';
import { refuseUnlessAdmin } from '../lib/admin-refusal.js';
import { AUDITS_CRON } from '../lib/audit-run.js';
import { describeCoverHealth, runCoverHealthAudit } from '../lib/cover-health-run.js';
import {
  describeSeriesAggregates,
  runSeriesAggregateAudit,
} from '../lib/series-aggregates-run.js';

/**
 * The verdict, in a sentence, for a run read back OUT of the table.
 *
 * ⚠️ Four states somebody will meet wondering whether the audit is working, and
 * they are NOT interchangeable — most of all the first two, which look identical
 * on a status page and mean opposite things.
 */
function describeStoredState(state: string | null, detail: string | null): string {
  switch (state) {
    case 'ok':
      return 'It ran and found nothing. That is the good news, and it is not the same ' +
        'thing as never having run.';
    case 'findings':
      return 'It ran and found something a person should look at. POST to this route to ' +
        'see the list with titles — the stored row carries counts and ids only.';
    case 'failed':
      return `It REFUSED, and that is the safe outcome: ${detail ?? 'no reason was recorded'}. ` +
        'Nothing was measured, so this is not evidence that anything is clean.';
    case 'running':
      return 'A run is in flight, or one was cancelled before it could finish. A row that ' +
        'stays here for hours means the invocation was killed.';
    case null:
    case undefined:
      return `This audit has never run on this instance. It fires on the "${AUDITS_CRON}" ` +
        'cron (daily, 09:47 UTC); until a row exists, the trigger is claimed rather ' +
        'than verified.';
    default:
      return `The last run recorded the state '${state}'.`;
  }
}

function storedDetail(detail: unknown): string | null {
  if (detail && typeof detail === 'object' && 'detail' in detail) {
    const value = (detail as { detail: unknown }).detail;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

export const auditRoutes = new Hono<AppBindings>()
  /**
   * Probe this tick's window of cover URLs now.
   *
   * ⚠️ `trigger: 'admin'` — not cosmetic. It is the only way to tell later
   * whether the CLOCK is firing or a person has been quietly carrying the whole
   * feature, which is the same fact migration 0470 keeps `trigger` for.
   *
   * ⚠️ It uses the SAME per-tick cap as the cron. An admin route that swept the
   * whole catalog would be a second behaviour to reason about and the one most
   * likely to exhaust a subrequest budget — and the window rotates daily, so
   * "audit the rest" is *"run it again tomorrow"*, or the script, which has no
   * cap at all and is the right instrument for a full sweep.
   */
  .post('/audits/cover-health', async (c) => {
    const refusal = refuseUnlessAdmin(c, {
      job: 'Running the cover-health audit',
      reassurance: 'it is a read-only check and it changes nothing in the catalogue.',
    });
    if (refusal) return refusal;

    const result = await runCoverHealthAudit(c.env, { trigger: 'admin' });

    // ⚠️ 200 even for `state: 'failed'`, deliberately — the REQUEST succeeded
    // and the answer is the report. An HTTP error would put "the audit refused"
    // and "the route is broken" in one bucket, which is exactly the distinction
    // the run row exists to keep.
    return c.json({
      ok: result.state !== 'failed',
      audit: result.audit,
      trigger: result.trigger,
      runId: result.runId,
      state: result.state,
      detail: result.detail,
      findings: result.findings,
      /** ⚠️ Titled, live, never persisted. See the file header. */
      rows: result.findingRows.map((f) => ({
        id: f.id,
        title: f.title,
        url: f.url,
        verdict: f.verdict,
        reason: f.reason,
      })),
      says: describeCoverHealth(result),
    });
  })

  .get('/audits/cover-health', async (c) => {
    const refusal = refuseUnlessAdmin(c, {
      job: 'Reading the cover-health audit',
      reassurance: 'it is a read-only check and it changes nothing in the catalogue.',
    });
    if (refusal) return refusal;

    const run = await latestAuditRun(c.env.DB, 'cover-health').catch(() => null);
    return c.json({
      audit: 'cover-health',
      cron: AUDITS_CRON,
      lastRun: run,
      says: describeStoredState(run?.state ?? null, storedDetail(run?.detail)),
    });
  })

  /**
   * Run the bare-series alarm now.
   *
   * Pure D1 — no external call, no cap, no window. The whole catalog every time,
   * which it can afford because the set it looks at is *works with 2+ editions*
   * and that is a few dozen rows.
   */
  .post('/audits/series-aggregates', async (c) => {
    const refusal = refuseUnlessAdmin(c, {
      job: 'Running the series-aggregate alarm',
      reassurance: 'it is a read-only check and it changes nothing in the catalogue.',
    });
    if (refusal) return refusal;

    const result = await runSeriesAggregateAudit(c.env, { trigger: 'admin' });
    return c.json({
      ok: result.state !== 'failed',
      audit: result.audit,
      trigger: result.trigger,
      runId: result.runId,
      state: result.state,
      detail: result.detail,
      findings: result.findings,
      /** ⚠️ Titled, live, never persisted. */
      rows: result.flaggedRows,
      says: describeSeriesAggregates(result, c.env.SITE_ORIGIN ?? 'this instance'),
    });
  })

  .get('/audits/series-aggregates', async (c) => {
    const refusal = refuseUnlessAdmin(c, {
      job: 'Reading the series-aggregate alarm',
      reassurance: 'it is a read-only check and it changes nothing in the catalogue.',
    });
    if (refusal) return refusal;

    const run = await latestAuditRun(c.env.DB, 'series-aggregates').catch(() => null);
    return c.json({
      audit: 'series-aggregates',
      cron: AUDITS_CRON,
      lastRun: run,
      says: describeStoredState(run?.state ?? null, storedDetail(run?.detail)),
    });
  });
