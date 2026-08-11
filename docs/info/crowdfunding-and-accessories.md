# Crowdfunding provenance and accessories — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-10**.
>
> Built on `feature/crowdfunding-accessories`. Migrations **0010** and **0011**
> are written but **NOT applied to `--remote`**, and nothing is deployed. The
> owner gates production.

Two features, asked for in one sentence:

> *"now is a good time to scan Kickstarter, indiegogo, and Backerskit for books.
> Same as in game catalog there are 2 backerskit accounts and we'll need to scan
> both. We can add a section for accessories for stuff that came with a
> kickstarter or a book but we don't need ti publish that count on the main page,
> just keep it each book. Some books have plushies or pins. Make sure they can all
> be editted, deleted, and more accessories can be added. … Kickstarter stuff
> generally has a mix of physical and digital books so make sure when youre
> auditing you're really looking close."* — the owner, 2026-08-10

---

## 1. The five things worth knowing without reading the rest

1. **⚠️ One pledge delivers one novel two or three times, and that is the whole
   design.** Ebook + print + audiobook together is measured, not hypothetical
   (Space Knight 5 and 6, Tamer Bk 11, Fires of December). `pledge_item` is one
   row per *reward line*, so those are three rows against **one** `work`. Every
   count is taken twice — `lines` and `works` — and they are meant to differ.
2. **⚠️ Accessories are never counted on the collection page**, and the API has
   no route that would make it possible. This is a requirement, not a default.
3. **⚠️ An accessory belongs to the COPY**, and the measured case that proves it
   is a V1 dust jacket delivered by a *later* campaign for a book bought in an
   *earlier* one. `copy_id` and `pledge_id` are separate nullable columns because
   of exactly that row.
4. **⚠️ Barnes & Noble is not crowdfunding and must never be added to the
   platform enum.** A shop purchase already has `copy.vendor`,
   `copy.acquired_on`, `copy.price_paid_cents`. The test is whether the money
   bought a **promise** or a **product**.
5. **⚠️ Signed/numbered is prose, not a field.** *"Book 1 will be Signed &
   Numbered"*, *"CONQUEROR -- SIGNED PAPERBACK+"*, *"Legendary Book Box (Uniquely
   Numbered)"*. `rewardFlags()` reads it and the importer prints a **prompt**;
   `copy.is_signed` and `edition.edition_name` are where the answer goes, and a
   person puts it there.

---

## 2. The tables

Migration **0010** — `crowdfunding_campaign`, `crowdfunding_pledge`,
`pledge_item`. Migration **0011** — `book_accessory`.

| Table | Grain | Whose fact |
|---|---|---|
| `crowdfunding_campaign` | one campaign that ran | the **world's** |
| `crowdfunding_pledge` | one campaign × one of **our** accounts | **ours** — tier, date, amount |
| `pledge_item` | one **book** a pledge delivered | ours — and the row that must not collapse |
| `book_accessory` | one non-book thing that came with a book | ours |

The split follows migration 0001 §1 (*catalog is separate from collection*). It
is not tidiness: **two BackerKit accounts can back the same campaign**, which is
one campaign row and two pledge rows, and a merged table could not say so.

### 2.1 Why three tables and not one `source_url`

The sibling Board Game Catalog models crowdfunding as a single
`item.source_url` (its migration 0012) and that was the right answer there.
Books need more for one reason: **a board game pledge delivers a box, and a book
pledge delivers a physical edition and a digital edition of the same title**.
One URL cannot express "we got both, and only one of them is on a shelf".

### 2.2 The indexes that carry the meaning

```sql
-- Re-scan guard: one campaign, one platform, one login = one pledge.
UNIQUE (campaign_id, platform, account)                       -- crowdfunding_pledge

-- ⚠️ Physical AND digital of one work under one pledge, without duplicates.
CREATE UNIQUE INDEX idx_pledge_item_unique
  ON pledge_item(pledge_id, work_id, IFNULL(edition_id, 0), IFNULL(format_hint, ''));

-- ⚠️ work_id is IN here. A "Collector's Edition Trilogy" line is three rows
--    sharing one external_ref; without work_id, two of the three are refused.
CREATE UNIQUE INDEX idx_pledge_item_external
  ON pledge_item(pledge_id, external_ref, work_id) WHERE external_ref IS NOT NULL;
```

**⚠️ `IFNULL` is load-bearing.** SQLite treats NULL as *distinct from* NULL
inside a UNIQUE index, so a plain `UNIQUE (pledge_id, work_id, edition_id)` would
let a re-import insert the same unmatched line on every run, forever, with no
error at all.

**⚠️ An upsert against a PARTIAL index must repeat the predicate.** Measured
2026-08-10: the first `--commit` run died with *"ON CONFLICT clause does not
match any PRIMARY KEY or UNIQUE constraint"* and wrote nothing. The fix is

```sql
ON CONFLICT (platform, external_id) WHERE external_id IS NOT NULL DO UPDATE …
```

It fails loudly, which is the one good thing about it. `upsertCampaign` in
`packages/db` sidesteps it by selecting first.

### 2.3 `pledge_item.edition_verdict` — why a verdict column exists

An **audiobook** reward line can never be matched to an `edition`.
`EDITION_FORMATS` has no audiobook value and deliberately never will — audio
lives in `audiobook_catalog` and meets this app through `work_key`
(`HANDOFF.md` open question 5 settles it as **No**). Without a verdict that line
sits in the audit's "no printing" queue on every run forever, and **a queue that
cannot empty is a queue nobody reads**.

So `edition_verdict` takes the same two values as `gap_verdict` (migration 0007)
for the same reason, and there is deliberately no `found`: a found printing *is*
`edition_id`.

| Value | Means |
|---|---|
| `'none'` | there is genuinely no edition row for this. An audiobook. |
| `'unknown'` | somebody looked and could not tell. |
| `NULL` | nobody has looked. **This is the only state that is a job.** |

Naming a printing **clears** the verdict — a row holding both would say "there is
no edition" beside an edition id.

---

## 3. The physical/digital ladder

`packages/core/src/crowdfunding.ts`, pinned by 13 tests in `npm test`.

| Rung | Source | Note |
|---|---|---|
| 1 | `edition.format` vs `PHYSICAL_FORMATS` | authoritative, and it **ends the question** |
| 2 | `format_hint` — the campaign's own words | what a fresh scan has and nothing else |
| 3 | the reward `title` | last resort |
| — | `'unknown'` | **a real answer** |

**⚠️ The edition beats the campaign blurb, never the other way round.** Once a
line is resolved the words on the page are *evidence for the match*, not a second
opinion about it.

**⚠️ There is no fourth rung, and there must not be one.** Guessing from the
tier, the amount paid or the delivery date is the reasoning `isbn-ladder.md` §4.4
records going wrong: a wrong answer scored 1.00 on title *and* author, twice.

**⚠️ A line naming both is `'both'`, not whichever word came first.** "Hardcover
+ Ebook Bundle" is one row describing two things and it needs splitting. Silently
resolving it to `physical` is how the ebook goes missing.

### 3.1 What the audit reports, and what to read

```
⚠️ 1 bundled line to split, 2 with no printing — 4 lines across 1 book, 1 physical, 3 digital
```

| Field | Read it as |
|---|---|
| `lines` vs `works` | **equal numbers on a Kickstarter import usually means half the rewards were dropped** |
| `both` | one row, two things. A job. |
| `unknown` | nothing could classify it. Go and look at the campaign page. |
| `unmatched` | matched to a book, not a printing. Expected on a first run. Excludes verdicted lines. |

`docs/HANDOFF.md` records the general version of this twice already —
*"860/860 matched looked perfect"* and the keys were unusable. **Read the lines,
not the totals.**

---

## 4. Accessories

### 4.1 Copy, not work — and the measured case

An accessory hangs off `work_id` (NOT NULL, so the panel always renders and the
cascade is unambiguous) with a **nullable `copy_id`** beside it, exactly as
`copy.work_id` sits beside a nullable `copy.edition_id` in migration 0001.

The honest answer is that it belongs to the copy:

1. **Two backers of one campaign get different piles.** A £40 tier and a £120
   tier deliver the same book and different extras.
2. **You can own a work twice.** A retail paperback and a campaign deluxe are two
   copies, and only one has the pin.
3. **Selling or lending the copy takes the extras with it.**

**⚠️ And the case that settles it:** the scan found *"V2 or V3 Bundle w/ V1
Jacket"* — a dust jacket delivered by a **later** campaign for a book bought in
an **earlier** one. Only separate `copy_id` and `pledge_id` can say that.

`copy_id` is nevertheless nullable because production holds **120 works and 4
copies**; requiring one would make the feature fire on four books.

**⚠️ The `copy_id`-belongs-to-`work_id` check lives in the write path**
(`addAccessory` / `updateAccessory`), because SQLite CHECK constraints cannot
contain a subquery. A second writer needs the same check.

### 4.2 Not on the main page

The owner asked for it in as many words. Enforced in three places, deliberately
redundant:

- `routes/accessories.ts` has **no collection-wide read** — nothing can ask.
- `api.ts` has no `accessoryCount()`.
- `works.ts` (`listCollection`, `collectionStats`) does not import
  `accessories.ts` and must not start.

### 4.3 `is_digital` is a column, not a `kind`

Measured: an **STL file** and a **concept-art PDF** among the rewards. "How many
things are in this box" and "what is this thing" are two questions, and folding a
`digital` value into `kind` would make "digital art print" unsayable.

### 4.4 The kinds, and why these ones

`standee`, `model`, `dust_jacket` and `slipcase` are in `ACCESSORY_KINDS` because
the purchase scan found them. **The Primal Hunter box set is one book product and
roughly twenty-three accessories** — pins, standees, plushies, bookmarks and a
slipcase. On a pledge like that the accessories *are* the pledge, and filing them
all as `other` would make the panel useless exactly when it matters most.

---

## 5. The import file

`npm run import:crowdfunding` reads `scripts/crowdfunding-scan.json` by default
(**gitignored** — it carries pledge amounts and both account addresses). The
tracked, runnable example is `scripts/crowdfunding-example.json`.

```jsonc
{
  "scannedAt": "2026-08-10",
  "campaigns": [
    {
      "platform": "kickstarter",          // kickstarter | backerkit | indiegogo
      "name": "Dungeon Crawler Carl: …",  // required
      "creator": "Matt Dinniman",
      "url": "https://www.kickstarter.com/projects/…",
      "externalId": "example/butchers-masquerade",  // ⚠️ makes a re-scan an upsert
      "launchedOn": "2024-03-01",
      "fundedOn": "2024-03-31",

      "pledges": [
        {
          "platform": "backerkit",        // where OUR pledge lives — may differ
          "account": "…@gmail.com",       // ⚠️ REQUIRED. Two BackerKit logins.
          "tier": "All-In Hardcover",
          "pledgedOn": "2024-03-05",
          "amountCents": 21500,
          "currency": "USD",
          "managerUrl": "https://….backerkit.com/",
          "status": "delivered",          // pledged|delivered|partial|cancelled|refunded

          "books": [
            // ⚠️ ONE NOVEL, THREE LINES. This is the shape to get right.
            { "title": "…", "authors": "…",
              "formatHint": "Deluxe Hardcover", "editionFormat": "hardcover",
              "fulfilled": true, "externalRef": "reward-1-hc" },

            { "title": "…", "authors": "…",
              "formatHint": "EPUB + MOBI", "editionFormat": "ebook_epub",
              "fulfilled": true, "externalRef": "reward-1-ebook" },

            // ⚠️ An audiobook line needs editionVerdict, or it never leaves the queue.
            { "title": "…", "authors": "…",
              "formatHint": "Audiobook download", "editionVerdict": "none",
              "fulfilled": true, "externalRef": "reward-1-audio" }
          ],

          "accessories": [
            { "name": "Princess Donut plush", "kind": "plush", "location": "desk shelf" },
            { "name": "Dragon STL file", "kind": "model", "isDigital": true }
          ]
        }
      ]
    }
  ]
}
```

### 5.1 Field rules that are not obvious

| Field | Rule |
|---|---|
| `books[].workId` / `workKey` / `title`+`authors` | at least one. `workKeyFor` from `@lc/core` does the fold — **never a local one**. |
| `books[].editionFormat` | matched against existing editions. **Never creates one.** |
| `books[].externalRef` | shared by every row of a multi-work line ("Collector's Edition Trilogy" = 3 rows, one ref). |
| `accessories[].title`+`authors` | needed when the pledge has **more than one** book. With exactly one it attaches automatically; with a choice the importer **refuses** rather than guessing. |
| `pledges[].account` | required, non-empty. The whole reconciliation depends on it. |

### 5.2 What the importer will not do

- **Creates no `work`.** A book not in the catalog is reported and skipped.
  `POST /api/works` does not dedupe, and a campaign page's spelling of a title is
  exactly the input that would mint a second row for a book already on the shelf.
- **Creates no `edition`.** "Deluxe Hardcover" is a *claim about a printing*.
  `suggestFormat` prints the proposal, a person creates it in the app (recording
  an owned copy already does), and a re-run then matches it. The propose/accept
  rule the research pipeline obeys.
- **Writes no `copy.is_signed`.** See §1.5.
- **Adds no `crowdfunding` value to `edition.source`.** That CHECK is in
  migration 0001 and SQLite cannot alter a CHECK additively.

### 5.3 Verified 2026-08-10

Against a fresh local D1 with three seeded works, one edition and one copy:

| | |
|---|---|
| dry run | reported `3 lines across 1 book, 1 physical, 2 digital` for the ebook+print+audio pledge |
| `--commit` | 2 campaigns, 3 pledges, 6 reward lines across 3 books, 7 accessories |
| **re-run `--commit`** | **identical counts — idempotent** |
| campaign audit across two BackerKit accounts | `lines: 4, works: 1` — the work counted **once** |
| API | POST / PATCH / DELETE accessory, provenance read, `PUT /items/:id/edition` all driven with curl |
| refusals | copy-of-another-book → 400; unknown kind → 400; double delete → 404 |

---

## 6. The API

| Method + path | Gate | Note |
|---|---|---|
| `GET /api/works/:id/accessories` | `read` | one work only, by design |
| `POST /api/works/:id/accessories` | `editCatalog` | answers with the whole list |
| `PATCH /api/works/:id/accessories/:accessoryId` | `editCatalog` | partial; scoped to the work |
| `DELETE /api/works/:id/accessories/:accessoryId` | `editCatalog` | |
| `GET /api/works/:id/provenance` | `read` | ⚠️ selects **no money** |
| `GET /api/crowdfunding` | `editCatalog` | campaigns + pledges + audits |
| `GET /api/crowdfunding/pledges` | `editCatalog` | flat list for the accessory picker |
| `POST /api/crowdfunding` · `/pledges` · `/pledges/:id/items` | `editCatalog` | all upserts |
| `PUT /api/crowdfunding/items/:id/edition` | `editCatalog` | closes an unmatched line |
| `DELETE /api/crowdfunding/:id` · `/pledges/:id` · `/items/:id` | `editCatalog` | never touches `work`/`edition`/`copy` |

**⚠️ The crowdfunding reads are `editCatalog`, not `read`.** What was paid, when,
and from which of two logins is household financial detail. The work page's
provenance is the exception and carries no amount.

---

## 7. Deliberately left out

- **No `/crowdfunding` screen.** The audit is an API and the importer prints it.
  A screen means a route in `App.tsx` and `router.tsx`, which another branch is
  editing; the reconciliation surface a scan needs is the script's output.
- **No Barnes & Noble path.** §1.4. `copy.vendor` / `copy.acquired_on` /
  `copy.price_paid_cents` already model a shop order and adding a fourth
  "platform" would put retail rows in a table whose every column is meaningless
  for them. A retail importer would be a *different* script writing `copy` rows.
- **No campaign or pledge editing in the UI.** The scan is the source. A form
  that could mint a campaign beside an imported one is how the two get out of
  step. Unlinking a wrong reward line **is** offered, because a scan makes
  mistakes.
- **No accessory images.** There is no upload path in this app and no R2 bucket,
  deliberately (`wrangler.toml`).

---

## 8. To finish it

```bash
npm test                 # 104
npm run typecheck        # six workspaces
npm run db:migrate       # ⚠️ REMOTE — 0010 and 0011, BEFORE deploying
npm run deploy
npm run import:crowdfunding -- --remote                      # dry run — READ THE LINES
npm run import:crowdfunding -- --remote --commit             # ⚠️ owner gates this
```

⚠️ **Migrate before deploying.** `/api/works/:id/provenance` and
`/api/works/:id/accessories` query four tables production does not have;
deploying first makes every book page's two new panels a 500.
