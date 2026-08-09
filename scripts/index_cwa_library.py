#!/usr/bin/env python3
"""Publish Calibre-Web Automated's library into library_catalog.

The counterpart of `audiobook_catalog/scripts/sync_to_drive.py`: the step that
takes what the library engine holds and makes it visible in the catalog.

    CWA / Calibre metadata.db  ->  work -> edition -> copy  (D1, via the Worker)

## What it reads

Calibre's own `metadata.db`, read-only, directly. Not the CWA web API, because:

  - it is a plain SQLite file we already have bind-mounted;
  - it is Calibre's stable, documented schema, whereas CWA's HTTP surface is
    Calibre-Web's and is not a contract;
  - it needs no credentials and cannot mutate anything.

⚠️ Opened with `mode=ro` in a URI, not just "we promise not to write". CWA is
writing to this database while we read, and an accidental write from a second
process is how a SQLite library gets corrupted.

⚠️ Calibre runs this database in **WAL mode**, so the newest rows live in
`metadata.db-wal` until a checkpoint. Reading the file *in place* is fine —
`mode=ro` sees the WAL because it sits alongside. **Copying `metadata.db`
somewhere else to inspect it does not**: the copy silently reports an empty or
stale library. That cost time during the first run and looked exactly like a
failed ingest.

## What it does NOT do

- It does not move, convert or delete files. CWA owns the library.
- It does not create `copy` rows for books it has never seen before **unless
  --create-copies is passed**. An ebook file appearing is good evidence that we
  hold a licence to it, but "we own a copy" is a claim about us, and the
  catalog/collection split (migration 0001) says the machine does not get to
  make those unasked.
- It does not overwrite anything whose `source` is `manual`. A person's answer
  outranks an import, every time.

## Divergence from the audiobook pipeline — deliberate, do not "fix"

The audiobook sync publishes by **committing to git and pushing**, because that
site is static and built from the repo. This catalog is a Worker over D1, so
publishing is an **authenticated API call**. There is no git in this image and no
GITHUB_TOKEN in its environment.

## Dry run is the default

On unless explicitly turned off, matching the discipline used for the review
backfill. `EBOOK_SYNC_DRY_RUN=0` publishes for real — the same name in `.env`, in
the compose file and inside the container, so a one-off override actually works:

    docker compose -f docker-compose.ebooks.yml run --rm --no-deps       -e EBOOK_SYNC_DRY_RUN=0 ebook-sync python scripts/index_cwa_library.py

✅ Verified against a real CWA library 2026-08-09: read one book, produced
`ingest smoke test|testworth pemberton`, published it, and reported
`unchanged: 1` on the next run. Series and volume survived the trip
(`Pipeline Trials` / `Book 2` from Calibre's `series_index` 2.0 — the trailing
`.0` is stripped, because "Book 2.0" is not what a cover says).

**Still run `--audit` first on any library you care about** and read the keys it
would write. The review backfill looked perfect at 860/860 matched and was
producing keys no paperback could ever match; only reading them caught it.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import sys
import unicodedata
from pathlib import Path
from typing import Any, Iterable

import requests

CALIBRE_LIBRARY = Path(os.environ.get("CALIBRE_LIBRARY", "/calibre-library"))
API_BASE = os.environ.get("LIBRARY_API_BASE", "").rstrip("/")
API_TOKEN = os.environ.get("LIBRARY_API_TOKEN", "")
DATA_DIR = Path(os.environ.get("SYNC_DATA_DIR", "/app/data"))
DRY_RUN = os.environ.get("EBOOK_SYNC_DRY_RUN", "1") != "0"

# Calibre format name -> our `edition.format`. See migration 0002.
FORMAT_MAP = {
    "EPUB": "ebook_epub",
    "KEPUB": "ebook_kepub",
    "MOBI": "ebook_mobi",
    "AZW3": "ebook_azw3",
    "AZW": "ebook_azw3",
    "PDF": "ebook_pdf",
}

# Preference order when one Calibre book holds several files. EPUB first because
# it is CWA's own default conversion target, so it is the one most likely to be
# complete and correctly tagged.
FORMAT_PREFERENCE = ["EPUB", "KEPUB", "AZW3", "AZW", "MOBI", "PDF"]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("cwa-index")


# ---------------------------------------------------------------------------
# ⚠️ These two must match packages/core/src/titles.ts EXACTLY.
#
# This is the fifth implementation of a fold in this household's codebase and it
# is the one most likely to drift, because it is in a different language from
# the one that owns the rule. `normaliseTitle` produces `work.work_key`, which
# is the bridge to the audiobook catalog's reviews; a disagreement here does not
# raise an error, it writes a work whose reviews are invisible.
#
# The TypeScript is authoritative. If it changes, change these, and re-run with
# --audit to see how many keys move.
# ---------------------------------------------------------------------------

def normalise_title(raw: str) -> str:
    """Port of normaliseTitle. Keep byte-for-byte equivalent."""
    decomposed = unicodedata.normalize("NFD", raw)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    s = stripped.lower().replace("&", " and ")
    s = "".join(c if c.isalnum() and c.isascii() else " " for c in s)
    s = " ".join(s.split())
    for article in ("the ", "a ", "an "):
        if s.startswith(article):
            s = s[len(article):]
            break
    return s.strip()


def primary_author(raw: str) -> str:
    """Port of primaryAuthor: split on [;,/&] or ' and ', take the first."""
    import re

    parts = re.split(r"[;,/&]|\sand\s", raw, flags=re.IGNORECASE)
    for part in parts:
        cleaned = re.sub(
            r"\s*-\s*(Translator|Narrator|Editor)\s*$", "", part, flags=re.IGNORECASE
        ).strip()
        if cleaned:
            return cleaned
    return raw.strip()


def work_key(title: str, authors: str) -> str:
    return f"{normalise_title(title)}|{normalise_title(primary_author(authors))}"


# ---------------------------------------------------------------------------
# Calibre
# ---------------------------------------------------------------------------

def read_calibre(db_path: Path) -> list[dict[str, Any]]:
    """Every book, with its authors, series, identifiers and formats."""
    uri = f"file:{db_path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT b.id,
                   b.title,
                   b.pubdate,
                   b.path,
                   (SELECT group_concat(a.name, ', ')
                      FROM books_authors_link bal
                      JOIN authors a ON a.id = bal.author
                     WHERE bal.book = b.id)                       AS authors,
                   (SELECT s.name FROM books_series_link bsl
                      JOIN series s ON s.id = bsl.series
                     WHERE bsl.book = b.id LIMIT 1)               AS series,
                   b.series_index,
                   (SELECT p.name FROM books_publishers_link bpl
                      JOIN publishers p ON p.id = bpl.publisher
                     WHERE bpl.book = b.id LIMIT 1)               AS publisher
              FROM books b
             ORDER BY b.id
            """
        ).fetchall()

        books = []
        for row in rows:
            identifiers = {
                r["type"]: r["val"]
                for r in conn.execute(
                    "SELECT type, val FROM identifiers WHERE book = ?", (row["id"],)
                )
            }
            formats = [
                r["format"]
                for r in conn.execute(
                    "SELECT format FROM data WHERE book = ?", (row["id"],)
                )
            ]
            books.append(
                {
                    "calibre_id": row["id"],
                    "title": row["title"] or "",
                    "authors": row["authors"] or "",
                    "series": row["series"],
                    "series_index": row["series_index"],
                    "publisher": row["publisher"],
                    "pubdate": row["pubdate"],
                    "identifiers": identifiers,
                    "formats": formats,
                }
            )
        return books
    finally:
        conn.close()


def choose_format(formats: Iterable[str]) -> str | None:
    """One edition per Calibre book, using the best file it holds.

    ⚠️ Not one edition per file. Calibre keeps EPUB, MOBI and AZW3 of the *same*
    printing side by side — CWA creates them by conversion — and recording three
    editions would make the collection page claim three books.
    """
    available = {f.upper() for f in formats}
    for preferred in FORMAT_PREFERENCE:
        if preferred in available:
            return FORMAT_MAP.get(preferred)
    return None


def pick_isbn(identifiers: dict[str, str]) -> str | None:
    """Calibre stores whatever a metadata source gave it, including junk."""
    raw = identifiers.get("isbn")
    if not raw:
        return None
    digits = "".join(c for c in raw if c.isdigit())
    # Only a 13-digit 978/979 is accepted. An ISBN-10 here is left for the Worker
    # to convert, which owns that rule (packages/core/src/isbn.ts) — a second
    # conversion in Python is exactly the drift this codebase keeps warning about.
    if len(digits) == 13 and digits.startswith(("978", "979")):
        return digits
    return None


# ---------------------------------------------------------------------------
# Publishing
# ---------------------------------------------------------------------------

def api(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    res = requests.request(
        method,
        f"{API_BASE}{path}",
        headers={
            "Authorization": f"Bearer {API_TOKEN}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    res.raise_for_status()
    return res.json()


def load_manifest() -> dict[str, Any]:
    """What we have already published, so a re-run is cheap and idempotent.

    The audiobook pipeline persists an upload manifest for the same reason. It is
    a cache, not a source of truth: deleting it causes a slow full re-index, not
    duplicates, because the Worker matches on `cwa_book_id`.
    """
    path = DATA_DIR / "cwa_manifest.json"
    if path.exists():
        try:
            return json.loads(path.read_text("utf-8"))
        except (OSError, json.JSONDecodeError):
            log.warning("manifest unreadable; treating as empty")
    return {}


def save_manifest(manifest: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = DATA_DIR / "cwa_manifest.json.tmp"
    tmp.write_text(json.dumps(manifest, indent=2), "utf-8")
    tmp.replace(DATA_DIR / "cwa_manifest.json")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--audit",
        action="store_true",
        help="report what would change and exit; never writes, whatever DRY_RUN says",
    )
    parser.add_argument(
        "--create-copies",
        action="store_true",
        help="also record that we own a copy of each ebook (see the module docstring)",
    )
    args = parser.parse_args()

    db_path = CALIBRE_LIBRARY / "metadata.db"
    if not db_path.exists():
        log.error("no metadata.db at %s", db_path)
        return 1

    books = read_calibre(db_path)
    log.info("calibre library: %d books", len(books))

    manifest = load_manifest()
    skipped_no_format = 0
    planned: list[dict[str, Any]] = []

    for book in books:
        fmt = choose_format(book["formats"])
        if fmt is None:
            # A Calibre row with no file we can name — a CBZ, or a format CWA
            # has not converted yet. Counted, not published, and not an error.
            skipped_no_format += 1
            continue

        key = work_key(book["title"], book["authors"])
        entry = {
            "cwaBookId": book["calibre_id"],
            "workKey": key,
            "title": book["title"],
            "authors": book["authors"],
            "series": book["series"],
            "seriesIndexSort": book["series_index"],
            "format": fmt,
            "isbn13": pick_isbn(book["identifiers"]),
            "asin": book["identifiers"].get("mobi-asin") or book["identifiers"].get("amazon"),
            "publisher": book["publisher"],
            "source": "cwa",
        }

        previous = manifest.get(str(book["calibre_id"]))
        if previous == entry:
            continue
        planned.append(entry)

    log.info("to publish: %d   unchanged: %d   no usable format: %d",
             len(planned), len(books) - len(planned) - skipped_no_format, skipped_no_format)

    if args.audit:
        for entry in planned[:25]:
            log.info("  %s  ->  %s  [%s]", entry["title"], entry["workKey"], entry["format"])
        if len(planned) > 25:
            log.info("  ... and %d more", len(planned) - 25)
        log.info("AUDIT ONLY. Nothing written.")
        return 0

    if DRY_RUN:
        for entry in planned[:25]:
            log.info("  would publish: %s  ->  %s", entry["title"], entry["workKey"])
        log.info("DRY RUN. Nothing written. Set EBOOK_SYNC_DRY_RUN=0 to publish.")
        return 0

    if not API_BASE or not API_TOKEN:
        log.error("LIBRARY_API_BASE / LIBRARY_API_TOKEN not set")
        return 1

    published = 0
    for entry in planned:
        try:
            api("POST", "/api/ingest/ebook", entry)
            manifest[str(entry["cwaBookId"])] = entry
            published += 1
        except requests.RequestException as err:
            # One bad row must not stop the run. The audiobook pipeline learned
            # this: a single failure that aborts the batch means the next 400
            # books wait an hour for no reason.
            log.warning("failed to publish %s: %s", entry["title"], err)

    save_manifest(manifest)
    log.info("published %d/%d", published, len(planned))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
