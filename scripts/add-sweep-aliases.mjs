/**
 * The nine pairs an AI sweep found that the mechanical matcher structurally cannot.
 *
 * ## Why a sweep, and why it is not a looser matcher
 *
 * `backfill-audiobook-holdings.mjs` asks `matchIndexedWork` about every work and
 * gets 79 live holdings out of 351. The remaining 272 are mostly honest misses —
 * we own no audiobook — but a handful are the *same book* under a name the fold
 * cannot bridge. The owner asked for those to be found by reading both catalogs
 * rather than by relaxing a threshold, which is the right instinct:
 * `matching.ts` opens with three wrong-game matches the sibling project shipped,
 * every one from a gate that was loosened. So nothing here changes a threshold.
 * Each entry below is one asserted string, offered as one extra question.
 *
 * ## The five shapes the sweep found (2026-08-14, 351 works × 1,077 audiobooks)
 *
 * | Shape | Example |
 * |---|---|
 * | marketing tail the cleaner does not know | `Sunrise on the Reaping` vs `… - A Hunger Games Novel` |
 * | genre subtitle, just under the 60% containment floor | `He Who Fights with Monsters` vs `…: A LitRPG Adventure` (26/45 = 0.58) |
 * | series prefix on OUR side | `Ascend Online: Legacy of the Fallen` vs `Legacy of the Fallen` |
 * | a parenthetical carrying a NUMBER | `The revenge of the Shadow King` vs `… (Grey Griffins #1)` — containment fits at 0.62 but `numbersAgree` rejects {} vs {1}, correctly |
 * | one word hyphenated differently | `A Deckbuilding LitRPG` vs `A Deck-Building LitRPG` |
 *
 * ⚠️ Every one of those rejections is CORRECT behaviour. The fold is not broken;
 * it is refusing to guess, and an alias is how a person answers instead.
 *
 * ## ⚠️ This script verifies through the matcher BEFORE it writes
 *
 * `add-audio-corroboration-aliases.mjs` shipped an alias that scored no match —
 * "All the Skills 5" — and only the *second* run found out, because the check was
 * a re-read of `work_alias` and a re-read cannot tell you whether the string
 * works. So every entry here is probed against `audiobookIndex()` first, and the
 * run refuses unless the probe lands on the exact audiobook row named in
 * `expectAudiobook`. A dry run therefore proves the alias, not just the plan.
 *
 * `source = 'manual'`, per migration 0001: a researched answer a re-import must
 * never delete.
 *
 * ## ⚠️ What the sweep deliberately did NOT alias
 *
 *   Legion 1, 2                audio has only the omnibus at rung 4
 *   Sixth of the Dusk,         collected in "Arcanum Unbounded", no standalone
 *     Shadows for Silence
 *   Divine Dungeon omnibus     audio has the five volumes, not the collection
 *   Tamer 2–6, 11              those volumes are not in the audiobook catalog
 *   Arcane Pathfinder 5        audio has 1–4
 *   Space Knight Book 1        both audio rows fold to bare "Space Knight" and
 *                              #250 already holds that alias — see
 *                              add-space-knight-alias.mjs, which refuses the
 *                              same thing for the same reason
 *   Wandering Inn part-twos    "No Killing Goblins" / "Immortal Games" are
 *                              print HALVES of audio books 1 and 2; owner's call
 *
 * An omnibus that contains a book is not that book. Aliasing any of these would
 * claim an audiobook the household does not separately own.
 *
 *   node scripts/add-sweep-aliases.mjs                    # dry run, local
 *   node scripts/add-sweep-aliases.mjs --remote           # dry run, REMOTE — read it
 *   node scripts/add-sweep-aliases.mjs --remote --commit
 *
 * Then re-run `npm run backfill:audiobooks -- --remote --commit`, which is what
 * asks under these aliases and writes the holding rows.
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { audiobookIndex, loadAudiobooks } from './lib/audiobooks.mjs';

const flags = parseFlags();

/**
 * One verified pair.
 *
 * `expectTitle` guards against a shifted id. `expectAudiobook` is the RAW title
 * of the audiobook row the probe must land on — raw rather than cleaned, because
 * that is what a person can look up in `catalog.csv` and check.
 */
const ENTRIES = [
  {
    workId: 36,
    expectTitle: "World's Only Hero",
    titleAlias: "World's Only Hero: An Apocalyptic LitRPG Adventure",
    expectAudiobook: "World's Only Hero: An Apocalyptic LitRPG Adventure",
    why: 'same author, same year (2026), our title is the audiobook title with its subtitle dropped',
  },
  {
    workId: 223,
    expectTitle: 'Ascend Online: Legacy of the Fallen',
    titleAlias: 'Legacy of the Fallen',
    expectAudiobook: 'Legacy of the Fallen - Ascend Online, Book 2',
    why: 'we print the series as a prefix; Ascend Online vol 2 on both sides, both 2018',
  },
  {
    workId: 235,
    expectTitle: 'Sunrise on the Reaping',
    titleAlias: 'Sunrise on the Reaping - A Hunger Games Novel',
    expectAudiobook: 'Sunrise on the Reaping - A Hunger Games Novel',
    why: 'Suzanne Collins, 2025 both sides; "- A Hunger Games Novel" is a marketing tail cleanAudiobookTitle does not strip (it knows "- A Novel" only)',
  },
  {
    workId: 263,
    expectTitle: 'Dungeon Crawler Carl',
    titleAlias: 'Dungeon Crawler Carl - A LitRPG/Gamelit Adventure',
    expectAudiobook: 'Dungeon Crawler Carl - A LitRPG/Gamelit Adventure',
    why: 'Matt Dinniman, Dungeon Crawler Carl vol 1 on both sides; the genre tail puts containment at 20/46 = 0.43, under the 0.6 floor',
  },
  {
    workId: 285,
    expectTitle: 'Ballad of Songbirds and Snakes',
    titleAlias: 'The Ballad of Songbirds and Snakes - A Hunger Games Novel',
    expectAudiobook: 'The Ballad of Songbirds and Snakes - A Hunger Games Novel',
    why: 'Suzanne Collins; same marketing tail as Sunrise on the Reaping, containment 29/50 = 0.58',
  },
  {
    workId: 307,
    expectTitle: 'The revenge of the Shadow King',
    titleAlias: 'The Revenge of the Shadow King (Grey Griffins #1)',
    expectAudiobook: 'The Revenge of the Shadow King (Grey Griffins #1)',
    why: 'Derek Benz & J. S. Lewis, Grey Griffins vol 1 both sides; containment fits at 0.62 but the parenthetical adds a NUMBER, so numbersAgree rejects — correctly',
  },
  {
    workId: 336,
    expectTitle: 'Rhapsody',
    titleAlias: 'Rhapsody - Child of Blood',
    expectAudiobook: 'Rhapsody - Child of Blood',
    why: 'Elizabeth Haydon, The Symphony of Ages vol 1 both sides; "Rhapsody: Child of Blood" is that volume\'s full printed title',
  },
  {
    workId: 341,
    expectTitle: 'He Who Fights with Monsters',
    titleAlias: 'He Who Fights with Monsters: A LitRPG Adventure',
    // ⚠️ The author alias is NOT optional here, and this is the only entry that
    // needs one. We file this volume as "Travis Deverell writing as Shirtaloon";
    // Audible files it as "Shirtaloon, Travis Deverell". Folded, our primary
    // author is the whole phrase, which scores 2*1/(5+1) = 0.33 against
    // "shirtaloon" — under MIN_AUTHOR_SIMILARITY, so the title alias alone would
    // be rejected by the author gate. Works 94–98 carry the identical alias for
    // the identical reason; this is volume 1 catching up with its siblings.
    authorAlias: 'Shirtaloon',
    expectAudiobook: 'He Who Fights with Monsters: A LitRPG Adventure - He Who Fights with Monsters, Book 1',
    why: 'HWFWM vol 1 both sides, 2021; containment misses by a hair at 26/45 = 0.58',
  },
  {
    workId: 356,
    expectTitle: 'All The Skills 3: A Deckbuilding LitRPG',
    titleAlias: 'All the Skills 3: A Deck-Building LitRPG',
    expectAudiobook: 'All the Skills 3: A Deck-Building LitRPG - All the Skills, Book 3',
    why: 'Honour Rae, All the Skills vol 3; the ONLY difference is "Deckbuilding" against "Deck-Building", which the fold cannot bridge and containment cannot either (neither string contains the other)',
  },
];

const q = (sql) => query(sql, { remote: flags.remote });

console.log(`\n${flags.remote ? 'REMOTE' : 'local'} database\n`);

const ids = ENTRIES.map((e) => e.workId).join(',');
const works = q(
  `SELECT id, title, authors, series, series_index_display AS vol FROM work WHERE id IN (${ids})`,
);
const byId = new Map(works.map((w) => [Number(w.id), w]));

const audiobooks = loadAudiobooks();
// ⚠️ Zero rows is a missing file, not an empty catalog — the same failure
// backfill-audiobook-holdings.mjs refuses to run through. Every probe below
// would "fail" identically and the run would look like nine bad aliases.
if (audiobooks.length === 0) {
  console.error(
    'No audiobook rows were read. That is a missing file, not an empty catalog.\n' +
      'Set LC_AUDIOBOOK_ROOT to the audiobook_catalog checkout and try again.\n',
  );
  process.exit(1);
}
const index = audiobookIndex(audiobooks);
console.log(`${audiobooks.length} audiobook row(s) read; ${works.length} of ${ENTRIES.length} work(s) found\n`);

const todo = [];
let refused = 0;

for (const e of ENTRIES) {
  const w = byId.get(e.workId);
  if (!w) {
    console.log(`  ⚠️ work ${e.workId} does not exist — refusing\n`);
    refused++;
    continue;
  }
  // ⚠️ Guard on the title, so a shifted id can never alias the wrong book.
  if (w.title !== e.expectTitle) {
    console.log(`  ⚠️ work ${e.workId} is "${w.title}", expected "${e.expectTitle}" — refusing\n`);
    refused++;
    continue;
  }

  console.log(`  work ${e.workId}  ${w.title}`);
  console.log(`     ${w.authors} · ${w.series ?? '(no series)'} vol ${w.vol ?? '-'}`);
  console.log(`     ${e.why}`);

  // ⚠️ The probe. Exactly the question backfill-audiobook-holdings.mjs will ask:
  // the alias offered as a title, and the author alias — when there is one — as
  // the author, because `attempts()` pairs them.
  const probeAuthor = e.authorAlias ?? w.authors;
  const hit = index.lookup(e.titleAlias, probeAuthor);

  if (!hit) {
    console.log(`     ⚠️ probe FAILED: lookup("${e.titleAlias}", "${probeAuthor}") found nothing — refusing\n`);
    refused++;
    continue;
  }
  if (hit.row.rawTitle !== e.expectAudiobook) {
    console.log(
      `     ⚠️ probe landed on the WRONG row: "${hit.row.rawTitle}"\n` +
        `        expected "${e.expectAudiobook}" — refusing\n`,
    );
    refused++;
    continue;
  }
  console.log(
    `     probe ok: ${hit.via}, sim ${hit.similarity.toFixed(2)} → "${hit.row.rawTitle}"` +
      ` (${hit.row.series ?? 'no series'} ${hit.row.seriesIndexDisplay ?? ''})`,
  );

  const wanted = [{ alias: e.titleAlias, kind: 'title' }];
  if (e.authorAlias) wanted.push({ alias: e.authorAlias, kind: 'author' });

  for (const a of wanted) {
    const existing = q(
      `SELECT id FROM work_alias WHERE work_id = ${lit(e.workId)} AND alias = ${lit(a.alias)} AND kind = ${lit(a.kind)}`,
    );
    console.log(
      `     + ${a.kind} alias "${a.alias}"${existing.length ? '  (already present — skipping)' : ''}`,
    );
    if (!existing.length) todo.push({ workId: e.workId, ...a });
  }
  console.log('');
}

console.log(`${todo.length} alias row(s) to add, ${refused} entr(ies) refused\n`);

if (!flags.commit) {
  console.log('DRY RUN. Nothing written. Re-run with --commit.\n');
  process.exit(refused ? 1 : 0);
}
if (refused) {
  console.log('Refusing to write while any entry failed its guard or its probe.\n');
  process.exit(1);
}
if (!todo.length) {
  console.log('Nothing to do.\n');
  process.exit(0);
}

execute(
  todo.map(
    (a) =>
      `INSERT INTO work_alias (work_id, alias, kind, source) VALUES ` +
      `(${lit(a.workId)}, ${lit(a.alias)}, ${lit(a.kind)}, 'manual');`,
  ),
  { remote: flags.remote },
);

const after = q(`SELECT work_id, alias, kind, source FROM work_alias WHERE work_id IN (${ids})`);
console.log('verified by re-reading:');
for (const r of after) {
  console.log(`  work ${r.work_id}  "${r.alias}"  kind=${r.kind} source=${r.source}`);
}
const ok = todo.every((a) =>
  after.some((r) => Number(r.work_id) === a.workId && r.alias === a.alias && r.kind === a.kind),
);
console.log(ok ? '\nAll aliases confirmed.\n' : '\n⚠️ Re-read does not match what was written.\n');
process.exit(ok ? 0 : 1);
