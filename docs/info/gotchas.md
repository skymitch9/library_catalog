# Gotchas — library_catalog   (Information Reference)

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-17** — the SDK-`Error.message` entry was verified
> that day against the installed SDK (`@anthropic-ai/sdk` 0.116.0) and against
> the two live D1 rows it describes. The **other** findings still carry their
> own dates and were **not** re-checked; they were extracted verbatim from
> `docs/TODO.md` on 2026-08-16 during the three-way split.
> ⚠️ The worktree/sync-script entry below was **added 2026-08-23** and was
> measured that day; nothing else here was re-checked then.

The traps that cost real time, kept **findable by symptom** rather than by the
day they happened — which is the whole reason they left the work log. Each is
reproduced whole, with its original reasoning intact.

⚠️ Some of these also appear in the repo's `CLAUDE.md` (the first-ten-minutes
sheet). That is deliberate duplication of the *headline* only; the full
reasoning lives here.

### 🔴 "The work id checks out on both instances" — WORK IDS ARE PER-INSTANCE, and they collide with DIFFERENT BOOKS — found 2026-09-02

**Symptom.** A script, a link or a check that names a work id runs clean against
MAIN and clean against `--friend`, and you conclude the id is good on both.

**It is not the same book.** The two deployments are two separate D1 databases
whose ids were allocated independently. Measured 2026-09-02:

| id | MAIN (`library.heygabi.ai`) | FRIEND (`padhard.heygabi.ai`) |
|---|---|---|
| 229 | *The Wandering Inn* | *Divine Rivals* |
| 230 | *No Killing Goblins* | *Ruthless Vows* |
| 231 | *Fae and Fare* | *River Enchanted Deluxe Collector's Edition* |
| 232 | *Immortal Games* | *Priory of the Orange Tree* |

⚠️ **The dangerous case is not a failure, it is a PASS.** A check pointed at the
wrong instance finds a work that exists, and if it happens to hold a matching
row it reports **green for a link to the wrong book**. A red result would at
least make somebody look.

**What to do.** Any id-bearing artifact says which instance it belongs to, and
anything that consumes it refuses the other rather than answering about books
nobody meant. `scripts/check-cross-catalog-overrides.mjs` is the worked example:
it exits 2 on `--friend`, printing the table above, because the overrides file
names MAIN ids and the audiobook site links to `library.heygabi.ai` and nowhere
else.

⚠️ **Not the same as `--friend` threading** (the audit HIGH that
`scripts/test/friend-threading.test.mjs` guards). That one is a `--friend` run
silently reading or writing MAIN. This one is a run that reaches exactly the
instance it was asked for and answers a question that only made sense on the
other one.

### ⚠️ A GIT WORKTREE CANNOT TYPECHECK OR TEST — five sync scripts fail first — found 2026-08-23

**Symptom.** In a fresh `git worktree` of this repo, `npm run typecheck` and
`npm test` both die before doing anything, on:

```
sync-universes: Cannot find the catalog-platform checkout.
Tried:  C:\lcw\catalog-platform  ·  C:\catalog-platform
```

**Cause.** `pretypecheck` and `pretest` run five `scripts/sync-*.mjs`, and they
look for `catalog-platform` **next to the checkout**. A worktree under
`C:/lcw/<name>` has no sibling repo, so every one of them fails. It looks like
a broken worktree and is not.

**Fix — name the checkout, do not clone a second one:**

```bash
CATALOG_PLATFORM_DIR="C:/Users/nbasl/OneDrive/Documents/vs-code-repos/catalog-platform" npm run typecheck
```

**Two more that bite in the same session:**

| | |
|---|---|
| `npm ci` | fails on a stale lockfile — use `npm install`, then `git checkout package-lock.json` so the churn is not committed |
| `wrangler dev` | refuses to start with *"assets.directory … does not exist"* until `npm run build` has made `apps/web/dist` — which itself needs `CATALOG_PLATFORM_DIR` |

### ⚠️ A DOC CAME BACK RE-SAVED IN CP1252 AND HALF ITS MEANING WAS GONE — found 2026-08-23

**Symptom.** `git diff docs/TODO.md` shows **440 insertions / 392 deletions** on
a file nobody meant to rewrite. Every `—` reads `�`, every `⚠️` reads `??`, and
the leading BOM is gone. It looks like a colossal edit and is mostly not one.

**What actually happened.** The file was re-saved in the system ANSI codepage
(cp1252). Characters cp1252 cannot represent were replaced with literal `?` —
so **the emoji are destroyed, not merely displayed wrongly.** No re-decoding
recovers them; only the last good copy does. One code fence lost a character
outright: `` `npm run …` `` became `Run \npm run …`, i.e. the `n` was eaten as
an escape.

⚠️ **The trap inside the trap: the diff was NOT purely cosmetic.** Buried in
those 832 changed lines were a real new section and, at the very end, three
feature requests **the owner had typed in himself**, headed *"This was added by
the user not the Ai."* A `git checkout` to "undo the encoding mess" would have
destroyed them silently — the diff is far too noisy to read by eye, so the
damage and the content are indistinguishable at a glance.

**How to tell them apart, in one command.** Reduce both versions to ASCII
alphanumerics and compare line by line: encoding damage vanishes under that
reduction and a real edit does not.

```js
const red = t => t.split(/\r?\n/).map(l => l.replace(/[^A-Za-z0-9]/g, ''));
// lines where red(HEAD)[i] !== red(WORKING)[i] are REAL edits, not encoding
```

**The recovery, in order.** Copy the damaged file somewhere safe **first**;
read every line the reduction flags as genuinely new and keep it in hand;
restore the file from `HEAD` (the only intact UTF-8 copy); re-insert the new
content by hand. Verify with a replacement-character count of **zero** and a
positive check that a known emoji survived — an absence test alone passes on an
empty file.

**What wrote it was never identified**, and that is recorded rather than
guessed. `find_covers.ps1` (untracked, repo root) was the obvious suspect and is
innocent: it writes only `found_covers.json`, and explicitly with
`-Encoding utf8`. Windows PowerShell 5.1's `Set-Content`/`Add-Content` default
to ANSI, so any script or editor writing a doc without naming an encoding can do
this.

⚠️ **This is the same class the estate already killed once on the Python side**
— `PYTHONIOENCODING=utf-8` was set globally in the pipeline task environment
(audiobook K6, 2026-08-21) precisely so a cp1252 console could not crash a
script. That fix does not cover a file being *written* in ANSI by anything else,
which is why this one still bit.


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

## The Anthropic SDK's `Error.message` IS the raw JSON body

**Found 2026-08-17 — the owner read it off a live page**, on padhard's
Missing/queue screen, hours after the fix above shipped:

```
400 {"type":"error","error":{"type":"invalid_request_error","message":"You have
reached your specified API usage limits. You will regain access on 2026-09-01 at
00:00 UTC."},"request_id":"req_011Ce8wV2ToKAQnsf1Ahq1V6"}
```

⚠️ **`describeError` did exactly what it promised and the defect shipped
anyway.** The SDK builds its message as `` `${status} ${JSON.stringify(body)}` ``
whenever the body has no **top-level** `message` field — and the error envelope
never does, because its sentence is nested at `error.error.message`
(`node_modules/@anthropic-ai/sdk/core/error.js`, `APIError.makeMessage`). So the
first branch found a real, non-empty `string` and returned it. **A worded output
is not the same as a worded message**, and no amount of "never `[object
Object]`" testing catches that.

The fix is `packages/core/src/lookup-errors.ts` — `classifyLookupFailure` /
`wordLookupError` — which names three provider failures in words: the spend cap
(400 `invalid_request_error` whose text carries the limit vocabulary, with the
reset date **read** out of the message, never computed), the 429, and the 401.
It runs **first** in the Worker's `describeError`, ahead of all the generic
unwrapping.

⚠️ **Why it lives in `@lc/core` and not beside either caller: `error_message` is
PERSISTED, so a store-time fix reaches no row that already exists.** Runs 5 and 6
on `library-catalog-2nd` hold the body above and always will. Both layers call
the same function — the Worker at store time, `DetailsQueuePage`/`ScanJobsPage`
at render time (`wordLookupError`) — so the sentence cannot drift between them
and a legacy row reads the same as a fresh one. Any future column holding a
provider error needs the render-side call too; `wordLookupError` guarantees its
output contains **no brace**, whatever it is handed.

⚠️ **It refuses to guess.** An ordinary 400 ("roles must alternate") returns
null and keeps reading like the bug it is; the bare word *limit* is not enough
(`max_tokens exceeds the model's limit` is a defect, not an allowance). Three
tests exist purely to pin what must NOT be claimed.

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

---

## "The deploy did not ship" — but the origin is fine and the EDGE is stale

**Found 2026-08-17**, verifying the content-notes deploy on both instances. Two
different traps fired within a minute of each other, and each one *looked
exactly like a bad deploy*.

### 1. `https://<host>/` can be a Cloudflare edge HIT despite `Cache-Control: no-cache`

The live page named `assets/index-C6qTDWn7.js` — a bundle from a previous
deploy, whose asset no longer exists, so fetching it fell through to the SPA
`index.html` and every grep for new code came back **0**. Response headers said
`CF-Cache-Status: HIT`, `Cache-Control: no-cache`.

⚠️ `no-cache` means *revalidate*, not *do not store*, and the edge served the
stored copy anyway. `index.ts` sets that header deliberately (a cached
index.html pins a browser to the previous deploy's JavaScript — the Safari
failure recorded there), and it is still not a guarantee.

**The check that works:** add a cache-buster.

```bash
curl -s "https://library.heygabi.ai/?cb=$RANDOM" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

With the buster it named the freshly built bundle, and that asset answered 200.
Same shape as the `ebooks.json` edge-cache item in `TODO.md`: **origin clean,
edge stale**, and only a busted URL tells them apart.

### 2. `curl -o <file>` silently returns nothing for a ~900 KB asset here

The follow-up check wrote the bundle to a file and grepped it. The file was
either 3,989 bytes (the SPA fallback, from trap 1) or absent, with
`http=000 size=0` — the Git Bash curl artifact this household has already met
(`curl -o /dev/null` reporting exit 43 / status 000 against a host that is
plainly up).

**Pipe instead of writing**, and the same URL answers correctly:

```bash
curl -s "https://library.heygabi.ai/assets/index-BMOsf5fN.js" | grep -c "Content notes"
```

⚠️ Both traps produce a **zero**, and a zero is exactly what a genuinely failed
deploy produces. Before believing one, bust the cache and drop the `-o`.

## "The failed count never goes down" — it is a lifetime total (2026-08-19)

**Symptom:** the details queue at `/queue` shows a `3 failed` tile that never
changes, and nothing on the page is red.

`data.spent.errors` comes from `runTotals`, which counts every `research_run`
row with `status = 'error'` **ever**, exactly like the token and cost tiles
beside it. It is not a count of anything currently broken. On padhard the three
were all from the monthly-cap incident of 2026-08-17, and every one had already
been superseded by a later successful run — two of them by the hourly sweep the
same night, with nobody pressing anything.

⚠️ **The question the tile looks like it is answering is a different query:**

```sql
SELECT w.id, w.title FROM work w
  JOIN research_run r ON r.id = (SELECT MAX(id) FROM research_run x WHERE x.work_id = w.id)
 WHERE r.status = 'error';
```

Empty means no book is showing a failure — which is what a person means by
"is anything broken". Run that before believing the tile. The label now reads
`failed, all time` for this reason.

⚠️ Related, and the reason this cost real time: a tech-debt note in `TODO.md`
told a future session to confirm a cleared API key by *"pressing Look again on
either FAILED row (runs 5/6)"*. Those rows had not been on the page for two
days — the works had been re-run and left the queue — so the instruction was
unfollowable and its premise ("those rows never retry themselves") was wrong.

---

## "It's a gitignored scratch directory, so it's safe to delete" — 2026-08-21

**Symptom:** you are about to `rm -rf` a `.claude/worktrees/` tree, or any
ignored working directory, on the reasoning that git ignores it so nothing in
it can matter.

**What happened.** Sixteen stale agent worktrees were queued for deletion after
an audit found their `apps/worker/.wrangler/tmp/*.js.map` build artefacts carry
an **inlined live `ANTHROPIC_API_KEY`** — a wrangler dev source map embeds
`.dev.vars` values, so an ignored artefact had become a duplicate credential
store. Deleting them was correct.

Fifteen were pure duplicates, and the check that proved it is worth copying:

```bash
for wt in .claude/worktrees/*/; do
  sha=$(git -C "$wt" rev-parse --short HEAD)
  git merge-base --is-ancestor "$sha" main && echo "$wt in-main"   # no unique history
  git rev-list --count main.."$sha"                                # unique commits
  git -C "$wt" status --porcelain -uall | wc -l                    # uncommitted work
done
```

⚠️ **The sixteenth held `scripts/audit-universes.mjs` — 574 lines, written to an
explicit owner instruction, in ZERO commits and absent from the main tree.** It
existed in exactly one place on the machine: untracked, inside a gitignored
directory that was one command away from deletion. `rm -rf` would have destroyed
it with no trace and nothing to restore from — not git, not the R2 docs backup
(which only walks `docs/`), not the blob archive.

**The rule, which is the delete-side twin of "establish who wrote it before you
revert a dirty file":** *a directory being ignored by git says nothing about
whether the work inside it exists anywhere else.* Ignored means "git was told
not to look", not "nothing here is unique". Run the three-line check above and
rescue anything untracked BEFORE removing, every time.

**Two Windows/OneDrive mechanics that will also bite:**

- `git worktree remove --force` **deregistered all fifteen and then failed to
  delete a single directory** (`Permission denied`, OneDrive holding handles).
  That is the worst intermediate state available: git no longer lists them, so
  they look gone, while the files — including the key-bearing source maps — are
  still on disk. ⚠️ **Verify with `ls`, not with `git worktree list`.** Finish
  with a PowerShell `Remove-Item -Recurse -Force` after clearing attributes.
- `du -sm` over one of these trees ate a two-minute command timeout on its own.
  Do not measure the size first; just delete, and check the count after.


## "`op inject` says my template has an invalid secret reference I never wrote" — 2026-08-26

**Symptom.** `npm run secrets:push:op` dies before touching Cloudflare with
either of these, naming something that is not in any of the real lines:

```
[ERROR] invalid secret reference 'op://pointers': too few '/': secret references
        should have at least vault, item and field specified
[ERROR] parsing error at 4:53: only secret references or quoted strings can be
        enclosed in unescaped {{ }}s
```

**Cause.** ⚠️ **`op inject` parses the WHOLE file, comments included.** It is not
a line-oriented `NAME=` substituter. Both errors above came from the template's
own explanatory HEADER: the first from the phrase *"Names + op:// pointers"* in a
`#` comment (it read `op:// pointers` as the reference `op://pointers`), the
second from a comment that used an empty `{{ }}` to talk *about* the syntax.
Neither line was a template expression; both took the whole resolve down, and the
error named a reference nobody had written on purpose.

**Repair.** Keep comments free of both — no `op://` in prose, no curly braces in
prose. `scripts/op-import-dev-vars.mjs`'s `renderTemplate` generates the header,
so the fix lives in ONE place; the generated header now carries a warning about
itself, and `scripts/test/op-import-dev-vars.test.mjs` asserts that no rendered
line outside a `{{ }}` contains a reference.

**Rule.** A template's documentation belongs where the parser cannot reach it —
in the script that generates it, or in `docs/access/secrets.md`. What goes in the
file itself is the minimum a human needs, written in words the injector will not
mistake for syntax.

⚠️ **Sibling trap, same day, same tool: every `op` process can raise a 1Password
approval prompt a HUMAN must click.** Unanswered it is `authorization timeout`,
dismissed it is `authorization prompt dismissed`, and both look like a broken
install. They are neither — they are a person not at the machine. Batch `op`
calls into as few processes as possible (the import is one Node process; the push
resolves everything with a single `op inject`) and translate the refusal into a
sentence naming the click.

## "I appended a key to `.dev.vars` and the push shipped a corrupted secret" — 2026-08-25

**Symptom.** `printf 'PEER_TOKEN=%s\n' "$(openssl rand -hex 32)" >> apps/worker/.dev.vars`
reported **0** `^PEER_TOKEN=` lines afterwards, and the `secrets:push:both` run
that followed pushed `HARDCOVER_API_TOKEN` to BOTH instances — with the new
`PEER_TOKEN=…` glued onto the end of its value. The Hardcover rung was live-broken
for the ~4 minutes until the repair.

**Cause.** The file had **no trailing newline**, so `>>` continued the last line
instead of starting a new one. Nothing in the push script noticed: a value is a
value.

**Repair (values never read):** `sed -i -E 's/(.)PEER_TOKEN=/\1\nPEER_TOKEN=/'`,
then verify by COUNTS only (`grep -c '^KEY='` = 1 for each, glued = 0,
`tail -c1 | od -c` shows `\n`), then re-push. Live re-test of Hardcover passed.

**Rules.** (1) Before any `>>` into `.dev.vars`, check `tail -c1` for a newline
or write `printf '\nKEY=%s\n'`. (2) Verify structure by counts before pushing.
(3) ⚠️ `grep -c` exits 1 on a zero count, so a `&&` chain that includes a
"glued lines = 0" check kills itself silently — use `|| true` or test the
variable, not the exit code. (4) The mechanical guard is queued in `TODO.md`:
`push-secrets.mjs` should refuse a value that itself contains `[A-Z_]+=`.
