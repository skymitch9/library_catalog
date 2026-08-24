# library_catalog — Known Issues, Waivers & Exceptions

> **Audience:** Claude/Kiro sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-23** — every entry below was re-measured that day
> against production and the repo; four were retired as no longer true.
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

## KI-6 · The CREATE schemas are not `.strict()` — a stray key is silently stripped — `WATCHING`

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

