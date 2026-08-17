/**
 * The GABI allowlist is DEFAULT-DENY, and phase 0 is READ-ONLY.
 *
 * Two different failures, and neither test can see the other's:
 *
 *   1. **The allowlist stops being the allowlist.** A definition without a name,
 *      a name without a definition, a duplicate, a capability string that names
 *      no row in `CAPABILITY_MATRIX`. Each of those turns "the array is the one
 *      source of truth" into a comment.
 *   2. ⚠️ **A write tool arrives.** The design's §9 ships the loop before it
 *      ships any writer, and the whole point of phase 0 is that the conversation,
 *      the wording and the disambiguation UX are proved *with zero write risk*.
 *      Adding `set_book_details` to the array is one line, it typechecks, and
 *      nothing else in the repo would notice. **This file is what notices.**
 *
 * The style is the repo's own — `capability-wiring.test.ts` reads the refusal
 * off the wire rather than trusting a constant, and `details-sweep.test.ts`
 * reads `wrangler.toml` rather than restating the cron. Both ideas appear here:
 * the batch cap is compared against `routes/research.ts`'s own literal rather
 * than against a number typed twice.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  CAPABILITY_MATRIX,
  GABI_BATCH_CAP,
  GABI_MAX_TURNS,
  GABI_PHASE,
  GABI_TOOLS,
  GABI_TOOL_NAMES,
  gabiPanelEnabled,
  gabiToolByName,
  isGabiToolName,
} from '../src/index.js';

/** The seven writers §4.2 designs. None of them may exist yet. */
const PHASE_1_PLUS_TOOLS = [
  'research_book',
  'set_book_details',
  'record_gap_verdict',
  'undo_changes',
  'list_cover_candidates',
  'set_cover_from_url',
  'mark_cover_wrong',
];

/** The routes §4.3 excludes STRUCTURALLY. None of these is ever a tool. */
const NEVER_A_TOOL = [
  'delete_work',
  'delete_edition',
  'delete_copy',
  'delete_cover',
  'set_title',
  'set_authors',
  'create_work',
  'set_user_role',
  'scan_shelf',
  'export_catalog',
];

describe('the allowlist and the definitions are one thing', () => {
  it('every allowlisted name has exactly one definition', () => {
    for (const name of GABI_TOOL_NAMES) {
      const matches = GABI_TOOLS.filter((t) => t.name === name);
      assert.equal(matches.length, 1, `'${name}' has ${matches.length} definitions, expected 1`);
    }
  });

  it('no definition exists for a name that is not allowlisted', () => {
    for (const tool of GABI_TOOLS) {
      assert.ok(
        (GABI_TOOL_NAMES as readonly string[]).includes(tool.name),
        `'${tool.name}' has a definition but is not in GABI_TOOL_NAMES — the array is the allowlist`,
      );
    }
  });

  it('the two lists are the same length, so neither can quietly grow', () => {
    assert.equal(GABI_TOOLS.length, GABI_TOOL_NAMES.length);
  });
});

describe('⚠️ PHASE 0 IS READ-ONLY — a write tool must fail this file', () => {
  it('declares itself phase 0', () => {
    assert.equal(GABI_PHASE, 0, 'GABI_PHASE moved — the invariants below are phase-0 invariants');
  });

  it('no tool may mutate the catalog', () => {
    const writers = GABI_TOOLS.filter((t) => t.mutates).map((t) => t.name);
    assert.deepEqual(
      writers,
      [],
      `phase 0 has no writers, but these declare mutates: ${writers.join(', ')}. ` +
        'Shipping a write tool is a PHASE change: it needs the confirm lane (§6), the ' +
        'provenance stamp (§5.2) and its own tests — not a line in an array.',
    );
  });

  it('no tool may reach a method that can change anything', () => {
    for (const tool of GABI_TOOLS) {
      assert.deepEqual(
        [...tool.methods],
        ['GET'],
        `'${tool.name}' declares ${tool.methods.join('/')} — phase 0 executors issue GET and nothing else`,
      );
    }
  });

  it('every tool rides a route gated on `read`, the loosest capability there is', () => {
    // Not decoration: `list_cover_candidates` is a GET that the route gates on
    // `editCatalog`, so "it is a GET" is NOT the same statement as "it cannot
    // write". Both are asserted, separately, on purpose.
    for (const tool of GABI_TOOLS) {
      assert.equal(
        tool.capability,
        'read',
        `'${tool.name}' rides a '${tool.capability}' route — phase 0 is read-only`,
      );
    }
  });

  it('none of phase 1+’s write tools has slipped into the allowlist', () => {
    for (const name of PHASE_1_PLUS_TOOLS) {
      assert.equal(
        isGabiToolName(name),
        false,
        `'${name}' is allowlisted, but it is a WRITE tool from a later phase (design §9)`,
      );
      assert.equal(gabiToolByName(name), null);
    }
  });

  it('nothing §4.3 excludes structurally is reachable, in any phase', () => {
    // ⚠️ These never become tools — not in phase 1, not ever. Deletes are the one
    // write `revertFinding` cannot undo; `title`/`authors` re-derive `work_key`
    // and need a Firestore attestation the Worker structurally cannot make.
    for (const name of NEVER_A_TOOL) {
      assert.equal(isGabiToolName(name), false, `'${name}' is reachable — §4.3 excludes it`);
    }
  });
});

describe('default-deny means junk is refused, not coerced', () => {
  it('refuses the empty string, whitespace and case variants', () => {
    for (const junk of ['', ' ', 'FIND_BOOK', 'find_book ', ' find_book']) {
      assert.equal(isGabiToolName(junk), false, `'${junk}' was admitted`);
    }
  });

  it('refuses non-strings without throwing — the model can send anything', () => {
    for (const junk of [null, undefined, 42, {}, [], { name: 'find_book' }, true]) {
      assert.equal(isGabiToolName(junk), false);
      assert.equal(gabiToolByName(junk), null);
    }
  });

  it('refuses inherited Object keys — the classic allowlist hole', () => {
    // A `Record`-based lookup would answer truthily for these. An array does not,
    // and this is the test that keeps it an array.
    for (const key of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      assert.equal(isGabiToolName(key), false, `'${key}' got through`);
      assert.equal(gabiToolByName(key), null);
    }
  });
});

describe('the definitions are shapes the API and the executor can both use', () => {
  it('every capability names a real row in CAPABILITY_MATRIX', () => {
    for (const tool of GABI_TOOLS) {
      assert.ok(
        tool.capability in CAPABILITY_MATRIX,
        `'${tool.name}' claims capability '${tool.capability}', which is not in CAPABILITY_MATRIX`,
      );
    }
  });

  it('every schema is closed — additionalProperties: false, always', () => {
    // The wrapper builds its request from a fixed field list (§4.2), so an open
    // schema would not by itself be a hole. It would still be a model inventing
    // arguments nothing reads, which is the shape of a silent no-op.
    for (const tool of GABI_TOOLS) {
      assert.equal(tool.input_schema.type, 'object');
      assert.equal(
        tool.input_schema.additionalProperties,
        false,
        `'${tool.name}' has an open input schema`,
      );
    }
  });

  it('every required key is a declared property', () => {
    for (const tool of GABI_TOOLS) {
      for (const key of tool.input_schema.required) {
        assert.ok(
          key in tool.input_schema.properties,
          `'${tool.name}' requires '${key}', which it does not declare`,
        );
      }
    }
  });

  it('every property carries a description — the model reads these, not the names', () => {
    for (const tool of GABI_TOOLS) {
      for (const [key, prop] of Object.entries(tool.input_schema.properties)) {
        assert.ok(prop.description?.length > 10, `'${tool.name}.${key}' has no real description`);
      }
    }
  });

  it('every description says WHEN to call, not just what the tool is', () => {
    // Recent models reach for tools conservatively; a trigger condition in the
    // description is what lifts should-call rate. Cheap proxy, deliberately: the
    // word "Call this" (or "call it") appears in every one.
    for (const tool of GABI_TOOLS) {
      assert.match(
        tool.description,
        /call (this|it)/i,
        `'${tool.name}' describes itself but never says when to reach for it`,
      );
    }
  });
});

describe('the two ceilings', () => {
  it('the turn ceiling is a real number the route can refuse past', () => {
    assert.ok(Number.isInteger(GABI_MAX_TURNS) && GABI_MAX_TURNS > 0);
  });

  it('⚠️ the batch cap equals POST /research/undo’s own cap, read from its source', () => {
    // Design §6.3: "A batch you cannot undo in one action is a batch that should
    // not be one action." The number is only meaningful while the two agree, so
    // this reads the route rather than restating 10 in a second place. If the
    // undo cap ever moves, this goes red and somebody decides on purpose.
    const research = readFileSync(
      fileURLToPath(new URL('../../../apps/worker/src/routes/research.ts', import.meta.url).href),
      'utf8',
    );
    const match = research.match(/if \(ids\.length > (\d+)\)/);
    assert.ok(match, 'routes/research.ts no longer caps the undo list the way §6.3 assumes');
    assert.equal(
      GABI_BATCH_CAP,
      Number(match[1]),
      `GABI_BATCH_CAP is ${GABI_BATCH_CAP} but POST /research/undo caps at ${match[1]} — ` +
        'a batch GABI can make but cannot take back',
    );
  });
});

describe('the panel posture: unset is OFF, and so is anything unrecognised', () => {
  it('is on only for the exact word', () => {
    for (const on of ['on', 'ON', ' On ', 'On']) {
      assert.equal(gabiPanelEnabled(on), true, `'${on}' should enable the panel`);
    }
  });

  it('⚠️ fails CLOSED for unset, empty, garbage and near-misses', () => {
    // The feature is her instance only (§2) and the route spends her key's
    // money. A typo in a var must never switch it on somewhere it was not meant
    // to be — the same failure direction `resolveDefaultRole` and the estate
    // mode parser both take.
    for (const off of [undefined, null, '', '   ', 'off', 'true', '1', 'yes', 'enabled', 'onn']) {
      assert.equal(gabiPanelEnabled(off), false, `'${String(off)}' should NOT enable the panel`);
    }
  });
});
