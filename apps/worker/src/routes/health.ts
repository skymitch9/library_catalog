import { Hono } from 'hono';
import { gabiPanelEnabled } from '@lc/core';
import { isDatabaseReachable } from '@lc/db';
import { describeEstateGate } from '@lc/estate-auth';
import { edgeMode } from '@lc/research';
import { universeNames, universesDocument } from '@lc/universes';
import type { AppBindings } from '../env.js';

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
export const healthRoutes = new Hono<AppBindings>().get('/', async (c) => {
  const database = (await isDatabaseReachable(c.env.DB)) ? 'up' : 'down';
  const ok = database === 'up';
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
