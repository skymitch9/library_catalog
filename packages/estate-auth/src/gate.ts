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
 *  - Missing `ESTATE_AUTH_URL` / `ESTATE_APP_TOKEN_LIBRARY` while the mode
 *    asks for shadow OR enforce IS the off state, with its name in the log —
 *    the code deploys before the secret exists, and a half-configured enforce
 *    must fail into "today's behaviour", never into a lockout.
 *
 * ## Visibility rides along (§4.5)
 *
 * The /seen answer carries the EFFECTIVE visibility set beside the status;
 * the one-answer rule says the two are cached and aged together. The gate
 * parses the cached JSON at the boundary (`parseVisibility` — garbage dies
 * into null here, not at query time), hands the canonical array back in
 * `refresh` for the caller to persist, and logs it. Nothing in THIS app
 * scopes on it today — the library's own authorization stays `role`.
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
  ESTATE_APP_TOKEN_LIBRARY?: string;
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
}

/** An enforce-mode refusal, ready for `c.json(body, status)`. */
export type GateDenial =
  | { status: 403; body: { error: 'estate_revoked' } }
  | { status: 503; body: { error: 'estate_unreachable'; detail: string } };

export interface GateOutcome {
  mode: EstateMode;
  /** True when a §3.1 verdict was actually computed. */
  performed: boolean;
  skipReason: 'mode_off' | 'estate_config_unset' | null;
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
  refresh: { status: EstateStatus; visibility: Catalog[] | null; checkedAt: string } | null;
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
          app: LIBRARY_POSTURE.app,
          event: 'mode_unrecognised',
          estate_check_raw: env.ESTATE_CHECK ?? null,
          treated_as: 'off',
        });
    return { ...SKIPPED, mode, skipReason: 'mode_off', logLine };
  }

  const baseUrl = (env.ESTATE_AUTH_URL ?? '').trim();
  const appToken = (env.ESTATE_APP_TOKEN_LIBRARY ?? '').trim();
  if (!baseUrl || !appToken) {
    const missing = [
      ...(baseUrl ? [] : ['ESTATE_AUTH_URL']),
      ...(appToken ? [] : ['ESTATE_APP_TOKEN_LIBRARY']),
    ];
    return {
      ...SKIPPED,
      mode,
      skipReason: 'estate_config_unset',
      logLine: JSON.stringify({
        tag,
        app: LIBRARY_POSTURE.app,
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
    },
    {
      email: subject.email,
      firebaseUid: subject.firebaseUid,
      displayName: subject.displayName,
    },
    { baseUrl, appToken, fetchImpl: timedFetch },
    nowMs,
  );

  const verdict = combineEstateAndLocal(result.status, {
    active: subject.role !== 'pending',
    locallyDecided: subject.approvedAt !== null,
  });

  const wouldDeny = verdict === 'revoked' || verdict === 'estate_unreachable';
  const wouldAutoGrant = verdict === 'default_grant' ? LIBRARY_POSTURE.defaultRole : null;

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
    logLine: JSON.stringify({
      tag,
      app: LIBRARY_POSTURE.app,
      mode,
      email: subject.email,
      local_role: subject.role,
      estate: result.status,
      src,
      visibility: result.visibility,
      verdict,
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
