# library_catalog — working rules

Read `docs/HANDOFF.md` first; it holds current state. This file is only the
things that will bite you in the first ten minutes.

## Read these before changing anything load-bearing

| File | Why |
|---|---|
| `docs/info/isbn-ladder.md` | The **measured** hit rates. Two of the original design's assumptions were wrong, and this records which. |
| `docs/info/identity-and-reviews.md` | One Google account across two catalogs, and one review store. The audiobook site does three surprising things; they are all documented there. |
| `migrations/0001_init.sql` | The schema comments carry the reasoning, not just the columns. |

## Committing on Windows

**Always `git commit -F <file>`. Never `-m`.**

This shell is PowerShell. A `-m` message containing double quotes, an em dash,
or a newline gets mangled before git ever sees it — the observed failure is
`error: unknown option`, with the commit silently not happening. Write the
message to a file and pass `-F`.

Related traps, all seen in the sibling Board Game Catalog:

- **PowerShell has no heredocs.** `<<'EOF'` is a parser error, not a quoting
  problem. Use a file, or the Bash tool.
- **Rewriting a source file through PowerShell can corrupt its UTF-8.** A file
  once came back with every `—` as `â€”`. It typechecks, builds and deploys
  clean, so nothing catches it. Sweep with
  `grep -rn 'â€\|Â·\|Ã' --exclude-dir=dist --exclude-dir=node_modules`.
- **wrangler sometimes prints success then exits 255** on Windows — a libuv
  teardown quirk. Read the output, not the exit code.

## Commit, then deploy — in that order

`npm run deploy` refuses a dirty working tree (`scripts/check-clean.mjs`). That
guard exists because production in the sibling project twice ended up running
code that was in no commit. If you genuinely mean it:
`ALLOW_DIRTY_DEPLOY=1 npm run deploy`.

Migrate before deploying, so new code never meets an old schema.

## Verifying anything

`npm run dev:worker` serves the API on `:8787` with **no sign-in** —
`middleware/auth.ts` has a dev bypass gated on `ENVIRONMENT !== 'production'`
and `DEV_EMAIL`, both set in `apps/worker/.dev.vars`. So curl works locally with
no tokens:

```bash
curl -s localhost:8787/api/health
curl -s localhost:8787/api/me
curl -s localhost:8787/api/isbn/9780765326355     # live Open Library
```

`npm test` runs the core rules (26 tests, no framework, via tsx).

Prefer exercising a change locally over reasoning about it. Both real defects
found while building this were found that way and by nothing else: zod silently
**stripping** a stray `rating` instead of rejecting it, and the review backfill
producing keys no print edition could match.

## ⚠️ Two things that are dangerous to touch

**`packages/core` has a load-bearing import order.** `constants.ts` is a leaf,
`schemas.ts` imports it, `index.ts` re-exports both. **Nothing under `src/` may
import from `index.ts`** — doing so reintroduces a cycle that makes `z.enum()`
receive `undefined`, and every write endpoint starts returning 500 with a
misleading message. Typecheck does not catch it.

**`normaliseTitle`, `splitAuthors` and `bookIdFromTitle` are each the ONE
implementation.** They produce stored keys — `work.work_key` and Firestore
document ids. Changing one is a migration, not an edit. `bookIdFromTitle` in
particular is ported verbatim from the audiobook site and keeps the leading
article where `normaliseTitle` strips it; using the wrong one writes a duplicate
review rather than updating the existing one.

## Shape of the code

Entry points stay thin — `apps/worker/src/index.ts` mounts routes and delegates
to `packages/`, so there is exactly one implementation of anything that makes a
decision. If two routes need the same logic it belongs in `packages/`, not
copied.
