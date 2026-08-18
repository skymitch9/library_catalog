/**
 * The site panel's half of GABI's conversation memory — which key a chat
 * belongs to, and which remembered turns a given browser tab is *not* already
 * carrying.
 *
 * Everything here is pure and everything here is this repo's. The shape, the
 * window and the alternation rule come from the shared substrate; what a
 * `surface`, a `space` and a `person` MEAN on a website is a decision only this
 * repo can make, and the substrate is explicit that it must not try:
 *
 * > *"`space` and `person` are OPAQUE BY CONTRACT. Nothing in this file or any
 * > consumer may parse them, pattern-match them, or assume they are numeric."*
 *
 * ## ⚠️ THE RESUME RULE — the one piece of arithmetic that is genuinely new
 *
 * Discord and the panel differ in one way that decides this whole file. Discord
 * holds **nothing** between messages, so the stored record *is* the
 * conversation and every remembered turn goes into the prompt. The panel holds
 * its live tab's transcript in React state — `tool_use` and `tool_result`
 * blocks included, which the store deliberately never keeps — and re-sends the
 * whole thing on every turn. Prepending the stored window there would send
 * every turn **twice**: once as the browser's copy and once as the server's.
 *
 * So the panel needs to know which remembered turns the browser is already
 * carrying, and the answer is exact rather than heuristic: **the browser mints
 * one `conversationId` per tab** (it already did, for the `gabi_turn`
 * accounting join), and every turn this surface stores records that id in
 * `turns[].ref.cid` — the surface-private bag the core never reads. A turn
 * whose `cid` is the incoming one is a turn the browser has. A turn whose `cid`
 * is anything else is a turn from a conversation that is over as far as the
 * browser is concerned — a closed tab, a reload, a phone picked up again — and
 * that is exactly what "she remembers" has to mean.
 *
 * ⚠️ Not matched on TEXT, deliberately. Two identical questions ten minutes
 * apart are a normal thing to ask, and a text match would silently swallow the
 * second one. An id minted per tab cannot collide with itself.
 */

import {
  SURFACE_WEB_PANEL,
  conversationKey,
  type ConversationKey,
  type ConversationTurn,
} from '../generated/index.js';

/**
 * Which catalog this conversation happened on — `library` or `library2`.
 *
 * ⚠️ **`ESTATE_APP`, not the hostname.** It is the identifier the estate
 * already uses for an instance everywhere else (the auth Worker's per-app
 * token, GABI's Discord `instance_pick` menu rows), so a conversation begun on
 * the site and a conversation begun in Discord about the same shelf name that
 * shelf the same way. A hostname would be a second vocabulary for one fact.
 *
 * ⚠️ **The two instances are two memories.** Same person, same browser, but
 * `library` and `library2` are different books and a different conversation.
 * A test in the platform repo pins that the keys differ.
 */
export function panelSpace(estateApp: string | undefined): string {
  // Unset is not an error worth refusing a chat over — it means somebody is
  // running a local worker without the var. A stable literal keeps the local
  // memory working and cannot collide with a deployed instance's name.
  return estateApp && estateApp.trim().length > 0 ? estateApp.trim() : 'local';
}

/**
 * Who was talking.
 *
 * ⚠️ **The `app_user` id, not the Firebase uid**, and the reason is stability
 * rather than preference: `app_user.firebase_uid` is nullable in this schema
 * (a person seeded before their first sign-in has none), so keying on it would
 * give the same person two memories depending on when their row was written.
 * The `app_user` id is present for everybody the auth middleware lets through,
 * never changes, and is already the key `gabi_turn.user_id` accounts against —
 * so "what did this conversation cost" and "what does she remember" are about
 * the same person by construction.
 *
 * ⚠️ It is still OPAQUE to the substrate: this function is the only place in
 * the estate that knows the string is a number, and the storage key never
 * parses it back.
 */
export function panelPerson(userId: number): string {
  return String(userId);
}

/** The key one site chat belongs to. */
export function panelConversationKey(estateApp: string | undefined, userId: number): ConversationKey {
  return conversationKey(SURFACE_WEB_PANEL, panelSpace(estateApp), panelPerson(userId));
}

/**
 * The surface-private bag this panel stamps on every turn it stores.
 *
 * ⚠️ `cid` is the *browser's* conversation id, and the resume rule above is the
 * only thing that reads it. It is not an identifier of anything durable — a
 * new tab mints a new one — which is why it lives in `ref` rather than becoming
 * a field on the record: a field would be a shape change every other surface
 * would have to carry for a reason that is entirely this one's.
 */
export function panelTurnRef(conversationId: string): Record<string, string> {
  return { cid: conversationId };
}

/**
 * The remembered turns this browser tab is **not** already carrying.
 *
 * A turn with no `ref.cid` at all is treated as belonging to somebody else's
 * conversation — i.e. it IS remembered. That is the safe direction: the failure
 * mode is a turn appearing twice in one prompt (mild, and visible), where the
 * other direction is GABI silently forgetting the thing the person is asking a
 * follow-up about (the exact defect this whole feature exists to fix).
 */
export function rememberedFor(
  turns: readonly ConversationTurn[],
  conversationId: string,
): ConversationTurn[] {
  return turns.filter((t) => t.ref?.['cid'] !== conversationId);
}

/**
 * The plain text of one message's content, for STORING.
 *
 * ⚠️ **Text blocks only, and that is the privacy posture as much as the spend
 * one.** A `tool_use` block holds a work id and a query; a `tool_result` holds a
 * projection of somebody's catalog. Neither belongs in a 30-minute memory whose
 * whole justification is that it is small and then gone — and neither helps a
 * follow-up, because every claim about a current value is supposed to come from
 * a fresh `get_book` rather than from what was said earlier. `thinking` blocks
 * are excluded for the same reason plus a stronger one: they are the model's
 * scratch, not anything a person said.
 *
 * The substrate clips whatever this returns to 600 characters.
 */
export function panelTurnText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.join('\n\n').trim();
}

/**
 * The last thing the person actually typed, out of the array the browser sent.
 *
 * ⚠️ Searched from the END and skipping `tool_result` bodies. A tool round-trip
 * appends a `role: 'user'` message whose content is entirely `tool_result`
 * blocks — the browser answering the model, not the person saying anything. Its
 * `panelTurnText` is empty, which is what makes the skip a consequence of the
 * projection above rather than a second rule that could disagree with it.
 */
export function lastUserText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (typeof m !== 'object' || m === null) continue;
    const message = m as { role?: unknown; content?: unknown };
    if (message.role !== 'user') continue;
    const text = panelTurnText(message.content);
    if (text.length > 0) return text;
  }
  return '';
}

/**
 * The two turns one answered exchange contributes to the memory.
 *
 * Returns `[]` when there is nothing worth remembering — a turn that produced
 * only tool calls and no prose, for instance, which is a step in an exchange
 * rather than an exchange. ⚠️ The caller must treat that as "write nothing",
 * not as "write an empty record": the record is deleted when it empties, and
 * re-saving an empty one would leave a row per person per instance forever,
 * whose *key* still says who talked to her and where.
 */
export function panelExchange(
  userText: string,
  assistantText: string,
  conversationId: string,
  now: number,
): ConversationTurn[] {
  if (userText.length === 0 || assistantText.length === 0) return [];
  const ref = panelTurnRef(conversationId);
  return [
    { role: 'user', text: userText, at: now, ref },
    { role: 'assistant', text: assistantText, at: now, ref },
  ];
}
