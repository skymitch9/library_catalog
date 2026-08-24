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
 * | Bookcover API (free) | fallback | covers books neither OL nor Google hold, when the API is up |
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
 *     npm run backfill:missing-covers -- --remote --standins  # ALSO re-try known stand-ins
 *     npm run backfill:missing-covers -- --remote --llm    # ⚠️ COSTS MONEY, see below
 *     npm run backfill:missing-covers -- --remote --llm --commit   # ⚠️ the ONLY --llm run that spends
 *     npm run backfill:missing-covers -- --remote --llm --llm-dry  # ⚠️ paid preview: spends, writes nothing
 *
 * `--repair` widens the question from "which works have no cover" to "which works
 * have no *working* cover". It fetches every stored URL, which is slow and mostly
 * confirms nothing is wrong — so it is a flag, not the default.
 *
 * ⚠️ **`--standins` widens it the other way, to the app's OWN question.** The
 * paragraph above this one used to say this script "only targets works with no
 * cover", and that was true and quietly wrong: `coverNeeded` in `@lc/core` and
 * `NEEDS_CLAUSE.cover` in `@lc/db` both define it as
 * `cover_url IS NULL OR cover_status = 'standin'`, so the sweep could never
 * reach a book the app itself was marking as still wanting one. Measured
 * 2026-08-23: padhard held 15 blanks and 17 stand-ins, so the script reported
 * 15 where the site reported 32.
 *
 * `NEEDS_COVER` below is a deliberate mirror of that fragment, not a third
 * definition of the question. Two rules go with it:
 *
 *  - a stand-in beaten by a **verified** real cover is written with
 *    `cover_status = 'ok'` in the SAME statement (migration 0040 pairs the
 *    columns — see the comment above `statements`);
 *  - a stand-in nothing could beat **stays a stand-in**. It is never blanked.
 *    A stand-in is a recorded judgement; a blank is the absence of one.
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
 * ⚠️ **The paid call is gated on `--commit` — a dry `--llm` run spends NOTHING.**
 * (Fixed 2026-08-24; before that the paid loop ran on the dry pass too, so a
 * "dry then commit" workflow was billed TWICE and, because each pass re-asks,
 * the dry pass was not even a preview of what the committing pass would write.)
 * A dry `--llm` run now prices the rung — how many books WOULD be asked and the
 * worst-case cost — and stops. `--llm-dry` (default OFF) is the explicit opt-in
 * for anyone who genuinely wants a PAID preview that spends but writes nothing.
 * The free rungs still run in dry mode; only this one paid rung is gated.
 *
 * ⚠️ **A `confidence: 'low'` proposal is never written, however well it
 * verifies.** `verifyCoverUrl` proves the bytes are an image; it cannot prove
 * they are an image of THIS book, and low confidence is the model saying it
 * cannot either. Those are printed for the owner with the URL and the model's
 * note, and the book stays counted as wanting a cover until a person decides.
 * The run also prints its MEASURED spend — calls and cents summed from `usage`
 * — rather than only the list-price guess in `COVER_CENTS_EACH`.
 *
 * ⚠️ **Whose key pays follows the INSTANCE, not the run.** `--llm` reads
 * `ANTHROPIC_API_KEY` on the main catalogue and `ANTHROPIC_API_KEY_FRIEND_SAM`
 * on `--friend`, and prints which NAME it used. Padhard's spend goes on
 * Samantha's own key — `apps/worker/.dev.vars` lines 79–85 say so. Her line is
 * a drop-box that lives BLANK; see the comment at the rung itself.
 *
 * ⚠️ **`--llm-key-from=main` is the one way out of that, and it is deliberately
 * ugly.** It makes a `--friend --llm` run read `ANTHROPIC_API_KEY` — the OWNER's
 * key — instead of Samantha's, so padhard's covers land on his bill. It has to
 * be typed in full, on purpose, for exactly one reason: the default is the
 * custody rule, and a rule you can opt out of by accident is not one. What it
 * does NOT do is change the default — with the flag absent the rung still
 * refuses to fall back, and still says so. When the flag IS present the banner
 * names the key in use and says the override is active, so the bill is never a
 * surprise. Owner decision, 2026-08-23: *"Run those 15 on MY key instead."*
 *
 *     npm run backfill:missing-covers -- --friend --remote --llm --llm-key-from=main
 *
 * Reads `GOOGLE_BOOKS_API_KEY` from `apps/worker/.dev.vars`. ⚠️ Without it rung 2
 * is skipped and this script is worth 0 new covers — anonymous Google Books
 * returned 429 on 40 of 40 calls (2026-08-09).
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { execute, lit, parseFlags, query, ROOT } from './lib/d1.mjs';
import { coverFrom, resolveIsbn, verifyCoverUrl } from '../packages/isbn/src/resolve.ts';
import { searchOpenLibrary } from '../packages/isbn/src/search.ts';
import { titleSimilarity } from '../packages/core/src/matching.ts';
import { normaliseTitle } from '../packages/core/src/titles.ts';
import { COVER_CENTS_EACH, findCover } from '../packages/research/src/covers.ts';

const flags = parseFlags();
const repair = process.argv.includes('--repair');
/** ⚠️ Costs money per book. Opt-in per run, never automatic. See --llm below. */
const useLlm = process.argv.includes('--llm');
/**
 * ⚠️ **The paid `--llm` call is gated on `--commit` — a dry run makes NO paid
 * call.** Until 2026-08-24 the loop below ran on the dry pass too: only the SQL
 * write was gated, so a "dry then commit" workflow was billed TWICE, and the
 * dry pass wasn't even a reliable preview (each pass re-asks Claude, so results
 * differ). Now a dry run prices the rung — how many books WOULD be asked and the
 * worst-case cost — and stops without spending.
 *
 * `--llm-dry` is the deliberate opt-in for anyone who truly wants a PAID preview
 * (it spends but writes nothing). Default OFF. The free rungs (Open Library,
 * Google Books, Bookcover, title search) still run in dry mode — they cost
 * nothing; only this one paid rung is gated.
 */
const llmDry = process.argv.includes('--llm-dry');
/** Also go after works wearing a known stand-in. See `NEEDS_COVER` below. */
const includeStandins = process.argv.includes('--standins');

/**
 * ⚠️ **The escape hatch from the whose-key-pays rule — and it is meant to look
 * like one.**
 *
 * `--llm-key-from=main` makes a `--friend` run spend `ANTHROPIC_API_KEY` rather
 * than `ANTHROPIC_API_KEY_FRIEND_SAM`. The long, explicit spelling is the point:
 * the default (refuse, never fall back) is a custody rule, and the only safe way
 * to have an exception to a custody rule is to make it impossible to take by
 * accident. There is no short form, no env var, and no `--llm-key=…` that could
 * be confused with passing a key on the command line.
 *
 * It is validated HERE, before the free rungs run, rather than at the paid rung
 * forty seconds later — a typo in the one flag that redirects a bill should cost
 * nothing and stop immediately.
 */
const llmKeyFrom = (() => {
  const arg = process.argv.find((a) => a === '--llm-key-from' || a.startsWith('--llm-key-from='));
  if (!arg) return null;
  const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1).trim() : '';
  if (value !== 'main') {
    console.error(
      `⚠️ --llm-key-from: the only accepted value is "main"` +
        (value ? `, not "${value}".` : ' — it takes an "=", e.g. --llm-key-from=main.'),
    );
    console.error(
      '   It exists to bill a --friend run to the OWNER\'s ANTHROPIC_API_KEY.\n' +
        '   There is nothing else to point it at: the default already reads the key\n' +
        '   belonging to whichever instance the run is aimed at.',
    );
    process.exit(1);
  }
  if (!useLlm) {
    console.error('⚠️ --llm-key-from=main does nothing without --llm — that is the only rung that spends. Stopping.');
    process.exit(1);
  }
  if (!flags.friend) {
    console.error(
      '⚠️ --llm-key-from=main does nothing without --friend: a main-instance run\n' +
        '   already reads ANTHROPIC_API_KEY. Stopping rather than pretending the flag\n' +
        '   changed something.',
    );
    process.exit(1);
  }
  return value;
})();

/**
 * "Cover needed", as SQL — ⚠️ **a MIRROR of `NEEDS_COVER` in
 * `packages/db/src/works.ts`, character for character.**
 *
 * The app has exactly one definition of this question and it is not
 * `cover_url IS NULL`: `coverNeeded` in `@lc/core` for the card mark,
 * `NEEDS_CLAUSE.cover` in `@lc/db` for the server's filter. Migration 0040 is
 * the reason — a stand-in HAS a url, so every "has a cover" test says yes about
 * a cover we already know is wrong.
 *
 * ⚠️ This script quoted the blank-only form and its header said so out loud, so
 * a run of it reported 15 where padhard's own `/works?needs=cover` reported 32.
 * A third definition living here is how those two numbers drift apart for good,
 * so this is a copy under instruction and not a new rule. If `works.ts` changes,
 * this line changes with it.
 */
const NEEDS_COVER = "(w.cover_url IS NULL OR w.cover_status = 'standin')";

/** The narrower, original question: no cover at all. */
const BLANK_ONLY = "(w.cover_url IS NULL OR w.cover_url = '')";

/** Which question THIS run is asking. `--standins` widens it to the app's own. */
const TARGET_CLAUSE = includeStandins ? NEEDS_COVER : BLANK_ONLY;

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

/*
 * ⚠️ The stranded-on-an-edition skip must NOT swallow a stand-in.
 *
 * That skip means "this catalogue already holds a cover for the book, one row
 * down; `backfill-work-covers.mjs` copies it up for free, so a network call
 * here is waste". A stand-in is the opposite case: a cover we hold and have
 * already REJECTED. And `backfill-work-covers.mjs` only fills works with no
 * cover, so it will never reach a stand-in either — leave the skip unqualified
 * and the 17 padhard stand-ins are stranded between the two scripts forever.
 */
const CANDIDATES = `
  SELECT w.id AS id, w.title AS title, w.authors AS authors,
         w.cover_status AS cover_status,
         (SELECT group_concat(COALESCE(e.isbn13, e.isbn10), ' ')
            FROM edition e
           WHERE e.work_id = w.id
             AND (e.isbn13 IS NOT NULL OR e.isbn10 IS NOT NULL)) AS isbns
    FROM work w
   WHERE ${TARGET_CLAUSE}
     AND (w.cover_status = 'standin'
          OR NOT EXISTS (SELECT 1 FROM edition e2
                          WHERE e2.work_id = w.id
                            AND e2.cover_url IS NOT NULL AND e2.cover_url <> ''))
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

/**
 * ⚠️ Three numbers, because two of them are routinely mistaken for each other.
 * `blank` is what this script used to report; `needed` is what the app reports.
 * They differed by 17 on padhard on 2026-08-23, which reads as a regression the
 * first time somebody puts the two reports side by side.
 */
const COUNTS = `SELECT COUNT(*) AS works,
       SUM(CASE WHEN ${BLANK_ONLY} THEN 1 ELSE 0 END) AS blank,
       SUM(CASE WHEN w.cover_status = 'standin' THEN 1 ELSE 0 END) AS standin,
       SUM(CASE WHEN ${NEEDS_COVER} THEN 1 ELSE 0 END) AS needed
  FROM work w`;

const total = query(COUNTS, flags)[0];

console.log(
  `\n${flags.remote ? 'production' : 'local'} ${flags.friend ? 'library-catalog-2nd (padhard)' : 'library-catalog'}: ` +
    `${total.works} work(s) — ${total.blank} with no cover, ${total.standin} wearing a stand-in, ` +
    `${total.needed} cover-needed (the app's own number).`,
);
console.log(
  includeStandins
    ? "  --standins: targeting the app's own question, cover_url IS NULL OR cover_status = 'standin'."
    : '  targeting blanks only. Add --standins to also re-try the stand-ins.',
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

/**
 * ⚠️ Which rungs COULD NOT BE ASKED, as opposed to which had no cover.
 *
 * Added 2026-08-22 after a padhard sweep reported "no cover anywhere: 40" in a
 * run where **Google Books answered HTTP 429 to every single call** — the daily
 * quota was spent. `resolveIsbn` records exactly that in its trace
 * (`{ ok:false, detail:"googlebooks 429" }`) and this script was throwing the
 * trace away, so an exhausted rung and a genuinely coverless book printed
 * identically.
 *
 * That is the difference between "ask again tomorrow, for nothing" and "this
 * needs a person or the paid rung", and the run was giving the wrong one. It is
 * the worst rung to lose silently: `resolve.ts` measures Google Books as the one
 * that actually moves the number.
 */
const rungDown = new Map();

console.log(`\nasking the ISBN ladder for ${targets.length} work(s)…\n`);

for (const [i, r] of targets.entries()) {
  const isbns = String(r.isbns).split(' ').filter(Boolean);
  let hit = null;

  for (const isbn of isbns) {
    const { candidates, trace } = await resolveIsbn(isbn, {
      googleBooksKey: key,
      userAgent: UA,
    });
    // A rung that threw did not answer "no cover" — it did not answer at all.
    for (const t of trace) {
      if (t.ok) continue;
      const at = rungDown.get(t.rung) ?? { calls: 0, detail: t.detail };
      at.calls += 1;
      rungDown.set(t.rung, at);
    }
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
console.log(`  from bookcover    ${found.filter((f) => f.rung === 'bookcover-api').length}`);
console.log(`no cover anywhere   ${empty.length + withoutIsbn.length}`);

// ⚠️ Printed BEFORE the list below, because that list's heading is only
// true when every rung actually answered.
if (rungDown.size) {
  console.log('');
  for (const [rung, at] of rungDown) {
    const quota = /429|quota/i.test(String(at.detail));
    console.log(
      '⚠️ RUNG NOT ASKED: ' + rung + ' failed ' + at.calls + ' call(s) — ' + at.detail + '.',
    );
    console.log(
      '   Those books are UNMEASURED by this rung, not coverless. ' +
        (quota
          ? 'A quota, not a missing book: re-run after it resets, for nothing.'
          : 'Fix the rung and re-run BEFORE spending the paid --llm rung on them.'),
    );
  }
}

if (empty.length) {
  console.log(
    rungDown.size
      ? '\nHas an ISBN, and no cover from the rungs that ANSWERED (see the warning above):'
      : '\nHas an ISBN, but neither rung holds a cover:',
  );
  for (const r of empty) console.log(`  ${String(r.id).padStart(4)}  ${r.title}`);
}

// ---------------------------------------------------------------------------
// Rung 3, free: Open Library searched by TITLE AND AUTHOR rather than by ISBN
// ---------------------------------------------------------------------------

/*
 * ## Why this rung had to exist
 *
 * Every rung above is keyed on an ISBN, and that quietly decided which books
 * could ever get a cover. Measured after the first full sweep: the books left
 * without one included *The Sea of Monsters*, *The Nightmare Before Christmas*
 * and *The Day the Crayons Made Friends* — titles every cover database on earth
 * holds. They failed for a reason that has nothing to do with the books: their
 * editions carry no ISBN, because they were hand-created (the Illumicrate Percy
 * Jackson set) or scanned from a code that resolved to nothing.
 *
 * So the paid LLM rung was being asked to do work a free search could do. That
 * is the wrong shape: money spent to cover a gap in the ladder.
 *
 * ⚠️ **A title search is weaker evidence than an ISBN and is treated as such.**
 * `searchOpenLibrary` exists precisely because the right answer is not reliably
 * first — the comment there records "Firefight" + Brandon Sanderson returning a
 * different 2001 Firefight at the top. So every candidate goes through the same
 * similarity gate a spine read gets, and a weak match is skipped rather than
 * guessed. Free-text is deliberately NOT used: it is the rung that answered
 * "The Wandering Inn" with a different book by the same author.
 */

const titleFound = [];
const stillEmpty = [...empty, ...withoutIsbn];

if (stillEmpty.length) {
  console.log(`\nRung 3 (free): searching Open Library by title for ${stillEmpty.length} book(s).`);
  for (const r of stillEmpty) {
    let candidates = [];
    try {
      candidates = await searchOpenLibrary(r.title, r.authors ?? null, { userAgent: UA });
    } catch (err) {
      console.log(`  ERROR  ${r.title.slice(0, 44)} — ${err?.message ?? err}`);
      await sleep(PAUSE_MS);
      continue;
    }

    const hit = candidates.find(
      (c) => c.coverUrl && titleSimilarity(normaliseTitle(c.title), normaliseTitle(r.title)) >= 0.85,
    );
    await sleep(PAUSE_MS);
    if (!hit) continue;

    // Same verifier as every other rung. Open Library answers a missing cover
    // with a 1x1 placeholder and HTTP 200 unless asked not to, so a URL that
    // exists is not yet a cover that exists.
    const check = await verifyCoverUrl(hit.coverUrl, { userAgent: UA });
    if (!check.ok) {
      console.log(`  rejected ${r.title.slice(0, 40)} — ${check.reason}`);
      continue;
    }
    console.log(`  ✓ ${String(r.id).padStart(4)}  ${r.title.slice(0, 44)}  (${check.bytes}B)`);
    titleFound.push({ ...r, url: hit.coverUrl, bytes: check.bytes, rung: 'ol-title' });
  }
  console.log(`Rung 3 found ${titleFound.length} of ${stillEmpty.length}.`);
}

/** What the paid rung should still be asked about — never what rung 3 just got. */
const titleFoundIds = new Set(titleFound.map((f) => f.id));

// ---------------------------------------------------------------------------
// --llm: the paid rung, for what the free ones could not reach
// ---------------------------------------------------------------------------

const llmFound = [];
/**
 * ⚠️ Verified, on the right shelf, and STILL NOT WRITTEN — the model said it was
 * unsure this is the same book. Held for the owner instead. See below.
 */
const llmLowConfidence = [];
/** What this run actually cost, summed from `usage`, not from the list-price guess. */
const spend = { calls: 0, cents: 0, errors: 0 };
if (useLlm) {
  // Everything the ladder missed, including works with no ISBN — this rung
  // searches by title and author, so a missing ISBN is not disqualifying.
  // ⚠️ Skip anything rung 3 just covered for free — otherwise the paid rung
  // re-buys a cover we already hold, which is the exact waste it exists to avoid.
  const remaining = [...empty, ...withoutIsbn].filter((r) => !titleFoundIds.has(r.id));
  const worst = ((remaining.length * COVER_CENTS_EACH) / 100).toFixed(2);

  console.log('');
  console.log(`--llm: ${remaining.length} book(s) the free rungs could not cover.`);
  console.log(
    `  ⚠️ This rung calls Claude with web search and COSTS MONEY: about` +
      ` ${COVER_CENTS_EACH}c per book worst case, so roughly $${worst} for this run.` +
      `\n     That is an estimate from list prices, not a measurement — see COVER_CENTS_EACH.`,
  );

  /*
   * ⚠️ **The key follows the INSTANCE, and that is a custody rule, not a
   * convenience.** This rung is the only thing in `scripts/` that spends money,
   * and until 2026-08-23 it read `ANTHROPIC_API_KEY` whichever database it was
   * pointed at — so a `--friend --llm` sweep of padhard's 32 cover-needed rows
   * would have been billed to the OWNER's Anthropic account for books in
   * Samantha's catalogue.
   *
   * `apps/worker/.dev.vars` lines 79–85 settle whose key pays: padhard's spend
   * goes on HER key, dropped into `ANTHROPIC_API_KEY_FRIEND_SAM`. The name is
   * printed on every run so the bill is never a surprise — the NAME only, never
   * the value.
   *
   * ⚠️ That drop-box line is deliberately BLANK most of the time: the runbook
   * (`docs/access/second-instance.md`) pastes a key in, pipes it to
   * `wrangler secret put ANTHROPIC_API_KEY --env friend`, then blanks the line
   * again. Her live Worker holds the key; a secret store cannot be read back.
   * So a `--friend --llm` run needs the owner to re-paste it first, and this
   * rung says exactly that rather than falling back to the main key.
   */
  /*
   * ⚠️ **`--llm-key-from=main` is the one sanctioned exception, and it changes
   * WHO PAYS — nothing else.** Owner decision 2026-08-23, for padhard's 15
   * remaining blanks: *"Run those 15 on MY key instead."* Both keys are on the
   * same Anthropic account, so on his account this is attribution rather than a
   * transfer of money; that is HIS statement about HIS billing, not something
   * this script can verify, and it is why the flag says the loud thing anyway.
   *
   * The default is untouched: with the flag absent, a `--friend` run reads
   * Samantha's key and refuses to fall back. The exception is only ever taken by
   * typing it out.
   */
  const defaultKeyName = flags.friend ? 'ANTHROPIC_API_KEY_FRIEND_SAM' : 'ANTHROPIC_API_KEY';
  const overridden = llmKeyFrom === 'main';
  const keyName = overridden ? 'ANTHROPIC_API_KEY' : defaultKeyName;
  const whose = overridden
    ? "the OWNER's key — billed to him, for padhard's books"
    : flags.friend
      ? "padhard — Samantha's own key"
      : "main instance — the owner's key";
  console.log(`  key in use: ${keyName}  (${whose})`);
  if (overridden) {
    console.log(
      `  ⚠️ OVERRIDE ACTIVE — --llm-key-from=main.\n` +
        `     This is a --friend run (${'library-catalog-2nd'}, padhard) and it is NOT using\n` +
        `     ${defaultKeyName}. Every cent below lands on ${keyName}.\n` +
        `     Without this flag the rung refuses to fall back; that default is unchanged.`,
    );
  }

  /*
   * ⚠️ **The paid call is gated on --commit — the dry pass NEVER spends.** The
   * key is not even read unless we are actually going to call Claude, so a dry
   * run cannot make a paid request by any path. Until 2026-08-24 the loop ran on
   * the dry pass too, so "dry then commit" was billed twice; --commit gated only
   * the SQL write, not the LLM call. `--llm-dry` is the explicit opt-in for a
   * paid preview (spends, writes nothing); it is OFF by default.
   */
  const spendAllowed = flags.commit || llmDry;
  const apiKey = spendAllowed ? readDevVar(keyName) : null;
  if (!spendAllowed) {
    console.log('');
    console.log(
      `  DRY RUN — the paid --llm rung is NOT called and nothing is spent.\n` +
        `     ${remaining.length} book(s) WOULD be asked, about $${worst} worst case on ${keyName}.\n` +
        `     Re-run with --commit to spend AND write, or --llm-dry for a paid preview that\n` +
        `     spends but writes nothing (OFF by default; each pass re-asks Claude, so a\n` +
        `     dry-then-commit workflow is TWO bills and the two passes differ).`,
    );
  } else if (!apiKey) {
    console.log(`  ⚠️ ${keyName} is empty or absent in apps/worker/.dev.vars — skipping this rung.`);
    if (overridden) {
      console.log(
        '     ⚠️ That is the OWNER\'s key missing, not the drop-box: --llm-key-from=main\n' +
          '     was passed, so ANTHROPIC_API_KEY is what was looked for. Nothing fell back\n' +
          '     to Samantha\'s key either — an override in one direction is not a licence\n' +
          '     to swap in the other.',
      );
    } else if (flags.friend) {
      console.log(
        '     That is the drop-box being blank, which is its resting state — not a\n' +
          '     misconfiguration. Paste her key after the `=` on that line, re-run, then\n' +
          '     blank it again. Runbook: docs/access/second-instance.md.\n' +
          '     ⚠️ Do NOT substitute ANTHROPIC_API_KEY here: that bills padhard to the owner.\n' +
          '     If that IS what is wanted, it is a decision and it has a flag that says so:\n' +
          '     --llm-key-from=main. Never a quiet edit of this line.',
      );
    }
  } else {
    for (const [i, r] of remaining.entries()) {
      const isbn = r.isbns ? String(r.isbns).split(' ')[0] : null;
      const n = `${String(i + 1).padStart(3)}/${remaining.length}`;
      let proposal;
      try {
        const out = await findCover(apiKey, { title: r.title, authors: r.authors, isbn });
        proposal = out.proposal;
        // ⚠️ Counted BEFORE anything is judged. A call that came back "not
        // found", or whose URL is about to be rejected, was still paid for —
        // a spend total that only counts successes understates the bill.
        spend.calls += 1;
        spend.cents += out.usage.estimatedCents;
        console.log(
          `${n} ${out.usage.estimatedCents.toFixed(2)}c tokens  ${r.title.slice(0, 40)}` +
            `  -> ${proposal.found ? `${proposal.confidence} conf` : 'not found'}`,
        );
      } catch (err) {
        // A throw may still have burned tokens (a timeout mid-stream does), but
        // `usage` never arrived — so it is counted as an error and NOT as 0c.
        spend.errors += 1;
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

      /*
       * ⚠️ **A low-confidence proposal is NOT written, however well it verifies.**
       *
       * `verifyCoverUrl` answers one question — "are these bytes an image, and
       * bigger than Open Library's 43-byte placeholder". It cannot answer the
       * one that matters here, which is whether they are an image of THIS book.
       * `confidence: 'low'` is the model saying it could not answer that either,
       * and the system prompt asks it to say so precisely because "the caller
       * shows low-confidence proposals to a person".
       *
       * Writing one anyway would be the worst shape available: a wrong cover
       * that passed every automated check, in a column nothing in this system
       * ever revisits. So it is held and printed with its URL and the model's
       * own note, and a person decides. The cover-needed count stays honest in
       * the meantime — the book is still counted as wanting one.
       */
      if (proposal.confidence === 'low') {
        llmLowConfidence.push({
          ...r,
          url: proposal.url,
          bytes: check.bytes,
          source: proposal.source ?? 'unknown',
          note: proposal.note,
        });
        console.log(`       ⚠️ LOW CONFIDENCE — held for the owner, not written: ${proposal.note}`);
        continue;
      }

      llmFound.push({ ...r, url: proposal.url, bytes: check.bytes, rung: 'llm' });
    }

    console.log('');
    console.log(
      `--llm: ${llmFound.length} written of ${remaining.length},` +
        ` ${llmLowConfidence.length} held for the owner (low confidence).`,
    );

    /*
     * ⚠️ The number on the owner's bill, summed from `usage` rather than from
     * COVER_CENTS_EACH. That constant is a list-price guess with no measured
     * sweep behind it; this is the measurement it asked for.
     * ⚠️ It counts TOKENS only. Server-side web search is billed separately at
     * $10/1,000 searches (up to 4 per call at the tool's max_uses), and does not
     * appear in `usage` — so the true figure is this plus up to 4c a call.
     */
    console.log(
      `--llm spend: ${spend.calls} call(s), ${spend.cents.toFixed(2)}c in tokens` +
        ` ($${(spend.cents / 100).toFixed(2)}) on ${keyName}` +
        (overridden ? ` (⚠️ --llm-key-from=main — padhard's books, the owner's key)` : '') +
        (spend.errors ? `, plus ${spend.errors} errored call(s) whose usage never arrived` : '') +
        `.\n   ⚠️ Tokens only. Add up to 4c per call for server-side web search,` +
        ` which is billed separately and is not in usage — so at most` +
        ` $${((spend.cents + spend.calls * 4) / 100).toFixed(2)} all in.`,
    );

    if (llmLowConfidence.length) {
      console.log('');
      console.log('⚠️ FOR THE OWNER — verified images the model would not vouch for.');
      console.log('   Nothing below was written. Each is a real, fetchable image of the');
      console.log('   right size; what is in doubt is whether it is the right BOOK.');
      for (const r of llmLowConfidence) {
        console.log('');
        console.log(`   ${r.id}  ${r.title}`);
        console.log(`     author  ${r.authors}`);
        console.log(`     url     ${r.url}`);
        console.log(`     source  ${r.source}  (${r.bytes}B)`);
        console.log(`     note    ${r.note}`);
      }
      console.log('');
      console.log('   To accept one: PUT /api/works/:id/cover (it re-verifies), or the');
      console.log('   cover control on the work page. To reject: do nothing.');
    }
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

/*
 * ⚠️ **A stand-in's two columns move in ONE statement, or the warning outlives
 * the cover it was about.**
 *
 * Migration 0040 pairs `cover_url` with `cover_status`, and `updateWork` in
 * `@lc/db` already enforces the pairing from the API side: a patch that moves
 * the url without naming a status sets the status to NULL, precisely so a
 * `'standin'` can never survive onto the image that replaced it. This script
 * writes SQL directly and so has to keep that promise itself.
 *
 * Two shapes, and the difference is what somebody has actually observed:
 *
 * - **Was a stand-in** → we knew the old image was wrong, we fetched and
 *   verified a replacement, so `cover_status = 'ok'` goes in the SAME UPDATE.
 *   Two statements would leave a window where the row wears a real cover and a
 *   stale warning, and a run killed between them makes that permanent.
 * - **Was blank** → status is left exactly as it was, i.e. NULL. §2.5 of
 *   `covers-and-series.md` is explicit: nothing is backfilled to `'ok'`, because
 *   'ok' means a PERSON looked, and nobody has. A machine-verified URL proves
 *   the bytes are an image, not that they are this book.
 *
 * ⚠️ The WHERE guard matches whichever set the row came from, so a row that
 * changed under us is skipped rather than overwritten — and a stand-in the
 * rungs could not beat is simply never named here. **It stays a stand-in. It is
 * never blanked**: a stand-in is information, and a blank is the absence of it.
 */
const statements = [...found, ...titleFound, ...llmFound].map((f) =>
  f.cover_status === 'standin'
    ? `UPDATE work SET cover_url = ${lit(f.url)}, cover_status = 'ok',` +
      ` updated_at = datetime('now')` +
      ` WHERE id = ${lit(f.id)} AND cover_status = 'standin';`
    : `UPDATE work SET cover_url = ${lit(f.url)}, updated_at = datetime('now')` +
      ` WHERE id = ${lit(f.id)} AND (cover_url IS NULL OR cover_url = '');`,
);

const replacedStandins = [...found, ...titleFound, ...llmFound].filter(
  (f) => f.cover_status === 'standin',
).length;

console.log(`\n${statements.length} statement(s) to run.`);
if (replacedStandins) {
  console.log(
    `  ${replacedStandins} of them replace a stand-in and pair cover_status = 'ok' in the same statement.`,
  );
}
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
const after = query(COUNTS, flags)[0];
console.log(
  `\nwrote ${statements.length}. ${after.works} work(s) — ${after.blank} with no cover` +
    ` (was ${total.blank}), ${after.standin} stand-in (was ${total.standin}),` +
    ` ${after.needed} cover-needed (was ${total.needed}).`,
);
/*
 * ⚠️ Check the number the RUN was about. With `--standins` the blank count and
 * the needed count move by different amounts — a replaced stand-in drops
 * `needed` and leaves `blank` alone — so asserting on blanks alone would print
 * a false alarm on exactly the runs this flag exists for.
 */
const movedBy = includeStandins
  ? Number(total.needed) - Number(after.needed)
  : Number(total.blank) - Number(after.blank);
if (movedBy !== statements.length) {
  console.log(
    `⚠️ ${statements.length} statement(s) ran but the count moved by ${movedBy}.` +
      ' That is not the arithmetic expected. Investigate before re-running.',
  );
}
