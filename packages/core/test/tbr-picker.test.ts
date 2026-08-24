/**
 * The random TBR picker (`packages/core/src/tbr-picker.ts`).
 *
 * These pin the two things a spinner-with-pizzazz must not get wrong: the
 * choice is a pure function of `(items, filters, seed)` — so the wheel can
 * animate towards a result already decided — and every filter, plus the
 * format-gating floor, removes exactly what it claims to and nothing else.
 *
 * ⚠️ There is ONE seeded generator. A test that reached for `Math.random`
 * would be asserting against a different definition of random than the code
 * ships; determinism is checked by re-running the same seed, never by sampling.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextSeed, pickRandom, type PickableItem } from '../src/tbr-picker.js';

/** A tiny helper so each fixture only spells out the axis it is testing. */
function item(id: string, extra: Partial<PickableItem> = {}): PickableItem {
  return { id, ...extra };
}

const SEED = 1234567;

describe('pickRandom — determinism (the wheel lands where the pick already chose)', () => {
  const items = [item('a'), item('b'), item('c'), item('d'), item('e')];

  it('returns the SAME book for the same items, filters and seed', () => {
    const first = pickRandom(items, {}, SEED);
    const second = pickRandom(items, {}, SEED);
    assert.equal(first.item?.id, second.item?.id);
    assert.equal(first.seed, SEED);
  });

  it('does not depend on the order the items arrive in', () => {
    const shuffled = [items[3], items[0], items[4], items[1], items[2]];
    assert.equal(pickRandom(items, {}, SEED).item?.id, pickRandom(shuffled, {}, SEED).item?.id);
  });

  it('a different seed can land on a different book (reroll = new seed)', () => {
    // Across a spread of seeds the picker must reach more than one book — a
    // generator stuck on one index would pass every other test here.
    const landed = new Set<string>();
    let s = SEED;
    for (let n = 0; n < 40; n++) {
      landed.add(pickRandom(items, {}, s).item!.id);
      s = nextSeed(s);
    }
    assert.ok(landed.size > 1, `expected several distinct books, got ${[...landed]}`);
  });

  it('always picks an item that is actually in the pool', () => {
    let s = SEED;
    for (let n = 0; n < 50; n++) {
      const { item: picked } = pickRandom(items, {}, s);
      assert.ok(items.some((i) => i.id === picked!.id));
      s = nextSeed(s);
    }
  });

  it('nextSeed is itself deterministic — a replay of spins reproduces', () => {
    assert.equal(nextSeed(SEED), nextSeed(SEED));
    assert.notEqual(nextSeed(SEED), SEED);
  });
});

describe('pickRandom — the empty / worded states', () => {
  it('reports item null and total 0 for an empty list', () => {
    const r = pickRandom([], {}, SEED);
    assert.equal(r.item, null);
    assert.equal(r.total, 0);
    assert.equal(r.pool, 0);
  });

  it('distinguishes "filters matched nothing" (total > 0, pool 0) from an empty list', () => {
    const items = [item('a', { format: 'audio' }), item('b', { format: 'audio' })];
    const r = pickRandom(items, { format: 'physical' }, SEED);
    assert.equal(r.item, null);
    assert.equal(r.pool, 0);
    assert.equal(r.total, 2); // there ARE books; the filter is what emptied the pool
  });
});

describe('pickRandom — format-gating is a floor, not a filter', () => {
  it('never surfaces a book the person cannot open, even as the only candidate', () => {
    const only = [item('locked', { openable: false })];
    const r = pickRandom(only, {}, SEED);
    assert.equal(r.item, null);
    assert.equal(r.total, 1); // it was handed in…
    assert.equal(r.pool, 0); // …and gated out before any filter
  });

  it('gates out the unopenable book across every seed', () => {
    const items = [item('open'), item('locked', { openable: false })];
    let s = SEED;
    for (let n = 0; n < 30; n++) {
      assert.equal(pickRandom(items, {}, s).item?.id, 'open');
      s = nextSeed(s);
    }
  });

  it('treats a missing openable flag as openable', () => {
    const r = pickRandom([item('a')], {}, SEED);
    assert.equal(r.item?.id, 'a');
  });
});

describe('pickRandom — the format filter', () => {
  const items = [
    item('audio1', { format: 'audio' }),
    item('phys1', { format: 'physical' }),
    item('ebook1', { format: 'ebook' }),
    item('phys2', { format: 'physical' }),
  ];

  for (const format of ['audio', 'physical', 'ebook'] as const) {
    it(`keeps only ${format} across every seed`, () => {
      let s = SEED;
      for (let n = 0; n < 30; n++) {
        assert.equal(pickRandom(items, { format }, s).item?.format, format);
        s = nextSeed(s);
      }
    });
  }

  it('pools exactly the matching count', () => {
    assert.equal(pickRandom(items, { format: 'physical' }, SEED).pool, 2);
  });
});

describe('pickRandom — the hardcover ⟷ no-hardcover filter', () => {
  const items = [
    item('hc', { hardcover: true }),
    item('pb', { hardcover: false }),
    item('unknown', { hardcover: null }),
  ];

  it("'only' keeps just the hardcover", () => {
    const r = pickRandom(items, { hardcover: 'only' }, SEED);
    assert.equal(r.pool, 1);
    assert.equal(r.item?.id, 'hc');
  });

  it("'exclude' drops the hardcover and keeps the rest — unknown printings survive", () => {
    const r = pickRandom(items, { hardcover: 'exclude' }, SEED);
    assert.equal(r.pool, 2);
    let s = SEED;
    for (let n = 0; n < 20; n++) {
      assert.notEqual(pickRandom(items, { hardcover: 'exclude' }, s).item?.id, 'hc');
      s = nextSeed(s);
    }
  });
});

describe('pickRandom — first-in-series-only', () => {
  const items = [
    item('firstA', { series: 'Stormlight', seriesIndex: 1 }),
    item('secondA', { series: 'Stormlight', seriesIndex: 2 }),
    item('firstB', { series: 'Reckoners', seriesIndex: 1 }),
    item('standalone', { series: null, seriesIndex: null }),
  ];

  it('keeps only volume 1 of a series', () => {
    const r = pickRandom(items, { series: 'first' }, SEED);
    assert.equal(r.pool, 2);
    let s = SEED;
    for (let n = 0; n < 20; n++) {
      assert.equal(pickRandom(items, { series: 'first' }, s).item?.seriesIndex, 1);
      s = nextSeed(s);
    }
  });

  it('a standalone is not a first-in-series', () => {
    const only = [item('standalone', { series: null, seriesIndex: null })];
    assert.equal(pickRandom(only, { series: 'first' }, SEED).item, null);
  });
});

describe('pickRandom — series-continuation-only', () => {
  const items = [
    item('first', { series: 'Stormlight', seriesIndex: 1 }),
    item('second', { series: 'Stormlight', seriesIndex: 2 }),
    item('third', { series: 'Stormlight', seriesIndex: 3 }),
    item('standalone', { series: null, seriesIndex: null }),
  ];

  it('keeps only later volumes of a series a person is already into', () => {
    const r = pickRandom(items, { series: 'continuation' }, SEED);
    assert.equal(r.pool, 2);
    let s = SEED;
    for (let n = 0; n < 20; n++) {
      const picked = pickRandom(items, { series: 'continuation' }, s).item!;
      assert.ok(picked.seriesIndex! > 1 && picked.series != null);
      s = nextSeed(s);
    }
  });

  it('excludes the first volume and standalones', () => {
    const edge = [
      item('first', { series: 'X', seriesIndex: 1 }),
      item('lonely', { series: null, seriesIndex: 5 }), // index but no series → not a continuation
    ];
    assert.equal(pickRandom(edge, { series: 'continuation' }, SEED).item, null);
  });
});

describe('pickRandom — owned vs wishlist', () => {
  const items = [
    item('own1', { acquisition: 'owned' }),
    item('own2', { acquisition: 'owned' }),
    item('wish1', { acquisition: 'wishlist' }),
  ];

  it('keeps only owned copies', () => {
    let s = SEED;
    for (let n = 0; n < 20; n++) {
      assert.equal(pickRandom(items, { acquisition: 'owned' }, s).item?.acquisition, 'owned');
      s = nextSeed(s);
    }
    assert.equal(pickRandom(items, { acquisition: 'owned' }, SEED).pool, 2);
  });

  it('keeps only wishlist entries', () => {
    const r = pickRandom(items, { acquisition: 'wishlist' }, SEED);
    assert.equal(r.pool, 1);
    assert.equal(r.item?.id, 'wish1');
  });
});

describe('pickRandom — exclude-last-rerolled', () => {
  const items = [item('a'), item('b'), item('c')];

  it('a reroll never hands back the last book while another candidate exists', () => {
    let s = SEED;
    let last = pickRandom(items, {}, s).item!.id;
    for (let n = 0; n < 40; n++) {
      s = nextSeed(s);
      const next = pickRandom(items, { excludeId: last }, s).item!;
      assert.notEqual(next.id, last);
      last = next.id;
    }
  });

  it('excluding the only remaining book yields the worded empty state, not a repeat', () => {
    const one = [item('solo')];
    const r = pickRandom(one, { excludeId: 'solo' }, SEED);
    assert.equal(r.item, null);
    assert.equal(r.total, 1);
    assert.equal(r.pool, 0);
  });
});

describe('pickRandom — filters compose with AND', () => {
  const items = [
    item('a', { format: 'physical', series: 'S', seriesIndex: 1, acquisition: 'owned' }),
    item('b', { format: 'physical', series: 'S', seriesIndex: 2, acquisition: 'owned' }),
    item('c', { format: 'ebook', series: 'S', seriesIndex: 1, acquisition: 'owned' }),
    item('d', { format: 'physical', series: 'S', seriesIndex: 1, acquisition: 'wishlist' }),
  ];

  it('an item must pass every active filter at once', () => {
    const r = pickRandom(
      items,
      { format: 'physical', series: 'first', acquisition: 'owned' },
      SEED,
    );
    assert.equal(r.pool, 1);
    assert.equal(r.item?.id, 'a');
  });
});
