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
import { freeDetailsFor, readSeriesLabel, readVolumeDisplay } from './free-details.js';
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
// Rung 2 — the dark index rung
// ---------------------------------------------------------------------------

describe('rung 2 — the estate index', () => {
  it('⚠️ is skipped with a NAMED reason when INDEX_READ_TOKEN is unset, and names the gap', async () => {
    const { db } = stubDb({ holding: null });
    const out = await freeDetailsFor(env(db, { INDEX_URL: 'https://index.heygabi.ai' }), 514, [
      'series',
    ], { throttle: false });

    const reason = out.skipped.find((s) => s.startsWith('the estate index:'));
    assert.ok(reason, 'an unaskable rung must say so — it is not the same as "nothing found"');
    assert.match(reason, /INDEX_READ_TOKEN/, 'the missing thing must be named, so it can be fixed');
    assert.match(reason, /index-worker/, 'and so must the mount that would have to accept it');
  });

  it('never invents a token: with INDEX_URL set and no token, nothing is fetched', async () => {
    const fetchStub = stubFetch({});
    const { db } = stubDb({ holding: null });
    await freeDetailsFor(env(db, { INDEX_URL: 'https://index.heygabi.ai' }), 514, ['series'], {
      throttle: false,
      fetchImpl: fetchStub.impl,
    });
    assert.equal(
      fetchStub.calls.filter((u) => u.includes('index.heygabi.ai')).length,
      0,
      'a dark rung must not dial the host at all',
    );
  });

  it('answers when a token IS configured (the shape is unverified — see the module header)', async () => {
    const fetchStub = stubFetch({ '/api/lookup': { series: 'Cradle', series_index: 3 } });
    const { db } = stubDb({ holding: null });
    const out = await freeDetailsFor(
      env(db, { INDEX_URL: 'https://index.heygabi.ai', INDEX_READ_TOKEN: 'test-only' }),
      514,
      ['series', 'seriesIndex'],
      { throttle: false, fetchImpl: fetchStub.impl },
    );
    assert.equal(out.sources.series, 'index');
    assert.equal(out.sources.seriesIndex, 'index');
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
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
