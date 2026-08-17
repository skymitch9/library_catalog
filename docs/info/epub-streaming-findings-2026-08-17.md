# EPUB reader fetch behaviour — Information Reference (measured)

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-17** — every request line and heap figure below was
> produced that day by loading real library EPUBs in Chrome against a local
> HTTP server that logged every `Range` header. §7 lists what was **not**
> measured. This document exists to settle
> [`ebook-viewer-design.md`](ebook-viewer-design.md) §10's "single most
> load-bearing unmeasured statement".

**The claim under test**, from `ebook-viewer-design.md` §4.1, verbatim:

> *"Neither **epub.js** nor **foliate-js** does HTTP range fetching by default
> — both take a URL or an `ArrayBuffer` and pull the **whole archive** before
> rendering a word. Range requests … **do not help EPUB** in any off-the-shelf
> configuration."*

**Verdict: the first sentence is confirmed and the second is wrong.**

---

## 0. The verdict in one sentence

**epub.js fetches the entire archive in a single whole-file `GET` with no
`Range` header and inflates it into the JS heap at ~3× the file size (measured:
1,207 MB of heap for the 393 MiB omnibus); therefore the EPUB phase should NOT
be built on epub.js's default loader — it should use foliate-js with a
range-reading ZIP loader, which opened that same 393 MiB book in 85 ms using 15
range requests totalling 76.9 KiB (0.019% of the file) at 10.4 MB of heap.**

The corollary matters as much as the verdict: **the 32 MiB size gate and the
"honest refusal" card for three books are unnecessary**, and PDF-first is no
longer forced by EPUB's limitations.

---

## 1. The harness

Scratch only, outside every repo, deleted-safe:
`C:\Users\nbasl\.claude\jobs\3473b22a\tmp\epub-probe\`. Nothing in any repo was
touched to produce this.

| Piece | What it did |
|---|---|
| `server.js` | Node HTTP server on `127.0.0.1:8099`. **Logged every request with its `Range` header and the exact byte count of every response.** The server log — not the browser — is the evidence below |
| `/whole/<id>.epub` | the real file, `Accept-Ranges: bytes`, `Content-Length` set, `206` honoured |
| `/nolen/<id>.epub` | the same bytes **chunked**: no `Content-Length`, no `Accept-Ranges` |
| `/unzipped/mid/` | the EPUB pre-extracted to disk, served as individual files (the server-side-unzip shape) |
| `clean.html` | epub.js 0.3.93 + JSZip 3.10.1, **no monkey-patching** |
| `foliate.html` | foliate-js (`@main`) + `@zip.js/zip.js` 2.7.45 |
| `zipRange.html` | zip.js `HttpRangeReader` alone |

Books used, all real files from `C:/Users/nbasl/OpenAudible/books`:

| id | Bytes | MiB | File |
|---|---|---|---|
| `small` | 3,197,514 | 3.05 | `Will Wight/Waybound (Cradle Book 12)…` |
| `mid` | 28,997,544 | 27.65 | `Brandon Sanderson/The_Frugal_Wizard_s_Handbook…` |
| `big` | 150,104,209 | 143.15 | `Brandon Sanderson/whitesand.epub` |
| `huge` | 412,436,591 | 393.33 | `Brandon Sanderson/White Sand Omnibus…` |

⚠️ **Harness gotcha that cost the most time, recorded so nobody re-pays it.**
The probe tab is driven headlessly and stays `document.visibilityState ===
"hidden"`. **Chrome throttles `requestAnimationFrame` to ~0 Hz in a background
tab, and epub.js drives its view attach off rAF** — so an unshimmed hidden tab
opens the book in 500 ms and then *never renders*, looking exactly like an
epub.js hang on large files. It is not. `clean.html` shims `rAF` onto
`setTimeout` before epub.js loads. **Consequence for reading the numbers below:
network shape and heap size are real measurements; every render *duration* is
an upper bound, because background `setTimeout` is clamped.**

---

## 2. epub.js — the request logs

### 2.1 Every whole-file run, trimmed to the request lines

```
# small (3,197,514 B)
#  2 GET /whole/small.epub   Range: (none)
  -> 200 FULL 3197514 B

# mid (28,997,544 B) — plus display() and TWO page turns
#  2 GET /whole/mid.epub     Range: (none)
  -> 200 FULL 28997544 B
                                    <- no further requests, at all

# big (150,104,209 B)
#  2 GET /whole/big.epub     Range: (none)
  -> 200 FULL 150104209 B

# huge (412,436,591 B)
#  2 GET /whole/huge.epub    Range: (none)
  -> 200 FULL 412436591 B
```

**Four books, four single `GET`s, `Range: (none)` on every one, the complete
file every time.** Rendering three sections and turning two pages on `mid`
produced **zero** additional network requests — everything came out of the one
buffer.

epub.js's transport is an `XMLHttpRequest` with `responseType=arraybuffer` (seen
client-side in the instrumented run). `book.opened` never resolved before the
XHR completed in any run — structurally it cannot, because JSZip is handed the
finished `ArrayBuffer`.

### 2.2 Timings and heap

| Book | MiB | Bytes fetched | `book.opened` | Peak JS heap | Heap ÷ file |
|---|---|---|---|---|---|
| small | 3.05 | 3,197,514 | 82 ms | 45.4 MB | — |
| mid | 27.65 | 28,997,544 | 597 ms | **93 MB** | 3.4× |
| big | 143.15 | 150,104,209 | 862 ms | **295.4 MB** | 2.1× |
| huge | 393.33 | 412,436,591 | 5,538 ms | **1,207.5 MB** | **3.07×** |

All four rendered successfully. `huge` reported 490 spine sections and rendered
its first pages. **The desktop's `jsHeapSizeLimit` is 4,192 MB, so 1.2 GB
survives here.** That is the finding to be careful with — see §5.

⚠️ **All four load times are from `127.0.0.1`.** The download was effectively
free. Over a real network the 393 MiB transfer dominates completely, and none
of these figures predict it.

---

## 3. Does epub.js need `Content-Length`? — No

The design asked whether a reader can open a URL that streams chunked rather
than one that declares its size. Measured on `mid` with the origin sending
**no `Content-Length` and no `Accept-Ranges`**:

```
#  2 GET /nolen/mid.epub   Range: (none)
  -> 200 CHUNKED (no Content-Length, no Accept-Ranges) size=28997544
```

`book.opened` at 644 ms, 76 spine sections, rendered, two page turns — **no
error, no degradation.** `XMLHttpRequest` with `responseType=arraybuffer`
buffers to completion regardless of framing.

**Implication for the Worker:** passing `R2ObjectBody.body` straight through as
a chunked stream is safe for EPUB even if `Content-Length` is unavailable. It
buys nothing for epub.js (which waits for the last byte anyway), and it does
**not** relieve the memory problem, which is client-side.

---

## 4. The two fetch shapes that DO work

### 4.1 Server-side unzip — epub.js `openAs: 'directory'`

epub.js has an off-the-shelf directory mode. Pointed at a pre-extracted tree it
fetched **individual files, on demand**:

```
#  2 GET /unzipped/mid/META-INF/container.xml
#  3 GET /unzipped/mid/OEBPS/content.opf
#  4 GET /unzipped/mid/META-INF/com.apple.ibooks.display-options.xml   -> 404 (harmless)
#  5 GET /unzipped/mid/OEBPS/Text/nav.xhtml
#  6 GET /unzipped/mid/OEBPS/Text/Cover.xhtml
#  7 GET /unzipped/mid/OEBPS/Styles/style.css
#  8 GET /unzipped/mid/OEBPS/Images/Cover.png
#  9 GET /unzipped/mid/OEBPS/Text/endpaper1.xhtml
# 10 GET /unzipped/mid/OEBPS/Styles/style.css          <- refetched
# 11 GET /unzipped/mid/OEBPS/Images/endpaper01.jpg
# 12 GET /unzipped/mid/OEBPS/Text/title.xhtml
# 13 GET /unzipped/mid/OEBPS/Styles/style.css          <- refetched
# 14 GET /unzipped/mid/OEBPS/Images/bagsworth.jpg
# 15 GET /unzipped/mid/OEBPS/Images/TitlePage.png
```

**14 requests, 914,969 B = 0.87 MiB — 3.16% of the 27.65 MiB archive** — to
open the book and render three sections. `book.opened` in **55 ms** (vs 597 ms),
peak heap **36.9 MB** (vs 93 MB).

⚠️ **Note requests #10 and #13: `style.css` was fetched three times.** The probe
server sends `Cache-Control: no-store`, which is exactly what
`ebook-viewer-design.md` §2.3 mandates for the gated byte stream. **A
server-side-unzip design plus `no-store` re-fetches every shared asset on every
section.** That is a correctness-neutral but real cost, and it is a decision to
make deliberately rather than discover: either accept it, or find a posture that
is private-but-revalidatable for the sub-resources.

### 4.2 Zip-over-HTTP — the range path, on the worst file in the library

zip.js `HttpRangeReader` against `/whole/huge.epub` (393.33 MiB), reading the
central directory, `container.xml`, the full 123 KB OPF and the first document:

```
#  2 GET /whole/huge.epub  Range: bytes=0-0                        -> 206 (1 B)
#  3 GET /whole/huge.epub  Range: bytes=412436569-412436590        -> 206 (22 B)      EOCD
#  4 GET /whole/huge.epub  Range: bytes=412369287-412436568        -> 206 (67,282 B)  central directory
#  5 GET /whole/huge.epub  Range: bytes=58-87                      -> 206 (30 B)
#  6 GET /whole/huge.epub  Range: bytes=110-286                    -> 206 (177 B)     container.xml
#  7 GET /whole/huge.epub  Range: bytes=455864-455893              -> 206 (30 B)
#  8 GET /whole/huge.epub  Range: bytes=455911-465485              -> 206 (9,575 B)   content.opf
#  9 GET /whole/huge.epub  Range: bytes=287-316                    -> 206 (30 B)
# 10 GET /whole/huge.epub  Range: bytes=331-589                    -> 206 (259 B)
```

**9 range requests, 77,406 B total.** The classic ZIP-from-the-end pattern is
plainly visible: probe, read the end-of-central-directory record, pull the
central directory, then seek to individual local headers and entry data.

⚠️ **This is the row that overturns the design's §4.1.** Range requests help
EPUB enormously. The reason they "don't" is not the format — it is epub.js's
default loader.

---

## 5. foliate-js — and the recommendation

foliate-js's own loader, read from `view.js@main`, is
`new ZipReader(new BlobReader(file))` over a whole in-memory `Blob`, returning a
**plain object** `{ entries, loadText, loadBlob, getSize }` that `new
EPUB(loader).init()` consumes. So the whole-file claim holds for its shipped
path — and the loader is a one-line swap.

Both were exercised:

| Run | Book | Requests | Bytes over the wire | Time to init | Peak heap |
|---|---|---|---|---|---|
| foliate **default** (`BlobReader`) | mid, 27.65 MiB | 1 whole `GET` | 28,997,544 | 119 ms | **8 MB** |
| foliate **+ `HttpRangeReader`** | **huge, 393.33 MiB** | **15 ranges** | **78,741 B (0.019%)** | **85 ms** | **10.4 MB** |

The range run loaded 490 sections, the correct title
(*"White Sand Omnibus (Brandon Sanderson's White Sand)"*) and the first three
chapter documents.

**Two separate findings here, and the first is easy to miss:**

1. ⚠️ **Even foliate's *default* whole-file path costs ~8 MB of heap on a book
   where epub.js costs 93 MB.** It keeps the archive as a `Blob` — backed by
   disk, not the JS heap — and inflates entries on demand. **The memory problem
   is an epub.js problem, not an EPUB problem.**
2. **The range path makes file size nearly irrelevant**: 10.4 MB of heap and 77
   KiB transferred for the largest book in the library.

### The head-to-head, same file, same origin

| | epub.js | foliate-js + `HttpRangeReader` |
|---|---|---|
| Bytes fetched | **412,436,591** | **78,741** |
| Requests | 1 | 15 |
| Open time (localhost) | 5,538 ms | **85 ms** |
| Peak JS heap | **1,207.5 MB** | **10.4 MB** |

---

## 6. What this means for the design

### 6.1 For the three oversized EPUBs (393.3, 143.2, 27.7 MiB)

- **The 32 MiB size gate in §4.1/§8-phase-2 is not needed** if the reader is
  foliate-js with a range loader. All three open. The "honest refusal" card
  becomes dead code — worth *not* building rather than building and removing.
- ⚠️ **But do not conclude from this document that epub.js "handles" them.**
  It opened all three *on a desktop with a 4,192 MB heap limit*. 1.2 GB of heap
  is not survivable on a phone, and §7 records that no mobile device was
  tested. If epub.js is kept, the gate must stay.
- The 393 MiB omnibus stops being "the single worst constraint in this design"
  (§11 item 7). Whether it duplicates `whitesand.epub` is still worth ten
  minutes, but it is no longer load-bearing.

### 6.2 For the Worker (§2.3)

- **`Accept-Ranges: bytes` and correct `206`/`Content-Range` handling become
  mandatory for EPUB too**, not just PDF. The design already specifies exactly
  this for pdf.js, so **the handler shape needs no change** — but the reason it
  matters doubles, and a future session must not "simplify" ranges away as a
  PDF-only nicety.
- **`Never await object.arrayBuffer()` stays right**, and now for both formats.
- ⚠️ **Range requests must carry the bearer header.** §3.3's header-only
  decision survives — but note the fetch count: **15 requests to open one
  book**, each needing the `Authorization` header and each paying token
  verification + the estate `/seen` cache lookup. The per-request auth cost is
  now on the EPUB path, so §3.5's rate limit must be sized for "a page turn is
  several range GETs" on **both** formats, not just PDF.
- **Class B ops:** 15 reads to open a book, more per chapter. Still nothing
  against R2's allowance for a household, but it is no longer "one GET per
  book".

### 6.3 For the phase order (§8)

**The deciding argument for PDF-first is gone.** §8's table gives one reason and
one only: *"pdf.js range-streams its own 181 MiB outlier by design. epub.js
cannot stream at all — so EPUB-first must also ship a size gate, an
honest-refusal UI for 3 books, and a decision about the 393 MiB omnibus."*
Measured, an EPUB reader can range-stream its own outliers too, and needs no
gate, no refusal UI and no omnibus decision.

The remaining arguments for PDF-first are real but weaker (smaller first
ingest; PDFs have the worst metadata). The arguments for EPUB-first — 138 of
168 files, and it is what "read a book on the site" means — now stand
unopposed by any technical constraint. **This is an owner decision (§11 item
1), and it should be re-put to him with this evidence.**

### 6.4 For the library choice (§4.2)

**Recommendation changes: foliate-js, not epub.js.** The design chose epub.js
"on the same reasoning the estate uses everywhere else — take the well-trodden
thing", with typography as the only named reason to revisit. That reasoning
predates these numbers. On measured behaviour foliate-js is better by
**two orders of magnitude on heap** and **four on bytes transferred**, and it
is the only one of the two whose loader interface is documented as pluggable.

⚠️ **The cost of this swap is named in the design and is real:** §7.3 says a
stored CFI is a persisted key produced by a specific renderer, so *"swapping
epub.js for foliate-js later is a migration, not an edit."* **Deciding
foliate-js now, before phase 3 stores its first position, makes that migration
cost exactly zero.** Deciding it later does not. That is the single strongest
practical reason to settle the renderer before the EPUB phase starts.

---

## 7. What was NOT measured

- ⚠️ **No mobile device, and no low-memory device of any kind.** Every heap
  figure is from one Windows desktop with `jsHeapSizeLimit = 4,192 MB`. The
  claim "1.2 GB would kill a phone tab" is **reasoning, not measurement** — it
  is the same class of statement this document exists to replace. If the size
  gate decision matters, exercise it on a phone.
- ⚠️ **Every timing is from `127.0.0.1`**, where a 393 MiB download is
  essentially free. No figure here predicts real-network behaviour, and the
  whole-file approach's true cost (transfer time on a household uplink, and on
  a phone's data plan) is therefore **understated everywhere above**.
- ⚠️ **Render durations are upper bounds, not measurements** — the rAF shim in
  §1. Network shape and heap are unaffected.
- **No paginated reading session was exercised.** Sections were loaded and up to
  three rendered; nobody read a chapter, resized, changed font size, or turned
  50 pages. Whether foliate's range loader stays cheap deep into a book is
  **unmeasured** — it should, because entries are fetched on demand, but that is
  an inference.
- **foliate-js was driven through its `EPUB` class directly, not through its
  `View`/`paginator` UI.** Rendering quality, pagination, theming and RTL were
  not assessed at all. The `makeLoader` helper in the probe is a faithful copy
  of `view.js`'s `makeZipLoader` with the Reader swapped, but it is a copy —
  **using foliate's real `view.js` may bring back the whole-file `BlobReader`
  unless the loader is injected deliberately.** That integration point is the
  main unknown for the build.
- **Both libraries were loaded from jsdelivr**, not vendored. The design's §4.4
  `'self'` CSP posture requires vendoring; **no vendored build was exercised**,
  and no CSP was applied to the probe page at all. `blob:` requirements in
  `img-src`/`frame-src` are therefore still unverified.
- **foliate-js was taken from `@main`**, an unpinned moving target. The design's
  vendoring discipline requires a pinned version; these numbers belong to
  whatever `main` was on 2026-08-17.
- **Nothing was tested against R2, the Worker, or any authenticated origin.**
  Whether Cloudflare's edge preserves this range pattern, and whether 15
  bearer-authenticated range requests behave, is **untested**. The probe origin
  was a local Node server with permissive CORS.
- **No `HEAD` request was needed by `HttpRangeReader`** in these runs (it probed
  with `bytes=0-0`), but whether that holds against R2's headers was not
  checked.
- **epubcfi position stability across the two libraries** — the §7.3 migration
  question — was not exercised. No position was stored or restored.
- **No claude.ai usage reading was taken** during this work.

---

## Related

- [`ebook-viewer-design.md`](ebook-viewer-design.md) — the design this
  measures; §4.1, §4.2, §8 and §11 all move on these numbers.
- `catalog-platform/docs/info/audiobook-auth-migration.md` §5 Phase 4 — the
  gated-read sibling whose handler shape the byte stream shares.
