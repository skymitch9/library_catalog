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

## 6. Budget rules

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
