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
>
> **Amended again 2026-08-25 (evening) — 🟢 RUNG 2 IS LIVE.** §4 was *"🔴 built
> dark, and it is the owner's decision"*; the decision was taken, the credential
> was minted on both instances, and the rung now calls the index's **machine**
> route. §4 is rewritten from the gap to the contract, §2's row and §6's
> NOT-verified table follow it, and §8 gains the fan-out cap that the sweep's
> subrequest budget forced. ⚠️ **Two things about that are NOT verified and are
> named in §6:** no `/queue` lookup has been driven end to end showing *"the
> estate index"* as a field's source, and the F9 same-series gate has mocked
> coverage only.

> **Amended 2026-08-26 — §8's 🔴 four-gap stall is FIXED and is now ✅.** The
> stall was **measured live on padhard that day** (work #541, 4 asks, 52 against
> a budget of 46, **90 eligible and 0 picked**); `planSweep` gained rule 4 and
> the sweep now names both the over-budget admission and any tick that plans
> nothing. ⚠️ Only §8's bullet and §9's file map were touched — **no rung was
> repriced and nothing else in this doc was re-measured.**

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
| 2 | the estate index — **`/api/machine/lookup`** | series, volume | 1–3 fetches (§8) | live — **2026-08-25**, §4 |
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
`HARDCOVER_API_TOKEN` is set on **both** instances (2026-08-25). An instance
without it reports `Hardcover: not asked — no HARDCOVER_API_TOKEN` rather than
looking like a rung that was asked and knew nothing.

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

## 4. 🟢 Rung 2 — the contract, as built (LIVE 2026-08-25)

This section was *"🔴 built dark — the gap, by name"* from 2026-08-23 until the
evening of 2026-08-25. The gap it described is closed; what follows is the
contract that replaced it. The history is kept in `DONE.md`, not here.

### 4.1 The request

```
GET {INDEX_URL}/api/machine/lookup?title=<one identity>
Authorization: Bearer {INDEX_READ_TOKEN}
```

| | |
|---|---|
| Host | `INDEX_URL` — `https://index.heygabi.ai` on **both** instances (`[vars]` and `[env.friend.vars]`) |
| Credential | `INDEX_READ_TOKEN`, **per instance** — main's is the index's `INDEX_READ_TOKEN_LIBRARY`, padhard's is its `INDEX_READ_TOKEN_LIBRARY2` |
| Params | **`title` only** |
| Code | `askIndex` in `apps/worker/src/lib/free-details.ts` |

⚠️ **`/api/machine/lookup`, and never `/api/lookup`.** They run the *same*
handler — the index mounts `lookupHandler` twice on purpose so the two surfaces
cannot drift about what a lookup means — behind two different gates. The human
one sits **below** the index's `requireEstateMember()` blanket and wants a
person's Firebase ID token; the machine one is mounted **above** it, by name,
and takes this bearer.

🔴 **This is the bug the rung shipped with, and it is worth keeping.** From
2026-08-23 to 2026-08-25 this instance had `INDEX_URL` set **and**
`INDEX_READ_TOKEN` set — so the rung was not skipped, reported nothing unusual,
and was refused **every single run**, because the URL it built was the human
one. *"The token is set"* was never the same fact as *"the rung works"*, and
nothing on the page could tell them apart. The doc that said the rung was DARK
was also wrong, in the other direction.

⚠️ **No `creator` param, and no author gate.** The old code sent a `creator`;
`lookupHandler` reads `title` and nothing else (`read.ts:57`), so it was a
parameter the server has never looked at — decoration that read like a safety
gate. There is no similarity gate on our side either, and that is the
endpoint's own contract rather than an omission: `/api/lookup` is the
**exact-identity** endpoint (`read.ts:22-23`), joining on the `title_fold` the
write side computed. This rung is not searching the open web (where an
unmatched author is how *Firefight* came back as a different 2001 book) — it is
asking the household's own store whether another of its shelves holds this
exact title.

### 4.2 The response, and what is parsed

`read.ts:79` returns the envelope; `read.ts:39-40` is the column list.

```jsonc
{ "query": "Elantris", "title_fold": "elantris",
  "matches": [ { "source": "audiobook", "title": "Elantris", "creator": "…",
                 "series": "Elantris", "series_index": 1, /* + 13 more columns */ } ] }
```

| Field read | Used for |
|---|---|
| `matches[]` | ⚠️ **an ARRAY** — every format on every shelf whose fold matches |
| `series` | the series name, read `declared: true` (§5) |
| `series_index` | the volume — a **stored** position, so it **wins** over any number parsed out of the label; the label's is the fallback when this is null |
| `source` | context only; nothing branches on it |

⚠️ **The first row that NAMES a series wins — not `matches[0]`.** This is rule
3.2 one level up: the audiobook copy can be present and silent about series
while the library row two positions down carries it. The index's own ordering
(`ORDER BY source, format, title`) is kept rather than re-ranked; a second
ranking would be a second matcher.

⚠️ **No `seriesIndexDisplay` from `series_index`** — it is a number, not a
designation a publisher printed (§5.2). Same rule as Hardcover and Wikidata.

⚠️ **It cannot answer `description`.** The index is an identity index; the
projection this catalog pushes carries no such column, so the rung is not even
asked when `description` is the only open field.

### 4.3 What it says when it cannot answer

Every one is a **named** skip that travels in the response — the rung's silence
and the rung's absence must never look the same.

| Situation | The skip says |
|---|---|
| `INDEX_URL` / `INDEX_READ_TOKEN` not both set | not asked, and names `INDEX_READ_TOKEN_<THIS INSTANCE>` — the *pairing* is where this goes wrong |
| Any non-2xx | `HTTP <status> (<the index's own error code>)` — `machine_token_invalid`, `machine_read_unconfigured`, `unfoldable_query`… |
| 200 that is not the envelope | *"the index has changed its contract"* — nothing is written off an unknown shape |
| `matches: []` | *"no shelf in the estate holds this title"* |
| Rows but no series | *"N row(s) across the estate, none naming a series"* |
| Network failure | *"could not be reached (…)"* |

⚠️ **Carrying the index's `error` code is the point.** A bare status would send
whoever reads the queue to guess between a broken pairing, an unminted secret
and a title that cannot fold — three faults with three different owners.

### 4.4 Why `/api/machine/search?source=library` is NOT used for series

The machine surface offers a search too. This rung ignores it, for two
independent reasons either of which would be enough:

1. ⚠️ **It is a RANKED PARTIAL match, and this rung AUTO-WRITES.** The index's
   own header says its search *"claims resemblance and never identity"*, and
   that title-only matching is safe *"HERE AND ONLY HERE"* because a human is
   reading a result list with covers and publishers (`read.ts:19-25`). Nothing
   reads this ladder's list — it writes `work.series` straight into the row.
   Feeding a resemblance score into an auto-acting write is the 0.34/0.7 lesson
   this project has already paid for twice.
2. **`source=library` narrows to rows THIS catalog pushed** — our own `series`
   column, which is blank, which is why the rung is running. The value of the
   index is the shelves that are *not* ours; that param excludes exactly those.

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
| **Rung 2 END TO END, through the queue page** | ⚠️ **The one that matters.** The route, the header and the parse are pinned by tests with a mocked `fetch`, and the LIVE index was exercised by hand on 2026-08-25 (`/api/machine/lookup?title=The%20Way%20of%20Kings` → 200 with rows; a wrong bearer → the named 401 `machine_token_invalid`). But **no `/queue` lookup has been driven end to end showing "the estate index" as a field's source**, so the rung-to-column path is inference, not measurement. |
| **Rung 2 on the FRIEND instance** | padhard's `INDEX_URL` and her own `INDEX_READ_TOKEN` were set 2026-08-25 and the pairing was verified by `wrangler secret list --env friend` (NAMES only) plus a live curl of the value. Her sweep has not been observed using the rung. |
| **F9 — the same-series gate** | Mocked-fetch coverage only (the Cosmere-vs-Stormlight case, the spelling case, the empty-shelf case, the set-earlier-this-run case). No live run has yet dropped a real ordinal. |
| **The 44 → 46 `SWEEP_BUDGET` raise** | Arithmetic, checked by test, not observed on a live tick. §8 has the reasoning. |
| **Rung 4 end to end** | The exercise run got **`googlebooks 400`** from the live API with the key in `.dev.vars`. Not diagnosed, and **not** touched by this work — `lookupGoogleBooksByIsbn` is unchanged. The rung is covered by tests with a stubbed fetch; its live behaviour is an open question. ⚠️ Do not read the passing tests as evidence the live rung works. |
| **Rung 5 (Hardcover) live** | Added 2026-08-25. The request shape was confirmed field-by-field against the vendor's published SDL (`hardcoverapp/hardcover-docs@main/schema.graphql`), and the real call was made ONCE from the main session the same day (Way of Kings: description + Stormlight #1 + *Cosmere #7*). ✅ **The universe caveat is FIXED, 2026-08-25:** `lookupHardcover` returns every named `book_series` row and `pickSeries` drops universe names — predicate injected from `@lc/universes`, never a second normaliser — preferring the smallest `series.books_count` among the rest, so Stormlight is written and The Cosmere is not (it still lands in `work.universe`, which is its own column). All-universes ⇒ the named skip `Hardcover: only a universe named, no series`. ⚠️ CI still mocks `fetch`, **the fix itself was never exercised against the live API**, and nothing measures how many catalogue books this rung closes. Both instances hold the token. |
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

- ⚠️ **Rung 2's fan-out is capped at 3 identities (`INDEX_MAX_IDENTITIES`), and
  the cap is a BUDGET decision.** It is the only rung whose price scales with a
  work's aliases, and the hourly sweep's `SWEEP_BUDGET` is the binding
  constraint on the whole ladder (an overrun does not throw — it silently kills
  the invocation). Priced uncapped at `1 + MAX_ALIAS_IDENTITIES` = 5, a
  two-question book on a donor instance cost 46 against a budget of 44, and
  `planSweep` **`break`s** rather than skips, so the sweep would have picked
  **nothing, every hour, silently**. Three is enough for the question asked: this
  is the household's own store keyed on an exact fold, and a fourth spelling
  will not find what three did not. ⚠️ The rung's declared price and this
  constant are the same number — change one and reprice the other.
- ⚠️ **`SWEEP_BUDGET` went 44 → 46 the same day**, for the same arithmetic: an
  AI-only book missing all four details costs `12 + 18 + 16 = 46`, it sorts
  FIRST (never attempted), and at 44 it would have stalled the sweep rather than
  being deferred. The slack under the 50-subrequest ceiling is now **2, not 4** —
  acceptable only because the largest term stopped being an estimate
  (`free-details.test.ts` counts the real calls of a worst-case run). **Do not
  raise it again**; price a rung down instead.
- ✅ **A four-gap book on a DONOR instance costs more than the budget allows —
  `12 + 18 + 6 + 16 = 52` against 46 — and since 2026-08-26 it TAKES THE TICK
  ALONE rather than stalling the sweep.** It used to stall it: `planSweep` breaks
  on the first unaffordable candidate and the queue is never-attempted-first, so
  such a book at the head stopped the tick and was still at the head an hour
  later. **Measured 2026-08-26**, and it was live: padhard's work **#541 *"Raising
  Jesca"*** at 4 asks / 52, with **90 eligible books behind it and 0 picked**;
  main was converged (0 queued) and unaffected. `planSweep`'s **rule 4** now
  admits the head regardless of cost whenever the pick would otherwise be empty,
  and `SweepResult.skipped` names both the over-budget admission and any tick
  that plans nothing. ⚠️ **Such a tick can exceed the 50-subrequest ceiling** —
  the accepted cost, because the 52 is a worst case that assumes every rung is
  asked and fails, and a killed invocation is reaped by `closeStaleRuns`, demotes
  that book in the rotation, and lets the other 89 through next tick. The
  instrument: `tsx scripts/sweep-plan.mjs --remote [--friend]` (read-only). Full
  record in [`../DONE.md`](../DONE.md).
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
| `apps/worker/src/lib/free-details.test.ts` | **60 tests** (2026-08-25) — the fall-through, the per-field stop, attribution, both refusals, **rung 2's route + bearer + envelope parse + fan-out cap**, **F9's same-series gate**, the counted worst-case price, and "no paid call" |
| `apps/worker/src/lib/details-sweep.ts` | `SWEEP_BUDGET` and `FREE_LADDER_SUBREQUESTS` — where the ladder's price is spent; §8. Also `planSweep`'s **rule 4** (the anti-stall) and `SweepPlan.overBudget` / `.nothingPicked` |
| `scripts/sweep-plan.mjs` | ⚠️ **READ-ONLY** — *"what would the next tick plan?"* against a live instance. Calls the real `listWorksNeedingDetails` / `detailsRunHistory` / `planSweep`; writes nothing. `tsx scripts/sweep-plan.mjs --remote [--friend]` |
| `apps/worker/src/lib/detail-values.ts` | `printedFormIn` / `quotedDesignation` — §5.2 |
| `apps/worker/src/lib/research-run.ts` | the wiring: free first, then only what is left |
| `apps/worker/src/routes/scan-jobs.ts` | the add path, on `waitUntil` |
| `apps/web/src/pages/DetailsQueuePage.tsx` | the "answered by:" line |
| `packages/isbn/src/works.ts` | `workDescription` — the OL work record's blurb |
| `apps/worker/src/env.ts` | `INDEX_URL` / `INDEX_READ_TOKEN` — the per-instance pairing (§4.1) |
| `catalog-platform/apps/index-worker/src/machine-route.ts` | ⚠️ **the other end** — the gate, the visibility set, and the three refusals rung 2's skips quote |
| `catalog-platform/apps/index-worker/src/read.ts` | `lookupHandler` — the SELECT (`:39-40`), the `title`-only read (`:57`) and the envelope (`:79`) §4.2 parses |
