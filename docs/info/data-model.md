# Data Model — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-23** — the `copy` section was re-measured that day
> against a local D1 with every migration through 0400 applied. ⚠️ **The rest
> of this page still carries its 2026-08-09 verification** (`0001_init.sql`
> applied cleanly, 39 statements, every table exercised through the API) and
> was NOT re-checked; the counts in it predate `edition.collects` and have
> moved. The migrations' own comments carry the full reasoning; this is the map.
>
> `edition.collects` added **2026-08-11** (migration 0060, applied to a local D1
> and read back through the API). Counts elsewhere on this page predate that and
> have moved.
>
> `copy.person_user_id` / `copy.person_name` added **2026-08-23** (migration
> 0400, applied to a local D1 and exercised through the API — writes, both
> refusals, and the live display-name join). ⚠️ Nothing on either live instance
> was measured that day; the migration has NOT been applied to production.

```
work        title · authors · series · series_index · work_key
  └─ edition    isbn13? · asin? · format · publisher · year · pages
       └─ copy      condition · location · acquired · person · signed

work_alias  the other titles one book answers to
user_book   read_state · dates · notes · rating_cached (a mirror)
scan_job    the queue: store the decision, compute the fact
lookup_cache / research_run / research_finding
```

## The three rules the schema enforces

1. **Catalog is separate from collection.** Open Library may overwrite `work`
   and `edition`; it must never touch `copy`. Your shelf location survives every
   re-sync. (Inherited from the Board Game Catalog's `DESIGN.md` §2.1.)
2. **ISBN belongs on `edition`, never on `work`.** One work has many ISBNs —
   hardcover, paperback, book-club, reissue. Putting the identifier on the work
   is how a reissue becomes a second book you appear not to own.
3. **Ratings are not in this database.** They live in Firestore beside the
   audiobook reviews. See `identity-and-reviews.md`.

## Table by table

### `work` — the thing an author wrote

| Column | Note |
|---|---|
| `title`, `subtitle`, `sort_title` | `sort_title` is article-stripped so "The Hobbit" sorts under H |
| `authors` | **As printed, in the order printed. Not split into rows.** |
| `primary_author` | first name out of `splitAuthors`, folded |
| `work_key` | ⚠️ **the bridge.** `normaliseTitle(title)\|normaliseTitle(primaryAuthor)` |
| `series`, `series_index_sort`, `series_index_display` | reused verbatim from `audiobook_catalog` |
| `openlibrary_work_id` | nullable; lets the join harden to an identifier later |

**Why `authors` is one string.** `audiobook_catalog` splits author fields in
four places and two of them disagree — its own docs record that keeping them in
sync was a real, silent bug. A fifth implementation, in a third language, is how
that returns, and here it would be worse: the author is half of `work_key`, so a
disagreement produces a review that silently fails to appear rather than a
cosmetic difference. `splitAuthors` in `packages/core` is the one implementation
and this column is its input.

**Why `work_key` is not UNIQUE.** Two genuinely different works can fold to one
key — a reissue under a pen name, a translation. A duplicate row is visible and
fixable; a refused write is a mystery.

**There is no tree.** The Board Game Catalog's `parent_item_id` / `root_game_id`
has no analogue: books do not have expansions. What games expressed as a tree,
books express as `series` + `series_index_sort`. That project's migration 0019
reached the same conclusion after measuring that tree-matching search returns an
entire product line for every hit — right at 26 rows, wrong at 147. A book series
is 15 volumes, so books start where that project ended up.

### `work_alias` — the retitling problem

Ported from `item_alias` (board game migration 0021), and the case it was built
for is **more** common in books: UK and US editions are routinely retitled.
"Northern Lights" and "The Golden Compass" are one book.

No similarity threshold can connect those two strings, because there is nothing
in them to connect. It is a fact about the world, so it is recorded rather than
computed. `buildWorkIndex` drops an alias that collides with a real title, and
drops one claimed by two works — both silently, because guessing merges two
different books.

### `edition` — the printing, and every identifier

| Column | Note |
|---|---|
| `isbn13` | UNIQUE. Digits only, 978/979, checksum valid. ISBN-10s converted at the edge |
| `asin` | UNIQUE. ⚠️ **not an ISBN.** For Kindle-native titles it is the only identifier that exists |
| `format` | `hardcover \| paperback \| mass_market \| ebook_epub \| ebook_kindle \| ebook_pdf` |
| `edition_name` | Free text, exactly as the vendor wrote it. Never rewritten; it is what the UI prints |
| `edition_kind` | `collectors` or NULL. ⚠️ **NULL means an ORDINARY printing, not "unclassified"** (migration 0050) |
| `source` | `manual` outranks everything and is never overwritten automatically |

**`edition_name` and `edition_kind` are a pair, and the split is the design.**
The name is *what the vendor called it* — "Illumicrate Exclusive", "Year of
Sanderson premium hardcover", "B&N Exclusive Edition" — and 13 distinct spellings
were in production on 2026-08-11, which made *"show me the fancy ones"* thirteen
`LIKE` patterns. The kind is *what it is*, and everything that filters or counts
reads it. Normalising the name itself was rejected: it is the only record of
which shop a book came out of.

⚠️ **NULL in `edition_kind` means ordinary, breaking the NULL rule that
`gap_verdict`, `decided_how` and `cover_status` share.** Those three record
whether somebody *looked*; this records what a book *is*, and the default state
of a book is ordinary — 220 editions carry no name at all. The price is that an
unrecognised special edition is filed as ordinary silently, and the payment is
the collection's **Printing → "Named, not sorted"** filter: a special printing is
always *named*, so `edition_name IS NOT NULL AND edition_kind IS NULL` is exactly
the set that could be wrong. Keep that control; it is what makes the NULL rule
honest rather than merely convenient.

`classifyEdition` in `packages/core/src/crowdfunding.ts` is the one rule that
assigns it, and the importers call it. It refuses anything describing a book's
**contents** rather than its printing — an omnibus and a "Volume 1" are ordinary
trade printings.

**`collects` (migration 0060) is where those two went.** A third axis, and the
one 0050 promised: `edition_name` is what the *shop* called the printing,
`edition_kind` is whether it is a special one, and `collects` is **what is
printed inside the object** — "Volumes 1-3". Free text on purpose; this house
holds bind-ups of unnumbered novellas and one leatherbound *edition* delivered as
two physical volumes. NULL means the ordinary case (the whole work), which is 227
of 229 rows.

⚠️ It is **not** a substitute for `work_relation.contains`. This says what is in
the object; that says which catalog *rows* are inside which, and only that one
can be linked to or read by the scanner's overlap warning. *White Sand* has
`collects` filled and **no** relation row, because its three volumes are not rows
— and inventing them would mean guessing three titles.

**`format` is the point of the whole table.** It is what makes *"I own this in
audio and paperback but not ebook"* a query rather than a feature. Audiobooks are
deliberately **not** a format here — they live in `audiobook_catalog`, are
pipeline-fed three times a day, and are read-only to this app. The two meet
through `work_key`, not by merging. (`PLATFORM.md` §2.2.)

**`isbn13` is UNIQUE where the board game catalog's `barcode` was not.** An
ISBN-13 identifies one printing by definition, so two rows carrying one is a bug
worth refusing at the database rather than discovering as a duplicate on a shelf
list.

**Self-healing.** Every successful scan writes `isbn13` back, so the collection
gradually becomes its own barcode database and re-scanning a book you own costs
no network call.

### `copy` — the object on the shelf

Nothing outside this house knows any of it, so nothing outside overwrites any of
it. `location` is free text on purpose: the space of shelves is open and an enum
would be rewritten every time furniture moved. `is_signed` and `edition_notes`
exist for the limited-edition minority the research pipeline is for.

#### WHO has it — `person_user_id` + `person_name` (migration 0400)

| Column | Note |
|---|---|
| `person_user_id` | Nullable FK to `app_user(id)`, `ON DELETE SET NULL`. NULL is the ordinary case: most people you lend a book to have never signed in here |
| `person_name` | The name **as typed**, always. ⚠️ **Kept even when the id is set** |
| `lent_to` | ⚠️ **DEPRECATED** (0400). Backfilled into `person_name`, left standing one release, dropped by a later migration. Nothing writes it |

**Why two columns and not a nullable FK.** They answer different questions: the
id is *which account*, the text is *what was written down*. A design that could
only record a member would refuse the ordinary lend; a design that only stored
text could never follow somebody's account. Same shape of argument as
`edition_name` / `edition_kind` above — and, as there, the pair is the design
rather than a duplicate fact wearing two hats.

**A linked card is a LIVE JOIN, not a snapshot** (the owner's decision,
2026-08-23). When `person_user_id` is set the API resolves it to that member's
*current* `display_name` on every read, so a rename propagates everywhere.
`person_name` is then the fallback that survives an unlink, a deleted account,
or a member whose Google account never supplied a display name.

**Only `lent`, `borrowed` and `sold` may carry a person**, and that is enforced
in `packages/db/src/editions.ts`, not by a CHECK. ⚠️ The rule is about a
**transition** — you may not newly attach a person to a copy that is merely
`owned` — and a row-level constraint cannot tell that apart from a copy coming
home from a lend and *keeping* the record of who had it. Both refusals (a person
on the wrong status; an id naming nobody) answer in words, never a bare status.

**Visibility is redacted server-side, in one place**
(`apps/worker/src/lib/copy-person.ts`): both fields reach a caller only if that
caller holds `editCatalog` or IS the linked person. ⚠️ The **status word is not
redacted** — hiding it would make a lent book read as missing from the shelf.

⚠️ **`sold` keeps its row forever.** Person and date stay; the collection view
hides a work whose copies are *all* sold, and the Copies filter's **Sold**
option is the way back. Nothing is deleted — see `NOT_ONLY_SOLD` in
`packages/db/src/works.ts` for what it does and does not hide.

### `user_book` — read-state, and a mirror

**No `rating` column.** `rating_cached` is a read-model: the Firestore value
copied in so the collection page can sort 800 rows without 800 network calls.
Nothing may read it and write it back. `setReadState` and `cacheRating` are
separate functions over the same row so that merging them cannot happen by
accident.

`read_state` includes `reference`, which is not a synonym for unread: a cookbook
or a rulebook is *used*, never finished, and filing it as unread makes every
"what haven't I read" list wrong forever.

`read_format` lets the UI say "read (audiobook)" against a paperback, rather than
implying the paperback is the one that got read.

### `scan_job` — store the decision, compute the fact

Ported wholesale, and it matters **more** here than in the source project: every
scan reconciles against the physical shelf, the ebook files and 1,073
audiobooks. A scan is a queued job with a review step, never a direct write —
which is the only defence against a wrong ISBN returning a confident wrong book.

`mode` includes `isbn`, which has no image, never calls vision and costs nothing.
Recording it as a photo job would make the queue lie about where its titles came
from.

**Photos are never stored.** ⚠️ Since migration 0040 that sentence needs its
scope said out loud: **no scan photograph is ever stored, and no bucket for one
may exist.** A *covers* bucket is a different object with the opposite lifetime
(read on every page load, forever) and is a separate, permitted decision — see
`docs/access/cloudflare.md` §7 and §7.1. Nothing in the scan path writes an
object either way.

### `lookup_cache`, `research_run`, `research_finding`

Ported. The cache stores whole-response JSON rather than columns, because what a
rung returns changes as rungs are added and a cache needing a migration every
time is worse than no cache.

⚠️ `research_run` carries `input_*` columns and `unfilled` for the same reason
board game migration 0020 added them: "ask once" and "ask always" are both wrong,
because the *inputs* move. A 2027 pre-order asked in 2026 has nothing to find.

⚠️ **Gate before pipeline.** The sibling project's `cost-reduction.md` records
$8.30 spent putting 616 rows in front of a web-search model because the question
asked was "what does this row not know" rather than "what is worth buying for
this row". See `isbn-ladder.md` §4.2 for why that gate is *harder* here than the
design assumed — half this library has no free metadata at all.

## What was deliberately dropped from the board game schema

| Dropped | Why |
|---|---|
| `sleeve_requirement` | board-game-only |
| `is_sleeved`, `is_punched`, completeness | board-game-only |
| `item_relation` (works_with, reimplements…) | books relate through `series` and `work_alias` |
| `play` | you do not log plays of a book; `user_book` logs the read |
| `parent_item_id` / `root_game_id` | no expansions — see `work` above |
