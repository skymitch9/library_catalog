# docs/info — index

> **Audience:** Claude sessions. How and why things work.
> Last verified: **2026-08-10**.

| File | Covers | Read it before |
|---|---|---|
| [`isbn-ladder.md`](isbn-ladder.md) | **Measured** hit rates for Open Library and Google Books against this household's own library. Two of the original design's assumptions did not survive. | touching `packages/isbn`, or assuming a lookup will succeed |
| [`covers-and-series.md`](covers-and-series.md) | **Measured** ladders for cover art, series names and Drive links, and why the ISBN ladder cannot fire on these rows | touching either backfill, the Drive links, or `detectSeriesFromTitle` |
| [`identity-and-reviews.md`](identity-and-reviews.md) | One Google account across both catalogs; one shared review store; the `workKey` bridge and the backfill | touching auth, `titles.ts`, or anything that writes Firestore |
| [`data-model.md`](data-model.md) | What each table is for and the rules the schema enforces | changing the schema |
| [`ios-camera.md`](ios-camera.md) | Copied from the Board Game Catalog. Every line is a WebKit constraint | touching `camera.ts` / `scanner.ts` |

## The four findings worth knowing without opening a file

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
4. **None of the 117 ebook rows has an ISBN, so finding 1 does not help them.**
   Their covers come out of the EPUB files themselves (114 of 115) and their
   series out of their own titles (65) — see `covers-and-series.md`. Reaching for
   Open Library to fix a cover here is solving the wrong problem.
