# The free details ladder — how "Look up" stopped paying for what we already know

> **Audience:** Claude/Kiro sessions first, the owner second.
> **Status:** TRACKED. Built on `feature/free-details-ladder`, 2026-08-23.
> **Last verified:** **2026-08-23** — the rung order, the parse rules and the
> Elantris walkthrough below were **measured** that day against a real local D1
> (Miniflare, all 35 migrations applied) and the **live** Open Library API.
> ⚠️ **Not verified:** rung 2 (no credential exists — §4), the Google Books rung
> end-to-end (§6), and the whole thing through the deployed HTTP route (§6).
>
> **Amended 2026-08-25** — two rungs were added after the measurement above and
> §2 now lists them: **Hardcover** (rung 5) and **Wikidata** (rung 6). ⚠️ Only
> §2 and §6's NOT-verified table were updated; **the walkthrough and the
> measured numbers in §6 are still the 2026-08-23 four-rung run** and were not
> re-measured.

**Read this before** touching `apps/worker/src/lib/free-details.ts`, adding a
rung, changing what `POST /api/research/works/:id/run` costs, or wondering why a
book's series says it came from "the audiobook catalogue".

---

## 1. The defect it fixes, in the owner's words

> *"we have a problem with Elantris. item 514 in the library didnt pull from the
> audiobook catalog even though we own 2 audio editions, and it didnt pull
> information from the other catalog when i hit look up. so first link them all
> together, then in missing details make sure when the look up button is hit, it
> does the free checks first, we have a pipeline use it"* — 2026-08-22

Two separate failures, and both are now closed:

| | Was | Is |
|---|---|---|
| **"Look up"** | straight to the paid model — **no free rung anywhere on the path** | four free rungs first; the model is asked only what is left, and is not called at all when nothing is left |
| **The add path** | stored title, authors, publisher, year, cover — series, volume and description **never asked for**, so every scanned book landed incomplete | the free ladder runs after the work is created, in the background |

---

## 2. The rungs, in order

| # | Rung | Can answer | Cost | Where |
|---|---|---|---|---|
| 1 | `audiobook_holding` | series, volume | one D1 read | our own database |
| 2 | the estate index — `/api/lookup` | series, volume | one fetch | ⚠️ **DARK — §4** |
| 3 | Open Library `/works/<key>/editions.json` | series, volume, description | ~1 req/s | live |
| 4 | Google Books by ISBN | description, series *hints* | one keyed fetch | live |
| 5 | Hardcover.app GraphQL by ISBN | description, series, volume | one keyed fetch, 5,000/day | live — **added 2026-08-25** |
| 6 | Wikidata SPARQL by ISBN | series, volume | one keyless fetch | live — **added 2026-08-25** |
| 7 | the paid model | everything left | **money** | `research-run.ts` |

⚠️ **Rungs 5 and 6 were added after this doc's 2026-08-23 measurement and are
covered by mocked-fetch tests only** — see the NOT-verified table in §6.

**Why Hardcover sits in front of Wikidata.** Both answer a STRUCTURED series
(neither parses one out of a title, so `readSeriesLabel` is not applied to
either). Wikidata has the cleaner provenance but a notability bar that the
indie / LitRPG / webnovel end of this catalogue does not clear; Hardcover's
contributors skew that way, and it returns the blurb in the same request. So
Hardcover gets first crack and Wikidata is the fallback behind it.

**Neither writes `series_index_display`.** Wikidata's `P1545` and Hardcover's
`book_series.position` are both NUMBERS, not designations a publisher printed —
§5.2's rule, unchanged.

**Rung 5 is keyed like rung 4, and its absence is a NAMED skip.**
`HARDCOVER_API_TOKEN` is set on the main instance and **not** on the friend
instance, which reports `Hardcover: not asked — no HARDCOVER_API_TOKEN` rather
than looking like a rung that was asked and knew nothing.

**Rung 2 cannot answer `description`** and never will: the index is an identity
index, not a metadata store, and the projection this catalog pushes it
(`packages/db/src/index-projection.ts`) carries no such column.

**Rung 4's series is a HINT.** Google's title arrives with the subtitle joined
on — *"He Who Fights with Monsters 10: A LitRPG Adventure"* — which is a shape
`detectSeriesFromTitle` is measured against, so it is read with `declared:
false` and an unparsed title yields nothing at all.

---

## 3. The three rules that are not negotiable

### 3.1 Stop PER FIELD, never per rung

A rung that answers `series` does **not** end the pass while `description` is
still open — rung 1 has no blurbs and rung 4 does. Every rung is asked only
about what is still outstanding, which is also what keeps the subrequest budget
honest: a fully-answered book costs one D1 read and stops.

### 3.2 ⚠️ A PRESENT ROW WITH A NULL COLUMN IS NOT AN ANSWER

**This is the Elantris bug in one sentence, and it is the rule most likely to be
undone by a well-meaning refactor.**

`audiobook_holding.work_id` is a `PRIMARY KEY` (migration 0010), so the table
holds **one** audio edition per work. The household owns **two** *Elantris*
audiobooks — the full-cast one and the Tenth Anniversary Special Edition — and
the row that landed is the first, whose `series` is `NULL`.

So: **row present + column null ⇒ fall through to the next rung, and say why.**
A ladder that reads "row found" as "rung answered" reports nothing, for ever,
about a book the estate demonstrably knows.

The fall-through is **named** in the result, not silent. A rung that could not
be *asked* and a rung that was asked and knew nothing are different facts, and
printing them identically is a mistake this project has already paid for once —
see `covers-and-series.md` §0, where a dead cover rung read as *"no cover
anywhere"*.

### 3.3 Never `work.title`, never `work.authors`

`updateWork` re-derives `work_key` from those two, and the key joins ~860
audiobook reviews. The patch this ladder builds names four columns and cannot
name a fifth.

---

## 4. 🔴 Rung 2 is BUILT DARK — the gap, by name

**The rung is implemented and it has never run.** It is gated on an env var
that is unset in every environment:

| The thing | The name |
|---|---|
| The var this Worker reads | **`INDEX_READ_TOKEN`** (`apps/worker/src/env.ts`) |
| Where a mount that accepts it would go | **`catalog-platform/apps/index-worker/src/index.ts`** |
| The write direction, which already works | `INDEX_PUSH_TOKEN` — ⚠️ **a different credential; never point one at the other** |

**Why it is not simply switched on.** `index.heygabi.ai/api/lookup` sits behind
a blanket **human Firebase-token** check, and no machine-read credential exists
anywhere in the estate. Minting one and mounting it is an
**access-INCREASING** change in another repo — it opens a read path to every
catalogue's rows for whoever holds the value — and the estate's standing rule is
that access-increasing changes are **confirmed by the owner**, never acted on.

**So this is an owner decision, and it is the only thing standing between this
ladder and its best rung.** Until it is taken:

- unset means the rung is **skipped with a named reason that travels in the
  response** — a person reading the queue can see the rung exists and why it did
  not fire;
- ⚠️ **nothing guesses a value**, and a test pins that the host is not dialled
  at all when the token is absent;
- ⚠️ **the request shape is a GUESS.** It is modelled on the projection this
  catalog pushes (`title`, `creator`, `series`, `series_index`) and parses the
  response defensively from `unknown`, because the contract is genuinely unknown
  rather than merely unread. **The first person to set that token should expect
  to adjust the parse**, and should re-verify this section afterwards.

---

## 5. Reading a series label — the parses, and why only two of them

**Series and volume are parsed ONLY through `detectSeriesFromTitle` and
`parseVolumeNumber` in `@lc/core`'s `titles.ts`.** That is not tidiness:
`audiobook_catalog` split author strings four different ways and its own docs
record keeping them in sync as a real, silent bug. A fifth parse of a volume
number here would be the same mistake in a new place.

`readSeriesLabel(raw, declared)` is where it happens, and `declared` is what
makes one function safe to point at two very different strings:

| `declared` | Used for | An unparsed label is… |
|---|---|---|
| `true` | a field the source SAYS is a series — `entries[].series`, `audiobook_holding.series` | **taken whole** as the series name |
| `false` | a field that merely MIGHT contain one — an edition's `subtitle`, a Google Books title | **thrown away** |

⚠️ **The `false` case is the important one.** Most subtitles are subtitles;
reading *"A Novel"* as a series name would file the book on a shelf that does
not exist. Only an explicit volume shape — *"Cradle, Volume Five"* — is
believed.

### 5.1 ⚠️ `series: ["Elantris (1)"]` — the shape that got through

**MEASURED 2026-08-23 against the live API.** `editions.json` numbers a series
with a **bare number in brackets** and no marker word anywhere:

```
GET /works/OL…W/editions.json  →  entries[].series = ["Elantris (1)"]
```

`detectSeriesFromTitle` refuses that on purpose — *a bare trailing number is
never a volume*, or *"Summoner 6"* becomes six copies of one book — so the whole
string was taken as the NAME, and the first exercise run produced:

```
work 514:  series = 'Elantris (1)',  series_index_sort = NULL
```

A series of one, sitting next to the real one. Plausible, wrong, and exactly the
class of data this catalog exists to refuse.

`Name (N)` and `Name #N` are now read: **the number still goes through
`parseVolumeNumber` and nothing else**, and the name is whatever precedes it —
a split rather than a parse, the same distinction `splitSeriesPrefix` draws.
⚠️ **It fires only when `parseVolumeNumber` returns a position**, so
*"Discworld (UK)"* keeps its name whole. That guard is what makes it safe, and
it has a test.

### 5.2 The printed form is written only when a source QUOTED one

Owner rule 2026-08-19 (`volume-numbers.md` is the permanent answer): the sort
value closes the gap; `series_index_display` is **optional data**, present only
where a printing physically carries a designation, and **never derived**.

Two near-identical functions guard that, in `apps/worker/src/lib/detail-values.ts`,
and ⚠️ **they are NOT interchangeable:**

| | Used by | Reads the number with | Keeps `"Volume Five"` |
|---|---|---|---|
| `printedFormIn` | the paid findings path | `asIndex` — digits only | no |
| `quotedDesignation` | the free rungs | `parseVolumeNumber` — digits, **words**, **Roman** | yes |

Three spellings are all in this household's own library — *"Book 10"*, *"Book
One"*, and *"Volume XI"*, which is how *Rise of the Weakest Summoner* is printed
— and Hidden Gnome files *"Cradle, Volume Five"* in the subtitle on more
editions than it uses the `series` field at all. Demanding a digit in the free
path would throw the designation away on exactly the books that carry one.

Both agree on the one rule that matters: **a bare number is not a printed
form.**

---

## 6. What is measured, and what is NOT

### Measured 2026-08-23 — a real D1, the real Open Library

Miniflare's D1 (the same SQLite `wrangler dev --local` uses) with all **35
migrations applied**, seeded with work 514 *Elantris*: an `audiobook_holding`
row whose `series` is **NULL**, and an edition carrying a real ISBN.

```
=== work 514 ===
sources:  { series: 'openlibrary', seriesIndex: 'openlibrary',
            description: 'openlibrary' }
applied:  Series set to Elantris — from Open Library.
          Volume number set to 1 — from Open Library.
          Description saved — from Open Library.
skipped:  the audiobook catalogue: an audio edition is linked but its series is
            blank … so the next rung was asked
          the estate index: not asked — INDEX_READ_TOKEN is unset …
stillOpen: []
work row now: series 'Elantris', series_index_sort 1, description 'Elantris:
              gigantic, beautiful, radiant-----filled with powerful …'
```

`stillOpen: []` is the whole feature: through the research route that book now
makes **no paid call at all**.

⚠️ **It took 17 seconds**, most of it Open Library latency plus the ~1/s pace
`packages/isbn/src/throttle.ts` sets and which is not negotiable. That is
comfortable inside the research route's awaited invocation, and **less
comfortable inside the scan path's ~30s `waitUntil`**. The failure mode if it
is ever cut short is the pre-existing one — the columns stay blank and the book
appears on the details queue — so it degrades rather than breaking. Worth
re-measuring if the scan path ever looks like it is dropping fills.

### ⚠️ NOT verified

| What | Why not |
|---|---|
| **Rung 2, at all** | No credential exists — §4. Every line below its config check is unexercised against the real index. |
| **Rung 4 end to end** | The exercise run got **`googlebooks 400`** from the live API with the key in `.dev.vars`. Not diagnosed, and **not** touched by this work — `lookupGoogleBooksByIsbn` is unchanged. The rung is covered by tests with a stubbed fetch; its live behaviour is an open question. ⚠️ Do not read the passing tests as evidence the live rung works. |
| **Rung 5 (Hardcover) live** | Added 2026-08-25. The request shape was confirmed field-by-field against the vendor's published SDL (`hardcoverapp/hardcover-docs@main/schema.graphql`), but **no call has ever been made with the real token** — every test mocks `fetch`. The friend instance has no token at all and skips by name. |
| **Rung 6 (Wikidata) live** | Added 2026-08-25. The SPARQL was verified by hand at `query.wikidata.org` (Way of Kings → Stormlight #1); the rung as wired into the ladder has only mocked-fetch coverage. |
| **The deployed HTTP route** | Nothing was deployed and `POST /works/:id/run` needs an owner sign-in. The ladder was driven directly against D1 instead. |
| **The scan path in a browser** | The `waitUntil` hook is wired and typechecked; nobody has scanned a real barcode through it. |
| **Whether a run's `sources` renders correctly on the queue page** | The component is written and typechecks; the page has not been opened. |

---

## 7. What the ladder does NOT answer, and why

**`firstPublished`.** Every free rung here can produce *a* year and none can
produce the right one: Open Library's editions and Google Books both date a
**printing**, while `work.first_published` is a fact about the work's first
appearance. `gaps.ts` already refuses edition years for exactly this reason —
*"facts about a printing, attached to a row that is a file"*. Filling it from a
printing would be a wrong number that sorts, filters, and looks exactly like
data.

The refusal is **reported, not silent**, and it costs little: measured
2026-08-22, the main catalogue had **30** works with no year against **138** with
no series and **51** with no description.

**Covers.** Not on this queue at all, and unchanged by this work — a cover is
fetched, never reasoned. See `REFUSED_FIELDS` in `packages/core/src/gaps.ts`.

---

## 8. Known limits

- ⚠️ **A free-rung write is NOT in `GET /api/research/auto-applied` and cannot
  be undone by `POST /undo`.** Those operate on `research_finding` rows, and the
  free rungs write through `updateWork` directly. The bargain the auto-apply
  design struck — *"see a batch afterwards and throw it away wholesale"* — is
  therefore only half true for a free answer today. It is recoverable by hand
  (the fields are editable in place on the book page) and it is a real gap. If
  it starts to bite, the fix is for the free rungs to save findings against the
  run that called them — which the research path can do and the scan path
  cannot, because it has no run.
- **`research_run.unfilled` is still stamped before the ladder runs**, so it
  records what the lookup was *claimed for*, not what the model was *asked*. The
  honest record of who answered what is `result_json.sources`.
- **The audiobook rung carries the OTHER catalogue's spelling** of a series
  ("All the Skills" there, "All The Skills" here). That is deliberate at the
  source (migration 0010 stores both catalogues' spellings rather than
  flattening them), and it means a series name filled from rung 1 may not match
  this catalogue's existing casing.

---

## 9. The file map

| File | What |
|---|---|
| `apps/worker/src/lib/free-details.ts` | the ladder |
| `apps/worker/src/lib/free-details.test.ts` | 32 tests — the fall-through, the per-field stop, attribution, both refusals, the dark rung, and "no paid call" |
| `apps/worker/src/lib/detail-values.ts` | `printedFormIn` / `quotedDesignation` — §5.2 |
| `apps/worker/src/lib/research-run.ts` | the wiring: free first, then only what is left |
| `apps/worker/src/routes/scan-jobs.ts` | the add path, on `waitUntil` |
| `apps/web/src/pages/DetailsQueuePage.tsx` | the "answered by:" line |
| `packages/isbn/src/works.ts` | `workDescription` — the OL work record's blurb |
| `apps/worker/src/env.ts` | `INDEX_READ_TOKEN`, and the gap it names |
