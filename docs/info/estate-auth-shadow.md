# Estate auth in this app (shadow + enforce) — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-13** — shadow claims exercised against the local dev
> Worker + a stub auth server that day (six-phase lifecycle probe); the
> ENFORCE arm built and exercised the same day (all eight §3.1 rows live
> against local D1 + the stub — see the enforce section), 407 unit tests in
> `packages/estate-auth/test/gate.test.ts` and the root suite.
> Companions: `catalog-platform/docs/info/estate-auth-design.md` (the design —
> §3.1 semantics, §5 protocol, §14.5 this step), `identity-and-reviews.md`
> (the identity ground this sits on).

This app is a consumer of the estate directory at `auth.heygabi.ai`
(`pending | approved | revoked` per person, one approval estate-wide).
Production currently runs **`ESTATE_CHECK = "shadow"`**: after the existing
local auth fully resolves, it asks the directory what the design's §3.1 table
WOULD decide, logs that, and changes nothing. The **enforce arm is BUILT**
(wave-2, games precedent — its arm flipped to enforce in production first)
but ⚠️ **flipping the flag is the dispatcher's evidence-gated step**: days of
shadow soak with zero household `"would_deny":true` lines, same as games.

## The three settings

| Name | Where | Values / notes |
|---|---|---|
| `ESTATE_CHECK` | `wrangler.toml [vars]` | `off` (fully inert: no DB read, no fetch, no log) · `shadow` (observe + log, never changes a response) · `enforce` (the §3.1 verdicts act — see below). Unrecognised values are treated as `off` — a typo must never enforce by accident — and logged as `mode_unrecognised` |
| `ESTATE_AUTH_URL` | `wrangler.toml [vars]` | `https://auth.heygabi.ai` |
| `ESTATE_APP_TOKEN_LIBRARY` | **secret** (`wrangler secret put`, or `.dev.vars` + `npm run secrets:push`) | The per-app bearer for `POST /api/estate/seen` (design §4.4). ⚠️ Absent while mode is `shadow` OR `enforce` = one `estate_config_unset` log line per request and otherwise the off state — a half-configured enforce fails into today's behaviour, never into a lockout |

## What runs per authenticated request (both active modes)

1. Local auth resolves exactly as before (`middleware/auth.ts` — including the
   OWNER_EMAILS recovery hatch in `upsertUserOnLogin`, which runs BEFORE the
   estate and is never gated by it).
2. Cache check: `app_user.estate_status` / `estate_checked_at` (0140) and
   `estate_visibility` (0150 — the §4.5 set cached beside the status, one
   freshness stamp for the whole answer). Fresh within 10 min
   (`REVOCATION_DELAY_MS` — the TTL IS the revocation delay, §5.3) → no call.
3. Otherwise `POST /seen` with the app bearer; on failure ride the stale value
   (§6 row 1) or, with no cache at all, `estate_unreachable`.
4. Combine per §3.1 with local standing derived as `active = role !==
   'pending'`, `locallyDecided = approved_at IS NOT NULL`.
5. Log one JSON line; persist the cache columns (status + visibility together)
   if a fresh answer arrived.
6. **Shadow:** stop — nothing else is written, no response changes, including
   on internal errors (the compute step is try/caught). **Enforce:** act, per
   the next section.

## The enforce arm (`packages/estate-auth/src/gate.ts` + `middleware/auth.ts`)

| §3.1 row | Enforce behaviour |
|---|---|
| estate `revoked` (any local role, even owner) | **403 `{"error":"estate_revoked"}`** — computed, never stored: `role`/`approved_at` untouched, so a later re-approval restores the person exactly |
| `approved` + active local role | proceed; local capabilities govern |
| `approved` + `pending` never locally decided | **auto-grant `reader`** (§5.4): `approved_by NULL` (the estate-actor convention) + a `change_log` audit row — `entity='app_user'`, `field='role'`, `changed_by NULL`, `changed_how='auto'`, note naming the estate — written in the SAME atomic D1 batch as the grant, guarded by `(SELECT changes()) > 0` so a concurrent local decision wins AND no orphan audit row can land |
| `approved` + locally demoted `pending` (`approved_at` stamped) | stays pending — a local owner's demotion is standing; request screen via the capability layer |
| estate `pending` + active local | proceed — local wins (seed-gap row) |
| estate `pending` + local `pending` | request screen, as today |
| unreachable + standing (stale cache or active local role) | proceed on the stale cache / local approval — includes the OWNER_EMAILS break-glass lane |
| unreachable + no standing | **503 `{"error":"estate_unreachable", detail}`** — named, so an outage is distinguishable from a denial |

An unexpected throw anywhere in the estate step degrades to local-only auth,
loudly (`estate_gate: error swallowed`) — no estate failure may break a
request local auth already passed; enforce refusals themselves are returned
outside that try/catch, deterministically.

## Reading the logs in production

```bash
npx wrangler tail --config apps/worker/wrangler.toml --format json | grep estate_
```

Shadow lines keep the soak's tag and vocabulary byte-for-byte
(`tag:"estate_shadow"`, `would_deny`, `would_auto_grant`); enforce lines are
their own stream with the acting vocabulary:

```json
{"tag":"estate_enforce","app":"library","mode":"enforce","email":"…","local_role":"owner",
 "estate":"revoked","src":"cache","visibility":[],"verdict":"revoked","denied":true,
 "auto_grant":null,"seen_ms":null}
```

| Field | Meaning |
|---|---|
| `estate` | the directory's answer (or null = no answer exists) |
| `src` | `cache` (fresh, no call) · `seen` (fresh call) · `stale_cache` (call failed, rode the old value) · `none` (no answer at all) |
| `visibility` | the §4.5 effective set riding with that status (null = no visibility fact — a pre-§4.5 answer) |
| `verdict` | the §3.1 outcome: `proceed` / `default_grant` / `request_screen` / `revoked` / `estate_unreachable` |
| `would_deny` (shadow) | ⚠️ **the rollout gate**: true when enforcement WOULD refuse a request that succeeded today. `grep '"would_deny":true'` must find **zero** household lines over days before the flip |
| `denied` / `auto_grant` (enforce) | what actually happened; a default-grant also logs a second plain line naming the granted role and that the audit row was written |
| `seen_ms` | /seen round-trip when a call happened |

## The flip checklist (dispatcher's, evidence-gated — same as games)

1. Shadow soak: days, zero household `"would_deny":true` lines; both household
   users read `estate:"approved"` with fresh `src` values.
2. `npm run db:migrate` — remote **0150** (`estate_visibility`; 0140 is
   already live). Migrate before deploying, per the standing rule.
3. Deploy the enforce-capable build with `ESTATE_CHECK` still `"shadow"`;
   confirm shadow lines unchanged (the build must be inert at the old flag).
4. Flip `ESTATE_CHECK = "enforce"` in `wrangler.toml [vars]`, redeploy.
5. Immediately verify: owner sign-in works; tail shows `estate_enforce` lines
   with `denied:false`; a capability route answers.
6. Rollback is the flag: set `"shadow"` (or `"off"`) and redeploy — the cache
   columns are inert when unread and nothing else changed shape.

## Gotchas that cost time

- **`wrangler dev` does not hot-reload `.dev.vars` here** — restart the dev
  server to pick up an `ESTATE_CHECK` flip (measured 2026-08-13; the watcher
  never fired on an edit).
- ⚠️ **A TaskStop/console kill of `wrangler dev` leaks its node parent AND
  workerd, which keep answering the port** — during the enforce build a
  killed enforce-mode server kept serving 403s on 8811 while a freshly
  started shadow-mode server ALSO claimed the port (two LISTENING pids,
  Windows lets both bind); the probe read the wrong worker until netstat
  exposed the pair. Kill by name filtered on `library_catalog`, then check
  `netstat -ano | grep <port>` shows nothing before restarting.
- The canonical module arrives at build time: `scripts/sync-estate-auth.mjs`
  materialises `catalog-platform/packages/estate-auth/src/` into gitignored
  `packages/estate-auth/generated/`. A missing platform checkout fails the
  build loudly, on purpose. The gate (all three modes) lives in
  `packages/estate-auth/src/gate.ts` (formerly `shadow.ts`).
- A localhost connection-refused on /seen took ~2s on Windows before falling
  back to the stale cache — an estate outage adds that once per user per TTL,
  not per request.
