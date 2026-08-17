# EPUB / PDF in-browser viewer — Information Reference (design)

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-17** — every number in §1 was measured that day by
> reading `audiobook_catalog/site/ebooks.json` (168 records, arithmetic run over
> `size_bytes`) and by reading the named source files in `audiobook_catalog`,
> `catalog-platform` and this repo. §10 lists what was **not** verified.
> This is a **DESIGN DOC**: nothing below is built. No code, no data and no
> other doc was changed alongside it except the two pointers this repo's rules
> require (`info/README.md` index row, `TODO.md` item).

**The owner's ask, verbatim (2026-08-16):**

> *"how hard would it be to have a reader for EPUBs and PDFs so users could
> either preview or a read a book on the site?"*

**Sequencing (owner, `TODO.md`):** current batch → Discord portal → **this**.

**The first-take framing this doc was asked to test** — *"epubs render off R2
range requests, PDFs via pdf.js, and the real design work is auth-gating the
file streams plus reading-position sync"* — is **two-thirds right and one-third
backwards.** The auth-gating call is exactly right and §3 treats it as the
main event. But the files **are not in R2 at all today** (§1), so an ingest
phase exists that the framing did not price; and **range requests are a PDF
technique, not an EPUB one** (§4.1) — an EPUB is a ZIP whose readers fetch the
whole archive. That inversion changes which format ships first (§8).

---

## 0. The design in one paragraph

The 168 ebook files stay produced exactly as they are (pipeline sync step 1b
walks `C:/Users/nbasl/OpenAudible/books` and writes `site/ebooks.json`). A new
pipeline step mirrors those files into a **private R2 bucket that has no public
dev URL** — deliberately not the covers bucket, which does. Bytes reach a
browser through exactly one door: **`audiobook-api.heygabi.ai`, the audiobook
Worker that already exists, already verifies Firebase ID tokens with the
canonical estate verifier, and already carries a committed `download`
capability with a `member` floor.** The Worker streams `R2ObjectBody.body`
through untouched, honours `Range`, and **never mints a URL that works on its
own** — every request carries a bearer token in a header, so a copied link is a
401 rather than a leak. The reader itself is a new page in the audiobook repo's
template tree, served at `ebooks.heygabi.ai/read/#<anchor>` through the
existing `ebooks-door` proxy — no fourth deployable, the same decision the
ebook-split design already made. **pdf.js ships first** because it
range-streams its own 181 MiB outlier by design where epub.js cannot; epub.js
follows. Reading position becomes **the first collection in this estate keyed
on `uid`**, because the reader's readership is token-bearing by construction —
which no other shared-store collection can say.

---

## 1. What is true today — all measured 2026-08-17

### 1.1 The corpus, measured from `site/ebooks.json`

| Fact | Value |
|---|---|
| Files in the manifest | **168** (`count`; `generated_at` 2026-08-17T07:00:39Z) |
| **Total bytes** | **1,805,293,238 B = 1.681 GiB = 1.805 GB** |
| EPUB | **138 files, 1.084 GiB** — mean 8.0 MiB, **median 3.1 MiB**, min 295 KiB, **max 393.3 MiB** |
| PDF | **30 files, 0.598 GiB** — mean 20.4 MiB, **median 6.1 MiB**, min 37 KiB, **max 181.1 MiB** |
| Manifest root | `C:/Users/nbasl/OpenAudible/books` — the same tree `sync_to_drive.py` mirrors |
| Per-record fields | `path, anchor, filename, format, title, author, source, beside_audiobook, size_bytes, modified, cover_url, cover_source` |
| Provenance | `source`: 138 `opf`, 30 `filename` (the `filename` rows stay **provisional** — every consumer must treat them so) |
| Author present | 151 of 168 |

**The size distribution is the whole engineering story, so it gets its own
table.** The median book is small and the tail is brutal:

| Threshold | Files over it | Why the threshold matters |
|---|---|---|
| 16 MiB | **14** | roughly where a phone's patience with a whole-file fetch ends |
| **25 MiB** | **10** | **Cloudflare Pages' documented per-file asset cap** — these could never be Pages assets even if they were allowed to be public |
| 50 MiB | 5 | |
| 100 MiB | 3 | |
| **128 MiB** | **3** | **the Workers per-isolate memory limit** — buffering any of these in the Worker is an OOM, not a slow request |

Bucketed:

| EPUB | count | | PDF | count |
|---|---|---|---|---|
| < 1 MiB | 30 | | < 5 MiB | 13 |
| 1–5 MiB | 65 | | 5–25 MiB | 10 |
| 5–20 MiB | 40 | | 25–100 MiB | 6 |
| **20 MiB +** | **3** | | **100 MiB +** | **1** |

The five files that drive every constraint below:

| Size | Format | Path |
|---|---|---|
| **393.3 MiB** | epub | `Brandon Sanderson/White Sand Omnibus …` |
| **181.1 MiB** | pdf | `Brandon Sanderson/SL001_Stormlight_Handbook_digital.pdf` |
| **143.2 MiB** | epub | `Brandon Sanderson/whitesand.epub` |
| 72.7 MiB | pdf | `Brandon Sanderson/mistborn_adventuregame.pdf` |
| 65.8 MiB | pdf | `Kumo Kagyu/Goblin Slayer, Vol. 1.pdf` |

⚠️ **The two worst files are EPUBs, and EPUB is the format whose readers cannot
stream.** That single row decides §8's phase order.

### 1.2 Where the files actually live — **not R2**

| Location | What is there | Measured from |
|---|---|---|
| `C:/Users/nbasl/OpenAudible/books` | **the files themselves**, the manifest's `root` | `ebooks.json` |
| Google Drive | a mirror, via `sync_to_drive.py` | `ebook-split-design.md` §5 |
| `/srv/shelf/library` on the shelf server | an rclone pull of the same tree → Audiobookshelf → `shelf.heygabi.ai` behind Cloudflare Access | `SHELF_SERVER.md` — ⚠️ its own header says **"NOT YET RUN"**, so this lane is a runbook, not a fact |
| R2 bucket `audiobook-covers` | **cover images only** — 1,850 objects / ~250 MB (2026-08-10) plus an `ebooks/<sha256>.<ext>` prefix, 83 objects / 71.9 MB (first backfill 2026-08-17) | `audiobook_catalog/docs/info/covers-r2.md` |

> ⚠️ **So the design owes an ingest phase.** The framing assumed the bytes were
> already in R2. They are not. Nothing but covers has ever been uploaded.

⚠️ **And the covers bucket is the wrong home for them.** It has its **public
r2.dev dev URL enabled** (`pub-7ab0…r2.dev`) precisely so `<img>` tags can hit
it with no credential. Putting DRM-stripped book files in a bucket whose whole
posture is "anonymous GET works" is one config line away from being the public
download endpoint this design exists to prevent. **New bucket, no dev URL, no
custom domain, reachable only through a Worker binding.**

### 1.3 The auth surfaces that already exist

| Thing | State | Measured from |
|---|---|---|
| **`audiobook-api.heygabi.ai`** — the audiobook Worker | **DEPLOYED** 2026-08-16. `ENVIRONMENT=production`, `FIREBASE_PROJECT_ID=audiobook-catalog` pinned as iss+aud, `ESTATE_AUTH_URL=https://auth.heygabi.ai`, **`ESTATE_CHECK="shadow"`** | `catalog-platform/apps/audiobook-worker/wrangler.toml` |
| **The `download` capability** | **already committed**, floor `member`, with the comment *"`download`/`upload` are Phase 4 surfaces — the floors are committed now so /api/me can already answer what the UI should render"* | `apps/audiobook-worker/src/capabilities.ts:58` |
| **Phase 4 of the audiobook auth migration** | *"`GET /api/download/:bookId` — capability `download` (member+): answers a short-lived signed/proxied URL … a **gated READ behind the worker**"* | `catalog-platform/docs/info/audiobook-auth-migration.md` §5 Phase 4 |
| The ladder | `guest < member < contributor < moderator < admin < owner`, stored in Firestore `site_roles/{uid}`, **written server-side only**; browsers may `get` their own doc, never list, never write | `auth-worker/src/role-ladder.ts`, `firestore.rules` |
| `ESTATE_CHECK` enforce arm | **built and dormant** — `enforce-gate.ts` answers `503 not_enabled` in `off`/`shadow`; the flip is an owner act, never a deploy side effect | `apps/audiobook-worker/src/enforce-routes.ts` |
| ⚠️ **CORS on the Worker** | `SITE_ORIGINS = "https://audiobooks.heygabi.ai"` — **`https://ebooks.heygabi.ai` is NOT on it** | same `wrangler.toml` |
| `ebooks.heygabi.ai` | `ebooks-door`, a ~30-line pass-through Worker: `/` → the **prod** audiobook Pages `/ebooks.html`, every other path proxied verbatim, headers and body untouched | `apps/ebooks-door/src/index.ts` |
| The audiobook Pages origin | **serves no `Content-Security-Policy` at all** (`grep -c` on `site/_headers` → 0). Its `_headers` is about caching. The apex, by contrast, ships a strict `default-src 'none'` CSP per route | `audiobook_catalog/site/_headers`, `heygabi-home/public/_headers` |
| Identity on the ebooks page | `identity.js` **v2 keeps a LIVE Firebase session** (`onAuthStateChanged`, `getIdToken()`, *"The session stays live — no signOut"*). The ebooks page mounts only `account-modal.js`, which exposes no token getter today | `site/identity.js`, `app/web/templates/ebooks.html` |

### 1.4 The ebooks page as it stands

Its own header comment states the seam this design fills, verbatim:

> *"DISPLAY-ONLY, by design (ebook-split design doc, phase 1): this page renders
> `site/ebooks.json` … and **offers no downloads. File access belongs to the
> auth migration's file-permissions phase, not here.**"*

Also true and load-bearing:

- **Every book has an anchor**: the tile's element id is the manifest's own
  `anchor` = `"b-" + sha256(rel_path)[:12]`, computed in **exactly one place**
  (`build_ebook_manifest.ebook_anchor`), consumed by both the page and
  `app/index_push.py`'s `detail_url` (`https://ebooks.heygabi.ai/#<anchor>`).
  ⚠️ **A second copy of that fold in JavaScript is forbidden** — it would break
  every deep link silently.
- ⚠️ **The anchor is derived from the FILE PATH.** Rename or re-file a book and
  its anchor changes. That is fine for a scroll target and **fatal for a stored
  reading position** — §7 keys on something else because of this.
- **PDFs are hidden by default** behind a "Show PDFs" checkbox (`eb:showPdfs`
  in localStorage), because they are handbooks and household documents rather
  than books. A deep link to a PDF turns the checkbox on rather than dying.
- Tapping a tile opens a **reading card** dialog showing cover, title, author,
  format and size — the natural place a "Read" button lands.

### 1.5 The per-person store precedents

| Store | Doc id | Key |
|---|---|---|
| `reviews` | `` `${bookId}_${displayNameLower}` `` | `bookIdFromTitle(title)` |
| `readingLists` (TBR) | `` `${displayNameLower}_${bookId}` `` — ⚠️ **REVERSED**, and neither may be harmonised | same |
| `profiles/{userId}` | per person | |
| `clubs/*/reads/*/progress/{userId}` | **club-scoped** reading progress — a precedent, not a home for general position | `firestore.rules:646` |

`workKey` = `normaliseTitle(cleanTitle)|normaliseTitle(author)` is the key that
**spans catalogs**; `bookIdFromTitle` is title-only and cannot tell two books
called "Gold" apart. Both are one-implementation-only: changing either is a
migration, not an edit.

---

## 2. Q1 — Where the files live and how they stream

**Recommendation: a new private R2 bucket, fed by a new pipeline step, streamed
byte-for-byte through the audiobook Worker with `Range` honoured and no public
URL anywhere in the system.**

### 2.1 The bucket

| | |
|---|---|
| Name | **`estate-ebooks`** (sibling of `audiobook-covers`, `estate-backups`, `library-covers`) |
| Dev URL | **never enabled.** Custom domain: **never attached.** |
| Reachability | a Worker binding **only** (`[[r2_buckets]] binding = "EBOOKS"`) |
| Object key | the manifest's `path`, verbatim — `Brandon Sanderson/Defiant.pdf`. **No prefix**, exactly the no-`covers/`-prefix choice the covers bucket made and was glad of |
| Record of truth | a committed `site/ebook_files_manifest.json` (`{key: {size, sha256, uploaded_at}}`), mirroring `covers_manifest.json`'s job |

**Why key on `path` rather than on `anchor`:** the anchor is a hash *of* the
path, so it adds no uniqueness; and a human debugging a missing book in the
Cloudflare dashboard needs to see `Brandon Sanderson/Defiant.pdf`, not
`b-a49cd096d824`. The Worker maps `anchor → path` by reading `ebooks.json`,
which it must load anyway to authorise (§3.4).

⚠️ **Measured: the wrangler key-encoding landmine does not fire here.** The
covers work lost 9 objects to `#` truncating keys and `%` crashing the
uploader. **Zero of the 168 ebook paths contain `#`, `%` or `?`.** They contain
9 apostrophes, 2 ampersands and 1 non-ASCII character (`Brené Brown/`) — all
three documented as safe literally. Carry `wrangler_key()`'s pre-encoding
anyway; do not rely on today's filenames staying tame.

### 2.2 The ingest step, and its arithmetic

Model it on `scripts/upload_covers_r2.py` verbatim — it has already paid for
every lesson:

- **Idempotent**, diffing local sha256 against the committed manifest.
- **Never deletes** (prod may still be serving what main dropped).
- **Checkpoints every N objects** — ⚠️ *a 10-minute task cap killed the covers
  backfill at 1,425/1,827 before checkpointing existed*, and this payload is
  **7× larger by bytes**.
- **Uploads before the auto-commit**, so a published manifest can never
  reference an object that is not in the bucket. Slot it as **step 5.8**,
  directly after covers' 5.7, for exactly that ordering guarantee.
- **wrangler prints success and exits non-zero on Windows** — read the output,
  not the exit code.

**Cost arithmetic:**

| | |
|---|---|
| Payload | **1.805 GB**, 168 objects |
| Bucket after ingest | ~1.805 GB + ~322 MB covers ≈ **2.13 GB** against R2's documented **10 GB-month free tier** |
| R2 egress | **$0** — the whole reason R2 and not S3 |
| Class A (writes) | 168 per full backfill; a handful per incremental run, against 1M/month |
| Class B (reads) | ⚠️ **the one number that could bite.** A pdf.js range session is many small GETs — see §5.3 |
| Backfill wall time | **not the ~3 objects/sec Node-startup floor the covers backfill hit** — at 10.7 MB mean these are bandwidth-bound, not process-bound. 1.805 GB over the household uplink; ⚠️ **the uplink was not measured** (§10) |
| Ongoing | trivial — the pipeline adds a handful of files a week |

### 2.3 The stream

```
GET https://audiobook-api.heygabi.ai/api/ebook/b-a49cd096d824/file
Authorization: Bearer <Firebase ID token>
Range: bytes=20447232-20971519          # pdf.js asks; epub.js does not
```

The handler, in order: verify token (canonical verifier) → estate `/seen`
(cached, TTL 10 min) → ladder role from `site_roles/{uid}` → `can(role,
'download')` → resolve `anchor → path` → `env.EBOOKS.get(path, { range })` →
**return `object.body` as the response body, streamed**.

⚠️ **Never `await object.arrayBuffer()`.** Three files exceed the Workers
128 MiB isolate memory limit outright and the 393 MiB EPUB exceeds it 3×;
buffering is an OOM on the exact books the household is proudest of.
`R2ObjectBody.body` is a `ReadableStream` and costs no memory to pass through.

Response headers the handler must set, and why:

| Header | Value | Why |
|---|---|---|
| `Accept-Ranges` | `bytes` | pdf.js probes for this before enabling range mode; without it, it falls back to a full download of a 181 MiB file |
| `Content-Range` / `206` | from `object.range` | the range contract |
| `Content-Length` | `object.size` (or range length) | pdf.js needs the total to lay out the page count |
| `Content-Type` | `application/epub+zip` / `application/pdf` | |
| `Content-Disposition` | **`inline`**, never `attachment` | this is a viewer, not a download button (§6) |
| **`Cache-Control`** | **`private, max-age=0, no-store`** | ⚠️ see below |
| `Vary` | `Authorization` | belt and braces if the above is ever loosened |

⚠️ **Cache posture is the sharpest edge in this section.** Cloudflare's edge
cache is keyed on URL and **does not know about your `Authorization` header**.
An authenticated response left cacheable is a public download endpoint with
extra steps — the exact outcome this design exists to prevent, arriving as a
performance optimisation. So: **`no-store` on the byte stream, unconditionally,
and never a `cf: { cacheEverything }` option on the R2 fetch.** The cost is
re-fetching from R2 on every read; R2 egress to Workers is free and the
latency is single-digit milliseconds within Cloudflare's network. Pay it.

Two things *are* safely cacheable and should be: `ebooks.json` (already public)
and the covers (already public, already `max-age=604800`).

### 2.4 Rejected alternatives

| Option | Cost | Verdict |
|---|---|---|
| **Public R2 dev URL** (`pub-*.r2.dev/<path>`) — what the covers do | Zero build. Also zero gate: the shared pool becomes a world-readable warehouse of DRM-stripped files, findable by anyone who reads one URL and guesses another. `SHELF_SERVER.md` §0 already says out loud that the Access gate on the shelf is *"load-bearing, not cosmetic. These are DRM-stripped"* | **Rejected on principle.** Not a trade-off; a refusal |
| **Cloudflare Pages assets** (ship files in `site/`) | 10 files exceed the documented 25 MiB per-file cap outright; the 1.8 GB payload would ride every three-times-a-day deploy — the exact problem `covers-r2.md` §1 moved 243 MB out of git to solve; and Pages assets are public by construction | Rejected twice over |
| **Serve from the shelf server** (Audiobookshelf has its own EPUB reader) | The files are already there and ABS renders EPUB natively. But: the shelf is behind **Cloudflare Access with its own email allowlist**, a *second, disjoint* directory from the estate ladder — one more roster to keep in step, and the estate's whole auth design exists to stop that. It also lives on hardware whose runbook says **"NOT YET RUN"**, and it would put the reader on `shelf.heygabi.ai`, not on the pool's own front door | **Rejected as the primary**, kept as a genuine complement: ABS is the *phone-app* story, this is the *browser* story. If the owner would rather have one reader than two, that is a real option and it is listed in §11 |
| **Google Drive direct links** | Drive's own auth, a second identity system, link-sharing semantics nobody controls, and the pipe is the owner's permanent freight lane — not a delivery surface | Rejected |
| **Keep bytes on the origin, stream through the Pages Function / door worker** | `ebooks-door` proxies to Pages, and Pages has no private storage. There is nothing to stream from | Not available |

---

## 3. Q2 — Auth-gating the streams *(the real work)*

### 3.1 Who may read — and one correction to the brief's framing

**Recommendation: estate `approved` (not `revoked`) **AND** audiobook ladder
role ≥ `member`, i.e. the already-committed `download` capability. Both checks,
server-side, on every request.**

⚠️ **It must NOT be §4.5 visibility.** The brief asked whether this rides "the
same §4.5 scoping". It cannot, and the reason is structural: `vis_audiobook`
is the estate's **public slice** — the anonymous rule grants `{audiobook}` to
callers with no token at all, and `pending` members get it too. Gating book
files on a flag whose default population includes *the anonymous internet* is
gating on nothing. §4.5 governs **what appears in estate search**; the ladder
governs **what you may do at a shelf**. The estate's own sentence settles it:
*"the estate answers in/out; the apps answer what/here."* File bytes are a
what/here question.

The combination, concretely:

| Estate says | Ladder says | Result |
|---|---|---|
| `revoked` | anything | **403**, always |
| `approved` | `guest` (or no `site_roles` doc) | **403**, with the §1e sentence: what happened, what it needs, how to get it |
| `approved` | `member`+ | **stream** |
| `pending` | anything | 403 — a pending person sees the shelf, not the books |
| unreachable, cached `approved` | `member`+ | stream (availability for the household, §6 row 1 of the estate design) |
| unreachable, no cache | anything | **403 `estate_unreachable`** — a named outage, never a bare denial |

⚠️ **This route must sit behind `requireEnforceMode` like every other
capability route on that Worker** — `ESTATE_CHECK` is `"shadow"` today, so the
route answers `503 not_enabled` until the owner's explicit flip. That is a
feature: the reader can be built, deployed and reviewed while the door is still
formally shut.

### 3.2 Token flow, end to end

```
ebooks.heygabi.ai/read/#b-a49cd096d824        (Pages page, via ebooks-door)
  │
  ├─ identity.js v2  →  live Firebase session  →  user.getIdToken()
  │                     (auto-refreshes; 1 h RS256 token)
  │
  └─ fetch('https://audiobook-api.heygabi.ai/api/ebook/<anchor>/file',
           { headers: { Authorization: 'Bearer ' + token, Range: … } })
        │
        └─ audiobook-worker
             ├─ canonical verifier (JWKS, iss+aud pinned, email_verified)
             ├─ estate /seen  (per-app bearer, TTL-10 min cache)
             ├─ site_roles/{uid}  →  ladder role
             ├─ can(role, 'download')
             └─ env.EBOOKS.get(path, {range})  →  streamed 206
```

**Two mechanical gaps this opens, both measured, both one line:**

1. ⚠️ **`SITE_ORIGINS` must gain `https://ebooks.heygabi.ai`.** Today it is
   `"https://audiobooks.heygabi.ai"` alone, so `abCors()` rejects the reader's
   preflight and the fetch fails **as a network error, indistinguishable from a
   dead host** — the exact failure the estate already ate once when the apex's
   CSP silently blocked `padhard.heygabi.ai` and every row read *"unreachable"*.
2. ⚠️ **The reader page needs a token getter that `account-modal.js` does not
   expose.** `identity.js` has `getIdToken()` internally; the page mounts only
   the account modal. Exporting a `getIdToken()` from the identity module is a
   small, additive change **in the audiobook repo**, which means it ships
   through that repo's pipeline and its own promote lane — plan for the
   two-repo hop rather than discovering it at build time.
3. **Federating a new origin is two edits and the second is easy to miss** —
   the other side's CORS *and* this side's CSP. The audiobook Pages origin
   serves no CSP today (measured), so nothing blocks the fetch right now; but
   §4.4 recommends *adding* one for the reader route, and the moment it exists
   it must name `connect-src https://audiobook-api.heygabi.ai`.

### 3.3 Bearer-per-request vs signed URLs — **the decision**

**Recommendation: a bearer token in an `Authorization` header on every request,
including every range. No credential ever appears in a URL.**

The argument is the leak model, and it is decisive:

> **A signed URL *is* the credential.** It survives in browser history, in the
> referrer header, in a screenshot, in "hey look at this link", in a devtools
> copy-as-cURL, and in any log that records request lines. A bearer header
> survives in none of those. **Copying the URL out of a working reader session
> yields a 401.**

The counter-argument for signed URLs is real and worth naming: they let the
byte stream bypass the Worker entirely (R2 presign → direct to R2), which is
faster and cheaper. It is rejected because:

- **Revocation becomes impossible mid-session.** A presigned URL is valid for
  its TTL no matter what the estate directory says. The estate's whole
  revocation design — 10-minute TTL, "revoked ⇒ 403, always" — evaporates for
  exactly the surface where it matters most.
- **The TTL cannot be short.** A reading session is 20 minutes to 2 hours; a
  60-second URL breaks pdf.js's range fetches mid-book. So the TTL has to be
  session-length, which is precisely the leak window.
- The performance win is small here: R2→Worker egress inside Cloudflare is free
  and fast, and the household is ~10 people, not 10,000.

**The middle option, named so it is not re-proposed as new:** a short-lived
**read lease** — the Worker mints `HMAC(anchor + email + exp)`, ~15 minutes,
scoped to one book, refreshable. Worth building **only** if a consumer turns up
that genuinely cannot set headers (a native `<embed src>` PDF viewer; a
download to the OS reader). Neither pdf.js nor epub.js is such a consumer:
pdf.js takes `httpHeaders` on `getDocument()`, and the EPUB path fetches the
archive with our own `fetch()`. **Header-only, and revisit only on a measured
need.**

### 3.4 Authorisation input: where the Worker learns `anchor → path`

The Worker must not trust an `anchor` from the client to name a bucket key —
that is a path-traversal question wearing a hash. It resolves the mapping from
a **server-side copy of the manifest**, and the options are:

| Option | Verdict |
|---|---|
| `fetch('https://audiobooks.heygabi.ai/ebooks.json')`, cached per isolate | ✅ **Recommended.** One subrequest, the manifest is already public, and it is the same file the page renders — impossible for the two to disagree |
| A `[[kv_namespaces]]` copy pushed by the pipeline | More moving parts, another writer, another thing to go stale |
| Hard-coded in the Worker | A deploy per new book. No |

**Whatever the source, the mapping is a lookup, never a construction.** An
`anchor` that is not in the manifest is a 404, and no client-supplied string
ever reaches `env.EBOOKS.get()`.

### 3.5 Rate limiting and the abuse case

The honest threat is not a stranger — it is **a member scripting all 168
GETs**. That is not a security breach (they are entitled to the bytes) but it
is a bandwidth and Class-B-ops event. Port the games repo's `rate-limit.ts`,
which `PLATFORM.md` §4.1 already requires estate-wide, at a limit generous for
a reader (a page turn is a few range GETs) and stingy for a scraper (e.g. one
distinct book opened per N seconds, ranges uncapped within a book).

---

## 4. Q3 — EPUB rendering

### 4.1 ⚠️ The framing's inversion, stated plainly

**An EPUB is a ZIP archive.** To render one you need the central directory,
which lives at the *end* of the file, then per-entry inflation. Neither
**epub.js** nor **foliate-js** does HTTP range fetching by default — both take
a URL or an `ArrayBuffer` and pull the **whole archive** before rendering a
word. Range requests, the thing the first take leaned on, **do not help EPUB**
in any off-the-shelf configuration. They help PDF, natively and enormously
(§5).

The consequence, against §1.1's distribution:

- **135 of 138 EPUBs are ≤ 20 MiB** — a whole-file fetch is completely fine,
  and on the median 3.1 MiB book it is imperceptible.
- **3 EPUBs (393, 143, 27.7 MiB) are not fine**, and the two worst are far
  worse than any PDF's problem, because a PDF that big streams and an EPUB that
  big does not. A 393 MiB ZIP inflated in JavaScript on a phone is a tab crash.

**Recommendation: whole-file fetch with an explicit size gate.** Below the gate
(propose **32 MiB**, covering 135 of 138), open in the reader. Above it, the
reading card says so honestly — *"This book is 393 MB; it is too large to open
in the browser reader"* — and offers the alternatives that exist (the shelf
server, or a gated download if §6 grants one). ⚠️ **Never a spinner that never
ends.** A size gate is a product decision made visible; an OOM is the same
decision made by accident.

*The way out, if the owner wants those three books in the reader:* a
zip-over-HTTP loader (zip.js `HttpRangeReader`, or foliate-js's pluggable
loader interface) fetching only the entries a chapter needs. It is a real
technique and it is **phase-3-or-later work**, not MVP.

### 4.2 The library — recommendation and alternatives

| Option | Assessment |
|---|---|
| **epub.js** | The default answer: mature, huge install base, `EpubCFI` gives a precise, stable position string (§7), pagination/spread/theming built in. Costs: it is a large-ish bundle, its rendering runs inside an **iframe** it manages, and its maintenance has been intermittent |
| **foliate-js** | The reader behind the Foliate desktop app — modern ES modules, cleaner code, notably better typography and RTL/vertical support, pluggable loaders (the §4.1 escape hatch). Costs: smaller community, less written-down, and its position model differs from CFI so §7's stored shape must be chosen with it in mind |
| **Custom minimal** (unzip + inject XHTML) | Tempting for a weekend and wrong for a decade: pagination, CFI, CSS containment, footnotes, images, and the OPF spine's edge cases are exactly the parts that look easy and are not. **Rejected** |

**Recommendation: epub.js for the MVP**, on the same reasoning the estate uses
everywhere else — take the well-trodden thing, and prefer the one whose
position primitive (CFI) is a documented, portable string. **Revisit foliate-js
if typography quality becomes the complaint**, and record the swap cost
honestly: the renderer is replaceable, but **a stored CFI is a persisted key**,
so migrating positions later is a migration, not an edit (§7 designs around
this).

### 4.3 Where it mounts

**Recommendation: `ebooks.heygabi.ai/read/` — a new template
`app/web/templates/read.html` in the audiobook repo, copied verbatim to
`site/read.html` by `app/writers.py` (the same convention `ebooks.html` and
`guess-game.html` already use), reached through the existing `ebooks-door`
proxy with no change to that Worker at all.**

Why: it keeps the ebook-split's decision intact — *no fourth deployable* — and
it puts the reader same-origin with `ebooks.json`, `fb-env.js`, `identity.js`
and `account-modal.js`, so sign-in, theme and the account chip all work with
zero new plumbing. The door already proxies every non-`/` path verbatim, so
`/read/` arrives for free the moment the page exists on prod.

⚠️ **Edit the TEMPLATE.** `site/*.html` is generated; a change made there is
wiped by the next catalog build (project memory:
`site-index-is-generated-from-template`).

Rejected: **mounting the reader in `library_catalog`'s React app.** The library
is the *per-person shelves* catalog; ebooks are *shared pool*. The ebook-split
design settled that ownership boundary deliberately and this would re-cross it,
adding an auth origin and a bundle for a surface whose data lives elsewhere.

### 4.4 CSP fit

The audiobook origin ships **no CSP today**, so nothing blocks anything —
which is itself the finding: the reader is the first page on that origin that
*wants* one, because it handles a large binary from a credentialed endpoint.

Recommended `_headers` block for `/read` and `/read/` (⚠️ **both forms** — the
trailing-slash 308 trap the apex `_headers` already documents):

```
default-src 'none';
script-src 'self' https://www.gstatic.com https://apis.google.com;
connect-src https://audiobook-api.heygabi.ai
            https://identitytoolkit.googleapis.com
            https://securetoken.googleapis.com;
img-src 'self' data: blob: https://pub-7ab0…r2.dev;
style-src 'self' 'unsafe-inline';
font-src 'self' data:;
frame-src 'self' blob:;          /* epub.js renders into an iframe */
child-src 'self' blob:;
worker-src 'self' blob:;         /* pdf.js's worker thread */
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

Three notes that will cost time if skipped:

- **`'self'`, not a CDN.** The estate's script posture is `'self'` plus gstatic
  for the Firebase SDK. **epub.js, JSZip and pdf.js must be vendored** into
  `site/static/js/` and committed, like `theme.js` already is. That also means
  a **pinned version with a header comment** saying which, per the estate's
  vendoring discipline.
- **`blob:` is required in `img-src` and `frame-src`** because both readers
  materialise extracted resources as blob URLs. Omitting it produces a reader
  that loads, paginates, and shows no images — a failure that looks like a data
  problem.
- **`'unsafe-eval'`**: pdf.js may want it for font handling; it can be avoided
  by setting `isEvalSupported: false` on `getDocument()`. ⚠️ **Prefer turning
  the flag off over widening the CSP.**

### 4.5 Offline / PWA

**Recommendation: not in scope, and say so out loud.** A service worker that
caches book bytes would be a genuinely nice feature and it is also a **local,
persistent copy of gated content on a device**, which changes the leak model
(§3.3) from "no URL works twice" to "the file is on the disk". If the owner
wants offline reading, that is a deliberate decision to make, not a side effect
of adding a manifest — and the honest version of it is probably *"use the
Audiobookshelf app"*, which already does offline properly, behind its own gate.
Listed in §11.

---

## 5. Q4 — PDF rendering

### 5.1 pdf.js, self-hosted

**Recommendation: Mozilla's pdf.js, vendored, version-pinned, with its worker
file self-hosted alongside.** There is no serious alternative: it is the
renderer in Firefox, it is the renderer most "PDF viewer" products wrap, and it
is the only one whose streaming model matches this design.

Configuration that matters:

```js
pdfjsLib.getDocument({
  url: `${API}/api/ebook/${anchor}/file`,
  httpHeaders: { Authorization: `Bearer ${await getIdToken()}` },
  withCredentials: false,
  disableRange:  false,   // the whole point
  disableStream: false,
  disableAutoFetch: true, // ⚠️ see §5.3 — do NOT let it prefetch the whole file
  isEvalSupported: false, // keeps the CSP tight (§4.4)
  cMapUrl: '/static/pdfjs/cmaps/',  cMapPacked: true,   // CJK — Goblin Slayer
  standardFontDataUrl: '/static/pdfjs/standard_fonts/',
});
```

⚠️ **`httpHeaders` is what makes bearer-per-range work**, and it is the single
reason §3.3's "no credential in a URL" rule is affordable rather than
aspirational. If a future pdf.js drops it, the read-lease fallback in §3.3
becomes necessary.

### 5.2 Memory reality on the big ones

The 181 MiB Stormlight Handbook is the test case, and it is genuinely fine —
**as long as nothing defeats the streaming**:

- pdf.js fetches the trailer, then the cross-reference table, then **only the
  objects the visible pages need**. Opening page 1 of a 181 MiB book transfers
  a few hundred KB, not 181 MB.
- Memory is per **rendered page canvas**, not per file. A rendered A4 page at
  2× device pixel ratio is ~15–25 MB of canvas. So the cap is **how many pages
  are simultaneously rendered**, not how big the file is.
- **Therefore: never `PDFViewer` in full-document mode with 400 pages
  attached.** Use a windowed/virtualised page list (pdf.js's own `PDFViewer`
  does this when driven properly) that keeps ~3 canvases live and destroys the
  rest. That is the whole of "memory realities for 100 MB+ RPG PDFs".
- ⚠️ Big RPG PDFs are **image-heavy**, which means one *page* can decode to a
  large bitmap even when the file streams beautifully. Cap the render scale on
  small screens rather than trusting the device.

### 5.3 The Class-B ops caveat

`disableAutoFetch: true` is not a micro-optimisation. Left on (the default),
pdf.js **background-fetches the rest of the document** after the first page —
which turns "open the handbook to check one table" into a 181 MB transfer and
several hundred range GETs. With it off, page-at-a-time is genuinely
page-at-a-time. Against R2's documented 10M/month Class B free allowance a
household will never come close either way; the reason to set it is the
**phone's data plan**, not the bill.

---

## 6. Q5 — "Preview" vs "read"

The owner's word was *"either preview or a read"*, and it can mean two quite
different products. Both are presented; one is recommended; the choice is his.

### Option A — Preview = ungated first N (a shopfront)

The first ~10% or first chapter streams to **anyone**, signed in or not; the
rest needs `member`. This is what a bookshop does.

- ✅ Someone who lands on the shelf can tell what a book *is* — which is real
  value for the 30 filename-sourced PDFs whose titles say almost nothing.
- ❌ **It requires the Worker to serve gated-corpus bytes to anonymous
  callers**, which means a second, weaker code path through the one door this
  design spent §3 hardening, plus per-format logic to compute "the first
  chapter" (trivial-ish for PDF pages; genuinely fiddly for EPUB spine order).
- ❌ ⚠️ **And it is a fiction for EPUB**, because the whole archive must be
  fetched to render any of it (§4.1). "First chapter only" would mean shipping
  the entire book and *displaying* one chapter — a paywall implemented in the
  client, which is not a boundary at all.

### Option B — Preview = what the shelf already shows; "read" = members-only *(recommended)*

**"Preview" is the reading card that exists today** — cover, title, author,
format, size — plus, at most, the **cover at full size** and (a cheap, genuine
win) **a first-page thumbnail for PDFs**, rendered *once by the pipeline* and
stored in R2 as another public cover-class image. **"Read" opens the reader and
requires `member`.**

- ✅ One gate, one code path, no anonymous access to corpus bytes ever.
- ✅ The PDF first-page render solves the actual problem Option A was reaching
  for — *"what even is this file"* — at build time, publicly, with no gate
  involvement, and it composes with the owner's existing *"PDFs get web-sourced
  cover art"* item in `TODO.md`.
- ❌ A visitor with no account cannot sample a book. Given the estate's
  membership model — a household plus approved guests, not the public — that
  is a feature.

⚠️ **One thing to be honest about under either option: "read online" and
"download" are not a security boundary.** A person who can stream every range
can concatenate them. Any distinction between them is an **honest product
distinction** (convenience, intent, what the UI encourages) and must never be
described in a doc or a UI as protection. That said, the estate's ladder
already draws the line where it wants it — `download: member` — so the simplest
correct answer is **one capability for both**, with the download button as a
separate affordance the owner can hide or show without changing the gate.

**Recommendation: Option B, with `download` as the single capability, and the
PDF first-page thumbnail built as part of it.**

---

## 7. Q6 — Reading position sync

### 7.1 The key — and the trap the anchor sets

⚠️ **Do not key a stored position on the `anchor`.** It is
`sha256(relative_path)[:12]`, so **renaming or re-filing a book silently
orphans every position on it**, with no error anywhere — the same silent-drift
failure the anchor's own docstring warns about for deep links, except that a
dead deep link is a page that does not scroll, while a dead position is a
person's place in a book, gone.

**Recommendation: key on the estate's existing identity pair, exactly as TBR
does** — `bookId = bookIdFromTitle(title)` as the id component, with
`workKey = normaliseTitle(title)|normaliseTitle(author)` carried as a field so
the position can join the library catalog and the audiobook catalog later
without a migration. Both are ported implementations that **must not be
re-derived** in the reader page; `bookIdFromTitle` in particular keeps the
leading article where `normaliseTitle` strips it, and using the wrong one
writes a second document beside a real one.

Store the `anchor` too, as a **hint, never a key** — it makes "open this
position" a one-hop lookup while the file keeps its path.

### 7.2 The store — and the one place this estate can finally use `uid`

**Recommendation: a NEW Firestore collection `readingPositions` (+
`readingPositions_dev`, via the same `col()` suffix machinery), doc id
`` `${uid}_${bookId}` ``, with genuine per-user rules.**

⚠️ **This is deliberately different from every other shared-store collection,
and the reason is structural rather than aesthetic.** `reviews`, `readingLists`
and `profiles` are keyed on **lowercased display name** and governed by
shape-only rules, because they must keep working for **legacy v1 sessions that
have no uid at all** — a recorded owner decision that `PLATFORM.md` §4a and
`firestore.rules`' own header both say must not be "fixed". **The reader has no
such population.** Its readership is, by construction, people who presented a
verified Firebase ID token to get the bytes. So it is the first per-person
collection in this estate that **can** be keyed on `uid` and locked to its
owner — and taking that opportunity costs one small, additive rules block:

```
match /readingPositions/{docId} {
  allow read, write: if request.auth != null
                     && docId.split('_')[0] == request.auth.uid;
}
```

The estate already holds standing permission for `firebase deploy --only
firestore:rules` from main (project memory `firebase-rules-deploy-allowed`),
with a smoke test after — so this is a small, sanctioned, additive deploy that
touches no existing collection's posture.

**Rejected alternatives:**

| Option | Why not |
|---|---|
| **Extra fields on the `readingLists` doc** | ⚠️ Fatal by design: `tbr.md` §5 **deletes** the entry when the work is marked read, and again on "Off the list" — so finishing a book would erase where you were in it. And a TBR entry only exists for books you *intended* to read; you can read a book that was never on the list |
| **`profiles/{userId}.currentlyReading…`** | Holds *one* current book as presentation state, not a per-book position for a shelf of 168 |
| **A D1 table in `library_catalog`** | ⚠️ Cannot span. Same reasoning `tbr.md` §4.1 used and settled: a per-person fact that two catalogs must see lives in the one store both can reach |
| **The club `progress` subcollection** | Club-scoped and read-scoped by design. A genuine future *join* (finishing a club read could update it), never the home |
| **localStorage only** | The ask was explicitly cross-device |

### 7.3 Document shape

```jsonc
{
  "uid": "…", "displayName": "Skylar",
  "bookId": "the-way-of-kings", "workKey": "way of kings|brandon sanderson",
  "anchor": "b-a49cd096d824",          // hint, never the key (§7.1)
  "format": "epub",
  "pos":   { "kind": "cfi",  "value": "epubcfi(/6/14[c07]!/4/2/2/2[p3]/1:0)" },
  // or:   { "kind": "page", "value": 137, "scroll": 0.42 }
  "progress": 0.31,                     // 0–1, for a progress bar and nothing else
  "updatedAt": "2026-08-17T…Z",
  "device": "iPhone · Safari"           // for the §7.4 prompt's wording
}
```

⚠️ **`pos.kind` travels *with* `pos.value`, atomically, in one document.** A
CFI interpreted as a page number is a silent jump to the wrong place; the pair
must never be able to disagree. (Same discipline as the estate's
`*_how` provenance columns.)

⚠️ **A CFI is a persisted key produced by a specific renderer.** Swapping
epub.js for foliate-js later is therefore **a migration, not an edit** — say so
in the reader's header comment so a future session does not treat the library
as a drop-in.

### 7.4 Conflict resolution

**Last write wins on `updatedAt` — never furthest-progress-wins.** A person
re-reading, or one who flipped to the appendix, would have their real place
overwritten by a stale high-water mark.

But **never silently jump either**: when the remote position is ahead of the
local one on open, show *"You were on page 137 on iPhone — jump there?"* with
Jump / Stay. Cross-device sync that moves you without asking is the single most
common complaint about every reader that has ever shipped one.

Write cadence: **debounced, ~10 s of idle plus on page-hide/`visibilitychange`
plus on close.** A write per page turn is a write per few seconds of reading,
for no benefit.

---

## 8. Q7 — Phasing

**Ordering constraints, stated once:** the bucket and the ingest step precede
everything (nothing to stream otherwise); the gated stream precedes both
renderers; position sync is genuinely independent and can land beside or after
either renderer.

### Which renderer first — **PDF, and here is the argument**

| For PDF first | For EPUB first |
|---|---|
| ⚠️ **pdf.js range-streams its own 181 MiB outlier by design. epub.js cannot stream at all** (§4.1) — so EPUB-first must *also* ship a size gate, an honest-refusal UI for 3 books, and a decision about the 393 MiB omnibus. PDF-first ships a renderer that handles its whole corpus | EPUBs are **138 of 168**, and are the actual *books*. "Read a book on the site" means EPUB to most people |
| **30 files / 0.598 GiB** — a third of the corpus by bytes; a smaller, faster first ingest | The PDFs are **hidden behind a default-off checkbox**, so a PDF-only reader could read as shipping a viewer for the format nobody sees |
| PDFs are the format with the **worst status quo**: no covers, filename-only metadata, hidden. A viewer adds the most information per unit of work — and pairs with the owner's existing "PDF covers from content" item | epub.js is very well trodden; the risk is low |
| It exercises the whole gated pipe **on the format where `Range` genuinely matters**, so phase 2 inherits a proven door | |

**Recommendation: PDF first.** The deciding row is the first one — PDF-first
delivers a *complete* renderer for its whole format on day one, where
EPUB-first ships a renderer that must refuse three books, including the two
largest and most conspicuous in the library.

⚠️ **And the cost of being wrong is near zero**: phase 1's gate, bucket,
ingest, token flow, CORS and CSP are entirely format-agnostic. **Flipping the
order changes only which vendored library and which reader page phase 1
builds.** If the owner would rather see EPUB first, say so and it costs nothing
but the size-gate work moving earlier.

### The phases

| # | Phase | Ships | Verify | Does **NOT** do | Est. agent size |
|---|---|---|---|---|---|
| **0** | **Bucket + ingest** — create `estate-ebooks` (no dev URL, no domain); `scripts/upload_ebooks_r2.py` modelled line-for-line on `upload_covers_r2.py`; committed `site/ebook_files_manifest.json`; wire as pipeline **step 5.8**, after covers' 5.7 and before the auto-commit | one repo (`audiobook_catalog`, Python) | manifest count == 168; a `wrangler r2 object get` of the 393 MiB file succeeds; **no anonymous URL exists** (there is no dev URL to try) | No Worker, no page, nothing user-visible. Nothing is readable by a browser at the end of this phase — deliberately | **~150–200k** |
| **1a** | **The gated stream** — `GET /api/ebook/:anchor/file` on `audiobook-worker`, behind `requireEnforceMode`; `[[r2_buckets]] EBOOKS` binding; manifest lookup for `anchor → path`; `Range` + `206` + `no-store`; `SITE_ORIGINS` gains `https://ebooks.heygabi.ai`; rate limit | one repo (`catalog-platform`) | tokenless → 401; `guest` → 403 with the §1e sentence; `member` → 206 with correct `Content-Range`; **copied URL → 401**; revoked user → 403 within TTL; **`curl -I` shows `Cache-Control: no-store`** | No reader page. No EPUB. `ESTATE_CHECK` stays `shadow`, so the route answers `503 not_enabled` until the owner flips it | **~150k** |
| **1b** | **The PDF reader** — `app/web/templates/read.html`, vendored pinned pdf.js + worker + cMaps, windowed page rendering, `httpHeaders` bearer, `disableAutoFetch`; a **Read** button on the ebooks card for `format === 'pdf'` when `/api/me` reports the `download` capability; the `_headers` CSP block for `/read` **and** `/read/`; `identity.js` gains an exported `getIdToken()` | one repo (`audiobook_catalog`) + one exported function | dev lane `/dev/read.html` opens the 181 MiB handbook to page 1 in < 3 s having transferred < 2 MB (devtools network); a `guest` sees **no Read button**, and gets the sentence if they hit the URL; three canvases live at any time | No EPUB. No position sync — reopening starts at page 1. No download button | **~180–220k** |
| **2** | **The EPUB reader** — vendored pinned epub.js + JSZip; whole-file fetch with the **32 MiB size gate** and its honest refusal card; pagination, font size, light/dark against the shelf's own palette; Read button extends to `format === 'epub'` | one repo | 135 of 138 open; the 3 over the gate show the refusal, never a spinner; images render (⚠️ proves `blob:` in the CSP); the reader inherits the shelf theme | No position sync yet. No zip-over-HTTP for the 3 big ones. No annotations, no highlights, no dictionary | **~250–300k** |
| **3** | **Position sync** — `readingPositions` collection + additive rules deploy (standing permission, smoke test after); write on debounce/hide/close; the "you were on page X on <device>" prompt; progress bar on the shelf tile | rules + one repo (+ optionally a read-only surface in `library_catalog`) | position survives a reload, and a phone→desktop hop; another signed-in account **cannot read or write** your document (⚠️ exercise this, do not reason about it); `_dev` writes land in `_dev` | No merge semantics beyond last-write-wins. No "currently reading" integration with `profiles`. No club-`progress` join | **~200k** |
| **4** | *(Deferred, out of scope)* zip-over-HTTP for the 3 oversized EPUBs; offline/PWA; annotations; a download button if §6 grants one; TBR/read-state integration from the reader | — | — | — | — |

**Per the estate's own dispatch rules:** phases 1b, 2 and 3 sit at or above the
~150k "commit and push everything first" line, and 1a+1b together would exceed
it as a single dispatch — **which is exactly why they are split by repo.** Two
agents that each land beat one that dies at 90%.

---

## 9. What explicitly does NOT change

- **The pipeline's producer.** `build_ebook_manifest.py` (step 1b) stays the
  manifest's sole author, unconditional. Phase 0 adds a *consumer* step, it
  does not touch step 1b.
- **The anchor fold.** One implementation, in Python, in
  `build_ebook_manifest.ebook_anchor`. The reader **reads** anchors and never
  computes one.
- **`bookIdFromTitle`, `normaliseTitle`, `workKeyFor`, `reviewDocId`,
  `readingListDocId`.** Persisted-key implementations; each is one
  implementation, and the two doc-id orders stay deliberately reversed.
- **`ebooks-door`.** No change. It already proxies every path verbatim.
- **The covers bucket and its public dev URL.** Untouched; the new bucket is a
  sibling, not a reorganisation.
- **`firestore.rules`' existing openness.** No existing collection's posture
  changes. Phase 3 adds one new block for one new collection and nothing else.
  The `reviews`/`readingLists` shape-only rules are a recorded owner decision;
  do not "fix" them on the way past.
- **`ESTATE_CHECK`.** Flipping `shadow` → `enforce` remains a separate,
  evidence-gated owner act. This design ships *behind* the gate.
- **The shelf server / Audiobookshelf / Cloudflare Access.** Unchanged, and
  still the better phone-and-offline story.
- **The two-lane deploy.** Everything lands on `/dev/` first; prod only on an
  explicit "prod" ask.

---

## 10. What was NOT verified

- **Cloudflare's own documented limits were quoted from knowledge, not
  re-read against Cloudflare's docs this session** — specifically the Pages
  25 MiB per-file asset cap, the Workers 128 MiB isolate memory limit, the
  R2 free tier (10 GB-month / 1M Class A / 10M Class B / zero egress), and the
  Free-plan max cacheable object size. The *arithmetic* over `ebooks.json` is
  measured and re-runnable; the *thresholds* it is compared against are not.
- **Which Cloudflare plan this account is on** (Workers Free vs Paid) — not
  found in any doc read. It changes CPU-time headroom and cache limits, not the
  design.
- ~~**epub.js's and foliate-js's fetch behaviour was reasoned from how EPUB and
  those libraries work, not exercised.** §4.1's claim that neither
  range-fetches by default is the single most load-bearing unmeasured statement
  in this document. ⚠️ **Exercise it before phase 2** — 20 minutes with one
  epub and a devtools network tab settles it, and if it is wrong the EPUB size
  gate may be unnecessary.~~
  ✅ **MEASURED 2026-08-17 → [`epub-streaming-findings-2026-08-17.md`](epub-streaming-findings-2026-08-17.md).**
  ⚠️ **It was half wrong, and the half that was wrong is the half this document
  built on.** epub.js does fetch the whole archive in one `Range`-less `GET`
  (confirmed, 4 books) and inflates it to ~3× file size in the JS heap
  (1,207 MB for the 393 MiB omnibus). But **range requests help EPUB
  enormously**: foliate-js with a zip.js `HttpRangeReader` opened that same
  393 MiB book in **15 range requests / 76.9 KiB / 10.4 MB heap**. So the
  **32 MiB size gate (§4.1) and its refusal card are unnecessary**, the
  **renderer recommendation (§4.2) changes to foliate-js** — decide it *before*
  phase 3 stores a CFI, or §7.3's migration becomes real — and **§8's sole
  deciding argument for PDF-first no longer holds**, which re-opens §11 item 1
  as an owner decision.
- **pdf.js's `httpHeaders` option surviving in the current version** — the
  bearer-per-range design (§3.3) depends on it. Confirm against the exact
  vendored version at phase 1b.
- **Whether the 393 MiB "White Sand Omnibus" and the 143 MiB "whitesand.epub"
  are the same book twice.** The sizes and names suggest a duplicate; nobody
  opened either. If they are, the corpus is smaller than measured and the worst
  outlier may simply be deletable — worth ten minutes before phase 0.
- **The household's upload bandwidth**, so the phase-0 backfill wall time is
  unstated rather than estimated.
- **Nothing was fetched over the network.** `ebooks.heygabi.ai`,
  `audiobook-api.heygabi.ai/api/me` and `audiobooks.heygabi.ai/ebooks.json`
  were all read as source, never as live responses.
- **The shelf server's state.** `SHELF_SERVER.md` says "NOT YET RUN"; whether
  it has since been built was not checked, and §2.4's assessment of it as an
  alternative assumes the doc is current.
- **Audiobookshelf's actual EPUB reader quality** — from general knowledge,
  never exercised. `ebook-split-design.md` §5 already flags the same claim as
  unverified.
- **No claude.ai usage reading was taken** during this work.

---

## 11. Open owner decisions

1. ⚠️ **PDF first or EPUB first?** Recommended: **PDF** (§8 — pdf.js handles
   its whole format; epub.js must refuse 3 books). Cost of the other choice:
   near zero, and it is his call which format he wants to *see* first.
2. ⚠️ **Preview: Option A (ungated first chapter) or Option B (members-only
   read, richer card + PDF first-page thumbnail)?** Recommended: **B** (§6).
   This is the one that changes the security surface, so it is the one worth
   the most thought.
3. **One capability or two?** Recommended: **reuse `download` (member+) for
   both reading and downloading**, and treat any read-vs-download distinction
   as UI. Splitting them is available but is a product line, never a security
   one (§6).
4. **Should a download button exist at all**, and at which rung? `download`
   floors at `member` today; `upload` at `contributor`. The owner may want
   downloads higher than reading.
5. **Offline / PWA reading?** Recommended: **no** for now (§4.5) — it puts
   gated files on disk and Audiobookshelf already does offline properly.
6. **One reader or two?** This browser reader and the Audiobookshelf app will
   both open EPUBs, from two different gates, with two different position
   stores. That is acceptable (different surfaces, different jobs) but it
   should be a decision, not a discovery.
7. **The two White Sand files** — is the 393 MiB omnibus a duplicate of the
   143 MiB epub, and may one be deleted? Answering yes removes the single
   worst constraint in this design.
8. **Is a 32 MiB EPUB gate the right line**, or should phase 4's
   zip-over-HTTP work be pulled forward so no book is ever refused?

---

## Related

- `catalog-platform/docs/info/ebook-split-design.md` — the ownership-model
  decision this builds on; §5 is the shelf-server seam.
- `catalog-platform/docs/info/audiobook-auth-migration.md` §5 **Phase 4** —
  *the* file-permissions phase; `GET /api/download/:bookId` is this design's
  sibling and should share its handler shape.
- `catalog-platform/docs/info/estate-auth-design.md` §3.1 (the combination
  table), §4.5 (visibility — and why it is **not** the gate here), §5.3 (the
  10-minute TTL).
- [`tbr.md`](tbr.md) — the shared-store precedent, the reversed doc ids, and
  why a spanning per-person fact lives in Firestore.
- [`identity-and-reviews.md`](identity-and-reviews.md) — `workKey`,
  `bookIdFromTitle`, and the audiobook site's three surprising behaviours.
- `audiobook_catalog/docs/info/covers-r2.md` — the R2 machinery this copies,
  including every gotcha that cost time (LOCAL ONLY in that repo).
- `audiobook_catalog/docs/access/SHELF_SERVER.md` — the complementary
  phone/offline story (LOCAL ONLY).
