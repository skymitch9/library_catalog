# docs/info — index

> **Audience:** Claude sessions. How and why things work.
> Last verified: **2026-08-17** — the `ebook-viewer-design.md`,
> `epub-streaming-findings-2026-08-17.md` and
> `gabi-fixer-design.md` rows are new that day (`ebook-viewer-design.md` is
> design only; ⚠️ `gabi-fixer-design.md` is NO LONGER design-only — its phase 0
> was built and deployed the same day; the findings doc is measurement only, no
> code changed);
> the `estate-search.md` row is from 2026-08-16;
> everything else was last checked **2026-08-14** (index rows for the estate
> docs checked against their files; the operational side of estate auth / the
> index / themes now lives in `../access/estate-auth.md`,
> `../access/index-worker.md`, `../access/themes.md`).

| File | Covers | Read it before |
|---|---|---|
| [`isbn-ladder.md`](isbn-ladder.md) | **Measured** hit rates for Open Library and Google Books against this household's own library. Two of the original design's assumptions did not survive. | touching `packages/isbn`, or assuming a lookup will succeed |
| [`openlibrary-ids.md`](openlibrary-ids.md) | **Measured** fill of `work.openlibrary_work_id`: 35 of 116 matched, 68 searched-and-absent, 13 outliers. What counts as corroboration beyond title+author, and the matches refused despite a perfect score | touching `corroboration.ts`, the OL id backfill, or adding an Open Library rung anywhere |
| [`covers-and-series.md`](covers-and-series.md) | **Measured** ladders for cover art, series names and Drive links, and why the ISBN ladder cannot fire on these rows | touching either backfill, the Drive links, or `detectSeriesFromTitle` |
| [`completeness-wishlist-relations.md`](completeness-wishlist-relations.md) | **Measured** series gaps (7 interior, 69 earlier, 12 sourced), what may and may not be claimed about a series length, why the wishlist is a list of copies, and the two bugs where a wish closed a gap | touching `completeness.ts`, `series_volume`, `copy.status`, or `work_relation` |
| [`identity-and-reviews.md`](identity-and-reviews.md) | One Google account across both catalogs; one shared review store; the `workKey` bridge and the backfill | touching auth, `titles.ts`, or anything that writes Firestore |
| [`tbr.md`](tbr.md) | The cross-catalog to-be-read list. ⚠️ **The store already existed** — `readingLists`, the audiobook site's own TBR — so this joins it rather than inventing one, and needed **no rules change**. The document id is the REVERSE of a review's; why TBR is a flag and not a fifth `read_state`; how finishing any format clears it; and the audiobook-side hook that is deliberately NOT built, with its spec | touching `packages/core/src/tbr.ts`, `/api/tbr`, the My TBR screen, or the read-state sweep |
| [`content-warnings.md`](content-warnings.md) | ⚠️ **The cross-catalog join, and the one way to get this feature silently wrong.** Reader content notes live in the audiobook site's own `user_content_warnings`, keyed by a slug of the title as THAT catalog spells it — and **27 of this catalog's 92 matched works spell it differently enough to produce a different key** (measured 2026-08-17). `audiobook_holding.title` is the join; `workKey` cannot be, because a warning document has none and both collections were empty. Also: the delete gate is `authorUid` vs the estate's `site_roles` (a DIFFERENT record from this catalog's roles), the free published-warnings join, and the deliberately deferred ebooks half | touching `packages/core/src/warnings.ts`, `/api/warnings`, the Content notes panel, or porting this to the ebooks site |
| [`ebook-viewer-design.md`](ebook-viewer-design.md) | **PHASE 0a BUILT 2026-08-17 (§2.2a); phase 1a onward is design only.** The in-browser EPUB/PDF reader. ⚠️ **The files ARE in R2 now** — 167 of 168 objects in the private `estate-ebooks` bucket (no dev URL, no domain, no reader). ⚠️ **`wrangler r2 object put` refuses files over 300 MiB**, measured — the one 393 MiB book needs an owner-minted R2 API token and the S3 multipart path. Measured: 168 files / 1.805 GB — an ingest phase the first take did not price. ⚠️ ~~Range requests are a PDF technique, not an EPUB one~~ **FALSIFIED 2026-08-17** — ranges help EPUB enormously via foliate-js, so no size gate and PDF-first loses its deciding argument (see `epub-streaming-findings-2026-08-17.md`). The gate is the audiobook Worker's `download` capability — **floored at `admin` since 2026-08-17** (owner: downloads by ladder only, no checkbox; reading rides `vis_ebooks`, NOT this capability — gating the stream on `download` would lock every member out of reading) — and **not** §4.5 visibility, whose default population includes the anonymous internet. Bearer-per-request, never a signed URL. Position sync becomes the first `uid`-keyed collection in this estate | building phase 1a+, proposing a public bucket or dev URL on `estate-ebooks`, committing `site/ebook_files_manifest.json`, or changing the object key scheme (it is a migration — 1.4 GB is stored under it) |
| [`epub-streaming-findings-2026-08-17.md`](epub-streaming-findings-2026-08-17.md) | **MEASURED**, and it overturns the design it tests. ⚠️ **epub.js fetches the whole EPUB in one `Range`-less `GET` and inflates it to ~3× file size in the JS heap — 1,207 MB for the 393 MiB omnibus.** But **range requests DO help EPUB**: foliate-js on a zip.js `HttpRangeReader` opened that same book in **15 ranges / 76.9 KiB / 10.4 MB heap**. Also measured: epub.js needs no `Content-Length` (chunked works); `openAs:'directory'` fetches 3.16% of the archive; and ⚠️ `no-store` makes a server-side-unzip design re-fetch shared CSS per section. Consequences: **no 32 MiB size gate, foliate-js not epub.js, and PDF-first loses its deciding argument** | building the EPUB reader, keeping the size gate, or picking a renderer before reading this |
| [`gabi-fixer-design.md`](gabi-fixer-design.md) | **PHASE 0 BUILT AND DEPLOYED 2026-08-17; phases 1–3 still design.** "Sam asks GABI to fix her books" — an Anthropic tool-use loop whose tools are this Worker's existing capability-gated endpoints. ⚠️ **The loop runs in HER BROWSER, not in the Worker**: a server-side loop blows the 50-subrequest ceiling, which *terminates the invocation silently*, and the browser design makes "her authority end to end" free rather than a thing to build. ⚠️ **Phase 0 is READ-ONLY and that is enforced, not remembered** — `packages/core/test/gabi-tools.test.ts` fails the build if a tool in the allowlist can mutate. Scoped to her instance by the `GABI_PANEL` posture var, which gates the ROUTE as well as the panel (404 disabled-not-open, never 403). §7.4 carries MEASURED costs; §12 records all nine owner decisions, answered 2026-08-17; §13 is the file map. ⚠️ Do NOT disable thinking on Opus 5 — tool calls can arrive as plain text and silently never run | adding a WRITE tool (that is a phase, with a confirm lane and provenance), switching `GABI_PANEL` on for the main catalog (owner decision §12.8), or assuming the loop belongs server-side |
| [`data-model.md`](data-model.md) | What each table is for and the rules the schema enforces | changing the schema |
| [`ios-camera.md`](ios-camera.md) | Copied from the Board Game Catalog. Every line is a WebKit constraint | touching `camera.ts` / `scanner.ts` |
| [`research-and-gaps.md`](research-and-gaps.md) | **Measured** gap counts across the whole catalog, the four questions the details queue asks and the five it refuses, why `gap_verdict` exists, and the propose/accept rule the paid lookup obeys | touching `gaps.ts`, `packages/research`, the queue page, or adding a field anybody could be asked for |
| [`routing.md`](routing.md) | The URL scheme, the push-vs-replace rule, how a back button knows where it goes, and why deep links need nothing from the Worker | **adding any screen**, or touching `router.tsx` / `App.tsx` |
| [`aliases-export-people.md`](aliases-export-people.md) | `work_alias` gets a write path, a `kind` and a reader — **45 → 50 Open Library ids measured**, and why the pen name alone was not enough; the export's JSON-vs-CSV split and its paging; the People screen's two guards and the self-demotion bug | touching `work_alias`, `matching.ts`'s gates, `/api/export.*`, or role changes |
| [`series-formats-and-audiobooks.md`](series-formats-and-audiobooks.md) | **Measured** 40 of 157 works matched to the audiobook catalog (25%, and why the ceiling is far below 100); why the format chips are suppressed when a series is uniform; why "bought twice" means two printings *of one medium*; why `audiobook_holding` is a cache and not an `edition` | touching the series screens, `audiobook_holding`, `editionMedium`, or the audiobook backfill |
| [`crowdfunding-and-accessories.md`](crowdfunding-and-accessories.md) | Kickstarter / BackerKit (**two accounts**) / Indiegogo provenance, and the plushies and pins that came with a book. **Why one pledge is two or three rows against one work**, the `IFNULL` unique index that allows the pair, why Barnes & Noble is not a platform here, and why signed/numbered is prose rather than a field | touching `pledge_item`, `book_accessory`, `crowdfunding.ts`, the import script, or adding anything to the collection page |
| [`universes.md`](universes.md) | ⚠️ **The shared universe list lives in `catalog-platform`, not here** — that repo is now a BUILD DEPENDENCY. How this repo resolves it, why a missing checkout fails the build here and only warns in the audiobook pipeline, and why the generated copy is an artifact rather than a second source of truth | touching `@lc/universes`, `scripts/sync-universes.mjs`, or anything that asks what universe a book is in |
| [`estate-auth-shadow.md`](estate-auth-shadow.md) | ⚠️ Estate auth (auth.heygabi.ai) adopted in **shadow mode**: the `ESTATE_CHECK` flag, the `estate_shadow` log line and its `would_deny` rollout gate, the 0140 cache columns, and the second sibling-checkout sync (`sync-estate-auth.mjs`). Enforcement is NOT built | touching `middleware/auth.ts`, `@lc/estate-auth`, migration 0140, or flipping `ESTATE_CHECK` |
| [`estate-theme.md`](estate-theme.md) | ⚠️ The app styles against the estate's `--et-*` token contract (apple/cyberpunk/retro × light/dark, default apple), vendored by a **third** sibling-checkout sync (`sync-estate-theme.mjs` → gitignored `apps/web/public/estate/`); the pre-paint stamp in index.html, the topbar cog, and how the old palette's five hues mapped onto token roles | touching `styles.css`, `index.html`'s head, `ThemeCog.tsx`, or being tempted to hard-code a colour |
| [`estate-search.md`](estate-search.md) | ⚠️ The **fourth** sibling-checkout sync (`sync-estate-search.mjs`): the shared `<estate-search>` element in the top bar — ADDITIVE, it does not replace CollectionPage’s own search. ⚠️ **It is dead until `library.heygabi.ai` is added to the index Worker’s `READ_ORIGINS`** (measured, §2). Why the element is built by hand, why Vite refuses a dynamic import of `public/`, the upstream scan-button bug, and the `navigate()` hook | touching `components/EstateSearch.tsx`, `lib/estate-search.ts`, `scripts/sync-estate-search.mjs`, or wondering why the estate box returns nothing |
| [`scan-jobs-and-vision.md`](scan-jobs-and-vision.md) | **Measured** shelf-photo reads on two real photographs and two synthetic ones, with costs; why persistence had to precede the camera; why lookups are one line at a time rather than chunked server-side | touching `scan-jobs.ts`, `lib/vision.ts`, `scanjobs.ts`, or anything that spends money |

## The seven findings worth knowing without opening a file

1. **Open Library is excellent by ISBN (9/10) and covers about half this
   library by title (14/30).** The missing half is Kindle Unlimited and
   Audible-native indie fiction with no ISBN anywhere. A title miss is the
   expected outcome, not an error.
2. **A wrong ISBN returns a confident, well-formed, wrong book.** Three of ten
   ISBNs typed from memory resolved to entirely different titles, with covers.
   Nothing in the response marks them. Confirm-before-write is not ceremony.
3. **The audiobook site's review key has no author in it**, so it cannot reach a
   print edition and cannot tell two books called "Gold" apart. `workKey` exists
   for that, and the backfill onto 860 existing documents has **not been run**.
4. **No ebook row has an ISBN *in the database*, so finding 1 does not help them.**
   Their covers come out of the EPUB files themselves (114 of 115) and their
   series out of their own titles (65) — see `covers-and-series.md`. Reaching for
   Open Library to fix a cover here is solving the wrong problem.
5. **The EPUB files carry 24 checksum-valid ISBNs, 111 publishers and 108 years**
   — none of which is in the database. That is what made an Open Library id
   reachable for 35 of 116 works, and it is the second time "the file knows more
   than the catalog does" has been the answer. See `openlibrary-ids.md`.
6. **A shelf photograph reads far better than expected, on an easy shelf.** 28
   of ~30 spines correct on a real photo of an English-language manga shelf,
   with nothing invented — and clearly poor recall on a real, cluttered,
   part-Japanese one. Both cost 3–7¢. No photo of *this household's* shelves has
   ever been tested. See `scan-jobs-and-vision.md`.
7. **"You own 6 of 12" is a lie unless something said 12.** Gaps *inside* a run
   you own are arithmetic and cannot be wrong — 7 of them exist, in two series.
   Everything beyond your highest volume needs a named source, and the only one
   that fires here is the audiobook catalog, which knows 12 of our 25 series.
   See `completeness-wishlist-relations.md`.

---

## Owner-facing work artifacts (in `docs/`, not here — indexed so they are findable)

These are **work products with a shelf life**, not stable facts, which is why
they live in `docs/` rather than beside the reference material:

| Doc | What it is |
|---|---|
| [`../isbn-barcode-worklist.md`](../isbn-barcode-worklist.md) | The **64 editions whose ISBN only the physical book can settle**, grouped by author/series for shelf work. ⚠️ Contains the **Realmkeeper warning**: 16 edition rows describe **8 physical omnibus volumes**, and `idx_edition_isbn13` is UNIQUE catalog-wide, so a volume's barcode can only ever land on one of its two rows. |
| [`../cover-rehost-report.md`](../cover-rehost-report.md) | The 2026-08-13 rehost of **every third-party cover hotlink into R2** (171 URLs, 295 rows) plus the 21 covers found for coverless works, with each dead end itemised. ⚠️ Records that Open Library's **"no cover" sentinel** (`/b/id/-1-L.jpg`) had been stored as a real cover. |

⚠️ **The `cover_status` distinction both docs rely on:** `'ok'` means **a person
assessed the image**. Automated work leaves it **NULL** — "nobody has looked" —
because promoting rows to `'ok'` would empty the "cover needed" list with work
nobody did. 0040's rule, applied to covers.

- [`gotchas.md`](gotchas.md) — the traps that cost real time, findable by symptom. Extracted from the work log 2026-08-16.
- [`decisions.md`](decisions.md) — why things are as they are, including what was deliberately NOT built, plus the honest known-imperfect list.
