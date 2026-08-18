/**
 * The GABI panel's deep link — a question carried in the URL.
 *
 * `docs/info/gabi-fixer-design.md` §10.2 records the gap this closes. Discord's
 * `/gabi <question>` shipped as shape (b), "propose and deep link": the bot
 * answers with a best-effort nibble and a link into this panel worded *"GABI
 * can dig deeper and propose fixes on the site"*. That link carries **no
 * question**, so the asker arrives at an empty box and retypes what they just
 * typed in Discord. This module is the panel half that lets the link carry it.
 *
 * ## ⚠️ THE PARAMETER IS `gabi`, NOT `q`, AND THAT IS A MEASUREMENT
 *
 * The design named `?q=` — written before anybody looked at this app's router.
 * Measured 2026-08-18: **`q` is already taken, on the exact route the deep link
 * points at.** `router.tsx` `parseCollection()` reads `q` as the collection's
 * own server-side search, and `parse()` maps `/` to the collection. So
 * `https://padhard.heygabi.ai/?q=the+Sanderson+one+with+the+wrong+cover` would
 * do TWO things with one value: prefill the panel *and* filter the book list to
 * a sentence no title matches. The visitor would land on an empty catalog with
 * a panel floating over it — the link would look broken at the exact moment it
 * was working.
 *
 * `parseSeriesList()` reads `q` too, so the collision is not even unique to one
 * route. A parameter the panel owns has no such problem, on any route, ever.
 *
 * ⚠️ **So `panelDeepLink()` in `catalog-platform/apps/discord-worker/src/gabi.ts`
 * — the one function the design names — must emit `?gabi=`, not `?q=`.** Until
 * it does, this reads a parameter nothing sends yet, which is the harmless
 * direction: a panel that accepts more than it is given. The reverse (Discord
 * emitting a parameter the panel ignores) is the "link that silently lies" the
 * design refused to ship, and is why the panel half goes first.
 *
 * DOM-free on purpose: `App.tsx` supplies `window.location.search` and these
 * are plain string functions, so `apps/web/test/` can exercise the real
 * contract under `node:test` without a browser.
 */

/** The panel's own query parameter. One place, so a caller cannot misspell it. */
export const GABI_PREFILL_PARAM = 'gabi';

/**
 * A ceiling on what a URL may type into the box.
 *
 * Not a security control — the Worker's own limits are that — but a question is
 * a sentence, and a link carrying four kilobytes of it is a mistake or a mangle
 * rather than something somebody meant. Truncating keeps the panel usable
 * instead of pasting a wall of text into a textarea; the asker can always edit
 * it, because nothing is sent until they press send.
 */
export const GABI_PREFILL_MAX = 500;

/**
 * The question a URL is carrying, or `null` for "no prefill".
 *
 * `null` rather than `''` deliberately: the caller's whole decision is "did a
 * link bring a question", and an empty string is the same answer as an absent
 * parameter — `?gabi=` alone must not open a panel with nothing in it.
 *
 * @param search `window.location.search`, with or without its leading `?`.
 */
export function gabiPrefillFrom(search: string): string | null {
  // `URLSearchParams` accepts either spelling of the leading '?', and returns
  // null for an absent key — the two cases this has to tell apart.
  const raw = new URLSearchParams(search).get(GABI_PREFILL_PARAM);
  if (raw === null) return null;
  // Collapse the runs of whitespace a copy-paste out of Discord brings with it,
  // so the box opens on a sentence rather than on ragged lines.
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > GABI_PREFILL_MAX ? text.slice(0, GABI_PREFILL_MAX).trimEnd() : text;
}

/**
 * The same query string with the panel's parameter removed, for `replaceUrl`.
 *
 * ⚠️ Stripped once the question is in the box, and the reason is a draft, not
 * tidiness: leave it in and a reload — or an iOS PWA restoring the tab — seeds
 * the box a second time, over whatever the asker had since typed. Taking it out
 * makes the prefill happen exactly once, which is what "a link carried a
 * question" means.
 *
 * ⚠️ EVERY OTHER PARAMETER SURVIVES, in its original order. The deep link points
 * at `/` today, but the panel is global — it is rendered outside the route
 * switch in `App.tsx` — so nothing stops a future link pointing at a filtered
 * collection or a series ladder. Rebuilding the URL from scratch there would
 * silently drop the filters the rest of the link was for.
 *
 * Returns `''` when nothing is left, so the caller writes a bare path rather
 * than a trailing `?` — the same reason `seriesListPath()` omits its defaults.
 */
export function searchWithoutGabiPrefill(search: string): string {
  const p = new URLSearchParams(search);
  if (!p.has(GABI_PREFILL_PARAM)) return search;
  p.delete(GABI_PREFILL_PARAM);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}
