# Estate theme adoption — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-13** — all three themes exercised in the running app
> (dev worker + vite, real D1 data) before this was written.

The web app styles against the estate's `--et-*` token contract and carries the
shared theme switcher. THE contract is `catalog-platform/docs/info/estate-themes.md`
— read that first; this doc records only what is library-specific.

## 1. The moving parts

| Piece | Where | Notes |
|---|---|---|
| Vendored asset | `apps/web/public/estate/` | **Gitignored build artifact**, written by `scripts/sync-estate-theme.mjs` on every build/test/typecheck (sibling of the universes and estate-auth syncs; same loud failure when `catalog-platform` is missing). |
| The one transformation | inside the sync script | Font URLs re-rooted `/assets/fonts/` → `/estate/fonts/`, because this app's `/assets/*` is Vite hash space with an immutable cache rule. Pattern-checked: zero replacements fails the build. |
| Pre-paint stamp | `apps/web/index.html` | `<html data-default-theme="apple">` + `estate-theme.css` + `theme.js` as a **classic synchronous script in `<head>`, before the module bundle** — the React bundle is far too late and flashes the wrong theme. |
| Settings surface | `ThemeCog.tsx` in the topbar | Drives `window.estateTheme` (typed in `src/lib/estate-theme.ts`); deliberately NOT the apex's `#hg-cog` markup ids — theme.js wires those at DOMContentLoaded, which races React's render (comment in the component has the full argument). |
| `theme-color` meta | `src/lib/estate-theme.ts` | Follows the computed `--et-bg` on every `hg-themechange`. |
| Caching | `apps/web/public/_headers` | `/estate/*` 1h (bytes change without renames), `/estate/fonts/*` 1y. |

Storage (`hg_theme` / `hg_mode`) belongs to theme.js alone; nothing in this app
touches those keys. Default is `apple` — defaults are identity, the owner's call.

## 2. How the old palette's roles map (the part worth re-reading)

The pre-2026-08-13 stylesheet had five hues with documented meanings. They did
not map one-to-one, and the split is deliberate:

| Old | New | Rule |
|---|---|---|
| `--accent` (cloth binding) | `--et-accent` | interactivity + held facts |
| `--warm` as a **request** (needs/watch/gap/pending/reading) | `--et-warn` | status tokens carry status |
| `--warm` as **decoration** (series tags, blank-cover spine) | `--et-accent-2` | second voice; apple folds it into the accent |
| `--transit` (preordered/arrivals) | `--et-ok` | the estate has no fourth hue; minting one is how themes rot |
| `.fmt--audio`'s warm outline | `--et-muted` outline | accent-2 would collapse into the ebook chip under apple and into warn under cyberpunk; muted keeps the three-way format distinction in every theme |
| the serif | `--et-font-display` on headings only | body/list content rides `--et-font`, so retro's Bangers stays a heading voice |

**Two deliberate literals remain** (colour IS the meaning, header comment in
`styles.css`): the filled star's gold `#d9a441` (the shared review store must
not show two colours of truth on two sites) and the camera stage's `#000`.

**One `[data-theme]` selector exists** — retro's press-into-shadow on native
buttons — and it is the token sheet's own primitive rule mirrored, not a fork.
Do not add more; a needed `[data-theme]` selector means a missing token.

`--lc-tint` / `--lc-spine` in `styles.css` are app-local *derived* tokens
(color-mix over `--et-*`), not new colours — the app has three surface levels
where the contract has two.

## 3. Gotchas that cost time

- **Button resets must unset `box-shadow`.** The global `button` rule now
  carries `--et-btn-shadow` (retro's hard offset); every flat row-as-button
  (`.row-open`, `.ladder__book`, `.picker__hit`, …) sets `box-shadow: none` or
  retro draws a drop shadow under every list row.
- `.scan-mode` and `.cover-swap__card` are buttons that *keep* the shadow on
  purpose — they are small panels.
- The vendored copy under `public/estate/` is rewritten every build; editing it
  is silent lost work. Theme/token edits go to catalog-platform.
- `npm run dev` does NOT run `prebuild` — the vendored copy exists because
  typecheck/test/build all sync it. On a fresh clone run `npm run
  estate-theme:sync` (or any build) once before `npm run dev`.
