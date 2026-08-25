# Secrets & ops commands — how to set/push keys and run the npx tooling

> **Audience:** the owner + Claude sessions. **Status:** TRACKED.
> **Last verified: 2026-08-25** — the Hardcover section below was re-checked
> against the code and the push allowlist that day and CORRECTED (it described
> work that was already done). ⚠️ **Not re-checked in the same pass:** whether
> each named secret is actually set on each instance — a secret store cannot be
> read back (KI-7), and `npm run secret:list` names only what exists.
> Complements [`RECOVERY.md`](RECOVERY.md), which
> is the disaster *inventory* (what every secret is + where a copy lives); this is
> the *operational* how-to (how to set, push, and rotate them, and the ops
> commands). One fact, one home: custody lives in RECOVERY, procedure lives here.

## ⚠️ The rule that governs this whole doc

**A raw secret value never goes into chat, and Claude never reads the file that
holds it.** Two safe channels only:
1. **Owner sets it interactively** — `wrangler secret put` prompts hidden; the
   value goes straight to Cloudflare. Claude can't see it and doesn't need to.
2. **Owner writes it to `apps/worker/.dev.vars`** (gitignored) and Claude runs
   `npm run secrets:push` — the *script* reads the file and pushes; Claude runs
   the command but never opens `.dev.vars`.

`.dev.vars` is gitignored and MUST stay that way. It is the single source of
truth for the main instance's secrets.

## Where secrets live

Cloudflare **Worker secrets** — encrypted at rest, never in git, never in
`wrangler.toml`. Two instances, two secret sets:
- **main** (`library.heygabi.ai`) — `.dev.vars` is its source of truth.
- **friend** (`padhard.heygabi.ai`) — ⚠️ **there is no `.dev.vars.friend` on
  purpose, and there must not be one.** Since 2026-08-25 a bulk push CAN reach
  her, but only with the `SHARED_SECRETS` list; her own key material is refused
  by name, not protected by a missing file. See "Both instances" below.

## Adding / rotating a secret

### Path A — `.dev.vars` + push (Claude can run the push)
```
# 1. Owner: add the line to apps/worker/.dev.vars (gitignored) — NAME=value
# 2. Claude or owner:
npm run secrets:push                  # MAIN — every allowlisted key present
npm run secrets:push -- --dry         # …show the plan, send nothing
npm run secrets:push:both             # MAIN then FRIEND (shared keys only)
npm run secrets:push:both -- --dry-run
npm run secrets:push:friend           # FRIEND only (shared keys only)
```
The MAIN allowlist is `PRODUCTION_SECRETS` in `scripts/push-secrets.mjs`. A key
not on it is skipped — add it there first (a one-line code change).

### 🆕 Both instances in one command (owner ask, 2026-08-25)

`scripts/push-secrets.mjs` classifies every key into **two explicit lists**, and
a key on both is a startup error:

| List | Members (2026-08-25) | Friend |
|---|---|---|
| **`SHARED_SECRETS`** — one value, two holders, by design | `GOOGLE_BOOKS_API_KEY`, `HARDCOVER_API_TOKEN`, `EBOOK_INGEST_TOKEN`, `AUDIOBOOK_MAPPING_TOKEN`, `DONOR_TOKEN`, `PEER_TOKEN` | **pushed** |
| **`PER_INSTANCE_SECRETS`** — each instance holds its own | `ANTHROPIC_API_KEY`, `INDEX_PUSH_TOKEN`, and **every `ESTATE_APP_TOKEN_*`** (prefix rule) | **refused, always** |
| anything else in `.dev.vars` | e.g. `INDEX_READ_TOKEN`, `LIBRARYTHING_API_KEY`, `GABI_PANEL` | refused with a sentence |

Per key the run prints exactly one of `push main` / `push friend` /
`refuse (per-instance)` / `refuse (not a shared secret)` / `skip (not set
locally)` / `skip (local only)`. **Names only — no value, and no fingerprint,
ever leaves the `--both`/`--friend` path.**

⚠️ **`INDEX_PUSH_TOKEN` is per-instance, not shared**, even though it has the
same *name* on both sides. The index Worker holds it as
`INDEX_PUSH_TOKEN_LIBRARY` and derives the pushing **source** from which
suffixed secret matched, so main's value on her Worker would file her rows as
`library`. Hers is unset until federation mints a `library2` token.

⚠️ **`EBOOK_INGEST_TOKEN` and `AUDIOBOOK_MAPPING_TOKEN` are shared by design but
UNSET on her instance today** — unset means those routes are *disabled*, not
open. Pushing them to her is what turns her machine routes on: a deliberate act,
not a tidy-up. 🔴 **And `--both` WILL push them whenever they are present in
`.dev.vars`** — measured 2026-08-25: the PEER_TOKEN rotation's `secrets:push:both`
created `EBOOK_INGEST_TOKEN` on padhard as a side effect (reverted the same
minute with `echo y | wrangler secret delete EBOOK_INGEST_TOKEN --env friend`).
Until the opt-in split in `TODO.md` lands, run `--both --dry-run` first and
check for those two names under FRIEND.

✅ **The friend push path was exercised for real on 2026-08-25** (the rotation):
`push friend HARDCOVER_API_TOKEN` / `PEER_TOKEN` → "Successfully created" on
`library-catalog-friend`, verified by the peer route accepting the new token.

⚠️ **Appending to `.dev.vars`:** check for a trailing newline first
(`tail -c1 apps/worker/.dev.vars | od -c`) or write `printf '\nKEY=%s\n'` — a
`>>` onto a file without one glues the new key onto the last value, and the
push ships it. Full incident in `info/gotchas.md`.

⚠️ `secrets:push` **with no flags is unchanged** — same list, same output, same
last-4 fingerprints. The both-instances work is additive.

### Path B — interactive `wrangler secret put` (owner runs)
```
npx wrangler secret put <NAME> --config apps/worker/wrangler.toml             # main
npx wrangler secret put <NAME> --config apps/worker/wrangler.toml --env friend # friend
```
Paste the value at the hidden prompt. This is still the ONLY way to set a
**per-instance** key on her env — and the drop-box pattern (a named line in the
MAIN `.dev.vars`, piped, then blanked) is still how a value that must never sit
in an allowlist travels. `ANTHROPIC_API_KEY_FRIEND_SAM` is the one in use.

### List what's set (no values shown)
```
npm run secret:list            # main
npm run secret:list:friend     # friend
```

**Measured 2026-08-25 (names only):**
- main (11): `ANTHROPIC_API_KEY`, `AUDIOBOOK_MAPPING_TOKEN`, `DONOR_TOKEN`,
  `EBOOK_INGEST_TOKEN`, `ESTATE_APP_TOKEN_DISCORD`, `ESTATE_APP_TOKEN_LIBRARY`,
  `GOOGLE_BOOKS_API_KEY`, `HARDCOVER_API_TOKEN`, `INDEX_PUSH_TOKEN`,
  `INDEX_READ_TOKEN`, `PEER_TOKEN`.
- friend (7): `ANTHROPIC_API_KEY`, `DONOR_TOKEN`, `ESTATE_APP_TOKEN_DISCORD`,
  `ESTATE_APP_TOKEN_LIBRARY2`, `GOOGLE_BOOKS_API_KEY`, `HARDCOVER_API_TOKEN`,
  `PEER_TOKEN`.

## The Hardcover.app key, concretely — ✅ SET ON BOTH, RUNG LIVE (2026-08-25)

Secret name: **`HARDCOVER_API_TOKEN`** (Bearer token; free key at
`hardcover.app/account/api`). In `env.ts` and on the `push-secrets.mjs`
allowlist.

**State, corrected 2026-08-25** (this section described the work as still to do
for a day after it was done):

- **The token is on BOTH instances.** Nothing to set. It is on the SHARED
  allowlist, so `npm run secrets:push:both` is what re-pushes it if it is ever
  rotated — the friend instance does **not** need the interactive
  `wrangler secret put` this section used to tell the owner to run.
- **The rung is SHIPPED.** `askHardcover` is rung 5 of the free-details ladder
  (`apps/worker/src/lib/free-details.ts`), deployed to both instances. It reads
  `env.HARDCOVER_API_TOKEN`, and an instance without it records the NAMED skip
  *"Hardcover: not asked — no HARDCOVER_API_TOKEN"* rather than looking like a
  rung that was asked and knew nothing.
- ⚠️ **It refuses to write a UNIVERSE into `work.series`** (fixed the same day):
  Hardcover files universes as series rows too, and *The Way of Kings* answers
  `[The Stormlight Archive #1, The Cosmere #7]`. Row order was deciding which
  tier landed. See the header of `askHardcover`.
- Rotation, if ever needed: put the new value in `apps/worker/.dev.vars` and run
  `npm run secrets:push:both`. (Owner never pastes the key to Claude; Claude
  never reads `.dev.vars`.)

## Ops command reference (which Claude can run vs which need the owner)

| Command | What | Who |
|---|---|---|
| `npm run deploy` / `deploy:friend` / **`deploy:both`** | Build + deploy a worker (clean-tree + overlap guards) | Claude |
| `npm run db:migrate` / `db:migrate:friend` / **`db:migrate:both`** | Apply migrations to one instance's D1 | Claude |
| `npm run backfill:audiobooks -- --remote [--friend] [--commit]` | Re-run the audiobook matcher (durable audio links) | Claude |
| **`npm run for-both -- <script> -- <args>`** | Run any npm script against main then friend, stopping on the first failure | Claude |
| `npx wrangler d1 execute library-catalog[-2nd] --remote --command "..."` | Direct prod D1 read/write | Claude (writes with care) |
| `npm run secrets:push` | Push `.dev.vars` secrets to MAIN | Claude (never reads the file) |
| **`npm run secrets:push:both` / `:friend`** | Push the SHARED set to both / to friend; per-instance keys refused | Claude (never reads the file) |
| `npx wrangler secret put ... [--env friend]` | Set one secret interactively | **Owner** (hidden prompt) |
| `npm run secret:list[:friend]` | List secret NAMES | Either |

## ⚠️ Known secret-hygiene gap (2026-08 audit)

A live **`PEER_TOKEN`** was committed in plaintext to this (public) repo — it needs
rotating. There is **no central password/key vault** (1Password/Bitwarden/etc.);
secrets are spread across Cloudflare, `.dev.vars`, GCP, Firebase. A proper
secrets-management review (inventory → flag exposed → recommend a vault +
rotation) is offered as a follow-up. See `docs/info/audit-2026-08-findings.md`.
