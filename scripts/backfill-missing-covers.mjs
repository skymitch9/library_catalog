#!/usr/bin/env node
/**
 * Give every book a cover, from the same places its ISBN data came from.
 *
 * ## Why this exists beside `backfill-work-covers.mjs`
 *
 * That script moves a cover **this catalog already holds** from an edition up
 * onto its work. It fetches nothing. It is the right first step and it is not
 * enough: measured against production 2026-08-10, of **52** works with no cover,
 * 12 had one stranded on an edition and the other **40 had no cover anywhere in
 * the database**. This script is for those — it goes back out to the ISBN ladder.
 *
 * Run them in that order. This one skips a work whose edition already has a
 * cover, because a network call to re-fetch something already on disk is waste.
 *
 * ## The rungs, and what each is actually worth
 *
 * Measured 2026-08-10 over the 46 coverless works carrying an ISBN:
 *
 * | Rung | Covers | Note |
 * |---|---|---|
 * | Open Library (`/api/books`) | **12** | exactly the 12 already stranded on an edition — **zero new** |
 * | Google Books (key required) | **19** more, of the 34 Open Library missed | the rung that actually earns its place here |
 * | neither | 15 | plus 6 works that have no edition and so no ISBN at all |
 *
 * ⚠️ **The obvious idea does not work.** `covers.openlibrary.org/b/isbn/{isbn}-L.jpg`
 * looks like the answer and is worth exactly nothing beyond what the edition rows
 * already carried — its 12 hits are the same 12. It is Google Books, gated on a
 * key that is already configured, that moves the number.
 *
 * ## ⚠️ The 1×1 placeholder, and why nothing here is stored unverified
 *
 * Open Library answers a cover request for a book it has no cover for with
 * **HTTP 200 and a 43-byte 1×1 pixel**, not a 404. An unguarded sweep would have
 * "filled" all 46 and left 34 works rendering a blank dot, with the count
 * reporting a clean success. Every URL this script writes has been fetched and
 * checked by `verifyCoverUrl` — `?default=false` plus a size floor. Nothing in
 * this system ever revisits a cover column, so a bad write is permanent in a way
 * a blank is not.
 *
 * ## Usage
 *
 *     npm run backfill:missing-covers                      # dry run, local
 *     npm run backfill:missing-covers -- --remote          # dry run, production
 *     npm run backfill:missing-covers -- --remote --commit # apply
 *     npm run backfill:missing-covers -- --remote --repair # ALSO check stored covers still load
 *     npm run backfill:missing-covers -- --remote --llm    # ⚠️ COSTS MONEY, see below
 *
 * `--repair` widens the question from "which works have no cover" to "which works
 * have no *working* cover". It fetches every stored URL, which is slow and mostly
 * confirms nothing is wrong — so it is a flag, not the default.
 *
 * ⚠️ `--llm` adds a **paid** rung for the books the free ones could not reach: it
 * asks Claude, with web search, and costs roughly **6c per book** (Claude Opus 5
 * tokens plus server-side web search at $10/1,000 searches — an estimate from
 * list prices, not a measured sweep). It is opt-in per run and deliberately not
 * wired into the scan path, so adding a book tomorrow still costs nothing. Every
 * URL it proposes is fetched and checked before it is written — a hallucinated
 * image link is well-formed, plausible and 404, and this is the only thing
 * standing between that and the database.
 *
 * Reads `GOOGLE_BOOKS_API_KEY` from `apps/worker/.dev.vars`. ⚠️ Without it rung 2
 * is skipped and this script is worth 0 new covers — anonymous Google Books
 * returned 429 on 40 of 40 calls (2026-08-09).
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { execute, lit, parseFlags, query, ROOT } from './lib/d1.mjs';
import { coverFrom, resolveIsbn, verifyCoverUrl } from '../packages/isbn/src/resolve.ts';
import { COVER_CENTS_EACH, findCover } from '../packages/research/src/covers.ts';

const flags = parseFlags();
const repair = process.argv.includes('--repair');
/** ⚠️ Costs money per book. Opt-in per run, never automatic. See --llm below. */
const useLlm = process.argv.includes('--llm');

const UA = 'library_catalog (+https://github.com/private)';
/** Open Library asks for roughly one call a second and means it. */
const PAUSE_MS = 1100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// The Google Books key, from the one file that holds real key material.
// ---------------------------------------------------------------------------

/** Read one key out of the gitignored `.dev.vars`. Never printed, only used. */
function readDevVar(name) {
  const file = path.join(ROOT, 'apps/worker/.dev.vars');
  if (!existsSync(file)) return undefined;
  const m = new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm').exec(
    readFileSync(file, 'utf8'),
  );
  return m?.[1]?.trim() || undefined;
}

const key = readDevVar('GOOGLE_BOOKS_API_KEY');
console.log(
  key
    ? 'Google Books key: present (rung 2 active)'
    : '⚠️ Google Books key: MISSING — rung 2 is skipped and this run is worth ~0 new covers.\n' +
        '   Put GOOGLE_BOOKS_API_KEY in apps/worker/.dev.vars (it is gitignored).',
);

// ---------------------------------------------------------------------------
// Who needs one
// ---------------------------------------------------------------------------

const CANDIDATES = `
  SELECT w.id AS id, w.title AS title, w.authors AS authors,
         (SELECT group_concat(COALESCE(e.isbn13, e.isbn10), ' ')
            FROM edition e
           WHERE e.work_id = w.id
             AND (e.isbn13 IS NOT NULL OR e.isbn10 IS NOT NULL)) AS isbns
    FROM work w
   WHERE (w.cover_url IS NULL OR w.cover_url = '')
     AND NOT EXISTS (SELECT 1 FROM edition e2
                      WHERE e2.work_id = w.id
                        AND e2.cover_url IS NOT NULL AND e2.cover_url <> '')
   ORDER BY w.id
`;

const rows = query(CANDIDATES, flags);
const stranded = query(
  `SELECT COUNT(*) AS n FROM work w
    WHERE (w.cover_url IS NULL OR w.cover_url = '')
      AND EXISTS (SELECT 1 FROM edition e WHERE e.work_id = w.id
                    AND e.cover_url IS NOT NULL AND e.cover_url <> '')`,
  flags,
)[0];

const total = query(
  `SELECT COUNT(*) AS works,
          SUM(CASE WHEN cover_url IS NULL OR cover_url = '' THEN 1 ELSE 0 END) AS blank
     FROM work`,
  flags,
)[0];

console.log(
  `\n${flags.remote ? 'production' : 'local'}: ${total.works} work(s), ${total.blank} with no cover`,
);
if (Number(stranded?.n ?? 0) > 0) {
  console.log(
    `  ⚠️ ${stranded.n} of those have a cover stranded on an edition. Run\n` +
      '     node scripts/backfill-work-covers.mjs --remote --commit\n' +
      '     first — it needs no network and this script deliberately skips them.',
  );
}

const withIsbn = rows.filter((r) => r.isbns);
const withoutIsbn = rows.filter((r) => !r.isbns);
console.log(`  ${rows.length} to fetch for: ${withIsbn.length} with an ISBN, ${withoutIsbn.length} without`);
if (withoutIsbn.length) {
  console.log('\nNo edition and so no ISBN — nothing on this ladder can reach these:');
  for (const r of withoutIsbn) console.log(`  ${String(r.id).padStart(4)}  ${r.title}`);
}

const targets = Number.isFinite(flags.limit) ? withIsbn.slice(0, flags.limit) : withIsbn;

// ---------------------------------------------------------------------------
// Ask the ladder
// ---------------------------------------------------------------------------

const found = [];
const empty = [];

console.log(`\nasking the ISBN ladder for ${targets.length} work(s)…\n`);

for (const [i, r] of targets.entries()) {
  const isbns = String(r.isbns).split(' ').filter(Boolean);
  let hit = null;

  for (const isbn of isbns) {
    const { candidates } = await resolveIsbn(isbn, { googleBooksKey: key, userAgent: UA });
    const url = coverFrom(candidates);
    if (!url) {
      await sleep(PAUSE_MS);
      continue;
    }
    // ⚠️ Never store what has not been fetched. See verifyCoverUrl.
    const check = await verifyCoverUrl(url, { userAgent: UA });
    if (check.ok) {
      const rung = candidates.find((c) => c.coverUrl === url)?.source ?? 'unknown';
      hit = { url, bytes: check.bytes, rung, isbn };
      break;
    }
    console.log(`       rejected ${url.slice(0, 60)} — ${check.reason}`);
    await sleep(PAUSE_MS);
  }

  const n = `${String(i + 1).padStart(3)}/${targets.length}`;
  if (hit) {
    found.push({ ...r, ...hit });
    console.log(`${n} ✓ ${hit.rung.padEnd(12)} ${String(hit.bytes).padStart(6)}B  ${r.title.slice(0, 46)}`);
  } else {
    empty.push(r);
    console.log(`${n} ·  ${'no cover'.padEnd(12)}         ${r.title.slice(0, 46)}`);
  }
  await sleep(PAUSE_MS);
}

console.log('');
console.log(`covers found        ${found.length}`);
console.log(`  from openlibrary  ${found.filter((f) => f.rung === 'openlibrary').length}`);
console.log(`  from googlebooks  ${found.filter((f) => f.rung === 'googlebooks').length}`);
console.log(`no cover anywhere   ${empty.length + withoutIsbn.length}`);

if (empty.length) {
  console.log('\nHas an ISBN, but neither rung holds a cover:');
  for (const r of empty) console.log(`  ${String(r.id).padStart(4)}  ${r.title}`);
}

// ---------------------------------------------------------------------------
// --llm: the paid rung, for what the free ones could not reach
// ---------------------------------------------------------------------------

const llmFound = [];
if (useLlm) {
  // Everything the ladder missed, including works with no ISBN — this rung
  // searches by title and author, so a missing ISBN is not disqualifying.
  const remaining = [...empty, ...withoutIsbn];
  const worst = ((remaining.length * COVER_CENTS_EACH) / 100).toFixed(2);

  console.log('');
  console.log(`--llm: ${remaining.length} book(s) the free rungs could not cover.`);
  console.log(
    `  ⚠️ This rung calls Claude with web search and COSTS MONEY: about` +
      ` ${COVER_CENTS_EACH}c per book worst case, so roughly $${worst} for this run.` +
      `\n     That is an estimate from list prices, not a measurement — see COVER_CENTS_EACH.`,
  );

  const apiKey = readDevVar('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.log('  ⚠️ No ANTHROPIC_API_KEY in apps/worker/.dev.vars — skipping this rung.');
  } else {
    for (const [i, r] of remaining.entries()) {
      const isbn = r.isbns ? String(r.isbns).split(' ')[0] : null;
      const n = `${String(i + 1).padStart(3)}/${remaining.length}`;
      let proposal;
      try {
        const out = await findCover(apiKey, { title: r.title, authors: r.authors, isbn });
        proposal = out.proposal;
        console.log(
          `${n} ${out.usage.estimatedCents.toFixed(2)}c tokens  ${r.title.slice(0, 40)}` +
            `  -> ${proposal.found ? `${proposal.confidence} conf` : 'not found'}`,
        );
      } catch (err) {
        console.log(`${n} ERROR  ${r.title.slice(0, 40)} — ${err?.message ?? err}`);
        continue;
      }

      if (!proposal.found || !proposal.url) continue;

      /*
       * ⚠️ The model's URL is a CLAIM. Fetch it before believing it.
       *
       * A hallucinated image link is well-formed, plausible, and 404 — and it is
       * indistinguishable from a real one until a person opens the page. This is
       * the same verifier the free rungs use, deliberately.
       */
      const check = await verifyCoverUrl(proposal.url, { userAgent: UA });
      if (!check.ok) {
        console.log(`       proposed ${proposal.url.slice(0, 58)}\n       REJECTED — ${check.reason}`);
        continue;
      }
      console.log(`       ✓ verified ${check.bytes}B from ${proposal.source ?? 'unknown'}`);
      if (proposal.confidence === 'low') {
        console.log(`       ⚠️ low confidence: ${proposal.note}`);
      }
      llmFound.push({ ...r, url: proposal.url, bytes: check.bytes, rung: 'llm' });
    }

    console.log('');
    console.log(`--llm verified ${llmFound.length} of ${remaining.length}.`);
  }
}

// ---------------------------------------------------------------------------
// --repair: a stored cover that no longer loads
// ---------------------------------------------------------------------------

const broken = [];
if (repair) {
  const live = query(
    `SELECT id, title, cover_url FROM work WHERE cover_url IS NOT NULL AND cover_url <> '' ORDER BY id`,
    flags,
  );
  console.log(`\n--repair: checking ${live.length} stored cover URL(s)…`);
  for (const r of live) {
    // Covers copied from the audiobook catalog are relative paths into that
    // repo's site/ directory, not URLs. Nothing to fetch, and not broken.
    if (!/^https?:\/\//i.test(r.cover_url)) continue;
    const check = await verifyCoverUrl(r.cover_url, { userAgent: UA });
    if (!check.ok) {
      broken.push({ ...r, reason: check.reason });
      console.log(`  ✗ ${String(r.id).padStart(4)}  ${r.title.slice(0, 40)} — ${check.reason}`);
    }
  }
  console.log(`  ${broken.length} broken of ${live.length} checked`);
  if (broken.length) {
    console.log('  ⚠️ Not cleared automatically. A dead URL may be a transient outage,');
    console.log('     and blanking it loses the only record of where the cover came from.');
  }
}

// ---------------------------------------------------------------------------

const statements = [...found, ...llmFound].map(
  (f) =>
    `UPDATE work SET cover_url = ${lit(f.url)}, updated_at = datetime('now')` +
    ` WHERE id = ${lit(f.id)} AND (cover_url IS NULL OR cover_url = '');`,
);

console.log(`\n${statements.length} statement(s) to run.`);
if (!flags.commit) {
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.');
  process.exit(0);
}
if (statements.length === 0) process.exit(0);

execute(statements, flags);

/*
 * ⚠️ Confirm by re-reading. `execute` returns statements run, not rows changed,
 * and one backfill today reported "nothing to do" over 99 live rows.
 */
const after = query(
  `SELECT COUNT(*) AS works,
          SUM(CASE WHEN cover_url IS NULL OR cover_url = '' THEN 1 ELSE 0 END) AS blank
     FROM work`,
  flags,
)[0];
console.log(
  `\nwrote ${statements.length}. ${after.works} work(s), ${after.blank} still with no cover` +
    ` (was ${total.blank}).`,
);
if (Number(after.blank) !== Number(total.blank) - statements.length) {
  console.log('⚠️ That is not the arithmetic expected. Investigate before re-running.');
}
