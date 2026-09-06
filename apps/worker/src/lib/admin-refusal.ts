/**
 * The owner-or-admin gate on the operator verbs, worded once.
 *
 * ## Why this is a module and not a copy in each route file
 *
 * It was a private function in `routes/audiobook-sweep.ts` until 2026-09-06,
 * when the two standing audits gained admin routes of their own. Copying it
 * would have made three near-identical refusals — and a refusal is exactly the
 * kind of text that drifts: one file gains the pending-account branch, another
 * keeps saying "ask an owner" to somebody whose account has not been approved
 * yet, and the person is sent to ask for a role that would not help them.
 *
 * ## The estate rule this implements
 *
 * ⚠️ **A person must NEVER see a bare HTTP status.** Every refusal says three
 * things:
 *
 * 1. **what happened** — in words, not a number;
 * 2. **what it needs** — the capability BY NAME, so an owner reading it over
 *    somebody's shoulder knows what to grant;
 * 3. **how to get it** — the actual page, and the alternative when there is one.
 *
 * ⚠️ And the four causes stay DISTINCT, because their fixes differ: not signed
 * in (handled upstream by `requireAuth`) / awaiting approval / insufficient role
 * / revoked. Collapsing the middle two is the specific mistake this function
 * exists to stop being made three times.
 *
 * ⚠️ `manageUsers` is checked BY NAME rather than by role, the same reasoning
 * `requireCapability` carries: adding a role later must not mean auditing every
 * operator route to find out who can suddenly reach it.
 */

import type { Context } from 'hono';
import { can } from '@lc/core';
import type { AppBindings } from '../env.js';

export interface AdminRefusalWording {
  /**
   * What the caller was trying to do, as a sentence subject —
   * `'Running the audiobook sweep'`, `'Running the cover-health audit'`.
   */
  job: string;
  /**
   * The reassurance that follows *"or ask them to run it for you"*. It should
   * say why handing the job to somebody else costs the asker nothing.
   */
  reassurance: string;
}

/**
 * `null` when the caller may proceed; a worded 403 when they may not.
 *
 * ⚠️ Returns the response rather than throwing it, so a route reads
 * `const refusal = refuseUnlessAdmin(c, …); if (refusal) return refusal;` —
 * one line, impossible to forget silently, and it keeps the refusal on the
 * route's own return path where `app.onError` can never turn it into a 500.
 */
export function refuseUnlessAdmin(
  c: Context<AppBindings>,
  wording: AdminRefusalWording,
) {
  const user = c.get('user');
  if (can(user.role, 'manageUsers')) return null;
  return c.json(
    {
      error: 'forbidden',
      capability: 'manageUsers',
      role: user.role,
      detail:
        user.role === 'pending'
          ? 'Your account is still waiting for an owner to approve it, so nothing here is ' +
            'available yet. An owner approves accounts on the People page.'
          : `${wording.job} is an owner-or-admin job, and your account is ` +
            `'${user.role}'. Ask an owner to change your role on the People page — or ask ` +
            `them to run it for you; ${wording.reassurance}`,
    },
    403,
  );
}
