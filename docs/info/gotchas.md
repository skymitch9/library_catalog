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

---

## "npm run db:migrate printed nothing" — silence is a FAILED migration, not a quiet one

**Recorded 2026-08-17, from a real sequencing slip.** A remote migration run
printed only the wrangler log-file line and no result table; the conductor
read the silence as success, ran the backfill (which threw — the table did
not exist), and DEPLOYED — shipping worker code that reads `ebook_holding`
while the table was still missing. Migrate-before-deploy was violated for
about ninety seconds; health stayed 200 and the household was asleep, so
nothing user-visible is known to have failed, but that was luck.

⚠️ **The rule: a migration is applied when you have seen its ✅ row in the
result table, or `wrangler d1 migrations list --remote` no longer lists it.**
Silence, an empty tail, or the UV teardown assertion are all FAILURE shapes
on this machine (see the wrangler-exit-code gotcha above). Do not run the
next step — least of all a deploy — on an unread migration result.


---

## `String(err)` is `[object Object]` — and it gets PERSISTED

**Found 2026-08-17.** Four places in the Worker wrote the idiom
`err instanceof Error ? err.message : String(err)`. The second half is the
trap: the Anthropic SDK throws plain objects (`{ status, error: { message } }`),
a parsed JSON error body is a plain object, and `String({})` is the literal
string `[object Object]`.

⚠️ **The reason it is worse here than in most codebases: two of those four
sites WRITE THE STRING TO D1** — `scan_job.error` and
`research_run.error_message` — and both are read back on screen days later.
The real cause is unrecoverable from that row.

The fix is `apps/worker/src/lib/describe-error.ts`, now the one implementation:
message-bearing fields, the SDK envelope, nested `cause`, arrays of issues,
custom `toString`, then JSON — never `[object Object]`, never a bare status
number, never empty. `describe-error.test.ts` pins every shape.

⚠️ **There are TWO `describeError`s and they are NOT interchangeable.**
`apps/web/src/lib/errors.ts` decodes an `ApiError` *status* into role-aware
words for a screen; the Worker's decodes a *thrown value* for a log line, a D1
row or a `detail` field. Merging them would put role vocabulary into messages
where no role was involved — which is the next gotcha.

---

## A 503 that reads like a permission problem

**Found 2026-08-17.** The scan endpoints answer **503** when
`ANTHROPIC_API_KEY` is missing or rejected, and the estate rule is explicit:
*a network or server failure is NOT a permission failure — mislabelling an
outage sends people asking for access they already have.*

Both halves were wrong. Server-side the message was written for an operator
("Set ANTHROPIC_API_KEY in .dev.vars"), which tells the person holding the
phone nothing about whether it is their fault. Client-side was worse: `describeError` in
`apps/web/src/lib/errors.ts` mapped *every* 503 to `"Couldn't check your access
right now."` — wording that belongs to `estate_unreachable` alone — and ignored
the body, so a scan outage could not say anything else.

**Both halves are now fixed (2026-08-17).** The client half reads the body:
`scan_unavailable` with a worded `detail` surfaces that sentence; everything
else keeps the access wording, so an unrecognised 503 still gets words rather
than a bare status. ⚠️ The decision lives in `apps/web/src/lib/error-wording.ts`
— a leaf with **no imports** — for the reason in the next section, and
`apps/web/test/errors.test.ts` pins both directions.

Worker side is fixed: `SCAN_UNAVAILABLE_MESSAGE` / `SCAN_KEY_REJECTED_MESSAGE`
in `lib/vision.ts` each say what happened, what it needs (an *operator* sets
the key), and that it is not about the person asking; the route answers
`error: 'scan_unavailable'`, distinct from the 403 `forbidden` that
`requireCapability('scanPhoto')` returns, so the two are told apart by code and
not by status alone.

⚠️ **Keep the four causes four**: not signed in / awaiting approval /
insufficient role / service unavailable. They have four different fixes, so
they need four different sentences. `lib/vision.test.ts` and the
`scan-jobs.test.ts` block assert *both* sides — the message must say the
operator half AND must not contain the vocabulary the other three own.


---

## A web test dies at import with "Cannot read properties of undefined (reading 'VITE_…')"

**Found 2026-08-17**, writing the client half of the 503 fix. The symptom is a
test file that fails *whole* — no assertion runs, no test name is printed, just
a `TypeError` at module load:

```
apps/web/src/lib/firebase.ts:55
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '…'
TypeError: Cannot read properties of undefined (reading 'VITE_FIREBASE_API_KEY')
```

**`import.meta.env` is Vite's, not the runtime's.** `npm test` runs `tsx`, where
it is `undefined`. The import chain does the damage:
`lib/errors.ts` → `api.ts` (for `ApiError`) → `firebase.ts` → boom. So **any**
web test that imports a runtime value from `api.ts` — or from anything that
reaches it — dies before it can assert.

⚠️ That is why `other-versions.test.ts` imports only a **type** from `api.ts`:
type imports are erased, so they cost nothing at runtime. The fix when a real
value is needed is to put the decision in a leaf module with no imports and test
that (`lib/error-wording.ts` is the worked example), not to reach for a mock
loader.
