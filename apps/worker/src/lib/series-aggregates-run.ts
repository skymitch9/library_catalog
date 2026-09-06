/**
 * One series-aggregate tick — what the cron and the admin route both call.
 *
 * Platform inventory §7 row **#5**, and its reason is the sharpest one in that
 * document: *"a **standing alarm** with no clock is the exact failure this ask
 * is about."* `scripts/audit-series-aggregates.mjs` called itself the standing
 * alarm for tier 3 of the bare-series-name rule and had no cadence at all —
 * nothing ran it, nothing noticed that nothing ran it, and the set it watches
 * has been empty in production since the night it was written, which is
 * indistinguishable from an alarm that was never armed.
 *
 * ## What it looks for
 *
 * Any work whose title equals a known series name AND which carries two or more
 * editions. That is the signature the 2026-08-13 corruption wore: a scanned
 * barcode resolved to an Open Library record titled bare *Space Knight*, and the
 * phantom work it minted absorbed six editions with six unrelated ISBNs and six
 * copies (works #300–#302, cleaned up by hand that night).
 *
 * ⚠️ **A hit is a QUESTION, not a defect.** *The Wandering Inn* is legitimately
 * titled with its series name and legitimately owned in two printings. This
 * audit writes NOTHING and nothing downstream may auto-act on its list; it
 * exists so the question gets asked.
 *
 * ## ⚠️ It makes NO external call — which is why it shares the cover audit's cron
 *
 * The platform inventory's row for this script says *"D1 + **HTTP** (Open
 * Library)"*. **Measured 2026-09-06: that is wrong.** The script imports
 * `foldSeriesNames`/`isBareSeriesTitle` from `@lc/core` and `query` from
 * `scripts/lib/d1.mjs`, and makes no network call of any kind — the Open Library
 * connection is in what the alarm is ABOUT (an OL work-level aggregate), not in
 * how it looks. So this runner spends zero subrequests, which is half the reason
 * the two audits can share one invocation without competing for a budget.
 */

import {
  auditSeriesAggregates,
  formatSeriesAggregateReport,
  type SeriesAggregateWork,
} from '@lc/core';
import { readSeriesAggregateInputs } from '@lc/db';
import type { Env } from '../env.js';
import { recordAuditRun, type AuditRunResult } from './audit-run.js';

/**
 * What the run row and `/api/health` carry.
 *
 * ⚠️ **Counts and ids, never a title and never an author.** `audit_run.detail_json`
 * is read back by `/api/health`, which is unauthenticated on purpose — and a
 * flagged row's title is, by construction, a series the household owns. The
 * admin route returns the titled list live, behind `manageUsers`, and stores
 * none of it.
 */
export interface SeriesAggregateAuditFindings {
  /** Distinct folded series names the catalog knows — the fold's own health check. */
  seriesKeys: number;
  /** Works carrying 2+ editions at all. The denominator. */
  multiEditionWorks: number;
  /** The subset whose title IS a bare series name. **This is the alarm.** */
  flagged: number;
  /** Every flagged work id — the list is expected to be EMPTY, so it is not truncated. */
  flaggedIds: number[];
}

export interface SeriesAggregateRunResult
  extends AuditRunResult<SeriesAggregateAuditFindings> {
  /**
   * The full titled list — for the ADMIN ROUTE's response only. Never persisted
   * and never on `/api/health`.
   */
  flaggedRows: SeriesAggregateWork[];
}

/**
 * One tick. **Never rejects** — the returned result is the whole report.
 */
export async function runSeriesAggregateAudit(
  env: Env,
  opts: { trigger: 'cron' | 'admin' },
): Promise<SeriesAggregateRunResult> {
  let flaggedRows: SeriesAggregateWork[] = [];

  const result = await recordAuditRun<SeriesAggregateAuditFindings>(
    env,
    'series-aggregates',
    opts.trigger,
    async () => {
      let inputs;
      try {
        inputs = await readSeriesAggregateInputs(env.DB);
      } catch (err) {
        return {
          state: 'failed' as const,
          detail: `read failed: ${err instanceof Error ? err.message : String(err)}`,
          findings: null,
        };
      }

      // ⚠️ **Guard: a zero-works read is a REFUSED run, not a clean catalog** —
      // the AUDIO-B precedent, and the shape phase 0 actually measured (a
      // `--remote` run returning `0 work(s)` and exiting 0). ⚠️ Note the
      // denominator this guard uses: `totalWorks`, not `works.length`. A catalog
      // with zero works carrying 2+ editions is a genuinely CLEAN answer and
      // must report `ok`; a catalog with zero works at all is a read that did
      // not happen.
      if (inputs.totalWorks === 0) {
        return { state: 'failed' as const, detail: 'empty-read', findings: null };
      }

      const audit = auditSeriesAggregates({
        seriesNames: inputs.seriesNames,
        works: inputs.works,
      });
      flaggedRows = audit.flagged;

      const findings: SeriesAggregateAuditFindings = {
        seriesKeys: audit.seriesKeys,
        multiEditionWorks: audit.multiEditionWorks,
        flagged: audit.flagged.length,
        flaggedIds: audit.flagged.map((w) => w.id),
      };

      return {
        state: audit.flagged.length > 0 ? ('findings' as const) : ('ok' as const),
        detail: null,
        findings,
      };
    },
  );

  return { ...result, flaggedRows };
}

/**
 * The verdict in words, plus the script's own report text when there is
 * something to say.
 *
 * ⚠️ The SAME formatter the script calls, so an operator comparing the route's
 * answer to `npm run audit:series-aggregates -- --remote` is comparing text
 * produced by one function rather than two that look alike.
 */
export function describeSeriesAggregates(
  result: SeriesAggregateRunResult,
  where: string,
): string {
  if (result.state === 'failed') {
    return (
      `The series-aggregate alarm refused to report, and that is the safe outcome: ` +
      `${result.detail ?? 'no reason was recorded'}. Nothing was measured, so this is NOT ` +
      `evidence that the catalog is clean.`
    );
  }
  const f = result.findings;
  if (!f) return 'The series-aggregate alarm ran but recorded no counts.';
  const report = formatSeriesAggregateReport(
    {
      seriesKeys: f.seriesKeys,
      multiEditionWorks: f.multiEditionWorks,
      flagged: result.flaggedRows,
    },
    where,
  );
  if (result.state === 'ok') {
    return `${report}\n\nThat is the expected answer — this set has been empty in production since the 2026-08-13 cleanup.`;
  }
  return (
    `${report}\n\n⚠️ Each row is either the Open Library work-level aggregate bug recurring ` +
    `or a real multi-printing volume 1. Nothing has been changed and nothing will be: a ` +
    `person decides.`
  );
}
