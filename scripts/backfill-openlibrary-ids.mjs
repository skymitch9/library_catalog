#!/usr/bin/env node
/**
 * Fill in `work.openlibrary_work_id` — and record, per work, what settled it.
 *
 * ## Why this column is worth the trouble
 *
 * It is **0 of 116**, and that single empty field is the documented blocker in
 * two places. `migrations/0003_series_completeness.sql` lists `openlibrary` as a
 * legal `series_volume.source` and then says *"No rows yet; no work here has an
 * openlibrary_work_id"*. `scripts/backfill-series-volumes.mjs` therefore has one
 * rung — the sibling audiobook catalog — which had never heard of 13 of this
 * library's 25 series. Open Library's `/works/<key>/editions.json` is the only
 * other free source of volume data this project has found, and it is reachable
 * only through this id.
 *
 * ## ⚠️ The bar, and why it is higher than a similarity score
 *
 * `docs/info/isbn-ladder.md` §4.4: Open Library answered "Firefight" + "Brandon
 * Sanderson" with a **different** book called Firefight — Random House, 2001 —
 * scoring **1.0 on title and 1.0 on author**. Nothing textual separated it from
 * the truth. Only the publisher and the year did.
 *
 * So a title+author agreement is the *entry ticket*, never the verdict. Every id
 * written here also has at least one fact about the printing agreeing:
 * `packages/core/src/corroboration.ts` holds that arithmetic and the reasoning.
 * Anything short of it is left empty and listed as an outlier for hand review,
 * because `docs/info/covers-and-series.md` §3.1 already settled the standing
 * rule: an empty field is correct where a guessed one is a lie that looks exactly
 * like data.
 *
 * ## The two rungs
 *
 * **Rung 1 — the file names itself.** `<dc:identifier>` inside the EPUB, when it
 * is a checksum-valid ISBN-13, resolved through `/isbn/<isbn>.json` to the
 * edition's work. This is not a search and does not have a search's failure mode.
 * ⚠️ It has its own: `isbn-ladder.md` §2 records three ISBNs that resolved
 * perfectly to entirely different books. So the answer is still checked against
 * the title, publisher, year and series we already hold, and an ISBN whose answer
 * agrees with none of them is an outlier rather than a match.
 *
 * **Rung 2 — fielded title+author search**, through `searchOpenLibrary` (which
 * applies `cleanAudiobookTitle` itself — measured 5/30 → 14/30, so do not
 * pre-clean). Survivors of `matching.ts`'s gates get their editions fetched and
 * corroborated.
 *
 * There is deliberately **no free-text rung**. §4.3 measured it buying one extra
 * hit with two wrong answers, one of them the wrong *volume* of the right series
 * — the single worst failure this catalog can have, and the last thing to invite
 * into a script that writes a column with nobody watching.
 *
 * ## The ledger: a miss is a first-class result
 *
 * `scripts/openlibrary-ids.json`, keyed on `work_key`, same convention as
 * `scripts/series-overrides.json` and for the same reason. It records
 * `not_found` — *searched, Open Library has nothing* — distinctly from absence,
 * which means nobody has looked. Half this library is genuinely not in Open
 * Library (§4.2), so most of this file is misses, and a session that cannot tell
 * a measured miss from an unasked question re-runs every dead end.
 *
 * ⚠️ **The ledger is written by a dry run too**, unlike the database. It is
 * research notes, not catalog state; the whole point of writing down a dead end
 * is that you did not have to commit anything to learn it. `--no-ledger` opts out.
 * A second run reads it, makes **zero** network calls and writes nothing.
 *
 * An entry with `"manual": true` is a person's answer and is never overwritten,
 * exactly as `series-overrides.json` outranks every automatic rung.
 *
 * ## Usage
 *
 *     npm run backfill:openlibrary-ids                       # dry run, local db
 *     npm run backfill:openlibrary-ids -- --remote           # dry run, production
 *     npm run backfill:openlibrary-ids -- --commit
 *     npm run backfill:openlibrary-ids -- --refresh          # re-ask about everything
 *     npm run backfill:openlibrary-ids -- --retry-misses     # re-ask only the not_founds
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { primaryAuthor, normaliseTitle } from '../packages/core/src/titles.ts';
import {
  titleSimilarity,
  MIN_TITLE_SIMILARITY,
  MIN_SPINE_SIMILARITY,
  MIN_AUTHOR_SIMILARITY,
} from '../packages/core/src/matching.ts';
import { corroborate } from '../packages/core/src/corroboration.ts';
import { searchOpenLibrary } from '../packages/isbn/src/search.ts';
import { editionsOfWork, workKeyForIsbn } from '../packages/isbn/src/works.ts';

import { execute, lit, parseFlags, query, ROOT } from './lib/d1.mjs';
import { readEpub } from './lib/epub.mjs';

const flags = parseFlags();
const REFRESH = process.argv.includes('--refresh');
const RETRY_MISSES = process.argv.includes('--retry-misses');
const NO_LEDGER = process.argv.includes('--no-ledger');
const FORCE = process.argv.includes('--force');
const EBOOK_ROOT = process.env.EBOOK_ROOT || 'C:/Users/nbasl/OpenAudible/books';
const LEDGER = path.join(ROOT, 'scripts/openlibrary-ids.json');
const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Open Library asks for a descriptive agent with a way to reach the operator,
 * and throttles anonymous bulk traffic. One request at a time with a pause
 * between is well inside anything it objects to, and this runs over 116 rows
 * once — there is nothing to optimise for.
 */
const USER_AGENT = 'library_catalog/0.1 (private household catalog; nbaslamking@gmail.com)';
const DELAY_MS = 700;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One call, paced, retrying only the status that means "slow down". */
async function polite(fn, what) {
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await fn();
      await sleep(DELAY_MS);
      return out;
    } catch (err) {
      const msg = String(err?.message ?? err);
      const retryable = /\b(429|502|503|504)\b/.test(msg) || /fetch failed|ETIMEDOUT|ECONNRESET/i.test(msg);
      if (!retryable || attempt >= 3) {
        await sleep(DELAY_MS);
        throw new Error(`${what}: ${msg}`);
      }
      const backoff = 2000 * 2 ** attempt;
      console.log(`    …${msg}; waiting ${backoff}ms`);
      await sleep(backoff);
    }
  }
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

const rawLedger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
/** "_" keys are the file's own documentation — the `series-overrides.json` convention. */
const docKeys = Object.fromEntries(Object.entries(rawLedger).filter(([k]) => k.startsWith('_')));
const ledger = Object.fromEntries(Object.entries(rawLedger).filter(([k]) => !k.startsWith('_')));

const LEDGER_DOC = {
  _doc:
    'What Open Library was asked about each work, and what it answered. Keyed on work.work_key, ' +
    'the same key scripts/series-overrides.json uses. Written by scripts/backfill-openlibrary-ids.mjs.',
  _why:
    'A miss is a result. docs/info/isbn-ladder.md §4.2 measured that roughly half this library is ' +
    'simply not in Open Library — Kindle Unlimited and Audible-native indie titles with no ISBN and ' +
    'no library record anywhere — so most of this file is misses and that is the expected outcome, ' +
    'not a shortfall. Absence from this file means nobody has looked; a "not_found" entry means ' +
    'somebody did. Only the second one is a reason to stop looking.',
  _verdict:
    'matched — an Open Library work key, corroborated beyond title+author, written to ' +
    'work.openlibrary_work_id. needs_review — a candidate exists and is recorded in `candidate`, ' +
    'but nothing about the printing agreed, so NOTHING is written and a person should look. ' +
    'not_found — searched, and no candidate cleared the title/author gate at all. ' +
    'ambiguous — two candidates corroborated and picking either would be a coin toss.',
  _bar:
    '⚠️ Title and author agreement is the entry ticket, never the verdict. isbn-ladder.md §4.4: a ' +
    'wrong book scored 1.0 on BOTH and only the publisher and year discriminated. Every "matched" ' +
    'entry therefore carries at least one strong corroborator, or two weak ones — see the table in ' +
    'packages/core/src/corroboration.ts.',
  _manual:
    'Set "manual": true on an entry a person settled by hand. Like series-overrides.json, a person\'s ' +
    'answer outranks every rung and is never overwritten by a re-run, not even by --refresh.',
  _rerun:
    'A second run reads this file, makes zero network calls and writes nothing. --refresh re-asks ' +
    'about everything; --retry-misses re-asks only the not_found rows, which is the one worth ' +
    'repeating occasionally because Open Library gains records over time.',
};

// ---------------------------------------------------------------------------
// What we hold
// ---------------------------------------------------------------------------

const works = query(
  `SELECT w.id, w.title, w.authors, w.work_key, w.series, w.series_index_sort,
          w.series_index_display, w.openlibrary_work_id,
          (SELECT e.source_url FROM edition e
            WHERE e.work_id = w.id AND e.source_url IS NOT NULL
            ORDER BY e.id LIMIT 1) AS source_url
     FROM work w
    ORDER BY w.id`,
  flags,
);

console.log(`${works.length} work(s) in the ${flags.remote ? 'REMOTE' : 'local'} database`);
if (works.length === 0) process.exit(0);

const BACKSLASH = String.fromCharCode(92);

/**
 * Every .epub under the ebook root, by filename, built once and only if needed.
 *
 * ⚠️ This exists because `source_url` is not the same shape in both databases.
 * Production stores `Author Folder/Title.epub`; the local dev database — built by
 * an earlier run of the importer — stores the bare filename. Resolving only the
 * stored path meant every EPUB lookup failed locally, and the failure was
 * **silent**: `fileFacts` returned `{}`, every publisher and year discriminator
 * vanished, and the first smoke run rejected a correct Thomas & Mercer match as
 * "corroborated by NOTHING". That is the same silent-staleness shape
 * `scripts/lib/d1.mjs` warns about for `--file` reads, and it is worth a walk of
 * a few hundred directories to make impossible.
 */
let basenameIndex = null;
function basenames() {
  if (basenameIndex) return basenameIndex;
  basenameIndex = new Map();
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let items = [];
    try {
      items = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      const full = path.join(dir, it.name);
      if (it.isDirectory()) walk(full, depth + 1);
      else if (it.name.toLowerCase().endsWith('.epub') && !basenameIndex.has(it.name)) {
        basenameIndex.set(it.name, full);
      }
    }
  };
  if (existsSync(EBOOK_ROOT)) walk(EBOOK_ROOT, 0);
  return basenameIndex;
}

/**
 * What the file on disk knows that the catalog does not.
 *
 * `covers-and-series.md` §1's lesson, applied to a different column: these rows
 * have a title, an author and a path, and **0 of 116 carry a `first_published`
 * or an ISBN in the database**. The EPUB carries a publisher on 111 of them, a
 * year on 108 and a checksum-valid ISBN-13 on 24 — which is to say the only
 * discriminators §4.4 leaves us exist solely inside the files.
 */
const noFile = [];
function fileFacts(work) {
  const rel = String(work.source_url ?? '').split(BACKSLASH).join('/');
  let file = rel ? path.join(EBOOK_ROOT, rel) : null;
  if (!file || !existsSync(file)) {
    file = basenames().get(path.basename(rel)) ?? null;
  }
  if (!file) {
    noFile.push(work.title);
    return {};
  }
  try {
    const e = readEpub(file, { cover: false });
    return {
      publisher: e?.publisher ?? null,
      year: e?.year ?? null,
      isbn13: e?.isbn13 ?? null,
      epubTitle: e?.title ?? null,
    };
  } catch {
    noFile.push(work.title);
    return {};
  }
}

/** Flatten a work's editions into the facts `corroborate` compares against. */
function factsFromEditions(editions, searchDoc) {
  const seriesStrings = [];
  const publishers = [];
  const years = [];
  const isbn13s = [];
  for (const e of editions) {
    for (const s of e.series) if (s) seriesStrings.push(s);
    // ⚠️ `subtitle` is not decoration here. covers-and-series.md §3.1: Hidden
    // Gnome files the volume number in it — "Ghostwater" :: "Cradle, Volume
    // Five" — on more editions than it uses the `series` field at all.
    if (e.subtitle) seriesStrings.push(e.subtitle);
    // ⚠️ The edition TITLE is deliberately not in this pool, and the first run
    // is why. "What If Everybody Said That?" is filed here under the series
    // "What If Everybody?", so the series corroborator fired against the book's
    // own title and reported `an edition is labelled "What if everybody said
    // that?" — our series`. That is the title match restated in the voice of an
    // independent one, which is the single thing this whole module exists to
    // refuse. A corroborator has to be evidence the title did not already give.
    for (const p of e.publishers) if (p) publishers.push(p);
    if (e.year != null) years.push(e.year);
    for (const i of e.isbn13) if (i) isbn13s.push(i);
  }
  if (searchDoc?.publisher) publishers.push(searchDoc.publisher);
  if (searchDoc?.publishedYear != null) years.push(searchDoc.publishedYear);
  return {
    seriesStrings: [...new Set(seriesStrings)],
    publishers: [...new Set(publishers)],
    years: [...new Set(years)],
    isbn13s: [...new Set(isbn13s)],
  };
}

/** Best title agreement between what we call it and anything the OL work is called. */
function bestTitleSimilarity(ourTitle, candidateTitles) {
  let best = 0;
  for (const t of candidateTitles) {
    if (!t) continue;
    best = Math.max(best, titleSimilarity(normaliseTitle(t), normaliseTitle(ourTitle)));
  }
  return best;
}

// ---------------------------------------------------------------------------
// The two rungs, per work
// ---------------------------------------------------------------------------

/**
 * Rung 1 — an ISBN the file states about itself.
 *
 * Returns null when the file has no ISBN or Open Library has never seen that
 * printing (a 404 here is a real answer, and a common one for the Japanese
 * light-novel originals whose fan translations this library holds).
 */
async function rungIsbn(work, ours) {
  if (!ours.isbn13) return null;

  const hit = await polite(
    () => workKeyForIsbn(ours.isbn13, { userAgent: USER_AGENT }),
    `isbn ${ours.isbn13}`,
  );
  if (!hit?.workKey) return null;

  const editions = await polite(
    () => editionsOfWork(hit.workKey, { userAgent: USER_AGENT }),
    `editions ${hit.workKey}`,
  ).catch(() => []);

  const all = editions.length ? editions : hit.edition ? [hit.edition] : [];
  const theirs = factsFromEditions(all, null);
  // ⚠️ `isbn13` is deliberately withheld from the comparison. We found this work
  // *by* that ISBN, so "the ISBN matches" would be the question restated as its
  // own answer. What has to agree is something the ISBN did not already assert.
  const c = corroborate({ ...ours, isbn13: null }, theirs);

  const titles = [hit.edition?.title, ...all.map((e) => e.title)];
  const titleSim = bestTitleSimilarity(work.title, titles);
  const titleAgrees = titleSim >= MIN_TITLE_SIMILARITY;

  return {
    via: 'isbn',
    workKey: hit.workKey,
    olTitle: hit.edition?.title ?? null,
    editionKey: hit.editionKey,
    titleSimilarity: Number(titleSim.toFixed(3)),
    authorSimilarity: null,
    corroboration: [...c.strong, ...c.weak, ...(titleAgrees ? ['title'] : [])],
    evidence: [
      `ISBN ${ours.isbn13} read from the EPUB's <dc:identifier> resolves to edition ${hit.editionKey}`,
      ...c.evidence,
      titleAgrees
        ? `Open Library calls it "${hit.edition?.title ?? '?'}" (title similarity ${titleSim.toFixed(2)})`
        : `⚠️ nothing textual agrees: Open Library calls it "${hit.edition?.title ?? '?'}"`,
    ],
    // An identifier the artefact states about itself is stronger evidence than
    // any search result — but on its own it is still only the file's word. It
    // becomes a match when something the ISBN did not assert agrees too.
    confidence: c.strong.length >= 1 || titleAgrees || c.weak.length >= 2 ? 'high' : 'none',
    editions: all.length,
  };
}

/** Rung 2 — fielded search, gated, then corroborated one candidate at a time. */
async function rungSearch(work, ours) {
  const found = await polite(
    () => searchOpenLibrary(work.title, primaryAuthor(work.authors), { userAgent: USER_AGENT }),
    `search "${work.title}"`,
  ).catch(() => []);

  // The gates from `matching.ts`, unchanged and unduplicated. The SPINE floor,
  // not the friendlier one: nobody is confirming these, so this is the "matched
  // without anyone looking" case that floor exists for.
  const gated = found
    .map((c) => ({
      c,
      ts: titleSimilarity(normaliseTitle(c.title), normaliseTitle(work.title)),
      as: titleSimilarity(
        normaliseTitle(primaryAuthor(c.authors)),
        normaliseTitle(primaryAuthor(work.authors)),
      ),
    }))
    .filter((x) => x.ts >= MIN_SPINE_SIMILARITY && x.as >= MIN_AUTHOR_SIMILARITY)
    .sort((a, b) => b.ts - a.ts)
    // Three is every candidate worth an editions call; `searchOpenLibrary` only
    // asks for five and anything below the top three has already lost on title.
    .slice(0, 3);

  const scored = [];
  for (const x of gated) {
    if (!x.c.openlibraryWorkId) continue;
    const editions = await polite(
      () => editionsOfWork(x.c.openlibraryWorkId, { userAgent: USER_AGENT }),
      `editions ${x.c.openlibraryWorkId}`,
    ).catch(() => []);
    const theirs = factsFromEditions(editions, x.c);
    const cor = corroborate(ours, theirs);
    scored.push({
      via: 'search',
      workKey: x.c.openlibraryWorkId,
      olTitle: x.c.title,
      olAuthors: x.c.authors,
      editionKey: null,
      titleSimilarity: Number(x.ts.toFixed(3)),
      authorSimilarity: Number(x.as.toFixed(3)),
      strong: cor.strong,
      weak: cor.weak,
      corroboration: [...cor.strong, ...cor.weak],
      evidence: [
        `fielded search matched "${x.c.title}" by ${x.c.authors}` +
          ` (title ${x.ts.toFixed(2)}, author ${x.as.toFixed(2)})`,
        ...cor.evidence,
      ],
      confidence: cor.confidence,
      editions: editions.length,
      // Kept so the report can name what was rejected and why — the most useful
      // lines in it, per isbn-ladder.md §4.4.
      olPublisher: x.c.publisher,
      olYear: x.c.publishedYear,
    });
  }
  return { gatedCount: gated.length, searched: found.length, scored };
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

const stats = { cached: 0, isbn: 0, search: 0, review: 0, notFound: 0, ambiguous: 0, skipped: 0 };
const outliers = [];
const rejected = [];
const contested = [];
const matched = [];
let touchedLedger = false;

let n = 0;
for (const w of works) {
  if (n >= flags.limit) break;

  const prior = ledger[w.work_key];
  if (prior?.manual) {
    stats.cached++;
    if (prior.olid) matched.push({ ...w, olid: prior.olid, via: 'manual', confidence: 'high' });
    continue;
  }
  const staleMiss = RETRY_MISSES && prior?.verdict === 'not_found';
  if (prior && !REFRESH && !staleMiss) {
    stats.cached++;
    if (prior.verdict === 'matched' && prior.olid) {
      matched.push({ ...w, olid: prior.olid, via: prior.via, confidence: prior.confidence });
    } else if (prior.verdict === 'not_found') {
      stats.notFound++;
    } else {
      stats.review++;
      outliers.push({ work: w, entry: prior });
    }
    continue;
  }

  n++;
  const ff = fileFacts(w);
  const ours = {
    series: w.series ?? null,
    volume: w.series_index_sort ?? null,
    publisher: ff.publisher ?? null,
    year: ff.year ?? null,
    isbn13: ff.isbn13 ?? null,
  };

  process.stdout.write(`[${String(n).padStart(3)}] ${w.title.slice(0, 52).padEnd(52)} `);

  let entry = null;

  const byIsbn = await rungIsbn(w, ours).catch((e) => {
    console.log(`\n    isbn rung failed: ${e.message}`);
    return null;
  });

  if (byIsbn && byIsbn.confidence === 'high') {
    entry = {
      olid: byIsbn.workKey,
      verdict: 'matched',
      confidence: 'high',
      via: 'isbn',
      corroboration: byIsbn.corroboration,
      evidence: byIsbn.evidence,
      source: [
        `https://openlibrary.org/works/${byIsbn.workKey}`,
        `EPUB <dc:identifier> ISBN ${ours.isbn13}`,
      ],
      searched_at: TODAY,
    };
    stats.isbn++;
    console.log(`isbn -> ${byIsbn.workKey}`);
  } else if (byIsbn) {
    entry = {
      olid: null,
      candidate: byIsbn.workKey,
      verdict: 'needs_review',
      confidence: 'none',
      via: 'isbn',
      corroboration: byIsbn.corroboration,
      evidence: byIsbn.evidence,
      source: [
        `https://openlibrary.org/works/${byIsbn.workKey}`,
        `EPUB <dc:identifier> ISBN ${ours.isbn13}`,
      ],
      searched_at: TODAY,
      note: 'The ISBN resolved, but nothing we hold independently agrees with what it resolved to.',
    };
  }

  if (!entry || entry.verdict !== 'matched') {
    const { scored, searched, gatedCount } = await rungSearch(w, ours).catch((e) => {
      console.log(`\n    search rung failed: ${e.message}`);
      return { scored: [], searched: 0, gatedCount: 0 };
    });

    // ⚠️ Open Library holds genuine duplicate work records for the same book —
    // two "Blackflame" works, both Will Wight, both real. When two candidates
    // both corroborate, the one with *strictly more* evidence agreeing wins, and
    // the runner-up is written into the evidence so the choice is auditable. A
    // true tie is NOT broken: edition count and record age are properties of
    // Open Library's housekeeping, not of which book we own, and using them
    // would be inventing a discriminator. A tie is an outlier.
    const high = scored
      .filter((s) => s.confidence === 'high')
      .sort((a, b) => b.strong.length - a.strong.length || b.corroboration.length - a.corroboration.length);
    const tied =
      high.length > 1 &&
      high[0].strong.length === high[1].strong.length &&
      high[0].corroboration.length === high[1].corroboration.length;

    for (const s of scored) {
      if (s.confidence !== 'high') rejected.push({ work: w, cand: s });
    }

    if (high.length >= 1 && !tied) {
      const s = high[0];
      if (high.length > 1) {
        contested.push({ work: w, winner: s, losers: high.slice(1) });
        s.evidence.push(
          `chosen over ${high.length - 1} other corroborating record(s) — ` +
            high.slice(1).map((o) => `${o.workKey} [${o.corroboration.join(', ') || 'nothing'}]`).join('; ') +
            ' — on strictly more agreeing evidence',
        );
      }
      entry = {
        olid: s.workKey,
        verdict: 'matched',
        confidence: 'high',
        via: 'search',
        corroboration: s.corroboration,
        evidence: s.evidence,
        source: [`https://openlibrary.org/works/${s.workKey}`],
        searched_at: TODAY,
      };
      stats.search++;
      console.log(`search -> ${s.workKey}  [${s.corroboration.join(', ')}]`);
    } else if (high.length > 1) {
      entry = {
        olid: null,
        verdict: 'ambiguous',
        confidence: 'none',
        via: 'search',
        candidates: high.map((s) => ({ olid: s.workKey, title: s.olTitle, corroboration: s.corroboration })),
        evidence: high.flatMap((s) => s.evidence),
        source: high.map((s) => `https://openlibrary.org/works/${s.workKey}`),
        searched_at: TODAY,
        note:
          'Two or more candidates corroborated with exactly the same weight of evidence. ' +
          'Nothing here distinguishes them, so picking one would be a coin toss dressed as a match.',
      };
      stats.ambiguous++;
      console.log('AMBIGUOUS');
    } else if (!entry) {
      const best = scored[0] ?? null;
      if (best) {
        entry = {
          olid: null,
          candidate: best.workKey,
          verdict: 'needs_review',
          confidence: best.confidence,
          via: 'search',
          corroboration: best.corroboration,
          evidence: best.evidence,
          source: [`https://openlibrary.org/works/${best.workKey}`],
          searched_at: TODAY,
          note:
            best.corroboration.length === 0
              ? 'Title and author agree and NOTHING else does. isbn-ladder.md §4.4 is exactly this shape.'
              : 'One weak corroborator only. Not enough to write unattended.',
        };
        console.log(`review (${best.confidence}) ${best.workKey}`);
      } else {
        entry = {
          olid: null,
          verdict: 'not_found',
          confidence: null,
          via: 'search',
          evidence: [
            `fielded search returned ${searched} result(s), ${gatedCount} of which cleared the` +
              ` title ≥ ${MIN_SPINE_SIMILARITY} / author ≥ ${MIN_AUTHOR_SIMILARITY} gate`,
          ],
          source: [
            'https://openlibrary.org/search.json?title=' + encodeURIComponent(w.title) +
              '&author=' + encodeURIComponent(primaryAuthor(w.authors)),
          ],
          searched_at: TODAY,
        };
        stats.notFound++;
        console.log('not found');
      }
    } else {
      console.log(`review (isbn, uncorroborated) ${entry.candidate}`);
    }
  }

  if (entry.verdict === 'matched') {
    matched.push({ ...w, olid: entry.olid, via: entry.via, confidence: entry.confidence });
  } else if (entry.verdict !== 'not_found') {
    stats.review++;
    outliers.push({ work: w, entry });
  }

  ledger[w.work_key] = entry;
  touchedLedger = true;
}

// ---------------------------------------------------------------------------
// ⚠️ Two works must never claim one Open Library work.
//
// `idx_work_ol` in migration 0001 is a UNIQUE partial index, so a collision is a
// failed statement rather than a silent merge — but a failed batch tells you
// nothing about which two rows collided. Catch it here, drop BOTH, and name them:
// a collision means one of the two matches is wrong and there is no way to tell
// which from this side.
// ---------------------------------------------------------------------------

const byOlid = new Map();
for (const m of matched) {
  const list = byOlid.get(m.olid);
  if (list) list.push(m);
  else byOlid.set(m.olid, [m]);
}
const collisions = [...byOlid.values()].filter((l) => l.length > 1);
const collided = new Set();
for (const group of collisions) {
  // A person's answer wins the collision outright — same rule as everywhere
  // else here and in `series-overrides.json`. Only when nobody has ruled does
  // the whole group get dropped.
  const settled = group.filter((m) => ledger[m.work_key]?.manual);
  const losers = settled.length === 1 ? group.filter((m) => m !== settled[0]) : group;

  for (const m of losers) {
    const e = ledger[m.work_key];
    if (!e) continue;
    collided.add(m.id);
    e.olid = null;
    e.candidate = m.olid;
    e.verdict = 'ambiguous';
    e.note =
      `${group.length} works in this catalog resolved to ${m.olid} — ` +
      group.map((g) => `"${g.title}"`).join(', ') +
      (settled.length === 1
        ? `. "${settled[0].title}" is the hand-settled one and keeps it.`
        : '. At most one can be right and nothing here says which.');
    outliers.push({ work: m, entry: e });
  }
  touchedLedger = true;
}
const writable = matched.filter((m) => !collided.has(m.id));

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const searchedThisRun = n;
console.log('');
console.log('---------------------------------------------------------------');
console.log(`works                       ${works.length}`);
console.log(`searched this run           ${searchedThisRun}`);
console.log(`answered from the ledger    ${stats.cached}`);
console.log('');
// ⚠️ Say this loudly. With no readable EPUB there is no publisher, no year and
// no ISBN, which is to say NONE of the discriminators §4.4 requires — so those
// works cannot clear the bar however good their title and author look, and the
// hit rate would quietly read as "Open Library does not have them" instead of
// "we could not check".
if (noFile.length) {
  console.log(
    `⚠️  ${noFile.length} work(s) had no readable EPUB, so publisher/year/ISBN could not be` +
      ' checked for them at all:',
  );
  for (const t of noFile) console.log(`      ${t}`);
  console.log('');
}
// Counted off the ledger rather than off this run's counters, so a second run —
// which searches nothing — still reports the true standing totals instead of
// three zeroes that read like a regression.
const viaCount = (via) => writable.filter((m) => ledger[m.work_key]?.via === via).length;
console.log(`matched via the file's ISBN ${viaCount('isbn')}`);
console.log(`matched via search          ${viaCount('search')}`);
console.log(`settled by hand             ${viaCount('manual')}`);
console.log(`searched, NOT FOUND         ${
  Object.values(ledger).filter((e) => e.verdict === 'not_found').length}`);
console.log(`outliers for hand review    ${outliers.length}`);
console.log('');
console.log(`${writable.length} of ${works.length} work(s) have a corroborated Open Library id` +
  `  (${((100 * writable.length) / works.length).toFixed(0)}%)`);

// ⚠️ Read the values, not the totals — backfill-series.mjs's rule, and the review
// backfill's 860/860 dry run that was writing unmatchable keys is why it exists.
const byCorroborator = new Map();
for (const m of writable) {
  const e = ledger[m.work_key];
  // ⚠️ The ISBN rung's identification is named here even though it is not in the
  // stored `corroboration` array — that array deliberately excludes the ISBN
  // because we found the work *by* it and it cannot corroborate itself. Leaving
  // it out of the report too would print lines like "5 matched by: title", which
  // reads as exactly the title-only match this whole script refuses to make.
  const parts = e?.via === 'isbn' ? ['isbn(file)', ...(e.corroboration ?? [])] : e?.corroboration ?? [];
  const label = parts.join(' + ') || '(none recorded)';
  byCorroborator.set(label, (byCorroborator.get(label) ?? 0) + 1);
}
console.log('');
console.log('how each match was corroborated:');
for (const [label, count] of [...byCorroborator].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ${label}`);
}

if (contested.length) {
  console.log('');
  console.log('CONTESTED — more than one Open Library record corroborated; the winner had strictly more:');
  for (const c of contested) {
    console.log(`  "${c.work.title}"`);
    console.log(`      won  ${c.winner.workKey} "${c.winner.olTitle}" [${c.winner.corroboration.join(', ')}]`);
    for (const l of c.losers) {
      console.log(`      lost ${l.workKey} "${l.olTitle}" [${l.corroboration.join(', ')}]`);
    }
  }
}

if (rejected.length) {
  console.log('');
  console.log('CANDIDATES REJECTED despite clearing the title+author gate:');
  for (const r of rejected) {
    console.log(
      `  "${r.work.title}" -/-> ${r.cand.workKey} "${r.cand.olTitle}"` +
        ` (title ${r.cand.titleSimilarity}, author ${r.cand.authorSimilarity})`,
    );
    console.log(
      `        ${r.cand.olPublisher ?? 'no publisher'}, ${r.cand.olYear ?? 'no year'};` +
        ` corroborated by: ${r.cand.corroboration.join(', ') || 'NOTHING'}`,
    );
  }
}

if (outliers.length) {
  console.log('');
  console.log('OUTLIERS — for hand review:');
  for (const o of outliers) {
    console.log(`  [${o.entry.verdict}] ${o.work.title} — ${o.work.authors}`);
    if (o.entry.candidate) console.log(`        candidate ${o.entry.candidate}`);
    if (o.entry.note) console.log(`        ${o.entry.note}`);
  }
}

// ---------------------------------------------------------------------------

if (touchedLedger && !NO_LEDGER) {
  const sorted = Object.fromEntries(Object.entries(ledger).sort((a, b) => a[0].localeCompare(b[0])));
  writeFileSync(LEDGER, JSON.stringify({ ...LEDGER_DOC, ...docKeys, ...sorted }, null, 2) + '\n', 'utf8');
  console.log('');
  console.log(`ledger written: scripts/openlibrary-ids.json (${Object.keys(sorted).length} entries)`);
} else if (touchedLedger) {
  console.log('\n--no-ledger: the run\'s findings were NOT recorded.');
}

const updates = writable.filter((m) => FORCE || m.openlibrary_work_id !== m.olid);
console.log('');
console.log(`${updates.length} row(s) to update`);
if (updates.length === 0) process.exit(0);

if (!flags.commit) {
  for (const u of updates) console.log(`  ${u.title}  ->  ${u.olid}  (${u.via})`);
  console.log('\nDRY RUN. Nothing written to the database. Re-run with --commit.');
  process.exit(0);
}

const sent = execute(
  updates.map(
    (u) =>
      `UPDATE work SET openlibrary_work_id = ${lit(u.olid)}, updated_at = datetime('now')` +
      ` WHERE id = ${lit(u.id)};`,
  ),
  flags,
);

// Confirm by re-reading. `execute` cannot report rows changed — miniflare omits
// `meta.changes` entirely, so a run that wrote 114 reported 0.
const after = query(
  `SELECT COUNT(*) AS total, COUNT(openlibrary_work_id) AS with_ol,
          COUNT(DISTINCT openlibrary_work_id) AS distinct_ol
     FROM work`,
  flags,
)[0];
console.log(
  `\n${sent} statement(s) run. ${after.with_ol} of ${after.total} work(s) now carry one of` +
    ` ${after.distinct_ol} distinct Open Library ids in the` +
    ` ${flags.remote ? 'REMOTE' : 'local'} database.`,
);
