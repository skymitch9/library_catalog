# Provisioning a new BOOKS catalog — `scripts/provision-catalog.mjs`

> **Audience:** the owner first (he is the only person who can run it), Claude
> sessions second.
> **Status:** TRACKED — no secret values here, names only.
> **Last verified: 2026-09-05** — the script was written that day, and the
> sealed-key ladder (§6.4) was added to step 10 the same day. What was
> MEASURED: `node --check`; the whole suite (**2428 pass / 0 fail**); a
> `--dry --fixture` run printing all twelve steps and both pauses, leaving
> `git status` untouched and grepping clean of anything secret-shaped; the live
> Firebase authorised-domain read (13 domains, `amber.heygabi.ai` correctly
> absent); and **`--dry` against all three REAL rows in the live `estate_auth`
> D1** — #1 `library` and #2 `padhard` each refused as *"already live at
> https://…"* (**exit 2**, and the host read back correctly from the row), #3
> `boardgames` refused as a GAMES request pointing at design §8 (**exit 2**), and
> a nonexistent id refused at **exit 1**. So the D1 read path, the column
> mapping and every refusal are exercised against production data.
> ⚠️ **NOT verified — and this is the headline:** **no real instance has ever
> been provisioned by this script.** Nothing has run past `--dry`. No D1, no
> bucket, no hostname, no secret and no deploy exists because of it. Every AUTO
> step below is therefore *written and unexercised*, and the first real run is
> the test.
>
> **Added 2026-09-05, the sealed-key ladder in step 10.** MEASURED: a
> `--dry --fixture` run printing both envelope candidates by key name against
> the REAL bucket (`reader/4.json` and `owner/4.json`, both absent, falling
> through to the owner's key with the standing-decision line); the whole suite
> at **2428 / 0**. 🔴 **The measurement that mattered was a bug found in the
> rehearsal:** the first version read "any stdout means the object is there",
> and wrangler 4.123.0 answers a MISSING object with exit 127, the words *"The
> specified key does not exist."* on stderr **and a single newline on stdout** —
> so every absent envelope reported PRESENT. Fixed, and both real stderr strings
> are now fixtures in `catalog-platform/scripts/test/catalog-seal.test.mjs`.
> ⚠️ **NOT verified: no envelope has ever been decrypted from R2** — nothing has
> been sealed by a real browser, so rows 1 and 2 of the ladder below are proven
> only by a Node-to-Node round trip with a throwaway keypair.
>
> Design of record: `catalog-platform/docs/info/request-a-catalog-design.md`
> §7 (the whole of it) — this page is the runbook, that file is the reasoning,
> and neither restates the other.

---

## What it is

A signed-in estate member presses the **"+"** on the Books card of
<https://heygabi.ai>, the owner accepts it in `/admin`, and **nothing is
created** — Accept sets a status and hands over a checklist. This script is the
checklist, executed.

🔴 **It is never web-triggered.** The owner runs it on this machine with his own
wrangler login, from a clean tree. There is no route, no queue consumer and no
cron that reaches it, and there must not be: it creates databases, buckets,
hostnames and secrets.

```
npm run provision:catalog -- --request 4 --dry      # print everything, touch nothing
npm run provision:catalog -- --request 4            # do it, stopping at each manual step
npm run provision:catalog -- --request 4 --resume   # continue after a manual step
```

| Flag | Does |
|---|---|
| `--request <id>` | **required** — the `catalog_request` row in the estate directory D1 (`estate_auth`) |
| `--dry` / `--dry-run` | prints the derivation, every step, every command, and the whole manual runbook. **Writes nothing anywhere** — no wrangler write, no file edit, no commit, no mint |
| `--resume` | continue a half-finished provision: existing artifacts are skipped by name, and the manual pauses are **verified** instead of announced |
| `--instance <name>` | override the derived wrangler env name (see the naming rule) |
| `--covers-base-url <url>` | the bucket's public base, from the R2 console step |
| `--owner-break-glass` | ALSO put the estate owner on `OWNER_EMAILS`. ⚠️ Access-increasing, so it is a flag he types, never a default |
| `--enable <NAME>` | push one route-ENABLING shared secret (`EBOOK_INGEST_TOKEN`, `AUDIOBOOK_MAPPING_TOKEN`). One key at a time, deliberately |
| `--fixture <file>` | ⚠️ **`--dry` only.** Use a JSON row from a file instead of D1 — how the plan is exercised before a real request exists |

**Exit codes:** `0` done · `1` refused or failed · `2` this row cannot be
provisioned (a games request, a row that is not `accepted`) · `3` **paused** at a
manual step — not a failure, re-run with `--resume` when it is done.

---

## The names it derives, and the rule behind them

Nothing is asked of a person. From the row:

| Derived | Example | Rule |
|---|---|---|
| hostname | `amber.heygabi.ai` | **the only identity-bearing name** (design §7.1) |
| wrangler env / Worker | `amber` / `library-catalog-amber` | the **sanitised subdomain** — a Worker can be renamed, and the operator types this name a dozen times |
| D1 | `library-catalog-3rd` | **ordinal** — a D1 can never be renamed |
| R2 bucket | `library-3rd-covers` | **ordinal** — same, and a rehost is a data migration |
| estate app id | `library3` | **ordinal** — it is a CONTRACT with `catalog-platform` (`CONSUMER_APPS`, `appTokenFor()`, a `vis_` column), pinned per catalog, never per person or host |
| estate token NAME | `ESTATE_APP_TOKEN_LIBRARY3` | the app id selects the secret name |
| visibility column | `vis_library3` | one `ADD COLUMN`, `DEFAULT 0` |

⚠️ **This SPLITS design §7.1's rule rather than following it whole**, and the
split is deliberate: the doc makes every permanent name identity-neutral
(env `third`), the brief for this build asked for the env to follow the
subdomain. Both are honoured on the axis that matters — **what is cheap to
rename follows the person; what can never be renamed stays ordinal.**
`--instance third` gets the doc's convention back in one flag, and nothing else
about the run changes. ☐ The owner may want to settle which he prefers.

**The sanitiser, as a rule:** lowercase → every run of anything but `[a-z0-9]`
becomes one `-` → leading and trailing `-` trimmed → **refused** if it is empty,
longer than 30, a reserved wrangler word (`default`, `production`, `preview`,
`dev`, `development`, `staging`, `local`, `test`, `none`, `friend`), or the name
of an `[env.*]` block that already exists. 30 rather than the subdomain's 40
because the Worker is `library-catalog-<env>` and Cloudflare caps that at 63.
Every refusal names `--instance` as the way out.

---

## The twelve steps

| # | Step | Ledger (§7.3) | Idempotence probe |
|---|---|---|---|
| 1 | D1 create (binding stays `DB`) | AUTO | `wrangler d1 list --json` by name |
| 2 | R2 bucket + `COVERS_BASE_URL` | AUTO / ⚠️ **console for the URL** | `r2 bucket list`; the URL is read back out of the toml |
| 3 | the `[env.<instance>]` block | AUTO | the block is in `wrangler.toml` |
| 4 | `package.json` script twins | AUTO | the keys are present |
| 5 | commit an explicit allowlist | AUTO | nothing to commit |
| 6 | `db:migrate:<instance>` — **before any deploy** | AUTO | wrangler's own checkbox table |
| 7 | ⏸ **Firebase authorised domain** | 🔴 **MANUAL** | 🟢 the live domain list |
| 8 | ⏸ **auth-worker registration** | 🔴 **MANUAL** | 🟡 the sibling checkout's source |
| 9 | the paired estate token, both sides | AUTO (stdin) | `secret list` names |
| 10 | shared secrets, then the `ANTHROPIC_API_KEY` ladder (sealed reader → sealed owner → the owner's own) | AUTO (stdin) | `secret list` names; the R2 envelope is deleted once set |
| 11 | `deploy:<instance>` through the guards | AUTO, owner-run | `deploys.log` |
| 12 | `/api/health?cb=` then mark the row `live` | AUTO | the row's `status`; the key booleans follow step 10's source |

⚠️ **A plain run STOPS when it finds an artifact that already exists**, and that
is not pedantry: a D1 called `library-catalog-3rd` that this run did not create
is either a half-finished provision or somebody else's database, and adopting it
silently is how a new catalog ends up bound to the wrong data. `--resume` is the
word that says *"yes, that was me"*.

### The two pauses, and what `--resume` can actually MEASURE

| Pause | Checked by | Strength |
|---|---|---|
| #1 Firebase | `GET identitytoolkit.googleapis.com/v1/projects?key=<the public web key>` → `authorizedDomains[]` | 🟢 **a real measurement** — the console's own list, read live |
| #2 auth-worker (code) | the app id in `CONSUMER_APPS`, the `Env` field, a `case '<app>'` arm, a `vis_<app>` migration file | 🟡 **source, not production** — it proves the code is written, not that the Worker was migrated and deployed |
| #2 auth-worker (deployed) | nothing | 🔴 **unmeasurable from here** — only a real sign-in tailed with `"src":"seen"` proves the pairing ([`second-instance.md`](second-instance.md)'s three levels) |

A check that cannot be made is **said**, not assumed: the run prints its
NOT-verified list before it finishes.

### What the manual runbook contains

The script prints it in full on `--dry` and at each pause, with exact file paths
and the exact diff shape for `CONSUMER_APPS`, the `Env` field, the
`appTokenFor()` case arm, `EstateUserRow`, and the `vis_<app>` migration
(⚠️ `DEFAULT 0`, the deliberate opposite of 0002's `DEFAULT 1`, because it is
another household's shelf and is granted by hand). It does **not** apply the
auth-worker migration: the directory database is never migrated unattended.

---

## Secrets

⚠️ **A raw key never enters chat, and Claude never reads `.dev.vars`.** The
script reads it **in code** — the documented single source of truth
(`push-secrets.mjs:141`, [`secrets.md`](secrets.md)) — and pipes what it finds
straight to `wrangler secret put` over **stdin, never argv**, so no value reaches
a process list, a log, a console or a disk.

| Secret | On a new instance |
|---|---|
| `GOOGLE_BOOKS_API_KEY`, `HARDCOVER_API_TOKEN`, `DONOR_TOKEN`, `PEER_TOKEN` | **pushed** — `SHARED_ALWAYS` |
| `EBOOK_INGEST_TOKEN`, `AUDIOBOOK_MAPPING_TOKEN` | **skipped** — route-ENABLING, needs `--enable NAME` one at a time |
| `INDEX_PUSH_TOKEN`, `INDEX_READ_TOKEN`, every `ESTATE_APP_TOKEN_*` | **refused** — per-instance, with the same sentence a bulk push prints |
| `ESTATE_APP_TOKEN_LIBRARY<N>` | **minted here** (node crypto, hex, no trailing newline, no BOM) and set under the **same name on BOTH** the new instance and the auth Worker. ⚠️ Pipe first, deploy second — that order has no inert window |
| `ANTHROPIC_API_KEY` | **one of three sources, resolved at provisioning time** — see below |

⚠️ The refusal lists are **imported** from `scripts/push-secrets.mjs`
(`PER_INSTANCE_SECRETS`, `PER_INSTANCE_PREFIXES`), never restated, and
`secretPlan()` throws if a per-instance key ever reaches the push set. Design
§6.4 calls that guard one that must not be weakened; this is the mechanical half.

### 🔴 The Anthropic key — three sources, and the fallback costs the owner money

There is exactly **one** `ANTHROPIC_API_KEY` per instance, so precedence is not
a runtime rule: it is decided by which plaintext this script pipes into that one
secret (design §6.4). Step 10 tries them in this order, and the order **is** the
policy — falling to the owner's key while a perfectly good sealed one sat unread
in a bucket would spend his money on somebody else's catalog, invisibly, until a
bill.

| # | Source | The run logs | The row, at mark-live |
|---|---|---|---|
| 1 | the requester's sealed envelope, `estate-catalog-keys/reader/<id>.json` | `reader key used` | **neither boolean is written** — `reader_key_set` was set by the ROUTE when the envelope was stored, and one fact has one writer |
| 2 | the owner's sealed envelope from Accept, `owner/<id>.json` | `owner-at-accept key used` | `owner_key_set = 1` |
| 3 | the owner's own local key, from `.dev.vars` | `owner key used — standing decision 2026-09-05` | `owner_key_set = 1` |

Rows 1 and 2 are done by `catalog-platform/scripts/lib/catalog-seal.mjs`
(`injectSealedKey`): it fetches the envelope from the private R2 bucket,
decrypts it **in memory** with the provisioning private key on this machine, and
pipes the plaintext straight to `wrangler secret put` over stdin, then deletes
the R2 object. ⚠️ **It returns a word, not a value** — `{source}` — and there is
no decrypt-to-READ path anywhere in the estate (design §6.2), so nobody,
including the owner, can be shown a requester's key.

⚠️ **If the platform repo has no seal lib**, the run says so and falls to row 3
rather than failing a provision over a file only needed when somebody attached a
key. ⚠️ **A failed `secret put` does NOT delete the envelope** — running a step
twice is recoverable, deleting the only copy of a key is not.

**Row 3 is the owner's standing decision** (2026-09-05 ~07:03 Phoenix: *"Have it
fall back to my Claude key for now."*) and the run states two consequences out
loud, because they are spend, not configuration:

1. the new instance's hourly `"7 * * * *"` details sweep runs donor-then-AI and
   **spends that key** every tick the donor cannot fully answer;
2. `BILLING_POLICY` ships `"off"` (matching both existing instances), so nothing
   throttles it until a rule exists — write one on <https://heygabi.ai/admin/>,
   or drop the instance's `[triggers]` block to stop the tick.

**In a `--dry` run** step 10 prints which envelope keys it *would* look for and
whether each is PRESENT or absent — by key NAME only, never a byte of content.
A missing bucket is reported distinctly from a missing object, so *"the feature
is not deployed yet"* is never read as *"this person attached no key"*.

⚠️ **Custody of the private key:** `catalog-platform/docs/access/keys/catalog-provisioning.private.jwk`,
on this machine only. It is recorded in that repo's `docs/access/RECOVERY.md`
secrets table; without it, an envelope cannot be opened by anybody, ever.

---

## What ships OFF, and what is deliberately not done

| | Why |
|---|---|
| `PEERS = "[]"` | a peer entry lets this catalog read another household's holdings — **access-INCREASING**, therefore the owner's explicit call. Adding one is a line in each instance's `PEERS` **and a redeploy of every one of them** |
| `GABI_PANEL = "off"` | phase 0 is read-only so it risks no data, but she **spends the key**, and on this instance the key is the owner's |
| `INDEX_URL` set, both index tokens unset | the read and push halves are inert without their per-instance bearers |
| `DEFAULT_THEME = "apple"` | the estate default; padhard's `hearts` is hers, chosen for her |
| `OWNER_EMAILS = <the requester>` | design §7.2 step 9 option 1 — forced `owner` at every sign-in, so they cannot be locked out of their own shelf. ⚠️ Different from padhard on purpose, where that var is the estate owner's break-glass |
| no games path | `kind='games'` is refused at exit 2 with a message pointing at design §8: `Board_Game_Catalog` has zero `[env.*]` blocks, no script twins and a hard-coded estate identity. Provisioning one is a build in another repo |

---

## The one test that will catch tomorrow's mistake

`scripts/test/provision-catalog.test.mjs` reads the **real**
`apps/worker/wrangler.toml` and fails when the generated block and
`[env.friend]` disagree about which vars exist.

🔴 **Wrangler environments inherit NOTHING** — not `[vars]`, not bindings, not
routes, not triggers. A var added to the friend block and forgotten in the
generator is not a lint failure; it is a third instance that silently ships
without it, which is the same shape as the F-5 hard-coded-identity bug. So
adding a var to `[env.friend]` **fails the suite** until the generator carries
it too. That is the intended workflow, not an obstacle.

⚠️ **A gotcha it caught in itself, worth keeping:** the string
`[env.friend.vars]` is *mentioned in a comment* about 3,000 characters before the
real table, so an `indexOf` for the section header lands in the top-level
`[vars]` block and reads the MAIN instance's values while claiming to read the
friend's. Both the test and `existingVar()` use a line-anchored regex instead.

---

## After a real run

- ☐ **Commit `docs/deploys.log`** — `deploy-done.mjs` writes the line and
  deliberately does not commit it.
- ☐ **Watch one real sign-in**: `npm run tail --workspace @lc/worker -- --env <instance>`
  and look for `"app":"library<N>"` with `"src":"seen"`. `"none"` or
  `"stale_cache"` means the directory refused the bearer — wrong value, re-pipe.
  This is the **only** proof the paired token is right; `/api/health` proves the
  name is configured, not that the value matches.
- ☐ **Read `/api/health` with a cache-buster.** It is edge-cached on a custom
  domain and a plain fetch right after a deploy returns the PREVIOUS body.
- ☐ This LAN negative-caches a new subdomain for ~30 minutes; a dead-looking
  host right after the deploy is the router, not the deploy. Test through
  `*.workers.dev`.

**Review links:** `https://<host>/` · `https://<host>/api/health?cb=1` ·
<https://heygabi.ai/admin/>
