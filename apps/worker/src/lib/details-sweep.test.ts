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
import type { DonorCandidate } from '../routes/donor.js';
import {
  DETAILS_SWEEP_CRON,
  DONOR_FUZZY_RUN_MODEL,
  SWEEP_BUDGET,
  SWEEP_LIMIT,
  donorAskUrl,
  donorFindings,
  estimateSubrequests,
  judgedOutcome,
  planSweep,
  runDetailsSweep,
  sweepMode,
  unaskedGaps,
  type SweepCandidate,
} from './details-sweep.js';
import { heldForPerson } from './research-run.js';

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
  // Header table: AI 12; donor 5 alone, 6 where a judge is possible (the judge
  // is a second fetch, and an exact MISS is the ordinary case); apply 4 per
  // field, spent once by whichever rung answered.
  assert.equal(estimateSubrequests(2, { ai: false, donor: true }), 13);
  assert.equal(estimateSubrequests(2, { ai: true, donor: true }), 26);
  assert.equal(estimateSubrequests(4, { ai: true, donor: true }), 34);
});

test('the judged rung is COUNTED, not assumed free — the estimate rose by exactly one fetch', () => {
  // ⚠️ The arithmetic is load-bearing: exceeding 50 subrequests terminates the
  // invocation silently. A rung added without moving this number is a rung
  // that eventually kills a tick mid-book.
  const withJudge = estimateSubrequests(2, { ai: true, donor: true });
  const donorOnly = estimateSubrequests(2, { ai: false, donor: true });
  const aiOnly = estimateSubrequests(2, { ai: true, donor: false });
  assert.equal(withJudge - (donorOnly + aiOnly - 4 * 2), 1, 'exactly one extra fetch, the judge call');
});

test('with both paths live, two ordinary books no longer fit one tick — one is picked, honestly', () => {
  // 2 × 26 = 52 is past the whole ceiling. Fitting both in on the AI-only
  // estimate (2 × 20 = 40) is exactly the silent-termination bug the budget
  // exists for.
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

// ---------------------------------------------------------------------------
// Rung 2: the judged donor match (owner ask 2026-08-16, "fuzzy match before
// going to web"). Everything that decides what gets WRITTEN is pure, so it is
// pinned here without a model, a donor or a database.
// ---------------------------------------------------------------------------

function donorCandidate(overrides: Partial<DonorCandidate> = {}): DonorCandidate {
  return {
    workId: 42,
    title: 'Unsouled',
    authors: 'Will Wight',
    fold: 'unsouled',
    titleScore: 0.5,
    authorAgrees: true,
    details: { firstPublished: 2016, series: 'Cradle', seriesIndex: 1 },
    ...overrides,
  };
}

test('⚠️ a donor-only instance never asks for a shortlist it could not judge', () => {
  // THE no-key guarantee, and it is a property of the REQUEST, not of a branch
  // further in: her sweep has no ANTHROPIC_API_KEY, so the URL it sends must be
  // the one it sent before this rung existed.
  const withoutAi = donorAskUrl('https://library.heygabi.ai', 'Unsouled', 'Will Wight', false);
  assert.ok(!withoutAi.includes('candidates'), 'a shortlist costs the donor reads nobody here can use');
  assert.equal(
    withoutAi,
    'https://library.heygabi.ai/api/donor/details?title=Unsouled&author=Will+Wight',
  );
  const withAi = donorAskUrl('https://library.heygabi.ai', 'Unsouled', 'Will Wight', true);
  assert.ok(withAi.includes('candidates=1'));
});

test('a confident verdict applies, wearing the judged tier rather than the exact one', () => {
  const outcome = judgedOutcome(
    { verdict: 'same', workId: 42, confidence: 'high', why: 'Same author; the title adds the series.' },
    [donorCandidate()],
    ['firstPublished', 'series', 'seriesIndex'],
    'https://library.heygabi.ai',
  );
  assert.equal(outcome.kind, 'apply');
  if (outcome.kind !== 'apply') return;
  assert.deepEqual(
    outcome.findings.map((f) => f.field),
    ['firstPublished', 'series', 'seriesIndex'],
    'DETAIL_FIELDS order — series before seriesIndex, which the apply path depends on',
  );
  for (const f of outcome.findings) {
    assert.equal(
      f.sourceTier,
      'donor_fuzzy',
      '⚠️ a MATCHED-by-model copy must never wear the exact rung’s tier — migration 0321',
    );
    assert.equal(f.sourceUrl, 'https://library.heygabi.ai/work/42');
    assert.match(String(f.value.basis), /high confidence/);
  }
});

test('⚠️ an unsure verdict proposes, and is structurally incapable of applying itself', () => {
  const outcome = judgedOutcome(
    { verdict: 'unsure', workId: 42, confidence: 'medium', why: 'Could be the omnibus.' },
    [donorCandidate()],
    ['firstPublished'],
    'https://d',
  );
  assert.equal(outcome.kind, 'pending', 'not confident is not a licence to write');
  if (outcome.kind !== 'pending') return;
  const [f] = outcome.findings;
  assert.equal(f?.sourceTier, 'donor_fuzzy');
  assert.match(String(f?.value.basis), /NOT confident/);
  // The guarantee that outlives this tick: `autoApplyFindings` is default-deny
  // on the judged tier, so the ordinary research run an hour from now cannot
  // sweep this proposal up on its way past.
  assert.equal(heldForPerson('donor_fuzzy', 7, undefined), true, 'no opt-in: held');
  assert.equal(heldForPerson('donor_fuzzy', 7, {}), true, 'an options object is not an opt-in');
  assert.equal(
    heldForPerson('donor_fuzzy', 7, { applyJudgedDonorFromRun: 8 }),
    true,
    '⚠️ another run’s confident verdict authorises nothing about THIS proposal',
  );
  assert.equal(heldForPerson('donor_fuzzy', 7, { applyJudgedDonorFromRun: 7 }), false);
  assert.equal(heldForPerson('donor', 7, undefined), false, 'an exact copy is unaffected');
  assert.equal(heldForPerson('community', 7, undefined), false, 'a web claim is unaffected');
});

test('a same-work verdict at medium confidence is a proposal, not an answer', () => {
  const outcome = judgedOutcome(
    { verdict: 'same', workId: 42, confidence: 'medium', why: 'Probably.' },
    [donorCandidate()],
    ['firstPublished'],
    'https://d',
  );
  assert.equal(outcome.kind, 'pending', 'only same + high writes unattended');
});

test('"different" writes nothing at all and costs no bookkeeping', () => {
  const outcome = judgedOutcome(
    { verdict: 'different', workId: null, confidence: 'high', why: 'Different author entirely.' },
    [donorCandidate()],
    ['firstPublished'],
    'https://d',
  );
  assert.equal(outcome.kind, 'none');
});

test('⚠️ a work id the donor never offered is ignored, however confident the model sounds', () => {
  // A model that invents an id would otherwise have values copied from a row
  // nobody shortlisted — the §4.4 failure with no shortlist to blame.
  const outcome = judgedOutcome(
    { verdict: 'same', workId: 999, confidence: 'high', why: 'Certain.' },
    [donorCandidate({ workId: 42 })],
    ['firstPublished'],
    'https://d',
  );
  assert.equal(outcome.kind, 'none');
  if (outcome.kind !== 'none') return;
  assert.match(outcome.why, /not on the shortlist/);
});

test('a confident match with nothing this book still needs writes no run', () => {
  const outcome = judgedOutcome(
    { verdict: 'same', workId: 42, confidence: 'high', why: 'Same book.' },
    [donorCandidate({ details: { description: 'A description.' } })],
    ['firstPublished'], // the donor holds a description; this book never asked for one
    'https://d',
  );
  assert.equal(outcome.kind, 'none');
});

test('the judged run names both halves of its provenance', () => {
  // "donor" alone would lose which model admitted the match; a model name alone
  // would lose that the VALUES came from the donor, not from the web.
  assert.match(DONOR_FUZZY_RUN_MODEL, /^donor\+/);
  assert.match(DONOR_FUZZY_RUN_MODEL, /haiku/, 'the cheap judge is the point of the rung');
});
