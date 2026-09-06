/**
 * One audiobook-association tick — the thing the cron, the admin route and the
 * on-add hook all call.
 *
 * Step 8 of `catalog-platform/docs/info/audiobook-association-route.md` §9.
 * The DECISIONS are `planAudiobookSweep` in `@lc/core` and the WRITES are
 * `applyAudiobookSweepPlan` in `@lc/db`; what lives here is everything between
 * them that a script never needed — the fetch, the guards, the run row, and the
 * mode ladder.
 *
 * ## 🔴 Why the guards, and why they are not "defensive programming"
 *
 * The sweep's stale phase marks every holding it did not reproduce. In a script
 * that is safe, because a missing file makes the script exit 1 in front of the
 * person who started it. **A Worker's failure mode is worse than a missing file,
 * because it looks like success**: a Pages deploy mid-flight, a truncated body,
 * or an origin error page served with a `200` each yields a parse that "worked"
 * and returned few or zero rows — and the sweep would then mark EVERY holding in
 * the catalog stale, on both instances, with nobody watching (§6.2).
 *
 * | # | Guard | Rule |
 * |---|---|---|
 * | 1 | **Zero audiobook rows** | abort, `failed: empty snapshot`, write nothing. The script's own check, ported exactly. Also the index Worker's rule: *"zero rows is a failed export, not an empty catalog"* |
 * | 2 | **Mass drift** | more than **3%** fewer rows than the last successful fetch aborts with `failed: drift` and BOTH numbers. Precedent: `drive_role_parity.py`'s `MASS_DRIFT_CAP=3`. A catalog does not lose 3% of its rows between ticks; a broken fetch does |
 * | 3 | **A scoped run stales nothing** | enforced in the planner as a TYPE, not here — `scope: { kind: 'works' }` produces zero stale entries and `packages/core/test/audiobook-sweep-scope.test.ts` pins it |
 * | 4 | **Zero WORKS read** | abort, `failed: empty-read`. ⚠️ Not in §6.2 — added because phase 0 measured it: one `--remote` run returned `0 work(s) in the REMOTE database` and **exited 0**, wrangler handing back an empty result set with no error. Re-running gave the full 411. In a Worker the same empty read reaches the stale sweep with nothing to reproduce, which is guard 1's disaster arriving through the other door |
 *
 * ⚠️ **The snapshot is written only AFTER the guards pass.** A snapshot written
 * from a refused fetch would poison the drift baseline: the next tick would
 * compare against the broken number, find no drift, and sail through. Guard 2
 * would have destroyed itself on first use.
 *
 * ## ⚠️ It never throws — and that is a promise to `scheduled()`
 *
 * A scheduled invocation has no user and no response to put an error in, and
 * (measured in the sibling project 2026-08-13) a scheduled Worker's logs
 * defeated three separate `wrangler tail` attempts. Every failure is folded into
 * the returned result AND into the `audiobook_sweep_run` row, which is the
 * surface `/api/health` reads. A refused run is still a run and still gets a
 * row: *"the sweep did nothing because the fetch came back with 40 rows"* and
 * *"the sweep has not fired at all"* are different facts with different fixes.
 *
 * ## ⚠️ Where this DEVIATES from the design, stated out loud
 *
 * §3.3 says the on-add hook *"must never fetch 1.4 MB — it reads the cached
 * snapshot, and if there is none it records `deferred: no snapshot`"*, and §4.3
 * prices the per-work path at *"no external call at all when the snapshot is
 * warm"*. **Both sentences assume the parsed ROWS are cached somewhere, and
 * migration 0470 caches only the `etag`, the `fetched_at` and the `row_count`**
 * — which is exactly what step 6 of §9 specifies. There is no row store, so
 * there is nothing warm to read.
 *
 * The choice made here, and why: **the scoped run fetches, conditionally, like
 * the cron does.** §4.3's objection to fetching was that it would slow the add;
 * `ctx.waitUntil` already answers that, because the person's response has gone
 * out before any of this starts. What is genuinely spent is one 1.4 MB GET per
 * book added — and books are added a handful of times a day, against a cron that
 * fetches six times a day regardless. Paying that to close the owner's *"it
 * didn't associate right away"* is the trade the whole route exists to make.
 *
 * 🔴 **The follow-up this leaves open:** a KV row cache would make the hook free
 * and is what the design assumed. It is deliberately NOT built here — a new
 * binding on both instances is its own change, and shadow mode must land first.
 */

import {
  groupWorkAliases,
  parseAudiobookCsv,
  planAudiobookSweep,
  type SweepPlan,
  type SweepScope,
} from '@lc/core';
import {
  applyAudiobookSweepPlan,
  finishAudiobookSweepRun,
  readAudiobookSnapshot,
  readAudiobookSweepInputs,
  saveAudiobookSnapshot,
  startAudiobookSweepRun,
  type AudiobookSweepTrigger,
} from '@lc/db';
import { canonicalSeries, seriesCanonEntryCount } from '@lc/universes';
import type { Env } from '../env.js';

/**
 * ⚠️ Must match `wrangler.toml`'s `crons` entry in BOTH `[triggers]` blocks
 * EXACTLY — `scheduled()` dispatches on the string and does nothing for one it
 * does not know, so a drift makes the sweep stop firing while both files still
 * look correct. `audiobook-cron.test.ts` reads the toml and proves it.
 *
 * **Four-hourly, not hourly**: the sibling catalog's CSV changes ≈3×/day, so an
 * hourly tick would conditional-GET 24 times for three real changes. Six ticks
 * comfortably cover three writes.
 *
 * **Minute 23**, and neither `:00` nor `:07`. Not `:00` because the whole world
 * fires there (the details sweep's own comment says so); not `:07` because that
 * is where the details sweep already lives, and the games repo records that two
 * cron invocations in the same minute compete for the same subrequest budget.
 */
export const AUDIOBOOK_SWEEP_CRON = '23 */4 * * *';

/**
 * Where the sibling catalog publishes itself.
 *
 * The same file as `audiobook_catalog/site/catalog.csv` — measured 2026-09-05,
 * the live bytes equal the disk bytes apart from line endings, and the shared
 * parser skips `\r`, so **the script and the route see identical rows over both
 * transports**. That equality is what makes "one canonical implementation" true
 * rather than aspirational (§3.2).
 *
 * ⚠️ Deliberately NOT the index Worker, which really does hold audiobook rows:
 * its push schema is `.strict()` and carries **no narrator and no
 * `series_index_display`** by POLICY (*"ownership does not travel"*), and using
 * it would mean widening the estate's default-deny privacy projection to solve
 * a plumbing problem. §3.1 has the full three reasons.
 */
export const AUDIOBOOK_CSV_URL = 'https://audiobooks.heygabi.ai/catalog.csv';

/**
 * How far below the last successful row count a fetch may land before it is
 * treated as broken rather than as news. Percent.
 *
 * Borrowed from `drive_role_parity.py`'s `MASS_DRIFT_CAP = 3`, and the reasoning
 * transfers exactly: a curated catalog does not lose 3% of its rows between two
 * ticks four hours apart. A truncated body does.
 */
export const MASS_DRIFT_CAP_PERCENT = 3;

/** How long the origin has to answer before the tick gives up on it. */
const FETCH_TIMEOUT_MS = 20_000;

/**
 * The ladder, per the estate's enforcement rule: off → shadow → enforce, flipped
 * only on measured equality and never as a side effect of an unrelated deploy.
 *
 * - **`off`** — costs nothing and asks nothing. No fetch, no run row.
 * - **`shadow`** — computes the whole plan and **writes nothing** to the holding
 *   tables; the plan's counts land in `audiobook_sweep_run.detail_json`, which
 *   is what makes a shadow tick evidence rather than a no-op. STEP 11 of the
 *   audiobook pipeline is still doing the writing.
 * - **`enforce`** — the plan is applied.
 */
export type AudiobookSweepMode = 'off' | 'shadow' | 'enforce';

/**
 * ⚠️ **Fails CLOSED, unlike `GABI_EDGE` and unlike `BILLING_POLICY`.** An
 * unset, misspelt or unrecognised value resolves to `off`, because the thing on
 * the other side of this switch marks holdings stale across a whole catalog.
 * The billing switch fails open on purpose — its worst case is spending 4¢ — and
 * the reasoning does not transfer to a switch whose worst case is a page telling
 * the owner he does not own books that are in the house.
 */
export function audiobookSweepMode(env: Pick<Env, 'AUDIOBOOK_SWEEP_MODE'>): AudiobookSweepMode {
  const raw = (env.AUDIOBOOK_SWEEP_MODE ?? '').trim().toLowerCase();
  if (raw === 'shadow') return 'shadow';
  if (raw === 'enforce') return 'enforce';
  return 'off';
}

/**
 * What a tick decided.
 *
 * ⚠️ `state` is the vocabulary `audiobook_sweep_run.state` stores, and it is
 * deliberately NOT constrained by a CHECK in the schema — see migration 0470 for
 * why. `detail` carries the WHY in one short phrase, and it is what tells the
 * four different silences apart.
 */
export type SweepRunState = 'applied' | 'shadow' | 'in-sync' | 'skipped' | 'failed';

export interface AudiobookSweepRunResult {
  state: SweepRunState;
  /** One phrase: 'unchanged', 'empty snapshot', 'drift', 'empty-read', 'mode off', … */
  detail: string | null;
  trigger: AudiobookSweepTrigger;
  mode: AudiobookSweepMode;
  /** Null when the tick never opened a run row (mode `off`). */
  runId: number | null;
  /** Counts only — see `planCounts`. Null when no plan was computed. */
  plan: PlanCounts | null;
  /** What was actually written. Null in shadow, in a dry run, and on a refusal. */
  written: { statements: number; transitions: number } | null;
  snapshot: { etag: string | null; rowCount: number } | null;
}

/**
 * The plan, as numbers.
 *
 * 🔴 **Counts and names, never the matched rows themselves.** `detail_json` is
 * read back by `/api/health`, which is unauthenticated on purpose; a shape that
 * carried edition titles would be one careless `...detail` away from publishing
 * what the household listens to. The numbers below are exactly the ones the
 * script's dry run prints, which is what makes the phase-1 gate ("the route's
 * plan equals the script's plan on the same CSV") a comparison somebody can
 * actually do.
 */
export interface PlanCounts {
  workCount: number;
  audiobookCount: number;
  matched: number;
  missed: number;
  byVia: { exact: number; alias: number; containment: number };
  viaAliasCount: number;
  multiEdition: number;
  editionUpserts: number;
  editionStales: number;
  rungUpserts: number;
  rungStales: number;
  seriesWithRungs: number;
  /** Series a SCOPED run declined to write rungs for, by name. Always empty under a full sweep. */
  foldSeriesDeferred: string[];
  /**
   * §2.4's guard: the route's series canon is as fresh as the last DEPLOY while
   * the script's is as fresh as the last `git pull` of catalog-platform, and
   * when they disagree the ROUTE is the stale one. A deploy that shipped an
   * empty canon is then visible in one curl rather than as a page full of
   * `AUDIO?` months later.
   */
  seriesCanonEntries: number;
}

function planCounts(plan: SweepPlan): PlanCounts {
  const r = plan.report;
  return {
    workCount: r.workCount,
    audiobookCount: r.audiobookCount,
    matched: r.matched.length,
    missed: r.missed.length,
    byVia: r.byVia,
    viaAliasCount: r.viaAliasCount,
    multiEdition: r.multiEdition.length,
    editionUpserts: plan.editionUpserts.length,
    editionStales: plan.editionStales.length,
    rungUpserts: plan.rungUpserts.length,
    rungStales: plan.rungStales.length,
    seriesWithRungs: r.rungs.length,
    foldSeriesDeferred: r.foldSeriesDeferred,
    seriesCanonEntries: seriesCanonEntryCount,
  };
}

export interface AudiobookSweepRunOptions {
  trigger: AudiobookSweepTrigger;
  /**
   * 🔴 `{ kind: 'all' }` may only be passed by something that has looked at the
   * whole catalog — the cron and the admin route. The on-add hook passes
   * `{ kind: 'works', ids }` and therefore marks nothing stale (§6.2 guard 3).
   */
  scope?: SweepScope;
  /**
   * Compute and record the plan, write nothing — the admin route's `dryRun`.
   * Independent of the mode: `enforce` + `dryRun` is how somebody checks what
   * enforcing would do before flipping the var.
   */
  dryRun?: boolean;
}

/**
 * One tick. **Never rejects** — the returned result is the whole report.
 */
export async function runAudiobookSweep(
  env: Env,
  opts: AudiobookSweepRunOptions,
): Promise<AudiobookSweepRunResult> {
  const trigger = opts.trigger;
  const mode = audiobookSweepMode(env);
  const scope: SweepScope = opts.scope ?? { kind: 'all' };

  const base = {
    trigger,
    mode,
    runId: null as number | null,
    plan: null as PlanCounts | null,
    written: null as { statements: number; transitions: number } | null,
    snapshot: null as { etag: string | null; rowCount: number } | null,
  };

  // `off` costs nothing and asks nothing — not even a run row. A row per tick
  // saying "the switch is off" is six rows a day restating a var anybody can
  // read on `/api/health`.
  if (mode === 'off') {
    return { ...base, state: 'skipped', detail: 'mode off' };
  }

  let runId: number | null = null;
  try {
    runId = await startAudiobookSweepRun(env.DB, trigger);
  } catch (err) {
    // No run row means no record — but a tick that cannot open a row cannot
    // write holdings either, so refusing here is the safe direction.
    return { ...base, state: 'failed', detail: `run row failed: ${message(err)}` };
  }

  const finish = async (
    result: Omit<AudiobookSweepRunResult, 'trigger' | 'mode' | 'runId'>,
  ): Promise<AudiobookSweepRunResult> => {
    const full: AudiobookSweepRunResult = { ...result, trigger, mode, runId };
    try {
      await finishAudiobookSweepRun(env.DB, runId as number, {
        state: full.state,
        detail: {
          detail: full.detail,
          trigger,
          mode,
          scope: scope.kind,
          plan: full.plan,
          written: full.written,
          snapshot: full.snapshot,
        },
      });
    } catch {
      // The row stays `running`, which is itself diagnostic (see 0470). There is
      // nowhere better to put this and throwing would break the one promise this
      // function makes.
    }
    return full;
  };

  try {
    const previous = await readAudiobookSnapshot(env.DB).catch(() => null);

    // ── The fetch ─────────────────────────────────────────────────────────
    let res: Response;
    try {
      res = await fetch(AUDIOBOOK_CSV_URL, {
        headers: previous?.etag ? { 'If-None-Match': previous.etag } : {},
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      return finish({ ...base, state: 'failed', detail: `fetch failed: ${message(err)}` });
    }

    if (res.status === 304) {
      // Nothing has changed since the last body we read, so there is nothing to
      // re-plan. ⚠️ Not `in-sync`: `in-sync` is a claim about the CATALOG and
      // this is a claim about the CSV — they are different facts, and conflating
      // them would hide a holding table that had drifted while the source stood
      // still.
      return finish({
        ...base,
        state: 'skipped',
        detail: 'unchanged',
        snapshot: previous ? { etag: previous.etag, rowCount: previous.rowCount } : null,
      });
    }

    if (!res.ok) {
      // ⚠️ Recorded, never thrown. An origin error is news, not an exception.
      return finish({ ...base, state: 'failed', detail: `origin answered ${res.status}` });
    }

    const text = await res.text().catch(() => '');
    const audiobooks = parseAudiobookCsv(text);
    const etag = res.headers.get('etag');

    // ── Guard 1: zero rows is a failure, not an empty catalog ─────────────
    if (audiobooks.length === 0) {
      return finish({
        ...base,
        state: 'failed',
        detail: 'empty snapshot',
      });
    }

    // ── Guard 2: mass drift ───────────────────────────────────────────────
    if (previous && previous.rowCount > 0) {
      const floor = previous.rowCount * (1 - MASS_DRIFT_CAP_PERCENT / 100);
      if (audiobooks.length < floor) {
        return finish({
          ...base,
          state: 'failed',
          detail: `drift: ${audiobooks.length} rows against ${previous.rowCount} last time` +
            ` (cap ${MASS_DRIFT_CAP_PERCENT}%)`,
          snapshot: { etag, rowCount: audiobooks.length },
        });
      }
    }

    // ── The database side ─────────────────────────────────────────────────
    const rows = await readAudiobookSweepInputs(env.DB, scope);

    // ── Guard 4: a zero-WORKS read is a refused run, not a stale sweep ────
    if (rows.works.length === 0) {
      return finish({ ...base, state: 'failed', detail: 'empty-read' });
    }

    const plan = planAudiobookSweep({
      works: rows.works,
      aliases: groupWorkAliases(rows.aliasRows),
      audiobooks,
      existingEditions: rows.existingEditions,
      existingRungs: rows.existingRungs,
      // ⚠️ The GENERATED copy, out of `@lc/universes` — never `@lc/core`, which
      // holds no data, and never a cross-repo read, which a Worker cannot do.
      // §2.4 states the skew out loud: when the two callers disagree about a
      // series name, the ROUTE is the stale one.
      canonicalSeries,
      scope,
    });

    const counts = planCounts(plan);

    // ⚠️ Only now. A snapshot written before the guards would poison the drift
    // baseline for every tick after it.
    await saveAudiobookSnapshot(env.DB, { etag, rowCount: audiobooks.length }).catch(() => {});

    if (mode === 'shadow' || opts.dryRun) {
      return finish({
        ...base,
        state: 'shadow',
        detail: opts.dryRun ? 'dry run — nothing written' : 'shadow — nothing written',
        plan: counts,
        snapshot: { etag, rowCount: audiobooks.length },
      });
    }

    const nothingToDo =
      plan.editionUpserts.length === 0 &&
      plan.editionStales.length === 0 &&
      plan.rungUpserts.length === 0 &&
      plan.rungStales.length === 0;

    if (nothingToDo) {
      return finish({
        ...base,
        state: 'in-sync',
        detail: null,
        plan: counts,
        snapshot: { etag, rowCount: audiobooks.length },
      });
    }

    const written = await applyAudiobookSweepPlan(env.DB, plan, {
      trigger,
      existingEditions: rows.existingEditions,
    });

    return finish({
      ...base,
      state: 'applied',
      detail: null,
      plan: counts,
      written: { statements: written.statements, transitions: written.transitions },
      snapshot: { etag, rowCount: audiobooks.length },
    });
  } catch (err) {
    // Belt and braces. Everything above is already caught; this is here because
    // the one guarantee this function makes to `scheduled()` is that it settles.
    return finish({ ...base, state: 'failed', detail: `sweep failed: ${message(err)}` });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
