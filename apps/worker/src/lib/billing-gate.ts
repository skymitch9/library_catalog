/**
 * THE CALL-SITE GATE for this Worker's money paths — phase 3 of
 * `catalog-platform/docs/info/llm-billing-control-design.md`, and the fix for
 * `docs/KNOWN_ISSUES.md` KI-13 (*"this repo receives `billing_denied` and
 * throws it away"*).
 *
 * The template is `catalog-platform/apps/index-worker/src/billing-gate.ts`,
 * which gated E6. This file is its library twin and departs from it in exactly
 * two places, both forced by this codebase:
 *
 *   1. ⚠️ **The site is not a constant.** One build runs as TWO estate
 *      consumers — `library` (library.heygabi.ai) and `library2`
 *      (padhard.heygabi.ai) — and they are separate sites in the policy table,
 *      on separate Anthropic keys, spending separate money. The site is read
 *      from `ESTATE_APP` through `resolveEstateApp`, the SAME resolver the
 *      estate gate uses, so the two identities cannot drift apart. Hard-coding
 *      `'library'` here would be estate-credentials F-5 all over again: her
 *      instance asserting his identity, and a switch the owner pressed on
 *      padhard doing nothing.
 *   2. **The deny-set is read from the request context**, put there by
 *      `middleware/auth.ts` out of the cached `/seen` answer, rather than from
 *      a scope middleware.
 *
 * ⚠️ IT SHIPS `BILLING_POLICY = "off"` AND MUST. `off` → nothing resolves and
 * nothing is logged; `shadow` → the decision is logged WITH ITS OUTCOME and the
 * call proceeds and bills; `enforce` → a deny refuses, in words. A site is
 * flipped one at a time and never as a side effect of an unrelated deploy
 * (§4.2). ⚠️ Two instances means TWO flips: `[vars]` and `[env.friend.vars]`.
 *
 * ⚠️ THE SHADOW LINE CARRIES `proceeded`, AND THAT FIELD IS THE WHOLE POINT.
 * The estate paid for this lesson once (`info/audiobook-auth-soak-2026-08-16.md`):
 * `reportGate()` fired from a `finally` with no outcome field, the tail could
 * not separate a true regression from the gate merely agreeing with today's
 * rules, and the verdict was *NOT ENOUGH EVIDENCE, do not flip*. A soak whose
 * criterion cannot be falsified is not a soak.
 *
 * 🔴 THIS NEVER GRANTS. It answers "does policy say no", and the caller ANDs
 * that with the gate it already had — `requireCapability('runResearch')`,
 * `requireCapability('scanPhoto')`, the `ANTHROPIC_API_KEY` presence check, the
 * `GABI_PANEL` posture. Removing any of those because this exists would be
 * exactly backwards (§3.3: the gates are ANDed, never replaced).
 */

import type { Context } from 'hono';
import { resolveEstateApp } from '@lc/estate-auth';
import type { AppBindings, Env } from '../env.js';

export const BILLING_POSTURES = ['off', 'shadow', 'enforce'] as const;
export type BillingPosture = (typeof BILLING_POSTURES)[number];

/**
 * ⚠️ ANYTHING UNRECOGNISED FALLS TO `off` AND LOGS. Copied deliberately from
 * the index Worker's gate, which copied it from games' `ESTATE_CHECK`
 * coercion, rather than reinvented — a typo in a wrangler var must not
 * silently half-enable a money gate, and must not be silent about it either.
 */
export function billingPosture(raw: string | undefined): BillingPosture {
  if (raw === undefined || raw === '') return 'off';
  const v = raw.trim().toLowerCase();
  if ((BILLING_POSTURES as readonly string[]).includes(v)) return v as BillingPosture;
  console.warn(
    `BILLING_POLICY is "${raw}", which is not off|shadow|enforce — treating it as "off"`,
  );
  return 'off';
}

/**
 * The estate site id THIS instance spends against — `library` or `library2`.
 *
 * ⚠️ Derived from `ESTATE_APP` through the estate gate's own resolver, so the
 * identity this Worker asserts at `/seen` and the site its spending policy is
 * read for are one decision, not two that can disagree. An unrecognised value
 * resolves to `null` there and to `null` here, and a null site is treated as
 * "no site" — the gate skips, loudly, in `billingRefusal`. Failing into
 * today's behaviour is the direction every flag in this codebase falls.
 */
export function billingSite(env: Pick<Env, 'ESTATE_APP'>): string | null {
  return resolveEstateApp(env.ESTATE_APP).app;
}

/** The registry ids this Worker checks. */
export const BILLING_FEATURES = {
  details: 'research.details',
  covers: 'research.covers',
  series: 'research.series',
  scanPhoto: 'scan.photo',
  gabiPanel: 'gabi.panel',
  sweep: 'sweep.details',
} as const;

export interface BillingRefusal {
  body: Record<string, unknown>;
  status: 403;
}

/**
 * The pure half — decide and describe, touching no context and no Response, so
 * every row of the truth table is a plain unit test. `denied` is the resolved
 * deny-set as the cache handed it over.
 *
 * 🔴 `denied === null` IS "UNKNOWN" AND UNKNOWN PROCEEDS. §3.5 row 3, chosen
 * out loud: denying every paid feature when the directory is unreachable turns
 * an auth outage into a household-wide "everything is broken", which is the
 * failure the estate's wording rule exists to prevent. `[]` is the other fact
 * — the directory answered and denied nothing — and it proceeds for a
 * different reason. The two never collapse into one another, which is the pin
 * `packages/estate-auth/test/billing-denied-shape.test.ts` exists to hold.
 *
 * The exposure of the fail-open choice is bounded by the ceilings that already
 * exist here (`SWEEP_LIMIT`, `SWEEP_BUDGET`, the 60 s and 90 s timeouts, the
 * in-flight run claim), not by this switch. *A policy that can only deny cannot
 * be depended on to fail closed.*
 */
export function decideBilling(args: {
  posture: BillingPosture;
  site: string | null;
  feature: string;
  denied: string[] | null;
}): { wouldDeny: boolean; proceeded: boolean; log: boolean } {
  if (args.posture === 'off' || args.site === null) {
    return { wouldDeny: false, proceeded: true, log: false };
  }
  const wouldDeny = Array.isArray(args.denied) && args.denied.includes(args.feature);
  const proceeded = args.posture !== 'enforce' || !wouldDeny;
  return { wouldDeny, proceeded, log: wouldDeny || args.posture === 'shadow' };
}

/**
 * The cached 0440 column as stored, parsed like the untrusted text it is.
 *
 * 🔴 The `null` / `[]` distinction survives: `'[]'` parses to `[]` (the
 * directory answered and denied nothing); a NULL column, unparseable text or a
 * non-array dies into `null` (UNKNOWN, which proceeds). Non-string entries
 * inside an otherwise good array are dropped rather than voiding the list,
 * because voiding it on one bad entry fails in the ALLOWING direction — wrong
 * way round for a deny-list. Mirrors the gate's own parser exactly.
 */
export function parseCachedDenied(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return null;
  }
}

/**
 * Decide, log, and hand back a refusal body when one is owed — the form that
 * takes the deny-set EXPLICITLY, for callers with no session of their own.
 *
 * The delegated lane (`routes/gabi-delegated.ts`) is why this exists: the bot
 * acts on borrowed authority, and ⚠️ the person to resolve against is the
 * ON-BEHALF-OF human, never the bot (billing design §9 Q4). Denying the bot
 * would switch the feature off for the whole household, which is not what a
 * per-person rule means.
 */
export function billingRefusalFor(
  env: Pick<Env, 'BILLING_POLICY' | 'ESTATE_APP'>,
  args: {
    feature: string;
    label: string;
    estCents: string;
    denied: string[] | null;
    principal?: string | null;
  },
): BillingRefusal | null {
  const posture = billingPosture(env.BILLING_POLICY);
  const site = billingSite(env);
  const { wouldDeny, proceeded, log } = decideBilling({
    posture,
    site,
    feature: args.feature,
    denied: args.denied,
  });

  if (posture !== 'off' && site === null) {
    console.warn(
      `billing_policy: ESTATE_APP is "${env.ESTATE_APP ?? ''}", which is not library|library2 — ` +
        'the spending gate cannot name its site and is behaving as off',
    );
  }

  if (log) {
    // One JSON line per decision, carrying every field §4.1 names — `rule_id`
    // is the exception and is deliberately absent: this consumer is handed a
    // resolved SET, not the rules, so it cannot name the row. "Why was I
    // denied" is answerable on the admin page, which holds both.
    console.log(
      JSON.stringify({
        evt: 'billing_policy',
        posture,
        feature: args.feature,
        site,
        principal_kind: 'person',
        principal_value: args.principal ?? null,
        would_deny: wouldDeny,
        proceeded,
        est_cents: args.estCents,
      }),
    );
  }

  if (proceeded) return null;

  return {
    status: 403,
    body: {
      error: 'billing_denied',
      // §6: the SITE sentence, not the person one. This Worker is handed a
      // resolved set and cannot tell which rule produced it — and guessing
      // "switched off for you" when it was switched off for the whole
      // catalogue would send somebody to ask the owner for something nobody
      // there can grant. When in doubt, say the one that does not waste an
      // evening.
      detail: `${args.label} is switched off for this catalogue. The owner can turn it back on.`,
      feature: args.feature,
      needs: 'the estate owner',
      how: 'Ask the owner to switch it back on from the Spending panel on heygabi.ai/admin/. A change takes effect within 10 minutes.',
    },
  };
}

/**
 * Decide, log, and hand back a refusal body when one is owed.
 *
 * Returns `null` to proceed. Returns a body + status when the caller must be
 * refused — never a bare status, per the estate's standing rule: the body says
 * what happened, what it needs and how to get it. ⚠️ The Worker carries the
 * sentence, not only the React app; `errors.ts` translating the code is not
 * compliance (§6.1's own lesson — curl, GABI and every future surface got a
 * machine code and no route back).
 */
export function billingRefusal(
  c: Context<AppBindings>,
  feature: string,
  label: string,
  estCents: string,
  opts: { principal?: string | null } = {},
): BillingRefusal | null {
  const posture = billingPosture(c.env.BILLING_POLICY);
  const site = billingSite(c.env);
  const denied = c.get('billingDenied') ?? null;
  const { wouldDeny, proceeded, log } = decideBilling({ posture, site, feature, denied });

  if (posture !== 'off' && site === null) {
    console.warn(
      `billing_policy: ESTATE_APP is "${c.env.ESTATE_APP ?? ''}", which is not library|library2 — ` +
        'the spending gate cannot name its site and is behaving as off',
    );
  }

  if (log) {
    // One JSON line per decision, carrying every field §4.1 names — `rule_id`
    // is the exception and is deliberately absent: this consumer is handed a
    // resolved SET, not the rules, so it cannot name the row. "Why was I
    // denied" is answerable on the admin page, which holds both.
    console.log(
      JSON.stringify({
        evt: 'billing_policy',
        posture,
        feature,
        site,
        principal_kind: 'person',
        principal_value: opts.principal ?? c.get('user')?.email ?? null,
        would_deny: wouldDeny,
        proceeded,
        est_cents: estCents,
      }),
    );
  }

  if (proceeded) return null;

  return {
    status: 403,
    body: {
      error: 'billing_denied',
      // §6: the SITE sentence, not the person one. This Worker is handed a
      // resolved set and cannot tell which rule produced it — and guessing
      // "switched off for you" when it was switched off for the whole
      // catalogue would send somebody to ask the owner for something nobody
      // there can grant. When in doubt, say the one that does not waste an
      // evening.
      detail: `${label} is switched off for this catalogue. The owner can turn it back on.`,
      feature,
      needs: 'the estate owner',
      how: 'Ask the owner to switch it back on from the Spending panel on heygabi.ai/admin/. A change takes effect within 10 minutes.',
    },
  };
}
