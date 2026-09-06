/**
 * The audiobook sweep's guards — §6.2 plus the one phase 0 measured.
 *
 * ⚠️ **Every test here is about a run that must NOT write.** The sweep's stale
 * phase marks every holding it did not reproduce, so each of these is one step
 * away from a catalog telling the owner he does not own books that are in the
 * house — on both instances, with nobody watching. They are asserted on the
 * WRITE, not on the return value alone: a function that returns
 * `state: 'failed'` after having already batched is a function that failed
 * safely on paper only.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  AUDIOBOOK_CSV_URL,
  AUDIOBOOK_SWEEP_CRON,
  MASS_DRIFT_CAP_PERCENT,
  associateWorkAfterAdd,
  audiobookSweepMode,
  runAudiobookSweep,
} from './audiobook-sweep-run.js';
import type { Env } from '../env.js';

// ---------------------------------------------------------------------------
// A fake catalog: one CSV, one D1
// ---------------------------------------------------------------------------

const HEADER =
  'title,series,series_index_display,series_index_sort,author,narrator,year,genre,' +
  'duration_hhmm,cover_href,companion_files,desc,library_work_id,library_formats,universe,series_gap';

function csv(rows: number): string {
  const lines = [HEADER];
  for (let i = 1; i <= rows; i += 1) {
    lines.push(
      `The Primal Hunter ${i},The Primal Hunter,${i},${i},Zogarth,Travis Baldree,2021,LitRPG,` +
        `12:00,covers/Zogarth/ph${i}.jpg,,A book,,,,`,
    );
  }
  return lines.join('\n');
}

interface FakeState {
  /** Every statement the fake was asked to run or batch. */
  written: string[];
  batches: number;
  runRows: { id: number; state: string; detail: unknown }[];
  works: { id: number; title: string; authors: string }[];
  snapshot: { etag: string | null; rowCount: number } | null;
  /**
   * How many times the snapshot row was WRITTEN.
   *
   * ⚠️ Counted rather than inferred from the value: a replay rewrites the same
   * etag and the same row count, so comparing the object cannot tell a skipped
   * write from a redundant one — and the point of skipping it is `fetched_at`,
   * which the stored value here does not carry.
   */
  snapshotWrites: number;
}

function fakeEnv(over: Partial<FakeState> = {}, envOver: Partial<Env> = {}) {
  const state: FakeState = {
    written: [],
    batches: 0,
    runRows: [],
    works: [{ id: 1, title: 'The Primal Hunter 1', authors: 'Zogarth' }],
    snapshot: null,
    snapshotWrites: 0,
    ...over,
  };

  const stmt = (sql: string) => {
    let binds: unknown[] = [];
    const api = {
      /** So `batch()` can say WHICH table a batched statement touched. */
      _sql: sql,
      bind(...args: unknown[]) {
        binds = args;
        return api;
      },
      async first() {
        if (/FROM audiobook_snapshot/.test(sql)) {
          return state.snapshot
            ? {
                etag: state.snapshot.etag,
                fetched_at: '2026-09-05 00:00:00',
                row_count: state.snapshot.rowCount,
              }
            : null;
        }
        if (/INSERT INTO audiobook_sweep_run/.test(sql)) {
          const id = state.runRows.length + 1;
          state.runRows.push({ id, state: 'running', detail: null });
          return { id };
        }
        return null;
      },
      async run() {
        if (/UPDATE audiobook_sweep_run/.test(sql)) {
          const row = state.runRows.find((r) => r.id === binds[2]);
          if (row) {
            row.state = String(binds[0]);
            row.detail = JSON.parse(String(binds[1]));
          }
          return { meta: { changes: 1 } };
        }
        if (/INSERT INTO audiobook_snapshot/.test(sql)) {
          state.snapshot = { etag: binds[0] as string | null, rowCount: Number(binds[1]) };
          state.snapshotWrites += 1;
          return { meta: { changes: 1 } };
        }
        state.written.push(sql);
        return { meta: { changes: 1 } };
      },
      async all() {
        if (/FROM work ORDER BY id/.test(sql)) {
          return {
            results: state.works.map((w) => ({
              id: w.id,
              title: w.title,
              authors: w.authors,
              series: 'The Primal Hunter',
              series_index_sort: 1,
            })),
          };
        }
        return { results: [] };
      },
    };
    return api;
  };

  const env = {
    AUDIOBOOK_SWEEP_MODE: 'enforce',
    DB: {
      prepare: (sql: string) => stmt(sql),
      async batch(statements: unknown[]) {
        state.batches += 1;
        state.written.push(`BATCH(${statements.length})`);
        // ⚠️ The batched SQL is recorded too, because there are TWO halves now
        // and "nothing was written" has to be answerable per table.
        for (const st of statements) state.written.push(String((st as { _sql?: string })._sql ?? ''));
        return statements.map(() => ({ success: true }));
      },
    },
    ...envOver,
  } as unknown as Env;

  return { env, state };
}

/** Swap `fetch` for one canned answer, and put it back afterwards. */
const realFetch = globalThis.fetch;
function stubFetch(answer: () => Response | Promise<Response> | never) {
  globalThis.fetch = (async () => answer()) as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

function csvResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/csv', etag: '"abc"' },
    ...init,
  });
}

/** Did anything reach the holding tables? */
function wroteHoldings(state: FakeState): boolean {
  return state.batches > 0 || state.written.some((s) => /audiobook_(edition|series)_holding/.test(s));
}

/** Did anything reach `series_volume` / `series_check` — the OTHER half of a tick? */
function wroteSeriesVolumes(state: FakeState): boolean {
  return state.written.some((s) => /INSERT INTO series_(volume|check)/.test(s));
}

// ---------------------------------------------------------------------------

describe('the mode ladder fails CLOSED', () => {
  it('unset, blank, misspelt and unknown all resolve to off', () => {
    for (const raw of [undefined, '', '  ', 'shadowy', 'ENFORCED', 'on', 'true', 'yes']) {
      assert.equal(
        audiobookSweepMode({ AUDIOBOOK_SWEEP_MODE: raw }),
        'off',
        `"${raw}" must not switch a stale sweep on`,
      );
    }
  });

  it('reads the two live values, case- and space-insensitively', () => {
    assert.equal(audiobookSweepMode({ AUDIOBOOK_SWEEP_MODE: 'shadow' }), 'shadow');
    assert.equal(audiobookSweepMode({ AUDIOBOOK_SWEEP_MODE: ' Enforce ' }), 'enforce');
  });

  it('mode off costs nothing — no fetch, no run row, no write', async () => {
    let fetched = false;
    stubFetch(() => {
      fetched = true;
      return csvResponse(csv(10));
    });
    const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'off' });
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.equal(result.state, 'skipped');
    assert.equal(result.detail, 'mode off');
    assert.equal(result.runId, null);
    assert.equal(fetched, false);
    assert.equal(wroteHoldings(state), false);
  });
});

describe('§6.2 guard 1 — zero rows is a failure, not an empty catalog', () => {
  it('a header-only body fails the run and writes nothing', async () => {
    stubFetch(() => csvResponse(HEADER));
    const { env, state } = fakeEnv();
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.equal(result.state, 'failed');
    assert.equal(result.detail, 'empty snapshot');
    assert.equal(wroteHoldings(state), false);
    assert.equal(state.runRows[0]!.state, 'failed');
  });

  it('an empty body fails the same way', async () => {
    stubFetch(() => csvResponse(''));
    const { env, state } = fakeEnv();
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.equal(result.state, 'failed');
    assert.equal(wroteHoldings(state), false);
  });

  it('🔴 the snapshot is NOT updated by a refused fetch', async () => {
    // The baseline-poisoning bug: a snapshot written from a broken read makes
    // the NEXT tick compare against the broken number, find no drift, and sail
    // through. Guard 2 would destroy itself on first use.
    stubFetch(() => csvResponse(HEADER));
    const { env, state } = fakeEnv({ snapshot: { etag: '"old"', rowCount: 1088 } });
    await runAudiobookSweep(env, { trigger: 'cron' });
    assert.deepEqual(state.snapshot, { etag: '"old"', rowCount: 1088 });
  });
});

describe('§6.2 guard 2 — mass drift', () => {
  it(`a drop of more than ${MASS_DRIFT_CAP_PERCENT}% fails with BOTH numbers`, async () => {
    stubFetch(() => csvResponse(csv(900)));
    const { env, state } = fakeEnv({ snapshot: { etag: '"old"', rowCount: 1000 } });
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.equal(result.state, 'failed');
    assert.match(result.detail ?? '', /^drift: 900 rows against 1000 last time/);
    assert.equal(wroteHoldings(state), false);
  });

  it('a drop INSIDE the cap is news, not a failure', async () => {
    // 990 of 1000 is 1% — a book removed from the sibling catalog, which is a
    // thing that happens and must not stop the sweep.
    stubFetch(() => csvResponse(csv(990)));
    const { env } = fakeEnv({ snapshot: { etag: '"old"', rowCount: 1000 } });
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.notEqual(result.state, 'failed');
  });

  it('GROWTH is never drift', async () => {
    stubFetch(() => csvResponse(csv(50)));
    const { env } = fakeEnv({ snapshot: { etag: '"old"', rowCount: 10 } });
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.notEqual(result.state, 'failed');
  });

  it('the first ever run has no baseline and is not refused for lacking one', async () => {
    stubFetch(() => csvResponse(csv(5)));
    const { env } = fakeEnv({ snapshot: null });
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.notEqual(result.state, 'failed');
  });
});

describe('the fourth guard — a zero-WORKS read is a refused run', () => {
  it('reads zero works → failed: empty-read, nothing written', async () => {
    // Measured in phase 0: one `--remote` run returned 0 works and EXITED 0.
    // In a Worker the same empty read reaches the stale sweep with nothing to
    // reproduce — guard 1's disaster arriving through the other door.
    stubFetch(() => csvResponse(csv(50)));
    const { env, state } = fakeEnv({ works: [] });
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.equal(result.state, 'failed');
    assert.equal(result.detail, 'empty-read');
    assert.equal(wroteHoldings(state), false);
  });
});

describe('the conditional GET', () => {
  it('a 304 is `skipped: unchanged` and writes nothing', async () => {
    stubFetch(() => new Response(null, { status: 304 }));
    const { env, state } = fakeEnv({ snapshot: { etag: '"abc"', rowCount: 1088 } });
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.equal(result.state, 'skipped');
    assert.equal(result.detail, 'unchanged');
    assert.equal(wroteHoldings(state), false);
  });

  it('sends If-None-Match when a snapshot etag exists, and not when it does not', async () => {
    const seen: (HeadersInit | undefined)[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      seen.push(init?.headers);
      return new Response(null, { status: 304 });
    }) as typeof fetch;

    const withEtag = fakeEnv({ snapshot: { etag: '"abc"', rowCount: 10 } });
    await runAudiobookSweep(withEtag.env, { trigger: 'cron' });
    const without = fakeEnv({ snapshot: null });
    await runAudiobookSweep(without.env, { trigger: 'cron' });

    assert.deepEqual(seen[0], { 'If-None-Match': '"abc"' });
    assert.deepEqual(seen[1], {});
  });

  it('the URL is the published CSV, never the index Worker', () => {
    // §3.1: the index has no narrator and no series_index_display, by POLICY.
    assert.equal(AUDIOBOOK_CSV_URL, 'https://audiobooks.heygabi.ai/catalog.csv');
  });
});

describe('it never rejects', () => {
  it('a non-2xx is a RECORDED failure, not a thrown exception', async () => {
    stubFetch(() => new Response('<html>origin down</html>', { status: 502 }));
    const { env, state } = fakeEnv();
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.equal(result.state, 'failed');
    assert.equal(result.detail, 'origin answered 502');
    assert.equal(state.runRows[0]!.state, 'failed');
    assert.equal(wroteHoldings(state), false);
  });

  it('a fetch that throws is folded into the result', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network is unreachable');
    }) as typeof fetch;
    const { env } = fakeEnv();
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.equal(result.state, 'failed');
    assert.match(result.detail ?? '', /fetch failed: network is unreachable/);
  });

  it('🔴 a database that has gone away does not reject either', async () => {
    stubFetch(() => csvResponse(csv(10)));
    const env = {
      AUDIOBOOK_SWEEP_MODE: 'enforce',
      DB: {
        prepare() {
          throw new Error('D1_ERROR: no such table');
        },
        batch() {
          throw new Error('D1_ERROR');
        },
      },
    } as unknown as Env;
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.equal(result.state, 'failed');
    assert.ok(result.detail);
  });

  it('every failure path settles rather than rejecting — swept together', async () => {
    // The guarantee `scheduled()` relies on, asserted as one property over all
    // four shapes of bad news rather than trusted per branch.
    const answers: Array<() => Response> = [
      () => csvResponse(HEADER),
      () => new Response(null, { status: 500 }),
      () => new Response(null, { status: 304 }),
      () => csvResponse(csv(3)),
    ];
    for (const answer of answers) {
      stubFetch(answer);
      const { env } = fakeEnv({ snapshot: { etag: '"abc"', rowCount: 1000 } });
      await assert.doesNotReject(() => runAudiobookSweep(env, { trigger: 'cron' }));
    }
  });
});

describe('shadow mode', () => {
  it('computes the whole plan and writes NOTHING', async () => {
    stubFetch(() => csvResponse(csv(20)));
    const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'shadow' });
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.equal(result.state, 'shadow');
    assert.equal(wroteHoldings(state), false);
    // The plan is RECORDED — that is what makes a shadow tick evidence for the
    // §8 phase-2 gate rather than a no-op.
    assert.ok(result.plan);
    assert.equal(result.plan!.audiobookCount, 20);
    assert.equal(result.plan!.workCount, 1);
    assert.ok(result.plan!.editionUpserts >= 1, 'the plan must have found the match');
    const recorded = state.runRows[0]!.detail as { plan: { editionUpserts: number } };
    assert.equal(recorded.plan.editionUpserts, result.plan!.editionUpserts);
  });

  it('a dryRun in ENFORCE mode also writes nothing', async () => {
    stubFetch(() => csvResponse(csv(20)));
    const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'enforce' });
    const result = await runAudiobookSweep(env, { trigger: 'admin', dryRun: true });
    assert.equal(result.state, 'shadow');
    assert.match(result.detail ?? '', /dry run/);
    assert.equal(wroteHoldings(state), false);
  });

  it('⚠️ the recorded plan carries COUNTS, never a title or a narrator', async () => {
    // `detail_json` is read back by `/api/health`, which is unauthenticated on
    // purpose. A shape carrying edition titles would be one careless spread
    // away from publishing what the household listens to.
    stubFetch(() => csvResponse(csv(20)));
    const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'shadow' });
    await runAudiobookSweep(env, { trigger: 'cron' });
    const json = JSON.stringify(state.runRows[0]!.detail);
    assert.ok(!/Travis Baldree/.test(json), 'a narrator reached the run row');
    assert.ok(!/The Primal Hunter 1/.test(json), 'an edition title reached the run row');
  });
});

describe('enforce mode', () => {
  it('applies the holdings plan in ONE batch', async () => {
    stubFetch(() => csvResponse(csv(20)));
    const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'enforce' });
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.equal(result.state, 'applied');
    // ⚠️ TWO batches since 2026-09-05, and deliberately so: the holdings and
    // the series volumes are one TICK but not one fate, so a `series_volume`
    // failure cannot roll back holdings that landed correctly.
    assert.equal(state.batches, 2);
    assert.ok((result.written?.statements ?? 0) > 0);
  });
});

describe('the OTHER half of the tick — series_volume / series_check', () => {
  it('shadow plans it and writes NOTHING', async () => {
    stubFetch(() => csvResponse(csv(20)));
    const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'shadow' });
    const result = await runAudiobookSweep(env, { trigger: 'cron' });

    assert.equal(result.state, 'shadow');
    assert.equal(wroteSeriesVolumes(state), false);
    assert.ok(result.seriesVolumes?.planned, 'the plan must be recorded, or shadow is a no-op');
    assert.equal(result.seriesVolumes?.written, null);
    // One series in the fake catalog, 20 numbered rows under it.
    assert.equal(result.seriesVolumes?.planned?.seriesCount, 1);
    assert.equal(result.seriesVolumes?.planned?.found, 1);
    assert.equal(result.seriesVolumes?.planned?.volumeUpserts, 20);
    assert.equal(result.seriesVolumes?.planned?.checkUpserts, 1);
    assert.equal(result.seriesVolumes?.planned?.statements, 21);
  });

  it('the counts land in the run row under `seriesVolumes`', async () => {
    // That sub-object IS the shadow evidence — `/api/health` reads it back, and
    // a plan computed and not recorded proves nothing about the flip gate.
    stubFetch(() => csvResponse(csv(20)));
    const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'shadow' });
    await runAudiobookSweep(env, { trigger: 'cron' });
    const recorded = state.runRows[0]!.detail as {
      seriesVolumes: { planned: { volumeUpserts: number } | null };
    };
    assert.equal(recorded.seriesVolumes.planned?.volumeUpserts, 20);
  });

  it('⚠️ the recorded counts carry NO series name and no volume title', async () => {
    // `detail_json` is read back by an unauthenticated route.
    stubFetch(() => csvResponse(csv(20)));
    const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'shadow' });
    await runAudiobookSweep(env, { trigger: 'cron' });
    const json = JSON.stringify(
      (state.runRows[0]!.detail as { seriesVolumes: unknown }).seriesVolumes,
    );
    assert.ok(!/Primal Hunter/.test(json), 'a series name reached the run row');
  });

  it('enforce writes it, in its own batch', async () => {
    stubFetch(() => csvResponse(csv(20)));
    const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'enforce' });
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.equal(result.state, 'applied');
    assert.equal(wroteSeriesVolumes(state), true);
    assert.equal(result.seriesVolumes?.written, 21);
  });

  it('a dryRun in ENFORCE mode writes neither half', async () => {
    stubFetch(() => csvResponse(csv(20)));
    const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'enforce' });
    const result = await runAudiobookSweep(env, { trigger: 'admin', dryRun: true });
    assert.equal(wroteSeriesVolumes(state), false);
    assert.equal(result.seriesVolumes?.written, null);
    assert.ok(result.seriesVolumes?.planned);
  });

  it('🔴 guard 3 — a SCOPED run plans none of it', async () => {
    // A `series_check` row is a per-series claim that a source was consulted,
    // and a run that looked at one book has consulted nothing about the rest of
    // the catalogue. The cron owns this half.
    stubFetch(() => csvResponse(csv(20)));
    const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'enforce' });
    const result = await runAudiobookSweep(env, {
      trigger: 'on-add',
      scope: { kind: 'works', ids: [1] },
    });
    assert.equal(result.seriesVolumes?.planned, null);
    assert.match(result.seriesVolumes?.detail ?? '', /scoped run/);
    assert.equal(wroteSeriesVolumes(state), false);
  });

  it('guards 1, 2 and 4 cover it too — a refused tick plans nothing', async () => {
    // Inherited rather than re-implemented: this half is planned downstream of
    // all three, so each refusal returns before it is ever reached.
    const refusals: Array<[string, () => Response, Partial<FakeState>]> = [
      ['empty snapshot', () => csvResponse(HEADER), {}],
      ['drift', () => csvResponse(csv(900)), { snapshot: { etag: '"old"', rowCount: 1000 } }],
      ['empty-read', () => csvResponse(csv(50)), { works: [] }],
    ];
    for (const [what, answer, over] of refusals) {
      stubFetch(answer);
      const { env, state } = fakeEnv(over, { AUDIOBOOK_SWEEP_MODE: 'enforce' });
      const result = await runAudiobookSweep(env, { trigger: 'cron' });
      assert.equal(result.state, 'failed', what);
      assert.equal(result.seriesVolumes, null, `${what} planned a series-volume write`);
      assert.equal(wroteSeriesVolumes(state), false, what);
    }
  });

  it('mode off never reaches it at all', async () => {
    stubFetch(() => csvResponse(csv(20)));
    const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'off' });
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.equal(result.seriesVolumes, null);
    assert.equal(wroteSeriesVolumes(state), false);
  });

  it('🔴 no second mode variable — one switch decides both halves', async () => {
    // A second var would let an instance shadow one half and enforce the other,
    // which is a state nobody could read off /api/health and nothing needs.
    for (const mode of ['shadow', 'enforce'] as const) {
      stubFetch(() => csvResponse(csv(20)));
      const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: mode });
      await runAudiobookSweep(env, { trigger: 'cron' });
      assert.equal(
        wroteSeriesVolumes(state),
        mode === 'enforce',
        `${mode} must treat both halves alike`,
      );
      assert.equal(wroteHoldings(state), mode === 'enforce');
    }
  });
});

describe('the on-add hook — §4.2 and the §4.4 bulk guard', () => {
  /** Just enough of a Hono context to register a promise. */
  function ctxOver(env: Env) {
    const registered: Promise<unknown>[] = [];
    return {
      c: { env, executionCtx: { waitUntil: (p: Promise<unknown>) => void registered.push(p) } },
      registered,
    };
  }

  it("🔴 `'defer'` registers NOTHING — no fetch, no run row, no index build", async () => {
    // §4.4: one hook per row against a thousand-book import is a thousand index
    // builds and a thousand 1.4 MB fetches, for an audiobook row set that is
    // identical for every work in the run.
    let fetched = false;
    stubFetch(() => {
      fetched = true;
      return csvResponse(csv(20));
    });
    const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'enforce' });
    const { c, registered } = ctxOver(env);
    associateWorkAfterAdd(c, 42, 'defer');
    assert.equal(registered.length, 0);
    assert.equal(fetched, false);
    assert.equal(state.runRows.length, 0);
  });

  it("`'per-work'` registers exactly one background task", async () => {
    stubFetch(() => csvResponse(csv(20)));
    const { env } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'shadow' });
    const { c, registered } = ctxOver(env);
    associateWorkAfterAdd(c, 1, 'per-work');
    assert.equal(registered.length, 1);
    await Promise.all(registered);
  });

  it('the run it starts is trigger `on-add` and STALES NOTHING', async () => {
    // §6.2 guard 3 as it reaches this layer: a run that looked at one book has
    // no standing to say another book's row is gone. The type-level half is
    // pinned in `packages/core/test/audiobook-sweep-scope.test.ts`; this is the
    // half that proves the hook actually passes the scoped shape.
    stubFetch(() => csvResponse(csv(20)));
    const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'shadow' });
    const { c, registered } = ctxOver(env);
    associateWorkAfterAdd(c, 1, 'per-work');
    await Promise.all(registered);

    assert.equal(state.runRows.length, 1);
    const recorded = state.runRows[0]!.detail as {
      trigger: string;
      scope: string;
      plan: { editionStales: number; rungStales: number };
    };
    assert.equal(recorded.trigger, 'on-add');
    assert.equal(recorded.scope, 'works');
    assert.equal(recorded.plan.editionStales, 0);
    assert.equal(recorded.plan.rungStales, 0);
  });

  it('⚠️ in SHADOW it records what it would do, and writes nothing', async () => {
    stubFetch(() => csvResponse(csv(20)));
    const { env, state } = fakeEnv({}, { AUDIOBOOK_SWEEP_MODE: 'shadow' });
    const { c, registered } = ctxOver(env);
    associateWorkAfterAdd(c, 1, 'per-work');
    await Promise.all(registered);
    assert.equal(state.runRows[0]!.state, 'shadow');
    assert.equal(wroteHoldings(state), false);
  });

  it('a missing execution context is a skipped hook, never a thrown add', async () => {
    // An add that failed because an audiobook lookup failed would be a strictly
    // worse app. The hook is allowed to do nothing; it is never allowed to
    // throw into somebody's book-add.
    const { env } = fakeEnv();
    const c = {
      env,
      get executionCtx(): { waitUntil(p: Promise<unknown>): void } {
        throw new Error('no execution context');
      },
    };
    assert.doesNotThrow(() => associateWorkAfterAdd(c, 1, 'per-work'));
  });
});

describe('the cron string', () => {
  it('is minute 23 and four-hourly — neither :00 nor the details sweep’s :07', () => {
    assert.equal(AUDIOBOOK_SWEEP_CRON, '23 */4 * * *');
  });
});

// ---------------------------------------------------------------------------
// 🔴 Shadow fetches unconditionally — 2026-09-06
// ---------------------------------------------------------------------------
//
// Shadow mode's entire purpose is evidence, and for a day it produced none: the
// `304` return is upstream of the parse, the D1 read and BOTH planners, so a
// quiet input meant a quiet record. Measured on both instances: 3 run rows, 1
// with a plan, 0 with `seriesVolumes`.
//
// ⚠️ Every test here is about what is FETCHED. Not one of them relaxes what may
// be WRITTEN — the shadow assertions above still own that, and the `enforce`
// cases below prove the cheap path was left alone.

/** Answer 304 to a conditional GET and 200 to an unconditional one, like an origin would. */
function conditionalOrigin(body: string, etag = '"abc"') {
  const seen: (Record<string, string> | undefined)[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    seen.push(headers);
    if (headers && headers['If-None-Match'] === etag) return new Response(null, { status: 304 });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/csv', etag },
    });
  }) as typeof fetch;
  return seen;
}

describe('🔴 a quiet CSV must not silence SHADOW', () => {
  it('a full-scope shadow tick sends no If-None-Match and computes BOTH halves', async () => {
    // The bug, stated as its fix: the same snapshot etag that produced
    // `skipped`/`unchanged` for a day now produces a plan.
    const seen = conditionalOrigin(csv(20));
    const { env, state } = fakeEnv(
      { snapshot: { etag: '"abc"', rowCount: 20 } },
      { AUDIOBOOK_SWEEP_MODE: 'shadow' },
    );
    const result = await runAudiobookSweep(env, { trigger: 'cron' });

    assert.deepEqual(seen[0], {}, 'shadow must not send the stored etag');
    assert.equal(result.state, 'shadow');
    assert.ok(result.plan, 'the holdings half must have planned');
    assert.ok(result.seriesVolumes?.planned, 'and so must the series-volume half');
    // Still writes nothing. The change is to the fetch, never to the mode.
    assert.equal(wroteHoldings(state), false);
    assert.equal(wroteSeriesVolumes(state), false);
  });

  it('an unchanged body is marked `unchanged-replayed` — evidence, but not NEWS', async () => {
    conditionalOrigin(csv(20));
    const { env, state } = fakeEnv(
      { snapshot: { etag: '"abc"', rowCount: 20 } },
      { AUDIOBOOK_SWEEP_MODE: 'shadow' },
    );
    const result = await runAudiobookSweep(env, { trigger: 'cron' });

    assert.match(result.detail ?? '', /unchanged-replayed/);
    assert.ok(result.plan, 'a replay still computes the whole plan');
    // The marker reaches the run row, which is where a reader counting toward
    // the gate actually looks.
    const recorded = state.runRows[0]!.detail as { detail: string };
    assert.match(recorded.detail, /unchanged-replayed/);
  });

  it('⚠️ a replay does NOT re-stamp the snapshot — `snapshotAgeHours` must stay honest', async () => {
    // Re-stamping `fetched_at` every four hours with a body we already had would
    // peg the age near zero forever and destroy the one signal that says the
    // sibling pipeline has stopped publishing.
    conditionalOrigin(csv(20));
    const { env, state } = fakeEnv(
      { snapshot: { etag: '"abc"', rowCount: 20 } },
      { AUDIOBOOK_SWEEP_MODE: 'shadow' },
    );
    await runAudiobookSweep(env, { trigger: 'cron' });
    assert.equal(state.snapshotWrites, 0);
  });

  it('a CHANGED body under shadow is an ordinary tick — no marker, snapshot rewritten', async () => {
    // The lie in the other direction: a forced fetch that brought back something
    // new must not be filed as a replay.
    conditionalOrigin(csv(25), '"new"');
    const { env, state } = fakeEnv(
      { snapshot: { etag: '"abc"', rowCount: 20 } },
      { AUDIOBOOK_SWEEP_MODE: 'shadow' },
    );
    const result = await runAudiobookSweep(env, { trigger: 'cron' });

    assert.equal(result.detail, 'shadow — nothing written');
    assert.equal(state.snapshotWrites, 1);
    assert.deepEqual(state.snapshot, { etag: '"new"', rowCount: 25 });
  });

  it('the FIRST ever shadow tick has no stored etag and is not a replay', async () => {
    conditionalOrigin(csv(20));
    const { env, state } = fakeEnv({ snapshot: null }, { AUDIOBOOK_SWEEP_MODE: 'shadow' });
    const result = await runAudiobookSweep(env, { trigger: 'cron' });
    assert.equal(result.detail, 'shadow — nothing written');
    assert.equal(state.snapshotWrites, 1);
  });

  it('🔴 ENFORCE keeps the conditional GET and keeps the 304 short-circuit', async () => {
    // The cheap path is left exactly as it was: nothing changed means nothing to
    // write, and re-planning to discover that costs 1.4 MB to reach a batch of
    // zero statements.
    const seen = conditionalOrigin(csv(20));
    const { env, state } = fakeEnv(
      { snapshot: { etag: '"abc"', rowCount: 20 } },
      { AUDIOBOOK_SWEEP_MODE: 'enforce' },
    );
    const result = await runAudiobookSweep(env, { trigger: 'cron' });

    assert.deepEqual(seen[0], { 'If-None-Match': '"abc"' });
    assert.equal(result.state, 'skipped');
    assert.equal(result.detail, 'unchanged');
    assert.equal(result.plan, null);
    assert.equal(wroteHoldings(state), false);
    assert.equal(state.snapshotWrites, 0);
  });

  it('⚠️ a SCOPED on-add run keeps the conditional GET even in shadow', async () => {
    // It plans no series volumes at all (guard 3), so it generates no gate
    // evidence — making every book somebody adds pull 1.4 MB would buy nothing.
    const seen = conditionalOrigin(csv(20));
    const { env } = fakeEnv(
      { snapshot: { etag: '"abc"', rowCount: 20 } },
      { AUDIOBOOK_SWEEP_MODE: 'shadow' },
    );
    const result = await runAudiobookSweep(env, {
      trigger: 'on-add',
      scope: { kind: 'works', ids: [1] },
    });

    assert.deepEqual(seen[0], { 'If-None-Match': '"abc"' });
    assert.equal(result.state, 'skipped');
    assert.equal(result.detail, 'unchanged');
  });
});

describe('🔴 `force` — the flag that lets a dry run answer the gate', () => {
  it('skips If-None-Match in ENFORCE mode, so `dryRun` always returns a plan', async () => {
    // The failure it fixes: `POST {"dryRun":true}` came back `skipped` /
    // `unchanged` / `plan: null`, and §7.1 calls that route the instrument.
    const seen = conditionalOrigin(csv(20));
    const { env, state } = fakeEnv(
      { snapshot: { etag: '"abc"', rowCount: 20 } },
      { AUDIOBOOK_SWEEP_MODE: 'enforce' },
    );
    const result = await runAudiobookSweep(env, { trigger: 'admin', dryRun: true, force: true });

    assert.deepEqual(seen[0], {});
    assert.equal(result.state, 'shadow');
    assert.ok(result.plan);
    assert.ok(result.seriesVolumes?.planned);
    assert.match(result.detail ?? '', /dry run/);
    assert.match(result.detail ?? '', /unchanged-replayed/);
    assert.equal(wroteHoldings(state), false, 'dryRun still writes nothing');
  });

  it('⚠️ force alone does NOT make a run a rehearsal — the mode still decides', async () => {
    // They are independent flags. `force` changes what is fetched; `dryRun` and
    // the mode ladder decide what is written, and mislabelling either direction
    // is how a rehearsal turns out to have written.
    conditionalOrigin(csv(20));
    const { env, state } = fakeEnv(
      { snapshot: { etag: '"abc"', rowCount: 20 } },
      { AUDIOBOOK_SWEEP_MODE: 'enforce' },
    );
    const result = await runAudiobookSweep(env, { trigger: 'admin', force: true });
    assert.equal(result.state, 'applied');
    assert.equal(wroteHoldings(state), true);
  });

  it('without force, an enforce-mode dry run still 304s — the state before the fix', async () => {
    conditionalOrigin(csv(20));
    const { env } = fakeEnv(
      { snapshot: { etag: '"abc"', rowCount: 20 } },
      { AUDIOBOOK_SWEEP_MODE: 'enforce' },
    );
    const result = await runAudiobookSweep(env, { trigger: 'admin', dryRun: true });
    assert.equal(result.state, 'skipped');
    assert.equal(result.plan, null);
  });
});
