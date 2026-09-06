# Rollback points — library_catalog   (Access Reference)

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-16** — moved verbatim from `docs/TODO.md`; the ids
> below carry their own dates and were not re-verified against Cloudflare on
> that date.

The 3am "put it back" reference. Deploys also append to `docs/deploys.log`
(timestamp / commit / holder), which is the newer and more complete record —
prefer it, and treat this file as the annotated history behind it.

## Rollback points

The user permits pushing straight to `main` while this site is pre-release, **on
condition that a rollback id is recorded**. Contrast the board game catalog,
which has real users now and where changes are "more damning".

| Date | Pushed | Roll back to | Worker version |
|---|---|---|---|
| 2026-08-10 | `4d19ae4` — five agent branches, covers, formats | `c75d174` | `86e453ed` |
| 2026-08-11 | `3848593` — collector's-edition and bare-ebook format rules | `bb836dd` | `444d4562` |
| 2026-08-11 | `75e650f` — cover status, watches, upload path, migration `0040` | **`3848593`** | **`05fdf2e3`** |
| 2026-09-06 | `888ffbe` — the two STANDING AUDITS become routes + a daily cron, migration `0480` | **`235010f`** (main) / **`b1fb406`** (friend) | main `eadd16b6-143b-4a81-a492-9b4598ef5cac` → back to **`b547095d-4ec4-4cd6-b586-d40467f28e62`**; friend `0408aa25-e757-4b07-b02c-34b25259b578` → back to **`9b2b64d2-cffa-4a1d-abcb-7193694b1e31`** |

To undo the code: `git reset --hard c75d174 && git push --force-with-lease`.
⚠️ **That does not undo the database.** Migrations `0013`, `0020` and `0021` are
applied to production and are additive; leaving them in place is safe and is the
right call. The 99 board-book format corrections and the 40 audiobook holdings
are data changes with no down-migration — re-running the scripts is the remedy,
not a revert.

To roll the Worker back without touching git, redeploy a prior version id from
the Cloudflare dashboard.

### 🔴 2026-09-06, the audits — you almost certainly do NOT want a version rollback

Both audits are **read-only**: they write nothing to any catalog table, ever.
So the thing you would roll back for — a bad write — cannot have happened.
**The proportionate rollback is one edit:** delete `"47 9 * * *"` from BOTH
`[triggers]` blocks in `apps/worker/wrangler.toml` and `npm run deploy:both`.
That stops the clock and leaves the routes, the table and the `/api/health`
keys reporting the last run forever, which is honest and costs nothing.
Runbook: [`audits.md`](audits.md) §4.

⚠️ **Migration `0480` is not rolled back either.** `audit_run` is bookkeeping
about the audits and holds no catalog data; dropping it would gain nothing and
lose the history.

---
