#!/usr/bin/env python3
"""Feed CWA the ebooks that already sit beside the audiobooks.

This is the **acquisition stage for the books you already have**, and for this
household it is by far the biggest one: measured 2026-08-09 against
`C:\\Users\\nbasl\\OpenAudible\\books` — **83 EPUB and 30 PDF files across 7
author directories**, none of them catalogued anywhere.

    OpenAudible/books/<Author>/<something>.epub
        └─(copy, never move)─> /cwa-book-ingest/<Title> - <Author>.epub
                                    └─> CWA ingest ─> Calibre ─> library_catalog

## ⚠️ It COPIES. It never moves, and the source is mounted read-only.

Those files belong to the audiobook library. `app/metadata.py` in
`audiobook_catalog` scans for `.pdf/.epub/.mobi/.azw3` *beside* each audiobook and
writes them into the `companion_files` CSV column, so moving one out silently
changes that catalog's output. The mount is `:ro` so the mistake cannot even be
made by a later edit to this file.

## Why the path is the metadata

Phase 0 measured that roughly half this library has no Open Library record at
all, and the misses are overwhelmingly the KU/Audible-native indie titles. The
authors here are exactly that population — Dakota Krout, Selkie Myth,
Michael-Scott Earle. **There is no lookup to fall back on.** So the directory
name is the author and the filename is the title, and getting that mapping right
matters more here than any enrichment step downstream.

Files are copied out as `Title - Author.epub` because that is the convention
Calibre's own filename parser reads, which means CWA gets the right answer even
when a file's embedded metadata is empty or wrong — and for
`Dragonsteel_Prime_by_Brandon_Sanderson.epub` it very often is.

## What it does NOT do

- No DRM handling of any kind. Every file here is one you already hold, DRM-free,
  on your own disk.
- It does not touch `audiobook_catalog`'s database, CSV or site.
- It does not decide you *own* a copy — that is `copy`, and migration 0001 says a
  machine does not make claims about us unasked. The indexer creates work and
  edition rows only.

## Running it

    python scripts/scan_audiobook_companions.py            # dry run, prints a plan
    python scripts/scan_audiobook_companions.py --commit   # copies into the ingest folder
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import shutil
import sys
from pathlib import Path

AUDIOBOOK_LIBRARY = Path(os.environ.get("AUDIOBOOK_LIBRARY", "/audiobooks"))
INGEST_DIR = Path(os.environ.get("INGEST_DIR", "/cwa-book-ingest"))
DATA_DIR = Path(os.environ.get("SYNC_DATA_DIR", "/app/data"))

# PDFs are deliberately NOT included by default. Calibre will happily ingest a
# PDF, and the result is a library row whose "book" is a scanned map, a
# character sheet or a Kickstarter art insert — which is what most of the 30 PDFs
# beside these audiobooks actually are. `--include-pdf` if you disagree.
DEFAULT_SUFFIXES = {".epub", ".mobi", ".azw3", ".kepub"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("companions")


def title_from_filename(path: Path, author: str = "") -> str:
    """Recover a human title from an Audible-adjacent filename.

    These are not tidy. Real examples from the shelf:

        Dragonsteel_Prime_by_Brandon_Sanderson.epub
        Isles_of_the_Emberdark_by_Brandon_Sanderson_for_Kindle.epub
        legion_skindeep.epub
        firstborn_defendingelysium.epub

    The first two are recoverable exactly. The last two are not — no rule turns
    `legion_skindeep` into "Legion: Skin Deep", and inventing one would produce
    confident nonsense. They come out as "Legion Skindeep", which is wrong but
    *visibly* wrong and fixable in CWA, rather than silently wrong.

    ## ⚠️ Measured 2026-08-09: these rules matter LESS than they look

    All 83 files went through CWA, and **CWA overrode almost every title here
    from the EPUB's own embedded metadata**. Zero `BtDEM ...` titles survived
    into the catalog — they came out as "Oathbound Healer", "Ranger's Dawn",
    "Adventures in the Argo". The filename is a *fallback*, used only where the
    embedded metadata is empty or junk.

    So resist elaborating the rules below. A filename heuristic that fights CWA's
    metadata step is effort spent on a value that gets replaced, and every extra
    rule is another chance to be confidently wrong on the minority of files where
    the fallback actually applies.

    Three things are deliberately NOT fixed, because every rule for them
    guesses:

    - **Series abbreviations.** `BtDEM 1 Oathbound Healer` is Beneath the
      Dragoneye Moons book 1. Expanding "BtDEM" needs knowledge of the series,
      not a regex, and a wrong expansion is worse than an ugly one.
    - **Series filed as the author.** OpenAudible has directories named
      `Seirei Tsukai no Blade Dance` and `Highschool DXD` — those are series, not
      authors, and this scanner will faithfully report them as authors because
      that is what the shelf says. Fix in CWA, or in the audiobook library.
    - **`Copy Of ...` duplicates.** Left in; CWA does duplicate detection and is
      better placed to decide than a filename heuristic.
    """
    stem = path.stem

    # "..._for_Kindle" / "..._Kindle" — a distribution tag, never part of a title.
    stem = re.sub(r"[_\s-]+(for[_\s-]+)?kindle$", "", stem, flags=re.IGNORECASE)
    # "..._by_Brandon_Sanderson" — the author, which we already know from the dir.
    stem = re.sub(r"[_\s-]+by[_\s-]+.+$", "", stem, flags=re.IGNORECASE)

    # A trailing release stamp: "..._Selkie_Myth_20250106". Eight digits at the
    # end of a filename is a date, not a book. Real, and on 13 files here.
    stem = re.sub(r"[_\s-]+(19|20)\d{6}$", "", stem)

    # The author's own name repeated in the filename, which we already have from
    # the directory. "BtDEM 1 Oathbound Healer Selkie Myth" -> "BtDEM 1 Oathbound
    # Healer". Only stripped from the END, and only when it matches the directory
    # we are already trusting — a name appearing mid-title is left alone.
    if author:
        pattern = r"[_\s-]+" + r"[_\s-]+".join(re.escape(w) for w in author.split()) + r"$"
        stem = re.sub(pattern, "", stem, flags=re.IGNORECASE)

    words = re.split(r"[_\s]+", stem.replace("-", " ").strip())
    words = [w for w in words if w]
    if not words:
        return path.stem

    # Title-case only all-lower or all-upper words; leave MixedCase alone, since
    # a name like "McKenna" or "DXD" is already right and .title() would break it.
    out = []
    for w in words:
        out.append(w.capitalize() if (w.islower() or w.isupper()) else w)
    return " ".join(out)


def safe_filename(name: str) -> str:
    """Windows-safe, and no path separators — this becomes a real filename."""
    cleaned = re.sub(r'[<>:"/\\|?*]', "", name)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned[:150] or "Untitled"


def load_manifest() -> dict:
    path = DATA_DIR / "companions_manifest.json"
    if path.exists():
        try:
            return json.loads(path.read_text("utf-8"))
        except (OSError, json.JSONDecodeError):
            log.warning("manifest unreadable; treating as empty")
    return {}


def save_manifest(manifest: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = DATA_DIR / "companions_manifest.json.tmp"
    tmp.write_text(json.dumps(manifest, indent=2), "utf-8")
    tmp.replace(DATA_DIR / "companions_manifest.json")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", action="store_true", help="actually copy the files")
    parser.add_argument("--include-pdf", action="store_true", help="also copy PDFs")
    args = parser.parse_args()

    if not AUDIOBOOK_LIBRARY.is_dir():
        log.error("audiobook library not found at %s", AUDIOBOOK_LIBRARY)
        return 1
    if args.commit and not INGEST_DIR.is_dir():
        log.error("ingest folder not found at %s", INGEST_DIR)
        return 1

    suffixes = set(DEFAULT_SUFFIXES)
    if args.include_pdf:
        suffixes.add(".pdf")

    manifest = load_manifest()
    planned, skipped, copied = [], 0, 0

    for path in sorted(AUDIOBOOK_LIBRARY.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in suffixes:
            continue

        # The immediate parent is the author directory in OpenAudible's layout.
        # A file directly under the root has no author to read; take it anyway
        # and let CWA's own metadata step try, rather than dropping it silently.
        try:
            rel = path.relative_to(AUDIOBOOK_LIBRARY)
        except ValueError:
            continue
        author = rel.parts[0] if len(rel.parts) > 1 else ""

        key = str(rel).replace("\\", "/")
        stat = path.stat()
        entry = {"size": stat.st_size, "author": author}
        if manifest.get(key) == entry:
            skipped += 1
            continue

        title = title_from_filename(path, author)
        dest_name = safe_filename(f"{title} - {author}" if author else title) + path.suffix.lower()
        planned.append((path, INGEST_DIR / dest_name, key, entry, title, author))

    log.info(
        "found %d new ebook file(s) beside the audiobooks; %d already handled",
        len(planned),
        skipped,
    )

    for src, dest, key, entry, title, author in planned:
        if not args.commit:
            log.info("  would copy: %s", dest.name)
            continue
        try:
            if dest.exists():
                log.info("  already in ingest, skipping: %s", dest.name)
            else:
                # Stage under a dotfile then rename, so CWA's watcher never sees
                # a partially-copied file — the same guard the incoming/ watcher
                # uses, and it matters more here because these can be large.
                staged = dest.with_name("." + dest.name)
                shutil.copy2(src, staged)
                staged.rename(dest)
                log.info("  copied: %s", dest.name)
            manifest[key] = entry
            copied += 1
        except OSError as err:
            log.warning("  failed %s: %s", src.name, err)

    if args.commit:
        save_manifest(manifest)
        log.info("copied %d file(s) into %s", copied, INGEST_DIR)
    else:
        log.info("DRY RUN. Nothing copied. Re-run with --commit.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
