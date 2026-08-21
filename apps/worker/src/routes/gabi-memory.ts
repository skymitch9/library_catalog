/**
 * `GET /api/gabi/memory` and `PUT /api/gabi/memory` — the shared conversation
 * memory endpoint for Phase 2 of GABI's cross-surface continuity.
 *
 * Both surfaces (site panel + Discord) read and write the same conversation
 * history through this endpoint, keyed on `{surface: 'shared', space, person}`.
 * The Discord Worker calls here instead of its Durable Object so that a
 * conversation begun in chat continues on the site and vice versa.
 *
 * ## ⚠️ Mounted BEFORE `requireAuth`, same reasoning as `/api/gabi/delegated`
 *
 * The caller is the estate's Discord Worker, not a browser. It carries a static
 * bearer (`ESTATE_APP_TOKEN_DISCORD`) and the route enforces it — the same gate
 * `gabi-delegated.ts` uses, with the same refusal shape and the same failure
 * direction (unset = disabled, wrong = 401 with words).
 *
 * ## ⚠️ THE SURFACE KEY IS `'shared'`
 *
 * Not `'web_panel'`, not `'discord'`. Both surfaces read the same rows by
 * agreeing on one surface label. The site panel's `gabi-turn.ts` also uses
 * `'shared'` (changed in this build), so a conversation started on Discord
 * appears as remembered context on the site and the other way around.
 */

import { Hono } from 'hono';
import type { ConversationTurn } from '@lc/gabi-conv';
import { findUserByFirebaseUid, loadPanelConversation, savePanelConversation } from '@lc/db';
import type { AppBindings } from '../env.js';
import { secretEquals } from '../lib/secret-equals.js';
import { sharedConversationKey } from '../lib/shared-conversation-key.js';

/**
 * Resolve a Firebase UID to an internal user id, or null.
 * Validates the uid shape the same way `gabi-delegated.ts` does (8–128 chars).
 */
async function resolveUser(db: D1Database, firebaseUid: string | null | undefined) {
  if (typeof firebaseUid !== 'string') return null;
  const trimmed = firebaseUid.trim();
  if (trimmed.length < 8 || trimmed.length > 128) return null;
  return findUserByFirebaseUid(db, trimmed);
}

export const gabiMemoryRoutes = new Hono<AppBindings>()
  /**
   * The bearer gate — identical shape to gabi-delegated.ts.
   * Unset secret = disabled (503). Wrong/absent bearer = 401 with words.
   */
  .use('*', async (c, next) => {
    const expected = c.env.ESTATE_APP_TOKEN_DISCORD;
    if (!expected) {
      return c.json(
        {
          error: 'not_configured',
          detail:
            'The estate has not finished wiring GABI memory to this catalog yet ' +
            '(ESTATE_APP_TOKEN_DISCORD is unset). Nothing was read or written.',
        },
        503,
      );
    }
    const header = c.req.header('Authorization') ?? '';
    const presented = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] ?? '';
    if (!presented || !secretEquals(presented, expected)) {
      return c.json(
        {
          error: 'unauthenticated',
          detail:
            'This request did not carry the estate\'s own Discord credential. ' +
            'If you are seeing this in a chat, GABI and this catalog are holding ' +
            'different values for the same secret -- that is an owner fix.',
        },
        401,
      );
    }
    await next();
  })

  /**
   * GET /api/gabi/memory?person=:firebaseUid
   *
   * Returns the shared conversation record for this person, or an empty one
   * if nothing is stored.
   */
  .get('/', async (c) => {
    const personParam = c.req.query('person');
    if (!personParam) {
      return c.json({ error: 'bad_request', detail: 'Query parameter "person" is required.' }, 400);
    }

    const user = await resolveUser(c.env.DB, personParam);
    if (!user) {
      return c.json(
        { error: 'unknown_user', detail: 'No account found for that Firebase UID on this instance.' },
        404,
      );
    }

    const key = sharedConversationKey(c.env.ESTATE_APP, user.id);
    const memory = await loadPanelConversation(c.env.DB, key);

    return c.json({ turns: memory.turns, updatedAt: null });
  })

  /**
   * PUT /api/gabi/memory
   *
   * Saves conversation turns for a person under the shared surface key.
   * Body: { person: string (firebase UID), turns: ConversationTurn[], updatedAt: string }
   */
  .put('/', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'bad_request', detail: 'Body must be a JSON object.' }, 400);
    }

    const { person, turns, updatedAt } = body as {
      person?: unknown;
      turns?: unknown;
      updatedAt?: unknown;
    };

    if (typeof person !== 'string' || person.trim().length === 0) {
      return c.json({ error: 'bad_request', detail: '"person" (Firebase UID) is required in the body.' }, 400);
    }

    if (!Array.isArray(turns)) {
      return c.json({ error: 'bad_request', detail: '"turns" must be an array.' }, 400);
    }

    const user = await resolveUser(c.env.DB, person);
    if (!user) {
      return c.json(
        { error: 'unknown_user', detail: 'No account found for that Firebase UID on this instance.' },
        404,
      );
    }

    const key = sharedConversationKey(c.env.ESTATE_APP, user.id);
    await savePanelConversation(c.env.DB, key, turns as ConversationTurn[]);

    return c.json({ ok: true });
  });
