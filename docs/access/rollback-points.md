# Rollback points — library_catalog   (Access Reference)

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-09-06** for the NEW 2026-09-06 `c19fbbf` row ONLY — the
> four version ids in it were read off `npx wrangler deployments list` (each
> env) and the deploy output on the day. ⚠️ No other row was re-verified.
> Last verified before that: **2026-09-05** for the 2026-09-05 row ONLY — both version
> ids were read off `npx wrangler deployments list` (each env) BEFORE the
> deploy pair, and the new ids off the deploy output. ⚠️ No older row was
> re-verified against Cloudflare.
> Last verified before that: **2026-08-16** — moved verbatim from
> `docs/TODO.md`; the ids below carry their own dates and were not
> re-verified against Cloudflare on that date.

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
| 2026-09-05 | `b2c9931` — `series_volume`/`series_check` refreshed by the SAME audiobook cron (platform inventory §7 row #2), no migration | **`744f866`** is the tip; the code to go back to is **`0fa9ad6`** | main `6ed4a22b-d8dc-4703-b3b7-08f3214c6aef` → back to **`eadd16b6-143b-4a81-a492-9b4598ef5cac`**; friend `c57c5173-eaa9-4445-be06-48a4f2711ef5` → back to **`0408aa25-e757-4b07-b02c-34b25259b578`** |
| 2026-09-06 | `c19fbbf` — shadow fetches unconditionally, `force` on the admin route, the gate counters on `/api/health`. **No migration** | **`eb69b810`** — the last commit before this change | main `67554087-3791-495e-bb5f-61f730bc50dd` → back to **`c0d40662-60ca-4ee0-aed6-3b40b7802211`**; friend `2fde08ea-4fd0-4363-b3ad-90083ede2f69` → back to **`bfec83c1-70a7-4991-b3d4-55cb106acbf7`**. ⚠️ **NOT the immediately-previous version.** W10-FED-PROV deployed the same commit `09ea0cbf` two minutes earlier, so `d950b97d` / `7f782b10` already carry this build; the ids above are the last pair WITHOUT it, from `05:30Z`. 🔴 **And a version rollback is almost certainly the wrong tool** — nothing here writes, and the proportionate undo is `AUDIOBOOK_SWEEP_MODE = "off"` (the section below) |

To undo the code: `git reset --hard c75d174 && git push --force-with-lease`.
⚠️ **That does not undo the database.** Migrations `0013`, `0020` and `0021` are
applied to production and are additive; leaving them in place is safe and is the
right call. The 99 board-book format corrections and the 40 audiobook holdings
are data changes with no down-migration — re-running the scripts is the remedy,
not a revert.

To roll the Worker back without touching git, redeploy a prior version id from
the Cloudflare dashboard.

### 🔴 2026-09-05, the series-volume half — the rollback is ONE WORD, not a version

The same rule the audiobook sweep already has, and it now covers both halves of
one tick: **set `AUDIOBOOK_SWEEP_MODE = "off"` in BOTH `[vars]` blocks, one
commit of its own, `npm run deploy:both`.** It takes effect on the next tick,
needs no migration, and un-does nothing — this shipped in **SHADOW**, so it has
written nothing to `series_volume` or `series_check` at all, and
`npm run backfill:series-volumes` is still the only writer.

⚠️ **There is NO migration in this change.** `series_volume` and `series_check`
are migrations 0003/0200 and already on both instances; nothing was added or
altered, so a version rollback meets exactly the schema it left.

A version rollback also takes back every unrelated change in the same deploy.
Prefer the mode flip. Runbook: [`audiobook-sweep.md`](audiobook-sweep.md) §6.

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
