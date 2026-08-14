# Estate auth in this app (SHADOW) — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-13** — every claim below was exercised against the
> local dev Worker + a stub auth server that day (six-phase lifecycle probe),
> plus 18 unit tests in `packages/estate-auth/test/shadow.test.ts`.
> Companions: `catalog-platform/docs/info/estate-auth-design.md` (the design —
> §3.1 semantics, §5 protocol, §14.5 this step), `identity-and-reviews.md`
> (the identity ground this sits on).

This app is a consumer of the estate directory at `auth.heygabi.ai`
(`pending | approved | revoked` per person, one approval estate-wide). As of
§14.5 it participates in **shadow mode only**: after the existing local auth
fully resolves, it asks the directory what the design's §3.1 table WOULD
decide, logs that, and **changes nothing**. Enforcement is deliberately not
built in this revision.

## The three settings

| Name | Where | Values / notes |
|---|---|---|
| `ESTATE_CHECK` | `wrangler.toml [vars]` | `off` (deployed default — fully inert: no DB read, no fetch, no log) · `shadow` (observe + log) · `enforce` (**not built**: logs `enforce_requested` on every line and behaves as shadow). Unrecognised values are treated as `off` and logged as `mode_unrecognised` |
| `ESTATE_AUTH_URL` | `wrangler.toml [vars]` | `https://auth.heygabi.ai` |
| `ESTATE_APP_TOKEN_LIBRARY` | **secret** (`wrangler secret put`, or `.dev.vars` + `npm run secrets:push`) | The per-app bearer for `POST /api/estate/seen` (design §4.4). The auth Worker holds the matching value under the same name. ⚠️ Absent while mode is `shadow` = one `estate_config_unset` log line per request and otherwise the off state — deploying code before secret is the intended, safe order |

## What shadow does per authenticated request

1. Local auth resolves exactly as before (`middleware/auth.ts` — untouched
   semantics, then the shadow block).
2. Cache check: `app_user.estate_status` / `estate_checked_at` (migration
   0140, nullable, CHECK-constrained). Fresh within 10 min
   (`REVOCATION_DELAY_MS` — the TTL IS the revocation delay, §5.3) → no call.
3. Otherwise `POST /seen` with the app bearer; on failure ride the stale value
   (§6 row 1) or, with no cache at all, record `estate_unreachable`.
4. Combine per §3.1 with local standing derived as `active = role !==
   'pending'`, `locallyDecided = approved_at IS NOT NULL`.
5. Log one JSON line; persist the cache columns if a fresh answer arrived.
   **Nothing else is ever written — no role, no grant — and no response
   changes, including on internal errors (the whole block is try/caught).**

## Reading the shadow logs in production

```bash
npx wrangler tail --config apps/worker/wrangler.toml --format json | grep estate_shadow
```

One line per authenticated request while in `shadow`, e.g.:

```json
{"tag":"estate_shadow","app":"library","mode":"shadow","email":"…","local_role":"owner",
 "estate":"approved","src":"seen","verdict":"proceed","would_deny":false,
 "would_auto_grant":null,"seen_ms":4}
```

| Field | Meaning |
|---|---|
| `estate` | the directory's answer (or null = no answer exists) |
| `src` | `cache` (fresh, no call) · `seen` (fresh call) · `stale_cache` (call failed, rode the old value) · `none` (no answer at all) |
| `verdict` | the §3.1 outcome: `proceed` / `default_grant` / `request_screen` / `revoked` / `estate_unreachable` |
| `would_deny` | ⚠️ **the rollout gate**: true when enforcement WOULD refuse a request that succeeded today (`revoked`, or `estate_unreachable` with no standing). Run shadow days-not-hours; `grep '"would_deny":true'` must find **zero** household lines before `enforce` is even discussed. Both household users are already `approved` in the directory, so any would-deny is a finding, not noise |
| `would_auto_grant` | `"reader"` when one estate approval would auto-grant this app's default role (§5.4) to a never-locally-decided `pending` user. Visible, never performed |
| `seen_ms` | /seen round-trip when a call happened (design §15 asked shadow to measure it) |

## Gotchas that cost time

- **`wrangler dev` does not hot-reload `.dev.vars` here** — restart the dev
  server to pick up an `ESTATE_CHECK` flip (measured 2026-08-13; the watcher
  never fired on an edit).
- The canonical module arrives at build time: `scripts/sync-estate-auth.mjs`
  materialises `catalog-platform/packages/estate-auth/src/` into gitignored
  `packages/estate-auth/generated/` (the `@lc/universes` mechanism, second
  consumer). A missing platform checkout fails the build loudly, on purpose.
  Local shadow logic lives in `packages/estate-auth/src/shadow.ts`.
- A localhost connection-refused on /seen took ~2s on Windows before falling
  back to the stale cache — an estate outage adds that once per user per TTL,
  not per request.
