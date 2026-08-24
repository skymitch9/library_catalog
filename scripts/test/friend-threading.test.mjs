/**
 * --friend must be threaded into every query/execute of a friend-aware backfill
 * (2026-08 audit HIGH, `scripts/backfill-work-covers.mjs:35`).
 *
 * The bug: several writing backfills destructured only `{ commit, remote, limit }`
 * and passed a bare `{ remote }` to d1's query/execute, so `--friend --remote
 * --commit` silently read AND wrote the MAIN production catalogue while reporting
 * as if about padhard — `dbName({ remote, friend: undefined })` resolves to the
 * main DB.
 *
 * Structural guard (the scripts run on import, so they cannot be imported): each
 * fixed script must mention `friend` and must NOT pass a bare `{ remote }` to
 * d1 any more.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const scriptSrc = (name) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

describe('--friend is threaded into query/execute (audit HIGH :35)', () => {
  for (const name of [
    'backfill-work-covers.mjs',
    'backfill-edition-kinds.mjs',
    'apply-pending-findings.mjs',
  ]) {
    it(`${name} threads friend and passes no bare { remote }`, () => {
      const src = scriptSrc(name);
      assert.match(src, /friend/, `${name} must destructure/thread friend`);
      assert.doesNotMatch(
        src,
        /\{ remote \}/,
        `${name} still passes a friend-less { remote } to d1 — a --friend run would hit MAIN`,
      );
    });
  }
});
