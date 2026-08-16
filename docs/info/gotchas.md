# Gotchas — library_catalog   (Information Reference)

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-16** — extracted verbatim from `docs/TODO.md`
> during the three-way split; the individual findings carry their own dates
> and were **not** re-checked against the live system on that date.

The traps that cost real time, kept **findable by symptom** rather than by the
day they happened — which is the whole reason they left the work log. Each is
reproduced whole, with its original reasoning intact.

⚠️ Some of these also appear in the repo's `CLAUDE.md` (the first-ten-minutes
sheet). That is deliberate duplication of the *headline* only; the full
reasoning lives here.

### ⚠️ THE 1PASSWORD OVERLAY WAS EATING THE SAVE CLICK — found 2026-08-13

**This explains most of tonight's "silent save failures", and it is not a bug in
the app.** Several books were typed into `/add?mode=type`, the form looked right,
Save looked enabled, the click landed — and no row appeared.

The accessibility tree carried
`status "1Password menu is available. Press down arrow to select."` while the
extension's autofill overlay sat over the form. The Save click went to the overlay.

⚠️ **The fix is one keystroke: press `Escape` first, then click Save.** *Animal
Heroes* failed twice and went in on the very next click after an Escape. Anything
driving this form — a person or an agent — should dismiss the overlay before
saving, and **a save that appears to do nothing should be suspected of this before
anything else.**

⚠️ It also explains the *earlier* misdiagnosis: the "hydration" theory recorded
below fits some cases, but the overlay fits all of them, including the ones with
long waits where hydration cannot have been the cause.

---

### ⚠️⚠️ ONE BARCODE, SIX EDITIONS AND SIX COPIES — the OL work-record bug, 2026-08-13

**The worst bug of the session.** The owner: *"Space knight barcode scanned caused
a weird duplicate record… we have all of space knight and tamer already
recorded."* It is not a duplicate — it is an **aggregate**.

Scanning one Space Knight barcode produced work **302**, titled with the bare
series name *Space Knight*, carrying **six editions with six unrelated ISBNs and
six copies**:

`9781951641061` · `9781951641078` · `9781951641085` · `9781951641139` ·
`9781951641696` · `9781951641719` — 2020 and 2024 printings, all
`source = openlibrary`.

⚠️ **So the catalog claimed the household owned six copies of a book that does not
exist**, while the nine real volumes (works 249–255, 69, 70 — *Space Knight Book
1*…*9*) sit there with **no ISBNs at all**. The scan hoarded their identifiers
onto a phantom.

**Same bug, same author's barcodes, three works:**

| id | title | editions | copies | verdict |
|---|---|---|---|---|
| 302 | Space Knight | 6 | 6 | ✅ deleted |
| 301 | Tamer | 1 | 1 | ✅ deleted — authors even read *"Brian King, Michael-Scott Earle"*, a giveaway that the record is an aggregate and not one book |
| 300 | Monster Empire | 2 | 2 | ✅ deleted 2026-08-13 on the owner's word (*"delete it"* — see the owner-blocked table below) — **verified absent from production 2026-08-14**; the real volumes live as #45 and #256 |

**Diagnosis.** The ISBN ladder resolved to an Open Library **work-level** record
rather than a specific edition, and the add path then created *an edition for
every ISBN that OL attaches to that work*, plus **a copy per edition**. The rule
it breaks: **one barcode is one edition and at most one copy.** A work record on
Open Library aggregates every printing of every volume in a series, so any series
whose OL work is filed that way will do this again.

⚠️ **Suspect any work whose title is a bare series name with several editions.**
That is the signature — *Space Knight*, *Tamer*, *Monster Empire* all had it, and
all three were created by scanning within a few minutes.

**Deleted by SQL, because there is no other way** — see the item below.

---

### ⚠️ Two research findings that CORRECT earlier assumptions — 2026-08-13

Both came back from a research agent and both reverse something already recorded.

**1. ⚠️ The two Korean Teenieping series are DIFFERENT. Do not merge them.**
The publisher 아이휴먼 runs a separately numbered 동화 line per sub-brand:
| sub-brand | series | 
|---|---|
| 슈팅스타 캐치! 티니핑 | 마음을 **채우는** 동화 |
| 하츄핑 캐치! 티니핑 | **하츄핑 마음 동화** |
| 프린세스 / 반짝반짝 / 알쏭달쏭 | 마음을 가꾸는 / 마음 성장 / 마음을 여는 동화 |

So **#195** (`9791165384548`) is *마음을 채우는 동화* — its current filing is
**correct** — and it is **volume 8**, not unnumbered. The new book
(`9791165384678`) is *하츄핑 마음 동화* **volume 2**, a different line only two
volumes deep. The shared `979-11-6538` prefix is a **publisher block, not a series
marker** — that was the trap.

**2. ⚠️ *Who Goes Roar?* is NOT publisher-authored — the writer is Christie Hainsby.**
Make Believe Ideas' own site credits "Writer: Christie Hainsby, Illustrator:
Shannon Hays". MBI's house style omits the writer from the cover while crediting
the illustrator, so the physical book showing only "Illustrated by Shannon Hays"
is **expected, not evidence of publisher authorship**. My `Make Believe Ideas` on
#269 is wrong and should be **Christie Hainsby**.

Series is probably **Busy Bees** (MBI's UK site titles it so) but ⚠️ unnumbered,
and possibly UK-edition-only — our copy carries no Busy Bees branding, so treat it
as probable, not settled.

⚠️ ISBN `9781836422808` returns **zero** results anywhere, yet both check digits
are valid and `978-1-83642` is MBI's current prefix — so it is a **2024–25 reprint
too new to be indexed**, not a bad number. Catalog the year as **2019** (first
publication, and what the copyright page says).

---

### ⚠️ `wrangler dev` leaks — 212 processes, 15.6 GB, cleared 2026-08-13

The owner noticed the local dev server still up "almost 3 hours" after this
session had stopped using it. ⚠️ I had reported it stopped: the harness task did
stop, the `workerd` behind it did not. It was also much worse than one server.

**Diagnosis:** `wrangler dev` does not die with whatever started it. Killing the
shell/task/agent leaves `wrangler` **and** its `workerd` child alive, still
holding the port. Accumulated over days: **212 processes, 15.64 GB**, ~30 leaked
dev servers on ports 8787–8910 — **124 from the main checkout, 20 from another
session's scratchpad, and the rest one per `.claude/worktrees/agent-*`**, i.e.
every subagent that ever started a dev server left one behind.

**Cleared:** 191 killed, 21 already gone as children of a killed parent. 0
node/workerd left, no dev port held, **16.34 GB free of 63.18 GB**.

⚠️ Claude Code runs as **`claude.exe`, not `node.exe`** — verified by walking the
parent chain — so a node/workerd sweep cannot kill the session. The editor's
language servers *are* node, so `kiro|tsserver|extensionHost` were excluded.
The kill one-liner is now in `CLAUDE.md` under "Verifying anything".
