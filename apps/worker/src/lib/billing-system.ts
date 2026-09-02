/**
 * THE SYSTEM DOOR — the spending gate for the paths that have no human.
 *
 * `POST /api/estate/seen` answers *"what may THIS PERSON spend on"*, and the
 * hourly details sweep (L8) has no person to ask about: it is fired by a cron,
 * it has no request, no email and no session. ⚠️ Modelling it as `everyone`
 * would mean that switching a cron off also switched the whole household off,
 * which is the opposite of what the owner would mean — so the estate carries a
 * fourth principal, `system`, and its own door:
 *
 *     GET /api/estate/billing/policy      Authorization: Bearer <this app's token>
 *     → { site, system_denied: string[], cache_seconds: 600 }
 *
 * ⚠️ THREE CALLERS, ONE RESOLVER (billing design §3.4). This is not a second
 * implementation of the policy rules — the auth Worker resolves the same table
 * through the same function it uses for `/seen`, and answers an already-resolved
 * set. This module presents a bearer and reads an array; it decides nothing.
 *
 * 🔴 Switching `sweep.details` off is the ONLY control in the estate that stops
 * an unattended hourly biller without a deploy. That is what makes this file
 * worth its own network call once an hour.
 */

import { resolveEstateApp, APP_TOKEN_VAR } from '@lc/estate-auth';
import type { Env } from '../env.js';

/** How long a `GET /billing/policy` may hang before the sweep gives up on it. */
const POLICY_TIMEOUT_MS = 5_000;

/**
 * Fetch the `system` deny-set for this instance's site.
 *
 * 🔴 RETURNS `null` FOR "UNKNOWN", AND UNKNOWN PROCEEDS — §3.5 row 3, the same
 * fail-open direction every other consumer of this policy takes, chosen out
 * loud. An unreachable directory must not stop the sweep: the alternative turns
 * an auth outage into a silently-halted pipeline nobody is watching, and the
 * wallet is bounded here by `SWEEP_LIMIT` and `SWEEP_BUDGET`, not by this
 * switch. *A policy that can only deny cannot be depended on to fail closed.*
 *
 * `[]` is the other fact — the directory answered and denied nothing — and the
 * two are kept distinguishable all the way down, exactly as they are on `/seen`
 * (`packages/estate-auth/test/billing-denied-shape.test.ts`).
 *
 * Never throws. A scheduled invocation has no response to put an error in, so
 * every failure becomes `null` plus one log line.
 */
export async function fetchSystemDenied(
  env: Env,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<string[] | null> {
  const baseUrl = (env.ESTATE_AUTH_URL ?? '').trim();
  const identity = resolveEstateApp(env.ESTATE_APP);
  if (identity.app === null || identity.tokenVar === null) return null;

  // A switch, not an index expression, for the same reason the gate uses one:
  // the set of secrets this module may read stays greppable, and no future var
  // name can be reached by data.
  const token =
    identity.tokenVar === APP_TOKEN_VAR.library
      ? (env.ESTATE_APP_TOKEN_LIBRARY ?? '').trim()
      : identity.tokenVar === APP_TOKEN_VAR.library2
        ? (env.ESTATE_APP_TOKEN_LIBRARY2 ?? '').trim()
        : '';

  if (!baseUrl || !token) {
    // Named rather than silent: a half-configured system gate that said nothing
    // would read as "nothing is denied", which is false comfort of exactly the
    // kind shadow mode exists to prevent.
    console.warn(
      `billing_policy: system door not configured (need ESTATE_AUTH_URL + ${identity.tokenVar}) — treating the policy as unknown`,
    );
    return null;
  }

  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const resp = await doFetch(`${baseUrl.replace(/\/+$/, '')}/api/estate/billing/policy`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(POLICY_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn(`billing_policy: system door answered ${resp.status} — policy unknown`);
      return null;
    }
    const body: unknown = await resp.json();
    const raw = (body as { system_denied?: unknown } | null)?.system_denied;
    // ⚠️ Not an array is not an answer. Coercing a string into a one-element
    // deny-list would switch off a sweep nobody named.
    if (!Array.isArray(raw)) return null;
    return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return null;
  }
}
