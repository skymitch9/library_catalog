/**
 * The hourly missing-details sweep.
 *
 * These tests exist for the failure modes a scheduled job has that a request
 * does not: nobody is watching, there is no response to go wrong, and (measured
 * in the sibling project 2026-08-13) a scheduled Worker's logs defeated three
 * separate `wrangler tail` attempts. So the properties pinned here are the ones
 * whose failure would be silent — it converges, it stays inside the subrequest
 * budget, it never throws, and the cron string it dispatches on still exists.
 *
 * ⚠️ Unlike the sibling project's version of this file, **nothing here is a
 * copy of the logic under test.** The decision — which books to ask, in what
 * order, how many — is `planSweep`, which is pure, so it is exercised directly.
 * The parts that need D1 are reached through the real `runDetailsSweep` with an
 * environment that cannot answer, which is itself one of the cases worth
 * pinning.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Env } from '../env.js';
import type { DonorDetailsReply } from '../routes/donor.js';
import {
  DETAILS_SWEEP_CRON,
  SWEEP_BUDGET,
  SWEEP_LIMIT,
  donorFindings,
  estimateSubrequests,
  planSweep,
  runDetailsSweep,
  sweepMode,
  unaskedGaps,
  type SweepCandidate,
} from './details-sweep.js';

function candidate(overrides: Partial<SweepCandidate> = {}): SweepCandidate {
  return {
    workId: 1,
    title: 'Unsouled',
    authors: 'Will Wight',
    missing: ['firstPublished', 'description'],
    asked: [],
    lastAttemptAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Convergence — the money loop this feature would otherwise be
// ---------------------------------------------------------------------------

test('a book whose every open gap has already been asked is not asked again', () => {
  // ⚠️ THE test. This catalog's queue does not converge on its own: a run that
  // answers `identified: false` writes no verdict, so the gap survives — and
  // per isbn-ladder.md §4.2 that is the EXPECTED outcome for roughly half this
  // library. Without this rule the sweep re-buys the same nothing every hour,
  // for ever.
  const plan = planSweep([
    candidate({ workId: 1, missing: ['firstPublished', 'description'], asked: ['firstPublished', 'description'], lastAttemptAt: '2026-08-16 07:00:00' }),
  ]);
  assert.deepEqual(plan.pick, []);
  assert.equal(plan.deferred, 0, 'not deferred — settled, and off the list entirely');
});

test('a gap that has never been asked about makes the book eligible again', () => {
  // The other half of the same rule. A person types in a series name, so
  // "which volume is this?" becomes askable for the first time — a new
  // question, not a re-run of an old one.
  const plan = planSweep([
    candidate({
      workId: 4,
      missing: ['seriesIndex', 'description'],
      asked: ['firstPublished', 'series', 'description'],
      lastAttemptAt: '2026-08-16 07:00:00',
    }),
  ]);
  assert.equal(plan.pick.length, 1);
});

test('unaskedGaps counts a field as asked whether or not it was answered', () => {
  // The distinction the whole mechanism rests on. `description` was asked and
  // came back with nothing; that is what stops it repeating.
  assert.deepEqual(unaskedGaps(['firstPublished', 'description'], ['description']), [
    'firstPublished',
  ]);
  assert.deepEqual(unaskedGaps(['description'], ['description']), []);
  assert.deepEqual(unaskedGaps(['description'], []), ['description']);
});

test('the volume-number gap research can never close is asked once, not hourly', () => {
  // Measured 2026-08-13: 22 works had `series_index_sort` set and
  // `series_index_display` blank — they sort correctly and print nothing, so
  // `seriesIndexIncomplete` stays true for ever. Research fills `sort` only
  // (`display` quotes the cover), so this gap CANNOT be closed by a lookup.
  // Asked once is a reasonable price; asked every hour is a subscription.
  const stillOpen = candidate({
    workId: 9,
    missing: ['seriesIndex'],
    asked: ['seriesIndex'],
    lastAttemptAt: '2026-08-16 07:00:00',
  });
  assert.deepEqual(planSweep([stillOpen]).pick, []);
});

// ---------------------------------------------------------------------------
// Rotation — nothing may starve
// ---------------------------------------------------------------------------

test('never-attempted books go first, then the longest-waiting', () => {
  // Both ceilings lifted, because this pins the ORDER and nothing else. (The
  // real budget would take two of these three, which is what the tests below
  // are for.)
  const plan = planSweep(
    [
      candidate({ workId: 1, lastAttemptAt: '2026-08-16 06:00:00', asked: ['series'] }),
      candidate({ workId: 2, lastAttemptAt: null }),
      candidate({ workId: 3, lastAttemptAt: '2026-08-15 06:00:00', asked: ['series'] }),
    ],
    3,
    1000,
  );
  assert.deepEqual(
    plan.pick.map((c) => c.workId),
    [2, 3, 1],
  );
});

test('a book that fails every time costs one slot, not every slot', () => {
  // The queue is sorted by title, so taking its head each hour would hand the
  // same book to the same failure for ever and never reach the rest. An
  // errored run is not recorded as asked — deliberately, it never got an
  // answer — so `lastAttemptAt` is the only thing that moves it aside.
  const failing = candidate({ workId: 1, lastAttemptAt: '2026-08-16 07:00:00' });
  const waiting = candidate({ workId: 2, lastAttemptAt: null });
  const plan = planSweep([failing, waiting], 1);
  assert.deepEqual(
    plan.pick.map((c) => c.workId),
    [2],
  );
  assert.equal(plan.deferred, 1);
});

// ---------------------------------------------------------------------------
// The two ceilings: money and subrequests
// ---------------------------------------------------------------------------

test('the cap is the per-hour cost ceiling, and it is small', () => {
  // Guards the money, not the code. Each run costs ~2 cents
  // (RESEARCH_CENTS_EACH.low), so this is ~4 cents an hour at the very worst
  // and only while a backlog exists. If somebody raises it, they should have to
  // change a test that says why it was low.
  assert.ok(SWEEP_LIMIT <= 4, `SWEEP_LIMIT is ${SWEEP_LIMIT}; each book costs real money`);
});

test('the estimated tick stays inside a Worker invocation, worst case', () => {
  // ⚠️ Exceeding 50 subrequests TERMINATES the invocation rather than throwing,
  // and in scheduled() that is completely silent. Two queue reads plus the
  // budget must leave slack, because the per-book figure is an estimate.
  assert.ok(SWEEP_BUDGET + 2 <= 50, `${SWEEP_BUDGET} + 2 queue reads exceeds the 50 ceiling`);
});

test('a book with every field missing takes the tick to itself', () => {
  // 12 + 4x4 = 28 each; two of them is 56, past the budget and past the
  // ceiling. It is picked alone rather than fitted in beside another.
  const greedy = (id: number) =>
    candidate({ workId: id, missing: ['firstPublished', 'series', 'seriesIndex', 'description'] });
  const plan = planSweep([greedy(1), greedy(2)]);
  assert.equal(plan.pick.length, 1);
  assert.equal(plan.deferred, 1);
  assert.ok(plan.estimated <= SWEEP_BUDGET);
});

test('two ordinary books fit in one tick', () => {
  // The common shape by a distance: every work in this catalog was missing its
  // year and its description when the queue was measured (2026-08-10).
  const plan = planSweep([candidate({ workId: 1 }), candidate({ workId: 2 })]);
  assert.equal(plan.pick.length, 2);
  assert.ok(plan.estimated <= SWEEP_BUDGET, `${plan.estimated} over budget`);
});

test('the item cap binds even when the budget would allow more', () => {
  const cheap = (id: number) => candidate({ workId: id, missing: ['description'] });
  const plan = planSweep([cheap(1), cheap(2), cheap(3), cheap(4)]);
  assert.equal(plan.pick.length, SWEEP_LIMIT);
});

test('the per-book estimate is per field, because auto-apply is per field', () => {
  assert.equal(estimateSubrequests(0), 12);
  assert.equal(estimateSubrequests(4), 28);
});

// ---------------------------------------------------------------------------
// The donor path (owner ask 2026-08-16: check other libraries before the AI)
// ---------------------------------------------------------------------------

test('sweepMode: the donor needs BOTH its vars; either alone is not a donor', () => {
  // Half a configuration silently doing nothing is this codebase's named
  // enemy — a URL with no token would fetch and be refused every tick.
  assert.deepEqual(sweepMode({}), { ai: false, donor: false });
  assert.deepEqual(sweepMode({ DONOR_URL: 'https://library.heygabi.ai' }), { ai: false, donor: false });
  assert.deepEqual(sweepMode({ DONOR_TOKEN: 't' }), { ai: false, donor: false });
  assert.deepEqual(
    sweepMode({ DONOR_URL: 'https://library.heygabi.ai', DONOR_TOKEN: 't' }),
    { ai: false, donor: true },
  );
  assert.deepEqual(sweepMode({ ANTHROPIC_API_KEY: 'k' }), { ai: true, donor: false });
});

test('the estimate is mode-aware — a donor-blind estimate silently kills the invocation', () => {
  // Header table: AI 12, donor 5, apply 4 per field, applied once whichever
  // path answered.
  assert.equal(estimateSubrequests(2, { ai: false, donor: true }), 13);
  assert.equal(estimateSubrequests(2, { ai: true, donor: true }), 25);
  assert.equal(estimateSubrequests(4, { ai: true, donor: true }), 33);
});

test('with both paths live, two ordinary books no longer fit one tick — one is picked, honestly', () => {
  // 2 × 25 = 50 is the whole ceiling. Fitting both in on the AI-only estimate
  // (2 × 20 = 40) is exactly the silent-termination bug the budget exists for.
  const plan = planSweep(
    [candidate({ workId: 1 }), candidate({ workId: 2 })],
    SWEEP_LIMIT,
    SWEEP_BUDGET,
    { ai: true, donor: true },
  );
  assert.equal(plan.pick.length, 1);
  assert.equal(plan.deferred, 1);
  assert.ok(plan.estimated <= SWEEP_BUDGET);
});

test('donorFindings proposes only what was unasked, only what is usable, as donor-sourced', () => {
  const reply: DonorDetailsReply = {
    matched: true,
    workId: 7,
    title: 'The Way of Kings',
    details: {
      firstPublished: 2010,
      series: 'The Stormlight Archive',
      seriesIndex: 1,
      description: 'A description the donor holds.',
    },
  };
  // `description` was already asked here — the donor volunteering it must not
  // re-open a settled question.
  const findings = donorFindings(['firstPublished', 'series', 'seriesIndex'], reply, 'https://library.heygabi.ai');
  assert.deepEqual(
    findings.map((f) => f.field),
    ['firstPublished', 'series', 'seriesIndex'],
    'DETAIL_FIELDS order, series before seriesIndex — the apply path depends on it',
  );
  for (const f of findings) {
    assert.equal(f.sourceTier, 'donor', 'a copied value must never wear a web tier');
    assert.equal(f.value.kind, 'found');
    assert.equal(f.sourceUrl, 'https://library.heygabi.ai/work/7');
  }
  assert.equal(findings[0]?.value.value, 2010);
});

test('donorFindings drops blanks and non-scalars instead of proposing overwrites', () => {
  const reply = {
    matched: true,
    workId: 7,
    title: 'X',
    details: { firstPublished: null, series: '   ', description: { nested: 'garbage' } },
  } as unknown as DonorDetailsReply;
  assert.deepEqual(donorFindings(['firstPublished', 'series', 'description'], reply, 'https://d'), []);
});

test('an unmatched donor reply proposes nothing at all', () => {
  assert.deepEqual(
    donorFindings(['firstPublished'], { matched: false, details: {} }, 'https://d'),
    [],
  );
});

test('donor-only mode: no AI key no longer skips the tick', async () => {
  // ⚠️ THE key behaviour of the donor build: her instance has no
  // ANTHROPIC_API_KEY and its sweep used to skip every tick. With a donor
  // configured it must get PAST the key gate — proven here by it reaching the
  // queue read and reporting that failure, with the honest mode note first.
  const env = {
    DONOR_URL: 'https://library.heygabi.ai',
    DONOR_TOKEN: 'set',
    DB: {
      prepare() {
        throw new Error('D1 is gone');
      },
    },
  } as unknown as Env;

  const result = await runDetailsSweep(env);
  assert.deepEqual(result.skipped, [
    'no ANTHROPIC_API_KEY — donor-only mode',
    'queue read failed: D1 is gone',
  ]);
  assert.equal(result.attempted, 0);
});

test('an empty queue plans nothing at all', () => {
  assert.deepEqual(planSweep([]), { pick: [], deferred: 0, estimated: 0 });
});

// ---------------------------------------------------------------------------
// It never throws — the one guarantee scheduled() depends on
// ---------------------------------------------------------------------------

test('no API key: it says so once and spends nothing', async () => {
  const result = await runDetailsSweep({} as Env);
  assert.deepEqual(result.skipped, ['no ANTHROPIC_API_KEY']);
  assert.equal(result.attempted, 0);
});

test('a database that cannot be read is reported, not thrown', async () => {
  // Resolving rather than rejecting is the whole contract with scheduled():
  // there is no response for an exception to reach and no user to see it.
  const env = {
    ANTHROPIC_API_KEY: 'test',
    DB: {
      prepare() {
        throw new Error('D1 is gone');
      },
    },
  } as unknown as Env;

  const result = await runDetailsSweep(env);
  assert.equal(result.attempted, 0);
  assert.equal(result.errored, 0, 'a failed READ is not a failed run — no money was spent');
  assert.match(result.skipped[0] ?? '', /queue read failed: D1 is gone/);
});

// ---------------------------------------------------------------------------
// The two files that have to agree
// ---------------------------------------------------------------------------

test('the cron string the handler dispatches on matches wrangler.toml', async () => {
  // These are two separate files and the match is by string. A rename in one
  // stops the sweep firing and reports nothing at all — and this Worker's
  // scheduled() deliberately does NOTHING for an unrecognised cron rather than
  // guessing, so the silence would be total.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  // fileURLToPath, not a URL object: the Workers TS lib's URL is not node:url's
  // URL, and readFileSync(URL) fails to typecheck across the two.
  const toml = readFileSync(fileURLToPath(new URL('../../wrangler.toml', import.meta.url).href), 'utf8');
  assert.ok(
    toml.includes(`"${DETAILS_SWEEP_CRON}"`),
    `wrangler.toml has no cron entry "${DETAILS_SWEEP_CRON}" — the sweep would never fire`,
  );
});
