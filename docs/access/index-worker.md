# Cross-Catalog Index (`index.heygabi.ai`) — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (no secret values).
> Last verified: **2026-08-14** — health curled, tokenless reads probed (401),
> remote migration list read, secret names read back.
> Design: `catalog-platform/docs/info/index-worker-design.md`.

## TL;DR

**LIVE with all three catalogs pushed.** Pointers, never truth — one D1 row
per catalogued thing; re-pushing a source replaces its rows wholesale.
Verified 2026-08-14:

```
GET https://index.heygabi.ai/api/health
game: 836 rows · library: 346 · audiobook: 1077   (each with pushed_at)
```

| | |
|---|---|
| Code | `catalog-platform/apps/index-worker/` |
| D1 | `index_catalog` · `3004d175-3c51-4ed4-ac3e-62859319f8ac` · WNAM · 0001 + 0002 (estate_cache) applied remotely; ⚠️ **`0003_visibility_cache.sql` PENDING remotely** (the in-flight visibility work — apply with its deploy, not before) |
| Route | `index.heygabi.ai` (custom domain; `workers_dev = false`) |
| Reads | `GET /api/search` (ranked, for humans typing) · `GET /api/lookup` (exact fold joins) · `GET /api/universe/:name` — all **estate-members-only today** (tokenless → `401 {"error":"unauthenticated"}`, probed live) |
| Open | `GET /api/health` — counts + `MAX(pushed_at)` per source, so a stale source is visible |
| Consumer UI | the apex search box (`heygabi.ai` `#find`, `assets/find.js` → `/api/search`) |

⚠️ **In flight (do not document as landed):** visibility-aware reads —
`/api/search` becomes scoped-not-gated (absent/invalid token → the public
`{audiobook}` slice; members → their visibility set; revoked → `{}`), per
estate design §4.5. Migration 0003 above belongs to that change.

## ⚠️ The CORS/preflight lesson (found live 2026-08-14, by the owner)

The apex fetches reads cross-origin with an `Authorization` header, so the
browser sends a **preflight OPTIONS that deliberately carries no token**. With
the auth blanket mounted before CORS, the preflight was answered 401, the
browser surfaced a bare "network error", and the first real user's first real
search failed. Fix and rule: **`hono/cors` mounts BEFORE
`requireEstateMember`** — it short-circuits OPTIONS itself while every actual
GET still hits auth. Origin allow-list is the apex only, mirroring the auth
Worker's admin CORS. If a new route 401s only from a browser, suspect this
ordering first.

## Push protocol + tokens

`PUT /api/push/:source` (`game|library|audiobook`) with the source's COMPLETE
projection as a JSON array, bearer-authenticated per source. The Worker
rejects an empty array with 422 (*zero rows is a failed export, not an empty
catalog*), computes folds/universe itself, then `DELETE WHERE source` +
insert. Projections are **default-deny column allow-lists** in each source —
never prices, `lent_to`, emails, read-state.

⚠️ **Values for every token below live in the session scratchpad
`estate-app-tokens.json` (LOCAL ONLY — never paste).** Names verified in
production 2026-08-14:

| Secret | Index Worker holds | Source holds |
|---|---|---|
| `INDEX_PUSH_TOKEN_GAME` | ✅ | games Worker: `INDEX_PUSH_TOKEN` (one un-suffixed name per source repo) + `INDEX_URL` in `[vars]` |
| `INDEX_PUSH_TOKEN_LIBRARY` | ✅ | library Worker: `INDEX_PUSH_TOKEN` + `INDEX_URL` in `[vars]` |
| `INDEX_PUSH_TOKEN_AUDIOBOOK` | ✅ | ⚠️ **nowhere persisted** — the pipeline's `app/index_push.py` reads `INDEX_URL`/`INDEX_PUSH_TOKEN` from the environment and *skips with one log line* when unset; the 2026-08-14 push was run with inline env vars. Adding them to `audiobook_catalog/.env` is the natural next step (owner/dispatcher call) |
| `ESTATE_APP_TOKEN_INDEX` | ✅ (its own membership-check bearer against `auth.heygabi.ai`) | — |

Manual push (audiobook example):
`INDEX_URL=https://index.heygabi.ai INDEX_PUSH_TOKEN=... python -m app.index_push`
(from `audiobook_catalog/`; token from the scratchpad file, in the shell only).

## Freshness backstops — how each source repo keeps the index from going stale

All three fail SOFT: token/URL unset = one log line, nothing else; the index
can never stall a catalog.

| Source | Trigger | Backstop |
|---|---|---|
| library | after mutations via `waitUntil` (`apps/worker/src/lib/index-push.ts`) | **request-traffic backstop**: at most hourly per isolate, an API request checks `/api/health` after responding and re-pushes if the library source is empty or >24h stale. Rides traffic because this Worker has NO cron (an unproven cron must not be the backstop) |
| games | after mutations + cron for its other duties | request-traffic backstop **ported from the library shape** 2026-08-13 after the cron-riding backstop silently failed to push on three consecutive ticks (root cause UNDIAGNOSED — if the cover check or orphan sweep ever go quiet the same way, suspect the cron itself). Every pass logs its decision: `due → skipped (fresh, 836 rows)` / `throttled (next in 60m)` |
| audiobook | pipeline calls `push_after_build` after a site rebuild (`app/main.py` → `app/index_push.py`) | none beyond the pipeline's own cadence; env unset = logged skip (see token table) |

Known residual gaps (accepted, ≤24h tolerance): backfill scripts that write D1
directly fire no mutation push; `universes.json` edits propagate only on the
next re-push. Seen live 2026-08-14: the 13-duplicate work merge (library commit
`c5b5d66`, a script write) left the index at 364 library rows vs 351 works
until the next push — exactly this gap, self-healing.

## Bridge retirement (design §7 step 4) — proof run 2026-08-14: **both bridges STAY**

The design's gate is *retire only when the index provably answers what they
answer*. Measured read-only against production (remote D1 + the live Firestore
`reviews` collection; index answers computed with the index Worker's own
`fold.ts` over the current source projections — a member ID token for
`/api/lookup` is not mintable non-interactively, and open `/api/health`
cross-checks the row counts):

| Bridge question | Index answer today | Verdict |
|---|---|---|
| `backfill-review-keys.mjs`: stamp `workKey` (cleaned-title composite) onto audiobook review docs so the library's Firestore query joins them | Cannot write Firestore, has no `bookId`, and its `work_fold` (RAW pushed titles) equals the stamped `workKey` on only **329/870** docs — 541 differ because Audible decoration survives the raw push | **STAYS** (dormant: 870/870 stamped, 0 backlog, a re-run today restamps 0) |
| `backfill-audiobook-holdings.mjs` phase 1: per-work "owned on audio" (`audiobook_holding`, 70 live rows, all `matched_via='exact'`) | Exact `work_fold` join reproduces **21/70**; a cleaned-title push would reach 57/70; the last 13 need the alias/containment machinery `matching.ts` provides and design §8 refuses | **STAYS** |
| `backfill-audiobook-holdings.mjs` phase 2: per-volume audio rungs on series-gap rows (`audiobook_series_holding`, 135 live rungs / 19 series, 130 `work_match` + 5 hedged `fold`) | The read surface (`/api/lookup`, `/api/universe`, `/api/search`) has **no series join at all** — answers none of it | **STAYS** |

One index-AHEAD find: library #250 "Space Knight Book 2" — the bridge's
cleaner collapses the audiobook's "Space Knight, Book 2" to "Space Knight"
(colliding with book 1) so the matcher misses it, while the raw-title fold
join hits. The bridge's own known failure mode, fixable with a `work_alias`
row + re-run, not with retirement. ✅ **Fixed 2026-08-14**:
`scripts/add-space-knight-alias.mjs` (library repo) wrote the alias, the
holdings backfill was re-run `--remote --commit`, and #250 now carries a live
`audiobook_holding` row (`via_alias='Space Knight'`, `index_sort=2`). #249
"Space Knight Book 1" shares the collapse but stays unmatched on purpose —
see that script's header.

For full retirement the index would need: (1) cleaned titles (or a second
clean fold) from the audiobook pusher — a design change, since sources push
raw strings by rule; (2) alias-aware joins fed by `work_alias`; (3) a series
read surface with the `work_match`-vs-`fold` corroboration semantics; (4) for
reviews, a Firestore stamping path — which "pointers, never truth" rules out.
That is re-growing the bridges inside the index; not proposed.

## Deploy / operate

```bash
cd catalog-platform/apps/index-worker
npm run db:migrate          # remote — ⚠️ 0003 pending; apply WITH its deploy
npx wrangler deploy
npm test                    # wiring tests
npm run probe               # live probes: conformance + pending→approved→revoked→outage lifecycle
npx wrangler tail           # logs
```

Health is the staleness dashboard — curl it before suspecting a pusher.

## Gotchas

- **Snapshot-replace is the whole freshness model.** There is no per-row
  staleness machinery and must not be; a failed push leaves the previous
  snapshot standing.
- **`/api/search` is resemblance, never identity** — anything
  machine-actionable uses `/api/lookup` (exact folds). The "no second
  matcher" rule is scoped in design §8; do not reopen it.
- **Games rows have `work_fold = NULL` by design**; wholly non-Latin titles
  fold to NULL too (the Korean-title refusal). Reachable via display-title
  search, not key joins.
- The `estate_cache` table caches `/seen` answers (10-min TTL); membership IS
  the authorization here — the index has no local roles, `OWNER_EMAILS` is
  the only local standing.
