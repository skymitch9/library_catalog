# The details queue and the research pipeline — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-10** — every count below was read from the **production**
> database that day through `query()` in `scripts/lib/d1.mjs`. The review, accept,
> reject and verdict paths were driven in a browser against a local worker holding
> a copy of those 116 rows. **The paid lookup itself has never run** — see §7.

Phase 5 is two separate things and this is one of them. The **index**
(`index.heygabi.ai`, a cross-format view over three catalogues) is a different
project with its own host. This document is the **research** half: what the
catalog knows it is missing, and how a fact gets from the open web into a column
with a person's decision in between.

---

## 1. The measurement that shaped the whole feature

Production, 2026-08-10:

| | |
|---|---|
| works | **116** |
| no `first_published` | **116** |
| no `description` | **116** |
| no `subtitle` | **116** |
| no `series` | **13** — and all 13 are already **answers** |
| series set, no volume number | **10** |
| no cover | **1** |
| no `openlibrary_work_id` | **71** — 68 of them searched and absent |
| editions | **117**, every one `ebook_epub` from a file |
| editions with no ISBN-13 | **117** |
| editions with no publisher / year / pages | **116** |
| copies of any status | **0** |
| rows in `research_run` / `research_finding` | **0 / 0** |

⚠️ **"Which columns are null" is not a worklist here — it is the entire catalog
listed against the entire schema.** A queue built that way says
*first published, description* on all 116 rows and tells nobody anything. So
something has to decide, per field, whether an empty column is **a question, an
answer, or a category error**. `packages/core/src/gaps.ts` is that something, and
it is the file to read before adding a field.

---

## 2. What is asked, and what is refused

Four questions, and only four.

| Field | Absent on | Why it is asked |
|---|---|---|
| `firstPublished` | 116 | Every book was published in a year, including the Kindle-native half. Knowable for all, recorded for none. **But see §6 — there is a free rung that has not been run.** |
| `series` | 13, minus verdicts → **0** | The 13 are answers. The field stays on the list because the next book added will be a real question. |
| `seriesIndex` | 10 | "Which volume is this?" A real question for a light novel; a real *answer* of `none` for a side story. |
| `description` | 116 | One or two sentences on what the book is. Nothing else in the catalog answers "what is this". |

The refusals matter more, and the queue page prints them with their reasons
rather than silently omitting them:

- **`isbn13` — the strongest refusal.** An ISBN identifies **one printing**, and
  every edition here is an EPUB from a file. A model asked for "the ISBN of this
  book" returns a real, checksum-valid ISBN for a printing nobody in this house
  owns, and the catalog then claims a hardcover on the strength of it. That is
  [`isbn-ladder.md`](isbn-ladder.md) §4.4's failure with the safety rail removed:
  there is no title string to compare, so nothing downstream could ever catch it.
- **`publisher`, `published_year`, `pages` on an edition.** Same shape. They
  describe a printing; the row describes a file.
- **`openlibraryWorkId`.** Looked up, never reasoned. 68 of the 71 blanks were
  already searched and Open Library has nothing —
  [`openlibrary-ids.md`](openlibrary-ids.md), and `scripts/openlibrary-ids.json`
  is tracked precisely so that answer is not re-bought. A model asked for one
  emits a plausible `OL…W` and there is no cheap way to tell a real id from an
  invented one.
- **`coverUrl`.** One work has none — a picture book whose file carries no cover
  image. No amount of research produces a JPEG.
- **`subtitle`.** Null on all 116, and null is *correct* on most books.

---

## 3. ⚠️ Answers are not gaps — `gap_verdict` (migration 0005)

The thirteen works with no series are the case this feature was built around.
Eleven are **true standalones**; two are genuinely **unknown**. All thirteen were
researched by hand on 2026-08-10 and every one carries its sources in
`scripts/series-overrides.json`, whose header states the rule this table inherits
verbatim: *"An entry with no source is a bug, not a shortcut."*

A blank column says one of three completely different things:

1. Nobody has looked.
2. Somebody looked, and there is genuinely no such thing.
3. Somebody looked, and nobody knows.

Only the first is a gap. `gap_verdict` records the other two, with a **NOT NULL
`source`** and `UNIQUE (work_id, field)` so changing your mind is an upsert
rather than a second contradictory row. There is deliberately no `found`
verdict — a found value is written into the column it belongs in, and a row here
beside it would be a second copy of the same fact, free to drift.

`npm run seed:verdicts` copies the thirteen across. It is idempotent (a re-run
reports "13 already recorded, unchanged") and it **refuses to run** if any entry
in the JSON has no source.

Measured effect: `series` goes from *13 to ask* to **0 to ask, 13 answered**.
That is thirteen pieces of research showing up as work already done rather than
as an absence, and it is the single reason the queue is honest.

---

## 4. Research proposes; a person accepts

`POST /api/research/works/:id/run` writes to `research_run` and
`research_finding` and **nowhere else**. The catalog changes at exactly one
place — `PATCH /api/research/findings/:id` with `accepted` — and only because
somebody pressed a button. This is the rule `/api/enrich` has followed since
phase 2 and the reason is measured twice over in `isbn-ladder.md` §4.4 / §4.5:
*Firefight* and *Unsouled* both returned a **different book of the same name**
scoring **1.00 on title and 1.00 on author**. Only the publisher gave either
away.

Three consequences are built in:

1. **No confidence score anywhere.** `research_finding.confidence` exists in the
   schema and is deliberately left **null**. A number invites sorting and
   thresholding, and no threshold separates 1.00-and-right from 1.00-and-wrong.
   What the model is asked for instead is a `sourceUrl`, a `sourceTier` and a
   one-sentence `basis` — *"Hidden Gnome Publishing's own Cradle page lists
   Unsouled as book 1, June 2016"* — and those three are rendered beside every
   proposed value.
2. **Three outcomes per field, not two.** `found`, `none`, `unknown`. A model
   that can only say "here is a value" produces one for a self-published LitRPG
   nobody has catalogued, because that is what the shape of the request asks of
   it. §4.2 measured 16 of 30 sampled titles as having no record anywhere free,
   so `unknown` is the *expected* answer for much of this library, and accepting
   one writes a verdict rather than a value.
3. **Accepting applies, but only to a blank.** `applyFinding` refuses to
   overwrite anything already recorded, refuses anything that is not a usable
   year or volume number, and **cannot reach `title` or `authors`** — its patch
   object names four columns and cannot name a fifth. That matters because
   `updateWork` re-derives `work_key` from title and authors, and `work_key` is
   the join to 860 audiobook reviews.

⚠️ One deliberate divergence from the sibling Board Game Catalog: **there,
accepting a finding only marks the row**, and applying is "a separate step,
deliberately not built yet". The result is a queue that never empties. Here,
accepting *is* the human act the whole design waits for, so it does the write —
with the three refusals above standing in for the caution that separation was
buying.

`series_index_display` is never written by research. It is what the **cover**
says — "Book 2", "Volume 07", "Prequel" — and research read a web page, not a
cover. Filling it with "Book 2" would be inventing the one field in that trio
whose entire job is to quote something.

---

## 5. The call itself

`packages/research/src/details.ts`. One Claude call per book.

| | |
|---|---|
| model | `claude-opus-5`, recorded in `research_run.model` |
| effort | `low`, recorded in `research_run.effort` — dull, widely-agreed facts |
| thinking | adaptive |
| output | structured (`output_config.format`, a JSON schema), so there is nothing to parse and no retry-on-bad-JSON |
| tools | `web_search_20260209` ×4, `web_fetch_20260209` ×2 — no `allowed_domains`, because the job is to *find* whichever page knows |
| timeout | 90s, via `AbortSignal.timeout` |
| system prompt | identical for every book, and `cache_control`-cached for that reason |

The system prompt names the *Firefight* and *Unsouled* failures explicitly and
tells the model to choose neither candidate when two fit.

⚠️ **The route awaits the lookup and also hands the same promise to
`executionCtx.waitUntil`.** Both. Awaiting keeps the invocation open so the ~30s
`waitUntil` budget never starts; registering means a caller that vanishes does
not take the answer with it. The sibling project used `waitUntil` alone and
roughly half its runs were cancelled *silently* — no exception, nothing in the
catch, `research_run` id 3 stuck at `running` for eleven hours. Three layers now
guarantee a run cannot go quiet:

| Guard | Catches |
|---|---|
| `RESEARCH_TIMEOUT_MS` aborts the call | a lookup that runs away — it throws, so it is recorded |
| the `catch` in `runDetailsResearch` | anything thrown, from anywhere |
| `closeStaleRuns` on read (15 min) | the invocation being killed outright, when none of our code runs |

**Subrequest arithmetic:** one run is ~7 subrequests against a ceiling of 50, so
one book per invocation is comfortable. ⚠️ A "research these ten" route **must
not** share an invocation — ten is ~70, past the cap, and exceeding it
*terminates* the invocation rather than throwing. The queue page drives the list
one book at a time from the browser for that reason, and that page *is* the bulk
mechanism.

**Cost visibility** is why `input_tokens` and `output_tokens` are columns rather
than something the browser holds: the queue's running total comes from the run
log, so it means the same thing after a reload. `estimateCents` prices Opus 5 at
$5/$25 per MTok and the page says out loud that the figure is tokens only and
excludes Anthropic's own charge for the searches.

---

## 6. ⚠️ Before spending anything on `first_published`, run the free rung

The queue's biggest number is *116 books missing a publication year*, and there
is a rung for it that costs nothing and has never been run.

[`openlibrary-ids.md`](openlibrary-ids.md) §on-file-metadata measured what the
EPUB files themselves carry, and `scripts/lib/epub.mjs` already returns it:

| From the files | Count |
|---|---|
| `dc:publisher` | **111** |
| `dc:date` with a four-digit year | **108** |

None of it is in the database. Paying a model for a year that is sitting in a
file on disk would be the most expensive way to learn it, and this repo has
already recorded "the file knows more than the catalog does" twice.

Two caveats, both real:

- `dc:date` is frequently the **edition's** date, not the work's first
  publication. `openlibrary-ids.md` grades `year` as a *weak* corroborator —
  *"one year in a plausible range is a coincidence, not proof"*. So a file-derived
  year is a **candidate**, not a fact, and belongs in the same propose/accept
  flow as everything else rather than being written straight in.
- It leaves roughly **8** works the files cannot answer. That is the population
  research is actually for.

**So the intended order is: file rung first (free, ~108 candidates), then
research on the remainder.** Nothing enforces that today; it is a decision for
whoever runs the queue.

---

## 7. What has and has not been exercised

**Verified, in a browser, against a local worker holding production's 116 works:**

- the queue and its per-field tally, including `series` reading *0 to ask, 13 answered*
- narrowing to one question by URL (`/queue?field=seriesIndex` → 10 rows, exactly
  the genuinely unnumbered side stories and omnibuses)
- accepting a good finding — `firstPublished` → 2022 written, `work_key` unchanged
- **rejecting a wrong one** — a description belonging to a different 1994 book of
  the same name; the column stayed null
- accepting an `unknown` → a `gap_verdict` row, and the question left the queue
- writing a verdict by hand, and the server refusing one with no source (400)
- accepting the same finding twice → 409, not a second write
- `POST …/run` with no key → 503 `not_configured`, and no run row created
- `npm run seed:verdicts` dry run and `--commit`, then a re-run reporting
  *13 already recorded, unchanged*

**⚠️ Not exercised: the paid Claude call.** No `ANTHROPIC_API_KEY` exists on this
machine — there is no `apps/worker/.dev.vars` in either the main checkout or the
worktree, and the example file ships the key blank. `research_run` and
`research_finding` therefore still hold **0 rows in production**, and every token
and cent figure quoted in this document is an *estimate from list pricing*, not a
measurement. The review half was driven against hand-inserted rows whose shape is
exactly what `runDetailsResearch` writes.

**The first real run is the thing to do next**, on one book, reading the numbers:

```bash
# put a key in apps/worker/.dev.vars first
curl -s -X POST localhost:8787/api/research/works/3/run | jq '.run'
```

---

## 8. Two bugs found by driving it, both invisible to typecheck

1. **A controlled `<select>` whose options shrink underneath it.** The verdict
   form's question list is `work.missing`, and that list gets shorter as answers
   land. With the choice held in state, accepting the year left the state on
   `firstPublished` while the select — no longer offering it — *rendered*
   `description`. The form showed one question and submitted a different one,
   silently. Fixed by deriving the value from the live options; the rendered
   value and the submitted value are now the same expression.
2. **`SUM()` over an empty table is NULL, not 0.** `research_run` has no rows, so
   the run tally returned `errors: null` and the page rendered a blank where a
   count belongs. `COALESCE`, like the two sums beside it already had.

Both were found by clicking, and neither would ever have thrown.

---

## 9. Gotchas

- **A long checkout breaks the local D1 entirely.** miniflare keeps it under
  `apps/worker/.wrangler/state`, and on Windows a deep enough path pushes that
  past the limit. Every local `d1 execute` then fails with a bare
  `internal error; reference = …` — *including a plain `SELECT 1`*, which is how
  you tell it apart from a SQL problem. Seen 2026-08-10 in a git worktree under
  `AppData\Local\Temp\…`. Set `LC_D1_PERSIST_TO=C:/lcw` for the scripts and pass
  `--persist-to C:/lcw` to `wrangler dev` / `d1 migrations apply`. The main
  checkout needs neither, and remote is unaffected.
- **Backticks inside a SQL comment in `packages/db`.** The queries are JavaScript
  template literals, so one backtick in a comment ends the string. It broke the
  Worker build once, with an esbuild error pointing at the SQL.
- **The queue counts pending findings server-side.** A row that cannot say
  "2 to decide" until you expand it is a worklist you must open every row of,
  which is the opposite of one. One extra query for the whole page.
- **`research_run.unfilled` is comma-delimited *with leading and trailing
  commas*** — migration 0001 says so, and the reason is that an exact test is
  then `instr(unfilled, ',series,')` and `series` cannot match inside
  `seriesIndex`.

---

## 10. Where things live

| | |
|---|---|
| the policy — what is a gap | `packages/core/src/gaps.ts` (leaf; imports only `constants.ts`) |
| the field list | `DETAIL_FIELDS` in `packages/core/src/constants.ts` |
| tables and queries | `packages/db/src/research.ts` |
| the Claude call | `packages/research/src/details.ts` |
| running one pass, applying one finding | `apps/worker/src/lib/research-run.ts` |
| the routes | `apps/worker/src/routes/research.ts` |
| the page | `apps/web/src/pages/DetailsQueuePage.tsx`, at `/queue` |
| the seed | `scripts/seed-gap-verdicts.mjs` (`npm run seed:verdicts`) |
| the migration | `migrations/0005_gap_verdict.sql` |

⚠️ `packages/research` is a **sixth** workspace. Anything that says "five
workspaces typecheck" predates it.
