# Ebook Pipeline — Calibre-Web Automated

> **Status:** DECISION / IMPLEMENTATION PLAN — not built yet.
> **Decision date:** 2026-08-09.
> **Scope:** `library_catalog` ebook acquisition handoff, storage/management, normalization, and future integration with the unified BookBuddy catalog.
>
> This is an implementation decision for this repo. The broader system design still lives in
> [`catalog-platform/docs/LIBRARY_CATALOG.md`](https://github.com/skymitch9/catalog-platform/blob/main/docs/LIBRARY_CATALOG.md).

## Decision

Use **Calibre-Web Automated (CWA)** as the Docker-first ebook library/processing engine rather than running stock Calibre as the primary server application.

- CWA: <https://github.com/crocodilestick/Calibre-Web-Automated>
- Stock Calibre-Web: <https://github.com/janeczku/calibre-web>
- Calibre: <https://calibre-ebook.com/>

CWA does **not** replace `library_catalog`. It sits underneath it as the ebook storage, normalization, conversion, and reader/distribution service.

The intended ownership boundary is:

- **Acquisition/import job** — obtains or discovers ebooks the owner is entitled to use and drops completed files into a staging area.
- **Calibre-Web Automated** — ingests completed ebook files, manages the Calibre library, normalizes/converts formats, handles metadata/covers/duplicates, and exposes reader/device services.
- **`library_catalog`** — owns the canonical user-facing catalog of physical books + ebooks, edition/copy state, ISBN/ASIN identity, shelf/location/read state, scanning, research, and reconciliation with `audiobook_catalog`.
- **`audiobook_catalog`** — remains the audiobook-specific catalog and Audible/OpenAudible pipeline.

## Why CWA instead of stock Calibre

This project is Docker-first and automation-first. CWA is a better fit for that operating model than a full Calibre desktop/container deployment.

As verified from the CWA project on 2026-08-09, it is explicitly designed as an all-in-one self-hosted Calibre-Web + Calibre feature set and currently provides:

- automatic watched-folder ingest;
- automatic ebook conversion, with EPUB as the default target and EPUB/MOBI/AZW3/KEPUB/PDF available as targets;
- automatic metadata fetching on ingest;
- cover and metadata enforcement into the ebook files;
- backup of originals processed by CWA;
- duplicate detection/management;
- browser reading and normal Calibre-Web library functions;
- OPDS feeds;
- Kobo sync;
- send-to-eReader / automatic send-to-eReader support;
- KOReader sync;
- Docker Compose as the recommended deployment path;
- a network-share mode that changes SQLite/file-watching behavior for NFS/SMB;
- polling-based watching support for Docker Desktop/host-mounted filesystems where `inotify` is unreliable.

For this project, those features remove a large amount of custom glue that would otherwise have to be written around stock Calibre.

### What stock Calibre is still good at

Calibre remains the underlying ecosystem and CLI/tooling layer. If a future requirement needs a lower-level operation, the Calibre tools (`calibredb`, `ebook-convert`, `ebook-meta`, etc.) can be used directly without making the desktop Calibre UI a second primary service.

**Do not deploy stock Calibre and CWA side-by-side by default.** Add a separate Calibre service only if a concrete missing capability requires it.

## Existing audiobook pipeline this should parallel

The sibling [`audiobook_catalog`](https://github.com/skymitch9/audiobook_catalog) already has the operating pattern this ebook pipeline should follow.

Current audiobook flow, simplified:

```text
Audible
  ↓
OpenAudible Docker
  ↓
OpenAudible scheduler / Quick Sync
  ↓
runtime/openaudible/books
  ↓
audiobook sync pipeline
  ├─ sort / author normalization
  ├─ detect new files
  ├─ Google Drive upload
  ├─ catalog rebuild
  ├─ covers / metadata
  ├─ Firebase pipeline status
  └─ GitHub publish
  ↓
audiobook_catalog
```

Relevant sibling implementation:

- [`audiobook_catalog/docker-compose.sync.yml`](https://github.com/skymitch9/audiobook_catalog/blob/main/docker-compose.sync.yml) — OpenAudible + scheduler + sync container.
- [`audiobook_catalog/scripts/sync_to_drive.py`](https://github.com/skymitch9/audiobook_catalog/blob/main/scripts/sync_to_drive.py) — sorting, detection, Drive upload, catalog rebuild/publish orchestration.
- [`audiobook_catalog/app/metadata.py`](https://github.com/skymitch9/audiobook_catalog/blob/main/app/metadata.py) — M4B metadata/cover extraction and companion-file discovery.

The audiobook repo already recognizes `.pdf`, `.epub`, `.mobi`, and `.azw3` as companion formats and uploads them beside audiobooks. Those files are a useful seed inventory, but they are not currently first-class ebook records.

## Target ebook architecture

```text
                    EBOOK PIPELINE

Kindle / Kobo / loose files / Drive / other owned sources
                         ↓
              acquisition / discovery job
                         ↓
                 /ebooks/incoming
              (download/work area)
                         ↓
             completed-file atomic move
                         ↓
                 /cwa-book-ingest
                         ↓
               Calibre-Web Automated
                 ├─ ingest
                 ├─ metadata
                 ├─ cover
                 ├─ conversion
                 ├─ duplicate handling
                 ├─ original backup
                 └─ Calibre metadata.db
                         ↓
                 /ebooks/library
                         ↓
           library_catalog ingest/indexer
                         ↓
      work → edition → copy representation
                         ↓
    BookBuddy/catalog-platform unified projection
```

### Important staging rule

Acquisition jobs should **not write partially downloaded files directly into the CWA ingest directory**.

Use a work directory such as `/ebooks/incoming`, verify/finish the file there, then move/rename the completed file into `/cwa-book-ingest`. This gives us an atomic handoff and avoids the ingest watcher seeing half-written files.

This is the same class of protection already present in `audiobook_catalog`, where the pipeline has a minimum-file-age guard and treats a successful completed move as evidence that the producer is finished.

## CWA is not the OpenAudible acquisition equivalent

This distinction is load-bearing.

OpenAudible currently covers both acquisition/sync behavior and audiobook conversion/library behavior. CWA primarily solves the **post-acquisition ebook side**.

It should be thought of as:

```text
OpenAudible library/conversion/organization side
             ≈
Calibre-Web Automated
```

It is **not**, by itself:

```text
Amazon/Kindle account
      ↓
automatically obtain every new purchase
```

The missing component is an acquisition/discovery layer for the owner's ebook sources.

For Kindle specifically, the broader design already calls for phase-0 verification of the available owner-library paths before code is written. Keep that gate. Do not build `library_catalog` around an assumed Amazon workflow.

The acquisition layer must stay source-specific and legally/technically separable from CWA. The contract to CWA should simply be a completed supported ebook file plus whatever provenance metadata we can preserve.

## Proposed Docker separation

Do not mount the audiobook and ebook libraries onto the same writable path.

Suggested host layout:

```text
bookbuddy/
├── audiobook_catalog/
├── library_catalog/
└── runtime/
    ├── openaudible/
    │   └── books/
    └── ebooks/
        ├── incoming/
        ├── cwa-ingest/
        ├── calibre-library/
        ├── cwa-config/
        └── originals/
```

Conceptual Compose services:

```text
openaudible              # existing, audiobook_catalog
openaudible-scheduler    # existing, audiobook_catalog
audiobook-sync           # existing, audiobook_catalog

cwa                      # new ebook library/processor
ebook-acquire-*          # future, source-specific; may be scheduled jobs
library-catalog-ingest   # future, projects CWA/ebook state into library_catalog
```

Do not make CWA's `metadata.db` the only copy of BookBuddy-specific state. `library_catalog` owns its own domain model.

## Data ownership

The existing `library_catalog` design remains:

```text
work
  title · author(s) · series · series_index · first_published
  └─ edition
       isbn13? · asin? · format · publisher · year · pages · cover
       └─ copy
            condition · location · acquired · lent_to · read_state · notes
```

CWA/Calibre is a **media-library engine**, not the canonical domain database for all of those concepts.

Recommended mapping:

| Concern | Canonical owner |
|---|---|
| Ebook binary | CWA Calibre library |
| Ebook format(s) | CWA + projected into `edition` |
| Embedded ebook metadata | CWA-managed file, projected/imported |
| ISBN / ASIN / edition identity | `library_catalog` |
| Work/edition relationship | `library_catalog` |
| Physical copies | `library_catalog` |
| Read state / shelf location / lending | `library_catalog` |
| Audiobook-specific metadata | `audiobook_catalog` |
| Unified presence across media | catalog-platform/index projection |

## Unified BookBuddy behavior

Long-term, a work should be able to show every owned representation without merging the two catalog codebases.

Example:

```text
Brandon Sanderson
└── Mistborn: The Final Empire
    ├── 📖 Hardcover
    │    └── ISBN / shelf / condition
    ├── 📖 Ebook
    │    ├── EPUB
    │    └── managed by CWA
    └── 🎧 Audiobook
         ├── M4B
         ├── narrator
         └── duration
```

`library_catalog` should therefore treat ebooks as **first-class editions/copies**, not as `companion_files` attached to an audiobook.

The existing audiobook companion-file feature remains useful for discovery: the ebook ingest phase should scan/reconcile those distinct EPUB/PDF/MOBI/AZW3 files and promote real books into first-class `library_catalog` records.

## Integration contract to design

Do not tightly couple `library_catalog` directly to CWA internals until the first container is running and its real library/database behavior has been measured.

Preferred direction:

1. CWA owns `/ebooks/calibre-library`.
2. `library_catalog` gets **read-only** access to that library or a generated export.
3. An ingest/index job reads the Calibre records plus ebook files and maps them to `work` / `edition` / `copy`.
4. Identity is reconciled using ISBN when present; otherwise `(normalized title, normalized primary author)` with the matcher defined in the main system design.
5. `library_catalog` stores the CWA/Calibre book identifier as an external reference so future updates are idempotent.
6. BookBuddy-specific writes do not mutate Calibre's SQLite database directly.

Prefer a supported CLI/API/export boundary over direct SQLite writes. Reading `metadata.db` may be acceptable for indexing after validation, but direct writes are off-limits unless CWA/Calibre explicitly supports that path.

## Scheduling model

The ebook side should eventually follow the same autonomous pattern as the audiobook side:

```text
scheduled source check
        ↓
new owned ebook discovered
        ↓
acquire/export to incoming
        ↓
completed move to CWA ingest
        ↓
CWA normalization
        ↓
library_catalog reconciliation
        ↓
unified index refresh
        ↓
status/notification
```

Do not force all source checks onto one cadence. CWA should stay continuously available while source-specific acquisition jobs can be cron/scheduler jobs.

## Network storage / Windows note

The current household workflow uses Docker and may involve Windows/Docker Desktop and/or network-backed storage.

CWA currently documents:

- normal local-disk operation using SQLite WAL and filesystem watching;
- `NETWORK_SHARE_MODE=true` for NFS/SMB, which changes WAL/ownership behavior and uses polling;
- automatic preference for polling on Docker Desktop where host-mounted filesystem events may not propagate reliably;
- `CWA_WATCH_MODE=poll` as an explicit polling override.

When deployed, choose the mode based on the **actual location of `calibre-library` and `cwa-ingest`**, not just the host OS.

## What not to build

Until a measured gap appears, do **not** spend `library_catalog` effort recreating:

- generic ebook format conversion;
- a watched ingest folder;
- Calibre library file organization;
- generic ebook metadata editing;
- ebook browser reading;
- OPDS;
- Kobo sync;
- generic send-to-eReader;
- duplicate-management UI;
- backup of pre-conversion originals.

CWA already exists to cover those responsibilities. `library_catalog` should spend custom code on the parts that are specific to this household: ownership, physical + ebook reconciliation, edition identity, scanning, research, cross-media joins, and the unified BookBuddy experience.

## Phase-0 / next implementation checks

Before adding CWA to the production Compose stack:

1. Bring up CWA with throwaway volumes.
2. Import a small test set: EPUB, AZW3/MOBI if available, PDF, and at least one existing audiobook companion EPUB.
3. Observe exact filesystem layout and `metadata.db` identifiers after ingest.
4. Confirm metadata/cover behavior and conversion settings we actually want.
5. Confirm duplicate behavior with two editions/formats of the same work.
6. Test polling behavior using the real Docker Desktop/NAS mount arrangement.
7. Decide which fields `library_catalog` imports versus treats as CWA-owned.
8. Verify the Kindle owner-library acquisition path from the main design before automating it.
9. Only then add the permanent Compose service and reconciliation job.

## Sources / verification

Verified 2026-08-09 against:

- <https://github.com/crocodilestick/Calibre-Web-Automated>
- <https://github.com/janeczku/calibre-web>
- <https://manual.calibre-ebook.com/generated/en/cli-index.html>
- <https://github.com/skymitch9/audiobook_catalog/blob/main/docker-compose.sync.yml>
- <https://github.com/skymitch9/audiobook_catalog/blob/main/scripts/sync_to_drive.py>
- <https://github.com/skymitch9/audiobook_catalog/blob/main/app/metadata.py>
- <https://github.com/skymitch9/catalog-platform/blob/main/docs/LIBRARY_CATALOG.md>

Re-verify CWA details before implementation if this document is materially old; it is an actively developed external project.
