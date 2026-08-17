/**
 * `describeError` — the shapes that used to come out as `[object Object]`.
 *
 * ⚠️ The defect these pin: four sites in the Worker wrote
 * `err instanceof Error ? err.message : String(err)`, and every non-`Error`
 * throw fell into `String()`. The Anthropic SDK and a parsed JSON body are both
 * plain objects, so the string that reached `scan_job.error`,
 * `research_run.error_message` and the `detail` field on the wire was literally
 * `[object Object]` — persisted, then read back weeks later with no way to
 * recover what actually happened.
 *
 * Every assertion here is therefore of the same shape: **the output is words,
 * and specifically not `[object Object]`, not empty, and not a bare number.**
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeError } from './describe-error.js';

/** The regression itself. Used on every case, because any of them could fall in. */
function assertWorded(said: string) {
  assert.equal(typeof said, 'string');
  assert.ok(said.trim().length > 0, 'must never be empty');
  assert.ok(!said.includes('[object Object]'), `must never say [object Object] — got: ${said}`);
  assert.ok(!/^\d+$/.test(said.trim()), `must never be a bare status — got: ${said}`);
}

describe('describeError — never [object Object], never a bare status', () => {
  it('an ordinary Error keeps its message', () => {
    const said = describeError(new Error('Open Library timed out'));
    assertWorded(said);
    assert.equal(said, 'Open Library timed out');
  });

  it('THE DEFECT: a plain object with a message is read, not stringified', () => {
    // `String({ message: 'overloaded' })` === '[object Object]'.
    const said = describeError({ message: 'The model is overloaded' });
    assertWorded(said);
    assert.ok(said.includes('overloaded'));
  });

  it('THE DEFECT: the Anthropic SDK envelope — { status, error: { message } }', () => {
    // What the vision path actually throws when the API refuses a call.
    const said = describeError({
      status: 529,
      error: { type: 'overloaded_error', message: 'Overloaded' },
    });
    assertWorded(said);
    assert.ok(said.includes('Overloaded'), said);
    assert.ok(said.includes('529'), 'the status is context on the sentence, not the sentence');
  });

  it('a nested cause chain is said, not dropped', () => {
    const outer = new Error('Could not read that photo');
    (outer as { cause?: unknown }).cause = new Error('fetch failed');
    const said = describeError(outer);
    assertWorded(said);
    assert.ok(said.includes('Could not read that photo'));
    assert.ok(said.includes('fetch failed'), 'the real reason lives on .cause');
  });

  it('an Error with an empty message names itself rather than returning nothing', () => {
    const said = describeError(new TypeError(''));
    assertWorded(said);
    assert.ok(/TypeError/.test(said), said);
  });

  it('a bare number becomes a sentence — a naked status is forbidden outright', () => {
    const said = describeError(503);
    assertWorded(said);
    assert.ok(said.includes('503'), 'the code is still there');
    assert.notEqual(said.trim(), '503');
  });

  it('a status-only object says so in words', () => {
    const said = describeError({ status: 502 });
    assertWorded(said);
    assert.ok(/502/.test(said));
    assert.ok(/no message/i.test(said), said);
  });

  it('an object with nothing recognisable still yields its JSON, not [object Object]', () => {
    const said = describeError({ weird: 'shape', n: 3 });
    assertWorded(said);
    assert.ok(said.includes('weird'), said);
  });

  it('an array of zod-ish issues is joined, every one of them said', () => {
    const said = describeError([{ message: 'title is required' }, { message: 'isbn13 is invalid' }]);
    assertWorded(said);
    assert.ok(said.includes('title is required'));
    assert.ok(said.includes('isbn13 is invalid'));
  });

  it('a circular object does not throw and does not come back empty', () => {
    const o: Record<string, unknown> = { status: 500 };
    o.self = o; // JSON.stringify throws on this
    const said = describeError(o);
    assertWorded(said);
  });

  it('null, undefined and the empty string all get a sentence', () => {
    for (const v of [null, undefined, '', '   ']) {
      assertWorded(describeError(v));
    }
  });

  it('a thrown string is passed through unchanged', () => {
    const said = describeError('D1_ERROR: no such table');
    assertWorded(said);
    assert.equal(said, 'D1_ERROR: no such table');
  });

  it('a { error: "code" } body is read rather than stringified', () => {
    const said = describeError({ error: 'rate_limited' });
    assertWorded(said);
    assert.ok(said.includes('rate_limited'));
  });
});
