# Aliases, export and people — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-10** — every measurement below was taken on that day,
> against the local database and (read-only) against production D1. Nothing was
> deployed and nothing was written to production.

Three features on `feature/aliases-export-people`, grouped because they touch
mostly separate surfaces. Only the first one changes the schema.

| | |
|---|---|
| **§1 `work_alias`** | The table finally has a write path, a UI and a reader. **Measured: 45 → 50 of 116 Open Library ids**, and the five that moved are the five this feature was built for. |
| **§2 Export** | `/api/export.json` and `/api/export.csv`, streamed and paged. The answer to "D1 is the only copy of this data". |
| **§3 People** | `/people`, owner-only. Two guards, one bug found by clicking. |

---

## 1. `work_alias` — the pen-name problem

### 1.1 What was wrong

The table shipped in migration 0001 and **nothing ever wrote to it**.
`packages/db/src/works.ts` had a `listWorkAliases` with no callers.

The cost was measured, not hypothetical.
[`openlibrary-ids.md`](openlibrary-ids.md) §5 records that five *He Who Fights
with Monsters* works missed because this catalog files them under **Travis
Deverell** and Open Library files the series under the pen name **Shirtaloon**.
`matching.ts`'s author gate refused every candidate — correctly, on the names it
had. *White Sand* has the same shape from the other direction: `work.authors` is
"Julius Gopez Rik Hoskin", the artist and the scriptwriter, and Brandon
Sanderson is not in the field at all.

⚠️ **Neither is fixable by editing `work.authors`.** That column derives
`work_key`, the join to the 860 shared Firestore review documents. An alias is an
**addition**; rewriting the author is a migration with review documents
downstream of it. Nothing in this feature can touch `work.title` or
`work.authors`, and the UI copy says so on the form.

### 1.2 Migration 0005 adds `kind`, and why it is not one untyped string

`work_alias.kind` is `'title' | 'author'`, defaulting to `'title'` — which is
what every pre-0005 row meant.

The tempting alternative was to leave the alias untyped and try each one against
both the title and the author. **That is a rubber stamp.** The author gate is the
single check that keeps a differently-named book by somebody else out of this
catalog; an alias asserted as an alternate *title* must never widen it. A string
has to say which question it answers, so the schema, the zod contract and the
form all refuse to guess: `createWorkAliasSchema` gives `kind` **no default**,
and the radio group opens with nothing selected and the Save button reading
"Pick a kind first".

`ALTER TABLE … ADD COLUMN` with a non-NULL default rewrites no rows, so this is
additive and safe on a populated table.

### 1.3 What the two kinds actually do

| Kind | Widens | Effect |
|---|---|---|
| `title` | the check that **finds** a book | an exact-match alternate title in `WorkIndex.aliasKeys`, and an extra name to search Open Library under |
| `author` | the check that **refuses** a wrong book | an extra `authorKey` on that work's index entry, and an extra name to search under |

⚠️ **`buildWorkIndex`'s two safety rules apply to title aliases only, and that
is deliberate.** "A real title always wins" and "a contested alias belongs to
nobody" both exist because a title alias *identifies a work* — a string
identifying two works identifies neither. An author alias identifies nothing on
its own; it only widens the gate on the work carrying it. Five HWFWM volumes all
answering to "Shirtaloon" is the ordinary case, and rule 2 applied there would
throw away every one of them. There is a test for exactly this.

### 1.4 ⚠️ The pen name alone was NOT enough — and that is the interesting result

The expectation going in was that an author alias would fix the five. Measured
against openlibrary.org on 2026-08-10, it does not:

| Query | Results |
|---|---|
| `title=He Who Fights with Monsters 2: A LitRPG Adventure&author=Travis Deverell` | **0** |
| `title=He Who Fights with Monsters 2: A LitRPG Adventure&author=Shirtaloon` | **0** |
| `title=He Who Fights with Monsters 2&author=Travis Deverell` | **0** |
| `title=He Who Fights with Monsters 2&author=Shirtaloon` | **1 — the book** |

There are **two** blockers, not one. The second is the stored title's
`: A LitRPG Adventure`, which `cleanAudiobookTitle` does not strip (it only
removes a parenthetical containing Book/Volume/Series). This is the same shape
§5 item 3 recorded for *Onyx Storm*.

The right fix is the one this feature already provides: a **title alias**
alongside the author alias. The alternative — widening `cleanAudiobookTitle` to
strip more — is what `matching.ts`'s header and `openlibrary-ids.md` §5 both
explicitly forbid, because a strip rule loosened to catch five rows loosens for
all 116. A person asserting "this book is also called X" is a fact about the
world; a broader regex is a guess about all of them.

So each of the five carries two rows:

```
author : Shirtaloon
title  : He Who Fights with Monsters <n>
```

### 1.5 Measured: 45 → 50, against production rows

Both runs were `npm run backfill:openlibrary-ids -- --remote`, **read-only**,
2026-08-10. The second added `--aliases-from-local` (see §1.7).

| | Before | After |
|---|---|---|
| corroborated Open Library ids | **45 / 116 (39%)** | **50 / 116 (43%)** |
| searched, not found | 68 | **63** |
| outliers for hand review | 3 | 3 |
| network calls made | 0 (all cached) | 5 works re-asked |

The five, each matched at **title 1.00 / author 1.00** on the correct volume:

| Work | Open Library | Corroborated by |
|---|---|---|
| HWFWM 2 | `OL39744035W` | publisher (Aethon Books), series, year 2021 |
| HWFWM 3 | `OL36310135W` | series, year 2021 |
| HWFWM 5 | `OL28199716W` | series, year 2022 |
| HWFWM 6 | `OL28199758W` | series, year 2022 |
| HWFWM 10 | `OL37999440W` | publisher (Aethon Books), series, year 2023 |

⚠️ **Three of the five cleared on two *weak* corroborators (series + year)**
rather than a strong one. That is exactly the bar `corroboration.ts` sets, and it
is worth knowing that these five sit on it rather than above it. The volume
number itself is confirmed by the title score, not by the series corroborator —
every evidence line says "our series, volume unconfirmed", because Open Library
labels the editions with the bare series name.

Nothing was written. `--commit` is the owner's.

### 1.6 A new alias re-opens a settled question, automatically

The ledger `scripts/openlibrary-ids.json` now records, per entry, the names the
question was asked under:

```json
"aliases": ["author:Shirtaloon", "title:He Who Fights with Monsters 2"]
```

A work whose alias set differs from its entry's is **re-asked with no flag**.
Without that, adding a pen name would change nothing until somebody remembered
`--refresh`, and the feature would look built and be inert.

⚠️ **The converse is a trap worth knowing.** Because the names are part of the
question, running the backfill against a database that does *not* have these
alias rows will re-ask the five, get `not_found` again, and overwrite the five
matched entries. **Migrate production and re-enter the aliases before re-running
`--remote`**, or the measured result above reverts.

### 1.7 `--aliases-from-local`, and why it exists

Production has not had migration 0005 applied (the owner gates that) and has
zero alias rows, so a plain `--remote` run cannot see the effect of aliases at
all. `--aliases-from-local` reads `work_alias` from the local database and joins
it to the production works **by `work_key`, never by id** — the two databases
number their rows differently (HWFWM is 33–37 locally and 94–98 in production)
and an id join would attach a pen name to five unrelated books.

It measures what the aliases *would* do to production without writing anything
to it. That is its only purpose; once production is migrated and the aliases are
entered, the flag is not needed.

The alias read is also tolerant of a database with no `kind` column: it retries
as `'title'` and says so, rather than failing.

### 1.8 Where it is used

| Reader | Behaviour |
|---|---|
| `buildWorkIndex` / `matchIndexedWork` | title aliases as exact alternates; author aliases widen the author gate |
| `GET /api/enrich/works/:id/candidates` | searches each (name × author-name) pair, capped at 4 queries, dedupes by Open Library work id, scores against every known name |
| `scripts/backfill-openlibrary-ids.mjs` | the same, plus the ledger staleness rule above |

The enrich route is what makes the panel do something visible: on `/work/34`,
"Look this book up" returned *"Open Library has nothing matching"* before, and
**"He Who Fights With Monsters 2 / Shirtaloon / Aethon Books · 2021 · title 100%
· author 100%"** after the two aliases were added. Driven in a browser, not
reasoned about.

### 1.9 API

| | |
|---|---|
| `GET /api/works/:id/aliases` | `read` |
| `POST /api/works/:id/aliases` | `editCatalog`. Body `{alias, kind}`. Answers with the whole list. |
| `DELETE /api/works/:id/aliases/:aliasId` | `editCatalog`. Scoped to the work, so a stale page cannot delete by guessing a number. |

Refusals, all measured: no `kind` → 400; an alias equal to the work's own title
or own author → 400 (it would be silently discarded by `buildWorkIndex`'s rule 1,
so a write that cannot have an effect fails loudly instead); the same string
twice → 409; a work that does not exist → 404; fewer than 2 characters → 400
(matching the floor `buildWorkIndex` applies).

---

## 2. Export

### 2.1 Why JSON is the backup and CSV is not

A CSV is one table; this catalog is **ten**, and its value is in the joins —
`edition.work_id`, `copy.edition_id`, `user_book.user_id`,
`work_relation.from_work_id`, `series_volume.series` matching `work.series`
exactly. A flattened row can repeat an edition twice and hope. So:

| | Grain | For |
|---|---|---|
| `/api/export.json` | every row of every table | **rebuilding.** The one to keep. |
| `/api/export.csv` | one row per work | a spreadsheet. Lossy, and the page says so. |

The CSV is work-grained, not copy-grained like the sibling Board Game Catalog's
— that project's file answers an insurer's question about physical copies, and
this library is 118 ebook files with one copy each, so a copy-grained file would
be the work list with the interesting columns removed.

### 2.2 What is in it

Twelve tables in **dependency order** (that order is the re-import order):
`app_user`, `work`, `work_alias`, `alias_check`, `edition`, `copy`, `user_book`,
`work_relation`, `series_volume`, `series_check`, `research_run`,
`research_finding`.

Deliberately **out**: `lookup_cache` and `scan_job`. Neither is catalog data —
one is a cache of what Open Library was already asked, the other is transient
scan bookkeeping no route has ever written.

⚠️ The schema stamp is the **applied migration list read from `d1_migrations`**,
not a literal. The sibling project hard-coded `"schemaVersion": "0001_init"` and
it has been wrong since its migration 0002 — worse than absent, because a restore
would believe it.

### 2.3 Paged, and verified paged

Both exports are async generators; every table is read `LIMIT … OFFSET …` at
`PAGE = 500`, and each row is serialised individually. The route wraps the
generator in a `ReadableStream` whose **`pull`** (not `start`) drives it, so a
query only runs when the socket can take the rows.

Verified by setting `PAGE = 7` and diffing: the JSON `tables` object and the CSV
were **byte-identical** to the `PAGE = 500` output, at 116 works across 17 pages.
Measured sizes: 135 kB JSON, 14 kB CSV.

### 2.4 ⚠️ Why the buttons are not `<a download>`

The sibling catalog uses a plain anchor because Cloudflare Access authenticates
with a **cookie**, which a browser attaches to an ordinary navigation. Here the
credential is a Firebase **Bearer token** that only `api.ts`'s `request()`
attaches — an anchor arrives with no Authorization header and 401s.

**And it would have looked perfect locally.** `middleware/auth.ts`'s dev bypass
answers without a token, so an anchor downloads fine on `127.0.0.1` and breaks
the moment it is deployed. `api.downloadExport` fetches with the header and hands
back a Blob.

The trade: the browser buffers the finished file before the save dialog. The
*server* still streams and pages; a very large catalog would want the File System
Access API, which iOS does not have.

Gated on `editCatalog`, not `read` — a reader may browse the shelf; taking a copy
of the database, email addresses and all, is an owner's act.

---

## 3. People

`/people`, owner-only. The API already existed (`GET /api/users`,
`PATCH /api/users/:id/role`); this is the screen.

### 3.1 The two guards, and where they live

Both are enforced in `apps/worker/src/routes/users.ts` and only *reflected* in
the UI:

1. **A non-owner cannot change roles.** `requireCapability('manageUsers')` gates
   both endpoints. Measured as a `reader`: `GET /api/users` **403**,
   `PATCH /api/users/2/role` **403**, `/api/export.json` **403**,
   `POST /api/works/34/aliases` **403**, while `GET /api/works/34/aliases`
   stayed **200** (it is `read`). `/people` and `/export` render "Not a page"
   and their nav entries are hidden.
2. **The last owner cannot demote themselves.** The server counts owners inside
   the request. The page greys the buttons and explains why; with a second owner
   present the buttons enable again, verified by promoting one and watching them
   turn on.

⚠️ **There is no delete.** `user_book.user_id` is `ON DELETE CASCADE`, so
removing a person would take their whole reading history with them. `pending` is
the revoke: they keep their history and see nothing.

### 3.2 ⚠️ The bug that only clicking finds

An owner with a colleague-owner **may** step down — and the naive implementation
shows them the opposite of what happened. The `PATCH` succeeds, the follow-up
`GET /api/users` **403s because you are no longer an owner**, and you are left
looking at a stale list that still says OWNER with the word "forbidden" over it.
It reads as "the change failed" when it is the change working.

Fixed by handing back to `App` when the person you changed is you and the new
role is not `owner`: it navigates to `/` and re-reads `/api/me`. Verified — after
stepping down the collection renders and the top bar loses People and Export.

The role list is derived from `ROLES` rather than written out again. The sibling
project shipped a hardcoded copy and a whole role became assignable nowhere.

---

## 4. Verification log

Local worker on `127.0.0.1:880x` serving built assets (Vite binds to
`localhost`, which the browser tool cannot reach).

| | |
|---|---|
| `npm test` | **72** pass (was 66; six added, all on alias matching) |
| `npm run typecheck` | clean across five workspaces |
| `npm run db:migrate:local` | 0005 applied |
| Alias panel | added the pen name through the form, saw the badge, ran "Look this book up" before and after |
| Alias API | every refusal in §1.9 exercised by curl |
| Export | both files downloaded through the browser; JSON re-parsed and every table's length checked against its own `counts`; paging verified at `PAGE = 7` |
| People | two seeded users, approve → reader → owner → self-demote → reader-refused, all driven |
| Backfill | `--remote` dry run twice, before and after; **read-only, nothing committed** |

### What was NOT done

- **Not deployed, not merged, and `--remote` was never migrated.** Migration
  0005 exists only locally.
- **The five ids are not written.** The dry run named them; `--commit` is the
  owner's.
- ***White Sand* was not given an alias.** It is the other documented case and
  the mechanism now exists, but choosing what Sanderson's credit should be on a
  work whose `authors` names the artist and the scriptwriter is the owner's call,
  not a script's.
- **No bulk alias seeding.** Ten rows were entered by hand while testing.
- **The multi-user test used seeded rows, not two real Google sign-ins.** The
  dev bypass hardcodes `firebase_uid = 'dev-uid'`, which is `UNIQUE`, so a second
  local identity cannot be created through the front door — it 500s on the
  constraint. Pre-existing, dev-only, and unrelated to these features.
