/**
 * Phase 5, the research half: the details queue and the lookups that feed it.
 *
 * ## The two capabilities are different on purpose
 *
 * `runResearch` spends money. `reviewFindings` changes the catalog. They are
 * separate rows in `CAPABILITY_MATRIX` (both `owner`-only today) because the two
 * risks are different: one is a bill, the other is a wrong fact that looks
 * exactly like a right one. Reading the queue needs neither — a reader may see
 * what is missing.
 *
 * ⚠️ **Auto-apply makes `runResearch` imply the second risk as well**, since a
 * lookup now writes what it finds. That is survivable only because both are
 * `owner` today; if `runResearch` is ever widened to another role, it must gain
 * a `reviewFindings` check or the split silently stops meaning anything.
 *
 * ## ⚠️ Research now applies what it finds
 *
 * This used to read *"research proposes; a person accepts"*, and
 * `POST /works/:id/run` touched only `research_run` and `research_finding`. The
 * gate was retired because it was not being used — the owner pressed Use on
 * everything without reading it, so the queue bought taps rather than scrutiny.
 * `lib/research-run.ts` carries the full argument and the terms of the trade.
 *
 * What that means for the routes here:
 *
 * - `POST /works/:id/run` **writes to `work`**, and its response says what it
 *   wrote. It is no longer a read-only operation on the catalog.
 * - `PATCH /findings/:id` survives for the leftovers — a finding whose value
 *   could not be used stays pending, and a person still decides those. It marks
 *   its work `decided_how = 'human'`.
 * - `GET /auto-applied` and `POST /undo` are the recoverability half of the
 *   bargain: see the batch, throw it away.
 *
 * The free way to close a gap is unchanged: `POST /works/:id/verdict`, a person
 * writing down "this is a standalone, and here is how I know". It costs nothing
 * and it demands a source.
 */

import { Hono } from 'hono';
import {
  DETAIL_FIELD_LABEL,
  REFUSED_FIELDS,
  reviewFindingSchema,
  setGapVerdictSchema,
} from '@lc/core';
import {
  gapSummary,
  getFinding,
  getWork,
  listAutoApplied,
  listFindings,
  listGapVerdicts,
  listPendingFindings,
  listRunsForWork,
  listWorksNeedingDetails,
  latestRuns,
  markFinding,
  runTotals,
  setGapVerdict,
  deleteGapVerdict,
} from '@lc/db';
import { RESEARCH_CENTS_EACH, RESEARCH_MODEL, estimateCents } from '@lc/research';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';
import {
  applyFinding,
  claimRun,
  gapsFor,
  revertFinding,
  runDetailsResearch,
  toRunView,
} from '../lib/research-run.js';

const idParam = (raw: string | undefined): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export const researchRoutes = new Hono<AppBindings>()

  /**
   * The worklist, and the tally that makes it mean something.
   *
   * ⚠️ `summary` is not decoration. Measured against production on 2026-08-10,
   * **every** work is missing its publication year and its description, so a
   * bare list of 116 rows all saying the same two words carries no information
   * at all. The per-field tally does: it separates the questions that are nearly
   * closed (series — 13 blank, 13 already answered) from the ones that are wide
   * open, and it shows the answered ones as work already done rather than as an
   * absence.
   *
   * `refused` is here for the same reason. A queue that silently omits ISBN
   * looks like an oversight; one that says "refused, and here is why" is a
   * decision somebody can argue with.
   */
  .get('/queue', requireCapability('read'), async (c) => {
    const [works, summary, runs, totals, pending] = await Promise.all([
      listWorksNeedingDetails(c.env.DB),
      gapSummary(c.env.DB),
      latestRuns(c.env.DB),
      runTotals(c.env.DB),
      listPendingFindings(c.env.DB),
    ]);

    // ⚠️ Counted here rather than fetched per row when a row is expanded. A
    // queue whose rows cannot say "2 waiting on you" until you open them is a
    // queue you have to open every row of — which is the opposite of a worklist.
    // One extra query for the whole page.
    const pendingByWork = new Map<number, number>();
    for (const f of pending) pendingByWork.set(f.workId, (pendingByWork.get(f.workId) ?? 0) + 1);

    return c.json({
      works: works.map((w) => ({
        ...w,
        pending: pendingByWork.get(w.workId) ?? 0,
        missingLabels: w.missing.map((f) => DETAIL_FIELD_LABEL[f]),
        answeredLabels: w.answered.map((f) => DETAIL_FIELD_LABEL[f] ?? f),
      })),
      summary: summary.map((s) => ({ ...s, label: DETAIL_FIELD_LABEL[s.field] })),
      refused: REFUSED_FIELDS,
      runs: runs.map(toRunView),
      spent: {
        runs: totals.runs,
        errors: totals.errors,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        estimatedCents: estimateCents(totals.inputTokens, totals.outputTokens),
      },
      model: RESEARCH_MODEL,
      centsEach: RESEARCH_CENTS_EACH,
      /** Whether a lookup can even be attempted, so the page can say so once. */
      configured: Boolean(c.env.ANTHROPIC_API_KEY),
    });
  })

  /** Everything proposed for this book so far, plus the runs that produced it. */
  .get('/works/:id/findings', requireCapability('read'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const work = await getWork(c.env.DB, id);
    if (!work) return c.json({ error: 'not_found' }, 404);

    const [findings, runs, verdicts, gaps] = await Promise.all([
      listFindings(c.env.DB, id),
      listRunsForWork(c.env.DB, id),
      listGapVerdicts(c.env.DB, id),
      gapsFor(c.env.DB, id),
    ]);

    return c.json({
      work: { id: work.id, title: work.title, authors: work.authors },
      findings,
      runs: runs.map(toRunView),
      verdicts,
      missing: gaps ?? [],
    });
  })

  /** Every proposal waiting for a decision, across the catalog. */
  .get('/pending', requireCapability('read'), async (c) => {
    return c.json({ findings: await listPendingFindings(c.env.DB) });
  })

  /**
   * What the machine wrote lately, newest first.
   *
   * ⚠️ This route is the consideration in the auto-apply bargain, not a
   * reporting extra. The owner gave up reading each value before it lands; this
   * is what they got for it — a batch they can look over afterwards and throw
   * away wholesale. Removing it would leave the trade one-sided.
   *
   * `read`, not `reviewFindings`: seeing what the catalog did to itself is not a
   * privileged act, and the person who cannot undo it is exactly the person who
   * most needs to be able to spot it and say something.
   */
  .get('/auto-applied', requireCapability('read'), async (c) => {
    const asked = Number(c.req.query('limit'));
    const limit = Number.isInteger(asked) && asked > 0 && asked <= 200 ? asked : 50;
    return c.json({ applied: await listAutoApplied(c.env.DB, limit) });
  })

  /**
   * Take back one auto-applied value, or a whole batch of them.
   *
   * One route for both, because a bulk undo is not a different operation from a
   * single one — it is the same operation on a list, and two routes would be two
   * places for the "only touch what the machine wrote" rule to be got wrong.
   *
   * ⚠️ Sequential, not `Promise.all`, and not a `batch`. Undoing a `series`
   * finding also clears `seriesIndexSort` (see `revertFinding`), so two reverts
   * against one book read and write the same row — in parallel the second would
   * overwrite the first's clear with a stale value it read before it happened.
   * D1's subrequest ceiling is also real here: each revert is ~4, so this caps
   * the list rather than trusting the caller.
   */
  .post('/undo', requireCapability('reviewFindings'), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((n): n is number => Number.isInteger(n) && (n as number) > 0)
      : [];

    if (ids.length === 0) {
      return c.json({ error: 'bad_request', detail: 'Send { ids: [number, …] }.' }, 400);
    }
    // 10 reverts is ~40 subrequests. The page undoes a screenful at a time and
    // exceeding the ceiling terminates the invocation silently rather than
    // throwing, so this refuses rather than truncating — a partial undo that
    // reported success would be worse than a refusal.
    if (ids.length > 10) {
      return c.json(
        { error: 'bad_request', detail: 'Undo at most 10 at a time.' },
        400,
      );
    }

    const reverted: string[] = [];
    const skipped: string[] = [];
    const works = new Set<number>();

    for (const id of ids) {
      const finding = await getFinding(c.env.DB, id);
      if (!finding) {
        skipped.push(`#${id} no longer exists.`);
        continue;
      }
      const outcome = await revertFinding(c.env.DB, finding);
      if (outcome.reverted) {
        reverted.push(outcome.reverted);
        works.add(finding.workId);
      } else {
        skipped.push(outcome.skipped ?? `#${id} could not be undone.`);
      }
    }

    return c.json({ reverted, skipped, works: [...works] });
  })

  /**
   * Look one book up on the open web. Costs money; owner only.
   *
   * **Slow on purpose — twenty seconds to a minute and a half — and that is the
   * fix, not the bug.** Answering fast and finishing under `executionCtx.waitUntil`
   * sounds strictly better and is not: a `waitUntil` task gets about thirty
   * seconds *after the response is returned*, and half of these take longer. The
   * cancellation is silent. Awaiting keeps the invocation open, and an
   * invocation doing I/O has no such clock. See `lib/research-run.ts`.
   *
   * A second request while one is in flight gets the run already working rather
   * than starting another — the queue page polls, and an unguarded route would
   * buy the same answer twice.
   */
  .post('/works/:id/run', requireCapability('runResearch'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    // Checked before the run row exists: no key is a misconfiguration the caller
    // can act on, and recording it as a failed run would put an error against a
    // book that has nothing wrong with it.
    if (!c.env.ANTHROPIC_API_KEY) {
      return c.json(
        {
          error: 'not_configured',
          detail:
            'No Anthropic API key. Put ANTHROPIC_API_KEY in apps/worker/.dev.vars, then `npm run secrets:push`.',
        },
        503,
      );
    }

    const user = c.get('user');
    const claim = await claimRun(c.env.DB, id, user.id);

    if (claim.kind === 'not_found') return c.json({ error: 'not_found' }, 404);
    if (claim.kind === 'nothing_to_ask') {
      return c.json(
        {
          error: 'nothing_to_ask',
          detail:
            'Every question this book is asked has an answer already — a value or a recorded verdict.',
        },
        400,
      );
    }
    // Somebody else's lookup is already paying for this answer. Say so and get
    // out of the way; the caller polls for the outcome like everyone else.
    if (claim.kind === 'running') {
      return c.json({ run: toRunView(claim.run), alreadyRunning: true });
    }

    const work = runDetailsResearch(c.env, claim.run.id, id, claim.fields, user.id);
    // Registered *and* awaited. The await is what buys the time; the
    // registration is what saves the answer if this caller vanishes.
    //
    // ⚠️ Now that the run applies what it finds, the registration matters more
    // than it did: a caller that walks away mid-lookup must still get its
    // findings written, or the money is spent and the columns stay blank.
    c.executionCtx.waitUntil(work);
    const finished = await work;

    return c.json({
      run: toRunView(finished ?? claim.run),
      alreadyRunning: false,
      // Still pending after the run means "could not be applied" — a value that
      // was not a usable year, or not a number. Those are the only ones left for
      // a person, and there is normally nothing here.
      findings: await listFindings(c.env.DB, id, 'pending'),
      /** What the catalog now says, so the page can redraw without refetching. */
      missing: (await gapsFor(c.env.DB, id)) ?? [],
    });
  })

  /**
   * Accept or reject one proposal, by hand.
   *
   * ⚠️ **This is now the exception path, not the main one.** Auto-apply closes
   * almost everything inside the run; what reaches here is a finding whose value
   * could not be used — not a four-digit year, not a number — which stays
   * `pending` precisely so a person still gets asked. Kept rather than deleted
   * because those genuinely need a human, and because a reader may still want to
   * reject something they disagree with.
   *
   * Accepting applies it. `applyFinding` refuses to overwrite anything already
   * recorded, refuses to touch title or authors, and turns a `none`/`unknown`
   * into a verdict rather than a value. Both writes are stamped
   * `decided_how = 'human'` — the whole point of the column is that this route
   * and the automatic one are distinguishable afterwards.
   *
   * The response says what changed in a sentence, because "accepted" alone does
   * not tell you whether anything happened.
   */
  .patch('/findings/:id', requireCapability('reviewFindings'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const parsed = reviewFindingSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    const finding = await getFinding(c.env.DB, id);
    if (!finding) return c.json({ error: 'not_found' }, 404);
    if (finding.reviewState !== 'pending') {
      return c.json(
        { error: 'already_reviewed', detail: `This was already ${finding.reviewState}.` },
        409,
      );
    }

    const user = c.get('user');
    const outcome =
      parsed.data.reviewState === 'accepted'
        ? await applyFinding(c.env.DB, finding, user.id, 'human')
        : { applied: null, skipped: null };

    const marked = await markFinding(c.env.DB, id, parsed.data.reviewState, user.id, 'human');

    return c.json({
      finding: marked,
      ...outcome,
      missing: (await gapsFor(c.env.DB, finding.workId)) ?? [],
    });
  })

  /**
   * Write down an answer by hand. Free, and the honest way to close a gap.
   *
   * ⚠️ The route the eleven researched standalones exist to justify. Somebody
   * already knows the answer; making them pay a model to rediscover it would be
   * absurd, and leaving the gap open means paying for it on every future pass.
   * `setGapVerdictSchema` requires a non-empty `source` — the rule
   * `series-overrides.json` states in as many words: *an entry with no source is
   * a bug, not a shortcut.*
   */
  .post('/works/:id/verdict', requireCapability('reviewFindings'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);

    const parsed = setGapVerdictSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    const work = await getWork(c.env.DB, id);
    if (!work) return c.json({ error: 'not_found' }, 404);

    const user = c.get('user');
    const verdict = await setGapVerdict(c.env.DB, {
      workId: id,
      field: parsed.data.field,
      verdict: parsed.data.verdict,
      source: parsed.data.source,
      note: parsed.data.note ?? null,
      decidedBy: user.id,
    });

    return c.json({ verdict, missing: (await gapsFor(c.env.DB, id)) ?? [] });
  })

  /** Withdraw an answer, putting the question back on the list. */
  .delete('/verdicts/:id', requireCapability('reviewFindings'), async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'bad_request', detail: 'invalid id' }, 400);
    const gone = await deleteGapVerdict(c.env.DB, id);
    if (!gone) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  });
