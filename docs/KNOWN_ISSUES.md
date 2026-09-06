# library_catalog — Known Issues, Waivers & Exceptions

> **Audience:** Claude/Kiro sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-09-06 ~14:25 UTC (W10-LIB-FLIP)** — **KI-17 was SETTLED
> by the owner** (*"No ISBN"*) and re-measured against BOTH production databases
> before anything was written: editions **670–673** unchanged on
> `library-catalog` (`Collector's Edition`, `note` NULL, every identifier NULL,
> `source 'manual'`), **absent entirely from `library-catalog-2nd`**, and all
> four still refused by `isCrowdfundedPrinting` when the three guards are run
> over their real values. **No data was changed on either instance** — the rows
> were already inert and `scripts/backfill-missing-isbns.mjs` is the only script
> that could have filled them. ⚠️ **Nothing else was re-checked in that pass** —
> KI-5 through KI-16 all still carry the ages stated below.
> Previously **2026-09-06 (W8-GUARD)** — **KI-17 was added** (the four art
> books) and measured against production `library-catalog`: editions
> **670–673** all read `edition_name = "Collector's Edition"` / `source
> 'manual'` / `isbn13` NULL, all four are skipped by `isCrowdfundedPrinting` in
> the live `--remote` dry run (32 skipped by that guard in total), and
> `change_log` row **1593** shows work 516 *Sanctuary* was promoted `standin` →
> `ok` by a **human** at 2026-08-24 22:44:43. Stand-ins across both instances:
> **0** main / **6** padhard. ⚠️ **Nothing else was re-checked in that pass** —
> KI-5 through KI-16 all still carry the ages stated below.
> Previously **2026-09-05 ~23:10 UTC (ebook phase 5 APPLIED)** — **KI-15 was
> RETIRED by its own stated end condition** and moved to the resolved table at
> the foot of this file. Phase 5 ran against production `library-catalog`: the
> 123 ebook editions it was about are deleted, and the surviving ebook-format
> rows were **re-listed one by one, not inferred** — **4 remain** (edition 318,
> `manual`, no `source_url`, always out of scope; and 486/487/488, `research`,
> on the three works the owner kept). `source='file'` now matches **0** rows, so
> the predicate the entry was about has nothing left to be wrong about.
> ⚠️ **Nothing else was re-checked in that pass** — KI-5 through KI-14 all still
> carry the ages stated below.
> Previously **2026-09-05 (ebook phase 5, pre-apply)** — **KI-15 was added** and
> measured against production `library-catalog`: 127 ebook editions, the
> `source` column split 26 `file` / 34 `openlibrary` / 55 `research` / 11
> `googlebooks` / 1 `manual`, all 127 still carrying a manifest path in
> `source_url`, and `ebook_holding` still recording `edition_source='file'` for
> 125 of 126. ⚠️ **Nothing else was re-checked in that pass** — KI-5 through
> KI-14 all still carry the ages stated below.
> Previously **2026-09-05 (docs audit)** — the docs audit re-measured **exactly
> one entry, KI-5**: three fresh probes of `bookcover.longitood.com`, all 522,
> so the rung is still down and its "still 522 in a month" clock now has a date
> (**2026-09-22**). ⚠️ **NOTHING ELSE was re-checked on 2026-09-05** — KI-6,
> KI-7, KI-9, KI-10, KI-11, KI-12 and KI-14 all still carry the ages stated
> below, and KI-7 in particular could not be checked at all because verifying it
> means reading `.dev.vars`, which an agent may not open.
> Previously **2026-09-02 (latest)** — **KI-14 was added** and measured by
> replaying the audiobook site's own search over the 1,087 cards it ships. It
> is the RESIDUE of a fix, not a new defect: the audiobook deep link now
> searches the verbatim title (824 → 886 of 1,087 books reached uniquely, and
> the one dead search closed), and a book whose title IS its series name still
> cannot be isolated at all. ⚠️ **Nothing else was re-checked then.**
> Previously **2026-09-02 (later)** — **KI-13 was CLOSED BY A FIX** the
> same day it was filed: billing phase 3 landed and deployed to both instances
> (`e7b3f6b`), and the entry moved to the resolved table below. ⚠️ **The fix
> is INERT** — `BILLING_POLICY = "off"` — so what is verified is that the field
> is now cached and read, not that a switch has ever changed an outcome here.
> Earlier that day KI-13 was added and measured by reading the code
> (`packages/estate-auth/src/gate.ts`, `apps/worker/src/middleware/auth.ts`,
> the synced `generated/seen.js`), never against the live system.
> ⚠️ **Nothing else was re-checked on 2026-09-02**: KI-5 through KI-12 all
> still carry the ages stated below.
> Previously **2026-08-26 ~16:40 Phoenix** — **KI-8 was re-measured against
> production D1 and RETIRED** (see the resolved table at the foot), and
> **KI-12 was added** and measured against the live `catalog.csv` and both
> production D1s. ⚠️ **Nothing else was re-checked on 2026-08-26** — KI-5,
> KI-6, KI-7, KI-9, KI-10 and KI-11 still carry the ages stated next.
> Previously **2026-08-23 21:00 Phoenix** — KI-7 was re-measured at that
> hour against `apps/worker/.dev.vars` and rewritten: the 15 blank covers it
> named are no longer what is blocked. KI-5 was re-measured 2026-08-23 against
> production; four entries were retired as no longer true. KI-6 was added the
> same day and measured against the repo and a LOCAL D1, not production.
> ⚠️ **KI-6 and KI-8 were NOT re-checked at 21:00**; only KI-7 was. (KI-8 was
> retired 2026-08-26 — see the resolved table.)
>
> **This file exists to stop the same non-bug being re-reported every month.**
> It holds things that ARE wrong, or look wrong, and are deliberately tolerated.
>
> - Work in flight → [`TODO.md`](TODO.md)
> - Traps you fall INTO while working → [`info/gotchas.md`](info/gotchas.md)
> - Finished work → [`DONE.md`](DONE.md)
>
> ⚠️ **A gotcha is something you *do* wrong. A known issue is something that
> *is* wrong and is tolerated.**
>
> Every entry carries **Symptom · Status · Why tolerated · What would change
> it** — the last one a NUMBER wherever it can be. Format rules:
> `catalog-platform/docs/DOCS_STANDARD.md` §5.

**Status values:** `ACCEPTED` · `WAIVED` · `BLOCKED` · `WATCHING`.

---

## KI-5 · The Bookcover API rung is down — every call 522 — `WATCHING`

**Symptom.** Rung 2.5 of the cover ladder (`bookcover.longitood.com`) answers
**HTTP 522** — a Cloudflare "origin did not respond" — to every request. Until
2026-08-22 a sweep printed this as *"no cover anywhere"*, indistinguishable from
a book no database holds.

**Measured** 2026-08-22 ~23:15 and again **2026-08-23 19:10 Phoenix**, ~20 hours
apart, on a control ISBN known to resolve elsewhere: 522 both times. It is the
host, not us and not the ISBNs.

✅ **Re-measured 2026-09-05 13:2x Phoenix (docs audit), three probes in a row on
`bookcover.longitood.com`: 522, 522, 522.** Fourteen days on from the first
reading and the host has not come back once. 🔴 **This entry's own removal
condition now has a DATE, not a feeling:** it says *"if it is still 522 in a
month, delete the rung"*, and the month runs out on **2026-09-22**. If a probe
that day is still 522, delete rung 2.5 rather than carry a step that always
fails and always has to be explained.

**Why tolerated.** It is a free third-party service with no contract, and it is
the *third* rung — Open Library and Google Books are asked first and answer for
almost everything. Nothing is broken by its absence; the ladder degrades.

**What would change it.** ⚠️ **The silent half is already fixed and that was the
real defect:** `backfill-missing-covers.mjs` now tallies rungs that could not be
asked and says so, so a run distinguishes *"asked, nothing there"* from *"never
asked"* (commit `4a52589`). Removal condition: **the control ISBN returns 200**.
If it is still 522 in a month, delete the rung rather than keep a dead one —
a ladder step that always fails is a step that always has to be explained.

---

## KI-6 · A Google Books cover can be a 4KB "COVER COMING SOON" card, and no size check catches it — `ACCEPTED`

**Symptom.** `books.google.com/books/content?...&zoom=1` answers, for a book it
has no jacket for, with **HTTP 200, `image/jpeg`, and a branded *"COVER COMING
SOON"* card**. It is a genuine 4,013-byte JPEG. It clears `verifyCoverUrl`'s
`MIN_COVER_BYTES`, it clears `check-cover-health.mjs`'s 1,000-byte floor, and it
renders on the shelf as a book whose cover is fine.

**Measured** 2026-08-23: written onto padhard work 113 *Summer in the City* by a
`--standins` sweep, and found only by **looking at the image**. Every
`books.google.com` cover on both instances was then fetched and hashed —
**25 on main, 222 on padhard, exactly 1 hit** (that one). Kiro's 2026-08-22
sweep, which took 100% of its 52 finds from Google Books, brought in **none**.

⚠️ **This is §2's 43-byte Open Library pixel with the one defence removed.** That
one was catchable by size; this one is not. The signature that works is that the
card is **byte-identical for every book**:

```
sha1  df2f2659f5047344388a855a041b671651a45d68   4013 B
```

Six other padhard Google Books covers under 6 KB were checked and are real —
**distinct hashes**. That is the cheap test: the placeholder repeats, a real
thumbnail does not.

**Why tolerated.** One hit in 247 covers, and Google Books is the rung
`resolve.ts` measures as the only one that moves the number here — dropping it
would cost far more than the defect. The hit is now `cover_status='standin'`, so
it is counted as still wanting a cover rather than silently wrong.

**What would change it.** Add the hash to `verifyCoverUrl` as a deny-list beside
`MIN_COVER_BYTES` — one constant, one comparison, and it would have refused this
write. Do it if a **second** hit ever appears; one in 247 does not yet justify
putting a magic hash in a leaf package. ⚠️ Re-run the audit after **any** bulk
Google Books write; `check-cover-health.mjs` is the WRONG instrument and will
report it clean. Full record: `info/covers-and-series.md` §0.1.

---

## KI-7 · Padhard's paid cover rung cannot run — her key is not readable from here — `BLOCKED`

**Symptom.** `backfill-missing-covers.mjs --friend --remote --llm` prints
*"ANTHROPIC_API_KEY_FRIEND_SAM is empty or absent"* and skips the paid rung, so
nothing on padhard can be put through a paid rung **on her key**.

**Measured** 2026-08-23: `apps/worker/.dev.vars` line 85 is
`ANTHROPIC_API_KEY_FRIEND_SAM = ""`. Re-measured 2026-08-23 21:00 Phoenix:
still empty.

⚠️ **The 15 blank covers this entry used to name are NOT what is blocked any
more.** The owner decided on 2026-08-23 to run them on his own key
(*"Run those 15 on MY key instead"*), and `--llm-key-from=main` exists for
exactly that — see `info/covers-and-series.md` §0.2 and `DONE.md`. The block
below is unchanged and still real: it is about anything that must be billed to
**her**, not about those 15.

**Why tolerated — it is not a fault, it is the design.** That line is a
**drop-box**: the runbook pastes a key, pipes it to
`wrangler secret put ANTHROPIC_API_KEY --env friend`, then blanks the line, so
her key can never reach an allowlist by accident. Her Worker holds it and **a
secret store cannot be read back**. ⚠️ The rung deliberately refuses to fall
back to `ANTHROPIC_API_KEY`: padhard's spend goes on HER key, and a silent
fallback would bill her catalogue to the owner.

**What would change it.** The owner pastes her key after the `=` on that line,
the run happens, the line is blanked again — `docs/access/second-instance.md`.

⚠️ **Or he takes the exception, which is now a flag rather than an edit.**
`--llm-key-from=main` moves a `--friend --llm` run onto `ANTHROPIC_API_KEY`,
names the key in the banner and says `OVERRIDE ACTIVE`. It refuses any other
value, refuses without `--llm`, and refuses without `--friend`. The **default is
unchanged** — absent the flag the rung still refuses to fall back. The same flag,
the same spelling, is on `scripts/research-queue.mjs`.

⚠️ **Do not "fix" this by editing line 85 to hold the owner's key.** That is the
silent fallback the whole entry exists to prevent, wearing a disguise. If the
owner is paying, the run says so on screen.

⚠️ Her key is not limitless either: on **2026-08-17** the friend instance's key
hit its monthly cap and three details runs errored with *"You have reached your
specified API usage limits"* (`packages/db/src/research.ts`, the
`lastAttemptAt` note). A run planned against her key should check that first.

---

## KI-9 · Containment can file two different VOLUMES as two editions — `WATCHING`

**Symptom.** `matchIndexedWorkAll` returns every row that passes the unchanged
gates, so where containment already matched the wrong volume it can now return
two of them, and the work page would call them "editions".

**Measured 2026-08-23** over the 1,026 distinct cleaned titles in
`catalog.csv`. Titles reaching more than one row: **22** with a naive
implementation, **8** after refusing to re-offer an adjudicated ambiguous fold,
**6** after `collapseAmbiguousFolds`. Those 6 are three pairs seen from both
sides:

| Pair | Verdict |
|---|---|
| *The Fellowship of the Ring* — dramatized vs standard | ✅ a genuine second edition |
| *Portal to Nova Roma* — `The Rhine, Book 3` vs `Venice` | ⚠️ two different volumes |
| *Survival in Another World…* / *Reincarnated as a Sword* — `(Light Novel)` vs not | ⚠️ two different volumes |

**Why tolerated.** ⚠️ **It is not a new defect.** `matchIndexedWork` matches one
of the very same rows today and has since containment existed; the multi-result
form turns one wrong claim into two, it does not invent the claim. And a tighter
gate here would make `matchIndexedWorkAll` refuse what `matchIndexedWork`
accepts, breaking the invariant the sweep relies on — that `lookupAll(...)[0]`
is what `lookup` would have returned.

**Affected works today: 0.** Measured against the local catalog (117 works):
no work reaches more than one edition. All six hits are Light Novel / manga
series this catalog does not hold as works.

**What would change it.** Either number moving: works reaching >1 edition rising
above 0 where the extra row is a different VOLUME, or the 6 becoming more than a
handful. The discriminator, if it is ever needed, already exists as data — both
sides state `series_index_sort` and they DISAGREE in every wrong pair above —
but spending it means accepting the invariant break, so it is a decision.

---

## KI-10 · The CREATE schemas are not `.strict()` — a stray key is silently stripped — `WATCHING`

> **Update 2026-08-24 — SHADOW SHIPPED, ENFORCE PENDING.** The strip still
> happens (unchanged, deliberately), but it is no longer silent: all three
> create routes now log a structured `would_reject` line when a body carries an
> unmodelled key, then 201 exactly as before. `shadowStrictCreate`
> (`apps/worker/src/lib/strict-shadow.ts`) is the one helper; branch
> `feature/lent-to-person`. This is the shadow rung of off → shadow → enforce —
> it MEASURES the false-positive count, it does not enforce. The `.strict()`
> flip is still pending on that count reading **0** over real traffic (see *What
> would change it*). Exercised live 2026-08-24: snake_case `person_name` on
> `POST /api/copies` logged one would-reject and still 201'd; a clean body
> logged nothing.

**Symptom.** `POST /api/copies` with an unknown key answers **201** and drops
it. Measured 2026-08-23 against a local `wrangler dev`:
`{"workId":1,"status":"lent","person_name":"Samantha"}` — note the snake_case —
created a copy with `person_name: null` and reported success. The same body
sent to `PATCH /api/copies/:id` is correctly refused with a 400 naming the key.

`createCopySchema`, `createWorkSchema` and `createEditionSchema` all lack
`.strict()`; every `update*` counterpart has it. So the split is
**updates strict, creates lenient**, consistently across all three — it is not
a one-off omission.

⚠️ **This contradicts the file's own claim.** Three schemas in
`packages/core/src/schemas.ts` carry the comment *"`.strict()` like every
schema here"*, which is not true of the creates, and `setReadStateSchema`'s
comment records exactly this failure being fixed once already: *"a client that
posts a rating here is wrong and needs to be told so — a 400 is a bug report, a
silent strip is a rating that vanishes."* The argument applies unchanged to a
create.

**Why tolerated.** Flipping it is an **enforcement change on a live write
path**, and the estate's own rule is that those roll out shadow-first, never as
a side effect of an unrelated feature. `POST /copies` has more writers than the
UI form — the wishlist ask, the scan-approve flow, the importers under
`scripts/` — and any one of them sending a stray key would start answering 400
the moment this flipped. Found while building OR-1, deliberately left alone: it
predates that work and is not made worse by it.

**What would change it.** The shadow rung above now produces the measurement
this asked for — grep the Worker logs for `[strict-shadow] would-reject` and the
count of unmodelled-key bodies over real traffic is readable rather than
assumed. When that count is **0** (across the tree's callers **and** the
importers under `scripts/`, which the shadow line names by route), flip
`.strict()` on all three creates in one commit with the reading recorded. Until
that number reads 0, the strip stays.

---

## KI-11 · We cache Google Books responses; Google's API ToS forbids it — `ACCEPTED`

**Symptom.** Rung 2 of the ISBN fill (`packages/isbn/src/resolve.ts`) calls the
Google Books API and we store the result in D1. Google's umbrella API Terms
([developers.google.com/terms](https://developers.google.com/terms), governing
Books) forbid *"permanent copies … or cached copies longer than permitted by the
cache header."* Surfaced by the 2026-08-25 metadata-API research
([`info/scan-metadata-fill-strategy.md`](info/scan-metadata-fill-strategy.md)).

**Status:** `ACCEPTED`. **Why tolerated:** private, non-commercial, single-
household catalog; the cached values are factual book metadata, not resold or
exposed publicly; re-fetching on every read defeats a catalog and hammers the
quota. **Pre-existing** — applies to the Google Books rung we already ship, not
to anything new. **What would change it:** the catalog going public/commercial,
or a Google enforcement contact → TTL the Google-sourced rows to the cache header,
or drop the rung for the free Open-Library-work / Wikidata / Hardcover rungs the
strategy doc recommends.

---

## KI-12 · Two recordings with the SAME raw title collapse to one row — `ACCEPTED`

**Symptom.** The household owns two *Isles of the Emberdark* audiobooks and
<https://library.heygabi.ai/works/4> / <https://padhard.heygabi.ai/works/348>
each show **one**. The matcher hands both back (§4.7 of
[`info/series-formats-and-audiobooks.md`](info/series-formats-and-audiobooks.md));
the second is lost on the way to storage, not in the match.

**Measured 2026-08-26** against the live `audiobook_catalog/site/catalog.csv`
and both production D1s. Rows 98 and 99 are genuinely different recordings —

| | narrator | year | cover file |
|---|---|---|---|
| row 98 | Kaleo Griffith, Jennifer Jill Araya | 2025-07-10 | `…Isles of the Emberdark - A Cosmere Novel Secret Projects, Book 5.jpg` |
| row 99 | **Brandon Sanderson** | 2025 | `…Isles_of_the_Emberdark_by_Brandon_Sanderson.png` |

— and their `title` column is **byte-identical**. `audiobook_edition_holding` is
keyed `(work_id, audio_key)` where `audio_key` is that verbatim string
(migration 0390), so the two collide: the backfill's per-edition map keeps one,
and after `--commit` each work holds exactly one row. Confirmed by query on both
instances: `work_id = 4` and `work_id = 348`, one live row each.

**Why tolerated.** ⚠️ **`audio_key` is a persisted key, and it is deliberately
the SAME string the content-warning join uses** — migration 0340's `raw_title`,
which the audiobook site and `content_warnings.json` are both keyed by. Widening
it (say `raw_title + narrator`, or the cover file) is a **migration with its own
review**, not an edit, and it would split the edition identity from the warning
identity that 0390 went out of its way to keep as one string. The visible cost
today is one missing row on two works out of 1,168 across both instances; the
book itself is linked, which is the question the owner asked.

⚠️ **Not the same as the old KI-8.** That one was the MATCHER refusing a second
edition; this one is the matcher succeeding and the STORAGE key refusing.
Anything that "fixes" this by loosening the matcher is fixing the wrong half.

**What would change it.** The owner deciding the second recording is worth a
migration — the number to weigh is how many pairs share a raw title. Measured
2026-08-26 over the 1,084-row catalog: **1 pair** (this one). Do it when that
count is more than a handful, or when he asks to see both narrators on a work
page. The ACOTAR dramatizations are NOT affected — their raw titles differ by
`(Part 1 of 2)` / `(Part 2 of 2)`, so both halves store.

⚠️ **Decided 2026-09-06 — the migration is CANCELLED until that count moves.**
`TODO.md`'s *"is a second recording of one book worth a migration?"* was closed
by the conductor under the owner's silence-takes-the-recommendation rule and
moved WHOLE to [`DONE.md`](DONE.md) (*"Closed by the conductor under the silence
rule — reversible"*, 2026-09-06). **This entry is now the only place that
decision lives, and it reverses on the number above.**

---

## KI-14 · A book whose TITLE is its SERIES name cannot be isolated on the audiobook site — `ACCEPTED`

**Symptom.** The work page's audiobook link is a **search** on the sibling
site (`#q=`, the only book anchor that site has), and for *The Wandering Inn*
it drops **14** books into the search box rather than landing on one.

**Measured 2026-09-02** by replaying that site's own `_normalize` / `_tokens` /
`matchesAll` (`audiobook_catalog/site/index.html` lines 41175–41419) over the
**1,087** cards it ships — not by reading the regexes:

| query | lands on exactly ONE book | ≥10 books | 0 books | mean |
|---|---|---|---|---|
| the cleaned `title` (before 2026-09-02) | 824 | 48 | 1 | 2.20 |
| the verbatim `raw_title` (now) | **886** | **17** | **0** | **1.74** |
| *The Wandering Inn* specifically | — | **16 → 14** | — | — |

**Why tolerated — it is not a query that can be written better.**
`_applySearch` is an **AND of SUBSTRING tests**, so a query is only as specific
as its rarest token, and every token volume 1's verbatim title has (`the`,
`wandering`, `inn,`, `book`, `1`, `-`) is also a substring of its 15 siblings'
cards. ⚠️ **A numeral can never discriminate under substring matching** — `1`
is inside `16`, inside the year `2021`, inside the duration `45:21`. No query
composed of that book's own words can exclude its siblings, and the only fields
that would (year, duration, narrator-per-volume) are not stored on this side.
The fix that shipped is the best available and is a one-way ratchet — adding
tokens can never widen a conjunction — so no book was made worse: the single
book whose match count ROSE went **0 → 1** (*A Court of Wings and Ruin (1 of 3)
[Dramatized Adaptation]…* cleans to a string no card contains, i.e. its link
was a **dead search**).

**What would change it.** ⚠️ **An anchor on the OTHER side, not a cleverer
query here.** `_parseHash` reads exactly two keys, `q` and `p`; if it grew a
third — an id read as `bookIdFromTitle(raw_title)`, the slug both catalogs
already agree on (`packages/core/src/reviews.ts`, and that site's own review
documents are keyed by it) — this side would change one line of
`audiobookDetailUrl` and land on the book exactly. **The number to watch is the
17 books whose link still opens a wall of ten or more**; at 17 of 1,087 (1.6%)
a cross-repo change to a site this catalog does not own is not worth it. Full
record and the measurement script's findings:
`apps/web/src/lib/audiobook-site.ts`'s header.

---

## KI-16 · The cover audit will intermittently call padhard's own covers "unreachable" — `ACCEPTED`

**Symptom.** A cover-health run against `padhard` reports a handful of works as
`fetch failed` (the ROUTE's `unreachable`; the SCRIPT prints it in the same list
as `broken`). Re-probe the same URLs a minute later and they answer perfectly.

**Measured 2026-09-06**, the first production run of the converted audit:
**642 covers checked, 8 reported.** Seven of the eight were `fetch failed`
against `pub-6521c378bf4b4ac3b17d5ac898832819.r2.dev` — padhard's
`COVERS_BASE_URL`. Three of those seven were re-fetched by hand within minutes:

| work | re-probe |
|---|---|
| 7 *Bitten (Deluxe Limited Edition)* | **200**, `image/jpeg`, **3,470,395 B** |
| 51 *The Knight and the Moth* | **200**, `image/jpeg`, **4,185,831 B** |
| 73 *Lessons in Chemistry* | **200**, `image/jpeg`, **3,399,074 B** |

So **7 of the 8 were fine.** The eighth — 356 *Evocation* — is a real `HTTP 503`
and is `docs/TODO.md`'s long-standing row, now confirmed for the third time
(2026-08-23, 2026-09-05, 2026-09-06).

**Why it happens.** `apps/worker/wrangler.toml` already records the cause beside
the var: **r2.dev is rate-limited and uncacheable**, which is exactly why the
main instance fronts its bucket with `bookcovers.heygabi.ai`. Padhard's covers
are also LARGE — 3–4 MB each, an order of magnitude above a jacket thumbnail —
and the SCRIPT fetches them one at a time with **no timeout**, so a rate-limited
large object is the normal failure rather than the unlucky one.

**Why tolerated.** ⚠️ Nothing is wrong with the covers, and the audit is
already built to say so: `unreachable` is a **separate count** from `broken`
precisely so this does not read as eight dead covers. `/api/health` reports the
two apart, and `access/audits.md` §1 tells a reader to re-run before touching
anything. 🔴 **Never blank one of these URLs to make the number go down** — the
object is there.

**What would change it.** Attach a **custom domain + a 1-year Cache Rule** to
`library-2nd-covers`, the way `bookcovers.heygabi.ai` fronts the main bucket —
`wrangler.toml` names that as the intended end state and says the change is
**one line** (`COVERS_BASE_URL`). Object names are content hashes, so a cached
copy can never be stale. Removal condition, as a number: **a padhard tick
reporting `unreachable: 0` on two consecutive nights.**

⚠️ **Do NOT "fix" this by lengthening the route's timeout or retrying.** A
retry loop would hide a genuine outage, and the count is the instrument — an
`unreachable` figure that trends upward is the signal that the r2.dev decision
finally needs revisiting.

---

## KI-17 · The four ART BOOKS are refused by the crowdfunding guard, and one wears a product photo for a cover — ✅ **SETTLED 2026-09-06** · `ACCEPTED`

> ✅ **SETTLED 2026-09-06 by the owner, verbatim: *"No ISBN"*.** He looked at the
> four books, which are in the house. **The entry's one open question is
> answered and it is answered in the direction that costs nothing.**
>
> This entry used to end on the sentence *"`isbn13 IS NULL` on these rows means
> **nobody asked**, not **there is none** — the one place these four differ from
> every other row the guard refuses."* 🔴 **That sentence is now FALSE, and its
> falseness is the closure.** These four no longer differ from anything: like
> every crowdfunded row `isCrowdfundedPrinting` refuses under the owner's
> 2026-09-05 ruling, their `isbn13 IS NULL` is a **recorded fact**, not a gap.
> The guard's refusal — which was the *right outcome reached by the wrong
> reasoning*, because the word matched was *"Collector's"* — is now simply the
> right outcome.
>
> **Nothing was changed in the data, and that is the finding, not an omission.**
> Re-measured 2026-09-06 14:2x UTC against production:
>
> | Checked | Result |
> |---|---|
> | `edition` 670–673 on `library-catalog` | still `edition_name = "Collector's Edition"`, `note` NULL, `isbn13`/`isbn10`/`asin` all NULL, `source = 'manual'` |
> | the same rows on `library-catalog-2nd` | **they do not exist** — no art book is in padhard's catalogue, so there is no `--friend` half to this item |
> | the three guards run over the four rows' real values | `declaresNoIsbn` → null · **`isCrowdfundedPrinting` → `"Collector's"` on all four** · `namesAnIsbn` → null |
> | who could still fill them | **exactly one script**, `scripts/backfill-missing-isbns.mjs` — the only caller of any of the three guards, and it skips all four at guard 1b (`:654`). The other four ISBN-touching scripts either NULL a wrong value (`fix-foreign-isbns-2026-09-05.mjs:743`, `fix-same-isbn-series-2026-09-05.mjs:229`) or run off a fixed seven-work data file (`apply-bn-details.mjs:133`) |
>
> **So the rows are already inert and no write was needed.** A `--commit` sweep
> would have had nothing to do on main and no rows to find on padhard.
>
> ⚠️ **The one thing that stays true, and is why this entry is kept rather than
> retired to the resolved table:** the refusal rests on the WORD *"Collector's"*,
> not on a statement these rows make about themselves. `declaresNoIsbn` — the
> guard that would refuse them for the correct reason — reads a *phrase*, and
> these rows carry none. **If the crowdfunding word list is ever narrowed, these
> four re-enter the ladder**, and the 2026-09-05 dry run recorded what happens
> then: LibraryThing proposed `9784047336582` (**978-4 = Japan**) for work 516
> and only the language gate stopped it (`info/isbn-ladder.md` §7.5). The
> durable fix is one field, and it belongs to a person, not to a sweep: put
> *"No ISBN printed on this edition (owner-verified)"* in each row's `note` —
> the wording migration 0460 already established and `declaresNoIsbn` already
> matches — through **✎ Edit this book → Editions & copies → Note** (or the
> "no barcode" tick, which since 2026-09-03 writes `note` rather than the name).
> Until somebody does, the accidental refusal is doing the work of the stated
> one.

**Symptom.** Two ladders mis-handle the same four objects, for the same reason:
**an art book's ordinary retail packaging looks exactly like a special
printing.**

1. 🔴 **The ISBN backfill refuses them.** Editions **#670 #671 #672 #673** all
   carry `edition_name = "Collector's Edition"`, and `isCrowdfundedPrinting`
   (`scripts/lib/backfill-safety.mjs`, guard 1b) matches
   `/\bcollector'?s?\b/i`. Every run prints them as *"a crowdfunded/collector's
   printing the owner holds"* and never asks a rung. These are retail art books
   — a "collector's edition" is what the publisher calls the only edition there
   is — so, unlike a Kickstarter hardcover, they very probably **do** have
   ISBNs.
2. **The cover ladder returns a photograph of the object, not a jacket.** Work
   **516** *Sanctuary: The Art Book of Yuumei* was written a Goodreads image at
   **high** confidence that is the right book and a **3D product photo**
   annotated *11.5 in / 9 in / 124 Pages*
   ([`info/covers-and-series.md`](info/covers-and-series.md) §0.1).

| edition | work | title | `edition_name` | `source` | `isbn13` |
|---|---|---|---|---|---|
| **670** | 516 | *Sanctuary: The Art Book of Yuumei* | `Collector's Edition` | `manual` | NULL |
| **671** | 517 | *PERSONA 5 ROYAL ART BOOK* | `Collector's Edition` | `manual` | NULL |
| **672** | 518 | *PERSONA 5 ART BOOK The Aesthetics* | `Collector's Edition` | `manual` | NULL |
| **673** | 519 | *THE ART OF FIRE EMBLEM: THREE HOUSES* | `Collector's Edition` | `manual` | NULL |

**Measured 2026-09-06** against production `library-catalog`, in the `--remote`
dry run of `scripts/backfill-missing-isbns.mjs`: **32** rows skipped by
`isCrowdfundedPrinting`, and **these four are among them**. All four were
created in one batch at `2026-08-25 03:09:17`, all `hardcover`, all
`source = 'manual'`; each has exactly one owned `copy` (453–456) with
`edition_notes` NULL and `leatherbound` / `slipcase` / `sprayed_edges` all
**0**, and no crowdfunding importer in `scripts/` names any of them. That is the
same evidence profile that kept edition **#507** out of the tier C repair —
nothing on these rows says they came from a campaign except the word
*"Collector's"*.

⚠️ **The cover half of #516 is CLOSED, and it closed the way the design says it
should — a person looked.** Re-measured 2026-09-06: `cover_status` is **`ok`**,
and `change_log` row **1593** records `"standin"` → `"ok"` at
**2026-08-24 22:44:43**, `changed_how = 'human'`, `changed_by = 1`, with **no
accompanying `coverUrl` row** — so the owner assessed the product photograph and
accepted it, and that is a judgement rather than a failure (0040's rule: `'ok'`
means a person looked). ⚠️ [`TODO.md`](TODO.md)'s residue table still listed it
as a stand-in until this entry was written. Cover state of the other three
today: 517 `ok`, 518 and 519 `cover_status` NULL with a URL set. Stand-ins
across the estate right now: **0** on main, **6** on padhard (113, 268, 542,
552, 561, 675 — none of them an art book).

**Why tolerated.** ⚠️ **This is the exact cost `isCrowdfundedPrinting`'s own
docstring priced before it was written**, and the owner accepted the trade:

> *"refusing every exclusive would turn one silent-wrong-fill into a
> silent-never-fill"*

The guard exists because of the owner's ruling of 2026-09-05 18:29 Phoenix
(*"For the kickstarters we have in stock the ISBNs are recorded if they
exist"*), and the direction it is wrong in is the safe one: a **refusal to
write**, printed with its reason on every run, on four rows that already read
`isbn13 IS NULL` and lose nothing by staying that way. Narrowing the word list
to exclude *"Collector's"* is not available — three of the 13 tier C rows the
owner approved are refused by **that word alone** (#319 *"Collector's Edition
Trilogy — Book 1 Numbered"*, #320 *"Collector's Edition"*, #350 *"Kickstarter
Collector's Edition"*), so dropping it would re-open the defect the guard was
built for. ⚠️ And the ladder is unlikely to help even if asked: an art book's
ISBN is the sort a title search answers with a *different* art book from the
same franchise, which is precisely the wrong-object failure of 2026-08-20.

⚠️ **Not the same as KI-6.** That is a placeholder card showing the wrong book
(byte-identical, catchable by hash). This is the right book, photographed the
wrong way and named the wrong thing — **no automated check can catch either
half**; both were found by looking.

**What would change it — as numbers.**

- **Four is the number.** If the count of art-book rows refused by the
  crowdfunding guard passes **ten**, the answer is an `edition_kind` the guard
  can read (`packages/core` already models `collectors`) rather than a word in a
  name — a row's KIND is a fact, its NAME is prose.
- ✅ ~~🔴 **The cheap fix needs no code and belongs to the owner: type the four
  ISBNs.** They are printed on the books, which are in the house. Under the same
  ruling that created the guard, a hand-entered ISBN is the recorded fact and
  ends the question permanently. Until then `isbn13 IS NULL` on these rows means
  *"nobody asked"*, not *"there is none"* — ⚠️ the one place these four differ
  from every other row the guard refuses.~~ **DONE 2026-09-06 — the owner looked
  and answered *"No ISBN"*.** There are none to type. `isbn13 IS NULL` on these
  four now means *"there is none"*, exactly like every other row the guard
  refuses, and the sentence about them differing is retired with it. See the
  SETTLED banner at the top of this entry for what was and was not changed.
- 🔴 **What must NOT change it:** blanking work 516's `cover_url` so the default
  cover sweep re-tries it. `scripts/backfill-missing-covers.mjs` targets
  `cover_url IS NULL` unless `--standins` is passed, and the temptation is to
  make a row re-enter that sweep by emptying it. Same standing rule as KI-16's
  *"never blank a cover URL to make the number go down"* — the image is there
  and a person accepted it.

Review: <https://library.heygabi.ai/work/516> ·
<https://library.heygabi.ai/work/517> · <https://library.heygabi.ai/work/518> ·
<https://library.heygabi.ai/work/519>

---

## Resolved and removed — 2026-09-05 (ebook phase 5)

⚠️ Same rule as the blocks below: closed by a real change, removed rather than
badged, recorded here so nobody re-opens it from memory.

| Was | Claimed | Closed 2026-09-05 ~23:07 UTC |
|---|---|---|
| **KI-15** | 101 of the 127 ebook editions no longer say `source='file'` — the 2026-08-20 details/ISBN sweep stamped `openlibrary` (34) / `research` (55) / `googlebooks` (11) over the importer's own provenance — so `import:ebooks --prune` sees **26** where a reader expects 127, and would silently leave 101 behind | ⚠️ **Closed by the route the entry itself named as the likely end**: *"Ebook split phase 5 removing these rows entirely, at which point the entry retires with them."* Phase 5 was applied to production `library-catalog` at the owner's GO — **123 ebook editions deleted, 126 → 3**. The surviving ebook-format rows were **listed one by one, not inferred**: **4** remain — edition **318** (`manual`, no `source_url`, work 219: hand-added, deliberately never in scope) and **486 / 487 / 488** (`research`, manifest paths, on works **358 / 359 / 360**, which the owner kept so their three human read states survive). 🔴 **`source='file'` now matches ZERO editions**, so the WHERE clause the entry was about has nothing left to be wrong about, and `--prune` can no longer under-report because there is nothing to under-report. ⚠️ **The underlying nuance is NOT "fixed" and was never going to be** — 3 rows still say `research` about files the importer created, and `source` still means *where the metadata came from*. Nothing was rewritten back to `file`; inventing a provenance to suit a WHERE clause is what the entry refused, and it is still refused. It simply no longer matters, because the one caller that cared is retired. ⚠️ **Not verified:** `import-ebooks.mjs` was **not run** after the prune — `--prune`'s new behaviour on 0 file editions is read off the data, not exercised. And the standing ban on `npm run backfill:ebooks` is now *sharper*, not lifted: it derives `ebook_holding` from `edition`, so a run would mark the **40 surviving holdings** stale (`access/ebook-retirement.md` §6) |

---


## Resolved and removed — 2026-09-02

⚠️ Same rule as the blocks below: closed by a real fix, removed rather than
badged, recorded here so nobody re-opens it from memory.

| Was | Claimed | Closed 2026-09-02 |
|---|---|---|
| **KI-13** | This repo receives `billing_denied` and throws it away — no money path here is switchable | ⚠️ **Closed by billing phase 3 landing** (`e7b3f6b`, deployed to both instances). Its own "what would change it" listed four steps and all four happened: `GateOutcome.refresh` is four keys; migration `0440` adds `app_user.estate_billing_denied` and `GateSubject` takes it; `middleware/auth.ts` persists it beside `visibility` in the same UPDATE; and eight money paths now AND the resolved deny-set in front of their existing gates (L1–L8 — see [`DONE.md`](DONE.md)). 🔴 **The load-bearing pin held on the way through**: `null` is unknown and `[]` is "the directory denied nothing", and they stay apart on the wire, in the column, in the parser and in the tail line. ⚠️ **Shipped INERT** — `BILLING_POLICY = "off"` on both instances, so the switch is wired but not yet acting; the soak that flips it is on [`TODO.md`](TODO.md). ⚠️ **Not verified:** no rule has ever been written for `library`/`library2`, so no `billing_denied` has been seen non-empty on a real `/seen` answer here, and the gate has never fired |

---

## Resolved and removed — 2026-08-26

⚠️ Same rule as the 2026-08-23 block below: re-measured, found no longer true,
removed rather than badged, recorded here so nobody re-opens it from memory.

| Was | Claimed | Re-measured 2026-08-26 |
|---|---|---|
| **KI-8** | Work 514 shows one *Elantris* audiobook, not two — the matcher finds only one | ⚠️ **It shows two.** `audiobook_edition_holding` on production `library-catalog` holds two live rows for work 514: `audio_key = 'Elantris'` (`matched_via` exact, no alias) and `audio_key = 'Elantris - Tenth Anniversary Special Edition'` (exact, `via_alias = 'Elantris - Tenth Anniversary Special Edition'`), neither stale. Closed by the entry's own THIRD route — **a `work_alias` row**, one INSERT, no threshold moved and no code changed. Neither the 0.6 floor nor `cleanAudiobookTitle` was touched, exactly as the entry required |

---

## Resolved and removed — 2026-08-23

⚠️ **Kept as a pointer, not as content.** These were live entries in this file
and each was **re-measured** on 2026-08-23 and found no longer true. They are
removed rather than left with a badge, per the docs standard; the numbers are
recorded here so nobody re-opens them from memory.

| Was | Claimed | Re-measured 2026-08-23 |
|---|---|---|
| **KI-1** | `npm run typecheck` RED, 7 errors in 3 files | ⚠️ Its own stated removal condition was *"exits 0"*. **It exits 0.** Also 1,342 tests pass and `tsc --noEmit` on `apps/web` is clean |
| **KI-2** | Three feature branches unmerged, all conflicting | **All three merged** 2026-08-21 (Kiro, K2 then K11). `feature/series-overrides` no longer exists locally; the other two survive only as `origin/*` pointers |
| **KI-3** | `dl_ebooks` is a dead column still standing | **The column is gone.** `pragma_table_info('app_user')` on `--remote` lists 13 columns and `dl_ebooks` is not among them; the only match left in the repo is a comment in `packages/estate-auth/test/gate.test.ts` |
| **KI-4** | The donor refuses to hand out `series_index_display` | **It hands it out.** `routes/donor.ts` carries `seriesIndexDisplay` (Kiro item K7, completed 2026-08-21) |

