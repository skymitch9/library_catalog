-- GABI Personal Context — profile notes and preferences per person.
--
-- The `profile` column stores JSON with three optional keys:
--
--   callMe   — what the person prefers to be called (string)
--   notes    — lasting preferences, max 6, each max 120 chars (string[])
--   threads  — open items / follow-ups, max 5 ({ what, at }[])
--
-- This is metadata ABOUT THE PERSON, not about the catalog. It lets GABI
-- remember preferences ("I don't like spoilers"), preferred names, and
-- things she promised to follow up on — across conversations, across surfaces.
-- The catalog already knows what books they own; this knows how they read.

CREATE TABLE IF NOT EXISTS gabi_person_profile (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL UNIQUE REFERENCES app_user(id) ON DELETE CASCADE,
  profile     TEXT NOT NULL DEFAULT '{}',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gabi_person_profile_user ON gabi_person_profile(user_id);

-- ⚠️ IF NOT EXISTS on both statements, added 2026-08-22, and it is a repair
-- rather than a style choice. The table and the index were created on BOTH
-- live instances out of band — measured that day, their `sqlite_master` SQL is
-- byte-identical to the two statements above — but `d1_migrations` recorded
-- neither, so both ledgers still ended at 0370. `d1 migrations apply` therefore
-- failed on "table already exists", which meant the estate's own "migrate
-- before deploy" rule could not be followed at all: the next person to run it
-- hit a wall on a database that was in fact already correct.
--
-- Guarded, this file is a no-op against those two and still builds the table on
-- a fresh database — which is what `docs/access/RECOVERY.md` needs it to do.
-- Both instances held 0 rows when this landed, so nothing was at risk either way.
