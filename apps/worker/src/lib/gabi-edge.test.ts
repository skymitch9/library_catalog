/**
 * The panel's intensity dial — `GABI_EDGE`, ported from her Discord surface.
 *
 * Owner decision 2026-09-02, verbatim: *"library panel should match gabi in
 * discord no matter what. same experience different entry point"*.
 *
 * ## ⚠️ WHY THIS FILE PINS TEXT, WHICH IS USUALLY A BAD TEST
 *
 * Because the thing that can silently break is not behaviour, it is CONTENT.
 * A prompt block has no runtime, so a paragraph deleted in a merge, an editor
 * "helpfully" collapsing a bullet list, or somebody trimming the floor while
 * keeping the licence all compile, deploy and pass every other test in the repo
 * — and the first evidence would be GABI saying something she should not have.
 * So the four properties below are asserted about the STRING:
 *
 *   1. `standard` is **byte-identical** to the prompt that shipped before this
 *      landed. Turning her down must be one var flip and a deploy, not an
 *      archaeology dig through a diff.
 *   2. `full` appends the block, and the FLOOR is the last thing in it. The
 *      structural argument from `personality.ts` (catalog-platform): the limits
 *      must sit closest to the instruction they qualify. If a later edit moves
 *      the licence after the floor, this fails.
 *   3. The parse **fails OPEN to `full`** — the inverse of Discord's, and the
 *      owner's *"no matter what"*. A typo must not ship the quiet bot.
 *   4. The clauses that are not negotiable by a register are present: the PG-13
 *      ceiling, the real-material rule, the never-touch-a-write rule, and the
 *      anti-formula section. Each is a sentence somebody could plausibly cut as
 *      "wordy", and each is the reason the block is safe to ship at all.
 *
 * ⚠️ **These assertions are deliberately about MEANING-BEARING SUBSTRINGS, not
 * a whole-block hash.** A hash would fail on every wording tweak and would be
 * silenced by deleting it; a named clause fails only when that clause goes.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EDGE_MODES,
  GABI_EDGE_FULL,
  GABI_SYSTEM,
  edgeBlock,
  edgeMode,
  gabiSystemPrompt,
} from '@lc/research';

describe('edgeMode — the parse, and the inversion the owner asked for', () => {
  it('reads the exact string "standard" as standard', () => {
    assert.equal(edgeMode({ GABI_EDGE: 'standard' }), 'standard');
  });

  it('is case- and whitespace-insensitive about it, and nothing else', () => {
    assert.equal(edgeMode({ GABI_EDGE: '  STANDARD  ' }), 'standard');
    assert.equal(edgeMode({ GABI_EDGE: 'Standard' }), 'standard');
  });

  it('⚠️ FAILS OPEN: absent, empty and a typo all read as full', () => {
    // The whole point of the owner's "no matter what". Discord's edgeMode does
    // the opposite and both are correct for their surface — see the headers.
    assert.equal(edgeMode({}), 'full');
    assert.equal(edgeMode({ GABI_EDGE: '' }), 'full');
    assert.equal(edgeMode({ GABI_EDGE: 'standrad' }), 'full');
    assert.equal(edgeMode({ GABI_EDGE: 'off' }), 'full');
    assert.equal(edgeMode({ GABI_EDGE: 'quiet' }), 'full');
  });

  it('reads "full" as full, so the var can be written out explicitly', () => {
    assert.equal(edgeMode({ GABI_EDGE: 'full' }), 'full');
  });

  it('offers exactly two modes', () => {
    assert.deepEqual([...EDGE_MODES], ['standard', 'full']);
  });
});

describe('gabiSystemPrompt — what each posture actually sends', () => {
  it('⚠️ standard is BYTE-IDENTICAL to the core prompt — no stray newline', () => {
    assert.equal(gabiSystemPrompt('standard'), GABI_SYSTEM);
    assert.equal(edgeBlock('standard'), undefined);
  });

  it('full appends the block and changes nothing before it', () => {
    const full = gabiSystemPrompt('full');
    assert.ok(full.startsWith(GABI_SYSTEM), 'the core prompt must be the prefix, unedited');
    assert.equal(full, `${GABI_SYSTEM}${GABI_EDGE_FULL}`);
    assert.equal(edgeBlock('full'), GABI_EDGE_FULL);
  });

  it('⚠️ the FLOOR is the last section — the limits sit closest to the licence', () => {
    const full = gabiSystemPrompt('full');
    const floor = full.indexOf('## ⚠️ THE FLOOR');
    const licence = full.indexOf('## ⚠️ YOUR REGISTER RIGHT NOW: FULL');
    assert.ok(licence > -1 && floor > licence, 'the floor must come after the licence');
    // Nothing may be appended after the floor. If a later section is added it
    // goes ABOVE this one, or the block stops being safe.
    assert.ok(
      full.slice(floor).indexOf('\n## ') === -1,
      'no section may follow the floor',
    );
  });
});

describe('the clauses a register must never be allowed to delete', () => {
  const full = gabiSystemPrompt('full');

  it('states the PG-13 ceiling IN THE BLOCK, not by reference', () => {
    // ⚠️ The single most important adaptation from Discord's copy. There, the
    // ceiling is delegated to the persona block ("the ceiling in your voice
    // note"); there is no persona block here, so a straight port would have
    // shipped a licence pointing at a limit that does not exist.
    assert.match(full, /PG-13 is your ceiling and it does not move/);
    assert.match(full, /Louder is not cruder/);
  });

  it('requires the comedy material to be REAL', () => {
    assert.match(full, /THE MATERIAL HAS TO BE REAL/);
    assert.match(full, /a lie with a punchline stapled to it/);
  });

  it('carries the anti-formula section with all three rules', () => {
    assert.match(full, /NEVER SOUND PREWRITTEN/);
    assert.match(full, /No standing opener/);
    assert.match(full, /Never reuse a skeleton/);
    assert.match(full, /Vary the rhythm/);
  });

  it('⚠️ says the register never touches a write — the panel-only clause', () => {
    // Discord's GABI cannot write, so its floor never needed this. This one can,
    // and "she was being funny" must never become how a confirm lane got skipped.
    assert.match(full, /THE REGISTER NEVER TOUCHES A WRITE/);
    assert.match(full, /a confident joke is not an approval/);
  });

  it('keeps the four floor rules that decide who the joke lands on', () => {
    assert.match(full, /Tease TASTES, CHOICES and FICTIONAL ALLEGIANCES/);
    assert.match(full, /Mirror them/);
    assert.match(full, /Drop it INSTANTLY/);
    assert.match(full, /Content warnings are never comedy/);
  });

  it('keeps the privacy clause aimed at what she WRITES, not at a channel', () => {
    // Adapted, not dropped: the panel is one-to-one, so the public surface is
    // the catalog she writes into rather than a room other people can read.
    assert.match(full, /what you WRITE is not/);
    assert.match(full, /read by the whole household/);
  });
});

describe('the core prompt keeps its own rules under either posture', () => {
  for (const mode of EDGE_MODES) {
    it(`${mode}: the honesty rules are still there`, () => {
      const prompt = gabiSystemPrompt(mode);
      assert.match(prompt, /Every claim about a current value comes from get_book/);
      assert.match(prompt, /An absence from the catalogue is a statement about the CATALOGUE/);
      assert.match(prompt, /Confirm lane/);
      assert.match(prompt, /Never tell somebody they do not own a book/);
    });
  }
});
