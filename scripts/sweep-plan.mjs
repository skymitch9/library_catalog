/**
 * What would the next details-sweep tick plan? — READ ONLY.
 *
 * ## Why this exists
 *
 * `docs/TODO.md`'s *"The hourly sweep STALLS on a book it cannot afford"* opened
 * with a step nobody could take: **"read the head of `listWorksNeedingDetails()`
 * on both instances and count the asks"**. There was no way to do that without
 * either running the sweep (which spends money) or hand-writing a second copy of
 * the gap predicate in SQL — and a hand-written copy of that decision is the
 * exact mistake `listWorksNeedingDetails`'s own header refuses to make.
 *
 * So this asks the real functions. `listWorksNeedingDetails`, `detailsRunHistory`
 * and `planSweep` are imported and called; nothing here re-implements a rule.
 * The database is an in-memory `node:sqlite` mirror of the four tables they read,
 * built by `research-queue.mjs`'s own `buildMirror` — the same trick, for the
 * same reason.
 *
 * ⚠️ **It writes NOTHING, anywhere.** No `execute`, no flush, no run row, no
 * network call beyond the `wrangler d1 execute --remote` SELECTs that fill the
 * mirror. Running it against production is safe by construction, and that is
 * what makes it usable as a check rather than as an experiment.
 *
 * ## The one input that is NOT measured
 *
 * `SweepMode` — whether this instance can pay a model and whether it has a
 * donor — is decided by `sweepMode(env)` from two secrets and a var, and a
 * Cloudflare secret **cannot be read back** (`docs/access/secrets.md`). So the
 * mode is an INPUT here, defaulting to `ai + donor` because
 * `npm run secret:list[:friend]` names `ANTHROPIC_API_KEY` and `DONOR_TOKEN` on
 * both instances and `wrangler.toml` sets `DONOR_URL` on both. It is printed as
 * an assumption, never as a measurement, and `--no-ai` / `--no-donor` are there
 * so a changed instance can still be priced honestly.
 *
 * ## Usage
 *
 *     tsx scripts/sweep-plan.mjs --remote            # main
 *     tsx scripts/sweep-plan.mjs --remote --friend   # padhard
 *     tsx scripts/sweep-plan.mjs --remote --no-donor # price it AI-only
 */

import { detailsRunHistory, listWorksNeedingDetails } from '@lc/db';
import { unaskedGaps } from '@lc/core';
import {
  estimateSubrequests,
  planSweep,
  SWEEP_BUDGET,
  SWEEP_LIMIT,
} from '../apps/worker/src/lib/details-sweep.ts';
import { parseFlags } from './lib/d1.mjs';
import { buildMirror, makeShim } from './research-queue.mjs';

/** How many of the rotation's head to print. Enough to see why, not a dump. */
const SHOW = 8;

async function main() {
  const { remote, friend } = parseFlags();
  const mode = {
    ai: !process.argv.includes('--no-ai'),
    donor: !process.argv.includes('--no-donor'),
  };
  const which = friend ? 'library-catalog-2nd (padhard)' : 'library-catalog (main)';

  if (!remote) {
    console.error(
      '⚠️ --remote is required. A local run reads miniflare\'s copy, which is not\n' +
        '   the catalog the hourly sweep is actually stalling on.',
    );
    process.exit(1);
  }

  console.log(`\n=== ${which} — what the next tick would plan ===`);
  console.log('mirroring (read-only)…');
  const { db } = buildMirror({ remote, friend });
  const shim = makeShim(db);

  const [works, history] = await Promise.all([
    listWorksNeedingDetails(shim),
    detailsRunHistory(shim),
  ]);

  const seen = new Map(history.map((h) => [h.workId, h]));
  const candidates = works.map((work) => {
    const past = seen.get(work.workId);
    return {
      workId: work.workId,
      title: work.title,
      authors: work.authors,
      missing: work.missing,
      asks: work.asks,
      asked: past?.asked ?? [],
      lastAttemptAt: past?.lastAttemptAt ?? null,
    };
  });

  const plan = planSweep(candidates, SWEEP_LIMIT, SWEEP_BUDGET, mode);
  const eligible = candidates.filter((c) => unaskedGaps(c.missing, c.asked).length > 0);
  const ordered = [...eligible].sort((a, b) => {
    if (a.lastAttemptAt === b.lastAttemptAt) return a.workId - b.workId;
    if (a.lastAttemptAt === null) return -1;
    if (b.lastAttemptAt === null) return 1;
    return a.lastAttemptAt < b.lastAttemptAt ? -1 : 1;
  });

  console.log(`\nmode (ASSUMED, not measured): ai=${mode.ai} donor=${mode.donor}`);
  console.log(`budget ${SWEEP_BUDGET} subrequests · limit ${SWEEP_LIMIT} books a tick`);
  console.log(`queued (works owing something): ${works.length}`);
  console.log(`eligible (an UNASKED question):  ${eligible.length}`);

  console.log(`\nrotation head (never-attempted first, then oldest attempt):`);
  for (const c of ordered.slice(0, SHOW)) {
    const cost = estimateSubrequests(c.asks.length, mode);
    const fits = cost <= SWEEP_BUDGET ? 'fits' : '⚠️ OVER BUDGET ALONE';
    const when = c.lastAttemptAt ?? 'never attempted';
    console.log(
      `  #${c.workId} ${JSON.stringify(c.title)} — ${c.asks.length} ask(s) ` +
        `[${c.asks.join(', ')}] = ${cost} — ${fits} — ${when}`,
    );
  }
  if (ordered.length > SHOW) console.log(`  … and ${ordered.length - SHOW} more`);

  console.log(`\nplan: ${plan.pick.length} book(s), ${plan.estimated} subrequests, ` +
    `${plan.deferred} deferred`);
  for (const c of plan.pick) console.log(`  pick #${c.workId} ${JSON.stringify(c.title)}`);
  if (plan.overBudget) {
    console.log(
      `  ⚠️ over-budget admission: #${plan.overBudget.workId} costs ${plan.overBudget.cost} ` +
        `of a budget of ${plan.overBudget.budget} — it takes the tick alone`,
    );
  }
  if (plan.nothingPicked) console.log(`  ⚠️ nothing picked — ${plan.nothingPicked}`);

  const stalled = eligible.length > 0 && plan.pick.length === 0;
  console.log(`\nSTALLED: ${stalled ? 'YES — eligible books exist and none was picked' : 'no'}`);
}

await main();
