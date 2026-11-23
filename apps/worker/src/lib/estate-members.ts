/**
 * THE ESTATE ROSTER — who the estate has approved, for the lend picker.
 *
 * Owner request, verbatim (2026-11-22): *"I want you to write code to allow me
 * to lend books to estate members even if they can't view it. Pulling accounts
 * from estate is fine for assignment."*
 *
 *     GET /api/estate/members      Authorization: Bearer <this app's token>
 *     → 200 { members: [ { id, email, display_name } ] }   approved members only
 *
 * The structure is `billing-system.ts`'s, deliberately: the same identity
 * resolution (`resolveEstateApp`), the same greppable token `switch`, a
 * timeout, an injectable `fetchImpl`, and it never throws.
 *
 * 🔴 **`null` IS "UNKNOWN", AND IT IS NOT `[]`.** A non-200, a 404 from an auth
 * Worker that predates the route, a body of the wrong shape, a timeout, or an
 * unset token all answer `null`. `[]` is the directory replying that nobody is
 * approved. The picker says "estate list unavailable" for the first and shows
 * nothing extra for the second; the save path REFUSES on `null` — it never
 * links someone it could not confirm is still approved.
 *
 * ⚠️ The emails in this answer never leave the Worker. `routes/users.ts`
 * dedupes on them and hands the browser an opaque `estateId` + a name.
 */

import { resolveEstateApp, APP_TOKEN_VAR } from '@lc/estate-auth';
import type { Env } from '../env.js';

/** How long `GET /api/estate/members` may hang before the picker gives up on it. */
const ROSTER_TIMEOUT_MS = 5_000;

/** One approved estate member, validated. `estateId` is the directory's id, as text. */
export interface EstateMember {
  estateId: string;
  /** Lower-cased and trimmed — `findUserByEmail`'s normalisation. Server-side only. */
  email: string;
  /** Trimmed; `null` when the directory has no name (such entries are never offered). */
  displayName: string | null;
}

/**
 * Validate one roster element. Anything not shaped like the contract is
 * dropped rather than coerced — a half-understood entry is not a person to
 * lend a book to.
 */
function toMember(raw: unknown): EstateMember | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as { id?: unknown; email?: unknown; display_name?: unknown };

  let estateId: string | null = null;
  if (typeof r.id === 'number' && Number.isSafeInteger(r.id) && r.id > 0) estateId = String(r.id);
  else if (typeof r.id === 'string' && r.id.trim() !== '' && r.id.length <= 200) estateId = r.id.trim();
  if (estateId === null) return null;

  if (typeof r.email !== 'string') return null;
  const email = r.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null;

  let displayName: string | null = null;
  if (typeof r.display_name === 'string') displayName = r.display_name.trim() || null;
  else if (r.display_name !== null && r.display_name !== undefined) return null;

  return { estateId, email, displayName };
}

/**
 * Fetch the approved estate roster for this instance's app.
 *
 * Never throws: every failure is `null` plus (for configuration gaps) one log
 * line, so a picker request degrades to local names instead of erroring.
 */
export async function fetchEstateMembers(
  env: Env,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<EstateMember[] | null> {
  const baseUrl = (env.ESTATE_AUTH_URL ?? '').trim();
  const identity = resolveEstateApp(env.ESTATE_APP);
  if (identity.app === null || identity.tokenVar === null) return null;

  // A switch, not an index expression — the set of secrets this module may
  // read stays greppable, exactly as in `billing-system.ts`.
  const token =
    identity.tokenVar === APP_TOKEN_VAR.library
      ? (env.ESTATE_APP_TOKEN_LIBRARY ?? '').trim()
      : identity.tokenVar === APP_TOKEN_VAR.library2
        ? (env.ESTATE_APP_TOKEN_LIBRARY2 ?? '').trim()
        : '';

  if (!baseUrl || !token) {
    console.warn(
      `estate_members: roster door not configured (need ESTATE_AUTH_URL + ${identity.tokenVar}) — roster unknown`,
    );
    return null;
  }

  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const resp = await doFetch(`${baseUrl.replace(/\/+$/, '')}/api/estate/members`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(ROSTER_TIMEOUT_MS),
    });
    if (resp.status !== 200) {
      console.warn(`estate_members: roster door answered ${resp.status} — roster unknown`);
      return null;
    }
    const body: unknown = await resp.json();
    const raw = (body as { members?: unknown } | null)?.members;
    // Not an array is not an answer — never read silence as "nobody".
    if (!Array.isArray(raw)) return null;
    const out: EstateMember[] = [];
    const seen = new Set<string>();
    for (const el of raw) {
      const m = toMember(el);
      // A repeated id is the directory contradicting itself; keep the first.
      if (m && !seen.has(m.estateId)) {
        seen.add(m.estateId);
        out.push(m);
      }
    }
    return out;
  } catch {
    return null;
  }
}
