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
 * ## ⚠️ ONE tick, TWO halves — added 2026-09-05
 *
 * The same tick now also refreshes `series_volume` / `series_check` from the
 * SAME parsed CSV (`planSeriesVolumes` in `@lc/core`, `applySeriesVolumePlan` in
 * `@lc/db`) — platform inventory §7 row #2, *"same input, same fetch, same
 * instance pair … it costs one function"*. It costs one extra D1 read and no
 * second fetch, and it is folded in here rather than given a cron of its own for
 * the reason that row ends on: **two audiobook-derived tables that fall out of
 * step is a worse bug than either being stale.**
 *
 * 🔴 **No second mode variable.** `AUDIOBOOK_SWEEP_MODE` expresses this half
 * exactly — `off` means no fetch at all, `shadow` means the plan is computed and
 * its counts recorded under `detail_json.seriesVolumes` with nothing written,
 * `enforce` means it is applied. A second switch would let one instance shadow
 * one half and enforce the other, which is a state nobody could read off
 * `/api/health` and nothing needs.
 *
 * ⚠️ The two halves share a TICK, not a FATE. Each is planned and applied in its
 * own `try`/batch, so a missing or unreadable `series_volume` table records
 * `seriesVolumes.detail` and leaves the holdings the work pages draw from
 * untouched.
 *
 * ## 🔴 SHADOW fetches unconditionally — added 2026-09-06
 *
 * A full-scope tick in `shadow` mode (and anything passed `force`) sends **no**
 * `If-None-Match`, so it cannot be answered `304` and always computes both
 * halves of the plan. `enforce` and `off` keep the conditional GET and keep the
 * `304` short-circuit.
 *
 * **Why:** shadow mode exists to produce evidence for the §8 phase-2 gate, and
 * for a day it produced none — W10-LIB-FLIP measured **3 run rows per instance,
 * 1 with a plan, 0 with `seriesVolumes`**, because the `304` return is upstream
 * of the parse, the D1 read and both planners. The input changes ≈3×/day, so the
 * gate's *"a week at four-hourly"* was really ~14 days. Shadow writes nothing to
 * any catalogue table in either case; the only thing the extra 1.4 MB buys is
 * the record, which is the whole point of the mode. The reasoning, and why a
 * stored-snapshot replay is impossible (0470 caches no rows), is at the fetch.
 *
 * ⚠️ A tick that fetched unconditionally and got the SAME body back records
 * `detail: "… (unchanged-replayed)"` and does **not** re-stamp the snapshot's
 * `fetched_at` — otherwise `snapshotAgeHours` would sit at zero forever and stop
 * being able to say the sibling pipeline had died.
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
 * ⚠️ **All four cover the series-volume half too**, and three of them for free:
 * it is planned downstream of guards 1, 2 and 4, so a zero-row CSV, a drifted
 * CSV or a zero-WORKS read has already returned with nothing written. Guard 3 it
 * gets in its own form — a scoped run plans NONE of it, because a
 * `series_check` row is a per-series claim that a source was consulted and a run
 * that looked at one book has consulted nothing about the rest.
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
  planSeriesVolumes,
  type SeriesVolumePlan,
  type SweepPlan,
  type SweepScope,
} from '@lc/core';
import {
  applyAudiobookSweepPlan,
  applySeriesVolumePlan,
  finishAudiobookSweepRun,
  readAudiobookSnapshot,
  readAudiobookSweepInputs,
  readSeriesVolumeRows,
  saveAudiobookSnapshot,
  seriesVolumeStatements,
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

/**
 * 🔴 **The `enforce` gate, as a number — one home for it.**
 *
 * *"≥42 shadow ticks with ZERO divergences on BOTH halves"*, from §8 phase 2 of
 * `catalog-platform/docs/info/audiobook-association-route.md` and
 * `docs/access/audiobook-sweep.md` §6. Published on `/api/health` beside the
 * achieved counts so the page answers the flip question outright instead of
 * making a reader hold the requirement in their head — the failure mode of
 * 2026-09-06, when *"42"* was quoted back as if it were a reading.
 *
 * ⚠️ It is 42 because the gate was written as *"a week at four-hourly"*. The
 * arithmetic only holds now that shadow fetches unconditionally; while every
 * tick could `304`, six ticks a day bought about three.
 */
export const AUDIOBOOK_SWEEP_GATE_TICKS = 42;

/** How long the origin has to answer before the tick gives up on it. */
const FETCH_TIMEOUT_MS = 20_000;

/**
 * The ladder, per the estate's enforcement rule: off → shadow → enforce, flipped
 * only on measured equality and never as a side effect of an unrelated deploy.
 *
 * - **`off`** — costs nothing and asks nothing. No fetch, no run row.
 * - **`shadow`** — computes BOTH plans and **writes nothing** to the holding
 *   tables or to `series_volume`/`series_check`; the counts land in
 *   `audiobook_sweep_run.detail_json` (`plan` and `seriesVolumes`), which is what
 *   makes a shadow tick evidence rather than a no-op. STEP 11 of the audiobook
 *   pipeline and `npm run backfill:series-volumes` are still doing the writing.
 * - **`enforce`** — both plans are applied.
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
  /**
   * The OTHER half of the same tick — `series_volume` / `series_check`. Null
   * when the tick never got as far as planning anything (mode off, a refused
   * fetch, a failed guard).
   */
  seriesVolumes: SeriesVolumeRunCounts | null;
  snapshot: { etag: string | null; rowCount: number } | null;
}

/**
 * The series-volume half of a tick, as numbers.
 *
 * 🔴 **Counts only, exactly as `PlanCounts` is** — `detail_json` is read back by
 * `/api/health`, which is unauthenticated on purpose, and a shape carrying
 * volume titles would be one careless spread away from publishing what the
 * household reads. The numbers below are exactly the ones
 * `npm run backfill:series-volumes -- --remote` prints, which is what makes the
 * parity check a comparison somebody can actually do.
 */
export interface SeriesVolumePlanCounts {
  /** Our series considered — the script's `N series in the … database`. */
  seriesCount: number;
  /** Series the sibling catalog knows. */
  found: number;
  /** Series it has never heard of — recorded as `not_found`, not as silence. */
  notFound: number;
  volumeUpserts: number;
  checkUpserts: number;
  /** Volumes this run had not seen before — the script's `N volume(s) …`. */
  newVolumes: number;
  /** Rows left alone because a person entered them. */
  manualSkipped: number;
  /** Statements the plan renders to — what the script's dry run counts. */
  statements: number;
}

export interface SeriesVolumeRunCounts {
  /**
   * 🔴 Null under a SCOPED run. Guard 3, applied to this half: a run that looked
   * at one book has no standing to re-answer *"what volumes does the sibling
   * catalog know?"* for the whole catalogue, and `series_check` is a per-series
   * claim that a source was consulted. The cron owns it.
   */
  planned: SeriesVolumePlanCounts | null;
  /** Statements written. Null in shadow, in a dry run, and on a refusal. */
  written: number | null;
  /** One phrase when nothing was planned. */
  detail: string | null;
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

function seriesVolumePlanCounts(plan: SeriesVolumePlan): SeriesVolumePlanCounts {
  const r = plan.report;
  return {
    seriesCount: r.seriesCount,
    found: r.found,
    notFound: r.notFound,
    volumeUpserts: plan.writes.filter((w) => w.kind === 'volume').length,
    checkUpserts: plan.writes.filter((w) => w.kind === 'check').length,
    newVolumes: r.newVolumes,
    manualSkipped: r.manualSkipped,
    statements: plan.writes.length,
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
  /**
   * 🔴 **Skip `If-None-Match` — fetch the body whatever the etag says.**
   *
   * The admin route's `force`, and the answer to the thing that broke the
   * phase-1 gate on 2026-09-06: `dryRun` is documented as *"the ONLY way to
   * answer the phase-1 gate"* and it could not, because it sent the stored etag
   * like everything else and the origin answered `304`. A rehearsal that
   * returns `plan: null` is not an instrument.
   *
   * ⚠️ It changes **what is fetched, never what is written.** `dryRun` and the
   * mode ladder still decide that. `force` on its own in `enforce` mode is a
   * real run against a body that may be byte-identical to the last one — which
   * is safe (the sweep is idempotent) but is not a rehearsal; pass `dryRun`
   * too if that is what you meant.
   */
  force?: boolean;
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
    seriesVolumes: null as SeriesVolumeRunCounts | null,
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
          seriesVolumes: full.seriesVolumes,
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
    //
    // 🔴 **SHADOW FETCHES UNCONDITIONALLY. Enforce does not.** Added 2026-09-06
    // after W10-LIB-FLIP measured what shadow mode had actually produced in a
    // day of running: **1 tick with a plan and 0 carrying `seriesVolumes`, out
    // of 3, on both instances.** The conditional GET is what makes a tick cheap,
    // and it is also what made shadow mode — whose ENTIRE PURPOSE is evidence —
    // produce none, because a `304` returns below, upstream of the parse, the D1
    // read, the planner and both halves of the plan. The sibling CSV changes
    // ≈3×/day, so *"42 ticks = a week at four-hourly"* was really ~14 days of
    // waiting on somebody else's publish schedule.
    //
    // ⚠️ **The 304 short-circuit is KEPT for `enforce` (and `off`), deliberately.**
    // There the conditional GET is exactly right: nothing changed means nothing
    // to write, and re-planning to discover that costs 1.4 MB to reach the same
    // batch of zero statements. Shadow writes nothing either way, so the only
    // thing it can spend bandwidth on is the record — which is the thing being
    // asked for.
    //
    // ⚠️ **Full-scope only.** The on-add hook's scoped run plans no series
    // volumes at all (guard 3) and therefore generates no gate evidence, so
    // making every book somebody adds pull 1.4 MB would buy nothing. It keeps
    // the conditional GET in every mode.
    //
    // 🔴 **Why not replay the STORED snapshot instead of re-fetching?** Because
    // there is nothing to replay: migration 0470's `audiobook_snapshot` holds an
    // `etag`, a `fetched_at` and a `row_count` — *"⚠️ Neither table is a cache of
    // the CSV"*, in the migration's own words. There are no rows in the database
    // to plan over, so an unconditional fetch is the smallest honest way to get
    // a plan out of a quiet input.
    const unconditional = opts.force === true || (mode === 'shadow' && scope.kind === 'all');
    const conditionalEtag = unconditional ? null : (previous?.etag ?? null);

    let res: Response;
    try {
      res = await fetch(AUDIOBOOK_CSV_URL, {
        headers: conditionalEtag ? { 'If-None-Match': conditionalEtag } : {},
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
      //
      // ⚠️ Only reachable when the GET was conditional — i.e. `enforce`/`off`, or
      // a scoped on-add run. A full-scope shadow tick and anything with `force`
      // sent no `If-None-Match` and cannot be answered `304`.
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

    // ── The OTHER half of the same tick — `series_volume` / `series_check` ──
    //
    // Platform inventory §7 row #2. It reads the SAME parsed CSV and the SAME
    // works, so it costs one D1 read and no second fetch — and the two
    // audiobook-derived tables cannot fall out of step, which was the argument
    // for folding it in here rather than giving it a cron of its own.
    //
    // 🔴 **Guard 3, applied to this half: a scoped run plans NONE of it.** The
    // audiobook half's scoped form has a type-level reason to be safe (zero
    // stale entries); this half's reason is different and needs saying: a
    // `series_check` row is a per-series claim that a source was consulted, and
    // a run that looked at one book has not consulted anything about the rest of
    // the catalogue. The cron owns it. Guards 1, 2 and 4 are inherited whole —
    // this code is downstream of all three, so a zero-row CSV, a drifted CSV or
    // a zero-WORKS read has already returned above with nothing written.
    let seriesPlan: SeriesVolumePlan | null = null;
    let seriesVolumes: SeriesVolumeRunCounts;
    if (scope.kind !== 'all') {
      seriesVolumes = { planned: null, written: null, detail: 'scoped run — the cron owns this half' };
    } else {
      try {
        const existingVolumes = await readSeriesVolumeRows(env.DB);
        seriesPlan = planSeriesVolumes({
          works: rows.works,
          audiobooks,
          existing: existingVolumes,
        });
        seriesVolumes = { planned: seriesVolumePlanCounts(seriesPlan), written: null, detail: null };
      } catch (err) {
        // ⚠️ Recorded, never thrown, and it does NOT fail the audiobook half.
        // The two halves share a tick, not a fate: a `series_volume` table that
        // is missing or unreadable is no reason to withhold the holdings the
        // work pages draw from.
        seriesPlan = null;
        seriesVolumes = { planned: null, written: null, detail: `series volumes failed: ${message(err)}` };
      }
    }

    // 🔴 **A REPLAY: an unconditional GET that brought back the body we already
    // had.** The etag matched and the parse produced the same number of rows, so
    // this plan was computed over an input that has not moved since the last
    // fetch. It is still evidence — the planner really ran, over the really-live
    // CSV, and both halves really produced counts — but a reader must be able to
    // tell it from a tick that saw something new, or *"42 shadow ticks"* would
    // silently become *"42 readings of one CSV"*.
    //
    // ⚠️ It is deliberately NOT enough that `unconditional` is true: a forced
    // fetch that brings back a CHANGED body is an ordinary tick, and calling it
    // a replay would be the lie in the other direction.
    const replayed =
      unconditional &&
      previous !== null &&
      etag !== null &&
      previous.etag !== null &&
      etag === previous.etag &&
      audiobooks.length === previous.rowCount;

    // ⚠️ Only now. A snapshot written before the guards would poison the drift
    // baseline for every tick after it.
    //
    // ⚠️ **And not at all on a replay.** `fetched_at` answers *"how old is our
    // picture of the sibling catalog"* — the migration says so in as many words,
    // and `/api/health` derives `snapshotAgeHours` from it. Re-stamping it every
    // four hours with a body we already had would peg that number near zero
    // forever and destroy the one signal that says the sibling pipeline has
    // stopped publishing. `etag` and `row_count` are identical by definition
    // here, so the write would change nothing else.
    if (!replayed) {
      await saveAudiobookSnapshot(env.DB, { etag, rowCount: audiobooks.length }).catch(() => {});
    }

    if (mode === 'shadow' || opts.dryRun) {
      return finish({
        ...base,
        state: 'shadow',
        // ⚠️ The `(unchanged-replayed)` suffix is the distinguishing marker, and
        // it is in `detail` because `detail` is where every other silence in
        // this function is told apart — the runbook's silence table reads this
        // one field. `unchanged` (a 304) and `unchanged-replayed` (a full fetch
        // of an unchanged body, which DID compute a plan) are opposite facts
        // about the same quiet input.
        detail:
          `${opts.dryRun ? 'dry run' : 'shadow'} — nothing written` +
          (replayed ? ' (unchanged-replayed)' : ''),
        plan: counts,
        seriesVolumes,
        snapshot: { etag, rowCount: audiobooks.length },
      });
    }

    const seriesStatements = seriesPlan ? seriesVolumeStatements(seriesPlan).length : 0;

    const nothingToDo =
      plan.editionUpserts.length === 0 &&
      plan.editionStales.length === 0 &&
      plan.rungUpserts.length === 0 &&
      plan.rungStales.length === 0 &&
      // ⚠️ Both halves, or `in-sync` would be a lie the moment the holdings were
      // steady and a new series volume had appeared.
      seriesStatements === 0;

    if (nothingToDo) {
      return finish({
        ...base,
        state: 'in-sync',
        detail: null,
        plan: counts,
        seriesVolumes,
        snapshot: { etag, rowCount: audiobooks.length },
      });
    }

    // ⚠️ Called even when only the series half has work: an empty plan batches
    // nothing (`applyAudiobookSweepPlan` skips the batch at zero statements) and
    // reports zero, which is cheaper than a second branch that could drift.
    const written = await applyAudiobookSweepPlan(env.DB, plan, {
      trigger,
      existingEditions: rows.existingEditions,
    });

    if (seriesPlan && seriesStatements > 0) {
      try {
        const applied = await applySeriesVolumePlan(env.DB, seriesPlan);
        seriesVolumes = { ...seriesVolumes, written: applied.statements };
      } catch (err) {
        // Same reasoning as the planning catch: one half failing is recorded,
        // it does not un-write the other. ⚠️ Its own batch, so a `series_volume`
        // failure cannot roll back holdings that landed correctly.
        seriesVolumes = { ...seriesVolumes, written: 0, detail: `series volumes failed: ${message(err)}` };
      }
    }

    return finish({
      ...base,
      state: 'applied',
      detail: null,
      plan: counts,
      written: { statements: written.statements, transitions: written.transitions },
      seriesVolumes,
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

// ---------------------------------------------------------------------------
// The on-add hook — §4.2, §4.3, §4.4
// ---------------------------------------------------------------------------

/**
 * What a caller that just created a work wants done about it.
 *
 * 🔴 **Explicit, never inferred.** §4.4: `routes/ingest.ts` is a bulk importer,
 * and one hook per row against a thousand-book import is a thousand index
 * builds. The choice is a REQUIRED argument rather than a default with an
 * opt-out, because the failure mode of forgetting it is invisible until
 * somebody imports a library.
 */
export type AssociationPolicy = 'per-work' | 'defer';

/**
 * Associate one freshly-created work with the audiobook catalog, in the
 * background.
 *
 * ⚠️ **`ctx.waitUntil`, never inline and never a queue** (§4.3). Inline would
 * make the person's add wait on a fetch, an index build and a match — which is
 * precisely "slowing the add". A Queue would be a new binding, a producer, a
 * consumer and a new failure domain on both instances, for one row.
 *
 * ⚠️ **`scope: { kind: 'works', ids: [workId] }`, and that is a TYPE-level
 * guarantee, not a promise.** This run has looked at one book, so it has no
 * standing to say any other row is gone: `planAudiobookSweep` produces zero
 * stale entries under this scope, and it emits a rung only where this run itself
 * corroborated the series — a scoped `fold` verdict is an ABSENCE of evidence
 * rather than weaker evidence, and writing it would downgrade a `work_match`
 * rung the cron had already earned. `packages/core/test/audiobook-sweep-scope.test.ts`
 * pins both.
 *
 * ⚠️ **In shadow mode this records what it WOULD do** and writes nothing — the
 * run row lands with `trigger = 'on-add'` and the plan in `detail_json`, which
 * is how the §8 gate can tell whether the hook is firing at all before it is
 * ever allowed to write.
 *
 * ⚠️ Nothing here can affect the response: the caller has already returned by
 * the time this runs, and `runAudiobookSweep` never rejects. A missing
 * `ExecutionContext` (a unit test, an unusual host) is a skipped hook and a log
 * line, never a thrown error inside somebody's book-add.
 */
export function associateWorkAfterAdd(
  // ⚠️ Structural, not `Context<AppBindings>` and not `ExecutionContext`. Hono's
  // `ExecutionContext` and the Workers runtime types have drifted apart
  // (`tracing` is required in one and absent in the other), so naming either
  // fails to typecheck at the call sites. The only thing this needs is a place
  // to register a promise, and asking for exactly that is both honest and
  // trivially fake-able in a test.
  c: { env: Env; executionCtx: { waitUntil(promise: Promise<unknown>): void } },
  workId: number,
  policy: AssociationPolicy,
): void {
  if (policy === 'defer') {
    // §4.4. The importer's rows are caught by the cron's next full sweep, which
    // is the backstop the design already relies on.
    //
    // ⚠️ **The design says "collect work ids and fire ONE `associateWorks(ids)`
    // at the end of the batch", and that is not implementable HERE** — measured
    // 2026-09-05: `routes/ingest.ts` has exactly one route and it creates ONE
    // work per request. The loop is in the external importer, so a Worker
    // invocation never sees a batch begin or end and has nothing to flush. The
    // deferral is therefore real and the batching is the cron's. If the importer
    // ever grows a multi-row body, THAT is where the batched call belongs.
    console.log(
      JSON.stringify({ evt: 'audiobook_associate', policy: 'defer', workId }),
    );
    return;
  }

  let ctx: { waitUntil(promise: Promise<unknown>): void } | null = null;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = null;
  }
  if (!ctx) {
    console.log(
      JSON.stringify({ evt: 'audiobook_associate', policy, workId, skipped: 'no execution ctx' }),
    );
    return;
  }

  ctx.waitUntil(
    runAudiobookSweep(c.env, { trigger: 'on-add', scope: { kind: 'works', ids: [workId] } }).then(
      (run) =>
        console.log(
          JSON.stringify({ evt: 'audiobook_associate', policy, workId, state: run.state, detail: run.detail }),
        ),
      // Unreachable — `runAudiobookSweep` never rejects — and kept for the same
      // reason `scheduled()` keeps its catch: an unhandled rejection in a
      // background task is invisible in a way a request's never is.
      (err) => console.error('audiobook associate failed', workId, err),
    ),
  );
}
