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
  universeFor,
  universeIndex,
  universeNames,
  universesDocument,
  assertSchemaVersion,
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
    assert.equal(look('Lux - A Texas Reckoners Novel', 'The Stormlight Archive'), null);
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
    assert.equal(look('Steelheart', 'Reckoners'), null);
    assert.equal(look('Skyward', 'The Skyward Series'), null);
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
    assert.equal(canonicalUniverseName(universeIndex, 'Cytoverse'), null);
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
 * The list itself — a bad edit in another repo fails HERE
 * -------------------------------------------------------------------------- */

describe('the approved content, so an edit in catalog-platform cannot land unnoticed', () => {
  it('six universes, in the order the owner approved them', () => {
    assert.deepEqual(universeNames, ['The Cosmere', 'Runnerverse', 'CAL Verse', 'Maasverse', 'Riordanverse', 'Solaria']);
  });

  it('the counts the owner signed off', () => {
    const counts = Object.fromEntries(
      universesDocument.universes.map((u) => [
        u.name,
        [(u.series ?? []).length, (u.bookOverrides ?? []).length, (u.bookExclusions ?? []).length],
      ]),
    );
    assert.deepEqual(counts, {
      'The Cosmere': [5, 10, 8],
      Runnerverse: [11, 3, 0],
      'CAL Verse': [9, 0, 0],
      Maasverse: [3, 0, 0],
      Riordanverse: [3, 0, 0],
      Solaria: [2, 0, 0],
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

  it('the five held-out subjects are still recorded as refusals', () => {
    const subjects = (universesDocument._refused ?? []).map((r) => String(r['subject']));
    for (const needle of ['Will Wight', "Turncoat's Truth", 'Cultivating Chaos', 'The Axe Falls', 'Tailored Realities']) {
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
