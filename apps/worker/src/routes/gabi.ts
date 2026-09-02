/**
 * `POST /api/gabi/turn` — the conversational fixer's one server-side surface.
 *
 * Wiring only: parse a body, hand it to `lib/gabi-turn.ts`, map the outcome to a
 * status. Everything that makes a decision is in the lib, so the CLI, a test, or
 * a second front end can reach it without going through HTTP.
 *
 * ## ⚠️ Gated on `runResearch`, NOT `editCatalog`
 *
 * The route spends money on her key; that is the risk it carries. The *writing*
 * risk is carried by the tool endpoints, each behind its own gate, reached by
 * her browser with her own token. This mirrors `routes/research.ts`'s existing
 * header verbatim:
 *
 * > *"`runResearch` spends money. `reviewFindings` changes the catalog. They are
 * > separate rows because the two risks are different."*
 *
 * In phase 0 there is nothing to write at all — the four tools are read-only
 * (`@lc/core`'s `gabi-tools.ts`, and the test that keeps them that way) — so
 * `runResearch` is the whole gate this feature currently has, and it is the
 * right one: the only thing a turn can do is cost money.
 *
 * ## ⚠️ There is exactly ONE route here, and that is the design
 *
 * No `/api/gabi/tools`, no `/api/gabi/conversations`, no execute endpoint. The
 * loop runs in the browser and every tool call is the same authenticated request
 * the edit form already makes (design §3.1, option B). A second route here would
 * be the first step back toward a server-side loop, which the design refuses on
 * subrequest arithmetic: a six-turn conversation that researches one book and
 * patches two fields is ~40 of the 50 subrequests an invocation gets, and going
 * over **terminates the invocation rather than throwing**.
 */

import { Hono } from 'hono';
import { gabiTurn } from '@lc/research';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';
import { runGabiTurn } from '../lib/gabi-turn.js';
import { BILLING_FEATURES, billingRefusal } from '../lib/billing-gate.js';

export const gabiRoutes = new Hono<AppBindings>().post(
  '/turn',
  requireCapability('runResearch'),
  async (c) => {
    // L6 — the spending gate. ANDed with `runResearch` above, with the
    // `GABI_PANEL` env posture and with key presence inside `runGabiTurn`; it
    // replaces none of them (billing design §3.3). Inert while
    // `BILLING_POLICY` is "off".
    //
    // ⚠️ `gabi.panel` is this repo's own feature id and is NOT `gabi.chat` —
    // that one is the Discord Worker's. Two surfaces, two switches, so the
    // owner can silence one without the other. Getting the id wrong here would
    // fail SILENTLY OPEN forever, which is the drift the registry's pin test
    // exists to catch one layer up.
    const billing = billingRefusal(c, BILLING_FEATURES.gabiPanel, 'The GABI panel', 'per turn');
    if (billing) return c.json(billing.body, billing.status);

    const body = (await c.req.json().catch(() => ({}))) as {
      conversationId?: unknown;
      messages?: unknown;
    };

    const outcome = await runGabiTurn(
      c.env,
      c.get('user').id,
      {
        conversationId: String(body.conversationId ?? ''),
        messages: Array.isArray(body.messages) ? body.messages : [],
      },
      // The one model call, injected rather than imported by the lib — see that
      // file's header for why "exactly one" is a thing this repo measures.
      gabiTurn,
    );

    return outcome.ok ? c.json(outcome.body) : c.json(outcome.body, outcome.status);
  },
);
