# library_catalog — docs map

> **Audience:** Claude/Kiro sessions first, the owner second.
> **Status:** ⚠️ **MIXED** — parts of `docs/` are tracked, parts are not. Check `git check-ignore` before assuming.
> Last verified: **2026-08-21** (the tree below was measured that day).
>
> 📐 **The rules for this tree — filing, formatting, when to move things — live
> in `catalog-platform/docs/DOCS_STANDARD.md`, and ONLY there.** All four repos
> follow the same shape. Read it once; it is not restated here.
> ⚠️ It lives in that repo because `catalog-platform/docs/` is the only one of
> the four trees kept in git, so it survives a clone when this one does not.

**What this project is:** the physical and print book catalogue at `library.heygabi.ai`, its second instance (`padhard`), the ISBN/barcode ladder, covers and series, the GABI site panel, and the ebook viewer work.

---

## The tree

```mermaid
graph TD
    R["docs/"] --> RM["README.md<br/><i>you are here — the map</i>"]
    R --> T["TODO.md<br/><i>ACTIVE work only</i>"]
    R --> D["DONE.md<br/><i>dated archive · append-only</i>"]
    R --> K["KNOWN_ISSUES.md<br/><i>accepted defects & waivers</i>"]
    R --> A["access/<br/><i>how to operate it</i>"]
    R --> I["info/<br/><i>how & why it works</i>"]
    R --> AR["archive/<br/><i>superseded docs & data dumps</i>"]
    A --> AI["access/README.md — index"]
    I --> II["info/README.md — index"]
    T -.->|"finished work moves WHOLE"| D
    T -.->|"durable facts move by topic"| A
    T -.->|" "| I
    style T fill:#d9a441,color:#000
    style K fill:#b3453a,color:#fff
```

---

## Start here

| If you want to know… | Read |
|---|---|
| **What is active right now** | [`TODO.md`](TODO.md) — its 🧰 Tech debt section is the "later" pile |
| **Is this a bug or deliberate?** | [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) |
| **Current state / how to pick up** | [`HANDOFF.md`](HANDOFF.md) |
| **How do I deploy / roll back** | [`access/deploy.md`](access/deploy.md) · [`access/rollback-points.md`](access/rollback-points.md) |
| **🔴 Rebuild from nothing** | [`access/RECOVERY.md`](access/RECOVERY.md) |
| **The data model, routing, covers, series** | [`info/README.md`](info/README.md) |
| **A trap I keep hitting** | [`info/gotchas.md`](info/gotchas.md) — titled by symptom |
| **Why a call was made that way** | [`info/decisions.md`](info/decisions.md) |
| **Was this already solved** | [`DONE.md`](DONE.md) |

## Where the rest of the estate is

| Repo | Covers |
|---|---|
| `catalog-platform/docs/` | 📐 **The docs standard**, estate SSO, GABI, `/status`, backups — and the only tree in git |
| `bookbuddy/audiobook_catalog/docs/` | The audiobook pipeline, the shelf server, ebooks |
| `boardbuddy/Board_Game_Catalog/docs/` | The board-game catalogue |

⚠️ **This tree is not in git** (wholly or partly), so it exists on the owner's
machine and nowhere else. All four are backed up to R2 by
`catalog-platform/scripts/backup-docs.mjs`; the restore was drilled 2026-08-21.
Runbook: `catalog-platform/docs/access/backup-restore.md` §6b.
