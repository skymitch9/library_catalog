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

---

# Operating layer — built 2026-08-09

> The sections above are the decision. This section is the **concrete parallel of
> the audiobook process**, added because the owner asked for the two pipelines to
> operate the same way rather than merely to resemble each other on a diagram.
>
> ⚠️ **Status: written, typechecked, and NEVER RUN.** No image has been pulled,
> no container started, and no CWA library exists on this machine. The Worker
> half *is* exercised — see "What was verified" below.

## The 1:1 mapping

| `audiobook_catalog` | `library_catalog` | Role |
|---|---|---|
| `openaudible` | `calibre-web-automated` | the library engine; owns the files |
| `openaudible-scheduler` | `ebook-ingest-watcher` | keeps it fed |
| `audiobook-sync` | `ebook-sync` | publishes into the catalog |
| `docker-compose.sync.yml` | `docker-compose.ebooks.yml` | same profiles, same log rotation |
| `Dockerfile.sync` | `Dockerfile.sync` | cron in the container |
| `docker-entrypoint.sh` | `docker-entrypoint.sh` | validate config, run once, then cron |
| `scripts/sync_to_drive.py` | `scripts/index_cwa_library.py` | the publish step |
| `MIN_FILE_AGE_SECONDS` | `MIN_FILE_AGE_SECONDS` | "is the producer finished?" |
| upload manifest in a named volume | `cwa_manifest.json` in a named volume | idempotent re-runs |
| cron at `:00` and `:30` | cron at `:15` and `:45` | offset on purpose — same disk |

Everything carried across was carried across because it already earns its keep in
the audiobook pipeline, not because symmetry is pretty.

## ⚠️ The three places the parallel deliberately breaks

**1. Publishing is an API call, not a git push.** The audiobook site is static and
built from its repo, so its sync container holds a `GITHUB_TOKEN` and commits.
This catalog is a Worker over D1. `Dockerfile.sync` here installs **no git** and
the container is given **no GitHub credentials** — a background process with push
rights to a repo it never needs is a standing risk for no benefit.

**2. The library mount is read-only.** The audiobook sync mounts its library
read-write because `audit_drive_vs_local.py` restores missing files from Drive.
Nothing in the ebook pipeline needs to write to the library — CWA owns those
files — so nothing in it gets permission to.

**3. Authentication is a scoped shared secret, not a user identity.** The indexer
is a cron with no browser and no Google session; it cannot hold a Firebase ID
token. `EBOOK_INGEST_TOKEN` unlocks exactly one route. See below.

## `POST /api/ingest/ebook`

The one endpoint mounted **outside** the Firebase auth middleware. Everything
about it is narrowed to make that acceptable:

| Property | Why |
|---|---|
| Unset token ⇒ the route **404s**, not 401s | the failure direction matters more than the feature; a 404 also invites less guessing |
| Constant-time secret comparison | `===` on a secret leaks its length, and eventually its content |
| Creates a work and an **ebook** edition. Nothing else | no reads, no copies, no reviews, no users — a leaked token cannot exfiltrate the collection because nothing here returns it |
| Physical formats refused at the schema | a cron that can silently add hardcovers is a worse thing to leak |
| **`work_key` is recomputed server-side** | the indexer sends its own so drift is *visible*, but a drifted Python port must never be able to write keys the rest of the system cannot find |
| It does **not** create a `copy` | a file existing is evidence of a licence; *"we own this"* is a claim about us, and migration 0001's catalog/collection split says a machine does not make those unasked |

## ⚠️ `work_key` is now computed in two languages

`packages/core/src/titles.ts` (TypeScript, authoritative) and
`scripts/index_cwa_library.py` (a port, because the indexer runs in a container
with no Node).

This is the exact shape that has already bitten this household — `audiobook_catalog`
has four author-splitters and two disagree. Here a drift does not throw: it
writes a work whose reviews are invisible and a review whose book cannot be
found, and both look completely normal.

So there is a guard:

```bash
npm run check:fold      # 10 cases, both languages, must be byte-identical
```

**Run it after any change to `normaliseTitle`, `splitAuthors`, `primaryAuthor` or
`workKeyFor`.** `npm test` cannot cover it — that would need a Python
interpreter. Currently passing: 10/10 identical.

## What was verified, and what was not

✅ Verified by running it:

- `POST /api/ingest/ebook` rejects a missing token (401), a wrong token (401),
  and is disabled entirely (404) when `EBOOK_INGEST_TOKEN` is unset.
- It matches an **existing** work by `work_key` rather than duplicating it
  (`createdWork: false` for a book already in the catalog).
- It creates a new work with series data when the book is unknown.
- It refuses a physical format with a 400.
- It surfaces `work_key_mismatch` when the caller's key disagrees with the
  server's.
- The rest of the API is unaffected by mounting a route ahead of the auth
  middleware.
- Python and TypeScript folds agree on all 10 fixture cases.

❌ Not verified — nothing here has run:

- The CWA image, its environment variables, and the directory names
  `/config`, `/calibre-library`, `/cwa-book-ingest`. Taken from CWA's README,
  **not** from a running container.
- `scripts/index_cwa_library.py` against a real Calibre `metadata.db`. The
  column and identifier mappings are from Calibre's documented schema and have
  never met real rows. **Run it with `--audit` and read the output before ever
  setting `EBOOK_SYNC_DRY_RUN=0`.**
- `scripts/ebook_ingest_watcher.py`. The cross-device atomic-move path in
  particular (stage under a dotfile, then rename within the destination
  filesystem) is written from first principles and untested.

## First run, in order

```bash
# 1. Directories the compose file bind-mounts
mkdir -p runtime/ebooks/{config,library,incoming,cwa-book-ingest}

# 2. The library engine alone, and confirm it comes up on 127.0.0.1:8083
docker compose -f docker-compose.ebooks.yml up -d calibre-web-automated

# 3. Ingest one book by hand through the CWA UI, so metadata.db exists

# 4. Set the ingest secret on the Worker and in .env
wrangler secret put EBOOK_INGEST_TOKEN --config apps/worker/wrangler.toml

# 5. Audit BEFORE automating anything
docker compose -f docker-compose.ebooks.yml run --rm ebook-sync \
  python scripts/index_cwa_library.py --audit

# 6. Only once the audit output looks right
docker compose -f docker-compose.ebooks.yml --profile automation up -d
```
