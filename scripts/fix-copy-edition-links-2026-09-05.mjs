/**
 * Data repair: owned copies that are not linked to the printing they are a copy
 * of — `copy.edition_id IS NULL` where the evidence says which edition it is.
 *
 * Reported 2026-09-05 as *"the seven shop-order copies are not linked to their
 * editions"*. It is twelve, not seven: **the Illumicrate importer produced the
 * same result** (copies 104–108), and those five are the ones a person can
 * actually SEE, for the reason in §"What this looks like on the page" below.
 *
 * ## What was measured — 2026-09-05, both instances, production
 *
 * | | copies | `edition_id IS NULL` | work has 1 edition | 2 | 3 | 0 |
 * |---|---|---|---|---|---|---|
 * | main (`library-catalog`) | 450 | **419** | 364 | 40 | 15 | 0 |
 * | padhard (`library-catalog-2nd`) | 677 | **503** | 485 | 3 | 0 | 15 |
 *
 * ⚠️ **419 of 450 is not an incident, it is the normal state of this catalog** —
 * `apps/web/src/lib/shelf-view.ts` says so in its own header: *"`copy.edition_id`
 * is null across essentially the whole catalog"*, and the whole shelf derivation
 * is built to cope. So this script does NOT treat "unlinked" as damage to be
 * swept away. It repairs the rows where an importer *meant* to write a link and
 * did not, and it hands everything else to the owner as a question.
 *
 * ## What this looks like on the page today (so the visible effect is known)
 *
 * `effectiveFormat()` in `apps/web/src/lib/shelf-view.ts` resolves an unlinked
 * copy in this order: the linked edition's format → leatherbound implies
 * hardcover → **the work's sole physical-edition format** → otherwise
 * `UNSPEC_PHYSICAL`. So:
 *
 *   * a work with ONE printing renders an unlinked copy correctly already
 *     (`attribution: 'resolved-sole'`). **Linking it changes nothing a person
 *     sees.** That covers all seven Barnes & Noble copies — works 229–235 hold
 *     exactly one edition each.
 *   * a work with SEVERAL printings cannot attribute the copy at all, so the
 *     card falls back to the bare format word with the softened wording the
 *     derivation uses to avoid claiming a printing the owner may not own. **That
 *     is the five Illumicrate copies**: works 224–228 hold two or three
 *     printings each, so <https://library.heygabi.ai/work/224> shows an
 *     unattributed hardcover beside the *Illumicrate Exclusive* card instead of
 *     one card that says both.
 *
 * ## 🔴 The root cause is NOT established, and this script does not pretend it is
 *
 * What is RULED OUT, each measured 2026-09-05:
 *
 *   * **Not the ordering.** Editions 322–328 were created `14:19:32`, copies
 *     109–115 `14:19:39` — seven seconds later. Illumicrate: editions `05:33:31`,
 *     copies `05:33:40` — nine seconds. The rows the lookup wanted existed.
 *   * **Not the predicate's value.** `change_log` batch
 *     `fix-retailer-publishers-2026-09-02` proves editions 322–328 read
 *     `publisher = 'Barnes & Noble'` from the import until 2026-09-02, so the old
 *     `WHERE source='manual' AND publisher=<vendor>` lookup matched on value.
 *   * **Not the `--file` summary bug.** `query()` had already been switched to
 *     `--command` (`052a726`, 2026-08-10 07:28 Phoenix); both imports ran after it.
 *   * **Not the read path today.** Re-run against production now, the same
 *     predicate shapes return the right rows, correctly typed, ampersand and all.
 *   * **Not a double run.** Works 229–235 hold exactly 7 editions; works 224–228
 *     hold exactly one *Illumicrate Exclusive* each.
 *
 * The strongest surviving candidate — a read-after-write visibility gap between
 * `execute()` and the `query()` immediately following it on `--remote` — would
 * explain both importers, two different predicates, in the same week, and
 * nothing else measured does. **It is UNPROVEN**, and proving it needs a write
 * (insert into a scratch table, read back immediately, repeat), which is the
 * owner's call and not a dry run's. Until then: `matchEditionIds` hardens the
 * rule both importers use, and both now say out loud when a copy goes in
 * unlinked — which is the part that was silent for a month.
 *
 * ## The three tiers, and why the default is the smallest one
 *
 *   **A. EVIDENCED (default).** The twelve importer rows. Not an inference —
 *      a repair of a link the importer's own code was trying to write:
 *
 *      * **the five Illumicrate copies** — `vendor = 'Illumicrate'`, matched
 *        through the shared `matchEditionIds` on work + `hardcover` +
 *        `'Illumicrate Exclusive'`, which is exactly the plan the importer
 *        builds. This is the genuine, non-circular use of that function.
 *      * **the seven Barnes & Noble copies** — `vendor = 'Barnes & Noble'`,
 *        where the work holds **exactly one** edition AND that edition was
 *        created within `SAME_RUN_SECONDS` of the copy. The copy table records
 *        no format and no edition name, so `matchEditionIds` cannot be fed a
 *        real plan from the copy alone; the SELECTION here is sole-edition +
 *        same-run provenance, and `matchEditionIds` is then handed that
 *        edition's own format and name to turn the decision into an id. Said
 *        out loud because that second call proves less than the first one does.
 *
 *   **B. `--all-unambiguous` (owner-gated, NOT default).** Every other unlinked
 *      copy whose work holds exactly one edition — 357 more on main, 485 on
 *      padhard. ⚠️ **This is an inference, and a wrong one fabricates a claim
 *      about which printing the owner owns.** `copy` has no `format` column, so
 *      a paperback the catalog has no row for would be linked to the work's only
 *      hardcover and start rendering as that printing. The shelf already
 *      resolves these correctly WITHOUT the link (`resolved-sole` above), so the
 *      flag buys data tidiness and risks a false claim — which is why it is a
 *      flag and the owner decides.
 *
 *   **C. AMBIGUOUS — listed, never linked.** Unlinked copies on works with more
 *      than one edition, printed with every candidate so the owner can answer in
 *      *Editions & copies* → *"Which printing do I own?"*. The tempting
 *      work-level fallback is the wrong fix, for the reason
 *      `fix-shop-publisher-2026-09-05.mjs` refused it: a work can hold several
 *      printings.
 *
 *   Copies on a work with NO edition at all are touched by nothing — 15 on
 *   padhard. A copy is never linked to an edition that does not exist, and an
 *   edition is never invented for it.
 *
 * Every link writes one `change_log` row, batch
 * `fix-2026-09-05-copy-edition-links`, `changed_how = 'auto'`. Idempotent: a
 * linked copy no longer matches `edition_id IS NULL`.
 *
 * ⚠️ **`tsx`, not `node`** — reusing `matchEditionIds` pulls in
 * `import-shop-orders.mjs`, which reaches `packages/core/src/crowdfunding.ts`,
 * whose own `./constants.js` import plain Node cannot resolve. That is the same
 * reason `import:ebooks` and `import:crowdfunding` are `tsx` scripts. Copying
 * the function to dodge it would be the actual mistake: one canonical rule for
 * which edition a copy belongs to, or the two drift.
 *
 *   npx tsx scripts/fix-copy-edition-links-2026-09-05.mjs --remote                       # dry run
 *   npx tsx scripts/fix-copy-edition-links-2026-09-05.mjs --remote --commit
 *   npx tsx scripts/fix-copy-edition-links-2026-09-05.mjs --remote --friend
 *   npx tsx scripts/fix-copy-edition-links-2026-09-05.mjs --remote --friend --commit
 *   npx tsx scripts/fix-copy-edition-links-2026-09-05.mjs --remote --all-unambiguous     # tier B too
 */

import { matchEditionIds } from './import-shop-orders.mjs';
import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const BATCH = 'fix-2026-09-05-copy-edition-links';

/**
 * How close in time an edition and a copy must be to count as one import run.
 *
 * Measured: seven seconds (shop) and nine (Illumicrate). Two minutes is loose
 * enough to survive a slow wrangler round trip and far tighter than anything a
 * person does by hand, and it is only ever a NARROWING filter — a row that
 * fails it is reported, never linked.
 */
const SAME_RUN_SECONDS = 120;

/**
 * The importer batches this script repairs, by the vendor each one stamps.
 *
 * `editionName`/`fmt` present = the importer's own constants are known, so the
 * plan handed to `matchEditionIds` is the real one. Absent = the scan's per-row
 * values are not recoverable from the database, and selection falls back to
 * sole-edition + same-run provenance.
 */
const IMPORTS = [
  {
    vendor: 'Illumicrate',
    fmt: 'hardcover',
    editionName: 'Illumicrate Exclusive',
    script: 'scripts/import-illumicrate-percy-jackson.mjs',
  },
  {
    vendor: 'Barnes & Noble',
    fmt: null,
    editionName: null,
    script: 'scripts/import-shop-orders.mjs',
  },
];

const WHY =
  'An importer inserted an edition and then wrote its copy with edition_id NULL. The copy and the ' +
  'printing were created seconds apart in one run and belong together; the link is the one the ' +
  'importer was trying to write and did not. Root cause NOT established — see the header of ' +
  'scripts/fix-copy-edition-links-2026-09-05.mjs for what is ruled out. The mechanism is hardened ' +
  'in both importers by the shared matchEditionIds (commit 8de3b9a).';

const flags = parseFlags();
const all = process.argv.includes('--all-unambiguous');
const target = { remote: flags.remote, friend: flags.friend };
const q = (sql) => query(sql, target);
const where = flags.friend ? 'padhard' : flags.remote ? 'production' : 'local';

/** See `fix-shop-publisher-2026-09-05.mjs`: user 1 is a different person per instance. */
const CHANGED_BY = flags.friend ? 'NULL' : '1';

const secondsApart = (a, b) => Math.abs((Date.parse(a + 'Z') - Date.parse(b + 'Z')) / 1000);

// ---------------------------------------------------------------------------
// 1. Measure the whole table first. The report must be able to say what it did
//    NOT claim, and why, not only what it claimed.
// ---------------------------------------------------------------------------
const totals = q(
  `SELECT COUNT(*) AS copies, SUM(CASE WHEN edition_id IS NULL THEN 1 ELSE 0 END) AS unlinked FROM copy`,
)[0];
const buckets = q(
  `SELECT n, COUNT(*) AS copies FROM (
      SELECT c.id, (SELECT COUNT(*) FROM edition e WHERE e.work_id = c.work_id) AS n
        FROM copy c WHERE c.edition_id IS NULL
   ) GROUP BY n ORDER BY n`,
);
console.log(`\n${where}: ${totals.copies} copies, ${totals.unlinked} with edition_id NULL`);
for (const b of buckets) {
  const kind = b.n === 0 ? 'NO edition exists — untouchable' : b.n === 1 ? 'unambiguous' : 'AMBIGUOUS';
  console.log(`  ${String(b.copies).padStart(4)} on works holding ${b.n} edition(s)   (${kind})`);
}

/*
 * Every unlinked copy with its work's editions beside it. One read rather than
 * one per copy: `query()` caps the SQL length, not the row count.
 */
const rows = q(
  `SELECT c.id AS copy_id, c.work_id, c.vendor, c.status, c.created_at AS copy_created,
          w.title,
          e.id AS edition_id, e.format, e.edition_name, e.publisher, e.created_at AS ed_created
     FROM copy c
     JOIN work w ON w.id = c.work_id
     LEFT JOIN edition e ON e.work_id = c.work_id
    WHERE c.edition_id IS NULL
    ORDER BY c.id, e.id`,
);

/** One entry per unlinked copy, carrying every candidate printing on its work. */
const byCopy = new Map();
for (const r of rows) {
  let c = byCopy.get(r.copy_id);
  if (!c) {
    c = {
      id: r.copy_id, workId: r.work_id, title: r.title, vendor: r.vendor,
      status: r.status, created: r.copy_created, candidates: [],
    };
    byCopy.set(r.copy_id, c);
  }
  if (r.edition_id != null) {
    c.candidates.push({
      id: r.edition_id, work_id: r.work_id, format: r.format,
      edition_name: r.edition_name, publisher: r.publisher, created: r.ed_created,
    });
  }
}
const copies = [...byCopy.values()];

// ---------------------------------------------------------------------------
// 2. Tier A — the evidenced importer batches.
// ---------------------------------------------------------------------------
const links = [];   // { copy, edition, tier, why }
const claimedCopyIds = new Set();
const notes = [];

for (const imp of IMPORTS) {
  const mine = copies.filter((c) => c.vendor === imp.vendor);
  if (mine.length === 0) {
    notes.push(`${imp.vendor}: no unlinked copies on ${where} — nothing from ${imp.script} to repair.`);
    continue;
  }

  for (const c of mine) {
    /*
     * The plan handed to matchEditionIds. When the importer's constants are
     * known (Illumicrate) they ARE the plan. When they are not (a shop scan,
     * whose per-row format and name are in a file, not the database), the
     * decision is made HERE — sole edition, created in the same run — and
     * matchEditionIds only turns it into an id.
     */
    let fmt = imp.fmt;
    let editionName = imp.editionName;
    let basis = `${imp.vendor} import: work + ${fmt} + ${JSON.stringify(editionName)}`;

    if (fmt === null) {
      if (c.candidates.length !== 1) {
        notes.push(
          `copy #${c.id} (${imp.vendor}, work #${c.workId} ${c.title}) — ${c.candidates.length} editions on the ` +
            'work and no recoverable format/name from the scan, so NOT claimed. Listed as ambiguous below.',
        );
        continue;
      }
      const only = c.candidates[0];
      const gap = secondsApart(only.created, c.created);
      if (gap > SAME_RUN_SECONDS) {
        notes.push(
          `copy #${c.id} (${imp.vendor}, work #${c.workId} ${c.title}) — its work's sole edition #${only.id} was ` +
            `created ${Math.round(gap)}s away, outside the ${SAME_RUN_SECONDS}s same-run window. NOT claimed.`,
        );
        continue;
      }
      fmt = only.format;
      editionName = only.edition_name ?? null;
      basis = `${imp.vendor} import: sole edition on the work, created ${Math.round(gap)}s from the copy`;
    }

    const hit = matchEditionIds([{ workId: c.workId, fmt, editionName }], c.candidates).get(c.workId);
    if (!hit) {
      notes.push(
        `copy #${c.id} (${imp.vendor}, work #${c.workId} ${c.title}) — matchEditionIds found no printing for ` +
          `${fmt} / ${JSON.stringify(editionName)}. NOT claimed, and never guessed.`,
      );
      continue;
    }
    links.push({ copy: c, edition: hit, tier: 'A', why: basis });
    claimedCopyIds.add(c.id);
  }
}

// ---------------------------------------------------------------------------
// 3. Tier B — every other sole-edition copy. Owner-gated.
// ---------------------------------------------------------------------------
const soleRest = copies.filter((c) => !claimedCopyIds.has(c.id) && c.candidates.length === 1);
if (all) {
  for (const c of soleRest) {
    links.push({
      copy: c, edition: c.candidates[0].id, tier: 'B',
      why: 'the work holds exactly one edition (INFERRED — copy has no format of its own)',
    });
    claimedCopyIds.add(c.id);
  }
}

// ---------------------------------------------------------------------------
// 4. Tier C — ambiguous, and the untouchable.
// ---------------------------------------------------------------------------
const ambiguous = copies.filter((c) => !claimedCopyIds.has(c.id) && c.candidates.length > 1);
const noEdition = copies.filter((c) => c.candidates.length === 0);

// ---------------------------------------------------------------------------
// 5. Report, then plan.
// ---------------------------------------------------------------------------
console.log(`\n${where}: TIER A — evidenced importer links (${links.filter((l) => l.tier === 'A').length})`);
for (const l of links.filter((x) => x.tier === 'A')) {
  console.log(
    `  copy #${l.copy.id} (${l.copy.status}, work #${l.copy.workId} ${l.copy.title}) -> edition #${l.edition}`,
  );
  console.log(`      ${l.why}`);
}
if (links.every((l) => l.tier !== 'A')) console.log('  none.');

console.log(
  `\n${where}: TIER B — other sole-edition copies (${all ? links.filter((l) => l.tier === 'B').length + ' CLAIMED' : soleRest.length + ' NOT claimed'})`,
);
if (!all && soleRest.length) {
  console.log(
    `  ⚠️ ${soleRest.length} unlinked copy/copies sit on a work with exactly one edition. The shelf already\n` +
      "     renders these correctly without a link (shelf-view's 'resolved-sole'), and linking asserts WHICH\n" +
      '     printing the owner holds, which the copy row does not record. Pass --all-unambiguous to claim them.',
  );
}

console.log(`\n${where}: TIER C — AMBIGUOUS, for the owner (${ambiguous.length})`);
for (const c of ambiguous) {
  console.log(`  copy #${c.id} (${c.status}${c.vendor ? ', ' + c.vendor : ''}) work #${c.workId} ${c.title}`);
  for (const e of c.candidates) {
    console.log(
      `      candidate edition #${e.id}  ${e.format ?? '—'}  ${JSON.stringify(e.edition_name)}  ` +
        `publisher=${JSON.stringify(e.publisher)}`,
    );
  }
  console.log(`      → answer it on https://library.heygabi.ai/work/${c.workId} → ✎ Edit → Editions & copies`);
}
if (ambiguous.length === 0) console.log('  none.');

console.log(`\n${where}: NO EDITION EXISTS — untouched (${noEdition.length})`);
for (const c of noEdition) console.log(`  copy #${c.id} work #${c.workId} ${c.title}`);
if (noEdition.length === 0) console.log('  none.');

if (notes.length) {
  console.log(`\n${where}: not claimed, and why (${notes.length})`);
  for (const n of notes) console.log(`  ${n}`);
}

const stmts = [];
for (const l of links) {
  stmts.push(
    `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
      VALUES (${lit(BATCH)}, 'copy', ${l.copy.id}, 'edition_id', 'null', ${lit(String(l.edition))}, ${CHANGED_BY}, 'auto', ${lit(WHY + ' Basis: ' + l.why + '.')});`,
    `UPDATE copy SET edition_id = ${l.edition}, updated_at = datetime('now') WHERE id = ${l.copy.id};`,
  );
}

console.log(
  `\n${where}: ${links.length} copy/copies to link, ${links.length} change_log row(s), ` +
    `${ambiguous.length} for the owner, ${noEdition.length} untouchable.`,
);

if (!flags.commit) {
  console.log(`[dry run] ${stmts.length} statement(s) would run. Pass --commit to write.`);
  process.exit(0);
}
if (stmts.length === 0) {
  console.log('Nothing to write. That is a result, not a failure.');
  process.exit(0);
}

/*
 * ⚠️ Chunked. --all-unambiguous on padhard is 485 links = 970 statements in one
 * uploaded file; the largest batch this repo has run before is 122
 * (`sweep-signed-editions`). Chunking keeps a failure small and re-runnable
 * rather than turning one D1 limit into a whole run lost.
 */
const CHUNK = 100;
for (let i = 0; i < stmts.length; i += CHUNK) {
  execute(stmts.slice(i, i + CHUNK), target);
  console.log(`  wrote ${Math.min(i + CHUNK, stmts.length)} / ${stmts.length} statement(s)`);
}

// ---------------------------------------------------------------------------
// 6. Confirm by re-reading — `execute` returns statements run, not rows changed.
// ---------------------------------------------------------------------------
const ids = links.map((l) => l.copy.id);
const after = q(`SELECT id, edition_id FROM copy WHERE id IN (${ids.join(',')}) ORDER BY id`);
const stillNull = after.filter((r) => r.edition_id == null);
if (stillNull.length) {
  throw new Error(`${stillNull.length} copy/copies did not link: ${stillNull.map((r) => '#' + r.id).join(', ')}`);
}
const wrong = after.filter((r) => r.edition_id !== links.find((l) => l.copy.id === r.id)?.edition);
if (wrong.length) {
  throw new Error(`${wrong.length} copy/copies linked to an unexpected edition — investigate before doing anything else.`);
}
const logged = q(`SELECT COUNT(*) AS n FROM change_log WHERE batch_id = ${lit(BATCH)}`);
console.log(`\nAfter: ${after.length} copy/copies linked; change_log holds ${logged[0]?.n} row(s) for ${BATCH}.`);
