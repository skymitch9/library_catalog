# docs/info — index

> **Audience:** Claude sessions. How and why things work.
> Last verified: **2026-08-14** (index rows for the estate docs checked against
> their files; the operational side of estate auth / the index / themes now
> lives in `../access/estate-auth.md`, `../access/index-worker.md`,
> `../access/themes.md`).

| File | Covers | Read it before |
|---|---|---|
| [`isbn-ladder.md`](isbn-ladder.md) | **Measured** hit rates for Open Library and Google Books against this household's own library. Two of the original design's assumptions did not survive. | touching `packages/isbn`, or assuming a lookup will succeed |
| [`openlibrary-ids.md`](openlibrary-ids.md) | **Measured** fill of `work.openlibrary_work_id`: 35 of 116 matched, 68 searched-and-absent, 13 outliers. What counts as corroboration beyond title+author, and the matches refused despite a perfect score | touching `corroboration.ts`, the OL id backfill, or adding an Open Library rung anywhere |
| [`covers-and-series.md`](covers-and-series.md) | **Measured** ladders for cover art, series names and Drive links, and why the ISBN ladder cannot fire on these rows | touching either backfill, the Drive links, or `detectSeriesFromTitle` |
| [`completeness-wishlist-relations.md`](completeness-wishlist-relations.md) | **Measured** series gaps (7 interior, 69 earlier, 12 sourced), what may and may not be claimed about a series length, why the wishlist is a list of copies, and the two bugs where a wish closed a gap | touching `completeness.ts`, `series_volume`, `copy.status`, or `work_relation` |
| [`identity-and-reviews.md`](identity-and-reviews.md) | One Google account across both catalogs; one shared review store; the `workKey` bridge and the backfill | touching auth, `titles.ts`, or anything that writes Firestore |
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
