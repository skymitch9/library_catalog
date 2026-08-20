-- Cross-library ownership visibility.
--
-- Each row represents one work that a peer library holds. Populated by
-- POST /api/peer/push from sibling instances; queried by the series and
-- work-detail routes to show "In the Padhard Library" badges on gap rungs
-- and book pages.
--
-- The table supports N peers: a third library joining the network is just
-- another peer_id. No schema change needed.

CREATE TABLE IF NOT EXISTS peer_holding (
  work_key   TEXT    NOT NULL,
  peer_id    TEXT    NOT NULL,      -- e.g. 'padhard', 'sky', 'connell'
  peer_label TEXT    NOT NULL,      -- e.g. 'the Padhard Library'
  title      TEXT,
  cover_url  TEXT,
  detail_url TEXT,                  -- full URL to the work on the peer site
  formats    TEXT,                  -- comma-separated: 'physical', 'ebook', 'physical,ebook'
  series     TEXT,
  series_index REAL,
  pushed_at  TEXT    NOT NULL,
  PRIMARY KEY (work_key, peer_id)
);

-- Fast lookup for series page: "which of these gap keys does any peer hold?"
CREATE INDEX IF NOT EXISTS idx_peer_holding_series
  ON peer_holding (series, series_index);
