# Estate theme adoption — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-17** — `hearts` exercised on the deployed site in
> both modes (§4); the rest last verified **2026-08-13**, all three themes
> exercised in the running app (dev worker + vite, real D1 data).

The web app styles against the estate's `--et-*` token contract and carries the
shared theme switcher. THE contract is `catalog-platform/docs/info/estate-themes.md`
— read that first; this doc records only what is library-specific.

## 1. The moving parts

| Piece | Where | Notes |
|---|---|---|
| Vendored asset | `apps/web/public/estate/` | **Gitignored build artifact**, written by `scripts/sync-estate-theme.mjs` on every build/test/typecheck (sibling of the universes and estate-auth syncs; same loud failure when `catalog-platform` is missing). |
| The one transformation | inside the sync script | Font URLs re-rooted `/assets/fonts/` → `/estate/fonts/`, because this app's `/assets/*` is Vite hash space with an immutable cache rule. Pattern-checked: zero replacements fails the build. |
| Pre-paint stamp | `apps/web/index.html` | `<html data-default-theme="apple">` + `estate-theme.css` + `theme.js` as a **classic synchronous script in `<head>`, before the module bundle** — the React bundle is far too late and flashes the wrong theme. Since 2026-08-17 a six-line inline script runs between the CSS and `theme.js` and rewrites that attribute per instance — §4. |
| Settings surface | `ThemeCog.tsx` in the topbar | Drives `window.estateTheme` (typed in `src/lib/estate-theme.ts`); deliberately NOT the apex's `#hg-cog` markup ids — theme.js wires those at DOMContentLoaded, which races React's render (comment in the component has the full argument). |
| `theme-color` meta | `src/lib/estate-theme.ts` | Follows the computed `--et-bg` on every `hg-themechange`. |
| Caching | `apps/web/public/_headers` | `/estate/*` 1h (bytes change without renames), `/estate/fonts/*` 1y. |

Storage (`hg_theme` / `hg_mode`) belongs to theme.js alone; nothing in this app
touches those keys. Default is `apple` on `library.heygabi.ai` and `hearts` on
`padhard.heygabi.ai` — defaults are identity, the owner's call (§4).

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

## 4. The per-INSTANCE default (2026-08-17)

Owner: *"let it be the default for padhard"*. Her instance boots `hearts`;
this one still boots `apple`.

⚠️ **Both instances serve the same `apps/web/dist`** — `[assets]` and
`[env.friend.assets]` in `wrangler.toml` point at one directory — so there is
ONE `index.html` for two sites. That kills the two obvious mechanisms: a
build-time flag cannot tell the instances apart, and the Worker's per-env
`DEFAULT_THEME` var cannot reach a document the Worker hands straight out of
`ASSETS` without rewriting it.

So the default is resolved **in the browser, from the hostname, before
`theme.js` runs**:

| Piece | Where |
|---|---|
| The map | `<html data-default-theme-by-host='{"padhard.heygabi.ai":"hearts"}'>` |
| The resolver | six lines of inline classic script in `<head>`, between the CSS link and `theme.js` — anything going wrong leaves the declared default in place |
| The posture of record | `DEFAULT_THEME` in **both** `[vars]` and `[env.friend.vars]`; nothing in the Worker reads it |
| The drift guard | `apps/web/test/instance-default-theme.test.ts` reads `wrangler.toml` and fails if the var and the map disagree — the details-sweep-cron pattern |

A person's own pick still wins: the resolver moves the FALLBACK attribute only
and never touches `hg_theme`. Proven live — `library.heygabi.ai` declares
`apple` and renders `retro`, because the owner picked retro there.

**When the Worker grows a config surface** the web app reads at boot, that var
becomes the live source and the hostname map goes away. Until then the map is
the only thing that actually decides.

⚠️ **Do not verify a theme deploy against a warm browser.** Seen both ways on
2026-08-17: the first navigation after the deploy still got the previous
`index.html` (so the default read `apple`), and the page then styled itself
from a cached `/estate/estate-theme.css` — `_headers` gives `/estate/*`
`max-age=3600` — rendering the previous tile while the origin already served
the new one. Hard-reload, or fetch with `cache: 'no-store'` and compare.
