/**
 * Create the printing a pledge delivered, for lines that matched a work but no
 * edition.
 *
 * ## Why the importer would not do this itself
 *
 * `import-crowdfunding.mjs` deliberately mints no `edition`: a reward name is a
 * campaign's marketing copy, and "a format hint is a claim about a printing".
 * Turning every hint into a row would fill the column that `PHYSICAL_FORMATS`
 * filters on with invented facts.
 *
 * That refusal is right, and it left 10 lines with `edition_id NULL`. This
 * script closes the ones that can be closed **without inventing anything**.
 *
 * ## ⚠️ The rule: only where the hint NAMES a format
 *
 * The decision is delegated to `suggestFormat` in `@lc/core` — the same
 * proposer the importer already prints — rather than to a judgement made here.
 * It answers `hardcover` for "Year of Sanderson premium hardcover" and **null**
 * for "Collector's Edition", because a collector's edition is usually a
 * hardcover and *usually* is not a fact. Anything it declines is left for a
 * person, and now that editions are editable in the app that is a cheap wait.
 *
 * Signed/numbered wording is reported, never written. `copy.is_signed` is a
 * claim about the physical object in the house, which this script cannot see.
 *
 *   node scripts/create-pledge-editions.mjs --remote
 *   node scripts/create-pledge-editions.mjs --remote --commit
 */

import { classifyEdition, rewardFlags, suggestFormat } from '../packages/core/src/crowdfunding.ts';
import { execute, parseFlags, query } from './lib/d1.mjs';

const { commit, remote } = parseFlags();
const sql = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const lines = query(
  `SELECT pi.id AS id, pi.work_id AS workId, pi.format_hint AS hint,
          w.title AS title, c.name AS campaign
     FROM pledge_item pi
     JOIN work w ON w.id = pi.work_id
     JOIN crowdfunding_pledge p ON p.id = pi.pledge_id
     JOIN crowdfunding_campaign c ON c.id = p.campaign_id
    WHERE pi.edition_id IS NULL
      AND (pi.edition_verdict IS NULL OR pi.edition_verdict = '')
    ORDER BY pi.id`,
  { remote },
);

const doable = [];
const declined = [];
for (const l of lines) {
  const format = suggestFormat(l.hint);
  // ⚠️ Read off the SAME reward prose the format comes from, and answering a
  // different question about it — `suggestFormat` says what the object is made
  // of, `classifyEdition` says whether it was sold as better than standard.
  // "Collector's Edition Trilogy — Book 1 Signed & Numbered" is a hardcover AND
  // a collector's edition, and both facts come out of one string. Migration 0050.
  (format ? doable : declined).push({ ...l, format, kind: classifyEdition(l.hint) });
}

console.log(`\n${remote ? 'production' : 'local'}: ${lines.length} line(s) with no printing`);
console.log(`\ncan create (${doable.length}) — the hint names a format:`);
for (const l of doable) {
  const flags = rewardFlags?.(l.hint) ?? null;
  const note = flags && (flags.signed || flags.numbered) ? '   ⚠️ says signed/numbered' : '';
  const kind = l.kind ? `   [${l.kind}]` : '';
  console.log(`  ${String(l.id).padStart(3)}  ${l.format.padEnd(10)} ${l.title.slice(0, 42)}${note}${kind}`);
}
console.log(`\nleft for a person (${declined.length}) — the hint names no format:`);
for (const l of declined) console.log(`  ${String(l.id).padStart(3)}  ${l.title.slice(0, 34)}  "${l.hint}"`);

if (!commit) {
  console.log('\nDry run. Re-run with --commit to write.');
  process.exit(0);
}
if (doable.length === 0) process.exit(0);

// One edition per line, carrying the reward name so the printing is traceable
// back to the campaign that delivered it.
execute(
  doable.map(
    (l) =>
      `INSERT INTO edition (work_id, format, edition_name, edition_kind, source, source_url)
       VALUES (${l.workId}, ${sql(l.format)}, ${sql(l.hint)}, ${sql(l.kind)}, 'manual', NULL);`,
  ),
  { remote },
);

// Attach each new edition back to the line that justified it.
const made = query(
  `SELECT id, work_id AS workId, edition_name AS name FROM edition
    WHERE edition_name IN (${[...new Set(doable.map((l) => sql(l.hint)))].join(',')})`,
  { remote },
);
const byWork = new Map();
for (const e of made) if (!byWork.has(`${e.workId}|${e.name}`)) byWork.set(`${e.workId}|${e.name}`, e.id);

execute(
  doable
    .map((l) => ({ l, editionId: byWork.get(`${l.workId}|${l.hint}`) }))
    .filter((x) => x.editionId)
    .map((x) => `UPDATE pledge_item SET edition_id = ${x.editionId} WHERE id = ${x.l.id};`),
  { remote },
);

/* ⚠️ Confirm by re-reading — `execute` returns statements run, not rows changed. */
const left = query(
  `SELECT COUNT(*) AS n FROM pledge_item
    WHERE edition_id IS NULL AND (edition_verdict IS NULL OR edition_verdict = '')`,
  { remote },
);
console.log(`\nwrote ${doable.length} edition(s). ${left[0]?.n} line(s) still without a printing.`);
if (Number(left[0]?.n ?? 0) !== declined.length) {
  console.log('⚠️ Expected exactly the declined ones to remain. Investigate before re-running.');
}
