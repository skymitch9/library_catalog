#!/usr/bin/env node
/**
 * Check all cover URLs — both relative and absolute — and report broken ones.
 * Catches "image not available" placeholders: tiny files, 404s, non-image responses.
 */
import { query, parseFlags, ROOT } from './lib/d1.mjs';

const flags = parseFlags();
const BASE = process.argv.includes('--friend')
  ? 'https://padhard.heygabi.ai'
  : 'https://library.heygabi.ai';

const MIN_BYTES = 1000; // Below this is a placeholder, not a cover
const UA = 'library_catalog cover-health-check';

const rows = query(
  `SELECT id, title, cover_url FROM work WHERE cover_url IS NOT NULL AND cover_url <> '' ORDER BY id`,
  flags,
);

console.log(`Checking ${rows.length} cover(s) against ${BASE}...\n`);

const broken = [];
let checked = 0;

for (const r of rows) {
  const url = r.cover_url.startsWith('http') ? r.cover_url : `${BASE}${r.cover_url}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const ct = res.headers.get('content-type') || '';
    const size = parseInt(res.headers.get('content-length') || '0', 10);

    if (!res.ok) {
      broken.push({ ...r, reason: `HTTP ${res.status}`, url });
    } else if (!ct.startsWith('image/')) {
      broken.push({ ...r, reason: `not an image (${ct})`, url });
    } else if (size > 0 && size < MIN_BYTES) {
      broken.push({ ...r, reason: `${size}B placeholder`, url });
    }
  } catch (err) {
    broken.push({ ...r, reason: err.message?.slice(0, 50), url });
  }
  checked++;
  if (checked % 50 === 0) process.stdout.write(`  ${checked}/${rows.length}...\n`);
}

console.log(`\nChecked: ${checked}`);
console.log(`Broken:  ${broken.length}`);
if (broken.length > 0) {
  console.log('\nBroken covers:');
  for (const b of broken) {
    console.log(`  ${String(b.id).padStart(4)}  ${b.title.slice(0, 40).padEnd(40)}  ${b.reason}`);
  }
}
