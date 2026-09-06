/**
 * The three files that have to agree about a cron string, and what happens when
 * they do not.
 *
 * `wrangler.toml` schedules by STRING, `scheduled()` dispatches by STRING, and
 * an unrecognised cron does nothing. So a rename in one of the two files stops
 * the sweep firing **while both files still look correct** — the failure is
 * total and silent, and the only thing that catches it is a test that reads the
 * toml rather than trusting it.
 *
 * ⚠️ **And there are TWO blocks**, three hundred lines apart, only one of which
 * is ever open when somebody edits a cron. `[env.friend.triggers]` carries the
 * SAME strings deliberately; a different minute there would silently disable
 * padhard's sweep — the trap the details sweep's own wrangler comment already
 * warns about, now with two strings to get wrong instead of one.
 *
 * The sibling `details-sweep.test.ts` has the single-string version of this
 * test. This file is the one that checks the PAIR, in BOTH blocks, and that the
 * dispatcher knows both.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { AUDIOBOOK_SWEEP_CRON } from './audiobook-sweep-run.js';
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

describe('the audiobook cron is scheduled on BOTH instances', () => {
  for (const block of ['triggers', 'env.friend.triggers']) {
    it(`[${block}] carries "${AUDIOBOOK_SWEEP_CRON}"`, () => {
      assert.ok(
        cronsIn(block).includes(`"${AUDIOBOOK_SWEEP_CRON}"`),
        `[${block}] has no cron entry "${AUDIOBOOK_SWEEP_CRON}" — the audiobook sweep would ` +
          'never fire there, and nothing else would say so',
      );
    });

    it(`[${block}] still carries the details sweep's "${DETAILS_SWEEP_CRON}"`, () => {
      // ⚠️ Adding a string must not REPLACE one. Both blocks are edited by hand
      // and `crons = [...]` is a single line; overwriting it is one keystroke.
      assert.ok(
        cronsIn(block).includes(`"${DETAILS_SWEEP_CRON}"`),
        `[${block}] lost "${DETAILS_SWEEP_CRON}" — the details sweep stopped firing`,
      );
    });
  }

  it('🔴 the two blocks carry the SAME set of strings', () => {
    // A different minute on her instance disables HER sweep silently while this
    // file still reads as configured. One edit, both blocks.
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

describe('the mode ships SHADOW on both instances, and never enforce by accident', () => {
  const modes = [...toml.matchAll(/^AUDIOBOOK_SWEEP_MODE\s*=\s*"([^"]*)"/gm)].map(
    (m) => m[1] as string,
  );

  it('both [vars] blocks declare it — a missing one is silently OFF', () => {
    // The var fails closed, which is right, and it means an omission does not
    // announce itself: that instance simply never sweeps and nothing says so.
    assert.equal(
      modes.length,
      2,
      'AUDIOBOOK_SWEEP_MODE must appear in [vars] AND [env.friend.vars] — a missing ' +
        'one resolves to `off` and that instance silently stops sweeping',
    );
  });

  it('🔴 both are "shadow" — enforce is a deliberate flip with a numbered gate', () => {
    // §8 phase 2 → 3: ≥42 shadow ticks with zero divergences against the
    // script. Shipping `enforce` as a side effect of an unrelated deploy is
    // exactly what the estate's off → shadow → enforce rule exists to stop.
    assert.deepEqual(modes, ['shadow', 'shadow']);
  });

  it('the two instances are mirrored', () => {
    assert.equal(
      modes[0],
      modes[1],
      'one instance is enforcing while the other is not — the shadow evidence on ' +
        'either becomes unreadable against the other',
    );
  });
});

describe('the dispatcher knows both, and guesses at neither', () => {
  it('scheduled() branches on AUDIOBOOK_SWEEP_CRON by name', () => {
    assert.match(
      index,
      /event\.cron === AUDIOBOOK_SWEEP_CRON/,
      'index.ts does not dispatch the audiobook cron — the trigger would fire into nothing',
    );
  });

  it('scheduled() still branches on DETAILS_SWEEP_CRON by name', () => {
    assert.match(index, /event\.cron === DETAILS_SWEEP_CRON/);
  });

  it('⚠️ an unrecognised cron is still an ERROR, never a fall-through', () => {
    // The sibling Worker's bug, verbatim: it fell through to its oldest job
    // because it had a schedule before it had a dispatcher. Here that would run
    // the details sweep on the audiobook clock and hide the drift this whole
    // file exists to catch.
    assert.match(index, /cron fired that nothing handles/);
  });

  it('the two strings are different minutes — they must not share an invocation budget', () => {
    // The games repo records that two cron invocations in the same minute
    // compete for the same 50 subrequests, and a details tick can spend 46.
    const minuteOf = (cron: string) => cron.split(' ')[0];
    assert.notEqual(
      minuteOf(AUDIOBOOK_SWEEP_CRON),
      minuteOf(DETAILS_SWEEP_CRON),
      'both sweeps fire in the same minute — they will fight for one subrequest budget',
    );
  });

  it('neither fires on the hour — :00 is where the whole world fires', () => {
    for (const cron of [AUDIOBOOK_SWEEP_CRON, DETAILS_SWEEP_CRON]) {
      assert.notEqual(cron.split(' ')[0], '0', `${cron} joins the :00 stampede`);
    }
  });
});
