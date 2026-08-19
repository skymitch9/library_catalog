# DONE — library_catalog (dated archive)

> **Audience:** Claude sessions. **Status:** TRACKED. Created **2026-08-16**
> by splitting a 2,804-line `docs/TODO.md`, per the global docs rule.
>
> ⚠️ **This is an archive, not a living doc. APPEND ONLY.** Nothing here is
> ever edited, re-summarised or tidied. An item arrives exactly once, at
> completion, moved **whole** from [`TODO.md`](TODO.md).
>
> Newest first. Entries below kept the order they had in the original file,
> which ran broadly newest-first already — so the dates in the headings are
> the authority, not the position.
>
> Active work lives in [`TODO.md`](TODO.md). Durable reference lives in
> [`info/`](info/README.md) and [`access/`](access/README.md) — in particular
> [`info/gotchas.md`](info/gotchas.md) for the traps and
> [`info/decisions.md`](info/decisions.md) for the rationale, both of which
> were extracted from this same history.

## 📚 Samantha's volume queue emptied BY HAND — 51 waiting to 0 (2026-08-19)

The same afternoon the volume rules landed, the owner chose not to wait for
the hourly sweep: *"Fix them by hand"*. Everything below is on
`library-catalog-2nd` (padhard).

**What was wrong, and it was not the button.** Her key was live and her own
button press earlier that day succeeded ~45 times. Two real causes:

1. **Filling `series` on 57 books CREATED the 55 volume questions** —
   `detailFieldsFor` cannot ask "which volume?" of a book with no series, so
   climbing the first rung built the second.
2. ⚠️ **The bulk button reads "Every one already asked" and disables itself,**
   because `outstanding` counts books never asked — and ask-ness is tracked
   **per book, not per question**. Filling the series marked those books
   asked; the volume question came into existence afterwards. So the button
   honestly reported nothing to do while 51 real questions sat open. The
   hourly sweep drains them anyway (oldest-turn-first rotation ignores the
   marker), which is why the queue fell while the button looked broken.
   **This is a live defect and is NOT fixed** — see TODO.md.

**What was done by hand** (batch `hand-volumes-20260819`, `changed_how='human'`,
one `change_log` row each so any single value reverts):

- **49 books numbered.** The full Dresden Files run in publication order
  (Storm Front 1 … Skin Game 15, Side Jobs 12.5, Out Law 17.5, Twelve Months
  18), all six Dream Harbor, both Emily Wilde, both Shepherd King, both Cat
  and Mouse, both Royal Artifactual Guild, both Shadow Beast Shifters, both
  Love in Galway, A Touch of Power 1/3/4, and the singles.
- **1 recorded standalone** — *Tusk Love*, a `gap_verdict` of `none` rather
  than a fabricated `1`.
- **1 boxed set split** — *Caraval Paperback Boxed Set* into Caraval (1),
  Legendary (2), Finale (3), every ISBN verified against Open Library before
  use, the set row kept and joined by `contains`, its `collects` column filled.

**Owner decisions taken on the way** (one at a time, as the global rule
requires): 17.5 for *Out Law*, 3.5 for *Spectacular*, standalone for *Tusk
Love*, `1` for the four single-book series, and split the boxed set.

**Measured after**: 74 → 77 works; volume gaps 51 → 0 waiting; the only three
on the queue are the newly split Caraval books needing descriptions, which the
sweep fills two an hour. Cost: **nothing** — no research runs were spent.

⚠️ **The rules this produced are R9–R12 in
[`info/volume-numbers.md`](info/volume-numbers.md)**, not here: the novella
`.5` convention, standalone-is-a-verdict, the boxed-set split pattern, and
never labelling a hand fill `'auto'`. This entry is the event; that file is
the answer.

## 🔁 THE BUTTON WORKED AND THE COUNT DID NOT MOVE — the details queue converges — ✅ DONE 2026-08-19

Owner, verbatim: *"Sam has 55 missing details, the button didnt fix, do some
research then also strengthen out autofix."* Opened and closed the same day.
Reference: [`info/research-and-gaps.md`](info/research-and-gaps.md) §10.6.

### What the button actually did — measured, not reasoned

Every figure below was read from `library-catalog-2nd` (remote) on 2026-08-19.

| | |
|---|---|
| `research_run` rows | **80** — 77 `done`, 3 `error` |
| the 3 errors | runs **5, 6** (2026-08-17 20:19, raw cap body) and **7** (21:07, worded) — all three from the monthly-cap incident, none since |
| runs on 2026-08-19 16:33–16:37 UTC | **~45**, `model = claude-opus-5`, `triggered_by = 2`, every one `done` |
| values written | **73 descriptions, 57 series names, 4 years, 2 volume numbers** — all `accepted` / `decided_how = 'auto'` |
| works still on the queue | **55 of 74** |
| …of which the gap is `firstPublished` / `series` / `description` | **0 / 0 / 0** |
| …of which the gap is `seriesIndex` | **55** — and **54 had NEITHER `series_index_sort` NOR `series_index_display`** |

⚠️ **So the key was never the problem and the button was never broken.** Her
`ANTHROPIC_API_KEY` is live — the owner's *"i cleared this yesterday"* is
confirmed by ~45 successful paid runs that afternoon — and the three failed rows
are 2026-08-17 fossils that later runs already superseded (works 4 and 5 were
both re-run successfully at 22:07/22:11 that night, by the hourly sweep, with
nobody pressing anything). The count did not move because **filling `series` on
57 books CREATED 55 volume-number questions**: `detailFieldsFor` refuses to ask
"which volume is this?" of a book with no series, so the second rung of the
ladder only comes into existence once the first is climbed.
`scripts/research-queue.mjs`'s header had already recorded exactly this on the
main instance — *"57 volume-number questions came into existence the moment [the
series names landed]"* — and nobody connected it to the friend instance's number.

### ⚠️ And that second rung could not be climbed at all

`seriesIndexIncomplete` demanded BOTH `series_index_sort` and
`series_index_display`, and nothing downstream of `routes/ingest.ts` had ever
written the second — not research, not the donor, no backfill. All 55 rows were
rows the queue could be paid for **for ever** and never close.

**The owner settled it the same day** (verbatim): *"We don't need physical
volume if we have series. Only a few things have it like the 2 part Sanderson.
Make it optional."* And, on why the predicate deserved no more argument:
*"this volume bug is annoying, you've been right every time about volume."*

So: **`series` + `series_index_sort` = COMPLETE**, and the printed form is
optional data — present only where a printing physically carries a designation,
kept where it exists, never demanded. Research writes the sort always and the
display **only when a finding quoted a printed form verbatim** (`"Volume 07"`,
never a derived `Book 3`); `asIndex` now reads the number out of such a form,
which it previously threw away, so a model answering in the shape a book
actually prints is no longer told its answer is unusable.

⚠️ **The canonical statement is [`info/volume-numbers.md`](info/volume-numbers.md)** —
rules with dates, the two columns, the measured history of why the obvious
two-column predicate is the wrong fix, and where a printed form actually comes
from. It exists because the owner said *"We're wasting all our buffer usage on
solving nonsense we've solved many times"*, and it is the permanent answer.

⚠️ **Two fixes were built for this symptom and one was thrown away.** Earlier
the same morning, `applyFinding` derived the printed form (`seriesIndexDisplayFrom`)
and the sweep grew a free **rung 0** to heal rows stranded before it. Both
worked; both were removed when the ruling made the gap they closed not a gap.
Kept from that pass because each was right independently: the ingest literal now
lives in one place, `classifyLookupFailure` can read back its own sentences, and
the provenance table that made the ruling obviously correct — **nothing in this
repo has ever read a cover.** Of the main instance's 270 works holding both
columns, 184 hold the bare sort number (ingest's default) and 81 came from the
TITLE STRING (`High School DxD - Volume 07 - …`).

**Measured effect of the predicate change alone:** friend **55 → 53**, main
**0 → 0**. The remaining 53 have no sort either and genuinely need the lookup —
which the sweep now does, and which now closes the row when it lands.

### The queue can no longer show an anonymous number

Owner: *"a book missing details either gets them filled automatically within a
day, or sits in a NAMED residue category that the queue page displays with those
words — never an anonymous count that looks like a bug."* That is the other half
of why a working button was reported broken: a row research had answered looked
identical to a row nobody had reached.

`residueSentence` (`apps/web/src/lib/details-residue.ts`, pure and tested) now
says so per row — naming the volume case separately, and calling the
could-not-identify case **an answer rather than a failure**, because
`isbn-ladder.md` §4.2 measured 16 of 30 sampled titles as having no free record
anywhere. A page-level line splits the list by name: waiting for a lookup versus
looked up and unanswerable. ⚠️ It refuses to label a book settled while any of
its questions is unasked, and refuses to call an **errored** run an answer —
that would be the opposite lie from the one it fixes.

### A failure about the ACCOUNT is not the book's turn

Second strengthening. `detailsRunHistory` recorded `lastAttemptAt` as the newest
attempt of **any** status, and the sweep rotates on it. That is right for a book
that fails on its own merits and wrong for the failure that actually happened:
the 2026-08-17 cap demoted three books behind every book that had been
*answered*, taught nothing, spent nothing, and left them demoted after the owner
cleared the cap.

Now `classifyLookupFailure` weighs the newest error: `allowance_used_up`,
`too_many_at_once` and `key_rejected` are facts about the KEY and leave the
rotation exactly where it was; every other error still counts as a turn taken,
which is the starvation guard the original rule existed for. ⚠️ Deliberately a
**different rule from `asked`**, which has always ignored every error — that one
is about eligibility, this one only about order.

⚠️ **This exposed a real defect in the classifier itself.** `describeError`
classifies at STORE time, so every run failing since 2026-08-17 holds one of
`lookup-errors.ts`'s OWN sentences — and the vocabulary only matched Anthropic's
phrasing, so the module could not read its own handwriting. Harmless while the
only consumer was `wordLookupError` (which passes worded strings straight
through); **not** harmless the moment something asked *what kind* of failure a
stored row was. Both halves of the incident are live in one table (runs 5/6 raw,
run 7 worded), so a rule blind to the worded form would have fixed half of it.
`classifyLookupFailure` now round-trips every message this module writes, and
`regainDate` reads the human date (`until 1 September 2026`) as well as the ISO
one, so re-classifying cannot silently downgrade a screen that already reads
correctly.

### Also settled

- **Her hourly sweep cron is VERIFIED, not claimed.** The proof this repo asks
  for — a `research_run` row with `triggered_by` NULL — exists on
  `library-catalog-2nd`: six of them, most recently `2026-08-19 16:07:16`, plus
  a `model = 'donor'` row at `16:07:14` proving the donor rung fires too. Minute
  :07, as configured. The `[env.friend.triggers]` block was already correct;
  nothing needed adding.
- **The `Sam's ANTHROPIC key → capped workspace` tech-debt item is closed.** Its
  suggested five-second confirmation — press Look again on runs 5/6 — rested on
  the theory that those rows never retry themselves. They do; the sweep re-ran
  both works the same night. Whether her key sits in a capped workspace remains
  unverified and is a question for the owner, not for this catalog.

**Tests:** 1273 → **1296**, all green. New:
`packages/core/test/series-index-display.test.ts` (the derivation, and that undo
cannot mistake a person's string for the machine's),
`packages/db/test/last-real-attempt.test.ts` (the rotation rule, including that
an *unexplained* error is conservatively treated as the book's own),
`apps/web/test/residue-sentence.test.ts` (the named residue, and its two
refusals), and a round-trip block in `packages/core/test/lookup-errors.test.ts`.
`packages/core/test/series-index-display.test.ts` and the supersession note left
in `core.test.ts` are the mechanical guard against the predicate being
re-tightened.

## 📖 `browse-works` — GABI CAN FINALLY SEE THE PHYSICAL SHELF — ✅ DONE 2026-08-19

Opened and closed the same day, so this never sat in `TODO.md`. Operator doc:
[`access/gabi-delegated.md`](access/gabi-delegated.md).

**The failure that caused it, from the Discord archive that morning:** she asked
*"audiobook, ebook, or a physical copy?"*, the owner answered *"physical
please"*, and she replied *"Nothing's come through the scanner yet in that
direction."* The scanner sentence was invented whole — but the emptiness behind
it was real, and it was **ours**: her only view of print was the ~90-pair
audiobook join table, **84 of 1,079 catalog rows, 64 of them physical**, against
a catalog of 448 works.

⚠️ **Neither existing road could be widened, and that is why a third one was
built rather than a flag flipped.** `/api/machine/audiobook-mapping` is a **join
table on purpose** — its own header refuses to become a catalog export — and the
shared index **widens only for a caller holding a Firebase ID token**, which a
Discord Worker structurally cannot mint. The delegated door was the only surface
that already knew how to ask *"what may THIS PERSON be pointed at."*

**Built:** `POST /api/gabi/delegated/browse-works` — the door's first READ verb.
Gated on `read` (*"see the collection at all"*, guest+), **not** `editCatalog`:
the Discord side's own note is right that *"a reader with no edit rights can
still walk to the bookcase."* No new gate, no new secret, no new holder, no
migration. Projection is a default-deny allow-list in
`packages/db/src/gabi-browse.ts`, modelled on `index-projection.ts`.

⚠️ **The predicate is a COPY-level question, and getting that right was the
whole design.** A physical suggestion is an *errand* — it points somebody at an
object in a house — so the clause asks whether a **held** copy (`owned`/`lent`)
is a thing with mass, either linked to a physical printing or linked to **no**
printing at all. Measured live before writing it: **177 of 390 copies carry no
`edition_id`** (a copy may exist before its printing is known — the spine-photo
case), so requiring a physical `edition` row would have hidden 6 works the
household demonstrably has on a shelf.

⚠️ **`EBOOK_ONLY_CLAUSE.hide` looked like the obvious reuse and is a trap.** Its
third conjunct is `NOT EXISTS (copy)`, so beside a held-copy requirement it is
always false and the whole clause degenerates to `TRUE` — a filter that reads as
protection and applies none. Checked before writing, and pinned by a test so
nobody simplifies it back.

**Measured live 2026-08-19** (`wrangler d1 execute --remote`): 448 works → **341
returned**, 6 of them with `formats: []`, 0 held copies linked to an ebook
printing. ⚠️ **`formats: []` means "held, printing not typed in yet" — never "not
physical"**; a consumer reading it the other way inverts the meaning of exactly
the rows the clause exists to keep.

**Verified by execution, not by reasoning.** A local `wrangler dev` on a seeded
fixture exercised every gate branch and every predicate branch end-to-end
against a real D1 — the only way to prove the bind order, which no stub can. A
copy linked to a hardcover came back with formats; a copy linked to nothing came
back empty and present; a copy linked to an ebook and a `wanted` copy were both
absent; `limit: 99999` clamped to 500 rather than erroring.

**Also landed, because a third copy would have been a review finding:** the
four-word format mapping (`Hardcover` / `Paperback` / `Mass market` / `Ebook`)
moved out of `routes/audiobook-mapping.ts` into
`apps/worker/src/lib/format-labels.ts` — unchanged, now shared, and with the
test the private version never had. ⚠️ Those strings are load-bearing in two
other repos: the audiobook catalog stores them verbatim in `catalog.csv`'s
`library_formats`, and the Discord bot matches them lower-cased.

**Left open, and stated rather than papered over:**
- ⚠️ **No REAL Discord caller has used it.** Every branch is proven locally with
  a seeded fixture and the live door answers its refusals correctly; the ~20-line
  client in `catalog-platform/apps/discord-worker` is another agent's follow-up,
  and until it lands nothing has exercised this with the shared bearer.
- ⚠️ **The bot's `PHYSICAL_FORMAT_TOKENS` is `['hardcover','paperback']` and
  omits mass market** — a mass-market paperback from this verb would be dropped
  on their side. Not this repo's bug; worth knowing before somebody debugs a
  missing book.
- **The order is `work.id` under a hard cap**, so a caller that ignores `total`
  suggests from the front of the shelf forever. `offset` exists; whether the
  client uses it is the client's problem to get right.

## 🖼️ THE BOX-SET SPLIT'S COVERLESS OFFSPRING — ✅ ALL FILLED 2026-08-18

Moved whole from [`TODO.md`](TODO.md). Opened 2026-08-18 as "nobody has run the
covers backfill over these yet"; closed the same day, **verified by
re-measurement against production D1 at 19:16 UTC**.

**Measured: 448 works, `cover_url IS NULL OR = ''` → 0.** Every one of the rows
carries a cover.

⚠️ **The item said "20 NULL-cover rows" and the real number is 21.** Its own
group lists add up that way — 412, 419, 454, 455, 462–473 is **16**, and
325, 458–461 is **5** — and the 26-row total it also quoted is only reachable
as 5 + 21. The counting error, not the row list, was wrong; nothing was
missed by it.

| Group | works | outcome |
|---|---|---|
| **Box-set split offspring** | 412, 419, 454, 455, 462–473 | **16/16 filled**, all `covers.openlibrary.org/b/id/…-L.jpg` |
| **A Court of Thorns and Roses** | 325, 458, 459, 460, 461 | **5/5 filled**, same rung — 325 is the split set row itself, cleared by `change_log` 1010 |
| Illumicrate Percy Jackson | 224–228 | **untouched, correctly** — still `standin`, still the only rows on `/?needs=cover` |

**`/?needs=cover` now holds exactly 5.** Measured with the route's own
predicate (`NEEDS_COVER` in `packages/db/src/works.ts`,
`(w.cover_url IS NULL OR w.cover_status = 'standin')`) run against production:
it returns 224, 225, 226, 227, 228 and nothing else. That is the Illumicrate
photo job in [`TODO.md`](TODO.md), which is a different item and stays open.

⚠️ **Nobody re-ran the backfill for this closure, and the fills were not this
item's own work.** The 21 rows were already filled when the item was picked up:
all 21 carry `updated_at = 2026-08-18 16:05:56` — **one identical timestamp**,
the signature of `execute()` writing a single batched statement file, about two
hours after the split cleared them at 14:01:22. What is **measured**: no
`change_log` row accompanies the fills (so no human and no API write), no
`research_finding` for a cover field exists that day, `details-sweep.ts` does
not touch covers at all, and the cron fires at minute **:07** not :05. What is
**inferred, not proven**: that the writer was
`scripts/backfill-missing-covers.mjs --remote --commit`, rung 1 (Open Library
by ISBN) — the URL shape `/b/id/{id}-L.jpg` is exactly that rung's
`cover.large`, and the scripts deliberately write no `change_log`.

**Both free rungs re-run as dry runs against production and confirm nothing is
left:**

| Command | Result |
|---|---|
| `node scripts/backfill-work-covers.mjs --remote` | `production: 0 work(s) with a stranded cover` |
| `npm run backfill:missing-covers -- --remote` | `448 work(s), 0 with no cover` / `0 statement(s) to run` — no network calls made |

**No paid rung was run and none is needed.** `--llm` would have had an empty
candidate list; the leftover-for-money set is **zero books, $0.00**.

⚠️ **Neither script could ever have swept 224–228, and this is structural, not
luck.** Both gate their candidate set on `cover_url IS NULL OR cover_url = ''`,
and the Illumicrate rows carry a populated URL — they are on `/?needs=cover`
only via the `cover_status = 'standin'` half of the predicate, which no
backfill script reads. The dry runs above confirmed the write set was empty
before anything was committed.

**Every stored URL was fetched and size-checked, independently of whoever wrote
them.** All 26 rows (the 21 plus the 5 Illumicrate) were run through the repo's
own `verifyCoverUrl` — `?default=false` plus the size floor, the guard against
Open Library's 43-byte 1×1 placeholder-with-HTTP-200. **26 of 26 returned real
images, 31–76 KB each; 0 rejections.** So the failure mode held: "found
nothing", never a dead link.

**Not verified:** which agent or session ran the write at 16:05:56, and whether
the two rungs the ladder skipped (Google Books, Open Library by title) were
reached at all — with rung 1 answering every row, they would not have been.

## 📸 THREE BOOKS WANTED THE OWNER'S OWN PHOTOGRAPH — ✅ ALL THREE CLOSED 2026-08-18

Moved whole from [`TODO.md`](TODO.md). Recorded 2026-08-14/18 as an owner
photograph pass over `/?needs=cover`; **all three rows are now off that list**,
by three different routes, none of them a photograph.

**Measured in production D1 2026-08-18, after the cleanup pack:**

| # | Book | How it closed | Evidence |
|---|---|---|---|
| **376** | Doctrine and Covenants / Pearl of Great Price | **Resolved.** The Real-ESRGAN upscale was accepted and `cover_status` went `standin` → `ok`. | `change_log` **1001**, `changed_how = 'human'`, `changed_by` 1, **13:51:00** |
| **382** | The Holy Bible | **Resolved.** The 1805 KJV stand-in was accepted and `cover_status` went `standin` → `ok`. | `change_log` **1184**, `changed_how = 'human'`, `changed_by` 1, **15:41:43** |
| **439** | Calvin and Hobbes boxed set | **Gone — deleted as a phantom set** in the shelf pass. | `change_log` **1148** |

⚠️ **382's flip carries NO note, and it is the single most recent write in
the whole audit log (id 1184, after the cleanup pack's 1183).** What is
measured is that a human accepted the stand-in, which takes the row off
`NEEDS_COVER`. What is **NOT verified** is *why* — whether the owner decided
the stand-in is good enough permanently, or merely cleared the flag. **If his
own photograph of the 1805 Bible is still wanted, this row will no longer ask
for it**, because nothing on the needs-cover surface tracks it any more. Worth
one question rather than an assumption. 376's flip (1001) is equally
unannotated but far less ambiguous: the upscale was the thing he asked for.

⚠️ **The Illumicrate Percy Jackson photos are a DIFFERENT, still-open item**
and did not move with this one — see `TODO.md`.

The record as it stood while the item was open follows, unedited:

---

`/?needs=cover` is the surface; it holds **8** works, and three of them are
photo jobs rather than research jobs:

| # | Book | Why it is on the list |
|---|---|---|
| **376** | *The Doctrine and Covenants / The Pearl of Great Price* | ⚠️ **Has a cover and still wants a better one.** The live image is this edition's **genuine** jacket (AbeBooks, ISBN 9781591565604) but the only copy that exists anywhere is **213×290**. Real-ESRGAN upscaled it to **639×870** and that is what renders now (`…-bad854eb05c8ede6.jpg`; the 213×290 original is preserved at `…-568492185ac13a7d.jpg` and still served). Owner's words: *"Keep small cover, can we maybe use a service to upscale? Mark it for cover upload too."* |
| **382** | *The Holy Bible* | ⚠️ **Now carries a same-translation STAND-IN, so it still wants the owner's photograph.** No rung can reach this row (hand-typed 1805, no ISBN, no author, no edition), and nothing in the row or its description names a translation — an English Bible printed 1805 is the King James / Authorized Version by overwhelming likelihood. Applied 2026-08-18 on the owner's instruction *"Use any bible photo as long as it's the same version translation as ours."*: the **title page of an actual 1805 KJV** (Morris-Town, N.J., Mann and Douglass; Library of Congress scan, [archive.org/details/holybiblecontain00unse_18](https://archive.org/details/holybiblecontain00unse_18) leaf 9), rehosted to R2 as `…holy-bible-unknown-2cb82b7d18deab63.jpg`. The page's own wording — *"translated out of the original tongues, and with the former translations diligently compared and revised"* — **is** the Authorized Version formula, so the image evidences its own translation. `cover_status='standin'` per 0040. Owner can correct if his copy is rarer (Douay-Rheims etc.). |
| **439** | *Calvin and Hobbes* boxed set | No cover any rung can reach. |

⚠️ **376 carries `cover_status = 'standin'` for the MACHINERY, not for the
word.** `coverNeeded` / `NEEDS_COVER` are `cover_url IS NULL OR cover_status =
'standin'`, so that value is the *only* one that keeps an image rendering while
keeping the book on the "cover needed" list — migration 0040's Illumicrate
trick, used here for a different reason. **The cover is not the wrong book.**

⚠️ **Known copy gap, deliberately not fixed here.** `CoverPanel` states the
stand-in case as *"the image above is not this book's own cover"*, which is
false for 376 — the schema has no value for "right cover, too small". Either a
fourth `cover_status` (`'lowres'`, feeding the same `NEEDS_COVER`) or softer
panel copy would close it; both touch `apps/web` and were left to whoever owns
those files.

## 🧹 THE CLEANUP PACK — ✅ DONE 2026-08-18

Owner approved verbatim: *"Yes to the clean up pack"*. Four items, each of
which had been left open by an earlier pass **on purpose** rather than missed.

### 1. Work 435 — the withdrawn verdict

`gap_verdict` 249 recorded `seriesIndex = 'unknown'` (run 594, `decided_how
auto`), sourced to Goodreads numbering that contradicts itself — #0 in one
place, #1 in another. The owner had already ruled on it during the shelf pass:
**"Author says 0 it's 0"**, recorded as `change_log` 1130/1131
(`seriesIndexDisplay "0"`, `seriesIndexSort 0`). The verdict was therefore
**superseded, not wrong-at-the-time**, and was withdrawn the way the queue's
own Undo does it: `DELETE` guarded on `decided_how = 'auto'`, plus
`research_finding` 1065 marked `rejected` (`reviewed_by` NULL, `decided_how`
human) — the pair `revertFinding` writes.

⚠️ **Recorded by hand as `change_log` 1181, because
`deleteGapVerdict`/`deleteAutoVerdict` write no `change_log` row at all.** A
verdict can otherwise vanish leaving no trace that it ever existed, which is
the shape of bug that makes a later audit unable to tell "never decided" from
"decided and withdrawn".

### 2. Work 435 — the title de-decorated, as a key move

`"Naiya and the Foxdragon (The Isles of Antarah, #1)"` → **`"Naiya and the
Foxdragon"`** (`change_log` 1182, `work_key` move 1183).

The stripped parenthetical is a **Goodreads-style listing decoration, not part
of the title**: Goodreads `/book/show/50498354` renders `<h1>Naiya and the
Foxdragon</h1>` and labels the volume **#0**, and Google Books volume
`XxaPzQEACAAJ` — the source of this work's stored `cover_url` — also says #0.
So the stored `#1` was **wrong twice over**, and the series already lives in
`work.series` where it belongs. Read live 2026-08-18.

**Treated as a migration, not an edit**, because `title` derives `work_key` and
`bookIdFromTitle`. Measured before the write: **28 Firestore probes
(positive-controlled) and every title-keyed D1 table returned zero.** Nothing
to carry, nothing to orphan, so **no `work_alias`** — the same test
`scripts/strip-mm-suffix.mjs` applies, and the `work_key` note is exactly
`reviews restamped: 0` for the reason set out in the title-migration entry
below.

**Not verified:** Open Library has nothing for ISBN 9781734774511 or for the
title, and the Google Books API was quota-exhausted at the time of the write.
The two sources above are what the call rests on. `series` untouched.

### 3. Sun and the Star resolves — the fourth Riordanverse label

`catalog-platform` **`e9df6a0`** adds `"The Nico di Angelo Adventures"` to
Riordanverse. `a7beeba` had left this one open **deliberately** — it was not in
that brief — and the cleanup pack names it as item 4, so it is owner-approved
and closed.

⚠️ **NOT a spelling fold.** The two labels share no words, so
`normaliseUniverseText` could never bridge them; it is an add-series in the
shape `The Trials of Apollo` took in `a7beeba`. It differs in the direction
that matters: **no new book enters the universe**, because work 456 was already
claimed under `"From the World of Percy Jackson"` — Riordanverse's own notes
name it. What it adds is a forward claim on future Nico di Angelo Adventures
volumes, which is correct: the imprint is Camp Half-Blood continuity by
construction. `validate` clean, 43 fixtures pass.

### 4. The backfill stamped 16 works

`npm run backfill:universes -- --remote --commit`, after the two list commits.
**Measured in production D1 2026-08-18, every row `universe_how = 'list'`:**

| series (the D1 spelling) | works | universe |
|---|---|---|
| `Skyward` | 5 | **Cytoverse** |
| `The Heroes of Olympus` | 5 | **Riordanverse** |
| `The Trials of Apollo` | 5 | **Riordanverse** |
| `The Nico di Angelo Adventures` | 1 | **Riordanverse** |
| | **16** | |

Every one of these resolved to **no universe** before the two commits. The
backfill touches nothing where `universe_how = 'human'`, including
`universe IS NULL AND universe_how = 'human'` — a person saying *this book is
in no verse* — which is the whole reason the `how` column exists.

⚠️ **The backfill writes NO `change_log` rows**, by design: it is a machine
re-resolution, not a decision. So its work is evidenced by the resulting state
above and by the script's own output, not by the audit log. Anyone auditing
this later should count rows, not look for entries.

---

## 📚 THE SHELF PASS — ✅ DONE 2026-08-18

The owner walked the physical shelf and relayed what the covers actually say.
Seven strands, all of which needed the object in hand rather than a lookup.

### 1. Fourteen volume numbers, read off the covers

`changed_how = 'human'`, note `"owner read the cover (2026-08-18 shelf pass,
relayed)"` — `change_log` 1002 and 1118–1131.

| work | book | number |
|---|---|---|
| 389 | Fletch's Fortune | Book 3 |
| 436 | Calvin & Hobbes | 1 |
| 440 | Yukon Ho! | 3 |
| 441 | Weirdos from Another Planet | 4 |
| 438 | The revenge of the baby-sat | 5 |
| 437 | …Deranged Mutant Killer Monster Snow Goons | 7 |
| 411 | Edgedancer | 2.5 |
| 410 | Dawnshard | 3.5 |
| 406 | Lyra's Oxford | 3.5 |
| 444 | Harry Potter and the Cursed Child | 8 |
| 456 | The Sun and the Star | 1 |
| 408 | Treasures from grandma | 4 |
| 390 | Blues Brothers | 1 |
| 435 | Naiya and the Foxdragon | **0** |

⚠️ **435's zero is a ruling, not a reading** — *"Author says 0 it's 0"* — and
it settles `gap_verdict` 249, which had recorded `unknown` on the conflicting
Goodreads #0/#1 numbering. It is the only row here that also moved
`seriesIndexSort` (1131). The verdict itself was withdrawn in the cleanup pack
above.

### 2. The Harry Potter and Percy Jackson boxes — 10 member copies, 2 set rows retired

Owner's order 2026-08-18: **"We need to break all the box sets up, that's a
layer I don't want to deal with."**

| set row | asked | answered | became |
|---|---|---|---|
| **443** Harry Potter Paperback Boxed Set (Books 1-5) | does the box duplicate the loose books? | **"2 a second set"** | 5 copies on works 347, 449, 448, 334, 447 |
| **453** Percy Jackson boxed set | is this the Illumicrate set? | **"Percy Jackson is another set not the crate ones."** | 5 copies on works 224, 225, 226, 227, 228 |

Both set rows are **deleted**; ten copies exist that did not before. The
owner's two answers are what makes this addition rather than deduplication —
the loose Harry Potter 1–7 plus Cursed Child were typed in during the
2026-08-18 05:11–05:13 session and the box was typed in the same session as a
separate object, and the five Percy Jackson works already carry the
Illumicrate editions.

⚠️ **The set barcode is not lost.** `9780439682589` is preserved in every
member edition's `edition_name` and in the copy notes — the slipcase precedent
from works 280, 298 and 349–355 (2026-08-13). An ISBN on a member row would
claim the box's barcode belongs to one volume, which is false.

⚠️ **A copy had to be removed before each work could be deleted**
(`change_log` 1174 and the HP equivalent): the delete route refuses while any
copy records property (`copyBlocksDeletion`; work **#139** is the lesson).
Both were logged whole-row first, so the deletion is reversible from the audit
log.

**Not verified:** Open Library `/books/OL7514736M` (Scholastic, 1 Oct 2004)
records **no** `physical_format` for the HP set; `paperback` was taken from the
set's own title, which says Paperback.

### 3. Work 439 deleted — a phantom set

`"Calvin and Hobbes SET (Attack of the Deranged…)"` was hand-entered by title
in the 2026-08-18 05:09 add session and was **alone among that session's
set-shaped rows in carrying NO edition and NO ISBN**. The four titles it named
are all accounted for elsewhere: 437 Snow Goons, 438 Revenge of the Baby-Sat,
440 Yukon Ho! as their own rows, and *Something Under the Bed Is Drooling*
owned only inside the treasury at work 425. Owner ruling: **"I don't own any
more Calvin and Hobbes that aren't scanned. Use the omnibuses."**
`reviews_seen_count` was 0, observed 2026-08-18 14:07:57.

⚠️ **Cascade casualties the delete route does NOT log, recorded by hand in
`change_log` 1148:** `work_watch` #5 (resolved first — its note read *"RESCAN
THIS ROW… Check the physical object, then retitle this row to what it really
is or remove it"*, which this pass is the answer to), 1 `gap_verdict`, and 2
`research_run` rows. Copy 351 was removed first and logged whole-row.

### 4. The treasuries say what they contain

Two `work_relation` `contains` rows — **425 → 436** and **426 → 438** — plus
`edition.collects` prose on editions 549 and 550.

⚠️ **The prose is not redundant with the relation; it carries what the relation
structurally cannot.** `work_relation.to_work_id` is `NOT NULL REFERENCES
work(id)`, so a member with no work row of its own **cannot be named by a
relation at all** — and minting an ownerless work to satisfy the link would put
a book on the shelf that is not there. So *Something Under the Bed Is Drooling*
(inside 425) and *Scientific Progress Goes "Boink"* (inside 426) live in
`collects` as sentences. Same idiom as edition 191 and the White Sand omnibus
in migration 0060.

### 5. Work 426's author — a key move

`"William Patterson"` → **`"Bill Watterson"`** (`change_log` 1132).

"William Patterson" was never the author of any Calvin and Hobbes book, and
**the row's own description — auto-filled 2026-08-18 05:22:45 — already named
Watterson**. Open Library gives ISBN 9781449437077 the same title with
Watterson as author (`/books/OL26682030M`). The other treasury typed in the
same minute (work 425) was filed under Bill Watterson correctly, so this is a
**single mistyped row, not a systematic import** — worth stating, because the
two conclusions call for very different follow-up.

⚠️ **This MOVES `work_key`** (it is derived from author as well as title).
The **title is unchanged**, so every `bookIdFromTitle`-derived Firestore
document id — `reviews`, `readingLists`, `user_content_warnings` — is
untouched. The two halves of the key surface move independently; this is the
case where only one does.

### 6. Four Calvin and Hobbes editions backfilled from Open Library

| work | ISBN | Open Library | source |
|---|---|---|---|
| 437 Snow Goons | 9780836218831 | `/books/OL24300482M` | Andrews McMeel 1992, **Paperback**, 128pp |
| 438 Revenge of the Baby-Sat | 9780836218664 | `/books/OL1898651M` | Andrews and McMeel 1991, 127pp |
| 440 Yukon Ho! | 9780836218350 | `/books/OL2070394M` | Andrews and McMeel 1989, 126pp |
| 441 Weirdos from Another Planet | 9780836218626 | `/books/OL2229702M` | Andrews McMeel 1990, **Paperback**, 127pp |

⚠️ **Not verified, and marked as such in the rows themselves:** Open Library
records **no `physical_format`** for 438 and 440. Both were recorded as
`paperback` — the format Andrews McMeel published these collections in —
**inferred, NOT read off the object.** 441's ISBN was researched during this
pass; the brief carried none.

### 7. Three universe spellings, so the split box sets resolve

`catalog-platform` **`a7beeba`**. The box-set split turned five set rows into
fifteen works, and fifteen of them landed with **no universe**, because the
series strings D1 stores are not the strings the shared list spells.

| universe | added | kind |
|---|---|---|
| Riordanverse | `"The Heroes of Olympus"` | spelling of `"Heroes Of Olympus"` |
| Riordanverse | `"The Trials of Apollo"` | ⚠️ **NEW membership, not a spelling** |
| Cytoverse | `"Skyward"` | spelling of `"The Skyward Series"` |

⚠️ **`normaliseUniverseText` keeps leading articles ON PURPOSE**, so
`"Heroes Of Olympus"` could never match `"The Heroes of Olympus"` — the fix is
to **add the sibling spelling, never to override the owner's**. The Trials of
Apollo is flagged as a membership call rather than a fold because the series
was not on the list under any spelling; it is Camp Half-Blood continuity, the
same claim already made for the three listed series. `validate` clean, 43
fixtures pass. Consumers pick it up on their next build — this repo's
`prebuild` / `pretest` / `pretypecheck` sync.

---

## 🔑 TWO TITLE-CORRECTION MIGRATIONS (works 428, 390) — ✅ DONE 2026-08-18

Owner confirmed, verbatim: *"Confirm"*, after the details fill surfaced two
works filed under a string that was not the book's title.

| work | was | now | ISBN | evidence |
|---|---|---|---|---|
| 428 | `A Series of Unfortunate Events` (the SERIES name) | **The Miserable Mill** | 9780064407694 | HarperCollins/lemonysnicket.com publish this ISBN as *"A Series of Unfortunate Events #4: The Miserable Mill"*; `research_finding` 1019/1021 (run 550, tier **official**). The description already in D1 was the real book's. |
| 390 | `Drake And Josh: Chapter Book` (the imprint descriptor) | **Blues Brothers** | 9780439831628 | Open Library gives this ISBN the subtitle *"Blues Brothers (Teenick)"*; Scholastic Teenick chapter book **1**. `research_finding` 989/990 (run 523). |

⚠️ **Work 391 (`Sibling revelry`, 9780439831635, Drake & Josh #2) is a
DIFFERENT book and was not touched** — verified unchanged before and after.

### Treated as a migration, not an edit

`title` derives `work_key` (the Firestore review bridge) and
`bookIdFromTitle(title)` (the doc-id half of `reviews`, `readingLists`,
`user_content_warnings`). The whole dependent surface was **measured before the
write**, and every title-keyed store was empty:

* D1 per work — `user_book` 0, `work_alias` 0, `work_relation` 0,
  `audiobook_holding` 0, `ebook_holding` 0, `work_watch` 0, `gap_verdict` 0.
  (`edition`/`copy`/`research_finding`/`change_log` rows exist but hang off
  `work_id` and are title-blind.)
* Firestore, live over the REST API on both lanes of `reviews`,
  `readingLists`, `user_content_warnings` and `cw_requests` — **0 documents**
  under the old bookId, the new bookId, the old workKey or the new workKey.
  Probes positive-controlled against a known-populated key first, so the zero
  is measured, not a broken query.
* `keyMoveEvidence` said no reviews for either work (428 even carried a live
  browser check: `reviews_seen_count = 0` at 2026-08-18 06:21:49).

So there was nothing to carry and nothing to orphan — the same test
`scripts/strip-mm-suffix.mjs` applies.

### ⚠️ No `work_alias` was left behind, deliberately

The repo's alias-over-orphan pattern exists to keep an OLD KEY resolving. Here
nothing resolved to the old strings (0 documents, 0 aliases, 0 holdings), and
both old strings are **generic**: `A Series of Unfortunate Events` is the series
name (aliasing it to book 4 would capture books 1–13 on any future ingest) and
`Drake And Josh: Chapter Book` is the imprint descriptor shared with work 391.
`work_alias` is read by ingest, scan-jobs, enrich and the audiobook matcher, so
either alias would have been a mis-match waiting to happen. Say so out loud if
one is ever wanted anyway — it is one INSERT.

### ⚠️ The `work_key` change_log note is EXACTLY `reviews restamped: 0`

`keyMoveEvidence` counts a carried move as
`note LIKE 'reviews restamped: %' AND note <> 'reviews restamped: 0'`.
Appending any explanation to that string would make a zero-review move look
like evidence that reviews exist, and would raise the evidence floor against
the next legitimate move. The rationale therefore lives on the `title` row's
note instead. Four `change_log` rows written, two per work, one `batch_id`
each — the shape `updateWork` writes.

### Verified live

`/work/428` renders **The Miserable Mill** with the description that already
made sense for it; `/work/390` renders **Blues Brothers**; `/work/391` still
`Sibling revelry`. `/series/Drake & Josh` reads *1 Blues Brothers, 2 Sibling
revelry*; `/series/A Series of Unfortunate Events` now reads *book 4 = The
Miserable Mill* with 1–3 as gaps instead of the series name occupying slot 4.
Content-notes and reviews surfaces answer on both pages. The estate index
re-pushed at 13:44:16Z, after the 13:42:05Z write.

**Not fixed, noticed in passing:** work 390 has `series_index_sort = 1` but
`series_index_display = NULL`, so its page shows "Drake & Josh" with no number
while 391 shows "2". Cosmetic, moves no key.

## 📖 "RECENTLY ADDED" IS THE PHYSICAL SHELF — ✅ DONE 2026-08-18

Owner ask, verbatim: *"in the library site its showing recently added for
ebooks, remove those. this should just be physical books now since we have an
ebook site."*

### The measured mechanism — nothing was broken, a phase simply has not run

The strip asks `/api/collection?sort=added&dir=desc&pageSize=10` with **no
format narrowing at all**, and the ebook rows it returned are **real rows in
this catalog's own D1** — the 2026-08-09 Calibre-Web import, 127 `ebook_epub`
editions across 126 works, **94 of them ebook-only**. They were not estate-index
rows leaking in and they were not created by the cross-catalog linking.

They are still here because **`ebook-split-design.md` phase 5 (export + prune)
has not run** — phases 1–4 shipped, ebooks moved to ebooks.heygabi.ai, and the
library's rows were meant to be deleted after an export ceremony that nobody has
performed. Sorted newest-first the strip was showing "All The Skills" ebooks from
2026-08-14 alongside the morning's real books.

### The fix: filter the view, delete nothing

`EBOOK_ONLY_CLAUSE` in `packages/db/src/works.ts`, reached by
`?ebookOnly=hide`. The strip asks for it; **See all** sets it too, so the list
it opens is the same list. `Clear` turns it off, and a line above the results
says what is narrowed with a one-click "Show them here too".

⚠️ **The predicate is NOT `medium=physical`, and that is the whole trap.**
`MEDIUM_CLAUSE.physical` asks whether a physical *edition row* exists; measured
that morning, **6 works had no edition row at all and a copy anyway — 5 of them
catalogued in the hour this shipped**, because `copy.work_id` is denormalised so
a spine photo can create a copy before anybody types the printing in. The
obvious filter would have hidden the owner's newest books to remove two ebooks.
So the clause uses the split design's own definition — **an ebook edition, no
physical edition, and no copy** — which excludes only what is provably ebook-only
and fails towards *showing* a row.

**Census, 2026-08-18 04:55Z:** 387 works · 287 with a physical edition · 6 with
no edition row · **94 ebook-only** · 127 ebook editions · **293 shown**.
287 + 6 = 293 = 387 − 94. The friend instance measured **6 works, 0 ebook
editions** — the change is a no-op there, exactly as the design predicted
(her instance never set `EBOOK_INGEST_TOKEN`).

### Verified

- **Exercised end-to-end against a real database**, not reasoned about. The
  local D1 is 116 works of which 114 are ebook-only: unfiltered returned 116,
  `?ebookOnly=hide` returned **2** — and both survivors were the interesting
  case, a `wanted` copy on a work whose only edition is an EPUB.
- `packages/db/test/ebook-only-clause.test.ts` runs the **shipped SQL text**
  against `node:sqlite` (a new `packages/db/test/` lane, added to `npm test`).
- Suites **1226 green** (was 1215), typecheck clean, UTF-8 sweep clean.

### What was deliberately NOT changed

The collection grid, the `Format` facet, `/stats` counts, search, series and
universe pages all still see every row. Those rows feed `ebook_holding`, the
"also as an ebook" chip and the cross-catalog joins, and the owner's standing
decision on search stands. Making the whole site physical-only is one more line
and is **a question for him**, recorded in [`TODO.md`](TODO.md)'s ebook-split
section beside the phase 5 that should do it properly.

## 🤖 GABI'S DELEGATED DOOR — SHE WRITES WITH THE ASKER'S OWN ROLE — ✅ DONE 2026-08-18

The library half of the estate's **GABI Tier 1** build. Owner ask 2026-08-17,
verbatim: *"Can I dm her an isbn or a photo and she adds it to the catalog?"*
and *"Hey Gabi, fix all my missing details… Hey @Sam i went ahead and fixed all
your missing stuff."* Approved as Tier 1 of the T0–T4 ladder (*"that looks good,
start with that"*, then *"all of it"*): **additive writes with easy undo,
auto-apply then report.**

Design of record: `catalog-platform/docs/info/gabi-application-map.md` §2a–2d.
Operational reference: [`access/gabi-delegated.md`](access/gabi-delegated.md).

**Shipped** (`5b4b860`; deployed both instances — main `7fdbe01b`, friend
`5886875e`):

- `POST /api/gabi/delegated/{whoami,add-isbn,run-details}`, mounted **before
  `requireAuth`** as the fourth machine route. Bearer-gated on
  `ESTATE_APP_TOKEN_DISCORD` (one value, THREE holders, same name — the
  `DONOR_TOKEN` idiom).
- ⚠️ **The bearer authorises no write.** It proves only that the caller is the
  estate's Discord Worker. Every writing verb then resolves the on-behalf-of
  Firebase uid to an `app_user` row **on this instance** and checks that
  person's own capability — `editCatalog` to add, `runResearch` to sweep, the
  same one the equivalent button is gated on.
- Four refusal causes, four sentences, because they need four different fixes:
  no account here / estate-revoked / awaiting approval / role too low. Plus a
  worded 503 when the secret is unset and a worded 401 when the bearer is wrong
  — ⚠️ deliberately NOT `/api/donor`'s blank 404, because these refusals are
  relayed into a Discord message where a silent 404 reads as GABI saying nothing.
- `packages/db`: `findUserByFirebaseUid` — **a lookup, never a create**. The
  asymmetry is the point: this door must never be able to mint standing.
- `lib/details-sweep.ts` gained `SweepOptions.triggeredBy` — ONE implementation,
  the cron still passing `null`, the delegated tick passing the asker's id. It
  travels into `gap_verdict.decided_by` and `research_finding.reviewed_by`
  exactly as a person's Run button already does.

**Provenance and undo.** `add-isbn` stamps `Actor{ userId: <asker>,
how: 'auto', note: 'gabi-discord: …' }`, so `SELECT * FROM change_log WHERE note
LIKE 'gabi-discord%'` is the whole of what she has ever added; `run-details`
stamps `research_run.triggered_by`. The queue page's existing **auto-applied →
Undo** list is the undo, unchanged and already built.

⚠️ **What it deliberately will NOT do.** A barcode whose book is already on the
shelf raises the four-way rescan question (`@lc/core/rescan.ts`) or the
pre-order question. Nothing the catalog knows can tell those apart — this repo
already carries residue from the version that guessed — so both are handed back
**with nothing written**. They are T2 mutations and the confirm lane does not
exist. Auto-apply is bounded to the genuinely additive cases: a new book (work +
printing + copy), or a first physical printing on a work that had none.

**Verified live 2026-08-18** on both instances: every verb answers a worded 401
unauthenticated; with the real bearer, `whoami` answers `200 {known:false}` and
`add-isbn` answers `403 unknown_here` with a sentence naming the site to sign in
on. `/api/health` reports `gabi.delegated: true` on both. 1,200 tests pass,
typecheck clean.

⚠️ **NOT verified:** no real Discord DM has driven this end to end, so no
`change_log` row wearing `gabi-discord` exists in production yet. That needs the
owner and a Discord client — the exact messages to send are in
`catalog-platform/docs/access/discord-bot.md` §13.4.

## 🔗 A LINK CAN CARRY THE QUESTION INTO THE GABI PANEL — ✅ DONE 2026-08-18

The panel half of Discord's `/gabi` deep link, recorded as panel work in
[`info/gabi-fixer-design.md`](info/gabi-fixer-design.md) §10.2 (which is
updated in place, since it is the living design). Shape (b) — *propose and
deep link* — shipped with a link that carried **no question**, so the asker
landed on an empty box and retyped what they had just typed in Discord.

**Shipped** (`8745191`, deployed to both instances — `4b881b74` main,
`8965a8a4` friend; same bundle `index-BStS9t-N.js` verified live on both):

| File | What |
|---|---|
| `apps/web/src/lib/gabi-deeplink.ts` | DOM-free parse + strip; the parameter named once |
| `apps/web/src/App.tsx` | reads it once from the opening URL, opens the panel, strips it |
| `apps/web/src/components/GabiPanel.tsx` | seeds `draft`, focuses at the end, never sends |
| `apps/web/test/gabi-deeplink.test.ts` | 15 tests |

### ⚠️ THE PARAMETER IS `gabi`, NOT `q` — a measurement, not a preference

The design named `?q=`, written before anybody read this app's router. `q` is
**already taken, on the exact route the deep link points at**:
`router.tsx` `parseCollection()` reads it as the collection's own server-side
search and `parse()` maps `/` to the collection, so
`…/?q=the+Sanderson+one+with+the+wrong+cover` would prefill the panel **and**
filter the book list to a sentence no title matches — an empty catalogue under
a floating panel, a link looking broken at the moment it worked.
`parseSeriesList()` reads `q` too, so it is not one route's problem.

⚠️ **The first test in the file is a regression guard**: `?q=` must NOT
prefill, so a later "fix" back to the parameter the doc used to name fails
instead of shipping.

**Four properties that will otherwise be undone by a well-meaning edit:**

1. **It prefills; it never sends.** A link that fired a model call on arrival
   would spend the instance's Anthropic key on a click, with no chance to fix
   a question Discord mangled or a link somebody else forwarded.
2. **Once only.** `App.tsx` strips the parameter with `replaceUrl` (no history
   entry, no popstate — Back still leaves the site), and the panel refuses to
   write over a non-empty box, so a reload or a restored PWA tab cannot
   re-seed on top of what was typed since.
3. **Every other parameter survives the strip, in order.** The panel is global
   — rendered outside the route switch — so a future link may legitimately
   point at a filtered collection or a series ladder.
4. **The dead end gets words.** Somebody who followed a link carrying a
   question but holds neither `GABI_PANEL` nor `runResearch` would otherwise
   meet silence and read it as a broken page. The message names *which* of the
   two gates is shut, and appears **only** when a question actually arrived —
   the ordinary visitor still sees no control they cannot use.

Also here: whitespace collapsed (a Discord copy-paste arrives ragged), 500-char
ceiling, and the focus is a **second** `useEffect` on purpose — the input is
controlled, so its DOM value is still empty inside the effect that seeds it,
and placing the caret there would put it at index 0 of an empty box.

🧑 **STILL OWED, in the OTHER repo:** `panelDeepLink()` in
`catalog-platform/apps/discord-worker/src/gabi.ts` still emits a bare `/`. One
line plus a discord-worker deploy. Until then the panel reads a parameter
nothing sends — the harmless direction; the reverse is the "link that silently
lies" the design refused to ship, which is why the panel half went first.

⚠️ **NOT VERIFIED — needs the owner's eyes.** The live bundles were confirmed
to CONTAIN the code (cache-busted fetch of `index-BStS9t-N.js` on both hosts),
which is not the same as seeing it work: the panel only renders for a
signed-in account holding `runResearch`. **Open
<https://padhard.heygabi.ai/?gabi=what%20still%20needs%20fixing> signed in**
— the panel should open with *"what still needs fixing"* already in the box,
nothing sent, the `?gabi=` gone from the address bar, and the collection
behind it unfiltered.

## 🔑 TBR keyed to the ACCOUNT, not the display name — ✅ DONE 2026-08-18

The owner, verbatim, in answer to the measured finding that
`readingLists/{displayNameLower}_{bookId}` lets two members who share a
display name read and delete each other's lists:

> *"Make tbr keyed to account"*

**The full record is [`info/tbr.md`](info/tbr.md) §8** — the measurement, the
two-lane rules model, the three stores that turned out NOT to map a name to an
account, and the removal condition. This entry is the landing note.

| | |
|---|---|
| New id | `readingLists/{uid}_{bookId}` + a `uid` field (`positionDocId`'s idiom) |
| Measured population | 234 prod documents; `readingLists_dev` **0** |
| Migratable | **181** · ambiguous **0** · **unmappable 53** |
| Live rules smoke | **17/17**, both lanes |
| Tests | audiobook 1,247 pytest + 712 vitest; library **1,178** |

⚠️ **The 53** belong to one retired v1 passphrase account with no Firebase
identity. The migration **refuses to guess an owner** for a reading list, so
they keep the old id and the old shape-only rules. All 53 are `status: 'read'`,
so **no live to-read entry was left behind**.

⚠️ **The prod 181-document move has NOT been applied.** It rides
`audiobook_catalog`'s next promote, with the client code that reads the new id
— applying it first would leave that site's live per-book button reading an id
that no longer exists. Command, from `audiobook_catalog`:

```bash
python scripts/migrate_tbr_to_uid.py            # report — writes nothing
python scripts/migrate_tbr_to_uid.py --apply    # the move, ON PROMOTE DAY
```

⚠️ **Superseded three statements in `info/tbr.md`** (§1's "no rules change was
needed", §1's id row, §2's "neither may be harmonised"). §2 was right that
changing a persisted key orphans documents and wrong that this made the key
permanent — the answer is to move the documents.

**Left open on purpose:** browsing *another* person's list is still
name-addressed (nothing listable maps a name to an account), which is a public
read-only view — two name-sharers' public lists read as one, but neither can
write or delete the other's.

---

## 📌 Copy trimmed across the web app — ✅ DONE 2026-08-17

**Estate-wide ask, landed the session it was raised, so it never sat in
`TODO.md`.** The owner, verbatim:

> *"Let's trim text like this all over each of the sites. Only keep what's
> mandatory and keep all the text short and useful"*

Raised after he trimmed heygabi.ai/admin's header himself ("I think what we have
is self explanatory"); `catalog-platform` commit `204fb9d` is the precedent this
followed — prose out, home-of-record named in a comment beside the cut, string
pins updated in the same commit.

**Trimmed here** (8 blocks, 323 → 196 visible words, −39%):
`apps/web/src/pages/DetailsQueuePage.tsx` (the "four questions" intro, the
lookup-writes notice, the spend footnote, the answered-vs-to-ask definition),
`apps/web/src/pages/ExportPage.tsx` (backup, spreadsheet and privacy notes),
`apps/web/src/pages/ScanPage.tsx` (the camera refusal — only the repo path
`docs/info/ios-camera.md` came out, which meant nothing to somebody reading it
on a phone).

**Deliberately NOT trimmed, and the reason is the rule:** every empty state
(`TbrPage`, `WishlistPage`, `SeriesPage`, `ScanJobsPage`, `CollectionPage`,
`Accessories`, `Aliases`, `Copies`, `Watches`, `CoverPanel`, `CoverSwap`,
`Related`), every worded refusal and gate (`App.tsx`'s signed-out and
waiting-for-approval screens, `PeoplePage`'s read-only notice and pending
banner, `EstateSearch`'s degraded-search sentence), the cross-site honesty lines
(`Tbr`, `Reviews`, `CollectionPage`'s read-sync notice), the per-photo cost
disclosure on `ScanPage`, and the "flattened view, not the database" and
"estimate is tokens only" markers. A short refusal is not padding.

**Pins:** none. `apps/web/test/*.ts` pins refusal and error wording
(`content-notes`, `errors`, `ebook-shadow`, `gabi-executor`) — none of it
touched. Grepped every removed string across `apps/`, `packages/` and `scripts/`
before cutting; no assertion named any of them. 1,166 tests pass, typecheck
clean, UTF-8 sweep clean.

⚠️ **Both instances need a deploy.** The two hosts run separate Workers built
from the same `apps/web/dist` (see [`access/second-instance.md`](access/second-instance.md)),
so `npm run deploy` reaches `library.heygabi.ai` and `npm run deploy:friend`
reaches `padhard.heygabi.ai`. One code change, two deploys — a main-only deploy
leaves padhard on the old copy.

## 📌 Content warnings unified across every edition and format — ✅ DONE 2026-08-17

**New ask, landed the same session it was raised, so it never sat in
`TODO.md`.** The owner, verbatim:

> *"lets also move all content warnings from audiobooks to physical books and
> not relook them up. and make sure any edition has the same content warnings."*

**The defect.** The content-warning bridge shipped earlier the same day keyed on
`audiobook_holding.title`, believing it to be the audiobook catalog's own
spelling. Migration 0010's header says otherwise — that column is stored already
stripped by `cleanTitleWithSeries`. The raw string *was* computed, in
`scripts/lib/audiobooks.mjs` as `rawTitle`, and dropped at the D1 boundary.
`catalog.csv` says *"Onyx Storm - Empyrean, Book 3"*; we keyed on *"Onyx
Storm"*. The published file and the audiobook site's own book page are both keyed
on the former, and the ebook shelf publishes it per manifest row as
`audiobook_title` — so a paperback and an ebook of one book filed under two
different ids.

**Measured, production D1 + the live `content_warnings.json`:**

| | Before | After |
|---|---|---|
| holdings reaching a published entry | 15 | **32** |
| published warning labels surfaced | 57 | **164** |
| holdings writing the audiobook catalog's own key | 36 | **90** |
| …previously siloed under a different slug | — | **54** |

**Alias, not rekey.** All four Firestore collections re-measured empty over REST,
so no persisted id moved; and `WarningKeys.bookIds` is a union, so the old
cleaned-title slug stays in the read set forever and nothing filed under it can
be orphaned. A separate alias table was refused: the mapping already exists, one
row per work, with `matched_via` / `title_similarity` / `via_alias` stored and
printed by the backfill.

**The queue.** `audiobook_catalog`'s `fetch_content_warnings.py` gained a
two-rung dedupe at the one choke point every request producer flows through, so
a work already answered under another spelling is carried across rather than
re-researched. No fifth title-fold was written — it reuses that file's own
`main_title()` plus the catalog's author column, and refuses ambiguity (5 of
1,069 buckets, dropped). ⚠️ The title-only rung is the one the real queue lands
on, and the first draft lacked it: `cw_requests` documents carry no author, so
the author-gated rung fired on nothing. Caught by running it, not reading it.

**Proof.** `GET /api/warnings/:id/keys` for *Onyx Storm (The Empyrean)* answers
`writeBookId: "onyx-storm-empyrean-book-3"` with the old `onyx-storm` retained as
a read alias, and `publishedTitle` now resolves 10 live warnings where the old
key resolved none (that key is not in the file at all). The queue proof ran the
real fulfiller with the source chain replaced by a tripwire: 4 requests, **0
lookups**, idempotent on a second run. 1,166 library tests and 1,203 audiobook
tests pass; the join test watched failing on its mutation (6 red) and green on
revert.

- library `e2e46d3`, migration 0340 applied to **both** instances' D1, deployed
  `bd72dbcf`
- audiobook `17ec82d`
- design of record: [`info/content-warnings.md`](info/content-warnings.md) §9,
  which also **corrects §2** rather than quietly rewriting it
- ⚠️ still open, in §10: `content_warnings.json` is not back-swept (the dedupe
  fires on the next request/sync); the *Space Knight* `work_alias` over-share;
  and the signed-in round trip remains unverified

### ⚠️ Two of those three are now answered — 2026-08-17, same evening

- **The *Space Knight* over-share was a false premise and is CLOSED**, with no
  data change. #249 and #250 already resolve to *different* audiobook rows
  (`raw_title` "Space Knight" vs "Space Knight, Book 2"), so their published
  warnings already differ; `work_alias` row 26 was left in place, deliberately.
  Measurements, the volume-rule proof and the residual that *is* still open (a
  read-set collision in `bookIds`, code not data, 0 documents affected) are in
  `info/content-warnings.md` §9's *"THE OVER-SHARE ABOVE DOES NOT EXIST"* and
  the rewritten §10 bullet.
- **The signed-in round trip is no longer wholly unverified.** Both panels were
  read on the live pages while signed in — `/work/249` shows *"Published sources
  have been checked for this book and listed none"*, `/work/250` shows no
  published line and names *"Space Knight, Book 2"* as its write spelling. ⚠️
  The **write** half (adding and deleting a note) is still unexercised; only the
  read path and the derived keys were confirmed.

## 📌 foliate-js pinned to a commit — ✅ DONE 2026-08-17 (viewer phase 2)

**Moved whole from `TODO.md`'s tech-debt list, not summarised.** The item as it
stood:

> - **foliate-js is unpinned (`@main`)** in the EPUB probe findings — MUST be
>   pinned to a commit when the real EPUB reader build starts (the findings
>   doc says so; listed here so it survives until that build).

**It did survive until that build, which is the whole reason the line existed.**
Viewer phase 2 (`audiobook_catalog` `70fb145`) vendored foliate-js at commit
**`78914aef4466eb960965702401634c2cb348e9b1`** (2026-05-01, MIT), self-hosted at
`site/static/foliate/`, with `@zip.js/zip.js` pinned alongside at the **2.7.45**
the probe measured. The pin is enforced by a test rather than by a docstring
(`tests/test_reader_page.py::FOLIATE_COMMIT`), and
`site/static/foliate/VENDORED.md` carries the update procedure.

⚠️ **The probe's numbers survived the pin by luck, not by design.** `78914ae`
*was* `main` on the probe date — it is the repository's newest commit and
nothing landed between — so the measured bytes and the shipped bytes are
identical. A probe run a week later would have measured something no pin could
recover. The generalisable form: **an unpinned measurement has a shelf life, and
nobody knows how long it is until they try to cash it in.**

Closed in [`info/epub-streaming-findings-2026-08-17.md`](info/epub-streaming-findings-2026-08-17.md)
§7, whose §8 now records what the build measured against what the probe
predicted.

## 💸 A spend cap printed its JSON at a person — ✅ FIXED + DEPLOYED 2026-08-17

⚠️ **Never in `TODO.md`** — the owner hit it live and reported it directly, so
it is recorded here at completion rather than moved. The half that is NOT done
(a signed-in eyeball, and the allowance itself) went into `TODO.md` as active
work.

**What he saw**, on padhard's Missing/queue screen, on a FAILED research run:

```
400 {"type":"error","error":{"type":"invalid_request_error","message":"You have
reached your specified API usage limits. You will regain access on 2026-09-01 at
00:00 UTC."},"request_id":"req_011Ce8wV2ToKAQnsf1Ahq1V6"}
```

Her Anthropic key had reached its monthly spend cap. The estate law it broke is
the flat one: a person must NEVER see a bare status or a raw error body.

⚠️ **The sharp part: `describeError` did exactly what it promises, and the
defect shipped anyway — hours after the `[object Object]` fix above.** The SDK
builds its `Error.message` as `` `${status} ${JSON.stringify(body)}` `` whenever
the body has no **top-level** `message`, and the error envelope never does — its
sentence is nested at `error.error.message`. So the first branch found a real,
non-empty `string` and returned it. **A worded OUTPUT is not a worded MESSAGE**,
and a test suite built entirely around "never `[object Object]`, never empty,
never a bare number" cannot catch it. Verified against the installed SDK
(`@anthropic-ai/sdk` 0.116.0, `APIError.makeMessage`), not inferred.

**Commits `52aad39` (code + tests), `d8bd920` and this one (deploy log + docs).**
Deployed both instances from `52aad39`'s tree:

| instance | worker | version id | host |
|---|---|---|---|
| main | `library-catalog` | `76fcd3c2-5a89-4644-b136-78a287779f92` | library.heygabi.ai |
| friend | `library-catalog-friend` | `07a757de-8485-4a26-824b-c541efa6c5ed` | padhard.heygabi.ai |

Health 200 on both after deploy (21:00Z).

**What shipped.** New leaf `packages/core/src/lookup-errors.ts` —
`classifyLookupFailure` and `wordLookupError` — naming three provider failures
and **keeping them apart on purpose**, because each has a different fix: the cap
is a *wait*, the 429 is a *retry*, the 401 is an *operator action*. Collapsing
them into one "lookups unavailable" sentence would send someone to wait a month
for something a re-push fixes in a minute. The cap **reads** its reset date out
of the message rather than computing one ("first of next month" is wrong for any
limit that is not calendar-monthly), and says the thing the JSON never did.

Before → after, on the exact string in D1:

> `400 {"type":"error",…,"request_id":"req_011Ce8wV2ToKAQnsf1Ahq1V6"}`
>
> → *"This catalog's lookup allowance is used up until 1 September 2026 —
> lookups pause until then. An operator can raise the limit at
> platform.claude.com. Your books and everything already filled in are
> unaffected."*

The other two: *"Too many lookups at once, so the lookup service asked us to
slow down. Nothing is wrong with your books or your account — leave it a minute
and press Look again."* and *"The lookup service rejected this catalog's key…
This is a server configuration problem, not a permission problem — your account
is fine…"*, the latter deliberately parallel to `SCAN_KEY_REJECTED_MESSAGE`.

⚠️ **Why it is in `@lc/core` and not beside either caller — the decision worth
keeping.** `research_run.error_message` is **persisted**, so classifying at
store time reaches no row that already exists; runs 5 and 6 on
`library-catalog-2nd` hold that body and always will. Doing only the render side
would persist every new row unreadable, which is exactly the defect that
outlived its own session last time. So **both**, through one function: the
Worker in `describeError` (ahead of all the generic unwrapping),
`DetailsQueuePage` and `ScanJobsPage` via `wordLookupError` at render time. The
sentence cannot drift between them, and `wordLookupError` guarantees its output
contains **no brace** whatever it is handed — so the next unrecognised body is
not this incident again.

⚠️ **It refuses to guess.** An ordinary 400 ("roles must alternate") returns
null and keeps reading like the bug it is; the bare word *limit* is not enough
(`max_tokens exceeds the model's limit` is a defect, not an allowance); a
`UNIQUE constraint failed` is left alone for `catalog.ts`'s own matcher. Three
tests exist purely to pin what must NOT be claimed.

The raw shape still goes to `wrangler tail` from the run's catch — where an
operator can read it and a person cannot.

**Tests +34; suite 1153/1153, typecheck clean.** Both halves were **proven able
to fail**: stubbing `wordLookupError` to pass its input through fails 6 core
tests, and disabling the classifier inside `describeError` fails the Worker's.
The fixture strings were read **live out of `library-catalog-2nd`**, not
reconstructed from the screenshot.

**Verified:** health 200 both hosts; the worded sentences present in the live
bundle on **both** hosts (`/assets/index-DVAovdWp.js` — identical hash, same
build) — `lookup allowance`, `platform.claude.com`, `already filled in are
unaffected`, `not a permission problem`.

**NOT verified, and NOT done:**
- **The rendered row.** Estate auth is in enforce on both instances, so the
  FAILED rows have not been seen by a signed-in eye. Code-presence is not the
  same evidence. Runs 5 and 6 are the natural test rows — in `TODO.md`.
- **The Say-what-you-know / Look-again affordances** were not touched and their
  code is unchanged, but they were not exercised in a browser either.
- **The two legacy rows were not rewritten.** Deliberate: the render-layer
  mapping is what makes a backfill unnecessary, and a backfill would have been
  the weaker fix (it fixes two rows; the mapping fixes every row that will ever
  exist).
- **The allowance itself is untouched.** Lookups on `padhard` stay dead until
  1 September unless the owner raises the limit. That is a decision, not a bug.

## 📱 The top bar printed its chips over the wordmark on a phone — ✅ FIXED + DEPLOYED 2026-08-17

*Moved whole from [`TODO.md`](TODO.md) on completion. The original item, kept
verbatim:*

> **📱 The top bar overlaps the wordmark on a phone (owner, 2026-08-17, with a
> screenshot from `padhard.heygabi.ai` on an iPhone).** The action chips wrap
> over "The Library" instead of below it, leaving fragment letters showing
> behind them.

**Commits:** `640974c` (the fix), `9ed359f` + `d64c474` (deploy log).
**Live:** main `e1d9bd62-a282-46a9-825c-3c52e1ed5142`, friend
`83914cae-736f-41ea-bd42-cf1b72e97773`.

**What it actually was.** The seventh control (the GABI bubble) was the
trigger, not the fault. `.topbar` was a `display: flex` row with **no
`flex-wrap`**, so nothing could ever move to a second line, and
`.topbar__brand` was `flex: 1; min-width: 0`, which invites the algorithm to
shrink the wordmark to *zero* rather than shrink anything else. A zero-width
box does not clip its text — the letters spill out and the later DOM paints
over them. Measured before touching anything: at 320/390/430 the bar also
**overflowed the viewport horizontally**, so the cog and Sign out were off the
right-hand edge entirely. The owner's photograph was the mild version.

**The fix, in one line:** the bar wraps, and the wordmark is the one thing that
may not shrink (`flex-wrap: wrap` unconditionally, `min-width: max-content` on
the brand). Everything else is arrangement: a new `.topbar__tools` element so
the four person-and-session controls move as one cluster, and below a measured
**56rem** the nav chips take a line of their own (`order: 1`, 100% basis, 44px
tap targets), with the display name hidden at that same breakpoint instead of
30rem.

**What the bar does now at narrow widths:** line one is the wordmark with the
GABI bubble, the search magnifier, the cog and Sign out; line two is the chips,
wrapping among themselves if needed. Two lines at 390 and 430. At 320 the
wordmark and the tools cluster no longer fit together (112 + 220 against 296 of
usable width), so it is three lines — title, tools, chips.

**Measured**, Chrome, the shipped bundle, at 300/320/360/390/430/480/560/700/
880/920/1024/1280: nothing overlaps the wordmark at any width, the wordmark is
never clipped, no horizontal overflow, every tap target in the bar ≥ 44px below
56rem, and one row from 920px up — the desktop bar is unchanged. Verified live
on **padhard (hearts)** and **library (retro)** after deploy.

⚠️ **NOT verified: a real iPhone.** Chrome device emulation is not a device.
⚠️ **Theme-dependent detail:** the 320px chip row fits on one line in `apple`
and takes two in `hearts`, whose display face is wider. It wraps cleanly either
way; that is the point of fixing the layout class rather than the chip count.

## 🤖 "Sam asks GABI to fix her books" — PHASE 0 ✅ BUILT + DEPLOYED 2026-08-17

*Moved whole from [`TODO.md`](TODO.md) on completion of PHASE 0, with its
original text below kept verbatim. ⚠️ **The feature is not finished — only its
first phase is.** What remains (Discord next-after, then the write phases 1–3,
plus one owner action) is a NEW, short active item in `TODO.md`; it is not a
copy of this one, and this text is not maintained. The living record is
[`info/gabi-fixer-design.md`](info/gabi-fixer-design.md) — §9 for what is and
is not built, §13 for the file map.*

**What landed (commits on `main`):**

- `packages/core/src/gabi-tools.ts` — the allowlist as an explicit array,
  default-deny. Phase 0's four tools are READ-ONLY and that is enforced:
  `packages/core/test/gabi-tools.test.ts` fails the build if a tool declares
  `mutates`, a non-GET method, or a capability above `read`. Exercised — adding
  `set_book_details` fails four assertions four independent ways.
- `POST /api/gabi/turn` (`routes/gabi.ts` + `lib/gabi-turn.ts`), gated on
  `runResearch` because what it carries is a bill, not a write. One model call
  per invocation, counted at two levels rather than asserted.
- Migration `0330_gabi_turn.sql` — the accounting row, written on success AND
  failure, carrying the two CACHE token columns without which §7's cost claim
  could not be checked.
- The browser executor (`apps/web/src/lib/gabi.ts`, a leaf that cannot fetch)
  and the panel (`components/GabiPanel.tsx`), which runs the loop and draws a
  tool card for every `tool_use` block.
- `GABI_PANEL` posture var — `"on"` for `[env.friend.vars]`, `"off"` for
  `[vars]`, pinned by a test that reads `wrangler.toml`.

**MEASURED the same day** (real route, real executor, real model, owner's key):
cached prefix **1,793 tokens**; a two-turn conversation with one tool round
**1.4–1.8¢**; the model reached for the right tool unprompted, relayed the
catalog's own refusal wording verbatim, and said plainly that it cannot change
anything. ⚠️ It also proved a comment WRONG: `usage.input_tokens` excludes
cached tokens, so reusing `estimateCents` unchanged under-reports rather than
over-reports. `gabiCents` fixes it. Full figures: design §7.4.

⚠️ **Samantha's role was MEASURED, not assumed** — `admin` on
`library-catalog-2nd`, which closes design §11's first unknown and the "the
whole feature is dark if it resolves badly" risk below.

---

*Original item, verbatim:*

- **🤖 "Sam asks GABI to fix her books" — conversational fixer (owner vision,
  2026-08-16 late):** *"in the future i want Sam to be able to ask gabi to fix
  books for her like id ask you. it'd be done through api but it would have
  the needed context to fix things."* FUTURE — design seed, not queued yet
  (sits after the current batch + Discord queue + EPUB/PDF viewer unless
  reprioritized). The shape that keeps it safe and small:
  - **The write plumbing already exists and must be REUSED, never bypassed:**
    `claimRun`/`saveFindings`/`applyFinding`/`autoApplyFindings` are the one
    canonical path that fixes a book, with provenance (`source_tier`,
    `decided_by`, `decided_how`) and revert (`revertFinding`) built in. A
    conversational GABI is a new FRONT DOOR to that machinery — an Anthropic
    tool-use loop whose tools are the worker's existing capability-gated
    endpoints — not a new writer.
  - **Her authority, not GABI's:** actions run as Samantha (admin on her
    instance, role ladder), attributable in the audit trail — never as a
    service account. Scope: HER instance only.
  - **Guardrails:** action allowlist (detail fixes, cover swaps; deletes
    excluded at first), confirm-before-write summaries for anything bulk,
    spend rides the capped-workspace key design (§4 of second-instance.md).
  - **Surface question for later:** her site (a chat panel) vs Discord DM to
    GABI — decide when built; the API loop is identical behind either.
  Cross-referenced from catalog-platform TODO §0 (GABI queue).
  ✅ **DESIGN DONE 2026-08-17, awaiting owner read.**
  📄 **[`info/gabi-fixer-design.md`](info/gabi-fixer-design.md)** — full design,
  with rejected alternatives per section. **Nothing is built; no route, table,
  secret or panel exists.** What the design settled that the seed left open:
  - ⚠️ **The loop runs in HER BROWSER, not in the Worker.** A server-side loop
    is the obvious shape and the wrong one: a six-turn conversation that
    researches one book and patches two fields is ~40 of the **50 subrequests**
    an invocation gets, and going over **terminates the invocation rather than
    throwing** — a conversation whose failure mode is silence. The browser
    already holds her live Firebase token and already calls every one of these
    endpoints, so each tool call is *literally* the request the edit form makes:
    "her authority end to end" becomes a thing the design declines to
    circumvent rather than a thing it builds. The Worker keeps one thin route
    (`POST /api/gabi/turn`, `runResearch`-gated) that holds the API key and
    makes exactly ONE model call per turn.
  - ⚠️ **`title`/`authors` are unreachable by construction**, not by validation
    — they re-derive `work_key`, and moving a non-provisional key needs a
    Firestore `keyMove` attestation the Worker structurally cannot make.
    `applyFinding` already refuses the same two fields for the same reason.
  - **No migration is needed to make a GABI write auditable.** `decided_how`
    already means *"did anybody look at the value"*, not *"did a person ask"* —
    so a blank-fill lands `'auto'` + her id, a confirmed overwrite lands
    `'human'` + her id, and `Actor.note` carries `gabi:<conversationId>`. A
    third enum value would have stretched the column's meaning for nothing.
  - **Batches cap at 10** because `POST /api/research/undo` caps at 10: a batch
    you cannot undo in one action should not be one action.
  - ⚠️ **Do not disable thinking on Opus 5 to save money** — with it off, tool
    calls can arrive as plain *text*: the turn succeeds, the call never runs,
    nothing errors. Cost is controlled with `effort: 'low'` instead, exactly as
    `RESEARCH_EFFORT` already does.
  - **Cost: single-digit cents per conversation**, dominated by the ~2¢ paid
    lookup, not by the loop. ⚠️ Haiku is a false economy — its 4096-token cache
    minimum is above this prefix, so it pays full input price every turn.
  - 🧑 **Owner action, before anything is built:** confirm **Samantha's role on
    `padhard`**. The seed says `admin`; her `app_user.role` row was not read,
    `ESTATE_DEFAULT_ROLE` is unset (the `moderator` flip is paused), and a
    `member` gets 403 from every write tool — the whole feature is dark.
  - **Discord needs four things that do not exist** (an `app_user` join, token
    custody, a deferred-response path, persisted conversation state); the site
    panel needs none. If Discord is wanted sooner, the propose-and-deep-link
    shape is buildable today with no new auth.

## ⚠️ Content warnings — the EBOOKS half — ✅ BUILT 2026-08-17, in `audiobook_catalog`

*Moved whole from [`TODO.md`](TODO.md) on completion, with its original text
below kept verbatim — including the warning that turned out to be the whole
job. Built as `audiobook_catalog@7c2061a`; the design is written up in
[`info/content-warnings.md`](info/content-warnings.md) §7, rewritten the same
day from "deferred, on purpose" to the built answer.*

**How the one prohibition was satisfied.** The item's ⚠️ said: do not key the
notes on the ebooks site's own title. It is satisfied without a new key
derivation, and without this Worker — **that repo IS the audiobook catalog**,
so the answer was already in its own pipeline. The ebook manifest's
sibling-cover join (`scripts/build_ebook_manifest.sibling_catalog_match`)
already matches an ebook to the audiobook it sits beside; it now hands back the
matched row's **raw catalog title** as well, published per row as
`audiobook_title`. One join, two answers, so a cover and a content note can
never disagree about which audiobook a file is. Nothing in that browser
computes a key: it passes a raw title to `user-warnings.js`, which owns the
single `bookIdFromTitle` call.

**Measured on that repo's live 168-row manifest** — the same shape of failure
this catalog measured at 27-of-92, in a different catalog:

| Keying class | Key | Count |
|---|---|---|
| `audiobook` | the audiobook catalog's title | **56** (31 spelled differently from the ebook) |
| `beside` | own title; the join refused, and the panel says so | **100** |
| `ebook-only` | own title — the estate has no other spelling | **12** |

⚠️ **`ebook-only` is a keying class this document had no name for**, and
naming it narrowed §2's rule: never key on your own title *when another
catalog's spelling is the convention* — not never at all. Published-file reach
with the new key: 21 books (14 listing warnings, 7 checked-clean) against 12 on
the ebook's own title.

**The open question in the old §7 is closed, and the answer was neither
option.** No `ebook_holding` work id, no call to `/api/warnings/:workId/keys` —
the pipeline that builds the manifest already knew, so it publishes.

**Carried over unchanged, as predicted:** the store, the document id, the
`authorUid` stamp, the author-or-moderator delete and the 80-character bound.
That page CALLS `audiobook_catalog/site/user-warnings.js`; it does not fork it.
No `firestore.rules` change was made or needed.

**NOT verified:** the shelf's content notes sit behind a sign-in-and-grant
wall, so no rendered round trip has been performed there — see that repo's
`docs/DONE.md` for its own NOT-verified list.

### The item as it stood in TODO.md

- **⚠️ CONTENT WARNINGS — the EBOOKS half is still owed (owner, 2026-08-17:
  "port content warning feature over to all physical book and the ebook
  site").** The **library half is BUILT and deployed** on both instances —
  whole record in [`DONE.md`](DONE.md), design in
  [`info/content-warnings.md`](info/content-warnings.md). The ebooks half was
  deliberately NOT built: that page was mid-rebuild into the permission-gated
  shim on the same day, and adding a panel to a page being replaced is work
  done twice or a merge conflict.
  ⚠️ **The one thing whoever picks it up must not do:** key the notes on the
  ebooks site's own title. The store is the audiobook site's
  `user_content_warnings`, keyed by a slug of the title as THAT catalog spells
  it, and this catalog measured **27 of 92 matched works spelling it
  differently enough to produce a different key**. The library reads
  `audiobook_holding.title` for that; the ebooks page has no such cache and
  needs its own answer — `info/content-warnings.md` §7 states the options,
  including reusing this Worker's `/api/warnings/:workId/keys` if an
  `ebook_holding` row can supply a work id here.


### ✅ Content warnings — the LIBRARY half, built 2026-08-17 (`e5934d1`)

Owner, 2026-08-17: *"port content warning feature over to all physical book and
the ebook site."*

**Built and deployed on both instances.** The ebooks half is deliberately NOT
built and stays on [`TODO.md`](TODO.md) — that page was mid-rebuild into the
permission-gated shim the same day, and a panel added to a page being replaced
is work done twice or a merge conflict. Full design, measurements and the
carry-over list: [`info/content-warnings.md`](info/content-warnings.md).

#### The trap this item existed to avoid

The store is the audiobook site's own `user_content_warnings` (doc id
`{bookId}_{nameLower}_{topicId}`), and `bookId` is a slug of the title **as that
catalog spells it**. Measured against production D1 that day:

| | |
|---|---|
| works | 351 |
| with an `audiobook_holding` row | 92 (1 stale) |
| spelled differently by the two catalogs | 33 |
| …producing a **different key** | **27** |

`ours "Sunrise on the Reaping"` vs `theirs "Sunrise on the Reaping - A Hunger
Games Novel"`. Keying on `work.title` would file notes the other site never asks
about **and** find none of the ones written there — both halves silent, with no
error to notice.

⚠️ **The mechanism reviews use was unavailable.** Reviews span on a second
field, `workKey`, stamped by a backfill onto 870 documents. A warning document
carries none, the audiobook site will never write one, and **both collections
were measured empty (0 docs, prod and `_dev`)**, so there was nothing to
backfill and nothing to query. The join is `audiobook_holding.title` — the other
side's own spelling, cached in D1 by migration 0010, which
`routes/audiobook-mapping.ts` already trusts in the opposite direction. Write
under their key; read under theirs **and** ours; never write to a stale one.

#### What landed

- `packages/core/src/warnings.ts` — the join, the doc id ported verbatim
  (including the topic segment that IS the one-note-per-person-per-topic
  dedupe), the document, the delete verdict, the published lookup. No I/O.
- `apps/worker/src/routes/warnings.ts` — `GET /:workId/keys`, `POST
  /:workId/draft`; **writes nothing**, exactly as the review and TBR routes do.
  `authorUid` is stamped from the **verified token**, not claimed by the browser.
- `apps/web/src/components/ContentNotes.tsx` — the panel, above `Reviews`: a
  content note is read *before* the book, a review after it.
- `moderateContent` — new capability, moderator+, its own name rather than
  reusing `reviewFindings` (identical role set, indistinguishable in a refusal).
- **No `firestore.rules` change**, and none was needed: `validUserWarning()`
  asserts label/bookId/displayName and ignores the rest.

#### The published pipeline warnings came free, and were measured before being trusted

`content_warnings.json` answers `Access-Control-Allow-Origin: *`, is keyed by
the **full audiobook title** (339 keys), and we hold that string. **15 of 92**
holdings match, **8** carry at least one warning, and matching on our own title
reached **zero** extra books — so that fallback was not implemented rather than
added "just in case". ~200 KB, so it is fetched once per session and only for a
book that has a holding.

#### The honest gap, stated rather than hidden

`moderateContent` is this catalog's role; `canDeleteUserWarning()` reads the
**estate's `site_roles`**. They are different records, so a library moderator
with no estate role is offered the control and refused by Firestore.
`describeStoreError(err, { need: 'the estate-wide moderator role' })` turns that
into a sentence instead of the SDK's *"Missing or insufficient permissions."*

#### Evidence

The join test's fixtures are real production pairs, and it was **watched failing
on a deliberate mutation** (`writeBookId` = our own slug): 5 red, green on
revert. The route was **exercised locally** against a seeded holding — keys,
draft, the 80-character refusal, the blank refusal, the 404 — rather than
reasoned about. `npm run typecheck` clean.

⚠️ **NOT verified, and it needs the owner:** no signed-in add/delete round trip
on either instance; nobody has watched a library note appear on the audiobook
site's book page; and whether the owner's uid has a `site_roles` document at all
is unknown from here.

### 🔨 Cover swap — port it from the Board Game Catalog

*Landed here 2026-08-17 by the docs hygiene sweep — it still opened "⚠️ **We do not have it.**" VERIFIED in the tree: `apps/web/src/components/CoverSwap.tsx` (commits `6672b3f` "The cover swap — every cover this book could wear, side by side", `1e63193`) is wired into `CoverPanel.tsx`, and its own header records the two things this item demanded — the sibling implementation was read first ("Ported as an *idea* from the board game catalog's CoverPicker"), and the write goes through the same verified PUT, so migration 0040's `cover_status`-travels-with-`cover_url` rule is not bypassed.*


Owner: *"like the board game site can we just get the cover swap feature if we
don't already have it."*

⚠️ **We do not have it.** What exists today (`routes/covers.ts`) is: `PUT` a URL,
`POST` an upload, `PATCH` a status, `DELETE`. All of those *replace* the one
`work.cover_url`. There is **no** notion of holding several candidate covers and
choosing between them, and no way to see the alternatives you are choosing from.

Why it matters here specifically: **147 of this catalog's covers are hotlinks** —
106 Open Library, 41 Google Books — which fetch fine server-side but render
unreliably in a browser, and only **11** live in our own R2. A swap UI is also the
natural place to move a hotlink into R2 permanently.

⚠️ Read the sibling implementation before designing: the Board Game Catalog has
this feature and this repo's cover rules were largely ported from it, so the
candidate-list shape and the "which one is canonical" decision are already solved
there. Also honour migration 0040 — **`cover_status` travels with `cover_url` or
not at all** — a swap must carry the status across, or a "stand-in" flag survives
onto its replacement.

### 🔨 Add a record-delete button — asked 2026-08-13

*Landed here 2026-08-17 by the docs hygiene sweep, and it was already known stale — `audiobook_catalog/docs/TODO.md` recorded on 2026-08-16 that this was "ALREADY BUILT 2026-08-13 end to end … verified, not rebuilt", and the item still sat here in the active board anyway. VERIFIED in the tree: `apps/web/src/components/DeleteWork.tsx`, mounted from `WorkPage.tsx:506`, previews via `GET /works/:id/deletion`, writes whole-row `__row__` audit entries for the work and every cascaded edition and copy, and refuses outright (no force flag) while any copy records property — which is the "say what will go with it" confirm this item asked for, plus the audit-log tie-in.*


Owner: *"Add a todo to add a record delete button."*

⚠️ **`DELETE /api/works/:id` already exists** (`routes/catalog.ts:305`, gated on
`editCatalog`) and **nothing in the web app calls it** — `grep deleteWork` across
`apps/web/src` returns nothing. So a junk row can only be removed with
`wrangler d1 execute`, which is exactly the remedy `WorkFields`' own header says
this app exists to avoid. Removing works 301 and 302 tonight required raw SQL.

Safe to build: all **15** foreign keys to `work(id)` are `ON DELETE CASCADE`
(verified across every migration), so a delete cleans up its editions, copies,
aliases, watches and read-state without orphans.

⚠️ Wants a confirm step that **says what will go with it** — the 302 case would
have read "6 editions and 6 copies", which is precisely the information that makes
the delete obviously right. And it belongs with the audit log in the edit-any-detail
item below: a delete is the one edit that cannot be undone by re-editing.

## ⚠️ READ THIS FIRST — handoff, state at 2026-08-14 ~05:30Z

*Landed here 2026-08-17 by the docs hygiene sweep: a three-day-old handoff at the top of the ACTIVE board, and actively misleading — its LIVE table said library ran `ESTATE_CHECK=shadow` with "enforcement NOT BUILT", which `CLAUDE.md` had to correct on 2026-08-17 after two agents independently tripped on it (production has been ENFORCE on both instances since commit `3065741`, 2026-08-13 main / 2026-08-16 friend). Its five in-flight workstreams all landed, and its "Awaits the OWNER" block had already cleared itself. Durable halves live on by topic: deploy commands in [`access/deploy.md`](access/deploy.md), the estate surfaces in [`access/estate-auth.md`](access/estate-auth.md) and [`access/index-worker.md`](access/index-worker.md) — including the bridge-retirement delta table this section points at — and the Git-Bash curl trap in [`info/gotchas.md`](info/gotchas.md).*


**Written to survive a model swap and to be executable without the session that
wrote it.** Operational detail lives in `docs/access/estate-auth.md`,
`docs/access/index-worker.md` and `docs/access/themes.md` (all new tonight,
verified against the live estate) — this section is the map, those are the
manuals.

### What is LIVE (every row curled/probed 2026-08-14 ~05:10–05:20Z)

| Surface | State |
|---|---|
| **auth.heygabi.ai** | 🚢 Estate directory Worker, **deployed + seeded**: health shows `approved:2, approvers:1, pending:0`; remote migrations 0001+0002 (visibility) applied; all three `ESTATE_APP_TOKEN_*` secrets set |
| **index.heygabi.ai** | 🚢 **All three catalogs pushed** — game 836 / library 346 / audiobook 1077 rows with fresh `pushed_at`; reads are members-only (tokenless → 401, probed); ⚠️ remote migration `0003_visibility_cache.sql` **pending** — it belongs to the in-flight visibility work, apply WITH that deploy |
| **heygabi.ai** (apex) | 🚢 Live search (`find.js` → `/api/search`) + the `/admin` member page (200); `classic` theme default; ⚠️ served `theme.js` is still **pre-v2** |
| **board games** | 🚢 **`ESTATE_CHECK=enforce` DEPLOYED** (commit `6692c1d`, worker deploy 2026-08-14T05:07Z) + theme **v2 live** |
| **library** | 🚢 Deployed at `44a52f3` (04:38Z): estate themes v1 + **`ESTATE_CHECK=shadow`** — ⚠️ enforcement is NOT BUILT here (`estate-auth-shadow.md`); theme v2 (`9da43af`) committed, NOT deployed |
| **audiobooks** | Estate themes (cyberpunk default, first-ever light mode on stats + guess game) live on **`/dev/` ONLY**; prod site untouched |
| Secrets | Every estate/push token name verified set in production via `wrangler secret list`; ⚠️ **values only in the session scratchpad `estate-app-tokens.json` (LOCAL ONLY)** |

### In flight — the five workstreams (per FABLE5 §7 claims; check its tail for landings)

1. **Federated admin view** (wave 2): apex `/admin` gains `admin.js` + NEW
   `routes/admin.ts` in library + games workers (`GET/PATCH /api/admin/users`,
   owner-gated via each app's own `manageUsers`, CORS locked to the apex).
2. **Visibility-aware search (B2)**: index `/api/search` becomes
   scoped-not-gated — anonymous → `{audiobook}` slice, members → their
   visibility set (design §4.5). The catalog-platform tree is dirty with it;
   remote 0003 pending (above).
3. **Library enforcement build** — shadow's clean-log soak is the gate;
   today `enforce` only logs `enforce_requested` and behaves as shadow.
4. **Theme v2 wave** — committed in all three repos; dispatcher ships apex
   Pages + games + library **together** (games' half is already live).
5. **Docs refresh** — the three access docs + this handoff (landed with this
   commit).

### Awaits the OWNER 🔴

(All three items below CLEARED 2026-08-14: audiobook identity v2 + themes +
community estate-admin link all PROMOTED to prod on the owner's word; library
ESTATE_CHECK="enforce" is deployed; the attended passes happened live. What
awaits the owner now is the CI-arming checklist in
catalog-platform/docs/TODO.md §1.5.)


### Deploy commands per surface

| Surface | Command |
|---|---|
| auth Worker | `cd catalog-platform/apps/auth-worker && npm run db:migrate && npx wrangler deploy` |
| index Worker | `cd catalog-platform/apps/index-worker && npm run db:migrate && npx wrangler deploy` |
| apex (+ `/admin`) | `npx wrangler pages deploy sites/heygabi-home/public --project-name heygabi-home` (catalog-platform root) |
| library | `npm run deploy` (clean tree; migrate first if one is pending) |
| games | `npm run deploy` |
| audiobook `/dev/` | `git push origin main` — pushing that repo's main IS the /dev/ deploy |
| audiobook prod | 🔴 owner says "prod" → promote.yml, the sole writer of prod |

### Verification

```bash
curl -s https://auth.heygabi.ai/api/health     # approved:2, approvers:1
curl -s https://index.heygabi.ai/api/health    # three sources, fresh pushed_at
npm test && npm run typecheck                  # library: 393+ expected
```

⚠️ Git Bash curl here can report status 000 / exit 43 on hosts that are up —
use PowerShell `Invoke-WebRequest`, or `curl -s -D -` and read the status line.

### 🧾 Bridge retirement proof (hardening step 4) — RAN 2026-08-14, both bridges STAY

The index-worker design's own gate ("retire *only* when the index provably
answers what they answer") **failed for both bridges**, by measurement, not
assumption — full delta table + method in
`docs/access/index-worker.md` → *Bridge retirement*. Short form: the index's
exact-fold join reproduces 21/70 live `audiobook_holding` rows and 0/135
series rungs, and its `work_fold` agrees with the stamped review `workKey` on
only 329/870 docs (raw decorated titles vs cleaned). So
`scripts/backfill-review-keys.mjs` and `scripts/backfill-audiobook-holdings.mjs`
**both keep running as before**; nothing moved to an attic, no data touched.
Two live observations for whoever runs them next: (1) ✅ **DONE 2026-08-14** —
work #250 *Space Knight Book 2* got its `work_alias` (bare "Space Knight",
`kind='title'`, `source='manual'`, written by the new
`scripts/add-space-knight-alias.mjs`, whose header carries the measured
reasoning) and the holdings backfill was re-run `--remote --commit`. Verified
by re-reading production: #250 now holds `matched_via='exact'`,
`via_alias='Space Knight'`, `index_sort=2` — the vol-2 row, not book 1's.
⚠️ #249 *Space Knight Book 1* has the same miss (its audiobook's cleaned title
is also bare "Space Knight") but was left alone: nothing recorded prescribes
it, and pointing two works at one alias string would be ambiguous.
⚠️ The same re-run also wrote the catalog's post-growth deltas: holdings
70 → 79 live (incl. 2 read-and-approved containment matches — the two Harry
Potter "(Full-Cast Edition)" rows), rungs 135 → 144 live, with **9 new `fold`
rungs across 4 new series** (A Court of Thorns and Roses ×5, Grey Griffins ×1,
The Inheritance Cycle ×1, The Symphony of Ages ×2) — so "possibly on audio" is
back on those pages, honestly; the owner's series-page confirm button
(migration 0110) is the designed remedy if the mappings are right.
(2) review stamping is currently complete (870/870, zero
re-run backlog), so bridge A is dormant until the audiobook site accrues new
reviews.

## ⚠️ GitHub Actions minutes — diagnosed 2026-08-11, fix deferred by the user

*Landed here 2026-08-17 by the docs hygiene sweep — the diagnosis was right and the problem then dissolved at its root, so "fix deferred" describes work nobody should now do. MEASURED with `gh` on 2026-08-17: **all four repos are PUBLIC** (`audiobook_catalog`, `library_catalog`, `Board_Game_Catalog`, `catalog-platform`), so the metering this section is entirely about does not apply — and the item's premise that only `audiobook_catalog` has workflows is also gone, each of the other three gained a manual `deploy.yml` on 2026-08-14. ⚠️ The standing constraint the item leaves behind is recorded elsewhere and still binds: `audiobook_catalog` MUST stay public, precisely because its two crons would exhaust a metered allowance.*


**Only `audiobook_catalog` runs any workflows.** `library_catalog`,
`Board_Game_Catalog` and `catalog-platform` have **no `.github/workflows` at
all**, so the user's assumption was right.

Seven workflows there, and **two of them are pure cron**:

| Workflow | Schedule | Share of the last 100 runs |
|---|---|---|
| **Club Discord Notifications** | `*/15 * * * *` — **every 15 min** | 25 |
| **Content-warning requests** | `17 * * * *` — hourly | 21 |
| Deploy / Lint / Tests / promote | push or manual | the rest |

Measured: **100 runs in 26 hours ≈ 92/day ≈ 2,760/month.** The two crons alone
are ~46% of that and run whether or not anything changed.

⚠️ **The root cause is not the crons — it is that the repo went private on
2026-08-10.** Public repos get unlimited Actions minutes; private repos are
metered (2,000/mo Free, 3,000 Pro). Those two schedules were free the day before
and metered the day after. Nothing about the workflows changed.

Cheapest fixes, in order: lengthen the Discord poll from 15 min to 30–60 (saves
~50–75% of the largest consumer on its own), fold the hourly CW check into the
same job, or move both to Cloudflare Cron Triggers — the estate already runs
Workers, and Cloudflare's scheduler is free.

## 🌉 Cross-catalog bridge — the canonical series registry — ✅ SHIPPED 2026-08-17

*Landed here 2026-08-17 by the docs hygiene sweep; it still read "📋 QUEUED (reset batch), design agreed" when the design had been built. VERIFIED against `catalog-platform/docs/DONE.md` → "The estate SERIES REGISTRY — ✅ BUILT + DEPLOYED LIVE 2026-08-17" (registry home = the estate index, auto-merge on exact fold, confirm-first queue for fuzzy near misses) and the `/series` page that consumes it. Per-catalog surfaces stayed holdings-only, as this bullet required. Residual, tracked on catalog-platform's board and not here: the confirm queue has no browser affordance yet — one row is waiting.*

- **Cross-catalog bridge** (no duplicate series/universes; per-catalog surfaces
  stay holdings-only, apex series/universe pages union every medium + owner) —
  📋 QUEUED (reset batch), design agreed: canonical series registry in the
  estate index, auto-merge exact fold, confirm-first queue for fuzzy.

## 🔑 Sam's instance joins the estate management surfaces — ✅ SHIPPED 2026-08-16

*Landed here 2026-08-17 by the docs hygiene sweep; it still read "📋 QUEUED (reset batch)". VERIFIED against `catalog-platform/docs/DONE.md` → "Sam's library (`library2`) joins the estate MANAGEMENT surfaces — ✅ DONE 2026-08-16" plus its CSP sequel: every one of the three things this bullet asked for shipped — `admin.js` `APPS` gains `library2` with the same dropdown and strictly-beneath granting, a "Sam's library" role filter, `/status` rows `wk-library2` + `site-library2`, and padhard as a fifth estate-probe target. The friend Worker needed no new code: `padhard.heygabi.ai` already runs this repo's `[env.friend]`.*

- **Add her instance to the estate to be managed** — 📋 QUEUED (reset batch):
  admin members page per-site columns, estate probes, status page rows for
  `library2`/padhard.

## 🔗 Series linking — per-volume ownership across mediums and owners — ✅ SHIPPED 2026-08-17 (as the apex `/series` page)

*Landed here 2026-08-17 by the docs hygiene sweep; it still read "📋 QUEUED (reset batch, design locked)". VERIFIED against `catalog-platform/docs/DONE.md` → "The apex `/series` page — ✅ BUILT + DEPLOYED + VERIFIED SIGNED-IN 2026-08-17", which quotes this exact owner sentence as its brief and ships volumes in number order with dashed GAP rows for the numbers nobody holds, grouped by medium and owner. Live (members-only): <https://heygabi.ai/series/>. Commits `32a6f2b`, `f2fd6dc`, `6d41982`; deploys `1f932b64`, `f40d18c5`. The one thing still open belongs to that repo's board, not this one: nothing in a browser calls the fuzzy-fold confirm queue yet.*

- **Series linking, owner's words on the desired UX:** *"I want missing books
  to say you don't have book 1 but audio and ebook do and Skylar also owns
  it."* So the series view is per-VOLUME ownership across mediums and owners:
  each volume row names who holds it in what format, and a gap is a gap only
  if NOBODY holds it in ANY medium. This extends the canonical-series-registry
  item — the series page consumes the estate index union + each catalog's
  holdings. 📋 QUEUED (reset batch, design locked).

## ⏳ Committed but NOT deployed — `cc27fec` (universes single-writer guard)

*Landed here 2026-08-17 by the docs hygiene sweep: it rode along exactly as the item said it would. VERIFIED — `git merge-base --is-ancestor cc27fec HEAD` says yes, and `docs/deploys.log` records both instances redeployed after it (main `558a646` / `7edc651` / `1ef3d5b`, friend `8a8af07` / `7aa71eb` / `4d5f637`, latest 2026-08-17T14:52Z). The "do not apply 0321 on its behalf" warning went with the donor agent's own item.*


Nothing runtime changed in it (a test, docs, and one comment in `health.ts`), so
there is nothing to see live and no hurry. It was **deliberately not deployed**:
at the time it landed the working tree held a concurrent agent's uncommitted
donor work — including an unapplied `migrations/0321_donor_fuzzy_source_tier.sql`
— and both a dirty-tree deploy and a `d1 migrations apply` would have shipped or
applied work that is in no commit. It rides along with the next deploy of either
instance; live at that moment was main `0007e16c…` / friend `ec721da6…`.

⚠️ **Do not apply 0321 on its behalf.** It belongs to that agent's item and must
land with its own code.

## 2026-08-17 — 🔒 The ebook permission gate (SHIPPED)

**Moved whole from [`TODO.md`](TODO.md) at completion.** The item as it stood,
verbatim, then what was actually built.

- **🔒 EBOOKS GO PERMISSION-GATED (owner directive, 2026-08-17: "ebooks
  should be like the other site where we grant permission to view it. I
  don't want people scraping my books"):** ebooks.heygabi.ai becomes an
  auth-locked shim (the /todo pattern); ebooks.html + ebooks.json leave the
  public deployment and serve from a bearer-gated worker endpoint; estate
  admin grows an ebooks column. **The capability model, owner's exact
  design:** `vis_ebooks` (the view-site grant) **includes readEbook** — see
  the shelf = read in the reader, one grant; `downloadEbook` is a SIDE
  permission — **admin+ hold it by default, and it is individually
  grantable to any person at any ladder level** (per-person toggle beside
  the view checkbox, auto-on-and-locked for admin+/owners). This supersedes
  viewer-design §11's read-vs-download question with a decided answer.
  ✅ **UNBLOCKED 2026-08-17** — the covers agent has cleared the manifest
  zone (`audiobook_catalog@1441f0a`, PDF page-1 auto-covers; `ebooks.json`
  gained a top-level `needs_human_cover` array, and `site/ebooks.json` +
  `site/covers_manifest.json` are committed and pushed). Nothing else is
  holding this. Access-REDUCING, so it front-runs all viewer build work.
  ⚠️ Residual, and now MEASURED rather than assumed: cover images stay on
  the public host under unguessable sha256 hashes — including the 4 newly
  rendered PDF covers, which are page 1 of a purchased product.
  ⚠️ New surface for whoever builds the gate: the manifest now carries
  `needs_human_cover` (`{path,title,format,reason}`). It is metadata about
  the estate's gaps, not book content, but it names every file it lists —
  decide deliberately whether it crosses the auth boundary with the rest
  of `ebooks.json` rather than letting it ride along unnoticed.

### What was built, and where it landed

| Repo | Commits |
|---|---|
| `catalog-platform` | `be4d4f8` (estate vocabulary + the search carve-out), `146930c` (admin Ebooks column), `4350ad1` (the gated manifest route), `bf1059c` (ebooks-door path fix) |
| `audiobook_catalog` | `ca85553` (manifest out of git AND out of the deployment; the shim; sync step 5.8) |

**Deployed:** auth-worker `7b8c412f`, index-worker `e31d5d29`, audiobook-worker
`02247cde`, ebooks-door `1b14749d`, heygabi-home `b5bcfa24`. Migrations
`0008_vis_ebooks` + `0009_dl_ebooks` applied REMOTE FIRST, both rows seen ✅,
before any deploy.

**The capability model was built exactly as specified.** `vis_ebooks` is the
view grant and it INCLUDES reading — no `read_ebooks` column exists or ever
should. `download_ebooks` is the side permission, computed as
`dl_ebooks = 1 OR is_approver = 1 OR OWNER_EMAILS`, so admin+ hold it by
default while it stays individually grantable at any level; the admin page
draws those rows checked-and-disabled with the reason said out loud, because a
checkbox that cannot change anything is the silently-dead control the estate's
refusal rules forbid.

**`needs_human_cover` was decided deliberately, per the item's own warning: it
rides INSIDE the gate.** Metadata about the estate's gaps rather than book
content — but it names every file it lists, and a list of paths is a scrape
with fewer steps.

### Two things the item did not know, both MEASURED during the build

1. **The manifest was public in TWO places, not one.** `site/ebooks.json` was
   committed to `skymitch9/audiobook_catalog`, a **PUBLIC** repo that must stay
   public. Removing it from the deployment alone would have moved a door in
   front of an open window. It is now gitignored, and `deploy.yml` strips it
   from both lanes and fails if it survives — which also seals PROD on the next
   push to main rather than waiting for the promote.

2. **Estate search was giving the whole shelf away.** Ebook rows are pushed
   under `source: 'audiobook'` with `format: 'ebook'`, and `audiobook` is the
   PUBLIC slice — so an ANONYMOUS `/api/search` returned every ebook's title,
   author, cover URL and deep link. The brief said those rows were "already
   members-scoped"; they were not. index-worker now carves ebook-format rows
   out of any scope lacking the `ebooks` catalog, in the SQL. Verified live.

### Residual public surface, stated honestly

- **Cover images** stay on `covers.heygabi.ai` under unguessable sha256 keys,
  exactly as the item predicted — the 4 PDF page-1 renders included.
- **A Cloudflare EDGE-CACHED copy** of `audiobooks.heygabi.ai/ebooks.json` was
  still served after the strip (`Age:` climbing; the same URL with a
  cache-buster returned the SPA fallback, proving the origin was clean).
  🔴 **Owner action: purge that URL** — `catalog-platform/docs/access/ebooks-gate.md` §7.

### Left open, deliberately

- **The prod promote.** `ebooks.heygabi.ai` serves the PROD branch, whose
  `site/ebooks.html` is still the pre-gate page, so the SHIM is not live there
  yet. No data leaks meanwhile: the manifest is stripped from both lanes on
  every publish, so the old page cannot load a shelf even if reached.
- **Ebook rows leave the estate index** at the next CI deploy — CI has no
  manifest and the push is a snapshot REPLACE. Said loudly in a WARN and pinned
  by a test. Needs an owner decision: move the index push into the local
  pipeline (one writer, has the manifest), or teach CI to read the private
  bucket.

## ✅ 2026-08-17: Ebook cover healing — closed out, every book on the shelf has a cover

Landed in `audiobook_catalog`: the downscale fix (`32264d4`), the show-PDFs
checkbox (`4d45a4a`), the one hand-placed override, the mechanical guard, and
finally **PDF page-1 auto-covers** (`1441f0a`). Final census, measured: **56
audiobook / 107 epub / 4 pdf_page1 / 1 override / 0 placeholder of 168.**

⚠️ **The PDF half shipped by a DIFFERENT route than the design note below
anticipated, and the note is preserved unedited so the change of mind is
visible.** The queued plan was *"scour the web for the actual product's cover
art"* with `cover_source: 'web'`. The owner superseded it on 2026-08-17:

> "Apply and make it automatic but we need to check that first page ... make
> sure it's an image or at least some kind of cover page and not just a chapter
> or some huge block of text."

So the source is the PDF's **own page 1**, rendered by PyMuPDF and staged
through the existing sha256 / downscale / `upload_covers_r2` path —
`cover_source: 'pdf_page1'`, no network call, no provenance question, and the
art is by construction the actual product's. All four are real published
covers, verified by eye before upload. The web-lookup and series-borrow ideas
below stay on the record as the documented fallbacks for a PDF whose page 1 the
gate refuses.

**What replaced "no cover hunt for PDFs" is a cover-likeness gate**, which is
where the work actually went: page-1 text length, UNION image coverage, ink and
colour fractions, tuned against the four real covers and nine interior pages of
those same files. Measured, and each signal load-bearing — every Stormlight
Handbook interior page carries a full-page image *and* 2,500+ characters, while
Alloy of Law's real cover is eight tiled images whose largest is 17% of the
page. An ambiguous page is refused, not guessed at (the optional Claude-haiku
rung is unconfigured on that machine by design). Full write-up:
`audiobook_catalog/docs/info/covers-r2.md`.

**The guard grew a second half.** "Every EPUB has a cover" now sits beside
"every PDF resolves a cover **OR** is named in `needs_human_cover`" — so a
text-first PDF cannot break promote while a *silent* cover gap still fails,
naming the title. Proven able to fail before being trusted, as the owner's
mandate required: nulling *Defiant*'s cover unnamed → exit 1 naming it; the
same manifest with it listed → exit 0.

The **show-PDFs checkbox stays default-off**, exactly as the note below
insisted — covers make the hidden rows nicer, not more prominent.

### The item as it stood in TODO.md, moved whole

- **Ebook cover healing** 📋 QUEUED (reset batch) — **ROOT CAUSE FOUND
  2026-08-16 late (owner: "the epub has the cover"): he was right.** 15 of
  the 16 "coverless" EPUBs (All The Skills 2/4/6, Arcane Pathfinder 5, six
  Cradle books, more) declare perfect covers that
  `audiobook_catalog/scripts/build_ebook_manifest.py` silently REJECTS at
  `MAX_COVER_BYTES = 2MB` — measured 2.1–3.4MB high-res images, dropped by
  the size guard as if absent. Fix: **downscale-not-reject** (Pillow 11.3.0
  is in the env; resize ~1600px longest side, JPEG q85, keep sha256 naming) —
  never just raise the cap, that ships 3MB images to every page load.
  **Owner mandates (2026-08-16 late): every EPUB ends with a cover, minimum**
  — the 1 truly coverless EPUB gets a web lookup; **PDFs get no cover hunt —
  instead a "show PDFs" checkbox on the ebooks page, DEFAULT OFF** (hidden
  from grid and page search until ticked, preference persisted).
  📋 **Follow-up (owner ask 2026-08-16, deliberately NOT in the wave-1
  batch): PDF covers from content.** Two ideas weighed, owner prefers the
  second: (1) borrow the cover of the series the PDF belongs to — rejected as
  primary (a Mistborn RPG handbook wearing the novel's cover misrepresents
  what you'd open); (2) **scour the web for the actual product's cover art**
  — the 4 PDFs are real published products (Mistborn Adventure Game books,
  the Stormlight Handbook) whose covers exist online. Design note: source
  from the product's own listing (publisher page / DriveThruRPG / Google
  Books), stage through the same sha256 + upload_covers_r2 path, and mark
  `cover_source: 'web'` for provenance. Series-borrow stays the documented
  fallback for a PDF whose product art genuinely cannot be found. The
  "show PDFs" checkbox stays default-off regardless — covers make the hidden
  rows nicer, not more prominent.
  ⚠️ **And a MECHANICAL GUARD (owner: "this is so so important to me"):**
  every-EPUB-has-a-cover becomes a promote gate AND a test-suite failure in
  audiobook_catalog — failing output names the offending titles; escape
  hatch `ALLOW_COVERLESS_EPUBS=1`, emergency-only; guard ships only AFTER
  coverage reaches 100% and is proven able to fail before trusted. Original
  census for context: 168 ebooks, 148 covered (92 self-extracted, 56
  audiobook-sibling). (The bookshelf itself shipped and PROMOTED — DONE.md.)

## ✅ TBR instant-clear on the audiobook site (2026-08-17)

The TODO entry, moved whole:

> ### Third wave (2026-08-17 morning)
> - **TBR instant-clear on the audiobook site — APPROVED with promote
>   ("Do 8, promote heart thing", owner 2026-08-17):** the ~10-line spec in
>   [`info/tbr.md`](info/tbr.md) §6 — rating a book on the audiobook site flips
>   its TBR button back that second instead of on next load. 📋 Dispatches the
>   moment the warnings-split agent clears the audiobook templates zone; its
>   promote is covered by the same owner sentence (he was told it rides one and
>   said do it).

**What landed, and where.** Nothing changed in this repo's code — the whole
build is `audiobook_catalog` commit `2ff816f` on `main`, exactly the spec
[`info/tbr.md`](info/tbr.md) §6 wrote for it. That file's §6 is rewritten
accordingly: it described a gap, and now describes a mechanism.

| | |
|---|---|
| The delete | `site/reviews.js` gains `clearTbrForRating`, called from `submitReview` on the SUCCESS path only. It performs the same `deleteDoc` on `col('readingLists')` that the audiobook modal's own TBR button performs when toggled off |
| The flip | no new wiring — `app/web/templates/index.html` already re-rendered the reading-list button after a successful review. That call was incidental and is now load-bearing, and says so in a comment |
| Reach | all three rating surfaces, because they all route through `submitReview`: the book modal, `club.html` and `club-read.html` |
| Rules | untouched, as §1 argued. `validReadingList` already permits this delete; it is the delete the button has always performed |

**The two ways it could have been wrong, both closed by tests that were watched
failing.** The reading-list id is `{displayNameLower}_{bookId}` and a review's
is `{bookId}_{displayNameLower}` (§2) — a decoy document seeded at the wrong key
must SURVIVE the rating, and reversing the order in the source fails six of the
ten new cases. And a *failed* review write must clear nothing, because a
rejected rating settles no intention.

**Green at that repo's promote settings** (lint blocks a promote silently, so
this is checked rather than assumed): vitest 557, pytest 1028, flake8 clean on
both passes, every inline module `node --check`ed, `site/index.html` regenerated
from its template.

⚠️ **NOT verified: the flip in a browser.** Rating a book signed-in and watching
`✓ To Be Read` become `📋 Add to TBR` needs the owner's own session — it is the
same item §7 already listed as "the audiobook site's own view of a clear has not
been looked at", and this build does not close it. Everything either side of it
is verified: the target document, the id order, the lane, the failure modes, and
the shipped code's presence in the `/dev/` bundle.

**Prod:** the audiobook repo's promote is the conductor's step, pre-authorised
in the same owner sentence that approved the build.

## ✅ Hearts everywhere, and theme propagation stops depending on memory (2026-08-17)

**Owner order, verbatim:** *"Add the pink theme as an option for every site,
when a theme is added all sites get it some may just default right away."*
(The item below is the TODO entry, moved whole. What follows it is what
landed.)

- **🎨 Hearts everywhere + themes propagate mechanically:** Two halves:
  (1) hearts joins the cog on apex, audiobook site, games site (library/
  padhard already have it; padhard alone defaults it; every other default
  unchanged; the ebooks page's own identity is investigated, not steamrolled);
  (2) THE RULE — vendored theme copies become build-time syncs from the
  canonical (library's sync-estate-theme.mjs is the template) or carry a
  drift-guard test, so theme #6 someday reaches every cog with zero manual
  copying or breaks tests loudly.

**The diagnosis that mattered:** `hearts` had been in canonical since 08-16 and
was in NO cog, and the reason was not laziness. Adding a theme required editing
five apex HTML files, a React constant in the games repo, a label map in THIS
repo, a fallback list in the audiobook repo, and hand-copying four files into
two repos — nine places, none of which failed when skipped. So the fix was to
delete all nine, not to do the sweep.

**What landed**

| Repo | Mechanism now | Commit |
|---|---|---|
| catalog-platform | `theme.js` owns THEMES **and** a new LABELS map, and `wireCog` BUILDS `#hg-theme-select`'s options from them; `window.estateTheme` gains `labels`/`label()`; `predeploy-check.mjs` refuses to deploy a theme with no palette or label, or a page with hardcoded `<option>`s | `176c60c`, `ac36bbd` |
| games | `scripts/sync-estate-theme.mjs` on prebuild/pretest/predeploy; `apps/web/public/assets/` left git; the cog renders `estateThemes()`/`estateThemeLabel()`; its two inline scripts (bgc-theme migrate, theme-color) deleted — canonical does both for everyone now | `0c84d6b` |
| audiobook | `scripts/sync_estate_theme.py` + `tests/test_estate_theme_vendor.py` (sync-on-demand + read-only guard, because `site/` is served from the repo and the pipeline auto-commits); its forked `theme.js` is verbatim canonical again, all three site-local additions having moved upstream | `ada611f`, `9baeb38` |
| library (this repo) | already synced; gave up its `THEME_LABELS` map for `themeLabel()`, and the test that pinned that map now pins the LABELS in canonical instead | see this wave |

**Verified in a browser, not reasoned about** — the `hearts` build's own lesson
was that automated contrast checks passed while a page rendered as a solid pink
wall. Apex: all five cog pages ship an EMPTY select that fills to five named
themes, default `classic`. Games: five options, default `retro`, `theme-color`
still tracking `--et-bg` after its inline script was removed. Audiobook: five
options in the account modal's exact markup, default `cyberpunk`/dark
preserved, hearts legible in light and dark on the real catalog page.

**Both drift guards were watched FAILING and then passing** — a sixth theme
with no palette breaks the apex predeploy check and the audiobook drift test by
name.

⚠️ **Not covered:** the audiobook drift test SKIPS where the catalog-platform
checkout is absent, which includes that repo's CI. It guards developer and
agent checkouts — where re-vendoring actually happens — and nothing else.

⚠️ **Deliberate exclusion, recorded rather than fixed:** `ebooks.heygabi.ai`
is not a theme consumer. It has one look of its own by owner ruling and keeps
`theme.js` only so the shared account modal's Appearance controls work; hearts
reaches that dropdown while the page keeps its own skin.

Reference: [`access/themes.md`](access/themes.md) and
`catalog-platform/docs/info/estate-themes.md` §3a (how to add theme #6).

## ✅ Cross-catalog TBR — one intention per person per work, in the store the audiobook site already had (2026-08-17)

**What shipped** (core `packages/core/src/tbr.ts`, db `packages/db/src/tbr.ts`,
worker `apps/worker/src/routes/tbr.ts`, web `lib/tbr.ts` + `components/Tbr.tsx`
+ `pages/TbrPage.tsx`, design recorded in [`info/tbr.md`](info/tbr.md)):

- ⚠️ **The store already existed, and that is the whole reason this was small.**
  The design below assumed a TBR had to be *built* and weighed a new per-user
  Firestore collection with new per-user rules. It did not need one:
  `audiobook_catalog/app/web/templates/index.html` has had a per-person TBR
  button for a long time, writing `readingLists/{displayNameLower}_{bookId}`
  with `{ displayName, bookId, bookTitle, bookCover, status: 'tbr', addedAt }`,
  and `site/community.html` counts those documents per person. So this catalog
  did what it did for reviews: **joined that store and added fields to it**.
  A book added on either site is one document; clearing it here turns that
  site's `✓ To Be Read` button back into `📋 Add to TBR`.
- ⚠️ **No `firestore.rules` change, deliberately — and the brief authorised
  one.** `validReadingList()` asserts three strings and ignores unknown fields,
  exactly as `validReview()` does, so `workKey`, `email` and `source` ride along
  untouched. Tightening the collection would have been worse than nothing: that
  file's own header says reviews, club content, **TBR**, progress and profiles
  "are MEANT to be writable by anyone who can load the page — including legacy
  v1 sessions… Do not 'fix' that openness", so a per-user rule from this repo
  would have broken the audiobook site's own button for a legacy session.
  **Nothing in `audiobook_catalog` was touched.**
- ⚠️ **The document id is the REVERSE of a review's** — `${nameLower}_${bookId}`
  here against `${bookId}_${nameLower}` there — because that is what each site
  already wrote. Both are ported verbatim into `@lc/core`, and
  `packages/core/test/tbr.test.ts` asserts they differ, so harmonising them
  fails a test instead of filing a second document beside somebody's real entry.
- **Two keys, for the reason reviews carry two.** An entry this catalog writes
  carries `bookId` (theirs, title-only, and the document id) *and* `workKey`
  (`normaliseTitle(title)|normaliseTitle(author)`, the key that spans).
  `POST /api/tbr/resolve` matches on `workKey` and falls back to
  `bookIdFromTitle(work.title)` — the same weak fallback `fetchReviews` uses.
  An entry written on the audiobook site has only a `bookId` and usually matches
  nothing here; the My TBR screen shows those in a second group headed **Not on
  these shelves** with a link out, because hiding them would make a
  cross-catalog list look complete while showing a fraction of itself.
- **The decision the design asked for, recorded in `info/tbr.md` §4: TBR is its
  own per-person flag in the shared store, NOT a fifth `read_state`.** No
  migration, no new column. A ladder state in `user_book` could not span (it is
  this catalog's table, invisible to the audiobook site — the whole
  requirement), the want→have→reading→read ladder already exists across three
  stores under three names that are genuinely different facts (want to READ =
  Firestore; want to OWN = `copy.status = 'wanted'`, a fact about a *copy*;
  reading/read = `user_book`), and folding them would have to answer "does
  wanting the hardcover of a book I have read put it back on my TBR?"
- **Clearing, two paths, neither redundant.** The work page's control takes the
  read state as a prop, so it clears on `'read'` however that arrived — a press
  of the Read chip, a state set on an earlier visit, or one derived from a
  rating. The list clears on open: `/api/tbr/resolve` reports the read state of
  every entry and the finished ones are **deleted, not hidden**. ⚠️ Only
  `'read'`: a `dnf` is a *more specific* truth than "done with it" (the same
  reading `deriveReadState`'s precedence rule 5 applies) and `reference` is not
  something anybody finishes.
- ⚠️ **A rating written on the AUDIOBOOK site clears the intention through two
  steps that already existed** — the collection page's sweep (`lib/read-sync.ts`
  → `POST /api/reviews/observed`, `identity-and-reviews.md` §7.7) marks the work
  read, and the next open of My TBR retires the entry. That is why no
  audiobook-side code changed. The remaining gap — that site's own button stays
  lit until the person next opens the library — is left with **an exact spec in
  `info/tbr.md` §6**, because the button lives in a *generated* page (`site/` is
  built from `app/web/templates/`) so shipping it needs that repo's pipeline and
  a promote, and because dropping a book off your list the moment you rate it is
  a product decision for the owner rather than a repair.
- **Her instance gets it from the same bundle.** Both instances run
  `ENVIRONMENT = "production"` and `FIREBASE_PROJECT_ID = "audiobook-catalog"`
  (`apps/worker/wrangler.toml`), so `padhard.heygabi.ai` writes the same
  `readingLists` collection under her own email and display name — the identity
  model `identity-and-reviews.md` §2 settled on, unchanged.
- **Tests:** 22 new in `packages/core/test/tbr.test.ts` (id order and the
  reversal, the two keys, the provisional-work refusal, whose entries these are
  including the audiobook site's email-less documents, one row per work across
  two spellings, and exactly what clearing does and does not touch), plus the
  three new routes wired into `capability-wiring.test.ts` and
  `mount-order.test.ts`. Mutation-checked: reversing the id, dropping the status
  filter and loosening the clearing rule fail 5 of them. Full suite **985
  passing, 0 failing** (2026-08-17, `npm test`).
- ✅ **VERIFIED LIVE, signed in as the owner on `library.heygabi.ai`
  (2026-08-17)** — the evidence table is `info/tbr.md` §7. The one that matters:
  *Adventures in the Argo* (#78) is marked read **from an audiobook rating**, and
  adding it to the TBR then reloading **deleted the entry** and printed "Taken
  off your TBR — you have read it." `/tbr` also opened carrying *Rise of the
  Living Forge* — a document recorded on the **audiobook site**, which this
  catalog has never written — correctly filed under "Not on these shelves".
  Both test entries were cleaned up; the owner's own entry was left alone.
- ⚠️ **STILL NOT verified:** the second instance signed-in as her (bundle and
  config checked, no round trip), the audiobook site's own button falling back
  after a clear, a `bookCover` written by that site rendering here, the
  `readingLists_dev` lane, and the no-`trackReading` refusal path. Listed in
  `info/tbr.md` §7 rather than left implied.

**Still active, and NOT archived with this** — the "sort her books" items the
scope-narrowing subsection below points at (remote ingestion, the library
details sweep, adding her instance to the estate) keep their own rows in
[`TODO.md`](TODO.md)'s status board.

**The ask and its whole design discussion, moved from `TODO.md` — nothing
summarised, nothing dropped; heading levels demoted one so the archive keeps
one entry per `##`:**

### 📖 TBR should span all catalogs, the way "read" does (owner ask 2026-08-16)

> *"tbr like read should span all catalogs"*

**Recorded, not started.** Sits with the two entries below it — this is the
same question they are, arrived at from the reader's side rather than the
architecture's.

**What exists today, measured 2026-08-16:**

| Concept | Where it lives | Spans catalogs? |
|---|---|---|
| Reviews + ratings | ONE shared Firestore store, keyed by `bookIdFromTitle` — audiobook and library both write it | ✅ yes, already |
| "read" / reading state | `PUT /works/:id/reading` (`trackReading`), library only | ❌ library's own table |
| **TBR** | Only inside audiobook **book clubs** — a club's Current Read and TBR list | ❌ per-club, not per-person |
| Wishlist | Per catalog (`suggestWishlist` / `manageWishlist` in both library and games) | ❌ separate lists |

So there is a precedent that already works — the shared review store proves a
per-person fact CAN span catalogs — and TBR is the one that most obviously
should follow it: what someone intends to read next does not care whether the
copy is an audiobook, an ebook or a paperback.

⚠️ **The design question this forces, and why it is worth answering once:**
TBR is a **per-person, per-WORK** fact, while every catalog is organised around
**copies**. "I want to read *Wintersteel*" is one intention, even when the
household holds it in three formats. So a cross-catalog TBR needs the same
identity key the reviews already use, NOT a row in each catalog — otherwise
finishing the audiobook leaves the paperback still on the list.

⚠️ **This is the same seam as the ebooks question below.** Shared-pool formats
(audio, ebook) versus owned copies (physical, games) is the split; a spanning
TBR is what it looks like from the reader's side. Decide them together, and
consider whether "read", wishlist and TBR are three names for one per-person
state machine (want → have → reading → read) rather than three features.

**Games: DECIDED — NO to-play list (owner, 2026-08-16 late):** *"lets not
make a to play list, most people except weirdos like me buy games they arent
going to immediatly play where as books can stack up."* So TBR spans
audiobook + ebook + physical books ONLY; games are deliberately out, and the
reason is recorded so nobody "helpfully" adds them later: an unplayed game on
a shelf is normal ownership, an unread book on a list is an intention. If the
owner ever wants it, that's a NEW ask, not this feature grown sideways.

#### ⚠️ SCOPE NARROWED by the owner, 2026-08-16 — read this before building anything above

> *"lets more or less exclude games unless we design a feature thats worth
> adding to it. for now my friend wants to sort her books"*

Two corrections to everything written above, and the second is the important one:

1. **Games are out of scope** for the federation, the cross-catalog TBR and the
   ownership join — unless a feature turns up that is genuinely worth adding to
   games on its own merits. Do not carry games through these designs "for
   symmetry"; it doubles the surface for a use case nobody asked for.

2. ⚠️ **The actual requirement is "she wants to sort her books."** That is not
   the federation, not "who owns what", not a spanning TBR. Those are things
   the OWNER finds interesting about the estate; they are not what the person
   with the books needs. **Build the small thing first.**

**What "sort her books" actually needs, in order:**

| Need | Status today |
|---|---|
| Get her books INTO a catalog without a terminal | Scanning exists and is field-proven; the remote/non-technical ingest story is the real gap |
| Details filled in without her chasing them | The hourly auto-sweep landed for games 2026-08-16; **library is the queued twin and is what she actually needs** |
| Browse/sort by series, author, what's missing | Already the library app's strongest feature — series ladders, gaps, sorting, filters |

So most of what she needs **already exists**; the missing piece is ingestion for
someone remote and non-technical, plus the library details sweep.

⚠️ **Do NOT start with the shared index join.** "See who owns what" is a
SECOND-phase want, and it is cheap to add later precisely because a separate
instance is already an index source. Building the join first would mean
designing a federation for a catalog that does not yet have any books in it.

## ✅ Donor fuzzy-match backstop — the judged rung between the donor and the web (2026-08-17)

**The ask, moved whole from `TODO.md`:**

- **Donor fuzzy-match backstop** (owner ask 2026-08-16, after the donor build
  landed): *"have our ai model do a back up search on donors for fuzzy match
  before going to web."* Ladder becomes: (1) donor exact canonical-fold match
  (shipped today) → (2) when that misses, the donor returns a cheap candidate
  shortlist (same author / fold-overlap SQL, no new normaliser) and ONE small
  AI call judges "same work?" → on confident yes, use the donor's fields; on
  no/unsure → (3) existing full web research. ⚠️ Fuzzy-matched donor answers
  persist real data, so mirror the games matcher's confirm-first spirit: only
  auto-apply on a high-confidence judge verdict, otherwise leave the finding
  pending for a person. Donor-only instances (no AI key) stop at step 1
  unchanged. 📋 QUEUED (reset batch).

**What shipped** (worker `apps/worker/src/routes/donor.ts` + `lib/details-sweep.ts`
+ `lib/research-run.ts`, judge `packages/research/src/donor-match.ts`,
migration **0321**):

- **The ladder now reads exact → judged → web.** Rung 1 is unchanged (the
  canonical `work_key`, or a unique folded title). On a MISS the donor now
  answers a shortlist of up to **5** near-misses — `?candidates=1`, opt-in —
  each carrying its fold, its scores and *exactly the fields it could donate*,
  so a confident verdict needs no second round trip. Selection reuses
  `titleSimilarity` / `MIN_TITLE_SIMILARITY` / `MIN_AUTHOR_SIMILARITY` (the
  ported-verbatim gate `matching.ts` forbids re-implementing) over the one
  `listWorksForMatching` read the exact rung already makes — no new normaliser,
  no second SQL pass. ⚠️ **A shared author alone never shortlists anything**:
  zero title overlap is dropped however well the author matches, because one
  author writes forty books and offering all forty to a judge is how §4.4
  (right author, wrong book) gets its opportunity.
- **ONE small Claude call decides** (`judgeDonorMatch`, `claude-haiku-4-5`,
  structured output, 20s timeout, no retries). It sees **titles and authors
  only** — never the values it is authorising a copy of — so it cannot become a
  second, unaudited research pass. Verdict is strict: `same` / `different` /
  `unsure` plus `high` / `medium` / `low`.
- **Only `same` + `high` writes unattended.** Everything else — `unsure`, a
  medium confidence, or a `workId` the donor never offered (a hallucinated id is
  ignored outright) — leaves the donor's values as a **pending** finding for a
  person and falls through to the web pass. A pending judgement records
  `unfilled: []`, so it marks nothing as asked and the question stays live.
- **The confirm-first rule is MECHANICAL, not written down.** Judged copies wear
  their own `source_tier = 'donor_fuzzy'` (migration 0321, the same CHECK
  rebuild 0320 did), and `autoApplyFindings` is **default-deny** on that tier:
  `heldForPerson` holds it unless the caller passes
  `applyJudgedDonorFromRun: <this run's id>`. ⚠️ A run id rather than a
  boolean, and that closed a real hole — `autoApplyFindings` applies
  *everything pending for the work*, so a blanket flag would have let a later
  confident verdict sweep up an earlier tick's unconfident proposal about a
  different donor row. Nothing can auto-apply an unconfirmed judgement, in this
  tick or any future one, including `scripts/apply-pending-findings.mjs`.
- **Provenance is two-part and queryable.** The finding says `donor_fuzzy`; the
  run says `model = 'donor+claude-haiku-4-5'`, `effort = 'judged'`, and a
  sentence naming the donor work, the verdict and the measured judge cost. So
  *"show me every value a model MATCHED rather than a key"* is one query, with
  `revertFinding` at the end of it.
- **Donor-only instances are byte-for-byte unchanged.** `candidates=1` is sent
  only when `ANTHROPIC_API_KEY` exists, so the friend instance's request is the
  one it sent yesterday and its ladder still stops at rung 1.
- **Subrequest arithmetic updated honestly**, which is load-bearing: exceeding
  50 terminates the invocation *silently*. The donor term is now **6** where a
  judge is possible (1 donor fetch + 1 judge fetch + 4 bookkeeping) and 5
  without — the two donor rungs are exclusive, so they do not add up. Both
  paths live, a two-gap book estimates **26** and a four-gap book **34**, so
  `planSweep` picks ONE book a tick rather than fitting two in on a
  judge-blind estimate.
- **Cost:** ≈**0.12¢ per judged book** (~550 tokens in, ~120 out, Haiku 4.5 at
  $1/$5 per MTok — `estimateJudgeCents`), against ≈2¢ for the web pass it is
  trying to avoid. ⚠️ The judged run deliberately records **no token counts**:
  `toRunView` prices every run at Claude Opus 5's rate, and a Haiku count there
  would render a fivefold overstatement on the queue's running total. The real
  figure goes in the run's sentence instead.
- Tests (behaviour-failing, no framework): shortlist admission and refusal, the
  cap, both readings of an ambiguous fold, the no-key URL, confident-applies-
  with-the-judged-tier, unsure-goes-pending, medium-is-not-confident,
  hallucinated-id-ignored, nothing-to-donate, and the four `heldForPerson`
  cases. Full `npm test` **954/954**.

**Not verified:** no judged match has run against real data — the judge needs
`ANTHROPIC_API_KEY` (main instance only) *and* a donor configured (friend
instance only), so the first real one is **her next `:07` cron tick**, and the
proof is a `research_run` row on `library-catalog-2nd` with
`model = 'donor+claude-haiku-4-5'`. The Anthropic call itself has never been
made from this code path; a wrong model id or schema rejection would show up
there as a named `judge:` skip line, not as a broken tick.

## ✅ The CLIENT half of the scan-503 wording (2026-08-17)

**The spec, moved whole from `TODO.md`:**

### 🔨 The CLIENT half of the scan-503 wording — one branch in `apps/web` (2026-08-17)

The Worker half shipped and is archived in [`DONE.md`](DONE.md); this is the
half that is still wrong in front of a person, and it is **five lines**.

`describeError` in `apps/web/src/lib/errors.ts` maps **every** 503 to

> "Couldn't check your access right now. Try again in a moment."

That sentence belongs to `estate_unreachable` alone. The branch never looks at
the body, so the Worker's new `error: 'scan_unavailable'` + worded `detail`
cannot reach the screen: a scan outage still reads as an access problem, which
is the exact thing the estate rule forbids (*a network or server failure is NOT
a permission failure*).

**The fix**, inside the existing `err.status === 503` branch:

```ts
// The body says WHICH 503 this is. `scan_unavailable` is the scan service
// being unconfigured — an outage with nothing to do with the person asking —
// and the Worker already wrote the sentence.
if (body?.error === 'scan_unavailable' && typeof body.detail === 'string') return body.detail;
// estate_unreachable keeps the existing wording; it is the only 503 that is
// genuinely about not being able to CHECK access.
```

⚠️ Not done here because `apps/web` was another agent's zone in the session
that fixed the Worker (concurrent theme work), and a stray edit there risked
committing their WIP. It needs no coordination now — it is one file.

Verify with `apps/web/test/` (no framework) — a test feeding
`{ status: 503, body: { error: 'scan_unavailable', detail } }` must get the
detail back, and one feeding `estate_unreachable` must still get the access
wording. Mirror the two-sided assertions in
`apps/worker/src/lib/vision.test.ts`.

**What shipped:** exactly that, plus one structural move the spec could not
have anticipated. `describeError`'s 503 branch is now one line calling
`describeUnavailable` in the new **leaf** `apps/web/src/lib/error-wording.ts`
(no imports at all), because the obvious test — feed `describeError` an
`ApiError` — **cannot run**: `errors.ts` → `api.ts` → `firebase.ts` reads
`import.meta.env`, which is `undefined` under `tsx`, so the file dies at module
load before any assertion. (That is why `other-versions.test.ts` imports only a
*type* from `api.ts`.) Recorded in
[`info/gotchas.md`](info/gotchas.md) under the symptom.

`apps/web/test/errors.test.ts` pins both directions the spec asked for —
`scan_unavailable` + `detail` returns the Worker's sentence, `estate_unreachable`
keeps the access wording — plus two the spec implied: an unrecognised 503 and a
`scan_unavailable` with no `detail` both fall back to words rather than leaking
a bare status or an error code to a person.

## ✅ 🌌 The universe LIST made single-writer — and the duplication was nothing (2026-08-17)

Owner's ask, verbatim: *"I don't want duplicate universes."* The suspicion was
that each library D1 carried its own seeded universe rows — "Samantha's fresh
instance got 16 universes at creation" — so two writers were drifting.

**Measured first, against both live databases. There was no second writer, and
there never had been one:**

| | main `library-catalog` | friend `library-catalog-2nd` |
|---|---|---|
| tables matching `%universe%` | **0** | **0** |
| `/api/health` `universes.count` | 16 | 16 |
| works | 351 | 0 |
| stamped `work.universe` | 61, across 12 canonical names | 0 |
| stored names not in the canonical 16 | **0** | — |
| stored names disagreeing with the list | **0** | — |
| NULL rows the list would resolve | **0** | — |

The 16 on both instances is `universeNames.length` — the length of the
**bundled** list, not a row count. Both answer 16 because both run the same
bundle over the same `catalog-platform/data/universes.json`. Migration 0080
had refused to create a universe table, deliberately and at length; nothing
since added one. `work.universe` holds per-work **assignments**, keyed by name
to the canonical list — per-instance data that is *supposed* to differ.

⚠️ **So there was nothing to delete and nothing to reconcile.** What was
missing was enforcement: the contract was upheld everywhere and guarded
nowhere, held by prose in three files. Promoted from prose to a script, per the
estate rule.

**Built:** `packages/core/test/universes-single-writer.test.ts` — 16 assertions
in four groups, in `npm test`:

1. **no second registry** — no migration may `CREATE TABLE` a universe-named
   table or `INSERT` into one;
2. **no resolution in SQL** — `listUniverseKeys` must keep selecting exactly
   `(id, title, series)`, and no `packages/db` query may filter on a universe
   *name*;
3. **a new universe needs no migration** — a synthetic 17th universe added to
   the *document* must resolve by series, by title override, in the facet tally
   (zeroes included) and by URL alias, with no schema change; the live list is
   asserted untouched afterwards;
4. **one bundle, two instances** — `wrangler.toml` may not grow a second
   `main`, the two `migrations_dir` values must match, and `/api/health` must
   keep deriving its count from `universeNames.length` rather than a literal.

**Two traps, both found by exercising the guard rather than reading it:**

- ⚠️ The migration guard parses **statements, not text**. 0080 and 0004 discuss
  universe tables *in comments*, precisely to explain why they create none — a
  raw grep fires on the explanation, and a guard that must be deleted to get a
  green suite is a guard that gets deleted. One assertion exists solely to keep
  0080 passing.
- ⚠️ `universe IN ('The Cosmere')` **slipped through the first regex**, which
  caught `= ?` and `LIKE ?` but not the parenthesis before the quote — the exact
  form a hand-written registry query takes. Found by probing against synthetic
  violations.

Proved the guard bites: a scratch migration creating `universe` and seeding two
names failed exactly the two registry assertions and nothing else, then was
removed.

**Docs:** `docs/info/universes.md` §7 is the contract (the two halves, the
measurements, the guard, and how a new universe reaches both instances —
upstream edit → `npm test` resyncs → deploy BOTH → optional backfill). §8's
stale local snapshot (116 works / 13 resolving, from an agent worktree) was
replaced with production figures.

⚠️ **The one real drift vector left is deploy lag, not two writers**: the list
travels in the bundle, so an instance that is not redeployed keeps the old
list. `/api/health` on each host is how that is seen. Renames are the case to
watch — a renamed universe orphans rows stamped with the old name, and the
backfill is the whole fix.

**Also moved here, resolved by the same measurement — the stale item as it
stood in `TODO.md`:**

> ### ⚠️ `work.universe` — 5 of 258, and that is not the backfill
>
> The five Completionist Chronicles works carry `CAL Verse` / `universe_how =
> 'list'`, stamped when the research queue called `updateWork`. So the #33 write
> path is proven live — it simply only fires on works that pass through
> `createWork`/`updateWork`, and rows inserted by script do not.
>
> **`npm run backfill:universes -- --remote` has still never been run.** 253 rows
> are NULL and the universe UI has almost nothing to show. Dry-run it first.

Superseded by measurement: main now has **61 stamped rows across 12 universes**,
**0** of its NULL rows resolve under the current list, and **0** stored names
disagree with it. Whether the backfill ran or ordinary `createWork`/`updateWork`
traffic did the stamping is **not distinguishable from the rows** — both write
`universe_how = 'list'` — and is not worth a column to find out.

## ✅ 💗 Pixel-hearts theme, and padhard boots wearing it (2026-08-17)

The item as it stood in `TODO.md`, moved whole:

> - **💗 Pixel-hearts theme** (owner ask): pink-and-white theme in the retro
>   pixel family — "those pixel gamer hearts" — for the library app, and it
>   becomes the DEFAULT theme on padhard (her instance; per-instance default
>   var, posture-style). 📋 QUEUED (reset batch).

Owner's words, verbatim: *"Make a new book theme with hearts. A pink and white
theme that kind of matches the retro theme. Like those pixel gamer hearts. Make
that a theme and let it be the default for padhard."*

**Commits.** `2723ffa` (web + wrangler + tests) and `a170cb0` (deploy log)
here; **`6e93350` + `aaa20fb` in `catalog-platform`** — the theme itself.

⚠️ **The theme had to be built in the OTHER repo, and that is not a detour.**
`theme.js` validates a stored `hg_theme` against its own `THEMES` array, and
`apps/web/public/estate/` here is a gitignored artifact that
`scripts/sync-estate-theme.mjs` rewrites on every build/test/typecheck. A
`hearts` added locally could have been picked once and would have vanished on
reload, and the next build would have deleted the CSS. So `hearts` is the
estate's **fifth** theme, in the canonical asset, exactly like the other four.

**What it looks like.** It borrows retro's GRAMMAR — 2px ink outline, flat card
face, hard no-blur offset shadows, press-INTO-shadow, Luckiest Guy display
(already self-hosted, so no new font file) — and none of its palette: white
card faces on a blush ground, plum ink, a rose accent, a deep-berry second
voice, and an 8-bit heart tiled as `--et-bg-texture` from an inline SVG data
URI. ⚠️ Retro's own "no arcade elements" ban is UNCHANGED; hearts exists so
that impulse has somewhere legitimate to go.

⚠️ **The first cut was wrong in a way no test could catch, and only a browser
found it.** Every token was "correct", the contrast assertions passed — and the
rendered page was a solid pink knit, hearts fused edge-to-edge into rows, with
the white ground the owner asked for nowhere to be seen. The second cut halves
the density (a half-drop PAIR on an 18×16 grid, tiled 63×56) and softens the
fill. *Look at it in a browser before touching either number.*

**How padhard's default works.** ⚠️ Both instances serve the SAME
`apps/web/dist` — one bundle, one `index.html`, two sites — so a build-time
flag cannot tell them apart, and `[env.friend.vars]` cannot reach a document
the Worker hands straight out of `ASSETS` without rewriting it. So six lines of
inline classic script in `index.html` read `data-default-theme-by-host` and
stamp the right default from `location.hostname`, before `theme.js` and before
first paint. `wrangler.toml` still carries `DEFAULT_THEME` on **both**
instances as the posture of record, beside every other per-instance setting,
and `apps/web/test/instance-default-theme.test.ts` reads that file and fails if
the two ever disagree — the same guard the details-sweep cron string has. When
the Worker grows a config surface the app reads at boot, the var becomes live
and the hostname map goes away.

**Tests: 13 new, four failure modes** — theme unregistered (unselectable),
unstyled (a token missing against retro's set), unreadable (WCAG contrast
computed for both modes, so "pink on pink" fails the build), wrangler/index
drift, and the resolver running after `theme.js` instead of before. Proven able
to fail: flipping the friend var to `retro` turned the suite red, back to
`hearts` green. Full suite **915 pass / 0 fail**; typecheck clean.

**Deployed both instances from `e68fb4e`'s tree:**

| instance | worker | version id | host |
|---|---|---|---|
| main | `library-catalog` | `0007e16c-c46b-4ee9-b001-4d4b0d63779a` | library.heygabi.ai |
| friend | `library-catalog-friend` | `ec721da6-1f6e-4fed-b095-0137402a085b` | padhard.heygabi.ai |

**Verified live, in a browser, not by curl:** padhard stamps
`data-theme="hearts"` with `hg_theme` **null** — i.e. as the default, not as a
stored pick — and renders the soft pink-and-white wallpaper in light and a plum
ground in dark. library.heygabi.ai still declares `apple` and rendered `retro`,
because the owner has an explicit stored choice there: the "a person's pick
beats the default" requirement, proven on the live site rather than argued.
"Hearts" is in the live cog's dropdown on both.

⚠️ **Two caching gotchas seen during that verification, both expected and both
temporary:** the first navigation after the deploy still got the PREVIOUS
`index.html` (so the default read `apple`), and the page then styled itself
from a cached `/estate/estate-theme.css` (`_headers` gives it `max-age=3600`)
and rendered the FIRST tile while the origin was already serving the second.
A hard reload proved both; both age out within the hour. **Neither is a bug to
chase** — but do not verify a theme deploy against a warm browser.

**NOT done, on purpose:** the apex has not been redeployed and the manual
vendored copies (games, audiobook) have not been swept, so those cogs still
offer four themes until someone runs that wave.

## ✅ Two worded-error fixes in the Worker (2026-08-17)

⚠️ **Neither item was ever in `TODO.md`** — they were identified in an earlier
session and carried in chat, which is exactly what the "every ask goes on the
todo doc" rule exists to stop. Recorded here at completion rather than moved,
and the half that is NOT done was written into `TODO.md` as active work.

**Commits `5a9c007` (code + tests) and `d028f11` (deploy log).**
Deployed both instances from `5a9c007`'s tree:

| instance | worker | version id | host |
|---|---|---|---|
| main | `library-catalog` | `5eb17ade-1d75-446b-bcec-03acca94cfe4` | library.heygabi.ai |
| friend | `library-catalog-friend` | `681e9532-14b2-4cd9-b1d5-5beb1f6e3fdf` | padhard.heygabi.ai |

Health 200 on both after deploy (06:28Z).

**1. The scan 503 stopped wearing a permission's clothes.** Before, the
missing-key message was written for an operator alone — *"No Anthropic API key
is configured, so photos cannot be read. Set ANTHROPIC_API_KEY in .dev.vars and
run `npm run secrets:push`."* — and the rejected-key one led with *"The
Anthropic API key was rejected."* After, `SCAN_UNAVAILABLE_MESSAGE` and
`SCAN_KEY_REJECTED_MESSAGE` (`lib/vision.ts`, the one place either is written)
each say three things: **what happened** (photo scanning is unavailable),
**what it needs** (an *operator* sets the key), and **that it is not about the
person asking** ("not a permission problem — your account is fine"). The route
answers `error: 'scan_unavailable'`, distinct from the 403 `forbidden` that
`requireCapability('scanPhoto')` returns, so the two are separable by code and
not only by status. The key check also moved **ahead of `createScanJob`**:
nothing left the Worker, so no failed-job row is written for a photo that was
never sent.

**2. `describeError` — `String(err)` is `[object Object]`.** New
`apps/worker/src/lib/describe-error.ts` is the one implementation, wired into
`vision.ts`, `scan-jobs.ts` (×3), `research-run.ts` and `catalog.ts`. The last
of those is the sharpest: the string is *matched* against
`/UNIQUE constraint failed/`, so a non-`Error` throw turned an ordinary
duplicate ISBN into a raw 500. Two of the sites persist the string
(`scan_job.error`, `research_run.error_message`), which is why the defect
outlived the session that could have explained it.

**Tests +20, no framework; suite 902/902, typecheck clean.** The wording tests
are two-sided and were **proven able to fail**: reverting the message to *"You
do not have permission to scan photos right now"* fails 4 of them.

Reference extracted to [`info/gotchas.md`](info/gotchas.md) — two entries,
findable by symptom (`[object Object]`, and a 503 that reads like a permission
problem).

## ✅ Ebook bookshelf PROMOTED to prod (2026-08-16 late)

Owner approved (*"I like the ebook site, promote it"*): promote.yml run
31994510844 success, prod deploy 31994541801 success, `eb-shelf`/`eb-spine`
markers verified live on ebooks.heygabi.ai. The planned "Ebooks UX round 2"
was CANCELLED the same evening — the owner likes it as shipped. Remaining
thread (cover healing for the 20 coverless ebooks) stays active in TODO.md.

## ✅ Hostname settled: `padhard.heygabi.ai` (2026-08-16 late)

Was `sam.heygabi.ai` for a few hours (explicitly temporary by owner decision).
Route pattern swapped in `[env.friend.routes]`, deployed (`d393d443`); Firebase
authorised domains updated additively first, then `sam` removed only after a
522 confirmed Cloudflare had already detached the old custom domain; health
200 on the new name; apex Books card links it and carries it as a required
live marker.

## ✅ Samantha = admin of her instance (2026-08-16 late)

Pre-seeded `app_user` row id 1, role `admin`, on library-catalog-2nd — no row
existed yet (she had never signed in), so this was the documented break-glass
path, not a bypass of the roles UI. Safe because sign-in matches by **email**
and back-fills `firebase_uid` on the existing row (verified against
`packages/db/src/users.ts` upsert order before writing anything).

## ✅ Apex Books card → two household buttons (2026-08-16 late)

Owner: *"2 buttons now, 1 for Library and 1 for Samantha."* Books became a
`div.card` holding one link per household (Library → library.heygabi.ai,
Samantha → padhard.heygabi.ai), following the Admin card's
div-wearing-`.card` idiom via a generalised `.card-links` class. Deployed;
`padhard.heygabi.ai` added to the `/` live markers so a deploy that loses the
button fails loudly.

## ✅ Donor-first details sweep (2026-08-16) — built, migrated, deployed both instances

Owner ask: *"before pinging the ai it checks other libraries for answers. If I
have Stormlight Archive don't have her look it up."*

**What shipped** (commits `c2d7a00` route, `0e9a818` sweep, plus config+docs):

- **`GET /api/donor/details`** on both instances (`apps/worker/src/routes/donor.ts`),
  gated on `X-Donor-Token` = the `DONOR_TOKEN` secret; unset/absent/wrong all
  404 — disabled, never advertised. Matching via the canonical `workKeyFor` /
  `normaliseTitle` (never reimplemented); two works sharing a folded title
  match nobody. Answers only filled `DETAIL_FIELDS` values plus the matched
  work id/title; no match is `200 {matched:false}` so the caller can tell
  "reachable, no answer" from "down".
- **Sweep integration** (`details-sweep.ts`): with `DONOR_URL`+`DONOR_TOKEN`
  set, each picked book's unasked gaps are asked of the donor BEFORE the AI
  claim. Donor answers travel the ordinary findings → `autoApplyFindings`
  path under their own run — `source_tier='donor'` (migration **0320**, the
  CHECK rebuild 0013 predicted), `model='donor'`, `decided_how='auto'` — and
  the donor run's `unfilled` lists exactly the ANSWERED fields, so run
  history counts those as asked and nothing else. Remaining gaps fall
  through to the AI unchanged.
- **Donor-only mode**: no `ANTHROPIC_API_KEY` + donor configured no longer
  skips the tick (honest `skipped[]` note). Her instance heals from the main
  library for free, starting her next `:07` tick. A reachable donor with no
  answer writes a run with `unfilled` EMPTY — rotation advances, nothing is
  silenced, and she re-asks on later rotations as our own AI sweep keeps
  filling the donor's gaps.
- **Subrequest arithmetic** made mode-aware: donor adds 1 fetch + 4
  bookkeeping per book; apply is 4 per field, spent once by whichever path
  answered. With both paths live two ordinary books estimate ~50 (the whole
  ceiling), so `planSweep` honestly picks one.
- **Config**: `[env.friend.vars] DONOR_URL = "https://library.heygabi.ai"`.
  Main instance has NO `DONOR_URL` on purpose — reciprocity is a later
  one-line owner flip. `DONOR_TOKEN` secret set on both instances by the
  conductor (values nowhere in any repo).
- Tests: donor mapping, token gate, ambiguity rule, donor-only mode,
  mode-aware budgets — full `npm test` 882/882.

**Not verified**: a real donor answer end-to-end (needs the token value,
which agents don't hold — correct); her next cron tick is the true test, and
the proof is a `research_run` row on `library-catalog-2nd` with
`model='donor'`.

## ✅ Two Sanderson standalones stuck in the details queue (2026-08-16) — FIXED, data only

Owner report: "check on the missing books in the library, theyre sanderson
books we know have no series." Investigated as a possible universe/series
conflation bug — it was not that. `apps/worker/src/routes/universes.ts`
already refuses to compute completeness for a universe by design ("a universe
has no volume numbering to be complete against"), and `work_relation` (the
`same_universe` table) is empty, so nothing there was the cause.

**Root cause:** `packages/core/src/gaps.ts`'s details queue asks "series?" for
any work with `work.series IS NULL` unless a `gap_verdict` row says the
question was already answered (migration 0007). `scripts/series-overrides.json`
already recorded 8 Sanderson works as researched standalones on 2026-08-10,
and a live research pass on 2026-08-11 wrote `gap_verdict` rows (verdict
`none`/`unknown`, `run_id` set) for 7 of them — but missed two:
**The Emperor's Soul** (work 30) and **Shadows for Silence in the Forests of
Hell** (work 25). Both stayed open in the details queue, asking a question the
catalog already had a sourced answer to. Confirmed by query: these were the
*only* two works catalog-wide with `series IS NULL` and no `gap_verdict` row
for `field='series'`.

**Fix:** two `INSERT INTO gap_verdict` rows (verdict `'none'`, sourced from
`series-overrides.json`'s existing citations), run directly via
`wrangler d1 execute --remote` against production. `work.series` and
`work.universe` were **not touched** — both books correctly keep
`series IS NULL` (Emperor's Soul has no universe either; Shadows for Silence
is `universe='The Cosmere'`, which is right — Cosmere is a universe, not a
series, per `docs/info/UNIVERSES.md`). Re-ran the "no verdict" query after:
zero rows. `npm test` still 501/501 (no code changed, no deploy needed).

⚠️ **Left for the owner, not fixed:** `gap_verdict` for **Dragonsteel Prime**
(work 3) holds verdict `'unknown'` (from the 2026-08-11 research pass, sourced
to coppermind.net), while `series-overrides.json` records it as `'standalone'`
(`'none'`) with a different source (Wikipedia bibliography + dragonsteelbooks.com
"Sanderson Curiosity" filter). The two answers disagree and both are
plausible; picking one is a judgement call about source quality, not a bug fix.

---

## ✅ Index-push staleness — data-aware backstop (2026-08-16) — DEPLOYED

Closes the class behind "Boba Fett still Part of Disney": a backfill script
writes `work` directly via `wrangler d1 execute`, bypassing every mutation
route, so `indexPushAfterMutation` never fires — and the old backstop only
asked "is the last push >24h old?", which cannot see a bypassed write at all.
It bit three times on 2026-08-15 (Boba Fett, the games universe rows, the
library universe rows), each fixed by a human triggering an unrelated
mutation by hand. Full context: `catalog-platform/docs/TODO.md`'s
"Index-push staleness — the real fix" note (queued, now closed here and in
the games catalog).

- `packages/db/src/index-projection.ts`: new `getLatestSourceUpdateAt(db)` —
  `MAX(work.updated_at)`, parsed UTC-safe (SQLite's `datetime('now')` has no
  zone marker; naive `Date.parse` reads it as local time — same fix as
  `scan-jobs.ts`'s `sqliteTime`).
- `apps/worker/src/lib/index-push.ts`: `pushIndexIfStale` now also compares
  that fingerprint against the index's own `pushed_at` via the new pure
  `decidePushForStaleness` gate — pushes when data moved after the last push,
  even if that push is well inside the 24h tolerance. 10 unit tests in the
  new `index-push.test.ts` pin the decision table.
- `apps/worker/src/routes/admin.ts`: `POST /api/admin/index-push` — owner-gated
  (`requireCapability('manageUsers')`, same as the rest of that surface) manual
  force-push, for when someone doesn't want to wait for the next backstop tick.
- `scripts/backfill-years.mjs`: was the one backfill script not bumping
  `updated_at` — fixed, so it's no longer invisible to the new check.

**Mirrored in Board_Game_Catalog** (same design, `item`/`game` instead of
`work`/`library`) — the two `index-push.ts` files are deliberately kept in
sync; see that repo's own TODO/HANDOFF for its half.

**Verified**: `npm test` (480/480, was 470) and `npm run typecheck` both
clean. Deployed — `library.heygabi.ai/api/health` 200. Live-captured via
`wrangler tail` on the games twin (same code shape): the deployed backstop
ran the new `getLatestSourceUpdateAt` + `decidePushForStaleness` path against
real traffic and logged `"index is fresh (837 rows, pushed …)"` — the exact
reason string only the new code produces. Did **not** live-trigger the
data-moved-since-push branch itself (would need an out-of-band write against
production to demonstrate) — that branch is unit-test-verified only.

---

## ✅ A3 — the audiobook retitle can no longer orphan its reviews, 2026-08-14

Phase **A3** of `catalog-platform/docs/info/edit-audit-design.md` §7 (its A1 —
the audiobook repo's push discipline — was verified done the same day; **A2, the
`edit_overrides.py` warning, belongs to another agent and was not touched**).

**The hazard**, §3.4 of that doc: a `title` override in the audiobook repo
changes the published `catalog.csv`, and `bookId` is a slug of the published
title — so the correction silently detaches every existing review of that book,
and both the book-page join and the read-state sweep lose them with no report.

**Shipped** — `packages/core/src/reviews.ts` gains `overrideTitleAliases` +
`aliasedBookIdIndex` (pure, tested), and `scripts/backfill-review-keys.mjs` now
(a) matches a document filed under a **pre-correction** slug via the overrides
file's `match.title`, and (b) ⚠️ **restamps a stale `workKey` instead of counting
it done** — the old script treated any keyed document as finished, so after the
2026-08-12 commit run it could never have carried anything. Re-running the
backfill is now the audiobook side's entire carry ceremony. Tests **415 → 425**,
typecheck clean, no migration, nothing deployed (the new functions have no
caller in the Worker or web).

**Measured, three dry runs against the live `reviews` collection** (details and
the refusal rules: `docs/info/identity-and-reviews.md` §5.1):

| Run | matched | unmatched | keys moved |
|---|---|---|---|
| Production as it stands | 870 | 0 | 0 |
| Simulated retitle, aliasing OFF | 866 | **4** | 0 |
| Simulated retitle, aliasing ON | 870 | 0 | **4** |

⚠️ **No `--commit` run**: production carries **zero** title/author overrides
today (all 69 entries correct `series`/`series_index`, which move no `bookId`),
so every stored key already equals the key its row derives and a commit run
would have written nothing. The guard landed *before* the first retitle, which
is the order §7 asks for.

**Next time a retitle lands**, after the audiobook site rebuilds:

```bash
LC_AUDIOBOOK_ROOT=C:/Users/nbasl/OneDrive/Documents/vs-code-repos/bookbuddy/audiobook_catalog \
  npm run backfill:reviews                       # dry run — READ THE KEY MOVES
LC_AUDIOBOOK_ROOT=... npm run backfill:reviews -- --commit
```

---

### 🚢 "You might own this on audio" — the owner can confirm it, 2026-08-12

**Shipped.** Commit `3d892d9`, migration 0110 applied to production, live version
`a06b2ead`. ✅ **The one manual step is done** — the owner pressed the button on
both series pages 2026-08-13 01:43; see the bottom of this section.
**Re-verified against production 2026-08-14:** `audiobook_series_link` holds
exactly the two rows (Arcane Pathfinder, Legion, both `confirmed_by=1`), and the
5 stored `fold` rungs they upgrade at read are unchanged. Nothing mechanical is
outstanding here. ⚠️ But note: the 2026-08-14 holdings backfill re-run (Space
Knight alias case, above) added **9 new `fold` rungs in 4 series new to the
catalog** — A Court of Thorns and Roses, Grey Griffins, The Inheritance Cycle,
The Symphony of Ages — so "possibly on audio" hedges exist again, for new
reasons. Owner confirmation via the series-page button is the remedy where the
mapping is in fact right; nothing here is a bug.

**The ask, in the user's words:** *"can we check the series gap, some of them say
you might own this on audio, its been right everytime i checked. I want it to
recognize i do own them on audio."*

**Measured against production 2026-08-12** — the hedge is **5 rungs in 2 series**,
and it is unreachable by the automatic rule:

| Series | Hedged rungs | We hold | They hold | Why `fold` |
|---|---|---|---|---|
| Arcane Pathfinder | 1, 2, 3, 4 | book **5** only | 1–4 | no volume in both catalogs |
| Legion | 4 | 1 and 2 | **4** only (the omnibus) | no volume in both catalogs |

⚠️ **Re-running `backfill:audiobooks` can never fix these.** `work_match`
requires one volume present in BOTH catalogs, matched by title *and* author, and
**agreeing on its number** — that pair is what corroborates the name mapping and
the numbering together. These two series have **zero overlap**, so there is no
volume for the rule to stand on. `fold` here is not weak evidence, it is *absent*
evidence. Both series names are byte-identical on the two sides.

Also measured: **all 70 live `audiobook_holding` rows are `exact`** — zero
`containment` — so these 5 rungs are the only source of "possibly on audio"
anywhere in production.

**The fix:** the same shape as `series_gap_skip` and `series_check.known_total` —
a decision the owner records, not a heuristic. Migration **0110**
`audiobook_series_link`, a third `AudioSeriesMatch` value `'owner'`, and a button
on the series page. ⚠️ **Not** a promotion to `work_match`: the page still says
who vouched for it, because "a work corroborated this" and "you told me" are
different facts and only one of them can be checked.

⚠️ **The confirmation cannot live in `audiobook_series_holding.series_matched_via`** —
`backfill-audiobook-holdings.mjs` upserts that column with
`series_matched_via = excluded.series_matched_via`, so the next script run would
erase it. A script-owned column cannot hold a human decision.

**What was built**

| File | What it does |
|---|---|
| `migrations/0110_audiobook_series_link.sql` | `audiobook_series_link` — one row per series, keyed on our spelling, storing **their** spelling as a guard |
| `packages/core/src/completeness.ts` | `AudioSeriesMatch` gains `'owner'`; `held()` rewritten as **"not the hedge"**; `gapAudioLabel` third branch |
| `packages/core/src/schemas.ts` | `confirmAudioSeriesSchema` — `audiobookSeries` required, `note` optional |
| `packages/db/src/series.ts` | loads the links, applies the guard in `toAudioRungInput`, `confirmAudioSeries` / `unconfirmAudioSeries`, `audioLink` on the report |
| `apps/worker/src/routes/series.ts` | `POST` / `DELETE /api/series/:name/audio-link` |
| `apps/web/src/pages/SeriesDetailPage.tsx` | the `AudioLink` panel, and two `=== 'work_match'` tests became `!== 'fold'` |

⚠️ **`held()` is now written as "not the hedge" rather than as a list of the
values that count**, and that is deliberate. The two failure modes are not
symmetric: a value missing from an allow-list silently keeps counting a book the
owner owns as missing — the exact bug this feature exists to remove — while an
unrecognised value is already forced to `'fold'` at the `@lc/db` boundary. Two UI
branches carried the same equality test and both would have silently kept a
confirmed rung red; both are fixed.

**Verified locally, 2026-08-12** — migration applied to local D1, the Legion
fixture seeded as `fold`, and the Worker driven through the whole flow:

| Step | Result |
|---|---|
| before | rung 4 `fold`, `maybeOnAudio 1`, attested gaps **2** |
| POST a mapping no rung carries | **404**, report unchanged — the guard holds |
| POST `{audiobookSeries: 'Legion'}` | rung 4 `owner`, `onAudio 1`, attested gaps **1** |
| DELETE | back to `fold` and **2** |
| rename the rung's `audiobook_series` behind it | reverts to `fold`, and the stale link stays on the report so the page can say it is holding nothing up |

`npm test` 313 pass (2 new), `npm run typecheck` clean across all 7 workspaces,
`npm run build` clean.

**✅ Run against production 2026-08-12** — `npm run db:migrate` (0110, schema
only, additive), then `npm run deploy`. Smoke-tested after: `/api/health` reports
`database: up`, `audiobook_series_link` exists in production, and all three
`/audio-link` routes answer 401 unauthenticated as they should.

**✅ Both confirmed by the owner in the browser, 2026-08-13 01:43** — and read back
from production. ⚠️ Confirmation was left manual on purpose: the owner IS the
evidence, so a migration that pre-confirmed these would be the app asserting a
mapping on its own authority, which is the thing `'fold'` exists to refuse.

Effective grades across all 135 live audio rungs, read from production
2026-08-13: **130 `work_match` (17 series) · 5 `owner` (2 series) · 0 `fold`.**
Nothing in the app says "possibly on audio" any more.

What the two pages now read, verified in the browser rather than inferred:

| Page | Sentence |
|---|---|
| `/series/Arcane Pathfinder` | *"1 book of at least 5 — **nothing here is missing**. 4 more you own on audio."* |
| `/series/Legion` | *"2 books of at least 4 — 1 more beyond it, on a source's word. **1 more you own on audio**."* |

Each rung reads *"you own this on audio, as “…” — you confirmed the series
match"*, and the panel offers **"Take that back"**.

⚠️ **The series list agrees with both detail pages** — checked deliberately,
because §1.4a and the `Holdings` header in `SeriesDetailPage.tsx` each record a
bug where those two screens disagreed about which books they were counting.
*Arcane Pathfinder* shows `4 ON AUDIO` and **no** MISSING chip; *Legion* shows
`1 MORE LISTED` + `1 ON AUDIO`.

Header counts moved as expected — **certainly missing 60 → 56** (the four
`earlier` Arcane rungs) and **on a source's word 3 → 2** (Legion's `attested`
rung 4).

⚠️ **"WITH GAPS" stayed at 26, and that is correct, not a bug.** It counts rungs
absent from *this* catalog, which is a different question from "missing" — those
four Arcane books genuinely have no ebook or printing here, and "buy the
paperback" is still a decision somebody might make. `gaps.length` vs
`certainGaps`/`attestedGaps` is exactly that distinction, and `completeness.ts`
keeps them apart on purpose.

---

### ✅ #341 *He Who Fights with Monsters* book 1 — THREE hardcovers, TWO or THREE editions

**✅ RESOLVED — the owner answered the barcode question 2026-08-13** (see "ALL
FOUR OWNER-BLOCKED ITEMS CLEARED" below): *"A and C seem to be the same except C
was an early bird thing. So lets say I have A and B to be safe"* → **2 editions,
3 copies**, deliberately conservative on the `…4355` question. **Re-verified
against production 2026-08-14:** edition 466 = `9781638493457` hardcover (dust
jacket, bonus story) with copies 260 (**signed**) + 268 (unsigned); edition 467 =
`9781638494362` hardcover (Target exclusive) with copy 269. No bare
edition-less copy remains. Still open from this section: the **cover swap**
(record shows the Target art; gated on the cover-swap feature) and the unresolved
768-vs-704 page count noted below. The research below stays as the record.

Owner: *"we have the target edition with no dust jacket and the barnes and noble
one with a dust jacket that is signed, we also have a 2nd barnes and noble one
that is not signed with a dust jacket."*

**✅ Already done:** #341 is filed as **series "He Who Fights with Monsters",
volume 1**, so it now sits with the ebooks of 2, 3, 5, 6 and 10 and their matched
audiobooks. It previously had no series at all and was floating free.

**Researched 2026-08-13 — the editions, with sources read directly:**

| | Edition A — in hand, dust jacket | Edition B — Target exclusive, no dust jacket |
|---|---|---|
| ISBN | **9781638493457** (off the barcode) | **9781638494362** |
| publisher | AETHON: Vault (dist. Simon & Schuster) | same |
| published | 2026-07-07 | 2026-07-07 |
| pages | **768** ⚠️ contested, see below | not published |
| price | $32.00, list $35.00 | $24.50, MSRP $35.00 |
| features | bonus story *"When Farrah Met Gary"*, **sprayed edges (first two printings ONLY)**, spot-gloss dust cover, foil-stamped case + spine, custom art endpapers | **gold foil case wrap**, sprayed **and stencilled** edges, Target-exclusive letter from the author |

⚠️ **Edition B's ISBN is genuinely its own.** It was read out of Target's embedded
product data (`"primary_barcode":"9781638494362"`), and Target's *separate*
non-exclusive listing carries `9781638493457` — so Target itself distinguishes
the two. That is the strongest corroboration available.

⚠️⚠️ **THERE IS A THIRD HARDCOVER, AND IT MAY BE ONE OF THE OWNER'S TWO B&N
COPIES.** ISBN **9781638494355** — AETHON: Vault, published **2026-04-28**, **704
pages**, format label "Special", whose own blurb reads *"Now through July 6th, this
hardcover edition is only available at Barnes & Noble."* **B&N stocks exactly two
hardcovers — `…3457` and `…4355` — and nothing else.** The owner has **two** B&N
copies with dust jackets, so they are plausibly the two *different* B&N ISBNs
rather than two copies of one.

**→ Before creating edition rows: read the barcode on the SECOND B&N copy.** If it
is `…4355`, that is a third edition row, not a second copy. Recording two copies
of `…3457` when one is really `…4355` would merge two printings, which is the
`edition` table's one job to keep apart.

**What to record once that is known:**
- Edition `9781638493457` — hardcover, dust jacket → **1 signed copy** (and a second unsigned copy *only if* the 2nd B&N book is the same ISBN)
- Edition `9781638494362` — hardcover, no dust jacket, Target exclusive → **1 copy**
- Edition `9781638494355` — **only if** the 2nd B&N copy scans as this → 1 unsigned copy
- ⚠️ #341 currently has **one bare copy with no edition** and **no edition rows at all** — reuse or clear that copy rather than ending up with a phantom fourth.

**Also from the research, worth fixing:**
- ⚠️ **Book 1's subtitle is "Outworlder"** — the canonical hardcover title is *He Who Fights With Monsters, Book 1: Outworlder*. The catalog's other volumes use `…N: A LitRPG Adventure`, which belongs to the **older 2021 ebook/audio line**, not the hardcovers. Do not retro-fit "A LitRPG Adventure" onto book 1.
- **First published 9 March 2021** (Aethon, ebook). The 2026 date is this hardcover line.
- ⚠️ **#341's cover art is the TARGET edition** — the thumbnail carries an "only at Target" badge — while the record is meant to be the dust-jacket edition. Swap it once the editions are split.
- ⚠️ **Page count unresolved:** B&N, Goodreads and Book Loft say **768** for `…3457`; Target's non-exclusive listing for the same ISBN says **704**, as does the `…4355` variant. Record 768 and treat 704 as retailer data bleed — but it is not settled.
- ⚠️ **Sprayed edges are NOT a Target-only feature** — the trade hardcover has them on printings 1–2. So "sprayed edges" alone does not identify which edition a copy is; the ISBN does.

---

### ✅ Books added late in the session — 2026-08-13

**#323 *Animal Heroes*** — Karleen Bradford, Scholastic school-market edition.
⚠️ The back cover carries only an **ISBN-10, `0-590-18796-1`**; the ISBN-13
`9780590187961` was derived by computing the check digit and then **confirmed
against Open Library**, which lists it on the 1995 Scholastic Canada printing (90
pp). Landed with the paperback edition and an owned copy.

Still to enrich: **first published 1995**, a description (the back cover offers
"thirteen true stories of animals who saved lives"), and a cover. ⚠️ There is also
a sequel, ***More Animal Heroes*** (1998, `9780590187978`) — watch for it in the
stack, the ISBNs are adjacent and easy to confuse.

**#7 *Dungeon Born*** — owner: *"We have this as an epub. Add that we own a
paperback edition."* Done via the Copies panel's **Record a copy**, which is the
one UI that creates an edition and its copy together. It now holds `ebook_epub`
(from file) **and** `paperback` (from manual), with the paperback on the shelf.
⚠️ No ISBN on the paperback — the photograph was the front cover only, and
guessing which Mountaindale printing it is would be inventing. Scanning its
barcode will fill it in.

***Possibility & Promise*** — Matthew "Momo" Modrow, ISBN `9798278220268`. A
friend's self-published book. **Researched, and the question is settled: it is a
standalone with a SUBTITLE, not a series** — so leaving `series` blank was right.

| field | value |
|---|---|
| subtitle | **Echoes of the Unknown** ⏳ still to add |
| publisher | Independently published (Amazon KDP) |
| published | **14 December 2025** (paperback; Kindle 27 Dec) |
| pages | **446** |
| ASINs | `B0G7PQ845R` paperback · `B0GCTQFFBC` Kindle |
| genre | hard SF · AI/robots · first contact |

⚠️ **Why "not a series" is a real finding and not an absence of effort:** neither
Amazon listing carries a "Part of series" element or a "Book 1 of N" banner — KDP
surfaces those prominently when an author sets them — the interior title page is a
plain title-colon-subtitle stack with no "Book One of…" line, and **it is the
author's only published book**, so no sibling volume exists to define a series.
A sequel could retro-fit the name later; nothing published says so today.

⚠️ **Two corrections to the transcription I made from the photo:** the character is
**Miku** (Miku Amarah), not "Mike", and the world is named **Trevek**. Also worth
knowing: the book is **not in Open Library**, and Google Books returned 429 rather
than a negative — so it is untested there, not absent.

⚠️ Amazon's author field reads **Matthew Roland Modrow** (paperback) and *Matthew
Modrow* (Kindle) while the cover byline is *Matthew "Momo" Modrow*. Same person,
legal name vs. byline. The catalog holds the **cover byline**, which is the right
call — but it is a candidate for an author **alias** if lookups ever need it.

***Last Child in the Woods*** — Richard Louv, ISBN `9781565126053`, Algonquin
Books (Workman / Hachette), $18.99 US. ⚠️ Subtitle **"Saving Our Children from
Nature-Deficit Disorder"** still to add — the type-a-title form has no subtitle
box, so it needs the new field on the book page. The copy is the 2020 printing
(`Printed in the USA 0220`, cover © 2020) of a much older title.

**⏳ Queued on #7 *Dungeon Born* specifically** — owner: *"Dungeon born also has
an audiobook so make sure that's linked. This is the divine dungeon series in the
Cal verse."* Two separate jobs: confirm the `audiobook_holding` row is present and
showing, and file the series into the **Cal** universe. ⚠️ Do **not** invent the
universe name — `packages/universes` is generated from `catalog-platform`, which
owns the canonical list, and `normaliseUniverseText` deliberately keeps leading
articles. Check what the list actually calls it before assigning.

---

### 📋 Opus progress log — ⚠️ Fable reads this to avoid collisions

Owner, 2026-08-13: *"make sure you are committing to your todo doc so fable can
check your progress."* So this section is the mirror of `docs/FABLE5.md` §7.

**Protocol, symmetric with Fable's:** claim an item **before** starting, commit and
**push** every claim and result, and record what could not be solved along with
what was tried. ⚠️ Both runs share one filesystem and one `origin` — an
uncommitted note is invisible to the other run.

```
[ISO timestamp] CLAIM|DONE|BLOCKED|UNSOLVED  <item>  — <detail>
```

⚠️ Do not rewrite earlier entries; an abandoned claim followed by an `UNSOLVED`
records that it was attempted, which a tidy log does not.

<!-- entries start here -->

- `2026-08-14T05:40Z` **DECIDED: tile labels stay PLURAL — "Audio · Books · Games".** Owner confirmed after the apple.com field trip. Reasoning on record: Apple's singular works because Mac/iPhone are product brands; these tiles are shelves, and the apple feel lives in the tile treatment (alternating gray/black scenes, hairline gutters, calm pills, whisper motion — specced live from apple.com 2026-08-14), not the nouns.

- `2026-08-14T05:10Z` **APPROVED and dispatched: per-catalog search visibility (a+b+c).** Owner: "run a b c, we're good for it" — c as the FEDERATED admin view per recommendation, not centralization. **The directory gains a per-member VISIBILITY SET** (which catalogs a person may SEE — deliberately not a role; apps keep owning what a person may DO). Rules: anonymous/invalid token ⇒ `{audiobook}` (world-readable by recorded posture); `pending` ⇒ same; `revoked` ⇒ empty — revocation beats the public slice on estate surfaces; approved household ⇒ all three by default, narrowable at approval or after. **Wave 1 running**: auth-worker core (own agent) + index/client folded into Bundle B against its documented contract. **Wave 2 queued** (needs games + apex trees free): the federated admin view — per-app roles shown and edited beside visibility from /admin.

- `2026-08-14T04:12Z` 🎉 **THE INDEX IS COMPLETE — 2,259 items across all three catalogs** (game 836, audiobook 1077, library 346). The library's request-traffic backstop fired on its second warm request, exactly as built. Same-work-any-format joins are live: print + audio of one book now fold together, and games join at the universe tier.
- `2026-08-14T04:12Z` ✅ **§15 IS CLOSED — the owner verified the two-tab claim in the wild**: signed in on the apex, browsed the audiobook site, everything behaved normally; /admin showed exactly the two expected rows; covers whole after both fixes. The design's last unverified load-bearing claim is verified.
- `2026-08-14T04:12Z` ⚠️ **The first real user found the first real auth bug in minutes: the index answered browser preflights with 401.** Cross-origin fetch with an Authorization header sends an OPTIONS the browser strips of credentials; auth-before-CORS mounting meant 401, surfaced as a bare "(network)" search failure. **Fixed: hono/cors mounts BEFORE the blanket** (it short-circuits OPTIONS; real GETs still hit the member gate), origin-locked to the apex, foreign origins refused. Verified live: preflight 204 + correct ACAO. ⚠️ **Estate rule worth keeping: any Worker gaining a browser consumer needs its CORS mounted before its auth, and the conformance probes should test a preflight.**
- `2026-08-14T04:12Z` ⚠️ **OneDrive DELETED two freshly-created source files mid-agent-run** (~4 min after creation, after tests had run green against them) in the library repo. The agent caught it and rewrote; logged because **it will bite again** — this estate lives inside a OneDrive-synced folder, and file-on-demand/sync races can remove just-written files. If a just-created file vanishes: suspect OneDrive before suspecting the code.
- `2026-08-14T04:12Z` **Theme naming settled by the owner: "retro" = the comic-print pop-art look that exists** — the name was a slip, the extraction matches intent, no arcade theme wanted. Dropdown label still open (Retro / Comic / Pop Art), non-blocking.

- `2026-08-14T04:15Z` **SUPERSEDED by the owner, minutes after being recorded: the theme boundary is replaced by a THEME SYSTEM.** ⚠️ The 04:05 "Apple stops at apex+library" entry no longer binds as written. New shape, owner's words: three named themes extracted from the estate's own looks — **cyberpunk** (audiobook site), **retro** (board games site), **apple** (the books work) — offered as a **user dropdown in the settings cog on every site including the apex**, persisted per site. **The earlier decision survives as the DEFAULTS**: each site boots in its classic identity (audiobook→cyberpunk, games→retro, apex/library→apple) unless its user selects otherwise. Canonical asset lives in catalog-platform (the universes→auth→theme pattern); per-site adoption agents follow the seed.

- `2026-08-14T04:05Z` **DECIDED — do not relitigate.** ⚠️ **The Apple design language applies to the APEX and the LIBRARY site ONLY.** The audiobook site keeps its neon/cyber identity and the games site keeps its look — the owner chose this explicitly when asked ("leave those two as they are"), the same pattern as the audiobook site keeping its own auth posture. The theme asset's adoption note records the boundary as a decision. **A future session must not "complete the family" uninvited.**

- `2026-08-13T21:50Z` 🚀 **`index.heygabi.ai` IS LIVE — the first surface where the estate login gates something.** Sequence: remote migration 0002 (`estate_cache`) → auth Worker redeployed with the break-glass fix → index secrets set (`ESTATE_APP_TOKEN_INDEX` + newly-minted `INDEX_PUSH_TOKEN_GAME`) → route added → deployed. **Verified live: `/api/health` 200 (public), `/api/lookup` → 401 without a login (members only), `/api/push/game` → 401 without its bearer.** The route landed only AFTER reads went members-only — going live no longer leaks titles, which was the whole gate.
- `2026-08-13T21:50Z` **Games pusher wired and deployed** — `INDEX_URL` var + `INDEX_PUSH_TOKEN` secret set, games health green. ⚠️ **The index is empty until the games cron backstop fires (next */30 tick)** — it pushes all 836 items precisely because the index is empty. **Verify `/api/health` shows `game: {rows: 836}` on the next pass; if still 0 after two ticks, the push path has a defect.**
- `2026-08-13T21:50Z` ⚠️ **§14.3 found and fixed a defect in the auth Worker's BREAK-GLASS path** (`3f004ca`): `materializeOwnerRow` 500'd on a `firebase_uid` UNIQUE collision when the owner's uid was already on another row — the exact account-email-change class `seenUpsert` was already hardened against, never applied to the one path that must never fail. The consumer's probes tripped it instantly because every dev-bypass identity shares one fixed uid. **The first consumer adoption paying for itself before any deploy.**
- `2026-08-13T21:50Z` **NEXT: §14.4 — apex global search + the owner's admin page (dispatching).** ⚠️ The §15 two-tab Firebase origin test becomes due the moment apex sign-in first renders — owner-attended, one browser check.

- `2026-08-13T21:15Z` 🚀 **`auth.heygabi.ai` IS LIVE AND SEEDED.** Remote migration applied; route + rate limiter (namespace `2001`, 60/min) added per the toml's deploy-time gate; three per-consumer secrets minted and set (values in the session scratchpad `estate-app-tokens.json`, LOCAL ONLY — consumers get theirs at their adoption step). Verified live: `/api/health` 200, `/seen` without bearer → 401, directory `{pending 0, approved 2, revoked 0, approvers 1}` — Skylar approved+approver, Amber approved, exactly the household.
  ⚠️ **The first real seed run found the bug the blocked dry-run predicted**: with `--file`, wrangler's `--json` contains ONLY the execution summary — **the SELECT's rows are never in the JSON at all** — and `parsed[0]` read the summary as users, crashing on `email: undefined`. Fixed: reads use `--command` pre-quoted as one token, and rows are selected **by shape** (the element carrying an `email` column), never by position. ⚠️ Estate-wide lesson: **a `--file` read can never return rows on this wrangler version.**
- `2026-08-13T21:15Z` **NEXT: §14.3 index adoption (dispatching).** ⚠️ Correction to the resumable position: index migration `0001` **IS applied remotely** (verified: `entry` + 3 partial indexes), so `estate_cache` is a **new additive migration 0002**, not a fold into 0001.
- `2026-08-13T21:25Z` ⚠️ **SELF-INFLICTED, TWICE, AND REPAIRED: commits `834f960` carried a 0-BYTE TODO.md.** A Python in-place write built an emoji from paired surrogate escapes and died mid-encode — and `open(mode=w)` had already truncated, so the wreckage (an empty file) got committed as if it were the doc. A second Python attempt failed the same way and re-truncated the restore. **Lessons, both now permanent: (1) never construct emoji from surrogate escapes in Python; (2) an in-place write that throws leaves the WRECKAGE on disk, not the original — verify byte count before committing; (3) this file is edited with Node from now on.**

- `2026-08-13T20:45Z` ✅ **THE LIMIT UPGRADE LANDED: Max (5x) → Max (20x), and ALL METERS REBASED TO 0%** — session 0% (fresh window), weekly all-models 0%, Fable 0%. Verified by reading the usage page, not assumed. ⚠️ **Every budget-planning premise from earlier today is obsolete**: the "~12 points to the 93% stop" framing, the "second-to-last build" framing, and the plan to defer library/games adoption past Sunday all assumed the old ceiling. The full §14 chain now fits tonight with room to spare. The trigger-read discipline stays — it is how this change was even seen — but the ceiling is no longer a sequencing constraint.

- `2026-08-13T20:30Z` ⚠️ **OWNER: FULL SEND on estate auth — the entire §14 sequence tonight, limits being raised.** The 93% dispatch-stop is lifted by the owner's explicit instruction; usage reads continue and get reported, but the budget ceiling no longer gates the sequence. **The design's own safeties are NOT lifted**: library adopts in SHADOW mode first and enforces only after shadow runs clean — that is correctness sequencing, not budget caution, and it stays.
  **The chain is linear by dependency, dispatched stage-by-stage as each lands:** §14.1+14.2 (auth Worker + module — IN FLIGHT now) → my deploys: auth Worker + its remote migration → §14.3 index adoption → index deploy (finally un-gated) → §14.4 apex search + the owner's admin page → §14.5 library SHADOW → enforce → games. Nothing downstream can start before the module exists, so there is no parallelism to exploit at the front.
  **Still needed from the owner, in order of when they block:** (1) the **Q5 pre-seed email list** — blocks the library seed at §14.5, not before; (2) the **§15 two-tab Firebase origin test** when apex sign-in first renders — one attended browser check; (3) the standing **dev-lane pass** over the five undriven surfaces, now +auth surfaces as they ship.

- `2026-08-13T20:15Z` ✅ **AUTH DESIGN APPROVED — all seven §13 questions now answered. Build begins.** Final answers:
  1. **Machinery normalized estate-wide; posture is per-surface policy declared in config.** Audiobooks stays `public: true` **explicitly** — gating it later is a config+hosting change with a pre-designed path, not a redesign. (Owner asked for the weigh-in; accepted by continuation.)
  2. **Default-grant ON** — estate approval → library `reader` + games `viewer`. Acceptable because approval is owner-only, and §3.1's demotion escape hatch keeps partial guests possible deliberately.
  3. **TTL 10 minutes.** 4. **Owner-only approver, `is_approver` flag as the promotion path.** 5. **Owner supplies a pre-seed email list; seed accepts it whenever it arrives.**
  6. ✅ **Admin page at the TOP CATALOG LEVEL (the apex), not `auth.heygabi.ai`** — which deletes the design's "one more authorised domain" cost: the apex is already an authorised domain for search, and the auth Worker exposes an owner-gated admin API with CORS locked to the apex. **Better than the design's default.**
  7. ✅ **Build the auth Worker.**
  **Build order against ~12 weekly points:** §14.1 auth Worker + §14.2 canonical module first (dispatching now), then index adoption; library shadow-then-enforce and games land after Sunday's reset if the ceiling arrives first.

- `2026-08-13T20:00Z` **AUTH §13 — owner answered 3, 4, 5; 1 and 2 in discussion; 6 defaulted; 7 answered by implication.**
  - **Q3 ✅ TTL = 10 minutes.**
  - **Q4 ✅ Approver = owner only**, with a **promotion path**: the directory's `is_approver` flag is the mechanism — promoting someone is flipping that flag from the admin surface, no redeploy. `OWNER_EMAILS` stays break-glass. Owner: user count "won't be that large ever."
  - **Q5 ✅ Owner will supply an email list to PRE-SEED** the review-name-only people — keeps existing reviews tied to their Google logins; worst case a migration later. ⚠️ Build note: the seed step must accept this list when it arrives; do not block on it.
  - **Q7 (by implication of Q4): the auth Worker IS wanted** — a promotion path and owner-only approval both need the directory to exist.
  - **Q1/Q2: owner leans toward NORMALIZING auth estate-wide** ("potentially normalize, weigh on this") and wants 1+2 mapped together. Analysis owed before any build touches the audiobook posture.

- `2026-08-13T19:45Z` ✅ **POOL TEST ANSWERED: the weekly "All models" pool INCLUDES Fable.** Run per protocol — Fable-driven main loop, doc-reading turns only, zero subagents, zero background work. Baseline `80 / 47`; after `81 / 49`. **Both meters climbed with nothing else running.** Cross-check that settles it: the session moved +11 points, and at the global rules' measured session→weekly ratio (~0.09–0.10) that predicts **+1 weekly — exactly what all-models did.**
  ⚠️ **What the Fable meter actually is: a per-model CAP within the shared pool, not a second allowance.** Fable subagent spend was draining weekly all-models all along (yesterday's +22), with the Fable meter tracking Fable's share on a smaller denominator (+36). "Fable's separate untouched allowance" was a misreading — there is ONE pool and an extra cap.
  **Consequences:** the model swap is a budget no-op (no reason to swap back either); dispatch-vs-drive model choice is about capability, not budget; ⚠️ **the single real ceiling is weekly all-models — at 81% now, agents stop at 93%, so ~12 points of build budget remain until Sunday 4 PM.** Plan the auth build against that number.

- `2026-08-13T19:15Z` ⚠️ **POOL TEST BASELINE — taken at a genuinely quiet moment, for the post-swap session to compare against.**
  **`session 40% · weekly all-models 80% · weekly Fable 47%`.** Nothing in flight: no subagents, no background commands, all three trees clean and pushed.
  **The question:** does the weekly **"All models"** pool **include** Fable, or is it separate? Today's readings cannot settle it — across the session all-models rose **+22** while Fable rose **+36**, which *looks* like separate pools, but the meters have **different denominators**, so a smaller Fable pool would produce that same pattern *while still being included*. Every interval had both moving together, because Fable subagents and Opus main-loop work ran **simultaneously all day** — nothing isolated the variables.
  ⚠️ **The test can ONLY be run by the main loop running on Fable.** Opus turns move all-models by definition, so an Opus-driven test measures nothing. **Protocol for the post-swap session:** swap the model, then take **two or three ordinary turns with NO subagents dispatched and no background work**, then read again and compare to the baseline above.
  **Reading it:** all-models **flat** while Fable climbs → **separate pools**, and the swap is a real budget win (80% vs 47% of headroom). **Both** climb → **inclusive**, the swap is a no-op for budget, and ⚠️ **today's split — Opus drives and dispatches, Fable builds — is the arrangement that got two allowances' worth of work out of one day.** Worth knowing before committing to a model.

- `2026-08-13T19:00Z` **DESIGN DELIVERED — `catalog-platform/docs/info/estate-auth-design.md`, awaiting owner approval before any build.**
  ⚠️ **Measurement changed the problem before design began: identity is ALREADY estate-global.** Both Workers verify Firebase ID tokens pinned to the same `audiobook-catalog` project. **What is missing is MEMBERSHIP** — so the design adds exactly that and nothing more: a three-value directory (`pending | approved | revoked` plus an `is_approver` flag — **a status, never a role**) in a dedicated auth Worker, consulted *after* local token verification and cached 10 minutes on each app's own `app_user` row. **The TTL is the revocation delay, named as such.**
  **The load-bearing sentence (§3.1): the estate gates newcomers and enforces revocations; it NEVER overrules a standing local approval except by explicit revocation.** That asymmetry is what makes it fail closed for strangers and the revoked while never locking the household out during a seed gap or an auth outage.
  **Authorization stays entirely per-app** — both role vocabularies and **all 17 `app_user` foreign keys untouched** (my count of 12 was library-migrations-only). "Moving" the audiobook users is a **seed**, not a migration.
- `2026-08-13T19:00Z` ⚠️ **SECURITY — the two `auth.ts` copies have ALREADY DRIFTED, and the library's is the fail-open one. VERIFIED, not relayed.**
  - library: `env.ENVIRONMENT !== 'production' && env.DEV_EMAIL`
  - games: `env.ENVIRONMENT === 'development' && env.DEV_EMAIL`
  ⚠️ **The library's bypass activates in ANY environment that is not exactly `'production'`** — unset, misspelled, `staging`, `preview`, anything new. Games' activates only in `development`. **Production is safe today** because `ENVIRONMENT` is `'production'`, but the shape fails **open** where the other fails **closed**. Games hardened theirs; the library never got the change — which is the whole argument for a shared module over a copied file, arrived at by evidence rather than principle. **Worth fixing as a one-liner now rather than waiting for the auth build.**
- `2026-08-13T19:00Z` **Fable rejected one of my seven recommendations and was right.** I said **library adopts first**; it argued **index Worker first** — the library has **real household users, exactly who a seed gap would lock out**, while the index has zero users, is already gated on this design, and its estate cache is free because the migration is unapplied. Then library in **shadow-then-enforce**, then games. It also refused a first-sign-in-claims bootstrap outright: ⚠️ *"first to knock owns the estate"* is unacceptable in an auth Worker.

- `2026-08-13T18:15Z` **DECIDED (owner) — estate-wide auth. NEEDS A DESIGN DOC BEFORE ANY BUILD.** The direction: **`heygabi.ai` stays open, but global search requires a login**; login becomes **app-wide**; the audiobook catalog's users move onto it; **new users are approval-only**.
  **The ground, measured before designing — and it changes the shape of the job:**
  - **Library**: D1 `app_user`, roles `owner | reader | pending`. ✅ **Approval-only ALREADY WORKS here** — `role` defaults to `'pending'` and capabilities gate on it, so that half of the ask is a pattern to spread, not to invent.
  - **Board games**: D1 `app_user`, roles `owner | manager | rater | viewer | pending` — **richer, and recently extended** (0023 viewer, 0024 manager).
  - **Audiobook**: users live in **Firestore `/users`**, hardened after a documented takeover hole.
  - **Index Worker**: new, no auth at all yet.
  ⚠️ **THE CRUX: 12 foreign keys reference `app_user(id)` in the library alone** — `user_book`, `change_log.changed_by`, copies and more. **Local user rows therefore cannot be deleted or replaced.** "Moving users to global auth" is a **mapping** exercise, not a move; a design that migrates rows away will take out twelve relationships including the audit log's actor.
  ⚠️ **The two role vocabularies have ALREADY diverged** (`reader` vs `rater|viewer|manager`), so a single global role set would be **lossy** for board games.
  **The shape that follows from both facts: split identity from authorization.** Global auth answers *"who are you, and are you approved into the estate"*; each app keeps its own role for *"what may you do HERE"*, with the local `app_user` row surviving as the anchor its foreign keys need. That preserves board games' five roles and the library's capabilities without forcing a merge that loses either.
  ⚠️ **Break-glass matters more than usual: an auth change can lock the owner out of everything at once.** The library's `OWNER_EMAILS` env var already plays that role and the design must keep an equivalent — a path in that does not depend on the thing being changed.

- `2026-08-13T18:00Z` **BUILT, NOT DEPLOYED — the shared index Worker, games first.** Design §7 steps 1–3 done; **step 4 untouched and both existing bridges still running**, as the design required. Verified independently: **library 375/375, index-worker 17/17, all three trees clean**, both halves of the fold pin present. `Board_Game_Catalog` typecheck green — ⚠️ **no tests ran there because that repo has no `test` script**, stated rather than implied.
  **`index_catalog` database_id: `3004d175-3c51-4ed4-ac3e-62859319f8ac`** (WNAM). ⚠️ **Its remote migration is deliberately UNAPPLIED and the Worker has no route** (`workers_dev = false`) — both wait on the owner, per the no-unattended-migration rule.
  ✅ **THE PROOF WORKED — the first cross-catalog query this estate has ever answered without a script.** All 836 production items pushed through the *real* path (`__scheduled` → backstop → `PUT /api/push/game`), then `lookup?title=taverns and dragons` returned **Taverns & Dragons** (catalog spells it `&`, query typed `and`), a Ravenloft title matched with an added leading article, and a promo answered carrying `kind` and `parent_source_id`. **Fold audit: 0/836 unfoldable, 0/836 `work_fold` — NULL for every game, exactly as designed.**
  ⚠️ **The honest asterisk: 29 of the 836 are WANTED-only, and ownership deliberately does not travel to the index.** So lookup answers *"this is in your catalog, tap through"*, **not** *"you own this"* — which matters most in the exact place the feature is for: standing in a shop.
- `2026-08-13T18:00Z` ⚠️ **Four things Fable's own design got wrong, found only by building it** — the most valuable part of the report:
  1. **§7 step 2 and §9 Q1 contradicted each other** (cron+mutations vs start-cron-only) and **neither costed the write volume**: a naive half-hourly ride would have cost **~80k index D1 row-writes per day**. Built instead as mutation pushes plus a freshness-gated backstop that fires only when empty or >24h stale.
  2. **The fixture contract needed a subtlety the design missed**: the file must record the **raw** fold (`''` for Korean titles) because library CI asserts bare `normaliseTitle`; the NULL refusal is pinned separately, index-side. Both suites also assert those empty-fold cases **stay** in the file.
  3. ⚠️ **The `?unknown` sentinel was unhandled — it folds to `'unknown'` and collides with real "Author Unknown" credits.** That is precisely the hazard measured this morning, arriving from a new direction: the library's `workKeyFor` bypasses the fold for the sentinel, but **the index folds raw strings pushed by sources**, so the guard does not travel with the data. The index now refuses it before folding. Pre-emptive, since the library pusher is step 4.
  4. **Not verified by execution:** the remote push end-to-end, and whether remote D1 accepts an **837-statement batch** (local did; the first real push will tell).

- `2026-08-13T22:46Z` **DONE (board game repo)** ✅ **`sleeve_requirement` dropped from production; `play` deliberately kept.** Board game site health green afterwards, `boardgames.heygabi.ai` on version `0b50c147`, migration `0025`.
  ⚠️ **The order was the REVERSE of this estate's usual rule, and getting it wrong would have broken the live export.** Normal order is migrate-then-deploy, so new code never meets an old schema. **A DROP inverts that**: the live Worker was still running `SELECT * FROM sleeve_requirement`, so dropping first would have 500'd the export endpoint until the deploy caught up. Sequence used: **remove the reader → deploy → then drop.** Worth remembering as a rule — *additive changes migrate first, destructive changes deploy first.*
  Measured before deciding: **0 rows against 836 items** for the catalog's whole life; nothing ever wrote it; `export.ts` was its only reader, shipping a permanently empty array that read as a feature.
  ⚠️ **Dropping lost nothing because the concept outlived the table** — `sleeve_requirement` is also a **research finding field**, so sleeve sizes are still gathered as prose findings, cross-checked across publisher, BGG and vendors exactly as 0001's comment intended. That name collision is the trap: a grep still hits it and reads either as a live dependency or as the feature being deleted, and **both readings are wrong**.
  ⚠️ **No `test` script exists in that repo** — typecheck was the only verification available, and that is stated rather than implied.

- `2026-08-13T22:42Z` **DEPLOYED** ✅ **The manual edition picker — the rescan question, asked with no barcode.** Health green, **371 tests**, typecheck clean. This was the last feature in the queue.
  **What it gives you:** *"Which printing?"* on every copy row — the write the **172 unlinked copies** need, with no barcode required; **"Add a printing"** with no identifier and no paperback default; and **AddCopy now STOPS and asks** when the chosen format already has a printing — the silent `editions.find(format)` reuse that made **#341 unsayable** is gone.
  ⚠️ **Fable declined part of my instruction and was right.** I said reuse `rescan.ts`; it reused the rules, the label builder and the contract — but **not the `fill` type**, because `RescanAnswer.fill` *means* "write this ISBN onto that row", which a barcode-less answer can never mean. Its words: forcing `fill` to sometimes mean "just link" would have made the rescan path's central verb ambiguous — *"that would have been the drift, wearing reuse as a costume."* One label builder now names the buttons in **both** prompts, so the vocabulary cannot drift while the types stay honest.
  **New server floor:** `409 indistinguishable_printing` refuses a same-format sibling carrying **nothing to tell it apart** — the #139 residue shape, refused at its last minting point — and reuses `isbn_taken`'s body convention rather than inventing a second error shape. `CopyLinkError` refuses a `copy.edition_id` naming **another book's** printing, which the foreign key never checked.
- `2026-08-13T22:42Z` **DECIDED — stop resurfacing this** **The board game `play` and `sleeve_requirement` tables are DELIBERATELY KEPT.** Verified: **0 rows each across 836 items**, no write path, read only by `export.ts`. ⚠️ **The survey's claim that `sleeve_requirement` appears nowhere else was wrong** — it is also a **research finding field** in `packages/research/src/research.ts`. That is a **name collision, not a dependency**: sleeve data is gathered as prose findings, so **the concept is alive while the table is dead**, and a careless grep would read it either as a live dependency or as safe to remove along with the feature.
  Dropping them would delete **nothing that exists** and buys only tidiness (two empty arrays out of the export). `play` is not superseded, merely **unbuilt** — a reasonable design for logging game nights. **Recorded as kept so it stops returning as a to-do**, which was its only real cost.

- `2026-08-13T22:25Z` **DONE** ✅ **Every third-party cover hotlink is gone — 171 URLs rehosted into R2, 295 rows updated, zero upload failures.** 110 Open Library + 43 Google + 18 miscellaneous retail hosts, all now on `bookcovers.heygabi.ai` with `max-age=31536000, immutable`, each write guarded on the row still holding the old URL and logged with the original URL in `old_json`.
  ⚠️ **`cover_status` was untouched by construction** — the affected works stayed 160 NULL / 7 ok / 5 standin. Rehosting moves an image; it is not an assessment, and promoting those to `'ok'` would have emptied the "cover needed" list with work nobody did.
  ⚠️ **The census I quoted was wrong in a way worth remembering: it undercounted by ~145.** It measured *work* rows on the two obvious hosts and missed **22 works on miscellaneous retail/fan hosts and ~125 EDITION-level hotlinks entirely**. A census that only looks where it expects to find things measures its own assumptions.
  ⚠️ **Best find: `covers.openlibrary.org/b/id/-1-L.jpg` was stored as a real cover** — that is Open Library's **"no cover" sentinel**, an id of `-1`, saved as though it were an image. Cleared and logged.
- `2026-08-13T22:25Z` **DONE** **21 covers found for the 25 works that had none**, all visually confirmed before use, all applied with ⚠️ **`cover_status` left NULL** — because `'ok'` means *a person* assessed it, which is a stronger claim than any automated rung can make. Routes that worked: OL-by-ISBN, Google-by-ISBN (including a `979-8` KDP title), OL search with metadata matching, Amazon's image CDN keyed by ISBN-10, **Kyobo's ISBN-keyed CDN for the Korean title**, and League of Comic Geeks for a Skybound graphic novel.
  **5 not found, and they are the same five as always:** the Autumn Publishing supermarket board books, whose ISBNs exist in **no database at all**. One lookalike was deliberately **rejected as unverifiable** rather than used — the right call, since a wrong cover looks finished and nobody re-checks it. ⚠️ **The practical fix is photographing them through the app**, which is now possible: the cover upload path is live.
- `2026-08-13T22:25Z` **CHECKED, no change** **Edition 391's ISBN `9780765362438` stays on *Ender's Game*.** The agent flagged Google Books calling it *Children of the Mind*; Google is currently **429 and unverifiable**, while **Open Library says "The Ender Quartet", 1991, with NO page count** — and by today's own heuristic, **a missing page count points to a set rather than a single volume**. It is recorded as the set ISBN in `edition_name`, matching how Cooper's #298 holds its set ISBN. Consistent and documented; re-check when Google's quota resets.

- `2026-08-13T22:07Z` **DEPLOYED** ✅ **Version `60a03b20`** — the record **delete button**, the **cover swap**, and the **two-column gap fix**. Health green, **360 tests**, typecheck clean.
  ⚠️ **The delete button refuses outright while any copy records property** — owned, lent, preordered, borrowed, sold, or signed in any state. **There is no force flag.** #139 is the reason and it is the header comment: two edition rows looked like duplicates while the two *copies* were real books. It shows editions, copies, traces and review survival **before** offering anything, and ⚠️ **logs the cascade casualties** — one `__row__` row per destroyed edition and copy under one batch — so it cannot repeat the **unlogged subtree destruction** of today's four raw-SQL deletions. Mine logged the work; the children went silently.
  **Cover swap** shows every cover the book could wear side by side — edition covers, `change_log` history, and derived Open Library guesses last with `?default=false`, so a wrong guess 404s and its card is dropped while a *recorded* candidate that fails says "image no longer loads". The UI states the R2 content-addressing fact so the button can be trusted.
  ⚠️ **Expect the queue's volume-number tally to GO UP**, and that is the fix working: `applyFinding` writes `series_index_sort` only — correctly, since the printed form is quoted from the cover — so a research-filled number now **keeps its gap open until a person reads the spine**. That is the 22-works truth becoming visible rather than a regression.
- `2026-08-13T22:07Z` **SPECCED, NOT BUILT** **Merge-instead-of-delete.** Fable's verdict, which I accept: worth building, not tonight, and ⚠️ **the delete button no longer forces the issue** — the feared "delete used as a poor man's merge" is blocked exactly where it bites, and the refusal names merging as the alternative. Why it is not a quick follow-on: a real merge reparents **~13 child tables with per-table conflict rules** (`alias_check` and `audiobook_holding` are PK-on-work_id, `user_book` is unique per user+work, editions carry UNIQUE ISBNs that can collide with the target's) and must answer the survivor's identity questions — whose description, whose cover, whose OL id. ⚠️ **Both of today's production merges also moved REVIEWS implicitly**, by landing on the survivor's key. Shape: reparent copies, editions and read states; refuse on any UNIQUE collision; log every reparent as a field row under one batch; then delete the husk through the guarded path.

- `2026-08-13T20:50Z` ⚠️ **DO NOT CANONICALISE THE SAMG AUTHOR STRINGS — the split is load-bearing, and the obvious "fix" is the bug.** Measured, not inferred: `normaliseTitle` reduces **any wholly non-Latin title to the EMPTY STRING** — Korean, Japanese, Chinese, Cyrillic and Greek all fold to `""`. (Accented Latin is fine: *Amélie* → `amelie`. Mixed keeps the Latin part: *Naruto 나루토 7* → `naruto 7`.)
  So the two Korean works carry keys that are **nothing but the author**: #195 `|samg` and #305 `|samg entertainment`. ⚠️ **Merging those two author spellings — exactly what an author-canon pass would do — would give two different books the identical `work_key`**, and the ~860-review join would treat them as one book. The estate survey flagged this; measuring it makes it sharper: **the guard is accidental, and it is one tidy-up away from failing.**
  **Current exposure: 2 works with an empty title half, 0 duplicate keys.** But this is general, not a quirk of these two — every future book titled wholly in a non-Latin script lands in the same state, and the library is growing.
  ⚠️ **Three ways out, and the owner should pick, because none is free:**
  1. **Fix `normaliseTitle`** to transliterate rather than strip. Correct, and ⚠️ **it is a migration of every stored key in BOTH catalogs plus every Firestore review document carrying one** — `CLAUDE.md` already says changing that function is a migration, not an edit. Cross-repo, coordinated, not a quiet afternoon.
  2. **Leave the author split as the guard.** Free, and fragile: it survives only while nobody tidies it, and its load-bearing role is invisible at the point where someone would "clean it up". Now written down, which is the only thing making it safe.
  3. **Give those works Latin-containing titles** (romanised or English), so the title half is non-empty. Cheap and local, no shared-function change — but it is a **title edit, i.e. a key move**, and it loses the fidelity of the printed Korean title unless a romanised form is added alongside.
  **My read: (3) for these two now, (1) recorded as the real fix for when the estate next coordinates a key migration.** Doing nothing is (2) by default, which is the option that fails silently.

- `2026-08-13T20:30Z` **FIXED — and it was invisible to the queue** ⚠️ **22 works had `series_index_sort` set with `series_index_display` NULL: they sorted into exactly the right position and PRINTED NOTHING.** This is the two-column trap flagged this morning, found live. ⚠️ **`detailGaps` could not see it**, because the gap test is `seriesIndexSort == null` — so the details queue reported **zero gaps** while 22 books showed no volume number on the page.
  ⚠️ **Two items had been sitting on this list for days as "needs a volume number" — #341 (sort 1) and #195 (sort 8) — and the number was there the whole time.** The work was never missing; it was unprintable. All 22 backfilled from their sort values with audit rows. **The LOGIC is still wrong** and will silently readmit the state — sent to Fable: the field is missing if sort is null **OR** the display is blank.
  Same class as the `copy.edition_id` NULL problem: **a field whose absence is only visible from one direction.** Both were found by looking at the object from the other side rather than by any check.
- `2026-08-13T20:30Z` **DONE** Four running-list items cleared: **#7 Dungeon Born → universe `CAL Verse`** (⚠️ matched to the **exact existing production spelling**, which 12 works carry — `normaliseUniverseText` treats spellings as distinct, so "Cal Verse" would have silently created a **second universe beside the real one**); **#186 Bizzy Bear: Dinosaur Safari → volume 11**, with its stale `unknown` verdict deleted in the same batch because a verdict beside a value is contradictory; **#339 *Last Child in the Woods*** → subtitle *Saving Our Children from Nature-Deficit Disorder*; **#341** → subtitle *Outworlder*.

- `2026-08-13T20:05Z` **DECIDED — do not relitigate** **The book number stays ABOVE the title.** Owner approved 2026-08-13. Fable had flagged this as *"the decision to revisit"* if the owner had pictured a floating corner chip — they had not. ⚠️ **Recorded because that flag would otherwise sit in `FABLE5.md` §7 as an open invitation**, and a future session reading it would "fix" a placement that was deliberately chosen: a corner chip collides with title wrap on phones, while above-the-title reads as a catalog number.

- `2026-08-13T19:55Z` **DONE** ✅ **Details queue empty again — 0 descriptions, 0 gaps of any kind.** The 7 outstanding were **not residue**: they were the works *created today* by splitting the Cooper and Card slipcase sets, which arrived with titles, authors, series, volumes and years but no descriptions — the expected consequence of turning 2 records into 9. Written as **brief factual summaries in the catalog's own voice** (matching #269's style), ⚠️ **deliberately not publisher jacket copy**, which is copyrighted text and not something to paste into a database by reflex.

- `2026-08-13T19:41Z` **DEPLOYED** ✅ **Version `dded6f29`** — the illustrator credit and the book number are live. Health green, **347 tests pass**, typecheck clean.
  **Illustrator** renders as *"Illustrated by Shannon Hays"* directly under the byline — same serif, smaller and muted so the author stays primary — and a null renders **nothing at all**. Editable from **About → Edit**, deliberately **not** from the ceremony panel: putting a Free field behind the key-move UI would mislabel it as dangerous.
  ⚠️ **The one rule held with ZERO route changes**, which is the good kind of outcome: an illustrator-only PATCH computes `newKey === oldKey`, so the plain path takes it and **the ceremony never fires**. A new core test pins **`workKeyFor.length === 2`** as a tripwire — a literal guard against anyone widening the signature to include the illustrator.
  **Book number** sits above the title: monospace, muted, `#269`. Built as `<code role="button">` rather than `<button>` ⚠️ **because button text is unselectable in several browsers**, which would defeat the entire purpose — the number exists to be quoted. `user-select: all` makes one tap grab the whole token; a click copies it.
  **Placement to revisit if wrong:** the id went **above** the title rather than in a corner, because a corner chip collides with title wrap on phones. Five lines of CSS if the owner pictured a floating corner.
  ⚠️ **Not browser-verified:** the rendering and the copy tap were checked by typecheck and build only. **One attended look at production #269 settles both** — and #269 is the ideal page for it, being the one book carrying an author, an illustrator, a publisher and an ISBN in four separate homes.
  Production #53 was checked and is **intact** — the agent's probe misstep that cleared a `series` was local-D1 only, as it reported.

- `2026-08-13T19:00Z` ⚠️ **POST-MORTEM: the session limit was hit and the usage check did not stop it. My failure, and the rule had a real hole.**
  **What happened:** a read was taken at **55%**. Immediately after it I dispatched the rescan agent, which cost **279k tokens**, then dispatched a second agent, and **took no further read**. The limit was hit mid-build and killed the illustrator/book-number agent.
  ⚠️ **Every sentence of the existing rule was followed and the run still died.** "Pulse-check whenever anything is running" names **no moment**, so it is satisfiable by a read taken *before* the expensive thing — which measures the one interval guaranteed to contain none of the spend. The global rule already warned that *"a subagent's cost is invisible until it lands"* and that *"the granularity of risk is one agent, not one tool call"*; what it lacked was a required read at the moment the cost becomes knowable.
  **Fixed in `~/.claude/CLAUDE.md` — two MANDATORY trigger reads, plus a doubled cadence at the owner's instruction:**
  1. **AFTER every agent lands** — the completion notification is the first moment the number is knowable.
  2. **BEFORE dispatching any agent** — dispatch is the irreversible commitment; after it the cost is already being incurred.
  They answer different questions (*"can I afford to start this?"* vs *"what did that actually cost?"*) and neither substitutes for the other. Periodic cadence while anything is in flight is now **at least twice as often as feels necessary**.
  **Damage: none.** The killed agent died after committing its claim (`b70ddc2`) and **before writing any code**, so the tree was clean and nothing needed salvaging — it simply had to start over. Verified by `git status`, not assumed.
- `2026-08-13T19:00Z` **DONE** **#269 *Who Goes Roar?* is fully resolved** — author **Christie Hainsby** (owner-confirmed; Make Believe Ideas omits writers from covers, which is why the object names only the illustrator), illustrator **Shannon Hays**, publisher **Make Believe Ideas Ltd** on the edition, ISBN `9781836422808`, first published 2019. **Three credits, three homes, none displacing another** — two hours earlier the publisher sat in the author field because there was nowhere else to put anything. The illustrator column landing first is what freed `authors` for the actual writer.

- `2026-08-13T18:20Z` **DONE** **The Illumicrate Percy Jackson five carry no discernible ISBN** — owner checked the objects. Recorded on all five editions and in `change_log`. ⚠️ **This disproves a research expectation rather than merely failing to confirm one:** the worklist reasoned that "Illumicrate runs are publisher-produced exclusives that usually carry their own ISBNs printed on the jacket". The object says otherwise, so the blank `isbn13` is now **observed**, not open. **That closes the last of the 9 "worth scanning" candidates** — the remaining ~70 physical editions without an ISBN are overwhelmingly Kickstarter printings that never had one.
- `2026-08-13T18:20Z` **DONE + DEPLOYED-PENDING** **Migration `0130_work_illustrator.sql` applied to local AND production**, adding nullable `work.illustrator`, backfilled with the two credits that forced it: **#174 Judi Abbot**, **#269 Shannon Hays** — both previously surviving only as `change_log` notes, which is not a place anyone reads. Both books name **no writer anywhere on the object**, so `authors` holds the publisher and the illustrator was the only human credited.
  ⚠️ **The one rule, written into the migration header so it cannot be lost: `illustrator` MUST NEVER ENTER `work_key`.** The key is `title|primaryAuthor` and joins ~860 reviews across two catalogs — folding the illustrator in would mean **correcting an illustrator moves the key and orphans reviews**. `workKeyFor`'s two-argument signature is the guard. Display and edit only; a **Free field**, never key-moving, never frozen.
  Not backfilled beyond those two: an unrecorded illustrator is *"nobody has looked"*, not *"there is none"* — 0040's rule. Most novels stay NULL and there is no not-applicable sentinel, because absence already says it.
- `2026-08-13T18:20Z` **CLAIM (Fable)** **Put the book number on the detail page.** The owner: *"since we use book number so frequently can we get book number somewhere on the page?"* — the work id (`#269`) is currently **invisible in the UI**, obtainable only from the URL or from me, despite being how we refer to books constantly. Near the title or in a corner, visually quiet, and ⚠️ **selectable / click-to-copy**, since its entire purpose is being quoted into a conversation.

- `2026-08-13T16:38Z` **DEPLOYED** ✅ **Version `97c0d762` — "a rescan is a question, not a second copy" is LIVE. Scanning a book already in the catalog no longer creates a duplicate.** Health green. 346 tests pass (11 new), typecheck clean everywhere.
  **What the shelf now looks like:** scanning a slipcase volume raises a prompt — *"'Title' is already in the catalog, but the barcode you scanned is not on any of its printings. Which is it?"* — with one primary button per ISBN-less printing that **records the ISBN and creates nothing**, plus honest alternatives for "I have two of it", "a different printing I own" (the #341 case), "a different book", and "never mind". ⚠️ **Nothing is written before a question is answered**, so walking away leaves the catalog untouched.
  ⚠️ **The Realmkeeper dead-end is handled**: a fill that hits the catalog-wide UNIQUE index returns a 409 **naming the printing that holds the ISBN**, and the client offers the slipcase treatment instead of failing at a person holding a book.
  **It also closes the 67%-NULL defect at its source:** every fill links the owned copy to the printing the scan just proved, and "Add 2nd copy" now sets `copy.edition_id` too — that was the minting point.
  ⚠️ **All edition and copy mutations now write `change_log` with an actor in the same `db.batch`. They logged NOTHING before**, so the audit log only covered works until this deploy.
- `2026-08-13T16:38Z` **NEEDS ONE ATTENDED TEST BEFORE TRUSTING** ⚠️ Two browser flows are verified by typecheck, build and precedent — **not by being driven**: the **rescan prompt** and the **key-move ceremony** (`countReviewDocs → restampReviews → PATCH`). Both need one attended run on the **dev lane** before being trusted on live data. The ceremony matters more: it is the only path that touches the ~860-review join, and every key move made today deliberately went around it via SQL for exactly that reason.

- `2026-08-13T17:55Z` **RESOLVED** ⚠️ **#269 *Who Goes Roar?* was never wrong — the catalog's ISBN is correct and the WEB is what is missing.** The owner photographed the back cover: it prints **ISBN13 978-1-83642-280-8** and a barcode reading **9781836422808**, exactly the value already stored, check digit valid. Earlier research reported that this ISBN *"resolves to nothing anywhere on the open web"* and that every listing used `9781788436878` — **that was true of the web and false about the book.**
  ⚠️ **The lesson generalises and belongs beside the ladder's measured hit rates: an ISBN's absence from every index is NOT evidence the ISBN is wrong.** Copyright is 2019 but the `978-1-83642` prefix is a newer Make Believe Ideas range, so this is a **later printing of a 2019 title** — precisely the case that is real, in hand, and unindexed. The instinct to "fix" the record would have replaced a correct ISBN with a different edition's.
  Added from the photographs: **ISBN10 `1836422806`** (printed `1-83642-280-6`, check digit valid), **publisher Make Believe Ideas Ltd**, **published year 2019**.
  **ILLUSTRATOR: Shannon Hays**, credited on the back cover, recorded in `change_log` — the second book today whose illustrator survives only in the audit log. That is now two independent votes for the `illustrator` column.
  ⚠️ **Still open, and the photo does NOT settle it:** this repo previously recorded that **Christie Hainsby** is the credited writer, on the basis that Make Believe Ideas omits writers from covers. **No writer is named anywhere on the object** — consistent with that claim rather than proof of it. `authors` is currently the publisher, which matches the #174 precedent. Changing it to Hainsby is a **key move** and needs the owner's word plus a source, not an inference.

- `2026-08-13T17:35Z` **DONE** **The Autumn Publishing six all carry `first_published = 2025`** (#274, #287, #288, #296, #303, #304) — owner's call, from the shared *June 2025, Third Edition* printing line. Their stale `unknown` verdicts were deleted, since a verdict and a value together are contradictory. **No copyright page needed after all**; the shelf task is cancelled.
  ⚠️ **Two honesty notes attached in `change_log` rather than left implicit.** First, **this is the PRINTING date, not the work's first publication** the column normally wants — the same distinction that had Cooper at 2007 and Card at 1991. It is recorded knowingly as the best available fact, because these are set-internal ISBNs marked *"not for resale"*, absent from Open Library entirely, so **no work-level date is findable anywhere**. Second, stored as the bare year `2025` and not `2025-06`: ⚠️ **every one of the 313 dated rows in this table uses a 4-digit year**, so a month-qualified value would be the sole exception and the odd one out for sorting. The month survives in the audit note.

- `2026-08-13T17:20Z` **DONE** **#174 *I Love You, Little Bear* is finished** — author **Parragon Books**, `primary_author` and `work_key` moved with it, subtitle *Peek-a-Boo Adventure*, first published **2013**. No writer is credited anywhere; the publisher's editorial staff wrote it collectively, which is the case the owner's standing "use the publisher" rule exists for.
  ⚠️ **"Judi Abbot" was never a wrong attachment** — she is credited on this exact ISBN as the **ILLUSTRATOR** (Giuditta Gaviraghi, same person under a pen name). Her credit is preserved in `change_log` **because the schema has no illustrator field**, so the alternative was losing it silently.
  Done as SQL rather than through the ceremony Fable just shipped, deliberately: ⚠️ **that ceremony's browser flow is explicitly UNTESTED end-to-end** and Fable's own note asks for one attended retitle on the **dev lane** first. Using an unexercised path for the first time on live data would be the opposite of careful.
- `2026-08-13T17:20Z` **TODO** ⚠️ **The schema has no illustrator field, and this library is full of picture and board books where the illustrator is the credit that matters.** #174 forced the choice between recording the writer-less publisher and keeping the illustrator; both are true and only one column exists. Today the illustrator survives only in an audit-log note. ⚠️ **An `illustrator` column must NOT be folded into `work_key`** — the key is `title|primaryAuthor` and joins ~860 reviews across two catalogs, so widening it is a migration of every stored key, not a column addition. Straightforward as a nullable display field; the discipline is keeping it out of the key.
- `2026-08-13T17:20Z` **NOTE for the rescan flow** ⚠️ **A duplicate EDITION and a duplicate COPY are different bugs, and #139 proves it.** Its second edition was pure rescan residue, while its **two copies are real** — the owner confirmed owning two *Dinosaur Dance!* books. A flow that collapses both on the assumption they travel together would **silently delete owned books**. The four outcomes must keep that distinction straight.

- `2026-08-13T17:00Z` **DONE** ⚠️ **The owner's Dinosaur Dance answer did not fill a gap — it exposed the duplicate.** "Ends with 480994" identified `ed225`, which **already held** `9781481480994` (Little Simon 2016, from Open Library). The blank row beside it, `ed232`, was a `manual` edition with no ISBN, publisher or year: **rescan residue**, and the exact case the estate survey cited for work #139. Consolidated onto ed225 (it carried no fact ed232 lacked), with ed232's whole row kept in `change_log`. Both copies are now linked to the real edition — two of the 177 that named none.
  ⚠️ **OPEN QUESTION FOR THE OWNER: #139 has TWO copies.** Is that two physical *Dinosaur Dance!* books, or a rescan artefact? **I deliberately did not guess** — guessing a copy count is the error already made once today, and deleting a copy is not reversible from the log alone.
- `2026-08-13T17:00Z` **DONE** **Unmapped: the one known ISBN went on the hardcover.** `9781637663608` (check digit valid) is the only public *Unmapped* print ISBN and ⚠️ **no source states its binding**. `idx_edition_isbn13` is UNIQUE, so it fits exactly one row. Owner: *"just pick one, I can swap it later."* Chose the hardcover from a **weak sibling-pattern inference** — Untapped's determinable pair ran hardcover-first numerically (…295 HC before …301 PB) — and the `change_log` note says outright that this is an inference, not a sourced fact, with the swap recipe: clear ed471, then set ed470. The paperback stays NULL because **there is no second ISBN to assign, and inventing one would be a wrong fact rather than a missing one.**
- `2026-08-13T17:00Z` **SETTLED** **"No barcode on the object" is now recorded, not left blank.** Owner checked the physical books: **Dungeon Born PB and Unmapped PB carry no printed barcode.** Written into `edition_name` so the blank `isbn13` reads as an **observed** fact rather than an unanswered question — the same distinction 0040 draws between NULL and an assessed value. No future pass should re-ask these.

- `2026-08-13T16:30Z` **DECIDED — do not reopen** ⚠️ **epub editions are NOT backfilled with identifiers.** Owner, 2026-08-13. The **117 `ebook_epub` rows with no `isbn13`/`isbn10`/`asin` are a settled state, not a backlog** — recorded properly in `docs/info/isbn-ladder.md` so a future session does not read that count as a gap and start closing it. Three reasons: a print ISBN on an epub row is a **wrong** fact rather than a partial one; much of this library genuinely has none (about half is absent from Open Library, dominated by KU and Audible-native titles); and ⚠️ **not even the ASIN is research-determinable**, because those rows' `source_url`s are **local epub file paths** and matching a file on disk to a Kindle listing is itself a which-object guess. Fable raised that third point against my own framing and was right. Fable wrote **zero** ASINs, which was the correct call.

- `2026-08-13T16:00Z` **CLAIM (Fable)** **Backfill ISBNs where determinable.** Measured: **195 editions carry no `isbn13`/`isbn10`/`asin`** — but that number is misleading. **117 are `ebook_epub`**, 46 hardcover, 32 paperback; minus the **7 deliberately ISBN-less slipcase volumes** created today, the real target is **71 physical editions**, matching the estate survey exactly.
  ⚠️ **This task is a DIFFERENT SHAPE from the details backfill, and treating them alike would produce confident wrong data.** A first-published year is a fact about the **WORK** — one right answer, any good source gives it. **An ISBN is a fact about an OBJECT**: one work has dozens of editions, each printing and territory carrying its own, so *"find the ISBN for The Grey King"* has **no single correct answer** and only the book on the shelf says which. Research can prove an ISBN *exists*; it usually cannot say *which one is on the shelf*.
  **So the deliverable is the SPLIT, not the coverage:** editions where the ISBN is genuinely determinable (written, each with a `change_log` row carrying its source), versus editions that can only be settled by reading the barcode — delivered as a shelf-ready list grouped by author/series. ⚠️ **A short correct list plus an honest "these need the barcode" beats 71 plausible guesses**, and since the owner is actively scanning, "needs the barcode" is actionable advice rather than a failure.
  ⚠️ **Traps named in the brief:** a print ISBN on an ebook edition is a WRONG fact, not a partial one (an ISBN identifies a format-specific edition; Kindle books want the **ASIN** column the schema already has); the 7 slipcase volumes must be skipped; never pick the most popular printing when several match; validate check digits, because a transposed digit is a valid-looking entirely different book.

- `2026-08-13T15:45Z` **DONE** **Two slipcase sets split into their real books — 9 works now, was 2.** *The Dark Is Rising Sequence* (#349 Over Sea Under Stone 1965, #298 The Dark Is Rising 1973, #350 Greenwitch 1974, #351 The Grey King 1975, #352 Silver on the Tree 1977) and *The Ender Saga* (#280 Ender's Game 1985, #353 Speaker for the Dead 1986, #354 Xenocide 1991, #355 Children of the Mind 1996). Each has an owned copy and a slipcase note.
  ⚠️ **Both stored years were the BOX printing, not the work.** Cooper's said **2007** and Card's said **1991** — and 1991 is *Xenocide*'s year, which had leaked onto the set record and would have been inherited by *Ender's Game*. `first_published` wants the work's first publication, and for reissued sets those differ by decades.
  ⚠️ **Volumes are deliberately ISBN-LESS.** The scanned barcode belongs to the SET, and slipcase volumes frequently carry none of their own. A missing ISBN is honest; the set's ISBN copied onto five novels would be five wrong facts. The set ISBN is preserved in `edition_name` and the copy notes.
  **The Card key move IMPROVES the review join** rather than risking it: the old key was `ender quartet|orson scott card`, a *set* name no review could ever carry, and the new `ender s game|orson scott card` is what a real review would use.
- `2026-08-13T15:45Z` ⚠️ **A heuristic worth keeping, and it would have saved today's mix-up: a reported PAGE COUNT means one bound volume; its absence points to a box of separate books.** Open Library gave Cooper's ISBN **1088 pages** — which reads as an omnibus, and is what an automated pass would have concluded — while Card's set reported none. The owner has the physical object: Cooper is a **slipcase of five**. So the page count is a good FIRST FILTER and never a verdict. ⚠️ The same question got Narnia wrong in the other direction (thought separate, actually an omnibus), which is the real lesson: **for a set, ask the shelf before writing SQL.**

- `2026-08-13T15:18Z` **DEPLOYED** ✅ **Version `8433e561`. The one-barcode-one-edition guard is LIVE, so scanning is protected.** Health check green (`database: up`, 7 universes). Shipped together: Fable's three guard tiers, the key-move ceremony and gate, the evidence floor, `change_log` writes, the strict-schema fix ending the strip-lie, the sentinel containment pass, and the web surface. **335 tests pass, typecheck clean in every workspace.**
- `2026-08-13T15:18Z` ⚠️ **The deploy guard has a wart, found by it blocking me.** `predeploy` already runs `deploy-guard.mjs`, so running the guard **manually first** takes the lock and then the deploy's own guard refuses — *"opus started a deploy 0.0 min ago"*, a deadlock against yourself. **Correct usage is `npm run deploy` alone**, never `deploy-guard && npm run deploy`. Either teach the guard to recognise its own holder within the same run, or delete the manual step from the docs.
- `2026-08-13T15:18Z` **NOT DONE, and nothing to undo** ✅ **The Narnia split was NOT applied.** It failed on a wrong column name — `edition_notes` lives on `copy`, not `edition` — and ⚠️ **D1 rolled the whole `--file` batch back atomically**: 0 `change_log` rows, still one Narnia work, title untouched. The owner then corrected the premise (**it IS an omnibus**; the seven-separate-books memory belonged to a different, unscanned set). So the mistake in my SQL happened to save the work — but the lesson is the atomicity, which is now demonstrated rather than assumed: **a failed `--file` batch leaves nothing behind.** #324's `gap_verdict` note was rewritten to record the correction; the `none` verdict stands either way, because an omnibus is not volume N of its own series.

- `2026-08-13T11:50Z` **DONE** ✅ **THE DETAILS QUEUE IS EMPTY — 0 works owing anything, down from 62 works / 80 gaps.** Every gap was answered from a source, or recorded as `none`/`unknown` so it stops being asked. Nothing was invented to fill a blank.
- `2026-08-13T11:50Z` **DONE** **#299 merged into #333 (*The Maze Runner*) rather than repaired in place**, and the reason is structural rather than stylistic: ⚠️ **`work_key` is NOT unique** — 0001 gives it a plain index, not a unique one. Correcting #299's misspelt title and author *in place* would have produced **two works carrying the identical key `maze runner|james dashner`**, both matching the same reviews — a worse defect than the unmatchable key it replaced. The merge keeps **two paperback editions and two owned copies**, and #299's whole row is in `change_log` as undo material. ⚠️ Deleting it was never an option once the copy count was corrected: it stood for a real physical book.
- `2026-08-13T11:50Z` **DONE** **#328 retitled *Keepers of the Light* with volume 1.** Its stored title asserted *“Book Two of the Broken Prophecies”* while its ISBN `9780999264201` is **Book One** (Book Two is *Destroyers of the Light*), so writing the researched index beside the stored title would have left the record **contradicting itself**. Title, `sort_title` and `work_key` moved together. Also unified #327's series string — the same series was stored as both `Broken Prophecies` and `The Broken Prophecies`, so the series page saw two series of one book each.
- `2026-08-13T11:50Z` **NOTE for the ceremony Fable is building** ⚠️ **Two key moves (#141, #328) were made WITHOUT restamping reviews.** The Worker cannot read Firestore by policy, so “zero reviews” cannot be *proven*; the owner wanted them cleared. Both are recorded in `change_log` with the old key in `old_json` and a note saying no restamp occurred. **The ceremony must not assume every historical key move was carried properly.** This is also the strongest argument yet for the `reviews_seen_*` floor: it is NULL everywhere, which is precisely why there was no evidence either way.

- `2026-08-13T11:15Z` ⚠️ **CORRECTION — I reported "zero owned copies" for several books and that was WRONG.** `copy` carries **both** `work_id` and `edition_id`, and I counted by joining through `edition`. **177 of 265 copies have a NULL `edition_id`**, so every one of them read as zero. #284, #291, #299, #333, #141, #174 and #335 each hold an owned copy. ⚠️ **This inverts the reasoning on #299:** it is not an unowned stray that can simply be deleted — it stands for a real physical book, so deleting it would lose a copy. Fix its title/author instead. The right count is `SELECT COUNT(*) FROM copy WHERE work_id = ?`.
- `2026-08-13T11:15Z` **TODO** ⚠️ **Systemic, and the root of the correction above: 177 of 265 copies (67%) are not linked to an edition.** A copy that names no edition cannot answer "which printing is this?", which is the question the edition picker and the signed/variant work both depend on. Same family as "a rescan must be a question, not a second copy" — fold it into that work rather than fixing it twice.
- `2026-08-13T11:15Z` **DONE** **The Opal Deception duplicate is merged, on the owner's decision that both are owned.** #284 folded into **#291** *Artemis Fowl and the Opal Deception*, which now holds **two paperback editions** (9781423124559 Disney/Hyperion, 9780241434666 Puffin) and **two owned copies**, each now linked to its own edition. Children were reparented **before** the delete so `ON DELETE CASCADE` could not take them.
  ⚠️ **`change_log` recorded its first real entries, and this is exactly what it was built for:** the deletion row stores #284's **entire row as JSON** under `field='__row__'` — the undo material — plus one row per reparented child. Migration 0120 went to production earlier today, so the audit log existed in time to catch the first destructive change made after it.
- `2026-08-13T11:15Z` **DONE** #335 *Possibility & Promise* now carries the subtitle **"Echoes of the Unknown"** (owner approved; confirmed against the Amazon listing for ISBN 9798278220268).

- `2026-08-13T10:45Z` **DONE** ⚠️ **Europa (#348) has a cover, and it went into R2 rather than being hotlinked.** `https://bookcovers.heygabi.ai/covers/europa-d-l-houpt-5abcf91beea5786c.jpg` — verified live: **200, `image/jpeg`, 174,528 bytes, `max-age=31536000, immutable`**, byte length matching the source exactly. `cover_status` set to `'ok'`, matching what the upload route does deliberately: a person who went and found the image has assessed it more thoroughly than any rung of the ladder, so leaving it unassessed would put the book straight back on the "cover needed" list it just left.
  **Why the normal ladder was never going to find it:** the ISBN is `9798317365769`, and a **`979-8` prefix means Amazon KDP** — those titles are typically absent from Open Library altogether. ⚠️ So an Open Library miss on a `979-8` book means **"KDP, look elsewhere"**, not "no cover exists". The winning route was **ISBN → ASIN via retailer search-result titles → image CDN**, which sidesteps the Amazon product pages that are currently returning 500 to automated fetch.
  Identity confirmed rather than assumed — *Europa* is a common title, so: the ASIN `B0F5BRLJR9` maps to exactly this ISBN, and **the author's name is printed on the cover art itself**. The image was also read visually, not just fetched, so it is the real cover and not a placeholder.
  ⚠️ **The object key hashes the IMAGE BYTES, not the work key** — which is what lets the cache header be a year and immutable. Replacing a cover is a new URL, never the same URL serving different bytes.

- `2026-08-13T10:20Z` **DONE** ⚠️ **A false premise in this document, repeated in four places, is corrected above** — and the distinction it hides is worth keeping. This doc recorded that #141/#160/#174 “have ISBNs that did not resolve” and that “re-running research will not help”. **That is wrong for #141 and #174**: both resolve on the first call to Open Library's `/api/books` endpoint, and **six of the nine answers found for those two books came from those two calls.** The original conclusion appears to have come from **web-searching the ISBN string**, which returns garbage — searching `9781472327314` returns an unrelated book called *Cut*. ⚠️ **API lookup and web search are not the same operation, and a failure of the second says nothing about the first.** Belongs in `docs/info/isbn-ladder.md` beside the measured hit rates.
- `2026-08-13T10:20Z` **DONE** ⚠️ **A premise *I* supplied to a research agent was also wrong, and it pushed back with evidence — which is the behaviour to keep.** I briefed that #141's “Touch and Explore” is a Twirl/Chronicle line. True, but **irrelevant**: that is Nathalie Choux's line (ISBN 9782745976192, 2016). **Scholastic runs its own separate “Touch and Explore” format line inside *Scholastic Early Learners*,** which is what this book is. Searching the title surfaces the Choux book first, so accepting my brief would have attached the **wrong publisher, wrong year and wrong creator** — a confident, fully-sourced error.
- `2026-08-13T10:20Z` **ANSWERED** ⚠️ **The Autumn Publishing six are unfindable *by construction*, and that is a final answer rather than a gap.** ISBN prefix **978-1-83903 is registered to Igloo Books** (Autumn Publishing is its imprint, so the credit is right), and the six ISBNs are **exactly consecutive** — `978183903590`→`595`, all check digits valid, no gaps — which is the signature of **one simultaneous six-title release**, i.e. components of a boxed set, not a series accumulating volumes. Their back covers read **“Sold as part of a set, not for resale”**, and they are absent from Open Library entirely (`/isbn/` 404, `numFound 0`). So all 12 of their gaps are `unknown` **permanently**, and the volume-number answer is `none` at high confidence.
  ⚠️ **Named trap: do NOT turn the consecutive ISBN block into volumes 1–6.** That is *assembly* order and carries no reading order — and it would look **more** credible than an ordinary guess precisely because it has identifiers behind it. The invented-number failure in its most persuasive costume.
  **Cheapest real fix: read one copyright page.** #274 *My First Toys* is the one physically on the shelf (`copies=1`), and “First published YYYY” usually sits directly under the printing line — that single page could close all six year gaps at once.

- `2026-08-13T09:40Z` **NEEDS YOUR DECISION** ⚠️ **The queue research found DATA DEFECTS, not just missing numbers.** Three, none of which I will act on unilaterally because two involve deleting production records:
  1. **#284 and #291 are the same book twice** — *Artemis Fowl and the Opal Deception*, both Eoin Colfer, both sourced from Open Library, **both with ZERO owned copies**, differing only by edition (#284 = 9781423124559 Disney-Hyperion, #291 = 9780241434666 Puffin). Not a graphic-novel/novel pair — one novel entered twice. Volume 4 either way. **Which one do you want kept?**
  2. ⚠️ **#299 is a corrupt record.** Title `the mazeruner`, author `James Dasher` — both misspelt — which has produced the `work_key` **`mazeruner|james dasher`**, a key that can never match anything, in a catalog whose whole review join runs on that key. Its ISBN (9780385737951) is nonetheless the correct Delacorte paperback, and **#333 appears to be the good record**. 0 copies, no cover. **Fix the title/author, or delete it?** Note it needs exactly the title/author edit the frozen-field guard currently blocks — but with no reviews behind that garbage key it is a **free move** under the design's §5.1 test.
  3. **"My First" is probably not a series at all** — six works (#274, #287, #288, #296, #303, #304), all credited to Autumn Publishing, all with **consecutive ISBNs** `978-1-83903-5906/13/20/37/44/51`. The research suggests the series value was **mechanically derived from the shared title prefix** rather than being a real ordered series, which would make the right answer `none` for all six volume numbers *and* a correction to the series field itself.
- `2026-08-13T09:40Z` **DONE** ⚠️ **My dispatch error, found by an agent's dead-end note and worth recording as a method rule.** I built the research worklist from title + author + series and **left out the ISBNs, which were in the database the whole time.** An agent reported it could not locate six books and wrote "physical ISBNs would settle it in one lookup" — they were one join away. Regenerated as `queue-worklist-with-isbns.txt`; **61 of 62 rows carry an ISBN**, and all three agents were given it. **Rule for next time: any research worklist out of this catalog ships with the ISBN and the copy count.** The ISBN is the only identifier in a row that is trustworthy when the title is wrong — which #299 above proves is a real condition, not a hypothetical.

- `2026-08-13T09:10Z` **IN PROGRESS** ⚠️ **The `/queue` residue — measured, and the shape changes the job.** Production holds **62 works owing 80 individual detail gaps** (the owner's "80 missing details" is the *field* count, not the work count — 9+3+59+9 = 80, which confirms the SQL replicates `detailGaps` exactly). Breakdown: **volume number 59**, first published 9, description 9, series 3. So **74% of the entire backlog is one field.**
  ⚠️ **And it splits into two classes that need opposite answers:**
  - **Real numbered series** — Artemis Fowl (9), Grey Griffins (3), Harry Potter, Hunger Games, Maze Runner, Dungeon Crawler Carl, Ellie Engle. The volume number is a *fact* to look up.
  - **Publisher imprints and box sets wearing a series name** — "My First" (6), "Little Golden Book" (2), and **#325 "Court of Thorns and Roses Hardcover Box Set"**. These have **no volume number at all**; the correct answer is a `gap_verdict` of `'none'`, which is a recorded ANSWER that stops the field being asked again. Inventing a number here is the documented failure mode, and `gap_verdict`'s three-way split exists for precisely this.
  Three research agents dispatched — clusters, singletons, and the non-volume fields. ⚠️ **They propose with sources; they do NOT write.** I apply in one reviewed batch, so nothing writes to production concurrently.
  ⚠️ **Trap found before any write: the volume number is TWO columns**, `series_index_sort` (REAL, so 2.5 orders correctly) and `series_index_display` (TEXT). Writing the sort key without the display value sorts correctly and **prints nothing** — a silent inconsistency. Both together or neither.
- `2026-08-13T09:10Z` **DONE** Three of Fable's logged UNSOLVED items are now **closed**, and it has been told so: (1) the carry's dependence on Firestore's shape-only rules — **decided** by the owner, recorded in `PLATFORM.md` §4a; (2) "the migration SQL was never dry-run against local D1" — **it has been now**, including the proof that `old_json` rejects SQL NULL; (3) the title-edit doc-id drift — **accepted** as a known wart, so the read-before-write dedupe is explicitly NOT to be built.
- `2026-08-13T09:10Z` **TODO → promoted into the live build** ⚠️ **The strip-lie is no longer out of scope.** Fable logged that `updateWorkSchema` **silently strips any unknown key** — `{"Title": …}` or a misspelled field returns **200 having changed nothing**. That was fine to defer when logged; it is not now, because "edit any detail" is *built on sending field names*. ⚠️ **An audit log makes this defect worse rather than better:** the `change_log` correctly records that nothing changed, the caller correctly reads success, and the two disagree forever with no error anywhere — the log manufactures evidence that the save happened. Same defect class the repo already caught by exercising rather than reasoning (zod silently stripping a stray `rating`). Sent to Fable to fold into the current commit, with the caveat that a blanket `.strict()` must be checked against what the web app actually sends first — `Editions.tsx` sends `isbn13`/`isbn10`/`asin` on every save, and 400-ing every edition edit would be worse than the strip-lie.

- `2026-08-13T07:55Z` **CLAIM (next, before scanning resumes)** ⚠️ **PRIORITY — the one-barcode-one-edition guard is SPECCED BUT ABSENT FROM CODE.** Fable's estate survey verified there is **no Open Library `/works/` refusal anywhere under `packages/`**. This is the exact defect that corrupted #300/#301/#302 from single barcodes (6 phantom editions + 6 copies in one evening). ⚠️ **Scanning resumes today with ~100 books left, so every new scan is exposed.** The rule is written in `catalog-platform/docs/info/matching-thresholds.md` §6 — implement it there-as-specced. **Do this first thing, ahead of the rest of the survey.**
- `2026-08-13T07:55Z` **TODO** ⚠️ **A rescan must be a question, not a second copy.** 71 physical editions carry no ISBN, and the docs' standing answer — "a barcode scan will fill it in later" — describes a path that **does not exist**: `catalog-add.ts` unconditionally writes a new owned copy plus a second same-format edition. Residue is already live: work #139 holds an OL hardcover beside a `manual` ISBN-less hardcover for one physical book. Reuses the shipped preorder-prompt pattern; **merge this with the already-specced edition picker** rather than building twice. (Same root cause family as the item above — both are "the scanner assumes it is seeing a new thing".)
- `2026-08-13T07:55Z` **TODO** Rehost third-party cover hotlinks into R2. Census: **108 Open Library + 43 Google hotlinks vs 33 self-hosted**; the bucket and `bookcovers.heygabi.ai` are already live, and every new scan adds more. A batch script plus one intake change. Complements the owned cover-swap feature rather than duplicating it.
- `2026-08-13T07:55Z` **TODO** Author-string canon + dedupe report. Production holds `Make Believe Ideas` vs `Make Believe Ideas  Ltd.`, and `SAMG` vs `SAMG Entertainment`. ⚠️ **That second split is the only thing preventing a full `work_key` collision between the two Hangul-stripped Korean works** — so the canon list must land BEFORE any author merge, and merges go one at a time through the now-approved edit-and-audit machinery, because every merge moves the ~860-review join.
- `2026-08-13T07:55Z` **TODO (larger, platform)** Stand up the shared index Worker, **games first**. No longer speculative: two hand-built library↔audiobook bridges already exist and **drift between script re-runs**, while the 836-item games catalog has zero. All of stage 2's prerequisites (domain, Pages, R2) have landed since PLATFORM.md was written. Unlocks own-in-any-format, pledge routing across catalogs, and push-on-change replacing re-run backfills.
- `2026-08-13T07:55Z` **TODO (small)** Board game catalog: `play` and `sleeve_requirement` are **dead schema** — 0 rows and no write path anywhere in that repo; only `export.ts` reads them. Also refresh PLATFORM.md's stale §1/§8, which still lists "which domain?" as open. `user_item` ratings are live code with 0 rows — **watch, do not retire yet** (the gaps-chip precedent).

- `2026-08-13T07:40Z` **DONE** ⚠️ **OWNER APPROVED ALL FOUR** edit-and-audit decisions ("do them all"). Recorded below; build dispatched.
  1. **Sentinel design + migration 0120 — APPROVED.** Build it.
  2. **`reviews_seen_*` — KEEP.** Fable left this to the owner's taste; kept as defence behind the client attestation.
  3. **Firestore `reviews` stays shape-only — DECIDED and recorded in `catalog-platform/docs/PLATFORM.md` §4a.** ⚠️ The carry procedure depends on it; hardening those rules later would silently break the restamp for other people's review docs.
  4. **Title-edit sibling review doc — ACCEPTED for now.** Reading stays correct; the fix costs a read before every review write, so it waits for evidence that retitles on reviewed books actually happen.

- `2026-08-13T06:55Z` **DONE** reviewed Fable's threshold report — verified both side findings against production. **One confirmed, one corrected.** See the section below.
- `2026-08-13T06:55Z` **UNSOLVED (new, real)** ⚠️ `normaliseTitle` **strips Hangul entirely**, so every Korean book's `work_key` is author-only. Needs a migration; see below.

- `2026-08-13T06:15Z` **DONE** deploy overlap guard — lock + ancestry check, both tested; `docs/deploys.log` seeded and un-ignored
- `2026-08-13T06:15Z` **DONE** all four owner-blocked items (#341 editions, Krout signed copies, #238–242, #300 deleted)
- `2026-08-13T06:15Z` **CLAIM** watch `/queue`, research the residue — see the section below
- `2026-08-13T06:30Z` **DONE** ISBN backfill on 265, 266, 267, 269, 274 — all five now carry their edition, and every copy is linked to it rather than dangling
- `2026-08-13T06:30Z` **DONE** #269 *Who Goes Roar?* gained the owned copy it was missing
- `2026-08-13T06:35Z` **DONE** ⚠️ RESOLVED the format question — owner's rule: *all board books are hardcover, since they are physically hard.* 10 editions moved paperback → hardcover; standing rule written into `docs/info/series-formats-and-audiobooks.md`
- `2026-08-13T06:30Z` **~~UNSOLVED~~ superseded** format on those five editions — recorded as `paperback`, which is the app's own documented convention (*"a scanned book is recorded as a paperback until someone says otherwise"*). ⚠️ Four of the five are **board books**, so paperback is probably wrong; the catalog's other board books came from Open Library as `hardcover`. I did not assert a format I had not verified. Worth a sweep once the edition picker exists.
- `2026-08-13T06:30Z` **CLAIM** Fable dispatched on (a) edit-any-detail + audit-log design, (b) re-measuring the matching thresholds — see FABLE5.md §7 for their side

---

### ⚠️ Reviewing Fable's threshold report — one finding confirmed, one corrected

Fable's measurement pass (`catalog-platform/docs/info/matching-thresholds.md`) ended
with two side findings. Both were checked against production rather than taken on
trust, which is the point of the gate running in both directions.

#### ✅ CONFIRMED, and worse than a curiosity: `normaliseTitle` strips Hangul

Fable reported *"Korean titles normalise to `""` — works #195/#305 share the empty
key."* **The bug is real; the specific claim is wrong.** Measured:

| work | title | `work_key` |
|---|---|---|
| #195 | 슈팅 스타 캐치! 티니핑: 약속 의 오로라핑 | `\|samg` |
| #305 | 하츄핑의 눈물 | `\|samg entertainment` |

They do **not** currently collide — the keys differ on the author half (`SAMG` vs
`SAMG Entertainment`). What they share is an **empty title half**, and that is the
actual defect: `normaliseTitle` removes every Hangul character, so a Korean book's
key is its author and nothing else.

⚠️ **Consequences, which are broader than one collision:**
- **Two Korean books by the same author would collide completely** — same author
  string, both titles empty. #195 and #305 escape only because the author is spelled
  two different ways, which is itself a thing to fix and would *cause* the collision.
- Korean titles can never be **matched by title** at all — so the ISBN is the only
  handle, and `9791165384678` is not in Open Library.
- ⚠️ It presumably applies to **any non-Latin script**, not just Hangul. Untested.

**Fixing it moves stored keys, so it is a migration, not an edit** — `work_key` is
the join to 860 audiobook reviews. It belongs with the edit-any-detail/audit-log
design, which is already solving "how do we move a key safely". **Do not fix it
piecemeal.**

#### ❌ CORRECTED: #258's three hardcovers are right, not duplicates

Fable flagged *"#258 carries 3 hardcover editions — edition-picker case in the wild
or leftover dupes; needs a human eyeball."* It is **not** dupes:

| edition | name |
|---|---|
| 359 | The Wizard variant cover |
| 376 | The Witch variant cover |
| 377 | The Wild One variant cover |

*Worlds Beyond Number: The Wizard, The Witch, The Wild One* was published with
**three variant covers**, and this catalog already recorded that deliberately — it is
in the work log as "one book, three variant covers". Fable lacked that context, so
the flag was reasonable; the answer is that the data is correct.

⚠️ **But its instinct was right for the other half:** this is a **real instance of
the edition-picker case already in production** — three editions of one format on one
work, which `Copies.tsx` cannot express. It is the second known case after #341, and
it strengthens `FABLE5.md` §4.2a. ⚠️ Note #258 is still **pre-ordered, 0 held**, so
whoever builds the picker gets a test case that must not be mistaken for owned.

---

### 🌙 OVERNIGHT AUTONOMOUS RUN — the plan, 2026-08-13

Owner: *"once i go to bed you'll work through all the remaining todos with
subagents."* Usage at hand-off: **session 34%, weekly 52%** (resets Sun 16:00).

⚠️ **Guardrails, from the global usage rules — these are not optional.**
Pause the *session* at **89%**. On the **weekly** limit, **stop starting new
subagents at 93%** and keep working conversationally only to 97%. ⚠️ A subagent's
cost is invisible until it lands — one landed at 372k tokens in a single lump — so
**the granularity of risk is one agent, not one tool call**. Pulse-check usage
whenever an agent is in flight and state the figure when reporting. A full session
≈ 9 weekly points, so ~5 sessions of headroom remain at 52%.

#### 🎭 Fable 5 gets its own allowance — spend it, 2026-08-13

Owner: *"we haven't used any fable 5 usage this month, we should plan to use that
for something. its waste to leave our powerhouse on the table unused."* The usage
page carries **Fable weekly at 0%** as a **separate line from the 52% all-models
pool**, so Fable work does not draw down the main budget. Dispatch it with the
`Agent` tool's `model: 'fable'`.

**Chosen split — a review gate, not just more building:**

| Fable 5 | Opus (me) |
|---|---|
| **Adversarially review every change before it deploys** | Build **cover swap** and the **record-delete button** |
| **Design the edit-any-detail + audit log** feature | ISBN backfills, #269, the two Goodreads covers, subtitles, volume numbers, Cal universe |
| **Review migration 0110+ before it runs** | Apply Fable's design **only after the owner approves it** |

⚠️ **Why review and not only building — stated plainly, because it is the reason
this split was chosen.** In one attended evening I got three things wrong and
caught each only afterwards: I diagnosed the silent save failures as React
hydration when it was the **1Password overlay**; I told the owner retitling a work
was safe when `WorkFields` explicitly guards against it (`work_key` ↔ 860
audiobook reviews); and I entered *Who Goes Roar?* with the publisher as author
when **Christie Hainsby** is credited. All were cheap because the owner was awake
to correct them. **Unattended, that class of error compounds** — which is exactly
what an independent model on a separate budget is for.

⚠️ **The migration does NOT go to production unattended.** The edit-any-detail
feature needs `authors`/`primary_author` nullable and a decision about what
`work_key` is with no author — the schema's own comment warns title-only keys
"collide across authors constantly". Design it overnight, have Fable review it,
present it in the morning, apply on the owner's word. Nothing else in this plan
touches the schema.

#### ✅ Agent-safe — no physical book, no owner decision

1. **Cover swap feature** (see its own entry) — read the Board Game Catalog's implementation first. Biggest win, and it also unblocks moving 147 hotlinked covers into R2.
2. **Record-delete button** — route already exists, nothing calls it, all 15 FKs cascade. Wants a confirm that names what goes with it.
3. **ISBN backfill** on works **265, 266, 267, 269, 274** — ISBNs are all recorded in this file.
4. **#269** — add the missing copy (it is owned) and correct the author to **Christie Hainsby**.
5. **Covers for #266 and #267** from the Goodreads URLs in the queue — download, then upload to R2 rather than hotlinking.
6. **#186 volume 11**, **#195 volume 8** — both verified against publishers.
7. **Subtitles** — *Last Child in the Woods* → "Saving Our Children from Nature-Deficit Disorder"; *Possibility & Promise* → "Echoes of the Unknown"; #341 → "Outworlder".
8. **#7 *Dungeon Born*** — confirm the audiobook link shows, and file the series into the **Cal** universe ⚠️ using whatever name `catalog-platform` actually holds; do not invent it.
9. ✅ **#174** author → **Parragon Books** — done 2026-08-13T17:20Z despite this entry (see the Opus log; verified in production 2026-08-14). The authors-edit *capability* (item 10) is still wanted for the general case.
10. **Edit-any-detail + audit log** — the large one. Read its entry for the measured constraints before designing.

#### 🔭 Watch `/queue` and finish what the automatic pass could not

Owner, 2026-08-13: *"while im sleeping can you watch the /queue and manually look
up anything that didn't finish. if you cant find it i'll resolve it when i awake."*

The details queue stood at **~190 works** when they went to bed. The automatic pass
resolves what a source will answer; this job is the residue.

**How to work it:**
1. Read the queue, and group by *what* is missing — a batch of 40 board books all
   missing a year is one research shape, not forty.
2. Research from primary sources: the publisher's own site first, then retailers,
   then Open Library / Google Books. ⚠️ The publisher's own page has been right and
   the aggregators wrong repeatedly tonight — *The Wonderful World of Bizzy Bear*
   is the publisher's series name and the volume numbers came off their page.
3. Apply only what a source states. **Prefer the API or a script over the book
   page** — per-field UI edits cost 5–10 tool calls each and land about half the
   time.
4. ⚠️ **What cannot be found is a result, not a failure.** Write it here with what
   was tried, so the owner can settle it in seconds rather than repeat the search.
   `docs/TODO.md` is already full of that pattern and it is the pattern that works.

⚠️ **Do not fill a field to empty the queue.** A guessed year or an invented series
makes the count go down and the catalog worse — and *nothing revisits these
columns*, so a wrong value is permanent in a way a blank is not. The queue being
non-empty in the morning is an acceptable outcome; a queue emptied with fiction is
not.

#### ✅ ALL FOUR OWNER-BLOCKED ITEMS CLEARED before bed — 2026-08-13

The owner stayed up to answer them, so none of these are pending any more.

| Was blocked on | Owner's answer | Done |
|---|---|---|
| #341 — 2nd B&N barcode: 2nd copy or 3rd edition? | *"A and C seem to be the same except C was an early bird thing. So lets say I have A and B to be safe"* | 2 editions (`…3457` dust jacket, `…4362` Target), **3 copies** — signed B&N, unsigned B&N, Target |
| *Untapped* / *Unmapped* signed copies | already stated: paperbacks signed, hardcovers signed too | #34 and #33 each gained a **paperback + hardcover edition with a signed copy** |
| #238 *Ritualist* hardcover signed | *"probably the one from that kickstarter, I don't own 2 copies of it signed"* | existing copy flipped to `is_signed = 1` — **not** a second copy |
| Are 239–242 signed too? | **yes, all four** | *Regicide*, *Rexus*, *Raze*, *Ruthless* flipped — the whole Kickstarter set 1–5 now reads signed |
| Monster Empire #300 | **delete it** | gone, with its 2 phantom editions and 2 phantom copies |

⚠️ **Recorded because the conservative choice on #341 loses information on purpose.**
Both B&N copies are filed as edition `9781638493457`. If the second one is really
the `…4355` B&N-early-exclusive, the catalog understates how many *printings* are
owned — which a barcode scan fixes later — whereas guessing `…4355` would assert a
printing that may not be in the house. That was the owner's call and it is the
recoverable direction.

⚠️ **The copy form cannot express this case**, which is why the two editions were
written with SQL: `Copies.tsx` deliberately **reuses an existing edition of the
same format** (the comment cites an importer that made 83 duplicate editions), so
"a second, different hardcover printing" is unsayable through the UI. `edition` and
`copy` carry no derived columns — no `work_key`, no `primary_author` — so SQL is
safe here in a way a `work` edit never is. **A cover-swap-style edition picker
would remove the need.**

#### ⛔ Still needs the physical book

- **Subtitles and cover photos** on the pull-list items — the board books in the stack.
- ⚠️ #341's **cover art is the Target edition's** (it carries an "only at Target" badge) while the record's primary edition is the dust-jacket one. Swap once the cover-swap feature exists.

#### ⚠️ Two working notes for whoever picks this up

- **Press `Escape` before clicking Save** in the web UI. The 1Password overlay swallows the click; this caused most of the session's silent failures.
- **Per-field edits through the book page cost 5–10 tool calls each and land maybe half the time.** Prefer the API or a script for bulk data. The UI is for things only the UI can do.

---

### 🔨 LIVE QUEUE — the scanning session of 2026-08-13

⚠️ **Standing instruction from the owner:** *"Keep adding whatever I queue for you
to the todo list so nothing is lost and keep working through them as I queue them
up."* So this list is appended to as things are called out, and ticked as they
land. It is the session's working queue, not a summary.

**Done**

- ✅ Tamer 2–6 print covers uploaded to R2 (works 244–248), each verified against its volume number
- ✅ #265 *There's a Mouse About the House!* added — Richard Fowler verified
- ✅ #266 *Don't Tickle the Dinosaur!* added — Sam Taplin / Ana Martín Larrañaga
- ✅ #267 *Richard Scarry's Busy Busy Farm* added — Richard Scarry
- ✅ #269 *Who Goes Roar?* added ⚠️ but see the repair list — wrong author, no copy, no ISBN
- ✅ Subtitles: #141 Ocean Tails · #160 Ambulance Rescue · #186 Dinosaur Safari
- ✅ #213/#215 Pringle & Finn resolved and verified; both `work_watch` notes cleared
- ✅ #132 + #186 moved to the publisher's series name, *The Wonderful World of Bizzy Bear*
- ✅ **Entry-form fixes deployed** (`54a1c94f`) — typed ISBN now stored, "have it" now the default
- ✅ #274 *My First Toys*, #287 *My First Farm Animals* — #287 confirms the fix: copy **and** ISBN both recorded

**Still queued**

- ⏳ 3 of the Autumn set: *My First Wild Animals* `9781839035951`, *My First Ocean Animals* `9781839035937`, *My First Food* `9781839035913`
- ⏳ The Korean *하츄핑의 눈물* — `9791165384678`, author **SAMG Entertainment**, series **하츄핑 마음 동화**, volume **2**
- ⏳ Cover for **#266** from `goodreads.com/en/book/show/48837075-don-t-tickle-the-dinosaur`
- ⏳ Cover for **#267** from `goodreads.com/book/show/43744333-richard-scarry-s-busy-busy-farm`
- ⏳ ISBN backfill: #265 `9781601304193`, #266 `9780794549503`, #267 `9781984894236`, #269 `9781836422808`, #274 `9781839035944`
- ⏳ #269 needs a **copy** (it is owned) and its author corrected to **Christie Hainsby**
- ⏳ #160 series → *The Wonderful World of Bizzy Bear*, volume **15**; #186 volume **11**; #132 volume 2 already right
- ⏳ #195 volume → **8** of *마음을 채우는 동화*
- ✅ #174 author → **Parragon Books** — DONE 2026-08-13T17:20Z (see the Opus log); re-verified in production 2026-08-14: `authors`, `primary_author` and `work_key` (`i love you little bear|parragon books`) all moved together
- 💤 *Fire Rescue* title pattern — owner said leave it

---

### 🔨 Scanning session — 2026-08-13

**The pull list is built and verified against production.** 14 books, grouped by
what each needs; published as a phone checklist artifact for the owner to work
through at the shelf. Two corrections to the old notes, both from live reads:

- ⚠️ **All 14 already have ISBNs.** The older note in this file claimed three of
  them had none — wrong. The ISBNs are on file and the lookups already failed on
  them, so **a barcode rescan returns the same nothing**; what is needed is the
  printed subtitle, or a photo.
- ⚠️ **#258 *The Wizard, The Witch, The Wild One* is NOT a shelf job.** It has no
  cover and was on the coverless list, but all three copies are still
  `preordered` — nothing has arrived. Do not send anyone hunting for it.

Verified: 9 works need a cover photo (the 4 originals + Tamer 2–6, all held), 3
need a subtitle (#141, #160, #174 — all already have covers), 2 need the series
line (#213/#215, the two live `work_watch` rows).

**⏳ In flight: ISBN 9781601304193, *There's a Mouse About the House!*** Added by
hand through `/add?mode=scan`. The ladder resolved **the title but no author**, so
the row has no **Add** button — `isAddable` in `ScanLines.tsx` requires a title
*and* an author. The proposal is parked in **scan job #20** (server-side, so it
survives a reload; reachable from "Unfinished sweeps"). ⚠️ **Waiting on the owner
for the author off the cover — deliberately not guessed**, since a wrong author is
a permanent wrong fact and `POST /api/works` does not dedupe.

---

### 🚢 Gaps chip removed from the collection stat strip — 2026-08-12

**The ask:** *"I thought we had opted to move all information from that gap
section into the individual book series… just get rid of the gaps button and
count in the top sections."*

They are right, and the chip was a partial reversal of their own earlier
instruction. `0253f64` removed the top-bar Series button on 2026-08-11 —
*"place that information inside of each clickable series instead"* — and
`78bbd04`, five commits later, put a **"N series with gaps"** link back on the
collection page pointing at `/series?gaps=1`. Approved at the time as "Option B";
withdrawn now.

Removed in full, not just the visible half:

| File | What went |
|---|---|
| `apps/web/src/pages/CollectionPage.tsx` | the chip |
| `apps/web/src/api.ts` | `Stats.seriesWithGaps` |
| `apps/worker/src/routes/catalog.ts` | the `listSeries` call in `/stats`, and its now-dead import |
| `apps/web/src/styles.css` | `a.stat--link`, whose only user it was |

⚠️ **Removing it also deleted the most expensive query in the app.** `/stats` is
fetched on every visit to the collection page, and that one integer cost a full
`listSeries` — every work, `series_volume` row, edition, copy, audio rung, link
and skip, with `completeness.ts` run over all 81 series. Not the reason it went,
but worth knowing if anyone reconsiders.

⚠️ **`/series` is still a live route** and must stay one — deep links, bookmarks,
the back button out of a series page and `backTarget('/series')` all resolve to
it. This removed an *entry point*, not the page. Both removals did.

**The standing decision is now written down in
`docs/info/completeness-wishlist-relations.md` §1.7**, with both build-and-remove
cycles in a table, because a bare count of what you lack reads as a missing
feature to anyone who has not seen it removed twice.

**✅ Deployed and read back from the live site**, version `d441ecd1`:

- The stat strip is now **259 books · 81 series · 104 authors · 290 editions ·
  15 on the way · 34 read** — no gaps chip.
- `/series?gaps=1` still works as a deep link: 26 of 81 series, the gaps-only
  filter active with its "Clear" button. The page survived; only the way in went.

---

### ✅ 870 review keys backfilled — 2026-08-12

`scripts/backfill-review-keys.mjs` had **never** been run with `--commit`, and
every review the household had written was invisible to this catalog:
`bookIdFromTitle` slugs the audiobook's decorated title, so the print
*Oathbound Healer* and `oathbound-healer-beneath-the-dragoneye-moons-book-1`
never met. **870 written, 0 unmatched**, ratings and text untouched.

⚠️ Stripping the `- MM` suffix was the PREREQUISITE, discovered by accident.
Oathbound Healer's reviews key to `oathbound healer|selkie myth`; with the
suffix still on, the work's key was `oathbound healer mm|selkie myth` and all
three would have stayed orphaned. This also unblocks **#31** (a rating means
you read it), which needed exactly this bridge.

---

### ✅ #31 — a rating marks the book read, for the whole shelf — 2026-08-12

The rule, the column and the per-book derivation all shipped on 2026-08-11 (see
the section further down) and were **unreachable**: every review was keyed on
the audiobook site's `bookId`, so nothing but a coincidence of spelling ever
matched. The key backfill above is what turned that on, and this is the half
that was still missing — **reach, not rule**.

`Reviews.tsx` derives a read state when somebody opens a book page. Nobody opens
258 book pages, and `backfill-read-from-ratings.mjs` needs a checkout of the
sibling repo to run, so production had **zero** derived read states. Now: one
Firestore query for the signed-in person's own reviews, **once per browser
session**, and one call that applies all of them.

| | What |
|---|---|
| ✅ | **`observedRatingsFromReviews`** in `@lc/core` — the pure half. Keeps mine via the existing `isMyReview`, drops anything off the half-star scale, drops a document with no `workKey` |
| ✅ | **`applyObservedRatings`** in `@lc/db`, and **`applyObservedRating` now delegates to it** rather than keeping a second copy of the same join. Chunked at 90 keys a statement — D1 caps bound parameters at 100 — so 400 ratings are five SELECTs, not four hundred round trips |
| ✅ | **`POST /api/reviews/observed`** and **`GET /api/reviews/collection`** |
| ✅ | **`apps/web/src/lib/read-sync.ts`**, run from the collection page, guarded by `sessionStorage` and silent on every failure |
| ✅ | The page says *"Marked N books read, from M ratings you have written on the audiobook site"* — **only when something changed** — and names where to undo it |
| ✅ | **No migration.** `read_state_how` is 0070 and nothing new is stored |

⚠️ **A sweep has no legacy key to fall back on.** It starts from the person, not
from a book, so a review written on the audiobook site *since* the key backfill
carries no `workKey` and is skipped — and is still picked up when its own book
page is opened. **The per-book path is the safety net, not a duplicate**, and
`fetchReviews`' legacy `bookId` query must not be dropped. Full reasoning in
[`docs/info/identity-and-reviews.md`](info/identity-and-reviews.md) §7.7.

**Measured:** 299 tests (was 287). Typecheck clean for `@lc/core`, `@lc/db` and
`@lc/worker`; the web build bundles. The SELECT and the write pair were run by
hand against the local D1 — a three-key `IN` list matched its two works and
ignored the unknown one, the pair produced `read` / `rating` / `audio` / 4.5,
and the probe row was deleted afterwards.

⚠️ **Not verified:** nothing has been run against production and no browser has
executed the sweep. The numbers it will write are the ones the 2026-08-11 dry
run predicted — **15 works, every one `read_format = 'audio'`** — and that dry
run predates 25 new works and the key backfill, so expect it to differ.

**Pending, in this order — nothing below has been run:**

```bash
# 1. Code only. There is NO migration for this one.
npm run deploy

# 2. Then simply open the collection page while signed in. The sweep runs
#    itself, once per session, and says what it did.
```

Running `npm run backfill:read-states -- --remote --commit` is still an
alternative to step 2 and is no longer needed — it writes the same rows by the
same rule. ⚠️ It is **not** redundant for the household members who have never
signed in here: the sweep only ever runs for whoever is looking at the screen.

---

### ✅ #43 — an arriving pre-order is a question, not a guess — 2026-08-12

*"We also need a feature where if I add a book that's in pre-order status there
is a prompt asking me if this is the received pre-order or different."* Built on
`feature/preorder-arrival-prompt`. **Not deployed, no migration.**

Production holds **12 pre-ordered copies** — Completionist Chronicles 2–5, Tamer
11, three *Worlds Beyond Number* variant covers — several shipping within months,
so this gets exercised soon.

| Answer | Write | The failure it prevents |
|---|---|---|
| the pre-order arrived | that copy `preordered` → `owned`, via `arrivedPatch` | a phantom pre-order inflating "on the way" for ever, because nothing re-checks it |
| a different copy | a new `owned` copy; pre-order untouched | silently losing a copy the household owns |

⚠️ **Asked before the first write, not between two of them.** `addLineToCatalog`
returns `{ status: 'ask-preorder' }` and writes nothing; answering re-runs it
from the top, and the work match is idempotent. A prompt nobody answers leaves
the catalog exactly as it was.

⚠️ **One button per pre-ordered copy.** *Worlds Beyond Number* is **one work with
three pre-orders**, one per variant cover — "the pre-order" cannot be resolved
without asking which, so each choice is labelled with its edition name.

| | |
|---|---|
| covered | the scan review row (`ScanLines`), and the manual Add form's **have it** intent |
| ⚠️ not covered, deliberately | `POST /api/works` — it writes no copy, so there is no arrival to confuse. The Copies panel and the arrivals checklist already show the pre-order on screen; nothing there is a guess |
| cost | one `GET /api/works/:id`, **on the Add tap only** — not per row |
| ⚠️ `wanted` stays apart | `preorderedCopies` tests one status. `CollectionStats` in `@lc/db` carries the sibling's 262-vs-25 bug |
| new files | `packages/core/src/preorders.ts` (rule + wording, 9 tests), `apps/web/src/lib/preorders.ts`, `components/PreorderPrompt.tsx` |

⚠️ **The manual Add form now matches before saving, and only for "have it".** It
still creates a work per save otherwise — `POST /api/works` does not dedupe on
purpose — so answering *a different copy* does exactly what Save did before.
General de-duplication of that form is a separate, larger change.

---

## Read this — state at the end of 2026-08-11 (SUPERSEDED by the 2026-08-13 section above)

> The "the run is finished" banner that used to sit here was written at the end
> of the overnight run and was **stale within hours**. A full day of work
> followed it. Treat any "everything is done" claim in this file as a timestamp,
> not a status.

**In flight right now:** a full crowdfunding rescan (§Crowdfunding rescan
below). Nothing else is running.

**Open and actionable without the user:**

| | |
|---|---|
| **`backfill:universes` has never run against production** | 0 of 233 rows have a universe. Biggest built-but-not-switched-on item |
| **Crowdfunding rescan** | Kickstarter shows **61** successful pledges; we hold **11** pledge items. In progress |
| ✅ ~~**#43 preorder-arrival prompt**~~ | **Built 2026-08-12** on `feature/preorder-arrival-prompt`, not deployed. Section below |
| **#37 editable audiobook listings** | largest remaining build; cheaper now the corrections layer exists |
| **#29** how duplicates count · **#31** rating ⇒ read | unchanged |
| ✅ ~~**#30** B&N covers~~ | **Done 2026-08-12, and mostly already done.** All 7 had covers on 2026-08-11 from `apply-bn-details.mjs`; #30 was a stale entry. What was left was §2.5's other half — all seven images were *viewed*, six are the book's own jacket, and Project Hail Mary's stand-in was replaced with the **Deluxe Edition's own art**. `scripts/assess-bn-covers.mjs`, written to production. "Cover needed" among the seven: **0, was 1.** |

**Wants a human — nothing here is waiting on more work:**

1. Four universe verifications — Will Wight (Cradle, Last Horizon), Turncoat's
   Truth, Cultivating Chaos + The Axe Falls, Tailored Realities.
2. Say what "+ Books" meant in the Words of Radiance tier — BackerKit holds no
   itemisation for that pledge at all.
3. ~~Confirm the published title of the *Unstoppable* novel~~ — ✅ **RETIRED
   2026-08-11. There is no novel.** *Dungeon Crawler Carl: Unstoppable* is a
   card-crafting deck-builder; the pledge is two tabletop games and is out of
   scope entirely.
4. Resolve *Secret Ingredient* vs *Pengrooms* — **see THE PHYSICAL STACK below.**
5. ~~Give five reward lines a format~~ — ✅ **RETIRED 2026-08-12: nothing to do.**
   Checked three places: all 11 `pledge_item` rows carry a `format_hint`, all 11
   book lines in the staged scan carry an `editionFormat`, and nothing is marked
   unresolved. The only formatless line is the Fires of December AUDIOBOOK, which
   is deliberate — `editionVerdict: "none"`, because an audiobook is not a
   printing and would otherwise sit in the no-printing queue forever.
6. Add subtitles to three board books — **see THE PHYSICAL STACK below.**
7. Decide whether the heygabi.ai `/todo` page should be public. Built and pushed,
   **deliberately not deployed** — the user has since said to keep it private.
8. ~~Paste four cover links~~ — **moved into the scan backlog 2026-08-12.** The
   owner has those four pulled in a physical stack to re-scan, so they are not a
   paste-a-URL job. ⚠️ Separately, coverless works went 6 → 32 because scripts
   that mint works bypass the cover pipeline; 21 were then filled from the
   sibling audiobook catalog as **stand-ins**, leaving 11 — the four originals
   plus Tamer 2-6, Space Knight 7 and Worlds Beyond Number, all print-only or
   unreleased so there is no audiobook art to borrow.

   **✅ Done 2026-08-12 — Space Knight 7 was never print-only.** The m4b was
   sitting loose at the `books/` root instead of in `Michael-Scott Earle/`, so
   the library walk never saw it and every listing read the series as 1–6, 8–10.
   Ran `scripts/sync_to_drive.py` by hand: sorted, 612.7 MB to Drive, 25
   chapters, cover to R2, catalog 1076 → **1077**.

   It still landed seriesless, for the same reason its six siblings did — the
   file is ffmpeg-made (`©too=Lavf61.1.100`), so it carries no `SRNM`/`SRSQ` and
   no `CDEK`, only `©alb` and `trkn`, neither of which the pipeline reads. Only
   books 1 and 2 are real Audible downloads with genuine `SRNM`. Added the
   matching `catalog_overrides.json` entry; all ten volumes now carry series and
   volume. Then, downstream: `covers-from-audiobooks.mjs` → **11 coverless works
   → 10**, and `backfill-audiobook-holdings.mjs` → Space Knight rungs
   **[1,2,3,4,5,6,7,8,9,10], 1 new**, every other series `0 new`.

   ⚠️ **Two lessons, and the second one cost the most time.**

   1. *"No audio for this volume"* was inferred from a catalog listing, and the
      catalog only sees files the sorter has filed. A loose file in the drop
      folder is invisible and looks exactly like an absent one. **Check the raw
      `books/` root before recording an audio gap.**
   2. The owner reported the live site showing series for only books 1–2 while
      the deployed `catalog.csv` demonstrably had 1–6 and 8–10 correct. That was
      a **stale browser cache of `catalog.csv`**, not a data fault — it cleared
      on the next deploy. ⚠️ Before debugging a data bug from what the page
      shows, fetch the underlying CSV with a cache-buster and compare. The two
      disagreeing is itself the diagnosis.
9. **Sign in to BackerKit as `nbaslamking@gmail.com`** so the second account can
   be scanned. `aim.com` is signed in and holds only Words of Radiance.

✅ Cleared today: the Illumicrate Percy Jackson set was confirmed *and*
independently verified against the campaign photo.

### ✅ Four items closed 2026-08-12 — and two of them were already done

The owner asked what was still outstanding, said *"30 i thought we did this"* and
*"31 I thought we did this too"*, and was right on both counts. Checked against
the live database rather than the task list, which is the point of writing this
down: **two of the four open items had been finished and never marked.**

| # | Outcome |
|---|---|
| **30** B&N covers | **Already done.** All 7 works bought from Barnes & Noble carry `cover_status='ok'` and a real URL. None outstanding. |
| **31** rated → read | **Already done.** All 35 `user_book` rows are `read_state='read'`, `read_state_how='rating'`, synced 18:01:39. |
| **44** Realmkeeper pairing | **Confirmed by the owner** — "1,2/3,4/etc." The stored `collects` strings were already right, so no data changed; only the provenance moved from *assumed* to *verified*. |
| **29** duplicate counting | **Decided and implemented** (commit `8099bb7`). ⚠️ **Not deployed** — the worker deploy is manual. |

⚠️ **On #31, do not mistake this for incomplete:** 47 works sit under a series
with an audio rung but carry no read state. That is correct. The signal is a
**rating**, not ownership — an unrated audiobook says nothing about whether it
was read, and inferring "read" from "owned on audio" would be inventing data.

**The #29 rule, in two halves that look alike and are opposites:**

1. **Own it N times → it counts N times.** The owner's reason is the design
   brief: *"This will make giving books away."* So it is an inventory count, not
   a bibliography — and it counts `copy` rows, so two copies of ONE edition
   still count as two. This half needed **no change**: `heldCopies` already
   counts copies rather than editions, and `WorkList` already renders the ×N
   mark. DCC shows ×2 and becomes ×3 when the third is scanned.
2. **An omnibus of five books is still ONE object.** It counts once, on its own
   line; the volumes inside are not counted again but each carries a
   *non-counted* cross-reference. The `contains` relation already existed and
   rendered as "Part of" — but a bare "Part of" chip reads as *another thing on
   the shelf*, the exact misreading the rule exists to prevent. It now states
   the consequence from both ends.

⚠️ **The Divine Dungeon omnibus collects books 1–5, but books 2–5 do not exist
as works in this catalog** — only *Dungeon Born* does, and it already has the
link. The whole catalog has exactly **one** `contains` relation, so there were
no missing overlap notes to write.

Also fixed while in there: `collectionStats` counted `status='owned'` while
every other "do we have it" decision routes through `HELD_STATUSES`, which also
counts `lent`. Lending a book would have shrunk the shelf total while the ×N
mark beside it kept saying two. No row is lent today, so no number moved — the
disagreement was waiting for a first loan.

⚠️ **Build trap, now recorded in the code:** that stats SQL is a template
literal, so a backtick inside a `-- comment` closes it. It broke the build on
the first attempt.

### ⚠️ THE PHYSICAL STACK — one trip clears all of it

The owner has these pulled as a physical stack. Consolidated 2026-08-12 so
they are answered together rather than raised one at a time. **Remind them of
this whole list when they next mention the pulled books.**

| | needs | why nothing else will do |
|---|---|---|
| #141 *Touch and Explore* · #160 *Bizzy Bear* · #174 *I love you, little bear* | a **subtitle** | bare series-line titles; a lookup returns the range, not the book. ⚠️ **CORRECTED 2026-08-13: “all three ISBNs did not resolve” was FALSE for #141 and #174** — both resolve on the first call to Open Library's `/api/books`, and six of nine answers for those two came from those two calls. The original conclusion came from **web-searching the ISBN string**, which returns garbage (searching `9781472327314` returns an unrelated book called *Cut*). The claim now stands only for #160 |
| #137 Paw Patrol shaped board book · #171 *Home Sweet Home* · #195 Korean Tinyping · #197 *The Nightmare Before Christmas* | a **rescan** | no cover any rung can reach, and no audiobook to borrow one from. Not a paste-a-URL job |
| #215 *Pengrooms* · #213 *Secret Ingredient* | the **series name off the cover or spine** | contradictory auto-fills. Both star Pringle and Finn; "Pengrooms" reads as the 2021 book's TITLE, not a series. Theory: series is *Pringle & Finn*, books 1 and 2 — unverified, and a self-published picture book may have no formal series at all. Both wear a Check mark; clear the `work_watch` rows when resolved |

---

## Overnight autonomous run — started 2026-08-10 ~22:35

The user went to bed with: *"keep the working going until everything on the todo
list is done, take breaks as necessary to not hit usage limit but everytime it
refreshes you keep going. if you need me to intervene set it aside and keep going
on with other things."*

Rules being followed: stop starting agents at **93% weekly**, keep working
conversationally to **97%**; the session window is the cheap one (it resets in
hours) and the weekly is the real ceiling. Anything needing the user goes in
**Blocked** above rather than stalling the run.

Five agents were in flight at bedtime: mark-as-arrived (+ clickable series on
cards), audiobook matching + automatic covers, a browser verification sweep,
and the bulk details-queue clear. ⚠️ The queue agent was told to **report the
cost before spending it** — the research path is a paid API and the backlog is
in the hundreds.

---

## 2026-08-11, second half — series, audio and the duplicate cleanup

Everything below is **live**. Data-only items needed no deploy; code items are
in version `8c8b4e76`.

### ✅ Three agent branches merged, and a migration collision caught

Universe auto-assign (0080), the universe UI, and the audio-gap fixes. ⚠️ **Two
agents independently created `migrations/0080`** — git merged both cleanly
because the filenames differ, but wrangler tracks migrations by NAME, so it
would have marked 0080 applied and **silently skipped** the audiobook one.
Renumbered to `0090_audiobook_series_holding` and `0100_series_gap_skip`. All
three applied to production. 287 tests.

### ✅ The ladder now tells the truth about audio — 0090

`audiobook_series_holding`, keyed `(series, index_sort)`. `work_match` renders
**AUDIO** and stops counting as missing; `fold` renders **AUDIO?** and *stays*
missing, because a hedge does not cross a book off a list.

⚠️ **Agent a3a4426 claimed "every row has a matching `series_volume` row by
construction, and there is a test".** That was true of its fixture and **false
in production** — 52 of 113 rungs had no backing, and Percy Jackson had none at
all, so the page read *"5 of at least 5, nothing missing"* while books 6 and 7
sat in the audiobook catalog. Fixed by running `backfill:series-volumes`, which
already existed. **Lesson: a subagent's "verified" can be true of its fixture
and false of production.**

### ✅ Series completed from the audiobook side

A full sweep of all 1,075 audiobook rows: 85 books were seriesless while their
own `©alb` held a series the pipeline never reads. 71 were standalones (correctly
seriesless). The rest completed six series — Lion's Quest 1–6, Space Knight
1–10, Jackal Among Snakes 1–3, Millennial Mage 1–2, Monster Empire 1–2, Tamer
7–10 — plus the Full Murderhobo #3 gap.

- **Lion's Quest volume 5 is spelled `Lions Quest`** in its `©alb`, the only book
  in the series spelled that way, which is why it split off and looked like a
  hole. Now fixed **at source**: `SRNM`/`SRSQ` written to all six files so the
  `canonical_series` fold is no longer load-bearing.
- **Tamer volume 1 exists twice and that is correct** — two narrations, 762.8 MB
  and 333.8 MB. Recorded in `_not_corrected_on_purpose`; the sweep will keep
  reporting `DUPLICATE_VOLUME` for them and **that report should be ignored**.

### ✅ Dungeon Crawler Carl promoted, without touching the matcher

Added the Kickstarter V2 & V3 limited hardcovers (*Carl's Doomsday Scenario* #2,
*The Dungeon Anarchist's Cookbook* #3). That was the missing corroboration — all
8 rungs went `AUDIO?` → `AUDIO`. The hedge had been **correct**: the only DCC row
we held was *Crocodile*, a Florin DuPont side-story, deliberately unnumbered.

### ✅ Smaller, all live

- **24 children's titles title-cased** (`123s of art` → `123s of Art`). Safe
  because `normaliseTitle` lowercases, so `work_key` and the Firestore review id
  are byte-identical — and the script **checks** that rather than asserting it.
- **Series button removed from the top bar**; a series is reached from its book.
  `/series` is still a live route.
- **"N series with gaps" stat** on the collection page, linking to
  `/series?gaps=1` — computed by `listSeries`, not a `COUNT(*)`.
- **Divine Dungeon omnibus**: 2,258 pages (a *convention* — the epub declares no
  page count), `collects`, and a `contains` relation.

### ✅ 34.9 GB of duplicate audio removed

58 files across four causes: two stray nested folders, and two co-author folders
already handled by `author_aliases.json` (`Dennis Vanderkerken → Dakota Krout`,
`Alexey Kovtunov → Oleg Sapphire`). Every deletion was preceded by a byte-level
check that an identical twin survives — **zero unique, zero mismatches**.
⚠️ `zzzz_Books_to_be_Converted` is a staging pile of part-files and must always
be excluded from sweeps.

### 💤 The uncurated m4b repair path is DISARMED

Scrapped by the owner after the full dry run proposed 128 writes of which **7**
were plausible. `--commit` without `--from-overrides-only` now exits 2.
Reasoning in `audiobook_catalog/docs/info/catalog-corrections.md` §8.2.

---

## Shipped this session

| | Item | Evidence |
|---|---|---|
| 🚢 | Newest scanned book at the top of the queue | `6732f331`. ⚠️ Row/index pairing happens *before* the reverse — `index` is the offset the server patches. |
| 🚢 | Covers reach the work, not just the edition | `74ddd86`. Cover was landing one table away from where every list renders it. |
| ✅ | Stranded covers backfilled | `scripts/backfill-work-covers.mjs`. 35 filled, 0 stranded. |
| ✅ | **Board books corrected to hardcover** | `scripts/fix-scanned-formats.mjs`. 99 editions; production now has **0 paperback**. Dated on purpose — real paperbacks are arriving from B&N. |
| 🚢 | Series restructure | Print/Ebook/Audio chips, "Bought more than once", searchable series list. Migration `0010`. |
| ✅ | Audiobook holdings backfilled | 40 written, confirmed by re-read. |
| 🚢 | Format filter + preorder tag | Filter means **"has a physical edition"**, not "physical only". Caught `stats.wanted` silently summing wanted + preordered. |
| 🚢 | Editing an edition | `PATCH`/`DELETE /api/editions/:id` + Editions panel. `updateEditionSchema` had existed since day one with no route behind it. |
| 🚢 | Drive links hidden for physical books | Rule: show only when a **non-physical edition** exists. ISBN deliberately not consulted. |
| 🚢 | Automatic first-pass lookup | Ported from the sibling. **Concurrency is 1** — an 8-way `Promise.all` funnels through a 1100 ms serialising queue; measured 8885 ms for 8. |
| 🚢 | In-queue duplicates, unresolved barcodes, SKUs | Duplicates were deduped server-side at append time and the flag was never read. Non-Bookland codes are now addable rows carrying the raw code. |
| 🚢 | **Auto-apply missing details** | The queue writes what it finds instead of asking. Migration `0013` adds `decided_how`, so machine-written values stay distinguishable from asserted ones. `GET /auto-applied` + `POST /undo` give bulk recoverability. |
| 🚢 | Accessories + crowdfunding provenance | Migrations `0020`, `0021`. Four tables; campaign/pledge split so **two BackerKit accounts** can back one campaign. |
| ✅ | All 62 Kickstarter pledges enumerated | 15 library, 45 board games, 2 neither, 8 mixed, 6 flagged ambiguous rather than guessed. |
| ✅ | **Mark as arrived, in batches** | `6593a7e`. Ported from the sibling onto the **wishlist**, not a book page — a pledge delivers several *works*, so no work page can hold the batch. No migration, no bulk endpoint: N × `PATCH /api/copies/:id`, `allSettled`. ⚠️ `arrivedPatch` also dates the copy, which the sibling does not — it dropped `acquired_on`; we kept it. Only when empty, so a known date is never overwritten. |
| ✅ | A card's series is a link | `6593a7e`. ⚠️ The card had to stop being a `<button>` first — an `<a>` inside one is invalid HTML. Title is now a stretched link; series sits above it on z-index. |

---

---

## Covers you can fix yourself, and one label — 2026-08-11

Three asks, one feature: *"this cover is not really the right cover, and I know
it."* Built on `worktree-agent-ab5f1d6d24c0a09ed`. Typecheck clean, **150 tests
pass (was 140)**, exercised end-to-end against a local D1 with the migration
applied — including the real Illumicrate URL, which fetched **198,624 bytes**.

| | What |
|---|---|
| ✅ | **`work.cover_status`** — `'ok'` / `'standin'` / NULL. ⚠️ NULL is *unassessed*, not *fine*. Migration `0040`, no CHECK (`gap_verdict.field`'s idiom). |
| ✅ | **"Cover needed"** on cards and the book page = no cover **or** a known stand-in. One rule, `coverNeeded` in `@lc/core`, shared by the mark and the SQL. |
| ✅ | **`work_watch`** — "needs my eyes, and here is why". Note required; resolved rather than deleted; `raised_how` is `decided_how`'s counterpart so a run can later flag its own guesses. |
| ✅ | **`Needs` filter** on the collection — *Cover needed* / *To check* / *Either*, with counts, in the URL like every other filter. |
| ✅ | **Cover panel** on the book page: link an image, mark it a stand-in, remove it, or upload a file. |
| ✅ | **Percy Jackson** — five works set to the Illumicrate lineup and flagged `standin`, by the migration. |
| ✅ | **#213 / #215** — both get a `work_watch` row explaining the contradiction, by the migration. |
| ⏸️ | **Uploading a file needs an R2 binding this Worker does not have.** The route is complete and answers **501** with a sentence naming what is missing; the UI hides the picker. |

### ⚠️ The R2 question, and why §7 does not forbid it

`wrangler.toml` and `docs/access/cloudflare.md` §7 say "no R2 bucket,
deliberately". **That decision is about scan photographs** — write-only objects
whose only purpose was to be deleted later. A cover is the opposite: read on
every page load, forever, and deleting it is the bug. Both rules now stand
side by side in §7, and §7.1 has the exact `wrangler r2 bucket create`,
custom-domain and Cache Rule steps. ⚠️ The `r2.dev` URL is rate-limited and
uncacheable — the custom domain is the whole point, as it is on the audiobook
catalog.

Nothing was half-wired: with no binding, every other part of the feature works.

### Run these — ⚠️ migration BEFORE deploy

```bash
# 1. Schema + the two data corrections, against production.
npx wrangler d1 migrations apply library-catalog --remote --config apps/worker/wrangler.toml

# 2. Then the code.
npm run deploy

# 3. Confirm. Expect enabled:false until the bucket exists — that is correct.
curl -s https://library.heygabi.ai/api/cover-storage
```

⚠️ **Migration `0040` carries data, exceptionally**: the five Percy Jackson
covers and the two watches. Both are guarded (`edition_name`, and id + title
together), so they write nothing in a database that does not hold those rows.
Applied and re-run locally to confirm the selector picks the right works.

---

## Every special edition in one bucket — 2026-08-11

The ask, in the owner's words: *"Let's normalize any edition to collectors
edition. Keep the original name on the visible listing but for our sanity all
editions should be collectors and we can fix them one off if needed."*

Built on `worktree-agent-a40181996e01c3a59`. Typecheck clean, **164 tests pass
(was 150)**, exercised end to end against a local D1 with migration `0050`
applied — the filter, the facets, `POST`/`PATCH /api/editions`, and the backfill
run twice to prove it is idempotent.

| | What |
|---|---|
| ✅ | **`edition.edition_kind`** — `'collectors'` or NULL. Migration **`0050`**, schema only, no CHECK (`gap_verdict.field`'s idiom). Partial index on the non-null side. |
| ✅ | **`edition_name` is untouched** and stays what every listing prints. The kind sits beside it; the book page shows both. |
| ✅ | **`classifyEdition`** in `@lc/core`, beside `suggestFormat` — the same reward prose, a different question. `suggestFormat('Deluxe Edition')` is null and `classifyEdition` is `'collectors'`, and both are right. |
| ✅ | **Printing filter** on the collection — *Collector's edition* / *Named, not sorted*, with counts, in the URL as `?kind=` like every other filter. |
| ✅ | **A select on the Editions panel**, so any row can be re-filed by hand. |
| ✅ | The shop-order and pledge-edition importers set it on insert. |

⚠️ **NULL means an ORDINARY printing here, NOT "unclassified"** — the opposite of
`cover_status` one table over, deliberately. 220 editions have no name and are
plain; filing them as unknown would mint 220 jobs nobody will do. The cost is
that an unrecognised special edition is filed as ordinary in silence, and the
thing that pays for it is the **"Named, not sorted"** filter: a special printing
is always *named*, so that two-row list is the whole risk surface. Do not remove
that control thinking it is a spare option.

### ⚠️ Three rows deliberately NOT swept in

- **"Omnibus - collects volumes 1-3"** and **"Volume 1"** — both *White Sand*.
  They describe **what is inside the book**, not how it was printed. White Sand
  is the original "alternate copies of stuff we already own" case the series
  restructure was built around. Left NULL; they are the "Named, not sorted" list.
- **"ebook"** — junk out of a reward name, on a row whose `format` is already
  `ebook_epub`. The backfill **clears the name**, guarded on the format.
- One extra: **"Book with sticker and bookmark tier"** is classified **by hand**
  in the script, because no honest keyword reaches it — a bookmark is not a
  binding, and adding 'sticker' to the rule would misfile the next
  paperback-with-a-freebie.

⚠️ **The brief's own figures do not reconcile** — it states 17 named rows across
13 distinct names, then enumerates 12 names whose counts sum to 19. So a
thirteenth name exists that has never been seen. **Read the dry run**; if it
lands under "leaving as an ORDINARY printing", that is a decision worth a look.

### Run these — ⚠️ migration BEFORE deploy

```bash
# 1. Schema only. No data in this one, unlike 0040.
npx wrangler d1 migrations apply library-catalog --remote --config apps/worker/wrangler.toml

# 2. Rehearse against production and READ THE THREE LISTS it prints.
npm run backfill:edition-kinds -- --remote

# 3. Apply. Confirms by re-reading the database, and fails loudly on bad arithmetic.
npm run backfill:edition-kinds -- --remote --commit

# 4. Then the code.
npm run deploy
```

---

## A rating means you read it — 2026-08-11

The ask: *"if a book has a rating from the audiobook library mark it as read"*,
refined to *"ratings should be for the logged in person"* and *"mark all copies
of a book read"*.

Built on `worktree-agent-afef029056ca7bdab`. Typecheck clean, **197 tests pass
(was 180)**, exercised end to end against a local D1 with migration `0070`
applied — the backfill run twice to prove idempotence, and the Worker's exact
statement sequence run by hand (see the note on `wrangler dev` below).

Full reasoning in **`docs/info/identity-and-reviews.md` §7**. The short version:

| | What |
|---|---|
| ✅ | **`user_book.read_state_how`** — `'human'` / `'rating'` / NULL. Migration **`0070`**, schema only, no CHECK (`gap_verdict.field`'s idiom). Partial index on the non-null side. |
| ✅ | **The derivation is in the BROWSER**, on the book page. The Worker cannot see Firestore — no service account, deliberately — so `Reviews.tsx` is the only thing in the estate that sees both stores. It posts what it read back to `POST /api/reviews/:workId/observed`. |
| ✅ | **`deriveReadState` in `@lc/core`** — one rule, three callers (Worker, browser, backfill). Never overrules `'human'`; never promotes a `dnf`; refines its own earlier answer; returns null for a no-op so a second run is free. |
| ✅ | **`setReadState` stamps `'human'` unconditionally.** That is the entire protection: touch the chips once and no sync can ever move it again. |
| ✅ | **`read_format = 'audio'`** from an audiobook review. The owner listens to far more than they read, so this is the main signal rather than a nicety. |
| ✅ | **`scripts/backfill-read-from-ratings.mjs`** — `npm run backfill:read-states`. Dry run by default. |
| ✅ | The book page prints *"Marked read from your audiobook rating"*, so nobody is told they asserted something they did not. |

### ⚠️ The multi-copy half needed no code, and here is why

Read state is `UNIQUE (work_id, user_id)` — it hangs off the **work**, not the
copy. Three `copy` rows of one work have always shared one read state. What
needed code is three copies that arrived as three *works*, and the fan-out for
that is by `work.work_key` (indexed, **not** unique), which is also the key the
reviews carry. Measured: **no `work_key` is shared by two work rows in
production today**, so it is correct in advance rather than after the fact.
It merges nothing and mints no `work_relation` — that stays with the
omnibus/`edition.collects` work.

### ⚠️ Three things found by running it

1. **All 869 review documents carry no `source`, no `workKey` and no `email`.**
   So reading `doc.source` would have derived 869 read states with **no format
   at all**. `reviewSourceOf` closes it: `reviewDocFor` always writes both
   `workKey` and `source`, so a document with neither cannot have come from
   here, and the only other writer is the audiobook site. The invariant that
   makes that sound is asserted in `core.test.ts`, not left as a comment.
2. **A live display defect.** `Reviews.tsx` rendered `r.source === 'audio' ?
   'audiobook' : 'this library'` — which labelled **every** audiobook review
   "this library", the one thing that component's own header says must never
   happen. Fixed by the same function.
3. ⚠️ **`wrangler dev` in a git worktree writes to the MAIN CHECKOUT**, and
   `--persist-to` does not override it. A worktree's `.git` is a file, so
   wrangler walks up past it and resolves `.wrangler/state` under
   `library_catalog/apps/worker/`. Symptom: the dev server served a stale
   116-work database and 500'd on `cover_status`. Only the local miniflare dev
   D1 was touched (gitignored, not production), and the run was stopped as soon
   as it was diagnosed. **`d1 execute --local --persist-to` IS honoured** — that
   is the pair, and it is why the same asymmetry is worth remembering.

### Staged — ⚠️ migration BEFORE deploy, and the backfill is the user's call

```bash
# 1. Schema only. No data in this one, unlike 0040.
npx wrangler d1 migrations apply library-catalog --remote --config apps/worker/wrangler.toml

# 2. Then the code.
npm run deploy

# 3. Rehearse against production. Reads only. READ THE SAMPLE LIST it prints.
#    ⚠️ LC_AUDIOBOOK_ROOT is NOT optional — see the trap below.
LC_AUDIOBOOK_ROOT=C:/Users/nbasl/OneDrive/Documents/vs-code-repos/bookbuddy/audiobook_catalog \
  npm run backfill:read-states -- --remote

# 4. Apply. Confirms by re-reading the database and warns on bad arithmetic.
LC_AUDIOBOOK_ROOT=C:/Users/nbasl/OneDrive/Documents/vs-code-repos/bookbuddy/audiobook_catalog \
  npm run backfill:read-states -- --remote --commit
```

**Dry run against production 2026-08-11 — nothing was written:**

| | |
|---|---|
| review documents | **869** (860 on 2026-08-09) |
| claimed by a signed-in person | **412** — Skylar 383, Amber Mitchell 29 |
| nobody in `app_user` claims | **457** — Samantha Hardman 225, Jamie Jeremiah Lievertz 213, Sparkling Ember 11, Solomon Hardman 8 |
| no derivable `workKey` | **0** |
| book not held here | **397** |
| **would mark read** | **15**, every one `read_format = 'audio'` |

The 15: all five Percy Jackson volumes, *Project Hail Mary* (for **both**
people), *Dungeon Born*, *Moonfall*, *Words of Radiance*, *Yumi and the
Nightmare Painter*, *The Wandering Inn*, and four others.

⚠️ **15 is the right answer, not a shortfall.** 397 of the 412 are audiobooks
with no print or ebook copy here — the household owns ~1,075 audiobooks against
231 works in this catalog. And most of the physical shelf is collection pieces
that were never meant to be read, so a blank read state there is correct.
**Nothing in this feature turns an unread physical book into a worklist, a badge
or a count** — the same trap `cover_status` NULL and `edition_kind` NULL were
each shaped to avoid.

⚠️ **Two zero-reads that look like answers**, both hit while building this and
both now fatal rather than tidy: the default `catalog.csv` path lands three
directories too deep in a worktree (first dry run: `0 distinct bookIds`, `no
derivable workKey: 412`), and `scripts/lib/d1.mjs` returned **0 works** against
a live 231 on one run and 231 a minute later — the flaky read `docs/TODO.md`
already records. The script exits on either.

### Worth running alongside, not required

`npm run backfill:reviews -- --commit` (the review-**key** backfill, written
2026-08-09 and still never run) stamps `workKey` **and** `source: 'audio'` onto
all 869. After it, the browser reads the audio signal from the field instead of
inferring it, and `fetchReviews` can eventually drop its legacy `bookId` query.
The two are independent and may run in either order.

---

## BackerKit import — RUN against production 2026-08-10

`npm run import:crowdfunding -- --remote --commit`. Written: **6 campaigns, 6
pledges, 4 reward lines across 4 books, 0 accessories.**

Per-pledge, verified by re-reading the database:

| Campaign | Account | Lines |
|---|---|---|
| Surprise! Four Secret Novels | acct 2 | **4** ✅ |
| Hoid's Storybook Collection | acct 1 | 0 |
| The Primal Hunter Deluxe Box | acct 1 | 0 |
| DCC: CROCODILE | acct 1 | 0 |
| Ascend Online: Legacy of the Fallen | acct 1 | 0 |
| Words of Radiance Leatherbound | acct 2 | 0 |

⚠️ **The five zeroes are the importer working as designed, not failing.** It
creates no `work` and no `edition`, because a campaign's spelling of a title is
exactly what mints a duplicate. Five books must be created by hand first, then
the import re-run — it is an idempotent upsert keyed on campaign `externalId`,
so a second run adds the missing lines without duplicating the six pledges.

Books to create: *Fires of December* (Sanderson), *The Primal Hunter* (Zogarth),
*Dungeon Crawler Carl: Crocodile* (Dinniman), *Ascend Online: Legacy of the
Fallen* (Chmilenko), *Words of Radiance* (Sanderson).

Kickstarter, Indiegogo and Barnes & Noble are **deliberately not in the input
file**. B&N is a shop, not a promise — `copy.vendor` covers it. Four Kickstarter
pledges are the same pledges as BackerKit account 2's, so *Four Secret Novels*
is recorded once, under `platform: kickstarter`.

---

## Purchase scan — staged

JSON lives in the session scratchpad and is **never committed** (it carries order
data). `scripts/crowdfunding-scan.json` is gitignored for the same reason.

| Source | State | Books |
|---|---|---|
| Barnes & Noble | ✅ | 7 importable, 1 cancelled skipped, **4 are preorders** |
| BackerKit acct 1 | ✅ | 4 pledges + 28 survey entries |
| Indiegogo | ✅ | Space Knight 5 and 6 |
| Kickstarter | ✅ | 15 pledges containing books |
| BackerKit acct 2 | ✅ | The games-heavy account. 3 books: **Words of Radiance Leatherbound** ($650, genuinely signed), **Surprise! Four Secret Novels** ($620, one line = four works), **Ascend Online Bk 1 Collector's** |
| Illumicrate | ✅ | One-off Percy Jackson set — do NOT scan the rest of that site |

⚠️ **The two BackerKit accounts and Kickstarter overlap.** *Four Secret Novels*,
*Ascend Online Book 1*, *An Unexpected Wedding Invitation* and *Coral Island*
appear in **both** the Kickstarter enumeration and BackerKit account 2 — same
pledges, campaign run on Kickstarter and fulfilled through BackerKit. Importing
both sources naively double-counts every one. The importer must match on campaign
`externalId`, and a pledge's `platform` should record where *our pledge* lives
separately from where the survey lives.

⚠️ **The BackerKit trap:** the Pledges tab showed 4 items; the Surveys tab showed
28. *Ascend Online* appears only under Surveys. Any BackerKit scan must read
`/c/users/active_projects` under **all three** filters, not just `/c/users/pledges`.

### Classification rules the user set

- **RPG and D&D material → board game catalog**, even bound hardcovers.
- **Graphic novels → library, but tagged.**
- **Audiobooks → not catalogued here.** Record that a pledge included one.
- **Mixed pledges must be split**, never collapsed.

### Shapes the model has to survive

One pledge routinely delivers ebook + print + audiobook. One line item can cover
several works ("Collector's Edition Trilogy" is three books). Signed/numbered
arrives as reward *prose*, not a field. High-value pledges are mostly
accessories — Primal Hunter is 1 book and ~23 pins, standees and plushies. Some
accessories are digital.

---

---

## Details queue emptied — 2026-08-10

**224 works · 3 still holding a gap · 0 findings pending.** Two passes, on branch
`feature/apply-pending-findings`.

| | Pass | Cost |
|---|---|---|
| ✅ | **162 findings that predate auto-apply, applied.** 61 works. Already bought and paid for by 61 past runs and simply never written down — this is what the owner was hand-clicking "use it" on. `scripts/apply-pending-findings.mjs` | **$0.00** |
| ✅ | **69 lookups run to clear what was left.** `scripts/research-queue.mjs`, 0 failed | **$1.11** (estimated $1.41) |

Research has now cost **$6.06** over 301 runs. Tokens only — Anthropic bills its
server-side web searches separately.

⚠️ **The count went UP before it went down, and that is the pipeline working.**
After the backlog landed, the queue read *66 works / 78 questions* — more
questions than before, of which **57 were volume numbers**. Filling in 32 series
names is what created them: `detailFieldsFor` refuses to ask "which volume is
this?" of a book with no series, so the question does not exist until the series
is known. The queue got **longer in count and shorter in kind**. Do not "fix" a
rising number here without reading which field it is in.

⚠️ **The page's own bulk button cannot finish this job**, and its count is
misleading rather than wrong. `outstanding` filters on `runs[workId] === undefined`
and `runs` is `latestRuns` — one row per work *ever* looked up. With 66 works
still owing an answer it offered **"Look up 5"**. The other 61 had been looked up
weeks earlier, before they had a series to be a volume of. The per-row button
reaches them; the script is that, unattended.

**Three works could not be identified and are deliberately left open** — the model
declined rather than guess, which is the behaviour we want: #141 *Touch and
Explore* (Scholastic), #160 *Bizzy Bear* (Nosy Crow), #174 *I love you, little
bear* (Judi Abbot). All three are bare series-line titles with no subtitle, ISBN
or year, where any match would attach another book's facts. Fix by adding the
subtitle, not by re-running.

**Everything is machine-decided and reversible.** All 311 values carry
`decided_how = 'auto'`, so `GET /api/research/auto-applied` lists them and
`POST /api/research/undo` takes them back, ten at a time. Nothing a person had
asserted was touched: `applyFinding` writes only into blanks, and the 162-finding
pass additionally refused any finding whose work+field already carried a
human verdict (zero did).

### Two things found by running it

- ⚠️ **`updateWork` rewrites `sort_title`, `primary_author` and `work_key` from
  title/authors on *every* update**, whatever the patch asked for. So a stored
  value that has drifted gets silently corrected by a write that only meant to
  fill in a year. Measured across all 224 works: `sort_title` disagreed on **5**
  (works 224–228, the crowdfunding-import ones, which kept their leading article
  and sort under "The"); `primary_author` and `work_key` disagreed on **none**.
  The five are now corrected. **`work_key` drifting would be the serious one** —
  it is the join to 860 audiobook reviews, so a silent rewrite moves a book's
  reviews instead of failing visibly.
- ⚠️ **Two books in one series ended up with two different series names.** #213
  *Secret Ingredient* is "The Pengrooms" vol 2; #215 *Pengrooms* is "Pringle &
  Finn" vol 1. Both findings cite a real source (the author's Kickstarter, and
  Goodreads' series page) and both are plausible — Paul Castle's series is
  indexed under both names. They cannot both be right in one catalog. Needs a
  person to pick one.

Every volume number written as a *value* (15 of them) carries a source URL and a
basis that names the page. None hedge. Checked on purpose: a wrong volume number
is worse than a blank, because a filled column is never re-asked.

---

---

## Browser verification sweep — 2026-08-10

The first real browser pass over everything five agent branches shipped. **Zero
console errors** across every screen. Verdicts:

**Works:** scan picker and its four tabs · queue newest-first · duplicate,
unresolved-barcode and SKU rows · Editions panel with two-click delete ·
accessories (23 rows with kind chips, quantity, DIGITAL tag) · crowdfunding
provenance · `WorkFields` in-place editing · series list search/sort/gaps ·
"Bought more than once" · Edition and Print/Ebook filters with recomputing
counts · details-queue auto-apply with per-row and bulk undo · Drive links
correct in both directions.

**Two correctness bugs found and fixed** (`6344cc4`, deployed `95af9fbd`):

1. ⚠️ **The series page asserted audio it had only guessed at.** Tamer read
   *"All 5 held as ebooks and on audio"* when all five matched the same generic
   series-level row by containment. The per-rung chip *does* hedge with a `?`,
   but that chip is suppressed when every rung agrees — and folding
   `matchedVia` away in `signatureOf` is what made them agree. Both the chip and
   the sentence were individually correct, which is why only a browser caught it.
2. ⚠️ **"All N held…" overstated.** The count came from the whole series while
   the signature behind it came from ladder rungs only, which exclude wishlist
   entries and off-number-line works. *The Completionist Chronicles* said "All 4
   … on audio" while the series list said 3. Now gated on the counts agreeing.

Also corrected: the "Type a title" blurb promised *"Looks the rest up as you
type"* over a tab that makes no such request, and contradicted itself by
promising "no code" when the only lookup offered is by ISBN.

**Still open from the sweep:**
- ⚠️ **Mobile is UNVERIFIED and cannot currently be verified.** `resize_window`
  returns `Successfully resized … to 390x844` and the viewport does not move —
  `read_page` reports it unchanged every time. Two separate agents hit this.
  **Distrust any mobile verdict from this tooling.**
- The route is **`/add`, not `/scan`**.
- Per-rung Print/Ebook/Audio chips have never actually rendered — every series
  in production has a uniform ladder, so they are suppressed by design.
- The preorder tag has never rendered either: zero preordered and zero wanted
  copies exist. It will first appear when the 4 B&N preorders are imported.
- Cosmetic: two stacked "Cancel" buttons in the accessories panel; an
  `UNCLASSIFIED` chip that is accurate but the only jargon in an otherwise
  plain-English panel.

---

## ✅ An omnibus is not an edition — done 2026-08-11, three parts

The user was holding off scanning any book that would hit the omnibus/duplicate
case — *"we're waiting to scan books that will meet this criteria until we
decide"* — so this was blocking real work, not tidying.

**One badge was answering three different questions.** Do I own the same
*object* twice (`copy`), the same *book* in two printings (`edition`), or the
same *text* via a bundle (two works and a `contains`)? Three tables, one badge.

### 1. ✅ The duplicate badge counts COPIES now

"Bought more than once" → **"Owned more than once"**, and the rule is 2+ copies
in `HELD_STATUSES`. `ownedMoreThanOnce` in `packages/core/src/holdings.ts`, with
tests; `boughtTwice()` in `@lc/db` is deleted.

⚠️ **Measured before changing it: the badge was firing on scan artifacts, and
nothing in the catalog is genuinely owned twice today.** *Dinosaur Dance!* is one
board book recorded twice by two scan paths; *Pout-Pout Fish* and *Grinch* have
two real ISBNs each and **zero copies**. The five ebook+hardcover works were
already excluded and stay excluded. Full table in
`docs/info/series-formats-and-audiobooks.md` §3.

The section therefore renders for **no series** until a real second copy exists.
That is the honest answer and not a regression.

### 2. ✅ White Sand: the omnibus fact recorded, no volumes invented

Migration **0060** adds `edition.collects` — *what is printed inside this
object*. `scripts/backfill-omnibus-collects.mjs` (dry-run by default) sets
edition 206 to `Volumes 1-3` and edition 107 to `Volume 1`, matched on the
edition name rather than the id.

⚠️ **No works and no `work_relation` rows were created, deliberately.** White
Sand's three volumes are not rows in this catalog, and minting them means
guessing three titles — `POST /api/works` does not dedupe, so a guessed title is
a *permanent* duplicate that collects its own copies and reviews. The honest
statement ("this printing has volumes 1-3 in it") is recorded now; the statement
that needs two rows waits until there are two rows, at which point the Related
panel makes it one tap. `edition_name` is untouched; the Editions panel now shows
and edits a **Contains** field beside it.

0050 predicted this exactly: *"If that axis is ever wanted it is a new column,
not a new value here."* 0060 is that column.

### 3. ✅ The overlap warning fires AT SCAN TIME

`work_relation.contains` is no longer display-only. Every scan line carries an
`overlap`, and the review screen raises **the prompt it already had for
duplicates** — one more reason, not a second mechanism:

- scan a volume whose omnibus is held → *"You already own this inside …"*
- scan the omnibus of a held volume → *"This collects …, which you already own."*

⚠️ **It does not block.** Same buttons as before: *Add* / *Add 2nd copy* /
*Leave it*. Owning volume 1 and the omnibus on purpose is a real choice.

Costs **one query** while `work_relation` is empty (which it is), because the
index short-circuits. Wishes are excluded — a wished-for omnibus produces no
warning. Both directions verified through a running Worker against a fixture.

---

## 📦 The old `HANDOFF.md`, archived whole — 2026-08-16

⚠️ **Archived because it had become actively wrong, not merely old.** Dated
2026-08-10, it stated that the series/formats/audiobook work was *"committed,
**not deployed** and migration 0010 has NOT been applied to `--remote`"*, and
listed six branches as 🟡 in flight.

**Measured 2026-08-16 before replacing it:**

| Claim in the old handoff | Measured reality |
|---|---|
| migration 0010 not applied remotely | `wrangler d1 migrations list --remote` → **"No migrations to apply!"** — every migration is applied |
| the work is not deployed | `library.heygabi.ai/api/health` → `ok:true`, `database:up`, 16 universes |
| six feature branches in flight | `main` is **363–373 commits ahead** of all of them; four are fully merged, and three retain only 1–3 commits |

That is the stale-measurement trap in document form: every line was true when
written and false when read, and a session reading it first — as `CLAUDE.md`
instructs — would have believed production was six days behind. It is kept
here **whole and unedited** because the reasoning inside it is still the record
of how each feature was designed and what was deliberately left out.

<details>
<summary>The full 2026-08-10 handoff, verbatim</summary>

> # Handoff
>
> > Updated **2026-08-10**. **Live** at https://library.heygabi.ai — deployed,
> > Firebase domain authorised, Google sign-in verified in production 2026-08-09.
>
> ## 🟡 In flight — series formats, alternate printings, audiobooks
>
> Built in a worktree, committed, **not deployed and migration 0010 has NOT been
> applied to `--remote`.** The owner gates production.
>
> The complaint this answers: the Series tab "is useful but jarring and will get
> out of control super fast". So the series stuff moved *into* each series, and the
> list learned to scale.
>
> | | |
> |---|---|
> | **Formats on the ladder** | Each held rung says whether we have it in print, as an ebook, on audio, or several at once. |
> | **Owned more than once** | A second section per series: one volume, two or more **copies** on the shelf. ⚠️ Renamed and re-pointed from editions to copies on 2026-08-11. |
> | **Audiobook cross-reference** | `audiobook_holding` (**migration 0010**) + `npm run backfill:audiobooks`. **40 of 157 works, 25%.** |
> | **A list that scales** | Search, four sort orders, gaps-only, a holdings line per row — all three controls in the URL. |
>
> Everything measured is in
> [`docs/info/series-formats-and-audiobooks.md`](info/series-formats-and-audiobooks.md).
> The four worth knowing without opening it:
>
> - ⚠️ **25% is the honest audiobook number and the ceiling is nowhere near 100.**
>   ~35 misses are children's board books with no audiobook in existence, 38 are
>   fan-translated light novels (*Blade Dance*, *High School DxD*) with no English
>   audio. **The one group worth chasing is Cradle** — 12 works whose audiobooks
>   really are owned, and the fix is aliases, not a looser matcher.
> - ⚠️ **Our `work_alias` rows are what lifted it from 35 to 40.** The five added
>   are the *He Who Fights with Monsters* volumes, which Audible files under
>   Shirtaloon. `matching.ts`'s author gate rejects them under the printed name and
>   is right to; asking a second time under a recorded pen name is the fix.
> - ⚠️ **Every physical edition in the catalog is on a work with no series** (39 of
>   156, all children's board books), so every series page today is uniformly
>   ebook. The page therefore says "All 23 held as ebooks" **once** instead of
>   stamping 23 identical chips. It is not a bug that the chips are absent; they
>   appear the moment one volume differs, which the BackerKit import will do.
> - ⚠️ ~~**"Bought more than once" means two printings of ONE medium.**~~
>   **SUPERSEDED 2026-08-11.** That was the second of three rules and it was also
>   wrong: measured against production, all three books it named were scan
>   artifacts rather than purchases. The section is now **"Owned more than once"**
>   and counts held **copies** — `ownedMoreThanOnce` in `@lc/core`, with tests. Do
>   not restore an edition-based rule; `docs/info/series-formats-and-audiobooks.md`
>   §3 carries the measurement.
>
> ### To finish it
>
> ```bash
> npm install                                   # ⚠️ IN THE WORKTREE — see below
> npm test                                      # 95
> npm run typecheck                             # six workspaces
> npm run db:migrate                            # ⚠️ REMOTE — 0010, BEFORE deploying
> npm run deploy
> npm run backfill:audiobooks -- --remote           # dry run; READ THE CONTAINMENT LIST
> npm run backfill:audiobooks -- --remote --commit  # ⚠️ owner gates this
> ```
>
> ⚠️ **Migrate before deploying.** `/api/series` now selects from
> `audiobook_holding`; deploying first makes **every** series request a 500 — the
> list and every detail page. Migrations 0003 and 0005 each carried this trap.
>
> ⚠️ **`npm install` inside a worktree, before trusting a typecheck.** A worktree
> has no `node_modules`, and Node resolution walks *up* — so `@lc/core` silently
> resolves to the **main checkout's** copy. On 2026-08-10 a typecheck in a worktree
> reported errors in `PeoplePage.tsx` from a different session's uncommitted work,
> and would equally have missed real errors in the code being written.
> `package-lock.json` is unchanged by the install.
>
> ⚠️ **`LC_AUDIOBOOK_ROOT` is required from a worktree.**
> `scripts/lib/audiobooks.mjs` resolves `ROOT/../audiobook_catalog`, which under
> `.claude/worktrees/<name>` is three directories too deep, and a zero-row read
> looks exactly like "the sibling catalog knows nothing". The backfill now refuses
> to run on zero rows rather than marking every holding stale.
>
> ## 🟡 In flight — `feature/aliases-export-people`
>
> Three features, branched from `main` **on top of `feature/router`'s merge**,
> committed and pushed. **Not deployed, not merged, and migration 0005 has NOT
> been applied to `--remote`.** The owner gates production.
>
> | | |
> |---|---|
> | **`work_alias` write path** | The table has existed since migration 0001 with **nothing writing to it**. Now: a `kind` column, an API, a panel on the book page, and three readers. **Measured 45 → 50 of 116 Open Library ids** against production rows, read-only. |
> | **Export** | `/api/export.json` (twelve tables, the backup) and `/api/export.csv` (one row per work, for a spreadsheet), both streamed and paged. `/export` in the top bar, owner only. |
> | **People** | `/people`, owner only. Approve, promote, demote, revoke. The API already existed; this is the screen, plus a bug fix found by clicking. |
>
> Everything measured is in
> [`docs/info/aliases-export-people.md`](info/aliases-export-people.md).
> The four worth knowing without opening it:
>
> - ⚠️ **The pen name alone did NOT fix the five HWFWM works.** There were two
>   blockers, not one: Open Library files them under **Shirtaloon**, *and* the
>   stored title's `: A LitRPG Adventure` makes the fielded query return zero even
>   under the right author. Each of the five needs **two** aliases — an author one
>   and a short-title one. Widening `cleanAudiobookTitle` instead is what
>   `matching.ts`'s header forbids.
> - ⚠️ **A changed alias set re-opens a settled ledger entry with no flag** — which
>   is what makes the feature work at all, and is also a trap in reverse: running
>   the backfill against a database *without* these alias rows will re-ask the five
>   and overwrite the matches with `not_found`. **Migrate and re-enter the aliases
>   before re-running `--remote`.**
> - ⚠️ **Export downloads are fetch-and-Blob, not `<a download>`.** A plain anchor
>   sends no Bearer token; it works perfectly against the local dev bypass and
>   401s the moment it is deployed.
> - ⚠️ **An owner stepping down used to see "forbidden" and a stale list** — the
>   PATCH succeeded and the refetch 403'd. Fixed; the app now re-reads `/api/me`
>   and returns to the collection.
> ## 🟡 In flight — `feature/scanjobs-vision`
>
> Two features, in the order they had to be built. Branched from `feature/router`,
> committed and pushed, **not deployed, not merged, and not migrated against
> `--remote`.**
>
> **`scan_job` persistence.** The table shipped in migration 0001 with 0 rows and
> no route touching it; `ScanPage` kept results in React state, so a phone locking
> mid-sweep lost the sweep. There is now `/api/scan-jobs`, a `ScanLine` shape both
> producers share, `?job=<id>` in the URL, and a `/scans` queue of what you left
> half-finished. A barcode sweep is **one** job with N lines.
>
> **Phase 4 — the shelf photograph.** `POST /api/scan-jobs/shelf` sends one frame
> to `claude-opus-5` at low effort with a JSON-schema output contract, matches the
> result against the catalog for free, and lands the job at `review`. Persistence
> went first deliberately: a barcode is free to re-scan and a photograph is not.
>
> ⚠️ **Read [`docs/info/scan-jobs-and-vision.md`](info/scan-jobs-and-vision.md)
> before quoting any hit rate.** The headline — 28 of ~30 spines correct with
> nothing invented — is from a real photograph of an *easy* shelf (English-
> language manga, straight on, well lit). A real cluttered shelf did much worse.
> **No photo of this household's own shelves has ever been tested**, and that is
> the number that matters.
>
> | | |
> |---|---|
> | Cost | **3–7¢** per shelf, shown on screen. The unreadable path costs 1¢ |
> | Photos | **Never stored.** No binding this path can reach, and there must not be one. ⚠️ The optional `COVERS` bucket (migration 0040) is for book covers and is not it |
> | Writes | **None.** Every line is a proposal; `addedWorkId` records that a person pressed Add |
> | Gate | `runResearch`, not `scan` — the tab is hidden from anyone who cannot spend |
> ## 🟡 In flight — `feature/research-details`
>
> Phase 5's **research** half, plus the details queue that decides what research is
> for. Branched from `feature/router`, committed and pushed, **not deployed, not
> merged, and migration 0005 has NOT been applied to production.**
>
> ⚠️ **The index half of phase 5 is a different project.** `index.heygabi.ai` is a
> cross-format view over three catalogues with its own host; nothing here touches
> it.
>
> Everything measured is in
> [`docs/info/research-and-gaps.md`](info/research-and-gaps.md). The four things
> worth knowing without opening it:
>
> - **The queue is a tally first and a list second.** Against production, *every*
>   work is missing its year and its description, so a list of 116 rows saying the
>   same two words carries no information. The per-field tally does, and it is
>   where the thirteen answered series show up as work already done:
>
>   | Question | To ask | Answered | Recorded | N/A |
>   |---|---|---|---|---|
>   | first published | **116** | — | — | — |
>   | series | **0** | **13** (11 none, 2 unknown) | 103 | — |
>   | volume number | **10** | — | 93 | 13 |
>   | description | **116** | — | — | — |
>
> - **`gap_verdict` (migration 0005) is the point of the feature.** A blank column
>   means "nobody looked", "there is genuinely none", or "nobody knows", and only
>   the first is a gap. The 13 series answers researched by hand on 2026-08-10 come
>   across from `series-overrides.json` with `npm run seed:verdicts`.
> - **Nothing auto-applies, and there is no confidence score anywhere.** The
>   finding shows its value, its source and a one-sentence basis, and a person
>   presses Use. §4.4/§4.5 of `isbn-ladder.md` is why: a wrong book scored 1.00 on
>   title *and* author, twice.
> - ⚠️ **The paid call has never run.** No `ANTHROPIC_API_KEY` exists on this
>   machine, so `research_run` still holds 0 rows and every cost figure is an
>   estimate from list pricing. Everything else — review, accept, reject, verdicts,
>   the 503 with no key — was driven in a browser.
>
> ### To finish it
>
> ```bash
> npm test                                    # 72
> npm run typecheck                           # five workspaces
> npm run db:migrate                          # ⚠️ REMOTE — 0005, BEFORE deploying
> npm run deploy
> # then, in the app, re-enter the ten aliases on the five HWFWM works
> npm run backfill:openlibrary-ids -- --remote            # dry run; expect 50/116
> npm run backfill:openlibrary-ids -- --remote --commit   # ⚠️ owner gates this
> ```
>
> ⚠️ **Migrate before deploying.** `/api/works/:id/aliases` and the export both
> select `work_alias.kind`; deploying first makes every book page's alias panel a
> 500.
>
> ### Deliberately left out
>
> - ***White Sand* has no alias.** The mechanism exists; deciding what Sanderson's
>   credit should be on a work whose `authors` is "Julius Gopez Rik Hoskin" is the
>   owner's call, not a script's.
> - **No bulk alias seeding**, and no `openlibrary`-sourced aliases. `alias_check`
>   is still an unused table — nothing has ever asked Open Library "what else is
>   this called".
> - **No import to match the export.** The JSON is shaped to be re-importable
>   (tables in dependency order, migration list stamped) but nothing reads it back.
> - **The multi-user test used seeded rows.** The dev bypass hardcodes
>   `firebase_uid = 'dev-uid'`, which is `UNIQUE`, so a second local identity 500s
>   on the constraint. Pre-existing and dev-only.
> npm test                       # 74
> npm run typecheck              # five workspaces
> npm run db:migrate             # ⚠️ REMOTE — 0007, BEFORE deploying
> npm run secrets:push           # ANTHROPIC_API_KEY must be in production
> npm run deploy
> ```
>
> ⚠️ **Migrate before deploying.** `/api/scan-jobs` writes `created_by` and
> `updated_at`, which production does not have; deploying first makes every scan a
> 500. ⚠️ **`ANTHROPIC_API_KEY` must be pushed**, or the photo tab answers with a
> configuration message — deliberately worded so nobody goes looking at their
> lighting.
>
> ### What was deliberately left out
>
> - **No server-side chunked enrichment.** The sibling project's `waitUntil`
>   machinery is not copied; lookups are one line at a time, client-driven. §3 of
>   the info doc has the two book-specific reasons.
> - **No `alsoInAudio`.** The Worker holds no audiobook data, so the field would
>   have answered `false` for every book in the house. Waiting on the shared index.
> - **No retry-without-volume-number lookup rung.** Measured: `Nodame Cantabile
>   12` finds nothing usable where the bare series name likely would. Named in the
>   info doc as the fix if anyone wants it.
> - **iOS untested**, and every measured photo went through the file picker rather
>   than a live camera frame.
> npm test                            # 77
> npm run typecheck                   # ⚠️ SIX workspaces now — packages/research is new
> npm run db:migrate:local
> npm run seed:verdicts               # dry run, local
> npm run seed:verdicts -- --commit
>
> # production, owner-gated, in this order:
> npm run db:migrate                  # ⚠️ REMOTE — 0005, BEFORE deploying
> npm run deploy
> npm run seed:verdicts -- --remote            # dry run: expect 13 matched
> npm run seed:verdicts -- --remote --commit
> npm run secret ANTHROPIC_API_KEY             # or put it in .dev.vars + npm run secrets:push
> ```
>
> ⚠️ **Migrate before deploying.** `/api/research/queue` reads `gap_verdict`;
> deploying first makes every request to it a 500.
>
> ⚠️ **Do the free rung before paying for years.** The EPUB files already carry
> **108 four-digit `dc:date` years** and `scripts/lib/epub.mjs` already returns
> them — see `research-and-gaps.md` §6. Buying a model's answer for a year sitting
> in a file on disk is the most expensive way to learn it. That rung is *not* built
> here; it is the obvious next piece of work.
>
> ## 🟡 In flight — `feature/router`
>
> Real URLs and a working Back button. Branched from `main`, committed and pushed,
> **not deployed and not merged** — the owner gates production, and seven more
> features land on top of this one.
>
> The problem it fixes: navigation was `useState<Screen>` with no history
> integration, so an installed PWA **exited the app** when the phone's Back button
> was pressed, and nothing was linkable. There is now a hand-rolled router at
> `apps/web/src/router.tsx` — `pushState`, one `popstate` listener, `<Link>`,
> `useRoute()`, and **no `react-router` dependency**, ported from the sibling Board
> Game Catalog.
>
> `docs/info/routing.md` has the route table, the four traps and the verification
> log. The two worth knowing without opening it:
>
> - **`navigate` pushes, `replaceUrl` replaces and fires no popstate.** Collapsing
>   them puts one history entry per keystroke of the live search box.
> - **No worker change was needed.** The `notFound` handler already served
>   `index.html` for non-`/api` paths; deep links and hard refreshes were verified
>   against the built assets, not reasoned about.
>
> Every later screen adds a case to `Screens` in `App.tsx` and a branch in
> `parse()`. Do that rather than reaching for a routing library.
>
> ### To finish it
>
> - Nothing outstanding on the branch. `npm test` 66 green, typecheck clean across
>   five workspaces, driven in a browser end to end.
> - Merge and deploy are the owner's call.
>
> ## 🟡 In flight — `feature/completeness-wishlist-relations`
>
> Three features, built and driven in a browser against a local worker, **not
> deployed and not migrated against `--remote`**. The owner gates production.
>
> | | |
> |---|---|
> | **Series completeness** | `/api/series`, a Series screen and a per-series ladder. 15 of 25 series have a gap: **7 interior**, **69 earlier**, **12 on a source's word**. |
> | **Wishlist** | `copy.status = 'wanted'` is reachable at last — it was an unusable column with 0 rows. A Wishlist screen, a Copies panel, promotion by PATCH. |
> | **Related books** | `work_relation`: same universe / companion / contains / precedes. Hand-entered; two of the four are directional. |
>
> Everything measured is in
> [`docs/info/completeness-wishlist-relations.md`](info/completeness-wishlist-relations.md).
> **Read §2.3 before touching the wishlist** — two bugs there were found only by
> clicking, and both come from `work` meaning "the catalog knows this book" rather
> than "we have it".
>
> ### To finish it
>
> ```bash
> npm test                                            # 63
> npm run typecheck                                   # five workspaces
> npm run db:migrate                                  # ⚠️ REMOTE — 0003 + 0004, BEFORE deploying
> npm run deploy
> npm run backfill:series-volumes -- --remote         # dry run, READ THE PER-SERIES LINES
> npm run backfill:series-volumes -- --remote --commit
> ```
>
> ⚠️ **Migrate before deploying.** `/api/series` queries three tables production
> does not have; deploying first makes every series request a 500.
>
> ### What was deliberately left out
>
> - **No Open Library rung for series volumes.** The right endpoint is known
>   (`/works/<key>/editions.json`, §3.1 of `covers-and-series.md`) and
>   `series_volume.source` already allows `'openlibrary'` — but **no work here has
>   an `openlibrary_work_id`**, so the rung has nothing to call with.
>   **↳ Unblocked on `feature/openlibrary-ids`**, measured but not written: 35 of
>   116 works now have a corroborated id, including **11 of 12 Cradle volumes**,
>   the series the sibling catalog has never heard of. See the section below.
> - **No "% complete" bar.** A percentage needs a denominator, and 24 of 25 series
>   have none. It would be inventing the number it displays.
> - **No bulk relation seeding.** Three Cosmere links and one omnibus link were
>   entered by hand while testing; the rest is the owner's to enter.
> - **The wanted→owned promotion does not create an edition.** Deliberate, and
>   load-bearing — see §2.3.
>
> ## 🟡 In flight — `feature/openlibrary-ids`
>
> `work.openlibrary_work_id` was **0 of 116**. A dry run against **production,
> read-only** on 2026-08-10 resolved **35** of them with corroboration beyond
> title+author. **Nothing has been written to any database, local or remote** —
> the owner gates it.
>
> | | |
> |---|---|
> | matched, corroborated | **35 (30%)** — 16 via an ISBN inside the EPUB, 19 via fielded search |
> | searched, **not found** | **68 (59%)** — 66 of them returned zero results; the light-novel and Kindle-native half |
> | **outliers for hand review** | **13** — all named, each with a candidate id, in `scripts/openlibrary-ids.json` |
>
> Everything measured, including the ten Open Library duplicate-record cases and
> the matches refused despite a **1.0 title and 1.0 author** score, is in
> [`docs/info/openlibrary-ids.md`](info/openlibrary-ids.md). **Read §6 before
> touching the outliers** — seven of the thirteen are one question about
> fan-translated light novels, not seven questions.
>
> ### To finish it
>
> ```bash
> npm test                                                   # 63
> npm run typecheck                                          # five workspaces
> npm run backfill:openlibrary-ids -- --remote               # dry run; READ THE OUTLIER LIST
> npm run backfill:openlibrary-ids -- --remote --commit      # ⚠️ owner gates this
> ```
>
> No migration and no deploy are needed: the column, its unique partial index and
> `series_volume.source = 'openlibrary'` have all existed since migrations 0001 and
> 0003. Nothing in the Worker or the web app reads the column yet.
>
> ⚠️ **`scripts/openlibrary-ids.json` is the ledger and it is tracked.** It records
> "searched, Open Library has nothing" separately from "nobody has looked", so a
> re-run makes **zero** network calls. Delete it and the next run re-asks
> openlibrary.org ~300 times for answers it already had.
>
> ## ✅ Shipped and live — covers, series, sorting, filters, Drive links
>
> All merged to `main`, deployed, and **applied to production D1 on 2026-08-10**.
> Measured against the remote database after the run, not assumed:
>
> | | |
> |---|---|
> | Works | **117** |
> | With a cover | **115** (2 have none: *White Sand*, whose EPUB carries no cover, and a picture book) |
> | With a series | **104**, across **25** distinct series |
> | Left without a series **on purpose** | **13** — 11 researched true standalones and 2 genuinely unknown. See `info/covers-and-series.md` §3.1 |
>
> Series arrived in two passes: 80 from the automatic ladder (65 from the book's
> own `dc:title`, 15 from the audiobook catalog), then 24 from
> `scripts/series-overrides.json`.
>
> ### ⚠️ Deploy order — the handoff used to say the opposite, and it was wrong
>
> The original instruction here was backfill first, then deploy. **Do it the other
> way round.** Cover URLs point at `/covers/*.jpg`, which exist only in the
> deployed assets, so backfilling first opens a window where every cover is a
> broken image. Deploying first is a strict improvement: the images sit there with
> nothing referencing them and the page looks exactly as it did, then the backfill
> makes them appear at once. **Zero gap, rather than a managed one.**
>
> ```bash
> npm run deploy                                   # 1. images + UI first
> npm run backfill:covers -- --remote              # 2. dry run, READ THE OUTPUT
> npm run backfill:covers -- --remote --commit
> npm run backfill:series -- --remote
> npm run backfill:series -- --remote --commit
> ```
>
> ⚠️ A cover filename is a hash of `work_key`, **not** of the image bytes, so
> correcting a title mints a new filename. Two BtDEM books hit this — their images
> were extracted after the deploy and had to be committed and shipped in a second
> pass. If a cover renders as a title card, check the file exists in
> `apps/web/public/covers` before suspecting the database.
>
> ## State in one paragraph
>
> The app works. Five workspaces typecheck, 40 tests pass, both migrations apply,
> and the whole thing has been driven end to end in a browser: sign in, browse the
> collection, open a book, set read-state, scan or type an ISBN and resolve it
> against live Open Library, enrich a hand-added book, and write a review that
> lands in the same Firestore collection the audiobook site uses. **What has not
> happened: no ebook container has ever run, and the review backfill has not been
> committed.**
>
> Sign-in is verified in production against a real Google token, and ownership is
> claimed: `app_user` id 1, `nbaslamking@gmail.com`, `review_name` "Skylar" —
> which matches the `…_skylar` document ids the existing audiobook reviews already
> use, so the two sites' reviews are the same documents. The production collection
> holds 117 works and 117 editions, all ebooks imported from
> `audiobook_catalog/site/ebooks.json`.
>
> ## Done
>
> | | |
> |---|---|
> | **Phase 0 — verify** | ✅ Live calls. `docs/info/isbn-ladder.md`. Two of the design's assumptions were wrong. |
> | **Phase 1 — scaffold + manual** | ✅ Worker + D1 + Firebase auth + React PWA. Works, editions, copies, read-state, collection, work page. |
> | **Phase 2 — ISBN scan** | ✅ Ladder, book-barcode gate, continuous-scan screen, manual entry, per-row Add, covers. **Now persisted** — see `feature/scanjobs-vision`. |
> | **Phase 4 — shelf photo** | 🟡 **Built on `feature/scanjobs-vision`, not deployed.** Vision read + catalog match + per-line lookup, 3–7¢ a shelf. `docs/info/scan-jobs-and-vision.md`. |
> | **Shared identity** | ✅ Firebase Google SSO on the `audiobook-catalog` project, joined on email. |
> | **Review bridge** | ✅ `workKey`, draft endpoint, Firestore client, review UI, backfill script. **Backfill dry-run only.** |
> | **Open Library enrichment** | ✅ Proposes candidates with match scores; never auto-applies. |
> | **Phase 5 — research** | 🟡 **Built on `feature/research-details`, not deployed and not migrated remotely.** Details queue, `gap_verdict`, one Claude call per book, propose/accept. The paid call has never run. `info/research-and-gaps.md`. |
> | **Covers, series, sorting, Drive** | 🟡 **Built on `feature/library-parity`, not deployed.** 114/115 covers, 101/115 series (78 automatic + 23 from series-overrides.json, local only), server-side sort and filters, Drive flip-out. `docs/info/covers-and-series.md`. |
> | **Phase 3 — ebook pipeline** | ⏸️ **Built, run, then paused 2026-08-09.** The books it catalogued are kept. See below. |
>
> ## Not done
>
> - Phase 5 (research + index). **Phase 4 (shelf photo) is built** — see
>   `feature/scanjobs-vision` above.
> - Phase 4 (shelf photo), and the **index** half of phase 5 — `index.heygabi.ai`,
>   a cross-format view over three catalogues, which is a separate project with its
>   own host. The **research** half is on `feature/research-details`; see the top
>   of this file.
> - `scan_job` is in the schema but no route touches it. The scan screen keeps
>   results in React state, so a phone locking mid-sweep loses them. That matters
>   much more for phase 4 — a shelf photo costs money, an ISBN is free to re-scan.
> - No series browse page. The collection can be *filtered* to one series and
>   sorted series-first, which covers most of what a browse page would, but there
>   is no page that lists the 25 series with their volume counts.
> - **13 of 117 works have no series, and that is the finished answer, not a gap.**
>   It was 37; all 37 were researched on 2026-08-10 and every answer is in
>   `scripts/series-overrides.json` with a source — 24 got a series, **11 are true
>   standalones**, 2 are genuinely unknown (*Firstborn / Defending Elysium*, a
>   bind-up whose halves belong in different places, and *Undead Knight*, which has
>   essentially no metadata anywhere). The file records all 37, because "researched,
>   no series" and "nobody has looked" are different facts and only one of them is
>   worth re-researching. See `info/covers-and-series.md` §3.1.
>   **Applied to production 2026-08-10** — 104 of 117 across 25 series.
> - **The book page is a page, not a modal.** The audiobook site opens a book in a
>   modal over the grid; this one swaps the whole screen. Settled deliberately, and
>   the reason has only got stronger: a modal that cannot be linked to or dismissed
>   with the back button is worse on a phone than a screen that can, and since
>   `feature/router` the screen has both — `/work/:id`, and Back returns to
>   wherever it was opened from.
> - **No stats page.** There is a stat strip on the collection, counted live. The
>   audiobook catalog's separate `stats.html` was not ported.
> - **Light mode was checked by forcing the tokens, not by flipping the OS.** The
>   palette renders correctly; the `prefers-color-scheme` switch itself has only
>   been exercised in dark.
> ## ⏸️ The ebook pipeline — paused, and how to bring it back
>
> Removed 2026-08-09 on the owner's call: compose file, Dockerfile, entrypoint,
> ingest watcher, companion scanner, indexer, `/api/ingest`, the
> `EBOOK_INGEST_TOKEN` secret, and the containers, images and volume.
>
> **It worked.** 83 EPUBs from the OpenAudible folders went end to end to the live
> catalog. It was paused because file acquisition — getting the Amazon books the
> owner already paid for down as files — is not something this repo solves, and a
> pipeline fed only by ebooks already loose on disk was not the library that was
> wanted. **This is expected to resume.**
>
> ### What was deliberately kept
>
> | | |
> |---|---|
> | **81 works / 83 editions** in production D1 | accurate; they are books the owner owns |
> | `edition.format` ebook values + nullable `cwa_book_id` | migration 0002 untouched, so resuming is additive |
> | `runtime/ebooks/` — the Calibre library, all 83 already ingested | gitignored, left on disk so resuming does not mean re-ingesting |
> | `OpenAudible/books` | **never touched.** That mount was read-only and the scanner copied, never moved |
>
> ### Bringing it back
>
> ```bash
> git revert <the "Remove the ebook pipeline" commit>
> npm run secret EBOOK_INGEST_TOKEN        # a new one; the old was deleted
> docker compose -f docker-compose.ebooks.yml up -d calibre-web-automated
> npm run deploy                            # re-mounts /api/ingest
> ```
>
> Then read the removed `docs/EBOOK_PIPELINE.md` out of git history first — it
> carries the four defects the first real run found, and they will all be waiting
> again. Chief among them: the entrypoint must `exec "$@"`, and the dry-run flag
> must have one name inside and outside the container.
>
> ⚠️ **If a second language ever computes `work_key` again** — the Python indexer
> did — restore `scripts/check-fold-parity.mjs` with it. It is not optional.
>
> ## ⚠️ What is left
>
> Provisioning, deployment, the Firebase domain and ownership are all done. Full
> runbook in `docs/access/cloudflare.md`; redeploying is `npm run deploy`.
>
> The one outstanding action is the backfill, which is what makes the 860 existing audiobook reviews visible
> here:
>
> ```bash
> npm run backfill:reviews                # dry run: 860 documents, 860 matched, 0 unmatched
> npm run backfill:reviews -- --commit    # writes to the LIVE reviews collection
> ```
>
> ## The findings that changed the design
>
> 1. **Anonymous Google Books is dead.** 40 calls, 40 × HTTP 429 — the shared
>    unauthenticated quota is exhausted. It needs a free API key or it is not a
>    rung at all. The design listed it as a free second rung.
> 2. **Half this library is not in Open Library.** 14/30 by title. The misses are
>    the Kindle Unlimited / Audible-native indie half. The design budgeted research
>    to fire on ~5% of rows; that number is wrong for this collection, so either
>    research fires far more often than budgeted or those rows stay hand-entered.
> 3. **A wrong answer can score 1.0.** `/api/enrich` on *Firefight* returns
>    "Firefight / Brandon Sanderson", Random House, **2001** — perfect title and
>    author similarity, and the wrong book. No threshold can catch it; only the
>    year and publisher can, which is why they are rendered beside every candidate.
>    See `docs/info/isbn-ladder.md` §4.4. **Never auto-select the top candidate.**
> 4. **The audiobook site's review key has no author in it**, and it throws its
>    Google session away immediately after sign-in. Both facts shaped the entire
>    identity design — read `docs/info/identity-and-reviews.md` §1 before touching
>    auth.
> 5. **`work_key` is computed in two languages now** — TypeScript (authoritative)
>    and Python (the ebook indexer, which runs in a container with no Node). This
>    is the shape that has already bitten this household. `npm run check:fold`
>    proves the two agree on 10 cases and **must be run after any change to
>    `normaliseTitle`, `splitAuthors`, `primaryAuthor` or `workKeyFor`.** `npm test`
>    cannot cover it.
> 6. **Reading the backfill's dry run caught a defect the counts hid.** 860/860
>    matched looked perfect; the keys it would have written were
>    `court of mist and fury part 1 of 2 dramatized adaptation …`, which no
>    paperback could match. Fixed by using the `series` column. Read the keys, not
>    the totals.
>
> ## Gotchas that will bite the next session
>
> - **⚠️ `wrangler d1 execute --file` returns a SUMMARY, not rows, on `--remote`.**
>   It hands back
>   `[{results:[{"Total queries executed":1,"Rows read":2,…}]}]` — a well-formed
>   array with a `results` array in it, so nothing throws and the caller just gets
>   one row with none of its columns. The first remote cover backfill printed
>   *"1 work(s) in the REMOTE database"* against a catalog of 117 and then died on
>   `work_key` being undefined. **Locally the same `--file` returns real rows**,
>   which is exactly why it survived a whole feature's worth of local measurement.
>   Reads go through `--command` now; `scripts/lib/d1.mjs` `query()` refuses SQL
>   over 6000 chars and throws if it ever sees a summary again. Writes still use a
>   file, correctly — a shell cannot carry 117 UPDATEs full of apostrophes.
> - **A destructive flag whose dry run does nothing looks exactly like success.**
>   `--prune` was added to `scripts/import-ebooks.mjs` and, on the first run,
>   silently did nothing without `--commit`: the import dry-run `process.exit(0)`s
>   before the prune block was reached, so it printed "DRY RUN" and skipped the
>   entire feature. Prune is a function called from both paths now. **When adding a
>   flag, run it in the mode people will try first.**
> - **Cache headers here are governed by a Cloudflare setting outside the repo.**
>   `heygabi.ai` → Caching → Configuration → **Browser Cache TTL** was `4 hours`
>   and overrode origin `Cache-Control` for every host in the zone — including
>   this one, whose hashed `/assets/*` bundles are declared `immutable` for a year
>   and were being silently cut to four hours. Now **Respect Existing Headers**. If
>   `apps/web/public/_headers` ever appears to be ignored, check that first;
>   `*.pages.dev` is outside the zone and will keep obeying `_headers`, which makes
>   the discrepancy read as a routing problem when it is not.
> - **A long checkout breaks the LOCAL D1 outright.** miniflare keeps it under
>   `apps/worker/.wrangler/state`, and on Windows a deep enough path pushes that
>   past the limit. Every local `d1 execute` then fails with a bare
>   `internal error; reference = …` — **including a plain `SELECT 1`**, which is
>   how you tell it apart from a SQL problem. Seen 2026-08-10 in a git worktree
>   under `AppData\Local\Temp\…`. Set `LC_D1_PERSIST_TO=C:/lcw` for the scripts and
>   pass `--persist-to C:/lcw` to `wrangler dev` and `d1 migrations apply`. The
>   main checkout needs neither; remote is unaffected.
> - **A backtick inside a SQL comment in `packages/db` ends the string.** The
>   queries are JavaScript template literals. It broke the Worker build once, with
>   an esbuild error pointing at the SQL rather than at the quote.
> - **`git commit -F`, never `-m`.** See `CLAUDE.md`.
> - **⚠️ `wrangler d1` dies with an opaque `internal error` when the repo path is
>   long.** A git worktree under `%TEMP%\claude\...` put the local D1 file at
>   **283 characters**, past Windows' 260-char `MAX_PATH`. `wrangler dev` is
>   unaffected — workerd is long-path-aware — so it looks like "the app runs but
>   no query or migration will ever apply", with a reference id and nothing in the
>   log. Fix: `--persist-to C:/<something short>` on `dev` **and** on
>   `d1 migrations apply`, or work from a shorter path.
> - **`wrangler dev` does not tell you the port was already taken.** Port 8792 was
>   bound by the Board Game Catalog's own dev server, so this app silently failed
>   to bind and the browser served **that application** — title, data and all. It
>   reads like a catastrophic build failure and is a port collision. Check
>   `curl -s localhost:PORT/ | grep title` first.
> - **It also silently moves on.** 2026-08-10: a killed-but-still-listening worker
>   held 8787, so the new one came up on **8791** and said so only in its startup
>   banner. Everything pointed at 8787 kept talking to the dead one. `netstat -ano
>   | grep :8787` names the process; read the "Ready on" line, do not assume 8787.
> - **The assets watcher dies on OneDrive.** `Watcher error: EPERM: operation not
>   permitted, watch` after a rebuild, and from then on `GET /` returns 404 while
>   `/api/*` keeps working — which looks exactly like a broken SPA build. Restart
>   `wrangler dev` after `npm run build`; hot reload of `apps/web/dist` cannot be
>   relied on here.
> - **A `<video>` element makes Chrome's screenshot capture hang**, not the page.
>   The scan screen looks frozen to browser automation for 10–30s after it mounts
>   while being completely responsive to a person. Do not hunt for a render loop.
> - **`packages/core` import order is load-bearing** and typecheck does not catch a
>   violation. `constants.ts` → `schemas.ts` → `index.ts`; nothing under `src/` may
>   import `index.ts`.
> - **`bookIdFromTitle` ≠ `normaliseTitle`.** The first keeps the leading article
>   and builds Firestore document ids; the second strips it and builds `work_key`.
>   Swapping them writes a duplicate review instead of updating one.
> - **`npm test` and `npm run check:fold` need tsx** (a devDependency). Node's type
>   stripping cannot resolve the `.js` specifiers the source uses.
> - **`.dev.vars` is gitignored** and holds a real Google address so the dev bypass
>   produces the right `app_user` row. Recreate from `.dev.vars.example`.
> - Local D1 is in `apps/worker/.wrangler/state` and has four test works in it.
>
> ## Verification commands
>
> ```bash
> npm run typecheck        # five workspaces
> npm test                 # 40 core-rule tests
> npm run db:migrate:local
> npm run dev              # worker :8787, web :5174
> curl -s localhost:8787/api/health
> curl -s localhost:8787/api/isbn/9780765326355   # live Open Library
>
> # The collection API, all of it new on feature/library-parity
> curl -s "localhost:8787/api/stats"
> curl -s "localhost:8787/api/collection/facets"
> curl -s "localhost:8787/api/collection?sort=author&dir=desc&pageSize=10"
> curl -s "localhost:8787/api/collection?q=cradle"      # 6 — a series-name search
>
> # Both backfills are idempotent; a second run must report nothing to write.
> npm run backfill:covers
> npm run backfill:series
> ```
>
> ⚠️ `npm run check:fold` is **gone**, and correctly: the Python indexer that made
> a second `work_key` implementation was removed with the ebook pipeline. If a
> second language ever computes `work_key` again, bring the parity check back with
> it — `packages/core/src/titles.ts` says so in its header.
>
> ## Kindle: metadata only, and the mechanism is the desktop app
>
> The owner's requirement is that buying a book should show up without waiting.
> That rules out the data export and points at **Kindle for PC's local metadata
> cache**, which updates whenever the app syncs.
>
> ⚠️ **This imports names, not files.** Kindle books are DRM protected and this
> repo does not circumvent that — the import produces `ebook_kindle` editions,
> which migration 0002 defines as *a licence with no bytes*. `EBOOK_FILE_FORMATS`
> deliberately excludes it, so nothing will ever offer to send one to a device.
>
> **No books need to be downloaded.** The sync cache lists the whole account
> library, not just downloaded titles, so signing in and letting it sync is enough
> and nothing encrypted lands on disk.
>
> Next steps, in order:
>
> 1. Owner installs Kindle for PC, signs in, lets it finish syncing.
> 2. Identify what it actually wrote. Older versions produced
>    `KindleSyncMetadataCache.xml` — ASIN, title, authors, publication date, a
>    trivial parse. **Kindle for PC 2.x reorganised its storage and the current
>    format is unverified.** Look before writing the parser.
> 3. Parse → `ebook_kindle` editions through the existing API.
>
> This does **not** depend on the paused ebook pipeline. It writes catalog rows,
> not files, so it needs no CWA, no Docker and no ingest route — a script and the
> API that is already deployed.
>
> ## Open questions
>
> | # | Question | Blocks | State |
> |---|---|---|---|
> | 1 | Kindle metadata cache on this machine? | Kindle import | ✅ **Answered 2026-08-09: Kindle for PC is NOT installed.** Proven, not assumed — no `%LOCALAPPDATA%\Amazon`, no `%APPDATA%\Amazon`, no Program Files entry, no uninstall registry key under HKLM or HKCU, no Store appx. The earlier sweep that timed out left this "likely"; a targeted PowerShell check settled it. **Installing it is the chosen path** — see below. |
> | 2 | Amazon "Request My Data" export | — | ❌ **Rejected by the owner, and rightly.** A batch export with days of latency cannot answer "I bought a book an hour ago". Superseded by the Kindle for PC cache, which is local and updates on sync. |
> | 3 | Where do loose ebook files live — disk, Drive, or both? | Phase 3 | Not investigated. |
> | 4 | Do the legacy passphrase users need Google accounts? | UX | Their reviews show up fine; they just cannot sign in here. A conversation, not a code change. |
> | 5 | Should `edition.format` gain an audiobook value once the shared index lands? | Platform | **No.** `PLATFORM.md` §2.2 says nothing merges; audiobooks stay read-only in their own catalog and meet this one through `work_key`. Recorded because it will be asked. |
>

</details>
