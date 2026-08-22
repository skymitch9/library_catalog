/**
 * The browser-side executor: default-deny, round-trip, and no leaks.
 *
 * Four ways this half can be silently wrong:
 *
 *   1. **The allowlist stops being enforced HERE too.** The turn route checks
 *      inbound conversations; this checks outbound calls. They fail in different
 *      places and neither is redundant — a model that emits `set_book_details`
 *      in phase 1 development would otherwise find an executor waiting.
 *   2. ⚠️ **A projection turns into a passthrough.** `work.workKey` is the join
 *      to a shared Firestore review store across two catalogs; `copies` carry
 *      what was paid and where a book is kept. None of that belongs in a model's
 *      context or in a transcript, and none of it is excluded by NAME — the
 *      allowed fields are an explicit array, so a column added next year is
 *      absent by default. This file is what proves the array is still the array.
 *   3. **A failure becomes an exception.** §8's first row: a 4xx/5xx becomes a
 *      `tool_result` with `is_error: true` carrying the response's OWN sentence,
 *      and the loop continues. A throw would kill the turn and leave the model
 *      unable to say what happened.
 *   4. **The executor grows a fetch.** It takes six functions precisely so it
 *      cannot — `middleware/auth.ts`'s header says a GABI panel must use
 *      `api.ts` and not a hand-rolled request, and the shape is what makes that
 *      structural instead of remembered.
 *
 * ⚠️ Driven against the LEAF, not through `api.ts`. `errors.test.ts` records the
 * reason: `api.ts` → `firebase.ts` reads `import.meta.env`, which is `undefined`
 * outside Vite, so importing it under `tsx` dies at module load before any
 * assertion runs. The executor is a leaf for exactly that reason.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { GABI_TOOL_NAMES } from '../../../packages/core/src/index.js';
import {
  GABI_MAX_CANDIDATES,
  executeGabiTool,
  type GabiReadApi,
} from '../src/lib/gabi.ts';

// ── the fake API ────────────────────────────────────────────────────────────

/** Every field the real endpoints return, including the ones that must not leak. */
const WORK_ROW = {
  id: 42,
  title: 'Unsouled',
  subtitle: null,
  authors: 'Will Wight',
  primaryAuthor: 'Will Wight',
  // ⚠️ THE ONE THAT MATTERS. work_key joins ~860 reviews across two catalogs.
  workKey: 'unsouled|will wight',
  sortTitle: 'unsouled',
  series: 'Cradle',
  seriesIndexSort: 1,
  seriesIndexDisplay: '1',
  firstPublished: 2016,
  openlibraryWorkId: 'OL123W',
  description: 'A boy from a backwater sect.',
  coverUrl: 'https://example.com/c.jpg',
  coverStatus: 'ok',
  illustrator: null,
};

function fakeApi(overrides: Partial<GabiReadApi> = {}): { api: GabiReadApi; calls: string[] } {
  const calls: string[] = [];
  const api: GabiReadApi = {
    searchCollection: async (q) => {
      calls.push(`searchCollection(${q})`);
      return {
        rows: [
          { ...WORK_ROW, copyCount: 2, formats: 'ebook', readState: 'read', openWatches: 0 },
          { ...WORK_ROW, id: 43, title: 'Soulsmith', seriesIndexDisplay: '2' },
        ],
        total: 2,
        page: 1,
        pageSize: 24,
        sort: 'title',
        dir: 'asc',
      };
    },
    work: async (id) => {
      calls.push(`work(${id})`);
      return {
        work: WORK_ROW,
        editions: [{ id: 1 }, { id: 2 }],
        // ⚠️ Money and location. Never leaves.
        copies: [{ id: 9, status: 'owned', location: 'Bedroom shelf', pricePaidCents: 1499 }],
        watches: [{ id: 3, note: 'check the cover', resolvedAt: null }, { id: 4, resolvedAt: 'x' }],
        reading: { readState: 'read' },
        universe: null,
        audiobookHolding: null,
        ebookHolding: null,
      };
    },
    queue: async () => {
      calls.push('queue()');
      return {
        works: Array.from({ length: 40 }, (_, i) => ({
          workId: i + 1,
          title: `Book ${i + 1}`,
          authors: 'Someone',
          series: null,
          missing: ['description'],
          missingLabels: ['Description'],
          answered: [],
          answeredLabels: [],
          pending: 0,
        })),
        summary: [{ field: 'description', label: 'Description', missing: 40, filled: 3, none: 0, unknown: 1 }],
        refused: [{ field: 'isbn', because: 'a work has no ISBN' }],
        runs: [],
        spent: { runs: 4, errors: 0, inputTokens: 1, outputTokens: 2, estimatedCents: 3 },
        model: 'claude-opus-5',
        centsEach: { low: 2, high: 8 },
        configured: true,
      };
    },
    autoApplied: async (limit) => {
      calls.push(`autoApplied(${limit})`);
      return {
        applied: [
          {
            findingId: 5,
            workId: 42,
            title: 'Unsouled',
            authors: 'Will Wight',
            field: 'firstPublished',
            value: 2016,
            sourceTier: 'official',
            sourceUrl: 'https://example.com',
            appliedAt: '2026-08-17T10:00:00Z',
          },
        ],
      };
    },
    workChanges: async (id) => {
      calls.push(`workChanges(${id})`);
      return {
        changes: [
          {
            id: 1,
            batchId: 'b1',
            entity: 'work',
            entityId: 42,
            field: 'firstPublished',
            oldValue: null,
            newValue: 2016,
            changedBy: 3,
            changedByName: 'Sam',
            changedHow: 'auto',
            note: 'gabi:conv-1',
            createdAt: '2026-08-17T10:00:00Z',
          },
        ],
      };
    },
    ...overrides,
  };
  return { api, calls };
}

const describeError = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function call(api: GabiReadApi, name: string, input: unknown = {}) {
  return executeGabiTool(api, { id: 'toolu_1', name, input }, describeError);
}

// ── 1. default-deny ─────────────────────────────────────────────────────────

describe('⚠️ the executor is DEFAULT-DENY, the same way the route is', () => {
  it('every allowlisted tool has an executor that answers', async () => {
    const { api } = fakeApi();
    for (const name of GABI_TOOL_NAMES) {
      const out = await call(api, name, name === 'get_book' ? { workId: 42 } : {});
      assert.equal(out.isError, false, `'${name}' has no working executor`);
      assert.ok(out.result, `'${name}' answered with nothing`);
    }
  });

  it('no executor exists for a write tool from a later phase', async () => {
    // ⚠️ **This list is DERIVED, and it is derived because the hardcoded one
    // went stale and went red.** It named the phase-1 writes —
    // `set_book_details`, `research_book`, `undo_changes` — as "later phase",
    // and on 2026-08-21 phase 1 shipped them. A guard that has to be rewritten
    // every time a phase lands is a guard somebody eventually rewrites by
    // deleting, so the invariant is stated the way the executor actually
    // states it: **anything not in `GABI_TOOL_NAMES` is refused.**
    //
    // The names below are §4.2's planned writes that have NOT shipped. The
    // filter is what keeps this honest: when one of them is allowlisted it
    // drops out of the loop by itself, and the assertion under the loop is
    // what stops the loop quietly emptying to nothing and testing air.
    const planned = ['set_cover_from_url', 'merge_works', 'set_read_state'];
    const unshipped = planned.filter((n) => !(GABI_TOOL_NAMES as readonly string[]).includes(n));
    assert.ok(unshipped.length > 0, 'every planned write has shipped: name the next unshipped one');

    const { api, calls } = fakeApi();
    for (const name of unshipped) {
      const out = await call(api, name, { workId: 42 });
      assert.equal(out.isError, true, `'${name}' was executed`);
      assert.match(String((out.result as { error: string }).error), new RegExp(name));
    }
    assert.deepEqual(calls, [], 'a refused tool still reached the API');
  });

  it('no executor exists for anything §4.3 excludes forever', async () => {
    const { api, calls } = fakeApi();
    for (const name of ['delete_work', 'set_title', 'set_user_role', 'export_catalog', 'create_work']) {
      assert.equal((await call(api, name)).isError, true, `'${name}' was executed`);
    }
    assert.deepEqual(calls, []);
  });

  it('a refusal says nothing was attempted — never a bare no-op', async () => {
    const { api } = fakeApi();
    const out = await call(api, 'delete_work');
    assert.match(String((out.result as { detail: string }).detail), /nothing was attempted/i);
  });

  it('the tool_use id travels back, so the result can be matched to its call', async () => {
    const { api } = fakeApi();
    const out = await executeGabiTool(api, { id: 'toolu_xyz', name: 'list_gaps', input: {} }, describeError);
    assert.equal(out.toolUseId, 'toolu_xyz');
  });
});

// ── 2. projections ──────────────────────────────────────────────────────────

describe('⚠️ EXPLICIT PROJECTIONS — a new column must not arrive by default', () => {
  it('get_book carries the eleven fields it declares, and NOT work_key', async () => {
    const { api } = fakeApi();
    const out = await call(api, 'get_book', { workId: 42 });
    const book = (out.result as { book: Record<string, unknown> }).book;

    assert.deepEqual(Object.keys(book).sort(), [
      'authors',
      'coverStatus',
      'coverUrl',
      'description',
      'firstPublished',
      'id',
      'illustrator',
      'series',
      'seriesIndexDisplay',
      'subtitle',
      'title',
    ]);
    // ⚠️ THE assertion. work_key is the join to a shared Firestore review store
    // across two catalogs; the design's §4.3 makes title/authors unreachable for
    // the same reason, and the key itself has no business in a transcript.
    assert.equal('workKey' in book, false, 'work_key leaked into a tool result');
    assert.equal('sortTitle' in book, false);
    assert.equal('openlibraryWorkId' in book, false);
  });

  it('⚠️ get_book never carries copies — that is what was paid and where it is kept', async () => {
    const { api } = fakeApi();
    const out = await call(api, 'get_book', { workId: 42 });
    const serialised = JSON.stringify(out.result);
    assert.equal(typeof (out.result as { copies: unknown }).copies, 'number', 'copies should be a COUNT');
    assert.doesNotMatch(serialised, /Bedroom shelf/, 'a copy location leaked');
    assert.doesNotMatch(serialised, /pricePaidCents|1499/, 'what was paid for a book leaked');
  });

  it('get_book counts only OPEN watches — a resolved one is not outstanding', async () => {
    const { api } = fakeApi();
    const out = await call(api, 'get_book', { workId: 42 });
    assert.equal((out.result as { openWatches: number }).openWatches, 1);
  });

  it('null is KEPT — "nobody recorded this" is the fact GABI most needs', async () => {
    const { api } = fakeApi();
    const out = await call(api, 'get_book', { workId: 42 });
    const book = (out.result as { book: Record<string, unknown> }).book;
    assert.equal('subtitle' in book, true, 'a null field was dropped');
    assert.equal(book['subtitle'], null);
    assert.match(String((out.result as { note: string }).note), /not that the book has none/);
  });

  it('find_book carries five columns per candidate — enough to tell two books apart', async () => {
    const { api } = fakeApi();
    const out = await call(api, 'find_book', { query: 'cradle' });
    const candidates = (out.result as { candidates: Record<string, unknown>[] }).candidates;
    assert.deepEqual(Object.keys(candidates[0]!).sort(), [
      'authors',
      'id',
      'series',
      'seriesIndexDisplay',
      'title',
    ]);
    assert.doesNotMatch(JSON.stringify(out.result), /workKey/);
  });

  it('a change row drops the internal ids and keeps the diff', async () => {
    const { api } = fakeApi();
    const out = await call(api, 'list_recent_changes', { workId: 42 });
    const change = (out.result as { changes: Record<string, unknown>[] }).changes[0]!;
    assert.deepEqual(Object.keys(change).sort(), [
      'changedByName',
      'changedHow',
      'createdAt',
      'field',
      'newValue',
      'note',
      'oldValue',
    ]);
    assert.equal('changedBy' in change, false, 'a raw user id leaked');
    assert.equal('batchId' in change, false);
  });
});

// ── 3. round trip ───────────────────────────────────────────────────────────

describe('tool responses round-trip: the call reaches the right endpoint, the answer comes back', () => {
  it('find_book searches the collection and reports how many matched', async () => {
    const { api, calls } = fakeApi();
    const out = await call(api, 'find_book', { query: 'cradle' });
    assert.deepEqual(calls, ['searchCollection(cradle)']);
    const result = out.result as { total: number; candidates: unknown[]; note: string };
    assert.equal(result.total, 2);
    assert.equal(result.candidates.length, 2);
    // ⚠️ The instruction carried IN the result, at the moment the model is
    // tempted to guess. §4.2: "never guess an id."
    assert.match(result.note, /do not choose/i);
  });

  it('one match says so, and nothing says "pick"', async () => {
    const { api } = fakeApi({
      searchCollection: async () => ({ rows: [WORK_ROW], total: 1 }),
    });
    const out = await call(api, 'find_book', { query: 'unsouled' });
    assert.match(String((out.result as { note: string }).note), /exactly one/i);
  });

  it('⚠️ nothing found is an ANSWER, and the result says so in words', async () => {
    const { api } = fakeApi({ searchCollection: async () => ({ rows: [], total: 0 }) });
    const out = await call(api, 'find_book', { query: 'a book nobody owns' });
    assert.equal(out.isError, false, 'an empty search is not an error');
    assert.match(String((out.result as { note: string }).note), /an answer, not a failure/i);
  });

  it('a long candidate list is capped rather than sent whole', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ ...WORK_ROW, id: i }));
    const { api } = fakeApi({ searchCollection: async () => ({ rows, total: 40 }) });
    const out = await call(api, 'find_book', { query: 'the' });
    const result = out.result as { candidates: unknown[]; total: number };
    assert.equal(result.candidates.length, GABI_MAX_CANDIDATES);
    assert.equal(result.total, 40, 'the real total is still reported');
  });

  it('list_gaps leads with the TALLY and marks the rows as truncated', async () => {
    const { api, calls } = fakeApi();
    const out = await call(api, 'list_gaps');
    assert.deepEqual(calls, ['queue()']);
    const result = out.result as {
      summary: unknown[];
      examples: unknown[];
      truncated: boolean;
      booksNeedingDetails: number;
      lookupsConfigured: boolean;
    };
    assert.equal(result.summary.length, 1);
    assert.equal(result.booksNeedingDetails, 40, 'the real count survives the cap');
    assert.equal(result.truncated, true);
    assert.equal(result.lookupsConfigured, true);
  });

  it('list_recent_changes with no workId asks for the catalog-wide list', async () => {
    const { api, calls } = fakeApi();
    const out = await call(api, 'list_recent_changes', {});
    assert.match(calls[0]!, /^autoApplied\(/);
    assert.ok((out.result as { applied: unknown[] }).applied.length === 1);
  });

  it('list_recent_changes with a workId asks for that book’s audit trail', async () => {
    const { api, calls } = fakeApi();
    const out = await call(api, 'list_recent_changes', { workId: 42 });
    assert.deepEqual(calls, ['workChanges(42)']);
    // The distinction the whole audit rests on, spelled out for the model.
    assert.match(String((out.result as { note: string }).note), /nobody read the value/);
  });

  it('a junk workId is refused without a request', async () => {
    const { api, calls } = fakeApi();
    for (const workId of ['banana', -1, 0, 1.5, null]) {
      const out = await call(api, 'get_book', { workId });
      assert.match(String((out.result as { error: string }).error), /not a work id/i);
    }
    assert.deepEqual(calls, [], 'a junk id reached the API');
  });

  it('missing input does not throw — the model can send anything', async () => {
    const { api } = fakeApi();
    for (const input of [undefined, null, 'a string', 42, []]) {
      const out = await executeGabiTool(api, { id: 't', name: 'find_book', input }, describeError);
      assert.equal(out.isError, false);
    }
  });
});

// ── 4. failures ─────────────────────────────────────────────────────────────

describe('⚠️ a failed call is a RESULT, not an exception — the loop continues', () => {
  it('carries the server’s own sentence back as is_error', async () => {
    const worded = 'Running research needs the moderator role. Ask an owner or admin to grant it.';
    const { api } = fakeApi({
      queue: async () => {
        throw new Error(worded);
      },
    });
    const out = await call(api, 'list_gaps');
    assert.equal(out.isError, true);
    // ⚠️ Verbatim. §8: "Every sentence GABI shows about a write is quoted from
    // the server's response, never composed." A rewrite here would be the loop
    // inventing wording that reads like the app's.
    assert.equal((out.result as { error: string }).error, worded);
  });

  it('never throws, whatever the API does', async () => {
    const { api } = fakeApi({
      work: async () => {
        throw new Error('Failed to fetch');
      },
    });
    await assert.doesNotReject(() => call(api, 'get_book', { workId: 1 }));
  });

  it('survives a malformed response rather than throwing on it', async () => {
    const { api } = fakeApi({
      searchCollection: async () => null,
      work: async () => 'not an object',
      queue: async () => ({ works: 'nope' }),
    });
    for (const [name, input] of [
      ['find_book', { query: 'x' }],
      ['get_book', { workId: 1 }],
      ['list_gaps', {}],
    ] as const) {
      const out = await call(api, name, input);
      assert.equal(out.isError, false, `'${name}' turned a shape surprise into an error`);
    }
  });
});

// ── 5. the shape that keeps it honest ───────────────────────────────────────

describe('⚠️ the executor cannot reach the network on its own', () => {
  const SOURCE = readFileSync(
    fileURLToPath(new URL('../src/lib/gabi.ts', import.meta.url).href),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('holds no fetch, no XMLHttpRequest and no URL construction', () => {
    // middleware/auth.ts: "A GABI panel must use api.ts, not a hand-rolled
    // fetch" — because in THIS app the live token IS the access control, unlike
    // the audiobook site's localStorage string. Comments are stripped first: the
    // header quotes that rule verbatim, and a naive grep matches the prose.
    for (const forbidden of [/\bfetch\s*\(/, /XMLHttpRequest/, /new URL\(/, /\/api\//]) {
      assert.doesNotMatch(SOURCE, forbidden, `the executor reaches the network itself: ${forbidden}`);
    }
  });

  it('does not import api.ts — that would make it untestable outside Vite', () => {
    assert.doesNotMatch(SOURCE, /from '\.\.\/api/, 'the executor stopped being a leaf');
    assert.doesNotMatch(SOURCE, /firebase/);
  });
});
