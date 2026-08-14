# Estate Auth (`auth.heygabi.ai`) — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (no secret values).
> Last verified: **2026-08-14** — health curled, remote migrations listed, all
> secret names read back with `wrangler secret list`, tokenless probes run.
> Design + semantics: `catalog-platform/docs/info/estate-auth-design.md`
> (visibility = §4.5). This app's shadow wiring: [`../info/estate-auth-shadow.md`](../info/estate-auth-shadow.md).

## TL;DR

**LIVE and SEEDED.** One directory row per person the estate has ever seen —
`pending | approved | revoked` + `is_approver` + a per-catalog **visibility
set**. Apps verify Firebase tokens locally as always; the directory only gates
newcomers and enforces revocations. Verified 2026-08-14:

```
GET https://auth.heygabi.ai/api/health
{"ok":true,"users":{"pending":0,"approved":2,"revoked":0,"approvers":1}}
```

| | |
|---|---|
| Code | `catalog-platform/apps/auth-worker/` |
| D1 | `estate_auth` · `d94ffe45-4dd0-4dc2-86de-b8c4d649c1cb` · WNAM · migrations **0001 + 0002 (visibility) applied remotely** (verified: `npm run db:migrate` answers "No migrations to apply") |
| Route | `auth.heygabi.ai` (custom domain; `workers_dev = false`) |
| Admin UI | **`https://heygabi.ai/admin/`** — the APEX, not this host (owner decision #6). Answers 200; sign-in via the shared Firebase project |
| Consumers | index (**members-only reads**), games (**`ESTATE_CHECK=enforce`**, live), library (**`ESTATE_CHECK=shadow`** — enforcement NOT built), audiobook site untouched (public by decision) |

## ⚠️ Gotchas first

- **`/seen` never changes `status`.** It upserts unknown emails as `pending`
  and refreshes uid/name; approval is only ever the admin API's doing.
- **Rows are never deleted.** Revocation must survive re-sign-in; a revoked
  person must not reappear as a fresh `pending` an approver waves through.
- **The admin API's CORS names `https://heygabi.ai` alone.** The `/admin`
  page from `www.heygabi.ai` will not work — the page says so. Do not "fix"
  this by widening `ADMIN_ORIGINS`.
- **Re-running the seed re-widens visibility** for seed-listed approved
  members (deliberate: the seed list IS the household). If an approver has
  narrowed a household member, the seed undoes it.
- **Visibility is which shelves a member SEES, never what they may DO.** It
  must not become a role system — each app's own `app_user` still owns
  capabilities. Full contract: design §4.5.
- **The `wrangler.toml` header still says "NOT DEPLOYED YET"** — stale since
  the 2026-08-14 deploy; the `routes =` line below it is the live truth.
- Rate limiter: `[[unsafe.bindings]]` namespace `2001`, 60/min. Middleware
  **fails open with a log line** if the binding is absent (dev/tests).

## The directory shape (one table, `estate_user`)

`email` (lowercased, UNIQUE — THE join key) · `firebase_uid` (recorded, never
joined on) · `status` `pending|approved|revoked` · `is_approver` flag ·
`origin` (`seed:*` / `seen:*` / `manual` — the honesty column) ·
`vis_audiobook`/`vis_library`/`vis_games` (0|1, DEFAULT 1) ·
`decided_at`/`decided_by`.

Effective visibility as `/seen` answers it: approved → stored set;
`pending` → `{audiobook}` (what the anonymous internet sees); `revoked` → `{}`;
`OWNER_EMAILS` → all three, computed (break-glass is unnarrowable).

## API

| Route | Auth | Notes |
|---|---|---|
| `POST /api/estate/seen` | per-app bearer (`Authorization: Bearer <ESTATE_APP_TOKEN_*>`) | body `{email, firebase_uid?, display_name?}` → `{status, visibility}` |
| `GET /api/estate/users` | Firebase ID token of an approver | pending first; each row carries the STORED visibility array |
| `POST /api/estate/users/:id/status` | approver token | `{"status":"approved","visibility":[...]}` — visibility alongside `"revoked"` is refused 400 |
| `POST /api/estate/users/:id/visibility` | approver token | `{"visibility":[...]}`; `[]` is legal |
| `GET /api/health` | none | counts by status, no emails |

## `OWNER_EMAILS` break-glass

`OWNER_EMAILS = "nbaslamking@gmail.com"` sits in the `[vars]` of the auth
Worker **and** every consumer (library, games, index). On the auth Worker it
means approved + approver + full visibility regardless of table state — the
**only** bootstrap; there is deliberately no first-sign-in-claims rule here.
On consumers it means the owner is served on local standing alone even with
the directory down or corrupted. Recovery never depends on the thing being
recovered; the other two levers are the Cloudflare D1 console (edit
`estate_user` directly) and Firebase console user-disable.

## Secrets — names only; where each side holds them

⚠️ **Values live in the session scratchpad `estate-app-tokens.json`
(LOCAL ONLY, this machine, outside every repo). Never paste a value into any
file, message or log.** All names below verified set in production via
`wrangler secret list`, 2026-08-14.

| Secret | Auth Worker holds | Consumer holds |
|---|---|---|
| `ESTATE_APP_TOKEN_LIBRARY` | ✅ (`wrangler secret put`, from `apps/auth-worker/`) | ✅ library Worker, same name — `.dev.vars` + `npm run secrets:push` |
| `ESTATE_APP_TOKEN_GAMES` | ✅ | ✅ games Worker, same name — `npm run secret ESTATE_APP_TOKEN_GAMES` |
| `ESTATE_APP_TOKEN_INDEX` | ✅ | ✅ index Worker, same name |

One value per pair — mint once, set on both sides. A leaked token can probe
membership and spray `pending` rows; rotate that one secret on both sides.

## The seed

```bash
cd catalog-platform
node scripts/seed-estate.mjs                     # DRY RUN — prints EVERY row
node scripts/seed-estate.mjs --extra emails.txt  # optional pre-seed list
node scripts/seed-estate.mjs --commit --local    # rehearsal
node scripts/seed-estate.mjs --commit --remote   # 🔴 the real seed
```

Sources: both production `app_user` tables + audiobook `ADMIN_EMAILS` +
`OWNER_EMAILS`. Idempotent (`ON CONFLICT DO NOTHING`); never downgrades;
refuses zero-row reads. Two deliberate upgrades on re-run: approver flags for
admin emails, and the visibility re-widen (gotcha above). **Has been run** —
the health counts above are its output.

## Deploy / operate

```bash
cd catalog-platform/apps/auth-worker
npm run db:migrate          # remote D1 — BEFORE deploy
npx wrangler deploy
npm test                    # unit + wiring
npm run probe               # live probes
npx wrangler tail           # logs
```

Query production:
`npx wrangler d1 execute estate_auth --remote --command "SELECT email,status,is_approver FROM estate_user"`
(from `apps/auth-worker/`; contains emails — treat output accordingly).

## TTL / revocation — the one number

Consumers cache the `/seen` answer (status **with** visibility — one answer,
never aged separately) for **10 minutes**: library/games in
`app_user.estate_status`/`estate_checked_at` (migration 0140 here), the index
in its `estate_cache` table. So a revocation lands within ≤10 min everywhere.
Instant kill paths that skip the TTL: demote the person locally in an app's
People page, or disable the Google account in the Firebase console (tokens
die within their 1h life). During an auth-Worker outage, standing members keep
working on stale cache/local roles; unknown or pending people are refused with
`estate_unreachable` — closed for strangers, open for the household.
