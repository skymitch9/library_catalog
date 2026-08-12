/**
 * Borrow cover art from the sibling audiobook catalog for print rows that have none.
 *
 * ## Why this exists now
 *
 * Roughly thirty works were created by script on 2026-08-11/12 — the Grimoire
 * hardcovers, Tamer, Space Knight, the four missing Dragoneye volumes, DCC book
 * one. A raw INSERT bypasses the cover pipeline entirely, so every one of them
 * landed with `cover_url` NULL. The catalog went from 6 coverless works to 32.
 *
 * Most of them do not need a lookup at all: the household owns the same book on
 * audio, and `audiobook_catalog/site/catalog.csv` already carries a `cover_href`
 * for it. Measured: **21 of 32 reachable**, at zero cost and with no guessing.
 *
 * ## ⚠️ Every one is written as a STAND-IN, and that is the point
 *
 * An audiobook jacket is not the print jacket. A faux-leather Grimoire edition
 * looks nothing like the Audible art, and a signed paperback rarely matches
 * either. So each row is written with:
 *
 *     cover_url    = the audiobook's cover, absolute, on the audiobook R2 host
 *     cover_status = 'standin'
 *
 * `'standin'` means the picture shows AND the book stays on the "Cover needed"
 * list — `coverNeeded` in `@lc/core` treats it as outstanding. This is the exact
 * mechanism the five Percy Jackson rows already use, chosen by the owner:
 * *"use the marketing image now but put a label on them."* A blank slot tells
 * you nothing; a labelled stand-in tells you what the book is AND that the
 * jacket is still wrong.
 *
 * ⚠️ Never write these as `cover_status = 'ok'`. That would quietly assert the
 * print jacket is correct and remove the only prompt to fix it.
 *
 * ## Matching
 *
 * Series + volume first, because it is exact. Falls back to a normalised title
 * match, and only when the audiobook title EQUALS ours or begins with ours plus
 * a space — so "Space Knight Book 1" cannot match "Space Knight Book 10".
 *
 *   node scripts/covers-from-audiobooks.mjs                 # dry run
 *   node scripts/covers-from-audiobooks.mjs --remote --commit
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { ROOT } from './lib/d1.mjs';

const flags = parseFlags();
const q = (sql) => query(sql, { remote: flags.remote });

const CSV = process.env.CATALOG_CSV ?? path.resolve(ROOT, '../audiobook_catalog/site/catalog.csv');
// The sibling's own bucket. ⚠️ NOT bookcovers.heygabi.ai — that one is this
// repo's bucket; a custom domain belongs to exactly one bucket and mixing them
// 404s every image.
const BASE = 'https://covers.heygabi.ai/';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** catalog.csv has quoted, multi-line description fields — split it properly. */
function readCsv(file) {
  const text = readFileSync(file, 'utf8');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const audio = readCsv(CSV).filter((a) => a.cover_href);
const bySeriesVol = new Map();
const byTitle = new Map();
for (const a of audio) {
  if (a.series && a.series_index_sort) bySeriesVol.set(`${norm(a.series)}|${Number(a.series_index_sort)}`, a);
  const k = norm(a.title);
  if (!byTitle.has(k)) byTitle.set(k, a);
}

const works = q(
  `SELECT DISTINCT id, title, series, CAST(series_index_sort AS REAL) idx
     FROM work WHERE cover_url IS NULL ORDER BY title`,
);

const plan = [];
const unreachable = [];
for (const w of works) {
  let a = null;
  let how = '';
  if (w.series && w.idx != null) {
    a = bySeriesVol.get(`${norm(w.series)}|${Number(w.idx)}`);
    if (a) how = 'series+volume';
  }
  if (!a) {
    const t = norm(w.title);
    for (const [k, v] of byTitle) {
      // ⚠️ Equality or a prefix followed by a SPACE. A bare startsWith would
      // let "Space Knight Book 1" claim "Space Knight Book 10".
      if (t && (k === t || k.startsWith(t + ' '))) { a = v; how = 'title'; break; }
    }
  }
  if (!a) { unreachable.push(w); continue; }
  const href = String(a.cover_href).replace(/^covers\//, '');
  plan.push({ id: Number(w.id), title: w.title, how, audioTitle: a.title, url: BASE + href.split('/').map(encodeURIComponent).join('/') });
}

console.log(`\n${flags.remote ? 'REMOTE' : 'local'} — ${works.length} works with no cover`);
console.log(`  reachable from the audiobook catalog : ${plan.length}`);
console.log(`  not reachable                        : ${unreachable.length}\n`);
for (const p of plan) console.log(`  [${p.how.padEnd(13)}] ${p.title.slice(0, 40).padEnd(42)} <- ${p.audioTitle.slice(0, 40)}`);
if (unreachable.length) {
  console.log('\n  NOT REACHABLE — these still need a human:');
  for (const w of unreachable) console.log(`     ${w.id}  ${w.title}`);
}

if (!flags.commit) { console.log('\nDRY RUN. Nothing written. Re-run with --commit.\n'); process.exit(0); }
if (!plan.length) { console.log('Nothing to do.\n'); process.exit(0); }

// ⚠️ cover_url and cover_status are written TOGETHER, always. A url without a
// status reads as "nobody has looked", which is the opposite of the truth here.
execute(
  plan.map(
    (p) =>
      `UPDATE work SET cover_url = ${lit(p.url)}, cover_status = 'standin', updated_at = datetime('now')
        WHERE id = ${p.id} AND cover_url IS NULL;`,
  ),
  { remote: flags.remote },
);

const after = q(
  `SELECT COUNT(*) AS still_blank FROM work WHERE cover_url IS NULL`,
);
const standins = q(`SELECT COUNT(*) AS n FROM work WHERE cover_status = 'standin'`);
console.log(`\nverified by re-reading:`);
console.log(`  works with no cover at all : ${after[0]?.still_blank}`);
console.log(`  stand-ins on record        : ${standins[0]?.n}  (all still on the "Cover needed" list)`);
