/**
 * The library's SHADOW-MODE estate check — design §14.5 / §9 step 5.
 *
 * ⚠️ SHADOW MEANS SHADOW. This module computes what the §3.1 combination table
 * WOULD decide and shapes one greppable log line saying so. It never touches a
 * response, never writes a role, never grants anything. The only writes its
 * caller performs on its behalf are the two §5.2 cache columns on `app_user`
 * (`estate_status`, `estate_checked_at`, migration 0140) — the cache is the
 * protocol's own bookkeeping, not an enforcement act.
 *
 * The mode flag (`ESTATE_CHECK`):
 *
 *   off      — (deployed default) nothing happens: no /seen call, no DB read,
 *              no log. The deploy carrying this code is inert until the
 *              dispatcher flips the var.
 *   shadow   — observe and log, enforce nothing. Run days-not-hours; grep the
 *              tail for `"would_deny":true` lines and expect ZERO for household
 *              members before anyone considers `enforce` (§14.5).
 *   enforce  — ⚠️ NOT BUILT in this revision, deliberately: this build's whole
 *              contract is "change no response". Setting it logs a loud
 *              `enforce_requested` marker on every line and behaves as shadow,
 *              so a premature flip is visible and harmless rather than either
 *              silently ignored or half-enforced.
 *
 * Missing `ESTATE_AUTH_URL` / `ESTATE_APP_TOKEN_LIBRARY` while the mode asks
 * for shadow IS the off state, with its name in the log: one
 * `estate_config_unset` line per request, no fetch ever attempted. That is the
 * sane behaviour the rollout depends on — the code deploys before the secret
 * exists (§14.5: the secret is set at the dispatcher's deploy step).
 */

import {
  combineEstateAndLocal,
  type EstateStatus,
  type EstateVerdict,
  isEstateStatus,
} from '../generated/combine.js';
import { estateCheck } from '../generated/seen.js';
import { declareAuthPosture } from '../generated/config.js';

/**
 * The per-surface posture declaration (owner decisions #1 and #2): the library
 * is NOT public, and one estate approval would auto-grant its designed guest
 * role `reader` (read + own read-state + rate — §5.4). In shadow the grant is
 * NEVER performed; it surfaces only as `"would_auto_grant":"reader"` in the
 * log, which is precisely requirement (2) of the §14.5 build: config present,
 * visible, inert.
 */
export const LIBRARY_POSTURE = declareAuthPosture({
  public: false,
  app: 'library',
  defaultRole: 'reader',
});

export type EstateMode = 'off' | 'shadow' | 'enforce';

export interface ParsedMode {
  mode: EstateMode;
  /** False when the raw value was set but is not one of the three words. */
  recognised: boolean;
}

/**
 * Unset and `'off'` are both off. An unrecognised value ('shdow', 'ON', a
 * stray space) is treated as OFF — the inert direction — but flagged so the
 * caller can log it: a typo that silently disabled observation would otherwise
 * read exactly like a clean bill of health.
 */
export function parseEstateMode(raw: string | undefined): ParsedMode {
  const v = (raw ?? '').trim();
  if (v === '' || v === 'off') return { mode: 'off', recognised: true };
  if (v === 'shadow') return { mode: 'shadow', recognised: true };
  if (v === 'enforce') return { mode: 'enforce', recognised: true };
  return { mode: 'off', recognised: false };
}

/** The env slice the shadow check reads. `Env` satisfies this structurally. */
export interface ShadowEnv {
  ESTATE_CHECK?: string;
  ESTATE_AUTH_URL?: string;
  ESTATE_APP_TOKEN_LIBRARY?: string;
}

/** What the shadow check needs to know about the already-resolved local user. */
export interface ShadowSubject {
  /** Lowercased — `app_user.email` already is. */
  email: string;
  firebaseUid: string | null;
  displayName: string | null;
  /** The local role, verbatim. `'pending'` is the one non-active value (§3.1). */
  role: string;
  /** `approved_at`: non-null = a local decision was stamped (§3.1 row 4). */
  approvedAt: string | null;
  /** The two 0140 cache columns, as read from the row. */
  estateStatus: string | null;
  estateCheckedAt: string | null;
}

export interface ShadowOutcome {
  /** True when a §3.1 verdict was actually computed. */
  performed: boolean;
  skipReason: 'mode_off' | 'estate_config_unset' | null;
  verdict: EstateVerdict | null;
  /**
   * True when enforce mode WOULD have refused this request that today
   * succeeds: `revoked`, or `estate_unreachable` (which only occurs for
   * non-standing users). `request_screen` is NOT a would-deny — a local
   * `pending` user already gets 403s from the capability layer today, so
   * nothing would change for them.
   */
  wouldDeny: boolean;
  /** `'reader'` when the verdict is `default_grant`. Logged, never written. */
  wouldAutoGrant: string | null;
  /** Fresh /seen answer for the caller to persist onto the cache columns. */
  refresh: { status: EstateStatus; checkedAt: string } | null;
  /** One JSON line for the caller to `console.log`, or null (pure off). */
  logLine: string | null;
}

const SKIPPED: Omit<ShadowOutcome, 'skipReason' | 'logLine'> = {
  performed: false,
  verdict: null,
  wouldDeny: false,
  wouldAutoGrant: null,
  refresh: null,
};

/**
 * Compute the shadow verdict. Pure orchestration over the canonical module:
 * cache-or-/seen (§5.2, via `estateCheck`) then the §3.1 table
 * (`combineEstateAndLocal`), with the library's local standing derived as
 * `active = role !== 'pending'`, `locallyDecided = approved_at IS NOT NULL`.
 *
 * Never throws on estate trouble — an unreachable directory is an ANSWER
 * (`estate_unreachable`) in this protocol, not an error. The caller still
 * wraps the call defensively; in shadow, no failure may reach a response.
 */
export async function estateShadowCheck(
  env: ShadowEnv,
  subject: ShadowSubject,
  opts: { fetchImpl?: typeof fetch; nowMs?: number } = {},
): Promise<ShadowOutcome> {
  const { mode, recognised } = parseEstateMode(env.ESTATE_CHECK);

  if (mode === 'off') {
    // Pure off is silent — an inert deploy must not chatter. An unrecognised
    // value is off WITH its name in the log, so the typo is findable.
    const logLine = recognised
      ? null
      : JSON.stringify({
          tag: 'estate_shadow',
          app: LIBRARY_POSTURE.app,
          event: 'mode_unrecognised',
          estate_check_raw: env.ESTATE_CHECK ?? null,
          treated_as: 'off',
        });
    return { ...SKIPPED, skipReason: 'mode_off', logLine };
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
      skipReason: 'estate_config_unset',
      logLine: JSON.stringify({
        tag: 'estate_shadow',
        app: LIBRARY_POSTURE.app,
        mode,
        event: 'estate_config_unset',
        missing,
        note: 'behaving as off — no /seen call attempted',
      }),
    };
  }

  const nowMs = opts.nowMs ?? Date.now();

  // Time the /seen call when one happens (design §15 asks shadow to measure
  // it — Worker-to-Worker latency on same-zone custom domains has never been).
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
    performed: true,
    skipReason: null,
    verdict,
    wouldDeny,
    wouldAutoGrant,
    refresh: result.refresh,
    logLine: JSON.stringify({
      tag: 'estate_shadow',
      app: LIBRARY_POSTURE.app,
      mode,
      email: subject.email,
      local_role: subject.role,
      estate: result.status,
      src,
      verdict,
      would_deny: wouldDeny,
      would_auto_grant: wouldAutoGrant,
      seen_ms: seenMs,
      ...(mode === 'enforce'
        ? {
            enforce_requested: true,
            note: 'enforcement is NOT built in this revision; behaving as shadow',
          }
        : {}),
    }),
  };
}
