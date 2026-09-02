/**
 * The library's estate gate — §14.5 / §9 step 5, ALL THREE MODES.
 *
 * This module was born as the shadow-only `shadow.ts` (observe and log,
 * enforce nothing); the enforce arm replaced that revision's deliberate
 * `enforce_requested` stub once the shadow soak had evidence and the games
 * arm (`Board_Game_Catalog/apps/worker/src/middleware/estate.ts`) had proven
 * the shape in production. Same §3.1 semantics, ported into this repo's
 * convention: the module computes PURELY — it never touches D1 or a Response
 * — and returns directives (`refresh`, `autoGrant`, `deny`, `logLine`) that
 * `middleware/auth.ts` acts on. That split is why the whole §3.1 table is
 * pinned by plain unit tests with a fetch stub and no D1 mock.
 *
 * ## The three modes (`ESTATE_CHECK`)
 *
 *   off      — (safe default for a missing/typo'd value) nothing happens: no
 *              /seen call, no DB read, no log. A deploy carrying this code is
 *              inert until the flag is flipped deliberately.
 *   shadow   — the full §5.2 protocol runs and the §3.1 verdict is computed
 *              and logged (`"would_deny":true` on the rows enforce would
 *              refuse), and then the request proceeds EXACTLY as local auth
 *              already decided. Days of zero household would-deny lines are
 *              the evidence that makes the enforce flip boring.
 *   enforce  — the §3.1 verdicts act, via the directives:
 *                revoked            → deny 403 `estate_revoked` — COMPUTED,
 *                                     never stored: the local role is left
 *                                     intact so a later re-approval restores
 *                                     the person exactly (§3.1 row 1)
 *                estate_unreachable → deny 503 `estate_unreachable`, NAMED so
 *                                     an outage is distinguishable from a
 *                                     denial (§6 row 1) — only ever reached
 *                                     by non-standing users; standing ones
 *                                     ride the stale cache
 *                default_grant      → `autoGrant` the posture's `reader`
 *                                     (§5.4) — the caller writes it with the
 *                                     estate-actor convention: approved_by
 *                                     NULL + a change_log row,
 *                                     changed_how='auto' (this repo HAS an
 *                                     audit log, unlike games where the log
 *                                     line is the audit)
 *                proceed / request_screen → nothing; local auth's answer
 *                                     stands (a locally-pending person still
 *                                     meets the capability layer's request
 *                                     screen, not a new response shape)
 *
 * ## What the gate deliberately does NOT touch (the games arm's §14.5 list)
 *
 *  - `upsertUserOnLogin` and its OWNER_EMAILS recovery hatch run BEFORE this
 *    and are untouched — the way back in cannot depend on the thing being
 *    added. §3.1's local-wins rows mean a forced owner proceeds even in
 *    enforce with the directory down. (An estate `revoked` beats even a local
 *    owner BY DESIGN — §3.1 row 1 says "anything, even owner"; the recovery
 *    paths from a revocation mishap are §6 row 4's other two: the D1 console,
 *    and the *.workers.dev hostname. This gate must not invent a fourth.)
 *  - Missing `ESTATE_AUTH_URL` / this instance's `ESTATE_APP_TOKEN_*` while
 *    the mode asks for shadow OR enforce IS the off state, with its name in
 *    the log — the code deploys before the secret exists, and a
 *    half-configured enforce must fail into "today's behaviour", never into a
 *    lockout.
 *
 * ## ⚠️ WHICH APP THIS INSTANCE IS (`ESTATE_APP`) — per-instance, not baked in
 *
 * This codebase runs as TWO estate consumers from one build: the main library
 * (`library`, library.heygabi.ai) and the second instance (`library2`,
 * padhard.heygabi.ai). The directory tells them apart by the BEARER VALUE —
 * `identifyApp` in the auth Worker walks `CONSUMER_APPS` and matches the
 * presented token against each configured `ESTATE_APP_TOKEN_*`, then stamps a
 * newcomer's row `origin = 'seen:<app>'` and answers that person's effective
 * visibility set.
 *
 * ⚠️ Until 2026-08-17 the app id here was a HARD-CODED `'library'` and the
 * bearer was read from a hard-coded `ESTATE_APP_TOKEN_LIBRARY`, on BOTH
 * instances. The consequence (estate credentials catalog F-5): the friend
 * instance asserted the main library's identity, `ESTATE_APP_TOKEN_LIBRARY2`
 * on the auth Worker was an orphan nothing ever presented, and the
 * `vis_library2` column the friend-ingest design created to gate her catalog
 * gated nothing. The identity is now CONFIG, one var per wrangler env:
 *
 *   [vars]              ESTATE_APP = "library"   → ESTATE_APP_TOKEN_LIBRARY
 *   [env.friend.vars]   ESTATE_APP = "library2"  → ESTATE_APP_TOKEN_LIBRARY2
 *
 * The token var NAME follows the app id (`APP_TOKEN_VAR`), so the pairing rule
 * the whole estate uses — *one value, two holders, SAME NAME on both sides* —
 * holds for the second instance too, and a mismatched pairing is a missing
 * NAME (⇒ `estate_config_unset` ⇒ off) rather than a wrong VALUE (⇒ 401 from
 * the directory ⇒ `estate_unreachable`). Failing into off is the direction
 * this module has always chosen; it is why deploying this change before the
 * secret is piped cannot lock anyone out.
 *
 * ## Visibility rides along (§4.5)
 *
 * The /seen answer carries the EFFECTIVE visibility set beside the status;
 * the one-answer rule says the two are cached and aged together. The gate
 * parses the cached JSON at the boundary (`parseVisibility` — garbage dies
 * into null here, not at query time), hands the canonical array back in
 * `refresh` for the caller to persist, and logs it. Nothing in THIS app
 * scopes on it today — the library's own authorization stays `role`.
 *
 * ⚠️ Read that last sentence together with `ESTATE_APP` below, because it
 * bounds what the F-5 fix does and does not buy. The gate's REFUSALS come
 * from `status` (revoked / unreachable), never from the visibility array, on
 * either instance. So asserting `library2` does not by itself make
 * `vis_library2` a gate — it makes the directory answer, log and attribute
 * for the right consumer, and it makes the column MEANINGFUL to switch on
 * when a visibility-scoped refusal is built. Anyone who reaches the friend
 * instance today still passes or fails on estate `status` + her local role,
 * exactly as before. Gating on the array is a separate, access-REDUCING
 * decision with its own evidence step — do not slip it in here.
 */

import {
  combineEstateAndLocal,
  type EstateStatus,
  type EstateVerdict,
  isEstateStatus,
} from '../generated/combine.js';
import { estateCheck } from '../generated/seen.js';
import { declareAuthPosture } from '../generated/config.js';
import { parseVisibility, type Catalog } from '../generated/visibility.js';

/**
 * The per-surface posture declaration (owner decisions #1 and #2): the library
 * is NOT public, and one estate approval auto-grants its designed default role
 * `member` (read + own read-state + rate + suggestWishlist — §5.4). In shadow
 * the grant is NEVER performed and surfaces only as
 * `"would_auto_grant":"member"`; in enforce it is the `autoGrant` directive
 * the middleware writes.
 *
 * ⚠️ Was `'reader'` until the 2026-08-16 ladder redesign renamed the library's
 * own bottom active rung to `member` (`packages/core/src/constants.ts`,
 * migration 0300 — `reader` -> `member` everywhere, including every stored
 * row). `defaultRole` is a plain string here (`declareAuthPosture`'s
 * `EstateAuthConfig`, generated/config.ts) with no shared type to catch the
 * drift, so this rename had to be made by hand rather than by the compiler —
 * noted so the next rename remembers to look here too.
 */
export const LIBRARY_POSTURE = declareAuthPosture({
  public: false,
  app: 'library',
  defaultRole: 'member',
});

/**
 * The estate app identities THIS codebase is allowed to present — an
 * allowlist, deliberately, and deliberately not `CONSUMER_APPS` (which also
 * names `games`, `index` and `audiobook`, three apps that are not this repo).
 * A var that could name any string would let one edit make the library
 * catalog impersonate the audiobook site's consumer at the directory.
 *
 * `library` is the declared posture's own id and the default; `library2` is
 * the second instance (friend-ingest-design.md §6, auth-worker migration
 * 0007's `vis_library2`).
 */
export const ESTATE_APPS = Object.freeze(['library', 'library2'] as const);
export type EstateApp = (typeof ESTATE_APPS)[number];

/**
 * app id → the env var holding ITS paired bearer. ⚠️ The names are the auth
 * Worker's own (`appTokenFor` in `apps/auth-worker/src/env.ts`), because the
 * estate's pairing rule is *same name, both sides* — see §6 of the credentials
 * catalog. Renaming one half is how a pairing silently desyncs.
 */
export const APP_TOKEN_VAR: Readonly<Record<EstateApp, string>> = Object.freeze({
  library: 'ESTATE_APP_TOKEN_LIBRARY',
  library2: 'ESTATE_APP_TOKEN_LIBRARY2',
});

export interface ResolvedEstateApp {
  /** Null ONLY when a value was set and is not an allowed id — see below. */
  app: EstateApp | null;
  /** The env var this app's bearer must be under. Null with a null `app`. */
  tokenVar: string | null;
  /** The rejected raw value when one was set but not recognised, else null. */
  invalid: string | null;
}

/**
 * Resolve `ESTATE_APP` into an identity and the var holding its bearer.
 *
 * ⚠️ The failure direction is DELIBERATELY different from `resolveDefaultRole`
 * and `parseEstateMode`, which fall back to a working default. Those two pick
 * the inert answer; here the "inert" answer would be `library` — the exact
 * wrong identity for the friend instance, and the bug F-5 named. A typo must
 * therefore turn the gate OFF (loudly, `estate_app_unrecognised`) rather than
 * fall back into asserting the main library. Off is still the safe direction:
 * local auth — Firebase verification plus this app's own role ladder — is
 * untouched by it, so nobody gains anything they did not already have; the
 * estate simply stops being consulted until the var is fixed.
 */
export function resolveEstateApp(raw: string | undefined): ResolvedEstateApp {
  const v = (raw ?? '').trim();
  if (v === '') {
    const app = LIBRARY_POSTURE.app as EstateApp;
    return { app, tokenVar: APP_TOKEN_VAR[app], invalid: null };
  }
  if ((ESTATE_APPS as readonly string[]).includes(v)) {
    const app = v as EstateApp;
    return { app, tokenVar: APP_TOKEN_VAR[app], invalid: null };
  }
  return { app: null, tokenVar: null, invalid: v };
}

/**
 * Read the bearer for a resolved `tokenVar`. A switch rather than an index
 * expression: the set of secrets this module may read stays greppable, and no
 * future var name can be reached by data.
 */
function appTokenFrom(env: GateEnv, tokenVar: string): string {
  switch (tokenVar) {
    case 'ESTATE_APP_TOKEN_LIBRARY':
      return (env.ESTATE_APP_TOKEN_LIBRARY ?? '').trim();
    case 'ESTATE_APP_TOKEN_LIBRARY2':
      return (env.ESTATE_APP_TOKEN_LIBRARY2 ?? '').trim();
    default:
      return '';
  }
}

/**
 * The gate's configuration as an OUTSIDE observer can check it — what
 * `/api/health` reports (`routes/health.ts`), for the same reason it reports
 * `gabi.panel`: two instances serve one bundle from one commit, so "which
 * estate consumer is that Worker?" is otherwise a question only a signed-in
 * browser plus `wrangler tail` can answer, and F-5 was exactly that question
 * going unasked for a day.
 *
 * ⚠️ Names and booleans only — never a value, never a fingerprint of one.
 * `configured` says both halves of the config exist, NOT that the token's
 * value is the one the directory expects; only a real `/seen` call proves
 * that, and its proof is the tail line's `"src":"seen"`.
 */
export function describeEstateGate(env: GateEnv): {
  mode: EstateMode;
  app: EstateApp | null;
  tokenVar: string | null;
  configured: boolean;
} {
  const { mode } = parseEstateMode(env.ESTATE_CHECK);
  const { app, tokenVar } = resolveEstateApp(env.ESTATE_APP);
  const configured =
    app !== null && tokenVar !== null &&
    (env.ESTATE_AUTH_URL ?? '').trim() !== '' &&
    appTokenFrom(env, tokenVar) !== '';
  return { mode, app, tokenVar, configured };
}

/**
 * The roles a per-instance override may name — deliberately NARROWER than
 * `@lc/core`'s six-rung ladder (which this package cannot import; it is
 * core-free by design). This is a policy allowlist, not a duplicate of the
 * ladder: an auto-grant is the estate handing out standing with nobody in the
 * loop, and `admin`/`owner` must never be grantable by editing one var, while
 * `guest`/`pending` are not grants at all.
 */
const OVERRIDABLE_DEFAULT_ROLES = Object.freeze(['member', 'contributor', 'moderator']);

/**
 * The second-instance posture lever (friend-ingest-design.md §3): a wrangler
 * env may set `ESTATE_DEFAULT_ROLE` to change what role its auto-grant hands
 * out, so two instances of one codebase can hold different postures. Unset —
 * every instance today — means the declared posture's `member`, unchanged.
 * An unrecognised value falls back to the posture default (the inert
 * direction) and surfaces in the log line rather than silently, same
 * treatment as a typo'd ESTATE_CHECK.
 */
export function resolveDefaultRole(raw: string | undefined): {
  /** Nullable because the generated posture type allows a null defaultRole
   *  (a posture that auto-grants nothing); this library's declares `member`. */
  role: string | null;
  /** True only when a valid override is in effect. */
  overridden: boolean;
  /** The rejected raw value when one was set but not recognised, else null. */
  invalid: string | null;
} {
  const v = (raw ?? '').trim();
  if (v === '') return { role: LIBRARY_POSTURE.defaultRole, overridden: false, invalid: null };
  if (OVERRIDABLE_DEFAULT_ROLES.includes(v)) return { role: v, overridden: true, invalid: null };
  return { role: LIBRARY_POSTURE.defaultRole, overridden: false, invalid: v };
}

export type EstateMode = 'off' | 'shadow' | 'enforce';

export interface ParsedMode {
  mode: EstateMode;
  /** False when the raw value was set but is not one of the three words. */
  recognised: boolean;
}

/**
 * Unset and `'off'` are both off. An unrecognised value ('shdow', 'ON', a
 * stray space) is treated as OFF — the inert direction, which for a typo on
 * THIS flag means "behave exactly as before", never "enforce by accident" —
 * but flagged so the caller can log it: a typo that silently disabled the
 * check would otherwise read exactly like a clean bill of health.
 */
export function parseEstateMode(raw: string | undefined): ParsedMode {
  const v = (raw ?? '').trim();
  if (v === '' || v === 'off') return { mode: 'off', recognised: true };
  if (v === 'shadow') return { mode: 'shadow', recognised: true };
  if (v === 'enforce') return { mode: 'enforce', recognised: true };
  return { mode: 'off', recognised: false };
}

/** The env slice the gate reads. `Env` satisfies this structurally. */
export interface GateEnv {
  ESTATE_CHECK?: string;
  ESTATE_AUTH_URL?: string;
  /**
   * WHICH estate consumer this instance is — `library` (default, unset) or
   * `library2`. See the header. It selects both the asserted app id and the
   * name of the secret below that carries this instance's bearer.
   */
  ESTATE_APP?: string;
  /** The `library` bearer — the MAIN instance's. */
  ESTATE_APP_TOKEN_LIBRARY?: string;
  /**
   * The `library2` bearer — the FRIEND instance's, paired with the auth
   * Worker's secret of the same name. ⚠️ Setting this on the main instance
   * does nothing (its `ESTATE_APP` is `library`), and neither does setting
   * `ESTATE_APP_TOKEN_LIBRARY` on hers: the app id picks the var, so a token
   * in the wrong slot is inert rather than quietly wrong.
   */
  ESTATE_APP_TOKEN_LIBRARY2?: string;
  /** Per-instance auto-grant role override — see `resolveDefaultRole`. */
  ESTATE_DEFAULT_ROLE?: string;
}

/** What the gate needs to know about the already-resolved local user. */
export interface GateSubject {
  /** Lowercased — `app_user.email` already is. */
  email: string;
  firebaseUid: string | null;
  displayName: string | null;
  /** The local role, verbatim. `'pending'` is the one non-active value (§3.1). */
  role: string;
  /** `approved_at`: non-null = a local decision was stamped (§3.1 row 4). */
  approvedAt: string | null;
  /** The 0140 cache columns, as read from the row. */
  estateStatus: string | null;
  estateCheckedAt: string | null;
  /** The 0150 column: the cached §4.5 array as raw JSON text, or null. */
  estateVisibilityJson: string | null;
  /**
   * The 0440 column: the cached billing deny-set as raw JSON text, or null.
   *
   * 🔴 **null is UNKNOWN, not "nothing is denied"** — the load-bearing pin in
   * `test/billing-denied-shape.test.ts`. Optional so a caller built before
   * 0440 still compiles and behaves exactly as it did (it then always answers
   * unknown, which fails open, which is today's behaviour).
   */
  estateBillingDeniedJson?: string | null;
}

/** An enforce-mode refusal, ready for `c.json(body, status)`. */
export type GateDenial =
  | { status: 403; body: { error: 'estate_revoked' } }
  | { status: 503; body: { error: 'estate_unreachable'; detail: string } };

export interface GateOutcome {
  mode: EstateMode;
  /** True when a §3.1 verdict was actually computed. */
  performed: boolean;
  skipReason: 'mode_off' | 'estate_config_unset' | 'estate_app_unrecognised' | null;
  verdict: EstateVerdict | null;
  /**
   * Non-null ONLY in enforce, on the two refusing verdicts. The caller
   * returns it verbatim; in shadow the same rows surface as `wouldDeny`.
   */
  deny: GateDenial | null;
  /**
   * Non-null ONLY in enforce, on `default_grant`: the caller performs the
   * §5.4 grant (conditionally — a concurrent local decision wins) with the
   * estate-actor convention. In shadow the same row is `wouldAutoGrant`.
   */
  autoGrant: { role: string } | null;
  /**
   * True when enforce refuses / would refuse a request that succeeds under
   * local auth alone: `revoked`, or `estate_unreachable` (which only occurs
   * for non-standing users). `request_screen` is NOT a (would-)deny — a
   * local `pending` user already gets 403s from the capability layer today.
   * Meaningful in BOTH modes; it is the shadow soak's greppable gate and
   * enforce's `denied` log field.
   */
  wouldDeny: boolean;
  /** `'member'` when the verdict is `default_grant`. In shadow: logged only. */
  wouldAutoGrant: string | null;
  /**
   * Fresh /seen answer for the caller to persist onto the cache columns —
   * status + visibility together (§4.5's one-answer rule; both stamped by
   * the one `checkedAt`).
   */
  refresh: {
    status: EstateStatus;
    visibility: Catalog[] | null;
    billingDenied: string[] | null;
    checkedAt: string;
  } | null;
  /**
   * The EFFECTIVE billing deny-set for this person on this instance's site —
   * fresh, cached or stale, whichever the §5.2 protocol used, so it rides with
   * the very status the verdict was computed from (§4.5's one answer, one
   * moment). This is what a money route reads.
   *
   * 🔴 **null is UNKNOWN and UNKNOWN PROCEEDS** (§3.5 row 3, chosen out loud):
   * with the directory unreachable and no cache, every paid feature stays
   * available, because denying them would turn an auth outage into a
   * household-wide "everything is broken". `[]` is the other fact — the
   * directory answered and denied nothing. The two never collapse.
   */
  billingDenied: string[] | null;
  /** One JSON line for the caller to `console.log`, or null (pure off). */
  logLine: string | null;
}

const SKIPPED: Omit<GateOutcome, 'mode' | 'skipReason' | 'logLine'> = {
  performed: false,
  verdict: null,
  deny: null,
  autoGrant: null,
  wouldDeny: false,
  wouldAutoGrant: null,
  refresh: null,
  // ⚠️ A SKIPPED gate answers UNKNOWN, never `[]`. `ESTATE_CHECK = off`, a
  // missing bearer or an unrecognised `ESTATE_APP` are all "no answer was
  // sought", not "the directory denied nothing" — and a money route reading
  // `[]` from an off gate would believe a fact nobody established.
  billingDenied: null,
};

/**
 * Run the estate check at the strength `ESTATE_CHECK` allows and return what
 * to do about it. Pure orchestration over the canonical module: cache-or-/seen
 * (§5.2, via `estateCheck`) then the §3.1 table (`combineEstateAndLocal`),
 * with the library's local standing derived as `active = role !== 'pending'`,
 * `locallyDecided = approved_at IS NOT NULL`.
 *
 * Never throws on estate trouble — an unreachable directory is an ANSWER
 * (`estate_unreachable`) in this protocol, not an error. The caller still
 * wraps the call defensively; an unexpected throw there degrades to
 * local-only auth (§6 row 1's direction), loudly.
 */
export async function estateGateCheck(
  env: GateEnv,
  subject: GateSubject,
  opts: { fetchImpl?: typeof fetch; nowMs?: number } = {},
): Promise<GateOutcome> {
  const { mode, recognised } = parseEstateMode(env.ESTATE_CHECK);
  const identity = resolveEstateApp(env.ESTATE_APP);
  // Shadow-mode lines keep the soak's documented `estate_shadow` tag
  // byte-compatible; enforce gets its own greppable stream.
  const tag = mode === 'enforce' ? 'estate_enforce' : 'estate_shadow';

  if (mode === 'off') {
    // Pure off is silent — an inert deploy must not chatter. An unrecognised
    // value is off WITH its name in the log, so the typo is findable.
    const logLine = recognised
      ? null
      : JSON.stringify({
          tag,
          app: identity.app,
          event: 'mode_unrecognised',
          estate_check_raw: env.ESTATE_CHECK ?? null,
          treated_as: 'off',
        });
    return { ...SKIPPED, mode, skipReason: 'mode_off', logLine };
  }

  // A set-but-unrecognised ESTATE_APP is off, loudly — never a fallback to
  // `library`, which on the friend instance is precisely the wrong answer.
  if (identity.app === null || identity.tokenVar === null) {
    return {
      ...SKIPPED,
      mode,
      skipReason: 'estate_app_unrecognised',
      logLine: JSON.stringify({
        tag,
        app: null,
        mode,
        event: 'estate_app_unrecognised',
        estate_app_raw: identity.invalid,
        allowed: [...ESTATE_APPS],
        treated_as: 'off',
        note: 'behaving as off — this instance will not assert an identity it cannot name',
      }),
    };
  }

  const baseUrl = (env.ESTATE_AUTH_URL ?? '').trim();
  const appToken = appTokenFrom(env, identity.tokenVar);
  if (!baseUrl || !appToken) {
    const missing = [
      ...(baseUrl ? [] : ['ESTATE_AUTH_URL']),
      ...(appToken ? [] : [identity.tokenVar]),
    ];
    return {
      ...SKIPPED,
      mode,
      skipReason: 'estate_config_unset',
      logLine: JSON.stringify({
        tag,
        app: identity.app,
        mode,
        event: 'estate_config_unset',
        missing,
        note: 'behaving as off — no /seen call attempted, nothing refused',
      }),
    };
  }

  const nowMs = opts.nowMs ?? Date.now();

  // Time the /seen call when one happens (design §15 asked the rollout to
  // measure Worker-to-Worker latency; enforce keeps reporting it).
  let seenMs: number | null = null;
  const inner = opts.fetchImpl ?? fetch;
  const timedFetch: typeof fetch = async (input, init) => {
    const t0 = Date.now();
    try {
      return await inner(input, init);
    } finally {
      seenMs = Date.now() - t0;
    }
  };

  const result = await estateCheck(
    {
      status: isEstateStatus(subject.estateStatus) ? subject.estateStatus : null,
      checkedAt: subject.estateCheckedAt,
      visibility: parseCachedVisibility(subject.estateVisibilityJson),
      billingDenied: parseCachedBillingDenied(subject.estateBillingDeniedJson ?? null),
    },
    {
      email: subject.email,
      firebaseUid: subject.firebaseUid,
      displayName: subject.displayName,
      // ⚠️ The app's CLAIM about its own user's rung (billing design §3.4), so
      // the directory can resolve `role`-principal deny rules — it does not
      // hold this app's ladder and cannot ask. The trust level is right
      // because policy can only DENY: a wrong claim can close something, never
      // open it. Omit it and role rules are skipped; user and everyone rules
      // still apply, which is what an old consumer mid-deploy does.
      localRole: subject.role,
    },
    { baseUrl, appToken, fetchImpl: timedFetch },
    nowMs,
  );

  const verdict = combineEstateAndLocal(result.status, {
    active: subject.role !== 'pending',
    locallyDecided: subject.approvedAt !== null,
  });

  const wouldDeny = verdict === 'revoked' || verdict === 'estate_unreachable';
  const defaultRole = resolveDefaultRole(env.ESTATE_DEFAULT_ROLE);
  const wouldAutoGrant = verdict === 'default_grant' ? defaultRole.role : null;

  // The enforce directives — null everywhere except the acting mode.
  let deny: GateDenial | null = null;
  let autoGrant: { role: string } | null = null;
  if (mode === 'enforce') {
    if (verdict === 'revoked') {
      deny = { status: 403, body: { error: 'estate_revoked' } };
    } else if (verdict === 'estate_unreachable') {
      deny = {
        status: 503,
        body: {
          error: 'estate_unreachable',
          detail: 'the estate directory did not answer and no admission stands; try again shortly',
        },
      };
    } else if (verdict === 'default_grant' && wouldAutoGrant) {
      autoGrant = { role: wouldAutoGrant };
    }
  }

  // Where the status came from, for reading an incident later: 'seen' = fresh
  // call answered; 'cache' = fresh cache, no call; 'stale_cache' = call failed,
  // rode the old value (§6 row 1); 'none' = no answer exists at all.
  const src = result.refresh
    ? 'seen'
    : result.stale
      ? 'stale_cache'
      : result.status !== null
        ? 'cache'
        : 'none';

  return {
    mode,
    performed: true,
    skipReason: null,
    verdict,
    deny,
    autoGrant,
    wouldDeny,
    wouldAutoGrant,
    refresh: result.refresh,
    billingDenied: result.billingDenied,
    logLine: JSON.stringify({
      tag,
      // ⚠️ The identity this instance ASSERTED, from ESTATE_APP — not the
      // posture's baked-in `library`. This field is the greppable proof of the
      // F-5 fix in `wrangler tail`: hers must read "library2".
      app: identity.app,
      mode,
      email: subject.email,
      local_role: subject.role,
      estate: result.status,
      src,
      visibility: result.visibility,
      // ⚠️ Logged as the ARRAY, so `null` (unknown) and `[]` (the directory
      // denied nothing) stay distinguishable in `wrangler tail` too. Reading a
      // count would collapse exactly the distinction this phase rests on.
      billing_denied: result.billingDenied,
      verdict,
      // Only present when ESTATE_DEFAULT_ROLE is set — the main instance's
      // lines stay byte-shaped as before. An invalid value is loud here so a
      // typo'd posture flip never reads as a clean bill of health.
      ...(defaultRole.overridden ? { default_role_override: defaultRole.role } : {}),
      ...(defaultRole.invalid !== null
        ? { default_role_invalid: defaultRole.invalid, default_role_used: defaultRole.role }
        : {}),
      ...(mode === 'enforce'
        ? {
            // Enforce vocabulary: what IS happening, not what would.
            denied: deny !== null,
            auto_grant: autoGrant?.role ?? null,
          }
        : {
            would_deny: wouldDeny,
            would_auto_grant: wouldAutoGrant,
          }),
      seen_ms: seenMs,
    }),
  };
}

/**
 * The cached 0150 column crossed a network AND a database — parse it like the
 * untrusted text it is. Unparseable JSON or a non-§4.5 shape dies into null
 * ("no visibility fact"), which at worst costs one healing /seen call.
 */
function parseCachedVisibility(raw: string | null): Catalog[] | null {
  if (raw === null) return null;
  try {
    return parseVisibility(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * The cached 0440 column, parsed like the untrusted text it is — same
 * treatment as `parseCachedVisibility` one function up, and the same failure
 * direction.
 *
 * 🔴 THE `null` / `[]` DISTINCTION IS PRESERVED HERE ON PURPOSE, and it is the
 * one thing this function exists to get right. A stored `'[]'` parses to `[]`
 * — *the directory answered and denied nothing*, a fact a money route may act
 * on. Anything else that is not a clean array of non-empty strings — a NULL
 * column, unparseable text, a number, an object — dies into `null`, which is
 * UNKNOWN, which proceeds. Non-string entries inside an otherwise good array
 * are dropped rather than voiding the whole list, because refusing the list on
 * one bad entry would fail in the ALLOWING direction, which for a deny-list is
 * the wrong way round: the ids the directory did name are still names it meant.
 * Mirrors `postSeenAnswer`'s wire parser exactly; the pins are in
 * `test/billing-denied-shape.test.ts`.
 */
function parseCachedBillingDenied(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return null;
  }
}
