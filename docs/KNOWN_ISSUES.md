# library_catalog — Known Issues, Waivers & Exceptions

> **Audience:** Claude/Kiro sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-23** — KI-5 was re-measured that day against
> production; four entries were retired as no longer true. KI-6 and KI-7 were
> added the same day and measured against the repo and a LOCAL D1, not
> production.
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
padhard's remaining **15 blank covers** cannot be put through it.

**Measured** 2026-08-23: `apps/worker/.dev.vars` line 85 is
`ANTHROPIC_API_KEY_FRIEND_SAM = ""`.

**Why tolerated — it is not a fault, it is the design.** That line is a
**drop-box**: the runbook pastes a key, pipes it to
`wrangler secret put ANTHROPIC_API_KEY --env friend`, then blanks the line, so
her key can never reach an allowlist by accident. Her Worker holds it and **a
secret store cannot be read back**. ⚠️ The rung deliberately refuses to fall
back to `ANTHROPIC_API_KEY`: padhard's spend goes on HER key, and a silent
fallback would bill her catalogue to the owner.

**What would change it.** The owner pastes her key after the `=` on that line,
the run happens, the line is blanked again — `docs/access/second-instance.md`.
Worst case for the 15: **15 × 6c ≈ $0.90**, on her account.

---

## KI-8 · Work 514 still shows one Elantris audiobook, not two — `ACCEPTED`

**Symptom.** The household owns two *Elantris* recordings and
<https://library.heygabi.ai/works/514> shows one, with no series. Migration 0390
made the schema able to hold both; the MATCHER still finds only one, so the
second row is never written.

**Measured 2026-08-23**, against `audiobook_catalog/site/catalog.csv` lines 995
and 996. `cleanTitleWithSeries` leaves row 996 untouched — the series-suffix
strip only fires when the series name is a suffix, and here *Elantris* is the
whole title of row 995 and the PREFIX of row 996. Folded:

| | key | chars |
|---|---|---|
| ours | `elantris` | 8 |
| row 996 | `elantris tenth anniversary special edition` | 42 |

8/42 = **0.19** against the containment floor of **0.6** — the same floor that
stops *Mistborn* reaching *Mistborn: The Final Empire*. `matchIndexedWorkAll`
removes the early return and loosens nothing, so the refusal stands.

⚠️ **The design note in `docs/TODO.md` part B said the early return was the
cause. It was not** — that is why this entry exists rather than a fix.

**Why tolerated.** Both routes out are decisions, not refactors, and each has a
cost the schema change does not:

- teach `cleanAudiobookTitle` that *"Tenth Anniversary Special Edition"* is
  edition decoration — but that function produces STORED keys (`work_key`,
  Firestore document ids), so changing it is a migration, not an edit; **or**
- move the 0.6 containment floor — which `matching.ts`'s own header permits only
  *with evidence*, and the evidence on file (Firefight, The Wandering Inn) argues
  the floor is if anything too low for books.

**What would change it.** An owner decision on which of the two, **or** a third
route: a `work_alias` row on work 514 for the Tenth Anniversary title, which the
sweep already asks under and which costs one INSERT and no code. That is the
cheapest fix and needs no threshold moved.

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

