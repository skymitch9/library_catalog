-- Let research_finding.source_tier say 'donor' — a value copied from a sibling
-- library instance rather than claimed from the web.
--
-- The donor-first details sweep (owner ask 2026-08-16: "before pinging the ai
-- it checks other libraries for answers") copies detail values from another
-- instance of this same app. Those values go through the ordinary finding →
-- auto-apply path so their provenance is recorded like everything else's — but
-- 0001's CHECK only admits the model's four web tiers, and a copied-from-the-
-- donor value wearing 'community' would be a lie in the one column whose whole
-- job is to say where a value came from.
--
-- ⚠️ This is the rebuild migration 0013 predicted. Its comment declined a CHECK
-- on decided_how precisely because "the set may grow ... and a CHECK here would
-- make each addition a table rebuild". source_tier got its CHECK in 0001,
-- before that lesson, so growing it costs the rebuild below: SQLite cannot
-- alter a CHECK in place.
--
-- The rebuild is the standard four-step: new table, copy, drop, rename. Ids are
-- copied explicitly so nothing downstream moves; AUTOINCREMENT keeps its
-- sequence because sqlite_sequence tracks the max id on insert. Nothing
-- references research_finding by foreign key, so the drop orphans nothing.
--
-- 'donor' is NOT added to core's SOURCE_TIERS (the model's answer enum and the
-- conflict ranking) — see DONOR_SOURCE_TIER in packages/core/src/constants.ts.
-- The FindingSourceTier type there must match this CHECK list.

CREATE TABLE research_finding_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES research_run(id) ON DELETE CASCADE,
  work_id       INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  edition_id    INTEGER REFERENCES edition(id) ON DELETE CASCADE,
  field         TEXT    NOT NULL,
  value_json    TEXT    NOT NULL,
  source_tier   TEXT    NOT NULL
                        CHECK (source_tier IN ('official', 'crowdfunding', 'retail', 'community', 'donor')),
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

-- The same four indexes 0001 and 0013 declared, byte-for-byte.
CREATE INDEX idx_finding_work        ON research_finding(work_id);
CREATE INDEX idx_finding_review      ON research_finding(review_state);
CREATE INDEX idx_finding_run         ON research_finding(run_id);
CREATE INDEX idx_finding_decided_how ON research_finding(decided_how, reviewed_at);
