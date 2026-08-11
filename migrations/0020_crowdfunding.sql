-- Where a book came from, when it did not come from a shop.
--
-- *"now is a good time to scan Kickstarter, indiegogo, and Backerskit for books.
-- Same as in game catalog there are 2 backerskit accounts and we'll need to scan
-- both. … Kickstarter stuff generally has a mix of physical and digital books so
-- make sure when youre auditing you're really looking close."* — the owner,
-- 2026-08-10.
--
-- ## ⚠️ Three tables, and the split is migration 0001's rule, not tidiness
--
-- 0001 §1: *catalog (facts about the world) is separate from collection (facts
-- about us).* Applied here:
--
-- | Table | Grain | Whose fact |
-- |---|---|---|
-- | `crowdfunding_campaign` | one campaign that ran | the **world's**. Two households backing it share these rows. |
-- | `crowdfunding_pledge`   | one campaign × one of **our** accounts | **ours**. What we paid, when, at which tier. |
-- | `pledge_item`           | one **book** a pledge delivered | ours, and this is the row that must not collapse. |
--
-- Collapsing campaign into pledge would make "which account backed the Dungeon
-- Crawler Carl campaign" unanswerable when the answer is *both of them* — which
-- is the ordinary BackerKit case, not an edge one: back on Kickstarter with one
-- login, late-pledge through the pledge manager with the other.
--
-- ## ⚠️ The account column is the entire reason this feature is not one table
--
-- There are **two BackerKit accounts**. A pledge with no account on it cannot be
-- reconciled against a scan of either of them, and a re-scan of account B would
-- silently duplicate everything account A already recorded. `account` is NOT NULL
-- and non-empty, and `UNIQUE (campaign_id, platform, account)` is what makes a
-- re-scan an upsert instead of a second copy of the library.
--
-- ## ⚠️ ONE CAMPAIGN DELIVERS A PHYSICAL BOOK **AND** AN EBOOK. Do not merge them.
--
-- This is the failure the owner named in advance, and `pledge_item` is the answer:
-- its grain is one *reward line*, and the physical/digital axis is carried by
-- `edition_id` → `edition.format`, which is where this schema has modelled it
-- since 0001. A single pledge for *He Who Fights with Monsters 12* legitimately
-- produces **two** `pledge_item` rows against **one** `work`:
--
--     pledge_item(work_id=57, edition_id=<hardcover>,  format_hint='Deluxe Hardcover')
--     pledge_item(work_id=57, edition_id=<ebook_epub>, format_hint='EPUB + MOBI')
--
-- Two rows, one work, no double count — because every count that matters is over
-- `work_id DISTINCT` or over editions, never over rows. `packages/core/src/
-- crowdfunding.ts` holds the classifier and `npm test` pins it.
--
-- ⚠️ **The unique index uses `IFNULL`, and that is not decoration.** In SQLite a
-- UNIQUE index treats NULLs as distinct, so a plain
-- `UNIQUE (pledge_id, work_id, edition_id)` would let a re-import insert the same
-- unmatched line every single run, forever, with no error. `IFNULL(edition_id, 0)`
-- collapses the unmatched case to one bucket, and `IFNULL(format_hint, '')` is
-- what still lets the physical line and the digital line coexist *before* anybody
-- has matched either of them to an edition.
--
-- ## ⚠️ Barnes & Noble is NOT a platform here, and must never be added
--
-- The purchase scan also turns up **Barnes & Noble**, and it is a shop. A shop
-- purchase already has a home in this schema and has since migration 0001:
-- `copy.vendor`, `copy.acquired_on`, `copy.price_paid_cents`, `copy.currency`.
-- Adding `'barnes_noble'` to the platform CHECK would put retail orders in a
-- table whose every column — campaign, tier, pledged_on, backer account — is
-- meaningless for them, and would make "what did we crowdfund" unanswerable.
--
-- The two are told apart by a question, not a taxonomy: **did the money buy a
-- promise or a product?** A pledge is a promise with a delivery date, an account
-- that can be scanned, and rewards that arrive in pieces over years. An order is
-- a product. `copy` models the second one already.
--
-- ## Signed and numbered arrive as reward TEXT, and land on the copy
--
-- Measured: *"Book 1 will be Signed & Numbered"*, *"CONQUEROR -- SIGNED
-- PAPERBACK+"*, *"Legendary Book Box (Uniquely Numbered)"*. There is no signed
-- field on a campaign page; it is prose in the reward title.
--
-- ⚠️ It is therefore **not** a column here. `copy.is_signed` (migration 0001) and
-- `edition.edition_name` are where those facts already live, and duplicating them
-- on the reward line would create two answers to "is our copy signed" with
-- nothing keeping them in step. `rewardFlags()` in `packages/core/src/
-- crowdfunding.ts` reads the prose and the importer prints it as a **proposal**;
-- a person ticks the box on the copy.
--
-- ## What is deliberately NOT here
--
-- - **No stretch goals, no funding totals, no backer counts.** Facts about the
--   campaign that no query in this app would ever ask. The sibling Board Game
--   Catalog reached the same conclusion and shipped a single `item.source_url`
--   (its migration 0012) — this goes further only because books arrive in
--   physical-plus-digital pairs and boardgames do not.
-- - **No `accessory_id` on `pledge_item`.** Accessories point at the pledge
--   instead (migration 0011). One direction, one source of truth.
-- - **No bundle table.** A multi-work reward line ("Collector's Edition
--   Trilogy") is N rows sharing one `external_ref` and one `title`. That is what
--   groups them, and it needs no second table to say so.

-- ---------------------------------------------------------------------------
-- The campaign — a fact about the world
-- ---------------------------------------------------------------------------

CREATE TABLE crowdfunding_campaign (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Where the campaign RAN. Not necessarily where our pledge lives — a
  -- Kickstarter campaign whose pledge manager is BackerKit is the common case,
  -- and `crowdfunding_pledge.platform` records that separately.
  platform     TEXT    NOT NULL
                       CHECK (platform IN ('kickstarter', 'backerkit', 'indiegogo')),

  -- As the campaign page titles it.
  name         TEXT    NOT NULL,
  -- The publisher, author or studio running it.
  creator      TEXT,
  url          TEXT,

  -- The platform's own identifier — a Kickstarter project slug, a BackerKit
  -- project id. ⚠️ This is what makes a re-scan an upsert rather than a
  -- duplicate, and it is nullable because a hand-entered campaign has none.
  external_id  TEXT,

  launched_on  TEXT,
  -- When it funded or closed. `YYYY-MM-DD`, like every other date column here.
  funded_on    TEXT,

  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Idempotency for the scan. Partial, because a hand-entered row has no id and
-- several of those must be allowed to coexist.
--
-- ⚠️ **An upsert against a PARTIAL index must repeat the predicate in its
-- conflict target**, or SQLite refuses with *"ON CONFLICT clause does not match
-- any PRIMARY KEY or UNIQUE constraint"*. Measured 2026-08-10 — the first run of
-- `npm run import:crowdfunding --commit` died on exactly this and wrote nothing.
-- The correct form is:
--
--     ON CONFLICT (platform, external_id) WHERE external_id IS NOT NULL DO UPDATE …
--
-- It fails loudly, which is the one good thing about it. `upsertCampaign` in
-- `packages/db` sidesteps the question entirely by selecting first.
CREATE UNIQUE INDEX idx_campaign_external ON crowdfunding_campaign(platform, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX idx_campaign_name ON crowdfunding_campaign(name COLLATE NOCASE);

-- ---------------------------------------------------------------------------
-- The pledge — a fact about us
-- ---------------------------------------------------------------------------

CREATE TABLE crowdfunding_pledge (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id  INTEGER NOT NULL REFERENCES crowdfunding_campaign(id) ON DELETE CASCADE,

  -- Where THIS pledge lives, which may not be where the campaign ran. Backing on
  -- Kickstarter and completing on BackerKit is one campaign and one pledge, and
  -- the scan that finds it is a scan of BackerKit.
  platform     TEXT    NOT NULL
                       CHECK (platform IN ('kickstarter', 'backerkit', 'indiegogo')),

  -- ⚠️ WHICH LOGIN. There are two BackerKit accounts and this column is the only
  -- thing that tells their pledges apart. Free text rather than an enum: the set
  -- of accounts belongs to the owner and a third one must not need a migration.
  -- Non-empty is enforced, because '' would defeat the unique index below.
  account      TEXT    NOT NULL CHECK (length(trim(account)) > 0),

  -- "Hardcover Deluxe", "All-In", "Digital Only". Verbatim from the pledge page.
  tier         TEXT,
  pledged_on   TEXT,
  amount_cents INTEGER,
  currency     TEXT    NOT NULL DEFAULT 'USD',

  -- The pledge manager, when there is one and it differs from the campaign page.
  manager_url  TEXT,

  status       TEXT    NOT NULL DEFAULT 'pledged'
                       CHECK (status IN ('pledged', 'delivered', 'partial',
                                         'cancelled', 'refunded')),

  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),

  -- ⚠️ The re-scan guard. One campaign, one platform, one login = one pledge.
  UNIQUE (campaign_id, platform, account)
);

CREATE INDEX idx_pledge_campaign ON crowdfunding_pledge(campaign_id);
CREATE INDEX idx_pledge_account  ON crowdfunding_pledge(account, platform);

-- ---------------------------------------------------------------------------
-- What the pledge delivered — the physical/digital split lives here
-- ---------------------------------------------------------------------------

CREATE TABLE pledge_item (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pledge_id    INTEGER NOT NULL REFERENCES crowdfunding_pledge(id) ON DELETE CASCADE,

  -- The book, in the catalog. NOT NULL: a reward line that points at nothing is a
  -- note, not a link, and `notes` on the pledge is where a note goes. The same
  -- rule `work_relation` follows — a link is between two rows.
  work_id      INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,

  -- ⚠️ THE PHYSICAL/DIGITAL AXIS. `edition.format` already distinguishes
  -- hardcover from ebook_epub from ebook_kindle; nothing here re-states it.
  -- Nullable, because a scan finds "Deluxe Hardcover" before anybody has created
  -- the hardcover edition row.
  edition_id   INTEGER REFERENCES edition(id) ON DELETE SET NULL,

  -- The copy that arrived, once one is recorded.
  copy_id      INTEGER REFERENCES copy(id) ON DELETE SET NULL,

  -- What the campaign called it, verbatim: "Deluxe Hardcover", "EPUB + MOBI",
  -- "Signed Paperback + Ebook Bundle". ⚠️ Kept even after `edition_id` is filled
  -- in, because it is the evidence for the match and the only thing that can be
  -- re-read when a match turns out to be wrong.
  format_hint  TEXT,
  -- The reward's own title on the campaign page, which is routinely not the
  -- catalog title ("Book 3 — Ebook", "The whole series in hardback").
  title        TEXT,

  quantity     INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  -- Has it actually turned up? A 2027 delivery date is the normal state of a
  -- crowdfunded book, and a wishlist that shows undelivered pledges as owned is
  -- the bug this column prevents.
  fulfilled    INTEGER NOT NULL DEFAULT 0 CHECK (fulfilled IN (0, 1)),

  -- ⚠️ "Asked and answered" for the printing, distinct from "nobody has looked".
  --
  -- Measured, not hypothetical: one pledge routinely delivers **ebook + print +
  -- audiobook together** (Space Knight 5 and 6, Tamer Bk 11, Fires of December).
  -- The audiobook line can NEVER be matched to an `edition` — `EDITION_FORMATS`
  -- has no audiobook value and deliberately never will (audio lives in
  -- `audiobook_catalog` and meets this app through `work_key`; HANDOFF.md open
  -- question 5 settles it as **No**). Without this column that line sits in the
  -- audit's "no printing" queue forever, and a queue that can never empty is a
  -- queue nobody reads.
  --
  -- Exactly the three-way distinction `gap_verdict` draws (migration 0007), with
  -- the same two values and the same reason there is no third: a *found*
  -- printing is `edition_id`, and a verdict beside it would be a second copy of
  -- the same fact.
  --   'none'    — there is genuinely no edition row for this. An audiobook.
  --   'unknown' — somebody looked and could not tell.
  edition_verdict TEXT CHECK (edition_verdict IS NULL
                              OR edition_verdict IN ('none', 'unknown')),

  -- The line's identifier on the platform, when it has one. Import idempotency
  -- for rows the IFNULL index below cannot separate.
  external_ref TEXT,

  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ⚠️ THE INDEX THAT KEEPS ONE CAMPAIGN'S PHYSICAL AND DIGITAL BOOKS APART
-- WITHOUT DOUBLE-COUNTING THE WORK.
--
-- Read the header. `IFNULL` is what makes it work at all: SQLite treats NULL as
-- distinct from NULL inside a UNIQUE index, so the naive three-column version
-- silently permits unlimited duplicates of every unmatched line.
CREATE UNIQUE INDEX idx_pledge_item_unique
  ON pledge_item(pledge_id, work_id, IFNULL(edition_id, 0), IFNULL(format_hint, ''));

-- ⚠️ `work_id` is IN this index, and leaving it out was a real bug.
--
-- Measured: **one reward line can cover several works.** "Collector's Edition
-- Trilogy" is three books, and all three carry the same `external_ref` because
-- the platform gave the *line* one identifier, not the books. A
-- `UNIQUE (pledge_id, external_ref)` would have accepted the first book of the
-- trilogy and refused the other two — silently losing two thirds of the pledge,
-- which is precisely the class of loss this whole table is shaped to prevent.
CREATE UNIQUE INDEX idx_pledge_item_external
  ON pledge_item(pledge_id, external_ref, work_id) WHERE external_ref IS NOT NULL;

CREATE INDEX idx_pledge_item_pledge  ON pledge_item(pledge_id);
CREATE INDEX idx_pledge_item_work    ON pledge_item(work_id);
CREATE INDEX idx_pledge_item_edition ON pledge_item(edition_id);
