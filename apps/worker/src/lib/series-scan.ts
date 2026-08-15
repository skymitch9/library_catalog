/**
 * Running a per-series scan, and writing what it found the way `completeness.ts`
 * already expects to be fed.
 *
 * ## ⚠️ This does not follow `research-run.ts`'s auto-apply
 *
 * `research-run.ts` writes a proposed value straight into `work` because the
 * owner explicitly traded away reading each one — see that file's header for the
 * argument. Nothing here does that, and the difference is not an oversight: what
 * a series scan writes is `series_volume` and `series_check`, which are already
 * the "informing, not deciding" tables — `completeness.ts`'s header spends its
 * whole length on the rule that a claim like "this series has 12 books" may only
 * ever be attested, never invented, and is a lower bound until a person types a
 * total with a source. Writing an attested row here is the SAME kind of write
 * `upsertSeriesVolume` already makes for the audiobook-catalog import; a scan is
 * just a fourth source for it (migration 0200). Nothing here creates a `work`
 * row, changes a gap's verdict, or puts anything on a wishlist — the owner still
 * does all three, from the rungs this produces.
 *
 * ## Where the work runs
 *
 * Same shape as `runDetailsResearch`: the route awaits this promise AND hands it
 * to `executionCtx.waitUntil`, so a scan slower than ~30s survives Cloudflare's
 * silent `waitUntil` cutoff. See that file's header for the full argument; it is
 * not repeated here because it is not specific to series.
 */

import {
  getSeriesReport,
  recordSeriesCheck,
  upsertSeriesVolume,
  type SeriesReport,
} from '@lc/db';
import { ResearchError, estimateCents, researchSeriesVolumes, type Usage } from '@lc/research';
import type { Env } from '../env.js';

export interface SeriesScanOutcome {
  /** Null only when the series has nothing catalogued and the scan found nothing either. */
  report: SeriesReport | null;
  identified: boolean;
  /** Rows written to `series_volume` — not the same as how many the model reported; see `runSeriesScan`. */
  volumesWritten: number;
  /** The caveat shown beside the check, if any — see `checkNote` in `@lc/core`. */
  note: string | null;
  usage: Usage;
  estimatedCents: number;
}

/** A plain number, string or not. Unlike `asYear` in `research-run.ts` this keeps decimals — 2.5 is a real volume. */
function asIndex(raw: string): number | null {
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

/** Four digits, or null. Same bounds as the CHECK migration 0200 put on the column, so a rejected value here never reaches the database as a silent failure. */
function asYear(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).trim());
  return Number.isInteger(n) && n >= 1000 && n <= 2200 ? n : null;
}

/**
 * Scan one series against the open web, and write down what a source actually
 * says.
 *
 * ⚠️ No concurrency guard, unlike `claimRun`'s `research_run`-backed one.
 * `series_check` has no status column to hold a "running" state, and adding one
 * for this alone would be the migration this feature is trying to keep minimal.
 * The button disables itself for the duration of the request instead — the same
 * guard every other write on this page already relies on (`skipSeriesGap`,
 * `confirmAudioSeries`), none of which has a server-side lock either.
 */
export async function runSeriesScan(
  env: Env,
  readerId: number,
  series: string,
): Promise<SeriesScanOutcome> {
  const before = await getSeriesReport(env.DB, readerId, series);

  const known = (before?.ladder ?? [])
    .map((v) => ({ index: v.index, display: v.display, title: v.title }))
    .sort((a, b) => a.index - b.index);
  const authors = (before?.ladder ?? []).map((v) => v.authors).find((a): a is string => Boolean(a)) ?? null;

  const { answer, usage } = await researchSeriesVolumes(env.ANTHROPIC_API_KEY, {
    series,
    authors,
    known,
  });

  // ⚠️ Nothing is written unless the series was actually identified. An
  // unidentified answer's `volumes` is supposed to be empty already (the system
  // prompt says so), but this does not trust that — the one thing worse than no
  // list is a list attached to the wrong series entirely.
  let volumesWritten = 0;
  if (answer.identified) {
    for (const v of answer.volumes) {
      const index = asIndex(v.index);
      const title = v.title.trim();
      // A rung with no number, or no title, is not a finding — see
      // `details.ts`'s equivalent refusal for a blank "found". Silently
      // skipped rather than thrown: one bad row from a long list should not
      // cost the rest of it.
      if (index == null || title === '') continue;
      await upsertSeriesVolume(env.DB, series, {
        indexSort: index,
        indexDisplay: v.display,
        title,
        authors: v.authors?.trim() || null,
        year: asYear(v.year),
        source: 'claude_research',
        sourceUrl: v.sourceUrl,
        note: v.note,
      });
      volumesWritten += 1;
    }
  }

  // ⚠️ Prose only — see `checkNote`'s header in `@lc/core` for why nothing here
  // may feed the arithmetic. This is what turns "openEnded: true" from a flag a
  // person would have to go find into a sentence they are shown.
  const noteParts: string[] = [];
  if (!answer.identified) {
    noteParts.push(answer.note ?? 'Could not confidently identify this series.');
  } else {
    if (answer.openEnded) {
      noteParts.push(
        'The source describes this as an open-ended run — treat this as what is known, not a total.',
      );
    }
    if (answer.note) noteParts.push(answer.note);
  }
  const note = noteParts.length > 0 ? noteParts.join(' ') : null;

  await recordSeriesCheck(
    env.DB,
    series,
    'claude_research',
    answer.identified ? 'ok' : 'not_found',
    volumesWritten,
    note,
  );

  const report = await getSeriesReport(env.DB, readerId, series);

  return {
    report,
    identified: answer.identified,
    volumesWritten,
    note,
    usage,
    estimatedCents: estimateCents(usage.inputTokens, usage.outputTokens),
  };
}

export { ResearchError };
