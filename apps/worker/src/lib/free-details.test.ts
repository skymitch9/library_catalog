/**
 * The free rungs, and the four properties whose failure would be silent.
 *
 * These are the behaviours the owner's 2026-08-22 report turns on, not a tour
 * of the module:
 *
 * 1. **Each rung can answer, and says which one did.** A ladder that filled the
 *    column but recorded nothing about where the value came from would leave
 *    the queue unable to tell a free answer from a bought one — which is the
 *    entire point of building it.
 * 2. **⚠️ A present row with a NULL column is NOT an answer.** *Elantris* in one
 *    line: `audiobook_holding` holds one edition per work, the household owns
 *    two, and the row that landed carries no series. The ladder must fall
 *    THROUGH, not stop.
 * 3. **Stop per FIELD, not per rung.** Rung 1 answering `series` must not stop
 *    `description` reaching rung 3 or 4.
 * 4. **⚠️ Nothing is written that was not blank, and nothing settled is
 *    re-asked.** The free rungs write straight into `work`, so they inherit
 *    `applyFinding`'s two refusals or they are a second, unguarded way in.
 * 5. **⚠️ Nothing is bought when nothing is left to buy.** A run whose free
 *    rungs closed every field must make no paid call at all. Driven through the
 *    real `runDetailsResearch` with a `fetch` that throws, so a regression that
 *    reintroduced the model call fails here rather than on the invoice.
 *
 * The D1 stub answers only the queries these paths make and throws on anything
 * else, so a new query in the ladder fails this file loudly rather than
 * silently reading nothing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DetailField } from '@lc/core';
import type { Env } from '../env.js';
import {
  FREE_DETAILS_SUBREQUESTS,
  FREE_LADDER_RUNG_NAMES,
  INDEX_MAX_IDENTITIES,
  RUNG_LABEL,
  freeDetailsFor,
  readSeriesLabel,
  readVolumeDisplay,
} from './free-details.js';
import { runDetailsResearch } from './research-run.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A `work` row as `WORK_COLS` selects it; only what `toWork` reads. */
function workRow(extra: Record<string, unknown> = {}) {
  return {
    id: 514,
    title: 'Elantris',
    subtitle: null,
    sort_title: 'Elantris',
    authors: 'Brandon Sanderson',
    primary_author: 'Brandon Sanderson',
    work_key: 'elantris|brandon sanderson',
    series: null,
    series_index_sort: null,
    series_index_display: null,
    first_published: null,
    openlibrary_work_id: null,
    description: null,
    cover_url: null,
    cover_status: null,
    illustrator: null,
    universe: null,
    universe_how: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    ...extra,
  };
}

interface StubOptions {
  work?: Record<string, unknown>;
  verdicts?: { field: string }[];
  /** `null` = no row at all. An object with `series: null` is the Elantris case. */
  holding?: Record<string, unknown> | null;
  editions?: Record<string, unknown>[];
  /** `work_alias` rows this work carries. Empty by default. */
  aliases?: { alias: string; kind: string }[];
}

/**
 * A D1 that answers the four queries this ladder makes and refuses the rest.
 *
 * `writes` captures every statement that reached `batch`, which is how the
 * tests assert *what was written* without re-implementing `updateWork`'s
 * column order — they look for the value in the bound arguments rather than at
 * a position, so this stub cannot silently drift out of step with the real
 * UPDATE the way an index-mapped fake would.
 */
function stubDb(options: StubOptions = {}) {
  const work = options.work ? workRow(options.work) : workRow();
  const writes: { sql: string; bound: unknown[] }[] = [];

  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        sql,
        boundArgs: () => bound,
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first() {
          if (sql.includes('FROM work WHERE id = ?')) return work;
          if (sql.includes('FROM audiobook_holding')) return options.holding ?? null;
          throw new Error(`stubDb: unexpected first() for: ${sql}`);
        },
        async all() {
          if (sql.includes('FROM gap_verdict')) return { results: options.verdicts ?? [] };
          if (sql.includes('FROM edition WHERE work_id')) return { results: options.editions ?? [] };
          if (sql.includes('FROM work_alias')) {
            const rows = (options.aliases ?? []).map((a, i) => ({
              id: i + 1,
              work_id: (work as { id: number }).id,
              alias: a.alias,
              kind: a.kind,
              source: 'manual',
              created_at: '2026-01-01 00:00:00',
            }));
            return { results: rows };
          }
          throw new Error(`stubDb: unexpected all() for: ${sql}`);
        },
        async run() {
          return { success: true };
        },
      };
      return stmt;
    },
    async batch(statements: { sql: string; boundArgs: () => unknown[] }[]) {
      for (const s of statements) writes.push({ sql: s.sql, bound: s.boundArgs() });
      return [{ results: [work] }];
    },
  };

  return { db: db as unknown as D1Database, writes, work };
}

/** Did anything reach `work` carrying this value? */
function wrote(writes: { sql: string; bound: unknown[] }[], value: unknown): boolean {
  return writes.some((w) => w.sql.includes('UPDATE work SET') && w.bound.includes(value));
}

/**
 * The `new_json` the change log recorded for one FIELD, or undefined.
 *
 * ⚠️ Use this, not `wrote`, whenever the question is *which column* a value
 * landed in. `UPDATE work SET` names every column in one statement, and the
 * work-write path fills `work.universe` from the shared universe list — so
 * asserting that a universe name is absent from the whole statement fails on
 * correct behaviour. The change log has one row per field, which is the
 * question actually being asked.
 */
function loggedValue(
  writes: { sql: string; bound: unknown[] }[],
  field: string,
): string | undefined {
  const row = writes.find((w) => w.sql.includes('INSERT INTO change_log') && w.bound[3] === field);
  return row?.bound[5] as string | undefined;
}

function env(db: D1Database, extra: Partial<Env> = {}): Env {
  return { DB: db, ...extra } as Env;
}

/** A `fetch` that answers by URL substring and records what it was asked. */
function stubFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [needle, body] of Object.entries(routes)) {
      if (url.includes(needle)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ALL: DetailField[] = ['series', 'seriesIndex', 'description'];

// ---------------------------------------------------------------------------
// The label readers
// ---------------------------------------------------------------------------

describe('readSeriesLabel', () => {
  it('reads a series and a volume out of an Open Library series string', () => {
    assert.deepEqual(readSeriesLabel('Cradle, Volume 1', true), {
      series: 'Cradle',
      sort: 1,
      display: 'Volume 1',
    });
  });

  it('reads the worded volume Hidden Gnome files in the subtitle', () => {
    assert.deepEqual(readSeriesLabel('Cradle, Volume Five', false), {
      series: 'Cradle',
      sort: 5,
      display: 'Volume Five',
    });
  });

  it('⚠️ reads the markerless "Name (N)" Open Library really answers with', () => {
    // MEASURED 2026-08-23 against the live API: editions.json for Elantris
    // answers `series: ["Elantris (1)"]`. Before this was handled, the whole
    // string landed in work.series and the catalogue grew a series named
    // "Elantris (1)" — a shelf of one, beside the real one.
    assert.deepEqual(readSeriesLabel('Elantris (1)', true), {
      series: 'Elantris',
      sort: 1,
      display: null,
    });
  });

  it('reads the "Name #N" spelling of the same field', () => {
    assert.deepEqual(readSeriesLabel('Mistborn #2', true), {
      series: 'Mistborn',
      sort: 2,
      display: null,
    });
  });

  it('⚠️ reads the COMBINED "Name (#N)" spelling — the one that reached production', () => {
    // MEASURED 2026-09-05 on the second instance (padhard): three works held a
    // series name ending in a volume marker, every one written `changed_how
    // 'auto'` by this ladder within twenty seconds of the work being added. The
    // bracket branch matched and handed `parseVolumeNumber` the token "#2",
    // which is not a number, so the whole string fell through to the name — and
    // the estate index's near-miss queue correctly reported two series where
    // there is one.
    assert.deepEqual(readSeriesLabel("A Good Girl's Guide to Murder (#2)", true), {
      series: "A Good Girl's Guide to Murder",
      sort: 2,
      display: null,
    });
    assert.deepEqual(readSeriesLabel('Once Upon a Broken Heart (#1)', true), {
      series: 'Once Upon a Broken Heart',
      sort: 1,
      display: null,
    });
    // A decimal position survives the strip too — 2.5 is a real rung shape here.
    assert.deepEqual(readSeriesLabel('Skyward (#2.5)', true), {
      series: 'Skyward',
      sort: 2.5,
      display: null,
    });
  });

  it('⚠️ the # strip does NOT widen the guard — a non-numeric hash keeps the name whole', () => {
    // The whole reason stripping the '#' is safe: `parseVolumeNumber` is still
    // the only thing that reads a position, and it refuses this one.
    assert.deepEqual(readSeriesLabel('Foo (#hashtag)', true), {
      series: 'Foo (#hashtag)',
      sort: null,
      display: null,
    });
  });

  it('⚠️ leaves a name that merely ENDS in a parenthetical alone', () => {
    // The guard that makes the branch above safe: it fires only when
    // `parseVolumeNumber` gets a position out of the bracketed token.
    assert.deepEqual(readSeriesLabel('Discworld (UK)', true), {
      series: 'Discworld (UK)',
      sort: null,
      display: null,
    });
  });

  it('takes a DECLARED series field whole when it names no volume', () => {
    assert.deepEqual(readSeriesLabel('The Stormlight Archive', true), {
      series: 'The Stormlight Archive',
      sort: null,
      display: null,
    });
  });

  it('⚠️ refuses an UNDECLARED label that names no volume — a subtitle is usually a subtitle', () => {
    assert.equal(
      readSeriesLabel('A Novel', false),
      null,
      'reading "A Novel" as a series name would file the book on a shelf that does not exist',
    );
  });

  it('never returns a bare number as a printed designation', () => {
    // "All The Skills - 5" parses to a volume with no marker word. The sort is
    // the answer; `series_index_display` must stay empty, because nothing was
    // QUOTED — owner rule 2026-08-19.
    const label = readSeriesLabel('All The Skills - 5', false);
    assert.equal(label?.series, 'All The Skills');
    assert.equal(label?.sort, 5);
    assert.equal(label?.display, null);
  });

  it('is empty for a blank label', () => {
    assert.equal(readSeriesLabel('   ', true), null);
    assert.equal(readSeriesLabel(null, true), null);
  });
});

describe('readVolumeDisplay', () => {
  it('reads the bare number the audiobook catalogue stores', () => {
    assert.deepEqual(readVolumeDisplay('3', 'Cradle'), { sort: 3, display: null });
  });

  it('reads a marker form, and keeps it as the printed designation', () => {
    assert.deepEqual(readVolumeDisplay('Book 3', 'Cradle'), { sort: 3, display: 'Book 3' });
  });

  it('refuses a label with no position on a number line', () => {
    // "Extra.1" and "BR SS Compilation" are real labels in this library.
    assert.equal(readVolumeDisplay('BR SS Compilation', 'Cradle').sort, null);
  });
});

// ---------------------------------------------------------------------------
// Rung 1 — the audiobook catalogue, and the Elantris fall-through
// ---------------------------------------------------------------------------

describe('rung 1 — audiobook_holding', () => {
  it('answers the series and the volume, and records itself as the source', async () => {
    const { db, writes } = stubDb({
      holding: { title: 'Blackflame', series: 'Cradle', index_display: '3' },
    });
    const out = await freeDetailsFor(env(db), 514, ['series', 'seriesIndex'], { throttle: false });

    assert.equal(out.sources.series, 'audiobook');
    assert.equal(out.sources.seriesIndex, 'audiobook');
    assert.deepEqual(out.stillOpen, []);
    assert.ok(wrote(writes, 'Cradle'), 'the series must reach the work row');
    assert.ok(wrote(writes, 3), 'the volume must reach the work row');
  });

  it('⚠️ THE ELANTRIS BUG: a row with a NULL series is not an answer — it falls through', async () => {
    // The household owns two Elantris audiobooks; `audiobook_holding.work_id`
    // is a PRIMARY KEY, so only one landed, and its series is NULL. Treating
    // "row found" as "rung answered" is what made "look up" report nothing.
    const fetchStub = stubFetch({
      '/editions.json': { entries: [{ key: '/books/OL1M', series: ['Elantris'] }] },
    });
    const { db, writes } = stubDb({
      work: { openlibrary_work_id: 'OL27448W' },
      holding: { title: 'Elantris', series: null, index_display: null },
    });

    const out = await freeDetailsFor(env(db), 514, ['series'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.equal(out.sources.series, 'openlibrary', 'the NEXT rung must have been asked');
    assert.ok(wrote(writes, 'Elantris'));
    assert.ok(
      out.skipped.some((s) => s.includes('its series is blank')),
      'the fall-through must be NAMED, not silent — a rung that could not answer and one that ' +
        `was never asked are different facts. Got: ${JSON.stringify(out.skipped)}`,
    );
  });

  it('says so by name when no audio edition is linked at all', async () => {
    const { db } = stubDb({ holding: null });
    const out = await freeDetailsFor(env(db), 514, ['series'], { throttle: false });
    assert.ok(out.skipped.some((s) => s.includes('no audio edition is linked')));
  });
});

// ---------------------------------------------------------------------------
// Rung 2 — the estate index, over the MACHINE read route (live 2026-08-25)
// ---------------------------------------------------------------------------

/** The index config this rung needs. Both halves, always — see `askIndex`. */
const INDEX_ENV = {
  INDEX_URL: 'https://index.heygabi.ai',
  INDEX_READ_TOKEN: 'test-only-read-token',
} as const;

/** `read.ts:39-40,79` — the envelope `/api/machine/lookup` really answers. */
function lookupBody(matches: Record<string, unknown>[], query = 'Elantris') {
  return {
    query,
    title_fold: query.toLowerCase(),
    matches: matches.map((m) => ({
      source: 'audiobook',
      source_id: '1',
      title: query,
      creator: 'Brandon Sanderson',
      title_fold: query.toLowerCase(),
      work_fold: null,
      universe: null,
      series: null,
      series_slug: null,
      series_index: null,
      year: null,
      publisher: null,
      format: 'audiobook',
      kind: null,
      parent_source_id: null,
      cover_url: null,
      detail_url: null,
      pushed_at: '2026-08-25T00:00:00Z',
      ...m,
    })),
  };
}

/** A fetch that answers every index call with one body, recording the requests. */
function indexFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('rung 2 — the estate index', () => {
  it('⚠️ is skipped with a NAMED reason when the pairing is not configured', async () => {
    const { db } = stubDb({ holding: null });
    const out = await freeDetailsFor(env(db, { INDEX_URL: INDEX_ENV.INDEX_URL }), 514, ['series'], {
      throttle: false,
    });

    const reason = out.skipped.find((s) => s.startsWith('the estate index:'));
    assert.ok(reason, 'an unaskable rung must say so — it is not the same as "nothing found"');
    assert.match(reason, /INDEX_READ_TOKEN/, 'the missing thing must be named, so it can be fixed');
    assert.match(
      reason,
      /INDEX_READ_TOKEN_<THIS INSTANCE>/,
      'and so must the name the OTHER holder keeps — the pairing is where this goes wrong',
    );
  });

  it('never invents a token: with INDEX_URL set and no token, nothing is fetched', async () => {
    const fetchStub = stubFetch({});
    const { db } = stubDb({ holding: null });
    await freeDetailsFor(env(db, { INDEX_URL: INDEX_ENV.INDEX_URL }), 514, ['series'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });
    assert.equal(
      fetchStub.calls.filter((u) => u.includes('index.heygabi.ai')).length,
      0,
      'an unconfigured rung must not dial the host at all',
    );
  });

  it('⚠️ calls /api/machine/lookup — NOT the human /api/lookup — with the bearer and title only', async () => {
    // The regression this pins is the one the rung shipped with: the human
    // route sits below the index's requireEstateMember() blanket and answers
    // 401 to a bearer, so a rung pointed at it is refused every run while
    // looking perfectly configured.
    const f = indexFetch(lookupBody([{ series: 'Elantris', series_index: 1 }]));
    const { db } = stubDb({ holding: null });
    await freeDetailsFor(env(db, INDEX_ENV), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl: f.impl,
    });

    assert.equal(f.calls.length, 1);
    const url = new URL(f.calls[0]!.url);
    assert.equal(url.origin, 'https://index.heygabi.ai');
    assert.equal(url.pathname, '/api/machine/lookup', 'the MACHINE route, by name');
    assert.equal(url.searchParams.get('title'), 'Elantris');
    // ⚠️ lookupHandler reads `title` and nothing else (read.ts:57). A `creator`
    // param would be decoration that reads like an author gate.
    assert.equal(url.searchParams.get('creator'), null, 'no param the server never reads');

    const headers = f.calls[0]!.init?.headers as Record<string, string>;
    assert.equal(headers.authorization, `Bearer ${INDEX_ENV.INDEX_READ_TOKEN}`);
  });

  it('parses the { query, title_fold, matches } envelope and writes series + volume', async () => {
    const f = indexFetch(lookupBody([{ series: 'Elantris', series_index: 1, source: 'audiobook' }]));
    const { db, writes } = stubDb({ holding: null });
    const out = await freeDetailsFor(env(db, INDEX_ENV), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl: f.impl,
    });
    assert.equal(out.sources.series, 'index');
    assert.equal(out.sources.seriesIndex, 'index');
    assert.ok(wrote(writes, 'Elantris'));
    assert.ok(wrote(writes, 1));
  });

  it('⚠️ a lookup answers MANY rows — the first one NAMING a series wins, not matches[0]', async () => {
    // The estate-level restatement of rule 2: the audiobook copy is present and
    // silent about series; the library row two positions down carries it.
    // Taking matches[0] would end the rung on a row that answered nothing.
    const f = indexFetch(
      lookupBody([
        { source: 'audiobook', series: null, series_index: null },
        { source: 'audiobook', format: 'ebook', series: null },
        { source: 'library', series: 'Elantris', series_index: 1 },
      ]),
    );
    const { db } = stubDb({ holding: null });
    const out = await freeDetailsFor(env(db, INDEX_ENV), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl: f.impl,
    });
    assert.equal(out.sources.series, 'index');
    assert.equal(out.sources.seriesIndex, 'index');
  });

  it('rows present but none naming a series is reported as that, not as "nothing held"', async () => {
    const f = indexFetch(lookupBody([{ series: null }, { series: '   ' }]));
    const { db } = stubDb({ holding: null });
    const out = await freeDetailsFor(env(db, INDEX_ENV), 514, ['series'], {
      throttle: false,
      fetchImpl: f.impl,
    });
    const skip = out.skipped.find((s) => s.startsWith('the estate index'));
    assert.ok(skip);
    assert.match(skip, /2 row\(s\) across the estate, none naming a series/);
  });

  it('an empty matches array says no shelf holds it — a different fact', async () => {
    const f = indexFetch(lookupBody([]));
    const { db } = stubDb({ holding: null });
    const out = await freeDetailsFor(env(db, INDEX_ENV), 514, ['series'], {
      throttle: false,
      fetchImpl: f.impl,
    });
    assert.ok(out.skipped.some((s) => /no shelf in the estate holds this title/.test(s)));
  });

  it('⚠️ a refusal carries the index’s own error CODE into the skip, never a bare status', async () => {
    // "the index said no" and "your token is not the one it holds" send an
    // operator to two completely different places.
    const f = indexFetch({ error: 'machine_token_invalid', detail: 'nope' }, 401);
    const { db } = stubDb({ holding: null });
    const out = await freeDetailsFor(env(db, INDEX_ENV), 514, ['series'], {
      throttle: false,
      fetchImpl: f.impl,
    });
    const skip = out.skipped.find((s) => s.startsWith('the estate index'));
    assert.ok(skip);
    assert.match(skip, /HTTP 401/);
    assert.match(skip, /machine_token_invalid/);
  });

  it('a 200 that is not the envelope is a named CONTRACT skip, not a parsed guess', async () => {
    // The old rung accepted a bare row or one wrapped in `item`. Both were
    // wrong, and the guesswork is what let a broken rung look merely empty.
    const f = indexFetch({ series: 'Elantris', series_index: 1 });
    const { db, writes } = stubDb({ holding: null });
    const out = await freeDetailsFor(env(db, INDEX_ENV), 514, ['series'], {
      throttle: false,
      fetchImpl: f.impl,
    });
    assert.equal(out.sources.series, undefined, 'nothing may be written off an unknown shape');
    assert.equal(writes.length, 0);
    assert.ok(out.skipped.some((s) => /has changed its contract/.test(s)));
  });

  it('an unreachable index is a named skip and the ladder carries on', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const { db } = stubDb({ holding: null });
    const out = await freeDetailsFor(env(db, INDEX_ENV), 514, ['series'], {
      throttle: false,
      fetchImpl,
    });
    assert.ok(out.skipped.some((s) => /could not be reached/.test(s)));
  });

  it('⚠️ fans out over title aliases and answers off the one that names a series', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const title = new URL(url).searchParams.get('title') ?? '';
      const body =
        title === 'The Selish Cycle'
          ? lookupBody([{ series: 'Elantris', series_index: 1 }], title)
          : lookupBody([], title);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const { db } = stubDb({ holding: null });
    const out = await freeDetailsFor(env(db, INDEX_ENV), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl,
      titleAliases: ['The Selish Cycle'],
    });

    assert.equal(calls.length, 2, 'the title and then the alias should each be asked');
    assert.match(calls[0] ?? '', /title=Elantris/);
    assert.match(calls[1] ?? '', /title=The\+Selish\+Cycle/);
    assert.equal(out.sources.series, 'index');
    assert.equal(out.sources.seriesIndex, 'index');
    assert.ok(
      out.skipped.some((s) => s.includes('the estate index') && s.includes('no shelf in the estate')),
      'the identity that came back empty should be recorded',
    );
  });

  it('stops at the first identity that answers — no needless second call', async () => {
    const f = indexFetch(lookupBody([{ series: 'Elantris', series_index: 1 }]));
    const { db } = stubDb({ holding: null });
    await freeDetailsFor(env(db, INDEX_ENV), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl: f.impl,
      titleAliases: ['The Selish Cycle'],
    });
    assert.equal(f.calls.length, 1, 'the catalogued title answered, so the alias is not asked');
  });

  it('⚠️ the fan-out is CAPPED at INDEX_MAX_IDENTITIES — the sweep budget depends on it', async () => {
    // `selectTitleAliases` caps at 4 aliases, so 5 identities are possible. The
    // rung's declared price is INDEX_MAX_IDENTITIES and the sweep prices the
    // whole ladder off it; an uncapped fan-out would overrun a ceiling whose
    // breach does not throw, it kills the invocation.
    const f = indexFetch(lookupBody([]));
    const { db } = stubDb({ holding: null });
    await freeDetailsFor(env(db, INDEX_ENV), 514, ['series'], {
      throttle: false,
      fetchImpl: f.impl,
      titleAliases: ['A', 'B', 'C', 'D'],
    });
    assert.equal(f.calls.length, INDEX_MAX_IDENTITIES);
    assert.equal(INDEX_MAX_IDENTITIES, 3, 'change this and reprice FREE_LADDER_RUNGS with it');
  });

  it('the stored series_index wins over a number parsed out of the label', async () => {
    const f = indexFetch(lookupBody([{ series: 'Cradle, Volume 1', series_index: 9 }]));
    const { db, writes } = stubDb({ holding: null });
    const out = await freeDetailsFor(env(db, INDEX_ENV), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl: f.impl,
    });
    assert.equal(out.sources.seriesIndex, 'index');
    assert.ok(wrote(writes, 9), 'the pushed position, not the 1 in the string');
  });

  it('falls back to the label’s number when series_index is null', async () => {
    const f = indexFetch(lookupBody([{ series: 'Cradle, Volume 5', series_index: null }]));
    const { db, writes } = stubDb({ holding: null });
    await freeDetailsFor(env(db, INDEX_ENV), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl: f.impl,
    });
    assert.ok(wrote(writes, 5));
    assert.equal(loggedValue(writes, 'series'), '"Cradle"');
  });

  it('cannot answer description — it is an identity index, so the rung is not even asked', async () => {
    const f = indexFetch(lookupBody([{ series: 'Elantris', series_index: 1 }]));
    const { db } = stubDb({ holding: null, work: { series: 'Elantris', series_index_sort: 1 } });
    const out = await freeDetailsFor(env(db, INDEX_ENV), 514, ['description'], {
      throttle: false,
      fetchImpl: f.impl,
    });
    assert.equal(
      f.calls.length,
      0,
      'a rung that cannot answer the open field must not spend a subrequest',
    );
    assert.equal(out.sources.description, undefined);
  });
});

// ---------------------------------------------------------------------------
// F9 — a volume number is written only against the SAME series
// ---------------------------------------------------------------------------

describe('F9 — the volume belongs to the series in hand, or it is not written', () => {
  it('⚠️ Wikidata answering "The Cosmere, 7" for a Stormlight book writes NO volume', async () => {
    // The live case, 2026-08-25: a UNIVERSE is a true fact about the book and a
    // wrong number for its shelf. Before this gate, 7 landed in
    // series_index_sort and The Way of Kings became Stormlight volume 7.
    const fetchStub = stubFetch({
      'query.wikidata.org': {
        results: { bindings: [{ seriesLabel: { value: 'The Cosmere' }, ordinal: { value: '7' } }] },
      },
    });
    const { db, writes } = stubDb({
      holding: null,
      work: { series: 'The Stormlight Archive', series_index_sort: null },
      editions: [{ isbn13: '9780765326355' }],
    });

    const out = await freeDetailsFor(db ? env(db) : env(db), 514, ['seriesIndex'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.equal(out.sources.seriesIndex, undefined, 'the ordinal must not be attributed');
    assert.ok(!wrote(writes, 7), 'and it must not reach the row');
    const skip = out.skipped.find((s) => s.includes('volume not written'));
    assert.ok(skip, 'the drop is NAMED — a silent one is indistinguishable from "knew nothing"');
    assert.match(skip, /Wikidata: names series The Cosmere/);
    assert.match(skip, /filed under The Stormlight Archive/);
  });

  it('the same series spelled differently IS written — the one matcher, not string equality', async () => {
    // titleSimilarity("Stormlight Archive", "The Stormlight Archive") = 0.8,
    // over the 0.7 spine floor. A leading article must not cost a real answer.
    const fetchStub = stubFetch({
      'query.wikidata.org': {
        results: {
          bindings: [{ seriesLabel: { value: 'Stormlight Archive' }, ordinal: { value: '1' } }],
        },
      },
    });
    const { db, writes } = stubDb({
      holding: null,
      work: { series: 'The Stormlight Archive', series_index_sort: null },
      editions: [{ isbn13: '9780765326355' }],
    });

    const out = await freeDetailsFor(env(db), 514, ['seriesIndex'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.equal(out.sources.seriesIndex, 'wikidata');
    assert.ok(wrote(writes, 1));
    assert.ok(!out.skipped.some((s) => s.includes('volume not written')));
  });

  it('a rung bringing BOTH series and volume to an unfiled book still writes both', async () => {
    // The empty-shelf case: there is nothing to contradict, so the gate must
    // not fire. This is the ordinary path and the one a bad gate would break.
    const fetchStub = stubFetch({
      'query.wikidata.org': {
        results: { bindings: [{ seriesLabel: { value: 'Cradle' }, ordinal: { value: '3' } }] },
      },
    });
    const { db, writes } = stubDb({ holding: null, editions: [{ isbn13: '9780765350374' }] });
    const out = await freeDetailsFor(env(db), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });
    assert.equal(out.sources.series, 'wikidata');
    assert.equal(out.sources.seriesIndex, 'wikidata');
    assert.ok(wrote(writes, 'Cradle'));
    assert.ok(wrote(writes, 3));
  });

  it('⚠️ the gate follows a series set EARLIER IN THE SAME RUN, not just the stored one', async () => {
    // Rung 1 files the book under Cradle; a later rung then claims a volume of
    // something else. The book was unfiled when the run started, so a gate that
    // only read `work.series` would wave this through.
    const fetchStub = stubFetch({
      'query.wikidata.org': {
        results: { bindings: [{ seriesLabel: { value: 'The Cosmere' }, ordinal: { value: '7' } }] },
      },
    });
    const { db, writes } = stubDb({
      // Rung 1 answers a series with NO volume, so seriesIndex stays open.
      holding: { series: 'Cradle', index_display: null },
      editions: [{ isbn13: '9780765350374' }],
    });
    const out = await freeDetailsFor(env(db), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.equal(out.sources.series, 'audiobook');
    assert.equal(out.sources.seriesIndex, undefined);
    assert.ok(!wrote(writes, 7));
    assert.ok(out.skipped.some((s) => /names series The Cosmere.*filed under Cradle/.test(s)));
  });

  it('a mismatched volume does not stop a LATER rung answering it correctly', async () => {
    // Dropping the ordinal must leave `seriesIndex` OPEN, not closed-and-empty:
    // the per-field rule says a rung that cannot answer hands on to the next.
    // Hardcover names the right series, Wikidata (asked last) names the universe.
    const fetchStub = stubFetch({
      'api.hardcover.app': {
        data: {
          editions: [
            {
              book: {
                description: null,
                book_series: [
                  { position: 1, series: { name: 'The Stormlight Archive', books_count: 5 } },
                ],
              },
            },
          ],
        },
      },
      'query.wikidata.org': {
        results: { bindings: [{ seriesLabel: { value: 'The Cosmere' }, ordinal: { value: '7' } }] },
      },
    });
    const { db, writes } = stubDb({
      holding: null,
      work: { series: 'The Stormlight Archive', series_index_sort: null },
      editions: [{ isbn13: '9780765326355' }],
    });
    const out = await freeDetailsFor(env(db, { HARDCOVER_API_TOKEN: 'tok' }), 514, ['seriesIndex'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });
    assert.equal(out.sources.seriesIndex, 'hardcover');
    assert.ok(wrote(writes, 1));
    assert.ok(!wrote(writes, 7));
  });
});

// ---------------------------------------------------------------------------
// Rung 3 — Open Library editions
// ---------------------------------------------------------------------------

describe('rung 3 — Open Library editions', () => {
  it('⚠️ takes the series off an EDITION, which is the only place it lives', async () => {
    // covers-and-series.md §3.1: search.json returns series: null for
    // everything, including Unsouled, whose edition says "Cradle, Volume 1".
    const fetchStub = stubFetch({
      '/editions.json': {
        entries: [
          { key: '/books/OL1M', title: 'Unsouled' },
          { key: '/books/OL2M', title: 'Unsouled', series: ['Cradle, Volume 1'] },
        ],
      },
    });
    const { db, writes } = stubDb({ work: { openlibrary_work_id: 'OL1W' }, holding: null });

    const out = await freeDetailsFor(env(db), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.equal(out.sources.series, 'openlibrary');
    assert.equal(out.sources.seriesIndex, 'openlibrary');
    assert.ok(wrote(writes, 'Cradle'));
    assert.ok(wrote(writes, 1));
    assert.ok(
      wrote(writes, 'Volume 1'),
      'the printed designation was QUOTED by the source, so it is worth keeping',
    );
  });

  it('resolves the work key from an ISBN when none is recorded', async () => {
    const fetchStub = stubFetch({
      '/isbn/': { key: '/books/OL9M', works: [{ key: '/works/OL42W' }] },
      '/editions.json': { entries: [{ key: '/books/OL9M', series: ['Mistborn'] }] },
    });
    const { db } = stubDb({ holding: null, editions: [{ isbn13: '9780765350374' }] });

    const out = await freeDetailsFor(env(db), 514, ['series'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.equal(out.sources.series, 'openlibrary');
    assert.ok(fetchStub.calls.some((u) => u.includes('/works/OL42W/editions.json')));
  });

  it('takes the description from the WORK record, in either of its two shapes', async () => {
    const fetchStub = stubFetch({
      '/works/OL1W.json': { description: { type: '/type/text', value: 'A city that fell.' } },
    });
    const { db, writes } = stubDb({ work: { openlibrary_work_id: 'OL1W' }, holding: null });

    const out = await freeDetailsFor(env(db), 514, ['description'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.equal(out.sources.description, 'openlibrary');
    assert.ok(
      wrote(writes, 'A city that fell.'),
      'the object form must be unwrapped — String({…}) would store "[object Object]"',
    );
  });

  it('says by name when there is no key and no ISBN to find one with', async () => {
    const { db } = stubDb({ holding: null, editions: [] });
    const out = await freeDetailsFor(env(db), 514, ['series'], { throttle: false });
    assert.ok(out.skipped.some((s) => s.includes('no work key recorded')));
  });
});

// ---------------------------------------------------------------------------
// Rung 4 — Google Books
// ---------------------------------------------------------------------------

describe('rung 4 — Google Books', () => {
  it('answers the description, and attributes it', async () => {
    const fetchStub = stubFetch({
      'googleapis.com': {
        items: [
          {
            volumeInfo: {
              title: 'Elantris',
              description: 'The capital of Arelon.',
              industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780765350374' }],
            },
          },
        ],
      },
    });
    const { db, writes } = stubDb({ holding: null, editions: [{ isbn13: '9780765350374' }] });

    const out = await freeDetailsFor(env(db, { GOOGLE_BOOKS_API_KEY: 'k' }), 514, ['description'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.equal(out.sources.description, 'googlebooks');
    assert.ok(wrote(writes, 'The capital of Arelon.'));
  });

  it('is skipped by name with no key — anonymous calls answered 429 on 40 of 40', async () => {
    // Everything 404s, so rung 3 finds nothing and `description` is still open
    // when rung 4 is reached. ⚠️ The stub is not decoration: without it this
    // test dials the real openlibrary.org, which is both rude and flaky.
    const fetchStub = stubFetch({});
    const { db } = stubDb({ holding: null, editions: [{ isbn13: '9780765350374' }] });
    const out = await freeDetailsFor(env(db), 514, ['description'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });
    assert.ok(out.skipped.some((s) => s.includes('no GOOGLE_BOOKS_API_KEY')));
  });
});

// ---------------------------------------------------------------------------
// Rung 5 — Hardcover
// ---------------------------------------------------------------------------

describe('rung 5 — Hardcover', () => {
  /** The shape `lookupHardcover` reads, per the published SDL. */
  function hardcoverBody(book: unknown) {
    return { data: { editions: [{ book }] } };
  }

  it('answers description AND a structured series+volume in one call', async () => {
    const fetchStub = stubFetch({
      'api.hardcover.app': hardcoverBody({
        description: 'The capital of Arelon.',
        book_series: [{ position: 1, series: { name: 'Elantris' } }],
      }),
    });
    const { db, writes } = stubDb({ holding: null, editions: [{ isbn13: '9780765350374' }] });

    const out = await freeDetailsFor(env(db, { HARDCOVER_API_TOKEN: 'tok' }), 514, ALL, {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.deepEqual(out.sources, {
      series: 'hardcover',
      seriesIndex: 'hardcover',
      description: 'hardcover',
    });
    assert.ok(wrote(writes, 'The capital of Arelon.'));
    assert.ok(wrote(writes, 'Elantris'));
  });

  it('⚠️ never writes a printed designation from the numeric `position`', async () => {
    const fetchStub = stubFetch({
      'api.hardcover.app': hardcoverBody({
        description: null,
        book_series: [{ position: 1.5, series: { name: 'Cradle' } }],
      }),
    });
    const { db, writes } = stubDb({ holding: null, editions: [{ isbn13: '9780765350374' }] });

    await freeDetailsFor(env(db, { HARDCOVER_API_TOKEN: 'tok' }), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    const update = writes.find((w) => w.sql.includes('UPDATE work SET'));
    assert.ok(update, 'the series and volume should have been written');
    assert.ok(update.bound.includes(1.5), 'the float8 position closes the sort value');
    // ⚠️ `UPDATE work` names every column, so the SQL text proves nothing — the
    // question is whether a STRING form of the number was bound. It must not be:
    // a number is not a designation anybody printed (owner rule, 2026-08-19).
    assert.equal(
      update.bound.some((v) => typeof v === 'string' && v.includes('1.5')),
      false,
      'no printed designation may be derived from the numeric position',
    );
  });

  it('⚠️ is skipped with a NAMED reason when HARDCOVER_API_TOKEN is unset', async () => {
    // The friend instance's state until the owner sets the secret. A rung
    // nobody could ask must not read as a rung that was asked and knew nothing.
    const fetchStub = stubFetch({});
    const { db } = stubDb({ holding: null, editions: [{ isbn13: '9780765350374' }] });

    const out = await freeDetailsFor(env(db), 514, ['description'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.ok(
      out.skipped.some((s) => s === 'Hardcover: not asked — no HARDCOVER_API_TOKEN'),
      `the missing secret must be named. Got: ${JSON.stringify(out.skipped)}`,
    );
    assert.equal(
      fetchStub.calls.some((u) => u.includes('hardcover')),
      false,
      'no token means no request at all',
    );
  });

  it('is asked BEFORE Wikidata — the genre/indie skew gets first crack at the series', async () => {
    const fetchStub = stubFetch({
      'api.hardcover.app': hardcoverBody({
        description: null,
        book_series: [{ position: 2, series: { name: 'The Stormlight Archive' } }],
      }),
      'query.wikidata.org': {
        results: { bindings: [{ seriesLabel: { value: 'WRONG — Wikidata was asked first' } }] },
      },
    });
    const { db } = stubDb({ holding: null, editions: [{ isbn13: '9780765326355' }] });

    const out = await freeDetailsFor(env(db, { HARDCOVER_API_TOKEN: 'tok' }), 514, ['series'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.equal(out.sources.series, 'hardcover');
    assert.equal(
      fetchStub.calls.some((u) => u.includes('query.wikidata.org')),
      false,
      'the series was closed before the Wikidata fallback, so it must not be dialled',
    );
  });

  // -------------------------------------------------------------------------
  // ⚠️ A UNIVERSE must never land in `work.series` (fixed 2026-08-25)
  // -------------------------------------------------------------------------
  //
  // The bug, from a LIVE call on 2026-08-25: ISBN 9780765326355 (The Way of
  // Kings) answers `book_series` = [The Stormlight Archive #1, The Cosmere #7].
  // Hardcover files both as series rows; this catalogue keeps a universe one
  // tier ABOVE a series (`@lc/universes`). Taking the first named row meant
  // HARDCOVER'S ROW ORDER decided which tier got written into `work.series`.
  //
  // ⚠️ These tests use the REAL universe list, not a stub, because the half
  // that can silently break is the wiring: that the predicate `askHardcover`
  // builds folds names the same way the universe filter and facets do. A stub
  // would pass while the fold was wrong. `The Cosmere` and `Cosmere` are both
  // in the shared list's `canonicalNames`; `The Stormlight Archive` is a SERIES
  // inside that universe and is deliberately not.

  /** The live Way of Kings shape, with the row order Hardcover returned. */
  function wayOfKings(order: 'series-first' | 'universe-first') {
    const stormlight = { position: 1, series: { name: 'The Stormlight Archive', books_count: 10 } };
    const cosmere = { position: 7, series: { name: 'The Cosmere', books_count: 40 } };
    return hardcoverBody({
      description: null,
      book_series: order === 'series-first' ? [stormlight, cosmere] : [cosmere, stormlight],
    });
  }

  for (const order of ['series-first', 'universe-first'] as const) {
    it(`⚠️ writes The Stormlight Archive and NOT The Cosmere (${order})`, async () => {
      const fetchStub = stubFetch({ 'api.hardcover.app': wayOfKings(order) });
      const { db, writes } = stubDb({ holding: null, editions: [{ isbn13: '9780765326355' }] });

      const out = await freeDetailsFor(
        env(db, { HARDCOVER_API_TOKEN: 'tok' }),
        514,
        ['series', 'seriesIndex'],
        { throttle: false, fetchImpl: fetchStub.impl },
      );

      assert.equal(out.sources.series, 'hardcover');
      // ⚠️ Asserted through the CHANGE LOG, not by hunting the string in the
      // UPDATE's bound values. `UPDATE work SET` names every column and the
      // work-write path resolves a universe of its own into `work.universe` —
      // so "The Cosmere appears somewhere in this statement" is TRUE and
      // CORRECT. The question is only ever which COLUMN each name landed in.
      assert.equal(
        loggedValue(writes, 'series'),
        '"The Stormlight Archive"',
        'a UNIVERSE must never be written into work.series',
      );
      assert.equal(loggedValue(writes, 'seriesIndexSort'), '1', 'the volume travels with the SERIES');

      // …and the tier that WAS right: `universe` is a separate column, filled
      // by the work-write path from the shared list. Nothing here fights it.
      const update = writes.find((w) => w.sql.includes('UPDATE work SET'));
      assert.ok(update?.bound.includes('The Cosmere'), 'the universe still lands in work.universe');
    });
  }

  it('⚠️ a book whose ONLY named series is a universe is a NAMED skip, not "no series"', async () => {
    // "Hardcover named nothing" and "Hardcover named only a universe" are
    // different facts. Reporting the second as the first sends the next reader
    // hunting for a gap in Hardcover's data that is not there.
    const fetchStub = stubFetch({
      'api.hardcover.app': hardcoverBody({
        description: null,
        book_series: [{ position: 7, series: { name: 'Cosmere', books_count: 40 } }],
      }),
      // Left un-dialled only if the ladder stops; it must NOT stop, because
      // `series` is still open — so Wikidata is allowed to answer nothing.
      'query.wikidata.org': { results: { bindings: [] } },
    });
    const { db, writes } = stubDb({ holding: null, editions: [{ isbn13: '9780765326355' }] });

    const out = await freeDetailsFor(env(db, { HARDCOVER_API_TOKEN: 'tok' }), 514, ['series'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.ok(
      out.skipped.some((s) => s === 'Hardcover: only a universe named, no series'),
      `the universe skip must be named. Got: ${JSON.stringify(out.skipped)}`,
    );
    assert.equal(out.sources.series, undefined, 'nothing was answered, so nothing was sourced');
    assert.equal(loggedValue(writes, 'series'), undefined, 'no series may be written at all');
    // ⚠️ The alias `Cosmere` (no "The") must fold too — that is the whole reason
    // the predicate uses the shared list's canonicalNames map rather than a
    // string compare against the six canonical names.
  });

  it('prefers the SMALLEST books_count when two genuine series remain', async () => {
    const fetchStub = stubFetch({
      'api.hardcover.app': hardcoverBody({
        description: null,
        book_series: [
          { position: 3, series: { name: 'A Publisher Omnibus Grouping', books_count: 55 } },
          { position: 3, series: { name: 'Cradle', books_count: 12 } },
        ],
      }),
    });
    const { db, writes } = stubDb({ holding: null, editions: [{ isbn13: '9780765326355' }] });

    await freeDetailsFor(env(db, { HARDCOVER_API_TOKEN: 'tok' }), 514, ['series'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.equal(loggedValue(writes, 'series'), '"Cradle"');
  });
});

// ---------------------------------------------------------------------------
// Rung 6 — Wikidata
// ---------------------------------------------------------------------------

/**
 * ⚠️ **F21, closed 2026-08-26.** The 2026-08-25 review's last finding named this
 * absence: *"No ladder-level `askWikidata` test — `free-details.test.ts` gained
 * 4 cases for Hardcover in `893dd37`, none for Wikidata in `84df3e1`."*
 * `packages/isbn/test/wikidata.test.ts` proves the QUERY and the parse, and the
 * F9 block above proves the same-series gate. Neither proves the RUNG: that it
 * is reached, attributed, skipped by name, and silent about descriptions.
 */
describe('rung 6 — Wikidata', () => {
  /** The SPARQL envelope `lookupWikidataSeries` reads. */
  function sparql(bindings: unknown[]) {
    return { results: { bindings } };
  }

  it('answers a structured series and ordinal, and records itself as the source', async () => {
    const fetchStub = stubFetch({
      'query.wikidata.org': sparql([
        { seriesLabel: { value: 'The Stormlight Archive' }, ordinal: { value: '1' } },
      ]),
    });
    const { db, writes } = stubDb({ holding: null, editions: [{ isbn13: '9780765326355' }] });

    const out = await freeDetailsFor(env(db), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.deepEqual(out.sources, { series: 'wikidata', seriesIndex: 'wikidata' });
    assert.ok(wrote(writes, 'The Stormlight Archive'));
    assert.ok(wrote(writes, 1));
  });

  it('⚠️ never writes a printed designation from the numeric P1545 ordinal', async () => {
    // Same rule as Hardcover's `position`, same reason (owner rule 2026-08-19):
    // a number is not a designation any publisher printed.
    const fetchStub = stubFetch({
      'query.wikidata.org': sparql([
        { seriesLabel: { value: 'Cradle' }, ordinal: { value: '3.5' } },
      ]),
    });
    const { db, writes } = stubDb({ holding: null, editions: [{ isbn13: '9780765326355' }] });

    await freeDetailsFor(env(db), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    const update = writes.find((w) => w.sql.includes('UPDATE work SET'));
    assert.ok(update, 'the series and volume should have been written');
    assert.ok(update.bound.includes(3.5), 'the ordinal closes the sort value');
    assert.equal(
      update.bound.some((v) => typeof v === 'string' && v.includes('3.5')),
      false,
      'no printed designation may be derived from the ordinal',
    );
  });

  it('cannot answer description — with only that open, the rung is not even asked', async () => {
    // Wikidata carries no synopsis worth using, so spending a subrequest to be
    // told nothing spends it against a ceiling whose overrun is silent.
    const fetchStub = stubFetch({});
    const { db } = stubDb({ holding: null, editions: [{ isbn13: '9780765326355' }] });

    await freeDetailsFor(env(db), 514, ['description'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.equal(
      fetchStub.calls.some((u) => u.includes('query.wikidata.org')),
      false,
      'no SPARQL call may be made for a field this rung cannot answer',
    );
  });

  it('says so BY NAME when there is no ISBN to ask with, and asks nothing', async () => {
    const fetchStub = stubFetch({});
    const { db } = stubDb({ holding: null, editions: [] });

    const out = await freeDetailsFor(env(db), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.ok(
      out.skipped.some((s) => /Wikidata: no ISBN on any edition/.test(s)),
      `a rung that could not be ASKED must say so: ${JSON.stringify(out.skipped)}`,
    );
    assert.equal(fetchStub.calls.some((u) => u.includes('query.wikidata.org')), false);
  });

  it('⚠️ "asked and knew nothing" is a DIFFERENT named skip from "could not be asked"', async () => {
    const fetchStub = stubFetch({ 'query.wikidata.org': sparql([]) });
    const { db, writes } = stubDb({ holding: null, editions: [{ isbn13: '9780765326355' }] });

    const out = await freeDetailsFor(env(db), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.ok(out.skipped.some((s) => /Wikidata: no series recorded for ISBN/.test(s)));
    assert.equal(writes.some((w) => w.sql.includes('UPDATE work SET')), false);
  });

  it('is the LAST free rung — a series Hardcover already answered is not re-asked', async () => {
    const fetchStub = stubFetch({
      'api.hardcover.app': {
        data: {
          editions: [
            {
              book: {
                description: null,
                book_series: [{ position: 1, series: { name: 'Elantris' } }],
              },
            },
          ],
        },
      },
      'query.wikidata.org': sparql([
        { seriesLabel: { value: 'SHOULD NOT BE ASKED' }, ordinal: { value: '9' } },
      ]),
    });
    const { db, writes } = stubDb({ holding: null, editions: [{ isbn13: '9780765350374' }] });

    const out = await freeDetailsFor(
      env(db, { HARDCOVER_API_TOKEN: 'tok' }),
      514,
      ['series', 'seriesIndex'],
      { throttle: false, fetchImpl: fetchStub.impl },
    );

    assert.equal(out.sources.series, 'hardcover');
    assert.equal(
      fetchStub.calls.some((u) => u.includes('query.wikidata.org')),
      false,
      'the per-FIELD stop must reach the last rung too, or the budget is a fiction',
    );
    assert.ok(!wrote(writes, 'SHOULD NOT BE ASKED'));
  });
});

// ---------------------------------------------------------------------------
// The rules that cut across the rungs
// ---------------------------------------------------------------------------

describe('the ladder', () => {
  it('⚠️ stops PER FIELD: rung 1 takes the series, rung 4 still supplies the description', async () => {
    const fetchStub = stubFetch({
      'googleapis.com': {
        items: [{ volumeInfo: { title: 'Blackflame', description: 'Wei Shi Lindon.' } }],
      },
    });
    const { db } = stubDb({
      holding: { title: 'Blackflame', series: 'Cradle', index_display: '3' },
      editions: [{ isbn13: '9781981516032' }],
    });

    const out = await freeDetailsFor(env(db, { GOOGLE_BOOKS_API_KEY: 'k' }), 514, ALL, {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.deepEqual(out.sources, {
      series: 'audiobook',
      seriesIndex: 'audiobook',
      description: 'googlebooks',
    });
    assert.deepEqual(out.stillOpen, [], 'everything asked for was answered');
  });

  it('⚠️ does not re-ask a rung about a field an earlier rung answered', async () => {
    // The Open Library rung must never be dialled for a series rung 1 already
    // has — that is the per-field stop, and the whole subrequest budget rests
    // on it.
    const fetchStub = stubFetch({ '/editions.json': { entries: [] } });
    const { db } = stubDb({
      work: { openlibrary_work_id: 'OL1W' },
      holding: { title: 'Blackflame', series: 'Cradle', index_display: '3' },
    });

    await freeDetailsFor(env(db), 514, ['series', 'seriesIndex'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.deepEqual(fetchStub.calls, [], 'nothing was outstanding, so nothing should be fetched');
  });

  it('⚠️ refuses firstPublished, and says why rather than dropping it', async () => {
    const { db } = stubDb({ holding: null });
    const out = await freeDetailsFor(env(db), 514, ['firstPublished'], { throttle: false });

    assert.deepEqual(out.sources, {});
    assert.deepEqual(out.stillOpen, ['firstPublished'], 'it must still reach the paid rung');
    assert.ok(
      out.skipped.some((s) => s.includes('firstPublished') && s.includes('PRINTING')),
      'an edition year is a printing\'s year — filling first_published from one is a wrong number',
    );
  });

  it('⚠️ respects a recorded gap_verdict — an answered question is not re-asked', async () => {
    const { db, writes } = stubDb({
      verdicts: [{ field: 'series' }],
      holding: { title: 'Elantris', series: 'Cradle', index_display: '1' },
    });

    const out = await freeDetailsFor(env(db), 514, ['series'], { throttle: false });

    assert.deepEqual(out.sources, {});
    assert.deepEqual(writes, [], 'a settled question must not be overwritten by a rung');
    assert.ok(out.skipped.some((s) => s.includes('recorded verdict')));
    assert.deepEqual(out.stillOpen, [], 'and it must not be handed to the paid rung either');
  });

  it('⚠️ writes only into a blank — a column filled while it was out is left alone', async () => {
    // The invariant `revertFinding` depends on: the value before a machine
    // write was always empty.
    const { db, writes } = stubDb({
      work: { series: 'Cradle' },
      holding: { title: 'Blackflame', series: 'Something Else', index_display: null },
    });

    const out = await freeDetailsFor(env(db), 514, ['series'], { throttle: false });

    assert.equal(out.sources.series, undefined, 'nothing was written, so nothing is attributed');
    assert.ok(out.skipped.some((s) => s.includes('already in the series Cradle')));
    assert.equal(
      writes.filter((w) => w.sql.includes('UPDATE work SET')).length,
      0,
      'no UPDATE at all — an unnecessary write would bump updated_at and trigger an index push',
    );
  });

  it('⚠️ never writes a volume number with no series to hang it on', async () => {
    // `applyFinding` refuses exactly this, for exactly this reason.
    const fetchStub = stubFetch({
      '/editions.json': { entries: [{ key: '/books/OL1M', subtitle: 'Volume 4' }] },
    });
    const { db, writes } = stubDb({ work: { openlibrary_work_id: 'OL1W' }, holding: null });

    const out = await freeDetailsFor(env(db), 514, ['seriesIndex'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.equal(out.sources.seriesIndex, undefined);
    assert.equal(writes.filter((w) => w.sql.includes('UPDATE work SET')).length, 0);
  });

  it('survives a rung that throws, and still reaches the ones behind it', async () => {
    const exploding = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const { db } = stubDb({
      work: { openlibrary_work_id: 'OL1W' },
      holding: { title: 'Blackflame', series: 'Cradle', index_display: '3' },
    });

    const out = await freeDetailsFor(env(db), 514, ALL, {
      throttle: false,
      fetchImpl: exploding,
    });

    assert.equal(out.sources.series, 'audiobook', 'rung 1 still answered');
    assert.deepEqual(out.stillOpen, ['description'], 'and the rest goes on to the paid rung');
  });
});

// ---------------------------------------------------------------------------
// ⚠️ The property the owner asked for: nothing is bought when nothing is left
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ⚠️ `askedRungs` — WHICH RUNGS WERE TRIED (2026-09-02)
// ---------------------------------------------------------------------------
//
// > *"tell me why padhard library wasn't resolved by the free lookup with
// > series and description?"* — the owner, 2026-08-26.
//
// `sources` records who ANSWERED. Nothing recorded who was ASKED, so a run that
// stopped at rung 1 and a run whose six rungs all knew nothing left the same
// trace, and the owner's question was unanswerable from the page.
//
// ⚠️ The distinction under test is the one the covers sweep already got wrong
// once (`covers-and-series.md` §0): a rung BELOW the answer was never reached
// and must never be read as a rung that found nothing.
describe('askedRungs — the ladder records who it actually asked', () => {
  it('stops at the rung that answered, and records only the rungs it reached', async () => {
    const { db } = stubDb({
      holding: { title: 'Blackflame', series: 'Cradle', index_display: '3' },
    });
    const out = await freeDetailsFor(env(db), 514, ['series', 'seriesIndex'], { throttle: false });

    assert.deepEqual(out.askedRungs, ['audiobook']);
    assert.deepEqual(out.stillOpen, []);
  });

  it('⚠️ THE ELANTRIS SHAPE: a rung that fell through is recorded as ASKED', async () => {
    // Rung 1 finds a row whose series is NULL. It was asked and it could not
    // answer — which is a completely different sentence from "not reached", and
    // both must be readable off the same list.
    const fetchStub = stubFetch({
      '/editions.json': { entries: [{ key: '/books/OL1M', series: ['Elantris'] }] },
    });
    const { db } = stubDb({
      work: { openlibrary_work_id: 'OL27448W' },
      holding: { title: 'Elantris', series: null, index_display: null },
    });

    const out = await freeDetailsFor(env(db), 514, ['series'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });

    assert.deepEqual(
      out.askedRungs,
      ['audiobook', 'index', 'openlibrary'],
      'rung 1 fell through, rung 2 was asked and skipped for want of a credential, rung 3 answered',
    );
    assert.ok(
      !out.askedRungs.includes('googlebooks'),
      'Google Books sits below the rung that answered and was never reached',
    );
    assert.equal(out.sources.series, 'openlibrary');
  });

  it('records every rung when none of them can close the field', async () => {
    // Nothing linked, no OL key, no ISBN, no keys for the paid-token rungs: the
    // ladder walks the whole way down and comes back with nothing. That is the
    // padhard #578 shape, and the six names are the answer to "what was tried".
    const { db } = stubDb({ holding: null });
    const out = await freeDetailsFor(env(db), 514, ['series', 'seriesIndex'], { throttle: false });

    assert.deepEqual(out.askedRungs, [
      'audiobook',
      'index',
      'openlibrary',
      'googlebooks',
      'hardcover',
      'wikidata',
    ]);
    assert.ok(
      out.skipped.length >= out.askedRungs.length,
      'every rung that could not answer must have said why, in its own line — ' +
        `got ${JSON.stringify(out.skipped)}`,
    );
  });

  it('records nothing when no rung was reachable at all', async () => {
    // `firstPublished` is refused by the whole ladder by design, so the pass
    // returns before a single rung is asked. An EMPTY list is the honest record
    // of that, and it is not the same as no record.
    const { db } = stubDb();
    const out = await freeDetailsFor(env(db), 514, ['firstPublished'], { throttle: false });

    assert.deepEqual(out.askedRungs, []);
    assert.ok(out.skipped.some((s) => s.includes('firstPublished')));
  });
});

describe('runDetailsResearch — the paid call is skipped when the free rungs close everything', () => {
  it('makes NO network call at all, and says so in the run record', async () => {
    const finished: Record<string, unknown>[] = [];

    // Extends the stub with the two research_run queries this path makes. A
    // `fetch` that throws is the assertion: if the model is ever called again
    // for a fully-answered book, this test fails loudly instead of quietly
    // costing money.
    const base = stubDb({
      holding: { title: 'Blackflame', series: 'Cradle', index_display: '3' },
    });
    const db = {
      prepare(sql: string) {
        const inner = (base.db as unknown as { prepare: (s: string) => Record<string, unknown> })
          .prepare(sql);
        if (sql.includes('UPDATE research_run')) {
          let bound: unknown[] = [];
          const stmt = {
            sql,
            boundArgs: () => bound,
            bind(...args: unknown[]) {
              bound = args;
              return stmt;
            },
            async first() {
              finished.push({ status: bound[0], resultJson: bound[4] });
              return {
                id: 1,
                work_id: 514,
                tier: 'details',
                model: 'test',
                effort: 'low',
                status: bound[0],
                error_message: bound[1],
                input_tokens: bound[2],
                output_tokens: bound[3],
                result_json: bound[4],
                input_title: 'Blackflame',
                input_year: null,
                unfilled: ',series,seriesIndex,',
                triggered_by: null,
                started_at: null,
                finished_at: null,
                created_at: '2026-01-01 00:00:00',
              };
            },
          };
          return stmt;
        }
        return inner;
      },
      batch: (base.db as unknown as { batch: (s: unknown[]) => Promise<unknown> }).batch,
    } as unknown as D1Database;

    const realFetch = globalThis.fetch;
    let dialled = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      dialled += 1;
      throw new Error(`nothing should be fetched, but something dialled ${String(input)}`);
    }) as unknown as typeof fetch;

    try {
      const run = await runDetailsResearch(
        env(db, { ANTHROPIC_API_KEY: 'sk-test-never-used' }),
        1,
        514,
        ['series', 'seriesIndex'],
        null,
      );

      assert.equal(dialled, 0, 'the paid lookup must not have been attempted');
      assert.equal(run?.status, 'done', 'a fully-answered book is a finished run, not an error');
      assert.equal(finished.length, 1, 'the run must be closed exactly once');
      assert.match(
        String(finished[0]?.resultJson),
        /no paid lookup was made/,
        'and it has to SAY so — the queue prints this line beside a cost',
      );
      assert.match(
        String(finished[0]?.resultJson),
        /"sources":\{"series":"audiobook","seriesIndex":"audiobook"\}/,
        'the per-field attribution is persisted, so a reload still knows it was free',
      );
      assert.equal(
        run?.inputTokens,
        null,
        'no tokens were spent, so none are recorded — the spend total must not move',
      );
      // ⚠️ **The free ladder's own account of itself is persisted** (2026-09-02).
      // `sources` above says who ANSWERED; this says who was ASKED, and only the
      // second can explain a bill. padhard run 738 had the first and not the
      // second, which is why *"why did this cost money?"* had to be answered by
      // reading code.
      assert.match(
        String(finished[0]?.resultJson),
        /"free":\{"rungs":\["audiobook"\]/,
        'the rungs actually asked must be persisted with the run',
      );
      assert.ok(
        !String(finished[0]?.resultJson).includes('openlibrary'),
        'rung 1 closed everything, so no rung below it may be recorded as asked — ' +
          '"not reached" and "found nothing" are different facts',
      );
      assert.match(
        String(finished[0]?.resultJson),
        /"stillOpen":\[\]/,
        'nothing was handed to the paid rung, and the record has to say so',
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// ⚠️ The ladder's PRICE (F1, 2026-08-25)
// ---------------------------------------------------------------------------
//
// `FREE_LADDER_SUBREQUESTS` in `details-sweep.ts` was a hand-typed `11` while
// two rungs — Hardcover and Wikidata — had already been appended in front of
// the number, and the enumeration it was copied from never counted the
// `getWork` that `updateWork` does before it writes. Every AI-mode book was
// priced four subrequests short against a 50-per-invocation ceiling whose
// overrun does not throw: it silently kills the invocation.
//
// So the price is now DERIVED from `FREE_LADDER_RUNGS`, and these two tests are
// what make the derivation true rather than merely tidy:
//
//   1. every rung in the `FreeRung` union has a priced entry in the table, so a
//      new rung cannot be walked without a number beside it;
//   2. a worst-case run really spends exactly `FREE_DETAILS_SUBREQUESTS` —
//      counted by executing the ladder against a D1 and a `fetch` that tally
//      every call, not by re-adding the table.

describe("the ladder's price", () => {
  /**
   * Wraps a stub D1 and counts what it EXECUTES. `prepare` is free; `first`,
   * `all`, `run` and `batch` are one subrequest each, which is the Worker's
   * own accounting.
   */
  function countingDb(inner: D1Database): { db: D1Database; count: () => number } {
    let calls = 0;
    type Stmt = {
      sql: string;
      boundArgs: () => unknown[];
      bind: (...args: unknown[]) => Stmt;
      first: () => Promise<unknown>;
      all: () => Promise<unknown>;
      run: () => Promise<unknown>;
    };
    const wrap = (stmt: Stmt): Stmt => ({
      sql: stmt.sql,
      boundArgs: () => stmt.boundArgs(),
      bind: (...args: unknown[]) => wrap(stmt.bind(...args)),
      first: async () => {
        calls += 1;
        return stmt.first();
      },
      all: async () => {
        calls += 1;
        return stmt.all();
      },
      run: async () => {
        calls += 1;
        return stmt.run();
      },
    });
    const raw = inner as unknown as {
      prepare: (sql: string) => Stmt;
      batch: (s: Stmt[]) => Promise<unknown>;
    };
    const db = {
      prepare: (sql: string) => wrap(raw.prepare(sql)),
      batch: async (statements: Stmt[]) => {
        calls += 1;
        return raw.batch(statements);
      },
    };
    return { db: db as unknown as D1Database, count: () => calls };
  }

  it('⚠️ prices every rung the union names — a new rung cannot land unpriced', () => {
    // `RUNG_LABEL` is a `Record<DetailSource, string>`, so a new member of the
    // `FreeRung` union already fails to compile without a label. This closes the
    // other half: it must also be walked, and walked at a stated price.
    const named = Object.keys(RUNG_LABEL).filter((r) => r !== 'llm');
    assert.deepEqual(
      [...FREE_LADDER_RUNG_NAMES].sort(),
      named.sort(),
      'every free rung must appear in FREE_LADDER_RUNGS, which is where its subrequest cost lives',
    );
  });

  it('⚠️ a worst-case run spends exactly FREE_DETAILS_SUBREQUESTS', async () => {
    // The most expensive shape the ladder has: no recorded Open Library work
    // key (so the ISBN must be resolved), an audiobook row that exists and
    // cannot answer, ⚠️ the index CONFIGURED and fanned out to its full
    // `INDEX_MAX_IDENTITIES` while answering nothing, both keys present, every
    // rung asked, and a last-rung answer that forces the write. Counted, not
    // computed — a rung added without a price moves this number and fails here.
    const fetchStub = stubFetch({
      '/api/machine/lookup': { query: 'Elantris', title_fold: 'elantris', matches: [] },
      '/isbn/': { works: [{ key: '/works/OL1W' }] },
      '/editions.json': { entries: [] },
      'OL1W.json': {},
      'googleapis.com': { items: [] },
      'api.hardcover.app': { data: { editions: [] } },
      'query.wikidata.org': {
        results: { bindings: [{ seriesLabel: { value: 'Cradle' }, ordinal: { value: '1' } }] },
      },
    });
    const inner = stubDb({
      // A row that exists with a NULL series: rung 1 is really asked and really
      // falls through, which is what makes it cost its subrequest.
      holding: { series: null, index_display: null },
      editions: [{ isbn13: '9780765350374' }],
    });
    const counted = countingDb(inner.db);

    const out = await freeDetailsFor(
      env(counted.db, { GOOGLE_BOOKS_API_KEY: 'k', HARDCOVER_API_TOKEN: 'tok', ...INDEX_ENV }),
      514,
      ALL,
      {
        throttle: false,
        fetchImpl: fetchStub.impl,
        // Two aliases + the catalogued title = INDEX_MAX_IDENTITIES asks, the
        // rung's declared worst case.
        titleAliases: ['The Selish Cycle', 'Spirit of Elantris'],
      },
    );

    assert.equal(out.sources.series, 'wikidata', 'the last rung answered, so the write happened');
    assert.equal(
      counted.count() + fetchStub.calls.length,
      FREE_DETAILS_SUBREQUESTS,
      `worst case really cost ${counted.count()} D1 + ${fetchStub.calls.length} fetch; ` +
        `FREE_DETAILS_SUBREQUESTS says ${FREE_DETAILS_SUBREQUESTS}. ` +
        'Reprice FREE_LADDER_RUNGS rather than editing this number.',
    );
  });
});
