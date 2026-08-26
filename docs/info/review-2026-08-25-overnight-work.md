# Code review — the 2026-08-24/25 overnight work

> **Audience:** Claude/Kiro sessions and the owner.
> **Status:** TRACKED.
> **Last verified:** **2026-08-25** — every finding below was traced to the
> exact lines named, in the **committed** history (`git show <hash>`), against
> the working tree at `24d2c04`. `npm run typecheck` clean; `npm run test`
> **1728 pass / 0 fail**, both run 2026-08-25.
>
> ⚠️ **What was NOT checked**, and must not be read as clean:
>
> - **`apps/worker/src/lib/free-details.ts` and `packages/isbn/src/hardcover.ts`
>   in their UNCOMMITTED state** — another agent was editing both during this
>   review. The Wikidata rung was read at commit `84df3e1`; HEAD line numbers for
>   that file have since shifted (the Hardcover rung landed in `893dd37`,
>   in front of Wikidata).
> - **The Hardcover rung (`893dd37`) itself** — outside this review's scope. It
>   is named only where it compounds a finding (F1).
> - **Nothing was exercised against production or against a live D1.** No live
>   read of `library.heygabi.ai` or `padhard.heygabi.ai`; no browser check of the
>   Type dropdown or the cover-search button. Every "live" claim below is a claim
>   about the code, not a measurement of the deployment.
> - **Whether `ANTHROPIC_API_KEY` is actually set as a Worker secret on either
>   instance** — a secret store cannot be read back (KI-7). F2 is a code-level
>   defect whose *trigger* is an absent key; how often that trigger fires is
>   unmeasured.
> - **The Wikidata rung has never been exercised end to end here** — the ~4.6 s
>   figure in `wikidata.ts` is ONE hand measurement by the author, quoted, not
>   re-taken.
> - **No SQL was run.** The `collectionFilter` OR-grouping and the facet
>   variants were read, not executed (there is still no SQL test for either).
> - Repo B: only `037cb35` and `scripts/onedrive-exclude.ps1` were read. The
>   PowerShell script was **not run** — the `-Undo` findings are static analysis.

**Scope reviewed.** Repo A (`bookbuddy/library_catalog`): `1333ff2`,
`1f5f969` + `7189d70`, `2fadc19`, `636c32a` + `ee983e8`, `84df3e1`.
Repo B (`catalog-platform`): `037cb35`, `scripts/onedrive-exclude.ps1`
(`47c3124`).

---

## Findings, most severe first

### F1 · HIGH · CONFIRMED · `apps/worker/src/lib/details-sweep.ts:343`
**`FREE_LADDER_SUBREQUESTS` is still `11` after two new rungs were added to the
ladder it prices.**

`84df3e1` appended `askWikidata` as a fifth rung — one `fetch` to
`query.wikidata.org` (`ctx.isbn13()` is memoised, so it is exactly +1). `893dd37`
then inserted `askHardcover` in front of it — another +1. The constant, its
enumeration comment (which stops at *"rung 4 askGoogleBooks (keyed) 1"*,
`:334`) and the header table at `:83` were all left at **11**. True worst case is
**13**.

`estimateSubrequests` (`:357`) is what `SWEEP_BUDGET` spends against, and the
file's own comment says why this matters: *"an overrun does not throw, it
silently kills the invocation"* (`:331`, repeated at `:349`). The estate has
already paid for this failure mode once — `info/gabi-fixer-design.md` records the
50-subrequest ceiling terminating an invocation with no error.

**Failure scenario.** An AI-mode sweep tick with 2 open fields estimates
`12 + 11 + 6 + 8 = 37` and picks two books; the real cost is `12 + 13 + 6 + 8 =
39` each. The plan believes it is at 74 of 50 — it already refuses two — but the
per-book under-count is what erodes the margin the header says was deliberately
sized. Every AI book is priced 2 short.

**Fix.** `FREE_LADDER_SUBREQUESTS = 13`; add the two rungs to the enumeration
comment and to the header table at `:83`. Better: derive the number from the
`rungs` array length so a new rung cannot land without moving it.

---

### F2 · HIGH · CONFIRMED · `apps/web/src/lib/error-wording.ts:31-37` ← `apps/worker/src/routes/covers.ts:116-124`
**A missing API key on the paid cover search is shown to a person as an ACCESS
problem — the exact bug `error-wording.ts` was created to kill.**

The new route returns `503 { error: 'not_configured', detail: 'No Anthropic API
key…' }`. `describeError` routes every 503 to `describeUnavailable`, which
special-cases **only** `error === 'scan_unavailable'` and otherwise returns
`ACCESS_UNAVAILABLE` — *"Couldn't check your access right now. Try again in a
moment."*

So an owner/admin/moderator who clicks **Search the web for a cover** on an
instance with no `ANTHROPIC_API_KEY` is told their *access* could not be checked.
`error-wording.ts`'s own header states the rule being broken: *"a network or
server failure is NOT a permission failure … it sends people asking for access
they already have."*

**Failure scenario.** Local dev, or any instance where the secret was never put:
click the button → "Couldn't check your access right now." The real cause (no
key) and the actionable sentence the route deliberately wrote are both
discarded. The person retries, then asks for a role they already hold.

**Fix.** Add `not_configured` to `describeUnavailable`'s recognised set (return
`body.detail`), or rename the route's code to `cover_search_unavailable` and
handle it there — and rewrite the `detail` for a person (see F17).

---

### F3 · HIGH · CONFIRMED · `apps/web/src/pages/CollectionPage.tsx:378`
**"Owned 2+ (physical)" narrows the list but not the facet counts — the exact
disagreement the comment three lines below it forbids.**

`7189d70` threaded `owned2` through the list params (`:261`), the reload deps
(`:305`) and `collectionPath` (`:341`), and the server reads it on **both**
routes (`collectionQueryFrom` is shared; `catalog.ts:143`). The **facets** call
was not updated: `api.facets({ q, universe, medium, ebookOnly, binding,
editionKind, status, needs, readState })` — no `owned2`, and `ownedTwice` is
absent from that effect's dependency array (`:386`).

The comment immediately under that call states the invariant being violated:
> *`ebookOnly` is in here and not only in the list's params, or the counts stop
> describing the list they label … the disagreement `collectionFilter` exists as
> one builder to prevent.*

**Failure scenario.** Tick **Owned 2+ (physical)**. The grid narrows to (say) 12
works. The Series dropdown still reads *"Cradle (6)"*, *"Cover needed (4)"*,
*"Sold (9)"* — counted over the whole ~1,100-work collection. Pick "Cradle (6)"
and the list is empty under a facet that said six.

**Fix.** One line: `owned2: ownedTwice ? 1 : 0` in the facets params, plus
`ownedTwice` in the dep array. `duplicates` is correctly absent — it *replaces*
the grid rather than filtering it.

---

### F4 · HIGH · CONFIRMED · `packages/isbn/src/resolve.ts:407` (with `apps/worker/src/routes/scan-jobs.ts:239` and `apps/worker/src/routes/gabi-delegated.ts:1079`)
**`bestCandidate`'s description borrow is inert. Neither consumer reads
`description`, so `636c32a`'s headline — "scanning misses descriptions" — is not
delivered by that commit anywhere.**

- **scan-jobs**: `resolveBarcode` computes `bestCandidate(candidates)` (`:381`)
  and hands it to `applyCandidate` (`:239`), which copies `isbn13`,
  `resolvedTitle`, `resolvedAuthors`, `publisher`, `publishedYear`, `coverUrl` —
  **and nothing else**. `ScanLine` (`packages/core/src/scanjobs.ts:144`) has no
  `description`, `pages` or `language` field. `grep description
  apps/worker/src/routes/scan-jobs.ts` returns two comments and zero code.
  Descriptions actually reach a scanned book later, through
  `fillFreeDetails → freeDetailsFor` (`scan-jobs.ts:1093`), which is a different
  mechanism entirely.
- **gabi-delegated**: `top = bestCandidate(candidates)` (`:574`), then
  `createWorkSchema.parse({ title, authors, coverUrl, firstPublished,
  openlibraryWorkId })` (`:666`) and `editionFrom(...)` (`:1079`) — neither
  names `description`.

Net new behaviour from `636c32a`: `publisher`/`publishedYear` borrowing on the
scan path, and `publisher`/`publishedYear`/`pages`/`language` on the delegated
path. Description: nowhere.

**Why it matters beyond wasted work.** `DONE.md:106` and the commit message both
record descriptions as fixed here. The next session reading either will not look
for the gap again.

**Fix.** Either add `description` to `ScanLine` + `applyCandidate` +
`createWorkSchema` at these call sites, or correct the commit's claim in
`DONE.md` to say the borrow is live for the edition fields only and that
descriptions still ride the free ladder.

---

### F5 · MEDIUM · CONFIRMED · `apps/worker/src/routes/gabi-delegated.ts:1079-1104`
**`editionFrom` now records a provenance that can be false: `source` and
`sourceUrl` come from rung 1 while `publisher`, `pages`, `language` and
`coverUrl` may come from rung 2.**

Before `636c32a` this path used `candidates[0]` whole, so every field in the
stored `edition` row and its `source` agreed. `bestCandidate` deliberately keeps
identity (including `source`/`sourceUrl`) from rung 1 and coalesces the rest —
which is right for the *values* and wrong for the *label written beside them*.

**Failure scenario.** Add a book by ISBN through GABI. Open Library answers with
title/author and nulls for publisher and page count; Google Books supplies
`Tor, 384pp`. The `edition` row stores `publisher='Tor'`, `pages=384`,
`source='openlibrary'`, `sourceUrl=<the OL edition URL>`. Anyone auditing where
384 came from follows the OL link and finds nothing there.

**Fix.** Either record per-field provenance, or set `source`/`sourceUrl` to
`'mixed'`/null when any supplementary field was borrowed, or (cheapest) have
`bestCandidate` return the borrowed-field map alongside the candidate so callers
that persist provenance can be honest.

---

### F6 · MEDIUM · CONFIRMED · `packages/isbn/src/resolve.ts:411-418`
**`pick()` collapses `undefined` into `null` on `description`, erasing the
distinction the field's own doc comment exists to preserve.**

`BookCandidate.description` (`:61-74`) is documented explicitly:
> *`undefined` here means **this rung does not carry descriptions**; `null` means
> **it does, and this book has none**. The free details ladder reads it and needs
> to tell those apart.*

The Open Library rung builds its candidate with **no `description` key at all**
(`:238-255`) — correctly `undefined`. `bestCandidate` spreads `...first` and then
unconditionally assigns `description: pick(...)`, which returns `null` when no
rung supplied one. So a candidate that means *"nobody who could answer was
asked"* comes out meaning *"asked, and there is none"*.

**Failure scenario.** `GOOGLE_BOOKS_API_KEY` unset (rung 2 is skipped entirely —
`ResolveOptions:130`) or Google returns 400 (the `free-details-ladder.md` §6
not-verified list records a live 400). `candidates = [openLibrary]`, description
`undefined` → `bestCandidate` returns `null`. Any consumer that later branches
`description !== undefined` (the pattern already used at `free-details.ts:823`,
`:976`, `:1015`) reads a definitive "no blurb" and stops asking.

This is latent today only because of F4 — no consumer reads the field. It becomes
live the moment one does, which is exactly what F4's fix would do.

**Fix.** Only assign the key when at least one candidate carried it:
build the result object conditionally, or have `pick` return `undefined` (not
`null`) when every candidate's value was `undefined`.

---

### F7 · MEDIUM · CONFIRMED · `apps/web/src/router.tsx:354-395` + `packages/db/src/works.ts:1780-1794`
**Old shared links carrying BOTH a type and a printing now return MORE books
than they did. `DONE.md:287`'s "so shared links survive" is wrong for that
case.**

`1333ff2` changed the two axes from AND to OR *and* migrated `?format=` into
`?binding=`. Both halves are documented; the interaction is not.

**Failure scenario.** A link shared before 2026-08-24:
`/?format=hardcover&kind=collectors` meant *"has a hardcover edition **AND** has
a collector's printing"*. It now parses to `bindings=['hardcover']`,
`editionKinds=['collectors']`, which `collectionFilter` ORs into
`(hardcover OR collectors)` — *"has a hardcover **OR** has a collector's
printing"*. On a shelf of 224 works that turns a list of a handful into a list of
most of the hardcovers. Same for any pre-existing `?binding=…&kind=…`.

Secondary, same commit: `legacyFormatBinding` (`:354`) folds every non-physical
`EDITION_FORMATS` value to the coarse `ebook`, so `?format=epub` now also matches
a work whose only file is a PDF. That one **is** stated in the commit message,
so it is an accepted trade rather than a surprise — but it is not "narrows to the
same shelf" either.

**Fix.** No code change is obviously right (OR is the owner's ask). Correct the
claim in `DONE.md` and, if the old semantics matter, migrate a legacy
`format`+`kind` pair to `binding` only, dropping `kind`, so the link narrows
rather than widens.

---

### F8 · MEDIUM · CONFIRMED (code) / PLAUSIBLE (frequency) · `packages/isbn/src/wikidata.ts:60-69`
**`LIMIT 1` with no `ORDER BY` picks an arbitrary series when a work has several
`P179` statements — and the choice can change between runs.**

SPARQL result order is unspecified without `ORDER BY`. A great many books in this
catalogue's shape carry two `P179` statements — the series and the wider
publication sequence. The `OPTIONAL { ?st pq:P1545 ?ordinal }` compounds it: the
binding that wins may be the one *without* the ordinal, so the rung reports a
series and a `null` volume when another statement had both.

**Failure scenario.** ISBN of a Stormlight volume: Wikidata may bind *"The
Stormlight Archive", ordinal 1* on one run and a broader sequence with no
ordinal on the next. `work.series` is written from whichever landed first — and
`writeFreeValues` only writes into a blank, so the first arbitrary answer is
permanent.

**Fix.** Drop `LIMIT 1`, take up to a handful of bindings, and prefer the one
that HAS an ordinal; refuse when two bindings disagree on the series name rather
than picking. At minimum add `ORDER BY ?ordinal` so the pick is deterministic.

---

### F9 · MEDIUM · CONFIRMED (structural) · `apps/worker/src/lib/free-details.ts` — `fieldsClosedBy` / `writeFreeValues` (at `84df3e1`: `:717` and `:895-905`)
**A volume ordinal can be written against a series the ordinal does not belong
to. `seriesInHand` gates on a series *existing*, never on it being the *same*
series.**

`fieldsClosedBy` admits `seriesIndex` when `seriesInHand || answer.series !==
undefined`; `writeFreeValues` then writes `patch.seriesIndexSort` as long as
`seriesNow = patch.series ?? work.series` is non-blank. Nothing compares
`volumeAnswer.series` to `seriesNow`.

**Failure scenario.** `work.series` was already filled by an earlier rung or by a
title parse — e.g. a universe name landed there, the exact mistake
`free-details-ladder.md` records for Open Library's markerless
`series: ["Elantris (1)"]`. `seriesIndex` is still open, so `askWikidata` runs,
returns `{series: "The Stormlight Archive", ordinal: 1}`, and `1` is stored
against the series already on the row. `volume-numbers.md` treats
`series` + `series_index_sort` as *the* complete pair; the pair is now
internally inconsistent, and the queue considers the book done.

This structure predates `84df3e1` — but every earlier rung derived its series
from the same title the work already had, so name drift was small. Wikidata is
the first rung whose series comes from a wholly independent taxonomy, which is
what turns a theoretical mismatch into a likely one. Hardcover (`893dd37`) adds a
third taxonomy on top.

**Fix.** In `writeFreeValues`, when the volume answer carries a `series`, require
`normaliseTitle(answer.series) === normaliseTitle(seriesNow)` before writing the
ordinal; otherwise `skipped.push` with a named reason. Reuse
`packages/core/src/matching.ts` — do **not** add a second comparison helper.

---

### F10 · MEDIUM · CONFIRMED · `catalog-platform/scripts/onedrive-exclude.ps1:44-56` (`-Undo`)
**`-Undo` restores ANY reparse point named `node_modules` or `.claude`, not only
the ones this script made — and moves whatever it points at into the repo.**

The candidate filter is `$_.Name -in $Names -and (Is-Junction $_.FullName)`.
`Is-Junction` is `$i.LinkType` truthiness, which is true for symlinks and
junctions alike. There is no check that `$target` lives under `$Base`.

**Failure scenario.** A repo whose `node_modules` is a symlink into a shared
pnpm/npm cache, or a monorepo package linked to the root's `node_modules`. Run
`-Undo`: the link is deleted and `Move-Item -LiteralPath $target -Destination
$l.FullName` **moves the shared store bodily into that one repo**, breaking every
other consumer of it. Nothing warns; the line printed is `RESTORED`.

**Fix.** Guard the loop:
```powershell
if (-not $target.StartsWith($Base, [StringComparison]::OrdinalIgnoreCase)) {
  Write-Host "  SKIP (not ours) $($l.FullName) -> $target"; continue
}
```

---

### F11 · MEDIUM · CONFIRMED · `catalog-platform/scripts/onedrive-exclude.ps1:81`
**`Move-Item` into an existing `$dst` nests silently, and the junction then
points at a stale tree.**

PowerShell's `Move-Item` with a directory destination that already exists moves
the source *inside* it. The script never tests `Test-Path -LiteralPath $dst`.

**Failure scenario.** Run once → `C:\lcw\onedrive-excluded\<repo>\node_modules`
exists and the repo holds a junction. The junction is later lost (a `git clean`,
a OneDrive repair, a fresh clone over the path) and `npm install` recreates a
real `node_modules`. Run the script again → `$dst` exists → the **new**
`node_modules` is moved to
`…\node_modules\node_modules`, and the new junction points at the **old** tree.
Builds now resolve stale dependencies with no error anywhere, and `.claude` gets
the same treatment.

**Fix.** `if (Test-Path -LiteralPath $dst) { $skip += "$rel : destination already
exists"; continue }` — refuse, name it, let a person decide.

---

### F12 · MEDIUM · CONFIRMED · `packages/db/src/works.ts:2025` and `:2058-2065, 2091-2100`
**`collectionFacets`' `withoutKind` variant no longer means anything under OR
semantics — and both facets it feeds (`kinds`, `formats`) now have zero
consumers.**

`1333ff2` renamed `editionKind` → `editionKinds` in `withoutKind` but left the
"drop only my own clause" shape, which is an **AND** idea. Under OR, dropping the
kind half while keeping the binding half counts an intersection that clicking the
box would never produce.

Separately, `grep` across `apps/web/src` and `apps/worker/src` finds **no reader**
of `facets.kinds` or `facets.formats`: the "Printing" select and the "Edition"
select were the only two, and `1333ff2` deleted both. The two D1 queries — one of
them `work JOIN edition GROUP BY e.format` — still run on every facets request.

**Failure scenario (if counts are ever added to `TypeFilter`, which the TODO
defers rather than rules out).** bindings=`['paperback']` selected. `withoutKind`
= paperback only, so *"Collector's edition (2)"* renders — the paperbacks that
are also collector's editions. Clicking it ORs, and the list grows from 40 to 45.
The count disagrees with the list it labels, which `collectionFilter`'s header
calls *"worse than no facet at all"*.

**Fix.** For an OR group the correct variant drops the **whole** predicate:
`collectionFilter({ ...query, editionKinds: undefined, bindings: undefined })`.
And either delete `kinds`/`formats` from `CollectionFacets` (with their queries)
or wire them into the Type dropdown — one or the other, not the current
in-between.

---

### F13 · MEDIUM · CONFIRMED · `apps/worker/src/routes/covers.ts:140-144`
**The 502 `search_failed` sentence the route writes is thrown away by
`describeError`, and the person cannot tell whether they were charged.**

`describeError` (`apps/web/src/lib/errors.ts`) handles `status >= 500` before it
reaches the `detail` fallback, returning *"The server had a problem. Try again in
a moment."* The route's `detail` — *timeout / budget exhausted / upstream* — never
renders.

**Failure scenario.** `findCover` throws after Claude has already run its web
search. The person sees "try again in a moment", clicks again, confirms the ~6¢
prompt again. Two searches billed, one message, no way to distinguish "we never
called out" from "we called out and it died late".

**Fix.** Return the failure as a `502` the client special-cases (like
`scan_unavailable`), or move the `detail` fallback ahead of the generic 5xx
branch for codes the route defines. Separately: the route should say whether the
attempt is believed to have been billed.

---

### F14 · LOW-MEDIUM · CONFIRMED · `packages/isbn/src/wikidata.ts:74-78`
**The User-Agent has no contact, though the comment two lines above says
Wikidata's policy requires one.**

```
// Wikidata's policy REQUIRES a descriptive UA with contact — a generic one
// gets blocked.
'User-Agent': opts.userAgent ?? 'library_catalog/1.0 (household book catalog)',
```
No email, no URL. In practice `askWikidata` passes `free-details.ts`'s `UA =
'library_catalog (+private household catalog)'` — also contactless. WDQS blocks
by UA when it throttles, and the block would surface here as a thrown
`wikidata 403`, i.e. a permanently skipped rung reported as one line in
`skipped`.

**Fix.** Add a contact (`+https://library.heygabi.ai`) to both strings.

---

### F15 · LOW-MEDIUM · CONFIRMED by construction · `apps/web/src/pages/CollectionPage.tsx:51-73` + `packages/db/src/works.ts:1534`
**`TYPE_OPTIONS` auto-expands from `EDITION_KINDS`, but `KIND_CLAUSE` and
`KIND_LABEL` do not — so a future kind renders a checkbox that silently matches
nothing.**

`TYPE_OPTIONS` is built from `EDITION_KIND_FILTERS = [...EDITION_KINDS,
'unsorted']`. `EDITION_KINDS`'s own doc (`packages/core/src/constants.ts:760-768`)
says the set **is expected to grow** — *"`omnibus` is the obvious candidate"* —
and that *"an unrecognised value simply fails to match any filter"*.

The old "Printing" `<select>` hard-coded its two `<option>`s, so adding a kind
changed nothing on screen. The new dropdown adds a box automatically, labelled
with the raw token (`KIND_LABEL[v] ?? v`), whose `KIND_CLAUSE` lookup misses and
contributes no clause. Ticking it produces results **identical to leaving it
unticked** — a control that is indistinguishable from working.

Today `EDITION_KINDS === ['collectors']`, so this is clean. It becomes live on the
one-line change its own doc invites.

**Fix.** Derive `TYPE_OPTIONS` from the keys that have both a label and a clause,
or add a unit test asserting `EDITION_KIND_FILTERS ⊆ keys(KIND_CLAUSE)` — the
same shape as the universes tripwire that already earns its keep in this repo.

---

### F16 · LOW · CONFIRMED · `apps/web/src/components/EditBox.tsx:319-329`
**The one signal that would catch KI-6 is fetched, returned, and dropped.**

The route computes `bytes` from `verifyCoverUrl` and puts it in the response
(`covers.ts:158`). `CoverFindResult.bytes` is typed. The UI renders `note`,
`source`, `confidence` and `verifyReason` — never `bytes`.

KI-6 is precisely *"a Google Books cover can be a 4 KB 'COVER COMING SOON' card,
and no size check catches it"*: `MIN_COVER_BYTES` rejects the 43-byte
placeholder, not a 4 KB card. A person looking at a 96 px thumbnail cannot tell
either. `"4 KB"` beside the proposal is the cheapest possible mitigation and it
is already in hand.

Also here: the `<img>` has no `onError`. A URL that the Worker verified can still
fail in the browser (hotlink protection keyed on `Referer`), leaving a broken
image icon under the words **"Found a cover."**

---

### F17 · LOW · CONFIRMED · `apps/worker/src/routes/covers.ts:119-122`
**The 503's `detail` is a developer instruction shown to a moderator.**

> *"Put ANTHROPIC_API_KEY in apps/worker/.dev.vars, then `npm run secrets:push`."*

`runResearch` is held by owner, admin **and moderator** — and the delegated tests
(`gabi-delegated.test.ts:281`) show non-owner people in those tiers. Editing a
`.dev.vars` file is not an action available to them. (Moot today only because F2
means the sentence never renders at all.)

**Fix.** Person-facing sentence + the owner-facing remediation kept in the Worker
log: *"The cover search is not configured on this instance. An owner needs to add
the API key."*

---

### F18 · LOW · CONFIRMED · `catalog-platform/scripts/onedrive-exclude.ps1:44-56`
**The `-Undo` loop has no `try`/`catch` under `$ErrorActionPreference = 'Stop'`,
so one failure aborts mid-restore.**

The forward loop wraps each folder and collects `$skip`. `-Undo` does not. If
`Move-Item` fails on the third of ten links (a file lock, a long path), the
script throws with the junction **already deleted** — that repo now has no
`node_modules` and nothing pointing at the copy still sitting in `$Base` — and the
remaining seven are never touched. Recoverable by hand, but the state is
confusing and unreported.

**Fix.** Mirror the forward loop's `try`/`catch` + `$skip` reporting, and print
the `$Base` path in the failure line so the stranded copy is findable.

---

### F19 · LOW · CONFIRMED · `apps/web/src/pages/CollectionPage.tsx:1099-1162` (`TypeFilter`)
**Two small a11y defects in the new disclosure.**

- `aria-haspopup="true"` is `"menu"`, but the panel is `role="group"` of
  checkboxes. `"dialog"` or (better) `"listbox"` semantics, or simply omitting
  `aria-haspopup` and relying on `aria-expanded`, is more accurate. There is no
  `aria-controls` tying the button to the panel.
- `id="type-filter-label"` is hard-coded, so a second `TypeFilter` on any page
  produces duplicate ids and both buttons resolve to the first label. One
  instance exists today.

What is **correct** and worth not regressing: Escape closes and returns focus to
the button; `pointerdown` **and** `focusin` outside both close (the `focusin`
listener is what makes keyboard dismissal work); listeners are attached only
while open; the checkboxes are native, so Tab/Space work; the summary degrades
to `"n selected"`; a "Clear types" button exists inside the panel.

---

### F20 · LOW · CONFIRMED · `docs/TODO.md:444`
**Stale by four lines.** The "What already exists, so nobody rebuilds it" list
still says `findCover()` is *"**not** wired to any route or button"*, while item
2 immediately below records `2fadc19` wiring exactly that. One fact, two homes,
already disagreeing.

`DONE.md`'s **Owned 2+** entry (`:250`) was checked line by line against `7189d70`
and **is accurate**, including the revert narrative and the `?owned2=1` /
`?duplicates=1` separation. `DONE.md`'s **Type filter** entry (`:287`) is accurate
except for the shared-links claim — see F7.

---

### F21 · LOW · CONFIRMED · test coverage gaps

Not defects, but the absences that would have caught the findings above:

| Gap | Would have caught |
|---|---|
| No SQL test over `collectionFilter`'s OR-grouping (`owned-twice-clause.test.ts` covers `OWNED_TWICE_PHYSICAL` alone, 11 cases, and it is genuinely good) | F7, F12 |
| No test that a facet variant and the list agree for a given query | F3, F12 |
| `best-candidate.test.ts`'s `cand()` helper defaults `description: null`, so the `undefined` case is never constructed | F6 |
| No test that `bestCandidate`'s output is actually consumed (a scan-line contract test naming the fields it carries) | F4 |
| `wikidata.test.ts` never asserts the ISBN reaches the query — a refactor deleting the `FILTER` passes all 7 | — |
| No ladder-level `askWikidata` test (`free-details.test.ts` gained 4 cases for Hardcover in `893dd37`, none for Wikidata in `84df3e1`) | F9 |
| No assertion that `FREE_LADDER_SUBREQUESTS` matches the `rungs` array length | F1 |

#### ✅ F21 CLOSED 2026-08-26 — audited row by row

⚠️ **Six of the seven were already closed before this session looked**, which is
itself the finding: a gap list is only useful if somebody re-reads it, and
re-reading it saved writing six tests that already existed.

| Gap | State on 2026-08-26 |
|---|---|
| `collectionFilter` OR-grouping SQL | ✅ `packages/db/test/binding-clause.test.ts` — real SQLite, the clauses imported, the multi-select OR exercised as the worker builds it |
| facet variant vs the list | ✅ `apps/web/test/facet-list-agreement.test.ts` — F3 by name |
| `cand()` never builds the `undefined` case | ✅ `best-candidate.test.ts` grew `olRung()`, which `delete`s the key; three cases turn on undefined-vs-null |
| `bestCandidate`'s output actually consumed | ✅ `packages/core/test/scan-add-fields.test.ts` — names the scan-line fields, F4 by name |
| `wikidata.test.ts` never asserts the ISBN reaches the query | ✅ *"the ISBN really reaches the query — a deleted FILTER must not pass silently"* |
| **ladder-level `askWikidata` test** | 🆕 **CLOSED 2026-08-26** — a `rung 6 — Wikidata` block, 6 cases, mirroring rung 5's: attribution, no printed form from the numeric P1545, not asked when only `description` is open, the no-ISBN skip, "asked and knew nothing" as a DIFFERENT named skip, and the per-field stop reaching the last rung |
| `FREE_LADDER_SUBREQUESTS` vs the rungs array | ✅ *"prices every rung the union names"* + *"a worst-case run spends exactly FREE_DETAILS_SUBREQUESTS"* (counts real calls) |

---

## Checked and CLEAN

So the absence of a finding above is evidence, not silence. Each of these was
traced to specific lines.

**Canonical-key rule / migrations**
- ✅ **No commit in scope moves or re-derives a persisted key.** `1333ff2`,
  `7189d70`, `2fadc19`, `636c32a`, `84df3e1` carry **no `.sql`** and no write to
  `work_key`, `audio_key` or `openlibrary_work_id`. `gabi-delegated` uses
  `workKeyFor` from `@lc/core` rather than re-implementing the fold
  (`gabi-delegated.ts:599`).
- ✅ `1333ff2` reads only pre-existing columns (`edition.format`,
  `edition.edition_kind`, `copy.leatherbound`); migrate-before-deploy holds
  vacuously.

**No second matcher**
- ✅ Nothing in scope adds a similarity or parse function. `bestCandidate`/
  `descriptionFrom` are field coalescers with no comparison logic;
  `lookupWikidataSeries` parses a SPARQL binding and applies a `^Q\d+$` reject.
  `packages/core/src/matching.ts` is untouched, and `askWikidata` correctly does
  **not** run `readSeriesLabel` over a field already declared to be a series.

**SQL correctness of the Type consolidation**
- ✅ **Bind order is intact.** The whole `BINDING_CLAUSE` / `KIND_CLAUSE` OR
  group is bind-free (fixed maps of literal SQL over `@lc/core` constants), and
  `OWNED_TWICE_PHYSICAL` is bind-free too — so inserting both into
  `collectionFilter` between `query.format` and `query.status` cannot desynchronise
  the bind array. Verified by reading every `binds.push` in the function
  (`works.ts:1723-1837`).
- ✅ **D1's 100-bind cap is not approached.** The type group adds zero binds;
  `universeClause` still inlines integers through `Number.isInteger` for exactly
  this reason.
- ✅ **Unknown-token tolerance** holds end to end: `catalog.ts:126` and `:148`
  split without validating; the fixed maps drop what they do not know; a stale
  bookmark shows the collection rather than a 400.
- ✅ `withoutMedium`, `withoutNeeds`, `withoutSeries`, `withoutSoldHidden` and
  `listUniverseKeys`' universe drop are unaffected by the OR change — each of
  those axes is still its own AND conjunct. Only `withoutKind` is compromised
  (F12).

**Money / capability**
- ✅ `POST /works/:id/cover/find` is gated `requireCapability('runResearch')`
  (`covers.ts:108`) — the same gate as `POST /research/works/:id/run` and
  `POST /gabi/turn`, and **not** `editCatalog`.
- ✅ The route is present in `capability-wiring.test.ts:254`, which asserts the
  403 body names `runResearch` by NAME (several capabilities share a role set, so
  the status code alone proves nothing) and that the floor role gets past.
- ✅ **No other route was added by any commit in scope**, so nothing else is
  missing from `WIRED`. (`capability-wiring.test.ts:193` states that coverage is
  a discipline, not a mechanism — that pre-existing gap is documented in the file
  and is not a new finding.)
- ✅ **Confirm-before-spend exists and is per-search**: `window.confirm` naming
  the ~6¢ cost and the 20–90 s wait (`EditBox.tsx:224-235`), and the button is
  rendered only when `me.capabilities.includes('runResearch')` — an `editCatalog`
  reader sees the free "Choose from known covers" pointer and no paid control,
  which is the "prefer not rendering over refusing" rule.
- ✅ **The route proposes, never stores.** Applying goes through the free,
  re-verified `setCover` with `status: 'ok'` — the same call and the same status
  the two pre-existing manual paths use (`CoverPanel.tsx:111`,
  `CoverSwap.tsx:81`), so a person assessing the image is what sets `'ok'`.
- ✅ **The key is checked before anything is spent**, and `getWork` runs before
  `findCover`, so a 404 costs nothing.
- ✅ **The free ladder cannot reach the LLM.** `fillFreeDetails` calls
  `freeDetailsFor` only, and `scan-jobs.ts:1080` states the rule; `askWikidata`
  is a keyless public endpoint and adds no spend.
- ✅ `findCover` is awaited rather than `waitUntil`-only, with the ~30 s
  cancellation clock cited — correct for a 20–90 s search.

**Silent-failure distinguishability**
- ✅ `askWikidata` distinguishes all three states by name in `outcome.skipped`:
  *no ISBN to ask with* / *no series recorded for ISBN X* / the transport error
  text. A failed rung is never reported as a rung that knew nothing.
- ✅ `lookupWikidataSeries` **throws** on a non-2xx so the ladder can record it,
  and returns `null` only for a genuine no-match — the distinction is tested
  (`wikidata.test.ts`, the `wikidata 500` case).
- ✅ The bare-Q-id reject (`/^Q\d+$/`) stops a failed label service from naming a
  shelf `Q7766706`; tested.
- ✅ The cover-find UI distinguishes *search found nothing* (a reassuring
  sentence) from *found but the link would not load* (`verified: false` +
  `verifyReason`) from *the call failed*. Three states, three renderings.
- ✅ `resolveBarcode`'s empty case still distinguishes `wasRefused` (an aggregate
  answer, refused) from "not indexed" — `bestCandidate` returning `undefined` for
  an empty list preserves that branch exactly as `candidates[0]` did.

**SPARQL injection**
- ✅ **Not injectable.** `const digits = (isbn13 ?? '').replace(/[^0-9]/g, '')`
  followed by `if (digits.length !== 13) return null` means the only value
  interpolated into the query string is 13 ASCII digits. Nothing else in the
  SPARQL is caller-derived; the query is `encodeURIComponent`-ed into the URL.
  There is no second inlined literal.
- ✅ `AbortSignal.timeout(12_000)` bounds the call; the rung is last, so a slow
  Wikidata cannot delay the rungs that answer more often.

**Status flags travelling with their values**
- ✅ `cover_status` travels with `cover_url` — the find route never writes
  either, and the apply path sends both in one `setCover`.
- ✅ `askWikidata` correctly sets **`seriesIndexSort` only**, never
  `seriesIndexDisplay` — `P1545` is a number, not a designation a publisher
  printed (owner rule 2026-08-19), and `printedFormIn` stays the only gate.
- ✅ `writeFreeValues` refuses an ordinal when there is no series to hang it on
  (`'seriesIndex: this book has no series to be a volume of.'`) and re-reads the
  work at write time so a column that filled in between is left alone. The
  *name*-agreement half is F9; the *existence* half is solid.

**URL / back-compat**
- ✅ `?kind=collectors` still parses, as a one-element list.
- ✅ `?duplicates=1` is untouched and shares nothing with `?owned2=1` — separate
  parse (`router.tsx:409-411`), separate state, separate server field
  (`catalog.ts:143` reads `owned2`, not `duplicates`). The revert (`1f5f969`)
  genuinely restored the records finder; `7189d70` adds beside it rather than
  over it.
- ✅ **Clear resets everything**, including the two lists and both checkboxes
  (`CollectionPage.tsx:848-858`) and `ebookOnly`, which has no control of its own.
- ✅ **The filter panel auto-opens** for both new params —
  `filters.bindings.length || filters.editionKinds.length` and
  `filters.ownedTwice` are in the initial `useState` predicate (`:157-171`).
- ✅ `collectionInUniversePath` zeroes `bindings`, `editionKinds` and
  `ownedTwice` — a link into a world carries no shelf narrowing.
- ✅ `collectionQuery` drops `owned2: 0`, so an ordinary browse stays clean.

**Repo B — `037cb35`**
- ✅ **`apex-admin-link.js` still gates correctly.** It resolves the
  approver-only links by `a.getAttribute('href') === '/admin' || '/todo'`
  (`apex-admin-link.js:38-44`); `037cb35` changed only `target`, `rel` and the
  inner span. Hrefs are byte-identical.
- ✅ **`a.hidden` still hides.** `.admin-links` / `.card-links` set `display:flex`
  on the **container** (`index.html:341, 348`); no author rule sets `display` on
  the anchors, so the UA `[hidden] { display: none }` applies. (This is the
  "attribute reads hidden while the pixels show the button" trap, checked
  explicitly.)
- ✅ **`.sr-only` is really defined** — `assets/estate-theme.css:1020` — so
  "(opens in a new tab)" does not render visibly. It matches the wording the
  external cards already used.
- ✅ **Every internal `href="/…"` now carries `target="_blank"`**; the only
  remaining bare one is the stylesheet `<link>`. `rel="noopener"` without
  `noreferrer` is right for same-origin.

**Repo B — `onedrive-exclude.ps1`, the parts that are right**
- ✅ **`cmd /c rmdir` on the junction is the correct and safe call**, and this is
  the trap the script most needed to avoid: in Windows PowerShell 5.1
  `Remove-Item -Recurse -Force` on a junction **follows the reparse point and
  deletes the target's contents**. `rmdir` removes the link only. Answering the
  brief's question directly: **no, `rmdir` on a junction does not delete target
  contents; `Remove-Item -Recurse` would.**
- ✅ **`Move-Item` back works**, because the destination no longer exists once
  the link is removed — the forward move and the restore are both same-volume
  renames.
- ✅ **Paths with spaces survive the `cmd /c`.** The argument PowerShell hands
  cmd is `rmdir "C:\path with spaces\node_modules"`; cmd's `/c` quote-stripping
  rule only fires when the string *begins* with a quote, and this one begins with
  `r`. (`[System.IO.Directory]::Delete($p, $false)` would sidestep the question
  entirely and is worth doing anyway.)
- ✅ **The same-volume guard is real** — `Split-Path -Qualifier` on both, throwing
  before any move, so a cross-volume copy cannot happen silently.
- ✅ **The nested-`node_modules` regex behaves as intended.** `-notmatch
  '\\node_modules\\'` excludes anything *inside* a `node_modules` (including
  `.claude` dirs and `node_modules/.bin`) while still allowing a monorepo
  package's own `packages/x/node_modules`, whose path *ends* with the segment
  rather than containing it delimited. `$cands` is fully materialised before the
  loop, so a parent move cannot invalidate a child entry that was going to be
  skipped anyway.
- ✅ **PowerShell 5.1 compatible throughout.** `-in` (3.0), `-Directory` (3.0),
  `-Depth` (5.0), `New-Item -ItemType Junction` (5.0), `$_.LinkType` (5.0). No
  `&&`/`||`, no ternary, no `??`, no `-AsHashtable`. `Is-Junction` uses a
  non-approved verb but is a script-local function, so no warning.
- ✅ **Idempotent and non-forcing on the forward path**: already-junctioned
  folders are filtered out, in-use folders land in `$skip` and are reported, and
  nothing is ever `-Force`d.

**Build health**
- ✅ `npm run typecheck` — clean (all packages, exit 0), 2026-08-25.
- ✅ `npm run test` — **1728 pass / 0 fail / 0 skipped**, 275 suites, 2026-08-25.
  The universes tripwire that blocked `1333ff2`'s deploy is reconciled
  (`1719af9`) and green.
