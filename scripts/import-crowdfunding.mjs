#!/usr/bin/env node
/**
 * Land a Kickstarter / BackerKit / Indiegogo scan in the catalog.
 *
 *   npm run import:crowdfunding                                  # dry run, LOCAL
 *   npm run import:crowdfunding -- --file scripts/ks-scan.json   # a different file
 *   npm run import:crowdfunding -- --remote                      # dry run, PRODUCTION — READ THE LIST
 *   npm run import:crowdfunding -- --remote --commit
 *
 * The file shape is documented in `docs/info/crowdfunding-and-accessories.md`
 * with a worked example, and `scripts/crowdfunding-example.json` is a runnable
 * copy of it.
 *
 * ## ⚠️ READ THE AUDIT, NOT THE TOTAL
 *
 * *"Kickstarter stuff generally has a mix of physical and digital books so make
 * sure when youre auditing you're really looking close."* — the owner,
 * 2026-08-10.
 *
 * The number that matters is not "42 books imported". It is the four the audit
 * prints beside it:
 *
 * | | |
 * |---|---|
 * | **lines vs works** | one pledge delivering a hardcover *and* an EPUB of one novel is 2 lines and 1 book. Equal numbers on a Kickstarter import usually means half the rewards were dropped. |
 * | **needs splitting** | a reward line naming BOTH — "Hardcover + Ebook Bundle". One row cannot be two things; somebody must split it. |
 * | **unclassified** | nothing could say what it was. Go and look at the campaign page. |
 * | **no printing** | matched to a book, not to an `edition`. Expected on a first run; see below. |
 *
 * `docs/HANDOFF.md` records the general version of this lesson twice already:
 * *"860/860 matched looked perfect"* and the keys it would have written were
 * unusable. **Read the lines, not the totals.**
 *
 * ## ⚠️ This script creates no `edition` rows, and that is deliberate
 *
 * A reward that says "Deluxe Hardcover" is a *claim about a printing*, and
 * minting an `edition` from it would be an importer deciding what is on the
 * shelf. `suggestFormat` in `@lc/core` prints the proposal beside each line and a
 * person creates the edition in the app — where recording an owned copy already
 * creates one (`Copies.tsx`). The same propose/accept rule the research pipeline
 * obeys, for the reason `isbn-ladder.md` §4.4 gives.
 *
 * Once the edition exists, re-run this: the line will match it and the audit's
 * "no printing" count drops. That is the intended second pass.
 *
 * ## ⚠️ It creates no `work` rows either
 *
 * A book that is not already catalogued is **reported and skipped**, never
 * created. `POST /api/works` deliberately does not dedupe, and a campaign page's
 * spelling of a title is exactly the input that would mint a second row for a
 * book already on the shelf. `api.matchWork` exists for people; this is a script.
 *
 * ## ⚠️ `work_key` is READ from the database, never recomputed here
 *
 * `workKeyFor` in `packages/core` is the ONE implementation (CLAUDE.md). This
 * script imports it rather than reimplementing the fold, and joins on the
 * `work_key` column that is already stored — the rule `seed-gap-verdicts.mjs`
 * states and follows.
 *
 * ## Idempotent, and it must stay so
 *
 * Every write is an upsert against the unique indexes migrations 0010 and 0011
 * define. A second run of the same file reports "nothing to write". In
 * particular the pledge-item index is
 * `(pledge_id, work_id, IFNULL(edition_id, 0), IFNULL(format_hint, ''))`, which
 * is what lets one pledge hold both a hardcover line and an ebook line for one
 * novel while still refusing an exact repeat.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { workKeyFor } from '../packages/core/src/titles.ts';
import {
  auditSentence,
  pledgeAudit,
  pledgeItemMedium,
  rewardFlags,
  suggestFormat,
} from '../packages/core/src/crowdfunding.ts';

import { execute, lit, parseFlags, query, ROOT } from './lib/d1.mjs';

const { commit, remote } = parseFlags();
const where = remote ? 'REMOTE' : 'local';

const argv = process.argv.slice(2);
const fileArg = argv.indexOf('--file');
const FILE =
  fileArg >= 0 && argv[fileArg + 1]
    ? path.resolve(argv[fileArg + 1])
    : path.join(ROOT, 'scripts', 'crowdfunding-scan.json');

const PLATFORMS = new Set(['kickstarter', 'backerkit', 'indiegogo']);
const STATUSES = new Set(['pledged', 'delivered', 'partial', 'cancelled', 'refunded']);

// ---------------------------------------------------------------------------
// Read and validate the file
// ---------------------------------------------------------------------------

let scan;
try {
  scan = JSON.parse(readFileSync(FILE, 'utf8'));
} catch (err) {
  console.error(`Could not read ${FILE}: ${err?.message ?? err}`);
  console.error('\nSee docs/info/crowdfunding-and-accessories.md for the shape, or copy');
  console.error('scripts/crowdfunding-example.json and edit it.');
  process.exit(1);
}

const campaigns = Array.isArray(scan?.campaigns) ? scan.campaigns : null;
if (!campaigns) {
  console.error('The file has no top-level "campaigns" array. Nothing to do.');
  process.exit(1);
}

/**
 * ⚠️ Refuse a bad file before touching the database, not halfway through it.
 *
 * `account` is the one that matters most: **there are two BackerKit accounts**,
 * and a pledge that does not say which one cannot be reconciled against a scan of
 * either. Migration 0010's unique index refuses the duplicate that would
 * otherwise appear; this refuses the row that would slip past it.
 */
const problems = [];
for (const [ci, c] of campaigns.entries()) {
  const at = `campaigns[${ci}]`;
  if (!PLATFORMS.has(c?.platform)) problems.push(`${at}.platform must be one of ${[...PLATFORMS].join(', ')}`);
  if (!c?.name?.trim()) problems.push(`${at}.name is required`);
  const pledges = Array.isArray(c?.pledges) ? c.pledges : [];
  if (pledges.length === 0) problems.push(`${at}.pledges is empty — a campaign with no pledge of ours records nothing`);
  for (const [pi, p] of pledges.entries()) {
    const pAt = `${at}.pledges[${pi}]`;
    if (!PLATFORMS.has(p?.platform)) problems.push(`${pAt}.platform must be one of ${[...PLATFORMS].join(', ')}`);
    if (!p?.account?.trim()) problems.push(`${pAt}.account is required — WHICH LOGIN? there are two BackerKit accounts`);
    if (p?.status != null && !STATUSES.has(p.status)) problems.push(`${pAt}.status must be one of ${[...STATUSES].join(', ')}`);
    for (const [bi, b] of (p?.books ?? []).entries()) {
      if (!b?.workId && !b?.workKey && !(b?.title && b?.authors)) {
        problems.push(`${pAt}.books[${bi}] needs a workId, a workKey, or both title and authors`);
      }
    }
    for (const [ai, a] of (p?.accessories ?? []).entries()) {
      if (!a?.name?.trim()) problems.push(`${pAt}.accessories[${ai}].name is required`);
    }
  }
}

if (problems.length) {
  console.error(`${problems.length} problem(s) in ${FILE}:\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nNothing was read from the database. Fix the file and re-run.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Resolve every book to a work already in the catalog
// ---------------------------------------------------------------------------

const works = query('SELECT id, work_key AS workKey, title, authors FROM work', { remote });
console.log(`${works.length} work(s) in the ${where} database.`);

const byId = new Map(works.map((w) => [w.id, w]));
const byKey = new Map(works.map((w) => [w.workKey, w]));

/** ⚠️ `workKeyFor` from @lc/core — the ONE implementation. Never a local fold. */
function resolveWork(book) {
  if (book.workId != null) return byId.get(book.workId) ?? null;
  if (book.workKey) return byKey.get(book.workKey) ?? null;
  return byKey.get(workKeyFor(book.title, book.authors)) ?? null;
}

const editions = query('SELECT id, work_id AS workId, format FROM edition', { remote });
const editionsByWork = new Map();
for (const e of editions) {
  const list = editionsByWork.get(e.workId);
  if (list) list.push(e);
  else editionsByWork.set(e.workId, [e]);
}

/**
 * The printing this reward line was, if the catalog already holds one.
 *
 * ⚠️ Matched, never created. See the header. `editionFormat` in the file is a
 * person's answer and wins; `suggestFormat` is only ever printed as a proposal.
 */
function resolveEdition(work, book) {
  if (book.editionId != null) return book.editionId;
  const wanted = book.editionFormat ?? null;
  if (!wanted) return null;
  return editionsByWork.get(work.id)?.find((e) => e.format === wanted)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

const missing = [];
const unplaced = [];
const plan = [];

for (const c of campaigns) {
  const entry = { campaign: c, pledges: [] };
  for (const p of c.pledges) {
    const books = [];
    for (const b of p.books ?? []) {
      const work = resolveWork(b);
      if (!work) {
        missing.push({
          campaign: c.name,
          account: p.account,
          title: b.title ?? b.workKey ?? `#${b.workId}`,
          authors: b.authors ?? '',
        });
        continue;
      }
      books.push({ ...b, work, editionId: resolveEdition(work, b) });
    }

    // ⚠️ An accessory needs a book — `book_accessory.work_id` is NOT NULL. An
    // accessory naming no book is attached to the pledge's single work when
    // there is exactly one, and REFUSED when there is a choice. Guessing which
    // of four novels the plushie belongs to is not a decision a script may make.
    const distinct = [...new Set(books.map((b) => b.work.id))];
    const accessories = [];
    for (const a of p.accessories ?? []) {
      let work = a.workId != null || a.workKey || (a.title && a.authors) ? resolveWork(a) : null;
      if (!work && distinct.length === 1) work = byId.get(distinct[0]) ?? null;
      if (!work) {
        unplaced.push({ campaign: c.name, account: p.account, name: a.name, choices: distinct.length });
        continue;
      }
      accessories.push({ ...a, work });
    }

    entry.pledges.push({ pledge: p, books, accessories });
  }
  plan.push(entry);
}

// ---------------------------------------------------------------------------
// Say what will happen — the part that is worth reading
// ---------------------------------------------------------------------------

let totalLines = 0;
let totalAccessories = 0;

for (const { campaign, pledges } of plan) {
  console.log(`\n${campaign.platform.toUpperCase()}  ${campaign.name}`);
  for (const { pledge, books, accessories } of pledges) {
    const audit = pledgeAudit(
      books.map((b) => ({
        workId: b.work.id,
        editionId: b.editionId,
        editionVerdict: b.editionVerdict ?? null,
        format: b.editionId ? editions.find((e) => e.id === b.editionId)?.format : null,
        formatHint: b.formatHint,
        title: b.title,
        fulfilled: b.fulfilled,
      })),
    );
    totalLines += books.length;
    totalAccessories += accessories.length;

    console.log(`  ${pledge.platform} · ${pledge.account}${pledge.tier ? ` · ${pledge.tier}` : ''}`);
    console.log(`    ${auditSentence(audit)}`);

    for (const b of books) {
      const medium = pledgeItemMedium({
        format: b.editionId ? editions.find((e) => e.id === b.editionId)?.format : null,
        formatHint: b.formatHint,
        title: b.title,
      });
      const suggestion =
        b.editionId != null
          ? 'matched'
          : b.editionVerdict
            ? `no printing (${b.editionVerdict})`
            : (suggestFormat(b.formatHint ?? b.title) ?? '?');
      // ⚠️ Signed and numbered are prose in the reward title — there is no field
      // for them anywhere. Printed as a PROMPT: `copy.is_signed` and
      // `edition.edition_name` are where the answer goes, and a person puts it
      // there. Nothing here writes it.
      const flags = rewardFlags([b.title, b.formatHint].filter(Boolean).join(' '));
      const signed = flags.signed
        ? `  ⚠️ says SIGNED${flags.numbered ? ' & NUMBERED' : ''} — tick it on the copy`
        : '';
      console.log(
        `      ${medium.padEnd(9)} ${b.work.title}  [${b.formatHint ?? 'no format given'} → ${suggestion}]${signed}`,
      );
    }
    for (const a of accessories) {
      console.log(
        `      ${(a.isDigital ? 'digital' : 'extra').padEnd(9)} ${a.name}  (${a.kind ?? 'other'}) → ${a.work.title}`,
      );
    }
  }
}

if (missing.length) {
  console.log(`\n⚠️ ${missing.length} reward line(s) name a book this catalog does not hold.`);
  console.log('   Nothing is created for these — add the book in the app first, then re-run.');
  for (const m of missing) console.log(`   ${m.title}${m.authors ? ` — ${m.authors}` : ''}  (${m.campaign})`);
}

if (unplaced.length) {
  console.log(`\n⚠️ ${unplaced.length} accessor${unplaced.length === 1 ? 'y has' : 'ies have'} no book to attach to.`);
  console.log('   Give each one a "title"+"authors" or a "workId" — a pledge with several books');
  console.log('   cannot be guessed from, and book_accessory.work_id is NOT NULL.');
  for (const u of unplaced) console.log(`   ${u.name}  (${u.campaign} · ${u.account} · ${u.choices} books in the pledge)`);
}

console.log(`\n${plan.length} campaign(s), ${totalLines} book line(s), ${totalAccessories} accessor${totalAccessories === 1 ? 'y' : 'ies'} to write.`);

if (!commit) {
  console.log(`\nDRY RUN against the ${where} database. Re-run with --commit to write.`);
  console.log('⚠️ Read the per-line list above first. "needs splitting" and "unclassified" are');
  console.log('   the two that a total will never show you.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Write, in three passes, because each needs the ids the last one minted
// ---------------------------------------------------------------------------

/**
 * Campaigns. Upsert on (platform, external_id), else matched on name.
 *
 * ⚠️ **`WHERE external_id IS NOT NULL` in the conflict target is not optional.**
 * `idx_campaign_external` is a PARTIAL index, and SQLite will only use a partial
 * index as an upsert target if the clause repeats its predicate exactly. Without
 * it every campaign insert dies with *"ON CONFLICT clause does not match any
 * PRIMARY KEY or UNIQUE constraint"* — measured here on 2026-08-10, and it is
 * loud rather than silent, which is the one good thing about it.
 */
const campaignStatements = plan.map(({ campaign: c }) =>
  c.externalId
    ? `INSERT INTO crowdfunding_campaign (platform, name, creator, url, external_id, launched_on, funded_on, notes)
       VALUES (${lit(c.platform)}, ${lit(c.name.trim())}, ${lit(c.creator ?? null)}, ${lit(c.url ?? null)},
               ${lit(c.externalId)}, ${lit(c.launchedOn ?? null)}, ${lit(c.fundedOn ?? null)}, ${lit(c.notes ?? null)})
       ON CONFLICT (platform, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
         name = excluded.name,
         creator = COALESCE(excluded.creator, crowdfunding_campaign.creator),
         url = COALESCE(excluded.url, crowdfunding_campaign.url),
         launched_on = COALESCE(excluded.launched_on, crowdfunding_campaign.launched_on),
         funded_on = COALESCE(excluded.funded_on, crowdfunding_campaign.funded_on),
         notes = COALESCE(excluded.notes, crowdfunding_campaign.notes),
         updated_at = datetime('now');`
    : // No external id, so nothing to be idempotent on but the name. Stated
      // rather than hidden: two different campaigns with one name on one
      // platform would merge. Give the scan an externalId and this cannot happen.
      `INSERT INTO crowdfunding_campaign (platform, name, creator, url, launched_on, funded_on, notes)
       SELECT ${lit(c.platform)}, ${lit(c.name.trim())}, ${lit(c.creator ?? null)}, ${lit(c.url ?? null)},
              ${lit(c.launchedOn ?? null)}, ${lit(c.fundedOn ?? null)}, ${lit(c.notes ?? null)}
        WHERE NOT EXISTS (SELECT 1 FROM crowdfunding_campaign
                           WHERE platform = ${lit(c.platform)} AND name = ${lit(c.name.trim())} COLLATE NOCASE);`,
);

execute(campaignStatements, { remote });

const storedCampaigns = query(
  'SELECT id, platform, name, external_id AS externalId FROM crowdfunding_campaign',
  { remote },
);
const campaignId = (c) =>
  storedCampaigns.find((s) =>
    c.externalId
      ? s.platform === c.platform && s.externalId === c.externalId
      : s.platform === c.platform && s.name.toLowerCase() === c.name.trim().toLowerCase(),
  )?.id ?? null;

/** Pledges. Upsert on (campaign_id, platform, account) — the two-accounts guard. */
const pledgeStatements = [];
for (const { campaign: c, pledges } of plan) {
  const cid = campaignId(c);
  if (cid == null) throw new Error(`campaign "${c.name}" did not come back from the database`);
  for (const { pledge: p } of pledges) {
    pledgeStatements.push(
      `INSERT INTO crowdfunding_pledge
         (campaign_id, platform, account, tier, pledged_on, amount_cents, currency, manager_url, status, notes)
       VALUES (${cid}, ${lit(p.platform)}, ${lit(p.account.trim())}, ${lit(p.tier ?? null)},
               ${lit(p.pledgedOn ?? null)}, ${lit(p.amountCents ?? null)}, ${lit(p.currency ?? 'USD')},
               ${lit(p.managerUrl ?? null)}, ${lit(p.status ?? 'pledged')}, ${lit(p.notes ?? null)})
       ON CONFLICT (campaign_id, platform, account) DO UPDATE SET
         tier = COALESCE(excluded.tier, crowdfunding_pledge.tier),
         pledged_on = COALESCE(excluded.pledged_on, crowdfunding_pledge.pledged_on),
         amount_cents = COALESCE(excluded.amount_cents, crowdfunding_pledge.amount_cents),
         currency = excluded.currency,
         manager_url = COALESCE(excluded.manager_url, crowdfunding_pledge.manager_url),
         status = excluded.status,
         notes = COALESCE(excluded.notes, crowdfunding_pledge.notes),
         updated_at = datetime('now');`,
    );
  }
}

execute(pledgeStatements, { remote });

const storedPledges = query(
  'SELECT id, campaign_id AS campaignId, platform, account FROM crowdfunding_pledge',
  { remote },
);
const pledgeId = (cid, p) =>
  storedPledges.find(
    (s) => s.campaignId === cid && s.platform === p.platform && s.account === p.account.trim(),
  )?.id ?? null;

/**
 * Reward lines and accessories.
 *
 * ⚠️ The pledge-item conflict target names the same expressions as migration
 * 0010's unique index. Get it wrong and SQLite raises "ON CONFLICT clause does
 * not match any PRIMARY KEY or UNIQUE constraint" — a loud failure, which is
 * exactly what you want here rather than a silent duplicate.
 */
const itemStatements = [];
for (const { campaign: c, pledges } of plan) {
  const cid = campaignId(c);
  for (const { pledge: p, books, accessories } of pledges) {
    const pid = pledgeId(cid, p);
    if (pid == null) throw new Error(`pledge ${p.account} on "${c.name}" did not come back`);

    for (const b of books) {
      itemStatements.push(
        `INSERT INTO pledge_item
           (pledge_id, work_id, edition_id, edition_verdict, format_hint, title, quantity,
            fulfilled, external_ref, notes)
         VALUES (${pid}, ${b.work.id}, ${lit(b.editionId ?? null)}, ${lit(b.editionVerdict ?? null)},
                 ${lit(b.formatHint ?? null)},
                 ${lit(b.title ?? null)}, ${b.quantity ?? 1}, ${b.fulfilled ? 1 : 0},
                 ${lit(b.externalRef ?? null)}, ${lit(b.notes ?? null)})
         ON CONFLICT (pledge_id, work_id, IFNULL(edition_id, 0), IFNULL(format_hint, '')) DO UPDATE SET
           edition_verdict = COALESCE(excluded.edition_verdict, pledge_item.edition_verdict),
           title = COALESCE(excluded.title, pledge_item.title),
           quantity = excluded.quantity,
           fulfilled = excluded.fulfilled,
           external_ref = COALESCE(excluded.external_ref, pledge_item.external_ref),
           notes = COALESCE(excluded.notes, pledge_item.notes),
           updated_at = datetime('now');`,
      );
    }

    for (const a of accessories) {
      // ⚠️ `book_accessory` has no unique index — a household can genuinely own
      // two identical pins — so a blind insert would duplicate on every run. The
      // guard is a NOT EXISTS on (work_id, pledge_id, name), which is the only
      // combination a re-scan can repeat.
      itemStatements.push(
        `INSERT INTO book_accessory (work_id, copy_id, name, kind, is_digital, quantity, location, notes, pledge_id)
         SELECT ${a.work.id}, NULL, ${lit(a.name.trim())}, ${lit(a.kind ?? 'other')},
                ${a.isDigital ? 1 : 0}, ${a.quantity ?? 1}, ${lit(a.location ?? null)},
                ${lit(a.notes ?? null)}, ${pid}
          WHERE NOT EXISTS (SELECT 1 FROM book_accessory
                             WHERE work_id = ${a.work.id} AND pledge_id = ${pid}
                               AND name = ${lit(a.name.trim())});`,
      );
    }
  }
}

execute(itemStatements, { remote });

// ⚠️ Confirmed by re-reading, never by the statement count. `execute` returns how
// many statements ran, and miniflare's D1 omits `meta.changes` entirely — see the
// note on `execute` in scripts/lib/d1.mjs.
const after = query(
  `SELECT (SELECT COUNT(*) FROM crowdfunding_campaign) AS campaigns,
          (SELECT COUNT(*) FROM crowdfunding_pledge) AS pledges,
          (SELECT COUNT(*) FROM pledge_item) AS items,
          (SELECT COUNT(DISTINCT work_id) FROM pledge_item) AS works,
          (SELECT COUNT(*) FROM pledge_item
            WHERE edition_id IS NULL AND edition_verdict IS NULL) AS noPrinting,
          (SELECT COUNT(*) FROM book_accessory) AS accessories`,
  { remote },
)[0];

console.log(
  `\nWritten to the ${where} database: ${after.campaigns} campaign(s), ${after.pledges} pledge(s), ` +
    `${after.items} reward line(s) across ${after.works} book(s), ${after.accessories} accessor${after.accessories === 1 ? 'y' : 'ies'}.`,
);
if (after.noPrinting > 0) {
  console.log(
    `⚠️ ${after.noPrinting} line(s) still have no printing. Create the edition in the app, then re-run — ` +
      'this script never mints one.',
  );
}
