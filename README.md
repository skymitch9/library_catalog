# library_catalog

A private catalog of owned **physical books and ebooks**, built by scanning them.

Cloudflare Worker + D1 + Firebase Google SSO + a React PWA. A sibling to
`audiobook_catalog`, sharing its identity and its reviews — and a fork in spirit
of `boardbuddy/Board_Game_Catalog`, whose schema, scan queue and camera code this
inherits.

> **Status:** phases 0 and 1 done, phase 2 partly. Runs locally; **nothing is
> deployed**. See [`docs/HANDOFF.md`](docs/HANDOFF.md) for exactly what is built
> and the commands only the owner can run.

## Quick start

```bash
npm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # put your real Google address in it
npm run db:migrate:local
npm run dev            # worker :8787, web :5174
```

```bash
npm test               # 26 core-rule tests
npm run typecheck      # all five workspaces
```

## What is different from the Board Game Catalog

| | Board games | Books |
|---|---|---|
| Barcodes | a weak primitive — 2 of 4 resolved | **near-universal ISBN-13, 9 of 10 resolved** |
| Build order | BGG first, barcode in phase 5 | **barcode first**, vision as the fallback |
| Structure | a tree — base game, expansions, promos | a **series column**; books have no expansions |
| Matching | title alone | **(title, author)** — book titles collide constantly |
| Identity | Cloudflare Access | **Firebase Google SSO**, shared with `audiobook_catalog` |
| Ratings | D1 `user_item` | **Firestore**, the same documents the audiobook site writes |

## The three things worth knowing before reading the code

1. **Open Library is excellent by ISBN and covers about half this library by
   title.** The missing half is Kindle Unlimited and Audible-native indie
   fiction with no ISBN anywhere. A title miss is expected, not an error.
2. **A wrong ISBN returns a confident, well-formed, wrong book.** Nothing in the
   response marks it. Every scan is a proposal a person confirms.
3. **Reviews are shared, not synced.** One Firestore collection, both sites,
   joined on a `workKey` that carries the author — because the audiobook site's
   own key does not, and cannot reach a print edition.

All three are measured, not assumed:
[`docs/info/isbn-ladder.md`](docs/info/isbn-ladder.md) ·
[`docs/info/identity-and-reviews.md`](docs/info/identity-and-reviews.md)

## Layout

```
packages/
  core/    zod schemas, ISBN rules, title folding, (title,author) matching — no I/O
  db/      D1 queries + the derived-column rules
  isbn/    the ladder: Open Library, then Google Books (key required)
apps/
  worker/  Hono routes, thin — mounts and delegates
  web/     React PWA; camera.ts and scanner.ts ported from the board game catalog
migrations/  D1 schema; the comments carry the reasoning
docs/{access,info}/
scripts/   check-clean, review backfill
```

## Design documents

The system design lives outside this repo and is not duplicated here:

- [`catalog-platform/docs/LIBRARY_CATALOG.md`](../../catalog-platform/docs/LIBRARY_CATALOG.md)
  — what ports, what must change, the book-specific traps.
  ⚠️ Its §1 and §7 were *knowledge, not measurement*; `docs/info/isbn-ladder.md`
  is the measurement, and it contradicts the design in two places.
- [`catalog-platform/docs/PLATFORM.md`](../../catalog-platform/docs/PLATFORM.md)
  — how three catalogs are presented as one site without merging any of them.
