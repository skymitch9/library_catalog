#!/usr/bin/env node
/**
 * Give every work a cover.
 *
 *     EPUB on disk  ─┐
 *     audiobook cover ├─►  apps/web/public/covers/*.jpg  ─►  work.cover_url
 *                    ─┘
 *
 * ## Why the files are extracted and committed rather than linked
 *
 * Measured 2026-08-10, against the 117 works then in production D1:
 *
 * | Source | Works it can cover |
 * |---|---|
 * | `work.cover_url` already set | **0** |
 * | `edition.isbn13` (so Open Library by ISBN) | **0** |
 * | audiobook catalog row matched by work key | 27 |
 * | the EPUB named by `edition.source_url` | **115** |
 *
 * So the ISBN ladder that `docs/info/isbn-ladder.md` measured — the strongest
 * rung either catalog has — cannot fire here at all: these rows are ebook files
 * with no ISBN. The files themselves are the only source with real coverage, and
 * they are already on this disk.
 *
 * They are resized and committed because the alternative is worse in both
 * directions. Hot-linking the audiobook site's covers would make this app break
 * when that one is redeployed, and covers only a quarter of the rows. Storing the
 * originals would be 106MB for 115 images, into a repo whose sibling has already
 * had a 377MB `.git` force a hosting migration. Resized they are a few MB, and
 * they ship with the Worker's static assets, which is where every other byte
 * this app serves already comes from.
 *
 * ## Idempotent, and safe to re-run
 *
 * The filename is derived from `work_key`, so a re-run of an unchanged library
 * produces byte-identical output and an empty UPDATE batch. A work whose cover
 * is already correct is skipped without reading its EPUB.
 *
 * ⚠️ It never overwrites a cover that came from somewhere else. `--force`
 * re-extracts, but a `cover_url` that does not point at `/covers/` — one a person
 * chose through the enrichment screen — is left alone regardless.
 *
 * ## Usage
 *
 *     npm run backfill:covers                     # dry run, local database
 *     npm run backfill:covers -- --commit         # write locally
 *     npm run backfill:covers -- --remote         # dry run against production
 *     npm run backfill:covers -- --remote --commit
 *
 * ⚠️ `--remote --commit` writes paths that only resolve once the built assets
 * are deployed. Deploy in the same sitting, or production shows broken images
 * where it currently shows placeholders.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import { execute, lit, parseFlags, query, ROOT } from './lib/d1.mjs';
import { readEpub } from './lib/epub.mjs';
import { audiobookCoverPath, audiobookIndex, loadAudiobooks } from './lib/audiobooks.mjs';

const flags = parseFlags();
const FORCE = process.argv.includes('--force');

/**
 * Where `edition.source_url` is relative to.
 *
 * The importer stores a path relative to the ebook root, not an absolute one —
 * migration 0002 says why in full: a path is a fact about one machine's mount
 * layout. This is that machine's, overridable so the script is not.
 */
const EBOOK_ROOT = process.env.EBOOK_ROOT || 'C:/Users/nbasl/OpenAudible/books';

const OUT_DIR = path.join(ROOT, 'apps/web/public/covers');
/** The URL prefix the app serves `OUT_DIR` at. Must match, or every image 404s. */
const URL_PREFIX = '/covers';

/**
 * 360px wide, quality 78.
 *
 * The grid renders a cover at 150px and the detail panel at 190px, so 360
 * survives a 2× display with room to spare and stops well short of paying for
 * pixels nothing can show. 115 covers land around 3MB together; the same images
 * unresized are 106MB.
 */
const COVER_WIDTH = 360;
const COVER_QUALITY = 78;

/** Stable, collision-proof, and readable in a directory listing. */
function coverName(workKey) {
  const slug = workKey
    .replace(/\|/g, '--')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  // The hash is what makes it collision-proof; the slug is what makes the
  // directory legible when something is wrong with one image.
  const hash = createHash('sha1').update(workKey).digest('hex').slice(0, 8);
  return `${slug}-${hash}.jpg`;
}

async function writeCover(buffer, outPath) {
  const jpeg = await sharp(buffer)
    .rotate()
    .resize({ width: COVER_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: COVER_QUALITY, mozjpeg: true })
    .toBuffer();
  writeFileSync(outPath, jpeg);
  return jpeg.length;
}

// ---------------------------------------------------------------------------

const works = query(
  `SELECT w.id, w.title, w.authors, w.work_key, w.cover_url,
          (SELECT e.source_url FROM edition e
            WHERE e.work_id = w.id AND e.source_url IS NOT NULL
            ORDER BY e.id LIMIT 1) AS source_url
     FROM work w
    ORDER BY w.id`,
  flags,
);

console.log(`${works.length} work(s) in the ${flags.remote ? 'REMOTE' : 'local'} database`);
if (works.length === 0) {
  console.log('Nothing to do. (A local run needs `npm run db:migrate:local` and some rows.)');
  process.exit(0);
}

const audiobooks = loadAudiobooks();
const abIndex = audiobookIndex(audiobooks);
console.log(`${audiobooks.length} audiobook row(s) available as a fallback source`);

mkdirSync(OUT_DIR, { recursive: true });

const stats = { already: 0, epub: 0, audiobook: 0, reused: 0, none: 0, failed: 0, bytes: 0 };
const misses = [];
const updates = [];

let n = 0;
for (const w of works) {
  if (n++ >= flags.limit) break;

  const name = coverName(w.work_key);
  const url = `${URL_PREFIX}/${name}`;
  const outPath = path.join(OUT_DIR, name);

  // A cover chosen by a person through /api/enrich is not ours to replace.
  if (w.cover_url && !w.cover_url.startsWith(URL_PREFIX)) {
    stats.already++;
    continue;
  }

  if (existsSync(outPath) && !FORCE) {
    // The image is already extracted; only the column may be missing.
    stats.reused++;
    if (w.cover_url !== url) updates.push([w.id, url]);
    continue;
  }

  let source = null;
  let buffer = null;

  if (w.source_url) {
    const file = path.join(EBOOK_ROOT, w.source_url);
    if (existsSync(file)) {
      try {
        const epub = readEpub(file);
        if (epub?.cover) {
          buffer = epub.cover.data;
          source = 'epub';
        }
      } catch (err) {
        // One unreadable file must not stop 116 good ones.
        console.warn(`  ! ${w.title}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  if (!buffer) {
    const hit = abIndex.lookup(w.title, w.authors);
    const abCover = hit ? audiobookCoverPath(hit.row.coverHref) : null;
    if (abCover) {
      buffer = readFileSync(abCover);
      source = 'audiobook';
    }
  }

  if (!buffer) {
    stats.none++;
    misses.push(`${w.title} — ${w.authors}`);
    continue;
  }

  try {
    stats.bytes += await writeCover(buffer, outPath);
    stats[source]++;
    if (w.cover_url !== url) updates.push([w.id, url]);
  } catch (err) {
    stats.failed++;
    console.warn(`  ! ${w.title}: could not encode — ${err instanceof Error ? err.message : err}`);
  }
}

// ---------------------------------------------------------------------------

const onDisk = readdirSync(OUT_DIR).filter((f) => f.endsWith('.jpg'));
const diskBytes = onDisk.reduce((sum, f) => sum + statSync(path.join(OUT_DIR, f)).size, 0);

console.log('');
console.log(`from the EPUB           ${stats.epub}`);
console.log(`from the audiobook site ${stats.audiobook}`);
console.log(`already extracted       ${stats.reused}`);
console.log(`left alone (hand-set)   ${stats.already}`);
console.log(`no source at all        ${stats.none}`);
if (stats.failed) console.log(`failed to encode        ${stats.failed}`);
console.log('');
console.log(`${onDisk.length} file(s) in apps/web/public/covers, ${(diskBytes / 1048576).toFixed(1)}MB total`);
console.log(`${updates.length} row(s) need cover_url set`);

if (misses.length) {
  console.log('');
  console.log('No cover found for:');
  for (const m of misses) console.log(`  ${m}`);
}

if (updates.length === 0) {
  console.log('\nNothing to write.');
  process.exit(0);
}

if (!flags.commit) {
  console.log('');
  for (const [id, url] of updates.slice(0, 5)) console.log(`  work ${id} -> ${url}`);
  if (updates.length > 5) console.log(`  … and ${updates.length - 5} more`);
  console.log('\nDRY RUN. Images were written; the database was not. Re-run with --commit.');
  process.exit(0);
}

const sent = execute(
  updates.map(
    ([id, url]) =>
      `UPDATE work SET cover_url = ${lit(url)}, updated_at = datetime('now') WHERE id = ${lit(id)};`,
  ),
  flags,
);

// Confirm by re-reading, never by trusting the write's own report — see the note
// on `execute`, which cannot tell you how many rows moved.
const after = query('SELECT COUNT(*) AS total, COUNT(cover_url) AS covered FROM work', flags)[0];
console.log(
  `\n${sent} statement(s) run. ${after.covered} of ${after.total} work(s) now have a cover` +
    ` in the ${flags.remote ? 'REMOTE' : 'local'} database.`,
);
if (flags.remote) {
  console.log('⚠️  These URLs resolve only once apps/web/public/covers is built and deployed.');
}
