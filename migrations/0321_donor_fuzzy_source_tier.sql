-- Let research_finding.source_tier say 'donor_fuzzy' — a value copied from the
-- sibling library instance where the canonical key MISSED and an AI judge said
-- the two rows are the same work anyway.
--
-- Owner ask 2026-08-16, the rung after the donor sweep shipped: *"have our ai
-- model do a back up search on donors for fuzzy match before going to web."*
-- The ladder is now (1) exact canonical fold → (2) a cheap candidate shortlist
-- judged by one small Claude call → (3) the existing web research.
--
-- ⚠️ Why this is a SEPARATE value and not just 'donor'. 0320's tier means the
-- `work_key` (or a unique folded title) matched — an identity this codebase
-- computes and can recompute. This one means a MODEL was asked whether two
-- differently-named rows are the same book, which is the isbn-ladder.md §4.4
-- failure shape (right title, wrong book) that routes/donor.ts otherwise
-- refuses to guess at. Wearing 'donor' would make a judged copy
-- indistinguishable in the one column whose whole job is to say where a value
-- came from — and `listAutoApplied` + `revertFinding` are the tools a person
-- reaches for when a judge turns out to have been wrong, so "show me every
-- judged copy" has to be one query.
--
-- It is also what makes the confirm-first rule mechanical rather than written
-- down: `autoApplyFindings` refuses this tier unless the caller opts in by
-- name, so a judged match that was NOT confident stays `pending` for a person
-- however many later runs sweep that work.
--
-- Same four-step rebuild as 0320 (SQLite cannot alter a CHECK in place): new
-- table, copy, drop, rename. Ids are copied explicitly so nothing downstream
-- moves; AUTOINCREMENT keeps its sequence because sqlite_sequence tracks the
-- max id on insert. Nothing references research_finding by foreign key, so the
-- drop orphans nothing.
--
-- Neither donor value is in core's SOURCE_TIERS (the model's answer enum and
-- the conflict ranking) — see DONOR_FUZZY_SOURCE_TIER in
-- packages/core/src/constants.ts. The FindingSourceTier type there must match
-- this CHECK list.

CREATE TABLE research_finding_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES research_run(id) ON DELETE CASCADE,
  work_id       INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  edition_id    INTEGER REFERENCES edition(id) ON DELETE CASCADE,
  field         TEXT    NOT NULL,
  value_json    TEXT    NOT NULL,
  source_tier   TEXT    NOT NULL
                        CHECK (source_tier IN ('official', 'crowdfunding', 'retail', 'community', 'donor', 'donor_fuzzy')),
  source_url    TEXT,
  confidence    REAL,
  review_state  TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (review_state IN ('pending', 'accepted', 'rejected')),
  reviewed_by   INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Added by 0013, deliberately CHECK-less there; stays CHECK-less here.
  decided_how   TEXT
);

INSERT INTO research_finding_new
  (id, run_id, work_id, edition_id, field, value_json, source_tier, source_url,
   confidence, review_state, reviewed_by, reviewed_at, created_at, decided_how)
SELECT
   id, run_id, work_id, edition_id, field, value_json, source_tier, source_url,
   confidence, review_state, reviewed_by, reviewed_at, created_at, decided_how
FROM research_finding;

DROP TABLE research_finding;

ALTER TABLE research_finding_new RENAME TO research_finding;

-- The same four indexes 0001, 0013 and 0320 declared, byte-for-byte.
CREATE INDEX idx_finding_work        ON research_finding(work_id);
CREATE INDEX idx_finding_review      ON research_finding(review_state);
CREATE INDEX idx_finding_run         ON research_finding(run_id);
CREATE INDEX idx_finding_decided_how ON research_finding(decided_how, reviewed_at);
