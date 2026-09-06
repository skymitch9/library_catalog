/**
 * Import a retailer order — a shop purchase, not a pledge.
 *
 * ## Why this is not the crowdfunding importer
 *
 * `docs/info/crowdfunding-and-accessories.md` draws the line: **did the money
 * buy a promise or a product?** Barnes & Noble sells products. A shop order
 * already has a home in the schema — `copy.vendor`, `copy.acquired_on`,
 * `copy.price_paid_cents` — and forcing it through `crowdfunding_pledge` would
 * make "which campaign was this" a question with no answer.
 *
 * That rule was right and it had a cost nobody noticed: the B&N scan was staged
 * on 2026-08-10 and then simply never imported, because the only importer that
 * existed refused it. **Zero of its seven books were in production** until this
 * script. Two features built the same day — the preorder tag and the
 * mark-as-arrived panel — had nothing to render as a direct result.
 *
 * ## ⚠️ What it does and does not decide
 *
 * Formats come from `suggestFormat`, the same proposer the pledge importer uses,
 * so a retailer's marketing word is never silently promoted to a binding.
 * ⚠️ B&N sells formats the schema has no value for — **"Special"** (Project Hail
 * Mary Deluxe) and **"BN Exclusive"** (Sunrise on the Reaping). Those are tiers,
 * not bindings. `formatOf` maps them to `hardcover` **only because the input
 * file records an explicit `format` the scan author asserted**, and the retailer
 * word is preserved in `edition_name` so the assumption stays visible and
 * correctable in the Editions panel.
 *
 * A cancelled line is recorded as skipped, never as owned.
 *
 * ## 🔴 The SHOP is not the PUBLISHER — settled by the owner 2026-09-05
 *
 * Until 2026-09-05 this file wrote `scan.vendor` — the SHOP — into
 * `edition.publisher`, and read its own rows back by `publisher = <vendor>`.
 * All seven rows the Barnes & Noble order created carried *"Barnes & Noble"* as
 * their publisher; B&N published none of those seven books.
 * `scripts/fix-retailer-publishers-2026-09-02.mjs` repaired the data; the
 * importer stayed broken and would have re-created the defect on its next run.
 *
 * **The owner's decision (2026-09-05) is both halves of the option pair
 * `TODO.md` posed:**
 *
 *   * `edition.publisher` is **NULL** unless the source row carries a real
 *     publisher (`item.publisher`). A shop order genuinely does not know who
 *     published the book, and the ISBN ladder is what fills it later.
 *   * the shop goes to **`copy.vendor`**, which is where a shop belongs and
 *     where this file's own header already said it goes. That write was
 *     already correct and is unchanged.
 *
 * ⚠️ **Do not "fix" this by looking the publisher up here.** That would make an
 * import a research run, which is the split `docs/info/isbn-ladder.md` keeps.
 *
 * ⚠️ **A shop CAN be a publisher** — *Barnes & Noble Books* and *Barnes & Noble
 * Classics* are real imprints and two rows in this catalog are theirs. That is
 * why the rule is "use what the source row says", not "reject anything that
 * looks like a shop name": the source deciding is the whole point.
 *
 *   node scripts/import-shop-orders.mjs --file <scan.json> --remote
 *   node scripts/import-shop-orders.mjs --file <scan.json> --remote --commit
 *   node scripts/import-shop-orders.mjs --file <scan.json> --remote --friend --commit
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { classifyEdition, suggestFormat } from '../packages/core/src/crowdfunding.ts';
import { primaryAuthor, workKeyFor } from '../packages/core/src/titles.ts';
import { execute, parseFlags, query, ROOT } from './lib/d1.mjs';

const sql = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

/**
 * The publisher of the printing, or NULL — **never the shop**.
 *
 * The only source is the scan row's own `publisher`. `scan.vendor` is the shop
 * and is deliberately not consulted: see the header. Blank and whitespace-only
 * both mean "the order does not say", which is the ordinary case and is NULL,
 * not an empty string — `publisher = ''` would be invisible to every
 * `publisher IS NULL` gap query the ladder runs on.
 */
export function publisherFor(item) {
  const raw = item?.publisher;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Which edition row belongs to which planned item, after the INSERT.
 *
 * ⚠️ This used to be `WHERE source = 'manual' AND publisher = <vendor>`, which
 * only worked *because* of the bug above: the shop name in `publisher` was
 * doubling as the batch marker. With `publisher` correctly NULL that predicate
 * would match **every** manual edition with no publisher in the catalog — 97 of
 * them on main, measured 2026-09-05 — and hand copies the wrong `edition_id`.
 *
 * So the match is on what actually identifies the printing: the work, the
 * format, and the retailer's `edition_name`. Where several rows tie, the
 * **highest id wins**, because the row this run just inserted is the newest.
 *
 * `rows` are `{ id, work_id, format, edition_name }` for the candidate works.
 * Returns a `Map<workId, editionId>`, the same shape the caller had before.
 */
export function matchEditionIds(plan, rows) {
  const out = new Map();
  for (const p of plan) {
    if (!p.workId || !p.fmt) continue;
    const wanted = p.editionName ?? null;
    const hit = rows
      .filter(
        (r) =>
          r.work_id === p.workId &&
          (r.format ?? null) === p.fmt &&
          (r.edition_name ?? null) === wanted,
      )
      .sort((a, b) => b.id - a.id)[0];
    if (hit) out.set(p.workId, hit.id);
  }
  return out;
}

/** The scan's explicit `format` wins; the retailer's word is only a fallback. */
export function formatOf(item) {
  return item.format ?? suggestFormat(item.bnFormat) ?? null;
}

/**
 * Which canonical bucket the printing falls in. Migration 0050.
 *
 * ⚠️ **This is the half of the “Special” / “BN Exclusive” problem the note at
 * the top of this file could not fix.** `formatOf` maps those words to
 * `hardcover` and `edition_name` keeps the retailer's exact wording — both
 * right, and between them still leaving *“show me the fancy ones”* as a
 * substring search. `classifyEdition` reads the same prose and answers the
 * question the column exists for.
 *
 * Reads the recorded `editionName` first and falls back to the retailer's own
 * format word, because that is where B&N actually puts it: the scan records
 * `bnFormat: "BN Exclusive"` for a row whose `editionName` may be unset.
 * Null — an ordinary printing — is the common and correct answer.
 */
export function kindOf(item) {
  const fmt = formatOf(item);
  return classifyEdition(item.editionName, fmt) ?? classifyEdition(item.bnFormat, fmt);
}

/**
 * One planned row, with everything decided and nothing written.
 *
 * Split out so the two decisions worth pinning — the format ladder and
 * publisher-is-not-the-shop — can be exercised with no database at all;
 * `scripts/test/shop-orders.test.mjs` does exactly that.
 */
export function planItem(item, heldByKey = new Map()) {
  const authors = item.authors;
  const key = workKeyFor(item.title, authors);
  return {
    ...item,
    key,
    authors,
    primary: primaryAuthor(authors),
    workId: heldByKey.get(key) ?? null,
    fmt: formatOf(item),
    kind: kindOf(item),
    // 🔴 The shop NEVER lands here. See the header.
    publisher: publisherFor(item),
  };
}

function main() {
  const { commit, remote, friend } = parseFlags();
  const target = { remote, friend };
  const fileArg = process.argv.indexOf('--file');
  const file = fileArg >= 0 && process.argv[fileArg + 1]
    ? path.resolve(process.argv[fileArg + 1])
    : path.join(ROOT, 'scripts', 'shop-orders.json');

  const scan = JSON.parse(readFileSync(file, 'utf8'));
  const items = (scan.items ?? []).filter((i) => !i.skipImport);
  const skipped = (scan.items ?? []).filter((i) => i.skipImport);

  const held = new Map(
    query('SELECT work_key, id FROM work', target).map((r) => [r.work_key, r.id]),
  );

  const plan = items.map((i) => planItem(i, held));

  const where = friend ? 'padhard' : remote ? 'production' : 'local';
  console.log(`\n${where}: ${scan.source} — ${plan.length} item(s)`);
  console.log(`  shop: ${scan.vendor ?? '—'}  →  copy.vendor (NEVER edition.publisher)`);
  for (const p of plan) {
    const at = p.workId ? `work ${p.workId}` : 'NEW work';
    const fmt = p.fmt ?? '⚠️ no format';
    console.log(`  ${p.copyStatus.padEnd(10)} ${fmt.padEnd(10)} ${at.padEnd(9)} ${p.title.slice(0, 46)}`);
    if (p.editionName) console.log(`             edition_name: ${p.editionName}   (retailer said "${p.bnFormat}")`);
    if (p.kind) console.log(`             edition_kind: ${p.kind}`);
    console.log(
      p.publisher
        ? `             publisher:    ${p.publisher}   (from the order line, not the shop)`
        : '             publisher:    NULL — the order does not say; the ISBN ladder fills it',
    );
  }
  for (const s of skipped) console.log(`  SKIPPED    ${s.title.slice(0, 46)} — ${s.status}`);

  const noFormat = plan.filter((p) => !p.fmt);
  if (noFormat.length) console.log(`\n⚠️ ${noFormat.length} item(s) have no format and will get an edition-less copy.`);

  if (!commit) {
    console.log('\nDry run. Re-run with --commit to write.');
    process.exit(0);
  }

  // Works we do not already hold.
  const fresh = plan.filter((p) => !p.workId);
  if (fresh.length) {
    execute(
      fresh.map(
        (p) =>
          `INSERT INTO work (title, authors, primary_author, work_key, series)
           VALUES (${sql(p.title)}, ${sql(p.authors)}, ${sql(p.primary)}, ${sql(p.key)}, ${sql(p.series ?? null)});`,
      ),
      target,
    );
    const now = new Map(
      query(
        `SELECT id, work_key FROM work WHERE work_key IN (${fresh.map((p) => sql(p.key)).join(',')})`,
        target,
      ).map((r) => [r.work_key, r.id]),
    );
    for (const p of plan) if (!p.workId) p.workId = now.get(p.key) ?? null;
  }

  // An edition only where a format is actually known — same rule as the pledge path.
  const withFmt = plan.filter((p) => p.workId && p.fmt);
  if (withFmt.length) {
    execute(
      withFmt.map(
        (p) =>
          `INSERT INTO edition (work_id, format, edition_name, edition_kind, publisher, source)
           VALUES (${p.workId}, ${sql(p.fmt)}, ${sql(p.editionName ?? null)}, ${sql(p.kind)}, ${sql(p.publisher)}, 'manual');`,
      ),
      target,
    );
  }

  /*
   * ⚠️ Read the rows back by WORK + FORMAT + edition_name, never by publisher —
   * see `matchEditionIds`. The old `publisher = <vendor>` predicate only ever
   * worked because the shop name was wrongly sitting in that column.
   */
  const workIds = [...new Set(withFmt.map((p) => p.workId))];
  const eds = workIds.length
    ? matchEditionIds(
        plan,
        query(
          `SELECT id, work_id, format, edition_name FROM edition
            WHERE source = 'manual' AND work_id IN (${workIds.join(',')})`,
          target,
        ),
      )
    : new Map();

  /*
   * ⚠️ `preordered` is not `owned`. It is what the wishlist counts as "on the way"
   * and what the arrivals panel turns into a shelf copy — recording a preorder as
   * owned would claim a book that has not arrived.
   */
  execute(
    plan
      .filter((p) => p.workId)
      .map(
        (p) =>
          `INSERT INTO copy (work_id, edition_id, status, vendor, acquired_on, price_paid_cents, currency, notes)
           VALUES (${p.workId}, ${eds.get(p.workId) ?? 'NULL'}, ${sql(p.copyStatus)}, ${sql(scan.vendor ?? null)},
                   ${p.copyStatus === 'owned' ? sql(p.datePlaced ?? null) : 'NULL'},
                   ${p.priceUsd != null ? Math.round(p.priceUsd * 100) : 'NULL'}, 'USD',
                   ${sql(p.estimatedArrival ? `Estimated arrival ${p.estimatedArrival}.` : null)});`,
      ),
    target,
  );

  /* ⚠️ Confirm by re-reading — `execute` returns statements run, not rows changed. */
  const after = query(
    `SELECT c.status AS status, COUNT(*) AS n FROM copy c WHERE c.vendor = ${sql(scan.vendor ?? null)} GROUP BY c.status`,
    target,
  );
  console.log(`\nwrote ${plan.length} item(s). Copies now recorded for ${scan.vendor}:`);
  for (const r of after) console.log(`  ${String(r.n).padStart(3)}  ${r.status}`);
}

// Importable for its pure halves; runs only when invoked directly.
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('import-shop-orders.mjs')
) {
  main();
}
