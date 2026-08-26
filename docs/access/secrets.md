# Secrets & ops commands — how to set/push keys and run the npx tooling

> **Audience:** the owner + Claude sessions. **Status:** TRACKED.
> **Last verified: 2026-08-26** — 1Password became the MASTER that day (the
> "vault" section below): 13 items imported into vault `Estate`, the
> `--source op` plan proved byte-identical to the `--source file` plan on all
> three paths (main / friend / both), and `HARDCOVER_API_TOKEN` was pushed to
> BOTH instances *from the vault* and landed — both Workers rolled to a new
> **Secret Change** version at 16:22 Phoenix. The live secret NAME lists were
> re-taken the same minute: main 11, friend 10, unchanged.
> ⚠️ **NOT re-checked:** whether the Hardcover ladder RUNG still answers — the
> only live path to it writes to production; see that section.
> **Previously verified: 2026-08-25** — the two `push-secrets.mjs` guards LANDED that
> day, and the "Both instances" section below was rewritten against the shipped
> code (`SHARED_ALWAYS` / `SHARED_OPT_IN` / `--enable`, and the glued-value
> refusal). The `--both --dry-run` plan quoted there was **run**, names only.
> Earlier that day the Hardcover section was re-checked against the code and
> CORRECTED (it described work that was already done).
> ⚠️ **Not re-checked in the same pass:** whether
> each named secret is actually set on each instance — a secret store cannot be
> read back (KI-7), and `npm run secret:list` names only what exists. The
> 2026-08-25 `secret:list` snapshots further down were NOT re-taken.
> Complements [`RECOVERY.md`](RECOVERY.md), which
> is the disaster *inventory* (what every secret is + where a copy lives); this is
> the *operational* how-to (how to set, push, and rotate them, and the ops
> commands). One fact, one home: custody lives in RECOVERY, procedure lives here.

## ⚠️ The rule that governs this whole doc

**A raw secret value never goes into chat, and Claude never reads the file that
holds it.** Three safe channels:
1. **Owner sets it interactively** — `wrangler secret put` prompts hidden; the
   value goes straight to Cloudflare. Claude can't see it and doesn't need to.
2. **Owner writes it to `apps/worker/.dev.vars`** (gitignored) and Claude runs
   `npm run secrets:push` — the *script* reads the file and pushes; Claude runs
   the command but never opens `.dev.vars`.
3. 🆕 **The vault (2026-08-26).** The owner puts it in 1Password vault `Estate`
   and Claude runs `npm run secrets:push:op` — `op` resolves the value straight
   into the push, and it never reaches the disk at all. See
   "The vault" below; this is now the **preferred** channel.

`.dev.vars` is gitignored and MUST stay that way. ⚠️ **Since 2026-08-26 it is no
longer the source of truth — it is a GENERATED artifact** and the vault is the
master. It still holds real key material whenever it exists, which is the reason
the standing advice is to regenerate it, push, and delete it again.

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
| **`SHARED_ALWAYS`** — one value, two holders, by design | `GOOGLE_BOOKS_API_KEY`, `HARDCOVER_API_TOKEN`, `DONOR_TOKEN`, `PEER_TOKEN` | **pushed** |
| **`SHARED_OPT_IN`** — shared, but **route-ENABLING** on the receiver | `EBOOK_INGEST_TOKEN`, `AUDIOBOOK_MAPPING_TOKEN` | **only with `--enable NAME`** |
| **`PER_INSTANCE_SECRETS`** — each instance holds its own | `ANTHROPIC_API_KEY`, `INDEX_PUSH_TOKEN`, and **every `ESTATE_APP_TOKEN_*`** (prefix rule) | **refused, always** |
| anything else in `.dev.vars` | e.g. `INDEX_READ_TOKEN`, `LIBRARYTHING_API_KEY`, `GABI_PANEL` | refused with a sentence |

`SHARED_SECRETS` still exists and is the **union of the first two** — it answers
"may this key's value travel between instances at all?", which is unchanged. A
key on both shared lists, like a key on both shared and per-instance, is a
**startup error** asserted at module load.

Per key the run prints exactly one of `push main` / `push friend` /
`refuse (per-instance)` / `refuse (not a shared secret)` / `skip (not set
locally)` / `skip (local only)` / `skip (opt-in; --enable NAME)`. **Names only —
no value, and no fingerprint, ever leaves the `--both`/`--friend` path.**

### 🆕 The opt-in rule for route-ENABLING keys (2026-08-25)

⚠️ **`EBOOK_INGEST_TOKEN` and `AUDIOBOOK_MAPPING_TOKEN` are shared by design,
but sending one to an instance is a CAPABILITY GRANT, not a rotation.** The
receiving Worker treats *unset* as *that machine route is disabled*, so a bulk
push that includes them opens a machine-writable door on a catalog that did not
have one. That is a different kind of act from re-sending a value the receiver
already holds, and it now needs a different keystroke:

```
npm run secrets:push:both                                  # opt-in keys SKIPPED
npm run secrets:push:both -- --enable EBOOK_INGEST_TOKEN   # …and this ONE sent
npm run secrets:push:friend -- --enable EBOOK_INGEST_TOKEN --enable AUDIOBOOK_MAPPING_TOKEN
```

- `--enable` is **repeatable** and takes **one key name at a time** — enabling
  one opt-in key never enables the other.
- `--enable` naming anything that is not on `SHARED_OPT_IN` **exits non-zero**
  rather than doing nothing, so a typo cannot look like it worked.
- `--enable` without `--friend`/`--both` exits non-zero: MAIN is the source of
  truth and already holds both.
- MAIN's half of `--both` is **unaffected** — it still gets everything the
  no-flag run sends, and never less.
- A run that does enable one prints a ⚠️ line saying so, **including on a dry
  run**.

📌 **Owner decision, 2026-08-25 — padhard is ON; future instances are not.**
*"her and I share audio and ebooks … they're already pre-mixed with mine; they
should count as she owns them too."* padhard is the owner's partner and they
share ONE audio and ebook pool, so both keys were set on her instance **by hand
that day** and her routes are live. The flag did not turn them on and does not
turn them off. **Any FUTURE library instance is opt-in by the owner**, one key
at a time — which is exactly what `--enable` makes someone type.

⚠️ Because they are now set on padhard, the pipelines had to learn to TARGET her:
`audiobook_catalog`'s STEP 11 sibling-link runs main **then** friend, and
`scripts/import-ebooks.mjs` accepts `--friend`. See
[`second-instance.md`](second-instance.md) → "Running the PIPELINES against her".

### 🆕 A glued value refuses the whole run (2026-08-25)

⚠️ **`.dev.vars` is parsed defensively now.** If any VALUE looks like two lines
welded into one — a `KEY=`-shaped run inside the value, or a stray CR/LF — the
run **refuses entirely** and pushes nothing, naming the KEY and never the value:

```
HARDCOVER_API_TOKEN in …/apps/worker/.dev.vars looks like two lines glued
together (a missing trailing newline?) — fix the file, nothing was pushed.
```

This is the 2026-08-25 incident, mechanised: a `>>` append onto a file with no
trailing newline welded `PEER_TOKEN=…` onto the end of `HARDCOVER_API_TOKEN`'s
value, `secrets:push:both` shipped the corrupt string to **both** instances, and
`PEER_TOKEN` never appeared as a key at all. Nothing downstream could catch it —
a secret is an opaque string, so "corrupt" and "rotated" look identical.

- It refuses the **whole run**, not the one key: a badly-appended file makes the
  next key just as suspect, and a partial rotation across two instances is worse
  than a failed one.
- It fires on **every** path, `--dry-run` included — a plan printed from a broken
  file is itself wrong.
- ⚠️ **base64 padding is deliberately NOT a glue** (`…QUJDRA==` is fine). A real
  weld always has the second key's VALUE after the `=`; that remainder is what
  tells them apart. Covered both ways in `scripts/test/push-secrets.test.mjs`.

⚠️ **`INDEX_PUSH_TOKEN` is per-instance, not shared**, even though it has the
same *name* on both sides. The index Worker holds it as
`INDEX_PUSH_TOKEN_LIBRARY` and derives the pushing **source** from which
suffixed secret matched, so main's value on her Worker would file her rows as
`library`. Hers is unset until federation mints a `library2` token.

✅ **The 🔴 warning that stood here is retired — the opt-in split landed
2026-08-25.** It read: *"`--both` WILL push `EBOOK_INGEST_TOKEN` and
`AUDIOBOOK_MAPPING_TOKEN` whenever they are present in `.dev.vars`"*, measured
that day when the `PEER_TOKEN` rotation's `secrets:push:both` created
`EBOOK_INGEST_TOKEN` on padhard as a side effect (reverted the same minute with
`echo y | wrangler secret delete EBOOK_INGEST_TOKEN --env friend`). **A bulk run
no longer does that**: those two are `SHARED_OPT_IN` and are skipped with a named
line unless `--enable NAME` is typed. See the opt-in section above.

Running `--both --dry-run` first is still good practice, and is now what the
plan looks like when it is working:

```
FRIEND — padhard.heygabi.ai (env friend)
  push friend              GOOGLE_BOOKS_API_KEY
  push friend              HARDCOVER_API_TOKEN
  push friend              PEER_TOKEN
  skip (opt-in; --enable NAME) EBOOK_INGEST_TOKEN
                             ↳ route-ENABLING: … a capability grant, not a rotation
```

✅ **The friend push path was exercised for real on 2026-08-25** (the rotation):
`push friend HARDCOVER_API_TOKEN` / `PEER_TOKEN` → "Successfully created" on
`library-catalog-friend`, verified by the peer route accepting the new token.

⚠️ **Appending to `.dev.vars`:** check for a trailing newline first
(`tail -c1 apps/worker/.dev.vars | od -c`) or write `printf '\nKEY=%s\n'` — a
`>>` onto a file without one glues the new key onto the last value. ✅ Since
2026-08-25 the push **refuses the whole run** if it sees one (see the
glued-value section above), but the guard is a net, not a licence: it names the
key, and you still have to fix the file. Full incident in `info/gotchas.md`.

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

### ⚠️ A secret push CREATES A NEW WORKER VERSION, and `deploys.log` never sees it

**Measured 2026-08-26.** `npm run secrets:push:both` rolled both Workers onto new
versions — main `1414e626…` → `46ba520b…`, friend `7d64d4f1…` → `91fe750c…` —
listed by `wrangler deployments list` as **Source: Secret Change**. The CODE is
identical (the same bundle, redeployed with new bindings), but:

- ⚠️ **`docs/deploys.log` records only `npm run deploy*` runs**, so after any
  secret push the newest line's version id is **no longer what is live**. When
  rolling back by version id, read `wrangler deployments list` as well —
  `deploys.log` answers *"which COMMIT is live"*, not *"which VERSION id"*.
- It is not a failure and needs no fix: a Secret Change version carries the same
  commit as the deploy beneath it. It is only misleading if you assume the log
  is complete.

### List what's set (no values shown)
```
npm run secret:list            # main
npm run secret:list:friend     # friend
```

**Measured 2026-08-25, RE-TAKEN 2026-08-26 — unchanged on both (names only):**

⚠️ **`DONOR_TOKEN` now has a master.** It was live on both instances with **no
readable copy anywhere** until 2026-08-26, when it was re-minted into
`apps/worker/.dev.vars` and pushed with `npm run secrets:push:both` (it is on
`SHARED_ALWAYS`, so one command rotates both halves). Custody is catalogued in
[`RECOVERY.md`](RECOVERY.md) §3; verification is a `GET /api/donor/details` with
the header against **both** hostnames — done that day, 200 on both, and 404 for a
wrong token or none.

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

## 🔐 The vault — 1Password is the MASTER as of 2026-08-26

📌 **Owner decision 2026-08-26 (option A): adopt 1Password NOW**, superseding the
2026-08-25 "defer (option C)". Plan of record:
`catalog-platform/docs/info/secrets-review-2026-08-26.md` §5.

**`apps/worker/.dev.vars` is no longer a hand-edited master. It is a GENERATED
artifact** — a build output you may delete and regenerate at will. The master is
1Password vault **`Estate`**.

```
apps/worker/.dev.vars.tpl     TRACKED. Names + pointers. No values.
        |
        |  npm run secrets:push:op        <- nothing touches the disk at all
        |  op inject -i ... -o .dev.vars  <- ...or make the real file, then delete it
        v
apps/worker/.dev.vars         GENERATED. Gitignored. Ephemeral.
```

### The item-title convention — the SAME in every repo

| Title | When | Examples |
|---|---|---|
| `<NAME>` | the NAME identifies **one value** estate-wide, however many holders | `HARDCOVER_API_TOKEN`, `PEER_TOKEN`, `DONOR_TOKEN`, `ESTATE_APP_TOKEN_LIBRARY` |
| `<holder>.<NAME>` | the same NAME means a **different value** on another holder | `library.ANTHROPIC_API_KEY`, `library2.INDEX_READ_TOKEN` |

- ⚠️ **The separator is a DOT, never a slash.** A secret reference is
  `op://<vault>/<item>/<field>`, so a title containing a slash is unaddressable:
  `op://Estate/library/ANTHROPIC_API_KEY/password` parses as item `library`,
  section `ANTHROPIC_API_KEY`.
- ⚠️ **`ESTATE_APP_TOKEN_*` is BARE**, even though `push-secrets.mjs` classifies
  it `PER_INSTANCE`. The two answer different questions: the list asks *"may a
  bulk run send this to her Worker?"* (no), the title asks *"does this name
  identify one value?"* (yes — the instance is already in the SUFFIX).
- **An unclassified key defaults to holder-scoped**, so a key nobody has decided
  about can never be mistaken for an estate-wide shared value.
- Every item carries tags `estate`, `library_catalog`, and `credential` or
  `local-config`; the **notes field records WHICH HOLDERS receive the value**, so
  the vault item *is* the custody record rather than a table that goes stale.

### The commands

```
npm run secrets:import:op                  # .dev.vars  -> vault   (idempotent)
npm run secrets:import:op -- --dry-run     # ...names + actions only
node scripts/op-import-dev-vars.mjs --write-template   # regenerate the .tpl

npm run secrets:push:op                    # vault -> MAIN
npm run secrets:push:friend:op             # vault -> FRIEND (shared keys only)
npm run secrets:push:both:op               # vault -> both
npm run secrets:push:both:op -- --dry-run
npm run secrets:push:both:op -- --only HARDCOVER_API_TOKEN   # ONE key
```

`SECRETS_SOURCE=op` in the environment is the same as `--source op`, for a shell
that has switched over wholesale. **`--source file` is still the DEFAULT and is
byte-for-byte unchanged** — backing the vault out is dropping a flag, not
reverting a rotation.

### 🆕 `--only NAME` — narrow a run to one key

Repeatable. ⚠️ **It can only ever REMOVE keys from what a run would send.** A
refusal stays a refusal, an opt-in key still needs `--enable`, and no key the
allowlists did not already contain can be added by naming it. `--enable` is the
flag that grants; this one only declines. It is how a single key is rotated
without a bulk run — and it is how the `op` source was first exercised in
production: one already-live value, re-sent unchanged.

### Regenerating the real file, when you actually want one

```
op inject -i apps/worker/.dev.vars.tpl -o apps/worker/.dev.vars
npm run secrets:push
rm apps/worker/.dev.vars            # ⚠️ it is a build output, not a master
```

⚠️ Prefer `npm run secrets:push:op`, which resolves the template to **stdout** and
parses it in memory — the file never exists, so there is no window in which it can
be read, synced to OneDrive, or left behind.

### ⚠️ The two traps, both measured on adoption day

1. **`op inject` parses COMMENTS.** It reads the whole file, not only the
   template expressions. A secret reference written in prose fails the entire
   resolve with *"invalid secret reference … too few /"*, and a stray pair of
   curly braces in prose fails it with *"only secret references or quoted strings
   can be enclosed in unescaped braces"*. Both happened, in the template's own
   header, minutes apart. The generated header now warns about it and a test
   asserts it. Full symptom entry in [`../info/gotchas.md`](../info/gotchas.md).
2. **Every `op` process can raise an authorization prompt a HUMAN must approve.**
   Unanswered, `op` writes `authorization timeout`; dismissed,
   `authorization prompt dismissed` — both were hit before the first successful
   call. This is why the import is ONE Node process batching its `op` calls, and
   why the push resolves the whole template with a single `op inject` rather than
   one `op read` per key. Both scripts turn the refusal into a sentence naming the
   click, never a bare exit code.

### What the vault does NOT fix

⚠️ **Worker secrets stay write-only.** The vault is a *master*, never a *readback
of what is actually installed*. `npm run secret:list` still proves only that a
NAME exists, and *"do these two holders carry the same value?"* is still
answerable only by the last-4 fingerprint on the main path, or by re-pushing both
sides.

### ✅ padhard's `INDEX_READ_TOKEN` HAS A MASTER NOW — 2026-08-26

It had none: her instance and `catalog-index` each held a value nothing on this
machine could read (estate secrets review §3.1), and the drop-box line
`INDEX_READ_TOKEN_FRIEND_PADHARD` in the MAIN `.dev.vars` is empty, as a
drop-box should be. `catalog-platform/scripts/op-rotate-pair.mjs` minted a fresh
value into vault item **`library2.INDEX_READ_TOKEN`** and set it on BOTH holders
in one run — `catalog-index` (the verifier) first, then her Worker.

**Proved live:** `GET index.heygabi.ai/api/machine/lookup?title=…` with the new
value returned **200 with 2 matching rows**, having returned **401** minutes
earlier with the same value before the rotation. Her secret NAME list after: 10,
unchanged.

⚠️ **The drop-box channel is superseded for THIS key.** Setting hers no longer
means piping `INDEX_READ_TOKEN_FRIEND_PADHARD` and blanking it — it means reading
`library2.INDEX_READ_TOKEN` from the vault. Leave the drop-box line in place and
empty; it is still the channel for anything the vault does not hold, and
`ANTHROPIC_API_KEY_FRIEND_SAM` still needs it (KI-7 — only Sam can mint that one).

⚠️ **A gotcha worth more than the rotation: a Cloudflare secret change is not
live the instant `wrangler` returns.** The first attempt set the verifier, probed
straight away, got 401, and stopped with the pair half-applied — her rung 2 was
down for the couple of minutes it took to resume. The value was right; the edge
had not caught up. Anything that pushes a secret and then immediately tests it
must retry with backoff before calling it a failure.

### 🔴 Three custody gaps, MEASURED 2026-08-26 — two of them NEW

The 2026-08-26 secrets review recorded these as *"master: library `.dev.vars`
(file exists; contents unopened)"* — a statement about the FILE. Parsing it for
NAMES (never values) for the 1Password import measured the contents for the first
time, and **two of those rows were wrong**:

| Secret | Live on | In `.dev.vars`? | Status |
|---|---|---|---|
| `ESTATE_APP_TOKEN_LIBRARY` | main ✅ | 🔴 **NO** | **NEW** — no readable master. Re-mint needs BOTH sides; `estate-auth` is the verifier |
| `INDEX_PUSH_TOKEN` | main ✅ | 🔴 **NO** | **NEW** — no readable master. Pairs with `catalog-index`'s `INDEX_PUSH_TOKEN_LIBRARY` |
| `AUDIOBOOK_MAPPING_TOKEN` | main ✅ + friend ✅ | 🔴 **NO** | Already known (`TODO.md`). Master is `audiobook_catalog/.env` `LIBRARY_MAPPING_TOKEN` |

All three print `skip (not set locally)` on a dry run, **from either source** —
a bulk run cannot rotate them, and the vault cannot hold what the file never had.
Closing each is a mint-and-set-both-sides operation. See [`../TODO.md`](../TODO.md).

⚠️ Three `.dev.vars` lines are **drop-boxes and are deliberately NOT in the
vault**: `ANTHROPIC_API_KEY_FRIEND_SAM`, `INDEX_READ_TOKEN_FRIEND_PADHARD` and
`CLOUDFLARE_API_TOKEN_CI`. All three are empty, which is their correct resting
state — a filled drop-box is an unfinished operation, never storage. The import
skips an empty value by name, and the template carries them as blank lines.

## Ops command reference (which Claude can run vs which need the owner)

| Command | What | Who |
|---|---|---|
| `npm run deploy` / `deploy:friend` / **`deploy:both`** | Build + deploy a worker (clean-tree + overlap guards) | Claude |
| `npm run db:migrate` / `db:migrate:friend` / **`db:migrate:both`** | Apply migrations to one instance's D1 | Claude |
| `npm run backfill:audiobooks -- --remote [--friend] [--commit]` | Re-run the audiobook matcher (durable audio links) | Claude |
| **`npm run for-both -- <script> -- <args>`** | Run any npm script against main then friend, stopping on the first failure | Claude |
| `npx wrangler d1 execute library-catalog[-2nd] --remote --command "..."` | Direct prod D1 read/write | Claude (writes with care) |
| **`npx tsx scripts/sweep-plan.mjs --remote [--friend]`** | ⚠️ **READ-ONLY** — what the next hourly details-sweep tick would plan, and whether it is stalled. Calls the real `planSweep`; writes nothing, spends nothing | Claude |
| `npm run secrets:push` | Push `.dev.vars` secrets to MAIN | Claude (never reads the file) |
| **`npm run secrets:push:both` / `:friend`** | Push `SHARED_ALWAYS` to both / to friend; per-instance keys refused; `SHARED_OPT_IN` skipped unless `-- --enable NAME` | Claude (never reads the file) |
| `npx wrangler secret put ... [--env friend]` | Set one secret interactively | **Owner** (hidden prompt) |
| `npm run secret:list[:friend]` | List secret NAMES | Either |
| 🆕 `npm run secrets:push:op` / `:friend:op` / `:both:op` | The same pushes, values resolved from the 1Password vault. Nothing written to disk | Claude (never sees a value) |
| 🆕 `… -- --only NAME` | Narrow any push to one key. ⚠️ Can only ever REMOVE keys from a run | Claude |
| 🆕 `npm run secrets:import:op` | Import `.dev.vars` into the vault. Idempotent; prints names + actions only | Claude (never opens the file) |
| 🆕 `node scripts/op-import-dev-vars.mjs --write-template` | Regenerate `apps/worker/.dev.vars.tpl` | Claude |
| `op item list --vault Estate` | List vault item TITLES (no values) | Either — ⚠️ raises a 1Password approval prompt the **owner** must click |

## ⚠️ Known secret-hygiene gap (2026-08 audit)

~~A live **`PEER_TOKEN`** was committed in plaintext to this (public) repo~~ —
**rotated 2026-08-25**, verified live on both instances (see `DONE.md`).
✅ **The "no central vault" half of this gap CLOSED on 2026-08-26** — owner
decision option A, superseding the 2026-08-25 "defer (option C)". 1Password vault
`Estate` is now the master for this repo's 13 `.dev.vars` keys and `.dev.vars`
is a generated artifact. See "The vault" above.

⚠️ **What is NOT closed, and must not be claimed as closed:** secrets still exist
ONLY on a Worker with no readable master — KI-7 (padhard's `ANTHROPIC_API_KEY`,
which only Sam can mint) plus the three measured gaps listed in that section
(`ESTATE_APP_TOKEN_LIBRARY`, `INDEX_PUSH_TOKEN`, `AUDIOBOOK_MAPPING_TOKEN`). A
vault cannot hold a value nothing on this machine can read; each of those needs a
mint-and-set-both-sides operation before the vault can become its master. ✅ **The two `push-secrets.mjs` guards that were queued in `TODO.md`
landed 2026-08-25** (the glued-value refusal and the opt-in split, both above);
they narrow the blast radius of a hand-edited `.dev.vars` but do not replace a
vault.
