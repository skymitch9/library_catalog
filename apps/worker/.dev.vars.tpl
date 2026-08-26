# apps/worker/.dev.vars.tpl — GENERATED. Names + op:// pointers, never values.
#
# ⚠️ This file is TRACKED and this repo is PUBLIC. Every line below is a NAME
# and a POINTER into the 1Password vault `Estate`. Nothing here is secret.
#
# Regenerate `.dev.vars` from the vault:
#   op inject -i apps/worker/.dev.vars.tpl -o apps/worker/.dev.vars
#   npm run secrets:push                  # …then push
#   rm apps/worker/.dev.vars              # …then DELETE it again
#
# Or never touch the disk at all — the push reads the vault directly:
#   npm run secrets:push:op
#
# Regenerate THIS file (after adding a key to the vault):
#   node scripts/op-import-dev-vars.mjs --write-template
#
# ⚠️ The blank lines at the bottom are DROP-BOXES, not gaps. A filled
# drop-box is an unfinished operation, never storage — pipe it, then blank it.

ENVIRONMENT={{ op://Estate/library.ENVIRONMENT/password }}
DEV_EMAIL={{ op://Estate/library.DEV_EMAIL/password }}
DEV_NAME={{ op://Estate/library.DEV_NAME/password }}
GOOGLE_BOOKS_API_KEY={{ op://Estate/GOOGLE_BOOKS_API_KEY/password }}
LIBRARYTHING_API_KEY={{ op://Estate/LIBRARYTHING_API_KEY/password }}
ANTHROPIC_API_KEY={{ op://Estate/library.ANTHROPIC_API_KEY/password }}
EBOOK_INGEST_TOKEN={{ op://Estate/EBOOK_INGEST_TOKEN/password }}
ESTATE_CHECK={{ op://Estate/library.ESTATE_CHECK/password }}
GABI_PANEL={{ op://Estate/library.GABI_PANEL/password }}
HARDCOVER_API_TOKEN={{ op://Estate/HARDCOVER_API_TOKEN/password }}
PEER_TOKEN={{ op://Estate/PEER_TOKEN/password }}
INDEX_READ_TOKEN={{ op://Estate/library.INDEX_READ_TOKEN/password }}
DONOR_TOKEN={{ op://Estate/DONOR_TOKEN/password }}

# Drop-boxes — deliberately empty, deliberately NOT in the vault.
ANTHROPIC_API_KEY_FRIEND_SAM=
CLOUDFLARE_API_TOKEN_CI=
INDEX_READ_TOKEN_FRIEND_PADHARD=
