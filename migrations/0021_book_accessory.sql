-- The things that came in the box and are not books.
--
-- *"We can add a section for accessories for stuff that came with a kickstarter
-- or a book but we don't need ti publish that count on the main page, just keep
-- it each book. Some books have plushies or pins."* — the owner, 2026-08-10.
--
-- ## ⚠️ Why this hangs off the COPY and not the work
--
-- A plushie is not a fact about the novel. *Dungeon Crawler Carl* the work has no
-- plushie; the deluxe hardcover that arrived in a Kickstarter box does. The
-- distinction is load-bearing here for three reasons that are already true of
-- this household's shelf:
--
--   1. **Two backers of one campaign get different things.** A £40 tier and a
--      £120 tier deliver the same book and a different pile of extras. Filing the
--      pin on the work would say the book comes with a pin, which is false for
--      the retail paperback sitting next to it.
--   2. **You can own a work twice.** A retail paperback and a campaign deluxe of
--      the same novel are two `copy` rows, and only one of them has the enamel
--      pin. `work` cannot hold a fact that is true of one copy and false of
--      another — that is exactly the split migration 0001 §1 exists to keep.
--   3. **Selling or lending the copy takes the extras with it.** `copy.status`
--      already models that; an accessory on the work would survive the copy
--      leaving the house.
--
-- ⚠️ **The case that settles it is measured, not imagined.** The scan found a
-- dust jacket delivered as a reward of a *later* campaign, for a book bought in
-- an *earlier* one — "V2 or V3 Bundle w/ V1 Jacket". That accessory belongs to a
-- copy the household already owned, and it arrived from a pledge that delivered
-- no copy at all. Only a row with `copy_id` and `pledge_id` as **separate**
-- nullable columns can say that. A `work`-level accessory could not say which
-- printing the jacket fits; an accessory hanging off the pledge's own delivery
-- could not reach a copy that predates it.
--
-- ## ⚠️ …and why `copy_id` is nevertheless NULLABLE
--
-- Because `work_id` is the column that makes the panel render, and because the
-- catalog measured on 2026-08-10 holds **120 works and 4 copies**. Requiring a
-- copy row before an accessory could be recorded would mean the feature fired on
-- four books.
--
-- This is not a new shape: `copy.edition_id` is nullable for the identical reason
-- (migration 0001) — "a copy can exist before its exact printing is known". Here,
-- an accessory can exist before anybody has recorded which copy it arrived with.
-- `work_id` is denormalised alongside it exactly as `copy.work_id` is, so the
-- book page's read is one indexed lookup and the cascade delete is unambiguous.
--
-- ⚠️ **The write path must check that `copy_id`, when set, belongs to `work_id`.**
-- SQLite cannot express that as a CHECK (no subqueries), so it lives in
-- `addAccessory`/`updateAccessory` in `packages/db/src/accessories.ts`. If a
-- second writer ever appears, it needs the same check.
--
-- ## ⚠️ NOT counted on the collection page
--
-- The owner asked for this explicitly. Nothing in `packages/db/src/works.ts`,
-- `collectionStats` or `/api/collection` may learn about this table. An accessory
-- count in the grid would turn a shelf of books into an inventory of merch.

CREATE TABLE book_accessory (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Which book's page this appears on. Denormalised beside copy_id on purpose;
  -- see the header.
  work_id     INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,

  -- Which copy it actually arrived with, when that is known. NULL means "we have
  -- this, nobody has said which copy it belongs to" — the ordinary state of a
  -- catalog with four copies in it.
  copy_id     INTEGER REFERENCES copy(id) ON DELETE SET NULL,

  -- What it is, in the owner's words: "Carl plush", "Princess Donut enamel pin",
  -- "sprayed-edge dust jacket". This is the truth; `kind` is only the bucket it
  -- sorts into.
  name        TEXT    NOT NULL,

  -- A short closed list, with `other` as the deliberate escape hatch.
  --
  -- ⚠️ It is closed so the panel can group and the audit can count, and it has an
  -- `other` because a list of merch cannot be complete. A row that cannot be
  -- filed is a row the import drops; `other` plus a real `name` is never wrong.
  -- Adding a value later is one more additive migration.
  --
  -- ⚠️ `standee`, `model`, `dust_jacket` and `slipcase` are here because the
  -- purchase scan found them, not because a taxonomy suggested them. **The
  -- Primal Hunter box set is one book product and roughly twenty-three
  -- accessories** — pins, standees, plushies, bookmarks and a slipcase. On a
  -- pledge like that the accessories *are* the pledge, and a bucket they all
  -- fall into as `other` would make the panel useless at exactly the moment it
  -- matters most.
  kind        TEXT    NOT NULL DEFAULT 'other'
                      CHECK (kind IN ('plush', 'pin', 'art_print', 'bookmark',
                                      'sticker', 'poster', 'map', 'card', 'dice',
                                      'coin', 'patch', 'apparel', 'bag', 'sleeve',
                                      'slipcase', 'dust_jacket', 'standee', 'model',
                                      'signed_plate', 'audio', 'other')),

  -- ⚠️ Physical or not, and it is a column rather than a `kind` value.
  --
  -- Crowdfunding tiers routinely deliver a wallpaper pack, a soundtrack or a PDF
  -- art book beside the plushie. Those are real rewards and belong on the book,
  -- but they are not objects on a shelf — "how many things are in this box" and
  -- "what is this thing" are two questions, and folding a `digital` value into
  -- `kind` would make it impossible to say "digital art print".
  --
  -- This is the same axis the owner warned about for books: *"Kickstarter stuff
  -- generally has a mix of physical and digital … make sure when youre auditing
  -- you're really looking close."*
  --
  -- ⚠️ Measured: the scan found an **STL file** and a **concept-art PDF** among
  -- the rewards. Assuming an accessory is a physical object is wrong on real
  -- data, not just in principle.
  is_digital  INTEGER NOT NULL DEFAULT 0 CHECK (is_digital IN (0, 1)),

  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),

  -- Where it physically is. Free text, matching `copy.location` — the space of
  -- shelves is open and an enum would be rewritten every time furniture moved.
  location    TEXT,

  -- ⚠️ Which pledge delivered it, when one did. NULLABLE, and the null case is
  -- the ordinary one: a preorder bonus bookmark came with a book, not a campaign.
  -- The owner's sentence covers both — "came with a kickstarter **or a book**".
  --
  -- This is the ONLY link between an accessory and a pledge. `pledge_item`
  -- deliberately has no `accessory_id`: two paths to one fact is how the two
  -- author-splitters in two languages happened (migration 0001, `work.authors`).
  pledge_id   INTEGER REFERENCES crowdfunding_pledge(id) ON DELETE SET NULL,

  notes       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The book page's read: everything that came with one book.
CREATE INDEX idx_book_accessory_work   ON book_accessory(work_id);
CREATE INDEX idx_book_accessory_copy   ON book_accessory(copy_id);
CREATE INDEX idx_book_accessory_pledge ON book_accessory(pledge_id);
