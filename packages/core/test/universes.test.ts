/**
 * The shared universe list, as this repo sees it.
 *
 * Two jobs, and the second is the interesting one:
 *
 *  1. pin the lookup — resolution order, normalisation, the three cases that
 *     prove a series-keyed mapping is insufficient;
 *  2. ⚠️ prove this repo and audiobook_catalog agree, by running the SAME
 *     fixture file both of them run. There is no shared runtime between a
 *     Cloudflare Worker and a Python static build, so there is no shared
 *     implementation — the fixtures are the whole contract.
 *
 * The data is not in this repo. `scripts/sync-universes.mjs` (wired as
 * `pretest`) materialises it from catalog-platform. If these tests cannot find
 * it, read that script's output: it names CATALOG_PLATFORM_DIR and every path
 * it tried.
 *
 * Lives in packages/core/test/ because that is where `npm test` looks
 * (`tsx --test packages/core/test/*.test.ts`); the code under test is
 * packages/universes.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  canonicalUniverseName,
  membersOf,
  normaliseUniverseText,
  resolveUniverseName,
  universeAsserted,
  universeFor,
  universeIndex,
  universeMemberIds,
  universeNames,
  universeOnCreate,
  universeOnUpdate,
  universeTally,
  universesDocument,
  assertSchemaVersion,
  type UniverseAssignment,
} from '../../universes/src/index.ts';
import { platformPaths, resolvePlatformRepo } from '../../../scripts/lib/platform-repo.mjs';

const GENERATED = join(import.meta.dirname, '..', '..', 'universes', 'generated');

const fixtures = JSON.parse(readFileSync(join(GENERATED, 'universes.fixtures.json'), 'utf8')) as {
  cases: Array<{ name: string; title?: string; series?: string; expect: string | null }>;
  canonicalNameCases: Array<{ input: string; expect: string | null }>;
};

const look = (title: string | null, series: string | null) => universeFor(universeIndex, { title, series });

/* -------------------------------------------------------------------------- *
 * The shared contract
 * -------------------------------------------------------------------------- */

describe('⚠️ the fixtures both catalogs run — the only thing stopping the two lookups drifting', () => {
  for (const c of fixtures.cases) {
    it(c.name, () => {
      assert.equal(look(c.title ?? null, c.series ?? null), c.expect ?? null);
    });
  }

  for (const c of fixtures.canonicalNameCases) {
    it(`canonical name: ${c.input}`, () => {
      assert.equal(canonicalUniverseName(universeIndex, c.input), c.expect ?? null);
    });
  }

  it('the fixture file is not empty, so a truncated copy cannot pass by vacuum', () => {
    assert.ok(fixtures.cases.length >= 15, `only ${fixtures.cases.length} lookup cases`);
    assert.ok(fixtures.canonicalNameCases.length >= 5);
  });
});

/* -------------------------------------------------------------------------- *
 * ⚠️ The three cases that decide the design, asserted by name
 *
 * They are already inside the fixtures. They are repeated here on purpose: a
 * fixture file can be edited, and these three are the reason the file has the
 * shape it has. If one of these ever fails, the answer is not to change the test.
 * -------------------------------------------------------------------------- */

describe('⚠️ the three cases that prove a series-keyed lookup is insufficient', () => {
  it('Secret Projects is MIXED — four members are Cosmere', () => {
    assert.equal(look('Tress of the Emerald Sea', ''), 'The Cosmere');
    assert.equal(look('Yumi and the Nightmare Painter', ''), 'The Cosmere');
    assert.equal(look('The Sunlit Man', ''), 'The Cosmere');
    assert.equal(look('Isles of the Emberdark', ''), 'The Cosmere');
  });

  it('Secret Projects is MIXED — the fifth is not, and that single row is the proof', () => {
    assert.equal(look('The Frugal Wizard’s Handbook for Surviving Medieval England', ''), null);
  });

  it('⚠️ the exclusion survives a CURLY apostrophe, which is how the real row is stored', () => {
    // site/catalog.csv holds U+2019. A lookup that does not fold it returns the
    // wrong answer on the one row the whole design rests on, and nowhere else.
    assert.equal(look('The Frugal Wizard’s Handbook for Surviving Medieval England', ''), null);
    assert.equal(look("The Frugal Wizard's Handbook for Surviving Medieval England", ''), null);
  });

  it('⚠️ "Secret Projects" as a SERIES resolves to nothing — it must never be in a series list', () => {
    assert.equal(look('Any Book At All', 'Secret Projects'), null);
  });

  it('the Otherlife trilogy has no series value, so only a per-book override finds it', () => {
    assert.equal(look('Otherlife Dreams - The Selfless Hero Trilogy', ''), 'Runnerverse');
    assert.equal(look('Otherlife Nightmares - The Selfless Hero Trilogy', ''), 'Runnerverse');
    assert.equal(look('Otherlife Awakenings - The Selfless Hero Trilogy', ''), 'Runnerverse');
    assert.equal(look('', 'The Selfless Hero Trilogy'), null, 'the series does not exist in the data yet');
  });

  it('Fires of December is a seriesless standalone that IS Cosmere', () => {
    assert.equal(look('Fires of December', ''), 'The Cosmere');
    assert.equal(look('Fires of December', null), 'The Cosmere');
  });
});

/* -------------------------------------------------------------------------- *
 * Resolution order and normalisation
 * -------------------------------------------------------------------------- */

describe('resolution order', () => {
  it('an exclusion beats a series that would otherwise claim the row', () => {
    // ⚠️ Rewritten 2026-08-15 alongside the fixture of the same name. It was
    // Lux with series 'The Stormlight Archive'; Lux stopped being an exclusion
    // when the owner approved the Reckoners universe (an exclusion is a GLOBAL
    // stop, so it would have blocked Reckoners' own claim on that row). The
    // Frugal Wizard is the exclusion this mechanism was built for.
    assert.equal(look('The Frugal Wizard’s Handbook for Surviving Medieval England', 'The Stormlight Archive'), null);
  });

  it('an override beats a series belonging to a different universe', () => {
    assert.equal(look('Warbreaker', 'Zodiac Academy'), 'The Cosmere');
  });

  it('a series answers when the title says nothing', () => {
    assert.equal(look('Some Book Nobody Listed', 'Crescent City'), 'Maasverse');
  });

  it('null is the ordinary answer, not an error', () => {
    assert.equal(look('Unknown', 'Unknown'), null);
    assert.equal(look('', ''), null);
    assert.equal(look(null, null), null);
  });

  it('⚠️ titles match exactly — substring matching would break The Hope of Elantris', () => {
    // Both are real overrides. A prefix or contains match makes one of them
    // shadow the other and the failure is invisible.
    assert.equal(look('Elantris', ''), 'The Cosmere');
    assert.equal(look('The Hope of Elantris', ''), 'The Cosmere');
    assert.equal(look('Elantris: The Annotated Edition', ''), null);
  });

  it('notSeries never returns a universe — it records a refusal', () => {
    // ⚠️ Reckoners and The Skyward Series became universes of their own on
    // 2026-08-15 (owner-approved), so those two rows now resolve — and that
    // does NOT overturn the refusal being tested here. The Cosmere's notSeries
    // still lists both, and 'not Cosmere' is what it claims; the assertion is
    // that notSeries never RETURNS The Cosmere, so it is stated that way now.
    assert.notEqual(look('Steelheart', 'Reckoners'), 'The Cosmere');
    assert.notEqual(look('Skyward', 'The Skyward Series'), 'The Cosmere');
    // Legion is claimed by nothing at all, so it still pins the plain null.
    assert.equal(look('Legion', 'Legion'), null);
  });
});

describe('normalisation', () => {
  it('folds case, whitespace and curly quotes', () => {
    assert.equal(normaliseUniverseText('  The   COSMERE '), 'the cosmere');
    assert.equal(normaliseUniverseText('Monster’s Mercy'), "monster's mercy");
    assert.equal(normaliseUniverseText(null), '');
    assert.equal(normaliseUniverseText(undefined), '');
  });

  it('matches a series written with different spacing and case', () => {
    assert.equal(look('', '  the   stormlight ARCHIVE '), 'The Cosmere');
  });

  it("folds an apostrophe inside a series name — Monster's Mercy, Artorian's Archives", () => {
    assert.equal(look('', 'Monster’s Mercy'), 'Runnerverse');
    assert.equal(look('', 'Artorian’s Archives'), 'CAL Verse');
  });
});

/* -------------------------------------------------------------------------- *
 * Canonical names
 * -------------------------------------------------------------------------- */

describe("canonical names — the owner's spellings win", () => {
  it('Cosmere normalises to The Cosmere', () => {
    assert.equal(canonicalUniverseName(universeIndex, 'Cosmere'), 'The Cosmere');
    assert.equal(canonicalUniverseName(universeIndex, 'cosmere'), 'The Cosmere');
  });

  it('Arand multiverse renames to Runnerverse', () => {
    assert.equal(canonicalUniverseName(universeIndex, 'Arand multiverse'), 'Runnerverse');
    assert.equal(canonicalUniverseName(universeIndex, 'ARANDVERSE'), 'Runnerverse');
  });

  it('an unknown name returns null rather than a guess', () => {
    // ⚠️ 'Cytoverse' was the example here until 2026-08-15, when the owner
    // approved it as a universe. 'Skyward universe' replaces it and is the
    // better test: it is the name a reader would most plausibly guess, because
    // 'The Skyward Series' is Cytoverse's only claimed series.
    assert.equal(canonicalUniverseName(universeIndex, 'Skyward universe'), null);
    assert.equal(canonicalUniverseName(universeIndex, ''), null);
  });

  it('the prose comment keys in the map are not treated as aliases', () => {
    assert.equal(canonicalUniverseName(universeIndex, '_note'), null);
    assert.equal(canonicalUniverseName(universeIndex, '_namespace'), null);
  });

  it('every universe name resolves to itself', () => {
    for (const name of universeNames) {
      assert.equal(canonicalUniverseName(universeIndex, name), name);
    }
  });
});

/* -------------------------------------------------------------------------- *
 * Applying the list to rows — what the UI is built on
 *
 * ⚠️ These are NOT part of the two-repo contract; `catalog.ts` is a caller of
 * the lookup, not a twin of anything in the Python. What they pin is the pair
 * of rules the screens depend on: absence is ordinary and is never counted, and
 * a filter and the count labelling it come from one function.
 * -------------------------------------------------------------------------- */

describe('universes over catalog rows', () => {
  /**
   * Six rows standing in for the shapes this catalog actually holds: a series
   * match, a title override with no series at all, a title override that
   * carries an unrelated series, an exclusion sitting next to the titles that
   * would otherwise sweep it in, and two ordinary books in no universe.
   */
  const rows = [
    { id: 1, title: 'The Way of Kings', series: 'The Stormlight Archive' },
    { id: 2, title: 'Sixth of the Dusk', series: null },
    { id: 3, title: 'Tress of the Emerald Sea', series: 'Secret Projects' },
    { id: 4, title: 'The Frugal Wizard’s Handbook for Surviving Medieval England', series: 'Secret Projects' },
    { id: 5, title: 'Dungeon Born', series: 'The Divine Dungeon' },
    { id: 6, title: 'The Very Hungry Caterpillar', series: null },
  ];

  it('collects the ids of one universe, across series and standalones alike', () => {
    // 1 by series, 2 and 3 by title — and 3 proves a book can be in a universe
    // while its own series is in none of them.
    assert.deepEqual(universeMemberIds(universeIndex, rows, 'The Cosmere'), [1, 2, 3]);
    assert.deepEqual(universeMemberIds(universeIndex, rows, 'CAL Verse'), [5]);
  });

  it('⚠️ an exclusion is left out, so the same row cannot be filtered in and counted out', () => {
    assert.ok(!universeMemberIds(universeIndex, rows, 'The Cosmere').includes(4));
  });

  it('a universe this catalog holds nothing from is an empty list, never everything', () => {
    assert.deepEqual(universeMemberIds(universeIndex, rows, 'Maasverse'), []);
    // A name that is not a universe at all also collects nothing. The caller
    // decides whether that means "no filter" — see `resolveUniverseName`.
    assert.deepEqual(universeMemberIds(universeIndex, rows, 'Cytoverse'), []);
  });

  it('the tally agrees with the ids, because one function answers both', () => {
    const tally = universeTally(universeIndex, rows, universeNames);
    for (const { name, count } of tally) {
      assert.equal(count, universeMemberIds(universeIndex, rows, name).length, name);
    }
  });

  it('⚠️ every universe is counted, zeroes included, so a control cannot come and go', () => {
    const tally = universeTally(universeIndex, rows, universeNames);
    assert.deepEqual(tally.map((t) => t.name), universeNames);
    assert.deepEqual(
      tally.filter((t) => t.count === 0).map((t) => t.name),
      // Cytoverse and Reckoners join the zero list 2026-08-15: neither is
      // represented in this test's six synthetic rows, and that is exactly what
      // the assertion is for — a new universe must show as a counted zero, not
      // vanish from the tally.
      [
        'Runnerverse',
        'Maasverse',
        'Riordanverse',
        'Solaria',
        'Willverse',
        'Marvel',
        'Disney',
        'Star Wars',
        'Alliances',
        'Cytoverse',
        'Reckoners',
        'Middle-earth',
        'Dungeon Crawler Carl',
        'Innworld',
      ],
    );
  });

  it('⚠️ nothing counts the books in NO universe — absence here is ordinary, not a gap', () => {
    const tally = universeTally(universeIndex, rows, universeNames);
    const counted = tally.reduce((n, t) => n + t.count, 0);
    // Two of the six rows are in no universe (the exclusion and the picture
    // book) and neither appears anywhere in the answer. A "none" bucket would
    // put a worklist on screen made of correctly filed books.
    assert.equal(counted, 4);
    assert.ok(!tally.some((t) => t.name === '' || t.name.toLowerCase().includes('none')));
  });

  it('a row with neither a title nor a series is simply in no universe', () => {
    assert.deepEqual(
      universeTally(universeIndex, [{ id: 9 }], universeNames).filter((t) => t.count > 0),
      [],
    );
  });

  it('resolveUniverseName folds a spelling, and refuses to guess', () => {
    assert.equal(resolveUniverseName(universeIndex, universeNames, 'cosmere'), 'The Cosmere');
    assert.equal(resolveUniverseName(universeIndex, universeNames, '  THE   Cosmere '), 'The Cosmere');
    // ⚠️ 'Cytoverse' stood here as the unknown name until 2026-08-15, when the
    // owner approved it. 'Skyward universe' replaces it — the most plausible
    // wrong guess, since 'The Skyward Series' is Cytoverse's only claim.
    assert.equal(resolveUniverseName(universeIndex, universeNames, 'Skyward universe'), null);
    assert.equal(resolveUniverseName(universeIndex, universeNames, ''), null);
    assert.equal(resolveUniverseName(universeIndex, universeNames, null), null);
  });

  it('a canonical name resolves even if no alias was ever written for it', () => {
    // The fallback, not the alias map: `names` is the whole vocabulary here.
    assert.equal(resolveUniverseName(universeIndex, ['Cytoverse'], 'cytoverse'), 'Cytoverse');
    for (const name of universeNames) {
      assert.equal(resolveUniverseName(universeIndex, universeNames, name), name);
    }
  });
});

/* -------------------------------------------------------------------------- *
 * The list itself — a bad edit in another repo fails HERE
 * -------------------------------------------------------------------------- */

describe('the approved content, so an edit in catalog-platform cannot land unnoticed', () => {
  it('sixteen universes, in the order the owner/coordinator approved them', () => {
    // ⚠️ Willverse was added 2026-08-12 and was the SEVENTH. Marvel and Disney
    // were added 2026-08-15 (owner/coordinator: separate universes). Same
    // day, revised again: Star Wars split OUT of Disney on the owner's
    // crossover-potential criterion, and Alliances was created (owner-
    // approved, 'human'-decided — not just llm-proposed like the others).
    // Per-item membership on Marvel/Disney/Star Wars is still 'llm'-decided,
    // not individually owner-reviewed — see their `confirmed` fields in
    // data/universes.json. Cytoverse (12th) and Reckoners (13th) were created
    // later the same day during the estate-wide orphan sweep, both owner-
    // approved and both 'human'-decided. Middle-earth (14th), Dungeon Crawler
    // Carl (15th) and Innworld (16th) followed within the hour, when the owner
    // ruled on that sweep's verdict table. This assertion failing is this file
    // WORKING: a universe cannot appear in catalog-platform without a decision
    // landing here too.
    assert.deepEqual(universeNames, [
      'The Cosmere',
      'Runnerverse',
      'CAL Verse',
      'Maasverse',
      'Riordanverse',
      'Solaria',
      'Willverse',
      'Marvel',
      'Disney',
      'Star Wars',
      'Alliances',
      'Cytoverse',
      'Reckoners',
      'Middle-earth',
      'Dungeon Crawler Carl',
      'Innworld',
    ]);
  });

  it('the counts the owner signed off (or, for Marvel/Disney/Star Wars, the agent proposed and cited)', () => {
    const counts = Object.fromEntries(
      universesDocument.universes.map((u) => [
        u.name,
        [(u.series ?? []).length, (u.bookOverrides ?? []).length, (u.bookExclusions ?? []).length],
      ]),
    );
    assert.deepEqual(counts, {
      // 36 since 2026-08-15: +22 for Brotherwise Games' Cosmere RPG line and
      // the Mistborn deckbuilder (board-game D1, null series), +1 Shards of
      // Creation ('literally all the gods from the cosmere' — owner), +3 for
      // Arcanum Unbounded / The Emperor's Soul / Shadows for Silence in the
      // Forests of Hell — the last two used to be caught by the SERIES
      // values 'Cosmere'/'The Cosmere' (a universe masquerading as a
      // series); those series fields are now blanked non-destructively at
      // the source (this repo's change_log; audiobook_catalog's corrections
      // layer for Arcanum) and caught by title instead, which is also why
      // `series` below dropped from 5 to 3.
      // series 3 -> 4 later on 2026-08-15: +White Sand, the Cosmere graphic-
      // novel line (library work #90). An author-keyed scan cannot find it —
      // `authors` reads 'Julius Gopez Rik Hoskin', the artist and scripter, so
      // the word Sanderson is nowhere on the row. Exclusions 8 -> 5: Snapshot,
      // Lux and Firstborn / Defending Elysium moved out, because an exclusion
      // is a GLOBAL stop and would have blocked the new Reckoners/Cytoverse
      // overrides on those exact titles. The Cosmere still refuses all three
      // via notSeries and the new entries' own `why` text.
      'The Cosmere': [4, 36, 5],
      // 12 since 2026-08-12: Turncoat's Truth was restored from _refused once the
      // owner verified the co-authored book does sit inside the continuity.
      Runnerverse: [12, 3, 0],
      // +1 since 2026-08-15: 'Divine Dungeon the Game' (board-game D1 id 103) —
      // not a new universe, since canonicalNames already folds 'divine dungeon
      // universe' onto CAL Verse.
      'CAL Verse': [9, 1, 0],
      Maasverse: [3, 0, 0],
      Riordanverse: [3, 0, 0],
      Solaria: [2, 0, 0],
      // Cradle and The Last Horizon are owned; The Elder Empire and The
      // Traveler's Gate are listed so a future purchase files itself.
      Willverse: [4, 0, 0],
      // New 2026-08-15. 77 title overrides: 72 Marvel/X-Men/Deadpool board-game
      // rows inside the mixed 'Dice Throne' series (unclaimed at series level),
      // 4 audiobook Avengers tie-ins, 1 library 'Little Golden Book' row.
      // +1 later on 2026-08-15: 'Panther Patience - Spidey and His Amazing
      // Friends' — a Disney Junior imprint row with Marvel characters, so it
      // goes to Marvel and not Disney, like the Age of Ultron tie-ins.
      Marvel: [0, 78, 0],
      // New 2026-08-15, then revised the SAME day: Star Wars split out (see
      // below), leaving just the Toy Story series claim + 11 seriesless
      // Disney Books imprint titles (12 minus Star Wars: Ahsoka, moved out).
      // 1 -> 2 series and 11 -> 20 overrides later the same day: the first
      // pass keyed on the literal word 'Disney' IN THE TITLE and half the
      // imprint's rows do not carry it. Re-run by author = 'Disney Books' and
      // the set closes: +Lady and the Tramp (a real series value), +3 Frozen,
      // +3 Mickey/Minnie, +Peter Pan, +The Lion King, +The Nightmare Before
      // Christmas (library work #197 — the first Disney row found outside the
      // audiobook catalog). Each was tested against the owner's crossover-
      // potential criterion individually rather than swept.
      // +1 override on the owner's Winnie-the-Pooh ruling, which also settled
      // a general criterion (Disney's new `criterion` field): FRANCHISE-
      // inclusive, so a kid-recognisable Disney property belongs even where the
      // row's own provenance is not Disney's — 'My First Winnie-the-Pooh' is
      // credited to A. A. Milne.
      Disney: [2, 21, 0],
      // New 2026-08-15, split out of Disney on the owner's crossover-potential
      // criterion: 3 series (High Republic, Legends, Boba Fett) + 1 title
      // override (Ahsoka, seriesless) — moved verbatim from Disney.
      // +1 series later the same day: 'Darth Vader and Family', Jeffrey
      // Brown's licensed Chronicle Books picture-book line (library work #190,
      // 'Goodnight Darth Vader').
      'Star Wars': [4, 1, 0],
      // New 2026-08-15, owner-approved creation (not just llm-proposed):
      // Stan Lee's Alliances, 1 series claim, both owned volumes.
      Alliances: [1, 0, 0],
      // New 2026-08-15, owner-approved during the estate-wide orphan sweep.
      // Sanderson's non-Cosmere SF continuity: the 'The Skyward Series' claim
      // covers 7 audiobooks, and the override covers library work #8
      // 'Firstborn / Defending Elysium', which carries no series at all —
      // Defending Elysium's own ebook edition is subtitled 'A Cytoverse
      // Novella'.
      Cytoverse: [1, 1, 0],
      // New 2026-08-15, owner-approved during the same sweep. Two series
      // because the spin-off carries a DIFFERENT series value ('Texas
      // Reckoners series', on Lux), and one override because Snapshot carries
      // none at all in either catalog — the two facts that make this a
      // universe rather than just a series.
      Reckoners: [2, 1, 0],
      // New 2026-08-15. 1 series (the 5 LotR audiobooks) + 13 title overrides,
      // and the override count is the point: the 12 Ascension game rows and the
      // LotR 5e book are filed under 'Ascension' and 'D&D', neither of which
      // can be claimed at series level because both also hold unrelated
      // products. The clearest case in the file of a universe saying what no
      // series name says.
      'Middle-earth': [1, 13, 0],
      // New 2026-08-15. ONE series claim covering 8 audiobooks, 6 works here
      // and 29 board-game rows — the games only reachable because
      // Board_Game_Catalog set series='Dungeon Crawler Carl' on ids 570-598 the
      // same day. Universe is the only tier a games row can join the estate at
      // (work_fold is null for games by design), which is what earns a
      // single-series franchise a universe here.
      'Dungeon Crawler Carl': [1, 0, 0],
      // New 2026-08-15. Named for pirateaba's world, not for The Wandering Inn,
      // so neither of its two series is elevated over the other (Solaria's
      // naming rule). Singer of Terandria is set on a continent of the same
      // world; the household owns Gravesong and Huntsong.
      Innworld: [2, 0, 0],
    });
  });

  it('⚠️ every book entry carries a reason — a bare mapping is indistinguishable from a typo', () => {
    for (const u of universesDocument.universes) {
      for (const field of ['bookOverrides', 'bookExclusions'] as const) {
        for (const b of u[field] ?? []) {
          assert.ok(b.why && b.why.trim().length > 0, `${u.name} ${field} "${b.title}" has no why`);
        }
      }
    }
  });

  it('every universe records how it was decided', () => {
    for (const u of universesDocument.universes) {
      assert.ok(['seed', 'llm', 'human'].includes(u.decidedHow), `${u.name}: ${u.decidedHow}`);
    }
  });

  it('the four held-out subjects are still recorded as refusals', () => {
    // ⚠️ Will Wight was the FIFTH and is deliberately gone — the refusal was
    // answered on 2026-08-12 and became the Willverse. Removing it here is the
    // other half of that decision; leaving it would assert a refusal that no
    // longer exists.
    const subjects = (universesDocument._refused ?? []).map((r) => String(r['subject']));
    for (const needle of ["Turncoat's Truth", 'Cultivating Chaos', 'The Axe Falls', 'Tailored Realities']) {
      assert.ok(
        subjects.some((s) => s.includes(needle)),
        `no refusal mentions ${needle}`,
      );
    }
  });

  it('⚠️ no held-out series has been swept into a universe', () => {
    for (const r of universesDocument._refused ?? []) {
      for (const s of (r['heldOutSeries'] as string[] | undefined) ?? []) {
        assert.equal(look('', s), null, `"${s}" is held out by "${String(r['subject'])}" and yet resolves`);
      }
    }
  });

  it('membersOf answers "all Cosmere books" without a query', () => {
    const { series, titles } = membersOf(universesDocument, 'The Cosmere');
    assert.ok(series.includes('The Stormlight Archive'));
    assert.ok(titles.includes('Fires of December'));
    assert.equal(membersOf(universesDocument, 'Nope').series.length, 0);
  });

  it('the schema version is the one this repo was written against', () => {
    assertSchemaVersion();
  });
});

/* -------------------------------------------------------------------------- *
 * What gets STORED when a book enters — migration 0080
 *
 * The owner's ask: *"when a book enters it's automatically added to its verse
 * especially if it's a copy of an ebook audiobook or physical."*
 *
 * `universeFor` above decides WHICH universe. These decide what is written to
 * the row and, more importantly, what is NOT overwritten. `@lc/db`'s createWork
 * and updateWork are thin wrappers over exactly these three functions.
 * -------------------------------------------------------------------------- */

const created = (title: string, series: string | null) =>
  universeOnCreate(universeIndex, { title, series });

describe('a book entering the catalog is filed in its verse', () => {
  it('a new book in a series the list knows resolves, and records that the LIST said so', () => {
    assert.deepEqual(created('Some Book Nobody Listed', 'The Stormlight Archive'), {
      universe: 'The Cosmere',
      how: 'list',
    });
  });

  it('⚠️ a seriesless book still resolves, which is why the title is read too', () => {
    // Fires of December and the Otherlife trilogy are the two shapes that a
    // series-keyed add path would have missed entirely.
    assert.deepEqual(created('Fires of December', null), {
      universe: 'The Cosmere',
      how: 'list',
    });
    assert.deepEqual(created('Otherlife Dreams - The Selfless Hero Trilogy', ''), {
      universe: 'Runnerverse',
      how: 'list',
    });
  });

  it('⚠️ the excluded member of a mixed series is filed in NO universe', () => {
    // Curly apostrophe, as the row is really stored. This is the single row the
    // whole design rests on.
    assert.deepEqual(created('The Frugal Wizard’s Handbook for Surviving Medieval England', ''), {
      universe: null,
      how: null,
    });
  });

  it('⚠️ an unknown book stores { null, null } — NOT a stamped miss', () => {
    // The tempting alternative is `how: 'list'`, meaning "we looked and found
    // nothing". It would turn the ordinary case into a stored decision, and the
    // backfill would have to re-examine those rows anyway. Recording a negative
    // nothing observed is what migration 0070 refused to do with read states.
    assert.deepEqual(created('A Book Of No Fixed Universe', 'Some Series'), {
      universe: null,
      how: null,
    });
  });

  it('no universe is the ordinary answer, for most of the catalog', () => {
    assert.equal(created('Dune', 'Dune').universe, null);
    assert.equal(created('', null).universe, null);
  });
});

describe('⚠️ re-resolving an existing row — and the one row it must never touch', () => {
  const human = (universe: string | null): UniverseAssignment => ({ universe, how: 'human' });

  it('the series arriving later is what files a SCANNED book — it has no series at add time', () => {
    // A barcode carries no series. `ScanLine` has no such field, so the book is
    // created on its title alone and the series lands later from
    // `backfill:series` or the details queue. Without this step, "a new book in
    // a series we know" would never fire for anything scanned off a shelf.
    const atScanTime = created('Rhythm of War', null);
    assert.deepEqual(atScanTime, { universe: null, how: null });
    assert.deepEqual(
      universeOnUpdate(universeIndex, atScanTime, {
        title: 'Rhythm of War',
        series: 'The Stormlight Archive',
      }),
      { universe: 'The Cosmere', how: 'list' },
    );
  });

  it('a row the list decided is re-resolved when the list grows', () => {
    assert.deepEqual(
      universeOnUpdate(
        universeIndex,
        { universe: 'Runnerverse', how: 'list' },
        { title: 'Elantris', series: null },
      ),
      { universe: 'The Cosmere', how: 'list' },
    );
  });

  it("⚠️ a person's answer is never overwritten, however wrong the list thinks it is", () => {
    assert.deepEqual(
      universeOnUpdate(universeIndex, human('Cytoverse'), {
        title: 'Elantris',
        series: 'The Stormlight Archive',
      }),
      human('Cytoverse'),
    );
  });

  it('⚠️ a human "in NO universe" survives too — the case that needs the how column', () => {
    // Without `how`, this row is indistinguishable from "nobody has looked", and
    // the next title edit would silently put The Cosmere back over a correction
    // the owner had just made.
    assert.deepEqual(
      universeOnUpdate(universeIndex, human(null), {
        title: 'Fires of December',
        series: null,
      }),
      human(null),
    );
  });
});

describe('a person naming a universe', () => {
  const canonicalise = (name: string) => canonicalUniverseName(universeIndex, name);

  it('is folded onto the owner\'s spelling, so one shelf does not become two', () => {
    // 'Cosmere' and 'The Cosmere' already exist in this estate as two spellings
    // of one thing — as SERIES values on two different works.
    assert.deepEqual(universeAsserted(canonicalise, 'Cosmere'), {
      universe: 'The Cosmere',
      how: 'human',
    });
    assert.deepEqual(universeAsserted(canonicalise, 'arandverse'), {
      universe: 'Runnerverse',
      how: 'human',
    });
  });

  it('⚠️ but a name the list has never heard of is kept verbatim, not refused', () => {
    // Naming a universe the list has not got yet is the reason a human answer is
    // storable at all. Refusing it would defeat the point.
    assert.deepEqual(universeAsserted(canonicalise, 'Cytoverse'), {
      universe: 'Cytoverse',
      how: 'human',
    });
  });

  it('null is an answer — "this book is in no universe" — and is stamped as one', () => {
    assert.deepEqual(universeAsserted(canonicalise, null), { universe: null, how: 'human' });
  });
});

/* -------------------------------------------------------------------------- *
 * The cross-repo wiring
 * -------------------------------------------------------------------------- */

describe('⚠️ the copy under generated/ is a build artifact, not a second source of truth', () => {
  it('is byte-identical to catalog-platform, so a stale copy cannot pass', () => {
    const { dir } = resolvePlatformRepo();
    const paths = platformPaths(dir);
    for (const [name, src] of [
      ['universes.json', paths.universes],
      ['universes.fixtures.json', paths.fixtures],
    ] as const) {
      assert.equal(
        readFileSync(join(GENERATED, name), 'utf8'),
        readFileSync(src, 'utf8'),
        `${name} differs from ${dir}. Run: node scripts/sync-universes.mjs`,
      );
    }
  });

  it('records where it came from', () => {
    const source = readFileSync(join(GENERATED, 'SOURCE.txt'), 'utf8');
    assert.match(source, /do not edit, do not commit/);
    assert.match(source, /catalog-platform/);
  });
});
