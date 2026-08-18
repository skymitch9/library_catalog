# GABI panel v2 — one conversation substrate, two surfaces

> **Audience:** Claude sessions + the owner. **Status:** TRACKED (public repo —
> no secrets). Last verified: **2026-08-18**, as built and deployed.
>
> Companion to [`gabi-fixer-design.md`](gabi-fixer-design.md), which owns the
> panel's architecture (one route, browser-held loop, tool allowlist). **This
> doc owns the MEMORY**, because the memory is deliberately not this repo's.
> The contract lives in `catalog-platform/docs/info/gabi-conversation-continuity.md`
> and the map entry in that repo's `gabi-application-map.md` §"Site panel v2".

---

## 0. What the owner asked for, verbatim

> *"Yes this is priority. I want to make upgrades it apply to both."*
> — 2026-08-18, on unifying the site panel with the Discord conversation.

And the constraint that shaped the record months before the panel needed it,
also his:

> *"whatever we build we need to consider for when we update the chat button on
> GABI."*

The point is not that the panel gained a memory. It is that the panel gained
**GABI's** memory: the next upgrade to how she remembers — a longer window,
richer turns, a persona change, a cap — lands once and serves both surfaces.

---

## 1. ⚠️ THE DECISION: SHARED SHAPE, SEPARATE STORAGE

**Decided 2026-08-18. This is the load-bearing call and it was not close.**

| | Shared SHAPE (chosen) | Shared STORAGE (rejected) |
|---|---|---|
| What travels | the record, the window, the limits, the alternation rule | all of that, plus the bytes |
| Where the panel's bytes live | this repo's D1 (`gabi_conversation`, migration 0350) | the Discord Worker's gateway Durable Object |
| A chat turn on the site depends on… | this Worker and its D1 | **the Discord Worker being up** |

Four reasons, in the order they cost something when ignored:

1. **A chat turn on the site must not depend on the Discord Worker being up.**
   That object holds an always-on gateway socket. When it drops, GABI goes quiet
   in Discord — and shared storage would take the website's chat down with it,
   for a person who has never opened Discord and cannot be told why.
2. **The continuity design already refused it, in its own words**, before this
   panel existed: *"It must NOT reuse the Discord Worker's Durable Object. The
   object is per-Worker and holds a bot token's session; the shape travels, the
   storage does not."*
3. **A cross-Worker call is a subrequest**, and this route's entire architecture
   is an argument about the 50-subrequest ceiling
   ([`gabi-fixer-design.md`](gabi-fixer-design.md) §3.1). Going over
   *terminates the invocation rather than throwing*.
4. **It would need a new trust edge** — an estate-app token, a new authenticated
   path into an object that holds a bot session — to buy a property nobody
   asked for. Two surfaces do not need to read each other's transcripts; they
   need to behave the same way.

⚠️ **What "shared shape" costs, honestly:** the same person talking to GABI on
the site and in Discord has **two** conversations. She will not carry a site
question into a DM. That is a real limitation, it is stated in the panel's own
words to the reader, and it is the price of #1. If it ever becomes wrong, the
fix is a *third* store both surfaces read — not one surface reaching into the
other's.

---

## 2. What was measured first

⚠️ Before anything was built, the panel's existing behaviour was **read off the
code**, not assumed:

| Question | Answer, 2026-08-18 |
|---|---|
| Where did panel history live? | **Entirely client-side.** `GabiPanel.tsx`'s `useState<Turn[]>`, re-sent whole on every turn |
| Did the Worker persist anything? | **No.** `gabi_turn` recorded *cost*, never text. The component's own comment said so: *"it is the transcript — the Worker persists nothing (§3.2, stateless) — so closing the tab ends it"* |
| So what broke? | Closing the tab ended the conversation. Exactly the complaint that produced the Discord side: *"I don't want to message GABI and then message her again and she has no recollection"* |
| Was there a shape to migrate? | **No.** Nothing was stored, so nothing needed migrating — the new table starts empty on both instances |

---

## 3. The code, and where each piece honestly lives

| Piece | Where | Shared with Discord? |
|---|---|---|
| Record shape, window, caps, clip, prune/append | `@platform/gabi-conversation` (catalog-platform) | **Yes — the same file** |
| Alternation rule (`normaliseHistory`, `modelMessages`, `withRemembered`) | same | **Yes** |
| History accounting (`historyCost`) | same | **Yes** |
| Materialised copy for this repo | `packages/gabi-conv/generated/` — **gitignored build artifact** | — |
| What a surface/space/person MEANS here | `packages/gabi-conv/src/panel.ts` | No — this repo's |
| The store | `packages/db/src/gabi-conversation.ts` + migration 0350 | No — this repo's |
| The wiring | `apps/worker/src/lib/gabi-turn.ts` | No |
| The one line a reader sees | `apps/web/src/components/GabiPanel.tsx` | No |

### 3.1 ⚠️ The sharing mechanism is the estate-auth precedent, not a new idea

`scripts/sync-gabi-conversation.mjs` materialises the canonical module into
`packages/gabi-conv/generated/` on every `prebuild`, `pretest` and
`pretypecheck`, and **fails the build loudly** if the platform checkout is
missing (naming `CATALOG_PLATFORM_DIR` and every path it tried). This is the
**third** package in this repo with a cross-repo dependency, after
`@lc/universes` and `@lc/estate-auth`, and it exists for the identical recorded
reason: two repos once held two copies of `auth.ts` and only one of them got a
security hardening.

⚠️ **Do not edit `packages/gabi-conv/generated/`.** The next build overwrites
it silently, and a local edit there would give the site panel a memory that
behaves differently from the memory GABI has in Discord — which is precisely
what this build exists to prevent.

⚠️ **The sync does a STRUCTURAL check, not a checksum**: it refuses a copy
missing `CONVERSATION_WINDOW_MS`, `CONVERSATION_MAX_TURNS`, `withRemembered` or
`pruneConversation`. A truncated copy typechecks for a surprisingly long time
before anything notices.

---

## 4. ⚠️ THE RESUME RULE — the one genuinely new piece of arithmetic

Discord and the panel differ in one way that decides the whole design.

- **Discord holds nothing between messages.** The store *is* the conversation,
  so every remembered turn goes into the prompt.
- **The panel holds its live tab's transcript** in React state — `tool_use` and
  `tool_result` blocks included, which the store deliberately never keeps — and
  re-sends the whole thing every turn.

Prepending the stored window there would send every turn **twice**: once as the
browser's copy, once as the server's. Paid for twice, and the model would see
the conversation stutter.

So the panel must know which remembered turns the browser is already carrying,
and the answer is **exact rather than heuristic**:

> The browser already mints **one `conversationId` per tab** (it did before this
> build, as the `gabi_turn` accounting join). Every turn this surface stores
> records that id in **`turns[].ref.cid`** — the surface-private bag the shared
> core never reads. A turn whose `cid` is the incoming one is a turn the browser
> has. A turn whose `cid` is anything else is a turn from a conversation the
> browser has forgotten — a closed tab, a reload, a phone picked up again — and
> **that is exactly what "she remembers" has to mean.**

⚠️ **Not matched on TEXT, deliberately.** Two identical questions ten minutes
apart are a normal thing to ask, and a text match would silently swallow the
second one. An id minted per tab cannot collide with itself.

⚠️ **A turn with no `ref.cid` at all counts as remembered.** The safe direction:
the failure mode is a turn appearing twice in one prompt (mild, visible), where
the other direction is GABI silently forgetting the thing the person is asking a
follow-up about — the exact defect this feature exists to fix.

### 4.1 The merge, and every 400 it prevents

`withRemembered()` is in the shared package because getting it wrong is the same
Messages-API 400 on both surfaces:

| Case | What it does |
|---|---|
| nothing remembered | the surface's array, untouched |
| remembered ends on `assistant` | straight concatenation (the surface's array always begins `user`) |
| remembered starts with `assistant` (the window cut there) | **drop** the leading assistant turns |
| consecutive same-role remembered turns | **merge** them |
| remembered ends on an **unanswered** `user` turn | **fold it into** the surface's first message — as a prefix for a string body, as a leading `text` block for a block array |

⚠️ The last row is the one that matters. The turn in the window with no answer
is exactly the one a follow-up refers to; dropping it would be tidy and wrong.

---

## 5. The key, and why each part is what it is

`conv:web_panel:<space>:<person>` — `conversationStorageKey()`'s output, stored
whole rather than recomputed, because the joining rule (length caps, separator
replacement) belongs upstream.

| Part | Value here | Why |
|---|---|---|
| `surface` | `web_panel` | The constant the continuity doc §1.3 wrote down before the panel existed. Named as a constant, not typed at call sites: a typo would not fail, it would silently give somebody a second empty memory |
| `space` | **`ESTATE_APP`** (`library` / `library2`) | The identifier the estate already uses for an instance — the auth Worker's per-app token, GABI's Discord `instance_pick` rows. A hostname would be a second vocabulary for one fact. ⚠️ **The two instances are two memories**: same person, different shelf, different conversation |
| `person` | the **`app_user` id** | Not the Firebase uid: `app_user.firebase_uid` is **nullable** in this schema, so keying on it would give one person two memories depending on when their row was written. The `app_user` id is present for everybody the auth middleware admits, never changes, and is already what `gabi_turn.user_id` accounts against — so "what did this cost" and "what does she remember" are about the same person by construction |

⚠️ **`space` and `person` stay OPAQUE to the substrate.** `panel.ts` is the only
place in the estate that knows the person string is a number, and the storage
key never parses it back. That is why `gabi_conversation` has **no foreign key**
on `person`: a foreign key is a database that parses an opaque string.

---

## 6. Where it lives, and the write budget

**`gabi_conversation`** in this repo's D1 (migration 0350). **One row per person
per instance** — not per conversation — which is what makes a new tab continue
rather than start a second memory.

| | Writes |
|---|---|
| `loadPanelConversation()` | **0** on the normal path; the prune is in memory. Its one possible write is a **DELETE** of a wholly aged-out row |
| `savePanelConversation()` | **1**, and only on an **answered** turn that produced prose |
| `sweepPanelConversations()` | **1** statement, and only when a save happens |

A turn that only asked for tools writes nothing — it is a step inside an
exchange, not an exchange — and that rule has one implementation
(`panelExchange()`), which the store simply obeys.

⚠️ **D1 rather than a Durable Object, and the reasoning is the mirror image of
Discord's.** That repo rejected D1 because it would be *"a new binding on the
credential-lightest Worker in the estate, for one table"*. Here D1 is already
bound, already carries `gabi_turn`, and is already written by this exact route —
so it is the choice that adds nothing. A Durable Object here would be the new
binding.

### 6.1 ⚠️ Aged-out state is DELETED, not archived

`pruneConversation()` returns `null` when nothing is left inside the window and
**every caller must answer that by deleting the row.** No archive column, no
tombstone, no `expired` flag — an empty-but-present row would leave a key per
person per instance forever, and that key still says who talked to her and
where.

⚠️ **Prune-on-read cannot do all of it.** Somebody who chats once and never
returns leaves half an hour of their words in the table indefinitely — the
privacy posture failing quietly, which is the worst way for it to fail. So
`sweepPanelConversations()` rides the **save** path: one indexed
`DELETE … WHERE updated_at < ?`, running exactly as often as the only thing that
creates rows. Not a cron, because this estate's free cron slots are contended
and a prior deploy FAILED on precisely that.

---

## 7. Accounting: the same two fields, by the same names

`gabi_turn` gains **`history_turns`** and **`history_chars`** (migration 0350) —
the same names GABI's Discord accounting line already uses, so the two surfaces
compare without a translation step.

Context tokens are charged on **every** turn, so continuity's share of a
conversation's bill is the one thing a token total cannot break out. A full
window is 20 × 600 = **12,000 characters ≈ 3k tokens**; on Opus 5 with the
cached ~2.5k prefix most of that is fresh input, which is why it is recorded
rather than assumed.

⚠️ **The remembered TEXT is never logged** — only how much of it there was.
⚠️ **NULL is not zero.** Null means the turn predates the column; `0` means a
turn that genuinely remembered nothing, which is what every first turn looks
like. `gabiSpend()` sums `history_chars` with the same `COALESCE` every other
column gets.

---

## 8. What a reader sees

- **The intro states the limit beside the capability**: *"She remembers the last
  half hour of a conversation, so you can come back to it in a new tab. After
  that it is gone."* ⚠️ "She remembers" alone is a promise this build does not
  keep.
- **"Picking up where you left off"** appears **only when something was actually
  remembered**, with the count, above the first answer. A model that knows
  things this tab never said reads as a model inventing them; naming the window
  turns that into a feature. Zero remembered turns says **nothing** — an empty
  reassurance is noise.
- ⚠️ It is **not** styled as a turn. It is the panel talking about itself, and
  giving it GABI's bubble would put words in her mouth she did not say.
- **The transcript still starts empty in a new tab.** She remembers; the panel
  does not re-render. Same as Discord, and deliberate — see §9.

---

## 9. ⚠️ What this build deliberately did NOT do

| Not done | Why |
|---|---|
| **A second route** (`/api/gabi/conversations`, a history GET) | The posture test pinning `POST /turn` as the only declaration is **untouched**. She does not *display* what she remembers any more than she does in Discord; a read-back route would be a second projection of somebody's chat text and a thing to keep in sync with a transcript the browser already holds |
| **The docs tools** | Explicitly out of scope. The devops gating that would have to come with them is its own decision — see `catalog-platform/docs/info/gabi-docs-assistant-design.md` — and it is **not** made by this build |
| **Per-user / per-day turn caps** | Discord fuses at 20 answered turns per person per hour and 200/day estate-wide. The panel has the message-count ceiling (`GABI_MAX_TURNS`) and the body-byte fuse and **nothing new was added**: adding refusals nobody asked for could lock the owner out of his own catalog mid-conversation. ⚠️ The *grammar* is shared and the constants are one import away; the *policy* is an owner decision |
| **`pending` / confirm components** | The field is in the shared shape and the panel writes `null`. Its clarifying question is prose in a chat box, not a component somebody presses, so there is nothing to resume and nothing to age out. A T2 confirm lane would be the same shape |
| **Cross-surface memory** | §1's honest cost. Site and Discord are two conversations |

---

## 10. ⚠️ NOT VERIFIED

- **No real conversation has been held against the deployed memory.** Every
  claim below the model call is exercised by tests and by direct SQL; the
  end-to-end "ask, close the tab, come back, she remembers" has **not** been
  performed by a person on either live instance. That is the acceptance test and
  it is in `TODO.md`.
- **No model call was made by this build.** Every test supplies a counting
  stand-in or no key at all, so `history_turns` / `history_chars` have never
  been observed against a real invoice.
- **The write budget is arithmetic**, over a published limit and this route's
  existing behaviour. The first week of real use is the measurement.
- **The 30-minute window has never been observed expiring in production** —
  only in tests with a synthetic clock.
- **The two-tabs-at-once case is reasoned, not measured.** Two tabs on the same
  catalog share one memory by design; the interleaving of their `cid`s is
  handled by the filter but has not been exercised by a person.
