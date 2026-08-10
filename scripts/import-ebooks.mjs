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
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { workKeyFor, cleanAudiobookTitle } from '../packages/core/src/titles.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const INCLUDE_FILENAME = args.includes('--include-filename');
const INCLUDE_PDF = args.includes('--include-pdf');

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
  let n = 0;
  for (const w of byWork.values()) {
    if (n++ >= 15) break;
    console.log(`  ${w.title}  —  ${w.authors}  [${w.formats.map((f) => f.format).join(', ')}]`);
  }
  if (byWork.size > 15) console.log(`  … and ${byWork.size - 15} more`);
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.');
  process.exit(0);
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
      if (res.warning === 'work_key_mismatch') {
        console.warn(`  key mismatch on "${w.title}": sent ${res.sent}, server computed ${res.workKey}`);
      }
      createdEditions++;
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
    `\neditions: ${createdEditions} created` +
    (failed ? `\nfailed: ${failed}` : ''),
);
