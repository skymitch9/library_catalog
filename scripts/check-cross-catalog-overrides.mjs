#!/usr/bin/env node
/**
 * Hold this database to the hand-reviewed cross-catalog joins.
 *
 * ## ⚠️ THIS IS THE CHECK THAT STOPS A DEAD LINK SHIPPING, and only this repo
 * ## can make it
 *
 * `audiobook_catalog/site/cross-catalog-overrides.json` names library work ids.
 * That repo renders them as `https://library.heygabi.ai/work/<id>` and CANNOT
 * ask whether the work exists — it has no reach into this database. A wrong id
 * over there is a live link to a "Not a page" screen with nothing failing
 * anywhere. So the existence check lives here, and the file's own `_README`
 * says so in as many words.
 *
 *     npm run check:cross-links              # against the local database
 *     npm run check:cross-links -- --remote  # against MAIN production
 *
 * ⚠️ `--remote` is the one that matters. The local database is a dev copy with
 * 117 works, so a check against it reports every id above that as unknown and
 * proves nothing. It is still worth running: a SHAPE error in the file fails
 * before any query.
 *
 * ## 🔴 `--friend` IS REFUSED, and the reason is a wrong answer, not a missing one
 *
 * **Work ids are per-instance.** The two deployments are two separate D1
 * databases whose ids were allocated independently, and they collide with
 * completely different books. Measured 2026-09-02:
 *
 *   id   MAIN (library.heygabi.ai)   FRIEND (padhard.heygabi.ai)
 *   229  The Wandering Inn           Divine Rivals
 *   230  No Killing Goblins          Ruthless Vows
 *   231  Fae and Fare                River Enchanted Deluxe Collector's Edition
 *   232  Immortal Games              Priory of the Orange Tree
 *
 * So a `--friend` run would find four works that exist, holding no matching
 * audiobook, and report four UNRESOLVED pairs — a failure about books nobody
 * curated. Worse, if padhard ever did hold an audiobook at one of those ids it
 * would report RESOLVED, which is a green tick for a link to the wrong book.
 *
 * The overrides file names MAIN's ids because the audiobook site links to
 * `library.heygabi.ai` and only there (`site/library-link.js` `LIBRARY_ORIGIN`).
 * A padhard-facing set of curated links would be a DIFFERENT file with
 * different ids, and is not built — nobody has asked for one.
 *
 * ## The three verdicts, and why they are kept apart
 *
 * `checkCuratedLinks` in `scripts/lib/cross-catalog-overrides.mjs` explains
 * each. Briefly: an UNKNOWN id is a dead link shipping now; an UNRESOLVED pair
 * is a reviewed link that this side renders nothing for (usually a deleted
 * `work_alias`, or a sweep that has not been re-run); RESOLVED is the clean
 * state. Collapsing them into "broken" is how the wrong one gets fixed.
 *
 * ⚠️ **Exits non-zero on either failure, and on a file it could not read.** A
 * missing sibling checkout is NOT "all clear" — it is "the check did not run",
 * and a script that cannot tell those apart is worse than no script. This is
 * the same rule `loadAudiobooks()`'s zero-row guard states one file over.
 *
 * ⚠️ NOT wired into `npm test`, on purpose. The real check needs `--remote`,
 * and a unit suite that reaches production is a suite nobody can run offline.
 * `scripts/test/cross-catalog-overrides.test.mjs` covers the pure logic; this
 * is the instrument you point at a live database, by hand or before a deploy.
 */

import { existsSync } from 'node:fs';

import { parseFlags, query } from './lib/d1.mjs';
import {
  OVERRIDES_PATH,
  checkCuratedLinks,
  loadCuratedOverrides,
} from './lib/cross-catalog-overrides.mjs';

const flags = parseFlags();
const where = flags.remote ? 'REMOTE (main)' : 'local';

// 🔴 See the header. A --friend run does not fail to answer; it answers about
// four different books. Refusing is the only honest option.
if (flags.friend) {
  console.error(
    '\n--friend is refused. Work ids are per-instance and the two databases collide\n' +
      'with different books: on padhard, 229-232 are Divine Rivals, Ruthless Vows,\n' +
      "River Enchanted and Priory of the Orange Tree (measured 2026-09-02). This file\n" +
      'names MAIN ids, because the audiobook site links to library.heygabi.ai only.\n' +
      'A --friend run would report a verdict about books nobody curated.',
  );
  process.exit(2);
}

if (!existsSync(OVERRIDES_PATH)) {
  console.error(
    `\nThe overrides file was not read:\n  ${OVERRIDES_PATH}\n\n` +
      'That is "the check did not run", not "nothing is wrong". Point\n' +
      'LC_AUDIOBOOK_ROOT at the audiobook_catalog checkout and try again.',
  );
  process.exit(1);
}

const overrides = loadCuratedOverrides();
console.log(`${overrides.length} curated pair(s) read from ${OVERRIDES_PATH}`);
if (overrides.length === 0) {
  console.log('Nothing to check.');
  process.exit(0);
}

const ids = [...new Set(overrides.map((o) => o.libraryWorkId))];
const idList = ids.join(',');
const works = query(`SELECT id FROM work WHERE id IN (${idList})`, flags);
const holdings = query(
  `SELECT work_id, audio_key, stale_at FROM audiobook_edition_holding WHERE work_id IN (${idList})`,
  flags,
);

const { unknownWorkId, unresolved, resolved } = checkCuratedLinks(overrides, works, holdings);

console.log(
  `\n${where}: ${resolved.length} resolved, ${unresolved.length} unresolved, ` +
    `${unknownWorkId.length} unknown work id(s)\n`,
);

for (const o of resolved) {
  console.log(`  ok        work ${o.libraryWorkId} <-> ${o.audiobookTitle}`);
}
for (const o of unresolved) {
  console.log(`  UNRESOLVED work ${o.libraryWorkId} (${o.libraryTitle}) holds no live audiobook row for`);
  console.log(`             ${o.audiobookTitle}`);
}
for (const o of unknownWorkId) {
  console.log(`  DEAD LINK  work ${o.libraryWorkId} does not exist — ${o.libraryTitle || o.audiobookTitle}`);
}

if (unknownWorkId.length) {
  console.error(
    `\n🔴 ${unknownWorkId.length} curated pair(s) name a work that does not exist. The audiobook\n` +
      'site is linking to a "Not a page" screen for each of them right now. Fix the\n' +
      `ids in ${OVERRIDES_PATH}, or add the works.`,
  );
}
if (unresolved.length) {
  console.error(
    `\n🟠 ${unresolved.length} reviewed pair(s) resolve in NEITHER direction from this side. The\n` +
      'work page renders no audiobook for them. The usual causes, in order: a\n' +
      "`work_alias` row was deleted, or `npm run backfill:audiobooks` has not been\n" +
      'run since the sibling catalogue changed.',
  );
}

process.exit(unknownWorkId.length || unresolved.length ? 1 : 0);
