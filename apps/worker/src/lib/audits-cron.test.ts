/**
 * The audits' cron string, and the three files that have to agree about it.
 *
 * `wrangler.toml` schedules by STRING, `scheduled()` dispatches by STRING, and
 * an unrecognised cron does nothing. A rename in one of the two files stops the
 * audits firing **while both files still look correct** — the failure is total
 * and silent, and the only thing that catches it is a test that READS the toml
 * rather than trusting it.
 *
 * ⚠️ **There are TWO `[triggers]` blocks**, three hundred lines apart, only one
 * of which is ever open when somebody edits a cron. `audiobook-cron.test.ts`
 * already asserts the pair for the first two strings; this file adds the third
 * and — more usefully — asserts that the two blocks carry the SAME SET, so
 * nothing can be added to one and forgotten in the other.
 *
 * ⚠️ padhard is the instance this matters most on. Her covers are the ones that
 * have actually gone missing (40 blanks, measured 2026-08-23) and the ones the
 * script could not audit at all until 2026-08-22 — so a cron that silently
 * fires on main only would reproduce, in a new place, the exact bug that
 * change fixed.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { AUDIOBOOK_SWEEP_CRON } from './audiobook-sweep-run.js';
import { AUDITS_CRON } from './audit-run.js';
import { DETAILS_SWEEP_CRON } from './details-sweep.js';

// fileURLToPath, not a URL object: the Workers TS lib's URL is not node:url's
// URL, and readFileSync(URL) fails to typecheck across the two.
const toml = readFileSync(
  fileURLToPath(new URL('../../wrangler.toml', import.meta.url).href),
  'utf8',
);
const index = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url).href), 'utf8');

/** The `crons = [...]` line belonging to one `[triggers]`-shaped block. */
function cronsIn(block: string): string {
  const at = toml.indexOf(`[${block}]`);
  assert.notEqual(at, -1, `wrangler.toml has no [${block}] block at all`);
  const line = /crons\s*=\s*\[([^\]]*)\]/.exec(toml.slice(at));
  assert.ok(line, `[${block}] has no crons entry`);
  return line[1] as string;
}

const BLOCKS = ['triggers', 'env.friend.triggers'];

describe('the audits cron is scheduled on BOTH instances', () => {
  for (const block of BLOCKS) {
    it(`[${block}] carries "${AUDITS_CRON}"`, () => {
      assert.ok(
        cronsIn(block).includes(`"${AUDITS_CRON}"`),
        `[${block}] has no cron entry "${AUDITS_CRON}" — neither audit would ever fire ` +
          'there, and nothing else would say so',
      );
    });

    it(`[${block}] still carries the other two strings`, () => {
      // ⚠️ Adding a string must not REPLACE one. Both blocks are edited by hand
      // and `crons = [...]` is a single line; overwriting it is one keystroke.
      for (const cron of [DETAILS_SWEEP_CRON, AUDIOBOOK_SWEEP_CRON]) {
        assert.ok(
          cronsIn(block).includes(`"${cron}"`),
          `[${block}] lost "${cron}" — that job stopped firing`,
        );
      }
    });

    it(`[${block}] carries exactly three strings — an unknown fourth would do NOTHING`, () => {
      const count = cronsIn(block).split(',').filter((s) => s.trim()).length;
      assert.equal(
        count,
        3,
        `[${block}] has ${count} cron strings but the dispatcher knows three. A string ` +
          'wrangler schedules and `scheduled()` does not recognise is an invocation that ' +
          'logs an error and does nothing, every time it fires.',
      );
    });
  }

  it('🔴 the two blocks carry the SAME set of strings', () => {
    const normalise = (s: string) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .sort();
    assert.deepEqual(
      normalise(cronsIn('env.friend.triggers')),
      normalise(cronsIn('triggers')),
      'the two [triggers] blocks disagree — one instance is running a schedule the other is not',
    );
  });
});

describe('the dispatcher knows it, and guesses at nothing', () => {
  it('scheduled() branches on AUDITS_CRON by name', () => {
    assert.match(
      index,
      /event\.cron === AUDITS_CRON/,
      'index.ts does not dispatch the audits cron — the trigger would fire into nothing',
    );
  });

  it('it runs BOTH audits — one string, two jobs', () => {
    assert.match(index, /runCoverHealthAudit\(env, \{ trigger: 'cron' \}\)/);
    assert.match(index, /runSeriesAggregateAudit\(env, \{ trigger: 'cron' \}\)/);
  });

  it('⚠️ an unrecognised cron is still an ERROR, never a fall-through', () => {
    // The sibling Worker's bug, verbatim: it fell through to its oldest job
    // because it had a schedule before it had a dispatcher.
    assert.match(index, /cron fired that nothing handles/);
    // …and the error names every string it DOES know, so the mismatch is
    // readable in one log line rather than needing a diff of two files.
    assert.match(index, /AUDITS_CRON,\s*\n\s*\);/);
  });

  it('the promise is RETURNED as well as registered — waitUntil alone is a bug', () => {
    // A registered task is cancelled ~30s after the handler settles, and the
    // sibling project measured roughly half its runs silently cancelled that
    // way, with run rows stuck at `running` for eleven hours. The cover half of
    // this cron makes up to 250 sequential-ish probes and will comfortably
    // outlive 30 seconds.
    const branch = index.slice(index.indexOf('event.cron === AUDITS_CRON'));
    const body = branch.slice(0, branch.indexOf('cron fired that nothing handles'));
    assert.match(body, /ctx\.waitUntil\(work\);/);
    assert.match(body, /return work;/);
  });
});

describe('the string itself', () => {
  it('is daily at 09:47 UTC — 02:47 Phoenix', () => {
    assert.equal(AUDITS_CRON, '47 9 * * *');
  });

  it('shares a minute with NEITHER other cron — they must not fight for a budget', () => {
    // The games repo records that two cron invocations in the same minute
    // compete for the same subrequest budget, and a details tick can spend 46 of
    // 50 on its own. The cover audit probes up to 250 URLs.
    const minute = (cron: string) => cron.split(' ')[0];
    assert.notEqual(minute(AUDITS_CRON), minute(DETAILS_SWEEP_CRON));
    assert.notEqual(minute(AUDITS_CRON), minute(AUDIOBOOK_SWEEP_CRON));
  });

  it('does not fire on the hour — :00 is where the whole world fires', () => {
    assert.notEqual(AUDITS_CRON.split(' ')[0], '0');
  });

  it('is DAILY, not hourly — a broken cover does not un-break itself', () => {
    // Guards against somebody "improving" the freshness. The inventory's point
    // was that a report with NO clock never runs, not that it needs a fast one;
    // an hourly tick would probe 6,000 other people's URLs a day to learn what
    // one tick already knew.
    const [, hour, dom, month, dow] = AUDITS_CRON.split(' ');
    assert.ok(!hour?.includes('*'), 'the hour field is a wildcard — this is not daily');
    assert.deepEqual([dom, month, dow], ['*', '*', '*']);
  });
});
