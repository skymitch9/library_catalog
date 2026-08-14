#!/usr/bin/env node
/**
 * Import the audiobook pipeline's ebook manifest into this catalog.
 *
 *     audiobook_catalog/site/ebooks.json  ->  work + edition rows in D1
 *
 * ## Why a manifest and not a folder scan
 *
 * One pipeline, one source of data. `audiobook_catalog` already walks the whole
 * book tree three times a day and already reads each EPUB's embedded OPF
 * metadata — `scripts/build_ebook_manifest.py`, wired in as sync step 1b. It
 * knows what is there and it knows the real titles.
 *
 * This project previously scanned that folder itself and guessed titles from
 * filenames. It produced `BtDEM 1 Oathbound Healer` where the OPF says
 * `Oathbound Healer`. That scanner is gone; this reads the answer instead.
 *
 * Measured 2026-08-10: 148 files, and **118 of 118 EPUBs carried OPF metadata**.
 * The 30 PDFs did not, and say so.
 *
 * ## ⚠️ `source` decides how much a row is trusted
 *
 * | `source` | meaning | what happens here |
 * |---|---|---|
 * | `opf` | title/author read from inside the file | imported |
 * | `filename` | parsed from the name; the file has no usable metadata | **skipped unless `--include-filename`** |
 *
 * The default is deliberate. A `filename` row with no author folds to a work key
 * with an empty author half, which collides with every other authorless book —
 * the exact collision `workKey` exists to prevent. Better to leave those out and
 * add them by hand than to poison the key space.
 *
 * ## What it does NOT do
 *
 * - No `copy` rows. An ebook file existing is good evidence of a licence, but
 *   "we own this" is a claim about us, and migration 0001's catalog/collection
 *   split says a machine does not make those unasked.
 * - No overwriting. An existing work is matched and given an edition; its title,
 *   author and series are left exactly as they are. A person's correction always
 *   outranks an import.
 *
 * ## Usage
 *
 *     npm run import:ebooks              # dry run against production
 *     npm run import:ebooks -- --commit
 *     npm run import:ebooks -- --commit --api http://127.0.0.1:8787
 *
 * Dry run is the default, as it is for every importer in this project.
 *
 * ## Pruning
 *
 * Import is append-only: delete or rename an EPUB and its edition lives on,
 * pointing at a path that no longer exists.
 *
 *     npm run import:ebooks -- --prune --remote            # show the orphans
 *     npm run import:ebooks -- --prune --remote --commit   # delete them
 *
 * `--prune` reads D1 directly and so needs a wrangler login; `--remote` picks
 * production over the local dev database. It only ever removes editions with
 * `source = 'file'` in one of the five ebook FILE formats — never anything
 * physical, never `ebook_kindle` (a licence with no file to be missing), never a
 * hand-added edition, and never a work.
 *
 * It refuses to delete more than 20% of them in one run. An empty or truncated
 * manifest looks exactly like "the library was deleted", and the wrong response
 * to a failed scan is to make the catalog match it. `--force-prune` overrides,
 * once a person has looked.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cleanAudiobookTitle,
  normaliseTitle,
  primaryAuthor,
  splitSeriesPrefix,
  workKeyFor,
} from '../packages/core/src/titles.ts';
import {
  MIN_AUTHOR_SIMILARITY,
  bestSimilarity,
  foldAuthorNames,
} from '../packages/core/src/matching.ts';
import { UNKNOWN_AUTHOR } from '../packages/core/src/constants.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const INCLUDE_FILENAME = args.includes('--include-filename');
const INCLUDE_PDF = args.includes('--include-pdf');
const PRUNE = args.includes('--prune');
const FORCE_PRUNE = args.includes('--force-prune');
const REMOTE = args.includes('--remote');

function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const MANIFEST = argValue(
  '--manifest',
  path.resolve(here, '../../audiobook_catalog/site/ebooks.json'),
);
const API = argValue('--api', 'https://library-catalog.bgc-worker.workers.dev').replace(/\/$/, '');
// The machine token. Read from the environment, or from .dev.vars so an
// unattended run needs no shell setup at all — .dev.vars is already the single
// source of truth for secrets and is gitignored.
function tokenFromDevVars() {
  try {
    const text = readFileSync(path.resolve(here, '../apps/worker/.dev.vars'), 'utf8');
    const m = /^[ \t]*EBOOK_INGEST_TOKEN[ \t]*=[ \t]*"?([^"\r\n]+)"?/m.exec(text);
    return m?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}
const TOKEN = process.env.EBOOK_INGEST_TOKEN || tokenFromDevVars();

/** Manifest format -> `edition.format`. See migration 0002. */
const FORMAT_MAP = {
  epub: 'ebook_epub',
  mobi: 'ebook_mobi',
  azw3: 'ebook_azw3',
  kepub: 'ebook_kepub',
  pdf: 'ebook_pdf',
};

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
} catch (err) {
  console.error(`Cannot read manifest at ${MANIFEST}`);
  console.error('Generate it with:  python scripts/build_ebook_manifest.py   (in audiobook_catalog)');
  console.error(String(err));
  process.exit(1);
}

console.log(`manifest: ${manifest.count} file(s), generated ${manifest.generated_at}`);
console.log(`target:   ${API}`);

const skipped = { filename: 0, pdf: 0, noAuthor: 0, unknownFormat: 0 };
const planned = [];

for (const row of manifest.ebooks) {
  const format = FORMAT_MAP[row.format];
  if (!format) {
    skipped.unknownFormat++;
    continue;
  }
  if (row.format === 'pdf' && !INCLUDE_PDF) {
    // Most of the 30 PDFs beside these audiobooks are maps, character sheets and
    // Kickstarter art inserts rather than books. Opt in if yours differ.
    skipped.pdf++;
    continue;
  }
  if (row.source !== 'opf' && !INCLUDE_FILENAME) {
    skipped.filename++;
    continue;
  }
  if (!row.author) {
    // ⚠️ Never import an authorless row. `workKey` would be `title|`, and every
    // authorless book would then collide with every other one sharing a title.
    skipped.noAuthor++;
    continue;
  }

  // The title is cleaned even though it came from the OPF: a few carry Audible's
  // own decoration ("… - Series, Book 2"), and `workKey` must be computed from
  // the same shape a print edition would produce or the two never meet.
  const title = cleanAudiobookTitle(row.title);
  planned.push({
    title,
    authors: row.author,
    format,
    workKey: workKeyFor(title, row.author),
    path: row.path,
  });
}

console.log(
  `to import: ${planned.length}` +
    `   skipped: ${skipped.filename} filename-only, ${skipped.pdf} pdf, ` +
    `${skipped.noAuthor} no author, ${skipped.unknownFormat} unknown format`,
);

// Collapse by work key BEFORE hitting the API, so a book present in two formats
// is one work with two editions rather than two round trips racing to create it.
const byWork = new Map();
for (const p of planned) {
  if (!byWork.has(p.workKey)) byWork.set(p.workKey, { ...p, formats: [] });
  byWork.get(p.workKey).formats.push({ format: p.format, path: p.path });
}
console.log(`distinct works: ${byWork.size}`);

if (!COMMIT) {
  await dryRunProbe();
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.');
  // ⚠️ Prune has to be reached here too, or `--prune` without `--commit` — the
  // safe rehearsal, and the way anyone will first try it — exits above and
  // silently does nothing. It reports "DRY RUN" either way, so the failure looks
  // exactly like success.
  if (PRUNE) await runPrune();
  process.exit(0);
}

/**
 * Dry run: say what a commit would DO, not just what it would send.
 *
 * ## Why a dry run reads the database at all
 *
 * The old dry run listed the planned rows and stopped — it could not tell an
 * attach from a creation, so the 2026-08-14 run looked routine right up until
 * `--commit` minted 13 duplicate works. The decision lives server-side (the
 * ingest route matches before creating); a rehearsal that cannot see the
 * catalog is rehearsing a different play.
 *
 * So this classifies every planned work exactly as the route will —
 * exact key, then title alias (author-gated, contested → nobody), then
 * series-prefix (remainder key + fold-equal recorded series) — against works
 * and aliases read straight from D1, the same way `--prune` reads it:
 * wrangler login, `--remote` for production. The shared pieces
 * (`splitSeriesPrefix`, `workKeyFor`, `normaliseTitle`, `bestSimilarity`,
 * `foldAuthorNames`, `MIN_AUTHOR_SIMILARITY`) are imported from
 * `packages/core`, so the two sides cannot drift in what they fold — the
 * composition order is the only thing repeated, and it is short.
 *
 * No wrangler? It says so, prints the old plain listing, and stays a dry run
 * rather than failing — the safe rehearsal must stay the easy thing to run.
 */
async function dryRunProbe() {
  let works;
  let aliases;
  try {
    const { query } = await import('./lib/d1.mjs');
    works = query('SELECT id, title, authors, series, work_key FROM work', { remote: REMOTE });
    aliases = query('SELECT work_id, alias, kind FROM work_alias', { remote: REMOTE });
  } catch (err) {
    console.log(
      `\n(could not read the ${REMOTE ? 'REMOTE' : 'local'} database — ` +
        `attach-vs-create cannot be classified: ${err instanceof Error ? err.message.split('\n')[0] : err})`,
    );
    let n = 0;
    for (const w of byWork.values()) {
      if (n++ >= 15) break;
      console.log(`  ${w.title}  —  ${w.authors}  [${w.formats.map((f) => f.format).join(', ')}]`);
    }
    if (byWork.size > 15) console.log(`  … and ${byWork.size - 15} more`);
    return;
  }

  const byKey = new Map(works.map((w) => [w.work_key, w]));
  const byId = new Map(works.map((w) => [w.id, w]));
  const authorAliases = new Map();
  const titleAliases = [];
  for (const a of aliases) {
    if (a.kind === 'author') {
      const list = authorAliases.get(a.work_id);
      if (list) list.push(a.alias);
      else authorAliases.set(a.work_id, [a.alias]);
    } else {
      titleAliases.push(a);
    }
  }

  // The same three arms, in the same order, with the same gates as the route.
  const classify = (w) => {
    const exact = byKey.get(w.workKey);
    if (exact) return { via: 'key', work: exact };

    const titleKey = normaliseTitle(w.title);
    const authorKey = normaliseTitle(primaryAuthor(w.authors));
    const gated = [];
    for (const a of titleAliases) {
      if (normaliseTitle(a.alias) !== titleKey) continue;
      const candidate = byId.get(a.work_id);
      if (!candidate) continue;
      const stored = candidate.authors === UNKNOWN_AUTHOR ? '' : candidate.authors;
      const keys = foldAuthorNames(stored, authorAliases.get(a.work_id) ?? []);
      if (bestSimilarity(authorKey, keys) >= MIN_AUTHOR_SIMILARITY) gated.push(candidate);
    }
    const distinct = [...new Set(gated.map((g) => g.id))];
    if (distinct.length === 1) return { via: 'alias', work: byId.get(distinct[0]) };
    if (distinct.length > 1) return { via: 'create', work: null }; // contested — route refuses too

    const split = splitSeriesPrefix(w.title);
    if (split) {
      const candidate = byKey.get(workKeyFor(split.title, w.authors));
      if (candidate?.series && normaliseTitle(candidate.series) === normaliseTitle(split.series)) {
        return { via: 'series_prefix', work: candidate };
      }
    }
    return { via: 'create', work: null };
  };

  const counts = { key: 0, alias: 0, series_prefix: 0, create: 0 };
  const interesting = [];
  const creates = [];
  for (const w of byWork.values()) {
    const { via, work } = classify(w);
    counts[via]++;
    if (via === 'alias' || via === 'series_prefix') interesting.push({ w, via, work });
    if (via === 'create') creates.push(w);
  }

  console.log(
    `\nprobe (${REMOTE ? 'REMOTE' : 'local'} db, ${works.length} works): ` +
      `${counts.key} attach by key, ${counts.alias} by alias, ` +
      `${counts.series_prefix} by series prefix, ${counts.create} would CREATE`,
  );
  for (const { w, via, work } of interesting) {
    console.log(`  [${via}] ${w.title}  ->  #${work.id} ${work.title}`);
  }
  if (creates.length) {
    console.log('  new works a --commit would mint:');
    for (const w of creates) console.log(`    ${w.title}  —  ${w.authors}`);
  }
}

// A local `wrangler dev` carries the ENVIRONMENT!=production auth bypass, so it
// needs no token. Demanding one there made the safe rehearsal harder to run than
// the real thing, which is exactly backwards for a script whose whole discipline
// is "prove it locally first".
const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/.test(API);

if (!TOKEN && !IS_LOCAL) {
  console.error('\nEBOOK_INGEST_TOKEN is not set.');
  console.error('Put it in apps/worker/.dev.vars and run `npm run secrets:push`,');
  console.error('or export EBOOK_INGEST_TOKEN. Generate one: openssl rand -hex 32');
  process.exit(1);
}

async function api(method, endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${endpoint} -> ${res.status} ${await res.text()}`);
  return res.json();
}

let createdWorks = 0;
let attachedWorks = 0;
let createdEditions = 0;
let skippedEditions = 0;
let failed = 0;

for (const w of byWork.values()) {
  try {
    // One call per edition, through /api/ingest — the narrow machine route.
    //
    // ⚠️ It matches on `work_key` server-side and attaches to an existing work
    // rather than creating a second one, so this is idempotent and the
    // match-then-create dance does not belong on the client. It also means the
    // importer never needs `editCatalog`, which is the point of the separate
    // token: a leaked importer credential cannot edit the catalog at large.
    for (const f of w.formats) {
      const res = await api('POST', '/api/ingest/ebook', {
        title: w.title,
        authors: w.authors,
        format: f.format,
        sourcePath: f.path,
        workKey: w.workKey,
      });
      if (res.createdWork) createdWorks++;
      else attachedWorks++;
      // An attach the exact key could not have made is worth a line: it means
      // a fallback (alias / series-prefix) just prevented a duplicate work.
      if (!res.createdWork && res.matchedVia && res.matchedVia !== 'key') {
        console.log(`  [${res.matchedVia}] ${w.title} -> work #${res.workId}`);
      }
      if (res.warning === 'work_key_mismatch') {
        console.warn(`  key mismatch on "${w.title}": sent ${res.sent}, server computed ${res.workKey}`);
      }
      // ⚠️ Trust the server's answer, not the fact that a call was made. The
      // first version counted every response as a creation, so an idempotent
      // re-run reported "118 editions created" while the database correctly
      // stayed at 119 rows. A counter that lies about a no-op is worse than no
      // counter: it looks exactly like the duplicate bug it was meant to prove
      // was fixed.
      if (res.createdEdition === false) skippedEditions++;
      else createdEditions++;
    }
  } catch (err) {
    // One bad row must not stop the run — the same rule the audiobook pipeline
    // follows, because 400 books should not wait on one failure.
    failed++;
    console.warn(`  failed: ${w.title} — ${err instanceof Error ? err.message : err}`);
  }
}

console.log(
  `\nworks: ${createdWorks} created, ${attachedWorks} attached to existing` +
    `\neditions: ${createdEditions} created, ${skippedEditions} already present` +
    (failed ? `\nfailed: ${failed}` : ''),
);

// ---------------------------------------------------------------------------
// --prune: drop editions whose file is gone from the manifest
// ---------------------------------------------------------------------------
//
// Import alone is append-only, so deleting or renaming an EPUB leaves its
// edition behind for ever, pointing at a path that no longer exists. Two files
// were removed as verified duplicates on 2026-08-10 and their rows outlived
// them.
//
// ## ⚠️ Why this goes straight to D1 instead of through /api/ingest
//
// The ingest route can create a work and an ebook edition, and NOTHING else —
// no reads, no deletes — precisely so a leaked machine token cannot destroy or
// exfiltrate the collection. Adding a delete endpoint would hand exactly that
// power to the credential the route was narrowed to protect against. Pruning is
// rare, runs from the machine that holds the library, and already needs the
// files themselves, so it can afford to want a wrangler login instead.
//
// ## What it will not touch, by construction
//
//   - **Anything physical.** hardcover, paperback, mass_market are excluded at
//     the query. Physical books are being added to this catalog shortly and a
//     prune that could reach them would be a data-loss bug waiting for them.
//   - **`ebook_kindle`.** A licence with no bytes — it has no file to be
//     missing, so its absence from a file manifest means nothing.
//   - **Anything not `source = 'file'`.** A hand-added or research-sourced
//     edition is somebody's judgement, not this script's output.
//   - **Works.** Only editions are removed. A work left with no editions keeps
//     its copies, its read-state and its reviews, and is a visible thing to fix
//     rather than a silent deletion.
async function runPrune() {
  const { query, execute, lit } = await import('./lib/d1.mjs');

  const FILE_FORMATS = Object.values(FORMAT_MAP);
  const flags = { remote: REMOTE };

  // "An edition this script owns" — spelled out once per alias rather than
  // derived from the other by string surgery, because the two differ only by a
  // prefix and a regex that rewrites SQL is a worse thing to debug than a
  // duplicated WHERE clause.
  const formatList = FILE_FORMATS.map((f) => `'${f}'`).join(', ');
  const ownedE = `e.source = 'file' AND e.source_url IS NOT NULL AND e.format IN (${formatList})`;
  const owned = `source = 'file' AND source_url IS NOT NULL AND format IN (${formatList})`;

  const existing = query(
    `SELECT e.id, e.source_url, e.format, w.title
       FROM edition e JOIN work w ON w.id = e.work_id
      WHERE ${ownedE}`,
    flags,
  );

  const onDisk = new Set(manifest.ebooks.map((r) => r.path));
  const orphans = existing.filter((row) => !onDisk.has(row.source_url));

  console.log(
    `\nprune: ${existing.length} file edition(s) in the ${REMOTE ? 'REMOTE' : 'local'} database, ` +
      `${manifest.count} file(s) in the manifest, ${orphans.length} orphan(s)`,
  );

  // ⚠️ The guard that matters. `build_ebook_manifest.py` producing an empty or
  // truncated manifest — an unmounted drive, a crashed walk — is indistinguishable
  // from "the user deleted their whole library", and without this the response to
  // a failed scan would be to delete the catalog to match it. Refuse and make a
  // person look.
  const ceiling = Math.max(5, Math.floor(existing.length * 0.2));
  if (orphans.length > ceiling && !FORCE_PRUNE) {
    console.error(
      `\nREFUSING to prune ${orphans.length} of ${existing.length} edition(s) — over the ${ceiling} ceiling.` +
        '\nThat usually means the manifest is short, not that the library shrank.' +
        '\nCheck `python scripts/build_ebook_manifest.py` output first; override with --force-prune.',
    );
    process.exit(1);
  }

  for (const o of orphans.slice(0, 20)) {
    console.log(`  ${o.title}  [${o.format}]  ${o.source_url}`);
  }
  if (orphans.length > 20) console.log(`  … and ${orphans.length - 20} more`);

  if (!orphans.length) {
    console.log('Nothing to prune.');
  } else if (!COMMIT) {
    console.log('\nDRY RUN. Nothing deleted. Re-run with --commit.');
  } else {
    execute(
      orphans.map((o) => `DELETE FROM edition WHERE id = ${lit(o.id)};`),
      flags,
    );
    // Confirm by re-reading. `execute` returns statements run, not rows changed —
    // the local D1 omits meta.changes entirely, so a count from it would lie.
    const left = query(`SELECT COUNT(*) AS n FROM edition WHERE ${owned}`, flags)[0];
    console.log(`\n${orphans.length} edition(s) deleted. ${left.n} file edition(s) remain.`);
  }
}

if (PRUNE) await runPrune();
