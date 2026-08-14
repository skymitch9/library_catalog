# Estate Themes — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-14** — every "live" claim below curled from the
> deployed sites that day. Canonical reference:
> `catalog-platform/docs/info/estate-themes.md`; this app's mapping:
> [`../info/estate-theme.md`](../info/estate-theme.md).

Four themes — `classic | apple | cyberpunk | retro` — × light/dark on one
`--et-*` token contract, switched per site (and per page since v2) by a cog.

## ⚠️ The one rule

**Edit the CANONICAL asset only** —
`catalog-platform/sites/heygabi-home/public/assets/estate-theme.css` +
`theme.js` (+ `motion.js`, `fonts/`). Every other copy is vendored output;
editing one is lost work and drift. If a page needs a `[data-theme=…]`
selector, a token is missing — add it to the contract, never fork.

## How each consumer gets the asset

| Consumer | Mechanism | Vendored location |
|---|---|---|
| apex + `/admin` | serves canonical directly (same directory, ships with the Pages deploy) | — |
| library (this repo) | `scripts/sync-estate-theme.mjs` — runs on pre-build/test/typecheck; ⚠️ `npm run dev` alone does NOT sync on a fresh clone | gitignored `apps/web/public/estate/` (font URLs rewritten `/assets/fonts/`→`/estate/fonts/` — `/assets/*` is Vite hash space with an immutable cache rule) |
| games | manual verbatim copy from canonical (no script); `_headers` no-caches the two un-hashed estate files | `Board_Game_Catalog/apps/web/public/assets/` |
| audiobook | manual copy, font URLs rewritten relative for the `/dev/` lane; plus `ab-bridge.css` aliasing the legacy `--neon-*` vocabulary onto the tokens | `site/static/css/estate-theme.css` + `ab-bridge.css`, `site/static/js/theme.js`, `site/static/fonts/` |

⚠️ Manual copies drift: the games copy lagged the `classic` theme until its
re-vendor (`a7b0318`). After editing canonical, sweep the vendored copies.

## Storage keys (localStorage, origin-scoped so "per site" is free)

| Key | Values |
|---|---|
| `hg_theme` | site-default theme |
| `hg_theme_page` | v2: JSON map, normalised pathname → theme (per-page overrides; "apply to all pages" DELETES the whole map) |
| `hg_mode` | `auto \| light \| dark` — always site-wide, never per page |
| `ab_theme` / `bgc-theme` | legacy mode keys — read once while `hg_mode` unset, never written again |

## Defaults are identity (owner ruling — do NOT "helpfully" restyle)

| Site | Default |
|---|---|
| `heygabi.ai` | `classic` |
| `heygabi.ai/admin` | `apple` |
| `library.heygabi.ai` | `apple` |
| `audiobooks.heygabi.ai` | `cyberpunk` |
| `boardgames.heygabi.ai` | `retro` |

Every consumer sets `<html data-default-theme="…">` and loads `theme.js`
synchronously in `<head>` (pre-paint). Themes are SKIN, never page structure.

## Deploy-wave order + what is live (curled 2026-08-14)

The dispatcher ships theme changes as a wave — **apex Pages + games + library
together** — because the canonical asset and its vendored copies must move in
step; the audiobook site rides its own push→`/dev/`→"prod" lane.

| Surface | Live state 2026-08-14 | Ship with |
|---|---|---|
| apex | themed, `classic` default, **pre-v2 theme.js** (no `hg_theme_page` in the served file) | `npx wrangler pages deploy sites/heygabi-home/public --project-name heygabi-home` (repo root) |
| games | themed, **v2 LIVE** | `npm run deploy` (games repo) |
| library | themed (v1) live; **v2 committed `9da43af`, NOT deployed** | `npm run deploy` (this repo — no migration needed for themes) |
| audiobook | themed on **`/dev/` only**; prod untouched, awaiting owner eyes + "prod" | push main = `/dev/` deploy; promote is owner-only |

So until the wave lands: picking a theme on games writes per-page overrides
(v2) while apex/library still write only `hg_theme` (v1) — compatible by
design (v2 reads `hg_theme` as the site default), just uneven affordances.
