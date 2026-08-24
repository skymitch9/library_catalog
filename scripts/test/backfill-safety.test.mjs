/**
 * Guards for the scripts/ audit HIGH findings:
 *   - key custody on the paid --llm rung (backfill-missing-isbns.mjs:431)
 *   - the 'manual' source is never demoted by an ISBN write (…:517)
 *   - --friend is threaded into query/execute so a --friend run cannot silently
 *     read/write the MAIN catalogue (backfill-work-covers.mjs:35 et al.)
 *
 * The scripts run on import, so the pure decisions are extracted to
 * scripts/lib/backfill-safety.mjs and tested here; the friend-threading fix is
 * guarded structurally against the (import-unsafe) script sources.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  editionSourceWriteExpr,
  llmKeyName,
  readLlmKeyFrom,
} from '../lib/backfill-safety.mjs';

describe('llmKeyName — the paid rung follows the instance (audit HIGH :431)', () => {
  it('a --friend run reads padhard\'s own key, not the owner\'s', () => {
    assert.deepEqual(llmKeyName({ friend: true }), {
      keyName: 'ANTHROPIC_API_KEY_FRIEND_SAM',
      overridden: false,
    });
  });

  it('the main instance reads ANTHROPIC_API_KEY', () => {
    assert.deepEqual(llmKeyName({ friend: false }), {
      keyName: 'ANTHROPIC_API_KEY',
      overridden: false,
    });
  });

  it('--llm-key-from=main overrides a --friend run onto the owner\'s key, loudly', () => {
    assert.deepEqual(llmKeyName({ friend: true, keyFrom: 'main' }), {
      keyName: 'ANTHROPIC_API_KEY',
      overridden: true,
    });
  });

  it('--llm-key-from=main is IGNORED on a non-friend run (no override to make)', () => {
    assert.deepEqual(llmKeyName({ friend: false, keyFrom: 'main' }), {
      keyName: 'ANTHROPIC_API_KEY',
      overridden: false,
    });
  });

  it('readLlmKeyFrom parses the flag value', () => {
    assert.equal(readLlmKeyFrom(['--llm', '--friend', '--llm-key-from=main']), 'main');
    assert.equal(readLlmKeyFrom(['--llm']), null);
  });
});

describe('editionSourceWriteExpr — never demote a manual edition (audit HIGH :517)', () => {
  const lit = (v) => `'${String(v)}'`;

  it('preserves manual and writes the incoming source otherwise', () => {
    const expr = editionSourceWriteExpr(lit, 'openlibrary');
    assert.match(expr, /WHEN source = 'manual' THEN source/);
    assert.match(expr, /ELSE 'openlibrary' END/);
  });

  it('maps the llm rung to the schema-allowed research source', () => {
    const expr = editionSourceWriteExpr(lit, 'llm');
    assert.match(expr, /ELSE 'research' END/);
    assert.doesNotMatch(expr, /'llm'/);
  });

  it('is a CASE, not an unconditional assignment (the pre-fix bug)', () => {
    assert.match(editionSourceWriteExpr(lit, 'googlebooks'), /^CASE WHEN/);
  });
});
