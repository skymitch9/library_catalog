# GABI's delegated door — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED — no secret values here.
> Last verified: **2026-08-19** (`browse-works` added; every gate branch and
> every predicate branch exercised end-to-end against a real D1 locally, and the
> live door re-verified). The 2026-08-18 verification of the bearer pairing on
> BOTH instances stands and was not re-run.
> Design of record: `catalog-platform/docs/info/gabi-application-map.md` §2a–2d.
> The bot's half of the runbook: `catalog-platform/docs/access/discord-bot.md` §13.

The estate's Discord bot can now **write to this catalog on a person's behalf**
— the owner's Tier-1 ask, 2026-08-17: *"Can I dm her an isbn or a photo and she
adds it to the catalog?"* and *"Hey Gabi, fix all my missing details."*

## ⚠️ The one sentence this whole surface exists to enforce

> **GABI holds no permissions.** She asserts an identity; **this Worker** checks
> that person's own stored role, on **this instance**, before anything happens.

The bot's bearer proves only *"this request came from the estate's Discord
Worker"*. It authorises **no write at all**. Two independent facts must both be
true, and conflating them is the whole class of bug this shape avoids.

## What exists

| Thing | Value |
|---|---|
| Routes | `POST /api/gabi/delegated/whoami`, `…/add-isbn`, `…/run-details`, `…/browse-works` |
| Mount | `apps/worker/src/index.ts`, **before `requireAuth`** — the fourth machine route, after ingest / audiobook-mapping / donor |
| Gate | `Authorization: Bearer <ESTATE_APP_TOKEN_DISCORD>` |
| Code | `apps/worker/src/routes/gabi-delegated.ts` (+ `.test.ts`) |
| Health | `GET /api/health` → `gabi.delegated` — is the NAME populated here (never the value, never proof of a pairing) |

| Verb | Capability required **of the asker** | The button it borrows from |
|---|---|---|
| `whoami` | none — writes nothing, spends nothing | — |
| `add-isbn` | `editCatalog` (contributor+) | the scan review screen's **Add** |
| `run-details` | `runResearch` (moderator+) | the details queue's **Run** |
| `browse-works` | `read` (guest+) | the collection grid — *"see the collection at all"* |

## `browse-works` — the READ verb (added 2026-08-19)

**Why it exists.** The Discord bot's physical suggestion lane could only see
print rows the AUDIOBOOK catalog had cross-linked — 84 of 1,079 rows, 64 of them
physical — and said so to the owner out loud. The two roads that already existed
cannot be widened: `/api/machine/audiobook-mapping` is a **join table on
purpose** (~90 pairs) and the shared index **widens only for a Firebase ID
token**, which a Discord Worker structurally cannot mint. This is the third road.

⚠️ **It borrows `read`, not `editCatalog`** — the Discord side's own note is
right: *"a reader with no edit rights can still walk to the bookcase."* Every
role but `pending` holds `read`, so the refusals a person actually meets are the
existing four (unknown here / estate-revoked / awaiting approval / no `read`).

```jsonc
// POST /api/gabi/delegated/browse-works   Authorization: Bearer <ESTATE_APP_TOKEN_DISCORD>
{ "onBehalfOf": "<firebase uid>", "limit": 200, "offset": 0 }   // limit/offset optional
```

```jsonc
{
  "outcome": "works", "app": "library", "site": "library.heygabi.ai",
  "total": 341,            // ⚠️ the WHOLE match, ignoring limit — see below
  "limit": 200, "offset": 0,
  "rows": [{
    "id": 1, "title": "A Killer's Mind", "authors": "Mike Omer",
    "series": "Zoe Bentley Mystery", "seriesIndex": "Book 1", "year": null,
    "formats": ["Hardcover", "Paperback"],
    "url": "https://library.heygabi.ai/work/1"
  }],
  "generatedAt": "2026-08-19T15:14:56.717Z"
}
```

| Field | Notes |
|---|---|
| `authors` | **`null`** for a book with no author recorded — never the `?unknown` sentinel |
| `seriesIndex` | the human spelling (`"1"`, `"2.5"`, `"Book 5"`), `null` off-series |
| `formats` | ⚠️ **`[]` means "held, printing not typed in yet" — NEVER "not physical"** (6 of 341 rows today) |
| `url` | built by this Worker against **the instance that answered** — never assemble it caller-side |

⚠️ **`total` is not decoration.** The order is `work.id` and the cap is hard, so
a caller that ignores it suggests from the front of the shelf forever. Page with
`offset`, or ask for the ceiling. `limit` defaults to **200**, clamps to **500**;
junk (`NaN`, `Infinity`, a string, a fraction) clamps rather than 400s — GABI
must not decline to look at a bookshelf over a number.

**What it returns, exactly** (`packages/db/src/gabi-browse.ts` — allow-list, and
`packages/db/test/gabi-browse-clause.test.ts` runs the clause against real
SQLite): a work with **a held copy — `owned` or `lent` — that is either linked
to a physical printing or linked to no printing at all**. Never exported by this
road: copy counts, copy status, condition, `is_signed`, prices, vendors,
acquisition dates, locations, `lent_to`, read-state, ratings, notes, ISBNs,
ASINs, descriptions.

⚠️ **The unlinked-copy branch is load-bearing, not laxity.** Measured live
2026-08-19: **177 of 390 copies carry no `edition_id`** (a copy may exist before
its printing is known — the spine-photo case), and requiring a physical `edition`
row would hide 6 works the household demonstrably has on a shelf.

⚠️ **`EBOOK_ONLY_CLAUSE.hide` cannot be reused here.** Its third conjunct is
`NOT EXISTS (copy)`, so beside a held-copy requirement it is always false and the
clause degenerates to `TRUE` — a filter that reads as protection and applies
none. Pinned by a test so nobody "simplifies" it back.

| Measured live, 2026-08-19 | |
|---|---|
| works in the catalog | 448 |
| works `browse-works` returns | **341** |
| of those, `formats: []` | 6 |
| copies with no `edition_id` | 177 of 390 |
| held copies linked to an ebook printing | 0 |

## The secret

| Name | Custody |
|---|---|
| `ESTATE_APP_TOKEN_DISCORD` | ⚠️ **One value, THREE holders, the same NAME on each** — this Worker, `[env.friend]`, and `catalog-platform/apps/discord-worker`. The `DONOR_TOKEN` idiom. |

```
# Main instance
npm run secret -- ESTATE_APP_TOKEN_DISCORD
# Her instance  (⚠️ no bulk path exists for her, on purpose — second-instance.md)
npm run secret:friend -- ESTATE_APP_TOKEN_DISCORD
# The bot, from catalog-platform/apps/discord-worker
npx wrangler secret put ESTATE_APP_TOKEN_DISCORD
```

⚠️ **Unlike `ESTATE_APP_TOKEN_LIBRARY` / `_LIBRARY2`, the name does NOT vary by
instance.** Those assert *which consumer is speaking to the directory*, and the
two instances are two consumers. This one authenticates **one caller** (the bot)
to **both** shelves, and the instance question is answered by which hostname it
dialled.

⚠️ **Unset means a worded 503 and no write** — so the code is safe to deploy
before the secret exists, which is the intended order.

⚠️ **Rotating it is a THREE-sided change.** Set all three in one sitting; the
window between the first and the last is a window where GABI's writes 401. That
is a worded refusal rather than an outage, but it is still a window.

## Verifying it — three levels, and only the third proves the value

| Level | Command | Proves |
|---|---|---|
| Name | `GET https://library.heygabi.ai/api/health?cb=$RANDOM` → `gabi.delegated` | the secret NAME is populated on this env |
| Door | `POST /api/gabi/delegated/whoami` with **no** Authorization | a worded **401**, not a 404 and not a 500 |
| **Pairing** | the same POST **with** the bearer and a junk uid | **200 `{known:false}`** — the only proof the three holders agree |

⚠️ **`/api/health` is edge-cached on both custom domains** (measured
2026-08-17). Append a cache-buster or hit the `*.workers.dev` host, or a
post-deploy read returns the previous deployment's body and looks exactly like a
deploy that did not land.

⚠️ **Windows gotcha, cost real time 2026-08-18:** `curl -X POST` from Git Bash
returned `HTTP 000` against every one of these routes while `curl` GETs worked
and `node -e "fetch(...)"` POSTs worked fine. The same family as the recorded
`curl -o /dev/null` artifact. **Verify these routes with `node -e` + `fetch`,
not curl.**

**Measured 2026-08-18, live, both instances:**

| Call | Answer |
|---|---|
| any verb, no bearer | `401 unauthenticated` + a worded `message` |
| any verb, wrong bearer | `401` |
| `whoami`, right bearer, unknown uid | `200 {"app":"library","site":"library.heygabi.ai","known":false}` (and `library2` / `padhard.heygabi.ai` on hers) |
| `add-isbn`, right bearer, unknown uid | `403 unknown_here` + *"Sign in once at library.heygabi.ai…"* |

**Measured 2026-08-19, `browse-works`, end-to-end against a real D1** (a local
`wrangler dev` on a seeded fixture — the only way to exercise the SQL's bind
order, which no stub can prove):

| Call | Answer |
|---|---|
| no bearer / wrong bearer | `401 unauthenticated`, worded |
| right bearer, unknown uid | `403 unknown_here` — ⚠️ *"I did not **show you anything from** there"*, never *"nothing was changed"* |
| right bearer, **guest** role | `200 {"outcome":"works", …}` — the lowest standing there is may look |
| a copy linked to a hardcover | present, `formats: ["Hardcover","Paperback"]` |
| a copy linked to **nothing** | present, `formats: []` |
| a copy linked to an **ebook** printing | **absent** |
| a `wanted` copy | **absent** |
| `limit: 99999` | clamped to `500`, `200 OK` — not an error |

⚠️ **A uid shorter than 8 characters is a `400 bad_request`** on every verb
(`onBehalfOf`'s sanity floor). Cost time here: the local dev fixture's user is
`dev-uid`, seven characters, and the 400 looks exactly like a broken route.

## ⚠️ Why 401 with words, where `/api/donor` answers a blank 404

The donor route has one legitimate caller holding the same secret, so a mismatch
is an attacker or a misconfiguration and neither is owed a hint that the door
exists. **These refusals are relayed into a Discord message.** A silent 404
surfaces as GABI saying nothing at all, which is the one thing she must never
do. Every refusal here carries a `message` field the bot repeats verbatim.

## Provenance — what GABI wrote, and undoing it

| Verb | Stamp | Undo |
|---|---|---|
| `add-isbn` | `change_log`: `changed_by = <asker's app_user.id>`, `changed_how = 'auto'`, `note LIKE 'gabi-discord%'` | the book's **Changes** panel — a work, a printing and a copy |
| `run-details` | `research_run.triggered_by = <asker>` (the cron writes `NULL`) | the details queue's existing **auto-applied → Undo** list |

```sql
-- everything GABI has ever added here
SELECT * FROM change_log WHERE note LIKE 'gabi-discord%' ORDER BY id DESC;
-- every sweep a PERSON asked for, as opposed to the clock
SELECT * FROM research_run WHERE triggered_by IS NOT NULL ORDER BY id DESC;
```

## ⚠️ What this door will NOT do, and why that is not a gap

- **It never answers the rescan question** (`@lc/core/rescan.ts`). A barcode
  whose book is already on the shelf can mean four different things and nothing
  the catalog knows tells them apart; this repo already carries residue from the
  version that guessed. GABI hands it back with nothing written.
- **It never answers the pre-order question**, same reasoning
  (`@lc/core/preorders.ts`).
- **It never creates an `app_user` row.** `findUserByFirebaseUid` is a lookup;
  an unknown uid is refused in words. A door that could mint standing would be
  the estate-grant verb the ladder puts at T4.
- **It runs no fresh estate `/seen` call** — it acts on the cached
  `estate_status`, refusing a `revoked` one. Refreshing the directory here would
  put an outbound estate call on a write path whose failure mode must be "refuse
  in words", and the local role check stands on its own regardless.

## Gotchas

- The delegated sweep is the **same function** the cron runs
  (`lib/details-sweep.ts`), with `SweepOptions.triggeredBy`. Do not write a
  second, chat-shaped copy — that file is where the subrequest arithmetic, the
  donor-before-AI ladder and the never-ask-twice history all live.
- `run-details` genuinely takes **20–90 seconds per book, up to two books**. The
  caller is expected to have already said *"on it"*. Answering fast and
  finishing under `waitUntil` is the failure this repo has paid for twice.
- ⚠️ **The format WORDS are load-bearing in two other repos.** `Hardcover`,
  `Paperback`, `Mass market`, `Ebook` are produced by one function
  (`apps/worker/src/lib/format-labels.ts`, extracted 2026-08-19 when
  `browse-works` became its second caller), stored verbatim in the audiobook
  catalog's `catalog.csv` `library_formats` column, and matched lower-cased by
  the Discord bot's `PHYSICAL_FORMAT_TOKENS`. Renaming one silently un-matches
  rows in code nobody was editing.
- ⚠️ **The bot's `PHYSICAL_FORMAT_TOKENS` is `['hardcover','paperback']` and does
  NOT include `mass market`** (read 2026-08-19 in
  `catalog-platform/apps/discord-worker/src/suggest.ts`). A mass-market paperback
  reaching that filter from this verb would be dropped. Not this repo's bug to
  fix, and worth knowing before somebody debugs a missing book.
- The bot's timeout for a delegated call is **180 s**; a sweep that overruns it
  still *lands* (the writes happen) while GABI reports an outage. If that is
  ever observed, raise the bot's `CALL_TIMEOUT_MS` rather than shortening the
  sweep.
