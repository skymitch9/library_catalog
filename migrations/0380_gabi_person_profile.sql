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

CREATE TABLE gabi_person_profile (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL UNIQUE REFERENCES app_user(id) ON DELETE CASCADE,
  profile     TEXT NOT NULL DEFAULT '{}',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_gabi_person_profile_user ON gabi_person_profile(user_id);
