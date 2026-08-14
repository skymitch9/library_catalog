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
next re-push.

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
