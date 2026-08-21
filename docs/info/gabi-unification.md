# GABI Unification — One Bot, Two Entry Points   (Information Reference)

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-21** — moved here from `docs/GABI_UNIFICATION_PLAN.md`,
> where it sat UNTRACKED and existed only on the owner's machine. Contents
> unchanged; only the location and this header are new.
>
> ⚠️ **This is the DESIGN, not the work log.** Per the estate docs rule,
> design rationale lives in `docs/info/` and the live state lives in
> [`../TODO.md`](../TODO.md) — which now carries the three phases as items.
> Do not track progress in this file; it will disagree with the work log.
> ✅ Phase 1's code has LANDED on `main` (committed 2026-08-21 as work in
> flight) — landed is not the same fact as verified, and the work log says
> which is which.

> Owner ask 2026-08-20: "I want them to be a 1 for 1 with just a different
> entry point, they should know do and act the same ways. If I'm linked in
> Discord I should see my Discord personality coming through in the chat on
> my UI too."

## Current State

| | Site Panel | Discord Bot |
|---|---|---|
| **Repo** | library_catalog (`apps/worker/src/lib/gabi-turn.ts`) | catalog-platform (`apps/discord-worker`) |
| **Model call** | This Worker (Opus 5, `GABI_SYSTEM` prompt) | Discord Worker's own Durable Object |
| **Tools** | 4 read-only (`find_book`, `get_book`, `list_gaps`, `list_recent_changes`) | Structured RPC verbs (`add-isbn`, `run-details`, `browse-works`, `whoami`) |
| **Conversation memory** | D1 `gabi_conversation` table, keyed `{surface:'web_panel', space, person}` | Durable Object, same `ConversationRecord` shape via `@platform/gabi-conversation` |
| **User identity** | Firebase auth → `app_user.id` | `onBehalfOf` Firebase UID → same `app_user` row |
| **Personality** | `GABI_SYSTEM` in `packages/research/src/gabi.ts` | Separate prompt in catalog-platform |
| **Write capability** | None (Phase 0, build-test enforced) | Full (add books, run details, browse) |
| **Tool execution** | Browser-side (Worker returns `tool_use`, browser calls API) | Server-side (Discord Worker calls `gabi-delegated` endpoint) |

## Target State

- One personality (`GABI_SYSTEM`) used by both surfaces
- Same tools available everywhere (read + write)
- Shared conversation history — what you said in Discord shows in the site panel
- User identity already maps to the same person (Firebase UID → `app_user`)
- Entry point is the only difference (Discord DM vs site chat bubble)

## Implementation — Three Phases

### Phase 1: Upgrade site panel to full tools (library_catalog only)

**What:** Remove read-only Phase 0 enforcement, add write tools to the site panel.

**Files to change:**
- `packages/core/src/gabi-tools.ts` — add write tools (`research_book`, `set_book_details`, `add_book_by_isbn`, etc.) and bump `GABI_PHASE` to 1
- `packages/core/test/gabi-tools.test.ts` — update assertions for Phase 1 (write tools allowed, `mutates: true` permitted)
- `apps/web/src/lib/gabi.ts` — add tool execution for write tools (POST/PATCH calls via the existing `api.ts` client)
- `packages/research/src/gabi.ts` — update `GABI_SYSTEM` to remove the "I cannot change anything" paragraph
- `apps/worker/src/lib/gabi-turn.ts` — allow POST/PATCH methods in validation

**Risk:** Low — the site panel already gates on `runResearch` capability (only owners/moderators can open it), and every write tool still goes through the standard API routes which enforce their own capability checks.

**Effort:** ~3 hours.

### Phase 2: Merge conversation memory across surfaces (both repos)

**What:** Discord and the site panel share one conversation history per person per instance.

**Approach A — Discord stores in D1 (preferred):**
- Discord's Durable Object calls this Worker's `gabi_conversation` read/write via a new authenticated endpoint (`GET/PUT /api/gabi/memory`)
- Both surfaces key on `{surface: 'shared', space, person}` instead of separate surface keys
- The site panel sees Discord messages and vice versa
- Memory is in one place (D1) rather than split between D1 + Durable Object

**Approach B — Site panel reads Discord's Durable Object:**
- The site panel turn asks the Discord Worker for history before each call
- More latency, more coupling, harder to maintain

**Files to change (Approach A):**
- `apps/worker/src/routes/gabi.ts` — new `GET/PUT /api/gabi/memory` endpoint
- `packages/db/src/gabi-conversation.ts` — surface key becomes `'shared'`
- catalog-platform `apps/discord-worker` — change from Durable Object storage to calling library_catalog's memory endpoint

**Effort:** ~4 hours across both repos.

### Phase 3: Unified personality and prompt (both repos)

**What:** One `GABI_SYSTEM` prompt, one personality, sourced from library_catalog and consumed by both surfaces.

**Approach:**
- `packages/research/src/gabi.ts` remains the canonical source of the prompt
- The Discord Worker imports or syncs it (same pattern as `sync-gabi-conversation.mjs`)
- Remove any separate personality definition in catalog-platform
- The Discord bot's conversational loop uses the SAME model, effort, and prompt as the site panel

**Files to change:**
- catalog-platform: replace its own system prompt with the synced one
- `scripts/sync-gabi-conversation.mjs` → extend to also sync the system prompt (or make a `sync-gabi-prompt.mjs`)

**Effort:** ~2 hours.

## Prerequisites

- [ ] catalog-platform repo must be in the workspace
- [ ] Understand Discord bot's current Durable Object conversation storage
- [ ] Understand Discord bot's current system prompt location

## Decision Points for Owner

1. **Phase 1 alone** gives you write tools on the site panel immediately (same capabilities as Discord, but no shared history yet). Ship now?
2. **Phase 2** is the "see my Discord messages in the site chat" requirement. Needs catalog-platform access.
3. **Phase 3** is personality alignment. Depends on Phase 2.
4. **Do all three** in one session once catalog-platform is open? Or ship Phase 1 first?

## Notes

- The `ESTATE_APP_TOKEN_DISCORD` secret (one value, three holders) is already set on both instances — the auth infrastructure for cross-surface identity is in place.
- `ConversationRecord` is already shared via `@lc/gabi-conv` (synced from `@platform/gabi-conversation`) — the data shape is identical on both sides.
- The memory table already supports multiple surfaces via the `surface` key — merging them is a key-value change, not a schema change.
- **History display rule:** The site chat panel shows all conversations between GABI and this specific linked user — DMs AND public channel messages where GABI was talking to them. If GABI was responding to someone else in a public channel, that doesn't show. Only messages where the linked user was the one GABI was addressing.
