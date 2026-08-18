-- GABI's rolling memory for the site chat panel, and the two accounting columns
-- that make its share of the spend attributable rather than inferred.
--
-- The owner's ask, verbatim (2026-08-17, about the Discord surface): "I don't
-- want to message GABI and then message her again and she has no recollection."
-- And the constraint that shaped the record, also his: "whatever we build we
-- need to consider for when we update the chat button on GABI."
--
-- ⚠️ THE SHAPE IS NOT THIS REPO'S. The record stored in `record` below is
-- `ConversationRecord` from catalog-platform's `@platform/gabi-conversation` —
-- byte-for-byte the shape GABI's Discord surface writes into its Durable
-- Object. That was the point: one substrate, so "she remembers the last ~10
-- exchanges for ~30 minutes" is one rule with one implementation instead of two
-- that drift. See docs/info/gabi-panel-v2.md, and that repo's
-- docs/info/gabi-conversation-continuity.md for the contract.
--
-- ⚠️ THE STORAGE IS THIS REPO'S, AND DELIBERATELY SO. The panel does NOT call
-- the Discord Worker's gateway object. Three reasons, in order of how much they
-- cost when ignored:
--
--   1. A chat turn on the site must not depend on the Discord Worker being up.
--      That object holds an always-on gateway socket; when it drops, GABI on
--      Discord goes quiet — and a shared store would take the website's chat
--      down with it, for a person who has never opened Discord.
--   2. The continuity design says so in its own words: "It must NOT reuse the
--      Discord Worker's Durable Object. The object is per-Worker and holds a
--      bot token's session; the shape travels, the storage does not."
--   3. A cross-Worker call is a subrequest, and this route's whole architecture
--      is an argument about the 50-subrequest ceiling.
--
-- ⚠️ ONE ROW PER PERSON PER INSTANCE, not one per conversation. `storage_key`
-- is `conversationStorageKey()`'s output — `conv:web_panel:<space>:<person>` —
-- so a new browser tab continues the same memory rather than starting a second
-- one. That is what "a returning user continues their conversation" means, and
-- it is why the browser's own per-tab conversation id is NOT part of this key
-- (it rides inside the record, in the turn's surface-private `ref` bag).
--
-- ⚠️ NO FOREIGN KEY ON `person`, and that is a design decision rather than an
-- oversight. `key.person` is OPAQUE by the substrate's contract — "a Discord
-- snowflake and a library app_user id must be interchangeable" — and a foreign
-- key is a database that parses an opaque string. `gabi_turn.user_id` carries
-- the real, checkable relationship to `app_user`; this table carries a memory.
--
-- ⚠️ AGED-OUT STATE IS DELETED, NOT ARCHIVED. `pruneConversation()` returns
-- null when a record has nothing left inside its window and every caller must
-- answer that by deleting the row. There is no archive column, no tombstone and
-- no `expired` flag — deliberately, because an empty-but-present row would
-- leave a key per person per instance forever, and that key still says who
-- talked to her and where. The estate keeps half an hour of what somebody said
-- to a librarian in a chat window, and then it is gone. A privacy posture, not
-- an optimisation.
--
-- Applied to BOTH instances (the shared migrations_dir), the same standing
-- order 0330 followed: migrate before deploy, so new code never meets an old
-- schema.

CREATE TABLE gabi_conversation (
  -- `conversationStorageKey({surface, space, person})`. Stored whole rather
  -- than recomputed from the three columns below, because the substrate owns
  -- the joining rule (length caps, separator replacement) and a second
  -- implementation of it here is exactly the drift this build removed.
  storage_key TEXT    PRIMARY KEY,

  -- The three parts, denormalised for the sweep and for a human reading the
  -- table. ⚠️ Never parsed, never joined on, never used to rebuild the key.
  surface     TEXT    NOT NULL,
  space       TEXT    NOT NULL,
  person      TEXT    NOT NULL,

  -- The `ConversationRecord` as JSON. One blob rather than a turns table: the
  -- record is read and written whole, it is bounded at 20 turns x 600 chars
  -- (~12 KB), and a turns table would invite a query that reads somebody's chat
  -- history across conversations — which is the thing the 30-minute window
  -- exists to make impossible.
  record      TEXT    NOT NULL,

  -- Epoch ms, mirroring `record.updatedAt`. Duplicated out of the blob for one
  -- reason: the sweep below is `WHERE updated_at < ?`, and a sweep that had to
  -- parse JSON to find its own predicate would be a full scan by construction.
  updated_at  INTEGER NOT NULL
);

-- The sweep's index: "everything whose window closed before X".
CREATE INDEX idx_gabi_conversation_updated ON gabi_conversation(updated_at);

-- ---------------------------------------------------------------------------
-- gabi_turn gains continuity's share of the bill
-- ---------------------------------------------------------------------------
--
-- ⚠️ Context tokens are charged on EVERY turn, so an unbounded history makes
-- turn 10 cost ten times turn 1 under a cap that never noticed. The window
-- bounds it — but "bounded" is a claim, and this repo's rule is that a number
-- is either measured or labelled a guess. These two columns are what make
-- continuity's share of a conversation's cost attributable rather than
-- inferred, and they are the same two fields GABI's Discord accounting line
-- already carries, by name, so the two surfaces can be compared without a
-- translation step.
--
-- ⚠️ THE REMEMBERED TEXT IS NEVER LOGGED — only how much of it there was. Same
-- posture as the Discord side.
--
-- NULL is meaningful and is not backfilled: it means the turn was made before
-- this column existed, which is a different fact from "this turn carried no
-- history" (0). Every figure in the 0330 header rests on exactly that
-- distinction between an absent measurement and a measured zero.

ALTER TABLE gabi_turn ADD COLUMN history_turns INTEGER;
ALTER TABLE gabi_turn ADD COLUMN history_chars INTEGER;
