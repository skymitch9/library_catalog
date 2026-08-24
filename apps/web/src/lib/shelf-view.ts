/**
 * "On your shelf" — the hero holding and the availability row, derived once,
 * WITHOUT a DOM or firebase, so it can be exercised by `node --test`.
 *
 * This is the `deriveWorkView` / `buildVersionEntries` pattern the repo already
 * uses: a pure function whose output a test pins, and a thin component
 * (`OnYourShelf.tsx`) that only renders it. The redesign hoists this to the top
 * of the work page — the one thing a person asks a book page ("what do I have,
 * and where else can I get it?") — so the logic that answers it earns a test of
 * its own rather than living inline in the page.
 *
 * ⚠️ **No new response fields.** Everything here is derived from data the
 * `/api/works/:id` response already carries (copies, editions, the audiobook /
 * ebook / peer holdings). The work-detail contract test (`work-detail-contract.
 * test.ts`) is unaffected because `deriveWorkView` reads no new `detail.` field.
 *
 * ⚠️ **The special-edition badges are DERIVED from existing prose, not from new
 * columns.** Only `copy.is_signed` is a real boolean today. "Sprayed edges",
 * "Leatherbound" and "Slipcase" live as free text in `edition.edition_name`
 * (see `EditionForm`'s placeholder — *"Slipcased", "Signed and numbered"*), so
 * they are read back out of that text here. Making them first-class editable
 * toggles needs a migration and is deliberately deferred; surfacing what is
 * already recorded needs neither.
 */
import type { WorkAudioEdition, WorkAudiobookHolding, WorkEbookHolding } from '../api.js';
import type { CopyView } from '../components/Copies.js';
import type { EditionView } from '../components/Editions.js';
import type { PeerHoldingView } from '../components/PeerLibraries.js';
import { formatLabel, isPhysicalFormat } from './formats.js';

/** The statuses that mean the household physically holds (or held) the book. */
const HELD_STATUSES = ['owned', 'borrowed', 'lent'] as const;
/** Preference order for which held copy becomes the hero — the one you own wins. */
const HERO_PRIORITY: Record<string, number> = { owned: 0, borrowed: 1, lent: 2 };

export interface SpecialEditionBadge {
  key: string;
  label: string;
  title: string;
}

export interface ShelfHero {
  /** The copy status, or null when the hero is inferred from editions (no copy row). */
  status: string | null;
  /** The big format word — "Hardcover", "EPUB", "Audiobook" — or null when unknown. */
  format: string | null;
  /** Coarse medium, for the chip colour. */
  medium: 'physical' | 'ebook' | 'audio' | null;
  badges: SpecialEditionBadge[];
  location: string | null;
  condition: string | null;
  /** Held copies beyond the hero — "and 1 more copy". */
  otherHeldCount: number;
}

export interface ShelfAvailability {
  /** In the sibling audiobook library — with the count of recordings held. Null when none. */
  audio: { count: number } | null;
  /** In the shared ebook pool (live holding). */
  ebook: boolean;
  /** Peer libraries (e.g. Padhard) that also hold it. */
  peers: PeerHoldingView[];
}

export interface ShelfView {
  hero: ShelfHero | null;
  availability: ShelfAvailability;
  /** True when there is anything at all to show — the panel renders only then. */
  hasAnything: boolean;
}

/**
 * The special-edition badges for one held copy and its linked printing.
 *
 * `is_signed` is the one real boolean; the rest are read out of the edition's
 * own words. Leatherbound implies hardcover (the owner's data-model note), which
 * is why it is a badge in its own right rather than a format.
 */
export function specialEditionBadges(
  copy: CopyView | null,
  edition: EditionView | null,
): SpecialEditionBadge[] {
  const badges: SpecialEditionBadge[] = [];
  if (copy?.is_signed) {
    badges.push({ key: 'signed', label: 'Signed', title: 'A signed copy' });
  }
  // The prose the shop used, plus the canonical kind — both are scanned so a
  // "Collector's edition" whose name says "leatherbound" still lights the badge.
  const prose = [edition?.edition_name, edition?.edition_kind].filter(Boolean).join(' ').toLowerCase();
  if (/spray|sprayed[- ]?edge|sprededge/.test(prose)) {
    badges.push({ key: 'sprayed', label: 'Sprayed edges', title: 'Coloured/sprayed page edges' });
  }
  if (/leather/.test(prose)) {
    badges.push({ key: 'leather', label: 'Leatherbound', title: 'A leatherbound hardcover' });
  }
  if (/slip[- ]?case|slipcased/.test(prose)) {
    badges.push({ key: 'slipcase', label: 'Slipcase', title: 'Comes in a slipcase' });
  }
  return badges;
}

function editionOf(copy: CopyView, editions: EditionView[]): EditionView | null {
  return copy.edition_id == null ? null : (editions.find((e) => e.id === copy.edition_id) ?? null);
}

function mediumOfFormat(format: string | null): 'physical' | 'ebook' | null {
  if (!format) return null;
  return isPhysicalFormat(format) ? 'physical' : 'ebook';
}

/**
 * Build the hero holding — the one big "this is what you have" line.
 *
 * A held copy is preferred (it is a fact about a physical object on a shelf);
 * failing that, an edition row stands in (an ebook file, a hardcover recorded
 * with no copy). Failing both, the audiobook holding — because a book the
 * household owns only on audio still belongs on its own shelf line.
 */
function buildHero(
  copies: CopyView[],
  editions: EditionView[],
  audiobookHolding: WorkAudiobookHolding | null,
): ShelfHero | null {
  const held = copies
    .filter((c) => (HELD_STATUSES as readonly string[]).includes(c.status))
    .sort((a, b) => (HERO_PRIORITY[a.status] ?? 9) - (HERO_PRIORITY[b.status] ?? 9));

  if (held.length > 0) {
    const hero = held[0]!;
    const edition = editionOf(hero, editions);
    const format = edition ? formatLabel(edition.format) : null;
    return {
      status: hero.status,
      format,
      medium: mediumOfFormat(edition?.format ?? null),
      badges: specialEditionBadges(hero, edition),
      location: hero.location,
      condition: hero.condition,
      otherHeldCount: held.length - 1,
    };
  }

  // No copy recorded — infer the hero from the printings the catalog carries,
  // physical first (that is the object you would pull off a shelf).
  const physical = editions.find((e) => isPhysicalFormat(e.format));
  const anyEdition = physical ?? editions[0];
  if (anyEdition) {
    return {
      status: null,
      format: formatLabel(anyEdition.format),
      medium: mediumOfFormat(anyEdition.format),
      badges: specialEditionBadges(null, anyEdition),
      location: null,
      condition: null,
      otherHeldCount: 0,
    };
  }

  // Nothing physical and no file — but the household may own it on audio.
  if (audiobookHolding) {
    return {
      status: null,
      format: 'Audiobook',
      medium: 'audio',
      badges: [],
      location: null,
      condition: null,
      otherHeldCount: 0,
    };
  }

  return null;
}

export function deriveShelfView({
  copies,
  editions,
  audiobookHolding,
  audioEditions,
  audioEditionCount,
  ebookHolding,
  peerHoldings,
}: {
  copies: CopyView[];
  editions: EditionView[];
  audiobookHolding: WorkAudiobookHolding | null;
  audioEditions: WorkAudioEdition[];
  audioEditionCount: number | undefined;
  ebookHolding: WorkEbookHolding | null;
  peerHoldings: PeerHoldingView[];
}): ShelfView {
  const hero = buildHero(copies, editions, audiobookHolding);

  // Audio: the count the SERVER measured, never `editions.length` (a stale
  // edition still shows a row but is not "owned") — the rule `audioCountLine`
  // states. Falls back to 1 when a holding exists but the count field does not.
  const audioCount =
    audioEditionCount != null
      ? audioEditionCount
      : audiobookHolding
        ? Math.max(1, audioEditions.filter((e) => !e.staleAt).length || 1)
        : 0;
  const availability: ShelfAvailability = {
    audio: audioCount > 0 ? { count: audioCount } : null,
    // Live ebook in the shared pool. A stale holding is not "available".
    ebook: ebookHolding != null && ebookHolding.staleAt === null,
    peers: peerHoldings,
  };

  const hasAnything =
    hero !== null ||
    availability.audio !== null ||
    availability.ebook ||
    availability.peers.length > 0;

  return { hero, availability, hasAnything };
}
