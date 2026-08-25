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
  FREE_LADDER_SUBREQUESTS,
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
import { FREE_DETAILS_SUBREQUESTS } from './free-details.js';
import { heldForPerson } from './research-run.js';

function candidate(overrides: Partial<SweepCandidate> = {}): SweepCandidate {
  const missing = overrides.missing ?? (['firstPublished', 'description'] as const);
  return {
    workId: 1,
    title: 'Unsouled',
    authors: 'Will Wight',
    missing,
    // Defaults to `missing`, which is what `detailAsks` returns for every book
    // that is not being asked its series. A test about the companion ask sets
    // it explicitly.
    asks: missing,
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

test('a gap a finished run did not close is asked once, not hourly', () => {
  // The volume number was the standing example, and it is no longer one: the
  // gap test demanded a printed form nothing in the pipeline wrote, which by
  // 2026-08-19 had made 55 of the friend instance's 55 remaining rows
  // unclosable. The owner made the printed form optional and the predicate now
  // reads the sort alone (`docs/info/volume-numbers.md`).
  //
  // ⚠️ The RULE this pins survives that entirely, which is why the test does:
  // an open gap whose question a finished run already put is asked once,
  // whatever the field and whatever the reason it stayed open. Asked once is a
  // reasonable price; asked every hour is a subscription.
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
  // 12 + 18 (free ladder) + 4x4 = 46 each; two of them is 92, past the budget
  // and past the ceiling. It is picked alone rather than fitted in beside another.
  //
  // ⚠️ This is the case that forced SWEEP_BUDGET 44 -> 46 when rung 2 went live
  // (2026-08-25). `planSweep` BREAKS rather than continues, and this book sorts
  // first (never attempted), so at 44 the sweep would have picked NOTHING every
  // hour instead of deferring it. A four-gap book is the one the sweep is for.
  const greedy = (id: number) =>
    candidate({ workId: id, missing: ['firstPublished', 'series', 'seriesIndex', 'description'] });
  const plan = planSweep([greedy(1), greedy(2)]);
  assert.equal(plan.pick.length, 1);
  assert.equal(plan.deferred, 1);
  assert.ok(plan.estimated <= SWEEP_BUDGET);
});

test('an ordinary AI book is picked and stays inside the budget', () => {
  // The common shape by a distance: every work in this catalog was missing its
  // year and its description when the queue was measured (2026-08-10). Since the
  // free-details ladder is now counted (audit HIGH, details-sweep.ts:328), an
  // AI-only two-gap book estimates at 12 + 18 + 8 = 38, so a single one fits
  // under the 46 budget but TWO (76) no longer do — the ladder cost
  // that was silently overrunning the 50-subrequest ceiling is now honest.
  const one = planSweep([candidate({ workId: 1 })]);
  assert.equal(one.pick.length, 1);
  assert.ok(one.estimated <= SWEEP_BUDGET, `${one.estimated} over budget`);

  const two = planSweep([candidate({ workId: 1 }), candidate({ workId: 2 })]);
  assert.equal(two.pick.length, 1, 'two AI books really cost 76 > 46 — one is picked, honestly');
  assert.equal(two.deferred, 1);
  assert.ok(two.estimated <= SWEEP_BUDGET);
});

test('the item cap binds even when the budget would allow more', () => {
  // A deliberately generous budget so the BUDGET is not what binds — this test
  // isolates the item cap. (Under the real 46 budget, the free-ladder cost means
  // even one-field AI books at 34 each let only one through, so the cap and the
  // budget can no longer be exercised by the same fixture.)
  const cheap = (id: number) => candidate({ workId: id, missing: ['description'] });
  const plan = planSweep([cheap(1), cheap(2), cheap(3), cheap(4)], SWEEP_LIMIT, 500);
  assert.equal(plan.pick.length, SWEEP_LIMIT);
});

test('the per-book estimate is per field, because auto-apply is per field', () => {
  // AI_ONLY: 12 (claimRun+runDetailsResearch bookkeeping) + the free-details
  // ladder runDetailsResearch now always runs first + 4·fields.
  //
  // ⚠️ Derived from FREE_LADDER_SUBREQUESTS, not typed: the constant it prices
  // was left at 11 through two new rungs (F1, 2026-08-25), and a test that
  // re-typed the total would have gone green beside it.
  assert.equal(estimateSubrequests(0), 12 + FREE_LADDER_SUBREQUESTS);
  assert.equal(estimateSubrequests(4), 12 + FREE_LADDER_SUBREQUESTS + 16);
});

test('the free-details ladder is COUNTED — an AI book estimate includes every rung', () => {
  // ⚠️ Regression guard (2026-08 audit HIGH, details-sweep.ts:328): the estimate
  // once counted 0 for the free ladder that runDetailsResearch always runs, so a
  // sweep could pick two books whose real cost is ~74 against the 50 ceiling and
  // overrun the invocation silently. The ladder is AI-only (gated by
  // `if (!mode.ai) continue;`), so it must move the AI estimate and NOT the
  // donor-only one.
  const aiOnly = estimateSubrequests(2, { ai: true, donor: false });
  const donorOnly = estimateSubrequests(2, { ai: false, donor: true });
  assert.equal(aiOnly, 12 + FREE_LADDER_SUBREQUESTS + 8, 'AI two-gap book: 12 + ladder + 0 + 8');
  assert.equal(donorOnly, 13, 'donor-only two-gap book is unchanged — no free ladder');
  // Two AI-only two-gap books really cost past 50, so the free ladder must be
  // enough to push a two-book AI-only estimate past the ceiling.
  assert.ok(2 * aiOnly > 50, 'two AI books must no longer fit one 50-subrequest tick');
});

test('⚠️ the ladder price is DERIVED from the ladder — a new rung cannot land unpriced', () => {
  // F1, 2026-08-25: `FREE_LADDER_SUBREQUESTS` read 11 while Hardcover and
  // Wikidata had already been appended to `freeDetailsFor`'s rungs, and the
  // enumeration it was copied from never counted the `getWork` that
  // `updateWork` does before it writes. Four short per AI book, against a
  // ceiling whose overrun does not throw — it silently kills the invocation.
  //
  // The number now comes from `FREE_LADDER_RUNGS`, plus exactly what
  // `runDetailsResearch` spends around the ladder: `listAliasesForWork` before
  // and the `getWork` re-read after. `free-details.test.ts` proves the ladder
  // half against a real worst-case run.
  assert.equal(FREE_LADDER_SUBREQUESTS, FREE_DETAILS_SUBREQUESTS + 2);
  assert.equal(FREE_LADDER_SUBREQUESTS, 18, 'today: 16 in the ladder + 2 around it');
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
  assert.equal(estimateSubrequests(2, { ai: true, donor: true }), 12 + FREE_LADDER_SUBREQUESTS + 6 + 8);
  assert.equal(estimateSubrequests(4, { ai: true, donor: true }), 12 + FREE_LADDER_SUBREQUESTS + 6 + 16);
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
  // 2 × 41 = 82 is past the whole ceiling (the ~74 the audit measured). Fitting
  // both in on an estimate blind to the free ladder is exactly the
  // silent-termination bug the budget exists for.
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

test('donorFindings merges seriesIndexDisplay into seriesIndex value for applyFinding', () => {
  const reply: DonorDetailsReply = {
    matched: true,
    workId: 7,
    title: 'Unsouled',
    details: { series: 'Cradle', seriesIndex: 1 },
    seriesIndexDisplay: 'Volume 01',
  };
  const findings = donorFindings(['series', 'seriesIndex'], reply, 'https://library.heygabi.ai');
  const siF = findings.find((f) => f.field === 'seriesIndex');
  assert.equal(siF?.value.value, 'Volume 01', 'the printed form is the value — applyFinding writes both sort and display from it');
});

test('donorFindings uses bare sort when no seriesIndexDisplay is present', () => {
  const reply: DonorDetailsReply = {
    matched: true,
    workId: 7,
    title: 'Unsouled',
    details: { series: 'Cradle', seriesIndex: 1 },
  };
  const findings = donorFindings(['series', 'seriesIndex'], reply, 'https://library.heygabi.ai');
  const siF = findings.find((f) => f.field === 'seriesIndex');
  assert.equal(siF?.value.value, 1, 'the sort number travels as-is when no printed form is available');
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
