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

[2026-08-13T00:15-07:00] UNSOLVED  Five items in the design's §9, headline two: (1) title-edit doc-id drift — a retitled book's future library-side review lands under a new slug beside the person's old doc; tried stable ids (impossible, `bookIdFromTitle` built every production id) and id rewrites (delete+create of other people's docs, breaks audiobook `getReviews`); settles with a measured retitle-of-reviewed-book frequency or a dedupe-on-write in `reviewDocFor`. (2) the carry procedure depends on Firestore's shape-only rules (no `request.auth`) letting any client restamp anyone's review doc — if `reviews` rules are ever hardened the restamp breaks silently; settles with a PLATFORM.md decision on whether `reviews` ever gets auth rules (and then the carry needs the service account this estate refuses to hold). Also unverified by execution: the migration SQL was never dry-run against local D1 (design-only task) and the restamp→PATCH interleave has never been exercised.

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
