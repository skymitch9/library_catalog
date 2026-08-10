-- Books that belong together without sharing a series.
--
-- Ported from board game migration 0008 (`item_relation`), with the vocabulary
-- rewritten: "works with", "reimplements" and "integrates with" are facts about
-- cardboard. What books need, taken from cases actually sitting in this catalog
-- on 2026-08-10 rather than from a taxonomy:
--
--   same_universe  Nine Sanderson works here are Cosmere and carry no series
--                  between them — *The Emperor's Soul*, *Sixth of the Dusk*,
--                  *Shadows for Silence…*, *White Sand*, *Dragonsteel Prime*,
--                  and the Secret Projects. Migration 0001 deliberately has no
--                  parent/child tree and files a line in `work.series`; a
--                  universe is not a line, has no volume numbers, and would
--                  destroy the series sort if it were forced into one.
--
--   contains       *The Divine Dungeon Complete Series* (work 103) is an
--                  omnibus and *Dungeon Born* (work 24) is inside it. Both are
--                  real rows: one is a file we hold, the other is a file we
--                  hold. Neither contains the other in the catalog sense, and
--                  making one a child of the other would take it off the shelf.
--
--   companion      *Invent Short Story* is a five-chapter sampler of
--                  Completionist Chronicles book 7. It is filed in the series
--                  with no volume number on purpose (covers-and-series.md
--                  §3.1) — the relation is what says which book it samples.
--
--   precedes       Reading order across a series boundary. The case this house
--                  already has is *Firstborn / Defending Elysium* (work 9), a
--                  bind-up whose two halves sit in different places — the
--                  reason it is one of only two works left with no series at
--                  all.
--
-- ## Why a table and not a column
--
-- Because it is many-to-many and because it is **enterable by hand**. No API
-- knows that this household considers two specific books connected, and the
-- measured state of book metadata here (half this library is absent from Open
-- Library, isbn-ladder.md §4.2) means an API never will. A feature that needed
-- an external identifier to express "these two are Cosmere" would be a feature
-- that never fired.

CREATE TABLE work_relation (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_work_id INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  to_work_id   INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,

  -- ⚠️ Two of these are symmetric and two are directional, and the difference
  -- decides how the row is written. `createWorkRelation` sorts the two ids for
  -- a symmetric relation so that A↔B and B↔A collapse onto one row and the
  -- unique index catches the duplicate. It must NOT sort a directional one: a
  -- `contains` stored the wrong way round is not an untidy duplicate, it is a
  -- false statement — it would have *Dungeon Born* containing the omnibus,
  -- purely because it was catalogued with a lower id.
  relation     TEXT NOT NULL
               CHECK (relation IN ('same_universe', 'companion', 'contains', 'precedes')),

  -- Why, in the owner's words — "both novellas, different universes", "sampler
  -- of book 7". Optional, and worth having: the sibling project added
  -- `manual_note` to its components in migration 0022 after finding that a bare
  -- verdict with no reasoning is indistinguishable from a guess.
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),

  -- Refused at the database as well as in the write path. A self-relation is
  -- always a bug and is cheaper to make impossible than to find later.
  CHECK (from_work_id <> to_work_id),
  UNIQUE (from_work_id, to_work_id, relation)
);

CREATE INDEX idx_work_relation_from ON work_relation(from_work_id);
CREATE INDEX idx_work_relation_to   ON work_relation(to_work_id);
