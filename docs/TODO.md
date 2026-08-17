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

## 🔥 Owner asks 2026-08-16 late evening — status board

### Third wave (2026-08-17 morning)
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
- **🤖 "Sam asks GABI to fix her books" — conversational fixer (owner vision,
  2026-08-16 late):** *"in the future i want Sam to be able to ask gabi to fix
  books for her like id ask you. it'd be done through api but it would have
  the needed context to fix things."* FUTURE — design seed, not queued yet
  (sits after the current batch + Discord queue + EPUB/PDF viewer unless
  reprioritized). The shape that keeps it safe and small:
  - **The write plumbing already exists and must be REUSED, never bypassed:**
    `claimRun`/`saveFindings`/`applyFinding`/`autoApplyFindings` are the one
    canonical path that fixes a book, with provenance (`source_tier`,
    `decided_by`, `decided_how`) and revert (`revertFinding`) built in. A
    conversational GABI is a new FRONT DOOR to that machinery — an Anthropic
    tool-use loop whose tools are the worker's existing capability-gated
    endpoints — not a new writer.
  - **Her authority, not GABI's:** actions run as Samantha (admin on her
    instance, role ladder), attributable in the audit trail — never as a
    service account. Scope: HER instance only.
  - **Guardrails:** action allowlist (detail fixes, cover swaps; deletes
    excluded at first), confirm-before-write summaries for anything bulk,
    spend rides the capped-workspace key design (§4 of second-instance.md).
  - **Surface question for later:** her site (a chat panel) vs Discord DM to
    GABI — decide when built; the API loop is identical behind either.
  Cross-referenced from catalog-platform TODO §0 (GABI queue).
  ✅ **DESIGN DONE 2026-08-17, awaiting owner read.**
  📄 **[`info/gabi-fixer-design.md`](info/gabi-fixer-design.md)** — full design,
  with rejected alternatives per section. **Nothing is built; no route, table,
  secret or panel exists.** What the design settled that the seed left open:
  - ⚠️ **The loop runs in HER BROWSER, not in the Worker.** A server-side loop
    is the obvious shape and the wrong one: a six-turn conversation that
    researches one book and patches two fields is ~40 of the **50 subrequests**
    an invocation gets, and going over **terminates the invocation rather than
    throwing** — a conversation whose failure mode is silence. The browser
    already holds her live Firebase token and already calls every one of these
    endpoints, so each tool call is *literally* the request the edit form makes:
    "her authority end to end" becomes a thing the design declines to
    circumvent rather than a thing it builds. The Worker keeps one thin route
    (`POST /api/gabi/turn`, `runResearch`-gated) that holds the API key and
    makes exactly ONE model call per turn.
  - ⚠️ **`title`/`authors` are unreachable by construction**, not by validation
    — they re-derive `work_key`, and moving a non-provisional key needs a
    Firestore `keyMove` attestation the Worker structurally cannot make.
    `applyFinding` already refuses the same two fields for the same reason.
  - **No migration is needed to make a GABI write auditable.** `decided_how`
    already means *"did anybody look at the value"*, not *"did a person ask"* —
    so a blank-fill lands `'auto'` + her id, a confirmed overwrite lands
    `'human'` + her id, and `Actor.note` carries `gabi:<conversationId>`. A
    third enum value would have stretched the column's meaning for nothing.
  - **Batches cap at 10** because `POST /api/research/undo` caps at 10: a batch
    you cannot undo in one action should not be one action.
  - ⚠️ **Do not disable thinking on Opus 5 to save money** — with it off, tool
    calls can arrive as plain *text*: the turn succeeds, the call never runs,
    nothing errors. Cost is controlled with `effort: 'low'` instead, exactly as
    `RESEARCH_EFFORT` already does.
  - **Cost: single-digit cents per conversation**, dominated by the ~2¢ paid
    lookup, not by the loop. ⚠️ Haiku is a false economy — its 4096-token cache
    minimum is above this prefix, so it pays full input price every turn.
  - 🧑 **Owner action, before anything is built:** confirm **Samantha's role on
    `padhard`**. The seed says `admin`; her `app_user.role` row was not read,
    `ESTATE_DEFAULT_ROLE` is unset (the `moderator` flip is paused), and a
    `member` gets 403 from every write tool — the whole feature is dark.
  - **Discord needs four things that do not exist** (an `app_user` join, token
    custody, a deferred-response path, persisted conversation state); the site
    panel needs none. If Discord is wanted sooner, the propose-and-deep-link
    shape is buildable today with no new auth.

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

## 📚 Ebooks may want to be their OWN site — the ownership boundary is per-FORMAT (owner insight 2026-08-16)

Raised mid-conversation and **not yet decided** — recorded because it reframes
the federation question above rather than adding to it.

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

**Not a build yet.** Open questions, in the order they need answering:
1. Does an ebook site mean a new catalog, or a VIEW over the shared index?
   (The index already exists and already spans catalogs — a new Worker may be
   the expensive answer to a question a query answers.)
2. What happens to `library_catalog`'s existing ebook rows — move, mirror, or
   leave and re-point?
3. Does the shelf server change shape? It serves audiobooks by URL today;
   ebooks are the same *kind* of thing.
4. Who is the ingest owner once ebooks leave the physical catalog — step 1b
   still produces the manifest.

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

## 📸 Owner note — Illumicrate edition photos (2026-08-14)

The Percy Jackson ILLUMICRATE editions need their own photos added as
edition/cover images — the audiobook covers now being pulled are the standard
art, not the Illumicrate art. Owner action: photograph the Illumicrate copies
and upload via each work's cover UI (Replace cover / the edition row).
Owner's words: "Leave me a note somewhere to add the illumicrate editions
photos."

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
