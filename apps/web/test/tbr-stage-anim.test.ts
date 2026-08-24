/**
 * The dice/cards stage landing maths (`src/lib/tbr-stage-anim.ts`).
 *
 * These pin the one property a spinner-with-pizzazz must not break: the
 * animation is a pure function of the SEED, so the die and the drawn card land
 * the same way every replay — the flourish can never disagree with the pick,
 * because it never makes the pick. Determinism is checked by re-running the same
 * seed and by spreading `nextSeed`, never by sampling `Math.random` (that would
 * assert against a different definition of random than the app ships).
 *
 * ⚠️ These functions are in `src/lib/` and free of React / `import.meta.env` on
 * purpose: this app's tests run under `node:test` with no DOM, so anything that
 * reached the component graph would throw before an assertion could run — the
 * same reason `duplicates-view.ts` and `residue-sentence.ts` are libraries.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { nextSeed } from '@lc/core';

import {
  DIE_FACES,
  cardDrawSlot,
  dieCubeRotation,
  dieFaceForSeed,
  dieTumbleTurns,
} from '../src/lib/tbr-stage-anim.js';

const SEED = 1234567;

describe('dieFaceForSeed — the die lands where the seed already decided', () => {
  it('is deterministic: the same seed always lands the same face', () => {
    assert.equal(dieFaceForSeed(SEED), dieFaceForSeed(SEED));
  });

  it('is always a real face, 1..6, across a spread of seeds (incl. negative)', () => {
    let s = SEED;
    for (let n = 0; n < 200; n++) {
      const f = dieFaceForSeed(s);
      assert.ok(Number.isInteger(f) && f >= 1 && f <= DIE_FACES, `face out of range: ${f}`);
      s = nextSeed(s);
    }
    // Negative seeds must not produce a 0 or a 7 (the classic modulo-sign bug).
    for (const neg of [-1, -6, -7, -12345]) {
      const f = dieFaceForSeed(neg);
      assert.ok(f >= 1 && f <= DIE_FACES, `negative seed ${neg} gave ${f}`);
    }
  });

  it('reaches more than one face across seeds — not stuck on a constant', () => {
    const seen = new Set<number>();
    let s = SEED;
    for (let n = 0; n < 40; n++) {
      seen.add(dieFaceForSeed(s));
      s = nextSeed(s);
    }
    assert.ok(seen.size > 1, `expected several faces, got ${[...seen]}`);
  });
});

describe('dieCubeRotation — opposite faces sum to 7, so the cube is a real die', () => {
  it('brings face 1 to the front with no rotation', () => {
    assert.deepEqual(dieCubeRotation(1), { x: 0, y: 0 });
  });

  it('every face maps to a defined rotation', () => {
    for (let f = 1; f <= DIE_FACES; f++) {
      const r = dieCubeRotation(f);
      assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y));
    }
  });

  it('opposite faces (summing to 7) are 180° apart on one axis', () => {
    // 1↔6 differ by 180° about Y; 3↔4 differ by 180° about X; 2↔5 about Y.
    assert.equal(dieCubeRotation(6).y - dieCubeRotation(1).y, -180);
    assert.equal(dieCubeRotation(4).x - dieCubeRotation(3).x, 180);
    assert.equal(dieCubeRotation(5).y - dieCubeRotation(2).y, 180);
  });
});

describe('dieTumbleTurns — motion off under reduced motion, seed-varied otherwise', () => {
  it('contributes zero turns when reduced motion is asked for', () => {
    let s = SEED;
    for (let n = 0; n < 20; n++) {
      assert.equal(dieTumbleTurns(s, true), 0);
      s = nextSeed(s);
    }
  });

  it('is a positive whole number of turns otherwise', () => {
    let s = SEED;
    for (let n = 0; n < 40; n++) {
      const t = dieTumbleTurns(s, false);
      assert.ok(Number.isInteger(t) && t >= 3 && t <= 5, `turns out of band: ${t}`);
      s = nextSeed(s);
    }
  });
});

describe('cardDrawSlot — the drawn card is a deterministic slot of the fan', () => {
  it('is deterministic for the same seed and count', () => {
    assert.equal(cardDrawSlot(SEED, 5), cardDrawSlot(SEED, 5));
  });

  it('always indexes inside the fan, 0..count-1, incl. negative seeds', () => {
    for (const count of [1, 3, 5, 8]) {
      let s = SEED;
      for (let n = 0; n < 100; n++) {
        const slot = cardDrawSlot(s, count);
        assert.ok(slot >= 0 && slot < count, `slot ${slot} out of 0..${count - 1}`);
        s = nextSeed(s);
      }
      assert.ok(cardDrawSlot(-99999, count) >= 0);
    }
  });

  it('guards a non-positive count to slot 0 rather than NaN', () => {
    assert.equal(cardDrawSlot(SEED, 0), 0);
    assert.equal(cardDrawSlot(SEED, -3), 0);
  });
});
