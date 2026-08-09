# library_catalog

A private catalog of owned **physical books and ebooks**, built by scanning them.

> **Status:** NOT STARTED. This repo is a landing pad, created 2026-08-08 so the
> first working session has somewhere to begin. There is no application code yet.

**The design already exists and is not duplicated here.** Read it first:

- [`catalog-platform/docs/LIBRARY_CATALOG.md`](../../catalog-platform/docs/LIBRARY_CATALOG.md)
  — the system design: what ports from the Board Game Catalog, what must change,
  the book-specific traps.
- [`catalog-platform/docs/PLATFORM.md`](../../catalog-platform/docs/PLATFORM.md)
  — how the three catalogs are presented as one site *without merging any of them*.
- [`docs/EBOOK_PIPELINE.md`](docs/EBOOK_PIPELINE.md)
  — the 2026-08-09 implementation decision for ebooks: use Calibre-Web Automated
  as the Docker-first ebook processing/library engine, keep `library_catalog` as
  the canonical physical+ebook domain catalog, parallel the existing
  `audiobook_catalog` automation, and leave ebook acquisition as a source-specific
  stage in front of CWA.

`catalog-platform` holds **no application code** and never will. It is the
wrapper/plan that governs three codebases and belongs inside none of them.

## Why it lives here and not under catalog-platform

Owner's decision, 2026-08-08: separation. `library_catalog` sits beside
`audiobook_catalog` under `bookbuddy/` — the two book-shaped catalogs as
siblings. `bookbuddy` is the umbrella folder, not a catalog itself.

The name is deliberate: **not** "physical catalog", because ebooks are in scope.
