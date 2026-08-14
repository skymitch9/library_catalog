# library_catalog — working rules

Read `docs/HANDOFF.md` first; it holds current state. This file is only the
things that will bite you in the first ten minutes.

## Read these before changing anything load-bearing

| File | Why |
|---|---|
| `docs/info/isbn-ladder.md` | The **measured** hit rates. Two of the original design's assumptions were wrong, and this records which. |
| `docs/info/identity-and-reviews.md` | One Google account across two catalogs, and one review store. The audiobook site does three surprising things; they are all documented there. |
| `migrations/0001_init.sql` | The schema comments carry the reasoning, not just the columns. |
| `docs/info/universes.md` | ⚠️ **This repo now depends on a sibling repo to build.** `catalog-platform` owns the shared universe list; `prebuild` / `pretest` / `pretypecheck` fetch it and **fail loudly** if that checkout is missing. Set `CATALOG_PLATFORM_DIR` if yours is not a sibling. |
| `docs/info/estate-auth-shadow.md` | ⚠️ Estate auth is wired in **SHADOW mode** — observe and log, enforce nothing, `ESTATE_CHECK=off` deployed. The canonical module is a second sibling-checkout sync (`sync-estate-auth.mjs`); `packages/estate-auth/generated/` is a build artifact like the universes. Do not build enforcement casually — shadow's clean-log soak is the gate. |

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
`middleware/auth.ts` has a dev bypass gated on `ENVIRONMENT === 'development'`
and `DEV_EMAIL`, both set in `apps/worker/.dev.vars`. So curl works locally with
no tokens:

```bash
curl -s localhost:8787/api/health
curl -s localhost:8787/api/me
curl -s localhost:8787/api/isbn/9780765326355     # live Open Library
```

`npm test` runs the core rules (26 tests, no framework, via tsx).

⚠️ **`wrangler dev` does NOT die with whatever started it, and it leaks badly.**
Killing the shell, the task or the agent that ran `npm run dev:worker` leaves
`wrangler` and its `workerd` child running and still holding the port. Measured
2026-08-13: **212 orphaned processes holding 15.6 GB**, across ~30 leaked dev
servers on ports 8787–8910 — 124 from the main checkout, the rest one per
`.claude/worktrees/agent-*`, because every subagent that started a dev server
left one behind when it finished.

So **stop it by name, not by stopping the caller**:

```bash
# PowerShell. Nothing here is precious — no dev server holds state worth keeping.
Get-Process node,workerd -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq 'workerd' -or (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -match 'wrangler|miniflare|vite' } |
  Stop-Process -Force
```

⚠️ Claude Code itself runs as **`claude.exe`**, not `node.exe`, so a sweep of
node/workerd cannot kill the session — verified by walking the parent chain. Do
still exclude anything matching `kiro|tsserver|extensionHost`: the editor's
language servers *are* node.

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

**`packages/universes` is the only package that depends on another repo.** It is
alone on purpose — `@lc/core` promises "no I/O, safe to import anywhere", and a
build-generated file with cross-repo provenance does not belong inside that
promise. `packages/universes/generated/` is a **gitignored build artifact**;
editing it is lost work, because the next build overwrites it. The editor is
`node tools/universes.mjs` in `catalog-platform`.

**`normaliseTitle`, `splitAuthors` and `bookIdFromTitle` are each the ONE
implementation.** They produce stored keys — `work.work_key` and Firestore
document ids. Changing one is a migration, not an edit. `bookIdFromTitle` in
particular is ported verbatim from the audiobook site and keeps the leading
article where `normaliseTitle` strips it; using the wrong one writes a duplicate
review rather than updating the existing one.

⚠️ **`normaliseUniverseText` is a fourth one and is NOT interchangeable with
these.** It keeps leading articles — the universe list holds `The Cosmere` and
`Cosmere` as deliberately different strings — folds curly apostrophes, and
writes nothing. Reaching for `normaliseTitle` there silently merges two entries
the owner separated.

## Shape of the code

Entry points stay thin — `apps/worker/src/index.ts` mounts routes and delegates
to `packages/`, so there is exactly one implementation of anything that makes a
decision. If two routes need the same logic it belongs in `packages/`, not
copied.
