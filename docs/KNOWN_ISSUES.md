# library_catalog — Known Issues, Waivers & Exceptions

> **Audience:** Claude/Kiro sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-21**.
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

## KI-1 · `npm run typecheck` is RED, in files nobody has touched — `ACCEPTED`, and it blocks other work

**Symptom.** `npm run typecheck` fails with **7 errors** across three files.
Measured 2026-08-21:

| File | Error |
|---|---|
| `apps/web/src/pages/WorkPage.tsx:448` | `TS2339` — `peerHoldings` not on `WorkDetail` |
| `apps/worker/src/lib/peer-push.ts:37,147,148,149` | `TS2352` x4 — `Env` to `Record<string, unknown>` |
| `apps/worker/src/routes/catalog.ts:348,352` | `TS2551` x2 — `work_key` vs `workKey` |

**Why tolerated.** All three files are **unmodified in the working tree**, so the
errors pre-date current work; runtime tests pass.

**What would change it.** ⚠️ **Kiro item K2, and it is ranked early on purpose:
it GATES the branch merges (K11).** Merging into a red tree means new breakage
cannot be told from old, so those merges cannot be verified until this is zero.
Removal condition: `npm run typecheck` exits 0.

---

## KI-2 · Three feature branches are unmerged and all three conflict — `ACCEPTED`

**Symptom.** `feature/completeness-wishlist-relations` (3 commits),
`feature/series-overrides` (2) and `feature/openlibrary-ids` (1) sit unmerged,
last touched 2026-08-10.

**Why tolerated.** All three conflict with `main` — measured 2026-08-21 with
`git merge-tree --write-tree`, not guessed. The worst conflicts across 8+ files
in `apps/web`.

**What would change it.** KI-1 first, then one branch per session. Detail and
suggested order: [`TODO.md`](TODO.md).

---

## KI-3 · `dl_ebooks` is a dead column that is still standing — `ACCEPTED`

**Symptom.** A column deprecated by migration 0010's own comment still holds
`1`s from its one-day life.

**Why tolerated.** ⚠️ Re-adding it to `COLS` would **resurrect ghost grants** —
permissions nobody intended, from data nobody remembers. The guard comment is
the current protection.

**What would change it.** A decision about whether to zero the values. Until
then the column is inert **only because nothing selects it** — that is a
convention, not a constraint.

---

## KI-4 · The donor refuses to hand out the printed volume number — `ACCEPTED`

**Symptom.** `routes/donor.ts` gives `seriesIndex` (sort position) but not
`series_index_display`, so a receiving instance cannot show `Volume 07`.

**Why tolerated.** The original argument — "the caller's copy has its own cover"
— is now the odd one out: since 2026-08-19 both writers derive the column, and
the catalogue holds **81 hand-quoted forms** that are strictly better than a
derivation and are not offered.

**What would change it.** Kiro item **K7**. It needs a key wider than
`DetailField`, which is why it was left. Quality, not convergence: nothing is
broken today.

