/**
 * `shadowStrictCreate` — the KI-6 shadow rung, exercised against the REAL create
 * schemas it guards.
 *
 * The two properties the shadow flip depends on:
 *
 *   1. ⚠️ **An unmodelled key logs exactly one `would_reject` naming it** — and
 *      the record carries the field, the route and the schema, because the whole
 *      point is a count a human can act on ("which caller sends `person_name`?"),
 *      not a bare tally.
 *   2. ⚠️ **A clean body logs NOTHING.** A shadow rung that cried wolf on every
 *      request would drown the real would-rejects it exists to surface, and a
 *      later enforce flip reads this signal to decide it is safe.
 *
 * Run against the real `createCopySchema` etc. (not a fixture) so the KNOWN set
 * is byte-for-byte what the routes parse — the snake_case `person_name` from
 * KI-6's own measured reproduction is the headline case.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCopySchema, createEditionSchema, createWorkSchema } from '@lc/core';
import { shadowStrictCreate, type WouldReject } from './strict-shadow.js';

/** Collect records instead of writing to the console, so the log is assertable. */
function capture() {
  const records: WouldReject[] = [];
  return { records, log: (r: WouldReject) => records.push(r) };
}

describe('shadowStrictCreate — logs a would-reject, still accepts', () => {
  it('the KI-6 case: snake_case person_name on a copy logs one would-reject', () => {
    const { records, log } = capture();
    const returned = shadowStrictCreate(
      createCopySchema,
      { workId: 1, status: 'lent', person_name: 'Samantha' },
      'POST /api/copies',
      'createCopySchema',
      log,
    );
    assert.deepEqual(records, [
      { shadow: 'would_reject', route: 'POST /api/copies', schema: 'createCopySchema', field: 'person_name' },
    ]);
    // Returned records match what was logged — the routes ignore the return, but
    // a caller that wanted the count has it.
    assert.deepEqual(returned, records);
  });

  it('a clean copy body logs NOTHING', () => {
    const { records, log } = capture();
    shadowStrictCreate(
      createCopySchema,
      { workId: 1, status: 'lent', personName: 'Samantha', personUserId: 7 },
      'POST /api/copies',
      'createCopySchema',
      log,
    );
    assert.deepEqual(records, []);
  });

  it('names every unmodelled key, and only those', () => {
    const { records, log } = capture();
    shadowStrictCreate(
      createWorkSchema,
      { title: 'A Book', authors: 'Someone', bogus: 1, alsoBogus: 2 },
      'POST /api/works',
      'createWorkSchema',
      log,
    );
    assert.deepEqual(
      records.map((r) => r.field).sort(),
      ['alsoBogus', 'bogus'],
    );
  });

  it('a clean edition body logs nothing', () => {
    const { records, log } = capture();
    shadowStrictCreate(
      createEditionSchema,
      { workId: 1, format: 'hardcover', source: 'manual' },
      'POST /api/editions',
      'createEditionSchema',
      log,
    );
    assert.deepEqual(records, []);
  });

  it('a non-object body is a no-op (a create with one never parses anyway)', () => {
    const { records, log } = capture();
    for (const body of [null, 42, 'x', [1, 2]] as unknown[]) {
      shadowStrictCreate(createCopySchema, body, 'POST /api/copies', 'createCopySchema', log);
    }
    assert.deepEqual(records, []);
  });
});
