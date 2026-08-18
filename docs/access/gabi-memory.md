# GABI's panel memory — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED — no secret values here.
> Last verified: **2026-08-18** (built, deployed to BOTH instances; the SQL
> exercised against local and both remote D1s).
> Design of record: [`../info/gabi-panel-v2.md`](../info/gabi-panel-v2.md).
> The contract the shape comes from:
> `catalog-platform/docs/info/gabi-conversation-continuity.md`.

The site chat panel keeps a **30-minute rolling window** of what was said, so a
person who closes the tab and comes back continues their conversation. It is the
**same substrate GABI uses in Discord** — one shape, one set of limits, one
implementation.

## What exists

| Thing | Value |
|---|---|
| Table | `gabi_conversation` (migration `0350_gabi_conversation.sql`) |
| Key | `conv:web_panel:<ESTATE_APP>:<app_user.id>` — **one row per person per instance** |
| Window | **30 minutes** sliding · **20 turns** (~10 exchanges) · **600 chars** per turn |
| Where the limits are defined | `catalog-platform/packages/gabi-conversation/src/index.ts` — ⚠️ **not here** |
| Store | `packages/db/src/gabi-conversation.ts` |
| Wiring | `apps/worker/src/lib/gabi-turn.ts` (the block after the guards) |
| Accounting | `gabi_turn.history_turns` / `.history_chars` |
| Route | **still only** `POST /api/gabi/turn` — there is no memory endpoint |

## ⚠️ Changing how she remembers happens in the OTHER repo

The window, the cap, the clip and the record shape live in
`catalog-platform/packages/gabi-conversation/`. Editing them there and running
this repo's build is what changes both surfaces at once — which is the entire
point of the unification.

```bash
# after pulling a change to the substrate
node scripts/sync-gabi-conversation.mjs   # also runs on prebuild/pretest/pretypecheck
npm test && npm run typecheck
```

⚠️ **`packages/gabi-conv/generated/` is a gitignored build artifact.** An edit
there is overwritten by the next build, silently — and until it is, the site
panel remembers differently from Discord.

## Looking at what she remembers

⚠️ **This reads people's chat text.** It is a debugging tool, not a routine one;
the whole design keeps this data small and short-lived on purpose.

```bash
# Counts only — safe, and usually enough.
npx wrangler d1 execute library-catalog --remote --config apps/worker/wrangler.toml \
  --command "SELECT storage_key, space, person, updated_at, LENGTH(record) AS bytes FROM gabi_conversation ORDER BY updated_at DESC;"

# Her instance
npx wrangler d1 execute library-catalog-2nd --remote --config apps/worker/wrangler.toml \
  --command "SELECT storage_key, updated_at, LENGTH(record) AS bytes FROM gabi_conversation;"
```

## Forgetting on purpose

Deleting a row is safe and needs no ceremony: **aged-out state is deleted, not
archived**, so the code is already built around rows vanishing.

```bash
# One person, one instance.
npx wrangler d1 execute library-catalog --remote --config apps/worker/wrangler.toml \
  --command "DELETE FROM gabi_conversation WHERE storage_key = 'conv:web_panel:library:7';"

# Everything. She starts fresh with everybody; nothing else is affected.
npx wrangler d1 execute library-catalog --remote --config apps/worker/wrangler.toml \
  --command "DELETE FROM gabi_conversation;"
```

⚠️ **Do NOT delete from `gabi_turn`** to "clean up" — that is the accounting
table, it holds no chat text, and it is the only record that money was spent.

## What continuity is costing

```bash
npx wrangler d1 execute library-catalog --remote --config apps/worker/wrangler.toml \
  --command "SELECT COUNT(*) AS turns, COALESCE(SUM(history_turns),0) AS remembered_turns, COALESCE(SUM(history_chars),0) AS remembered_chars FROM gabi_turn WHERE history_turns IS NOT NULL;"
```

⚠️ **NULL is not zero** in those columns: null means the turn predates the
column (or ran before memory was wired), `0` means a turn that genuinely
remembered nothing — which is what every first turn of a conversation looks
like. The `WHERE` above is what keeps the two apart.

⚠️ **The remembered TEXT is never in `gabi_turn`** — only how much of it there
was.

## Symptoms → where to look

| Symptom | Cause to check first |
|---|---|
| "She doesn't remember anything" | Is it the **same instance**? `library` and `library2` are two memories by design. Then: was it more than 30 minutes? |
| "She remembers but the panel says nothing" | The *"Picking up where you left off"* line renders **only on the first answer of a tab** and only when `memory.turns > 0`. Mid-conversation it is deliberately silent |
| "She repeated my question back / the conversation stutters" | The resume rule (`ref.cid`) — a tab being given its own turns back. `gabi-panel-v2.md` §4 |
| "Chat 500s" | ⚠️ **Not the memory.** Every path through the store returns the do-nothing answer instead of throwing; a broken memory makes her forget, never 500. Look at the model call and `gabi_turn.error_message` |
| Build fails naming `CATALOG_PLATFORM_DIR` | The sibling checkout is missing or stale. `git pull` in catalog-platform, or set the env var |

## NOT verified

- **No real conversation has been held against the deployed memory** on either
  instance. The acceptance script is in `docs/TODO.md`.
- **The 30-minute expiry has never been observed in production** — only in
  tests with a synthetic clock.
- **No model call was made by this build**, so `history_turns` /
  `history_chars` have never been compared against a real invoice.
