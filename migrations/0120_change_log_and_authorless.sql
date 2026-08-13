-- Edit-any-detail, the audit log, and the authorless book.
-- Design: docs/info/edit-and-audit-design.md. Approved by the owner 2026-08-13.
--
-- Additive only — one new table, two paired columns, one index. NO table is
-- rebuilt, deliberately: `work` is the most-referenced table in this schema,
-- and 0008 records what a D1 rebuild of a referenced table costs (stash and
-- restore of every child row; BOTH escape pragmas were measured to LOSE
-- DATA). So "no author yet" is a sentinel VALUE ('?unknown', @lc/core
-- UNKNOWN_AUTHOR) rather than a nullable column: the '?' cannot survive
-- normaliseTitle's fold — which emits only [a-z0-9 ] — so a provisional key
-- can never collide with a real one, not even for a book genuinely credited
-- to "Unknown", and reviewDocFor refuses to stamp it onto a review document
-- at all. Every column here stays NOT NULL and every existing invariant of
-- 0001 stands untouched.
--
-- Nothing below backfills anything. No existing row is authorless, and
-- reviews_seen_* starting NULL is the honest "nobody has looked yet" —
-- 0040's rule, which refused to backfill cover_status to 'ok' for exactly
-- the same reason: it would be a value nothing observed.

-- ===========================================================================
-- change_log — who changed what, when, and what it said before
-- ===========================================================================
-- ⚠️ Designed ONCE for both catalogs (edit-and-audit-design.md §8).
-- audiobook_catalog applies this same DDL in its own database when it gains a
-- real editor; the tables are never shared or merged (PLATFORM.md §2.2) — the
-- *shape and semantics* are what cross the boundary, so the two sides give
-- one answer to "what happened".
--
-- One row per field per event, NOT one JSON blob per save:
--   * "when did the title change, and from what" is one indexed read;
--   * a future per-field undo needs no blob surgery;
--   * batch_id still groups a save into one event for display.
--
-- Append-only. No UPDATE or DELETE route exists, and the table has no
-- updated_at to even record one — an audit log something can edit is not an
-- audit log. No retention cap: at household scale (a few hundred works, two
-- editors) the log grows slower than the catalog it describes.
CREATE TABLE change_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,

  -- One save = one batch = one screenful. crypto.randomUUID() in the route.
  batch_id    TEXT    NOT NULL,

  -- 'work' | 'edition' | 'copy' today. No CHECK, following cover_status
  -- (0040) and edition_kind (0050): the set will grow (user_book? watches?)
  -- and a CHECK here makes each addition a table rebuild.
  entity      TEXT    NOT NULL,

  -- ⚠️ Deliberately NOT a foreign key. An audit row must survive the row it
  -- describes — a log that forgets deleted books is useless on exactly the
  -- question ("who deleted this, and what did it say?") it exists to answer.
  entity_id   INTEGER NOT NULL,

  -- The column name as the API spells it ('title', 'authors', 'coverUrl'),
  -- or '__row__' for a creation (old_json is 'null') or a deletion (new_json
  -- is 'null', and old_json is the whole row as JSON — the undo material for
  -- a bad delete).
  field       TEXT    NOT NULL,

  -- ⚠️ JSON-encoded, NOT NULL — SQL NULL never appears in these two columns.
  -- 'null' (the JSON literal) means "the column was NULL"; there is no way to
  -- write "not recorded", which is the point: a row in this table always
  -- knows both of its values. Same encoding as research_finding.value_json.
  old_json    TEXT    NOT NULL,
  new_json    TEXT    NOT NULL,

  -- Who, and how. changed_how reuses DECISION_MODES ('human' | 'auto'), the
  -- same vocabulary as decided_how (0013) and raised_how (0040): the details
  -- queue writes values unread, and its writes must stay distinguishable
  -- from a person's forever.
  changed_by  INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  changed_how TEXT    NOT NULL DEFAULT 'human',

  -- Free text for the one fact worth keeping beside the diff: a key move
  -- writes 'reviews restamped: 3', an auto-apply writes 'finding 412'.
  -- Nullable — most edits have nothing extra to say.
  note        TEXT,

  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The two reads this table has: "history of this book" (the book page's
-- Changes panel) and "what changed lately" (a future estate-wide view).
CREATE INDEX idx_change_log_entity ON change_log(entity, entity_id, id);
CREATE INDEX idx_change_log_time   ON change_log(created_at);

-- ===========================================================================
-- work.reviews_seen_count / reviews_seen_at — the server's evidence floor
-- ===========================================================================
-- The Worker cannot see Firestore (no service account, deliberately —
-- identity-and-reviews.md §3), so it can never PROVE a book has no reviews.
-- What it CAN hold is the browser's last observation: every book-page review
-- fetch reports what it saw, and a key-moving edit that claims "no reviews"
-- against a positive count here is refused. A read-model of Firestore, like
-- user_book.rating_cached: never authoritative, and never written back the
-- other way.
--
-- ⚠️ The pair moves together or not at all — a count with no timestamp is
-- unfalsifiable, and a timestamp with no count says nothing. That is 0040's
-- rule: the flag travels with its value. NULL means "no browser has ever
-- reported", which is true of every row today.
ALTER TABLE work ADD COLUMN reviews_seen_count INTEGER;
ALTER TABLE work ADD COLUMN reviews_seen_at    TEXT;

-- "Which books still need an author" is derived from authors = '?unknown'
-- (a NEEDS clause, deliberately not a work_watch row — design doc §3.3), but
-- both the filter and the facet count scan the table without this.
CREATE INDEX idx_work_unknown_author ON work(id) WHERE authors = '?unknown';
