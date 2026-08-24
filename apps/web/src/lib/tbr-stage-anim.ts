/**
 * Leaf module: the deterministic maths behind the DICE and CARDS spinner
 * stages. No React, no DOM, no `import.meta.env` — pure functions only, so this
 * app's `node:test` suite (which has no DOM and throws the moment a module
 * reaches `import.meta.env`) can pin them. The animated stages in
 * `components/TbrSpinner.tsx` import these; the tests import them directly.
 *
 * ## The one rule these enforce
 *
 * The book is chosen by `pickRandom` in `@lc/core` from a seed; the animation
 * only REVEALS it. So every landing here is a pure function of that same seed —
 * a die settles on one face, a card is drawn from one slot — and the same seed
 * always lands the same way. The flourish can never disagree with the choice
 * because it never makes the choice; it is decoration keyed to the seed the
 * choice already used. This mirrors the wheel, which places the chosen book at
 * `seed % segments` and rotates to bring it under the pointer.
 */

/** A standard six-sided die has faces 1–6; opposite faces sum to 7. */
export const DIE_FACES = 6;

/**
 * The face a die settles on for a spin, derived from its seed alone — `1..6`.
 * Deterministic: the same seed always yields the same face, so the tumble lands
 * the same way every replay. It is cosmetic (a d6 has fewer faces than the pool
 * usually has books), which is exactly why it is kept separate from the pick:
 * the pick decides the book, this decides the theatre.
 */
export function dieFaceForSeed(seed: number): number {
  return (((seed % DIE_FACES) + DIE_FACES) % DIE_FACES) + 1;
}

/**
 * The cube rotation, in degrees, that brings a given face to the front of the
 * viewer. Faces are laid out so opposite faces sum to 7 (1/6, 2/5, 3/4), the
 * physical invariant of a real die, and each entry is the inverse of that
 * face's own placement transform. The stage adds whole extra turns on top for
 * the tumble; a multiple of 360° leaves the resting face unchanged.
 */
export function dieCubeRotation(face: number): { x: number; y: number } {
  switch (face) {
    case 1:
      return { x: 0, y: 0 }; // front
    case 2:
      return { x: 0, y: -90 }; // right
    case 3:
      return { x: -90, y: 0 }; // top
    case 4:
      return { x: 90, y: 0 }; // bottom
    case 5:
      return { x: 0, y: 90 }; // left
    case 6:
      return { x: 0, y: -180 }; // back
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * How many whole extra tumbles a die adds before settling. Zero when the viewer
 * asked for reduced motion — the die then snaps to its resting face with no
 * spin, mirroring the wheel's `turns = reduced ? 0 : …`. Otherwise a
 * seed-derived 3–5, so different spins tumble a different amount.
 */
export function dieTumbleTurns(seed: number, reduced: boolean): number {
  if (reduced) return 0;
  return 3 + (Math.abs(seed) % 3);
}

/**
 * Which slot of a fanned deck the drawn card comes from, `0..count-1`, derived
 * from the seed alone — the cosmetic counterpart of the die's face. Purely which
 * card in the fan lifts and flips; the book it reveals is the pick. Guards a
 * non-positive `count` to slot 0 so an empty fan never indexes out of range.
 */
export function cardDrawSlot(seed: number, count: number): number {
  if (count <= 0) return 0;
  return ((seed % count) + count) % count;
}
