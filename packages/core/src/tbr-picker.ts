/**
 * Leaf module: the **random TBR picker** — pick one book to read next from a
 * person's to-be-read list, deterministically given a seed.
 *
 * No I/O, no dependency on `index.ts` (see CLAUDE.md). It knows nothing about
 * Firestore, D1 or React: it is handed an array of {@link PickableItem} — the
 * live `TbrPage` maps its rows onto that shape — and answers which one to read.
 *
 * ## Why a seed, and why only ONE generator
 *
 * The owner's ask is a spinner with pizzazz, and a spinner has to be able to
 * land on a *known* result: the wheel animates towards the book {@link
 * pickRandom} already chose, it does not choose as it stops. So the choice is a
 * pure function of `(items, filters, seed)` — the same three inputs always
 * yield the same book — and a **reroll is a new seed**, produced by {@link
 * nextSeed} so that even the "randomness" comes from this one generator and
 * never from `Math.random`. One seeded implementation, exercised by the tests
 * below; a second RNG anywhere would be a second definition of "random" that
 * could drift from this one.
 *
 * ## Format-gating is not a filter — it is a floor
 *
 * The estate rule is *don't surface a book the person can't open*. An item
 * whose `openable` is explicitly `false` is removed **before** any filter runs
 * and can never be picked, whatever the caller asks for. The TBR already
 * carries the format, so the page decides openability; this module only obeys
 * it. Everything else — format, hardcover, series position, owned/wishlist — is
 * an ordinary, optional filter the person toggles.
 */

/**
 * The medium an item is in. `audio` books live in the sibling audiobook
 * catalog; `physical` and `ebook` are the two media THIS catalog holds
 * (`EDITION_MEDIA` in `constants.ts`). Kept as a local union rather than
 * importing so this stays a zero-dependency leaf.
 */
export type PickerFormat = 'audio' | 'physical' | 'ebook';

/** How the household came by the book — a held copy, or an aspiration. */
export type PickerAcquisition = 'owned' | 'wishlist';

/**
 * One candidate the picker can choose from, reduced to only the axes a filter
 * reads. The live page builds these out of its TBR rows; a test builds them by
 * hand. Every axis except `id` is optional and may be `null` when the data does
 * not say — an unknown value simply fails the filters that need it, rather than
 * guessing.
 */
export interface PickableItem {
  /**
   * Stable identity — the Firestore `docId` in practice. It is what
   * `excludeId` (exclude-last-rerolled) matches on, and what the pick is
   * ordered by so the choice does not depend on array order.
   */
  id: string;
  /** The medium, when known. */
  format?: PickerFormat | null;
  /** Whether a hardcover printing exists for this book. `null` when unknown. */
  hardcover?: boolean | null;
  /** Series name, or `null`/absent for a standalone. */
  series?: string | null;
  /**
   * Volume number within the series: `1` is the first, anything `> 1` is a
   * continuation. `null` when the book is a standalone or the position is
   * unknown.
   */
  seriesIndex?: number | null;
  /** A held copy (`owned`) versus something still to acquire (`wishlist`). */
  acquisition?: PickerAcquisition | null;
  /**
   * Format-gating. Defaults to openable — only an explicit `false` gates the
   * item out, and it is gated out unconditionally, before any filter. See the
   * module header.
   */
  openable?: boolean;
}

/**
 * What the person has toggled. Every field is optional; an omitted or `null`
 * field means "do not filter on this axis". They compose with AND — an item
 * must pass every active filter.
 */
export interface PickFilters {
  /** Keep only items in this medium. */
  format?: PickerFormat | null;
  /**
   * `'only'` keeps items that ARE a hardcover (`hardcover === true`).
   * `'exclude'` keeps everything that is NOT known to be a hardcover — i.e.
   * `hardcover !== true`, so a book of unknown printing survives a
   * no-hardcover filter rather than being dropped on a guess.
   */
  hardcover?: 'only' | 'exclude' | null;
  /**
   * `'first'` keeps only first-in-series volumes (`seriesIndex === 1`).
   * `'continuation'` keeps only later volumes of a series a person is already
   * into (`series` present and `seriesIndex > 1`). A standalone passes
   * neither.
   */
  series?: 'first' | 'continuation' | null;
  /** Keep only owned copies, or only wishlist entries. */
  acquisition?: PickerAcquisition | null;
  /**
   * Exclude-last-rerolled: the id of the book the previous spin landed on, so a
   * reroll cannot hand back the same book while any other candidate exists.
   */
  excludeId?: string | null;
}

/** The outcome of one spin. */
export interface PickResult<T extends PickableItem> {
  /**
   * The chosen book, or `null` when nothing survived gating + filtering. A
   * `null` with `total > 0` is the worded empty state's cue: there ARE books,
   * the filters just matched none of them.
   */
  item: T | null;
  /** The seed this pick used. Pass {@link nextSeed} of it to reroll. */
  seed: number;
  /** How many candidates the pick actually drew from (after gating + filters). */
  pool: number;
  /** How many items were handed in, before anything was removed. */
  total: number;
}

/**
 * The one seeded generator. A 32-bit `mulberry32` step: same seed in, same
 * float in `[0, 1)` out. It is deliberately the ONLY source of randomness in
 * this module — {@link pickRandom} draws its index from it and {@link nextSeed}
 * advances it, so the whole feature has a single, testable definition of
 * "random".
 */
function unitFloat(seed: number): number {
  let a = seed | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The next seed in the sequence — what a reroll uses. Derived from the same
 * `mulberry32` state as {@link unitFloat}, so "give me another" never reaches
 * for a second RNG. Deterministic: `nextSeed(s)` is always the same for a given
 * `s`, which keeps a replay of a session of spins reproducible.
 */
export function nextSeed(seed: number): number {
  let a = seed | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

/** Does this item pass every active filter? Gating is handled separately. */
function matchesFilters(item: PickableItem, filters: PickFilters): boolean {
  if (filters.format != null && item.format !== filters.format) return false;

  if (filters.hardcover === 'only' && item.hardcover !== true) return false;
  if (filters.hardcover === 'exclude' && item.hardcover === true) return false;

  if (filters.series === 'first' && item.seriesIndex !== 1) return false;
  if (
    filters.series === 'continuation' &&
    !(item.series != null && typeof item.seriesIndex === 'number' && item.seriesIndex > 1)
  ) {
    return false;
  }

  if (filters.acquisition != null && item.acquisition !== filters.acquisition) return false;

  if (filters.excludeId != null && item.id === filters.excludeId) return false;

  return true;
}

/**
 * Pick one book to read next.
 *
 * 1. **Gate** — drop anything explicitly `openable: false` (the estate's
 *    format-gating floor), unconditionally.
 * 2. **Filter** — keep the items passing every active {@link PickFilters} axis.
 * 3. **Order** — sort the survivors by `id`, so the choice depends only on the
 *    SET of candidates and the seed, never on the order they arrived in.
 * 4. **Draw** — take the item at `floor(unitFloat(seed) * pool)`.
 *
 * Returns `item: null` when the pool is empty; the caller distinguishes "no TBR
 * at all" (`total === 0`) from "filters matched nothing" (`total > 0`) for its
 * worded empty state. Purely functional — no argument is mutated.
 */
export function pickRandom<T extends PickableItem>(
  items: readonly T[],
  filters: PickFilters,
  seed: number,
): PickResult<T> {
  const total = items.length;

  // Format-gating first, and on its own: a book the person cannot open is not a
  // candidate for any filter combination.
  const openable = items.filter((i) => i.openable !== false);
  const pool = openable.filter((i) => matchesFilters(i, filters));

  if (pool.length === 0) return { item: null, seed, pool: 0, total };

  const ordered = [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // `index` is always in range — `ordered.length > 0` here and `unitFloat` is
  // in `[0, 1)` — but the checked-index compiler setting cannot prove it, so we
  // clamp to the last element rather than assert non-null.
  const index = Math.min(ordered.length - 1, Math.floor(unitFloat(seed) * ordered.length));
  return { item: ordered[index] ?? null, seed, pool: ordered.length, total };
}
