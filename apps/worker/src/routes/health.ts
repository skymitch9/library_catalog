import { Hono } from 'hono';
import { gabiPanelEnabled } from '@lc/core';
import {
  audiobookHoldingCounts,
  isDatabaseReachable,
  latestAudiobookSweepRun,
  readAudiobookSnapshot,
} from '@lc/db';
import { describeEstateGate } from '@lc/estate-auth';
import { edgeMode } from '@lc/research';
import { seriesCanonEntryCount, universeNames, universesDocument } from '@lc/universes';
import type { AppBindings, Env } from '../env.js';
import { audiobookSweepMode } from '../lib/audiobook-sweep-run.js';

/**
 * Unauthenticated on purpose: this is the endpoint you curl to prove the
 * deployment works before sign-in is even configured.
 *
 * ⚠️ `universes` is here for one reason: it is the only thing that proves the
 * shared list was actually bundled. It comes from catalog-platform, is
 * materialised at build time, and this line makes a missing or empty list
 * visible in one curl rather than months later in a wrong answer. (It was
 * written when nothing else read the list; the collection filter, the facets
 * and `/api/universes/:name` all do now — so this is no longer the list's only
 * exercise, but it is still its only *unauthenticated* one.)
 *
 * ⚠️ **`count` is the length of the BUNDLED list, never a row count.** Both
 * instances answer 16 because both run the same bundle over the same file —
 * that is the single-writer contract being observable, not two databases
 * agreeing by luck. There is no `universe` table in either D1 and there must
 * never be one; `packages/core/test/universes-single-writer.test.ts` is the
 * guard, and `docs/info/universes.md` §7 is the contract.
 *
 * ⚠️ Envelope normalization (estate item 5, 2026-08-14): also answers
 * `{ ok, service, version, time, detail }`, `detail` holding this route's
 * pre-existing shape verbatim. `version`/`database`/`universes`/`time` stay
 * at the top level too — additive only, nothing removed this pass; see
 * catalog-platform's docs/info/health-envelope.md for the transition plan.
 *
 * ⚠️ `gabi.panel` is here for the same reason `universes` is: it is the only
 * way to prove a per-instance POSTURE from outside, in one curl, with no
 * sign-in. `GABI_PANEL` decides whether the conversational fixer exists on this
 * instance at all — panel and route both (`lib/gabi-turn.ts`) — and the two
 * instances serve the same bundle from the same commit, so "is it on over
 * there?" is otherwise a question only a signed-in browser can answer. A
 * boolean about a feature's existence is not privileged information; nothing
 * else about GABI is exposed here.
 *
 * ⚠️ `estate` is here for the SAME reason and by the same rule (added
 * 2026-08-17 with the F-5 fix): which estate consumer a Worker claims to be
 * (`app`), which secret NAME carries that identity's bearer (`tokenVar`),
 * whether both halves of the config exist (`configured`) and at what strength
 * (`mode`). One curl, no sign-in, from outside — which is exactly what was
 * missing when the friend instance spent a day asserting `library`.
 *
 * ⚠️ Names and booleans, never a value or a fingerprint of one. And
 * `configured: true` is NOT proof the pairing is right: it says the name is
 * populated, not that the directory accepts what is in it. The only proof of
 * the VALUE is a `wrangler tail` line from a real sign-in reading
 * `"src":"seen"` — a wrong value shows as `"src":"none"`/`"stale_cache"`.
 * (Six of one: `mode`/`configured` are also the fastest way to see that a
 * gate has quietly fallen inert, which is the failure this whole route class
 * exists to make visible rather than silent.)
 */
/**
 * The audiobook-association sweep's status line — design §7.2.
 *
 * 🔴 **One fact, one home applies to SURFACES.** The design's first instinct was
 * a page; this route already answers `{ ok, service, version, time, detail }`,
 * is unauthenticated on purpose, and the apex `/status` page already reads it —
 * so the sweep gets ONE KEY in `detail`, and `/status` shows main and padhard
 * side by side for free. A second dashboard would be a second number to
 * disagree with this one, and the estate has already paid for that once (a
 * usage tracker rendering figures two days stale beside a duplicate built the
 * same afternoon).
 *
 * ⚠️ **Counts, states and timestamps only** — the same posture `universes`,
 * `gabi.panel` and `estate` take here: *names and booleans, never a value*. The
 * run row's `detail_json` deliberately holds no edition title and no narrator
 * (see `PlanCounts`), and this reads named fields off it rather than spreading
 * it, so a future field added there cannot leak onto an unauthenticated route
 * by accident.
 *
 * ⚠️ **Never throws, and never fails the health check.** The sweep's tables are
 * migration 0470; an instance that has not been migrated yet must still answer
 * `ok`. Every read here is caught and degrades to nulls, because a `/status`
 * page that goes red over a background job's bookkeeping teaches people to
 * ignore it.
 *
 * ⚠️ `seriesCanonEntries` is §2.4's guard, and it is the reason this key is
 * worth more than a timestamp: the route's series canon is as fresh as the last
 * DEPLOY while the script's is as fresh as the last `git pull` of
 * catalog-platform, and when they disagree the ROUTE is the stale one. A deploy
 * that shipped an empty canon shows up here in one curl instead of as a page
 * full of `AUDIO?` months later.
 *
 * 🟡 A second reporter exists — STEP 11 of the audiobook pipeline renders
 * `_link_report` on the audiobook status page. Once this route ENFORCES, this
 * row is the authoritative one and STEP 11's line becomes a cross-check. Said
 * here and on that page, rather than letting two numbers quietly disagree.
 */
async function audiobookSweepStatus(env: Env) {
  const mode = audiobookSweepMode(env);
  try {
    const [run, snapshot, counts] = await Promise.all([
      latestAudiobookSweepRun(env.DB),
      readAudiobookSnapshot(env.DB),
      audiobookHoldingCounts(env.DB),
    ]);
    const detail =
      run?.detail && typeof run.detail === 'object' && 'detail' in run.detail
        ? ((run.detail as { detail: unknown }).detail ?? null)
        : null;
    return {
      mode,
      /** Null means the sweep has never run here — not that it ran and did nothing. */
      lastRunAt: run?.startedAt ?? null,
      lastFinishedAt: run?.finishedAt ?? null,
      trigger: run?.trigger ?? null,
      state: run?.state ?? null,
      /** The one phrase that tells the five silences apart. See `describeState`. */
      detail: typeof detail === 'string' ? detail : null,
      snapshotRows: snapshot?.rowCount ?? null,
      snapshotFetchedAt: snapshot?.fetchedAt ?? null,
      /**
       * How stale our picture of the sibling catalog is, in hours. ⚠️ Derived
       * here rather than left to the reader: a bare timestamp on a status page
       * is a number nobody subtracts, and the whole question this key answers is
       * *how old is it*.
       */
      snapshotAgeHours: ageHours(snapshot?.fetchedAt ?? null),
      editionsLive: counts.editionsLive,
      rungsLive: counts.rungsLive,
      seriesCanonEntries: seriesCanonEntryCount,
    };
  } catch {
    // Not migrated yet, or the database is down — which `database` above
    // already says, in the place people look for it.
    return {
      mode,
      lastRunAt: null,
      lastFinishedAt: null,
      trigger: null,
      state: null,
      detail: null,
      snapshotRows: null,
      snapshotFetchedAt: null,
      snapshotAgeHours: null,
      editionsLive: null,
      rungsLive: null,
      seriesCanonEntries: seriesCanonEntryCount,
    };
  }
}

/** SQLite's `datetime('now')` is `YYYY-MM-DD HH:MM:SS` in UTC, with no zone on it. */
function ageHours(stamp: string | null): number | null {
  if (!stamp) return null;
  const at = Date.parse(`${stamp.replace(' ', 'T')}Z`);
  if (Number.isNaN(at)) return null;
  return Math.round(((Date.now() - at) / 3_600_000) * 10) / 10;
}

export const healthRoutes = new Hono<AppBindings>().get('/', async (c) => {
  const database = (await isDatabaseReachable(c.env.DB)) ? 'up' : 'down';
  const ok = database === 'up';
  const audiobookSweep = await audiobookSweepStatus(c.env);
  // The pre-envelope shape, unchanged — nested under `detail` AND kept at
  // the top level (additive transition, see file header). Spread FIRST so
  // the explicit envelope fields after it are an intentional override, not
  // a silently-shadowed duplicate (tsc flags the reverse order, TS2783).
  const legacy = {
    ok,
    version: c.env.APP_VERSION ?? 'unknown',
    database,
    universes: { count: universeNames.length, schemaVersion: universesDocument.schemaVersion },
    /**
     * The per-instance posture of the conversational fixer. See the header.
     *
     * ⚠️ `delegated` (2026-08-18) reports only whether the SECRET NAME is
     * populated — never the value, never a fingerprint — and it is the one way
     * to tell "GABI's Discord door is wired here" from "it 401s everything"
     * without a sign-in and without holding the credential. `false` means the
     * delegated verbs answer a worded 503 and write nothing, which is the
     * ships-dark state the code is allowed to be deployed in.
     * ⚠️ `true` is NOT proof the pairing is right: it says the name exists on
     * this env, not that the bot holds the same value. The only proof of the
     * VALUE is a real delegated call answering something other than 401.
     */
    gabi: {
      panel: gabiPanelEnabled(c.env.GABI_PANEL),
      delegated: Boolean(c.env.ESTATE_APP_TOKEN_DISCORD),
      /**
       * ⚠️ How far she takes her personality here — the RESOLVED `full` /
       * `standard`, not the raw var (2026-09-02).
       *
       * Reported for the same reason `panel` is: a posture nobody can observe
       * from outside is one whose deploy cannot be verified. It matters MORE
       * than `panel` does, because this var **fails open** — a typo still reads
       * as `full` — so *"I set it to standard"* and *"she is on standard"* are
       * two different claims and only this line settles the second.
       *
       * Not a secret and not a capability: it says how loud she is, never what
       * she may do. Every tool gate, the confirm lane and the PG-13 ceiling are
       * unchanged by it.
       */
      edge: edgeMode(c.env),
    },
    /** The per-instance ESTATE IDENTITY and its config state. See the header. */
    estate: describeEstateGate(c.env),
    /**
     * The audiobook-association sweep (design §7.2). ⚠️ **Additive only** — see
     * `audiobookSweepStatus` for why this is a key here rather than a page, and
     * why it can never fail the health check.
     */
    audiobookSweep,
    time: new Date().toISOString(),
  };
  return c.json(
    {
      ...legacy,
      service: 'library-catalog',
      detail: legacy,
    },
    ok ? 200 : 503,
  );
});
