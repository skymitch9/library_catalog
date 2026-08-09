#!/bin/bash
set -e

echo "=== Ebook Indexer (Docker) ==="
echo "Started at: $(date)"

# --- Required configuration ---
#
# Fail loudly and immediately rather than starting a cron that will fail once an
# hour into a log nobody reads. The audiobook entrypoint does the same thing with
# GITHUB_TOKEN, and for the same reason.
if [ -z "$LIBRARY_API_BASE" ]; then
    echo "  [ERROR] LIBRARY_API_BASE not set — nowhere to publish to."
    echo "  Add to .env: LIBRARY_API_BASE=https://library-catalog.<subdomain>.workers.dev"
    exit 1
fi

if [ -z "$LIBRARY_API_TOKEN" ]; then
    echo "  [ERROR] LIBRARY_API_TOKEN not set — cannot authenticate to the Worker."
    echo "  See docs/access/deploy.md."
    exit 1
fi

if [ ! -f "${CALIBRE_LIBRARY:-/calibre-library}/metadata.db" ]; then
    echo "  [ERROR] No metadata.db under ${CALIBRE_LIBRARY:-/calibre-library}."
    echo "  Calibre-Web Automated has not built a library yet, or the bind mount"
    echo "  points somewhere else. Start CWA and ingest at least one book first."
    exit 1
fi

echo "  Publishing to: ${LIBRARY_API_BASE}"
echo "  Calibre library: ${CALIBRE_LIBRARY:-/calibre-library}"
if [ "${DRY_RUN:-1}" = "1" ]; then
    echo "  [DRY RUN] Nothing will be written. Set EBOOK_SYNC_DRY_RUN=0 to publish."
fi

# --- Pass environment variables to cron ---
# cron gets a near-empty environment, so anything the scripts read has to be
# written out here. This exact step was needed in the audiobook pipeline too.
env | grep -E '^(LIBRARY_API_|CALIBRE_LIBRARY|SYNC_DATA_DIR|DRY_RUN|TZ|PATH|HOME|PYTHONPATH)' > /etc/environment

# --- Run once immediately on container start ---
echo ""
echo "=== Running initial index... ==="
python scripts/index_cwa_library.py 2>&1 | tee /var/log/ebook-sync/index.log
echo ""
echo "=== Initial index complete. Starting hourly cron... ==="
echo "  Schedule: index at :15, audit at :45"
echo "  Logs: docker compose -f docker-compose.ebooks.yml logs -f"
echo ""

exec cron -f
