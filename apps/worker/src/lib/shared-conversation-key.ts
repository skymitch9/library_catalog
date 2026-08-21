/**
 * The shared conversation key — one function, used by both `gabi-turn.ts` (the
 * site panel) and `gabi-memory.ts` (the Discord-facing endpoint).
 *
 * ## ⚠️ THE SURFACE IS `'shared'`, NOT `'web_panel'`
 *
 * Phase 2 unifies both surfaces under one memory. The key differences from the
 * original `panelConversationKey` in `@lc/gabi-conv`:
 *
 *   - Surface is `'shared'` instead of `SURFACE_WEB_PANEL` (`'web_panel'`).
 *   - The space and person derivation are identical (instance name, user id).
 *
 * Both surfaces must call THIS function so they read the same D1 rows.
 */

import { conversationKey, panelPerson, panelSpace, type ConversationKey } from '@lc/gabi-conv';

/** The surface label that unifies site panel and Discord into one memory. */
export const SURFACE_SHARED = 'shared';

/** The key one shared conversation belongs to. */
export function sharedConversationKey(estateApp: string | undefined, userId: number): ConversationKey {
  return conversationKey(SURFACE_SHARED, panelSpace(estateApp), panelPerson(userId));
}
