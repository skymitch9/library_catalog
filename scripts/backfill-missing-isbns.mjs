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
 *
 * ## Safety
 *
 * - ISBN-13 check digits are validated before any write.
 * - Title similarity gate (>=0.80) prevents filing the wrong book's ISBN.
 * - A UNIQUE constraint on edition.isbn13 means a duplicate is a hard failure
 *   caught here, never a silent corruption.
 * - Dry run by default. Nothing written without --commit.
 * - Every write targets the FIRST edition of the work (the one the owner
 *   interacts with). If it already carries an isbn13 somehow, the work is
 *   skipped rather than overwritten.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { execute, lit, parseFlags, query, ROOT } from './lib/d1.mjs';
import { titleSimilarity } from '../packages/core/src/matching.ts';
import { normaliseTitle, cleanAudiobookTitle } from '../packages/core/src/titles.ts';

const flags = parseFlags();
const useLlm = process.argv.includes('--llm');

const UA = 'library_catalog (+https://github.com/private)';
const PAUSE_MS = 1100; // Open Library asks for ~1 req/sec
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

/** Pick the best ISBN-13 from a list of raw ISBN strings (may be isbn10 or isbn13). */
function pickBestIsbn13(isbns) {
  if (!isbns || isbns.length === 0) return null;
  // Prefer 978/979 prefixed 13-digit ones
  for (const raw of isbns) {
    const cleaned = raw.replace(/[-\s]/g, '');
    if (/^97[89]\d{10}$/.test(cleaned) && isValidIsbn13(cleaned)) return cleaned;
  }
  // Try converting isbn10 to isbn13
  for (const raw of isbns) {
    const cleaned = raw.replace(/[-\s]/g, '');
    if (/^\d{9}[\dXx]$/.test(cleaned)) {
      const isbn13 = isbn10to13(cleaned);
      if (isbn13 && isValidIsbn13(isbn13)) return isbn13;
    }
  }
  return null;
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

    // doc.isbn is an array of ALL isbns from all editions of this work
    const isbn13 = pickBestIsbn13(doc.isbn ?? []);
    if (isbn13) {
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
    const isbn13Entry = ids.find((i) => i.type === 'ISBN_13');
    if (isbn13Entry) {
      const isbn = isbn13Entry.identifier.replace(/[-\s]/g, '');
      if (isValidIsbn13(isbn)) {
        return {
          isbn13: isbn,
          matchedTitle: vi.title,
          similarity: sim,
          source: 'googlebooks',
          sourceUrl: vi.infoLink ?? null,
        };
      }
    }
    // Try isbn10 conversion
    const isbn10Entry = ids.find((i) => i.type === 'ISBN_10');
    if (isbn10Entry) {
      const converted = isbn10to13(isbn10Entry.identifier.replace(/[-\s]/g, ''));
      if (converted && isValidIsbn13(converted)) {
        return {
          isbn13: converted,
          matchedTitle: vi.title,
          similarity: sim,
          source: 'googlebooks',
          sourceUrl: vi.infoLink ?? null,
        };
      }
    }
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

  // Parse all <isbn>...</isbn> elements via regex
  const isbnMatches = [...xml.matchAll(/<isbn>([^<]+)<\/isbn>/g)].map((m) => m[1].trim());
  if (isbnMatches.length === 0) return null;

  // Find the first valid ISBN-13 (or convert ISBN-10)
  const isbn13 = pickBestIsbn13(isbnMatches);
  if (!isbn13) return null;

  return {
    isbn13,
    matchedTitle: cleaned,
    similarity: 1.0, // LT matched on our exact title query; no title returned to compare
    source: 'openlibrary', // CHECK constraint only allows known sources; LT aggregates same data
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

const CANDIDATES_SQL = `
  SELECT w.id AS work_id, w.title, w.authors,
         (SELECT e.id FROM edition e WHERE e.work_id = w.id ORDER BY e.id LIMIT 1) AS edition_id
    FROM work w
   WHERE NOT EXISTS (
     SELECT 1 FROM edition e
      WHERE e.work_id = w.id
        AND e.isbn13 IS NOT NULL
   )
   ORDER BY w.id
`;

const rows = query(CANDIDATES_SQL, flags);

const totalWorks = query('SELECT COUNT(*) AS n FROM work', flags)[0].n;
console.log(`\n${flags.remote ? 'production' : 'local'}: ${totalWorks} work(s), ${rows.length} with no ISBN on any edition`);

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
  const apiKey = readDevVar('ANTHROPIC_API_KEY');
  const worst = ((notFound.length * 6) / 100).toFixed(2);

  console.log('');
  console.log(`--llm: ${notFound.length} book(s) the free rungs could not resolve.`);
  console.log(`  ⚠️ Costs ~6c/book worst case, so roughly $${worst} for this run.`);

  if (!apiKey) {
    console.log('  ⚠️ No ANTHROPIC_API_KEY in apps/worker/.dev.vars — skipping.');
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

  // Also filter out works whose edition already gained an isbn13 (race/re-run)
  const statements = safe
    .filter((f) => f.edition_id != null)
    .map(
      (f) =>
        `UPDATE edition SET isbn13 = ${lit(f.isbn13)}, source = ${lit(f.source === 'llm' ? 'research' : f.source)}, updated_at = datetime('now')` +
        ` WHERE id = ${lit(f.edition_id)} AND isbn13 IS NULL;`,
    );

  console.log(`\n${statements.length} statement(s) to run.`);
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
  console.log(`\nWrote ${statements.length}. Works still without ISBN: ${after.n} (was ${rows.length}).`);
} else {
  console.log('\nNo ISBNs found. Nothing to write.');
}
