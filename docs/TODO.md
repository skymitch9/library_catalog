# TODO — library_catalog (ACTIVE work log)

> **Split 2026-08-16** per the global "Access & information docs" rule. This
> file had reached **2,804 lines**, of which 23 of 28 top-level sections were
> finished work — larger than the 1,688-line file that caused the rule to be
> written in the first place. A work log that cannot be read end-to-end stops
> being read, and a work log nobody reads is worse than none.
>
> **Where everything went, so nothing looks lost:**
>
> | Bucket | File | What belongs there |
> |---|---|---|
> | Finished work | [`DONE.md`](DONE.md) | Dated archive, newest first, **append-only**. Nothing is ever edited there. |
> | Gotchas | [`info/gotchas.md`](info/gotchas.md) | The traps that cost real time — findable by symptom, not by the day they bit. |
> | Decisions | [`info/decisions.md`](info/decisions.md) | Rationale for calls made, including the ones argued *against*. |
> | Rollback ids | [`access/rollback-points.md`](access/rollback-points.md) | Operational — the 3am "put it back" reference. |
>
> ⚠️ Sections were moved **whole — cut and paste, never summarised**. The
> summary always drops the *why*, and the why is the only reason to keep
> history at all.
>
> ⚠️ This split does **not** reinstate the problem that consolidating several
> competing *living* docs solved. An archive and a topic reference are not
> living docs — they do not compete with this file for "what is happening
> now", so do not helpfully re-merge them.

> 🚩 **KIRO'S RANKED QUEUE LIVES IN `catalog-platform/docs/TODO.md`**, in the
> section **"KIRO — COMPLETE THIS WORK, by ease and quickness"** (added
> 2026-08-21). Items from THIS repo appear there as K-numbers with plans. It is
> kept in that repo because `catalog-platform/docs/` is the only one of the four
> docs trees that is **tracked in git** and therefore survives a clone — this
> file does not. Do not duplicate the queue here; one list, not two.


## ☐ SCANNER → WISHLIST: let a scan land a book on the wishlist instead of the shelf — owner ask 2026-09-04 ~09:00 Phoenix

Owner (from his phone, out of town), verbatim: *"I didn't see how to scan a
book to add wishlist. We should add this feature to the scanner."* Said
while asking for /work/525 to be moved off the shelf (see the DATA section
just below — that copy is the case in point: scanned in a shop, wanted, not
owned).

**Read as:** the scan flow (barcode → edition match → "add copy") always
creates an **owned** copy today. It needs a target switch — *Shelf* /
*Wishlist* — so the same scan can create the copy with `status='wanted'`
(`WISHLIST_STATUSES = ['wanted','preordered']`,
`packages/core/src/constants.ts:283`). The switch should be visible at scan
time (a toggle on the scanner screen, remembered for the session so a
shop-visit of ten scans does not need ten taps), and the wishlist page
should show the new row immediately.

**Where it lives (to confirm before build):** scanner UI under
`apps/web/src/components/` (the RescanPrompt / scan-to-copy path touched by
the edition-note work — `RescanPrompt.tsx`, `Copies.tsx`), the copy-create
route in `apps/worker/src/routes/` (accepts `status`? — check the create
schema in `@lc/core`; if it already takes `status`, this is web-only).
Lands on BOTH instances through the shared components (global rule
2026-09-03: deploy PAIR). Opus build, ~100–150k if the route already
accepts `status`, ~150–200k if the worker needs a change.

☑ **owner 09:14: "Yes build it. We currently can't add to wishlist at
all."** — that second sentence WIDENS it. Measured 09:20: the wishlist
add exists but is buried — `Copies.tsx:491` *Want this* (gated
`suggestWishlist`) renders only inside **✎ Edit → Editions & copies**, and
`AddWork.tsx:260` *"want it — put it on the wishlist"* only in the scan
page's manual-add mode. The barcode path (`lib/catalog-add.ts:617`
`api.createCopy({ workId, status: 'owned', … })`) is owned-only — the route
already takes `status`, so this is **web-only**. From a phone none of it
is findable; "can't at all" is the honest reading. So the build is TWO
surfaces, one form:

1. **Scanner target switch** *Shelf / Wishlist* on `pages/ScanPage.tsx`,
   remembered for the session (`sessionStorage`), threaded through
   `catalog-add.ts` so the created copy is `status='wanted'`; ScanLines'
   *Add* reads *Add to wishlist*; the pre-order question is skipped on the
   wishlist path (a want is not an arrival); the manual-add `AddWork`
   intent defaults from the switch.
2. **A first-class *Want this* on the work page** — outside ✎ Edit,
   beside/under ON YOUR SHELF, gated `suggestWishlist`, opening the SAME
   `AddCopy` (intent `'wanted'`) — no second form.

☑ **build** (Opus, dispatched 09:2x, landed `40a1f65` + `5ceed15`) → ☑
**tests** → ☑ **deploy PAIR** from a clean tree at `0c4061b`, 09:38
Phoenix (`npm run deploy:both`; MAIN `40f5bb4b…`, friend `d869f335…`, both
lines in `deploys.log`) → ☑ **live** on both hosts: bundle
`index-JYV4Ylln.js` served by `library.heygabi.ai` and `padhard.heygabi.ai`
(curl); on the owner-signed-in tab, `/add` renders **Adding to · Shelf |
Wishlist** with *"Scanned books go on your shelf."*, and `/work/525` renders
the **Want this** panel under ON YOUR SHELF with the already-wanted sentence
(DOM text reads, 09:41) → ☐ owner scans one book to the wishlist from his
phone (the only real test — the scanner needs a camera) and finds *Want
this* on a work page. Still NOT verified: the barcode write itself, pixels,
padhard's signed-in rendering.

### ✅ BUILT 2026-09-04 — web-only, both instances through the shared components

| Commit | What |
|---|---|
| `40a1f65` | The scanner half: the Shelf/Wishlist switch, threaded to the write |
| `5ceed15` | The work-page half: a first-class *Want this* under ON YOUR SHELF |

**Files touched** (all under `apps/web/`; no worker, no `packages/`, no
migration — the copy-create route already took `status`):

* NEW `src/lib/scan-target.ts` — the target, its persistence, its words, and
  `copyStatusFor`, now the ONLY place `'owned'` vs `'wanted'` is chosen on the
  scan path.
* NEW `src/lib/wants.ts` — the "already wanted?" rule (`wantIn`, read off
  `WISHLIST_STATUSES`) and its two sentences. ⚠️ **No `api` import, on
  purpose:** anything importing `api.js` pulls in `lib/firebase.ts`, whose
  `import.meta.env` kills a `node:test` process — which is why `preorders.ts`
  and `rescans.ts` have no tests and these do. The one fetch that needs the
  rule sits beside its single caller in `catalog-add.ts`.
* NEW `test/scan-target.test.ts`, `test/wants.test.ts` — 20 assertions.
* `src/lib/catalog-add.ts`, `src/pages/ScanPage.tsx`,
  `src/components/ScanLines.tsx`, `src/components/AddWork.tsx`, `src/App.tsx`,
  `src/components/Copies.tsx` (now exports `AddCopy`), `src/pages/WorkPage.tsx`.

**What was DECIDED where the brief left room:**

| Question | Decision and why |
|---|---|
| Pre-order question on a want | **Skipped.** A want is not an arrival — `AddWork.tsx` already states that only `owned` can be a pre-order arriving. |
| Rescan question on a want | **Skipped.** Its commonest answer, *"the book I already have"* (`fill`), writes the ISBN and creates **no copy at all** — answered by somebody in a shop meaning "I want this", that silently records nothing, which is the very failure this feature removes. The other three answers are merely mis-worded there; that one is wrong. |
| …then what about #139, the duplicate printing the rescan question guards against? | **Closed a different way:** a want attaching to a book we already hold writes **no edition** — `Copies.AddCopy`'s existing wish rule. A path that mints no printing cannot mint a duplicate one. A genuinely NEW book still earns its edition: nothing on file to duplicate, and the ISBN is the most reliable fact available (`AddWork`, 2026-08-13). |
| ISBN-taken question on a want | **Unreachable**, and left in place. It is raised only from `applyRescanAnswer`, which only runs with a rescan answer, which is never asked for on this target. `applyRescanAnswer` still takes the target anyway, so no branch inside it can silently write `owned`. |
| A duplicate want | **Refused, in words** — a new `already-wanted` outcome: the row says so and writes nothing. A duplicate OWNED copy is still offered (some books here genuinely are owned twice); a barcode cannot express *"…as well as the one I already asked for"*, which is what makes the two cases different. Argued in `lib/wants.ts`. |
| Where *Want this* sits | Its own `panel` in `WorkPage.tsx`, **directly under `<OnYourShelf>`** and above Your reading. `OnYourShelf` takes no `me` and no `onChanged` and is a pure derivation; putting the button inside it would have widened it for nothing. |
| Capability copy | **Scanner:** the Wishlist half renders **disabled with a sentence** naming the permission and how to get it — a two-state switch with a missing state reads as broken. **Work page: hidden**, this page's own convention (`RequestContentWarnings`; the scan page's costed tabs — *"a control that exists and refuses is worse than one that was never offered"*). Both gate on `suggestWishlist`; on the scanner the target is ALSO forced to `shelf` in code, so no path writes a want the server would refuse. ⚠️ In practice always true on `/add`: that route needs `editCatalog`, a strict subset. |
| Storage key | `lc_scan_target_v1`, not the sketched `lc.scanTarget` — matches `lc_scan_format_v1` / `lc_prefs_v1` / `lc_tbr_picker_v1`. **`sessionStorage`**, where the format toggle uses local: a binding is a habit, a wishlist trip is an errand. |
| The sweep's format on a want | Kept as `wanted as <format>` in `editionNotes` on the copy when no edition is written — the same spelling `Copies.AddCopy` uses, so the wishlist reads one vocabulary whichever door a want came in through. Without it, the format chosen at the top of the sweep was silently dropped on exactly the rows that write no edition. |

**Verified 2026-09-04, by running them:** `npm run typecheck` — all nine
workspaces clean. `npm test` — **2331 pass / 0 fail** (was 2311; the 20 new
ones). `npm run build -w apps/web` — `✓ built in 2.93s`,
`dist/assets/index-JYV4Ylln.js`.

⚠️ **NOT verified — tell the owner rather than letting him assume:**

* **The live barcode path.** It needs a real camera; no scan was performed.
  Everything about a wanted copy reaching D1 through a barcode is reasoned,
  not measured.
* **Anything RENDERED.** This app has no jsdom setup and none was added, so
  every component change here is compiled and type-checked, never mounted.
  The switch, its disabled state, the "already on your wishlist" notice and
  the *Want this* panel have not been looked at in a browser.
* **Deployed anywhere.** Nothing has shipped; the PAIR above is still open.
* **The second instance specifically.** Nothing instance-specific is in the
  change — no posture var, no `[env.friend]` branch — so it lands through the
  shared components, but that is read off the diff, not checked against
  `padhard`.

## ☐ WISHLIST DOOR: mimic the board-game catalog's shape — "+ Add something" on /wishlist with type / barcode / photo tabs, built from reusable pieces — owner ask 2026-09-04 09:45 Phoenix

Owner, verbatim, after being told the board-game catalog already adds to
its wishlist from the Wishlist page itself (*+ Add something* → type a name
/ barcode / photo, `Board_Game_Catalog/apps/web/src/components/WishlistAdd.tsx`
+ `WishlistScan.tsx`), not from a switch on the scanner:

> "We should mimic that shape so keep reusable components"

**Read as:** the library's `/wishlist` page gets its own door — a
**+ Add something** button opening a form with three tabs, *Type a title* /
*Barcode* / *One book (photo)* — that creates the copy as `wanted`
directly. "Keep reusable components" = build it out of the pieces the scan
page already has (camera loop, `ScanLines`, `AddWork`, the `catalog-add`
path with the target pinned to `wishlist`), not a second scanner; the
wishlist door and `/add` must render the same rows and write through the
same code. The board-game files are the SHAPE reference (tab order, the
empty-state wording, "the page's own door" rationale), not code to copy —
different packages (`@bgc/core` vs `@lc/core`), different scan stack.

**Kept:** the *Adding to · Shelf | Wishlist* switch shipped this morning on
`/add` stays — a shop visit with a mixed basket needs it — but the wishlist
page becomes the primary door, matching the games.

Both instances through the shared components. Web-only. Opus, ~150–200k.

☑ **build** (Opus, `c82eae7` + `1702768`) → ☑ **tests** → ☑ **deploy
PAIR** 10:06 Phoenix (MAIN `005a4e48…` at `eb1d7f1`, padhard `6d6e74de…` at
`accc96b8`, both lines in `deploys.log`; both hosts serving
`assets/index-BcUnvzMK.js` — padhard served the old bundle for ~20 s of edge
cache first) → ☑ **live proof** 10:08 on the signed-in tab:
<https://library.heygabi.ai/wishlist> *+ Add something* → *Add to the
wishlist* with Type a title / Barcode / One book and the line "Books you add
here go on your wishlist — a want, not a copy you own"; `/add` still shows
four tabs + the *Adding to · Shelf | Wishlist* switch → ☐ owner adds one book
from https://library.heygabi.ai/wishlist on his phone (the only real test of
the camera tabs). **NOT verified:** the camera tabs themselves (no camera on
this machine), rendered pixels, padhard signed-in, and a cosmetic risk — the
panel is a card inside the wishlist page's card (card-in-a-card) until
someone looks.

### ✅ BUILT 2026-09-04 — web-only, one scanner behind two doors

| Commit | What |
|---|---|
| `c82eae7` | The extraction: `AddBookPanel` out of `ScanPage`, `/add` unchanged in behaviour |
| `1702768` | The wishlist door on top of it: **+ Add something** on `/wishlist` |

**Files touched** (all under `apps/web/`; no worker, no `packages/`, no
migration — the copy-create route already took `status`, and this feature adds
no route of its own):

* NEW `src/components/AddBookPanel.tsx` — the tab strip and everything under it:
  the camera loop, the barcode/photo endpoints, the duplicate prompt, the format
  toggle, `ScanLines` and `AddWork`. Props `{ target, modes, blocked,
  initialMode, initialJobId, onNav, onAdded, onFinished, onCancel, underTabs }`.
* NEW `src/lib/add-modes.ts` + `test/add-modes.test.ts` (19 assertions) — the
  tab catalogue as pure data, `/add`'s hide-the-paid-tabs rule, the wishlist
  door's three-in-order, and the sentence a blocked tab gets. ⚠️ It imports the
  `AddMode` **type** only, so a `node:test` process never loads `router.tsx` —
  the same trap `lib/wants.ts` records about `api.js` → `lib/firebase.ts`.
* NEW `src/components/WishlistAdd.tsx` — the door itself: which tabs, in which
  order, pinned to which target, and what closing means. No scan logic of its
  own.
* `src/pages/ScanPage.tsx` (now the way back, the sweeps link and the Shelf |
  Wishlist switch), `src/components/ScanLines.tsx` (optional `onAdded`),
  `src/pages/WishlistPage.tsx`.

**What is SHARED and what is NOT.** Shared: the tabs, the camera, both photo
endpoints, the barcode loop and its duplicate prompt, the format toggle,
`ScanLines`, `AddWork`, and — the bar the brief set — **one `addLineToCatalog`
and one `copyStatusFor` call site**, both still in `lib/catalog-add.ts`
(`grep -rn "copyStatusFor" apps/web/src` finds no second one). Not shared, on
purpose: the target (a switch on `/add`, pinned on the door), which tabs are
offered, whether the URL is kept in step (`onNav`, `/add` only), and what a
typed save means.

**What was DECIDED where the brief left room:**

| Question | Decision and why |
|---|---|
| Where the tabs live | `AddBookPanel`, a component both doors render — not a copied stack. `ScanPage` went 843 → ~190 lines and kept every string. |
| `underTabs` a node or a function? | **A function of the tab.** `/add`'s switch says *"Scanned books go on your wishlist"* on three tabs and *"Books you add…"* on the typing one, and the tab is now the panel's state; a plain node would have quietly dropped that. |
| A blocked tab: hidden or disabled? | **The two doors differ, and it is written down** (`lib/add-modes.ts`). `/add` hides its two PAID tabs — a spending decision, and a free tab always remains. The wishlist door DISABLES with a sentence: behind `suggestWishlist`, which a member holds, the missing tabs are an ACCESS question, and somebody whose phone shows one tab where another shows three is owed the reason. Same call the Shelf\|Wishlist switch made this morning. |
| Which capability gates which tab | Read off the ROUTES, not guessed: `POST /scan-jobs/barcode` → `scanBarcode`; `/single` → `scanPhoto`; the typing tab's two writes (`POST /works`, `POST /copies` with a wishlist status) → **`suggestWishlist`**, which is the door's own gate. So **typing is never blocked**, which is exactly why it is the default. |
| The shelf-photo tab on the door | **Not offered.** A wishlist is not bulk intake — photographing a shelf means "record every one of these", a sentence about books you have. The sibling leaves out its own slow paid rung for the same reason. |
| The format toggle on the door | **Kept.** A want that attaches to a book we already hold writes no edition, but the format is still recorded as the `wanted as …` note on the copy (`recordArrival`); dropping the control would silently throw that away. |
| What a typed save does | **Shuts the door and refreshes the list.** `AddWork` does not clear itself, and `POST /api/works` deliberately does not dedupe (migration 0001) — a second Save would mint a second work. A scanned row leaves the sweep standing, because a sweep is several books by definition. |
| How the list refreshes | `ScanLines` gained an optional `onAdded`, called **last and only on the write path** — a caller that refetched on an `ask-preorder` or `already-wanted` return would be reporting a change that did not happen. It carries no payload: "something landed, re-read your list". |
| The notice's wording | `addedLabel({ target: 'wishlist', … })` — literally the words the row inside the panel says, so one event is not reported two ways by two surfaces a few pixels apart. |
| Empty-state copy | Says what puts a book HERE — *"A book lands here when one of its copies is **wanted** — add one here, press **Want this** on a book's page, or take one of the gaps a series offers against its missing volumes"* — with the **+ Add something** button under it, per the sibling's *"the page's own door, not a link to /scan"*. |
| `/add` | Untouched in behaviour: same four tabs, same order, same hiding rule, same DOM order (tabs → switch → format toggle → body), same `replaceUrl` contract, and only a typed save leaves the screen. |

**Verified 2026-09-04, by running them:** `npm run typecheck` — all nine
workspaces clean. `npm test` — **2350 pass / 0 fail** (was 2331; the 19 new
ones). `npm run build -w apps/web` — `✓ built in 2.86s`,
`dist/assets/index-BcUnvzMK.js`.

⚠️ **NOT verified — tell the owner rather than letting him assume:**

* **Anything RENDERED.** No jsdom in this app and none was added, so every
  component here is compiled and type-checked, never mounted. The door, its
  three tabs, the disabled tabs' sentences, the new empty state and the panel
  around the typed form have not been looked at in a browser. ⚠️ The one
  cosmetic risk known in advance: `AddWork` draws its own `.panel` inside the
  door's `.panel`, so the typing tab is a card inside a card.
* **The camera tabs.** Barcode and one-book need a real camera; none was
  opened. Everything about a wanted copy reaching D1 from this door is reasoned
  from the shared code path, not measured.
* **Deployed anywhere.** Nothing has shipped; the PAIR above is open.
* **The second instance specifically.** Nothing instance-specific is in the
  change — no posture var, no `[env.friend]` branch — so it lands through the
  shared components, but that is read off the diff, not checked against
  `padhard`.

## ☐ DATA /work/525: copy off the shelf, onto the wishlist — owner ask 2026-09-04 ~09:00 Phoenix

Owner, verbatim: *"https://library.heygabi.ai/work/525 I want this on wish
list instead of owned."*

Measured 09:05: work 525 = *The Castle of 1,000 Doors* (Kenny Gould),
copy **464**, edition 678 (paperback, Spiderhead Press 2023), `status='owned'`.

☑ **09:09 Phoenix, MAIN only:** `UPDATE copy SET status='wanted',
updated_at=datetime('now') WHERE id=464 AND work_id=525 AND status='owned'`
→ changes=1. Direct D1 write, same route as /work/263 (the owner asked
for the data change, not for a screen; no code involved). No other column
touched — location/lent_to/condition were all NULL.
☑ live: <https://library.heygabi.ai/work/525> ON YOUR SHELF shows the
paperback card with the **WANTED** status chip (bundle `index-D8DRuBYK.js`).
☐ NOT verified: the Wishlist page listing it (needs sign-in) — owner to
glance at it. He will want the scanner feature above so the next one of
these needs no D1 write.

## ☐ SHELF round 3: "still 3 lists" → ONE list per format tab, the iconed edition cards only, copy facts as chips on them — owner ask 2026-09-03 17:21 Phoenix

Lands on BOTH instances through the shared components (global rule
2026-09-03: one codebase, deploy PAIR). Review page: <https://library.heygabi.ai/work/263>.

Owner, 17:21, after reviewing /work/263 with round 2 (`0d794f0`, deployed
15:58) live, with a screenshot of the Hardcover tab, verbatim:

> "Closer but still 3 list, the book icons below should be all that remains.
> Add the hard cover, sprayed edges lent out tabs to the iconed ones below"

What he was looking at: the Hardcover tab held (1) the tab header line,
(2) the three copy lines *"Hardcover — Sprayed edges"* / *"Hardcover"* /
*"Hardcover — Lent out (…)"*, and (3) the three MAY BE YOURS edition cards
with the book icon (*"V1 Limited Edition hardcover"*, *"V1 Limited Edition
Standard hardcover"*, *"Standard Hardcover"*). Three lists; he wants one.

**Read as:**

- Under a format tab there is exactly ONE list: the **iconed edition cards**.
  The copy-line list (round 2's `looseRows`/tab rows as separate text lines)
  goes away.
- What made each copy distinct (round 2's line facts — *Sprayed edges*,
  *Signed*, *Lent out (to whom)*, condition, location…) moves ONTO the card
  as **chips**, the same visual the format/kind badges already use. "Add the
  … tabs to the iconed ones" = his word for those chips/badges.
- A copy LINKED to an edition decorates that edition's card. A copy with no
  edition (all three on /work/263 today — see the DATA section below) still
  has to render as an iconed card, titled by its format word, with its chips.
  The MAY BE YOURS candidates stay as cards with the pill; the two kinds of
  card must not read as two lists — same component, same row.
- A fact printed once, still: what every copy under the tab shares stays on
  the tab header (round 1/2 derivation); the chips carry only the differences.
  "On the shelf" / "Not signed" are never printed (settled in round 2).

**Where it lives:** `apps/web/src/lib/shelf-view.ts` (`deriveShelfView`,
tabs/looseRows) and `apps/web/src/components/OnYourShelf.tsx` (tab panels;
the MAY BE YOURS cards are rendered from the same component). Tests in
`apps/web/test/shelf-view.test.ts` (38 `edition_name` mentions — the
fixtures exist). Web-only build — Opus, ~150–250k together with the edition
note below.

☑ build → ☑ tests → ☑ deploy PAIR from a clean tree → ☐ owner review on
/work/263 (three hardcover copies → three cards, chips *Sprayed edges* /
*Lent out*) and a padhard work with two formats.

### ✅ BUILT 2026-09-03 — commit `e6ed1fd` — ✅ **DEPLOYED TO BOTH 17:57 Phoenix**

| Instance | tree | version id | bundle |
|---|---|---|---|
| MAIN | `83bde65` | `064ec342-8a6c-431b-9421-81f16ce8ca37` | `index-D8DRuBYK.js` |
| padhard (`env=friend`) | `a1dd409` | `7d27c891-28c9-402d-8ea4-60aa3d5b2e26` | `index-D8DRuBYK.js` |

**Seen live 17:59 Phoenix** (rendered DOM read, not a status code): the
Hardcover tab of <https://library.heygabi.ai/work/263> holds **six cards in
one list** — *Hardcover OWNED · Sprayed edges* / *Hardcover OWNED* /
*Hardcover OWNED · Lent out* / *V1 Limited Edition hardcover MAY BE YOURS* /
*V1 Limited Edition Standard hardcover MAY BE YOURS* / *Standard Hardcover
MAY BE YOURS*; no copy-line list; tabs *Hardcover · Audio*. Padhard
<https://padhard.heygabi.ai/work/433> renders one card *Allural OWNED*
on the same bundle. ⚠️ NOT verified: pixels (a DOM text read, no screenshot),
the tab keyboard, padhard /work/642's two tabs.

**What landed** — all of it in the DERIVATION again, so a test pins what the
shelf SAYS and the component chooses no words:

- **`ShelfTab.lines` and `ShelfTab.rows` are GONE**, replaced by one
  `ShelfTab.cards`; `ShelfView.looseRows` became `looseCards`. Removed rather
  than left behind a flag — two lists under one tab is what he rejected twice.
- **ONE CARD PER OWNED COPY**, not per row (the open question in the spec).
  A row holding two copies of one printing is **two cards**, because *"lent
  out"* is a fact about an OBJECT and each object needs somewhere to say it; the
  two cards hold the SAME row object, so the printing's identity, cover and meta
  line are still said in one place. Two chip groups on one card would put two
  answers under one heading and make the reader work out which chip is whose.
- **Chips** (his *"tabs"*) carry the copy's differences, in his round-2 order:
  the badges the tab header did not take (signed LAST of them), then a status
  that is not "on the shelf" as one phrase (*"Lent out to Sam"*), then the
  location, then **a condition that is not the plain `good`** — his own example
  dropped `good`, and the hover still says it either way. Only the status chip
  takes a colour (`.special-badge--status`).
- **An unlinked copy is a card titled by its FORMAT WORD** — all three on
  /work/263 today — and it is the SAME card as a *"May be yours"* candidate.
  ⚠️ The state pill is the difference; the dashed `bd-hold--available` ground
  was KEPT, because "an available card must never read as a holding" is a
  standing anti-fabrication rule and the pill alone is a thin guard.
- **`SignedChip` and its dashed *"Not signed"* pill are DELETED.** Round 2 had
  already stopped printing the negative anywhere a person could see; with every
  owned copy now a card whose chips are only what distinguishes it, a positive
  *"Signed"* is an ordinary badge chip and there was no reachable caller left.
  The record is still answered both ways on the card's hover.
- Untouched: the tab set and its order, the tab-header lift (*"Hardcover · all
  signed"*), MAY BE YOURS wording, the audio provenance sentence, ebook files,
  wishes (a wish is NOT exploded per copy — no object, nothing to chip).

**Measured at the commit:** `npm test` **2311 pass / 0 fail** (2297 before round
3; +2 for round 3's own cases, +10 with the edition note below); `npm run
typecheck` and `npm run build` clean. ⚠️ **Twelve pins were AMENDED rather than
added** — the SENTENCES did not change, only the shape they arrive in, so each
now reads the same words off `card.label` + `card.chips` (a `says()` helper
rebuilds round 2's line grammar so his written example still reads verbatim).

⚠️ **NOT VERIFIED:** nothing seen on a live page — no deploy. The component
still has **no test** (no jsdom in this harness), so the chip markup, the tab
strip and the keyboard are unexercised; only the derivation is pinned.

☐ **Review after the deploy:** <https://library.heygabi.ai/work/263> — the
Hardcover tab should hold **six cards in one list**: three of his (*Hardcover*,
*Hardcover* + chip *Sprayed edges*, *Hardcover* + chip *Lent out*) and the three
*May be yours* printings — and padhard
<https://padhard.heygabi.ai/work/642> for two tabs each with a NAMED card.

## ☐ EDITION NOTE: move the "no barcode printed on this copy (owner-verified)" text out of the edition NAME into a note on the edit page — owner ask 2026-09-03 17:22 Phoenix

Owner, verbatim: *"Also remove the no bar code part from the title and put
it into a note in the edit page of the edition entries"*.

**Measured 17:30 Phoenix** (`SELECT … FROM edition WHERE edition_name LIKE
'%owner-verified%'`) — **MAIN 9 rows, padhard 1 row**:

| Instance | id | work | format | `edition_name` today |
|---|---|---|---|---|
| MAIN | 307–311 | 224–228 | hardcover | `Illumicrate Exclusive - no ISBN printed on this edition (owner-verified)` |
| MAIN | 378 | 263 | hardcover | `V1 Limited Edition hardcover — No barcode printed on this copy (owner-verified)` |
| MAIN | 379 | 263 | hardcover | `V1 Limited Edition Standard hardcover — No barcode printed on this copy (owner-verified)` |
| MAIN | 450 | 7 | paperback | `No barcode printed on this copy (owner-verified)` — the WHOLE name |
| MAIN | 470 | 33 | paperback | `No barcode printed on this copy (owner-verified)` — the WHOLE name |
| padhard | 426 | 433 | hardcover | `Allural — No barcode printed on this copy (owner-verified)` |

`edition` has **no note column** (columns: id, work_id, isbn13, isbn10,
asin, format, edition_name, publisher, published_year, pages, language,
cover_url, source, source_url, cwa_book_id, created_at, updated_at,
edition_kind, collects). So this is a MIGRATION (`migrations/0460_…`, last
is `0450_audiobook_match_review.sql`), a schema/route change
(`updateEditionSchema` in `@lc/core`, `updateEdition` in `packages/db`,
`PATCH /api/editions/:id` in `apps/worker/src/routes/catalog.ts`), an edit-page
field (`apps/web/src/components/Editions.tsx`), and a **data sweep on both
instances** that splits the suffix off (` — No barcode…` / ` - no ISBN…`)
into the note. The two whole-name rows (#450, #470) get the name
*"Standard edition"* — today's precedent for a plain paperback with no
distinguishing name (say so on review; ☐ owner may rename).

☑ migration 0460 → ☑ schema + route + db → ☑ edit-page note field (shown
and editable per edition entry) → ☑ sweep script with `--dry-run` and
`--friend` → ☑ migrate PAIR → ☑ sweep on BOTH (report both counts: MAIN 9,
padhard 1 expected) → ☑ deploy PAIR → ☑ live proof on /work/263 (names
clean) → ☐ owner sees the note on ✎ Edit → editions (not checked — the edit
page needs a sign-in this proof did not have) → ☐ owner may rename #450 /
#470 from *"Standard edition"*.

### ✅ BUILT 2026-09-03 — commit `47386c8` — ✅ **MIGRATED, SWEPT AND DEPLOYED TO BOTH 17:57 Phoenix**

- **Migrated 17:55** — `npm run db:migrate:both`: `0460_edition_note.sql` ✅ on
  `library-catalog` and ✅ on `library-catalog-2nd`.
- **Swept 17:56** — `node scripts/split-edition-note.mjs --remote --apply`
  (and `--friend`): **MAIN 9 matched / 9 names rewritten / 9 notes written /
  2 whole-name → "Standard edition" (#450 Dungeon Born, #470 Unmapped)**;
  **padhard 1 / 1 / 1 / 0** (#426 → *Allural*). Re-read after: MAIN
  `edition_name LIKE '%owner-verified%'` → **0 rows**; #307 *Illumicrate
  Exclusive*, #378 *V1 Limited Edition hardcover*, #379 *V1 Limited Edition
  Standard hardcover*, each with the phrase in `note`; padhard #426 *Allural*
  + note.
- **Deployed 17:57** — same pair as round 3 above (MAIN `064ec342`, friend
  `7d27c891`, bundle `index-D8DRuBYK.js`); /work/263's card names carry no
  suffix and the string *owner-verified* appears nowhere on the page.
- ⚠️ **NOT verified:** the Note field on the edit page (needs a signed-in
  session), a round-trip save through `PATCH /api/editions/:id`, the
  "no barcode" tick now writing `note` instead of the name.

- **`migrations/0460_edition_note.sql`** — `ALTER TABLE edition ADD COLUMN note
  TEXT`. ⚠️ **Run against NO remote** — the migrate PAIR is the conductor's.
  NULL here is an **absence** (nobody wrote a note), unlike `edition_kind`'s
  NULL, which is the positive claim *"ordinary printing"* (0050).
- **`@lc/core`** — `note` on the edition create/update schemas: trimmed, empty →
  null, capped at 500 chars. ⚠️ Deliberately **not** added to `blankSiblingOf`'s
  marks: two printings that differ only in somebody's remark are still two rows
  nobody can tell apart.
- **`@lc/db`** — `EditionRow.note`, `EDITION_COLS`, the INSERT, the UPDATE and
  the change-log diff. The contract test now pins `note` in `EDITION_COLS`, for
  the reason `cover_url` is pinned there: dropped from the SELECT it would
  render empty and every save would silently clear a verified remark.
- **`Editions.tsx`** — a **Note** textarea per edition entry, and a muted
  `📝 …` line on the row when it is set. ⚠️ **The "no barcode" TICK now writes
  `note`, not the name** — leaving it writing the name would have re-broken
  every row the sweep fixes, on the next tick. `RescanPrompt.tsx` and the two
  `createEdition` callers in `Copies.tsx` carry it through
  (`NewPrintingDetails.note`). ⚠️ No new 409 risk from `blankSiblingOf`:
  `newPrintingNeedsName` already forces a name in exactly the case the server
  would refuse.
- **`scripts/split-edition-note.mjs`** (+ `scripts/test/split-edition-note.test.mjs`)
  — dry by default, `--apply` (or `--commit`) writes, `--remote` / `--friend` as
  every other sweep. Splits at the **LAST** ` — ` / ` - ` before the marker, so a
  name's own dash survives; a name that is NOTHING BUT the phrase becomes
  **"Standard edition"**; an existing note is **never overwritten** (that row is
  printed under NEEDS THE OWNER and skipped). The marker is `owner-verified`,
  not `NO_BARCODE_NOTE` — production carries two wordings and only the
  parenthetical is common to both.
- **Display:** the note shows on the **edit page** only. It is deliberately NOT
  in a shelf card's headline (that is the printing's identity) and no shelf
  surface reads it yet — ☐ say whether he wants it as a muted line under a
  card's meta.

⚠️ **GOTCHA MEASURED WHILE BUILDING IT — belongs in
[`info/gotchas.md`](info/gotchas.md) when someone next touches that file:** a
`SELECT` naming a column D1 does not have comes back from `scripts/lib/d1.mjs`'s
`query()` as an **EMPTY ARRAY, not an error**. The first dry run printed
*"editions matched … 0"* against a MAIN catalog holding nine of them, and said
DRY RUN as if all were well. `requireNoteColumn` now reads
`pragma_table_info('edition')` first and refuses with an actionable message, so
this sweep can never report a zero that means "no such column".

**Measured at the commit:** `npm test` **2311 pass / 0 fail**; `npm run
typecheck` and `npm run build` clean. **DRY-RUN PROOF against MAIN** (read-only,
zero writes, run through the pure `planRow` because the column does not exist
remotely yet): **all 9 rows matched and parsed** — the five Illumicrate rows →
*"Illumicrate Exclusive"*, #378/#379 → *"V1 Limited Edition hardcover"* / *"V1
Limited Edition Standard hardcover"*, and #450 *Dungeon Born* + #470 *Unmapped*
→ **"Standard edition"** (whole name was the note).

⚠️ **NOT VERIFIED:** no migration run anywhere, no write to any remote, nothing
seen on a live page. **padhard's 1 row was not re-measured today** — the 17:30
figure above stands and is now hours old. The Note field, the row's note line
and the rewired tick have **no test** (no jsdom in this harness).

## ☐ SHELF round 2: "Better but still duplicate" → format tabs with the editions under each — owner ask 2026-09-03 15:18, spec 15:33 Phoenix

Lands on BOTH instances through the shared components (global rule
2026-09-03: one codebase, deploy PAIR). Review page: <https://library.heygabi.ai/work/263>.

Owner, 15:18, after reviewing /work/263 with round 1 (`dcbb79f`) live, verbatim:

> "Better but still duplicate, the hard cover section has info and the stuff
> underneath has information"

The card he reviewed read: *Hardcover · OWNED · Not signed* / *On the shelf ·
Sprayed edges* / *On the shelf* / *Lent out · good*, then three MAY BE YOURS
edition cards whose meta line repeats "Hardcover" under a name that already
says hardcover. Asked (one question, 15:20) whether the duplicate was the
copy lines' *"On the shelf"* (already what the OWNED pill means) or the MAY
BE YOURS meta word. His answer was a spec, not a pick — **15:33, verbatim:**

> "I want to see hardcover paperback cover audio ebook as the tabs and the
> editions owned of each under
> So paperback with standard under it. So very similar to A with minor
> changes. Keep what makes them different took.
> So hardcover
> Collectors edition - sprayed edges signed
> Standard edition
> Standard edition - signed - lent out"

**Read as:**

- The shelf is grouped by **format tabs** — Hardcover · Paperback · Audio ·
  Ebook (his list also says "cover"; taken as a slip between "hardcover" and
  "paperback" unless he says otherwise — ☐ confirm on review, not before).
  A format with nothing owned shows no tab.
- Under a tab, **one line per owned copy**: the edition name, then only the
  facts that distinguish THAT copy — ` - sprayed edges signed`,
  ` - signed - lent out`. A copy with nothing distinctive is its edition name
  alone (*"Standard edition"*). No *"On the shelf"* line, no *"Not signed"*:
  the absence of a word is the plain case.
- "Very similar to A with minor changes" = round 1's derivation stays (a fact
  printed once: shared facts on the group, differing facts on the copy); what
  changes is the SHAPE — tabs per format instead of a card per edition, and
  the copy line becomes *edition — differences* instead of *status · facts*.
- MAY BE YOURS stays as it is unless it duplicates the tab word; the format
  tab already says "Hardcover", so a candidate's meta line need not.

**Where it lives:** `apps/web/src/lib/shelf-view.ts` (`deriveShelfView`,
`physicalRow`, `splitBadges`, `ShelfRow`/`ShelfCopy`) and
`apps/web/src/components/OnYourShelf.tsx` (`ShelfCard`, `CopyFacts` — the
*"On the shelf"* word is added by `CopyFacts` whenever `withStatus`, i.e. on
every multi-copy list). Tests in `apps/web/test/shelf-view.test.ts`. Sized as
a web-only build (derivation + component + tests) — Opus, ~150k.

☑ build → ☑ tests → ☑ deploy PAIR from a clean tree → ☐ owner review on
/work/263 and a padhard work with two formats.

### ✅ BUILT 2026-09-03 — commit `0d794f0` — ✅ **DEPLOYED TO BOTH 15:58 Phoenix**

Deploy pair from the clean tree at `9b17f8b`, both from one build
(`assets/index-CEt3kbie.js`, served on both hosts at 15:59): **main**
`9ad44ecb-1659-4314-b46a-d6f2efda8cee` · **friend** `8e618f0a-1e98-4c54-8754-17124366ee1a`
(`deploys.log` lines `2026-09-03T22:57…`, holder `unknown` — the conductor's
shell had no holder name). **Seen live (15:59):** MAIN /work/263 → tabs
*Hardcover · Audio*, lines *Hardcover — Sprayed edges / Hardcover / Hardcover —
Lent out*, no *"On the shelf"*, no *"Not signed"* anywhere on the page — the
unlinked-copy rendering predicted below, exactly. padhard /work/642 → tabs
*Hardcover · Paperback · Audio*, line *Standard edition — Signed*. Tab
switching and the keyboard were NOT exercised live.

⚠️ Also measured on /work/263: neither the sprayed-edges copy nor the lent-out
copy is `is_signed` in the data, so his example's *"signed"* words will not
appear even after linking — ☐ ask whether those copies ARE signed (a data fix,
his call) or the example was illustrative.

**What landed** — all of it in the DERIVATION, so a test pins what the shelf
SAYS and the component chooses no words:

- **`ShelfView.sections` is GONE**, replaced by `tabs` + `looseRows`. Removed
  rather than left beside the new grouping: two groupings of one list is two
  things to keep in step, and only one is rendered.
- **Tabs are per FORMAT, in his order** — Hardcover · Paperback · *(any other
  physical format he did not name, e.g. Mass market)* · *Physical* (a copy whose
  binding cannot be attributed at all) · Audio · Ebook. A format with nothing on
  it gets no tab. ⚠️ The default tab is the first with something **owned**, so a
  book whose only hardcover is a *"May be yours"* printing opens on the format it
  actually has.
- **One line per owned copy:** the printing's name, ` — `, then only what
  distinguishes THAT copy — badges, then *Signed*, then a status that is not "on
  the shelf" (*"Lent out to Sam"*, one phrase), then the location. Nothing
  distinctive → the name alone.
- **Round 1's split is lifted from the PRINTING to the FORMAT**: a badge every
  copy under the tab carries is said once on the header (*"Hardcover · all
  signed"*) and appears on no line. ⚠️ It takes **two** copies for that to mean
  anything — a lone copy keeps its own facts on its line, because *"all signed"*
  over one book is a claim about a set of one.
- ⚠️ ***"On the shelf"* and *"Not signed"* are never printed** — the absence is
  the plain case, which is what he asked for. That **narrows the 2026-09-02 "say
  it either way" rule to the hover**: `line.title` still answers signing both
  ways and carries the condition his example dropped. ☐ Confirm on review that
  losing the visible *"Not signed"* is what he wants.
- **Untouched:** MAY BE YOURS, the wishes, the audiobook recordings (cover +
  the migration-0010 provenance sentence) and the ebook files keep the cards
  they had, inside their tab. The neutral slot and the formatless *"any format"*
  want belong to no format and sit beside the tabs.
- The tab strip **is** the edit box's strip — `.shelf-tabs` was added to every
  existing `.edit-box__tabs` rule, never given a look of its own.

**Measured at the commit:** `npm test` **2297 pass / 0 fail** (2282 before);
`npm run typecheck` and `npm run build` clean. Nineteen cases added; ⚠️ **three
were AMENDED rather than added** because they pinned `sections` (two in
`shelf-view.test.ts`, one in `audio-match-review.test.ts`), all marked and all
saying what they used to claim.

🔴 **HIS EXAMPLE WILL NOT RENDER ON /work/263 YET, and it is not a bug.**
Measured against production MAIN at the build: work 263's **three copies all
have `edition_id: null`** against **three hardcover printings** (378 *"V1
Limited Edition hardcover…"* `collectors`, 379 *"V1 Limited Edition Standard
hardcover…"*, 660 *"Standard Hardcover"*). Nothing attributes a copy to a
printing, so the work-220 anti-fabrication rule holds and the lines read:

> Hardcover
> Hardcover — Sprayed edges
> Hardcover
> Hardcover — Lent out

The three printings still show under the same tab as *MAY BE YOURS* cards.
☐ **The data follow-up is what turns that into his *"Collectors edition /
Standard edition"*** — link each copy to its printing under *✎ Edit this book →
Editions & copies*. Until then the shelf says what the record says.

⚠️ **NOT VERIFIED:** nothing has been seen on a live page — no deploy has
happened. The component itself has **no test** (there is no jsdom in this
harness): the tab strip, the default selection and the arrow-key handling were
exercised once by a throwaway `react-dom/server` render, which produced
*"Collectors edition — Sprayed edges · Signed"*, *"Standard edition"* and
*"Standard edition — Signed · Lent out"* exactly, and was then deleted.

☐ **Review after the deploy:** <https://library.heygabi.ai/work/263> (the tab
strip, and the three lines above) and — for two tabs each with a NAMED line, the
shape his example describes — padhard <https://padhard.heygabi.ai/work/642>
*The Ashes and the Star-Cursed King*, which holds one linked paperback and one
linked hardcover (measured on `library-catalog-2nd`, 2026-09-03).

## ☐ Audio-verdict residue (from part B, shipped 15:32 — the section is in [`DONE.md`](DONE.md))

- ☐ **OPEN** — `routes/reviews.ts` `/bookid-index` and `packages/db/src/tbr.ts`'s
  audio bridge do NOT filter `rejected` recordings. They are identity bridges
  into another catalog's documents; filtering them would silently move existing
  reviews / TBR entries and nobody has measured what that touches. Measure
  first (how many review/TBR rows key on a containment-matched recording on
  each instance), then decide.
- ☐ **Owner:** press *"Yes, this is it"* once on <https://library.heygabi.ai/work/347>
  (✎ Edit this book → Audio) — the route has never written a verdict against a
  real D1; the first press is the end-to-end proof.
- ☐ **padhard's 27 `fold` rows render nowhere found (15:35):**
  <https://padhard.heygabi.ai/series/He%20Who%20Fights%20with%20Monsters> (12
  fold rows) and the DCC page (8) both say *"Held: 1 in print. None of them are
  in the audiobook catalog"* with no audio chip on any rung. Either the fold
  rows attach to gap rungs that a one-book ladder with no known length never
  draws, or the series page is not reading them. Find where the owner saw
  "a lot" before assuming the 27 are visible anywhere.


## ☐ "Signed" typed into the edition name → the signed button ✅ **APPLIED TO BOTH INSTANCES 2026-09-03** (padhard 14:19, MAIN 14:33 Phoenix — different modes, see below), ☐ **6 rows to link by hand** and ☐ edition parity with the main catalog still open (owner ask 2026-09-03 ~13:00)

**Owner, verbatim (Discord/session, 2026-09-03):** *"Side project, Diva marked books as
signed manually in edition, sweep those and apply the button. Also diva's catalog
doesn't have editions like mine. Global rule apply all catalog changes to both
catalogs. Make shared global components and templates so they stay in sync"* — then
*"Make them all standard edition and signed instead of signed in the edition. Keep
the hardcover and paperback if available default to paperback if unknown"* — then
*"You're looking for padhard library not library"*.

Diva = Samantha Hardman = the `[env.friend]` instance `padhard.heygabi.ai`, D1
`library-catalog-2nd` ([`access/second-instance.md`](access/second-instance.md)).

✅ **Follow-up APPLIED 2026-09-03 14:58 Phoenix — owner: *"For books that lost
signed and became null make them standard edition"*.** Every edition the sweep
left with `edition_name IS NULL` now reads **`'Standard edition'`** (a data
write, not a display rule — the other ~440/~500 unnamed editions per instance
were not asked about and are untouched). Both instances, by explicit id list:

| | MAIN | padhard |
|---|---|---|
| rows named | **4** (#620/#621 *Something*, #622/#623 *Uncapped* — the four that were only "Signed"; the 16 that kept their other words were not touched) | **63** — recovered as *unnamed edition with a linked `is_signed=1` copy* (62) + work #136 *Mate*'s edition #135 (the one whose copy is still the owner's to pick); 63 = the sweep's 63 exactly |
| `edition_kind` | still NULL on all | still NULL on all 63 |
| rendered proof | not checked | <https://padhard.heygabi.ai/work/561> reads *Standard edition · OWNED · ✍ Signed · Paperback* (14:59) |

⚠️ `updated_at` was bumped by this write; the 14:19/14:33 sweeps had NOT bumped
it (measured — the padhard copies still carry their 08-22…08-28 stamps), which
is why the padhard set had to be recovered from the signed-copy join rather
than from a timestamp.

**Measured 2026-09-03 ~13:05 Phoenix on her D1 (read-only `d1 execute`):**

| Fact | Number |
|---|---|
| editions with `signed` in `edition_name` | **63** (47 paperback, 16 hardcover; 59 named exactly "Signed", 4 with more words: "Signed special" ×2 — already `edition_kind='collectors'` — "Signed deluxe edition", "After light edition/ signed") |
| of those, `edition_kind` set | 2 (the "Signed special" pair) |
| copies with `is_signed=1` on the whole instance | **4** |
| signed-named editions with NO copy linked | **55** — the work's copy sits with `edition_id NULL` (54 works have exactly ONE such copy, 1 work has several) |
| copies with no edition at all | 557 of 677 (main instance: 437 of 448 — same shape, so "link the copy" is not what "editions like mine" means) |
| works with no edition row | 15 (main: 0) |
| last migration | `0440_billing_cache.sql` — same as main |

⚠️ The signed button is `copy.is_signed` (`Copies.tsx` "Mark signed", migration
0001; 0430 explains why signed is a COPY fact). An edition row cannot be "signed";
the sweep therefore has to **link the work's unlinked copy to the edition and flag
the copy**, which is the same mechanism as the "link the unlinked copies" heading
below.

**Plan as specified by the owner (each row with `signed` in the name):**
1. `edition.edition_name → NULL`, `edition.edition_kind → NULL` — that IS "standard
   edition" in this schema (0050: NULL = ordinary printing, no badge). The 4
   multi-word names lose their other words too ("make them ALL standard") — listed
   above so he can veto any.
2. `edition.format` kept as is (all 63 are already hardcover or paperback); any row
   that were neither would default to `paperback`.
3. The copy: if the edition has a linked copy, `is_signed=1`; if not, link the
   work's sole `edition_id NULL` copy to it and set `is_signed=1`. The one
   many-copies work is reported, not guessed.
4. Dry-run by default, `--commit` to write, `--friend` for her D1 — the existing
   sweep idiom (`scripts/sweep-special-editions.mjs`). Run on BOTH instances (main
   is expected to match 0 rows; say so with the number).

### ✅ The sweep half — BUILT AND APPLIED to padhard, 2026-09-03 14:19 Phoenix

`scripts/sweep-signed-editions.mjs` (+ `scripts/test/sweep-signed-editions.test.mjs`,
16 unit tests on the pure `planRow` / `resolveCopyCollisions`; full suite **2234
pass / 0 fail**). Dry run is the default, `--commit` writes, `--friend` requires
`--remote`. Commit `a4153bc`.

**Applied on padhard — the dry run reproduced the measured table above exactly,
then `--commit` wrote 122 statements:**

| | |
|---|---|
| editions matched | **63** |
| names cleared → NULL | **63** |
| kinds cleared → NULL | **2** (the "Signed special" pair) |
| formats defaulted to paperback | **0** (all 63 were already hardcover/paperback, as measured) |
| copies flagged (already linked) | **5** |
| copies **linked + flagged** in one UPDATE | **54** |
| rows needing the owner | **1** |
| statements written | **122** |

**Verified after the write, not assumed:**

- re-running the dry run reports **0 editions matched** — idempotent, and the
  proof is the same command anyone can re-run;
- `SELECT COUNT(*) FROM copy WHERE is_signed=1` on `library-catalog-2nd` =
  **63** — exactly the 4 that pre-existed plus the 59 this wrote (5 + 54);
- spot-checked copies #489 / #562 / #606: each now carries its edition_id AND
  `is_signed=1`.

Review it: <https://padhard.heygabi.ai/> — e.g.
[work 561 *Level Me Up*](https://padhard.heygabi.ai/work/561),
[work 488 *Destroyers of the Light*](https://padhard.heygabi.ai/work/488),
[work 604 *Everything's Better with Lisa*](https://padhard.heygabi.ai/work/604).
The Editions panel now shows a plain printing with no name; the signed fact is
the lit **Mark signed** toggle on the copy.

**☐ ONE ROW NEEDS THE OWNER (padhard).** Its edition was normalised like the
rest, but no copy was flagged, because which copy is signed is not in the
database:

| Work | Was | Why it was not guessed |
|---|---|---|
| work **#136 "Mate"** (edition #135) | `edition_name = 'Signed'` | the work has **2 unlinked copies (#131, #320)** and neither is linked to the edition. Ask Diva which one she got signed, then `UPDATE copy SET edition_id = 135, is_signed = 1 WHERE id = <the one>;` |

**The 4 multi-word names, as applied** (the owner said "make them ALL standard",
so the extra words were deleted — listed here because that is the only remaining
record of them, and any one of them is restorable by hand):

| Edition | Work | Name deleted |
|---|---|---|
| #423 | A Kiss of Daggers | "Signed deluxe edition" |
| #503 | When I Picture You | "After light edition/ signed" |
| #632 | The Ashes and the Star-Cursed King | "Signed special" (+ `edition_kind='collectors'`) |
| #633 | Songbird and the Heart of Stone | "Signed special" (+ `edition_kind='collectors'`) |

### ✅ MAIN matched **20** rows — the word STRIPPED and the copies flagged, applied 2026-09-03 14:33 Phoenix

The expectation in the plan above was 0. It is 20, and **committing them would
be wrong**: unlike Diva's bare "Signed", these names are real vendor prose, which
migration 0050 says `edition_name` exists to keep byte-for-byte —
**"Kickstarter signed paperback" ×15**, "Campaign-only exclusive hardcover,
signed extras", "Collector's Edition Trilogy — Book 1 Signed & Numbered",
"Signed Leatherbound (two-volume set: …)", and two bare "Signed" rows
(*Something* #620/#621, *Uncapped* #622/#623).

Main's dry run in the DEFAULT mode: 20 matched, 20 names + 3 kinds would clear, 0
formats defaulted, 15 copies would be linked+flagged, **5 need the owner**. That
run was never committed, and the reason it was not is the whole of this section.

✅ **Owner answered 2026-09-03 14:26 Phoenix:** *"I think remove signed from the
name keep the rest, mark them all signed"*.

#### What was built — `--strip-word`, a second MODE of the same script

Commit `e23a432`, on `scripts/sweep-signed-editions.mjs` (**not** a second
script — one canonical sweep, two modes). `stripSignedWord()` removes the WORD
(case-insensitive, word-boundary) and keeps the rest; `edition_kind` is
**untouched** in this mode; `format` keeps the same hardcover/paperback rule;
*"mark them all signed"* is read literally — **every** copy of the work is
flagged, linked or not — while LINKING stays as conservative as it was.
21 new unit tests (**2255 pass / 0 fail** whole repo, up from 2234), including
the six before/after pairs the owner checked.

Two asymmetries in the name mapping, each pinned by a real name:

| Rule | Because |
|---|---|
| a connector glued to the word's **right** goes with it | "Book 1 Signed **&** Numbered" → "Book 1 Numbered" — the `&` joined *Signed* to *Numbered*, and one of them is gone |
| a connector on its **left** stays | "hardcover**,** signed extras" → "hardcover, extras" — the comma joins *hardcover* to an item that still exists |
| the remainder is capitalised only when the word was at the **start** | "Signed special" → "**S**pecial" — the only case where deleting a word promotes a lower-case one into first position |
| a dangling connector at either end is trimmed | "After light edition**/** signed" → "After light edition" |

⚠️ **The one thing it will not do:** `"signed"` inside another word ("cosigned").
The SQL's `instr` matches it, the word-boundary strip does not, so such a row is
printed under *word not found* and **left alone rather than mangled**. There are
none on either instance (measured 2026-09-03) — but a future one would sit in
the match set forever rather than being silently rewritten, which is the right
way round.

#### Applied to MAIN — the numbers, and the before → after table

`node scripts/sweep-signed-editions.mjs --remote --strip-word --commit`,
**36 statements**, 2026-09-03 14:33 Phoenix.

| | |
|---|---|
| editions matched | **20** |
| names rewritten (word removed, rest kept) | **16** |
| names emptied to NULL (were only "Signed") | **4** |
| names left alone (not a word) | **0** |
| kinds cleared | **0** — never, in this mode |
| formats defaulted to paperback | **0** (all 20 were already hardcover/paperback) |
| copies flagged | **1** |
| copies **linked + flagged** in one UPDATE | **15** |
| rows to link by hand | **5** |

⚠️ **This table is now the ONLY record of the old names** — the column was
overwritten, so any one of these is restorable only from here:

| Edition | Work | Before | After |
|---|---|---|---|
| #316 | Dungeon Crawler Carl: Crocodile | "Campaign-only exclusive hardcover, signed extras" | "Campaign-only exclusive hardcover, extras" |
| #319 | The Primal Hunter | "Collector's Edition Trilogy — Book 1 Signed & Numbered" | "Collector's Edition Trilogy — Book 1 Numbered" |
| #321 | Words of Radiance | "Signed Leatherbound (two-volume set: Vol 1 ISBN 9781938570308, Vol 2 ISBN 9781938570315)" | "Leatherbound (two-volume set: Vol 1 ISBN 9781938570308, Vol 2 ISBN 9781938570315)" |
| #336–#341 | Tamer: King of Dinosaurs Books 1–6 | "Kickstarter signed paperback" | "Kickstarter paperback" |
| #349 | Monster Empire Book 1 | "Kickstarter signed paperback" | "Kickstarter paperback" |
| #351–#355 | Tamer: King of Dinosaurs Books 7–11 | "Kickstarter signed paperback" | "Kickstarter paperback" |
| #358 | Monster Empire Book 2 | "Kickstarter signed paperback" | "Kickstarter paperback" |
| #620 | Something (paperback) | "Signed" | NULL |
| #621 | Something (hardcover) | "Signed" | NULL |
| #622 | Uncapped (hardcover) | "Signed" | NULL |
| #623 | Uncapped (paperback) | "Signed" | NULL |

**Verified after the write, not assumed:**

- re-running the dry run reports **0 editions matched, 0 statements** — the same
  command anyone can re-run;
- `SELECT COUNT(*) FROM copy WHERE is_signed=1` on `library-catalog`:
  **25 before → 41 after**, exactly the 16 this wrote (15 linked+flagged + 1
  flagged) and nothing else;
- `SELECT id, edition_name, edition_kind, format FROM edition WHERE id IN
  (316,319,321,336,620,621,622,623)`: the apostrophe in *Collector's* and the em
  dash both survived intact, and **#316/#319/#321 still carry
  `edition_kind='collectors'`** — the proof that this mode leaves the kind alone.

Review it: [work 220 *Words of Radiance*](https://library.heygabi.ai/work/220),
[work 478 *Something*](https://library.heygabi.ai/work/478),
[work 32 *Uncapped*](https://library.heygabi.ai/work/32) — and any Tamer volume,
e.g. [work 243 *Tamer: King of Dinosaurs Book 1*](https://library.heygabi.ai/work/243)
(edition #336), where the Editions panel should now read "Kickstarter paperback"
with copy #123's **Mark signed** toggle lit.

**padhard in the same mode: 0 editions matched, 0 statements** — as expected, the
full sweep already cleared every one of her names on 2026-09-03 14:19. Run and
reported rather than assumed.

☐ **FIVE ROWS TO LINK BY HAND (MAIN).** ⚠️ Every copy involved **is already
flagged signed**; what is missing is only which *printing* it belongs to, which
is not derivable from the database:

| Work | Editions | Why it was not guessed |
|---|---|---|
| #220 *Words of Radiance* | #321 | the work has **2 unlinked copies (#169, #382)** — both flagged signed, neither linked. Pick the leatherbound one: `UPDATE copy SET edition_id = 321 WHERE id = <the one>;` |
| #478 *Something* | #620 (paperback) **and** #621 (hardcover) | **two signed editions, one unlinked copy #407.** The copy is flagged; which printing he owns is the question. `UPDATE copy SET edition_id = <620 or 621> WHERE id = 407;` |
| #32 *Uncapped* | #622 (hardcover), #623 (paperback) | ⚠️ **the work has NO copy row at all** — nothing to flag, and a copy is never invented. Add the copy in the UI first, then mark it signed. |

**Still open — "diva's catalog doesn't have editions like mine" — MEASURED
2026-09-03 14:20, it is the THEME:** both hosts serve the same bundle
(`assets/index-BTMKoh3U.js`), the same eight tabs and the same controls. In the
owner's browser `library.heygabi.ai` runs his chosen *cyberpunk/dark* (uppercase
headings) while `padhard.heygabi.ai` falls to its per-host default *hearts/dark*
(`DEFAULT_THEME = "hearts"` in `[env.friend.vars]`, no theme stored for that
host). Same tab, different clothes. Second visible difference is data: her
printing came from a barcode scan (the "recorded as a paperback until someone
says otherwise" note); his is a hand-recorded box set. Reported to the owner.

⚠️ **What MAIN found that the friend data did not** — and it is now guarded in
code: *Something* has **two** signed editions (#620 paperback, #621 hardcover)
and **one** unlinked copy #407. A per-row plan would have linked #407 to #620
and then re-linked it to #621 — last write silently wins, report claims two.
`resolveCopyCollisions` sends both claimants to the owner instead.
Padhard has no such collision (checked).

**Still open — "diva's catalog doesn't have editions like mine":** both instances
run the same build (every deploy in `deploys.log` lands as a pair) and the same
migrations, so this is a DATA or a rendered-UI difference, not a missing feature.
Needs one owner answer: what he sees on his that he does not see on hers.

**Global rule (written to `~/.claude/CLAUDE.md` 2026-09-03):** every catalog change
lands on BOTH instances — one build, deploy pair, migration pair, sweeps run with
`--friend` too; posture vars mirrored unless a difference is deliberate and
documented in `second-instance.md`.


## ☐ CROSS-REPO: the LIBRARY half of the owner's 2026-09-02 ~14:00 batch is DONE — the platform file still says otherwise

⚠️ **Recorded here because `catalog-platform/docs/TODO.md` was read-only to the
session that did the work**, and a finished item that only one repo knows about
is exactly the silent staleness the docs standard exists to kill.

That file's section **"OWNER DECISION BATCH 2026-09-02 ~14:00"**, item 1
(*LIBRARY follow-up agent*), lists three things. **All three landed 2026-09-02**
and each has its own entry in [`DONE.md`](DONE.md):

| | Item | Where it landed |
|---|---|---|
| (a) | Harper Voyager publisher batch + the B&N-import sweep | committed to production D1; 7 rows corrected, 2 true B&N imprints left alone |
| (b) | Work-page merge — "On your shelf" becomes THE list | `783526b`, deployed both instances |
| (c) | Per-edition covers | `614759f`, deployed both instances |

☐ **Someone with write access to that tree ticks item 1** and moves it whole per
the standard. Items 2–4 of that batch (the AUDIOBOOK agent, the paused
other-computer work, Emberdark) are **untouched** and still open — this is only
the library half.


## ☐ Billing phase 3 landed INERT — two things remain (2026-09-02)

The build is on both instances (`e7b3f6b`, versions `77a9f67c` / `37b83f8b`) and
KI-13 is closed. What is NOT done:

### 1. ⚠️ The soak, then the flip — `BILLING_POLICY` is `"off"` on both

**The one-line change, per instance**, in `apps/worker/wrangler.toml`:

| Instance | Line | Today | Next |
|---|---|---|---|
| main | `[vars]` block, beside `ESTATE_APP = "library"` | `BILLING_POLICY = "off"` | `"shadow"` |
| padhard | `[env.friend.vars]`, beside `ESTATE_APP = "library2"` | `BILLING_POLICY = "off"` | `"shadow"` |

⚠️ **`apps/worker/src/lib/billing-gate.test.ts` reads that file and FAILS unless
both say `"off"`** — deliberately. Update the assertion in the same commit as
the flip, so a flip can never ride along on an unrelated deploy (design §4.2).
Then deploy that instance alone (`npm run deploy` or `npm run deploy:friend`),
never `deploy:both`, because **one site at a time** is the rule.

**Reading the soak:** `npm run tail --workspace @lc/worker`, then
`jq 'select(.evt=="billing_policy")'`. Each line carries `would_deny` AND
`proceeded` — the second field is the one the estate paid to learn it needed
(`catalog-platform/docs/info/audiobook-auth-soak-2026-08-16.md`: a soak whose
criterion cannot be falsified is not a soak).

**Flip shadow → enforce only when BOTH hold over ≥ 7 days** (§4.2):
1. **Zero `"would_deny":true`** on any feature the owner did not switch off.
2. ⚠️ **At least one `"would_deny":true`** on a feature he DID switch off, on
   that site. Without this half, "zero denials" is indistinguishable from "the
   instrument never ran" — which is exactly the `0 of 0 — unmeasured, not clean`
   verdict the audiobook soak reached.

⚠️ **Nothing can be measured until a rule exists.** The `billing_policy` table
has no row for `library` or `library2` today, so shadow would log a stream of
`would_deny:false` and satisfy criterion 1 while failing criterion 2 forever.
Write the throwaway deny FIRST, from the Spending panel on
<https://heygabi.ai/admin/>.

### 2. ☐ The CLI scripts (L9–L13) are still ungated, deliberately

`backfill-missing-covers.mjs`, `backfill-missing-isbns.mjs`,
`research-queue.mjs`, `audit-universes.mjs`, `probe-universes.mjs` — five paths
whose only gate today is a command-line flag, and one
(`research-queue.mjs:99`) hard-codes `OWNER_USER_ID = 1` and checks nothing.

Design §9 Q5's recommendation, unchanged: **honour policy as a WARNING with an
explicit `--ignore-policy` escape hatch, never a hard refusal.** A local script
the owner runs deliberately is not the threat model, and a CLI that refuses its
operator is a CLI that gets edited. The banner should read *"cover search is
switched off for library; re-run with --ignore-policy"*.

⚠️ They cannot reuse `lib/billing-gate.ts`: it reads a Worker request context.
They need the **system door** client instead (`lib/billing-system.ts` is the
shape — one HTTPS GET on this instance's app token), or the owner's own `/seen`
answer if the script is ever taught an identity. `cli.backfill` is the registry
id; ⚠️ L9 and L10 are ALSO covered by `research.covers` / `research.isbn`, and
that double cover is deliberate and pinned upstream — a path under two switches
is refused if EITHER denies.


> ✂️ **2026-09-02:** *"The audiobook deep link is a SEARCH, and on a
> series-named title it finds 16 books"* moved WHOLE to [`DONE.md`](DONE.md) —
> the link now searches the sibling catalog's **verbatim** title
> (`raw_title` / `audioKey`) instead of our stripped one, measured over that
> site's own 1,087 cards: **824 → 886** books reached uniquely, the one **dead
> search closed**, walls of ten-or-more **48 → 17**. ⚠️ It does NOT close the
> reported case — *The Wandering Inn* goes 16 → 14 and cannot go lower, because
> a numeral cannot discriminate under substring matching. That residue is
> [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) **KI-14**, with what would settle it.

---

## ☐ Cross-catalog links: the one decision this build deliberately did NOT take (2026-09-02)

The build is done and in [`DONE.md`](DONE.md); this is the single open thread.
Design of record: `audiobook_catalog/docs/info/cross-catalog-links.md` §5.

☐ **Should a curated join be WRITABLE on this side?** Today the four reviewed
  pairs are GUARDED here and rendered from the sibling's file; this side writes
  nothing curated, because `audiobook_edition_holding.matched_via` is
  `CHECK (matched_via IN ('exact','alias','containment'))` and a `'curated'`
  value means rebuilding the table **and** the `audiobook_holding` VIEW over it,
  on **two** production databases.
  ⚠️ **Migration 0110 already settled the shape, if it is ever done:** an
  owner-confirmed *series* link got its **own table** rather than a new enum
  value, for the same reason (an upsert would overwrite the confirmation).
  **What would change it:** the two `work_alias` rows that carry works 230 and
  232 being judged too fragile to rest on, or a second book needing the same
  two-works-one-audiobook shape. The number to watch is how many curated pairs
  exist — **4 today**, and one file, one owner decision.

## ☐ DATA: link the unlinked copies on the multi-printing works, so the shelf can name them (2026-09-02)

Fallout of the shelf change above, and a **data** task, not a code one. Where a
work has **two printings of one format** and its copies carry no `edition_id`,
the shelf can no longer name the edition — correctly, because with two
candidates a borrowed name is a guess (that was the work-220 fabrication the
change removed). Such a row renders the format word plus its per-copy chips.

**Work 220 (*Words of Radiance*) is the worked example.** Two owned copies —
one `is_signed`+`leatherbound`, one `slipcase` — against two hardcover
printings: Dragonsteel's *"Signed Leatherbound (two-volume set…)"* and Tor's
*"Volume of the slipcase set"*. The attribution is obvious **to a human** and
the copy flags all but spell it out, but ⚠️ **inferring it in code would be
exactly the guess the invariant forbids** — matching special-edition prose to
copy booleans is a heuristic, and a wrong match is a fabricated identity on the
owner's own shelf. So it is a person's call, one work at a time.

**How:** the edit box's **Editions & copies** tab, *"Which printing do I own?"*
on each copy (`Copies.tsx`). Setting `copy.edition_id` immediately upgrades the
row from `resolvedBy: null` to `'linked'` and the headline from *"Hardcover"* to
the printing's own name — no deploy, no migration.

**Scope, measured 2026-09-02:** **22** (work, format) pairs in production hold
more than one printing of the same format. Not all of them have unlinked copies;
that narrowing has NOT been measured.

> ✂️ **2026-09-02:** *"SHIPPED-NOT-DEPLOYED: the donor alias rung is on `main`
> and NOT yet on either Worker"* moved WHOLE to [`DONE.md`](DONE.md). The
> headline claim is **false and has been since 2026-08-27**: measured against
> Cloudflare (not read off the log), main serves version
> `2ee0da31-c2c2-4e0a-9065-767c629fd0b2` and friend
> `3abcb1de-de22-4ab4-af00-1daa72c6a039` at 100%, and `603d2a2` — the commit
> that wrote the rung — is an ancestor of both. ⚠️ Its residual *"deployed is
> not verified"* thread came with it and is **not closed**: see that entry for
> why no probe from outside can settle it (the route answers **404 to
> everything without `DONOR_TOKEN`, by design**).

> ✂️ **2026-09-02:** *"A research run must SAY what the free ladder found and
> skipped"* moved WHOLE to [`DONE.md`](DONE.md) — `result_json.free` is
> persisted (no migration) and rendered per run on `/queue`. The standing
> "the free rungs can never assert 'none'" limit is now
> [`info/free-details-ladder.md`](info/free-details-ladder.md) §7.

> ✂️ **2026-08-31:** the *"OWNER: confirm these 2 cross-instance near-misses"*
> section moved WHOLE to [`DONE.md`](DONE.md) — Q1 was applied 2026-08-26, and
> Q2 (*Keepers of the Light* / Broken Prophecies) was un-pinned by the owner's
> physical check (*"ITS BOOK 1"*): padhard #489 retitled, printed form "1" set,
> old title kept as alias, batch `owner-2026-08-31-broken-prophecies`.

## ☐ Should the SECOND recording of a book be storable? (`audio_key` is a persisted key — 2026-08-26)

Written up as [`KNOWN_ISSUES.md` KI-12](KNOWN_ISSUES.md) and repeated here
because it needs an owner decision, not a fix. The household owns **two**
*Isles of the Emberdark* audiobooks (one read by Kaleo Griffith + Jennifer Jill
Araya, one read by **Brandon Sanderson himself**) and `catalog.csv` gives them
the **byte-identical** title. `audiobook_edition_holding` is keyed
`(work_id, audio_key)` with `audio_key` = that verbatim string, so they collide
and only one is stored — works #4 and #348 each show one audiobook.

⚠️ **`audio_key` is deliberately the same string as the content-warning key**
(migration 0340's `raw_title`), so widening it is a **migration with its own
review**, not an edit. Measured 2026-08-26: **1 pair** in the 1,084-row catalog
is affected. Do it when that count grows, or when you want both narrators on a
work page. The ACOTAR dramatizations are unaffected — their raw titles differ.

## ☐ Custody gaps: THREE main-instance secrets are live with no readable master (2026-08-26)

🔴 **Two of these are NEW, and they falsify a row in the 2026-08-26 secrets
review.** That review recorded them as *"master: library `.dev.vars` (file
exists; contents unopened)"* — a statement about the FILE, which its own header
was honest about. Parsing the file for NAMES (never values) during the 1Password
import measured the contents for the first time:

| Secret | Live on | In `.dev.vars` | Pair / master |
|---|---|---|---|
| `ESTATE_APP_TOKEN_LIBRARY` | main | 🔴 **absent** | `estate-auth` is the VERIFIER — a re-mint sets the verifier first, then main |
| `INDEX_PUSH_TOKEN` | main | 🔴 **absent** | `catalog-index` holds it as `INDEX_PUSH_TOKEN_LIBRARY` — verifier first |
| `AUDIOBOOK_MAPPING_TOKEN` | main + friend | 🔴 **absent** | master is `audiobook_catalog/.env` `LIBRARY_MAPPING_TOKEN` — a COPY exists, it just is not here |

⚠️ **The vault does not close these and cannot.** 1Password became the master on
2026-08-26 for the 13 keys `.dev.vars` actually held; a vault cannot hold a value
nothing on this machine can read. All three print `skip (not set locally)` on a
dry run **from either source**, so `secrets:push:both` cannot rotate them.

**What would close each:**
- `AUDIOBOOK_MAPPING_TOKEN` — cheapest: copy the existing value from
  `audiobook_catalog/.env` `LIBRARY_MAPPING_TOKEN` into the vault as item
  `AUDIOBOOK_MAPPING_TOKEN`, regenerate the template, done. No rotation, no
  downtime. ⚠️ It is `SHARED_OPT_IN` (route-ENABLING), so a push to friend needs
  `--enable`; both her routes are already live and the flag does not turn them off.
- `ESTATE_APP_TOKEN_LIBRARY` and `INDEX_PUSH_TOKEN` — no copy exists anywhere, so
  each is a **mint-and-set-both-sides** operation: `openssl rand -hex 32` into the
  vault, set the VERIFIER first (`estate-auth`, `catalog-index`), then main, then
  verify the gated route. One at a time; a half-pushed pair is a silent 401/403/404.

## ☐ OWNER REVIEW — three surfaces nobody has looked at with their own eyes (2026-08-24 builds, merged + deployed)

Both 2026-08-24 branches are **merged, deployed and live on both instances**
— measured 2026-08-31 and again 2026-09-02 — and each moved WHOLE to
[`DONE.md`](DONE.md) on 2026-09-02. ⚠️ **This item is the part that did NOT
land with them: nobody has confirmed any of it in a browser.** Shipped is not
verified, and the two are tracked separately, per item.

| ☐ | Look at | What should be true |
|---|---|---|
| ☐ | <https://library.heygabi.ai/work/493> | *.hack//Another Birth Vol 2* reads **Owned — Paperback**. This is the live proof of the copy-driven shelf: 1 owned copy, 1 paperback edition, **no `edition_id` link** — it used to read *"Paperback — Wanted"* |
| ☐ | <https://library.heygabi.ai/work/269> | the second shelf case the build named |
| ☐ | <https://library.heygabi.ai/collection> | the **Type** filter is multi-select — hardcover / leatherbound / paperback / mass_market / ebook / audiobook, each tickable, OR-ed. Ticking **Hardcover** must also match a **leatherbound** copy (leather ⊂ hardcover in the data), while **Leatherbound** stays its own box |

🔴 **One owner ACTION is still outstanding, not just a look** — it is steps
2 and 3 of the special-editions go-live, and **no record of a run was ever
found**:

```bash
node scripts/sweep-special-editions.mjs --remote            # main, DRY RUN — read the plan
node scripts/sweep-special-editions.mjs --remote --friend   # padhard, DRY RUN
node scripts/sweep-special-editions.mjs --remote --commit   # + --friend, once the plan looks right
```

It maps rows whose **prose** says leather / sprayed / slipcase onto the real
columns migration `0430` added, and proposes `format → hardcover` for a
leatherbound copy sitting on a non-hardcover edition. ⚠️ **Its dry-run count
has never been measured** — the owner gets it from the first command. Until it
runs, badges on un-swept rows come from the **prose fallback**, which still
works; the sweep is what makes them read the columns.

⚠️ **Nothing here is blocked and nothing is broken.** Both features are live;
this is the confirmation half of *shipped ≠ verified*, and it needs a signed-in
human — which is why no session can close it.


> ✂️ **2026-09-02:** *"Retire `docs/HANDOFF.md` — a competing living doc the
> standard forbids"* moved WHOLE to [`DONE.md`](DONE.md) — done in one commit:
> five cited facts to [`info/decisions.md`](info/decisions.md), **31** inbound
> references repaired (the item's table said 18 and undercounted — it missed
> `README.md`, two migrations, `ExportPage.tsx`, two `scripts/` headers and
> `check-clean.mjs`), husk to [`archive/HANDOFF.md`](archive/HANDOFF.md) with a
> dated banner. `grep -rn HANDOFF` now returns **no live pointer** — only the
> husk, the two archives, and eight tombstones that say it is retired.


> ✂️ **2026-09-02:** *"Format fix — scan-time toggle + GABI confirmation
> (Kiro, queued 2026-08-22)"* moved WHOLE to [`DONE.md`](DONE.md) — built and
> shipped `57d8211`. The toggle is on `/add`; the confirmation is free (Open
> Library's `physical_format`, never a paid rung); no migration.
> ⚠️ Its entry names three readings taken CONSERVATIVELY where Kiro's wording
> was ambiguous — read them there before assuming what "auto-open persistence"
> was taken to mean.

## ☐ OWNER FEATURE REQUESTS — written by him directly into this file, 2026-08-23

> He added these himself, with the note *"This was added by the user not the Ai.
> Please apply formatting and rules to these request"* and *"always ask more
> details if needed"*. Formatted here, verbatim meaning preserved, with the open
> questions named rather than guessed. ⚠️ **His original text was lost once
> already** — see the encoding incident in [`info/gotchas.md`](info/gotchas.md).

### ~~OR-1~~ ✅ SHIPPED 2026-08-23/24 AND LIVE ON BOTH INSTANCES — the whole record is in [`DONE.md`](DONE.md)

> ✂️ **2026-09-02:** this section was a **stale duplicate**. `DONE.md`'s own
> OR-1 entry opens *"Moved here whole from `TODO.md`"* — and then the copy here
> was never cut, so one ask had two homes for ten days and the one people read
> first was the one that said it was unbuilt. Removed rather than badged, per
> the done-items-get-moved-not-badged rule; the ask, his three answers, and the
> design are all in [`DONE.md`](DONE.md), unedited.
>
> `copy.person_user_id` + `copy.person_name` (migration `0400`), the
> `editCatalog`-gated `GET /api/members` autocomplete, the one redaction rule in
> `apps/worker/src/lib/copy-person.ts`, sold-as-tombstone via `NOT_ONLY_SOLD`,
> and *"Books with you"* on the TBR page. **Measured 2026-09-02:** migrations
> list answers *"No migrations to apply!"* on **both** `library-catalog` and
> `library-catalog-2nd`, and `GET /api/members` answers **401** (not 404) on
> `library.heygabi.ai` **and** `padhard.heygabi.ai` — the route exists on both,
> which is what settles that the deploy carried it.
>
> ⚠️ **What is still NOT verified is the same thing DONE.md's entry named:
> nobody has exercised the three CALLER CLASSES against a live instance.** The
> redaction is unit-tested only, because `wrangler dev`'s bypass signs in as a
> single owner — so "an editor sees the name", "the linked person sees their own
> row" and "everybody else sees only the status word" have been proven in tests
> and never in production. That needs a signed-in human on each side, and it is
> the one thing left. **His standing answers, for whoever does it:** live join
> (the card shows the member's CURRENT display name), owner **+ the linked
> person** (not owner-only), and sold keeps the row.

### OR-2. Find duplicates — copy the board-game filter, don't redesign it

> *"ability to search a catalog for duplicates with a filter, we have this
> filter in boardgame catalog so lets mimic it from there instead of
> redesigning the wheel"*

⚠️ **This is an explicit reuse instruction, so the first step is to READ
`Board_Game_Catalog`'s implementation, not to design one.** Match its grammar
and its wording; a second, differently-shaped duplicate finder in the estate is
exactly what he is saying not to build.

**Ask him before building:** duplicates of a WORK (same book twice) or of a
COPY (two physical copies, which is legitimate and common)? The two want
different defaults.

### ~~OR-3~~ ✅ BUILT AND VERIFIED BY LIVE USE — moved to [`DONE.md`](DONE.md) 2026-09-01

`pause_mode` (`all`|`manual_only`) shipped 2026-08-23 in
`audiobook_catalog/app/core/ingest_control.py`, and the card's choice was
**proven by the owner using it**: the 2026-09-01 08:00 ingest log carries a
refusal reading *"paused by the dashboard — the scheduled 12am-8am window may
continue, but this is a manual start (set by estate-ops:…)"* — a `manual_only`
pause he set himself. Whole record in DONE.md.

---

## ☐ The EBOOK library's half of "say 2" — belongs to `audiobook_catalog`

The physical library's half shipped on `feature/audio-edition-count` and is in
[`DONE.md`](DONE.md) with the whole design; this is the piece that decision left
open, filed here only because the ask was made here. ⚠️ **Move it to that repo's
TODO when it is picked up, and do not reach into that repo from this one.**

> Owner, 2026-08-23: *"have it say 2 on the physical and ebook libraries."*

`ebooks.heygabi.ai` is `audiobook_catalog`'s `site/ebooks.html`, proxied by the
`ebooks-door` Worker. Two files there, measured 2026-08-23:

| File | What it does today | What it would need |
|---|---|---|
| `scripts/build_ebook_manifest.py` (record built ~line 1097; join at `sibling_catalog_match`, ~line 403) | writes `beside_audiobook` and `audiobook_title` per ebook, from ONE matched `catalog.csv` row | a new manifest field — a COUNT of the sibling rows this ebook matches |
| `site/ebooks.html` (~line 930, `.eb-audio-link` styled at ~line 386) | renders a bare *"Also on audio →"* link when `beside_audiobook` is set | say the number when it is more than one |

⚠️ **It cannot count today, and the reason is not a missing field.** The join is
deliberately conservative: `_agreed_row` (~line 389) **refuses** two rows that
name different covers as *"genuinely ambiguous"*, so a second edition there
removes the mark rather than doubling it.

⚠️ **`library_work_id` is not the shortcut it looks like.** The CSV carries it,
stamped by `app/library_link.py` — but measured 2026-08-23 across all **1,081**
rows, **no work id appears twice**: row 995 (*Elantris*, full cast) is stamped
514 and row 996 (*Tenth Anniversary*) is stamped nothing, because that side's
matcher refuses it for the same reason `KI-6` does. Counting by
`library_work_id` would report 1 for every book in the catalogue.

**Ask before building:** does the ebook site count rows in `catalog.csv`, or
wait for `KI-6` to be settled so both sides agree on what a second edition is?

---

## 🔜 START HERE NEXT SESSION — the audiobook link build, designed but NOT started

> Owner, 2026-08-22 ~23:40 Phoenix: *"we need to add audiobook sweep to the
> pipeline, we also need the schema change"* — then, on seeing the weekly budget:
> *"youre right, i shouldnt have started this build … we come back fresh."*

⚠️ **NOTHING WAS WRITTEN toward either item. No half-finished files, no partial
migration, no dirty tree.** The design below is the expensive part and is done;
what remains is typing. Weekly usage was **96%** with the reset at **16:00
Phoenix Sunday 2026-08-23** — start after it.

### A. The sweep becomes a pipeline step — `audiobook_catalog`

`scripts/backfill-audiobook-holdings.mjs` is hand-run, and that is the whole
defect: 401 of 493 works had arrived since its last run. It is **STEP 11**,
modelled line-for-line on STEP 8 (`_run_drive_parity`).

⚠️ **It must run on the IDLE path as well as the busy one**, and its reason is
stronger than parity's: the drift arrives when the **library** gains books,
which is completely uncorrelated with whether this machine gained an audiobook.
Wiring it only to the busy path reproduces exactly the failure being fixed.

Files, all of them — the step list is mirrored in four places and they must agree:

| File | Change |
|---|---|
| `scripts/sync_to_drive.py` | `_run_sibling_link()` after `_mirror_estate_backups()` in **both** paths (busy ~line 1489, idle ~line 1180); `_step_link()`; `STEP_INFO["link"]`; `_STEP_HANDLERS["link"]` |
| `app/pipeline_status.py` | append `("link", "Link sibling catalogues")` to `STEPS` |
| `catalog-platform` `ops.ts` / `admin.js` / `status.js` | ⚠️ `STEP_INFO`'s comment (sync_to_drive.py:1752) says this mirror is **manual — there is no shared module.** Miss it and the step renders unlabelled |
| `tests/test_pipeline_steps.py` | pins the list; update in the same commit |

- **kind: `publishing`.** It writes another app's PRODUCTION D1, which deserves
  the top confirmation tier, not `mutating`.
- Shell out the way parity does: `subprocess.run`, `PYTHONIOENCODING=utf-8`,
  a timeout, **never raises**, exactly one named line on every path
  (applied / in sync / skipped / failed). `npx tsx scripts/backfill-audiobook-holdings.mjs --remote --commit`, cwd = the library repo.
- ⚠️ It needs the **path to `library_catalog`**, which `app/config.py` does not
  have (`ROOT_DIR` is the audio library, not the sibling repo). Add one env-var
  constant with a named skip when it is unset — a machine that cannot reach the
  sibling must be distinguishable from one that reached it and found nothing.

### B. The schema change — two audio editions per work — ✅ MOVED

Migration 0390 shipped 2026-08-23 on `feature/audio-edition-holdings`; the whole
item is in [`DONE.md`](DONE.md), and what it did NOT close is `KI-8`/`KI-9` in
[`KNOWN_ISSUES.md`](KNOWN_ISSUES.md).

> ✂️ **2026-09-02:** part **C** (*"mark this copy signed"*) moved WHOLE to
> [`DONE.md`](DONE.md). It was already built — `ede7ff3` (2026-08-22) put the
> control on the copy row and `eeb08ab` (2026-08-24) generalised it to all four
> special-edition attributes — and it is live on both instances. What was
> missing was a test: nothing failed if the chips stopped rendering, and this is
> a control whose absence has been reported once already. `2026-09-02` added
> `apps/web/test/copy-special-toggles.test.ts`.

**Verify the two that remain:** work 514 shows both audio editions and its series
(<https://library.heygabi.ai/works/514>); `/status/processing` lists the new
pipeline step by name.

## ☐ Covers for the SECOND instance — owner ask, 2026-08-22

> *"we need a way to get covers, can we have missing details fill in covers or
> have a button on each book page to find covers with llm or something"*

⚠️ **Piece 1 of the three below is DONE (2026-08-22 and 2026-08-23). Pieces 2
and 3 are not started, which is why this entry is still here.** The numbers in
this section were re-measured **2026-08-23 21:45 Phoenix**; the durable record
lives in [`info/covers-and-series.md`](info/covers-and-series.md) §0/§0.1/§0.2
and that file, not this one, owns the figures.

| Instance | Works | Cover needed | Broken stored covers |
|---|---|---|---|
| `library-catalog` (library.heygabi.ai) | 493 | **4** — 2 blank + 2 `standin` | **0 of 490** — ⚠️ measured 20:30, not re-run |
| `library-catalog-2nd` (padhard.heygabi.ai) | 532 | **15** — 13 blank + 2 `standin` (was 17) | **1 of 519** (work 356, a 503) |

**What the 2026-08-23 sweeps did.** `--standins` was added so the sweep asks the
app's own `coverNeeded` question instead of `cover_url IS NULL`; all **17**
padhard stand-ins closed on the **free** rungs for **$0.00**, and the paid rung
wrote **2** on main for **12.43c of tokens** (4 calls, one aborted). Three
writes were then reverted to `standin` after *looking at the images* — see
§0.1 and **KI-6**.

Later the same evening the paid rung was pointed at padhard's 15 blanks on the
**owner's** key via `--llm-key-from=main` (§0.2): **2 written, 1 held for him,
81.65c of tokens over 30 calls**, and the entry moved WHOLE to
[`DONE.md`](DONE.md). ⚠️ Two of those 30 calls bought nothing anybody kept —
`--llm` spends on the dry pass as well, and the dry pass is not a preview.

<details><summary>The 2026-08-22 figures this replaced</summary>

| Instance | Works | Cover needed | Broken stored covers |
|---|---|---|---|
| `library-catalog` | 452 | **0** | **0 of 452** |
| `library-catalog-2nd` | 369 | **47** — 40 blank + 7 `standin` | not measurable |

</details>

⚠️ **The main library is fine. The gap is entirely padhard, and it is NEW
DATA, not a regression.** Grouped by `created_at`: every row created on or
before 2026-08-19 (76 works) has a cover; the 293 works added **2026-08-22 and
2026-08-23 UTC** brought all 40 of the blanks. `audiobook_catalog/docs/TODO.md`'s
2026-08-21 line *"Padhard cover audit — all fixed"* was true when written and is
stale now — the shelf kept being loaded after the sweep.

### 🔴 The root cause is a tooling gap, and it is one line

**`scripts/lib/d1.mjs` line 32 hardcodes `const DB_NAME = 'library-catalog'`.**
Every backfill script imports `query`/`execute` from there, so
`backfill-missing-covers.mjs` — the whole free ISBN ladder — **cannot be pointed
at the second instance at all.** There is no flag for it. That is why padhard's
new rows have never met the ladder.

⚠️ **And `check-cover-health.mjs --friend` is misleading in the same way:** it
switches the *fetch base* to `padhard.heygabi.ai` but still reads its rows from
the MAIN database. It has never audited a padhard row. Do not read a clean run
of it as evidence about the second instance.

### What already exists, so nobody rebuilds it

- **The free ladder** — `backfill-missing-covers.mjs`: Open Library → Google
  Books (the rung that actually earns its place) → Bookcover API, every URL put
  through `verifyCoverUrl` before it is stored.
- **The paid LLM rung** — `packages/research/src/covers.ts`, `findCover()`:
  Claude + web search, structured `{found,url,source,confidence,note}`, ~6c a
  book, opt-in behind `--llm`. It returns an **unverified claim**; the caller
  must fetch it. Wired into the backfill **and**, since `2fadc19` (2026-08-24),
  into `POST /api/works/:id/cover/find` and the **"Search the web for a cover"**
  button — see item 2 below. (⚠️ This line said *"not wired to any route or
  button"* until 2026-08-25, four lines above the item recording that it was:
  review finding F20, one fact with two homes, already disagreeing.)
- **The manual paths** — `CoverPanel.tsx` + `routes/covers.ts`: link a URL,
  mark a stand-in, upload (501, no `COVERS` bucket bound), and `CoverSwap`'s
  "choose from known covers" picker.

### The three pieces of work, cheapest first

1. ~~**~30 min — teach `scripts/lib/d1.mjs` a `--friend` target**~~ — **DONE.**
   `dbName({remote, friend})` landed 2026-08-22 (`4a52589`), and
   `check-cover-health.mjs` was fixed in the same commit. 2026-08-23 added the
   `--standins` target set, made `--llm` read the key of the **instance** it is
   pointed at, and stopped it auto-writing low-confidence proposals. Both
   instances have been swept with `--commit`.
2. ~~**~1–2 h — the button on the book page.**~~ **DONE 2026-08-24** (owner:
   *"turn on cover search"*), shipped `2fadc19`, deployed both instances.
   `POST /api/works/:id/cover/find` in `routes/covers.ts` → `findCover` →
   `verifyCoverUrl` → propose (no store). `RequestCovers` grows a **"Search the
   web for a cover"** button beside "Choose from known covers", gated on
   **`runResearch`**, a `window.confirm` before each ~6¢ search, the proposal
   shown with its `confidence`/`note`/`source` and a **"Use this cover"** that
   applies through the verified `setCover` — no auto-apply, because *nothing in
   this system ever revisits a cover column*. Whole record in [`DONE.md`](DONE.md).
   ⚠️ Passing a work's edition ISBN to `findCover` for disambiguation is a later
   refinement (it passes `isbn: null` today; the target rows are ISBN-less anyway).
3. **The details queue — DECIDE, do not just build.** `cover` is currently an
   explicit entry in `REFUSED_FIELDS` (`packages/core/src/gaps.ts`), reasoned
   *"Research cannot make a JPEG"*. `findCover` post-dates that reason and
   disproves it — research cannot make a JPEG but it can find one. Un-refusing
   it means adding `cover` to `DETAIL_FIELDS`, which makes every details run
   able to spend the 6c rung. ⚠️ That is a **cost** decision for the owner, not
   a code decision.

**Verify:** the SQL in [`info/covers-and-series.md`](info/covers-and-series.md)
§0 — the four-column one, **not** `COUNT(*) WHERE cover_url IS NULL`, which is
not the question the app asks. Then `check-cover-health.mjs --friend --remote`.
⚠️ Neither is evidence about placeholders; **KI-6** says why and what is.

### 🧾 Named residue — what is left and what would settle it

| | Work | State | What would settle it |
|---|---|---|---|
| main | 511 *Beauty X Beast*, 512 *Rob X Punzel* | blank; free rungs and the LLM both found nothing | Mountaindale Press's own store has these — the publisher-page rung sketched in KI-6's neighbour, or a hand-linked URL |
| main | 513 *Snow X Dwight* | blank; LLM proposed the publisher's `og:image` at **low confidence** and it was correctly NOT written | Owner opens `https://www.mountaindalepress.store/cdn/shop/files/00_600x.png?v=1767642347` and presses Use, or rejects it. The model's doubt is only whether that file is the flat jacket or a 3D mockup |
| main | 516 *Sanctuary (Yuumei)* | `standin` — right book, 3D product photo | A flat jacket scan. The art book may not have one online |
| padhard | 113 *Summer in the City* | `standin` — the Google placeholder, **KI-6** | Any real cover; the ISBN rungs had nothing |
| padhard | 268 *The Villa* | `standin` — right book, **German** edition jacket | The English Berkley jacket, or the owner deciding the German one is fine |
| padhard | 435 *Risky Business* | blank; LLM proposed a **blog-hosted** image at **low confidence**, correctly NOT written | Owner opens <https://padhard.heygabi.ai/works/435> and presses Use, or rejects it. The model's doubt is provenance, not the book — the aspect ratio is a cover's |
| padhard | 13 blank works | free rungs exhausted; **paid rung run 2026-08-23 on the owner's key** and it found nothing for these 13 | A publisher-page rung, or hand-linked URLs. ⚠️ Re-running the paid rung will re-bill ~40c and, on the evidence, mostly return the same nothing — see the non-determinism note in [`DONE.md`](DONE.md) |
| padhard | 199 *Foxy Tales* | 🔴 has a cover and it is **50 pixels wide** | One word deleted from the stored URL — see below |
| padhard | 356 *Evocation* | stored Open Library cover redirects to an archive.org object answering **503** on 3 probes | Wait and re-run `check-cover-health.mjs --friend --remote`. Not cleared: a dead URL may be an outage, and blanking it loses where the cover came from |

### 🔴 A cover can be the RIGHT book and still be useless — 50 pixels wide

**Found 2026-08-23 21:40 Phoenix** in the run that closed the 15 (see
[`DONE.md`](DONE.md)). The paid rung wrote this onto padhard **199 *Foxy Tales***
at **high confidence**, and it is the right book:

```
https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1738511384l/222114404._SX50_.jpg
```

⚠️ **`._SX50_` is a Goodreads size token and it means 50 pixels wide.** The grid
renders covers at 150px and the detail panel at 190px (§2), so this is a smudge.
Measured, same URL with the token deleted:

| URL | Bytes |
|---|---|
| `…222114404._SX50_.jpg` (stored) | **1,980** |
| `…222114404._SY475_.jpg` | 34,579 |
| `…222114404.jpg` (no token) | **255,373** |

**Settles it:** `UPDATE work SET cover_url = '…222114404.jpg' WHERE id = 199` on
`library-catalog-2nd`, or the cover control on
<https://padhard.heygabi.ai/works/199>. **Not applied** — it is a production
write nobody asked for, and one word is cheap to review first.

⚠️ **This is KI-6's family with the size test inverted, and every guard we own
misses it.** `verifyCoverUrl` has a `MIN_COVER_BYTES` **floor** and no notion of
*too small to be usable*; `check-cover-health.mjs`'s 1,000-byte floor passes 1,980
comfortably; the KI-6 hash audit passes it because the hash is genuinely
**distinct** — it is a real, unique, correct, tiny image. Only looking at it
works, again.

**Worth ~30 min if it recurs:** strip `._SX\d+_` / `._SY\d+_` / `._UY\d+_` from
`i.gr-assets.com` and `m.media-amazon.com` URLs in `verifyCoverUrl`, re-verify
the stripped form, and keep it when it answers. ⚠️ Do **not** add a blanket
minimum-dimension check instead — the 43-byte Open Library pixel and the
4,013-byte Google card are already handled, and a dimension floor would start
rejecting legitimate small covers without saying why.

## ☐ Padhard's details queue is 2, and BOTH are named residue no lookup will close

> Owner, 2026-08-23: *"padhard shows 4 missing details"*.

**Measured 2026-08-23 20:15 Phoenix** by reproducing `listWorksNeedingDetails`
against `library-catalog-2nd --remote` — the DECISION imported from
`@lc/core` (`detailGaps` / `detailAsks` / `unaskedGaps`), never re-expressed as
SQL, for the reason that function's own header gives.

⚠️ **It is 2, not 4, and the difference is not a disagreement.** A person
(user 2) pressed the bulk runner at **02:00 UTC**, firing 12 lookups over four
minutes across works 513–531; those closed. The queue is loaded live and moves
by the hour.

| Work | Title / author | Open fields | Already ASKED? | Fate |
|---|---|---|---|---|
| **490** | *The Ex Hex Duo* — Killian McRae | `series`, `description` | ✅ all three asks, run **#645**, `done` 17:17 UTC | 🔴 residue |
| **468** | *Veil of Darkness* — Rachael Reese | `series`, `description` | ✅ all three asks, run **#685**, `done` 17:33 UTC | 🔴 residue |

Both runs finished cleanly with `proposed: 0` — the model looked and **could not
identify the book**, in its own words:

> *"Killian McRae wrote the 'All My Exes Die From Hexes' series and a
> complete-series bind-up titled **'The Ex Hex'**, but I could not find any
> listing for a title 'The Ex Hex Duo'."*

> *"Searches for 'Veil of Darkness' by Rachael Reese returned only unrelated
> books of the same title by other authors… 'Veil of Darkness' is a very common
> title, [so] matching any of these would risk attaching another book's details."*

### ⚠️ Nothing automatic will touch these again, and that is CORRECT

- **The `7 * * * *` cron will not.** `planSweep` filters on
  `unaskedGaps(missing, asked).length > 0`; both are empty. Verified the cron is
  otherwise alive: 61 CRON-triggered details runs, most recently work 512 at
  **01:08 UTC**, one book an hour.
- **"Look up all" on `/queue` will not.** `outstandingWorks` applies the same
  `unaskedGaps` rule, so the button will offer **0 books** and each row will
  carry its *"research looked and could not identify this"* sentence.
- **`scripts/research-queue.mjs` WOULD** — it selects on `gapsFor`, which is
  `missing`, not unasked — and it should not be pointed at these. It would buy
  the same nothing twice. ⚠️ **Its key blindness is FIXED** (2026-08-23, moved to
  [`DONE.md`](DONE.md)): it now reads `ANTHROPIC_API_KEY_FRIEND_SAM` under
  `--friend`, names the key, and refuses to fall back. It was worse than
  recorded here — `--friend` was parsed and then dropped, so the run would have
  mirrored MAIN as well as billing the wrong key. **Still do not point it at
  these two.** The instance question is settled; the buy-the-same-nothing-twice
  question is not.

### 🧾 What would settle each

| Work | Settles it |
|---|---|
| **490** *The Ex Hex Duo* | 🎯 **Retitle it** — still the cheapest fix that needs no deploy: correcting the title to **"The Ex Hex"** (which the model *did* find, as McRae's complete-series bind-up) makes it askable again and it will almost certainly close on the next tick. ⚠️ **As of 2026-08-24 there is now a second path:** the alias-aware retry is BUILT (branch `feature/alias-aware-research`, see [`DONE.md`](DONE.md)) — once that deploys, the existing `work_alias` "The Ex Hex" itself re-opens the question, no retitle needed. It re-opens a *paid* question, so the owner runs it |
| **468** *Veil of Darkness* | A person supplies the series/description by hand, or records a `gap_verdict` of `unknown`. The title is too common for research to disambiguate, which is exactly what the run reported |

Neither needs money and neither needs a deploy. Both need a signed-in human at
<https://padhard.heygabi.ai/queue>.

## ☐ Audiobook links after a bulk import, and TWO audio editions — the residue of the free-checks ask

> The rest of that ask — the free ladder in front of "look up", and the add path
> filling series/volume/description — **shipped 2026-08-23** and moved WHOLE to
> [`DONE.md`](DONE.md) (branch `feature/free-details-ladder`, **not deployed**).
> Design of record: [`info/free-details-ladder.md`](info/free-details-ladder.md).
> ⚠️ Its NOT-verified list is real: rung 2 has never run, Google Books answered
> **400** live, and nothing has been through the deployed route.

Three things in that entry did NOT ship, and none of them is a coding oversight:

**1. Re-run the link sweep after any bulk import.** `npm run backfill:audiobooks`
is a *manual script* and always will be: its only source is
`audiobook_catalog/site/catalog.csv`, a file on disk beside this repo that a
Worker cannot read. 401 of 493 works had arrived since its last run, which is
the whole reason work 514 looked broken.
⚠️ The ladder now degrades instead of returning nothing when the sweep is stale
— a missing or series-less holding falls through to Open Library — so this is no
longer urgent. It is still the thing that makes rung 1 answer.

**2. 🔴 The household owns TWO Elantris audiobooks and the schema holds ONE.**
`audiobook_holding.work_id` is a `PRIMARY KEY` (migration 0010). The row that
landed is the full-cast edition, whose `series` is NULL; the Tenth Anniversary
Special Edition, which the CSV gives `series=Elantris` volume 1, has nowhere to
go. **This is being done separately** — `audiobook_holding` becomes a VIEW over a
new `audiobook_edition_holding` table. Until that lands, the work page names one
of several audio editions without saying so.

~~**3. 🔴 OWNER DECISION — `INDEX_READ_TOKEN`.**~~ ✅ **TAKEN AND SHIPPED
2026-08-25** — moved whole to [`DONE.md`](DONE.md) ("Rung 2 of the free ladder is
LIVE"). The credential exists on both instances and the rung calls
`/api/machine/lookup`. ⚠️ It turned out the rung was not merely dark: it was
pointed at the HUMAN route with both env vars set, so it was **refused every run
while looking configured**. Contract of record:
[`info/free-details-ladder.md`](info/free-details-ladder.md) §4.

**Verify, once the branch is deployed:** work 514 shows its audiobook and its
series on <https://library.heygabi.ai/works/514>, and a "look up" on a book the
audiobook catalog holds reports a free rung as the source rather than an LLM run.

> ✂️ **2026-08-31:** the three ✅ sections that sat here (GABI unification — all
> phases deployed 2026-08-21; three feature branches — all merged 2026-08-21;
> ISBN backfill — complete 2026-08-21) moved WHOLE to [`DONE.md`](DONE.md), per
> the done-items-get-moved-not-badged rule.

## 🧰 Tech debt (owner-ordered section, 2026-08-17: "all tech debt stuff move
## in to there so we can handle tech debt stuff later")

Nothing here is urgent, broken, or user-visible; each is a deliberate
"later". An item leaves by being fixed (→ DONE.md) or by being promoted to
real work. New debt goes HERE, never scattered.

- **Revoke the stale broad Cloudflare user token** — "Edit Cloudflare
  Workers" (issued Aug 14, Admin Read&Write on ALL R2 buckets, visible on
  the R2 API-tokens page) predates today's scoped tokens and nothing known
  uses it. Revoke from the dashboard. Its sibling "Edit Cloudflare Workers
  2" (Aug 17) IS the live CI-deploy token — keep, but it's broader than CI
  needs; narrowing = mint scoped replacement + `gh secret set` ×3 repos.
- **Let the donor donate the PRINTED volume number too** — `routes/donor.ts`
  hands out `seriesIndex` as the sort position only, refusing
  `series_index_display` because "the caller's copy of the book has its own
  cover". That refusal is now the odd one out: since 2026-08-19 both machines
  that WRITE the column derive it (`seriesIndexDisplayFrom`), and the main
  catalog holds 81 hand-quoted forms (`Volume 07`, `Book 1`) that are strictly
  better than a derivation and are currently not offered. Cheap: one field in
  `donorDetailsFor`, one in `detailFindings`. Left undone because it needs a
  key wider than `DetailField` and buys nothing the derivation does not
  already close — quality, not convergence.
- **audiobook `scripts/` not linted in CI** — the lint workflow covers `app
  tests` only; `build_ebook_manifest.py` carries a pre-existing C901 on
  `extract_epub_cover`. Add scripts/ to the lint matrix + fix or waive C901.
- **The cp1252 ⚠️-in-print class** — three incidents in two days (smoke
  script, club smoke, uploader): an emoji in a `print()` crashes any run
  whose console is cp1252, always BETWEEN setup and cleanup. Mechanical fix
  candidates: set `PYTHONIOENCODING=utf-8` in the pipeline .bat/task env
  globally, or a repo lint rule banning non-ASCII in print strings.
- **CSP `frame-src` asymmetry on apex** — `/universes` + `/status` don't
  name `auth.heygabi.ai` while `/`, `/admin`, `/series` do (series-page
  agent's XS flag, catalog-platform TODO). Measure whether anything breaks
  before touching; may be a no-op.
- **`dl_ebooks` column is dead but standing** — deprecated-unused by
  migration 0010's comment; it still holds 1s from its one-day life, and
  re-adding it to `COLS` would resurrect ghost grants. Debt = decide someday
  whether to zero the values; the guard comment is the current protection.
- **The TBR legacy display-name fallback** ⚠️ **UPDATED 2026-08-18: the prod
  migration is APPLIED (181/181) and the owner has DECIDED the last 53** —
  reassign them to another household account, skipping duplicates. The tool
  (`audiobook_catalog/scripts/reassign_tbr_owner.py`) is dry-run verified (53 to
  carry, **0 duplicates**) but ⚠️ **the run is blocked by the operating
  environment's permission classifier** and was not forced. Until it runs the
  count stays **53, not 0**, so everything below is still load-bearing. When it
  does run, removing the fallback is a **separate pass with its own test
  sweep**. Original note follows. (added 2026-08-18 with the account
  migration, `info/tbr.md` §8). `legacyReadingListDocId`, the `legacyDocId`
  field on `/api/tbr/:workId/keys`, the fallback read in `Tbr.tsx` and the
  uid-less branch of `ownsTbrDoc` all exist for **53 documents** belonging to
  a retired v1 passphrase account with no Firebase uid. ⚠️ **REMOVAL
  CONDITION IS A NUMBER, not a judgement call:** run
  `python scripts/migrate_tbr_to_uid.py --report` in `audiobook_catalog` and
  delete all four when *uid-less documents remaining* prints **0**. It cannot
  reach 0 while that account's documents exist, so the real question is
  whether the owner wants them reassigned or deleted — **an owner decision,
  not a cleanup.**

## 🔥 Owner asks 2026-08-16 late evening — status board

### Third wave (2026-08-17 morning)
- **🤖 GABI, the conversational fixer — PHASE 0 SHIPPED; DISCORD IS NEXT.**
  Phase 0 (read-only) is built, deployed to both instances and archived whole in
  [`DONE.md`](DONE.md); the living record is
  [`info/gabi-fixer-design.md`](info/gabi-fixer-design.md) (§9 = what is and is
  not built, §13 = the file map, §7.4 = measured costs). What is still moving:
  - ⚠️ **HER FIRST CONVERSATION NEEDS HER EYES.** The panel is live on
    `padhard.heygabi.ai` (top bar, speech-bubble icon beside the search and the
    cog) and the posture and route were verified from outside — but every
    measured conversation so far ran against the MAIN catalog's data on the
    OWNER'S key through the dev worker. Nobody has talked to GABI on her site,
    on her key, about her books. That is the acceptance test.
  - ⚠️ **THE MEMORY'S ACCEPTANCE TEST IS THE SAME SHAPE, AND ALSO UNRUN.**
    Panel v2 shipped 2026-08-18 to both instances — the panel now uses GABI's
    conversation substrate, shared with Discord
    ([`info/gabi-panel-v2.md`](info/gabi-panel-v2.md)). Everything below the
    model call is proven by tests and by direct SQL against both databases;
    **nobody has held a real conversation, closed the tab, come back inside
    half an hour and seen her continue it.** Script:
    1. <https://library.heygabi.ai> (or `padhard.heygabi.ai`) → speech bubble →
       ask *"what do we know about Unsouled?"* and let her answer.
    2. **Close the tab.** Open a new one, same site, same account, within
       30 minutes. Ask *"and what was the last thing I asked you?"*
    3. Expected: she answers from the earlier exchange, and the panel shows
       *"Picking up where you left off — GABI still has the last 2 things said
       here…"* above the answer.
    4. Wait past 30 minutes and repeat step 2. Expected: she does **not**
       remember, and the line does not appear.
    ⚠️ Step 4 is the half that is easy to skip and the one that proves the
    privacy posture rather than the feature.
  - **💬 Discord DM is the NEXT phase** (owner, 2026-08-17: *"we can do
    discord right after"*) — promoted ahead of the write phases. Two of the
    three parts already exist and are front-end-agnostic (`GABI_TOOLS`, the turn
    route); what a Discord surface must write is its own EXECUTOR. ⚠️ Design
    §10.2's four blockers are unchanged and none was solved by phase 0 — start at
    shape **(b)**, propose-and-deep-link, which needs none of them.
  - **Then phases 1–3** — the write slice (`research_book`, blank-only
    `set_book_details`, `undo_changes`), covers, small batches. ⚠️ Each needs
    what phase 0 deliberately does NOT have: the confirm lane (§6), the
    provenance stamp (§5.2, `changed_how` + a `gabi:<conversationId>` note), and
    the manifest UI. All the policy is settled (§12, answered) — none of it is
    implemented.
  - 🧑 **Owner action, the one open §12 row:** confirm Samantha's Anthropic key
    sits in a **capped workspace**. It is the backstop behind the turn ceiling,
    it is one dashboard move at platform.claude.com, and it is also on the tech
    debt list above. Everything else in §12 is answered.
    - ⚠️ **That cap is not hypothetical — IT HAS ALREADY FIRED.** Her key hit
      its monthly limit on 2026-08-17 and `research_run` 5 and 6 on
      `library-catalog-2nd` failed with *"You have reached your specified API
      usage limits. You will regain access on 2026-09-01."* The wording defect
      that exposed is fixed and archived in [`DONE.md`](DONE.md); the
      **allowance itself is untouched**, so lookups on her instance stay dead
      until 1 September unless someone raises it. Evidence the backstop works —
      and a decision the owner has to make, not a bug to fix.

### 👁️ Needs a signed-in eye — padhard's Missing/queue FAILED rows
The worded-error fix is deployed to both instances and verified by
code-presence in the live bundle (`/assets/index-DVAovdWp.js` carries the
sentences on both hosts), but **estate auth is in enforce, so nobody has seen
the rendered row**. Runs 5 and 6 are the natural test rows: open
<https://padhard.heygabi.ai/queue> signed in as someone with access and check
the two FAILED rows read *"This catalog's lookup allowance is used up until
1 September 2026…"* rather than a JSON body. Say-what-you-know and Look-again
should still be beside them.
- **✅ EBOOK DOWNLOAD IS NOW A ROLE, NOT A CHECKBOX (owner, 2026-08-17: *"For
  ebooks I don't want a download check box, I want to use roles we have. Set up
  the roles to match library."*)** — built in `catalog-platform`
  (`030930d`), nothing to do in this repo beyond the ripple already landed.
  **Why it appears on this board at all:** the pattern the owner names by
  "match library" is THIS repo's `@lc/core` `capabilitiesFor`, and the shared
  `packages/estate-auth` module is build-synced from that repo, so the change
  reached us whether we wanted it or not.
  - **What arrived here:** the `downloadEbooks` field left `SeenAnswer` /
    `SeenCache` / the `refresh` shape. `gate.test.ts`'s pinned shapes went back
    to `{status, visibility, checkedAt}` — the form they had before yesterday
    taught them the field. ⚠️ That is a ROUND TRIP, not a stale test; the file
    header explains it so nobody "fixes" it back.
  - **The grant now:** promote on the admin page's Audiobook role dropdown
    (`download` floors at `admin`). `vis_ebooks` — seeing the shelf and reading
    in the viewer — is UNCHANGED.
- **📱 Ebook reader PWA/offline — ON THE TABLE FOR LATER (owner, 2026-08-17:
  "Add pwa back on the table for later"):** not in viewer v1. ⚠️ The design
  constraint that must survive until then: offline caching stores book
  content on the device, so it is A FORM OF DOWNLOAD and gets gated by the
  `download` capability — **admin floor since 2026-08-17, and NOT the
  per-person `dl_ebooks` checkbox that briefly existed** — never bundled free
  with reading. Whoever builds it later starts from that sentence.
- **🔴 EBOOK GATE — the three things it left open (built 2026-08-17, whole
  record in [`DONE.md`](DONE.md)):**
  1. **Purge the edge cache.** `audiobooks.heygabi.ai/ebooks.json` was still
     served from Cloudflare's edge AFTER the deploy that stripped it —
     MEASURED: `Age:` climbing, while the same URL with a cache-buster
     returned the SPA fallback, so the origin was clean and the edge was not.
     A `Cache-Control: no-cache` request header did not shake it loose, and
     wrangler has no purge command (the session token holds `zone (read)`).
     **Owner:** Cloudflare dashboard → `heygabi.ai` zone → Caching →
     Configuration → Purge Custom URL, for `/ebooks.json` and
     `/dev/ebooks.json`. Until then the old manifest is still reachable at
     that exact bare URL.
  2. **The prod promote.** `ebooks.heygabi.ai` proxies the PROD branch, whose
     `site/ebooks.html` is still the pre-gate page — so the SHIM is not live
     on that hostname yet. Nothing leaks meanwhile (the manifest is stripped
     from both lanes on every publish), but the page a visitor meets there is
     the old one, which will simply fail to load a shelf. Conductor's call,
     as always.
  3. ~~**Ebook rows leave the estate index at the next CI deploy.**~~
     ✅ **CLOSED 2026-08-17 — the owner chose option A** (move the push out of
     CI into the local pipeline, the one writer that holds the manifest). It
     is now **STEP 7** of `audiobook_catalog/scripts/sync_to_drive.py`, run on
     every cycle including idle ones; the CI step was deleted and its
     `INDEX_PUSH_TOKEN` repo secret deleted with it (the Worker secret was
     rotated first, so the old value is inert). **Measured live the same day:
     the index holds 1,246 `audiobook`-source rows = 1,078 audiobooks + 168
     ebooks** (`index.heygabi.ai/api/health`); a manifest-less CI push landed
     1,078. Whole record in `audiobook_catalog/docs/DONE.md`; runbook in that
     repo's `docs/access/PIPELINE.md` ("STEP 7").
     ⚠️ **Two things to carry forward for this repo's own pushes:** never add
     a second writer of a REPLACE-semantics snapshot, and remember that an
     ebook missing from an **anonymous** `/api/search` is the permission gate
     working — check `/api/health` counts or search as a member instead.
Landed and archived — the TBR instant-clear built in `audiobook_catalog`
(`2ff816f`) and moved whole to [`DONE.md`](DONE.md). Only the prod promote of
that repo is outstanding, and it belongs to the conductor, not to this file.

### Second wave (rapid-fire, logged as they arrived)
- **Sequencing (owner):** deliver current batch → **Discord portal** (owner is
  nearly home for the owner-present steps) → **EPUB/PDF viewer** after.

- **Donor reciprocity flip** (open thread from the shipped donor sweep,
  archived in [`DONE.md`](DONE.md)): when her catalog is worth asking, one
  line in the main `[vars]` — `DONOR_URL = "https://padhard.heygabi.ai"` —
  makes the donating mutual. Owner's call on timing; zero code.

- **EPUB/PDF in-browser reader** (owner ask 2026-08-16: *"how hard would it be
  to have a reader for EPUBs and PDFs so users could either preview or a read a
  book on the site?"*; sequenced after the Discord portal) —
  ✅ **DESIGN DONE 2026-08-17. PHASE 0a (bucket + file ingest) BUILT the same
  day** — see [§2.2a](info/ebook-viewer-design.md) for the evidence and
  `audiobook_catalog/docs/info/ebooks-r2-ingest.md` for the reference.
  📄 **[`info/ebook-viewer-design.md`](info/ebook-viewer-design.md)** — full
  design, measured, with rejected alternatives per section.
  **From phase 1a on, nothing is built: no worker route, no reader page, no
  rules change.** Nothing in `estate-ebooks` is readable by a browser, which is
  phase 0's success condition rather than a gap.
  - 🔴 **OWNER ACTION carried over from phase 0a: one book is not in the
    bucket.** ⚠️ **Measured: `wrangler r2 object put` refuses files over
    300 MiB** (`--pipe` too — it is the Cloudflare REST endpoint's ceiling, not
    wrangler's). Exactly one of the 168 is over it, the **393 MiB White Sand
    omnibus**. The S3-multipart fallback is written and size-selected but needs
    an **R2 API token** wrangler cannot mint (dashboard → R2 → Manage R2 API
    Tokens, Object Read & Write on `estate-ebooks`). ⚠️ **Check the duplicate
    question first** (§10): if the 143 MiB `whitesand.epub` is the same graphic
    novel, deleting the omnibus removes the only file that needs the token.
  - 🔴 **Pipeline wiring is a one-line conductor step, deliberately left
    undone** — `sync_to_drive.py` auto-runs 3×/day and was contested. It is
    **step 5.75**, not the design's 5.8 (the gate work took that slot the same
    day); the load-bearing part is that files land *before* the manifest naming
    them is published.
  **What the design changed about the first take** (which said "epubs off R2
  range requests, PDFs via pdf.js, real work is auth-gating"):
  - ⚠️ **The files are NOT in R2.** Measured: only covers are (1,850 + 83
    objects). The 168 ebook files live on the pipeline PC, mirrored to Drive
    and rclone'd to the shelf server. **An ingest phase exists that the
    framing did not price** — **1.805 GB / 1.681 GiB total** (138 EPUB =
    1.084 GiB, 30 PDF = 0.598 GiB), against R2's 10 GB free tier.
  - ~~⚠️ **Range requests are a PDF technique, not an EPUB one.** An EPUB is a
    ZIP; epub.js and foliate-js both fetch the whole archive. That inverts the
    phase order: **pdf.js first**, because it range-streams its own 181 MiB
    outlier by design where epub.js must *refuse* three books (393 / 143 /
    27.7 MiB) behind a size gate.~~
    🔬 **FALSIFIED BY MEASUREMENT 2026-08-17 →
    [`info/epub-streaming-findings-2026-08-17.md`](info/epub-streaming-findings-2026-08-17.md).**
    epub.js does fetch the whole archive (confirmed, 4 books, one `Range`-less
    `GET` each) at ~3× file size in JS heap — **1,207 MB for the 393 MiB
    omnibus**. But **ranges DO help EPUB**: foliate-js on a zip.js
    `HttpRangeReader` opened that same book in **15 ranges / 76.9 KiB /
    10.4 MB heap**. Consequences: **no 32 MiB size gate, no refusal card;
    renderer becomes foliate-js not epub.js** (decide before phase 3 stores a
    CFI, or it is a migration); **PDF-first loses its only deciding argument**,
    so 🔴 owner decision #1 below re-opens with new evidence.
  - ✅ The auth-gating call was right, and it is smaller than feared: the
    **`download` capability (floor `member`) is already committed** in
    `audiobook-worker/src/capabilities.ts`, on a Worker already deployed with
    the canonical verifier. This is that repo's **Phase 4**, already specced.
  - ⚠️ **It must NOT gate on §4.5 visibility** — `vis_audiobook` is the estate's
    *public* slice (anonymous callers get it), so gating on it gates on
    nothing. Ladder role, server-side, every request.
  - **Bearer-per-request, never a signed URL**: a copied URL must be a 401, and
    a presigned URL cannot be revoked mid-session.
  - Reading position becomes the **first `uid`-keyed collection in this
    estate** — the reader's readership is token-bearing by construction, unlike
    `reviews`/`readingLists`, which must stay display-name-keyed for legacy
    sessions.
  **Recommended phase 1** (after phase 0, the bucket + ingest step): the gated
  stream route on `audiobook-api.heygabi.ai` + a self-hosted pdf.js reader at
  `ebooks.heygabi.ai/read/`. Ships **behind `ESTATE_CHECK` enforce**, so it is
  dormant until the owner flips it.
  🔴 **Owner decisions before phase 1** (§11 of the doc, 8 of them; the two
  that matter most): **PDF first or EPUB first?** and **what "preview" means —
  ungated first chapter, or members-only read with a richer card + PDF
  first-page thumbnail?** (~~recommended: PDF first~~ — **the PDF-first
  recommendation is now unsupported**, see the measurement above; members-only
  still recommended).

## 📚 Ebook split — ⚠️ PHASE 5 (retire ingest + prune) IS STILL OWED

**Decided and mostly built.** The insight below (owner, 2026-08-16) became
`catalog-platform/docs/info/ebook-split-design.md`; phases 1–4 have shipped and
ebooks live at **ebooks.heygabi.ai**. What is left in *this* repo is phase 5.

**Phase 5, unchanged from the design's §6 table** — stop running
`import-ebooks.mjs`; unset `EBOOK_INGEST_TOKEN` so `/api/ingest/ebook` 404s;
export the ebook-only works and all ebook editions to a dated JSON committed
here; `--force-prune` the `source='file'` ebook editions (deleting all of them
exceeds the 20% guard **by design** — the ceremony is the point); delete the
ebook-only works. ⚠️ **Re-measure `user_book` for `'human'`-asserted read states
on those works before deleting — it must be 0**, and it was 0 at design time
only because nobody had typed one in yet.

**Measured 2026-08-18 04:55Z, so phase 5 knows what it is deleting:** 387 works,
**94 ebook-only**, 127 ebook editions. ⚠️ The two ebook figures have not moved
since the design measured them on 2026-08-16 while the catalog grew by 25 works
in twenty minutes — the ebook rows are a closed 2026-08-09 import with no
producer still pointed here. If they ever *grow*, the ingest is back on.

**What landed instead, 2026-08-18 — the display half, on the owner's ask**
(*"in the library site its showing recently added for ebooks, remove those"*):
"Recently added" and its **See all** now ask for `ebookOnly=hide`, so the strip
is the physical shelf. **No data was deleted** — that is phase 5's job, and the
94 works still serve the series/universe joins, `ebook_holding`, and the "also
as an ebook" chip. See `EBOOK_ONLY_CLAUSE` in `packages/db/src/works.ts`.

⚠️ **Still showing all 387 works, and deliberately so — an owner decision, not
an oversight:** the collection grid, the `Format: Ebook (94→126)` facet and the
`/stats` counts are untouched. Narrowing those would make the `medium=ebook`
filter near-pointless and would hide books with no way to reach them, which is
phase 5's export-first ceremony done sloppily. **If the owner wants the whole
site physical-only before phase 5 runs, that is one more line
(`ebookOnly` defaulted on in `collectionQueryFrom`) — ask him, do not assume.**

The original insight, kept because it reframes the federation question below:

> *"we might need to now make ebooks its own site because we all share ebooks
> like we do audiobooks but physical books obviously belong to someone"*

**Why this is the sharp observation:** this estate has been splitting catalogs
by MEDIUM (audiobooks / books / games), and the owner has just pointed out the
split that actually matters is by **ownership model**:

| | Shared by the household | Belongs to one person |
|---|---|---|
| Audiobooks | ✅ already its own site | |
| **Ebooks** | ✅ **behaves like audiobooks** | |
| Physical books | | ✅ a specific copy on a specific shelf |
| Board games | | ✅ (a physical copy, though played together) |

Ebooks currently live INSIDE the physical library catalog — `site/ebooks.json`
is produced by the audiobook pipeline's step 1b and imported by
`library_catalog`. So a shared-by-everyone format is stored inside the one
catalog whose entire premise is "who owns this copy".

⚠️ **This is exactly the question the second-household federation runs into.**
"See who owns what" is meaningful for physical books and games, and close to
meaningless for ebooks and audiobooks — those are "do we have it", not "whose
is it". Deciding the ebook split FIRST would likely simplify the federation,
because it separates *the shared pool* from *the per-person shelves* before two
households ever have to be joined.

~~**Not a build yet.** Open questions…~~ — **all four were answered on
2026-08-16** and the answers are the design doc's §2–§5, kept there rather than
copied here so there is one source of truth: the ebooks page rides the
audiobook site (Q1); this repo's ebook rows are **demoted to holdings, then
pruned** (Q2 — the phase 5 above); the shelf server needs one runbook line
because the ebooks already ride the same mirror (Q3); step 1b stays the
manifest's producer and only the *consumer* moves home (Q4).

## 🤝 A second household's library, federated with ours (owner ask 2026-08-16)

**Deferred by the owner the same day it was raised — "do the next catalog
later" — recorded now so it is not lost.**

The ask: *"I want to make a site for my friends library and then link it to
mine so we can see who owns what. but she's less technical and doesnt live near
me, they need a much better automated solution."*

Three constraints that make this NOT just "deploy another copy":

1. ⚠️ **She is less technical.** Every operational assumption this estate rests
   on — a pipeline on a home machine, wrangler from a laptop, reading a runbook
   — is unavailable. Whatever is built has to run without her ever seeing a
   terminal.
2. ⚠️ **She is not local.** No shared LAN, no "I'll set it up on your machine",
   no physical access to fix a stuck box. Remote-first from day one.
3. **The point is the JOIN, not the copy.** "See who owns what" means the two
   catalogs must be comparable — which is what the shared index
   (`index.heygabi.ai`) already does across our three catalogs, and is the
   obvious foundation rather than a new mechanism.

⚠️ **Do not start this by cloning a repo.** The interesting design question is
the automation and the ownership boundary (her data, her account, her control,
our shared view), and answering that first will change what gets deployed.
Related: the combined-site architecture already sketched for our own three
catalogs.

## 📸 Owner note — Illumicrate edition photos (2026-08-14) — ⚠️ THE DASHBOARD NAG IS GONE, THIS NOTE IS NOW THE ONLY REMINDER

> **2026-08-18 (~14:15 Phoenix), owner order: "yes remove the need cover but
> keep it in our todolist."** Works 224–228 had `cover_status = 'standin'`
> cleared to NULL (art unchanged, 5 change_log rows, batch
> `illumicrate-standin-clear-20260818`) so `/?needs=cover` measures **0**.
> The stand-in flag was the reminder mechanism — with it gone, THIS section
> is the reminder of record. When the photos are taken: each work page →
> Cover panel → upload; every prior cover stays selectable in the
> "Choose from known covers" grid forever (content-addressed R2 + audit
> history), so nothing about the interim art is lost.

The Percy Jackson ILLUMICRATE editions need their own photos added as
edition/cover images — the audiobook covers now being pulled are the standard
art, not the Illumicrate art. Owner action: photograph the Illumicrate copies
and upload via each work's cover UI (Replace cover / the edition row).
Owner's words: "Leave me a note somewhere to add the illumicrate editions
photos."

⚠️ **These five works (224–228) are now the ENTIRE `/?needs=cover` list.**
Measured in production D1 2026-08-18 19:16 UTC with the route's own predicate
(`NEEDS_COVER`, `w.cover_url IS NULL OR w.cover_status = 'standin'`): it
returns 224, 225, 226, 227, 228 and nothing else, out of 448 works. The
box-set split's coverless offspring all filled — see [`DONE.md`](DONE.md).

⚠️ **No backfill script can close this one, and re-running one is wasted
time.** `backfill-work-covers.mjs` and `backfill-missing-covers.mjs` both
select on `cover_url IS NULL OR cover_url = ''`; these rows have a populated,
verified-loading URL (59–73 KB each, re-checked 2026-08-18) and are on the
list only via the `cover_status = 'standin'` half of the predicate, which no
script reads. It closes with a photograph and the cover UI, or not at all.

---

## ☐ The Wandering Inn — the two things the volume fix deliberately left

The volume mapping itself is **done** — moved whole to
[`DONE.md`](DONE.md) 2026-09-02, mapping and sources in
[`info/serial-print-splits.md`](info/serial-print-splits.md). These two were
kept out of that correction batch on purpose, and both need the owner.

✅ **RESOLVED 2026-09-02 by the owner himself: "i ticked all 4"** — all four
  works flagged through the edit panel, the one sanctioned door. The judgement
  call landed on *"this position spans volumes"*. Kept here (not moved) until a
  session verifies the four flags read back true; then move whole to DONE.

☐ ~~**`work.multi_volume_printing` on works 229–232 — OWNER'S CHECKBOX.**~~
  R6 (`info/volume-numbers.md` §3a) is **human-only and mechanically guarded**;
  no script, finding or sweep may write it, and a correction script setting it
  would be the exact bypass the guard exists to prevent. It may well belong on
  all four — *The Wandering Inn* Books 1 and 2 are each one reading position
  printed as two paperbacks. ⚠️ But the shape is not quite R6's worked example:
  R6 was written for **one work** printed as two physical books (the two-volume
  leatherbound *Words of Radiance*), and here there are **two works**, one
  physical book each, sharing a position. Whether the flag means *"this work
  spans volumes"* or *"this position does"* is a judgement, not a lookup —
  hence the ask. `serial-print-splits.md` §3.3 has the full argument.
  **Four ticks in the book edit panel, or one word.**

✂️ **2026-09-02:** the *"`edition.publisher` reads Barnes & Noble"* item moved
  WHOLE to [`DONE.md`](DONE.md) — all **seven** B&N-imported editions corrected
  on production (322–325 Harper Voyager, 326 Ballantine Books, 327 Clarkson
  Potter, 328 Scholastic Press), and the **two rows where B&N really IS the
  publisher** (511, 557) verified and left alone. What it left behind is the
  next item.

---

## ☐ `import-shop-orders.mjs` writes the RETAILER into `edition.publisher` (2026-09-02)

The data is corrected (see [`DONE.md`](DONE.md)); **the importer is not**, so its
next run re-creates the defect on every row it adds. It writes the shop name into
a field that answers a different question — it is already careful this way about
`format` (`suggestFormat`, never the retailer's marketing word) and about
`edition_name` (the retailer's wording preserved deliberately), so this is one
field out of step with the file's own standard.

**The fix is a decision, not a line.** A shop order genuinely does not know the
publisher, and the honest options are: (a) leave `publisher` NULL and let the
ISBN ladder fill it, or (b) record the shop where a shop belongs — `copy.vendor`
already exists and the file's own header says so. ⚠️ Do **not** fix it by
looking the publisher up inside the importer: that would make an import a
research run, which is the split `docs/info/isbn-ladder.md` keeps.

**Measured 2026-09-02:** 7 of 7 rows the importer created carried the wrong
value, and 0 of them were caught by any check. **Blast radius if it re-runs:**
one wrong `publisher` per imported line, silently, in a column nothing revisits.

---

> ✂️ **2026-09-02:** *"Pagination does not scroll to top — physical book
> library"* moved WHOLE to [`DONE.md`](DONE.md). ⚠️ It was **half-shipped and
> silently broken**: the effect had existed since 2026-08-21 and `focus()`
> scrolls by default, so it undid its own `scrollTo`.

---

## Legend

| Mark | Meaning |
|---|---|
| ✅ | Done and verified |
| 🚢 | Deployed to production |
| 🔨 | In flight |
| ⏸️ | Blocked — the blocker is named |
| 💤 | Deliberately deferred |

---

## Production right now

Measured **2026-08-12**, live version `d441ecd1`:

| works | editions | owned copies | preordered | audio rungs | series_volume |
|---|---|---|---|---|---|
| **258** | 288 | **152** | **12** | 134 | 147 |

Movement since the crowdfunding rescan landed: works 233 → 258, owned copies
117 → 152. Audio corroboration: **17 series confident, 2 hedged** — and the 2 are
now confirmable by hand, see below. Of the 70 live `audiobook_holding` rows,
**all 70 are `exact`**; zero rest on containment.

---

---

### 🔨 Completionist Chronicles 12 & 13 — signed, in BOTH formats, 2026-08-13

Owner: *"These are a part of completionist chronicles. The pictures I uploaded are
paperback copies that are signed we also have hardcover versions of each of these
signed too."*

⚠️ **Both works already exist and both are ebook-only**, so this is four copies to
record, not two books to add:

| work | title | vol | has | needs |
|---|---|---|---|---|
| **#34** | Untapped | 12 | `ebook_epub`, **0 copies** | signed **paperback** + signed **hardcover** |
| **#33** | Unmapped | 13 | `ebook_epub`, **0 copies** | signed **paperback** + signed **hardcover** |

Both Dakota Krout / **Mountaindale Press**. No ISBNs — the photographs are front
covers and back blurbs, no barcodes — so the editions go in without one and a
barcode scan can fill them later.

⚠️ **`copy.is_signed` is the whole point of this entry.** It is one of the fields
`docs/info/crowdfunding-and-accessories.md` says *only a person can fill* — no
importer or lookup will ever set it — so if these four copies are recorded without
ticking **Signed**, the fact is lost and nothing will flag it. The **Record a copy**
panel is the right tool: it creates the edition, the copy, and carries the Signed
checkbox in one go.

⚠️ Note the rest of the series for contrast: works **238–242** (*Ritualist*…
*Ruthless*) each hold a hardcover with **`signed = 0`**.

**✅ And that question is now partly answered — #238 *Ritualist*'s hardcover IS
signed.** Owner, with a photo of the hardcover: *"Another for completionist
chronicles this book is hard cover signed."* So this is **not** a new copy to add
— #238 already holds the hardcover, and its existing copy needs `is_signed`
flipped to true.

⏳ **Still unknown for 239–242** (*Regicide*, *Rexus: Side Quest*, *Raze*,
*Ruthless*) — all four hold a hardcover with `signed = 0`. If the whole
Kickstarter set is signed then all four are wrong, but ⚠️ **do not infer it from
#238** — one confirmed book is not evidence about four others, and this is exactly
the kind of "it was probably the same" guess the catalog refuses elsewhere. Ask,
or look.

---

---

### ⚠️ THE SCANNING IS NOT FINISHED — more books arrive tomorrow

Owner, on going to bed 2026-08-13: *"be aware we're not done scanning books, just
done for the night, more will come tomorrow."*

**This reprioritises the overnight list.** The catalog went 258 → 342 works in one
evening and will keep growing, so **a fix on the intake path pays off repeatedly
while a one-off data correction pays off once.** Prefer, in this order:

1. **Intake-path fixes** — the edition picker, a format question at intake (a board
   book still lands as `paperback` through `AddWork`, the scan path and any
   importer — see the standing rule in `docs/info/series-formats-and-audiobooks.md`),
   and anything that stops the Open Library **work-level aggregate** bug recurring.
   ⚠️ That last one corrupted three works tonight and *will* fire again on the next
   series whose OL record is filed that way.
2. **Cover swap** — 147 covers are third-party hotlinks and every new book adds more.
3. **One-off data cleanup** — last, and never at the cost of 1 or 2.

⚠️ **Do not treat the catalog as final.** Anything that assumes a fixed row count, a
complete series, or an empty queue will be wrong by tomorrow afternoon. The
`/queue` residue in particular will grow again — an empty queue tonight is not a
finished job.

---

### ⚠️⚠️ THREE BUGS found while adding books by hand — 2026-08-13, two now FIXED

Discovered by adding five books and then reading the rows back. **Read this before
typing in a scanning backlog**, because two of the three lose data silently.

**1. ⚠️ The typed ISBN is NOT stored. `/add?mode=type` has an ISBN box, and
nothing persists it.** Measured: works **265, 266, 267, 269, 274** all have
`editions = 0`, so no ISBN, no publisher, no year — for books whose ISBN was typed
in or scanned. Compare the owner's own adds (#268, #270–273, #275, #276), which
all resolved through a lookup and all have `editions = 1`.

The ISBN box appears to feed the **Look up** button only. So for exactly the books
that need hand-entry — the ones no service knows — **the one hard identifier the
book carries is thrown away.** That is the worst possible place to drop it: a
board book with no ISBN row can never be re-matched later, and the barcode is the
only thing that would have made it findable.

**2. ⚠️ "AND WE…" defaults to "just catalogue it — record no copy".** For a
scanning session — where every book is physically in your hands — the default is
the one answer that is always wrong. It produced **#269 *Who Goes Roar?* with
`copies = 0`**, i.e. catalogued but not owned. The other options are "have it" and
"want it — put it on the wishlist". Default should almost certainly be "have it"
when reached from a scan.

**3. ⚠️ A save can fail silently, and the cleared form looks like success.**
*My First Farm Animals* (9781839035920) was typed, saved, and the form went blank
— and **no row exists**. Cause is almost certainly hydration: the fields were
filled before React had attached, so its state stayed empty, `Save` stayed
disabled, and the click did nothing. The blank form after was the *un-filled* form,
not a reset one. Nothing distinguishes that from a successful save.

**Rows needing repair** (all created 2026-08-13):

| work | title | what is missing |
|---|---|---|
| 265 | There's a Mouse About the House! | ISBN 9781601304193 |
| 266 | Don't Tickle the Dinosaur! | ISBN 9780794549503 |
| 267 | Richard Scarry's Busy Busy Farm | ISBN 9781984894236 |
| 269 | Who Goes Roar? | ISBN 9781836422808 **and a copy — it is owned** |
| 274 | My First Toys | ISBN 9781839035944 |

⚠️ Also: #269 was entered as author **"Make Believe Ideas"** while the catalog
already holds #144 *Never Touch a Dinosaur!* as **"Make Believe Ideas  Ltd."**
(with a double space). Two author spellings for one publisher — pick one.

---

### 🔨 Books whose ISBN resolves to NOTHING — transcribed from photographs, 2026-08-13

⚠️ **Growing list, one root cause.** The owner is scanning and these keep landing:
the ISBN is real and printed on the book, and **every rung of the ladder returns
no answer at all** — so the scan row has no title, no author, and `isAddable`
refuses it. Children's board books, publisher-branded, are the whole population.

**Transcribed off the owner's photographs, so this survives the books going back
on the shelf.** Enter via `/add?mode=type` ("Type a title"), which needs no lookup.

**"Who Goes Roar?"** — a tabbed board book of dinosaur sounds
| field | value |
|---|---|
| ISBN13 / ISBN10 | **9781836422808** / 1-83642-280-6 |
| publisher | **Make Believe Ideas** (make believe ideas ltd, Berkhamsted, Herts UK · 557 Broadway, New York) |
| copyright | 2019 · $4.99 US / $6.99 CAN |
| illustrator | **Shannon Hays** — the ONLY credit on the book |
| author | ⚠️ none named. Publisher-as-author, per the catalog's convention (*Scholastic* #141, *Bendon* #137) |

**하츄핑의 눈물** — Korean *Catch! Teenieping* tie-in
| field | value |
|---|---|
| ISBN | **9791165384678** (979-11-6538-467-8) · 15,000원 |
| franchise | 캐치! 티니핑 (Catch! Teenieping) |
| series badge on cover | **하츄핑 마음 동화 2** — so volume **2** of that series |
| credits | 원작·그림 **SAMG** · 엮음 **아이휴먼 편집부** (compiled by the iHuman editorial dept) |
| publisher | **아이휴먼 / iHuman** |

⚠️ **Open question, and it decides how these two file together:** the catalog
already holds **#195** — *슈팅 스타 캐치! 티니핑: 약속 의 오로라핑*, ISBN
9791165384548 — under series **마음을 채우는 동화**. The new book's cover says
**하츄핑 마음 동화**. Are those the same series or two different ones? Filing them
together on a guess would merge two series; filing them apart would split one.
Under research 2026-08-13; **do not resolve by guessing the Korean.**

⚠️ Also note **#195 is on the cover-photo pull list** — do not confuse the two
Korean books, they are different ISBNs (…4548 vs …4678).

---

### 🔨 The Autumn Publishing 6-book set — cannot be scanned in, 2026-08-13

⚠️ **Read the back covers: "Sold as part of a set, not for resale."** These are
set-internal ISBNs. No retailer lists them individually, so **every rung of the
ISBN ladder returns nothing** — not a wrong answer, no answer. The scan row gets
no title and no author, so `isAddable` refuses it and the row has only *Edit* and
*Not wanted*. This is the same gate as the authorless books, one step worse.

**They must be typed in** — `/add?mode=type` ("Type a title"), which needs no
lookup. Transcribed from the owner's photographs of the fronts and backs, so this
survives even if the books go back on the shelf:

| Title | ISBN-13 |
|---|---|
| My First Farm Animals | 9781839035920 |
| My First Toys | 9781839035944 |
| My First Things That Go | 9781839035906 |
| My First Wild Animals | 9781839035951 |
| My First Ocean Animals | 9781839035937 |
| My First Food | 9781839035913 |

Common facts, all read off the books: **Autumn Publishing**, an imprint of Igloo
Books Ltd (owned by Bonnier Books, Sweden), **Third Edition, June 2025**, board
books with polyurethane-foam covers, series line on the covers is **My First** —
which is already a series in this catalog.

⚠️ **Author: `Autumn Publishing`.** No person is credited anywhere on these books.
That is the catalog's existing convention for publisher-branded board books —
*Scholastic* on #141, *Bendon* on #137 — not a placeholder.

---

### ⚠️ #174 *I Love You, Little Bear* — the author on file is probably another book's

Owner: *"the publishing company editorial stuff wrote it together… use the
publisher as the author."* They are right, and it is worse than a blank.

Researched 2026-08-13: **at least four different books share this exact title** —
Claire Freedman's, Angela Navarra's, a Scholastic edition, a Phoenix
International edition — and **none of them carries our ISBN 9781472327314**. So
the `Judi Abbot` currently in `work.authors` was almost certainly lifted from a
*different book of the same name*, which is precisely the failure
`docs/info/research-and-gaps.md` warns about.

The edition's publisher is **Parragon Books**, consistent with the `978-1-4723`
prefix. That is the honest attribution.

⚠️ **Blocked on the same guard as the title:** `WorkFields` deliberately cannot
reach `authors`, because `work_key` derives from it. #174 has **no reviews on
either site**, so the key move is harmless here — which is exactly the
"gated on no-review-join" design in the item below.

---

### ⏸️ Edit any detail, an audit log, and adding a book with no author — 2026-08-13

**Three asks from one scanning session, and they are the same feature.** Recorded
together because solving any one of them badly makes the others harder.

**The owner, verbatim:**

> *"add an edit title button on the ui. More than that we need a way to edit
> basically any detail about a book except core details like ISBN. We'd also need
> an audit log and stuff. Audiobook catalog will need this as well."*

> *"Let us add books without an author and immediately flag them for
> remediation. That way we're not hard blocked."*

**Why it came up.** Four books in one evening could not be added without hand-
typing an author — *There's a Mouse About the House!*, *Don't Tickle the
Dinosaur!*, *Richard Scarry's Busy Busy Farm*, and every bare-titled board book
on the pull list. `isAddable` (`packages/core/src/scanjobs.ts`) requires a title
**and** an author; children's board books are the common case in this house and
they resolve worst upstream, so the gate lands exactly where it hurts.

#### ⚠️ The constraints, all measured — read before designing

| Constraint | Where | Why it bites |
|---|---|---|
| `work.authors`, `primary_author`, `work_key` are all **NOT NULL** | `migrations/0001_init.sql:87,90,108` | "add with no author" is a **migration**, not a UI change |
| **`work_key` contains the author on purpose** | `0001_init.sql:99` — *"Title-only keys collide across authors constantly"* | a title-only key for authorless rows is a known-bad idea in this schema, not a shortcut |
| `work_key` is the join to **860 audiobook reviews** | `WorkFields.tsx` header | editing a title or author moves the key and orphans the reviews |
| `WorkFields` **deliberately** cannot reach `title`/`authors` | same header | this is the guard, not an oversight — do not simply remove it |

⚠️ **The trap:** "flag for remediation" means the author gets filled in *later*,
which moves `work_key` — the exact thing the guard exists to prevent. It is
harmless for a book that entered the catalog seconds ago with no reviews, and
destructive for one that has them. **So the remediation path must know the
difference**, and that is precisely what an audit log plus a "has this ever been
review-joined" test would give.

#### The shape this probably wants

1. **Migration:** `authors`/`primary_author` nullable, plus a documented answer
   for what `work_key` is while the author is unknown (a provisional key that is
   *expected* to move, marked as such, is better than a colliding title-only one).
2. **Add with no author** → row is created *and* a `work_watch` row is written in
   the same call, so it lands in `Needs → To check` and cannot be silently
   forgotten. Migration 0040's rule: the flag travels with the write.
3. **An edit surface for everything else** — title included — gated on "this work
   has no review join yet", or accompanied by an explicit "this will move the
   review link" confirmation.
4. **Audit log**: who changed what, when, and the old value. This is the thing
   that makes 3 safe rather than brave, and it is also what lets a bad bulk edit
   be undone.

⚠️ **`audiobook_catalog` needs the same treatment** and shares the identity and
review store, so the audit-log table and the `work_key`-move rules should be
designed once, across both — see `catalog-platform` / `PLATFORM.md` §2.2 on what
may and may not cross the boundary. Noted in that repo's work log too.

**Meanwhile, the zero-code unblock** (used twice tonight, ~3 taps): on the scan
row press **Edit**, type the author, **Save and look up**, then **Add**. The
lookup re-runs with the author and usually returns a close match at 1.00. For
publisher-branded board books the catalog's existing convention is the publisher
as the author — *Scholastic* on #141, *Bendon* on #137 — so that is a legitimate
answer, not a placeholder.

---

---

## Blocked — the live list

| | Item | Blocker | Who clears it |
|---|---|---|---|
| ⏸️ | **BackerKit `nbaslamking@gmail.com` is not signed in** | The browser holds `aim.com`, which has only *Words of Radiance*. The gmail account has at least the DCC Croc Box and probably more. ⚠️ **Never sign in on the user's behalf.** | User — said "we will do nbaslamking@gmail.com next" |
| ⏸️ | **Four universe calls held for verification** | Will Wight (Cradle, The Last Horizon) — the author has *hinted* at a multiverse and nothing is established; Turncoat's Truth; Cultivating Chaos + The Axe Falls; Tailored Realities. All recorded in `_refused` in the shared list so they are not re-litigated. | User |
| ⏸️ | **Two series stay hedged at AUDIO?, and cannot be fixed by code** | *Arcane Pathfinder* (we hold 5, audio has 1–4) and *Legion* (we hold 1–2, audio has only the omnibus at rung 4). No volume is owned in both formats, so nothing can corroborate the numbering. ⚠️ Loosening the matcher would turn a hedge into a lie. | User — a purchase, or nothing |
| 💤 | **~100 physical books unscanned** | Standing backlog, **explicitly not a blocker**: *"Don't wait for books to be scanned to move on."* A book missing from the catalog usually means unscanned, ranked above "not owned" and well above "bug". | User, over time |
| ✅ | ~~**Percy Jackson covers: no per-book images exist**~~ | **Answered and built.** User: *"use the marketing image now but put a label on them."* Migration `0040` sets all five to the plain-background lineup and flags them `cover_status = 'standin'`, so they wear the picture **and** stay on the "Cover needed" list. ⚠️ The five identical URLs are deliberate — nothing may dedupe them. Selected by `edition_name`, not by id. | Done |
| ⏸️ | **Two books claim contradictory series** | #213 *Secret Ingredient* records series "The Pengrooms"; #215 *Pengrooms* records "Pringle & Finn". Both by Paul Castle, both auto-filled, both sourced — and they cannot both be right. **Both now carry a `work_watch` row**, so they wear a **Check** mark and appear under `Needs → To check`. The question is recorded; it still wants the user's eyes. | User — said they will verify later |
| ⏸️ | **Three books the model refused to identify** | #141 *Touch and Explore* (Scholastic), #160 *Bizzy Bear* (Nosy Crow), #174 *I love you, little bear* (Judi Abbot) — bare **series-line** titles, so a lookup returns the range rather than the book. Declining beat guessing. ⚠️ **CORRECTED 2026-08-13: the “ISBNs did not resolve” premise was FALSE for #141 and #174** — the API resolves both; only *searching* the ISBN fails. **Re-running DOES help when it queries the API rather than the web**; a subtitle also helps — e.g. *Bizzy Bear: Fire Rescue*. | User, from the covers |
| ⏸️ | **4 works have no cover any rung can reach** | A Paw Patrol shaped board book, *Home Sweet Home*, a Korean Tinyping board book, *The Nightmare Before Christmas*. **There is now a way in**: the book page's Cover panel accepts a link to any image, verified before storing. Uploading a *file* additionally needs the R2 binding below. | User — paste four links |
| ✅ | ~~**Cover file upload needs an R2 binding**~~ | **Done 2026-08-11.** Bucket `library-covers` created, `COVERS` binding + `COVERS_BASE_URL` wired, deployed `0ab1e18e`. ⚠️ The hostname is **`bookcovers.heygabi.ai`, not `covers.heygabi.ai`** — that one is already attached to the sibling's `audiobook-covers` bucket, and a custom domain belongs to exactly one bucket. Checked before choosing. Still worth adding a Cache Rule (`bookcovers.heygabi.ai/*` → Edge TTL 1 year); safe because object names hash the file contents, so a replaced cover is a different URL. | Done |
| ✅ | ~~**Barnes & Noble was never imported**~~ | **Found 2026-08-11 while answering "what's labelled deluxe edition".** The scan was staged on 2026-08-10 and never imported, because the only importer was for pledges and rightly refused a shop order — so **zero of its 7 books were in production**. `scripts/import-shop-orders.mjs` is the missing half. Now: **3 owned, 4 preordered**. ⚠️ This is also why the preorder tag had never rendered — it was correct all along with nothing to show. | Done |

### Answered by the user 2026-08-11

- **Percy Jackson set confirmed** — and independently verified: the group photo
  on the Illumicrate page shows exactly *The Lightning Thief*, *The Sea of
  Monsters*, *The Titan's Curse*, *The Battle of the Labyrinth*, *The Last
  Olympian*. No longer an assumption.
- **Words of Radiance "+ Books" is solved.** The leatherbound shipped as **two
  physical volumes**, because the book is too large to bind as one. So it is one
  edition delivered as two objects — not two different books, and not a mystery.
- **"DCC RPG + Unstoppable" — dropped.** The user says it is a D&D book, so the
  whole pledge belongs to the board game catalog. Nothing to split out, and no
  work should be minted. Removed from Blocked entirely.
- **The `/todo` page must NOT be public.** It stays built and pushed but
  undeployed. heygabi.ai has no auth and never will, so if it is wanted live it
  has to move to a host that does — the catalog sites already sit behind
  Firebase sign-in.

### Cleared since the last revision

- ~~Main checkout dirty with unclaimed manager-role work~~ — it was the
  people/roles feature from earlier in the session; it committed itself as
  `a138019` + `c75d174`.
- ~~Deploy blocked by a dirty tree~~ — main is clean; five branches merged.
- ~~Barnes & Noble sign-in~~ — done, scanned, complete.
- ~~Kickstarter password verification~~ — user fixed; all 62 pledges enumerated.
- ~~Indiegogo sign-in~~ — done; only 3 pledges exist.
- ~~Worktrees typechecking against the main checkout~~ — no `node_modules` in a
  worktree made Node resolve `@lc/core` upward. `npm install` in the worktree
  fixes it. All five agents confirmed.

---

---

## Crowdfunding rescan — 2026-08-11, IN PROGRESS

The owner: *"I'm feeling dodgey about our scanned material from kickstarter and
related sites. Let's just do a full rescan and present me the list for
verification. Do a thorough reading not just high level."*

They are right. **Kickstarter shows 1 active + 61 successful pledges; the
database holds 11 pledge items.**

⚠️ **The list view paginates — there is a "Show more pledges" button and it must
be clicked until exhausted.** A first pass read only the visible 10 and would
have reported a fraction as if it were the whole.

Already visible and **not** recorded: *Raze & Ruthless: The Grimoire Editions*
($190, Legendary Book Box, uniquely numbered), *Regicide & Rexus: The Grimoire
Editions* ($164), *Tamer: King of Dinosaurs Book 11* ($90, signed paperback),
*Worlds Beyond Number: The Official Graphic Novel* ($435).

Scope: books only; board games belong to the sibling catalog but get listed as
excluded so the judgement can be checked.

### Result — **14 unrecorded book pledges**. COMPLETE. Report in the session scratchpad.

| account | coverage |
|---|---|
| Kickstarter | ✅ 61 successful + 1 active, after "Show more pledges" ×5 |
| Indiegogo | ✅ all 3 pledges; 2 are books |
| BackerKit `aim.com` | ✅ Pledges (1, no pagination) + Surveys p1+p2 + Active + Digital rewards |
| BackerKit `gmail.com` | ✅ Pledges (4) + Surveys Completed p1+p2 + Active p1+p2 + Digital rewards |

⚠️ **Two pagination traps.** Kickstarter renders 10 of 61 by default; **every**
BackerKit survey list is `1 / 2`. Trusting the first screen would have reported
a sixth of the truth. Look for pagination on every list, every time.

**The finds:** Completionist Chronicles **1–5 in physical Grimoire editions**
(*Ritualist* box SHIPPED) · **Tamer 1–10 in paperback plus 11 on preorder** —
the book-7 tier was "WHOLE SERIES SIGNED PAPERBACKS", confirmed by the owner,
and no hardcover exists · **Beneath the Dragoneye Moons Complete Realmkeeper
Set** ($670, shipped) · *Worlds Beyond Number* graphic novel · *Monster Empire 2* ·
*Ascend Online Book 1* · and from Indiegogo **Space Knight 5 and 6** — which is where the
existing unattributed Space Knight EPUBs came from. ⚠️ The owner confirms print
copies exist and they own **Space Knight 1–9**, so that is 9 paperbacks, not 2.

**Tamer audio, settled by the owner 2026-08-12:**

| Volumes | Audio | Note |
|---|---|---|
| 2–6 | **not owned** | Confirmed correct — a real gap, not a filing error. Stop re-checking. |
| 11 | **owned** | ⚠️ But **BookFunnel will not serve the download at this time**, so no m4b exists locally and the audiobook catalog cannot see it. |

⚠️ Tamer 11 is the case the schema handles badly: *owned but unobtainable*. It
is not a gap to chase and not a file the pipeline can ever acquire — any audit
that walks the library will keep reporting it missing. Treat a future "Tamer 11
audio missing" finding as already answered, and retry BookFunnel occasionally
rather than the acquisition pipeline.

⚠️ **Nothing has been written to the database.** The owner asked to verify first.

Still needs the owner: how many volumes in the Realmkeeper Set; what the two
Grimoire "Legendary Book Box" tiers contain; whether *Unstoppable* is the published title; and what "+ Books" meant
in the Words of Radiance tier — that order detail refused to open twice.

---

## Staged, waiting on the user to run — 2026-08-10

All dry-run and verified against production. **Nothing below has been written.**
Every one needs `LC_AUDIOBOOK_ROOT` only where noted, and all are idempotent.

Run **in this order** — the first is free and the second deliberately skips what
the first fixes.

```bash
# 1. Lift 12 stranded edition covers onto their works. No network.
node scripts/backfill-work-covers.mjs --remote --commit

# 2. Fetch the 20 covers Google Books holds. ~2 min, free (keyed).
npm run backfill:missing-covers -- --remote --commit

# 3. Three asserted audiobook aliases: Tamer 9, Tamer 10, The Primal Hunter.
LC_AUDIOBOOK_ROOT=C:/Users/nbasl/OneDrive/Documents/vs-code-repos/bookbuddy/audiobook_catalog \
  npm run seed:audiobook-aliases -- --remote --commit

# 4. Re-run the audiobook match so the Tamer fix and the aliases both land.
LC_AUDIOBOOK_ROOT=C:/Users/nbasl/OneDrive/Documents/vs-code-repos/bookbuddy/audiobook_catalog \
  npm run backfill:audiobooks -- --remote --commit
```

⚠️ **Step 4 rewrites `audiobook_holding`.** It marks the five wrong Tamer rows
and the wrong Primal Hunter row `stale_at` rather than deleting them (migration
0003's rule), and writes the correct rows for Tamer 7–10. Expect **six fewer
false claims** and the honest total to land near 45.

### Optional and **paid** — not run, gate separately

```bash
# ⚠️ COSTS MONEY. ~6c/book × 25 books ≈ $1.50, estimated from list prices.
npm run backfill:missing-covers -- --remote --llm            # dry run first
npm run backfill:missing-covers -- --remote --llm --commit
```

Yield is **unmeasured** — no sweep has been run. Every URL it proposes is fetched
and size-checked before it can be written, so the failure mode is "found
nothing", not "stored a dead link".

---

## Open work, not blocked

| | Item |
|---|---|
| 🔨 | **Keep GitHub current** — the user permits pushing straight to `main` while this site is pre-release, *provided a rollback id is recorded*. Contrast the board game catalog, which has real users now and where changes are "more damning". |
| 💤 | **Cross-project TODO page on heygabi.ai** — all projects, tagged one/some/all/landing. Explicitly deferred: "we will swap to it later". |
| 💤 | Gamefound — excluded, no books. |

---


---

## 🔍 AUDIT 2026-08 — confirmed findings

Ranked CRITICAL + HIGH items from the 2026-08 review/verify audit
(`wf_69d2365f-d02`, 14 units, 97 candidate findings). Full severity-ranked
list including MEDIUM/LOW: [`docs/info/audit-2026-08-findings.md`](info/audit-2026-08-findings.md).

🟡 **The CRITICAL PEER_TOKEN item below is now FIXED-IN-CODE** on
`feature/peer-token-secret` (2026-08-24): the plaintext `token` was removed
from both `PEERS` entries and the outbound `X-Peer-Token` now reads the
`PEER_TOKEN` secret. **Owner action still required to close the leak:** rotate
`PEER_TOKEN` to a fresh value on both workers, then deploy both. Until then the
OLD leaked value stays valid in git history. See the findings doc's top section.

## ✅ [CRITICAL] `if (count === 0) return null;` sits BEFORE two `useCallback` hooks, so the first time a book is sel…

**Where:** `apps/web/src/components/BulkActionBar.tsx:26` (library_catalog / web-components)

**Status:** ✅ FIXED on `feature/audit-fixes-library` (each fix has a failing-before/passing-after test).

**Claim:** `if (count === 0) return null;` sits BEFORE two `useCallback` hooks, so the first time a book is selected the component renders more hooks than the previous render and React throws — with no error boundary anywhere in the app, the whole collection page white-screens.

**Fix:** Move the `if (count === 0) return null;` early return in BulkActionBar.tsx to AFTER both useCallback hooks (or hoist the hooks above any conditional return) so hook count is invariant across renders.

**Source:** 2026-08 audit, see `docs/info/audit-2026-08-findings.md`

## 🟡 [CRITICAL] The live cross-instance peer shared secret is committed in plaintext, twice, in a tracked file on a …

**Where:** `apps/worker/wrangler.toml:203` (3 units: worker-scanjobs-isbn-enrich, infra-deploy-migrations-ci, worker-research-donor-peer)

**Status:** 🟡 FIXED-IN-CODE on `feature/peer-token-secret` (2026-08-24) — plaintext `token` removed from both `PEERS` entries; outbound `X-Peer-Token` now reads the `PEER_TOKEN` secret; `parsePeers`/`PeerConfig` no longer carry `token`; incoming auth unchanged. Covered by tests. **Owner-pending to actually close the leak:** (1) `wrangler secret put PEER_TOKEN` a FRESH value on BOTH the main worker and the friend/`padhard` worker (same value); (2) deploy both. Until deployed, the old leaked value stays valid. Optionally purge history (BFG/`git filter-repo`).

**Claim:** The live cross-instance peer shared secret is committed in plaintext, twice, in a tracked file on a PUBLIC GitHub repo — and it authenticates a route that wipes and rewrites `peer_holding` on both instances.

**Fix:** Rotate PEER_TOKEN via `wrangler secret put`, remove the plaintext value from both PEERS entries in wrangler.toml, and read it from a Worker secret at runtime instead of a tracked [vars] literal.

**Source:** 2026-08 audit, see `docs/info/audit-2026-08-findings.md`

## ✅ [HIGH] The paid `--llm` rung reads `ANTHROPIC_API_KEY` with no instance awareness, so a `--friend` sweep bi…

**Where:** `scripts/backfill-missing-isbns.mjs:431` (library_catalog / scripts-backfills-a)

**Status:** ✅ FIXED on `feature/audit-fixes-library` (each fix has a failing-before/passing-after test).

**Claim:** The paid `--llm` rung reads `ANTHROPIC_API_KEY` with no instance awareness, so a `--friend` sweep bills the OWNER's Anthropic account for padhard's books — the exact custody defect fixed in the sibling cover script on 2026-08-23 and left live here.

**Fix:** Read the instance-specific Anthropic key (ANTHROPIC_API_KEY_FRIEND_SAM-style) when flags.friend is set, matching the fix already applied to the sibling cover script.

**Source:** 2026-08 audit, see `docs/info/audit-2026-08-findings.md`

## ✅ [HIGH] The ISBN write also overwrites `edition.source`, so a hand-created (`manual`) edition that gains an …

**Where:** `scripts/backfill-missing-isbns.mjs:517` (library_catalog / scripts-backfills-a)

**Status:** ✅ FIXED on `feature/audit-fixes-library` (each fix has a failing-before/passing-after test).

**Claim:** The ISBN write also overwrites `edition.source`, so a hand-created (`manual`) edition that gains an ISBN from a free rung is silently demoted to `'openlibrary'` — destroying the "'manual' outranks everything and is never overwritten automatically" protection the column exists for.

**Fix:** Only overwrite edition.source when the incoming source outranks the existing one (respect the 'manual' precedence rule), not unconditionally alongside isbn13.

**Source:** 2026-08 audit, see `docs/info/audit-2026-08-findings.md`

## 🚩 [HIGH] The LibraryThing rung applies NO author gate and NO title-similarity gate — the `author` argument is…

**Where:** `scripts/backfill-missing-isbns.mjs:246` (library_catalog / scripts-backfills-a)

**Status:** 🚩 FLAGGED — left for the owner (not a clear code fix). See report.

**Claim:** The LibraryThing rung applies NO author gate and NO title-similarity gate — the `author` argument is accepted and never used, and `similarity` is hardcoded to 1.0 — yet the file's own Safety section claims a ≥0.80 title gate protects every write. It then files the result under `source: 'openlibrary'`, a provenance that is not true.

**Fix:** Actually use the author argument as a gate and compute a real title-similarity score in the LibraryThing rung instead of hardcoding similarity to 1.0, or stop labeling its output source: 'openlibrary'.

**Source:** 2026-08 audit, see `docs/info/audit-2026-08-findings.md`

## ✅ [HIGH] Six writing backfills destructure only `{ commit, remote, limit }` from `parseFlags()` and drop `fri…

**Where:** `scripts/backfill-work-covers.mjs:35` (library_catalog / scripts-backfills-a)

**Status:** ✅ FIXED on `feature/audit-fixes-library` (each fix has a failing-before/passing-after test).

**Claim:** Six writing backfills destructure only `{ commit, remote, limit }` from `parseFlags()` and drop `friend`, so `--friend --remote --commit` silently reads AND writes the MAIN production catalogue while reporting as if about padhard — defeating the guard `dbName()` was added to provide, and contradicting the docs' claim of "a `--friend` flag on every script".

**Fix:** Add friend to the destructured parseFlags() result in all six backfill scripts and thread it into dbName().

**Source:** 2026-08 audit, see `docs/info/audit-2026-08-findings.md`

## ✅ [HIGH] `research_book` returns only `{workId}` — none of RESEARCH_RESULT_FIELDS exists on the endpoint's re…

**Where:** `apps/web/src/lib/gabi.ts:151` (library_catalog / web-lib-and-app-shell)

**Status:** ✅ FIXED on `feature/audit-fixes-library` (each fix has a failing-before/passing-after test).

**Claim:** `research_book` returns only `{workId}` — none of RESEARCH_RESULT_FIELDS exists on the endpoint's response, so a paid lookup that came back `error` is indistinguishable from one that filled every field.

**Fix:** Have research_book's response actually include the RESEARCH_RESULT_FIELDS the caller expects, or have the caller check for an explicit error field.

**Source:** 2026-08 audit, see `docs/info/audit-2026-08-findings.md`

## ✅ [HIGH] Neither role-write route inspects the TARGET's current role, and the last-owner guard only fires whe…

**Where:** `apps/worker/src/routes/users.ts:90` (library_catalog / worker-auth-core)

**Status:** ✅ FIXED on `feature/audit-fixes-library` (each fix has a failing-before/passing-after test).

**Claim:** Neither role-write route inspects the TARGET's current role, and the last-owner guard only fires when the actor is editing themselves — so an `admin` can revoke or demote every `owner`, reaching countOwners()==0, after which no role in the app can ever mint an `owner` again.

**Fix:** Check the target's current role before a role-write, and fire the last-owner guard whenever a write would bring countOwners() to 0, not only on self-edit.

**Source:** 2026-08 audit, see `docs/info/audit-2026-08-findings.md`

## ✅ [HIGH] `OWNER_EMAILS` is documented in five places as a lock-out recovery hatch, but it is applied only whe…

**Where:** `apps/worker/src/env.ts:57` (library_catalog / worker-auth-core)

**Status:** ✅ FIXED on `feature/audit-fixes-library` (each fix has a failing-before/passing-after test).

**Claim:** `OWNER_EMAILS` is documented in five places as a lock-out recovery hatch, but it is applied only when a NEW app_user row is INSERTed — an existing row's role is never re-forced on sign-in, so the mechanism cannot recover the one situation it is documented for (a row that exists with the wrong role).

**Fix:** Re-apply OWNER_EMAILS on every sign-in for an existing app_user row, not only on INSERT of a new one.

**Source:** 2026-08 audit, see `docs/info/audit-2026-08-findings.md`

## ✅ [HIGH] DELETE /works/:id/accessories/:accessoryId deletes by accessory id ALONE — the `:id` work segment is…

**Where:** `apps/worker/src/routes/accessories.ts:96` (library_catalog / worker-catalog-covers-series)

**Status:** ✅ FIXED on `feature/audit-fixes-library` (each fix has a failing-before/passing-after test).

**Claim:** DELETE /works/:id/accessories/:accessoryId deletes by accessory id ALONE — the `:id` work segment is never used as a scope, so a request naming the wrong work destroys another book's accessory row and answers 200.

**Fix:** Scope the DELETE by both :id (work) and :accessoryId, not accessoryId alone.

**Source:** 2026-08 audit, see `docs/info/audit-2026-08-findings.md`

## ✅ [HIGH] GET /api/gabi/memory returns `{turns, updatedAt}` but its ONLY caller reads `{ok, record}`, so the D…

**Where:** `apps/worker/src/routes/gabi-memory.ts:101` (library_catalog / worker-gabi-and-memory)

**Status:** ✅ FIXED on `feature/audit-fixes-library` (each fix has a failing-before/passing-after test).

**Claim:** GET /api/gabi/memory returns `{turns, updatedAt}` but its ONLY caller reads `{ok, record}`, so the Discord side never sees the shared memory — Phase 2's cross-surface continuity is silently dead in one direction.

**Fix:** Change GET /api/gabi/memory to return {ok, record} (or update the caller to read {turns, updatedAt}) so the two sides agree.

**Source:** 2026-08 audit, see `docs/info/audit-2026-08-findings.md`

## ✅ [HIGH] PUT /api/gabi/memory passes the caller's FULL conversation window to `savePanelConversation`, which …

**Where:** `apps/worker/src/routes/gabi-memory.ts:139` (library_catalog / worker-gabi-and-memory)

**Status:** ✅ FIXED on `feature/audit-fixes-library` (each fix has a failing-before/passing-after test).

**Claim:** PUT /api/gabi/memory passes the caller's FULL conversation window to `savePanelConversation`, which APPENDS rather than replaces — so every Discord save re-appends the whole stored window and the shared record fills with duplicated turns.

**Fix:** Make PUT /api/gabi/memory replace the stored window via savePanelConversation instead of appending the full window every time.

**Source:** 2026-08 audit, see `docs/info/audit-2026-08-findings.md`

## ✅ [HIGH] `estimateSubrequests` never counted the free-details ladder that `runDetailsResearch` now always run…

**Where:** `apps/worker/src/lib/details-sweep.ts:328` (library_catalog / worker-gabi-and-memory)

**Status:** ✅ FIXED on `feature/audit-fixes-library` (each fix has a failing-before/passing-after test).

**Claim:** `estimateSubrequests` never counted the free-details ladder that `runDetailsResearch` now always runs, so the sweep's budget can pick two books whose real cost is ~74 subrequests against a 50 ceiling — and overrunning it terminates the invocation silently.

**Fix:** Add the free-details ladder's subrequest cost into estimateSubrequests so the sweep's budget reflects what runDetailsResearch actually spends.

**Source:** 2026-08 audit, see `docs/info/audit-2026-08-findings.md`

## ✅ [HIGH] GET /api/peer/holdings performs no token check at all, yet it is mounted before the requireAuth blan…

**Where:** `apps/worker/src/routes/peer.ts:120` (library_catalog / worker-research-donor-peer)

**Status:** ✅ FIXED on `feature/audit-fixes-library` (each fix has a failing-before/passing-after test).

**Claim:** GET /api/peer/holdings performs no token check at all, yet it is mounted before the requireAuth blanket and is classified everywhere in the repo as a token-gated machine route. It is an unauthenticated public read of another household's holdings, and the justification given for the pre-auth mount is factually wrong — the route has zero callers.

**Fix:** Require the peer token on GET /api/peer/holdings like every other machine route, and correct/remove the pre-auth-mount justification since the route has no callers.

**Source:** 2026-08 audit, see `docs/info/audit-2026-08-findings.md`

## ✅ [HIGH] The peer-holdings query uses a copy-status set that contradicts the canonical `HELD_STATUSES` in bot…

**Where:** `apps/worker/src/lib/peer-push.ts:89` (library_catalog / worker-scanjobs-isbn-enrich)

**Status:** ✅ FIXED on `feature/audit-fixes-library` (each fix has a failing-before/passing-after test).

**Claim:** The peer-holdings query uses a copy-status set that contradicts the canonical `HELD_STATUSES` in both directions — it advertises borrowed and not-yet-delivered books to another household as things we hold, and hides books we own but have lent out.

**Fix:** Use the canonical HELD_STATUSES set in the peer-holdings query instead of a contradictory copy-status list.

**Source:** 2026-08 audit, see `docs/info/audit-2026-08-findings.md`

