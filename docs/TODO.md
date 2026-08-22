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

## ✅ GABI unification — ALL PHASES DEPLOYED (2026-08-21)

Design of record: [`info/gabi-unification.md`](info/gabi-unification.md) (moved
there 2026-08-21 from an untracked `docs/GABI_UNIFICATION_PLAN.md` that existed
only on the owner's machine). Owner ask, 2026-08-20: *"I want them to be a 1 for
1 with just a different entry point… If I'm linked in Discord I should see my
Discord personality coming through in the chat on my UI too."*

✅ **Phase 1 (write tools) — deployed 2026-08-21.**
✅ **Phase 2 (shared memory endpoint) — deployed 2026-08-21.** Discord calls `GET/PUT /api/gabi/memory`, both surfaces key on `{surface:'shared', space, person}`.
✅ **Phase 3 (unified prompt) — deployed 2026-08-21.** One canonical personality, Discord-side prompt deleted.
✅ **Personal Context (reading state + notes) — deployed 2026-08-21.**

⚠️ Migration `0380_gabi_person_profile.sql` applied as part of deploy.

---


## ✅ Three feature branches — ALL MERGED 2026-08-21

Completed by Kiro session 2026-08-21 (K2 typecheck green first, then K11 merges).
All three (`series-overrides`, `openlibrary-ids`, `completeness-wishlist-relations`)
merged into `main`, conflicts resolved, typecheck still green after all three.
`npm run typecheck` exits 0 — 0 errors before and after merges.

Found while answering *"what is scratchpad wave 3, it has so many changes?"*.
**wave3 and wave4 were a false alarm** — both branches (`feature/scanjobs-vision`,
`feature/research-details`) are **already merged into `main`**; their 245/249
"changes" were deletions, because the Temp scratchpad directories had been
gutted. Nothing to recover, nothing to merge.

**But three other branches are genuinely outstanding**, all last touched
2026-08-10 and now eleven days behind `main`:

| Branch | Commits | Roughly |
|---|---|---|
| `feature/completeness-wishlist-relations` | 3 | series completeness, reachable wishlist, related books — ~4,400 insertions, heavy in `packages/db` |
| `feature/series-overrides` | 2 | 24 of 37 series gaps filled with a source each, plus `--prune` for the ebook importer |
| `feature/openlibrary-ids` | 1 | Open Library work ids, 35 of 116, corroborated on more than a name — ~3,700 insertions |

⚠️ **MEASURED 2026-08-21: every one of them conflicts with `main`.** Computed
with `git merge-tree --write-tree` (in-memory, no checkout — see the gotcha
below for why a worktree could not be used):

- `openlibrary-ids` → `packages/core/src/index.ts`, `packages/isbn/*`,
  `package.json`, `docs/*` and more
- `series-overrides` → `scripts/series-overrides.json`, `docs/HANDOFF.md`,
  `docs/info/covers-and-series.md`
- `completeness-wishlist-relations` → **8+ files across `apps/web`** including
  `App.tsx`, `api.ts`, `CollectionPage.tsx` — exactly the files today's GABI
  work also touched

☐ **Owner: which of the three, and in what order?** These are not a chore. Each
  needs real conflict resolution across core app files, and ⚠️ **this repo's
  `npm run typecheck` is already RED before any merge** (pre-existing —
  `WorkPage.tsx`, `lib/peer-push.ts`, `routes/catalog.ts`, all unmodified), so a
  merge lands in a tree where new breakage cannot be told from old. **Fix the
  typecheck first**, or the merges cannot be verified.
☐ Suggested order once that is clear, smallest blast radius first:
  `series-overrides` (data + one script) → `openlibrary-ids` (new modules,
  mostly additive) → `completeness-wishlist-relations` (the web-heavy one).

**Cleaned up the same day:** 15 stale `worktree-agent-*` branches and their
worktrees, all fully merged, deleted. The seven fully-merged `feature/*`
branches were LEFT ALONE — they are human-named and cost nothing.

---


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

## ☐ The Wandering Inn — series and volumes need rectifying (split print run)

Owner, 2026-08-20: *"wandering inn needs to have its series and volumes
rectified because the author split the physical books."*

**What is wrong:** the author published the physical books as SPLITS of the
original volumes, so one source volume maps to several printed books. Whatever
the catalogue currently holds treats those as if the numbering still lined up,
so the series order and the volume numbers disagree with the objects on the
shelf.

⚠️ **THIS IS DATA/MACHINERY DRIFT, NOT A DESIGN QUESTION.** Volume semantics
were settled 2026-08-19 and are recorded in
[`info/volume-numbers.md`](info/volume-numbers.md): series + sort = complete,
display optional, findings auto-apply. **Do not reopen that design to fix this
title** — a one-off mapping problem is exactly the shape that tempts a
re-litigation, and the settled rules already cover it.

☐ **Establish the real mapping first**, from the publisher's own numbering —
  which printed book covers which part of which source volume. Write it down
  before touching a record; guessing the split is how a fix has to be redone.
☐ Decide how a split book is IDENTIFIED so sort order stays stable and two
  printed books never collide on one volume number.
☐ Apply through the normal corrections path, not by hand-editing rows.

**Not verified — look before assuming:** how many volumes are affected, what
the catalogue holds for this series today, whether the same title in
`audiobook_catalog` has the same problem (the audio releases follow their own
numbering and may already differ), and whether any other serial-turned-print
series has the same split (this will not be the only one).

---

## ☐ Pagination does not scroll to top — physical book library

Owner, 2026-08-20: *"when we paginate to a new page on the physical book
libraries it doesnt scroll to the top, i know its an easy fix but we need to
save credits so file it."*

**Symptom:** clicking through to the next page of the physical book library
leaves the viewport where it was, so the reader lands mid-list — or below it
entirely on a short page — and has to scroll up to see what they just asked
for. Worst on mobile, where the list is tallest relative to the screen.

**Owner's own read: an easy fix.** Filed rather than fixed because the session
was near the weekly limit; NOT investigated, so the note below is a pointer,
not a diagnosis.

☐ **Fix:** on page change, scroll the list container (or window) back to the
  top — and move focus to the list heading at the same time, or a keyboard and
  screen-reader user is left at the old position even when the pixels move.
☐ Check the same handler covers **every** way the page changes: next/prev,
  a numbered page, and any filter or sort that resets to page 1.

**Not verified:** which component owns the pagination, whether the physical
book library shares it with any other list, and whether the ebook/audiobook
lists have the same behaviour. Look before assuming it is one call site.

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

## ✅ ISBN backfill — COMPLETE 2026-08-21 (free rungs + LLM)

**Final result: 181 → 21 works without ISBN.** Free rungs wrote 89 (2026-08-20),
then the LLM rung wrote another 71 (2026-08-21). LibraryThing API wired as
rung 2.5 (key valid, Cloudflare 403 — dead for now but plumbed). The remaining
21 are correctly ISBN-less (fan translations, crowdfund-only, indie).

| Rung | Found |
|---|---|
| Open Library (title+author) | 70 |
| Google Books (title+author) | 24 |
| LibraryThing (rung 2.5, wired) | 0 (CF 403) |
| LLM (Claude) | 71 |
| UNIQUE conflicts (skipped) | 5 |
| **Total written** | **160** |

**Script:** `scripts/backfill-missing-isbns.mjs`, `npm run backfill:missing-isbns`.
