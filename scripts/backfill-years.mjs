#!/usr/bin/env node
/**
 * Fill the two year columns — from the two different sources that are actually
 * true about them.
 *
 * ## ⚠️ The distinction this script exists to preserve
 *
 * `docs/info/openlibrary-ids.md` measured **108 of 116 EPUBs carrying a
 * four-digit `dc:date`** and named it as the free alternative to paying a model
 * to research 116 years. That is right about the cost and wrong about the
 * destination, and writing those 108 values into `work.first_published` would
 * have put a subtly wrong number in every one of them.
 *
 * **An EPUB's `dc:date` is the date of THAT FILE'S edition, not the work's first
 * publication.** The catalog proves it out of its own shelf:
 *
 *   | work | EPUB `dc:date` | what it actually is |
 *   |---|---|---|
 *   | Dragonsteel Prime | 2024 | a decades-old unpublished manuscript, released 2024 |
 *   | Firstborn / Defending Elysium | 2017 | a bind-up of two older stories |
 *
 * For most of this catalog — self-published LitRPG, where the ebook *is* the
 * first edition — the two coincide. That coincidence is exactly what makes the
 * error invisible, which is the shape §4.4 warns about: a wrong answer with
 * nothing to distinguish it from a right one.
 *
 * So:
 *
 *   **rung 1 — `edition.published_year` ← the EPUB's `dc:date`.** True by
 *   construction. It is a fact about the file, written to the row that *is* the
 *   file. This is the same correction the White Sand omnibus forced: a volume
 *   number is a fact about a printing, so it lives on the edition.
 *
 *   **rung 2 — `work.first_published` ← Open Library's `first_publish_year`.**
 *   The field that means what the column means, for the 50 works that carry an
 *   `openlibrary_work_id`. Sourced, not inferred.
 *
 * Neither rung guesses. A work with no OL id keeps a NULL `first_published`,
 * and the details queue goes on asking about it — which is the honest state.
 *
 *     npm run backfill:years -- --remote            # dry run, read the output
 *     npm run backfill:years -- --remote --commit
 */

import path from 'node:path';
import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { readEpub } from './lib/epub.mjs';

const flags = parseFlags();
const EBOOK_ROOT = process.env.EBOOK_ROOT || 'C:/Users/nbasl/OpenAudible/books';
const UA = 'library_catalog year backfill (+private household catalog)';

const works = query(
  `SELECT w.id, w.title, w.first_published, w.openlibrary_work_id,
          (SELECT e.id FROM edition e
            WHERE e.work_id = w.id AND e.source_url IS NOT NULL
            ORDER BY e.id LIMIT 1) AS edition_id,
          (SELECT e.source_url FROM edition e
            WHERE e.work_id = w.id AND e.source_url IS NOT NULL
            ORDER BY e.id LIMIT 1) AS source_url,
          (SELECT e.published_year FROM edition e
            WHERE e.work_id = w.id AND e.source_url IS NOT NULL
            ORDER BY e.id LIMIT 1) AS edition_year
     FROM work w
    ORDER BY w.id`,
  flags,
);

console.log(`${works.length} work(s) in the ${flags.remote ? 'REMOTE' : 'local'} database`);

const statements = [];
const stats = { fileYear: 0, fileAlready: 0, fileNone: 0, noFile: 0, ol: 0, olNone: 0, noId: 0, olAlready: 0, olLaterThanFile: 0 };
const disagree = [];
const laterThanFile = [];

/**
 * workId -> the year rung 1 just read out of the file.
 *
 * ⚠️ Rung 2 cannot compare against `edition_year` from the query above: on a
 * first run that column is NULL for every row, because rung 1 has only *queued*
 * the writes. Comparing against it silently produced an empty disagreement
 * report — the interesting output, reading as "nothing to see" when nothing had
 * been written yet.
 */
const fileYears = new Map();

// -- rung 1: the file's own date, onto the edition ---------------------------

for (const w of works) {
  if (!w.source_url || !w.edition_id) { stats.noFile++; continue; }
  if (w.edition_year != null) { stats.fileAlready++; continue; }
  let year = null;
  try {
    year = readEpub(path.join(EBOOK_ROOT, w.source_url), { cover: false })?.year ?? null;
  } catch {
    year = null;
  }
  if (!year) { stats.fileNone++; continue; }
  stats.fileYear++;
  fileYears.set(w.id, year);
  statements.push(`UPDATE edition SET published_year = ${lit(year)} WHERE id = ${lit(w.edition_id)};`);
}

// -- rung 2: Open Library's first_publish_year, onto the work ----------------

for (const w of works) {
  if (w.first_published != null) { stats.olAlready++; continue; }
  if (!w.openlibrary_work_id) { stats.noId++; continue; }
  let year = null;
  try {
    const key = String(w.openlibrary_work_id).replace(/^\/*(works\/)?/, '');
    const url = `https://openlibrary.org/search.json?q=key:/works/${key}&fields=key,first_publish_year`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) {
      const body = await res.json();
      const y = body?.docs?.[0]?.first_publish_year;
      if (Number.isInteger(y) && y > 1400 && y <= new Date().getFullYear() + 1) year = y;
    }
  } catch {
    year = null;
  }
  await new Promise((r) => setTimeout(r, 120)); // polite
  if (!year) { stats.olNone++; continue; }

  const fileYear = fileYears.get(w.id) ?? w.edition_year;

  // ⚠️⚠️ THE GUARD, and it exists because the first run of this script proved
  // the header's reasoning half wrong.
  //
  // The header argues Open Library's `first_publish_year` is the trustworthy
  // source for a *work* and the file's date is only its edition. That holds
  // right up until Open Library hands back a reissue's work record — which it
  // does, constantly, for this catalog:
  //
  //     Soulsmith    file 2016    OL "first published" 2023
  //     Skysworn     file 2017    OL "first published" 2023
  //     Wintersteel  file 2020    OL "first published" 2023
  //
  // Those are the 2023 Hidden Gnome reissues. It is the same duplicate-work
  // problem that made Skysworn a genuine tie between a 2023 record and a 2025
  // one — Open Library holds several work records per book and the year comes
  // from whichever one we matched.
  //
  // **A file we hold cannot predate the work's first publication.** So an OL
  // year LATER than the file's is not a first-publication date, whatever the
  // field is called, and writing it would put a knowably-wrong number in the
  // column. Refused, and counted.
  if (fileYear != null && year > fileYear) {
    stats.olLaterThanFile++;
    laterThanFile.push({ title: w.title, file: fileYear, ol: year });
    continue;
  }

  stats.ol++;
  // updated_at bump: without it this write is invisible to the shared-index
  // staleness backstop's data-aware check (apps/worker/src/lib/index-push.ts,
  // getLatestSourceUpdateAt) — the same class of gap the 2026-08-15 fix closed
  // for every OTHER writer of `work`.
  statements.push(
    `UPDATE work SET first_published = ${lit(year)}, updated_at = datetime('now') WHERE id = ${lit(w.id)};`,
  );

  // Surfaced, never auto-resolved. A file dated years AFTER first publication is
  // the ordinary reissue case, and the reason the two columns are separate.
  if (fileYear != null && Math.abs(fileYear - year) >= 2) {
    disagree.push({ title: w.title, file: fileYear, ol: year });
  }
}

console.log('');
console.log('rung 1 — edition.published_year, from the EPUB (a fact about the file)');
console.log(`  written from the file      ${stats.fileYear}`);
console.log(`  already had one            ${stats.fileAlready}`);
console.log(`  no date in the EPUB        ${stats.fileNone}`);
console.log(`  no file to read            ${stats.noFile}`);
console.log('');
console.log('rung 2 — work.first_published, from Open Library (a fact about the work)');
console.log(`  written from Open Library  ${stats.ol}`);
console.log(`  has an id, OL has no year  ${stats.olNone}`);
console.log(`  no Open Library id         ${stats.noId}  ← still a question for the queue`);
console.log(`  already had one            ${stats.olAlready}`);
console.log(`  ⚠️ REFUSED, OL later than the file we hold  ${stats.olLaterThanFile}`);

if (laterThanFile.length) {
  console.log('');
  console.log('   Refused — a file cannot predate first publication, so these OL');
  console.log('   records are reissues and their year is not a first-publication date:');
  for (const d of laterThanFile.slice(0, 12)) {
    console.log(`   ${d.title.slice(0, 46).padEnd(48)} file ${d.file}   OL claims ${d.ol}`);
  }
  if (laterThanFile.length > 12) console.log(`   … and ${laterThanFile.length - 12} more`);
}

if (disagree.length) {
  console.log('');
  console.log(`⚠️  ${disagree.length} work(s) where the file is 2+ years after first publication.`);
  console.log('   This is the reissue case, and the reason the two columns are separate:');
  for (const d of disagree.slice(0, 12)) {
    console.log(`   ${d.title.slice(0, 46).padEnd(48)} file ${d.file}   first published ${d.ol}`);
  }
  if (disagree.length > 12) console.log(`   … and ${disagree.length - 12} more`);
}

console.log('');
console.log(`${statements.length} statement(s)`);

if (!flags.commit) {
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.');
  process.exit(0);
}

execute(statements, flags);

// Confirm by re-reading; `execute` reports statements run, not rows changed.
const after = query(
  `SELECT (SELECT COUNT(published_year) FROM edition) AS edition_years,
          (SELECT COUNT(*) FROM edition) AS editions,
          (SELECT COUNT(first_published) FROM work) AS work_years,
          (SELECT COUNT(*) FROM work) AS works`,
  flags,
)[0];

console.log(
  `\n${statements.length} statement(s) run. ` +
    `${after.edition_years} of ${after.editions} edition(s) carry a published year; ` +
    `${after.work_years} of ${after.works} work(s) carry a first-published year.`,
);
