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
 *   node scripts/import-shop-orders.mjs --file <scan.json> --remote
 *   node scripts/import-shop-orders.mjs --file <scan.json> --remote --commit
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { suggestFormat } from '../packages/core/src/crowdfunding.ts';
import { primaryAuthor, workKeyFor } from '../packages/core/src/titles.ts';
import { execute, parseFlags, query, ROOT } from './lib/d1.mjs';

const { commit, remote } = parseFlags();
const fileArg = process.argv.indexOf('--file');
const file = fileArg >= 0 && process.argv[fileArg + 1]
  ? path.resolve(process.argv[fileArg + 1])
  : path.join(ROOT, 'scripts', 'shop-orders.json');

const scan = JSON.parse(readFileSync(file, 'utf8'));
const sql = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

/** The scan's explicit `format` wins; the retailer's word is only a fallback. */
function formatOf(item) {
  return item.format ?? suggestFormat(item.bnFormat) ?? null;
}

const items = (scan.items ?? []).filter((i) => !i.skipImport);
const skipped = (scan.items ?? []).filter((i) => i.skipImport);

const held = new Map(
  query('SELECT work_key, id FROM work', { remote }).map((r) => [r.work_key, r.id]),
);

const plan = items.map((i) => {
  const authors = i.authors;
  const key = workKeyFor(i.title, authors);
  return {
    ...i,
    key,
    authors,
    primary: primaryAuthor(authors),
    workId: held.get(key) ?? null,
    fmt: formatOf(i),
  };
});

console.log(`\n${remote ? 'production' : 'local'}: ${scan.source} — ${plan.length} item(s)`);
for (const p of plan) {
  const where = p.workId ? `work ${p.workId}` : 'NEW work';
  const fmt = p.fmt ?? '⚠️ no format';
  console.log(`  ${p.copyStatus.padEnd(10)} ${fmt.padEnd(10)} ${where.padEnd(9)} ${p.title.slice(0, 46)}`);
  if (p.editionName) console.log(`             edition_name: ${p.editionName}   (retailer said "${p.bnFormat}")`);
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
    { remote },
  );
  const now = new Map(
    query(
      `SELECT id, work_key FROM work WHERE work_key IN (${fresh.map((p) => sql(p.key)).join(',')})`,
      { remote },
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
        `INSERT INTO edition (work_id, format, edition_name, publisher, source)
         VALUES (${p.workId}, ${sql(p.fmt)}, ${sql(p.editionName ?? null)}, ${sql(scan.vendor ?? null)}, 'manual');`,
    ),
    { remote },
  );
}
const eds = new Map(
  query(
    `SELECT id, work_id FROM edition WHERE source = 'manual' AND publisher = ${sql(scan.vendor ?? null)}`,
    { remote },
  ).map((r) => [r.work_id, r.id]),
);

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
  { remote },
);

/* ⚠️ Confirm by re-reading — `execute` returns statements run, not rows changed. */
const after = query(
  `SELECT c.status AS status, COUNT(*) AS n FROM copy c WHERE c.vendor = ${sql(scan.vendor ?? null)} GROUP BY c.status`,
  { remote },
);
console.log(`\nwrote ${plan.length} item(s). Copies now recorded for ${scan.vendor}:`);
for (const r of after) console.log(`  ${String(r.n).padStart(3)}  ${r.status}`);
