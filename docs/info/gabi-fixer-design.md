# "Sam asks GABI to fix her books" — conversational fixer (design)

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-17** — every claim in §1 was established that day by
> reading the named source files in this repo and in `catalog-platform`. §11
> lists what was **not** verified, and says which of those the build then closed.
>
> ⚠️ **PHASE 0 IS BUILT AND DEPLOYED (2026-08-17).** This started as a design doc
> where nothing existed; the read-only loop, the turn route, the accounting
> migration and the site panel now do. **§9 is the map of what is and is not
> built** — phases 1–3 remain unbuilt, and §12's decisions about them are
> *answered*, not *shipped*. §7's arithmetic has been replaced with measured
> figures (§7.4). Everything else below still describes the whole design,
> including the parts that are still design.

**The owner's ask, verbatim (2026-08-16 late):**

> *"in the future i want Sam to be able to ask gabi to fix books for her like id
> ask you. it'd be done through api but it would have the needed context to fix
> things."*

**The four constraints the seed locks (`docs/TODO.md`, "Sam asks GABI to fix her
books"), restated here because every section below answers to them:**

1. **The write plumbing already exists and must be REUSED, never bypassed.**
   `claimRun` / `saveFindings` / `applyFinding` / `autoApplyFindings` are the one
   canonical path that fixes a book, with provenance and revert built in. A
   conversational GABI is a new **front door** to that machinery, not a new
   writer.
2. **Her authority, not GABI's.** Actions run as Samantha, on her instance
   (`padhard.heygabi.ai`), attributable in the audit trail — never as a service
   account.
3. **Guardrails.** An action allowlist (detail fixes, cover swaps; deletes
   excluded), confirm-before-write for anything bulk, spend on the
   capped-workspace key design.
4. **Surface deferred.** Site chat panel vs Discord DM is a later decision; the
   API loop must be identical behind either.

**Sequencing (owner, `TODO.md`):** current batch → Discord portal → EPUB/PDF
viewer → **this**. It is a design seed, not a queued build.

---

## 0. The design in one paragraph

GABI is an **Anthropic tool-use loop whose tools are HTTP calls Samantha's own
browser already makes**. A thin Worker route, `POST /api/gabi/turn`, holds the
`ANTHROPIC_API_KEY` and makes **exactly one** model call per turn — it does not
loop, and it touches no catalog table. The loop itself runs in her browser,
which already holds a live Firebase ID token and already knows how to call every
endpoint in `apps/web/src/api.ts`. When the model asks for `set_book_details`,
the browser issues the same `PATCH /api/works/:id` the edit form issues, with
her token, through `requireAuth` and `requireCapability` untouched — so "her
authority end to end" is not a thing this design builds, it is a thing this
design **declines to circumvent**. The tool definitions and the allowlist live
in `@lc/core` as one exported array, default-deny, so the Worker and any front
end cannot drift (the `CAPABILITY_MATRIX` precedent). Writes split into two
lanes that map exactly onto the estate's existing `decided_how` semantics:
blank-field single-book fixes land unattended and stamp `'auto'` (nobody read the
value) with her id as the authority; everything else — overwrites, batches,
covers not already in the catalog's candidate list — is proposed as an
old→new manifest and stamps `'human'` only after she says yes. Nothing in the
allowlist can delete a row, and nothing can touch `title` or `authors`, for the
same reason `applyFinding` cannot: those two derive `work_key`, and moving it
needs a Firestore attestation the Worker is structurally unable to make.

---

## 1. What is true today — read 2026-08-17

### 1.1 The canonical write path the loop must ride

`apps/worker/src/lib/research-run.ts` (806 lines) is the file. Its shape:

| Function | What it does | Why the loop needs it |
|---|---|---|
| `claimRun(db, workId, triggeredBy)` | Sweeps stale runs, refuses a second concurrent run for the same book, stamps `research_run` with the inputs *as they were before the lookup* | Idempotence. A chatty user who asks twice buys one answer, not two. |
| `runDetailsResearch(env, runId, workId, fields, triggeredBy)` | The paid Claude call, then `saveFindings`, then `autoApplyFindings`, then `finishRun`. **Never throws** | The whole fix-a-book operation, already atomic-ish and already audited |
| `applyFinding(db, finding, userId, decidedHow)` | Writes ONE value. Three rules: **gaps only** (never overwrites a non-blank column), `none`/`unknown` become `gap_verdict` rows not values, and **nothing here can reach `title` or `authors`** | The blank-only rule is what makes undo a one-liner |
| `autoApplyFindings(db, workId, userId, options?)` | Applies every pending finding in `DETAIL_FIELDS` order (so `series` lands before `seriesIndex`), reports skips **by name**, leaves only `unusable` pending | The no-silent-drops guarantee |
| `revertFinding(db, finding)` | Un-applies one auto-applied value by writing `null`. Gated on `decided_how = 'auto'` so a bulk undo can never reach something a person typed | Revertability, for free |

⚠️ **`revertFinding` is a one-liner only because `applyFinding` writes into a
blank.** Its own header says so: *"If a future change ever lets `applyFinding`
overwrite a non-blank column, this becomes wrong and starts destroying data."*
That single sentence is the strongest constraint in this whole design — it is
why §6's auto lane is **blank fields only**, and why an overwrite is a
different lane with a different provenance stamp.

⚠️ **Do not add a confidence threshold.** `research-run.ts`'s header forbids it
in three places and gives the reason: everything found is applied, and
everything unapplied is reported by name. A conversational front door must not
quietly reintroduce one by having the model "decide whether this is good
enough" before proposing it.

### 1.2 Provenance — the two columns, and what they actually mean

`packages/core/src/constants.ts:614` — `DECISION_MODES = ['human', 'auto']`,
and the comment above it (lines 602–613) settles a question §5 would otherwise
have to invent an answer to:

> *"`reviewed_by` / `decided_by` answer **on whose authority** — and under
> auto-apply that is still a real person, the one who pressed Look up. This
> answers **did anybody actually look at the value**, and under auto-apply the
> answer is no."*

`change_log` (migration `0120_change_log_and_authorless.sql`) carries
`changed_by INTEGER REFERENCES app_user(id)`, `changed_how TEXT NOT NULL DEFAULT
'human'` — **no CHECK constraint** — and `note TEXT`. `Actor`
(`packages/db/src/changes.ts:32`) is `{ userId, how, note? }`, and `note` is
documented as *"the one fact worth keeping beside the diff"*.

**Consequence for this design:** the enum already expresses exactly the
distinction confirm-before-write creates. No migration is needed to make a GABI
write auditable — §5.2.

### 1.3 The runtime numbers that shape the architecture

All from this repo's own comments, which record them as measured:

| Fact | Source | Consequence here |
|---|---|---|
| **50 subrequests per invocation**, every D1 call included; exceeding it **terminates the invocation rather than throwing** | `research-run.ts` §"Subrequest arithmetic"; `details-sweep.ts` §2 | A silent death. The one failure mode a conversation must never have |
| One research run ≈ **7**, or **~24 of 50** once auto-apply's `4·fields` is counted | `research-run.ts` | A single `research_book` tool call already spends half a budget |
| *"A 'research these ten' route must not share an invocation"* — ten runs is ~70, past the cap | `research-run.ts` | Any batch must be one book per invocation |
| `waitUntil` alone is a bug: a registered task is cancelled ~30s after the handler settles, and a lookup takes 20–90s. The sibling project lost half its runs silently | `research-run.ts`, `index.ts` `scheduled()` | Awaiting keeps the invocation open; a long await is *fine* and is in production today |
| `RESEARCH_TIMEOUT_MS = 90_000` | `packages/research/src/details.ts:64` | A 90-second await is normal here, not exotic |
| `wrangler.toml` has **no `[limits]` block** | read directly | CPU limit is whatever the platform default is — see §11 |
| The estate has **no Durable Objects and no Queues** — none in any of the five `catalog-platform/apps/*` or either library env | grepped `wrangler.toml`/`.jsonc` across both repos | A queue-based loop is new infrastructure, not a config line |

### 1.4 Her instance, as it stands

From `apps/worker/wrangler.toml` `[env.friend]` and
`docs/access/second-instance.md`:

| | `padhard.heygabi.ai` (env `friend`) |
|---|---|
| Worker | `library-catalog-friend`, same code as main |
| D1 | `library-catalog-2nd` — hers alone |
| `ANTHROPIC_API_KEY` | **Her own key**, minted 2026-08-16, replacing the owner's stopgap. ⚠️ Whether it is in a capped workspace is *not verified* (`second-instance.md`) |
| `ESTATE_CHECK` | `enforce` |
| `DONOR_URL` | `https://library.heygabi.ai` — her sweep heals from the main catalog first, free |
| `ESTATE_DEFAULT_ROLE` | **Unset — the owner PAUSED the `moderator` flip**, so estate auto-grant hands out `member` |
| Deliberately unset | `INDEX_PUSH_TOKEN`, `EBOOK_INGEST_TOKEN`, `AUDIOBOOK_MAPPING_TOKEN` |

⚠️ **The capability floor is the feature's on/off switch, and it was not
measured.** `CAPABILITY_MATRIX` puts `editCatalog` at contributor+,
`runResearch` and `reviewFindings` at moderator+, `manageUsers` at admin+. The
seed says Samantha is `admin` on her instance; her actual `app_user.role` row
was **not read** (no D1 query was run — §11). If she is `member`, every write
tool in §4 answers 403 and GABI is a read-only assistant. **Check this before
building anything.**

### 1.5 The endpoints that exist today, by capability

Every route was enumerated from `apps/worker/src/routes/*.ts`. The ones this
design cares about:

| Route | Capability | Notes |
|---|---|---|
| `GET /api/works/match?title&authors` | `read` | Exact `work_key` match; the disambiguation front door |
| `GET /api/collection` (+`/facets`, `/stats`) | `read` | The searchable list |
| `GET /api/works/:id` | `read` | One book, with everything |
| `GET /api/works/:id/changes` | `read` | The audit trail for one book |
| `PATCH /api/works/:id` | `editCatalog` | ⚠️ `.strict()` — unknown fields are a 400, never a silent strip. ⚠️ A `title`/`authors` change that moves a non-provisional `work_key` demands a `keyMove` attestation (§4.3) |
| `GET /api/research/queue` | `read` | The worklist + per-field tally + `configured` flag |
| `POST /api/research/works/:id/run` | `runResearch` | The paid lookup. Awaits 20–90s. Applies what it finds |
| `POST /api/research/works/:id/verdict` | `reviewFindings` | Free. Requires a non-empty `source` |
| `PATCH /api/research/findings/:id` | `reviewFindings` | The leftovers a value could not be used for |
| `POST /api/research/undo` | `reviewFindings` | **Capped at 10 ids**, sequential, refuses rather than truncating |
| `GET /api/research/auto-applied` | `read` | What the machine wrote lately — the consideration in the auto-apply bargain |
| `GET /api/works/:id/covers` | `editCatalog` | Candidate covers from what the catalog already knows |
| `PUT /api/works/:id/cover` | `editCatalog` | Points at someone else's URL. **Fetches and verifies the image before writing the column** |
| `PATCH /api/works/:id/cover-status` | `editCatalog` | "That cover is not the book" |
| `POST /api/works/:id/cover` | `editCatalog` | Upload. Needs R2; hers is bound (`library-2nd-covers`) |
| `DELETE /api/works/:id`, `/editions/:id`, `/copies/:id`, `/works/:id/cover` | `editCatalog` | **Excluded by name** — §4.3 |
| `POST /api/scan-jobs/shelf`, `/single` | `scanPhoto` | Spends vision money and needs an image; out of scope |
| `/api/ingest/*`, `/api/donor/*`, `/api/machine/*` | *(static token, mounted before `requireAuth`)* | Not hers, not a person's. Never a tool |

**One structural fact worth stating plainly:** every write route in that table
already produces a worded refusal — `capabilityDenied` returns
`{error, capability, role, detail}` with a sentence, and the global rule is that
a person never sees a bare status. So the loop's error vocabulary is the app's
error vocabulary, unchanged. §8 depends on this.

---

## 2. Goals and non-goals

### Goals (v1 = the owner's stated scope)

- **Her instance only.** `padhard.heygabi.ai`. The main library is out of scope
  and stays out until this has run on hers for a while.
- **Detail fixes and cover swaps.** The four `DETAIL_FIELDS`, plus `universe`
  and the printed volume form, plus the three cover verbs.
- **Single book, and small batches.** "Small" is defined as **≤ 10**, and the
  number is not arbitrary — §6.3.
- **Conversational.** She describes the problem; GABI finds the book, proposes,
  and either acts or asks. No form, no queue page, no ids typed by hand.
- **Every write lands exactly as if she had clicked the UI** — same route, same
  middleware, same `change_log` row, same undo.

### Non-goals (v1)

- **No deletions.** Not works, not editions, not copies, not covers. The seed
  excludes them and §4.3 keeps the exclusion mechanical.
- **No identity edits.** `title` and `authors` are unreachable — §4.3.
- **No role or user management.** `manageUsers` is not in the allowlist and
  never will be in a conversational surface.
- **No scanning, no uploads, no exports.** Photo scanning bills the vision API
  and needs an image; `GET /api/export.*` hands the whole catalog to whatever is
  reading the conversation.
- **No cross-instance action.** GABI on her site cannot touch the main library,
  because her browser's token is only good on her origin.
- **No autonomy while she is away.** Every turn is driven by a live
  conversation. The unattended lane already exists and is the hourly details
  sweep — this is not a second one.
- **No new writer.** If a fix cannot be expressed as a call to an endpoint that
  exists, v1's answer is "GABI says it cannot do that," not a new route.

---

## 3. The loop architecture

### 3.1 Three places the loop could run, and the honest ceiling on each

**Option A — the Worker runs the whole loop server-side.** One route, called
once, iterating `model → tool → model` internally against its own D1 handlers.

The appealing option, and the one to refuse. The arithmetic:

| Per turn | Subrequests |
|---|---|
| The Anthropic call | 1 |
| `find_book` (a `getWork` + a match query) | ~2 |
| `set_book_details` (`getWork` + `updateWork`'s own read + UPDATE + change_log batch) | ~4 |
| `research_book` — the whole `claimRun` + `runDetailsResearch` + apply chain | **~12 + 4·fields**, i.e. 20–28 |

A six-turn conversation that researches one book and patches two fields is
`6 + 2 + 8 + 24 ≈ 40 of 50`, and a seventh turn or a four-gap book puts it
over. ⚠️ **Going over does not throw — it terminates the invocation.** This
repo has been bitten by silent Worker failures twice (the `waitUntil`
cancellation that stuck a run at `running` for eleven hours; the sweep's own
subrequest note), and a *conversation* whose failure mode is "the reply never
comes and nothing is logged" is the worst possible place to accept that risk.
Wall clock is not the problem here — a 90-second await is in production today —
the ceiling is.

**Option B — a client-driven loop from her browser.** ✅ **Recommended for v1.**

The browser holds the conversation. Each turn is:

```
browser ──POST /api/gabi/turn { messages }──▶ Worker ──1 call──▶ Anthropic
browser ◀──── { content, stop_reason, usage } ────┘
   │
   ├─ model asked for a tool? execute it via api.ts, with HER token,
   │  against the SAME endpoint the UI uses  (its own invocation, own 50)
   └─ append tool_result to messages, post the next turn
```

What this buys, in order of importance:

1. **Authority is not simulated — it is the session.** Every tool call is a
   request her browser was already permitted to make. `requireAuth` verifies her
   Firebase ID token, `requireCapability` checks her role, `change_log` records
   her id. There is no impersonation layer to get wrong, because there is no
   impersonation layer.
2. **The subrequest problem disappears.** `/api/gabi/turn` spends ~1 subrequest.
   Every tool call is a separate invocation with its own fresh 50 — a
   `research_book` gets the exact budget it gets today, because it *is* today's
   route.
3. **A batch is naturally one book per invocation**, which is what
   `research-run.ts` demands, without anyone having to remember it.
4. **Token refresh is free.** `api.ts` calls `getIdToken()` per request and
   `apps/web/src/lib/firebase.ts` keeps it live, so an hour-long conversation
   does not hit an expiry cliff.
5. **The failure mode is a stalled tab, not a silent server death.** She can see
   it. That is a strictly better class of failure.

The cost: the executor (tool name → `api.ts` call) is client code, and a Discord
front end cannot reuse it. §10 splits the design so that only the executor is
per-front-end — the tool definitions and the turn route are shared.

**Option C — queue-based turns, or a Durable Object per conversation.**
Deferred. The estate has **no Queues and no Durable Objects anywhere**
(measured, §1.3), Queues additionally requires the Workers Paid plan (which is
itself unverified, §11), and a DO would exist to solve a state problem the
browser tab solves for nothing. This is the right answer *if and only if* a
Discord DM front end with unattended writes is chosen (§10) — revisit then, not
now.

### 3.2 The turn route

```
POST /api/gabi/turn        requireCapability('runResearch')
```

It is deliberately the dullest thing in the design:

- **Gated on `runResearch`, not `editCatalog`.** The route spends money on her
  key; that is the risk it carries. The *writing* risk is carried by the tool
  endpoints, each with its own gate. This mirrors `routes/research.ts`'s
  existing header: *"`runResearch` spends money. `reviewFindings` changes the
  catalog. They are separate rows because the two risks are different."*
- **Stateless.** The browser sends the message array; the Worker attaches the
  system prompt and the tool definitions from `@lc/core` and returns the model's
  response. No conversation is persisted in v1 beyond §7's usage row.
- **One call. No loop, no `waitUntil`, no retry.** `maxRetries: 0`, same as
  `researchDetails`, for the same reason: a retried turn is double spend on an
  answer that may already have landed.
- **503 with a sentence when `ANTHROPIC_API_KEY` is unset**, copying
  `POST /works/:id/run`'s existing shape exactly.
- **A hard turn ceiling** — the route refuses a `messages` array longer than N
  turns (start at 24) with a worded 400. A runaway loop is the one way a
  conversational surface can spend real money, and a server-side count is the
  only place a browser bug cannot bypass.

**Why it is safe to let the browser hold the conversation.** The obvious
objection is that a tampered browser could forge a conversation. It buys
nothing: the browser is already trusted to call every one of these endpoints
directly, every call is capability-checked server-side, and the worst outcome is
that she spends her own key's money on her own fabricated conversation. The
trust boundary is unchanged by this design — which is the point.

### 3.3 Model configuration, and the one setting that must not be changed

```
model:  claude-opus-5
thinking: { type: 'adaptive' }        // the default on Opus 5 — leave it on
output_config: { effort: 'low' }      // matching RESEARCH_EFFORT, same reason
tools:  GABI_TOOLS                    // from @lc/core, §4
system: [{ type:'text', text: SYSTEM, cache_control: { type:'ephemeral' } }]
```

⚠️ **Do not set `thinking: { type: 'disabled' }` to save money.** On Claude
Opus 5 with thinking off there is a documented failure mode where the model
writes a tool call into its **visible text** instead of emitting a `tool_use`
block: *the turn completes normally, the call never runs, and no error is
raised*. In an agentic loop that text then pollutes later turns. That is
precisely the silent-success class this codebase has spent two incidents
learning to hate. Thinking is on by default on Opus 5; control cost with
`effort`, which is the lever `RESEARCH_EFFORT = 'low'` already uses here with
the recorded reason that *"Opus 5 is unusually strong at the low end."*

### 3.4 Rejected alternatives

- **The Anthropic SDK's beta tool runner** (`client.beta.messages.tool_runner`).
  It automates the loop — which is exactly the part that must not run inside one
  Worker invocation (§3.1 Option A). It also cannot execute tools in a
  *different* process from the one driving the loop, which is the whole shape
  here. Rejected on architecture, not on quality.
- **Managed Agents.** Anthropic hosts the loop and a sandbox; the sandbox would
  then need her Firebase token to call her Worker, which means custody of a
  user credential outside her browser. Rejected on constraint 2.
- **Server-side web search as a GABI tool.** `researchDetails` already owns the
  open-web pass, with a schema, a source-tier, a basis sentence and a run row.
  Giving GABI its own search would be a second, unaudited research
  implementation — the "one canonical implementation" rule, and constraint 1.
  GABI calls `research_book`; it does not search.
- **Streaming the turn to the browser.** Nice, not v1. It complicates the tool
  extraction for a latency win on a surface where the slow part (a 20–90s
  research call) is a tool, not a token stream.

---

## 4. Tool inventory — the allowlist, as an explicit array

### 4.1 Where it lives, and why there

`packages/core/src/gabi-tools.ts`, exported through `@lc/core`, beside
`CAPABILITY_MATRIX` and for its stated reason: *"expressed once so the Worker
and the UI cannot drift."* `@lc/core` promises no I/O, and a tool definition is
data.

⚠️ **Mind the load-bearing import order** (`CLAUDE.md`): `constants.ts` is a
leaf, `schemas.ts` imports it, `index.ts` re-exports. Nothing under `src/` may
import from `index.ts`. A new file here follows the same rule or `z.enum()`
starts receiving `undefined` and every write endpoint 500s.

**Default-deny, as an array — never a denylist.** The estate's own rule:
*"Export/projection surfaces are default-deny: allowed fields as an explicit
array, never SELECT-*-minus-exclusions — the exclusion form leaks when a column
is added."* The same argument applies with more force here, because a new route
added six months from now must not become reachable by a conversation.

```ts
export const GABI_TOOL_NAMES = [
  'find_book',
  'get_book',
  'list_gaps',
  'list_recent_changes',
  'research_book',
  'set_book_details',
  'record_gap_verdict',
  'undo_changes',
  'list_cover_candidates',
  'set_cover_from_url',
  'mark_cover_wrong',
] as const;
```

Two guards, both cheap and both worth a test:

1. The turn route rejects any inbound `tool_result` whose name is not in the
   array (a worded 400).
2. A test asserts every name in the array has a definition and an executor, and
   that no executor exists for a name not in the array. The
   `capability-wiring.test.ts` / `mount-order.test.ts` precedent already
   establishes this style of guard in this repo.

### 4.2 The tools

Read-only. These are how GABI gets *"the needed context"* the owner asked for.

| Tool | Endpoint | Capability | What the loop may do with it |
|---|---|---|---|
| `find_book` | `GET /api/works/match` + `GET /api/collection?q=` | `read` | Turn "the Sanderson one with the wrong cover" into a work id. **Must present candidates and let her pick when more than one matches** — never guess an id |
| `get_book` | `GET /api/works/:id` | `read` | Everything known about one book, so a proposal is about real current values |
| `list_gaps` | `GET /api/research/queue` | `read` | "What still needs fixing?" — the per-field tally, the refused fields, and `configured` |
| `list_recent_changes` | `GET /api/research/auto-applied`, `GET /api/works/:id/changes` | `read` | "What did you just do?" — and the input to `undo_changes` |

Writes. Each is a **field-scoped wrapper**, never a passthrough.

| Tool | Endpoint | Capability | Scope, and what it may not do |
|---|---|---|---|
| `research_book` | `POST /api/research/works/:id/run` | `runResearch` | The paid lookup, unchanged. **The preferred way to fill a gap** — it writes with a source tier, a basis, and a revert. Costs ~2¢. One book per call; the route already refuses a second concurrent run |
| `set_book_details` | `PATCH /api/works/:id` | `editCatalog` | Body restricted to `{firstPublished, series, seriesIndexSort, seriesIndexDisplay, description, universe, coverStatus}`. ⚠️ The wrapper builds the body from a fixed field list — it never forwards the model's object. `title`, `authors`, `keyMove`, `coverUrl` are unreachable by construction, not by validation |
| `record_gap_verdict` | `POST /api/research/works/:id/verdict` | `reviewFindings` | "This is a standalone, and here is how I know." `setGapVerdictSchema` already requires a non-empty `source`; the wrapper additionally refuses a source the model composed without her saying it — a verdict is an assertion about absence and it is hers to make |
| `undo_changes` | `POST /api/research/undo` | `reviewFindings` | Take back what the machine wrote. Cap of 10 is the route's, not the tool's |
| `list_cover_candidates` | `GET /api/works/:id/covers` | `editCatalog` | Read, but `editCatalog`-gated by the route |
| `set_cover_from_url` | `PUT /api/works/:id/cover` | `editCatalog` | ⚠️ **v1: the URL must be one `list_cover_candidates` returned.** A URL the model recalls from the open web is a factual claim about an image, and `verifyCoverUrl` can only prove it *is* an image, not that it is *this book's*. A free-web URL is allowed only through confirm-before-write with the URL shown (§6) |
| `mark_cover_wrong` | `PATCH /api/works/:id/cover-status` | `editCatalog` | The "that cover is not the book" verb. Safe, reversible, and the reason the cover feature is not just an upload form |

### 4.3 What is deliberately not a tool

| Excluded | Why the exclusion is structural, not squeamish |
|---|---|
| `DELETE /works/:id`, `/editions/:id`, `/copies/:id` | The seed excludes deletes in v1. And a delete is the one write `revertFinding` cannot undo — the whole confirm/undo bargain in §6 rests on reversibility |
| `DELETE /works/:id/cover` | Same. Note that uploaded cover *objects* are content-addressed and never removed from the bucket, so re-pointing a column is the recoverable form — which `set_cover_from_url` already provides |
| `title` / `authors` on `PATCH /works/:id` | ⚠️ **The hardest exclusion, and the most important.** `updateWork` re-derives `work_key` from these two, and `work_key` is the join to the shared Firestore review store. Moving a non-provisional key demands a `keyMove` attestation — `{expectedOldKey, reviewsFound, restamped}` — that the **browser** produces by querying Firestore and re-stamping documents. The Worker cannot verify it (no service account, deliberately) and a model cannot produce it at all. `applyFinding` refuses these two fields for the same reason. GABI may *tell her* a title looks wrong and link her to the edit form; it may not fix it |
| `POST /api/works` (create) | A conversational surface that can mint works will mint duplicates. `find_book` returning nothing is an answer |
| `manageUsers`, `PATCH /users/:id/role` | Access-increasing, and the estate rule is that access-increasing orders get confirmed through the front door. Auth admin is UI-first here |
| `POST /api/scan-jobs/shelf`, `/single` | `scanPhoto` bills the vision API and needs an image the conversation does not have |
| `GET /api/export.json`, `.csv` | Hands the whole catalog to whatever is reading the transcript. No fix needs it |
| `/api/ingest/*`, `/api/donor/*`, `/api/machine/*` | Static-token routes mounted **before** `requireAuth`. They have exactly one legitimate caller each and it is not a person |

---

## 5. Authority and audit

### 5.1 Her token, end to end

There is no token custody problem to solve in the browser design, and that is
the single largest reason to prefer it:

| Hop | What carries authority |
|---|---|
| Browser → `/api/gabi/turn` | Her Firebase ID token. `requireAuth` verifies issuer + audience against `FIREBASE_PROJECT_ID`; `requireCapability('runResearch')` gates the spend |
| Turn route → Anthropic | Her instance's `ANTHROPIC_API_KEY`, never leaving the Worker. The browser never sees it |
| Browser → any tool endpoint | Her Firebase ID token again, via `api.ts` — **the same request the edit form makes** |
| Tool endpoint → D1 | `Actor { userId: c.get('user').id, … }`, exactly as today |

⚠️ **The one thing not to copy from the audiobook site**, restated because a
chat panel is exactly where somebody would be tempted:
`middleware/auth.ts`'s header says `audiobook_catalog/site/identity.js` signs
out immediately and keeps a string in `localStorage`, and that its own
`isAdmin()` is *"PRESENTATION ONLY … not, and cannot be, an access control."*
This app keeps the token live and sends it, because here it **is** the access
control. A GABI panel must use `api.ts`, not a hand-rolled fetch.

### 5.2 The provenance stamp — and why no migration is needed

The design decision, and it falls out of §1.2's existing semantics rather than
inventing anything:

| Lane | `changed_by` | `changed_how` | `note` |
|---|---|---|---|
| **Auto** — blank field, one book, revertible (§6.1) | her `app_user.id` | `'auto'` — because **nobody read the value** | `gabi:<conversationId>` |
| **Confirm** — she was shown old→new and said yes | her `app_user.id` | `'human'` — because **she read it** | `gabi:<conversationId>` |
| `research_book` | unchanged — `triggeredBy` = her id, `decided_how = 'auto'` | unchanged | unchanged (the run row already carries the provenance) |

Three things this gets right at once:

1. **The enum keeps its meaning.** `'auto'` has always meant "not read before it
   landed", not "not requested by a person" — the constant's own comment says so.
   A GABI blank-fill is exactly that, so stamping `'auto'` is honest, and
   stamping `'human'` would be the lie.
2. **No migration.** `change_log.changed_how` has no CHECK; `Actor` already has
   `note`. A third enum value would be a change to a persisted decision column
   — the sort of thing `CLAUDE.md` calls a migration, not an edit — and it is
   not needed.
3. **The audit question is answerable with one query**: *"what did GABI write
   that nobody read?"* is `changed_how = 'auto' AND note LIKE 'gabi:%'`. And
   `revertFinding`'s `decided_how = 'auto'` gate means a bulk undo still cannot
   reach anything she typed by hand.

⚠️ **`note` becomes load-bearing the moment this ships.** It is currently a
convenience field. If a later change starts writing structured data into it,
this query breaks silently. Say so in the code.

### 5.3 Revertability

The rule: **nothing enters the auto lane that `revertFinding` or a plain
re-PATCH cannot undo.** Concretely —

- `research_book` writes are already revertible by `POST /api/research/undo`,
  which is in the allowlist as `undo_changes`.
- `set_book_details` in the auto lane only ever fills a blank, so the prior
  value is known without storing it: it was empty. This is the same argument
  `revertFinding`'s header makes, and it holds only while the auto lane is
  blank-only.
- Confirm-lane overwrites are recoverable from `change_log`, which stores
  `oldValue` — but recovering one is a manual act, not a button. That
  asymmetry is exactly why the overwrite is behind a confirm.
- `mark_cover_wrong` and `set_cover_from_url` are column moves; the previous
  URL is a `list_cover_candidates` entry afterwards, because uploaded objects
  are never deleted from the bucket.

---

## 6. Confirm-before-write

### 6.1 The auto lane — three conditions, all required

A write executes without asking only if **all** of:

1. it fills a **blank** field (never overwrites a recorded value);
2. it targets exactly **one** work;
3. it is **revertible in one action** (§5.3).

This is not a new policy — it is `applyFinding`'s policy, restated as a UX rule.
The owner's own bargain applies verbatim: *"I'd rather come across a book with a
wrong desc and fix it then, than confirm each possible item."* A conversational
front door that confirmed every blank fill would reintroduce the gate that was
retired precisely because it bought taps rather than scrutiny.

### 6.2 The confirm lane — everything else, by name

| Trigger | Why it asks |
|---|---|
| Any **overwrite** of a non-blank value | Someone typed that, or a sourced run applied it. Undo is manual (§5.3) |
| Any **batch** — more than one work | Blast radius |
| A **cover URL not in `list_cover_candidates`** | The model asserting a fact about an image nothing can verify |
| Any **`record_gap_verdict`** | A verdict is a claim about absence *and it silences the question forever*. It demands a source, and the source must be hers |
| Anything the model wants that is **not in the allowlist** | It must say so in words. §8 |

**The confirmation is a manifest, not a sentence.** For a batch: one row per
work — work id, title, field, current value → proposed value — rendered by the
panel from structured tool input, and executed only on an explicit yes. She must
be able to see the whole thing before any of it happens.

### 6.3 Why the batch cap is 10

`POST /api/research/undo` refuses more than 10 ids, and refuses rather than
truncating, because 10 reverts is ~40 subrequests. So:

> **A batch you cannot undo in one action is a batch that should not be one
> action.**

Ten is the number the undo path already enforces; taking the same number for the
forward path keeps the two symmetric. A larger batch is not forbidden — it is
several confirmations.

### 6.4 Execution order

Serially, one book per HTTP call, never `Promise.all`. Two reasons, both already
recorded in this repo: `POST /undo`'s header (two reverts against one book read
and write the same row; in parallel the second overwrites the first's clear with
a stale value) and the per-invocation subrequest ceiling. The browser loop makes
serial execution the natural shape rather than a discipline.

If a batch fails partway, GABI reports **which rows landed and which did not, by
name** — the `AutoApplyReport` convention. A partial batch reported as success
is the failure this whole design is arranged to prevent.

---

## 7. Cost model

### 7.1 What a conversation costs, on her key

Arithmetic over the published price table, not a measured invoice (§11).

| Component | Estimate |
|---|---|
| System prompt | ~800 tokens |
| Tool definitions (11 tools, JSON schemas) | ~1,200–1,800 tokens |
| **Cached prefix** | **~2.5k tokens** |
| Per-turn output | ~200–400 tokens |
| Per-turn new input (her message + one tool result) | ~300–1,500 tokens, tool-dependent |

Claude Opus 5 is **$5 / MTok in, $25 / MTok out**, and its minimum cacheable
prefix is **512 tokens** — so the ~2.5k prefix caches from turn 2 onward at
~0.1× read cost. A six-turn fix conversation lands around **2–5 US cents in
model tokens**, and any `research_book` call adds `RESEARCH_CENTS_EACH.low = 2¢`
plus server-side web search billed separately (a caveat `estimateCents`'s own
header already records).

**So: single-digit cents per conversation, and the paid lookup dominates.** The
practical implication is the opposite of the intuitive one — the loop is cheap,
and the thing worth capping is how freely GABI reaches for `research_book`.

### 7.2 Model tiering — the honest version

| Model | In / Out per MTok | Min cacheable prefix | Verdict for this loop |
|---|---|---|---|
| **Claude Opus 5** | $5 / $25 | **512** | ✅ **v1.** Already this repo's `RESEARCH_MODEL`, one fewer model to reason about, strongest at picking the right tool — which is what decides whether the right thing gets written |
| Claude Sonnet 5 | $3 / $15 (intro $2 / $10 through 2026-08-31) | 1024 | The sane cost-down lever **if measured turns justify it**. Same effort ladder, prefix still caches |
| Claude Haiku 4.5 | $1 / $5 | **4096** | ❌ Not for the loop. ⚠️ A ~2.5k prefix is **below Haiku's cache minimum**, so the cheapest-looking model pays full input price on every turn while Opus 5 pays 0.1× — the gap is far smaller than the sticker suggests, and tool-selection accuracy is the thing that decides whether a wrong value gets written |

**No two-model split in v1.** A cheap "classify her intent" pre-pass would be a
second model call per turn to save part of one, and a second place that decides
what a message means. One canonical implementation, per the repo rule.

### 7.3 Making the estimate measurable

Everything in §7.1 is arithmetic. To convert it into the kind of number this
estate actually trusts, v1 should record each turn the way `research_run`
records a lookup — a small `gabi_turn` table (`user_id`, `conversation_id`,
`model`, `input_tokens`, `output_tokens`, `created_at`), one migration,
`estimateCents` reused unchanged. Without it, §7 stays a guess forever and the
"is this expensive?" question is unanswerable. With it, phase 0 (§9) *ends* with
a measured cost-per-conversation figure.

The spend cap itself rides the capped-workspace key design
(`second-instance.md` §4) — ⚠️ whose existence is unverified (§11). A capped
workspace is the backstop; the turn ceiling in §3.2 is the fuse.

### 7.4 ⚠️ MEASURED — 2026-08-17, the first real conversations

Everything above this line was arithmetic over a published price table. These
are numbers, taken by driving the real loop (real route, real executor, real
model, local D1) against `npm run dev:worker` on the owner's key:

| Fact | Measured | §7.1 had estimated |
|---|---|---|
| Cached prefix (system + 4 tool schemas) | **1,793 tokens** | ~2.5k |
| First turn's *new* input, beyond the prefix | **85–90 tokens** | 300–1,500 |
| A `list_gaps` tool result | **3,301 chars ≈ 1,450 tokens** | (unmodelled) |
| Turn after one tool result: input / output | **1,437–1,547 / 115–386** | 300–1,500 / 200–400 |
| A 2-turn conversation, one tool round | **1.4–1.8¢** | 2–5¢ for six turns |

⚠️ **The correction that matters, and it went the wrong way in the first
implementation.** `usage.input_tokens` **excludes** `cache_read_input_tokens` —
the API reports three input classes separately and the prompt is their *sum*. So
reusing `estimateCents(input, output)` unchanged, as this document's §7.3
proposed, does not "err high by pricing cache reads as full input": it omits the
cached prefix **entirely** and errs LOW. `gabiCents` in
`packages/research/src/gabi.ts` now prices all four classes (reads at 0.1×,
5-minute writes at 1.25×), still through the one `estimateCents` table.

That mistake is the argument for this whole section: it was written from
arithmetic, shipped, and corrected within the hour by *running* it. It is also
why `gabi_turn` stores the raw columns rather than one total — a stored total
computed by a wrong function is wrong forever.

**What the numbers say about §7.1's practical implication:** it holds, and more
strongly than estimated. The loop is cheap — the prefix caches at 0.1× from turn
2 onward, and the model's own output dominates every turn. The expensive thing
remains the paid lookup (`RESEARCH_CENTS_EACH.low = 2¢`), which phase 0 does not
have. **A phase-1 conversation's cost will be roughly "how many times did GABI
reach for `research_book`", and almost nothing else.**

⚠️ **Not measured:** a six-turn conversation, a conversation on HER instance, and
anything involving a paid lookup. The figures above are one- and two-tool
conversations on the main catalog's data.

---

## 8. Failure modes

The governing rule, and it is the one that makes or breaks the feature:

> **The loop never invents success. Every sentence GABI shows about a write is
> quoted from the server's response, never composed.**

This is affordable only because the endpoints already word themselves:
`applyFinding` returns *"First published set to 2016."*; `describeRun` returns
*"Filled in 2 of 3: … Skipped — …"*; `capabilityDenied` returns a role and a
sentence. The system prompt instructs GABI to relay them; the panel renders the
raw tool result underneath the message so a paraphrase is visible as one.

| Failure | How it must surface |
|---|---|
| A tool endpoint returns 4xx/5xx | `tool_result` with `is_error: true` carrying the response's own `detail`. The loop continues; GABI says what happened in the app's words |
| **403 from a capability gate** | Her role does not permit it. Say which capability and what it needs — never "something went wrong". This is the likeliest failure on day one if §1.4's role question resolves badly |
| `409 already_reviewed` / `alreadyRunning` | Not an error. "That lookup is already running; I'll wait" |
| `400 bad_request` from `.strict()` | The wrapper sent a field the schema does not model — a **bug in the tool wrapper**, not a user problem. Log it loudly; do not retry with fewer fields |
| A model turn returns `stop_reason: 'refusal'` | ⚠️ Check `stop_reason` **before** reading `content`. Opus 5's classifiers can decline with a 200 and an empty `content`; code that indexes `content[0]` breaks. `parseStructured` already does this check for the research path — copy the precedent |
| `stop_reason: 'max_tokens'` mid-`tool_use` | **Discard the turn.** Never execute a half-parsed tool call |
| `stop_reason: 'pause_turn'` | Should not arise (no server-side tools in `GABI_TOOLS`), but handle it: return it to the browser and let it re-post rather than assuming it cannot happen |
| The paid lookup takes 90s | Expected. `RESEARCH_TIMEOUT_MS` is 90s *because* they run that long. The panel shows it working; the browser does not time out at 30s |
| Her Firebase token expires mid-conversation | Free — `getIdToken()` refreshes per request |
| She closes the tab mid-batch | Whatever landed, landed, and `change_log` says so. `list_recent_changes` is how she finds out |
| **A tool call that silently never runs** | The §3.3 trap. Guarded by leaving thinking on, and by the panel showing a tool card for every `tool_use` block — a claimed action with no card is visibly a claim |
| Model proposes something not in the allowlist | The turn route's guard answers a worded refusal, and GABI relays it: *"I can't do that from here — you'd do it on the book page."* Never a silent no-op |

---

## 9. Phasing

The owner's v1 is details + covers, single-book and small-batch. These are the
shippable slices **inside** that boundary, ordered so each one lands complete.

**Phase 0 — read-only GABI. ✅ BUILT AND DEPLOYED 2026-08-17.** `find_book`,
`get_book`, `list_gaps`, `list_recent_changes`. The turn route, the `@lc/core`
array, the panel, the executor, the `gabi_turn` accounting row. **No write tool
exists yet** — and that is now enforced rather than remembered:
`packages/core/test/gabi-tools.test.ts` fails the build if a tool in the array
declares `mutates`, a non-GET method, or a capability above `read`. (Exercised:
adding `set_book_details` to the array fails four assertions in four independent
ways.) It ended with the *measured* cost figures §7.4 now carries.

⚠️ **What phase 0 deliberately does NOT have**, so the next phase knows what it
is starting from: no confirm lane, no manifest UI, no provenance stamping, no
`gabi:<conversationId>` note on any `change_log` row — because nothing writes.
§5.2 and §6 are unimplemented design, not implemented policy.

**Phase 1 — the smallest useful write slice.** `research_book`,
`set_book_details` (blank-only, auto lane), `undo_changes`. This is the
"conversational front door to the existing machinery" in its purest form: the
main verb is *ask the existing paid lookup to fix this book*, and the direct
patch is the fallback for what research cannot know (a printed volume form, a
universe). One book at a time. Confirm lane exists but only fires on overwrites.

**Phase 2 — covers.** `list_cover_candidates`, `set_cover_from_url`
(candidate-only auto; free-web behind confirm), `mark_cover_wrong`.

**Phase 3 — small batches.** The manifest UI, serial execution, the cap of 10,
partial-failure reporting by name.

**Phase 4 — the other front end.** ⚠️ **PROMOTED 2026-08-17.** The owner settled
the surface order as *"we can do discord right after"*, which makes Discord the
**next thing in the queue after phase 0**, ahead of phases 1–3 — not the last
thing after them. The design itself is unchanged and so are §10.2's four
blockers; only the position moved. Start at shape (b), propose-and-deep-link,
which needs none of the four.

Each phase is independently shippable and independently revertible, and none
requires a migration except phase 0's `gabi_turn` table.

---

## 10. Surface groundwork — chat panel vs Discord DM

The seed defers the pick, so the design is split into three parts and only the
third differs per front end:

| Part | Where it lives | Front-end specific? |
|---|---|---|
| Tool definitions + allowlist | `@lc/core` (`GABI_TOOLS`) | **No** |
| `POST /api/gabi/turn` — the key-holding, spend-gated model call | her Worker | **No** |
| The **executor** — turns a `tool_use` into an authenticated HTTP call | per front end | **Yes. This is the whole difference** |

### 10.1 Site chat panel — what it additionally needs

- A panel component and an executor over `api.ts` (which already attaches her
  token and already has typed methods for every endpoint in §4.2).
- A place to render tool results **verbatim** beneath each message (§8).
- The manifest UI for confirms (§6.2).
- Nothing else. No new auth, no new secret, no new table beyond `gabi_turn`.

### 10.2 Discord DM — what it additionally needs, and the honest blocker

The identity half is nearly there and the authority half is not.

**What exists** (`catalog-platform/apps/discord-worker/src/link.ts`, live and
shipping dark pending the owner's §3-step-7 clicks): a
`discord_links/{discordUserId}` Firestore document holding
`{slug, displayName, linkedAt, firebaseUid}`, proven by a server-verified
Firebase ID token at link time and an HMAC-signed HttpOnly cookie so the Discord
identity never enters page JavaScript.

**Four things that do not exist:**

1. **No join to her `app_user`.** The link maps a Discord id to a club-member
   slug and a `firebaseUid` — in **Firestore**, owned by the discord-worker. Her
   library Worker cannot read Firestore (no service account, deliberately — see
   `env.ts` on `EBOOK_INGEST_TOKEN` for the estate's reasoning). Joining
   `firebaseUid` → `app_user` on her instance is new work.
2. ⚠️ **Token custody — the real blocker.** A Firebase ID token can only be
   minted by a browser sign-in or by an Admin-SDK custom token. The
   discord-worker does hold a service account, and using it to mint a token *as
   her* is exactly the thing constraint 2 refuses: an actor that is not her,
   writing as her. Three ways out, and only two are acceptable:
   - **(a)** a per-user, revocable, scoped **library token** her instance mints
     after she proves both identities once — a new table, a new auth path, and
     a second credential to keep alive. Real work, and access-increasing.
   - **(b)** ✅ **the bot reads and proposes; every write is a deep link back to
     her site panel to confirm.** Zero new auth, and it is the honest version
     of "her authority" — she is still the one who acts.
   - **(c)** the bot acts under a service account. **Refused.**
3. **The 3-second interaction deadline.** A conversational turn cannot fit it. A
   deferred response buys up to 15 minutes via the interaction token, which is
   ample — but the deferred path must be built from day one, not added when the
   synchronous path is observed flaky (the Discord design doc's own advice).
4. **Conversation state.** Each Discord message is a separate interaction with
   its own token, so the message array must be persisted somewhere the bot can
   read — Firestore, or a new table. The browser tab provides this for free,
   which is why §3.1 Option C (a Durable Object per conversation) becomes the
   right answer *only if* unattended Discord writes are chosen.

**Recommendation: build the panel first, and if Discord is wanted, start at
(b).** Option (b) needs none of the four, because a proposing bot is a read-only
bot with a link on the end.

⚠️ **DECIDED 2026-08-17 — and Discord is now NEXT, not later.** The owner settled
the order as *"we can do discord right after"*: panel first (built), Discord the
following phase, ahead of the write phases. Two things that carry forward:

1. **Two of the three parts are already done for it.** `GABI_TOOLS` and
   `POST /api/gabi/turn` are front-end-agnostic and shipped. What a Discord
   surface needs to write is the **executor** — the third row of the table
   above — and that is genuinely the whole difference.
2. ⚠️ **The four blockers are unchanged and none was quietly solved by phase 0.**
   There is still no `app_user` join, no token custody answer, no deferred
   response path and no persisted conversation state — the browser tab provides
   the last one for free, which is exactly why phase 0 did not need to build it.
   Shape **(b)**, propose-and-deep-link, needs none of the four and is what
   "right after" should mean unless the owner says otherwise.

---

## 11. What was NOT verified

> ⚠️ **This section was written by the DESIGN session, when nothing was built.**
> The phase-0 build (2026-08-17) closed some of it by measurement and left the
> rest open. Each row now says which. **Nothing has been struck out** — a
> question that was open once is worth being able to see was open, and the
> answers are worth more with the doubt still attached.
>
> **Closed by the build:** Samantha's role (row 1, measured), the §7 arithmetic
> (now §7.4, measured), "no code was written, run or deployed" (it was), and the
> `change_log` CHECK sweep (irrelevant to phase 0, which writes nothing).
> **Still open:** the Cloudflare plan, the CPU limit, the capped workspace, the
> Discord link's shape, and every figure §7.4 marks as not measured.

- ✅ **Samantha's actual role on `padhard` — CLOSED 2026-08-17 by MEASUREMENT.**
  `SELECT role FROM app_user` against `library-catalog-2nd` (remote) returns
  **`admin`**, approved. `admin` holds `runResearch`, so the turn route admits
  her and **the feature is not dark**. ⚠️ The original doubt was well founded and
  is worth keeping visible: `ESTATE_DEFAULT_ROLE` is still unset on her env, so
  the estate auto-grant still hands out `member` — her `admin` is a specific
  grant to her account, not a property of the instance. **Anyone else who signs
  in there gets `member` and will not see the panel at all.**
- ⚠️ **Which Cloudflare plan this account is on (Workers Free vs Paid).** Not
  found in any doc — `ebook-viewer-design.md` §10 already flags the same
  unknown. It decides whether the subrequest ceiling is 50 or 1000, which is
  **the one number that would change §3's recommendation**: at 1000, a
  server-side loop (Option A) stops being reckless. The browser loop is still
  preferable on authority grounds, but the argument would be weaker.
- **The 50-subrequest figure itself** is quoted from this repo's own comments
  (`research-run.ts`, `details-sweep.ts`), which record it as measured. It was
  not re-read against Cloudflare's documentation this session.
- **The Worker CPU-time limit.** `wrangler.toml` has no `[limits]` block, so the
  platform default applies; that default was not looked up. Wall clock is not a
  concern (a 90s await is in production), but a long server-side loop would be
  bounded by CPU, not by wall clock.
- **Anthropic model prices, cache minimums and the thinking-disabled tool-call
  failure mode** were taken from the bundled `claude-api` reference in this
  session, not fetched live from `platform.claude.com`.
- ✅ **"Every figure in §7 is arithmetic, not an invoice" — CLOSED, partly.**
  Real calls were made 2026-08-17 and §7.4 carries the token counts. ⚠️ Still not
  an invoice: it is list pricing over measured tokens, and §7.4 names what
  remains unmeasured (a six-turn conversation, anything on HER instance, anything
  involving a paid lookup).
- **Whether her `ANTHROPIC_API_KEY` sits in a capped workspace.**
  `second-instance.md` already records this as unverified and recommends
  confirming with the owner before assuming a cap exists.
- **The Discord link's document shape** was read from
  `catalog-platform/apps/discord-worker/src/link.ts` as source, never exercised.
  Whether phase-2 linking is switched on at all depends on owner clicks that
  `catalog-platform/docs/TODO.md` §0 lists as outstanding.
- ✅ **"No code was written, run, typechecked or deployed" — CLOSED.** Phase 0
  exists (§9). ⚠️ **What the BUILD did not verify, in its turn:**
  - **Nobody has had a real conversation on `padhard.heygabi.ai`.** The panel is
    deployed and the posture is on, but the measured conversations in §7.4 ran
    against the main catalog's data through the dev worker on the OWNER's key.
    **Samantha's first conversation needs her eyes, on her site, on her key** —
    and it is the only thing that can confirm the wording lands for the person
    it was written for.
  - ✅ **The panel HAS now been seen in a browser** — `padhard.heygabi.ai`,
    signed in, 2026-08-17. The speech-bubble toggle renders in the top bar
    between Export and the estate-search magnifier; opening it shows the intro,
    the three suggestion chips, the compose box, and the line that matters most
    for phase 0: *"GABI can look things up. It cannot change anything yet —
    edits are still made on a book's own page."* It wears her `hearts` theme and
    lines up with `main`'s measure. ⚠️ **Looked at, not talked to** — no message
    was sent from that browser, deliberately: the first conversation on her
    instance spends her key and is hers to have.
  - **No conversation has ever hit the turn ceiling, the size ceiling, or a
    `pause_turn`** in production. All three are covered by tests; none has
    happened for real.
- **`change_log.changed_how` having no CHECK constraint** was read from
  `migrations/0120_change_log_and_authorless.sql`; whether a later migration
  added one was not swept for. ⚠️ Irrelevant to phase 0, which writes no
  `change_log` row at all — it becomes load-bearing the day phase 1 ships.
- **No claude.ai usage reading was taken** during either the design or the
  build.

---

## 12. Owner decisions — ALL ANSWERED 2026-08-17

**The owner took every recommendation, verbatim: *"take your recs and we can
always change later."*** The surface order was settled in the same breath —
*"we can do discord right after"*. Each row below records the answer, its date,
and (where the answer was a fact rather than a preference) how it was checked.

⚠️ **An answered decision is not the same as a shipped one.** Only phase 0 is
built; decisions 2, 3 and 4 govern phases that do not exist yet and are recorded
here so the phase that ships them starts from a settled position rather than
re-opening the argument.

| # | Question | Answer (2026-08-17) | Built? |
|---|---|---|---|
| 1 | Samantha's role on `padhard` | ✅ **`admin`** — **MEASURED**, not assumed: `SELECT role FROM app_user` on `library-catalog-2nd` (remote), 2026-08-17, returns `admin`, approved. `admin` holds `runResearch`, so **the feature is not dark** | n/a — it was the precondition |
| 2 | Auto lane, or confirm everything? | **Auto lane for blank single-book fills** (§6.1) — the same bargain the owner struck when the findings gate was retired | ⏳ phase 1 |
| 3 | `set_cover_from_url` — candidates only? | **Candidate-only in the auto lane, free-web behind confirm** (§4.2) | ⏳ phase 2 |
| 4 | Is `record_gap_verdict` a tool at all? | **Yes, but confirm-only, and the source must be her words** | ⏳ phase 1 |
| 5 | Batch cap | **10**, symmetric with `POST /undo` (§6.3) | ✅ recorded as `GABI_BATCH_CAP` in `@lc/core`, and a test reads `routes/research.ts` to check the two still agree. Nothing batches yet |
| 6 | Does `gabi_turn` earn its migration? | **Yes** (§7.3) — without it the cost model is permanently a guess | ✅ migration `0330_gabi_turn.sql`, both instances |
| 7 | Which surface first? | **Site chat panel first; Discord DM the phase NEXT AFTER** — owner, *"we can do discord right after"*. That promotes Discord from §9's phase 4 to the queue's next item, ahead of phases 1–3 | ✅ panel built. Discord recorded, not built — §10.2's four blockers are unchanged |
| 8 | Should this run on the main library? | **No for v1.** The spend would be the owner's key rather than hers, and the blast radius the whole catalog | ✅ enforced: `GABI_PANEL = "off"` in `[vars]`, `"on"` in `[env.friend.vars]`, pinned by `apps/worker/src/routes/gabi.test.ts` |
| 9 | Capped Anthropic workspace for her key? | **Still the owner's to confirm** — the one row here that is not closed. It is the backstop behind §3.2's turn ceiling, and it is on `TODO.md`'s tech-debt list | ⚠️ **NOT VERIFIED** |

### 12.1 ⚠️ "Her instance only" is a POSTURE, not a deploy boundary

Decision 8 needs one sentence of mechanism, because the obvious reading of it is
wrong. **The loop, the route and the panel deploy from this one repo to BOTH
instances by nature** — they are the same commit, the same bundle, the same
`apps/web/dist`. Nothing about "her instance only" can be achieved by deploying
less.

What makes it hers is a **per-instance posture var**, `GABI_PANEL`, in the idiom
the `DEFAULT_THEME` work established: `wrangler.toml` is the posture of record,
one pure function reads it, and a test pins the two together so they cannot
drift. Two differences from `DEFAULT_THEME`, both deliberate:

- **The Worker reads this one.** A theme must resolve before first paint, so
  that one is resolved in the browser from `location.hostname`. A chat panel
  need not be, so this is read server-side and reported on `/api/me` (what the
  app reads at boot) and `/api/health` (what a curl can check with no sign-in) —
  the "when the Worker grows a config surface the web app reads at boot" case
  `DEFAULT_THEME`'s own comment anticipated.
- ⚠️ **It gates the ROUTE, not only the panel.** `POST /api/gabi/turn` answers a
  worded **404** wherever the posture is off — the disabled-not-open idiom
  `EBOOK_INGEST_TOKEN` and `DONOR_TOKEN` already use, and **not** 403, which in
  this app means exactly one thing: your role. Hiding a control has never been
  the lock here; `/people`'s nav comment says so in as many words.

Unset means off, and so does anything unrecognised — the same failure direction
as `resolveDefaultRole` and `parseEstateMode`, for the same reason: this one
spends money.

---

## 13. As built — where phase 0 actually lives

For the session that has to change this. Everything above is the design;
this is the map.

| Part | File | The one thing to know |
|---|---|---|
| The allowlist | `packages/core/src/gabi-tools.ts` | `GABI_TOOL_NAMES` is default-deny and phase 0's four are read-only. Adding a name is not the change it looks like |
| Its guard | `packages/core/test/gabi-tools.test.ts` | Fails on a write tool four ways. Also pins `GABI_BATCH_CAP` against `routes/research.ts`'s own literal |
| The model call | `packages/research/src/gabi.ts` | One call, `maxRetries: 0`. ⚠️ **Thinking stays on** — see its header. `gabiCents` is the cache-aware pricing §7.4 corrected |
| The decisions | `apps/worker/src/lib/gabi-turn.ts` | Guards, spend, accounting. Takes the model call as a PARAMETER so "exactly one" can be counted |
| The route | `apps/worker/src/routes/gabi.ts` | Wiring only. `requireCapability('runResearch')` — money, not writes |
| The accounting | `migrations/0330_gabi_turn.sql`, `packages/db/src/gabi.ts` | Written on success AND failure. `recordGabiTurn` never throws |
| The posture | `wrangler.toml` `GABI_PANEL`, `routes/gabi.test.ts` | Off here, on for `friend`. The test reads the file |
| The executor | `apps/web/src/lib/gabi.ts` | A LEAF that cannot fetch. Explicit projections — `work_key` and copies never leave |
| The panel | `apps/web/src/components/GabiPanel.tsx` | Runs the loop. A tool card per `tool_use`, raw results verbatim |
| Two config surfaces | `routes/health.ts` (`gabi.panel`), `routes/users.ts` (`gabiPanel`) | One is curl-able without sign-in; one is what the app reads at boot |

**Verifying a deploy, in two curls and no sign-in:**

```bash
curl -s https://padhard.heygabi.ai/api/health   | grep -o '"gabi":{[^}]*}'   # {"panel":true}
curl -s https://library.heygabi.ai/api/health   | grep -o '"gabi":{[^}]*}'   # {"panel":false}
curl -s -X POST https://padhard.heygabi.ai/api/gabi/turn -d '{}'             # 401, tokenless
```

**The cost question, answered from the table rather than from arithmetic:**

```sql
SELECT conversation_id, COUNT(*) AS turns,
       SUM(input_tokens) AS input, SUM(output_tokens) AS output,
       SUM(cache_read_tokens) AS cached, SUM(tool_calls) AS tools
  FROM gabi_turn GROUP BY conversation_id ORDER BY MAX(id) DESC;
```

## Related

- `docs/TODO.md` — the seed, and the sequencing this sits behind.
- [`research-and-gaps.md`](research-and-gaps.md) — the four questions the
  details queue asks, the five it refuses, and why `gap_verdict` exists. The
  vocabulary GABI speaks.
- [`edit-and-audit-design.md`](edit-and-audit-design.md) — `change_log`, the
  key-move attestation (§5.2 there), and why `PATCH /works/:id` is `.strict()`.
- [`identity-and-reviews.md`](identity-and-reviews.md) — why `work_key` is
  load-bearing, and therefore why `title`/`authors` are unreachable here.
- [`../access/second-instance.md`](../access/second-instance.md) — her env, her
  key, and the capped-workspace question §4 there leaves open.
- `catalog-platform/docs/info/discord-bot-design.md` §1.6, §1.7 — the identity
  link ceremony and the 3-second deadline, both of which §10.2 depends on.
- `catalog-platform/docs/TODO.md` §0 — the GABI queue, which cross-references
  this document as its next horizon.
