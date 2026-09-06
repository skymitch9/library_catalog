#!/usr/bin/env node
/**
 * Give every edition an ISBN, by searching title+author across free sources
 * and an optional paid LLM fallback.
 *
 * ## The problem this solves
 *
 * 181 of 450 works have no ISBN on any edition. Breakdown:
 *   - Mainstream titles imported from OpenAudible without ISBNs (Sarah J. Maas,
 *     Brandon Sanderson, etc.) — these exist in ISBN databases.
 *   - LitRPG / self-pub (Honour Rae, Selkie Myth, etc.) — many are
 *     Audible-exclusive and genuinely have no print ISBN. The LLM rung will
 *     confirm "not found" for these, which is the correct answer.
 *
 * ## The rungs
 *
 * 1. Open Library title+author fielded search — returns ISBNs from all editions
 *    of the matching work. Free, 1 req/sec rate limit.
 * 2. Google Books title+author search — returns ISBN_13 on the volume. Free with
 *    API key (anonymous is 429'd).
 * 2.5. LibraryThing thingTitle API — returns ISBNs for a title match. Free with
 *    API key, 1000 req/day rate limit.
 * 3. --llm: Claude Opus 5 with web search — ~6c/book. Finds ISBNs for obscure
 *    titles the free rungs miss.
 *
 * ## Usage
 *
 *     npm run backfill:missing-isbns                      # dry run, local
 *     npm run backfill:missing-isbns -- --remote          # dry run, production
 *     npm run backfill:missing-isbns -- --remote --commit # apply
 *     npm run backfill:missing-isbns -- --remote --llm    # with paid rung
 *     npm run backfill:missing-isbns -- --remote --llm --commit
 *     npm run backfill:missing-isbns -- --remote --llm --ignore-policy  # spend despite a switched-off feature
 *
 * ## ⚠️ The spending gate (L10)
 *
 * `--llm` is the only rung here that spends, so a `--llm` run asks the estate
 * whether this catalogue's ISBN rung is switched off (`cli.backfill` /
 * `research.isbn` — see `lib/billing-cli.mjs`). If it is, the run stops before
 * the first free call and says so. `--ignore-policy` goes through anyway: a
 * guard with a deliberate escape hatch, never a CLI that refuses its operator.
 *
 * ## Safety
 *
 * - ISBN-13 check digits are validated before any write.
 * - Title similarity gate (>=0.80) prevents filing the wrong book's ISBN —
 *   ⚠️ on rungs 1 and 2 only. Rung 2.5 (LibraryThing) is the EXCEPTION and
 *   cannot be gated: measured live 2026-08-24, its thingTitle response returns
 *   no per-item title or author (the title is "omitted per vendor terms"), so
 *   there is nothing to compare our query against. It is therefore the LOWEST
 *   trust free rung, tried LAST (only when rungs 1 and 2 both missed), still
 *   guarded by the ISBN-13 checksum and the UNIQUE-constraint check below, and
 *   its writes are stamped source='librarything' so a wrong match is findable
 *   and revertable. Whether to keep an ungated rung at all is an owner call;
 *   this code makes its provenance honest rather than hiding it as 'openlibrary'.
 * - A UNIQUE constraint on edition.isbn13 means a duplicate is a hard failure
 *   caught here, never a silent corruption.
 * - Dry run by default. Nothing written without --commit.
 * - Every write targets the FIRST edition of the work (the one the owner
 *   interacts with). If it already carries an isbn13 somehow, the work is
 *   skipped rather than overwritten.
 * - 🔴 **A LANGUAGE GATE on every free rung**, 🔴 **a refusal to fill a row
 *   that says it has no ISBN**, and 🔴 **a refusal to fill a crowdfunded printing
 *   the owner holds** — all added 2026-09-05 after the 2026-08-20 run was
 *   audited. See "The two guards the 2026-08-20 run did not have" below.
 * - 🔴 **Every write logs a `change_log` row per changed field.** It did not
 *   before, which is why the 2026-08-20 run left no trace at all and had to be
 *   reconstructed from `updated_at` and three stdout logs at the repo root.
 *
 * ## 🔴 The two guards the 2026-08-20 run did not have (measured 2026-09-05)
 *
 * That run filled **43 editions** on the main instance, and **42 of them were
 * special printings** — Kickstarter exclusives, leatherbounds, subscription-box
 * hardcovers, volumes of slipcase sets. That is not bad luck: `CANDIDATES_SQL`
 * asks for works with no ISBN on ANY edition, and on this catalogue those are
 * precisely the crowdfunded and exclusive ones, whose oldest edition row IS the
 * special printing. **12 of the 43 got an ISBN belonging to a different object**
 * — French, Polish, German, Catalan, Spanish and Turkish translations, two
 * audiobook ISBNs, and one trade hardcover filed onto a leatherbound whose own
 * `edition_name` names the two real ISBNs.
 *
 *   1. **`declaresNoIsbn`** — a row whose `edition_name` or `note` states that no
 *      ISBN exists is not a gap. `isbn13 IS NULL` there is a recorded FACT, and
 *      the old `AND isbn13 IS NULL` guard cannot tell the two apart.
 *   1b. 🔴 **`isCrowdfundedPrinting`** — added 2026-09-05 **18:29 Phoenix** on the
 *      owner's ruling, verbatim: *"For the kickstarters we have in stock the ISBNs
 *      are recorded if they exist."* On a crowdfunded / collector's / exclusive
 *      printing he holds, an absent ISBN is a **measured absence**: he records it
 *      at entry when the object has one. ⚠️ This is an explicit WIDENING of guard
 *      1, which is deliberately narrow and stays narrow — the two make different
 *      claims and are two functions on purpose.
 *   2. **`isbnLanguageVerdict`** — rung 1 reads `doc.isbn`, *"an array of ALL
 *      isbns from all editions of this work"*, and the title gate scores the
 *      **work's** title, so a translation passes at `sim 1.00`. Every candidate
 *      is now checked against the printing's own attested language (Open Library
 *      `/isbn/<isbn>.json`, or Google Books' `volumeInfo.language`) and, failing
 *      that, its ISBN registration group.
 *
 * Full write-up, with the per-row table: `docs/info/isbn-ladder.md` §7.
 *
 * ⚠️ ORDER: a --commit run that finds via LibraryThing writes source=
 * 'librarything', which migration 0420 must have added to the edition.source
 * CHECK first. Apply migrations before committing, or the write aborts.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { execute, lit, parseFlags, query, ROOT } from './lib/d1.mjs';
import {
  declaresNoIsbn,
  editionSourceWriteExpr,
  isCrowdfundedPrinting,
  isbnLanguageVerdict,
  llmKeyName,
  readLlmKeyFrom,
} from './lib/backfill-safety.mjs';
import { CLI_FEATURE_SETS, checkCliBilling } from './lib/billing-cli.mjs';
import { parseThingTitleIsbns } from './lib/librarything.mjs';
import { titleSimilarity } from '../packages/core/src/matching.ts';
import { normaliseTitle, cleanAudiobookTitle } from '../packages/core/src/titles.ts';

const flags = parseFlags();
const useLlm = process.argv.includes('--llm');
const llmKeyFrom = readLlmKeyFrom(process.argv);

/**
 * ⚠️ **THE SPENDING GATE — L10, billing design §9 Q5.** Asked before the free
 * rungs run, so a run the owner has switched off costs nothing and stops at
 * once rather than after several minutes of rate-limited Open Library calls.
 *
 * Only `--llm` spends here, so only `--llm` is gated; every free run behaves
 * exactly as it did before this gate existed.
 *
 * ⚠️ L10 is under TWO switches, `cli.backfill` and `research.isbn` — a path
 * under two switches is refused if EITHER denies, and that double cover is
 * deliberate and pinned upstream. `--ignore-policy` always goes through.
 */
if (useLlm) {
  const gate = await checkCliBilling({
    friend: flags.friend,
    features: CLI_FEATURE_SETS.isbns,
    label: 'ISBN backfill (LLM rung)',
  });
  if (gate.blocked) process.exit(1);
}

const UA = 'library_catalog (+https://github.com/private)';
const PAUSE_MS = 1100; // Open Library asks for ~1 req/sec
/**
 * How many of a work's ISBNs the language gate will probe before giving up on
 * the rung. A popular work can list forty printings; probing all of them costs
 * forty rate-limited round trips to find an English one that the next rung would
 * have answered for free. Five is enough to get past a run of translations and
 * cheap enough not to matter.
 */
const MAX_LANGUAGE_PROBES = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Keys from .dev.vars
// ---------------------------------------------------------------------------

function readDevVar(name) {
  const file = path.join(ROOT, 'apps/worker/.dev.vars');
  if (!existsSync(file)) return undefined;
  const m = new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm').exec(
    readFileSync(file, 'utf8'),
  );
  return m?.[1]?.trim() || undefined;
}

const googleKey = readDevVar('GOOGLE_BOOKS_API_KEY');
console.log(googleKey ? 'Google Books key: present (rung 2 active)' : '⚠️ Google Books key: MISSING — rung 2 skipped.');

const ltKey = readDevVar('LIBRARYTHING_API_KEY');
console.log(ltKey ? 'LibraryThing key: present (rung 2.5 active)' : '⚠️ LibraryThing key: MISSING — rung 2.5 skipped.');

// ---------------------------------------------------------------------------
// ISBN-13 validation
// ---------------------------------------------------------------------------

function isValidIsbn13(isbn) {
  if (!/^97[89]\d{10}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(isbn[12]);
}

/**
 * Every valid ISBN-13 in a list of raw ISBN strings (13s first, then converted
 * 10s), in order.
 *
 * ⚠️ This used to be `pickBestIsbn13`, returning the FIRST one. That single line
 * is how a French and a Polish printing were filed onto English hardcovers: the
 * list it is given is Open Library's work-level `doc.isbn`, every printing in
 * every language, in no particular order. The caller now walks the list and
 * keeps the first candidate that survives the language gate.
 */
function allIsbn13s(isbns) {
  if (!isbns || isbns.length === 0) return [];
  const out = [];
  for (const raw of isbns) {
    const cleaned = String(raw).replace(/[-\s]/g, '');
    if (/^97[89]\d{10}$/.test(cleaned) && isValidIsbn13(cleaned)) out.push(cleaned);
  }
  for (const raw of isbns) {
    const cleaned = String(raw).replace(/[-\s]/g, '');
    if (/^\d{9}[\dXx]$/.test(cleaned)) {
      const isbn13 = isbn10to13(cleaned);
      if (isbn13 && isValidIsbn13(isbn13) && !out.includes(isbn13)) out.push(isbn13);
    }
  }
  return out;
}

/**
 * The languages Open Library attests for ONE printing.
 *
 * ⚠️ Deliberately the `/isbn/<isbn>.json` **edition** endpoint, not the search
 * or `/api/books` one. A work-level record aggregates every translation and
 * would answer `['eng','fre','pol',…]` for all of them — which is exactly the
 * shape that let a Polish printing pass as English. Returns `[]` when Open
 * Library has no record or does not say, and `isbnLanguageVerdict` then falls
 * back to the registration group.
 */
async function olEditionLanguages(isbn13) {
  try {
    const res = await fetch(`https://openlibrary.org/isbn/${isbn13}.json`, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    if (!res.ok) return [];
    const body = await res.json();
    return (body.languages ?? [])
      .map((l) => String(l?.key ?? '').replace('/languages/', ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 🔴 The language gate. `foreign` refuses; `ok` and `unknown` proceed.
 *
 * "Unknown proceeds" is the deliberate half: refusing everything Open Library
 * does not label would turn one silent-wrong-fill into a silent-never-fill, and
 * most self-published records carry no `languages` at all. The registration
 * group inside `isbnLanguageVerdict` is what makes `unknown` narrow — a
 * non-English group is `foreign` whether or not a language is attested.
 */
async function passesLanguageGate(isbn13, why) {
  const languages = await olEditionLanguages(isbn13);
  await sleep(PAUSE_MS);
  const verdict = isbnLanguageVerdict({ isbn13, languages });
  if (verdict === 'foreign') {
    console.log(
      `      ⚠️ REFUSED ${isbn13} — ${why}: Open Library says ` +
        `${languages.length ? languages.join(',') : 'nothing'}, registration group is not English.`,
    );
    return false;
  }
  return true;
}

function isbn10to13(isbn10) {
  const base = '978' + isbn10.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return base + check;
}

// ---------------------------------------------------------------------------
// Rung 1: Open Library title+author search
// ---------------------------------------------------------------------------

async function searchOpenLibraryForIsbn(title, author) {
  const cleaned = cleanAudiobookTitle(title);
  const u = new URL('https://openlibrary.org/search.json');
  u.searchParams.set('title', cleaned);
  if (author) u.searchParams.set('author', author);
  u.searchParams.set('limit', '5');
  u.searchParams.set('fields', 'key,title,author_name,first_publish_year,isbn,publisher');

  const res = await fetch(u.toString(), { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`openlibrary search ${res.status}`);
  const body = await res.json();
  const docs = body.docs ?? [];

  // Find the best matching doc by title similarity
  for (const doc of docs) {
    if (!doc.title) continue;
    const sim = titleSimilarity(normaliseTitle(doc.title), normaliseTitle(title));
    if (sim < 0.80) continue;

    // ⚠️ doc.isbn is an array of ALL isbns from all editions of this work — every
    // translation included — and `sim` above scored the WORK's title, so it says
    // 1.00 for a Polish printing. Walk the candidates and take the first the
    // language gate accepts, rather than the first that parses.
    const candidates = allIsbn13s(doc.isbn ?? []).slice(0, MAX_LANGUAGE_PROBES);
    for (const isbn13 of candidates) {
      if (!(await passesLanguageGate(isbn13, `openlibrary work ${doc.key ?? '?'}`))) continue;
      return {
        isbn13,
        matchedTitle: doc.title,
        similarity: sim,
        source: 'openlibrary',
        sourceUrl: doc.key ? `https://openlibrary.org${doc.key}` : null,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rung 2: Google Books title+author search
// ---------------------------------------------------------------------------

async function searchGoogleBooksForIsbn(title, author) {
  if (!googleKey) return null;

  const cleaned = cleanAudiobookTitle(title);
  let q = `intitle:${cleaned}`;
  if (author) q += `+inauthor:${author}`;

  const u = new URL('https://www.googleapis.com/books/v1/volumes');
  u.searchParams.set('q', q);
  u.searchParams.set('key', googleKey);
  u.searchParams.set('maxResults', '5');

  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`googlebooks search ${res.status}`);
  const body = await res.json();

  for (const item of body.items ?? []) {
    const vi = item.volumeInfo;
    if (!vi?.title) continue;
    const sim = titleSimilarity(normaliseTitle(vi.title), normaliseTitle(title));
    if (sim < 0.80) continue;

    const ids = vi.industryIdentifiers ?? [];
    const isbn13 = allIsbn13s([
      ...ids.filter((i) => i.type === 'ISBN_13').map((i) => i.identifier),
      ...ids.filter((i) => i.type === 'ISBN_10').map((i) => i.identifier),
    ])[0];
    if (!isbn13) continue;

    /*
     * 🔴 The language gate, rung 2 — and here it costs NOTHING and needs no
     * extra call, because Google Books has been returning `volumeInfo.language`
     * on every volume all along and this rung simply never read it. That
     * omission is how a German `978-3` printing of *Carl's Doomsday Scenario*
     * and an Italian `979-12` one of a Kickstarter hardcover were written.
     * Unlike rung 1's work-level record this one IS a single printing, so its
     * own label is authoritative; the registration group only decides when
     * Google leaves the label off.
     */
    const verdict = isbnLanguageVerdict({
      isbn13,
      languages: vi.language ? [vi.language] : [],
    });
    if (verdict === 'foreign') {
      console.log(
        `      ⚠️ REFUSED googlebooks ${isbn13} "${vi.title.slice(0, 40)}" — ` +
          `language ${vi.language ?? 'unstated'}, registration group is not English.`,
      );
      continue;
    }

    return {
      isbn13,
      matchedTitle: vi.title,
      similarity: sim,
      source: 'googlebooks',
      sourceUrl: vi.infoLink ?? null,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rung 2.5: LibraryThing thingTitle search
// ---------------------------------------------------------------------------

const LT_PAUSE_MS = 1100; // Be respectful of rate limits

async function searchLibraryThingForIsbn(title, author) {
  if (!ltKey) return null;

  const cleaned = cleanAudiobookTitle(title);
  const encoded = encodeURIComponent(cleaned);
  const url = `https://www.librarything.com/api/${ltKey}/thingTitle/${encoded}`;

  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`librarything search ${res.status}`);
  const xml = await res.text();

  // Parse against the REAL thingTitle shape (measured live 2026-08-24) — an
  // <idlist> of <isbn> elements on a hit, <idlist><unknownID/></idlist> on a
  // miss, and anything else (a Cloudflare challenge page, an empty body) reads
  // as no answer. See scripts/lib/librarything.mjs for the shape.
  const isbnMatches = parseThingTitleIsbns(xml);
  if (isbnMatches.length === 0) return null;

  /*
   * 🔴 The language gate, rung 2.5 — and it is the rung that needs it MOST.
   * `thingTitle` returns bare ISBNs with no title, author or language ("omitted
   * per vendor terms"), so there has never been anything to compare against;
   * that is why this rung is last and why its writes carry their own source.
   * The printing's own Open Library record is the only signal available, and
   * one call for a rung that fires rarely is cheap.
   */
  let isbn13 = null;
  for (const candidate of allIsbn13s(isbnMatches).slice(0, MAX_LANGUAGE_PROBES)) {
    if (await passesLanguageGate(candidate, 'librarything thingTitle')) {
      isbn13 = candidate;
      break;
    }
  }
  if (!isbn13) return null;

  return {
    isbn13,
    matchedTitle: cleaned,
    // ⚠️ NOT a computed score. LibraryThing returns no per-item title or author
    // (the <title> is "omitted per vendor terms"), so there is nothing to
    // title-gate against — unlike the Open Library / Google Books rungs above.
    // 1.0 records "LT's own server-side title match", not a similarity we
    // measured. This is why the rung is LAST among the free rungs and why its
    // writes are stamped with their own source below.
    similarity: 1.0,
    // Honest provenance now that migration 0420 adds 'librarything' to the
    // edition.source CHECK. ⚠️ Requires 0420 applied before a --commit run.
    source: 'librarything',
    sourceUrl: null,
    _rung: 'librarything', // internal tracking for summary counts
  };
}

// ---------------------------------------------------------------------------
// Rung 3 (--llm): Claude with web search
// ---------------------------------------------------------------------------

const ISBN_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    isbn13: { type: ['string', 'null'] },
    title: { type: ['string', 'null'] },
    publisher: { type: ['string', 'null'] },
    source: { type: ['string', 'null'] },
    confidence: { type: 'string', enum: ['high', 'low'] },
    note: { type: 'string' },
  },
  required: ['found', 'isbn13', 'source', 'confidence', 'note'],
  additionalProperties: false,
};

const ISBN_SYSTEM_PROMPT = `You find ISBN-13 numbers for books in a private household library catalogue.

You are given a book that two free ISBN databases could not supply an ISBN for.
These are usually self-published LitRPG/progression fantasy titles, Kindle
Unlimited exclusives, or small-press titles that are poorly indexed.

Rules:

- Return the ISBN-13 (a 13-digit number starting with 978 or 979) for a PRINT
  edition of this exact book. Paperback or hardcover — either is correct.
- For Japanese light novels / fan translations: find the OFFICIAL Japanese
  ISBN (the original publisher's print edition). These exist — they are published
  by Fujimi Fantasia Bunko, MF Bunko J, etc. Use the Japanese title if needed.
  Note "official JP ISBN" in your response.
- If the book is genuinely Audible/Kindle-exclusive with no print edition, set
  found=false. That is a correct and useful answer — many books in this catalogue
  have no print ISBN and that is the expected outcome.
- Never guess or fabricate an ISBN. Only return one you found on a publisher page,
  retailer listing, or library database.
- Match the EXACT book — same title, same author. A different book in the same
  series, or a different edition of a different book, is wrong.
- Set confidence=low when unsure, and explain in the note.`;

async function searchLlmForIsbn(apiKey, title, author) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const identity = [`Title: ${title}`, `Author: ${author || 'unknown'}`].join('\n');

  const stream = client.messages.stream(
    {
      model: 'claude-opus-5',
      max_tokens: 3000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: ISBN_SCHEMA },
      },
      system: [{ type: 'text', text: ISBN_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 2 },
      ],
      messages: [
        {
          role: 'user',
          content: `${identity}\n\nFind the ISBN-13 for a print edition of this book. Search Amazon, Goodreads, or the publisher's site. If no print edition exists (Audible/Kindle exclusive), say so.`,
        },
      ],
    },
    { signal: AbortSignal.timeout(90_000), maxRetries: 0 },
  );

  const message = await stream.finalMessage();
  const text = message.content.find((b) => b.type === 'text')?.text;
  if (!text) return null;

  const proposal = JSON.parse(text);
  const inputTokens = message.usage?.input_tokens ?? 0;
  const outputTokens = message.usage?.output_tokens ?? 0;
  const cents = (inputTokens / 1_000_000) * 500 + (outputTokens / 1_000_000) * 2500;

  return { proposal, cents };
}

// ---------------------------------------------------------------------------
// Find ISBN-less works
// ---------------------------------------------------------------------------

/*
 * ⚠️ `ORDER BY e.id LIMIT 1` is the OLDEST edition of the work, and on this
 * catalogue that is almost always the SPECIAL printing — measured 2026-09-05,
 * 42 of the 43 rows the 2026-08-20 run filled were exclusives, leatherbounds or
 * slipcase volumes. The row's own name and note are read here so
 * `declaresNoIsbn` can refuse the ones that state no ISBN exists.
 */
const CANDIDATES_SQL = `
  SELECT w.id AS work_id, w.title, w.authors,
         e0.id AS edition_id, e0.edition_name, e0.note, e0.source AS edition_source
    FROM work w
    LEFT JOIN edition e0
      ON e0.id = (SELECT e.id FROM edition e WHERE e.work_id = w.id ORDER BY e.id LIMIT 1)
   WHERE NOT EXISTS (
     SELECT 1 FROM edition e
      WHERE e.work_id = w.id
        AND e.isbn13 IS NOT NULL
   )
   ORDER BY w.id
`;

const allCandidates = query(CANDIDATES_SQL, flags);

/*
 * 🔴 GUARD 1 — a printing that SAYS it has no ISBN is not a gap.
 *
 * `isbn13 IS NULL` there is a recorded fact (an owner-verified note, or a
 * slipcase volume whose set carries the only barcode), and the old
 * `AND isbn13 IS NULL` write guard could not tell a fact from a gap. Refused
 * loudly rather than silently, so the count is a number somebody can check.
 */
/*
 * 🔴 GUARD 1b — a CROWDFUNDED printing the owner holds has already answered.
 *
 * Owner ruling 2026-09-05 18:29 Phoenix, verbatim:
 *
 *   "For the kickstarters we have in stock the ISBNs are recorded if they exist."
 *
 * So on a Kickstarter / collector's / exclusive printing in this catalogue,
 * `isbn13 IS NULL` is a **measured absence** — he types the ISBN at entry when
 * the object carries one — and filling it overwrites a recorded fact with a
 * guess. That is what happened to 13 rows on 2026-08-20.
 *
 * ⚠️ This is an explicit WIDENING of guard 1, made on the owner's answer about
 * the physical objects; guard 1 is deliberately narrow and stays that way. The
 * two claims are different and are kept as two functions — see
 * `lib/backfill-safety.mjs isCrowdfundedPrinting`.
 */
const declared = [];
const crowdfunded = [];
const rows = [];
for (const r of allCandidates) {
  const phrase = declaresNoIsbn(r.edition_name, r.note);
  if (phrase) {
    declared.push({ ...r, phrase });
    continue;
  }
  const campaign = isCrowdfundedPrinting(r.edition_name, r.note);
  if (campaign) {
    crowdfunded.push({ ...r, phrase: campaign });
    continue;
  }
  rows.push(r);
}

const totalWorks = query('SELECT COUNT(*) AS n FROM work', flags)[0].n;
console.log(
  `\n${flags.remote ? 'production' : 'local'}: ${totalWorks} work(s), ` +
    `${allCandidates.length} with no ISBN on any edition`,
);
if (declared.length > 0) {
  console.log(
    `\n🔴 ${declared.length} SKIPPED — the printing's own record says it has no ISBN ` +
      '(not a gap; see lib/backfill-safety.mjs declaresNoIsbn):',
  );
  for (const d of declared) {
    console.log(`   work #${d.work_id} ed#${d.edition_id}  ${d.title.slice(0, 44)}  — "${d.phrase}"`);
  }
}
if (crowdfunded.length > 0) {
  console.log(
    `\n🔴 ${crowdfunded.length} SKIPPED — a crowdfunded/collector's printing the owner holds, ` +
      'and an absent ISBN there is his ANSWER, not a gap.',
  );
  console.log(
    '   Owner ruling 2026-09-05 18:29 Phoenix: "For the kickstarters we have in stock the ' +
      'ISBNs are recorded if they exist."',
  );
  console.log('   (see lib/backfill-safety.mjs isCrowdfundedPrinting)');
  for (const c of crowdfunded) {
    console.log(`   work #${c.work_id} ed#${c.edition_id}  ${c.title.slice(0, 44)}  — "${c.phrase}"`);
  }
}

if (rows.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Run the ladder
// ---------------------------------------------------------------------------

const found = [];
const notFound = [];

console.log(`\nSearching for ISBNs for ${rows.length} work(s)...\n`);

for (const [i, r] of rows.entries()) {
  const n = `${String(i + 1).padStart(3)}/${rows.length}`;
  const primaryAuthor = r.authors?.split(/[;,/&]|\sand\s/i)[0]?.trim() || null;

  // Rung 1: Open Library
  let hit = null;
  try {
    hit = await searchOpenLibraryForIsbn(r.title, primaryAuthor);
  } catch (err) {
    // Degrade, never break
  }
  await sleep(PAUSE_MS);

  // Rung 2: Google Books (only if rung 1 missed)
  if (!hit) {
    try {
      hit = await searchGoogleBooksForIsbn(r.title, primaryAuthor);
    } catch (err) {
      // Degrade
    }
    await sleep(300); // Google is more lenient on rate
  }

  // Rung 2.5: LibraryThing thingTitle (only if rungs 1+2 missed)
  if (!hit && ltKey) {
    try {
      hit = await searchLibraryThingForIsbn(r.title, primaryAuthor);
    } catch (err) {
      // Degrade
    }
    await sleep(LT_PAUSE_MS);
  }

  if (hit) {
    found.push({ ...r, ...hit });
    const displaySource = hit._rung === 'librarything' ? 'librarything' : hit.source;
    console.log(
      `${n} ✓ ${displaySource.padEnd(12)} ${hit.isbn13}  ${r.title.slice(0, 40)}` +
        `  (sim ${hit.similarity.toFixed(2)})`,
    );
  } else {
    notFound.push(r);
    console.log(`${n} ·  ${'—'.padEnd(12)} ${'not found'.padEnd(13)}  ${r.title.slice(0, 40)}`);
  }
}

console.log('');
console.log(`ISBNs found (free)  ${found.length}`);
console.log(`  from openlibrary  ${found.filter((f) => f.source === 'openlibrary' && f._rung !== 'librarything').length}`);
console.log(`  from googlebooks  ${found.filter((f) => f.source === 'googlebooks').length}`);
console.log(`  from librarything ${found.filter((f) => f._rung === 'librarything').length}`);
console.log(`not found           ${notFound.length}`);

// ---------------------------------------------------------------------------
// --llm: paid rung for the remainder
// ---------------------------------------------------------------------------

const llmFound = [];
if (useLlm && notFound.length > 0) {
  // ⚠️ The key follows the INSTANCE — a --friend run bills padhard's books to
  // padhard's own key, never silently to the owner's. --llm-key-from=main is the
  // owner's explicit exception; absent it, a --friend run reads the friend key
  // and refuses to fall back. See lib/backfill-safety.mjs and the sibling cover
  // script.
  const { keyName, overridden } = llmKeyName({ friend: flags.friend, keyFrom: llmKeyFrom });
  const apiKey = readDevVar(keyName);
  const worst = ((notFound.length * 6) / 100).toFixed(2);

  console.log('');
  console.log(`--llm: ${notFound.length} book(s) the free rungs could not resolve.`);
  console.log(`  ⚠️ Costs ~6c/book worst case, so roughly $${worst} for this run.`);
  console.log(
    `  key in use: ${keyName}  (${
      overridden
        ? "the OWNER's key — billed to him, for padhard's books"
        : flags.friend
          ? "padhard — Samantha's own key"
          : "main instance — the owner's key"
    })`,
  );
  if (overridden) {
    console.log(
      `  ⚠️ OVERRIDE ACTIVE — --llm-key-from=main. This --friend run spends ${keyName}, ` +
        `not ANTHROPIC_API_KEY_FRIEND_SAM. Without the flag the rung refuses to fall back.`,
    );
  }

  if (!apiKey) {
    console.log(`  ⚠️ ${keyName} is empty or absent in apps/worker/.dev.vars — skipping.`);
  } else {
    for (const [i, r] of notFound.entries()) {
      const n = `${String(i + 1).padStart(3)}/${notFound.length}`;
      const primaryAuthor = r.authors?.split(/[;,/&]|\sand\s/i)[0]?.trim() || null;

      try {
        const result = await searchLlmForIsbn(apiKey, r.title, primaryAuthor);
        if (!result) {
          console.log(`${n} · ERROR  ${r.title.slice(0, 40)}`);
          continue;
        }

        const { proposal, cents } = result;
        if (!proposal.found || !proposal.isbn13) {
          console.log(`${n}  ${cents.toFixed(1)}c  not found   ${r.title.slice(0, 40)}  ${proposal.note || ''}`);
          continue;
        }

        // Validate the ISBN
        const isbn = proposal.isbn13.replace(/[-\s]/g, '');
        if (!isValidIsbn13(isbn)) {
          console.log(`${n}  ${cents.toFixed(1)}c  INVALID     ${r.title.slice(0, 40)}  (${proposal.isbn13} fails checksum)`);
          continue;
        }

        console.log(
          `${n}  ${cents.toFixed(1)}c  ✓ ${isbn}  ${r.title.slice(0, 40)}` +
            `  [${proposal.confidence}] ${proposal.source || ''}`,
        );

        llmFound.push({
          ...r,
          isbn13: isbn,
          source: 'llm',
          sourceUrl: proposal.source,
          confidence: proposal.confidence,
          note: proposal.note,
        });
      } catch (err) {
        console.log(`${n} · ERROR  ${r.title.slice(0, 40)} — ${err?.message?.slice(0, 60) ?? err}`);
      }
    }

    console.log('');
    console.log(`--llm found ${llmFound.length} of ${notFound.length}.`);
  }
}

// ---------------------------------------------------------------------------
// Check for UNIQUE conflicts before writing
// ---------------------------------------------------------------------------

const allFound = [...found, ...llmFound];
if (allFound.length > 0) {
  // Check which ISBNs already exist in the database
  const isbnList = allFound.map((f) => `'${f.isbn13}'`).join(',');
  const existing = query(
    `SELECT isbn13 FROM edition WHERE isbn13 IN (${isbnList})`,
    flags,
  );
  const existingSet = new Set(existing.map((r) => r.isbn13));

  const conflicts = allFound.filter((f) => existingSet.has(f.isbn13));
  const safe = allFound.filter((f) => !existingSet.has(f.isbn13));

  if (conflicts.length > 0) {
    console.log(`\n⚠️ ${conflicts.length} ISBN(s) already exist on another edition (UNIQUE conflict, skipped):`);
    for (const c of conflicts) {
      console.log(`  ${c.isbn13}  ${c.title.slice(0, 50)}`);
    }
  }

  /*
   * 🔴 EVERY PERSISTED-FIELD CHANGE GETS A `change_log` ROW — the estate's rule,
   * and this script did not obey it until 2026-09-05.
   *
   * The cost of that omission is measured: the 2026-08-20 run wrote 43 ISBNs and
   * flipped several editions from `manual` to `openlibrary`, and because it left
   * no row at all the whole thing had to be reconstructed a fortnight later from
   * `updated_at` clustering and three stdout logs that happened to survive in the
   * repo root. A `change_log` row would have answered it in one SELECT — and,
   * more importantly, would have made the repair a revert instead of a research
   * project.
   *
   * ⚠️ `changed_by` is a real `app_user(id)` and the instances do NOT share one.
   * On main, 1 is the owner. On padhard, user 1 is HER — stamping her name on a
   * script run she did not make would be a lie in the one table written to be
   * trusted. Same rule as `fix-illumicrate-publisher-2026-09-05.mjs`.
   */
  const BATCH = `isbn-backfill-${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`;
  const CHANGED_BY = flags.friend ? 'NULL' : '1';
  const NOTE =
    'scripts/backfill-missing-isbns.mjs filled a missing ISBN from the free/LLM ladder. ' +
    'Guards in force: the title gate (>=0.80), the ISBN-13 check digit, the UNIQUE-conflict ' +
    'check, declaresNoIsbn (a printing that states it has no ISBN is skipped), ' +
    'isCrowdfundedPrinting (a crowdfunded/collector\'s printing the owner holds is skipped — ' +
    'owner ruling 2026-09-05: "For the kickstarters we have in stock the ISBNs are recorded if ' +
    'they exist") and isbnLanguageVerdict (a printing in another language is refused). ' +
    'See docs/info/isbn-ladder.md §7.';

  const logRow = (entityId, field, oldValue, newValue, source, url) =>
    `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
      VALUES (${lit(BATCH)}, 'edition', ${lit(entityId)}, ${lit(field)}, ${lit(JSON.stringify(oldValue))}, ` +
    `${lit(JSON.stringify(newValue))}, ${CHANGED_BY}, 'auto', ${lit(`${NOTE} rung=${source}${url ? ` src=${url}` : ''}`)});`;

  // Also filter out works whose edition already gained an isbn13 (race/re-run)
  const statements = [];
  for (const f of safe) {
    if (f.edition_id == null) continue;
    statements.push(logRow(f.edition_id, 'isbn13', null, f.isbn13, f.source, f.sourceUrl ?? null));

    // The `source` column only moves when the CASE below actually rewrites it,
    // so the log says the same thing the UPDATE does rather than a hopeful
    // guess: 'manual' survives, everything else takes the rung's name.
    const mappedSource = f.source === 'llm' ? 'research' : f.source;
    if (f.edition_source !== 'manual' && f.edition_source !== mappedSource) {
      statements.push(logRow(f.edition_id, 'source', f.edition_source ?? null, mappedSource, f.source, null));
    }

    statements.push(
      // ⚠️ source is written through a CASE that preserves 'manual': a
      // hand-created edition that gains an ISBN from a free rung keeps its
      // 'manual' provenance rather than being silently demoted. See
      // lib/backfill-safety.mjs (audit HIGH, :517).
      `UPDATE edition SET isbn13 = ${lit(f.isbn13)}, source = ${editionSourceWriteExpr(lit, f.source)}, updated_at = datetime('now')` +
        ` WHERE id = ${lit(f.edition_id)} AND isbn13 IS NULL;`,
    );
  }

  const writes = safe.filter((f) => f.edition_id != null).length;
  console.log(`\n${statements.length} statement(s) to run — ${writes} edition update(s) + their change_log rows.`);
  console.log(`change_log batch_id: ${BATCH}`);
  if (!flags.commit) {
    console.log('\nDRY RUN. Nothing written. Re-run with --commit.');
    process.exit(0);
  }
  if (statements.length === 0) process.exit(0);

  execute(statements, flags);

  // Confirm
  const after = query(
    `SELECT COUNT(*) AS n FROM work w WHERE NOT EXISTS (SELECT 1 FROM edition e WHERE e.work_id = w.id AND e.isbn13 IS NOT NULL)`,
    flags,
  )[0];
  const logged = query(`SELECT COUNT(*) AS n FROM change_log WHERE batch_id = ${lit(BATCH)}`, flags)[0];
  console.log(
    `\nWrote ${writes} edition(s); change_log holds ${logged?.n} row(s) for ${BATCH}. ` +
      `Works still without ISBN: ${after.n} (was ${allCandidates.length}, of which ${declared.length} ` +
      'are printings that state they have none and are meant to stay that way).',
  );
} else {
  console.log('\nNo ISBNs found. Nothing to write.');
}
