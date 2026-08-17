/**
 * ⚠️ THE SINGLE-WRITER CONTRACT for the estate universe LIST.
 *
 * The owner's ask, 2026-08-16, verbatim: *"I don't want duplicate universes."*
 * The fear behind it is concrete and this file is the mechanical answer to it —
 * the estate has one universe registry, `catalog-platform/data/universes.json`,
 * and a D1 instance must never grow a second one.
 *
 * ## What was actually measured before this file was written (2026-08-17)
 *
 * The suspicion was that each library D1 carried its own seeded `universe`
 * rows — "Samantha's fresh instance got 16 universes at creation" — and that
 * two writers were drifting apart. **They were not.** Measured against both
 * live databases:
 *
 * | | main (`library-catalog`) | friend (`library-catalog-2nd`) |
 * |---|---|---|
 * | tables matching `%universe%` | **0** | **0** |
 * | `/api/health` universes.count | 16 | 16 |
 * | distinct `work.universe` values | 12, all canonical | 0 (no works yet) |
 *
 * The 16 both instances report is `universeNames.length` — the length of the
 * BUNDLED canonical list, not a row count. Both instances answer 16 because
 * both are the same bundle reading the same file; that number moving in step
 * is the single writer working, not two writers agreeing by luck.
 *
 * Migration 0080 already refused to create a universe table, at length and on
 * purpose. So the contract was upheld everywhere and enforced nowhere — held
 * by prose in three files, which is exactly the state this estate's rule
 * ("mechanical guards beat written advice") exists to end.
 *
 * ## The two halves, which must not be confused
 *
 *   the LIST      — which universes exist, and how they are spelled. ONE
 *                   writer, in another repo, reaching this one through
 *                   `scripts/sync-universes.mjs` at build time. Never a row.
 *   an ASSIGNMENT — which universe THIS instance's work #41 is in
 *                   (`work.universe` / `work.universe_how`, migration 0080).
 *                   Per-instance data, legitimately different on the two
 *                   databases, and keyed BY NAME to the list above.
 *
 * A duplicate universe can therefore only enter one of two ways: a second
 * registry (guarded below), or an assignment stamped with a name the list does
 * not hold (guarded by `universeAsserted`'s fold onto the canonical spelling,
 * covered in universes.test.ts).
 *
 * Lives in packages/core/test/ for the same reason universes.test.ts does:
 * that is where `npm test` looks. The code under test is packages/universes,
 * the schema under test is migrations/, and the wiring under test is
 * apps/worker.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  buildUniverseIndex,
  resolveUniverseName,
  universeFor,
  universeIndex,
  universeNames,
  universeTally,
  universesDocument,
  type UniversesDocument,
} from '../../universes/src/index.ts';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const MIGRATIONS = join(REPO_ROOT, 'migrations');
const WRANGLER = join(REPO_ROOT, 'apps', 'worker', 'wrangler.toml');

/**
 * SQL with its comments removed.
 *
 * ⚠️ Load-bearing, not tidiness. This repo's migrations are mostly prose —
 * 0080 is ~90 lines of reasoning above two ALTER statements, and both it and
 * 0004 discuss universe tables *in comments* precisely to explain why they are
 * not creating one. A guard that greps raw text fires on the explanation and
 * would have to be deleted to get a green suite, which is how mechanical
 * guards die.
 */
function statementsOf(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ');
}

const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));

/* -------------------------------------------------------------------------- *
 * 1. No second registry may enter the schema
 * -------------------------------------------------------------------------- */

describe('⚠️ the universe LIST is never a table — the guard that keeps one writer one', () => {
  it('there are migrations to check at all, so this suite cannot pass by vacuum', () => {
    assert.ok(migrationFiles.length > 20, `only ${migrationFiles.length} migrations found`);
  });

  it('no migration creates a universe registry table', () => {
    for (const file of migrationFiles) {
      const sql = statementsOf(readFileSync(join(MIGRATIONS, file), 'utf8'));
      const created = [...sql.matchAll(/CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)/gi)].map(
        (m) => m[1]!,
      );
      for (const table of created) {
        assert.ok(
          !/universe/i.test(table),
          `${file} creates table \`${table}\`. The universe LIST has exactly one writer — ` +
            'catalog-platform/data/universes.json, arriving via scripts/sync-universes.mjs at ' +
            'build time. A table here is a second registry and the two will drift into ' +
            'duplicates. Per-work ASSIGNMENTS belong on work.universe (migration 0080); read ' +
            'docs/info/universes.md §1 before changing this.',
        );
      }
    }
  });

  it('no migration seeds universe names as rows', () => {
    for (const file of migrationFiles) {
      const sql = statementsOf(readFileSync(join(MIGRATIONS, file), 'utf8'));
      const inserted = [...sql.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["'`]?(\w+)/gi)].map((m) => m[1]!);
      for (const table of inserted) {
        assert.ok(
          !/universe/i.test(table),
          `${file} inserts into \`${table}\` — a seeded universe list is the drift this ` +
            'guard exists to prevent. The list ships in the bundle, not in the database.',
        );
      }
    }
  });

  it('⚠️ the guard reads statements, not prose — 0080 discusses a universe table and must still pass', () => {
    const raw = readFileSync(join(MIGRATIONS, '0080_work_universe.sql'), 'utf8');
    assert.match(raw, /no `?universe`? table/i, 'migration 0080 no longer explains the refusal');
    assert.doesNotMatch(statementsOf(raw), /CREATE\s+TABLE/i);
  });

  it('the assignment columns are still there, because assignments are NOT what this guard removes', () => {
    const sql = statementsOf(readFileSync(join(MIGRATIONS, '0080_work_universe.sql'), 'utf8'));
    assert.match(sql, /ALTER TABLE work ADD COLUMN universe TEXT/i);
    assert.match(sql, /ALTER TABLE work ADD COLUMN universe_how TEXT/i);
  });
});

/* -------------------------------------------------------------------------- *
 * 2. No universe is resolved in SQL, so no query is a second implementation
 * -------------------------------------------------------------------------- */

describe('⚠️ the join lives in the worker, never in a WHERE clause', () => {
  it('listUniverseKeys reads only the keys, and never a stored universe name', () => {
    const works = readFileSync(join(REPO_ROOT, 'packages', 'db', 'src', 'works.ts'), 'utf8');
    const statement = /SELECT w\.id, w\.title, w\.series FROM work w \$\{sql\}/;
    assert.match(
      works,
      statement,
      'listUniverseKeys no longer selects exactly (id, title, series). Every universe filter, ' +
        'facet count and page in this app is built from its rows and resolved by universeFor — ' +
        'selecting w.universe here would make the stored column a second source of names.',
    );
  });

  it('no SQL in packages/db matches on a universe NAME', () => {
    const dir = join(REPO_ROOT, 'packages', 'db', 'src');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(dir, file), 'utf8');
      assert.doesNotMatch(
        src,
        // ⚠️ The `\(?` is not decoration. Written without it this pattern caught
        // `universe = ?` and `universe LIKE ?` and silently MISSED
        // `universe IN ('The Cosmere')` — the exact form a hand-written registry
        // query takes. Found by probing the regex against synthetic violations
        // rather than by reading it, which is the only way this class of hole
        // ever shows up.
        /WHERE[^`;]*\buniverse\s*(?:=|LIKE|IN)\s*\(?\s*['"?]/i,
        `${file} filters SQL by a universe name. That is a third implementation of the lookup ` +
          'contract (docs/info/universes.md §5) in a third language — the shape of the ' +
          'resolve_author_link bug this estate has already shipped once.',
      );
    }
  });
});

/* -------------------------------------------------------------------------- *
 * 3. A new universe reaches BOTH instances with no migration and no code edit
 * -------------------------------------------------------------------------- */

describe('⚠️ adding a universe upstream is a DATA change — prove the path end to end', () => {
  /**
   * The 17th universe, as catalog-platform would add it: one object in
   * `universes`, one alias in `canonicalNames`, nothing else. If any part of
   * this repo needed a schema change or a code edit to see it, one of the
   * assertions below fails.
   */
  const withNewUniverse: UniversesDocument = {
    ...universesDocument,
    universes: [
      ...universesDocument.universes,
      {
        name: 'Testverse',
        decidedHow: 'human',
        series: ['The Test Sequence'],
        bookOverrides: [{ title: 'A Seriesless Test Standalone', why: 'fixture' }],
      },
    ],
    canonicalNames: { ...universesDocument.canonicalNames, testverse: 'Testverse' },
  };

  const grownIndex = buildUniverseIndex(withNewUniverse);
  const grownNames = withNewUniverse.universes.map((u) => u.name);

  it('the index is derived from the document, so the new universe resolves by series immediately', () => {
    assert.equal(universeFor(grownIndex, { title: 'Book One', series: 'The Test Sequence' }), 'Testverse');
  });

  it('…and by title override, which is the seriesless case a table keyed on series could not hold', () => {
    assert.equal(
      universeFor(grownIndex, { title: 'A Seriesless Test Standalone', series: null }),
      'Testverse',
    );
  });

  it('the facet counts it — including its zero, so a new control cannot come and go', () => {
    const rows = [
      { id: 1, title: 'Book One', series: 'The Test Sequence' },
      { id: 2, title: 'Something Else Entirely', series: null },
    ];
    const tally = universeTally(grownIndex, rows, grownNames);
    assert.deepEqual(
      tally.find((t) => t.name === 'Testverse'),
      { name: 'Testverse', count: 1 },
    );
    assert.equal(tally.length, universeNames.length + 1);
  });

  it('its URL and its ?universe= filter work, via the alias map alone', () => {
    assert.equal(resolveUniverseName(grownIndex, grownNames, 'testverse'), 'Testverse');
    assert.equal(resolveUniverseName(grownIndex, grownNames, 'TESTVERSE'), 'Testverse');
  });

  it('⚠️ nothing here touched the schema — the live list is untouched by the fixture above', () => {
    assert.equal(universeNames.includes('Testverse'), false);
    assert.equal(universeFor(universeIndex, { title: 'Book One', series: 'The Test Sequence' }), null);
  });
});

/* -------------------------------------------------------------------------- *
 * 4. One bundle serves both instances, so one deploy carries the list to both
 * -------------------------------------------------------------------------- */

describe('⚠️ both instances read ONE bundled list — the wiring that makes the writer single', () => {
  const wrangler = readFileSync(WRANGLER, 'utf8');

  it('the friend env declares no entry point of its own, so it cannot ship a different list', () => {
    const mains = [...wrangler.matchAll(/^main\s*=/gm)];
    assert.equal(
      mains.length,
      1,
      'apps/worker/wrangler.toml declares more than one `main`. Wrangler environments do not ' +
        'inherit, so a second entry point means the two instances could bundle two different ' +
        'universe lists — and nothing would look wrong until they disagreed.',
    );
    assert.doesNotMatch(wrangler, /^\s*\[env\.friend\][\s\S]*?^main\s*=/m);
  });

  it('both instances migrate from the same directory, so neither can grow a private schema', () => {
    const dirs = [...wrangler.matchAll(/^migrations_dir\s*=\s*"([^"]+)"/gm)].map((m) => m[1]!);
    assert.equal(dirs.length, 2, `expected one migrations_dir per instance, found ${dirs.length}`);
    assert.deepEqual(new Set(dirs), new Set(['../../migrations']));
  });

  it('the health count is DERIVED from the list, never a literal — so both instances move together', () => {
    const health = readFileSync(join(REPO_ROOT, 'apps', 'worker', 'src', 'routes', 'health.ts'), 'utf8');
    assert.match(
      health,
      /universes:\s*\{\s*count:\s*universeNames\.length/,
      '/api/health stopped deriving its universe count from the bundled list. That line is the ' +
        'one curl that proves the list was bundled at all; a literal there would report a ' +
        'healthy 16 forever, including from an instance carrying no list.',
    );
  });

  it('the count both instances report is the canonical list length, not a row count', () => {
    assert.equal(universeNames.length, universesDocument.universes.length);
  });
});
