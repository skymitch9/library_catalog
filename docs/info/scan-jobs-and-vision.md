# Scan jobs and the shelf photo — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-11**. §1, §2 and §4 were verified 2026-08-10 against
> the real `POST /api/scan-jobs/shelf` route on a local worker with the real
> `ANTHROPIC_API_KEY`, driven in a browser. **§3 and §3b were verified
> 2026-08-11** against a local worker and live Open Library — every timing and
> every state transition below was measured, not reasoned.
>
> ⚠️ **Not verified for §3/§3b: the browser.** The review screen's polling and
> auto-continue effect were exercised at the API layer only; no shelf
> photograph was taken, because that half needs a paid vision call.

Two features, in the order they had to be built: a scan **job** that survives a
locked phone, and then a **shelf photograph** that is allowed to cost money
because the job exists to catch what it produces.

---

## 1. Why persistence came first

`scan_job` shipped in migration 0001 and sat at **0 rows with no route touching
it** for two phases. `ScanPage` kept its results in `useState`, so a phone
locking mid-sweep lost the lot.

For barcodes that is a shrug — a barcode is free to re-scan. For a shelf
photograph it is not: the reading has already been paid for. So nothing in the
vision path was written until a job could be reloaded, and that ordering is the
only reason §2 is safe to have built at all.

### What a job is

| | |
|---|---|
| One row per sweep | `scan_job`, `mode = 'isbn'` for barcodes, `'shelf'` for a photograph |
| Lines | `scan_job.enriched`, a JSON `ScanLine[]` — see `packages/core/src/scanjobs.ts` |
| What vision said, unmatched | `scan_job.raw_titles`, kept and never overwritten |
| Resumed by | `?job=<id>` on `/add`, written with `replaceUrl` the moment the server mints an id |
| Listed by | `/scans`, which shows only sweeps that are not `done` |

A **barcode sweep is one job with N lines**, not N jobs: ten books through ten
review screens is the thing bulk intake exists to avoid. A **photograph is one
job per photo**.

⚠️ **`photo_key` always holds `'not-stored'`.** The column is `NOT NULL` and
predates the decision never to keep a photograph. There is no R2 binding in
`wrangler.toml` and there must not be one — the sibling project deleted its
bucket after noticing the objects were write-only, existing only to be deleted
later, and that one forgotten code path would have kept photographs of someone's
home indefinitely.

### The one rule the review list enforces

`isOutstanding` in `@lc/core` settles a line **only** when the answer settles
itself (`owned`, `skipped`) or a person acted (`addedWorkId`, `dismissed`).
`not_found` and `error` stay outstanding. That is deliberate and is guarded by a
test: the sibling project closed a job when the *easy* rows were added, and the
rows worth coming back to were exactly the ones that went with it.

---

## 2. The measured vision hit rate

Model `claude-opus-5`, `effort: 'low'`, structured output against `SHELF_SCHEMA`,
thinking left on at its default. One call per photograph, no web search.

### ⚠️ Read this before quoting any number below

**No photograph of this household's own shelves was available when this was
measured.** The results split into two populations and only one of them is
evidence about real use:

- **Synthetic renders** (SVG spines, rendered with `sharp`) have exactly known
  ground truth and are wildly optimistic — flat text, no glare, no perspective,
  no occlusion, no dust jackets. Treat them as a **ceiling**, not a hit rate.
- **Real photographs** from Wikimedia Commons are real shelves, but they are
  *someone else's* shelves, so the "already yours" match rate is necessarily 0
  and says nothing. What they measure is the **reading**.

| Photo | Kind | Books returned | Verified correct | Wrong / invented | Cost | Time |
|---|---|---:|---:|---:|---:|---:|
| 12 synthetic spines, clean | synthetic | 12 | **12** | 0 | 2.8¢ | 8.7s |
| same, rotated 5° + blurred + JPEG q42 + darkened | synthetic | 12 | **12** | 0 | 3.0¢ | 8.3s |
| A real shelf of ~30 English-language manga, shot straight on | **real** | 30 | **28** | 0 invented, 1 volume-number disagreement, 1 unverifiable | 6.7¢ | 19.5s |
| A real Japanese children's storage unit, books mixed with toys | **real** | 15 | partially | 0 invented | 4.8¢ | 14.3s |
| The manga shelf at 900px, blurred, 28% brightness | **real, degraded** | 0 | — | — | 1.0¢ | 3.9s |

### What the real photographs actually showed

**The good case (manga shelf, ~30 spines).** It read 30 spines where a careful
human read found ~28, **and it found one the human missed** — a third *Godchild*
volume between two that had been read as one book. Two rows to be honest about:
it said `xxxHOLiC 11` where the human read `17` (small digit, neither is
certain), and `Immoral Bird 3` which could not be verified either way. **Nothing
was invented.** It refused an author on the two spines that genuinely showed
none, and flagged the cut-off spine at the frame edge as `low` with
`note: "partly cut off at left edge"`. It missed 1–2 partial spines at the right
edge.

⚠️ **That shelf is close to a best case and should not be read as typical.**
English-language manga have large, flat, high-contrast spine text; the photo is
straight on, evenly lit, and nothing is in front of the books.

**The hard case (children's storage unit).** ~50 book-like objects, mostly
Japanese, heavily occluded by bags and toys. It returned 15, at `low`/`medium`
confidence, correctly identified the *Kaiketsu Zorori* series and its author
(原 ゆたか), refused an author on 13 of 15 — and, importantly, **did not report
the toys, boxes or lunchboxes as books.** Recall against what is visible is
clearly poor. This is the shape a real household shelf photographed casually
will produce.

**The unreadable case.** A dark, blurred snap returned `unreadable: true` with
zero books and **16 output tokens — 1¢**. The failure path is cheap, which is
what makes "take another photo" reasonable advice.

### Cost, in the shape it is actually spent

3–7¢ per shelf. The image dominates: a 2400px photograph is ~5,700 input
tokens against ~500–1,500 output. Halving the long edge roughly halves the bill
and visibly costs recall, so `SHELF_LONG_EDGE` stays at 2400.

`estimatedCents` is returned to the client and **shown on the screen**. The
person spending the money is the person holding the phone; a cost that lives
only in a dashboard is a cost nobody ever sees.

### What could not be verified

- **The actual hit rate on this household's shelves.** Unknown. The catalog is
  heavy in Kindle-native and Audible-native indie titles whose print editions
  are often print-on-demand with thin, low-contrast spines — a harder population
  than either real photo tested here.
- **A phone camera in a real room.** Every image went through
  `fileToPhoto`, not `captureFrame` from a live `getUserMedia` stream. The
  capture code is shared and unchanged from the barcode path, but the *photos*
  were files, not frames.
- **iOS.** Not touched. See `docs/info/ios-camera.md`.

---

## 3. The first lookup pass is automatic

> ⚠️ **Reversed on 2026-08-11.** This section used to be titled "Why lookups are
> one line at a time" and argued that every external search should be a button.
> The owner overruled it: *"we keep having to manually engage the lookup feature;
> in the board game project the first pass was always automatic and made for a
> better experience."* The two facts the old argument rested on are still true
> and were never the point — see below.

A photograph now gets **vision, the local catalog match, and a first Open
Library pass**, without anybody pressing anything. The mechanism is the sibling
Board Game Catalog's, ported rather than re-derived:

| | |
|---|---|
| Barcode | already synchronous inside the append. Unchanged |
| Photo | `waitUntil(runLookupPass)` kicked from the upload response |
| Continuing | `POST /:id/enrich`, asked for by the review screen |
| Chunk | `LINES_PER_RUN = 8`, then the job parks at `read` |
| Heartbeat | `processed_at`; `STALE_AFTER_MS = 90_000` lets a retry replace a dead pass |
| Upstream | **one request at a time**, `MIN_GAP_MS = 1100` apart — `packages/isbn/src/throttle.ts` |

`read` already meant "lines exist, not all looked up", so continuing needed no
new status and **no migration**.

### What the old argument got right, and where it belongs

1. **Half this library is not in Open Library** (measured, 14 of 30). True — and
   a search that answers nothing now costs a row saying "not in Open Library",
   which is information arrived at without a tap. It was never a reason to make
   the person generate it by hand.
2. **The spine text is often wrong**, so the useful search is the one made after
   a person corrects it. Also true, and this is the real conclusion: the manual
   `POST /:id/lines/:i/lookup?q=` survives as the **repair bench**. It is no
   longer how a line gets looked up; it is how a line gets looked up *again,
   with better words*. Both paths call the same `lookupLine`, so a hand-made
   lookup and an automatic one score identically.

### Measured, 2026-08-11, against the local dev worker

| | |
|---|---|
| One chunk of 8 spine lookups | **8885 ms** — i.e. 1.11 s apart, confirming the throttle |
| Concurrent upstream requests | **1** |
| Ten lines | two chunks (8 then 2), ending at `review`; a third `/enrich` returns `running: false` |
| A row dismissed or retyped mid-pass | **survives** — the pass re-reads before writing and skips any line that stopped asking the same question |

That last row is the one hazard the automatic pass introduces and the only one
worth remembering: a person reviews *while* the pass runs, and both write the
same JSON blob. `runLookupPass` merges into a re-read job rather than writing
back the snapshot it started from. Without that, nine seconds of a person's
decisions get silently undone.

### The matcher, measured

On the synthetic shelf, 11 of 12 spines matched works already in the catalog.
The twelfth was **`Onyx Storm` refused against `Onyx Storm (The Empyrean)`** —
containment scored 9/21 = 0.43, under the 0.6 floor, so it was left unmatched.
That is the gate working: the series suffix makes it a different string, and
guessing is how a duplicate becomes invisible. `Killer's Mind` correctly matched
`A Killer's Mind`, because `normaliseTitle` strips the leading article.

On live Open Library lookups from the real manga read:

| Asked | Answer |
|---|---|
| `HYPER POLICE 10` + `MEE` | `Hyper Police Volume 10` / Mee (minoru Tachikawa), TokyoPop 2007 — **0.86**, added to the catalog end to end |
| `COYOTE RAGTIME SHOW 1` (no author) | `Coyote Ragtime Show, Vol. 1 - Fox Trot` — **0.67**, correct but *below* the 0.7 spine floor, so shown as a **loose match** and left unticked |
| `Nodame Cantabile 12` + `TOMOKO NINOMIYA` | rejected — Open Library answered, every candidate failed the author gate |
| corrected to `Hollow Fields` + `Madeleine Rosca` | **1.00**, exact |

⚠️ **Including the volume number in the query hurts.** `Nodame Cantabile 12`
found nothing usable where the bare series name would likely have. The spine
prints the number, the prompt is told not to strip it, and the search passes it
through — the fix, when someone wants one, is a second lookup rung that retries
without a trailing volume number, not a change to what the model reports.

---

## 3b. Dead ends: the rule that four separate bugs came from

> Added 2026-08-11, after four owner reports that turned out to be one defect.

**The review screen gated its buttons on how a row *arrived* (`via === 'spine'`)
and on whether a service had *answered* (`state === 'found'`), instead of on
what the row still *needed*.** Wherever the system had no answer, the person was
given no options — a row with no buttons on it at all.

| Row | What used to happen | Now |
|---|---|---|
| Already in the catalog (`owned`) | "Already yours", **no buttons**. A second physical copy could only be recorded by leaving the sweep, finding the book and adding a copy by hand | Names and links the work, one-tap **Add 2nd copy**, one-tap **Leave it** |
| Board book, ISBN resolves to nothing | `not_found`, **no Add, no Edit** — barcode rows were denied both | **Type it in** → **Add**. The scanned ISBN survives the edit and reaches the edition |
| Shop barcode / SKU (non-Bookland) | `skipped` — silent, settled, buttonless | `unresolvable` — visible, typeable, addable. Never looked up: there is no registry of SKUs |
| Same code already on this sweep | Server refused with `duplicate: true`; **nothing read the flag**, so it looked like a misfire | Prompts: "Already on this sweep — do you have a second copy?" `allowDuplicate` appends a new line |

The rule is now explicit in `@lc/core`, and the review screen and
`catalog-add.ts` both read the same predicates so a button can never offer
something the add path then refuses:

| | |
|---|---|
| `searchText(line)` | the words a title search would use — `null` when the only text is the scanned code |
| `proposedTitle` / `proposedAuthors` | what the row would be filed under; `null` means nobody has said yet |
| `isAddable(line)` | has a title and an author, **or** already names a work (the second-copy path) |

⚠️ **`proposedTitle` is the guard that stops a book being catalogued as
"9780241361221".** `blankLine` seeds a barcode line's `text` with the code, so
the old `resolvedTitle ?? text` fallback would have created a work by that name
the moment Add was un-gated.

⚠️ **Two costs, both accepted deliberately.** A stray UPC read now costs one
"Not wanted" tap where it used to be silent — reverting is one branch in
`resolveBarcode`. And `owned` rows are no longer settled, so a sweep of books
you already have reads "12 still to sort" rather than "all sorted"; that is the
point, since each is now a question.

⚠️ **The price add-on stays `skipped`, settled and silent.** Five digits beside
the real barcode is never a book, and there is no question to ask about it.

---

## 4. Money and consent

| | |
|---|---|
| **Gate** | `runResearch`, not `scan`. A barcode is free; this is the spend capability, and the tab is hidden entirely from anyone without it |
| **Trigger** | One deliberate tap. Never automatic, never on a timer, never retried on your behalf |
| **Photo** | Never written anywhere. Request body → vision call → gone |
| **Writes** | None. Every line is a proposal; `addedWorkId` records that a person pressed Add and the ordinary `POST /api/works` succeeded |

An edition is created **only when a resolved ISBN exists** — a barcode earns
one, a bare spine read does not. Writing `format: 'paperback'` off the shape of
a book would put an invented fact in the column `PHYSICAL_FORMATS` filters on.
A spine adds the work and the copy and leaves the edition to whoever later scans
its barcode.

---

## 5. Gotchas found while building this

- **⚠️ `min(8)` on the barcode body rejects the price add-on.** The five-digit
  code beside a book's barcode is the single most common thing a sweep locks
  onto, and `classifyScannedCode` exists to skip it quietly — which it never
  gets to do if the schema rejects the code as too short first. It is `min(3)`.
  Found by sending `51999` and getting a validation error where the whole point
  was silence.
- **⚠️ `wrangler d1` CLI dies with `internal error` when the repo path is long.**
  A git worktree under `%TEMP%\claude\...` puts the D1 file at **283
  characters**, past Windows' 260-char `MAX_PATH`. `wrangler dev` is fine —
  workerd is long-path-aware — so the symptom is "the app runs but no migration
  or query will apply", with an opaque reference id and nothing in the log. Fix:
  `--persist-to C:/<short>` on both `dev` and `d1 migrations apply`.
- **A stale `wrangler dev` keeps its port bound after being killed.** Four
  processes were listening on one port; the new server started, printed
  "Ready on", and every request hung. `netstat -ano | grep :PORT` and kill all
  of them, or move ports.
- **`cover-placeholder` was a dead class.** Carried from the old scan screen and
  never defined in `styles.css`, so the blank slot had no size. Scan rows now
  use `.scan-lines` / `.scan-line__blank`, scoped so the collection's own use of
  `ul.works` is untouched.
- **The system prompt is under the prompt-cache minimum.** `SHELF_SYSTEM` is
  ~400 tokens; the floor on this model is 512. A `cache_control` breakpoint
  would be silently ignored — `cache_creation_input_tokens: 0`, no error — so
  there deliberately is not one. A marker that does nothing is worse than no
  marker, because the next reader takes it as evidence caching works.
- **Thinking is ON by default on `claude-opus-5`.** Omitting the parameter runs
  adaptive thinking, unlike the previous generation. `max_tokens` therefore
  budgets thinking *and* the JSON. It is left on: disabling it can leak
  `<thinking>` tags into the visible output, which for a structured-output call
  is a malformed answer already paid for.
