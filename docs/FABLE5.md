# Fable 5 — briefing and work queue

> **Audience:** Claude sessions dispatching Fable 5, and Fable 5 itself.
> **Status:** TRACKED. Created **2026-08-13**. Last verified: **2026-08-13**.
>
> Dispatch with the `Agent` tool and `model: 'fable'`. In a `Workflow`, use
> `agent(prompt, { model: 'fable' })`.

## 1. Why this document exists

The owner, 2026-08-13: *"we haven't used any fable 5 usage this month, we should
plan to use that for something. its waste to leave our powerhouse on the table
unused."*

⚠️ **Fable has its own weekly allowance, counted separately from the all-models
pool.** Measured on the usage page that day: **Fable weekly 0%** beside
**all-models weekly 52%**. So Fable work does not spend the budget the rest of the
session draws on. Leaving it at zero is waste; spending it on the wrong thing is
also waste.

## 2. What Fable is for here: the review gate

**Chosen split, 2026-08-13:**

| Fable 5 | Opus |
|---|---|
| Adversarially review **every change before it deploys** | Build features, run the data work |
| **Design** the edit-any-detail + audit-log feature | Apply Fable's design *after the owner approves it* |
| Review **any migration before it runs** | Everything in `docs/TODO.md` → "Agent-safe" |

### ⚠️ Why a review gate rather than a second builder

This is the argument for the split, and it is empirical rather than theoretical.
In one **attended** evening the Opus session got three things wrong and caught
each only afterwards:

| What was claimed | What was true |
|---|---|
| Silent save failures were React **hydration** | It was the **1Password autofill overlay** swallowing the click. `Escape` first, then Save. |
| Retitling a work is **safe** because `work_key` follows the title | That is exactly the **danger** — `work_key` is the join to **860 audiobook reviews**, and `WorkFields` deliberately refuses `title`/`authors` for that reason |
| *Who Goes Roar?* is publisher-authored | **Christie Hainsby** is the credited writer. MBI's house style omits the writer from the cover |

All three were cheap because a human was awake to push back. **Unattended, that
class of error compounds** — a wrong author becomes a wrong `work_key` becomes an
orphaned review. That is what an independent model on a separate budget is for.

## 3. Standing review checklist

When reviewing a change, check these specifically. Each one is a real bug this
estate has already shipped or narrowly avoided.

1. **Does it move `work_key`?** Derived from `title` + `authors`. It is the join
   to the sibling catalog's reviews. If a change can move it, the change must say
   what happens to the join.
2. **Does it invent a fact?** This codebase's whole character is refusing to
   assert what it cannot evidence — `openEnded`, `'at least N'`, `series_volume
   .source`, `cover_status`, `AudioSeriesMatch`. A change that fills a field with
   a plausible guess is a bug here even where it would pass elsewhere.
3. **Does a flag travel with its value?** Migration 0040's rule: `cover_status`
   moves with `cover_url` **or not at all**. Same shape recurs — a status written
   in a second request can fail while the first succeeded.
4. **Does it create one edition per barcode?** The Open Library **work-level**
   record aggregates every printing of every volume. One scan produced **6
   editions and 6 copies** of a phantom "Space Knight" on 2026-08-13. One barcode
   is one edition and at most one copy.
5. **Does it reuse the ONE implementation?** `normaliseTitle`, `splitAuthors`,
   `bookIdFromTitle` and `normaliseUniverseText` are each the single
   implementation and are **not** interchangeable. A second similarity function is
   how the sibling project shipped three wrong games.
6. **Is a silent failure distinguishable from success?** A cleared form looked
   exactly like a saved one on 2026-08-13 and lost a book.
7. **Does it need a migration?** If so, it does **not** ship unattended. See §5.

## 3a. Scope: the whole `heygabi-ai` workspace, not one repo

The owner put **`catalog-platform`, `boardbuddy` and `bookbuddy`** into one VS Code
workspace called **`heygabi-ai`** and asked for Fable to *"clear a lot of todos from
all of these projects."* So this brief is estate-wide. The work logs to read:

| Repo | Work log | State (2026-08-13) |
|---|---|---|
| `bookbuddy/library_catalog` | `docs/TODO.md` | the big queue — this session's |
| `bookbuddy/audiobook_catalog` | `docs/TODO.md` ⚠️ **gitignored, local only** | pending/decisions + the shared edit-any-detail ask |
| `boardbuddy/Board_Game_Catalog` | `docs/TODO.md` | **healthy** — clean tree, only **3** open items |
| `catalog-platform` | `docs/TODO.md`, `docs/PLATFORM.md` | CI gap + sequencing |

### ⚠️ The three repos converge — do not treat this as triple the work

`Board_Game_Catalog`'s **entire** open list is three items: **scan history**,
**splitting a shelf photograph**, and **the two thresholds worth re-measuring**.
Those are precisely the three that `PLATFORM.md` §7 Stage 1 already identifies as
**shared wheels**. So the same three fixes clear boardbuddy's backlog *and* unblock
the fork. Fix them once, in a form that ports.

⚠️ `audiobook_catalog/docs/` is **gitignored**, so its work log is a local-only
file. Read it, but do not expect to commit changes to it — and say so if you write
there, because a future session will not find it in git history.

## 4. Fable's work queue, in priority order

### 4.1 Review gate — continuous, highest priority
Review each change Opus produces before it deploys. Nothing else in this list
outranks an unreviewed deploy.

### 4.2 Design: edit-any-detail + an audit log
The largest and most dangerous piece. **Design only** — read
`docs/TODO.md` → *"Edit any detail, an audit log, and adding a book with no
author"* for the measured constraints before proposing anything. The short form:

- `work.authors`, `primary_author`, `work_key` are all **NOT NULL**
- `work_key` **contains the author on purpose** — `0001_init.sql` warns that
  title-only keys "collide across authors constantly"
- `work_key` is the join to **860 reviews** shared with `audiobook_catalog`
- ⚠️ "Flag for remediation" means the author arrives **later**, which moves
  `work_key` — harmless for a book added seconds ago, destructive for one with
  reviews. **The remediation path must know the difference.** That test is the
  design's core problem, not an afterthought.

⚠️ **This is a cross-repo rule.** `audiobook_catalog` needs the same feature and
shares the review store. Design the audit-log table and the `work_key`-move rules
**once, for both**. `catalog-platform/docs/PLATFORM.md` §2.2 governs what may
cross the boundary.

### 4.2a Design: an edition picker — ⚠️ #341 was NOT a one-off

Owner, 2026-08-13: *"the 341 editions wont be a 1 off so maybe add that to the
fable workflow."* They are right, and it is a structural gap rather than a chore.

**The case.** *He Who Fights with Monsters* book 1 exists as **two different
hardcover printings** the household owns — a dust-jacketed trade edition
(`9781638493457`) and a Target exclusive with a foil case wrap and no dust jacket
(`9781638494362`). Recording both required raw SQL, because:

⚠️ **`Copies.tsx` deliberately reuses an existing edition of the same format** —
`editions.find((e) => e.format === format)` — and its comment explains why: *"this
catalog learned that lesson the expensive way — `findEditionBySourceUrl` exists
because an importer created 83 duplicate editions by not checking."* That guard is
correct for its case and makes **"a second, different printing of the same
format"** literally unsayable through the UI.

**Why it recurs.** The catalog already holds Kickstarter hardcovers, Target
exclusives, B&N exclusives, signed printings, sprayed-edge variants and a
`collectors` edition kind on **43 rows**. The docs' own "Owned more than once"
section says outright that *"a Target edition and a Barnes & Noble edition are two
objects on the shelf."* The data model supports it; only the UI cannot express it.

**Design it as a picker, not a new form.** When recording a copy of a format that
already has an edition, the person needs to *choose* — this printing, or a new one —
and to see enough to tell them apart (ISBN, edition name, kind). ⚠️ Note the
overlap with **cover swap**: both are "several candidates exist for this book,
which one is this?" and they may want to be one component.

⚠️ Constraints that must survive the design:
- The **83-duplicate-editions** guard must still hold for importers and the scan
  path. Only a person choosing may create a same-format sibling.
- `edition_kind` has **no CHECK** on purpose (migration 0050) — do not add one.
- A wish must still create **no edition**: `reportFor` decides held-vs-wished by
  whether a work has any edition at all.

### 4.3 Platform work — genuinely suited to Fable

Checked 2026-08-13 across `catalog-platform/docs/`. Three items are cross-repo
design problems rather than local chores, which is where an independent model
reasoning over three codebases earns its keep.

| Item | Where | Why Fable |
|---|---|---|
| **Re-measure the matching thresholds** — `matchExistingTitle` and the 0.7 spine floor | `PLATFORM.md` §7 Stage 1, marked **"✅ Critical"** | The doc says outright: *"Fix once, or fix twice differently."* Books need a (title, author) key because titles collide across authors and Kindle rows carry ASINs not ISBNs. ⚠️ **Tonight's session hit this repeatedly** — the OL aggregate bug, bare series-line titles resolving to the wrong book, `Bizzy Bear` ×3. This is the highest-value shared fix in the estate |
| **Three of four repos deploy only from a human's laptop** | `catalog-platform/docs/TODO.md` §1 | A CI design that must preserve the two-lane deploy, and ⚠️ §1.2 warns *"do not copy the audiobook workflow wholesale"*. Needs judgement across four repos, not a template |
| **Scan history view** | `PLATFORM.md` §7 Stage 1 | Marked as porting cleanly. Pure scan-queue infrastructure — `scan_job.enriched`, mode/timestamp columns, paging |

⚠️ **Do NOT put "splitting a shelf photograph" on this list yet.** `PLATFORM.md`
says re-argue it and **measure first** — the games evidence ("vision read all 73
titles fine") does not transfer, because book spines are narrower and denser.

## 5. ⚠️ Hard limits — what Fable must not do

1. **No migration reaches production unattended.** Design it, review it, present
   it in the morning, apply on the owner's word. Nothing in the overnight plan
   except the edit-any-detail feature needs the schema at all.
2. **No guessing to unblock itself.** The things waiting on the owner are waiting
   because a guess would corrupt data. If a fact is unavailable, report it as
   unavailable — `docs/TODO.md` is full of examples of that being the right answer.
3. **No second implementation** of the four normalisation functions. See §3.5.
4. **Say what was not verified.** Every research report in this estate that was
   useful ended with an explicit "could not verify" list. A confident report with
   a silent gap is worse than a hedged one.

## 5a. ⚠️ Fable owns the app being down

Owner, 2026-08-13: *"if the app goes down fable will be in charge of saving it."*

So this is Fable's call, not the dispatcher's. **Recovery beats everything else on
the list** — drop the review queue and the design work until the site is back.

**How to tell it is actually down** — the site *looked* down to the owner once this
session and was fine from the server side, so check before acting:

```bash
curl -s https://library.heygabi.ai/api/health          # expect ok:true, database:up
```
⚠️ Do **not** trust `curl -o NUL -w '%{http_code}'` in Git Bash — it reports
`000` / exit 43 on a perfectly healthy host. Use PowerShell `Invoke-WebRequest`
for status codes, or read the body as above.

⚠️ A **200 on `/` is not proof the app works** — the shell can serve while the
bundle white-screens. Load a real page and check the console before declaring it
healthy, and remember the PWA can serve a stale bundle from cache on one device
while the server is fine.

**If it really is down, the rollback target is in the repo:**

```bash
tail -3 docs/deploys.log        # ISO<TAB>commit<TAB>holder<TAB>version
```
Each line is a commit that was live and the Cloudflare version it produced. Roll
back with `npx wrangler rollback --config apps/worker/wrangler.toml` (or redeploy a
known-good commit from that log). ⚠️ **Never kill a deploy mid-flight** — a killed
deploy can leave the live version out of step with the repo, which is the one
genuinely expensive state.

⚠️ **Write the incident up in §7 as it happens, not afterwards.** If Fable is
mid-recovery when the dispatcher next looks, the log is the only way to avoid two
runs both trying to fix it.

## 6. Progress log — ⚠️ both runs write, so neither collides

Owner: *"add to the fable doc that it needs to track its process in that doc so you
can be aware of where it is to help with overlaps too."*

**The protocol, and it is symmetric:**

| Run | Writes progress to | So the other can |
|---|---|---|
| **Fable** | **§7 of this file** | see what is claimed, in flight, done, or abandoned |
| **Opus** | `docs/TODO.md` | same, from the other side |

**Rules for both:**

1. **Claim before starting.** Append a line naming the item *before* work begins,
   not after. A half-done item nobody claimed is how two runs rebuild the same
   thing.
2. **Commit and push every claim and every result.** ⚠️ Both runs share one
   filesystem *and* one `origin`, so an uncommitted note is invisible. `git add`,
   commit, `git push origin main`.
3. ⚠️ **Write down what you could NOT solve** — the owner asked for this
   explicitly. Name the item, what was tried, and what would settle it. An
   unsolved item recorded with its dead ends is useful; an unsolved item silently
   dropped costs the next run the same search. *"Could not find"* is a result.
4. **Pull before deploying.** `deploy-guard.mjs` will refuse if the live commit is
   not in your tree, which is the same instruction enforced mechanically.

## 7. Fable's progress log — append below this line

Format, one line or short block per entry:

```
[ISO timestamp] CLAIM|DONE|BLOCKED|UNSOLVED|INCIDENT  <item>  — <detail>
```

⚠️ Do not rewrite earlier entries. An abandoned claim followed by a later
`UNSOLVED` is more useful than a tidy log, because the pair records that it was
attempted.

<!-- entries start here -->

```
[2026-08-12T23:24-07:00] CLAIM  §4.2 design: edit-any-detail + audit log + authorless add  — writing docs/info/edit-and-audit-design.md. Design only, no migration applied, no deploy. Constraint reading done (0001, 0008, 0040, WorkFields.tsx, works.ts, titles.ts, reviews.ts, identity-and-reviews.md, PLATFORM.md §2.2).
```

[2026-08-12T23:18-07:00] CLAIM  Re-measure the two matching thresholds (`matchExistingTitle`, 0.7 spine floor) — Fable 5. Plan: query both production D1s read-only (library works+editions+aliases, board game items), measure false-positive/false-negative rates of 0.34/0.7 and the 60% containment gate against real titles, propose a bare-series-name detection rule, write up at `catalog-platform/docs/info/matching-thresholds.md`. No deploys, no migrations.

[2026-08-12T23:45-07:00] DONE  Threshold re-measurement — write-up at `catalog-platform/docs/info/matching-thresholds.md`. Verdict: **keep 0.34 and 0.7 in both catalogs**; the numbers are shareable but only because thresholds are not what does the safety work — 79 book pairs and 15 game pairs of *different* things score exactly 1.00 (single-digit volume numbers are dropped by `titleWords`), so the structural gates (numbers-agree, author, fragment) must ship in BOTH matchers; each catalog currently holds gates the other lacks. Fragment attack: games matcher wrong on **162/354 (46%)** bare prefixes, library matcher **0/29** — the shared wheel must be shaped like `matchIndexedWork`, not `matchIndexedTitle`. ⚠️ Books' TRUE spine reads measured 0.50–0.75 (real shelf job 9, *My First* board books) — the games' "gap at 0.7" does not exist for books; the floor survives only as "nothing auto-ticks unless exact-ish". Bare-series-name rule proposed in §6 of the doc: refuse >1 edition per barcode and any OL `/works/` record as an edition source; review-only (never auto-tick) a title equal to a known series name with no volume number (18/341 real works legitimately carry such titles, so refusal would be wrong); standing audit for series-titled works with ≥2 editions. Side findings recorded: Korean titles normalise to `""` (two works share the empty key — CJK-collision path, fix is a migration); #258 carries 3 hardcover editions (edition-picker case or leftover dupes — eyeball it); library's `isConfidentMatch` lacks the games' `isFragmentOf` guard.

[2026-08-12T23:45-07:00] UNSOLVED  Not measurable tonight, recorded in §8 of the write-up: OL wrong-answer rate at scale (needs a live API sweep; 2026-08-09 isbn-ladder spot checks remain the only evidence); Kindle/ASIN name-only match rate (exactly 1 ASIN-only edition in production — no corpus); book spine read-rate on a full shelf (total corpus is one 7-spine job, so the 0.50–0.75 true-read population is n=6 and needs re-checking after more scans — the "split the shelf photo" question stays open for the same reason).

[2026-08-13T00:15-07:00] DONE  §4.2 design — `docs/info/edit-and-audit-design.md`, design only, nothing applied. The key decision: an authorless book stores sentinel `?unknown` in `authors`/`primary_author` and gets `work_key = <titlefold>|?unknown` — the `?` cannot survive `normaliseTitle`'s [a-z0-9 ] fold, so the provisional key can never equal a real one, and `reviewDocFor` refuses to ever stamp it onto a review doc. **Remediation is therefore safe by construction, not by measurement**: zero docs can carry a provisional key, so filling in the author later is always a free key move. No `work` rebuild (0008 measured data loss on both escape pragmas; `work`'s child closure is essentially the whole DB) — `toWork()` maps sentinel→null so the app type is `string|null` and the compiler finds every reader. Established-book title/author edits get a two-sided ceremony: browser live Firestore check (both queries) + server evidence floor (`reviews_seen_*` columns, rating evidence, prior key-move audit rows), restamp-docs-FIRST-then-PATCH ordering so a half-done move degrades to legacy-query visibility and is idempotently re-runnable. Audit log = `change_log` (per-field rows, batch_id, no FK on entity_id so deletes stay accountable, old/new as NOT NULL JSON, DECISION_MODES `changed_how`), one DDL for both catalogs per PLATFORM §2.2 — audiobook side applies it in its own store when it gains an editor; today its git-tracked overrides file already is its audit trail. ⚠️ Two live gaps found while reading: `PATCH /api/works/:id` accepts `title`/`authors` TODAY with no guard (UI patch object is the only protection), and `updateEditionSchema` accepts `isbn13`/`asin` patches — both closed in the design, worth knowing about before it ships.

[2026-08-13T00:20-07:00] CLAIM  Review gate (§4.1): commit `7a3b749` — server-side refusal of `title`/`authors` on `PATCH /api/works/:id`. Adversarial review before deploy; not deploying either way, dispatcher deploys on the verdict.

[2026-08-13T00:50-07:00] DONE  Review of `7a3b749` — **verdict SHIP**, verified rather than approved. (1) Caller sweep re-done independently: every `api.updateWork` call in `apps/web` (`WorkFields.tsx`, `Enrich.tsx`, `catalog-add.ts:194`) sends neither field; `covers.ts` and `applyFinding` call `@lc/db`'s `updateWork` *below* the route, unaffected; all 48 `scripts/*` checked — only `import-ebooks.mjs` speaks HTTP and it POSTs `/api/ingest/ebook`, and `fix-title-case.mjs` (the one title-changer) writes SQL via wrangler with its own `normaliseTitle`-equality refusal; `audiobook_catalog`, `boardbuddy`, `catalog-platform` contain no `api/works` caller at all. (2) 313 tests + typecheck re-run, clean. (3) ⚠️ Exercised live on the dev worker (13 probes, work 53, then reverted, worker stopped by name): `title`/`authors`/both/`title:null` → 400 `frozen_field` with correct `fields`; **atomicity held** — a `subtitle` sent beside `title` did not land; cased `"Title"` passes the guard but Zod strips it and the key does not move (no bypass); array/string/number/null/malformed bodies all fall through to clean Zod 400s. (4) Whole-patch refusal is right: a 400 that had also mutated state would make resend-without-the-field re-apply half a patch, and a 200-with-warnings is the partial-success lie this estate keeps hitting. (5) The guard is the interim form of the design's own §5.2 gate — ⚠️ when the key-move ceremony builds, this 400 block becomes the 409 `key_move_requires_check` branch **in place, on this route**; do not read the comment's "opens its own guarded path" as licence for a second endpoint.

[2026-08-13T00:50-07:00] DONE  `updateEditionSchema` isbn13/asin question (deliberately not touched tonight — confirmed correct): ⚠️ **the Editions "Edit" UI legitimately patches ISBN today.** `Editions.tsx` `EditionForm` (lines ~307–321) sends `isbn13`/`isbn10`/`asin` unconditionally on *every* save, and `AddWork.tsx`'s failure path ("Book added, but that ISBN could not be recorded — add it from the book page") depends on exactly that form. A presence guard like tonight's would 400 every edition edit in the app. Recommend: freeze edition identifiers only as part of the edit-and-audit build, in the same commit that makes `EditionForm` delta-only, with the owner deciding whether null→value (adding a missing ISBN) stays allowed while value→value becomes delete-and-recreate. Risk asymmetry supports waiting: a wrong ISBN is one visible, UNIQUE-guarded row; a moved work_key silently orphans ~870 reviews.

[2026-08-13T00:50-07:00] UNSOLVED  Pre-existing, out of tonight's scope: `updateWorkSchema` still silently strips *any* unknown key — `{"Title": …}` or a misspelled field returns 200 having changed nothing, the exact strip-lie the estate documents. Fixing it is a `.strict()`-shaped decision across every patch schema, wider than this commit; recorded rather than smuggled in.

[2026-08-13T00:30-07:00] CLAIM  Estate-wide improvement/feature survey — Fable 5. Reading all four repos' TODO/PLATFORM/info docs + querying both production D1s read-only; writing ranked proposals to `catalog-platform/docs/info/improvement-proposals.md`. Survey and proposal only: no deploys, no migrations, no app-code changes.

[2026-08-13T01:30-07:00] DONE  Estate-wide improvement survey — write-up at `catalog-platform/docs/info/improvement-proposals.md` (+ its README index row). All counts read live from both production D1s 2026-08-13. Top six, ranked: (1) implement the one-barcode-one-edition guard — specced in matching-thresholds §6 and **measured as still absent from code** while scanning resumes today; (2) rescan-is-a-question — 71 physical editions have no ISBN and the promised "scan will fill it in later" path does not exist: `catalog-add.ts` writes a new owned copy unconditionally and a second same-format edition (residue already live: #139 holds an OL hardcover beside a `manual` ISBN-less one), fix reuses the shipped preorder-prompt shape and should merge with the edition picker; (3) rehost 151 OL/Google cover hotlinks into R2 (108+43 measured, vs 33 self-hosted; bucket live since 0ab1e18e); (4) author-string canon + dedupe report — `Make Believe Ideas` vs `Make Believe Ideas  Ltd.` and `SAMG` vs `SAMG Entertainment` are live, the latter the only thing preventing a full CJK work_key collision; merges one-at-a-time behind the audit ceremony; (5) stand up the index Worker games-first — two hand-built library↔audio bridges already exist and drift between script runs, zero bridges to 836 games; (6) refresh PLATFORM.md's stale §1/§8. Remove/simplify: games `play` and `sleeve_requirement` tables are **dead schema** — 0 rows and no write path anywhere in that repo, only export.ts reads them; `user_item` ratings 0 rows with live code = watch. Do-not-build recorded with reasons (lack-counts, auto-accept of findings despite the 798/798-accepted record, bulk author merge, book shelf-splitting, DB merge, Serper, ISBN-from-research, bulk cover_status stamping). No deploys, no migrations, no app code touched.

[2026-08-13T01:30-07:00] UNSOLVED  Survey items not assessable tonight (§7 of the write-up): Firestore live reads (no service account held, by policy); whether #163/#203's twin hardcovers are two real printings or a scan-resolved sibling printing (needs the shelf); games ratings UI reachability (write path exists, no browser driven); R2 cache rule on bookcovers.heygabi.ai (dashboard not opened); `scan_job.enriched` blob completeness for the history view (rows counted 32/30, blobs not sampled).

[2026-08-13T00:15-07:00] UNSOLVED  Five items in the design's §9, headline two: (1) title-edit doc-id drift — a retitled book's future library-side review lands under a new slug beside the person's old doc; tried stable ids (impossible, `bookIdFromTitle` built every production id) and id rewrites (delete+create of other people's docs, breaks audiobook `getReviews`); settles with a measured retitle-of-reviewed-book frequency or a dedupe-on-write in `reviewDocFor`. (2) the carry procedure depends on Firestore's shape-only rules (no `request.auth`) letting any client restamp anyone's review doc — if `reviews` rules are ever hardened the restamp breaks silently; settles with a PLATFORM.md decision on whether `reviews` ever gets auth rules (and then the carry needs the service account this estate refuses to hold). Also unverified by execution: the migration SQL was never dry-run against local D1 (design-only task) and the restamp→PATCH interleave has never been exercised.

[2026-08-13T00:01-07:00] CLAIM  Build the edit-and-audit code (design §7 "code changes riding along") — Fable 5. Owner approved all four open questions; migration 0120 already written and applied to LOCAL D1 by Opus (not production — Opus migrates+deploys after review). Priority: (1) @lc/core sentinel+tests, (2) @lc/db works.ts sentinel mapping + actor + change_log batch writes + NEEDS_AUTHOR, (3) worker key-move gate + reviews-seen + provisional refusals, (4) web UI. Not deploying, not migrating remote. Committing to main only.

[2026-08-13T07:45-07:00] DONE  One-barcode-one-edition guard — ALL THREE tiers of matching-thresholds §6, commits `52c559f` (tier 1) + `b5ee502` (tiers 2+3), pushed. Tier 1 in `@lc/isbn`: `lookupOpenLibraryByIsbn` refuses work-level records (/works/ in url or an OL…W identifier) and any answer carrying >1 distinct ISBN-13; same distinct-ISBN refusal on the Google rung; `workKeyForIsbn` (redirect-follow can land on a work JSON) returns the work key with `edition: null` instead of dressing the aggregate as a printing; `editionsOfWork` drops /works/ entries; refusals are throws prefixed `refused:` so they land in the rung trace distinguishable from "nothing found", and `resolveBarcode` says the true reason on the line via `wasRefused`. ⚠️ Live probe DURING the build changed the plan: OL now answers incident ISBN …641696 with a clean single-ISBN *edition* record titled bare "Space Knight" (…061/…078 answer `{}`), so tier 1 alone provably would NOT stop today's recurrence — tier 2 was therefore built in the same sitting rather than deferred: `isBareSeriesTitle`/`foldSeriesNames` in core matching.ts (digit test on the folded key; review-only because 18/341 real works are legitimately series-titled — a test pins that stance), `listKnownSeriesNames` in @lc/db (the spec's three-table union), `warnBareSeries` applied at all three resolution-landing sites in scan-jobs.ts plus a bare-series variant of the spine "check this one" detail. Tier 3: `npm run audit:series-aggregates` (read-only, exit 1 on hits — series-titled works with ≥2 editions). Verified by execution: 334/334 tests (11 isbn guard tests using the six real incident ISBNs incl. rung-degradation, 5 core predicate tests), typecheck clean, audit script exercised against local D1 (flagged #93 Beneath the Dragoneye Moons, 2 editions — the designed eyeball case). npm test's glob now includes packages/isbn/test/.

[2026-08-13T07:50-07:00] CLAIM  Task 2 — finish the edit-and-audit build (design §7 ride-along): worker catalog.ts key-move gate (replaces the blanket 400 in place, per my own review note on 7a3b749) + `POST /works/:id/reviews-seen` + delete `__row__` logging; reviews.ts `/observed` refusal (guard 3); web UI (edit title & author panel, Add-without-author, Needs→Author, card mark, Changes panel, reviews-held message). PLUS the dispatcher's added scope: patch schemas reject unknown keys with a 400 naming the field — client sweep first, all-or-nothing across work/edition/copy. Dispatcher's closures accepted: PLATFORM.md §4a settles the rules posture (read before writing the carry), 0120 dry-run verified, doc-id drift accepted as a known wart (comment only, no dedupe-on-write).

[2026-08-13T08:55-07:00] DONE  Task 2 — the edit-and-audit build is code-complete against the design's §7 table. Commits `6ba27bd` (server) + `eee2d8d` (web), pushed. Server: PATCH /works/:id key-move gate replaced the blanket 400 in place — every §5.2 refusal exercised live against local D1 (21 probes: 409 requires_check/stale_key/evidence_mismatch/reviews_would_detach, 400 inconsistent attestation, free provisional moves, ceremony move with 'reviews restamped: 3' note, carriedKeyMoves evidence leg, deletion __row__ surviving the row); POST /works/:id/reviews-seen; GET /works/:id/changes; POST /works + DELETE now pass the human actor; reviews.ts /:id/observed 409s on provisional (guard 3) and the bulk sweep drops crafted sentinel keys. Dispatcher's added scope DONE all-or-nothing: updateWork/Edition/Copy schemas are .strict() after a client sweep found every PATCH body modeled (Editions' unconditional isbn13/isbn10/asin included — they are modeled fields, so .strict() does not break edition saves); one test that pinned the workId strip-behaviour was updated to pin the refusal instead; new test asserts unrecognized_keys names the offender on all three. Web: EditTitleAuthor (live check keeps doc ids, Save disabled until it resolves, restamp-Firestore-FIRST then PATCH+keyMove, provisional light mode, ApiError.detail surfaced, doc-id drift documented as the owner's accepted wart per the dispatcher's instruction); Changes panel; Reviews held-state + reviews-seen piggyback; Add-without-author as an explicit button on scan lines and AddWork (mode survives the preorder prompt's re-run); /works/match authors now optional = provisional-key match (probed live, 4 cases); Needs→Author option + third facet; "No author" card mark; null-authors rendering across WorkList/Shelf/WorkPage. 335/335 tests, typecheck all workspaces, vite build clean.

[2026-08-13T09:20-07:00] DONE  Sentinel containment sweep — found while writing the previous UNSOLVED and fixed instead of logged: seven queries under packages/db SELECT `w.authors` raw, bypassing `toWork`, and would have printed the literal `?unknown` as an author's name (wishlist, details queue, auto-applied list, CSV export, watches list, related works, series ladder, crowdfunding provenance). All now fold it at the SQL boundary — `NULLIF(w.authors, '<sentinel>') AS authors`, the same mapping toWork does — and every touched interface plus its api.ts mirror is honestly `string | null`. Deliberately NOT folded: the JSON backup export (raw rows are the point of a backup), `listWorksForMatching` (the matcher needs a string; `foldAuthorNames` folds the sentinel to 'unknown', same fate as a real "Unknown" credit), and `aliases.ts`'s internal redundancy check. Also read the FIRST REAL change_log corpus (19 rows / 6 batches, production, read-only) per the dispatcher's pointer and reworked the Changes panel on what it showed: grouped by batch_id (flat, the merges read as 19 unrelated lines; grouped, six events — the design's §4.1 claim tested against real data), batch ids rendered verbatim never parsed (they are hand-written slugs, not UUIDs), empty-string olds spelled `""`, and notes rendered verbatim because 'KEY MOVE, no restamp performed' IS the record. Confirmed my keyMoveEvidence LIKE ('reviews restamped: %', excluding ': 0') does NOT count those two un-restamped moves (works 141/328) as carried-move evidence — correct in the safe direction, they prove nothing about reviews existing. 335/335, typecheck, build clean.

[2026-08-13T08:55-07:00] UNSOLVED  What was NOT verified by execution, explicitly: (1) the browser ceremony end-to-end — the restamp needs a signed-in Firestore session and a book with live reviews; a curl cannot fake either. The server half of every refusal it can hit WAS exercised; the untested seam is countReviewDocs→restampReviews→PATCH interleaving in a real browser, which the design's §9.5 already named as the build task's residue. Settled by: one attended retitle of a low-stakes reviewed book on the dev lane before this deploys to prod, watching the network tab. (2) The Changes panel and held-state UI were verified by typecheck+build+the real corpus's shapes, not by driving a browser. (3) Sentinel keys in the bulk /observed sweep are dropped silently — `considered` still counts them; if that reads as a lie in practice, subtract dropped from considered (one line in reviews.ts). (4) A merge's reparenting rows live under the edition/copy entities and the merged-away work's id, so the SURVIVING book's Changes panel does not show its own merge — real case in the corpus (291 and 333 show nothing). A cross-entity event view is a separate read with its own paging (listChangesForEntity's header says so); not smuggled in. (5) The details queue's empty state (queue now 0/62): the page's own empty rendering was not driven in a browser; listWorksNeedingDetails returning [] renders whatever DetailsQueuePage always rendered for no rows — eyeball it after deploy.

## 8. Budget rules

From the global usage rules, and they are not optional:

- Pause the **session** window at **89%**
- On the **weekly** limit: **stop starting new subagents at 93%**, keep working
  conversationally only to **97%**
- ⚠️ **A subagent's cost is invisible until it lands** — one landed at 372k tokens
  in a single lump. **The granularity of risk is one agent, not one tool call.**
  Pulse-check usage whenever an agent is in flight, and state the figure when
  reporting so a stale or failed read is visible rather than assumed fine.
- Fable's own allowance is separate; the rules above still apply to the
  all-models pool that the dispatching session spends.

### ⚠️ 6.1 Fable does NOT watch its own usage — the dispatcher does

Asked directly by the owner, 2026-08-13, and the answer is no. Two reasons, and
they are the reason the rule is written the way it is:

1. **The cost is invisible until the agent lands** — that is the entire failure
   mode, and it is invisible *to the dispatcher*. An agent that reads the usage
   page mid-run reports a figure that does not yet include its own consumption, so
   a self-check is structurally incapable of catching the thing being guarded
   against.
2. The global rules say outright to **use a background timer rather than a
   dedicated monitor agent**, because an agent costs more context than the tool
   calls it would replace. A self-monitoring agent is that anti-pattern twice.

**So: the dispatching session pulse-checks between dispatches and states the
figure when reporting.** ⚠️ And note that Fable being on a separate allowance makes
its work *cheap on the main pool, not free* — the dispatcher still pays for the
prompts it sends and the reports it reads.
