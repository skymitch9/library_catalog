# library_catalog — Rebuild From Nothing

> **Audience:** Claude sessions and the owner. **Status:** TRACKED — ⚠️ this
> repo is **PUBLIC** (`gh repo view skymitch9/library_catalog` → `PUBLIC`,
> verified 2026-08-18), so secret **NAMES ONLY**, never a value, never a
> member email.
> **Last verified: 2026-08-18** — ⚠️ except §3's secret table, whose custody
> column was re-measured and rewritten **2026-08-26** (`DONOR_TOKEN` gained a
> master and a one-command rotation; four keys that live in `.dev.vars` were
> added; `AUDIOBOOK_MAPPING_TOKEN`'s gap is named). ⚠️ **Nothing else in this
> file was re-checked that day** — §1, §2, §4 and §5 still carry their 2026-08-18
> ages, and the rebuild sequence has still never been performed.
>
> **The question this file answers:** *from nothing but a git clone and the
> blob backups, how do I rebuild this app?* It is the per-repo half of the
> estate rebuild rule. It does **not** duplicate restore mechanics —
> [`catalog-platform/docs/access/RECOVERY.md`](../../../../catalog-platform/docs/access/RECOVERY.md)
> is the single source of truth for *how* to replay a D1 dump or a bucket
> tarball, and this file says *what this repo needs and in what order*.
>
> ⚠️ **THE WHOLE SEQUENCE BELOW IS INFERENCE.** No rebuild of this app has ever
> been performed. §5 labels every capability drilled-or-not, honestly.

---

## 0. The 60-second version

1. **This repo runs TWO instances off one codebase** — the main library and the
   `padhard` shelf. They are separate D1 databases, separate buckets, separate
   hostnames, and `[env.friend]` in one `wrangler.toml`. **Rebuilding one and
   forgetting the other is the mistake this file exists to prevent.**
2. **The D1 data is the precious part.** Locations, prices, `lent_to` — user
   entered, no other copy anywhere (`backup-restore.md` §1 rates it High).
3. **The covers bucket is precious too** — `library-covers` has **no local
   master** (unlike the audiobook covers). The `estate-backups` dump is the only
   way back.
4. **Rebuild `catalog-platform` first.** It owns the backup system, the scripts
   that read these dumps, and the auth Worker this app calls.
5. ⚠️ **New D1 IDs come out of a rebuild** and must be pasted into
   `apps/worker/wrangler.toml` — twice, once per instance.

---

## 1. Full inventory

### 1a. Code

| | |
|---|---|
| Repo | `skymitch9/library_catalog` — ⚠️ **PUBLIC** |
| Worker source | `apps/worker/` (Hono, TS) |
| Web app | `apps/web/` → built to `apps/web/dist`, served by the Worker's `[assets]` |
| Shared | `packages/` (incl. `packages/db`) |
| Migrations | `migrations/` at the repo root — **32 files**, newest `0350_gabi_conversation.sql` (2026-08-18) |
| CI | `.github/workflows/deploy.yml` |

**Git is the only part of this app with no restore procedure, because it needs
none** — GitHub plus every local clone is already ≥2 copies.

### 1b. The two instances

| | **main** | **friend** (`[env.friend]`) |
|---|---|---|
| Worker name | `library-catalog` | `library-catalog-friend` |
| Hostname | `library.heygabi.ai` | `padhard.heygabi.ai` |
| D1 | `library-catalog` — `6022ea5e-2510-450e-81ce-7d847fa31379` | `library-catalog-2nd` — `9dcf4af9-d1a2-4de4-adcf-ac7eea77f1c8` |
| R2 covers | `library-covers` | `library-2nd-covers` |
| Cron | `7 * * * *` (details sweep) | `7 * * * *` |
| Default theme | `apple` | `hearts` |
| GABI fixer panel | off | on |

⚠️ **`library-catalog-2nd` had NO BACKUP AT ALL until 2026-08-18** — the estate
restore drill found it live and absent from all three store lists at once
(`catalog-platform` RECOVERY.md §1b hole #1). It is in the backup set now; its
first ever copy is `d1/library-catalog-2nd/20260818T072359Z.sql`. ⚠️ **Its
restore has never been exercised** — same mechanism as its sibling, which is an
inference, not a measurement.

### 1c. Durable state, and where a copy lives

| Store | Backed up? | Where the copy is | Rebuildable another way? |
|---|---|---|---|
| D1 `library-catalog` | ✅ daily 09:12 UTC | `estate-backups/d1/library-catalog/<STAMP>.sql` + the mirror | ❌ **No. User-entered, no other copy.** |
| D1 `library-catalog-2nd` | ✅ since 2026-08-18 | same grammar | ❌ **No.** |
| R2 `library-covers` | ✅ daily | `estate-backups/r2/library-covers/<STAMP>.tar.gz` | ❌ **No local master** — the dump is the only path back |
| R2 `library-2nd-covers` | ❌ not in the matrix | — | **0 objects** as of 2026-08-18; joins the matrix the day it holds anything |
| Rows pushed to `index_catalog` | n/a | — | ✅ **Yes — re-push, never restore.** A push replaces this source's rows wholesale |
| Firestore (reviews, clubs, …) | ✅ daily | shared with the estate | Owned by the `audiobook-catalog` Firebase project, not by this repo |

⚠️ **`library-2nd-covers` being empty is a fact with a date, not a permanent
property.** Re-check it before trusting this row.

### 1d. Machine state

**None that matters.** This app has no local master of anything — no media
library, no generated corpus, no `.env` that is the source of truth for data.
Everything it owns is in D1 or R2. ⚠️ That is *not* true of
`audiobook_catalog`, so do not carry this assumption across.

---

## 2. The rebuild, in order

```bash
# 0. PREREQUISITE: rebuild catalog-platform first — it owns the restore scripts
#    and the auth Worker this app calls.

# 1. clone + install
git clone https://github.com/skymitch9/library_catalog && cd library_catalog
npm install && npm run build          # apps/web/dist must exist before deploy

# 2. create the databases (BOTH instances)
npx wrangler d1 create library-catalog
npx wrangler d1 create library-catalog-2nd

# 3. ⚠️ PASTE THE NEW database_id VALUES into apps/worker/wrangler.toml —
#    line ~23 for main and line ~293 for [env.friend]. Deploying with the old
#    IDs "succeeds" and serves an account you no longer own.

# 4. restore the data — mechanics in catalog-platform RECOVERY.md §3b/§3c.
#    ⚠️ library-catalog's dump does NOT replay raw; reorder it first.
node ../catalog-platform/scripts/reorder-d1-dump.mjs ./library-catalog.sql ./library-catalog.ordered.sql
npx wrangler d1 execute library-catalog --remote --file=./library-catalog.ordered.sql -y

# 5. catch the schema up — a backup is always N migrations behind
npx wrangler d1 migrations apply library-catalog --remote          # NB: rejects -y
npx wrangler d1 migrations apply library-catalog-2nd --remote

# 6. buckets + covers — catalog-platform RECOVERY.md §5
npx wrangler r2 bucket create library-covers
npx wrangler r2 bucket create library-2nd-covers

# 7. secrets — §3 below, BOTH environments
# 8. deploy both instances
npx wrangler deploy --config apps/worker/wrangler.toml
npx wrangler deploy --config apps/worker/wrangler.toml --env friend

# 9. re-push the index rather than restoring it
curl -s https://library.heygabi.ai/api/health >/dev/null
```

⚠️ **Step 5 runs migrations on BOTH databases.** The dumps are at different
migration counts (the drill measured main at 26 in a 2026-08-16 backup against
31 live; the 2nd instance at 32), and a missed catch-up shows up as a missing
column at runtime, not at deploy.

---

## 3. Secrets, by name — custody and where to re-mint

⚠️ **NO VALUES HERE, EVER — this repo is PUBLIC.**
⚠️ **Cloudflare Worker secrets are WRITE-ONLY.** Names list forever; values
never read back. A rebuild **re-mints every one of them**.

| Name | Holder | Custody today | Re-mint at |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | GitHub Actions (`deploy.yml`) | GH repo secret | dash.cloudflare.com → API Tokens ("Edit Cloudflare Workers") |
| `CATALOG_PLATFORM_TOKEN` | GitHub Actions | GH repo secret | github.com → Settings → Developer settings → PAT |
| `ANTHROPIC_API_KEY` | Worker (both envs — ⚠️ `--env friend` is a **separate** secret) | Worker secret | console.anthropic.com |
| `ESTATE_APP_TOKEN_LIBRARY` | ⚠️ **PAIRED** — this Worker **and** `estate-auth` | Worker secret, both sides | self-generated; ⚠️ **both sides together or it fails as a silent 401** |
| `ESTATE_APP_TOKEN_DISCORD` | Worker | Worker secret | paired with the discord Worker |
| `INDEX_PUSH_TOKEN` | ⚠️ **PAIRED** — this Worker **and** `catalog-index` | Worker secret, both sides | self-generated |
| `AUDIOBOOK_MAPPING_TOKEN` | Worker | Worker secret. 🔴 **No copy in `.dev.vars`, so a bulk run cannot rotate it** (`--both --dry-run` → *"skip (not set locally)"*). The master is `audiobook_catalog/.env` `LIBRARY_MAPPING_TOKEN` — checked 2026-08-26; `TODO.md` "Custody gap" | paired with the audiobook side |
| `EBOOK_INGEST_TOKEN` | Worker | Worker secret **and** `apps/worker/.dev.vars` (`SHARED_OPT_IN` — travels only with `-- --enable EBOOK_INGEST_TOKEN`) | paired with the ebooks ingest side |
| `DONOR_TOKEN` | ⚠️ **BOTH instances, and each one both SENDS it and VERIFIES it** — outbound `X-Donor-Token` to `DONOR_URL`, inbound gate on its own `/api/donor/details` (`env.ts:141-158`, `routes/donor.ts:242-247`). **Exactly two holders**, checked estate-wide 2026-08-26 | ✅ **Master added 2026-08-26**: `apps/worker/.dev.vars`, and it is on `SHARED_ALWAYS` in `scripts/push-secrets.mjs`, so **`npm run secrets:push:both` rotates both halves in one command**. Before that date it had **no readable copy anywhere** | `openssl rand -hex 32` → `.dev.vars` → `npm run secrets:push:both`. ⚠️ **Both halves together or the sweep 404s** — and a wrong token is **404, not 401**, by design, so a half-rotation looks exactly like the route not existing. Verify with `GET /api/donor/details?title=…` + `X-Donor-Token` against **both** hostnames; drilled 2026-08-26, 200 on both |
| `GOOGLE_BOOKS_API_KEY` | Worker (both) | Worker secret **and** `apps/worker/.dev.vars` (`SHARED_ALWAYS`) | console.cloud.google.com |
| `HARDCOVER_API_TOKEN` | Worker (both) | Worker secret **and** `apps/worker/.dev.vars` (`SHARED_ALWAYS`) | hardcover.app/account/api |
| `PEER_TOKEN` | Worker (both) | Worker secret **and** `apps/worker/.dev.vars` (`SHARED_ALWAYS`) | self-generated; rotated 2026-08-25 |
| `INDEX_READ_TOKEN` | ⚠️ **PER-INSTANCE** — main's value is the index's `INDEX_READ_TOKEN_LIBRARY`, padhard's her `…_LIBRARY2` | Main's in `apps/worker/.dev.vars`; hers is piped from a drop-box line and lives only on her Worker | self-generated at the index Worker |

**Not secrets, but they decide who is an owner** — keep them in the rebuild
checklist because omitting them is a privilege change: `OWNER_EMAILS`,
`ESTATE_CHECK`, `ESTATE_AUTH_URL`, `FIREBASE_PROJECT_ID`, `ESTATE_APP` (all in
`[vars]`, tracked in git, so they come back with the clone).

📖 **The complete cross-repo credential map — which pairs with which, and the
rotation ritual — is `audiobook_catalog/docs/access/CREDENTIALS.md`.** ⚠️ It is
**gitignored on purpose** and exists only on the owner's machine; a
machine-loss rebuild does not have it, and this table plus `wrangler secret
list` is what remains.

```bash
npx wrangler secret list --config apps/worker/wrangler.toml              # names, main
npx wrangler secret list --config apps/worker/wrangler.toml --env friend # names, friend
```

---

## 4. What a rebuild CANNOT recover

- **Any catalog edit made after the newest backup.** Bounded at ~1 day by the
  daily 09:12 UTC cron — but the drill measured what an unbounded gap costs:
  **+84 works / +77 editions / +94 copies / +469 `change_log` rows** in under
  two days.
- **Worker secret values** — re-minted, never recovered.
- **Any cover uploaded since the newest bucket dump.** There is no local master.
- ⚠️ **`CREDENTIALS.md`**, if the owner's machine is the casualty.

---

## 5. Drilled vs inference

**"Drilled" = executed and measured on the date shown. "Inference" = an
identical mechanism was drilled elsewhere — a real reason to expect it works,
and not a measurement.**

| Capability | Status | Evidence |
|---|---|---|
| `library-catalog` dump is complete and faithful | ✅ **Drilled** 2026-08-17 | catalog-platform RECOVERY.md §1a/§3b |
| Its dump does **not** replay raw; reorder fixes it | ✅ **Drilled** 2026-08-17 + regression test | §3b there — died at `no such table: main.edition` after 5 of 27 tables |
| Local import + row counts match production | ✅ **Drilled** 2026-08-17 | 351/394/272/522/814, exact |
| Remote D1 import works at all | ✅ **Drilled** 2026-08-18 | §3c-drill there — ⚠️ on `estate_auth`, **not** on this repo's dumps |
| **Remote import of THIS repo's reordered dump** | ⚠️ **Inference** | same statement stream, never run remotely |
| `migrations apply --remote` | ⚠️ **Inference** | local only |
| `library-covers` dump matches live bytes | ✅ **Drilled** 2026-08-17 | 208 objects, sha256 spot-check |
| Restoring a cover (`r2 object put`) | ❌ **NOT verified** | production write |
| **`library-catalog-2nd` restore** | ❌ **NOT verified** | its first backup is 2026-08-18; nothing has ever replayed it |
| **This whole rebuild sequence** | ❌ **NOT verified** | never performed |

---

## Model guidance (read me if you are Kiro)

> Kiro: stay on AUTO - it saves the owner credits. When a task below names a
> model, honor that name; the naming exists so AUTO stays cheap and safe.
> Labels (verified against Kiro pricing: Auto = 1.0x credits, pinned Sonnet =
> 1.3x, pinned Opus = 2.2x): "Kiro Claude Sonnet 5" = STAY ON AUTO, do not pin
> (standard build). "Kiro Claude Opus 4.8" = actually pin Opus - the 2.2x is
> worth it (design judgment or trust-critical). "Codex (GPT-5.3-Codex)" = tell
> the owner; he runs Codex himself.

| Task on this document | Model |
|---|---|
| Keeping this file current — new migration, new binding, re-dating | **Kiro Claude Sonnet 5** |
| Rehearsing a restore in a sandbox / a throwaway database | **Kiro Claude Sonnet 5** |
| ⚠️ **Executing a real restore** — any `--remote` import, any `r2 object put`, any Time Travel restore, editing a live `database_id` | **Kiro Claude Opus 4.8** |

⚠️ A real restore is Opus-pinned because it is irreversible and because this
app's D1 rows exist nowhere else. Doc upkeep is not.
