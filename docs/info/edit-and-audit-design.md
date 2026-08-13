# Edit any detail, the audit log, and the authorless book — Information Reference

> **Audience:** Claude sessions, and the owner deciding whether to build this.
> **Status:** TRACKED. **DESIGN ONLY — nothing here is applied, migrated or
> deployed.** Written by Fable 5, 2026-08-12/13, per `docs/FABLE5.md` §4.2.
> Last verified: **2026-08-13** against this repo at commit `7301368` —
> `0001_init.sql`, `0008_manager_role.sql`, `0040_cover_status_and_watch.sql`,
> `packages/core/src/titles.ts`, `reviews.ts`, `schemas.ts`,
> `packages/db/src/works.ts`, `apps/worker/src/routes/catalog.ts`,
> `apps/web/src/components/WorkFields.tsx`,
> `docs/info/identity-and-reviews.md`, `catalog-platform/docs/PLATFORM.md`
> §2.2/§2.4, and `audiobook_catalog/docs/TODO.md` (local-only) were all read.
> What was **not** verified: nothing was executed — no migration was dry-run
> against a local D1, no Firestore query was issued, and the review counts
> quoted are the ones the docs recorded (869/870 as of 2026-08-12), not a fresh
> read.

The owner's three asks from one scanning session, which are one feature:

> *"add an edit title button on the ui. More than that we need a way to edit
> basically any detail about a book except core details like ISBN. We'd also
> need an audit log and stuff. Audiobook catalog will need this as well."*
>
> *"Let us add books without an author and immediately flag them for
> remediation. That way we're not hard blocked."*

---

## 0. The one paragraph that matters

Everything below hangs on a single decision: **a book with no author gets a
work key whose author half is a sentinel that no real key can ever equal and
no review document is ever allowed to carry.** That makes the dangerous
question — *"will filling in the author later orphan this book's reviews?"* —
answerable **by construction instead of by measurement**: a provisional key
provably joins zero reviews, so remediation is always a free move. The
measured, careful machinery (the live Firestore check, the carry procedure,
the audit trail) is then only needed for the genuinely dangerous case, which
is editing the title or author of an **established** book — and the audit log
is what makes that edit undoable rather than brave.

---

## 1. The constraints, restated with sources

All measured elsewhere; none re-derived here. Read the sources before arguing
with the design.

| Constraint | Source | Consequence here |
|---|---|---|
| `work.authors`, `primary_author`, `work_key` are **NOT NULL** | `0001_init.sql:87,90,108` | "no author" needs either a schema change or a representable value |
| `work_key` contains the author **on purpose** — title-only keys *"collide across authors constantly"* | `0001_init.sql:99` | the authorless key must still be collision-proof against every real key |
| `work_key` joins **~870 audiobook reviews** in the shared Firestore store | `identity-and-reviews.md` §3–§5 | moving a key that reviews carry orphans them on this side |
| Review doc **ids** are `bookIdFromTitle(title)_{name}` — title-only, author-free, never changed | `packages/core/src/reviews.ts` | a key move is a **field update** on review docs, never a doc move |
| The Worker **cannot see Firestore** — no service account, deliberately | `identity-and-reviews.md` §3 | any live review check must run in the browser; the server can only hold *evidence* |
| `fetchReviews` runs two queries: `workKey` and legacy `bookId` | `identity-and-reviews.md` §6 | a half-completed key move degrades to legacy-query visibility, not to loss — if the order of operations is right (§5.3) |
| `WorkFields.tsx` deliberately cannot reach `title`/`authors` | its header | the guard is real; this design *replaces* it with a gated surface, it does not delete it |
| ⚠️ `PATCH /api/works/:id` **already accepts `title` and `authors` with no guard at all** | `schemas.ts:127` (`createWorkSchema.partial()`), `catalog.ts:293` | the only guard today is the UI patch object. **This is a live gap** — any API caller can silently move a key right now. The design closes it server-side |
| ⚠️ `updateEditionSchema` **already accepts `isbn13`/`asin` patches** | `schemas.ts:251` | "except core identifiers like ISBN" is currently not enforced anywhere. Also closed below |
| Rebuilding a table on D1 to change a constraint **has measured data loss** on both escape hatches (`defer_foreign_keys`, `legacy_alter_table`), and `foreign_keys = OFF` is unsupported | `0008_manager_role.sql` header | a `work` rebuild means stash-and-restore of **every child table** — see §3.2 for why this design refuses it |
| Audiobooks are pipeline-fed and read-only; each catalog keeps its own DB; nothing is merged | `PLATFORM.md` §2.2, §2.4 | the audit **design** crosses the repo boundary; the audit **table** does not |

---

## 2. What "edit any detail" actually divides into

Three tiers, because the fields are not equally dangerous:

| Tier | Fields | Danger | Surface |
|---|---|---|---|
| **Free** | subtitle, series, volume sort, first published, description, cover, universe, edition name/kind/publisher/year/pages/language, everything on `copy` | none — moves no join | `WorkFields` and the existing edition/copy forms, exactly as today |
| **Key-moving** | `title`, `authors` | moves `work_key`, the review join | a new, deliberately heavier "Edit title & author" surface with the §5 ceremony |
| **Frozen** | `edition.isbn13`, `edition.isbn10`, `edition.asin` | identifies the physical object; scan write-back self-heals onto it; UNIQUE-indexed | **refused everywhere.** A wrong ISBN is a delete-and-recreate, which the audit log records as two `__row__` entries, so the trail survives |

Why `openlibrary_work_id` is *not* frozen: it is a pointer to someone else's
catalog, not the identity of an object on the shelf. A wrong OL id is a wrong
fact to correct; a wrong ISBN is a different book. The line is "does other
data hang off it" — scan write-back and the UNIQUE indexes hang off ISBN/ASIN,
nothing hangs off the OL id (its comment in 0001 says the join *may* harden to
it later; if that ever happens it moves to the frozen tier the same day).

Why frozen means **400, not silently stripped**: this codebase already found
zod *"silently stripping a stray `rating` instead of rejecting it"*
(`CLAUDE.md`, "Verifying anything") — a stripped field reports success and
changes nothing, which is the silent failure the review checklist bans. The
edition patch schema gets an explicit `.strict()`-style refusal of the three
identifier keys with a message saying what to do instead.

---

## 3. The `work_key`-with-no-author answer

### 3.1 The decision

**Store the sentinel string `?unknown` in `authors` and `primary_author`, and
derive `work_key` as `` `${normaliseTitle(title)}|?unknown` ``. No schema
change to `work`'s constraints at all.** The application type becomes honest
at the row boundary: `toWork()` in `packages/db/src/works.ts` — already the
single `WorkRow → Work` mapping — translates the sentinel to `null`, so
`Work.authors` and `Work.primaryAuthor` become `string | null` and the
**compiler** finds every reader that must now handle an unknown author. On
write, `createWork`/`updateWork` translate `null` back to the sentinel. The
sentinel exists in exactly three places: the database file, the two mapping
points in `packages/db`, and one constant in `@lc/core`.

```ts
// packages/core/src/constants.ts
/**
 * ⚠️ The stored stand-in for "no author recorded". Chosen to be impossible:
 * `normaliseTitle`'s output alphabet is [a-z0-9 ] (titles.ts), so no real
 * author can ever fold to a string containing '?'. That single character is
 * the entire collision proof — `gold|?unknown` cannot equal any key
 * `workKeyFor` derives from a real author, including an author literally
 * credited as "Unknown" or "Anonymous" (those fold to 'unknown'/'anonymous',
 * without the '?').
 *
 * It must NEVER appear in Firestore. `reviewDocFor` throws on it (§4), and
 * that refusal is what makes remediation free — see the design doc.
 */
export const UNKNOWN_AUTHOR = '?unknown';
```

`workKeyFor` — the ONE implementation, extended in place rather than joined by
a second function, per `CLAUDE.md`'s rule:

```ts
// packages/core/src/titles.ts — the only change to this file
export function workKeyFor(title: string, authors: string): string {
  // ⚠️ The sentinel bypasses the fold on purpose: folding '?unknown' yields
  // 'unknown', which a real credited author ("Author Unknown" is printed on
  // real folk-tale covers) could legitimately produce. The unfolded '?' is
  // the collision proof, so it must survive into the key verbatim.
  if (authors === UNKNOWN_AUTHOR) {
    return `${normaliseTitle(title)}|${UNKNOWN_AUTHOR}`;
  }
  return `${normaliseTitle(title)}|${normaliseTitle(primaryAuthor(authors))}`;
}
```

`parseWorkKey` needs no change — `gold|?unknown` splits cleanly.

### 3.2 Why the alternatives are worse

**(a) Make `authors`/`primary_author` nullable — the TODO's own sketch — is
rejected because of what the migration would be, not because NULL is wrong.**
SQLite cannot drop a NOT NULL without rebuilding the table, and migration
0008's header records what a D1 rebuild costs when the table has children:
`DROP TABLE` on a parent fires every FK action, both escape pragmas were
*measured to lose data* on a real D1, and the only safe pattern is
stash-and-restore of every affected row. `app_user` had six references and
the stash was six tables. `work` is the most-referenced table in the schema —
`work_alias`, `alias_check`, `edition` (CASCADE, with its own children),
`copy`, `user_book`, `research_run`, `research_finding`, `work_watch`,
`work_relation`, and more since — so its rebuild is a stash-and-restore of
**essentially the whole database**, including every row of per-person read
state that 0008 calls "the expensive one... which no rebuild can
reconstruct". That is the single riskiest migration this estate could write,
purchased to represent a state that (today) applies to about four board
books. The sentinel gets the same compile-time `string | null` honesty above
the row boundary for the cost of an `ADD COLUMN`-only migration. If the
platform convergence (`PLATFORM.md` §7) ever rebuilds these schemas from
scratch, make the columns properly nullable *there*, where the rebuild is
free.

**(b) A title-only key (`gold|`)** is the documented known-bad: 0001's own
comment says title-only keys collide across authors constantly, and the empty
author half is exactly what `primaryAuthor`'s fallback exists to prevent.
Worse, it *looks* joinable — a review carrying `gold|` would be one bad write
away from existing. Rejected without ceremony.

**(c) A NULL `work_key`** breaks the NOT NULL invariant that every consumer
of the bridge assumes (`findWorkByKey`, the search clause `work_key LIKE`,
the sweep's join, the backfill), turns "does this book have reviews" into a
three-valued question everywhere, and — unlike the sentinel — removes the key
from search: the collection's free-text search LIKEs against `work_key`
(`works.ts`, `collectionFilter`), so an authorless book with a NULL key would
vanish from title search. The sentinel keeps the title half searchable.

**(d) A placeholder *fact* ("Unknown", the publisher, the title)** is
inventing data, which is review-checklist item 2 and the thing this codebase
most consistently refuses. The TODO's note that publisher-as-author is
legitimate for publisher-branded board books stands — but that is a person
asserting a real convention on a specific book, not a default.

### 3.3 The remediation flag: derived, not stored

**"Flagged for remediation" is `authors = '?unknown'` itself — a derived
filter, not a `work_watch` row.** The TODO sketched a watch row written in the
same call; this design deliberately departs from that sketch, and the
precedent is migration 0040's own structure: "needs a cover" is *derived*
(`NEEDS_COVER` reads `cover_url`/`cover_status`), not stored as a row,
precisely so the mark and the fact cannot diverge. A watch row can be
resolved without the author arriving — somebody taps "looked at it" and the
flag is gone while the fact remains — which is checklist item 3 (a flag
travelling apart from its value) built into the schema on day one. A derived
clause cannot be forgotten, cannot drift, and needs no write:

```ts
// packages/db/src/works.ts — NEEDS_CLAUSE gains one literal, no binds
const NEEDS_AUTHOR = `w.authors = '${'?unknown'}'`;  // UNKNOWN_AUTHOR inlined as a literal
const NEEDS_CLAUSE: Record<string, string> = {
  cover: NEEDS_COVER,
  watch: NEEDS_WATCH,
  author: NEEDS_AUTHOR,
  any: `(${NEEDS_COVER} OR ${NEEDS_WATCH} OR ${NEEDS_AUTHOR})`,
};
```

The facet query grows a third `SUM(CASE...)` column beside `cover` and
`watch`, the card gets an "author unknown" mark, and the collection's
Needs control gets an **Author** entry — landing the flag in exactly the
"needs attention" pass the owner already works through. It cannot be silently
forgotten because it is computed from the row on every read.

### 3.4 What an authorless work refuses while provisional

These four guards are what make §3.1's construction sound. Remove any one and
the "free move" claim in §5.1 stops being a proof.

1. **`reviewDocFor` throws on `UNKNOWN_AUTHOR`** (and the `/draft` route
   returns a friendly 409 first): a review written now would be stamped with
   the provisional key and detach the day the author arrives. The message
   says so: *"Add the author first — a review written now would come loose
   when it arrives."* Asserted in `core.test.ts` beside the existing
   `reviewSourceOf` invariant, not left as a comment.
2. **The book page suppresses both review queries** for a provisional work —
   the `workKey` query would match nothing (harmless), but the legacy
   `bookId` query is title-only and could surface another author's book's
   reviews (*two books called "Gold"* is the exact case 0001 warns about,
   and with no author there is nothing to disambiguate with). The panel
   renders *"Reviews are held until the author is known."* The cost — a real
   audiobook review invisible until remediation — is accepted and stated in
   §8.
3. **The observed-ratings endpoints ignore provisional works** (the sweep
   already cannot reach them: it joins on `doc.workKey = work.work_key`, and
   no doc carries the sentinel; the per-book `/observed` path must add the
   refusal because it can be handed a legacy-matched rating). This keeps
   `rating_cached` and derived read-states from being polluted by a
   title-collided stranger's review.
4. **The scan/add path never does this silently.** `isAddable` keeps
   requiring title+author for the ordinary **Add** button; a second,
   explicit action — **"Add without an author"** — appears on a line that has
   a title but no author, and says on the button what it does. The owner's
   ask was to be unblocked deliberately, not to make authorless the default.

---

## 4. The audit log: `change_log`

### 4.1 The table, designed once for both catalogs

One row per changed field, grouped into events by `batch_id`. Proposed as
`migrations/0120_change_log_and_authorless.sql` — **NOT applied**; see §7 for
the full file.

```sql
-- Who changed what, when, and what it said before.
--
-- ⚠️ Designed ONCE for both catalogs (see the cross-repo section of
-- docs/info/edit-and-audit-design.md). audiobook_catalog applies this same
-- DDL in its own database when it gains an editor; the tables are never
-- shared or merged (PLATFORM.md §2.2) — the *shape and semantics* are what
-- cross the boundary, so the two sides give one answer to "what happened".
--
-- One row per field per event, NOT one JSON blob per save:
--   * "when did the title change, and from what" is one indexed read;
--   * a future per-field undo needs no blob surgery;
--   * `batch_id` still groups a save into one event for display.
--
-- Append-only. No UPDATE or DELETE route exists, and the table has no
-- updated_at to even record one — an audit log something can edit is not an
-- audit log. There is no retention cap: at household scale (a few hundred
-- works, two editors) the log grows slower than the catalog.
CREATE TABLE change_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,

  -- One save = one batch = one screenful. crypto.randomUUID() in the route.
  batch_id    TEXT    NOT NULL,

  -- 'work' | 'edition' | 'copy' today. No CHECK, following cover_status
  -- (0040) and edition_kind (0050): the set will grow (user_book? watches?)
  -- and a CHECK here makes each addition a table rebuild.
  entity      TEXT    NOT NULL,

  -- ⚠️ Deliberately NOT a foreign key. An audit row must survive the row it
  -- describes — a log that forgets deleted books is useless on exactly the
  -- question ("who deleted this and what did it say?") it exists to answer.
  entity_id   INTEGER NOT NULL,

  -- The column name as the API spells it ('title', 'authors', 'coverUrl'),
  -- or '__row__' for a creation (old is null) or deletion (new is null,
  -- old is the whole row as JSON — the undo material for a bad delete).
  field       TEXT    NOT NULL,

  -- ⚠️ JSON-encoded, NOT NULL — SQL NULL never appears in these two columns.
  -- 'null' (the JSON literal) means "the column was NULL"; there is no way
  -- to write "not recorded", which is the point: a row in this table always
  -- knows both values. Same encoding as research_finding.value_json.
  old_json    TEXT    NOT NULL,
  new_json    TEXT    NOT NULL,

  -- Who and how. `changed_how` reuses DECISION_MODES ('human' | 'auto'),
  -- the same vocabulary as decided_how (0013) and raised_how (0040):
  -- the details queue writes values unread, and its writes must stay
  -- distinguishable from a person's forever.
  changed_by  INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  changed_how TEXT    NOT NULL DEFAULT 'human',

  -- Free text for the fact worth keeping beside the diff: a key move writes
  -- 'reviews restamped: 3', an auto-apply writes 'finding 412'. Nullable —
  -- most edits have nothing extra to say.
  note        TEXT,

  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The two reads this table has: "history of this book" (the book page's
-- Changes panel) and "what changed lately" (a future estate-wide view).
CREATE INDEX idx_change_log_entity ON change_log(entity, entity_id, id);
CREATE INDEX idx_change_log_time   ON change_log(created_at);
```

### 4.2 Who writes it, and the atomicity rule

`createWork` / `updateWork` / `deleteWork` (and their edition/copy siblings)
in `@lc/db` grow an `actor` parameter — `{ userId, how }` — and write their
audit rows **in the same `db.batch()` as the mutation**, so a change and its
record land atomically or not at all. D1's `batch()` is the transaction this
schema gets; two separate awaits would be checklist item 3 (a status written
in a second request can fail while the first succeeded) as an audit bug.

Diff rules:

- **No-op fields are not logged.** A PATCH that re-sends the same description
  writes nothing — otherwise every save is noise and the log stops being read.
- **Derived columns are not logged** (`sort_title`, `primary_author`,
  `universe` when re-derived): they move mechanically with their inputs, and
  logging inputs *and* derivations answers every question twice. **Exception:
  `work_key`.** A key move is the event the entire §5 ceremony exists for, so
  it gets its own row, with `note` carrying the restamp count — which makes
  *"has this book's key ever moved, and were reviews carried"* a one-query
  answer, and is one leg of the server-side evidence floor (§5.2).
- **Creation logs one `__row__` row** ('who added this book' matters — the
  sibling catalog keeps a whole additions log for that question), including
  scan-path and importer creations, stamped `'auto'` with the job in `note`.
- **Deletion logs the whole row as `old_json`** — the undo material.

Undo itself is **not** built here (deliberately — see §9), but every design
choice above (per-field rows, whole-row deletes, JSON values) is made so that
building it later is a feature, not an archaeology dig.

---

## 5. Editing title or author on an established book — the key-move ceremony

### 5.1 The test that tells the two cases apart

The TODO names this the trap: filling in an author later moves `work_key` —
harmless for a book added seconds ago, destructive for one with reviews, and
the remediation path must know the difference.

**Case one is solved by construction, not by testing.** A provisional key
contains `?unknown`; §3.4's guards mean no review document can ever carry it
(nothing with the sentinel ever reaches `reviewDocFor`, the backfill derives
keys only from `catalog.csv`'s real author column, and `core.test.ts` asserts
both). So the server rule is simply:

> A key move **from** a provisional key (`parseWorkKey(old).author ===
> UNKNOWN_AUTHOR`) is always free. Zero documents can carry the old key, so
> zero documents can be orphaned. No check, no ceremony, no attestation.
> This includes fixing a typo'd *title* on a still-provisional book.

**Case two — the old key is real — always gets the ceremony**, because the
server cannot see Firestore (no service account, by design) and therefore can
never *prove* the review count is zero. Absence of evidence is not evidence
of absence; the house rule that "a failed read must be treated as a failed
read" applies to a read the server cannot perform at all.

### 5.2 The ceremony: a two-sided test

**Client side — the live check.** The "Edit title & author" panel, on open,
queries Firestore exactly as `fetchReviews` does: `workKey == currentKey`,
plus legacy `bookId == bookIdFromTitle(currentTitle)`, deduplicated on doc
id. The Save button is disabled until the check *resolves*; a query error
disables Save with *"couldn't check the review link — try again"*. ⚠️ A
failed check is never treated as zero — that is the silent-staleness trap in
one more costume.

**Server side — the evidence floor.** The server holds three kinds of D1
evidence that reviews exist, and refuses an attestation that contradicts it:

| Evidence | Written by |
|---|---|
| `work.reviews_seen_count` / `reviews_seen_at` (new columns, §7) | the browser, whenever a book page's review fetch returns — piggybacked, `'read'`-capability, count+timestamp move together or not at all (0040's pairing rule) |
| `user_book.rating_cached` / `rating_synced_at` / `read_state_how = 'rating'` on any row of the work | the existing observed-ratings paths |
| a `change_log` row for `work_key` whose `note` records restamped reviews | a previous ceremony |

The PATCH contract: `updateWorkSchema` gains an optional `keyMove` object.
When a patch would move a non-provisional key and `keyMove` is absent, the
route answers **409 `key_move_requires_check`** with `{ oldKey, newKey,
evidence }` — which is also what closes today's unguarded-PATCH gap (§1): a
raw API caller can no longer move a key by accident. To proceed the client
sends:

```ts
keyMove: {
  expectedOldKey: string,   // optimistic concurrency: 409 if the work's key
                            // changed since the client looked — two people
                            // editing one book must not silently interleave
  reviewsFound: number,     // what the live check counted
  restamped: number,        // how many docs it re-pointed (§5.3); must equal
                            // reviewsFound, or be 0 when reviewsFound is 0
}
```

Refusals: `expectedOldKey` stale → 409; `reviewsFound: 0` while the evidence
floor says reviews exist → 409 `evidence_mismatch` (a stale client, a failed
read miscoded as zero, or a dev browser on the wrong lane). The floor can
force the careful path; it can never authorize skipping it.

### 5.3 The carry procedure — reviews move with the key, or the key does not move

The review doc **id** is title-slug + name and never changes; only the
`workKey` *field* needs re-pointing. The browser (the only party with
Firestore access, using the signed-in person's own credentials — the same
posture as every other review write) does, in this order:

1. **Firestore first:** for every doc the live check found, merge-write
   `workKey: newKey`. Additive field update; `validReview()` ignores unknown
   fields, so no rules change (same verification as the backfill).
2. **D1 second:** send the PATCH with `keyMove`. The server re-derives the
   new key itself (`workKeyFor` — a caller-supplied key is ignored, per
   `works.ts`'s header rule), writes the work and the audit rows in one
   batch, `note: 'reviews restamped: N'`.

⚠️ **Why Firestore-first is load-bearing.** If the browser dies between the
two steps, the docs carry `newKey` while the work still holds `oldKey` — and
the book's reviews are *still visible*, because `fetchReviews`' legacy
`bookId` query matches on the title slug, which either did not change (author
remediation) or still matches the docs' stored `bookId` field (title edit —
the field holds the old slug forever). Re-running the ceremony is idempotent:
the `workKey` query finds nothing under the old key, the legacy query finds
the already-restamped docs, restamping is a no-op merge, and the PATCH
proceeds. The opposite order has the same degraded-visibility property but
leaves the *database* claiming a key no document carries, with nothing to
notice it; Firestore-first leaves the *pointer* ahead of the *store it points
from*, which the next page load self-heals through the legacy query.

**Clearing an author back to unknown** (real → provisional) is refused
whenever the live check or the evidence floor finds reviews — the sentinel
must never be written onto documents, so there is nothing to carry them *to*.
For a clean, review-less book (the "typo'd author on a book added a minute
ago" case) it is allowed, and is just a key move to a provisional key.

### 5.4 What this deliberately does not solve

A **title** edit changes what `bookIdFromTitle` derives for *future* review
doc ids from this side, while the person's existing review sits under the old
slug — a second doc beside the first if they ever re-review. And the
audiobook site keys off its own `catalog.csv` title, which no library edit
touches, so the two sites' slugs can drift apart. Both are consequences of
the doc-id scheme this design inherits and must not change
(`bookIdFromTitle` is ported verbatim, in bold, for exactly this reason).
See §9 — unsettled, with the mitigation sketched.

---

## 6. What the UI surfaces, and what it must refuse

### Surfaces

1. **`WorkFields` — unchanged.** The free tier keeps its open-type-save
   panel; its header's guard (the patch object that cannot name `title`)
   stays, because the ceremony lives elsewhere.
2. **"Edit title & author"** on the book page — a separate, deliberately
   heavier panel. On open it runs the live check and states the stakes in
   words: *"3 reviews follow this book — they will be carried to the new
   name"* or *"No reviews follow this book — safe to edit."* Save stays
   disabled until the check resolves. On a provisional book the same panel is
   light: the author field is the prominent ask (*"Add the author to unlock
   reviews"*), and saving is the free move.
3. **Add without an author** — the explicit second action on a scan line or
   the add form when title is present and author is not (§3.4.4). Creates
   the work with `UNKNOWN_AUTHOR` in one call; the flag needs no second
   write because it *is* the value (§3.3).
4. **Needs → Author** in the collection filter, a third `SUM` in the needs
   facet, and an "author unknown" mark on the card — the same surface
   `cover`/`watch` share, so the remediation queue is worked in the pass the
   owner already makes.
5. **"Changes"** on the book page — the `change_log` read, newest first,
   grouped by `batch_id`: who, when, field, old → new, and the note. Visible
   to `read` (it is a household), written by no one.

### Refusals — each with its reason said on screen

| Refused | Where enforced | Why |
|---|---|---|
| Editing `isbn13`/`isbn10`/`asin` on an edition | schema (400) + no UI control | identifier of the physical object; delete-and-recreate keeps the trail (§2) |
| A key-moving PATCH without a resolved `keyMove` | route (409) | closes today's unguarded-PATCH gap; the server never moves a real key on faith |
| Save while the live check is pending or failed | UI (disabled + message) | a failed read is a failed read, never a zero |
| A `keyMove` whose `expectedOldKey` is stale | route (409) | two editors must collide loudly, not interleave silently |
| `reviewsFound: 0` against contrary server evidence | route (409) | the floor catches a stale client or a wrong lane |
| Writing a review / draft on a provisional work | route (409) + UI message | the review would detach on remediation (§3.4.1) |
| Displaying legacy-matched reviews on a provisional work | UI | title-only match cannot say whose book it is (§3.4.2) |
| Clearing `authors` on a book with review evidence | route (409) | the sentinel may never be carried onto documents (§5.3) |
| Adding authorless silently | UI | unblocking is deliberate, per the owner's ask (§3.4.4) |

---

## 7. The migration — `migrations/0120_change_log_and_authorless.sql` (NOT applied)

Additive only: one new table, two paired columns, three indexes. **No table
is rebuilt** — that is §3.2's argument and the reason the sentinel design
was chosen. Nothing here backfills anything: no existing row is authorless,
and `reviews_seen_*` starting NULL is the honest "nobody has looked yet"
(0040's rule — an unobserved value is NULL, not a guess).

```sql
-- Edit-any-detail, the audit log, and the authorless book.
-- Design: docs/info/edit-and-audit-design.md. Additive only — no rebuild,
-- deliberately: work is the most-referenced table in this schema, and 0008
-- records what a D1 rebuild of a referenced table costs (stash-and-restore
-- of every child; both escape pragmas measured to LOSE DATA). "No author
-- yet" is therefore a sentinel VALUE ('?unknown', @lc/core UNKNOWN_AUTHOR),
-- not a nullable column — the '?' cannot survive normaliseTitle's fold, so
-- the provisional key can never equal a real one, and reviewDocFor refuses
-- to ever stamp it onto a review document. The columns stay NOT NULL and
-- every existing invariant stands.

-- [ §4.1's CREATE TABLE change_log + its two indexes, verbatim ]

-- ===========================================================================
-- work.reviews_seen_count / reviews_seen_at — the server's evidence floor
-- ===========================================================================
-- The Worker cannot see Firestore (no service account, deliberately —
-- identity-and-reviews.md §3), so it can never PROVE a book has no reviews.
-- What it can hold is the browser's last observation: every book-page review
-- fetch reports what it saw, and a key-moving edit that claims "no reviews"
-- against a positive count here is refused. A read-model of Firestore, like
-- user_book.rating_cached: never authoritative, never written back the
-- other way.
--
-- ⚠️ The pair moves together or not at all — a count with no timestamp is
-- unfalsifiable and a timestamp with no count says nothing (0040's rule:
-- the flag travels with its value). NULL means "no browser has reported",
-- which is true of every row today and is not backfilled, for the same
-- reason 0040 refused to backfill cover_status to 'ok': it would be a value
-- nothing observed.
ALTER TABLE work ADD COLUMN reviews_seen_count INTEGER;
ALTER TABLE work ADD COLUMN reviews_seen_at    TEXT;

-- "Which books still need an author" is NEEDS_CLAUSE's job (derived from
-- authors = '?unknown' — see the design doc for why it is NOT a work_watch
-- row), but the filter and the facet both scan without this.
CREATE INDEX idx_work_unknown_author ON work(id) WHERE authors = '?unknown';
```

Application order, when the owner approves: migrate → deploy, as `CLAUDE.md`
already requires, so new code never meets an old schema — and the sentinel
writes only start after both. Per `docs/FABLE5.md` §5.1 this migration does
not run unattended, and it should be exercised against the local D1
(`npm run dev:worker` + local migrate) before production, like everything
else in this repo that was ever verified.

### Code changes riding along (no schema)

| Where | Change |
|---|---|
| `@lc/core` `constants.ts` | `UNKNOWN_AUTHOR`; add to `index.ts` exports |
| `@lc/core` `titles.ts` | `workKeyFor` sentinel branch (§3.1) |
| `@lc/core` `reviews.ts` | `reviewDocFor` throws on sentinel |
| `@lc/core` `schemas.ts` | `createWorkSchema.authors` → nullable; `updateWorkSchema` + `keyMove`; edition patch refuses identifier keys with a 400 |
| `@lc/core` `core.test.ts` | asserts: fold alphabet excludes `?`; `workKeyFor` emits sentinel key iff sentinel in; `reviewDocFor` throws on sentinel |
| `@lc/db` `works.ts` | `toWork` sentinel→null; create/update null→sentinel; `actor` param + `change_log` batch writes; `NEEDS_AUTHOR`; facet column |
| worker `catalog.ts` | key-move gate on PATCH (§5.2); `POST /works/:id/reviews-seen`; delete logs `__row__` |
| worker `reviews.ts` | `/draft` + `/observed` refuse provisional works |
| web | Edit title & author panel; Add-without-author action; Needs→Author; card mark; Changes panel; Reviews hold message |

---

## 8. Cross-repo: what crosses the boundary, and what does not

`PLATFORM.md` §2.2: each catalog keeps its own database; nothing is merged.
Applied here:

| Crosses the boundary | Stays home |
|---|---|
| **The `change_log` DDL and its semantics** (§4.1) — the same table shape, applied by each repo as its own migration in its own store, so the two sides give one answer to "what happened" | the tables themselves — never shared, never joined |
| **The key-move rules** (§5): restamp-first ordering, the carry-or-refuse contract, the provisional-key freedom. Any writer that ever moves a `work_key` — today only this repo — must obey them | the evidence floor columns — a read-model of Firestore belongs beside the catalog that reads it |
| `workKeyFor` semantics — already the shared bridge contract | ⚠️ **the sentinel itself.** `?unknown` never crosses into Firestore *by construction* (§3.4), which is precisely what lets it stay a library-internal fact. The audiobook site never needs to learn it — the strongest practical argument for this design over a NULL or title-only key, both of which would have leaked into shared queries |

**What the audiobook catalog does with this, and when.** `PLATFORM.md` §2.4
says audiobooks are pipeline-fed and read-only — *"not a temporary state"* —
which sits in visible tension with the owner's "Audiobook catalog will need
this as well." The resolution, checked against that repo's (local-only)
`docs/TODO.md`: its edit surface today is the `edit_overrides` CLI writing
`scripts/catalog_overrides.json`, a **git-tracked file — so git history
already is its audit log**, entry by entry, and nothing needs building there
now. When that catalog gains a real editor (or moves onto the platform's D1),
it applies this DDL and these rules as its own migration. Its TODO already
points here rather than redesigning — noted there on 2026-08-13. One gap on
that side worth recording: its site still writes **no `workKey` on new
reviews** (`identity-and-reviews.md` §7.6), so the legacy `bookId` query —
which §5.3's failure recovery leans on — must not be removed on this side,
and periodically re-running the key backfill remains the sweep's food.

---

## 9. What I could not settle

Recorded per `FABLE5.md` §5.4 — each with what was tried or considered, and
what would settle it.

1. **The title-edit doc-id drift (§5.4).** After a library-side title edit, a
   *future* review by the same person derives a new doc id from the new
   title and lands beside their old review as a sibling. Considered: deriving
   doc ids from something stable (impossible — `bookIdFromTitle` is ported
   verbatim because every existing production id was built with it);
   having the ceremony also rewrite doc *ids* (a delete+create of other
   people's documents — far more invasive than a field merge, and it would
   break the audiobook site's own `getReviews(db, bookId)` for its
   spelling). Live-with-it mitigation: the ceremony already restamps
   `workKey`, so *reading* stays correct — both docs join the same work; the
   duplicate only appears if the person re-reviews from this side after a
   retitle. What would settle it: a measured answer to how often a title
   edit will actually happen on a reviewed book (my expectation: nearly
   never — the champion case is subtitle/series fixes, which are free-tier),
   or a dedupe-on-write in `reviewDocFor` that queries for an existing doc
   by `workKey`+name before choosing its id. The latter is a real design
   with a real cost (a read before every review write) and needs its own
   review.
2. **Firestore's open-write posture is what makes the carry possible.**
   `firestore.rules` checks shape only — no `request.auth` — so *any* client
   can merge `workKey` onto *anyone's* review doc. The carry procedure
   depends on exactly this. If the rules are ever hardened (the 2026-08-10
   `/users` hardening on the audiobook side shows the appetite exists), the
   restamp breaks silently for other people's docs. Not settled here because
   the posture is the other repo's, and hardening it is a feature with an
   owner-sized blast radius. What would settle it: a decision recorded in
   `PLATFORM.md` on whether `reviews` ever gets `request.auth` rules, and if
   so, the carry moves server-side behind the service account this estate
   has so far refused to hold — a genuine trade-off to argue that day.
3. **Whether `reviews_seen_*` is worth its two columns.** It is
   defense-in-depth behind the client attestation, and its honest trigger
   rate should be near zero (it fires on a stale client, a miscoded failed
   read, or a wrong lane). I kept it because the failure it catches —
   orphaning 860-review joins on a false zero — is the one this estate calls
   its most expensive, and the cost is two nullable columns and a piggyback
   POST. A reviewer who values schema thrift over belt-and-braces could cut
   it and lose only the floor, not the ceremony. Settled by: the owner's
   taste, in the morning.
4. **`change_log` volume from bulk imports.** Creation logging (`__row__`,
   `'auto'`) on an ebook import of a few hundred works writes a few hundred
   rows in one batch. Almost certainly fine at this scale; not measured,
   because measuring means running an import. If it ever reads as noise, the
   fix is a display filter (`changed_how = 'human'` by default in the
   Changes panel), not a write filter — the estate's precedent is to record
   and distinguish, never to skip.
5. **Not verified by execution.** The migration SQL has not been run against
   a local D1 (design-only task; the partial index on a literal and the
   ADD COLUMNs are all shapes existing migrations already use, but "it
   parses in my head" is not verification). The Firestore merge-write path
   is the same one the 2026-08-12 backfill used successfully, but the
   restamp-then-PATCH interleaving has never been exercised. Both belong in
   the build task's checklist, with the local dev-bypass curl loop
   `CLAUDE.md` describes.

---

*Fable 5, 2026-08-13. Review checklist (§3 of FABLE5.md) applied to this
design's own proposals: key moves are the subject (1); nothing invents a fact
— the sentinel is machine-marked, never displayed as an author (2); every
flag travels with its value or is derived from it (3); no edition/copy
creation paths change (4); `workKeyFor` extended in place, no second
implementation (5); every failure mode above is distinguishable from success
by construction or by a 409 (6); the migration exists and therefore does not
ship unattended (7).*
