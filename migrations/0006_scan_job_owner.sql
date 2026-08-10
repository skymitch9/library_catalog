-- Give a scan job an owner, and a way to be listed.
--
-- `scan_job` has existed since migration 0001 with 0 rows and no route touching
-- it. Phase 2 kept scan results in React state, which loses the whole sweep when
-- a phone locks — tolerable for barcodes, which are free to re-scan, and not
-- tolerable for a shelf photograph, which costs an API call every time. This is
-- the last thing the table needed before a route could use it.
--
-- Additive only. Two columns and one index; nothing existing is rewritten, so
-- there is no CHECK-constraint rebuild and no ordering hazard with the other
-- migrations landing around it.
--
-- ⚠️ `mode` and `status` are NOT touched. 0001 already allows
-- ('shelf','single','isbn','file') and the seven statuses, which is exactly what
-- the two producers need: 'isbn' for a barcode sweep, 'shelf' for a photograph.
-- The sibling Board Game Catalog had to rebuild its table to add a third mode
-- (its migration 0017); this schema was written after that and does not.

-- Who swept. Nullable because the column is being added to a table that could
-- in principle hold rows already, and ON DELETE SET NULL because a job is a
-- record of work done — removing a person should not remove the evidence that
-- fourteen books were catalogued.
--
-- SQLite allows a REFERENCES clause on ADD COLUMN only when the default is NULL,
-- which is the default here.
ALTER TABLE scan_job ADD COLUMN created_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL;

-- Set every time a line is written, so "is this job still moving" is answerable
-- without reading the blob. `processed_at` already means "vision finished" and
-- is not the same question.
ALTER TABLE scan_job ADD COLUMN updated_at TEXT;

-- The queue reads newest-first and filters to unfinished. 0001's index is on
-- status alone, which is the wrong half of that query.
CREATE INDEX idx_scan_job_recent ON scan_job(created_at DESC);
