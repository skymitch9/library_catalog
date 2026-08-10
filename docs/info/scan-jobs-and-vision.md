# Scan jobs and the shelf photo — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-10** — every number below was produced by the real
> `POST /api/scan-jobs/shelf` route against a local worker on `127.0.0.1:8793`,
> with the real `ANTHROPIC_API_KEY`, and the whole flow was driven in a browser.

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

## 3. Why lookups are one line at a time

The sibling Board Game Catalog enriches a whole photo server-side in chunks
behind `waitUntil`, with staleness detection and a resume path — machinery it
grew after three shelves silently died against the **50-subrequest-per-
invocation** ceiling. This route does not copy that. Two book-specific reasons:

1. **Half this library is not in Open Library** (measured, 14 of 30). Firing
   fifteen searches to have most answer nothing — or answer with a different
   book that shares a word — spends the budget to make the review list *worse*.
2. **The spine text is often wrong**, so the useful lookup is the one made after
   a person corrects it. `POST /:id/lines/:i/lookup?q=` is exactly that.

So a photograph gets **vision plus the local catalog match** — free, instant,
and the answer that actually prevents duplicates — and every external search is
a separate request the client makes per line. No chunking, no heartbeat, no
stale-job recovery, and no ceiling to hit.

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
