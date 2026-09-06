/**
 * Data repair: `edition.isbn13` values written by the **2026-08-20 ISBN
 * backfill** that belong to a DIFFERENT object from the printing they sit on.
 *
 * Owner decision 2026-09-05 (decision 5 of the day's list). The writer half is
 * fixed in `scripts/backfill-missing-isbns.mjs` — a language gate on every free
 * rung, a refusal to fill a printing that states it has no ISBN, and a
 * `change_log` row per changed field, all pinned by
 * `scripts/test/backfill-safety.test.mjs`. This is the data half.
 *
 * Full write-up: `docs/info/isbn-ladder.md` §7.
 *
 * ## Who wrote them, and how that was established
 *
 * `scripts/backfill-missing-isbns.mjs`, run `--remote --commit` on 2026-08-20 —
 * twice, at **15:33:26Z** (free rungs, 45 rows) and **18:03–18:04Z** (the
 * `--llm` rung, 19 rows). Five independent lines of evidence:
 *
 *   1. Three of its own stdout logs are still in the repo root
 *      (`isbn-backfill-llm.log`, `isbn-backfill-llm2.log`, `isbn-final.log`,
 *      UTF-16LE, dated 2026-08-20), each opening
 *      `> library-catalog@0.1.0 backfill:missing-isbns` /
 *      `tsx scripts/backfill-missing-isbns.mjs --remote --llm --commit`.
 *   2. The ISBNs those logs report finding are the ISBNs now on the rows
 *      (`9781981818648` → ed#336, `9781039470224` → ed#486, …).
 *   3. The version of the script in force that day wrote
 *      `source = ${lit(f.source === 'llm' ? 'research' : f.source)}` — a blunt
 *      overwrite. That is exactly the `manual → openlibrary` flip on the
 *      Illumicrate rows. The `CASE` that preserves `manual` landed four days
 *      later, in `fd705b0` (2026-08-24, "audit HIGH :517").
 *   4. Its rung→source mapping produces the three source values seen across
 *      both batches (`openlibrary`, `googlebooks`, `research`), and nothing else
 *      in this repo writes `edition.source = 'research'` beside an `isbn13`.
 *   5. It wrote no `change_log` row anywhere — matching the total absence of one.
 *
 * ⚠️ **Honest gap:** the 15:33:26Z batch has no surviving log of its own. It is
 * attributed by code-path signature (source values, one batched `execute`, the
 * `CANDIDATES_SQL` target set), not by a log line naming it.
 *
 * ## Why it filed the wrong book — the two holes, both now closed
 *
 *   - `CANDIDATES_SQL` takes works with no ISBN on ANY edition and writes to the
 *     **oldest** edition row. On this catalogue those works are the crowdfunded
 *     and exclusive ones, so the target is nearly always a SPECIAL printing:
 *     **42 of the 43 rows it filled**, measured 2026-09-05.
 *   - Rung 1 read `doc.isbn` off an Open Library **work** search result — its own
 *     comment says *"an array of ALL isbns from all editions of this work"* — and
 *     took the first one that parsed. The title gate scores the WORK's title, so
 *     a translation passes at `sim 1.00`; the log shows exactly that for a Korean
 *     printing of *Understanding the Old Testament*. Rung 2 had
 *     `volumeInfo.language` in hand all along and never read it.
 *
 * ## What it does to a row it claims
 *
 *   1. `edition.isbn13` → NULL, on an explicit id list with **asserted
 *      from-values** (the `fix-illumicrate-publisher-2026-09-05.mjs` shape —
 *      never an UPDATE over a predicate).
 *   2. `edition.source` → `'manual'` **only where the row was manual before the
 *      backfill demoted it**. That is provable for exactly the three Illumicrate
 *      rows (307, 308, 311): they were created by
 *      `import-illumicrate-percy-jackson.mjs`, which writes `source = 'manual'`,
 *      and its two untouched siblings (309, 310 — the ones the backfill found no
 *      ISBN for) still read `manual` today. Every other row here was already
 *      automated provenance and keeps it: restoring a `manual` that cannot be
 *      evidenced would be inventing provenance to repair a provenance bug.
 *   3. One `change_log` row **per changed field**, batch
 *      `fix-2026-09-05-foreign-isbns`, `changed_how = 'auto'`.
 *
 * ⚠️ **This does NOT invent the right ISBN.** These printings have none that is
 * known: three carry an owner-verified note saying no ISBN is printed on them,
 * and most of the rest are slipcase volumes whose set carries the only barcode.
 * NULL is a gap the ladder can find later; a plausible number is a silent one —
 * the same reasoning as `fix-illumicrate-publisher-2026-09-05.mjs`.
 *
 * ## The three tiers
 *
 * **A (default) — 12 rows, WRONG OBJECT.** Measured against openlibrary.org
 * 2026-09-05 through the repo's own `lookupOpenLibraryByIsbn` plus the
 * per-edition `/isbn/<isbn>.json` record. Each is a different book, a different
 * language, a different medium, or contradicted by the row's own name.
 * ✅ **APPLIED by the owner 2026-09-06 01:23:49Z (2026-09-05 18:23 Phoenix).**
 * Those rows now read `isbn13 IS NULL` and are reported by this script as
 * **already applied** — see the `already` branch, which is load-bearing: it
 * checks `isbn13 == null` BEFORE asserting the from-value, so a re-run of a
 * landed tier is idempotent rather than a crash.
 *
 * **B (`--also-declared-no-isbn`) — 17 rows, RIGHT BOOK, WRONG PRINTING.** Rows
 * whose own `edition_name` says *"no per-volume ISBN recorded"* and which the
 * same run filled anyway. The ISBN is a real printing of the same title.
 *
 * **C (`--also-crowdfunded`) — 13 rows, CROWDFUNDED PRINTINGS.** Kickstarter,
 * Indiegogo, collector's and campaign-tier printings the owner holds, filled with
 * a plausible trade ISBN. 🔴 **Approved by the owner 2026-09-05 18:29 Phoenix**,
 * verbatim:
 *
 * > **"For the kickstarters we have in stock the ISBNs are recorded if they
 * > exist."**
 *
 * ⚠️ That one sentence is what turns tiers B and C from judgement calls into the
 * same finding as tier A. On a crowdfunded printing in this household's hands,
 * `isbn13 IS NULL` is not a gap awaiting research — it is the owner's ANSWER,
 * recorded at entry, because if the object carried an ISBN he would have typed
 * it. The 2026-08-20 run therefore did not fill a blank; it **overwrote a
 * measured absence with a guess**. Same logic reaches tier B, whose rows say so
 * in their own names. Both are approved; `--all-tiers` runs A + B + C.
 *
 * The flags stay separate rather than collapsing into one, so the owner can still
 * land a tier at a time and so the WHY note recorded in `change_log` names the
 * actual reason for each row.
 *
 * ⚠️ **One row of the original "14 untouched" is deliberately NOT in tier C:
 * edition #507** (*The Book of Mormon*, work 375, `9780929753249`). Measured
 * 2026-09-05: its `edition_name` is **NULL**, its `note` is **NULL**, it is a
 * plain `paperback`, its two owned copies carry no `edition_notes` and none of
 * the `leatherbound` / `slipcase` / `sprayed_edges` flags, and no crowdfunding
 * importer in `scripts/` names it. `isbn-ladder.md` §7.1 already recorded it as
 * *"the one ordinary printing"* among the 43. The owner's ruling is about **"the
 * kickstarters we have in stock"** and does not reach a row with no evidence of
 * being one. ⚠️ It is still an OPEN question, just a different one: the ISBN on
 * it is Stratford Books' *"Hand Leather Bound Pocket Edition"* (Open Library
 * `OL8358629M`, 2007, English) sitting on a row whose `format` is `paperback` —
 * wrong medium, English, so the language gate would never have caught it. Left
 * for the owner in `docs/TODO.md`.
 *
 * ## Measured 2026-09-05, both instances, production
 *
 * | | tier A | tier B | tier C | left out |
 * |---|---|---|---|---|
 * | main (`library-catalog`) | **12** (applied) | **17** | **13** | 1 (#507) |
 * | padhard (`library-catalog-2nd`) | **0** | **0** | **0** | 0 |
 *
 * padhard was **unreachable** by the 2026-08-20 run — `scripts/lib/d1.mjs` gained
 * `--friend` on 2026-08-22 (before that `DB_NAME` was a constant), and her
 * earliest edition writes are 2026-08-22 02:00Z. Re-measured anyway rather than
 * argued: 0 rows there declare no ISBN yet carry one, and her only non-English
 * registration group is `9789358568417` on work #618, which this run did not
 * write. `--friend` is expected to be a no-op, and that zero is a result.
 *
 *   node scripts/fix-foreign-isbns-2026-09-05.mjs --remote            # dry run
 *   node scripts/fix-foreign-isbns-2026-09-05.mjs --remote --commit
 *   node scripts/fix-foreign-isbns-2026-09-05.mjs --remote --friend
 *   node scripts/fix-foreign-isbns-2026-09-05.mjs --remote --friend --commit
 *   node scripts/fix-foreign-isbns-2026-09-05.mjs --remote --also-declared-no-isbn  # + B
 *   node scripts/fix-foreign-isbns-2026-09-05.mjs --remote --also-crowdfunded       # + C
 *   node scripts/fix-foreign-isbns-2026-09-05.mjs --remote --all-tiers              # A + B + C
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const BATCH = 'fix-2026-09-05-foreign-isbns';

/**
 * TIER A — the wrong object.
 *
 * 🔴 **MAIN-INSTANCE IDS. They mean nothing on padhard, and checking them there
 * is a bug** — the two instances are separate D1 databases with separate
 * AUTOINCREMENT sequences. `fix-shop-publisher-2026-09-05.mjs` learned that on
 * its first `--friend` run, where the protected id was a different book
 * entirely. On padhard this list is not consulted; the safety there is the
 * measured zero, re-measured by every run.
 *
 * `sourceTo` is set only where the pre-backfill `source` is EVIDENCED. See the
 * header, step 2.
 */
const TIER_A = [
  {
    id: 307, work: 224, title: 'The Lightning Thief', from: '9780786838653',
    sourceFrom: 'openlibrary', sourceTo: 'manual',
    evidence:
      'The Lightning Thief, Disney-Hyperion Books 2006 — the US trade printing, not this UK ' +
      "subscription-box hardcover. The row's own note is owner-verified: no ISBN is printed on it.",
  },
  {
    id: 308, work: 225, title: 'The Sea of Monsters', from: '9782226177612',
    sourceFrom: 'openlibrary', sourceTo: 'manual',
    evidence:
      'La mer des monstres — Albin Michel 2007, FRENCH (OL languages: fre). ' +
      "The row's own note is owner-verified: no ISBN is printed on it.",
  },
  {
    id: 311, work: 228, title: 'The Last Olympian', from: '9788362170043',
    sourceFrom: 'openlibrary', sourceTo: 'manual',
    evidence:
      'Ostatni Olimpijczyk — Jaguar 2010, POLISH (OL languages: pol). ' +
      "The row's own note is owner-verified: no ISBN is printed on it.",
  },
  {
    id: 316, work: 222, title: 'Dungeon Crawler Carl: Crocodile', from: '9791281656383',
    sourceFrom: 'googlebooks', sourceTo: null,
    evidence:
      'registration group 979-12 is ITALY; Open Library holds no record of it at all, so nothing ' +
      'attests it is this English campaign-only exclusive hardcover.',
  },
  {
    id: 321, work: 220, title: 'Words of Radiance', from: '9781399622073',
    sourceFrom: 'openlibrary', sourceTo: null,
    evidence:
      'Words of Radiance, Orion Publishing Group 2024 — a UK trade hardcover. The row is the ' +
      "Dragonsteel leatherbound and its own edition_name names the two real ISBNs " +
      '(9781938570308 / 9781938570315), so the row contradicts itself.',
  },
  {
    id: 329, work: 236, title: "Carl's Doomsday Scenario", from: '9783596712496',
    sourceFrom: 'openlibrary', sourceTo: null,
    evidence: 'Carl’s Doomsday Scenario — FISCHER Tor, GERMAN (OL languages: ger).',
  },
  {
    id: 584, work: 462, title: 'Starsight', from: '9788381168830',
    sourceFrom: 'openlibrary', sourceTo: null,
    evidence: 'Wśród gwiazd — Zysk i S-ka 2020, POLISH (OL languages: pol).',
  },
  {
    id: 585, work: 463, title: 'Cytonic', from: '9781713664017',
    sourceFrom: 'openlibrary', sourceTo: null,
    evidence:
      'Cytonic — Audible Studios on Brilliance Audio: an AUDIOBOOK ISBN on a paperback row. ' +
      'A recording is not a printing, and this catalogue keeps audio in audiobook_holding.',
  },
  {
    id: 587, work: 464, title: 'Oathbringer', from: '9786052382349',
    sourceFrom: 'openlibrary', sourceTo: null,
    evidence:
      'Oathbringer — Akılçelen Kitaplar 2019, a TURKISH publisher; registration group 978-605 ' +
      'is Turkey. The row is a volume of a Tor US slipcase set.',
  },
  {
    id: 589, work: 466, title: 'The Son of Neptune', from: '9788424664558',
    sourceFrom: 'openlibrary', sourceTo: null,
    evidence: 'El fill de Neptú — La Galera 2019, CATALAN (OL languages: cat).',
  },
  {
    id: 595, work: 472, title: "The Tyrant's Tomb", from: '9788417773090',
    sourceFrom: 'openlibrary', sourceTo: null,
    evidence: 'La tumba del tirano — Montena 2020, SPANISH (OL languages: spa).',
  },
  {
    id: 596, work: 473, title: 'The Tower of Nero', from: '9780593290941',
    sourceFrom: 'openlibrary', sourceTo: null,
    evidence:
      'The Tower of Nero — Listening Library 2020: an AUDIOBOOK ISBN on a paperback row.',
  },
];

/**
 * TIER B — the right book on the wrong printing, and the row says so itself.
 *
 * Every one is a *"Volume of the slipcase set (set ISBN …); no per-volume ISBN
 * recorded"* row that the 2026-08-20 run filled anyway. The ISBN is a genuine
 * printing of the same title in English, so this is the owner's judgement rather
 * than a measurement — which is why it is behind a flag.
 */
const TIER_B = [
  { id: 477, work: 349, title: 'Over Sea, Under Stone', from: '9780152590345', sourceFrom: 'googlebooks' },
  { id: 478, work: 350, title: 'Greenwitch', from: '9780689704314', sourceFrom: 'googlebooks' },
  { id: 479, work: 351, title: 'The Grey King', from: '9781665932950', sourceFrom: 'googlebooks' },
  { id: 480, work: 352, title: 'Silver on the Tree', from: '9780689849183', sourceFrom: 'googlebooks' },
  { id: 481, work: 353, title: 'Speaker for the Dead', from: '9780812513509', sourceFrom: 'openlibrary' },
  { id: 482, work: 354, title: 'Xenocide', from: '9781250773074', sourceFrom: 'openlibrary' },
  { id: 483, work: 355, title: 'Children of the Mind', from: '9780312861919', sourceFrom: 'openlibrary' },
  { id: 580, work: 458, title: 'A Court of Mist and Fury', from: '9781619635197', sourceFrom: 'googlebooks' },
  { id: 581, work: 459, title: 'A Court of Wings and Ruin', from: '9781408857915', sourceFrom: 'openlibrary' },
  { id: 582, work: 460, title: 'A Court of Frost and Starlight', from: '9781635575620', sourceFrom: 'openlibrary' },
  { id: 583, work: 461, title: 'A Court of Silver Flames', from: '9781526635365', sourceFrom: 'openlibrary' },
  { id: 588, work: 465, title: 'Rhythm of War', from: '9780575093393', sourceFrom: 'openlibrary' },
  { id: 590, work: 467, title: 'The Mark of Athena', from: '9781368051422', sourceFrom: 'openlibrary' },
  { id: 591, work: 468, title: 'The House of Hades', from: '9780141339207', sourceFrom: 'googlebooks' },
  { id: 592, work: 469, title: 'The Blood of Olympus', from: '9781902603896', sourceFrom: 'openlibrary' },
  { id: 593, work: 470, title: 'The Dark Prophecy', from: '9781368013772', sourceFrom: 'openlibrary' },
  { id: 594, work: 471, title: 'The Burning Maze', from: '9780141363998', sourceFrom: 'openlibrary' },
];

/**
 * TIER C — crowdfunded printings the owner HOLDS, filled with a trade ISBN.
 *
 * 🔴 **Approved by the owner 2026-09-05 18:29 Phoenix**, verbatim:
 *
 * > **"For the kickstarters we have in stock the ISBNs are recorded if they
 * > exist."**
 *
 * These are the rows this script's own header used to call *"deliberately left
 * ALONE"*, on the reasoning that *"whether a crowdfunded hardcover shares the
 * trade ISBN is a question about the physical object, and only the owner can
 * answer it with the book in his hand."* ⚠️ **He answered it.** The absent ISBN
 * on such a row is a MEASURED ABSENCE — recorded at entry — so these are the same
 * finding as tier A: a wrong object written over a recorded fact.
 *
 * Every `from` value below was **re-read live from production 2026-09-05** before
 * this list was written, not carried over from the earlier measurement. The
 * asserted-from-value guard stays in force regardless.
 *
 * `sourceTo: 'manual'` is set only where the pre-backfill provenance is
 * **EVIDENCED**, on the same standard tier A used (never invented):
 *
 *   - **#330** — created by `scripts/add-dcc-kickstarter.mjs`, whose INSERT
 *     writes `edition_name = 'Kickstarter limited edition hardcover'`,
 *     `edition_kind = 'collectors'`, `source = 'manual'` for exactly the two DCC
 *     works (236, 237); the row matches all three fields.
 *   - **#331 #332 #334 #335 #343 #344 #345 #349 #350** — created by
 *     `scripts/add-crowdfunding-rescan-books.mjs`, whose INSERTs write
 *     `source = 'manual'` with a comment saying why. Corroborated in the data:
 *     that import batch is `created_at = '2026-08-12 06:21:00'`, and of its 28
 *     edition rows the **13 the backfill never touched** (`updated_at ==
 *     created_at`) read `source = 'manual'` **unanimously** — #339 #341 #346 #347
 *     #348 #351 #352 #353 #354 #355 #356 #357 #358.
 *   - **#317 #319 #320** get `sourceTo: null`. Their batch
 *     (`created_at = '2026-08-11 13:32:46'`) has **no untouched sibling of the
 *     same shape**, and `scripts/import-crowdfunding.mjs` — the only script that
 *     reads `crowdfunding-scan.json`, where these three campaigns live —
 *     **creates no `edition` rows at all, deliberately**. So nothing evidences
 *     what their `source` was, and restoring a `manual` that cannot be evidenced
 *     would repair a provenance bug with a provenance lie.
 */
const TIER_C = [
  {
    id: 317, work: 219, title: 'Fires of December', from: '9781938570728',
    sourceFrom: 'openlibrary', sourceTo: null,
    evidence:
      'Campaign tier "Book with sticker and bookmark tier" (Dragonsteel). Owner ruling 2026-09-05: ' +
      '"For the kickstarters we have in stock the ISBNs are recorded if they exist" — so the absent ' +
      'ISBN was his answer, and 9781938570728 is a trade printing written over it.',
  },
  {
    id: 319, work: 221, title: 'The Primal Hunter', from: '9798426232426',
    sourceFrom: 'openlibrary', sourceTo: null,
    evidence:
      'Campaign printing "Collector\'s Edition Trilogy — Book 1 Numbered" — a NUMBERED collector\'s ' +
      'copy, which by definition is not the trade run. Owner ruling 2026-09-05: "For the ' +
      'kickstarters we have in stock the ISBNs are recorded if they exist."',
  },
  {
    id: 320, work: 223, title: 'Ascend Online: Legacy of the Fallen', from: '9781775241317',
    sourceFrom: 'openlibrary', sourceTo: null,
    evidence:
      'Campaign printing "Collector\'s Edition" (crowdfunding-scan.json: "Collector\'s Edition of ' +
      'Ascend Online: Legacy of the Fallen!"). Owner ruling 2026-09-05: "For the kickstarters we ' +
      'have in stock the ISBNs are recorded if they exist."',
  },
  {
    id: 330, work: 237, title: "The Dungeon Anarchist's Cookbook", from: '9798724495066',
    sourceFrom: 'openlibrary', sourceTo: 'manual',
    evidence:
      '"Kickstarter limited edition hardcover", created by scripts/add-dcc-kickstarter.mjs (which ' +
      'writes source=manual). Owner ruling 2026-09-05: "For the kickstarters we have in stock the ' +
      'ISBNs are recorded if they exist."',
  },
  {
    id: 331, work: 238, title: 'Ritualist', from: '9781986338509',
    sourceFrom: 'openlibrary', sourceTo: 'manual',
    evidence:
      '"Kickstarter Grimoire Edition — faux leather", created by ' +
      'scripts/add-crowdfunding-rescan-books.mjs (source=manual; 13 untouched siblings of the same ' +
      'batch still read manual). Owner ruling 2026-09-05: "For the kickstarters we have in stock ' +
      'the ISBNs are recorded if they exist."',
  },
  {
    id: 332, work: 239, title: 'Regicide', from: '9781950914142',
    sourceFrom: 'openlibrary', sourceTo: 'manual',
    evidence:
      '"Kickstarter Grimoire Edition — faux leather", created by ' +
      'scripts/add-crowdfunding-rescan-books.mjs (source=manual). Owner ruling 2026-09-05: "For ' +
      'the kickstarters we have in stock the ISBNs are recorded if they exist."',
  },
  {
    id: 334, work: 241, title: 'Raze', from: '9781637660898',
    sourceFrom: 'openlibrary', sourceTo: 'manual',
    evidence:
      '"Kickstarter Grimoire Edition — faux leather", created by ' +
      'scripts/add-crowdfunding-rescan-books.mjs (source=manual). Owner ruling 2026-09-05: "For ' +
      'the kickstarters we have in stock the ISBNs are recorded if they exist."',
  },
  {
    id: 335, work: 242, title: 'Ruthless', from: '9781950914623',
    sourceFrom: 'openlibrary', sourceTo: 'manual',
    evidence:
      '"Kickstarter Grimoire Edition — faux leather", created by ' +
      'scripts/add-crowdfunding-rescan-books.mjs (source=manual). Owner ruling 2026-09-05: "For ' +
      'the kickstarters we have in stock the ISBNs are recorded if they exist."',
  },
  {
    id: 343, work: 250, title: 'Space Knight Book 2', from: '9781951641856',
    sourceFrom: 'googlebooks', sourceTo: 'manual',
    evidence:
      '"Crowdfunded print copy", created by scripts/add-crowdfunding-rescan-books.mjs ' +
      '(source=manual). Owner ruling 2026-09-05: "For the kickstarters we have in stock the ISBNs ' +
      'are recorded if they exist."',
  },
  {
    id: 344, work: 251, title: 'Space Knight Book 3', from: '9781986619233',
    sourceFrom: 'googlebooks', sourceTo: 'manual',
    evidence:
      '"Crowdfunded print copy", created by scripts/add-crowdfunding-rescan-books.mjs ' +
      '(source=manual). ⚠️ This is also the ISBN Google Books proposed for FIVE different Space ' +
      'Knight volumes (5-9) in the 2026-09-05 dry run, which is a title-gate defect in its own ' +
      'right. Owner ruling 2026-09-05: "For the kickstarters we have in stock the ISBNs are ' +
      'recorded if they exist."',
  },
  {
    id: 345, work: 252, title: 'Space Knight Book 4', from: '9781721829316',
    sourceFrom: 'googlebooks', sourceTo: 'manual',
    evidence:
      '"Crowdfunded print copy", created by scripts/add-crowdfunding-rescan-books.mjs ' +
      '(source=manual). Owner ruling 2026-09-05: "For the kickstarters we have in stock the ISBNs ' +
      'are recorded if they exist."',
  },
  {
    id: 349, work: 256, title: 'Monster Empire Book 1', from: '9781951641122',
    sourceFrom: 'googlebooks', sourceTo: 'manual',
    evidence:
      '"Kickstarter paperback", created by scripts/add-crowdfunding-rescan-books.mjs ' +
      '(source=manual). Owner ruling 2026-09-05: "For the kickstarters we have in stock the ISBNs ' +
      'are recorded if they exist."',
  },
  {
    id: 350, work: 257, title: 'Ascend Online', from: '9780995337800',
    sourceFrom: 'openlibrary', sourceTo: 'manual',
    evidence:
      '"Kickstarter Collector\'s Edition", created by scripts/add-crowdfunding-rescan-books.mjs ' +
      '(source=manual). Owner ruling 2026-09-05: "For the kickstarters we have in stock the ISBNs ' +
      'are recorded if they exist."',
  },
];

const WHY =
  'The 2026-08-20 run of scripts/backfill-missing-isbns.mjs filled this printing with an ISBN ' +
  'belonging to a different object. Owner decision 2026-09-05. Two holes, both now closed in the ' +
  "writer: rung 1 read Open Library's WORK-level isbn array (every translation) and took the first " +
  'that parsed, while the title gate scored the work title and so passed a translation at sim 1.00; ' +
  'and the run targets the OLDEST edition of a work with no ISBN, which on this catalogue is nearly ' +
  'always a special printing (42 of the 43 rows it filled). NULL rather than a corrected ISBN ' +
  'because these printings have no known one — three carry an owner-verified note that no ISBN is ' +
  'printed on them, and the rest are slipcase volumes whose set holds the only barcode. ' +
  'Per-row evidence: scripts/fix-foreign-isbns-2026-09-05.mjs. See docs/info/isbn-ladder.md §7.';

/**
 * The `change_log` note for a TIER C row. It carries the owner's ruling VERBATIM
 * and dated, because that sentence — not a measurement — is the whole warrant for
 * nulling these rows, and a `change_log` reader a year from now needs to see it
 * without opening a doc.
 */
const WHY_CROWDFUNDED =
  'The 2026-08-20 run of scripts/backfill-missing-isbns.mjs filled this crowdfunded/collector\'s ' +
  'printing with a trade ISBN belonging to a different object. OWNER RULING 2026-09-05 18:29 ' +
  'Phoenix, verbatim: "For the kickstarters we have in stock the ISBNs are recorded if they ' +
  'exist." On a crowdfunded printing the owner holds, an ABSENT isbn13 is therefore a MEASURED ' +
  'ABSENCE — he records the ISBN at entry when the object carries one — so this row had already ' +
  'answered the question and the backfill overwrote a recorded fact with a guess. NULL restores ' +
  'the recorded absence; it does not assert a new one. The writer can no longer do this: ' +
  'scripts/lib/backfill-safety.mjs isCrowdfundedPrinting skips these rows and prints why. ' +
  'Per-row evidence: scripts/fix-foreign-isbns-2026-09-05.mjs. See docs/info/isbn-ladder.md §7.';

const flags = parseFlags();
/**
 * ⚠️ The flag set is deliberately three switches plus an umbrella, not one
 * `--yes`. `--also-declared-no-isbn` is kept under its original spelling because
 * `docs/TODO.md` records it as the line the owner was given for tier B, and a
 * flag renamed out from under a written instruction is how a runbook goes stale.
 */
const alsoDeclared = process.argv.includes('--also-declared-no-isbn');
const alsoCrowdfunded = process.argv.includes('--also-crowdfunded');
const allTiers = process.argv.includes('--all-tiers');
const wantB = allTiers || alsoDeclared;
const wantC = allTiers || alsoCrowdfunded;
const target = { remote: flags.remote, friend: flags.friend };
const q = (sql) => query(sql, target);
const where = flags.friend ? 'padhard' : flags.remote ? 'production' : 'local';

/**
 * ⚠️ `changed_by` is a real `app_user(id)` and the instances do NOT share one.
 * On main, 1 is the owner. On padhard, user 1 is HER, and stamping her name on a
 * repair she did not make would be a lie in the one table written to be trusted.
 */
const CHANGED_BY = flags.friend ? 'NULL' : '1';

/** Each row carries its tier, so the log line and the `change_log` note can name it. */
const ROWS = [
  ...TIER_A.map((r) => ({ ...r, tier: 'A' })),
  ...(wantB ? TIER_B.map((r) => ({ ...r, tier: 'B' })) : []),
  ...(wantC ? TIER_C.map((r) => ({ ...r, tier: 'C' })) : []),
];
const TIERS = ['A', ...(wantB ? ['B'] : []), ...(wantC ? ['C'] : [])].join(' + ');

// ---------------------------------------------------------------------------
// 1. Measure. Read the live rows by ID and assert every from-value, so a row
//    that has moved since 2026-09-05 stops the run instead of being overwritten.
// ---------------------------------------------------------------------------
console.log(`\n${where}: tier ${TIERS} — ${ROWS.length} row(s) in this batch's evidence list.`);

if (flags.friend) {
  /*
   * ⚠️ On padhard the id list is not consulted at all — ids are per-database.
   * The safety here is the measured zero, and it is re-measured on every run
   * rather than asserted from the header. Two signatures of the defect are
   * checked: a printing that declares it has no ISBN yet carries one, and an
   * ISBN whose registration group is not the English-language group.
   */
  const declared = q(
    `SELECT e.id, e.isbn13, e.edition_name, e.note, w.title
       FROM edition e JOIN work w ON w.id = e.work_id
      WHERE e.isbn13 IS NOT NULL
        AND (e.edition_name LIKE '%no per-volume ISBN%' OR e.edition_name LIKE '%no ISBN%'
             OR e.note LIKE '%no ISBN%' OR e.note LIKE '%no barcode%')`,
  );
  const foreign = q(
    `SELECT e.id, e.isbn13, e.source, w.title
       FROM edition e JOIN work w ON w.id = e.work_id
      WHERE e.isbn13 IS NOT NULL
        AND substr(e.isbn13, 1, 3) = '978'
        AND substr(e.isbn13, 4, 1) NOT IN ('0', '1')`,
  );
  /*
   * Signature 3, added 2026-09-05 with tier C: a crowdfunded / collector's
   * printing that carries an ISBN. Under the owner's ruling that is the tier C
   * defect, and it has to be MEASURED here rather than inferred from the main
   * instance's zero — padhard is a separate catalogue with a separate owner's
   * habits, and this script's whole point is not assuming.
   */
  const campaign = q(
    `SELECT e.id, e.isbn13, e.source, e.edition_name, w.title
       FROM edition e JOIN work w ON w.id = e.work_id
      WHERE e.isbn13 IS NOT NULL
        AND (e.edition_name LIKE '%Kickstarter%' OR e.edition_name LIKE '%Indiegogo%'
             OR e.edition_name LIKE '%crowdfund%' OR e.edition_name LIKE '%BackerKit%'
             OR e.edition_name LIKE '%campaign%' OR e.edition_name LIKE '%Collector%'
             OR e.edition_name LIKE '%limited%' OR e.edition_name LIKE '%numbered%'
             OR e.edition_name LIKE '%exclusive%' OR e.edition_name LIKE '%Grimoire%')`,
  );
  console.log(`  printings that declare no ISBN yet carry one: ${declared.length}`);
  for (const r of declared) console.log(`    ed#${r.id} ${r.isbn13} — ${r.title}`);
  console.log(`  ISBNs outside the English registration group: ${foreign.length}`);
  for (const r of foreign) console.log(`    ed#${r.id} ${r.isbn13} source=${r.source} — ${r.title}`);
  console.log(`  crowdfunded/collector's printings carrying an ISBN (tier C): ${campaign.length}`);
  for (const r of campaign) {
    console.log(`    ed#${r.id} ${r.isbn13} source=${r.source} — ${r.title} — "${r.edition_name}"`);
  }
  console.log(
    '\nNothing to do on padhard. That is a result, not a failure — the 2026-08-20 run could not ' +
      'reach this instance (scripts/lib/d1.mjs gained --friend on 2026-08-22), and the three ' +
      'signatures above are re-measured rather than assumed.',
  );
  console.log(
    '⚠️ A NON-ZERO tier C count here is NOT automatically the same defect. On padhard a ' +
      "crowdfunded printing carrying an ISBN may simply be a recorded one — the owner's ruling " +
      'is about HIS data-entry habit, and nobody has asked her about hers. Read the rows, then ask.',
  );
  process.exit(0);
}

const live = q(
  `SELECT e.id, e.work_id, e.isbn13, e.source, e.edition_name, w.title
     FROM edition e JOIN work w ON w.id = e.work_id
    WHERE e.id IN (${ROWS.map((r) => r.id).join(',')})
    ORDER BY e.id`,
);
const byId = new Map(live.map((r) => [r.id, r]));

const claimed = [];
const already = [];
for (const row of ROWS) {
  const now = byId.get(row.id);
  if (!now) {
    throw new Error(`edition #${row.id} (${row.title}) is not in this database — read why before running this.`);
  }
  /*
   * ⚠️ ALREADY APPLIED — and this branch must stay AHEAD of both assertions.
   *
   * Tier A landed on production at 2026-09-06 01:23:49Z, so those 12 rows now
   * read `isbn13 IS NULL` and three of them read `source = 'manual'` rather than
   * the `sourceFrom` recorded here. If the from-value assertions ran first, every
   * later `--all-tiers` run would die on a row that is *correctly repaired* —
   * a script that cannot be re-run after it succeeds is a script nobody trusts
   * to run at all. Absent an ISBN there is nothing to overwrite, so there is
   * nothing for the guard to protect.
   */
  if (now.isbn13 == null) {
    already.push({ ...row, now });
    continue;
  }
  if (now.isbn13 !== row.from) {
    throw new Error(
      `edition #${row.id} (${row.title}) reads isbn13 ${JSON.stringify(now.isbn13)}, expected ` +
        `${JSON.stringify(row.from)}. Something else moved it — read why before running this.`,
    );
  }
  if (now.source !== row.sourceFrom) {
    throw new Error(
      `edition #${row.id} (${row.title}) reads source ${JSON.stringify(now.source)}, expected ` +
        `${JSON.stringify(row.sourceFrom)}. The provenance moved since this batch was measured.`,
    );
  }
  claimed.push({ ...row, now });
}

if (already.length > 0) {
  const tiers = [...new Set(already.map((a) => a.tier))].join(' + ');
  console.log(
    `\n  ✅ ${already.length} row(s) ALREADY APPLIED (tier ${tiers}) — isbn13 is NULL, nothing to do:`,
  );
  for (const a of already) {
    console.log(
      `     ed#${a.id} [${a.tier}] ${a.title} — isbn13 NULL, source=${JSON.stringify(a.now.source)}`,
    );
  }
}

if (claimed.length === 0) {
  console.log('\nNothing to do. That is a result, not a failure — every row is already repaired.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2. Plan.
// ---------------------------------------------------------------------------
const stmts = [];
let sourceRestores = 0;
const byTier = { A: 0, B: 0, C: 0 };
for (const row of claimed) {
  byTier[row.tier]++;
  // Tier C's warrant is the owner's sentence, not a lookup, so its change_log
  // note is a different text and says so verbatim.
  const why = row.tier === 'C' ? WHY_CROWDFUNDED : WHY;
  console.log(`\n  edition #${row.id} [tier ${row.tier}] (work #${row.work} ${row.title})`);
  console.log(`      isbn13 ${JSON.stringify(row.from)} -> NULL`);
  if (row.evidence) console.log(`      evidence: ${row.evidence}`);
  else console.log(`      evidence: the row's own edition_name says "no per-volume ISBN recorded" (tier B)`);

  stmts.push(
    `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
      VALUES (${lit(BATCH)}, 'edition', ${row.id}, 'isbn13', ${lit(JSON.stringify(row.from))}, 'null', ${CHANGED_BY}, 'auto', ${lit(why)});`,
  );

  const restoresSource = row.sourceTo != null && row.now.source !== row.sourceTo;
  if (restoresSource) {
    console.log(`      source ${JSON.stringify(row.now.source)} -> ${JSON.stringify(row.sourceTo)}`);
    sourceRestores++;
    stmts.push(
      `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
        VALUES (${lit(BATCH)}, 'edition', ${row.id}, 'source', ${lit(JSON.stringify(row.now.source))}, ${lit(JSON.stringify(row.sourceTo))}, ${CHANGED_BY}, 'auto', ${lit(why)});`,
      `UPDATE edition SET isbn13 = NULL, source = ${lit(row.sourceTo)}, updated_at = datetime('now') WHERE id = ${row.id};`,
    );
  } else {
    if (row.sourceTo == null) {
      console.log(
        `      source stays ${JSON.stringify(row.now.source)} — the pre-backfill value is not ` +
          'evidenced for this row, and inventing one would repair a provenance bug with a provenance lie.',
      );
    }
    stmts.push(`UPDATE edition SET isbn13 = NULL, updated_at = datetime('now') WHERE id = ${row.id};`);
  }
}

console.log(
  `\n${where}: ${claimed.length} isbn13(s) to null ` +
    `(tier A ${byTier.A}, B ${byTier.B}, C ${byTier.C}), ` +
    `${sourceRestores} source(s) to restore to 'manual', ` +
    `${claimed.length + sourceRestores} change_log row(s).`,
);
if (!wantB) {
  console.log(
    `(tier B is ${TIER_B.length} more rows whose own edition_name says "no per-volume ISBN recorded" — ` +
      'pass --also-declared-no-isbn, or --all-tiers.)',
  );
}
if (!wantC) {
  console.log(
    `(tier C is ${TIER_C.length} more rows on crowdfunded/collector's printings the owner holds — ` +
      'pass --also-crowdfunded, or --all-tiers. Owner ruling 2026-09-05: "For the kickstarters we ' +
      'have in stock the ISBNs are recorded if they exist.")',
  );
}

if (!flags.commit) {
  console.log(`[dry run] ${stmts.length} statement(s) would run. Pass --commit to write.`);
  process.exit(0);
}

execute(stmts, target);

// ---------------------------------------------------------------------------
// 3. Confirm by re-reading. `execute` returns statements run, never rows
//    changed — the local D1 omits `meta.changes` entirely, so a counter here
//    would lie in exactly the direction that hides a no-op.
// ---------------------------------------------------------------------------
const after = q(
  `SELECT id, isbn13, source FROM edition WHERE id IN (${claimed.map((r) => r.id).join(',')}) ORDER BY id`,
);
const stillWrong = after.filter((r) => r.isbn13 != null);
if (stillWrong.length) {
  throw new Error(
    `${stillWrong.length} isbn13(s) did not clear: ` +
      stillWrong.map((r) => `#${r.id} = ${JSON.stringify(r.isbn13)}`).join('; '),
  );
}
const badSource = claimed.filter(
  (row) => row.sourceTo != null && after.find((a) => a.id === row.id)?.source !== row.sourceTo,
);
if (badSource.length) {
  throw new Error(`${badSource.length} source(s) did not restore: ${badSource.map((r) => `#${r.id}`).join(', ')}`);
}

const logged = q(`SELECT COUNT(*) AS n FROM change_log WHERE batch_id = ${lit(BATCH)}`);
console.log(
  `\nAfter: ${after.length} edition(s) now isbn13 NULL; change_log holds ${logged[0]?.n} row(s) for ${BATCH}.`,
);
