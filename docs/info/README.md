# docs/info — index

> **Audience:** Claude sessions. How and why things work.
> Last verified: **2026-08-10**.

| File | Covers | Read it before |
|---|---|---|
| [`isbn-ladder.md`](isbn-ladder.md) | **Measured** hit rates for Open Library and Google Books against this household's own library. Two of the original design's assumptions did not survive. | touching `packages/isbn`, or assuming a lookup will succeed |
| [`openlibrary-ids.md`](openlibrary-ids.md) | **Measured** fill of `work.openlibrary_work_id`: 35 of 116 matched, 68 searched-and-absent, 13 outliers. What counts as corroboration beyond title+author, and the matches refused despite a perfect score | touching `corroboration.ts`, the OL id backfill, or adding an Open Library rung anywhere |
| [`covers-and-series.md`](covers-and-series.md) | **Measured** ladders for cover art, series names and Drive links, and why the ISBN ladder cannot fire on these rows | touching either backfill, the Drive links, or `detectSeriesFromTitle` |
| [`completeness-wishlist-relations.md`](completeness-wishlist-relations.md) | **Measured** series gaps (7 interior, 69 earlier, 12 sourced), what may and may not be claimed about a series length, why the wishlist is a list of copies, and the two bugs where a wish closed a gap | touching `completeness.ts`, `series_volume`, `copy.status`, or `work_relation` |
| [`identity-and-reviews.md`](identity-and-reviews.md) | One Google account across both catalogs; one shared review store; the `workKey` bridge and the backfill | touching auth, `titles.ts`, or anything that writes Firestore |
| [`data-model.md`](data-model.md) | What each table is for and the rules the schema enforces | changing the schema |
| [`ios-camera.md`](ios-camera.md) | Copied from the Board Game Catalog. Every line is a WebKit constraint | touching `camera.ts` / `scanner.ts` |
| [`routing.md`](routing.md) | The URL scheme, the push-vs-replace rule, how a back button knows where it goes, and why deep links need nothing from the Worker | **adding any screen**, or touching `router.tsx` / `App.tsx` |

## The six findings worth knowing without opening a file

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
6. **"You own 6 of 12" is a lie unless something said 12.** Gaps *inside* a run
   you own are arithmetic and cannot be wrong — 7 of them exist, in two series.
   Everything beyond your highest volume needs a named source, and the only one
   that fires here is the audiobook catalog, which knows 12 of our 25 series.
   See `completeness-wishlist-relations.md`.
