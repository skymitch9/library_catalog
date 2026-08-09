#!/usr/bin/env python3
"""Move finished ebook downloads into Calibre-Web Automated's watched folder.

The counterpart of `audiobook_catalog/scripts/openaudible_scheduler.py`: a small
controller that keeps the library engine fed, and does nothing else.

## Why this exists at all, when CWA already watches a folder

Because the thing CWA watches must only ever contain *finished* files.

An acquisition job writing straight into `/cwa-book-ingest` will be seen
mid-write, and CWA will ingest a truncated EPUB — which then has to be found and
removed by hand, because from its point of view the ingest succeeded. So
downloads land in `/incoming`, and this moves them across once they have stopped
changing.

`MIN_FILE_AGE_SECONDS` is lifted from the audiobook pipeline, where the same
guard exists for the same reason: **a downloader that is still writing looks
exactly like a downloader that has stopped.** Size-stability is checked as well
as age, because a slow or resumed download can be quiet for longer than the
threshold and then continue.

## Why polling rather than inotify

CWA's own documentation notes that `inotify` is unreliable on Docker Desktop and
host-mounted filesystems, which is exactly this setup. Polling every 60 seconds
costs nothing on a directory that is usually empty, and it works everywhere.

⚠️ NEVER RUN. Written 2026-08-09 alongside the compose file; no container has
started it.
"""

from __future__ import annotations

import logging
import os
import shutil
import sys
import time
from pathlib import Path

INCOMING = Path(os.environ.get("INCOMING_DIR", "/incoming"))
INGEST = Path(os.environ.get("INGEST_DIR", "/cwa-book-ingest"))
MIN_AGE = int(os.environ.get("MIN_FILE_AGE_SECONDS", "300"))
POLL = int(os.environ.get("POLL_INTERVAL_SECONDS", "60"))

# What CWA can ingest. Anything else is left where it is rather than moved and
# rejected — a file sitting in `incoming/` is a visible question; a file rejected
# inside CWA is a silent one.
EBOOK_SUFFIXES = {".epub", ".mobi", ".azw3", ".azw", ".kepub", ".pdf", ".cbz", ".cbr"}

# Suffixes downloaders use for work-in-progress. Skipped outright, whatever their
# age — a `.part` file that has been abandoned for an hour is still not a book.
PARTIAL_SUFFIXES = {".part", ".crdownload", ".tmp", ".download", ".!ut"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("ingest-watcher")

# path -> (size, first time we saw it at this size)
_seen: dict[Path, tuple[int, float]] = {}


def is_settled(path: Path, now: float) -> bool:
    """True when the file has been the same size for MIN_AGE seconds."""
    try:
        size = path.stat().st_size
    except OSError:
        return False

    if size == 0:
        return False

    previous = _seen.get(path)
    if previous is None or previous[0] != size:
        # New, or still growing. Restart the clock.
        _seen[path] = (size, now)
        return False

    return (now - previous[1]) >= MIN_AGE


def unique_destination(name: str) -> Path:
    """Never overwrite. CWA does duplicate detection; clobbering pre-empts it."""
    dest = INGEST / name
    if not dest.exists():
        return dest
    stem, suffix = Path(name).stem, Path(name).suffix
    for n in range(2, 1000):
        candidate = INGEST / f"{stem} ({n}){suffix}"
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"could not find a free name for {name}")


def sweep() -> None:
    now = time.time()

    for path in sorted(INCOMING.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() in PARTIAL_SUFFIXES:
            continue
        if path.suffix.lower() not in EBOOK_SUFFIXES:
            continue
        if not is_settled(path, now):
            continue

        dest = unique_destination(path.name)
        try:
            # shutil.move rather than Path.rename: `incoming` and the ingest
            # folder are separate bind mounts and may be different filesystems,
            # where rename() fails with EXDEV.
            #
            # ⚠️ On a cross-device move this is copy-then-delete, which means the
            # destination grows while CWA is watching it — the exact problem this
            # script exists to prevent. So it lands under a dot-prefixed name
            # first and is renamed within the destination filesystem, which IS
            # atomic. CWA ignores dotfiles.
            staged = dest.with_name("." + dest.name)
            shutil.move(str(path), str(staged))
            staged.rename(dest)
            _seen.pop(path, None)
            log.info("ingested %s (%.1f MB)", dest.name, dest.stat().st_size / 1e6)
        except OSError as err:
            # Never fatal. A single unreadable file must not stop the watcher —
            # the audiobook pipeline learned the same lesson.
            log.warning("could not move %s: %s", path.name, err)

    # Drop bookkeeping for files that have gone, so the dict cannot grow forever.
    for path in list(_seen):
        if not path.exists():
            _seen.pop(path, None)


def main() -> int:
    log.info("watching %s -> %s", INCOMING, INGEST)
    log.info("min age %ss, poll every %ss", MIN_AGE, POLL)

    if not INCOMING.is_dir():
        log.error("%s does not exist — check the bind mount", INCOMING)
        return 1
    if not INGEST.is_dir():
        log.error("%s does not exist — check the bind mount", INGEST)
        return 1

    while True:
        try:
            sweep()
        except Exception:  # noqa: BLE001 - a crash here stops all ingest
            log.exception("sweep failed; continuing")
        time.sleep(POLL)


if __name__ == "__main__":
    raise SystemExit(main())
