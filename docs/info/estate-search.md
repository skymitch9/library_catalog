# Estate search (`<estate-search>`) — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-16** — every claim below was exercised against the
> running app in Chrome or measured with `curl`, except where it says otherwise.

The **fourth** sibling-checkout sync, after `@lc/universes`, `@lc/estate-auth`
and the estate theme. Read `universes.md` first if you have not met that
pattern; this file only records what is different.

---

## 1. What it is, and what it is NOT

`<estate-search>` is a framework-agnostic custom element owned by
`catalog-platform` (`sites/heygabi-home/public/assets/estate-search.js`,
contract in that repo's `docs/TODO.md` §0.1). It asks the shared index Worker
at **index.heygabi.ai** one question: *do we own this on any shelf?* —
audiobooks, these books, and the board games, at once.

⚠️ **It does not replace this catalog's search and must never be made to.**

| | Collection page box | Estate box |
|---|---|---|
| Asks | "which of OUR books match" | "do we own this ANYWHERE" |
| Where | `pages/CollectionPage.tsx` | `components/EstateSearch.tsx` |
| Server | our Worker, `/api/collection?q=` | index.heygabi.ai, `/api/search?q=` |
| Has | facets, sorts, pagination, our columns | cross-catalog groups, universes |

The two sit a few pixels apart, so the estate box overrides the component's
default `hint` with a line saying which is which. That copy is the only reason
the attribute is set.

**Where it lives in the UI:** a magnifier in the top bar, between the nav chips
and the theme cog, opening a full-width strip under the header. The toggle's
`open` state is held in `App.tsx` because its two halves straddle the header.
It renders only inside the signed-in shell, so a signed-out visitor never sees
it.

---

## 2. ⚠️ THE DEPLOY PREREQUISITE — the box does nothing until this is done

**Measured 2026-08-16, live:**

```bash
curl -s -D- -o NUL -X OPTIONS 'https://index.heygabi.ai/api/search?q=x' \
  -H 'Origin: https://library.heygabi.ai' \
  -H 'Access-Control-Request-Method: GET'
# → 204, and NO Access-Control-Allow-Origin header.
# The same probe with Origin: https://heygabi.ai returns the header.
```

The index Worker's `readCors()` reads a `READ_ORIGINS` allow-list and
**defaults to `https://heygabi.ai` alone** (`apps/index-worker/src/index.ts`);
`READ_ORIGINS` is **not** in its `wrangler.toml` `[vars]`. So today only the
apex may call `/api/search` from a browser, and from `library.heygabi.ai` the
panel will show *"The index did not answer (network). Try again shortly."* —
a CORS refusal wearing a network error's clothes.

**Fix, in catalog-platform, by whoever owns that deploy:** add
`https://library.heygabi.ai` to `READ_ORIGINS` on the index Worker and
redeploy it. Re-run the probe above to confirm; it is the whole test.

Nothing in this repo can work around it — the browser refuses before the
request is sent.

---

## 3. The sync (`scripts/sync-estate-search.mjs`)

Written in the exact image of `sync-estate-theme.mjs`:

| | |
|---|---|
| Source | `catalog-platform/sites/heygabi-home/public/assets/estate-search.js` |
| Resolution | `scripts/lib/platform-repo.mjs` — sibling lookup, `CATALOG_PLATFORM_DIR` overrides, failure names every path tried |
| Output | `apps/web/public/estate/estate-search.js` + `SOURCE-estate-search.txt` |
| Runs as | `prebuild`, `pretest`, `pretypecheck`; by hand, `npm run estate-search:sync` |
| Tracked? | **No.** `apps/web/public/estate/` is gitignored. Editing the copy is lost work. |

It lands in the **same directory as the theme** on purpose: the component
resolves its optional sibling modules (`estate-auth.js`, `estate-scan.js`)
relative to `import.meta.url`. Each script writes its own provenance file so
two writers in one directory cannot clobber each other's record.

The copy is **pattern-checked**: it fails the build if
`customElements.define('estate-search'` is gone from the source. The React side
waits on `customElements.whenDefined()`, which cannot tell a renamed element
from a slow network — that has to break at build time, not in a panel that
spins forever.

**Not vendored, and neither is a gap:**

- `estate-auth.js` — only dynamic-imported when `.authAdapter` is unset. We set
  it (see §4).
- `estate-scan.js` — only fetched when the `scan` attribute is present. We do
  not set it: scanning here is `/add`'s own screen, with the catalog's
  add-to-shelf flow behind it, which a search box cannot do.

---

## 4. Auth: `auth="authed"`, adapter = this app's own Firebase

catalog-platform's §0.5 left this undecided and flagged it for the dispatcher.
**Decided here, for this app only:** the element gets `auth="authed"` and its
`.authAdapter` is built in `lib/estate-search.ts` from `lib/firebase.ts`.

Why not vendor `estate-auth.js`: it would put a second Firebase SDK loader,
with its own app instance and its own session, on a page that already has one —
two sign-in states free to disagree. Same project (`audiobook-catalog`), same
account, same session; the index Worker accepts the token the app already holds.

The one translation is `signIn`: ours throws, theirs returns
`{ ok | cancelled | redirecting | error, ownerAction }`. A cancelled popup is
mapped to `{ cancelled: true }`, not to an error.

`handleRedirectResult` is deliberately absent — the component guards on
`typeof … === 'function'`, and `App.tsx` re-checks `/api/me` from `watchAuth`,
which fires on the way back from Google anyway.

⚠️ **Signed out, the index answers audiobooks only** (estate design §4.5:
anonymous visibility is `{audiobook}`). An empty books/games section when
signed out is the correct answer, not a bug. Do not "fix" it.

---

## 5. ⚠️ Three traps, all found by opening the panel in a browser

Typecheck, the 816-test suite and `npm run build` were **all green over the
first two of these**. Only running it found them.

### 5a. The element is created by hand, and the ordering is load-bearing

`.authAdapter` must be set **before** the node is connected. The component's
`connectedCallback` boots auth immediately and falls back to a dynamic import
of `estate-auth.js` when no adapter property is there. React sets refs *after*
the commit that inserts the node, so every JSX shape — ref callback included —
is already too late: the import would 404 and the box would degrade silently to
authless, which for a library caller means audiobooks only, forever.

So: load, `whenDefined`, `document.createElement`, set properties, set
attributes, add listeners, `appendChild`. In that order.

### 5b. Vite refuses a dynamic `import()` of anything under `public/`

> *"This file is in /public and will be copied as-is during build without going
> through the plugin transforms, and therefore should not be imported from
> source code. It can only be referenced via HTML tags."*

`vite build` does not mind (`@vite-ignore` leaves the specifier alone and the
bundle keeps it), so this fails in **`vite dev` only** — with a full-screen HMR
error overlay. `loadEstateSearch()` therefore injects a
`<script type="module">` tag, which is what `index.html` already does with the
theme's sibling asset and behaves identically in both environments.

### 5c. Upstream bug: the scan buttons show on embeds that never asked for them

`estate-search.js` hides its barcode/shelf-scan row with the `hidden`
attribute and then styles it `.es-scan-row { display: flex; … }` — an author
rule, which beats the UA stylesheet's `[hidden] { display: none }`. The sibling
`.es-camera-stage[hidden] { display: none; }` sits four lines below it, so it
is an oversight, not an intent.

Result on any embed without `scan`: two visible buttons that can only fail,
because their logic is in a module that is never fetched.

`components/EstateSearch.tsx` appends **one** rule into the shadow root —
`.es-scan-row[hidden] { display: none !important; }` — re-asserting an
attribute the component itself set. It changes no behaviour and becomes a
no-op the moment upstream adds the guard. ⚠️ **This is the only rule allowed
in there.** Anything beyond it belongs in catalog-platform.

**Reported upstream? Not yet** — catalog-platform was read-only to the session
that found it.

---

## 6. The router hook

⚠️ **This app has no `react-router-dom`.** `router.tsx` is hand-rolled; its
navigate equivalent is the exported **`navigate(to: string)`**, and that is
what the `estate-search:select` handler calls.

The event is cancelable and fires **instead of** the component's default
`window.open(url, '_blank', 'noopener')`.

⚠️ The branch is taken on **`hit.source === 'library'`** — the index's own word
for which shelf answered — **not** on comparing URL origins. `detail_url` is
minted absolute as `https://library.heygabi.ai/work/N` by
`packages/db/src/index-projection.ts` in *every* environment, while
`window.location.origin` is `localhost:5174` under `vite dev`; an origin test
would send you to another tab on your own machine.

**Exercised 2026-08-16 in Chrome**, all three branches:

| Hit | `preventDefault`? | Result |
|---|---|---|
| `source: 'library'`, `/work/42?x=1` | yes | URL became `/work/42?x=1`, `history.state.from` recorded — i.e. `navigate()`, so the back button knows where it came from |
| `source: 'audiobook'` | no | not routed; the component keeps its new tab. Right: we cannot render another origin |
| `source: 'library'`, unparseable URL | no | not swallowed; handed back to the component |

A universe hit's *"everything in X →"* does **not** fire this event — it
re-renders inside the component, cross-catalog. Our own `/universe/:name` page
is library-only and cannot show that, so leaving it alone is correct.

---

## 7. Failure behaviour

The panel never shows a bare status or a dead box. If the script does not load
it says so and names the search that still works ("use the search box on the
collection page"). **Exercised 2026-08-16** by renaming the vendored file and
reopening the panel.

There is a 10s backstop on `whenDefined` for the one case the tag's `error`
event cannot catch — a parse error inside the script, which reports to
`window.onerror`. The sync script's define-check is what makes it unlikely; the
backstop is what stops the panel saying "Loading…" at someone forever.

Focus is taken on the component's own **`estate-search:auth`** event, not after
`appendChild`: the box boots neutral with a **disabled** input (the sign-in
flash fix), and focusing a disabled input silently does nothing. Measured — the
naive version never focused, once.

---

## 8. What has NOT been verified

- **Any real search result.** Blocked by §2 — every query from this origin dies
  at CORS. Ranking, grouping, the universe rows and the signed-in widening are
  all unexercised from this app.
- **Signed-in behaviour.** Localhost has no Firebase session and
  `auth.heygabi.ai` will not authorise it. The adapter's shape was confirmed on
  the element (`watchAuth, idToken, signIn, signOutUser`); its `signIn` and
  `signOutUser` paths were not run.
- **Production.** Nothing was deployed.
