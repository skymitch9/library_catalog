#!/usr/bin/env node
/**
 * Check all cover URLs — both relative and absolute — and report broken ones.
 * Catches "image not available" placeholders: tiny files, 404s, non-image
 * responses.
 *
 * ## ⚠️ THIS IS NOW A THIN CALLER — 2026-09-06
 *
 * Every RULE this script applies moved to `packages/core/src/audits.ts` when the
 * audit became a route + cron (platform inventory §7 row #4). The script is not
 * retired and is not a wrapper for the route: it stays because it can sweep the
 * WHOLE catalog in one go with no per-tick cap, which the Worker deliberately
 * will not do.
 *
 * What it must never do again is keep its own copy of a rule. It had two:
 * `MIN_BYTES = 1000` (the same number `MIN_COVER_BYTES` already held, arrived at
 * twice) and the four-branch verdict ladder. Both now come from `@lc/core`, so
 * the script and `apps/worker/src/lib/cover-health-run.ts` cannot drift — which
 * is the rule the inventory ends on and the reason `matching.ts` opens with
 * three wrong-game matches the sibling catalog shipped.
 *
 * ⚠️ **The printed output is byte-identical to the pre-conversion script**, and
 * that is measured rather than intended: `packages/core/test/audits.test.ts`
 * keeps the old inline logic verbatim as an oracle and compares the bytes on a
 * fixture.
 *
 * ## Running it
 *
 *   npm run check:cover-health                          # local dev database
 *   npm run check:cover-health -- --remote              # main, production
 *   npm run check:cover-health -- --remote --friend     # padhard, production
 *
 * ⚠️ It runs under **tsx** now (it imports TypeScript from `@lc/core`), which is
 * why the npm script exists. `node scripts/check-cover-health.mjs` will not
 * work.
 *
 * ⚠️ The ROUTE form checks a rotating 250-cover window each night and reports on
 * `/api/health` under `detail.coverHealth`. Runbook: `docs/access/audits.md`.
 */
import {
  formatCoverHealthHeader,
  formatCoverHealthReport,
  judgeCoverProbe,
  resolveCoverUrl,
} from '../packages/core/src/audits.ts';
import { query, parseFlags } from './lib/d1.mjs';

const flags = parseFlags();
/**
 * ⚠️ `--friend` switches the DATABASE and the base URL together, and until
 * 2026-08-22 it switched only the URL. `query()` read the MAIN catalog's rows
 * and fetched them against padhard, so this script had never audited a single
 * second-instance row — while a clean run of it was being read as evidence that
 * padhard was fine. It held 47 works needing a cover at the time. The pairing is
 * now structural: both come off the same `flags.friend`.
 */
const BASE = flags.friend ? 'https://padhard.heygabi.ai' : 'https://library.heygabi.ai';
const DB_LABEL = flags.friend ? 'library-catalog-2nd' : 'library-catalog';

const UA = 'library_catalog cover-health-check';

const rows = query(
  `SELECT id, title, cover_url FROM work WHERE cover_url IS NOT NULL AND cover_url <> '' ORDER BY id`,
  flags,
);

console.log(formatCoverHealthHeader(rows.length, DB_LABEL, BASE));

const broken = [];
let checked = 0;

for (const r of rows) {
  const url = resolveCoverUrl(r.cover_url, BASE);
  let verdict;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const length = res.headers.get('content-length');
    verdict = judgeCoverProbe({
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type'),
      contentLength: length === null ? null : Number.parseInt(length, 10),
    });
  } catch (err) {
    verdict = judgeCoverProbe({
      ok: false,
      status: 0,
      contentType: null,
      contentLength: null,
      error: err?.message ?? String(err),
    });
  }

  // ⚠️ `broken` and `unreachable` go in ONE list here, exactly as they always
  // have. A person watching this scroll past has the reason column to tell a
  // timeout from a 404; the CRON does not, which is why the ROUTE counts them
  // separately — see `cover-health-run.ts`.
  if (verdict.verdict !== 'ok') {
    broken.push({ ...r, url, verdict: verdict.verdict, reason: verdict.reason });
  }

  checked++;
  if (checked % 50 === 0) process.stdout.write(`  ${checked}/${rows.length}...\n`);
}

console.log(formatCoverHealthReport(broken, checked));
