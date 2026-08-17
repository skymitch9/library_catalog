-- The conversational fixer's accounting row — one per model call.
--
-- ⚠️ This table exists so that §7 of docs/info/gabi-fixer-design.md stops being
-- arithmetic. Every figure in that section is derived from a published price
-- table, not from an invoice, and the design says so about itself:
--
--   "Everything in §7.1 is arithmetic. To convert it into the kind of number
--    this estate actually trusts, v1 should record each turn the way
--    `research_run` records a lookup … Without it, §7 stays a guess forever and
--    the 'is this expensive?' question is unanswerable. With it, phase 0 ENDS
--    with a measured cost-per-conversation figure."
--
-- That is the whole justification, and it is the estate's verification rule in
-- another form: a number is either MEASURED (dated, re-checkable) or labelled a
-- guess. `research_run` already carries `input_tokens` / `output_tokens` as
-- columns rather than something the browser holds, for exactly this reason —
-- migration 0001's own comment on that table makes the argument. This is its
-- twin for the conversational surface.
--
-- ⚠️ THE ONE THING THAT MAKES IT DIFFERENT FROM research_run: the two cache
-- columns. §7.1's cost claim rests entirely on the ~2.5k system+tools prefix
-- caching from turn 2 onward at ~0.1x read cost. A row that recorded only
-- `input_tokens` could not tell a cache read from a full-price token, so it
-- could confirm the total and never the claim — and the claim is the part that
-- decides whether a longer conversation is cheap or ruinous. `usage`'s own
-- `cache_read_input_tokens` is the measurement; this is where it lands.
--
-- No CHECK constraints anywhere below, deliberately. Migration 0013 declined one
-- on `decided_how` because "the set may grow ... and a CHECK here would make
-- each addition a table rebuild", and 0320 then paid that exact rebuild cost for
-- `source_tier`'s CHECK. `model` and `stop_reason` are both vocabularies owned
-- by somebody else (Anthropic), so they are the last two columns in this repo
-- that should be pinned by a constraint SQLite cannot alter in place.
--
-- Applied to BOTH instances (the shared migrations_dir), even though the panel
-- is posture-OFF on the main one: the code deploys before the feature is
-- switched on, and an empty table on the main catalog costs nothing. Schema
-- ahead of behaviour is this repo's standing order — migrate before deploy, so
-- new code never meets an old schema.

CREATE TABLE gabi_turn (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,

  -- The browser mints this per conversation and sends it every turn. It is the
  -- join that turns per-turn rows into a cost-per-CONVERSATION, which is the
  -- figure §7 actually owes an answer for. Not a foreign key: a conversation is
  -- not a stored object anywhere: v1 persists no transcript (§3.2, "stateless").
  conversation_id       TEXT    NOT NULL,

  -- Whose key paid, and on whose authority the turn was made. SET NULL rather
  -- than CASCADE, matching research_run.triggered_by: deleting a person must
  -- not delete the record that money was spent.
  user_id               INTEGER REFERENCES app_user(id) ON DELETE SET NULL,

  -- Which model answered, from the RESPONSE and not from our constant — a
  -- server-side fallback or a silent alias change would otherwise be invisible.
  -- Same reasoning as research_run.model: a figure attributed six months from
  -- now should be traceable to the model that produced it.
  model                 TEXT    NOT NULL,
  effort                TEXT,

  -- How deep into the conversation this turn was: the length of the messages
  -- array the browser sent. This is what makes the turn ceiling auditable — a
  -- refused turn is recorded with the count that got it refused.
  turn_index            INTEGER,

  -- end_turn | tool_use | max_tokens | refusal | pause_turn | NULL on failure.
  -- Free-form on purpose (see the header): the vocabulary is not ours.
  stop_reason           TEXT,

  input_tokens          INTEGER,
  output_tokens         INTEGER,
  -- The two columns the header is about. NULL means the response carried no
  -- usage at all (a failure before the call); 0 means it carried a zero.
  cache_read_tokens     INTEGER,
  cache_creation_tokens INTEGER,

  -- How many tool_use blocks the turn asked for. The browser executes them, so
  -- this is the only place the SERVER can see how tool-heavy a conversation ran
  -- — and it is the counter that says whether the model is reaching for the
  -- paid lookup freely once phase 1 gives it one (§7.1's practical implication).
  tool_calls            INTEGER,

  -- ⚠️ Set means the turn FAILED, and the row exists anyway. A refusal, a
  -- timeout, a missing key and a turn-ceiling refusal all cost something (time,
  -- or an unanswered question), and a cost model built only from successes is
  -- the same silent-staleness trap in another disguise. NULL = it worked.
  error_message         TEXT,

  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The cost-per-conversation query: WHERE conversation_id = ? ORDER BY id.
CREATE INDEX idx_gabi_turn_conversation ON gabi_turn(conversation_id, id);
-- "What has this person's talking cost this month?"
CREATE INDEX idx_gabi_turn_user ON gabi_turn(user_id, created_at);
