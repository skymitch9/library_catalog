#!/usr/bin/env node
/**
 * Copy the author → Google Drive folder map out of the audiobook catalog.
 *
 *     audiobook_catalog/author_drive_map.json
 *       -> apps/web/public/author-drive-map.json
 *
 * ## Why copy rather than share or refetch
 *
 * The map is `{ "Brandon Sanderson": "https://drive.google.com/drive/folders/…" }`,
 * built by `audiobook_catalog/scripts/update_drive_map.py` from a live Drive
 * listing. That script needs Google credentials, which this repo deliberately
 * does not hold. And the ebooks in this catalog live in the *same* Drive tree as
 * the audiobooks — `edition.source_url` is a path under `OpenAudible/books`,
 * which is exactly what `sync_to_drive.py` uploads — so it is the same map, not
 * a similar one.
 *
 * A build-time copy into `public/` rather than an import, so the map is fetched
 * only when a book is opened and refreshing it is this one command rather than a
 * rebuild.
 *
 * ⚠️ It goes stale. It is a snapshot of folder ids taken when
 * `update_drive_map.py` last ran in the other repo. A missing author degrades to
 * a Drive *search* link, which always works, so a stale map loses precision and
 * never correctness.
 *
 *     npm run sync:drive-map
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.resolve(ROOT, '../audiobook_catalog/author_drive_map.json');
const DEST = path.join(ROOT, 'apps/web/public/author-drive-map.json');

if (!existsSync(SOURCE)) {
  console.error(`No map at ${SOURCE}`);
  console.error('Generate it in audiobook_catalog with:  python scripts/update_drive_map.py');
  process.exit(1);
}

const parsed = JSON.parse(readFileSync(SOURCE, 'utf8'));
const entries = Object.keys(parsed).length;
if (entries === 0) {
  console.error('The map is empty. Refusing to overwrite a working one with nothing.');
  process.exit(1);
}

mkdirSync(path.dirname(DEST), { recursive: true });
copyFileSync(SOURCE, DEST);

console.log(`${entries} author folder(s) copied to apps/web/public/author-drive-map.json`);
console.log(`source last written ${statSync(SOURCE).mtime.toISOString().slice(0, 10)}`);
