# Estate Themes — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-17** — the propagation table below was read in each
> repo that day and the drift guards were watched failing and passing; the
> "live state" rows carry their own dates. Canonical reference:
> `catalog-platform/docs/info/estate-themes.md`; this app's mapping:
> [`../info/estate-theme.md`](../info/estate-theme.md).

Five themes — `classic | apple | cyberpunk | retro | hearts` — × light/dark on
one `--et-*` token contract, switched per site (and per page since v2) by a
cog. `hearts` (pink/white, 8-bit hearts, retro's chunky grammar) was added
2026-08-16 for the second library instance.

## ⚠️ The one rule

**Edit the CANONICAL asset only** —
`catalog-platform/sites/heygabi-home/public/assets/estate-theme.css` +
`theme.js` (+ `motion.js`, `fonts/`). Every other copy is vendored output;
editing one is lost work and drift. If a page needs a `[data-theme=…]`
selector, a token is missing — add it to the contract, never fork.

## How each consumer gets the asset — NOBODY COPIES BY HAND ANY MORE

Rewritten 2026-08-17 (owner: *"when a theme is added all sites get it"*). Every
row below used to say "manual copy" for two of four consumers, and that is
precisely how `hearts` shipped on 08-16 and reached no cog for a day.

| Consumer | Mechanism | Vendored location | What fails if it goes stale |
|---|---|---|---|
| apex + `/admin` `/status` `/series` `/universes` | serves canonical directly (same directory, ships with the Pages deploy). Its five cogs carry an EMPTY `<select>`; `theme.js` fills the options from `THEMES` | — | `npm run deploy:home` → `predeploy-check.mjs` refuses: a theme with no `[data-theme=]` block, no `LABELS` entry, or any page with hardcoded `<option>`s |
| library + padhard (this repo) | `scripts/sync-estate-theme.mjs` on prebuild/pretest/pretypecheck; ⚠️ `npm run dev` alone does NOT sync on a fresh clone | gitignored `apps/web/public/estate/` (font URLs rewritten `/assets/fonts/`→`/estate/fonts/` — `/assets/*` is Vite hash space with an immutable cache rule) | build/test error naming the missing checkout |
| games | `scripts/sync-estate-theme.mjs` (added 2026-08-17, twin of this repo's) on the same hooks; `_headers` no-caches the two un-hashed files | gitignored `Board_Game_Catalog/apps/web/public/assets/` — the WHOLE directory is that script's output now | build/test/deploy error |
| audiobook | `scripts/sync_estate_theme.py` **plus** `tests/test_estate_theme_vendor.py`. ⚠️ Sync-on-demand, not prebuild, and the copy stays TRACKED: `site/` is served straight from the repo, so a test-time rewrite would fight that repo's auto-committing pipeline | `site/static/css/estate-theme.css`, `site/static/js/theme.js`, `site/static/fonts/`; plus its OWN `ab-bridge.css` aliasing the legacy `--neon-*` vocabulary (never synced) | the drift test fails by name and tells you to run the script |

⚠️ **The one real hole, stated rather than hidden:** the audiobook drift test
**skips** where the `catalog-platform` checkout is absent, which includes that
repo's GitHub Actions. It guards a developer's or an agent's checkout — which
is where re-vendoring happens — and nothing else. Its self-consistency half
(every offered theme has a palette and a label) does run in CI.

⚠️ **No consumer holds a theme list or a label map any more.** If you find
one, it is a second registry and it is already stale: build the list from
`window.estateTheme.themes` and the names from `.label(id)`.

## Storage keys (localStorage, origin-scoped so "per site" is free)

| Key | Values |
|---|---|
| `hg_theme` | site-default theme |
| `hg_theme_page` | ⚠️ RETIRED. A per-page override map, built and reverted the same day (2026-08-14); `theme.js` DELETES it on boot. Do not reintroduce it — the brief it answered was a misread |
| `hg_mode` | `auto \| light \| dark` — always site-wide, never per page |
| `ab_theme` / `bgc-theme` | legacy mode keys — read once while `hg_mode` unset, never written again. Migrated centrally by `theme.js` since 2026-08-17 (safe everywhere: localStorage is origin-scoped, so each key only exists where it was written) |

## Defaults are identity (owner ruling — do NOT "helpfully" restyle)

| Site | Default |
|---|---|
| `heygabi.ai` | `classic` |
| `heygabi.ai/admin` | `apple` |
| `library.heygabi.ai` | `apple` |
| `padhard.heygabi.ai` | `hearts` (owner, 2026-08-16) |
| `audiobooks.heygabi.ai` | `cyberpunk`, and `data-default-mode="dark"` — a first visit boots dark whatever the OS says |
| `boardgames.heygabi.ai` | `retro` |
| `ebooks.heygabi.ai` | ⚠️ **not a theme consumer at all.** It has ONE look of its own (owner, 2026-08-17: "let it have its own theme"), loads only `theme.js` so the shared account modal's Appearance controls are not dead, ignores `data-theme` and honours `data-mode`. A deliberate exclusion — verified 2026-08-17, do not "finish the job" |

Every consumer sets `<html data-default-theme="…">` and loads `theme.js`
synchronously in `<head>` (pre-paint). Themes are SKIN, never page structure.

⚠️ **The two library instances share one bundle**, so `padhard`'s default is
not a second `data-default-theme` — it is resolved from `location.hostname` by
an inline script before `theme.js`. `DEFAULT_THEME` in `wrangler.toml` is the
posture of record and a test pins the two together. Full mechanism and its
caching traps: [`../info/estate-theme.md` §4](../info/estate-theme.md).

## Deploy-wave order + what is live (measured 2026-08-17)

A theme change is still a WAVE — canonical plus every consumer — but the wave
is now *builds*, not copying: each consumer's sync pulls canonical at build
time, so "ship the wave" means run each repo's normal deploy.

| Surface | Live state 2026-08-17 | Ship with |
|---|---|---|
| apex (+ `/admin` `/status` `/series` `/universes`) | **five themes live, cog options built by `theme.js`** — verified in-browser: the `<select>` on all five pages ships EMPTY and fills to Classic/Apple/Cyberpunk/Retro/Hearts. Default `classic`, unchanged. Deployment `e68aef98` | `npm run deploy:home` (repo root; runs the static guard, deploys, then re-checks live) |
| games | **five themes live**, default `retro` unchanged, `theme-color` tracking `--et-bg` from canonical after its inline script was deleted. Worker version `783aad0e` | `npm run deploy` (games repo) |
| library + padhard | (this repo — see its own deploy notes; no migration needed for themes) | `npm run deploy` |
| audiobook | pushed to main → `/dev/`, then PROMOTED on the owner's explicit word (2026-08-17, scoped to this) | push main = `/dev/` deploy; promote is owner-only |

⚠️ **`/assets/*` on the apex and games is served `max-age=0, must-revalidate`
for the two un-hashed estate files, but a browser that already has them in its
MEMORY cache will still run the old copy on a soft reload.** Measured today: a
fresh navigation to heygabi.ai ran the previous `theme.js` (five themes but no
`label()`), and a hard reload picked up the new one. Verify with a hard reload
or a `fetch(url, {cache:'reload'})`, never with a plain revisit — otherwise you
will report a deploy as broken that is fine.
