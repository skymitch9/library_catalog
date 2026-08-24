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
 * ⚠️ **The special-edition badges are now FIRST-CLASS copy booleans (migration
 * 0430), with the old prose parse kept as a back-compat fallback.** `is_signed`,
 * `sprayed_edges`, `leatherbound` and `slipcase` are real columns on `copy`; a
 * badge lights when the column is set. For rows migrated 0430 has not yet swept
 * (`scripts/sweep-special-editions.mjs`), the attribute may still live only as
 * free text in `edition.edition_name` — so the prose is still scanned and
 * OR-ed in, and nothing regresses until the sweep runs. Once a row is swept the
 * column wins and the prose is redundant.
 */
import {
  LEATHER_IMPLIES_FORMAT,
  detectSpecialEditionProse,
  leatherboundImpliesHardcover,
} from '@lc/core';
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
 * ⚠️ **First-class copy columns win; edition prose is a back-compat fallback.**
 * Since migration 0430 each attribute is a real boolean on the copy
 * (`is_signed`, `sprayed_edges`, `leatherbound`, `slipcase`). A badge lights
 * when the column is set OR — for a row the 0430 sweep has not reached — when
 * the shop's own words in `edition.edition_name` / `edition.edition_kind` still
 * carry it. Once a row is swept the column is authoritative and the prose is
 * redundant; until then nothing regresses.
 *
 * Leatherbound implies hardcover (`LEATHER_IMPLIES_FORMAT`), which is why it is
 * a badge in its own right rather than a format — the format derivation reads
 * the same flag, see `buildHero`.
 */
export function specialEditionBadges(
  copy: CopyView | null,
  edition: EditionView | null,
): SpecialEditionBadge[] {
  // The prose the shop used, plus the canonical kind — both scanned so a
  // "Collector's edition" whose name says "leatherbound" still lights the badge
  // on an un-swept row. `detectSpecialEditionProse` is the SAME detector the
  // 0430 sweep uses, so a badge and a migration cannot disagree.
  const prose = detectSpecialEditionProse(
    [edition?.edition_name, edition?.edition_kind].filter(Boolean).join(' '),
  );

  const badges: SpecialEditionBadge[] = [];
  if (copy?.is_signed) {
    badges.push({ key: 'signed', label: 'Signed', title: 'A signed copy' });
  }
  if (copy?.sprayed_edges || prose.sprayedEdges) {
    badges.push({ key: 'sprayed', label: 'Sprayed edges', title: 'Coloured/sprayed page edges' });
  }
  if (copy?.leatherbound || prose.leatherbound) {
    badges.push({ key: 'leather', label: 'Leatherbound', title: 'A leatherbound hardcover' });
  }
  if (copy?.slipcase || prose.slipcase) {
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
    // Leather ⊂ hardcover: a leatherbound copy IS a hardcover
    // (`LEATHER_IMPLIES_FORMAT`). When no edition is linked to name a format, the
    // flag still tells us this is a hardcover — so the hero says so rather than
    // going blank. A recorded format is never overridden; this only FILLS an
    // unknown one, which is the ordinary case for a copy with no edition yet.
    const leatherHardcover = leatherboundImpliesHardcover(hero) && !edition;
    const format = edition
      ? formatLabel(edition.format)
      : leatherHardcover
        ? formatLabel(LEATHER_IMPLIES_FORMAT)
        : null;
    return {
      status: hero.status,
      format,
      medium: edition ? mediumOfFormat(edition.format) : leatherHardcover ? 'physical' : null,
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
