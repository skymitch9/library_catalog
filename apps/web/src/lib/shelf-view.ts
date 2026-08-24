/**
 * "On your shelf" — the shelf rows and the availability line, derived once,
 * WITHOUT a DOM or firebase, so it can be exercised by `node --test`.
 *
 * This is the `deriveWorkView` / `buildVersionEntries` pattern the repo already
 * uses: a pure function whose output a test pins, and a thin component
 * (`OnYourShelf.tsx`) that only renders it.
 *
 * ## The owner's model (2026-08-24, corrected): THE SHELF IS WHAT YOU HAVE
 *
 * > "Edition is all-encompassing of copies. I'll have multiple of the same
 * > edition or different editions — those are the copies. On your shelf should
 * > show the editions I have and the ebooks/audiobooks I might also have."
 *
 * ⚠️ **This derivation is COPY-DRIVEN, not link-driven — and that is the whole
 * fix.** The previous version marked an edition "Owned" only when a copy *linked*
 * to it (`copy.edition_id`). But `copy.edition_id` is **null across essentially
 * the whole catalog** — the Kickstarter/Illumicrate copies never had a barcode to
 * link on — so an owned book with an unlinked copy read as **Wanted**. Work 493
 * (".hack//Another Birth Vol 2") is the canonical case: one owned copy, one
 * paperback edition, no link between them → the old code showed "Paperback —
 * Wanted" while the owned copy floated off separately. **An owned book must never
 * read as Wanted.**
 *
 * So the shelf is built from what you HOLD, and links are a bonus, not the spine:
 *
 * 1. **Owned physical rows** come from your **owned/held copies**, grouped by
 *    their *effective* format:
 *      - the linked edition's format when `copy.edition_id` is set;
 *      - `hardcover` when the copy is leatherbound (`LEATHER_IMPLIES_FORMAT`);
 *      - otherwise the work's sole physical-edition format — this is how an
 *        unlinked owned copy still names itself "Paperback" (the 493 fix);
 *      - otherwise an "unspecified physical" row (you hold a physical copy, we
 *        cannot say which printing).
 *    Each distinct effective format = ONE Owned row; the copies of it nest as
 *    instances (count + each copy's condition/signed/special-edition/location).
 * 2. **Ebook files** — every ebook `edition` is bytes you hold → an Owned row.
 *    Plus the shared-pool `ebookHolding` → an Owned "Ebook" row when it is live
 *    and no ebook edition already stands for it.
 * 3. **Audiobook** — `audiobookHolding` / `audioEditions` → an Owned "Audiobook"
 *    row (the recording count rides on the row).
 * 4. **Wanted rows ONLY for genuinely wanted items** — a copy whose status is a
 *    wishlist status (`wanted` / `preordered`), or the edition such a copy wants.
 *    An edition you neither own nor want is **not a row at all** — the shelf is
 *    what you have and want, not every printing that exists in the world.
 * 5. **Never empty, but never a fabricated Want** — when there is genuinely
 *    nothing owned, held or wanted, one neutral "not on your shelf" slot stands
 *    in (display-only; `neutral: true`). It is NOT a Wanted row.
 *
 * ## No new response fields
 *
 * Everything is derived from data `/api/works/:id` already carries (copies,
 * editions, the audiobook / ebook / peer holdings). The work-detail contract
 * test is unaffected because `deriveWorkView` reads no new `detail.` field.
 *
 * ## Special editions are FIRST-CLASS copy booleans (migration 0430)
 *
 * `is_signed`, `sprayed_edges`, `leatherbound` and `slipcase` are real columns on
 * `copy`; a badge lights when the column is set. For rows the 0430 sweep has not
 * reached the attribute may still live only as free text in
 * `edition.edition_name` — so the prose is still scanned and OR-ed in, and
 * nothing regresses until the sweep runs.
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
/** The statuses that mean "we do not have it yet, and we mean to". Mirrors `@lc/core` `WISHLIST_STATUSES`. */
const WISHLIST_STATUSES = ['wanted', 'preordered'] as const;
/** Preference order for which held copy leads a row — the one you own wins. */
const HELD_PRIORITY: Record<string, number> = { owned: 0, borrowed: 1, lent: 2 };

/** Grouping key for a copy whose effective physical format cannot be named. */
const UNSPEC_PHYSICAL = '__physical__';

export interface SpecialEditionBadge {
  key: string;
  label: string;
  title: string;
}

/** One held (or wanted) copy, nested under the edition/format it is a copy of. */
export interface ShelfCopy {
  id: number;
  /** The copy status — owned/borrowed/lent/wanted/preordered. */
  status: string;
  location: string | null;
  condition: string | null;
  /** Who has it, when the server sent a name (lent/borrowed). Null otherwise. */
  personName: string | null;
  badges: SpecialEditionBadge[];
}

/**
 * One shelf row = one format/version you HAVE or WANT, plus the copies of it.
 */
export interface ShelfRow {
  /** Stable list key. */
  key: string;
  /** The big format word — "Hardcover", "EPUB", "Audiobook" — or null when unknown. */
  format: string | null;
  /** Coarse medium, for the chip colour. */
  medium: 'physical' | 'ebook' | 'audio' | null;
  /** The vendor's own name for the printing — "BN Exclusive" — to tell two of one format apart. */
  editionName: string | null;
  /** The canonical kind — "collectors" — or null for an ordinary printing. */
  kind: string | null;
  /** What is bound inside — "Volumes 1-3". */
  collects: string | null;
  /** True when you hold a copy of this format, or it is a file you have. */
  owned: boolean;
  /**
   * ⚠️ A DISPLAY-ONLY placeholder — the never-empty "not on your shelf" slot.
   * Neither Owned nor Wanted; it fabricates no want and mints nothing.
   */
  neutral: boolean;
  /** Recordings held, for an Audiobook row (the sibling-library count). Null otherwise. */
  count: number | null;
  /** Special-edition badges for the row (union across its copies + prose). */
  badges: SpecialEditionBadge[];
  /** The held/wanted copies of this format. Empty for a file row or the neutral slot. */
  copies: ShelfCopy[];
}

export interface ShelfAvailability {
  /**
   * Peer libraries (e.g. Padhard) that also hold it. ⚠️ Audio and ebook are no
   * longer here — the owner model makes your own audiobook/ebook holdings
   * **Owned shelf rows**, not an "also available" footnote. Only OTHER people's
   * libraries remain "also available".
   */
  peers: PeerHoldingView[];
}

export interface ShelfView {
  /** ⚠️ ALWAYS at least one row — the shelf is never empty (owner model). */
  rows: ShelfRow[];
  availability: ShelfAvailability;
}

/**
 * The special-edition badges for one copy and its linked printing.
 *
 * ⚠️ **First-class copy columns win; edition prose is a back-compat fallback.**
 * Since migration 0430 each attribute is a real boolean on the copy
 * (`is_signed`, `sprayed_edges`, `leatherbound`, `slipcase`). A badge lights when
 * the column is set OR — for a row the 0430 sweep has not reached — when the
 * shop's own words in `edition.edition_name` / `edition.edition_kind` still carry
 * it. `detectSpecialEditionProse` is the SAME detector the 0430 sweep uses, so a
 * badge and a migration cannot disagree.
 */
export function specialEditionBadges(
  copy: CopyView | null,
  edition: EditionView | null,
): SpecialEditionBadge[] {
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

function mediumOfFormat(format: string | null): 'physical' | 'ebook' | null {
  if (!format) return null;
  return isPhysicalFormat(format) ? 'physical' : 'ebook';
}

/** Held/wish copies first by ownership preference, so a row leads with the copy you own. */
function sortCopies(copies: CopyView[]): CopyView[] {
  return [...copies].sort((a, b) => (HELD_PRIORITY[a.status] ?? 9) - (HELD_PRIORITY[b.status] ?? 9));
}

/**
 * The union of special-edition badges across a set of copies and their printing —
 * deduped by key, so a signed copy and a "Signed" edition name light ONE badge.
 */
function mergeBadges(copies: CopyView[], edition: EditionView | null): SpecialEditionBadge[] {
  const byKey = new Map<string, SpecialEditionBadge>();
  const add = (bs: SpecialEditionBadge[]) => {
    for (const b of bs) if (!byKey.has(b.key)) byKey.set(b.key, b);
  };
  if (copies.length === 0) add(specialEditionBadges(null, edition));
  else for (const c of copies) add(specialEditionBadges(c, edition));
  return [...byKey.values()];
}

function toShelfCopy(copy: CopyView, edition: EditionView | null): ShelfCopy {
  return {
    id: copy.id,
    status: copy.status,
    location: copy.location,
    condition: copy.condition,
    // Rendered only when the server actually sent a name — a redacted person
    // arrives null and the row simply carries the status word (`Copies.tsx`
    // documents why "nobody recorded" would be a claim without evidence).
    personName: copy.person_name,
    badges: specialEditionBadges(copy, edition),
  };
}

/**
 * The *effective* format a copy names, when its edition link is missing — the
 * heart of the copy-driven fix.
 *
 *   1. A linked edition's format is authoritative.
 *   2. A leatherbound copy is a hardcover (`LEATHER_IMPLIES_FORMAT`), link or no.
 *   3. Otherwise, if the work has exactly one physical-edition format, the
 *      unlinked copy is a copy of THAT — this is how work 493's unlinked owned
 *      copy becomes "Paperback" rather than a formatless orphan.
 *   4. Otherwise the format is unknown: an unlinked copy amid several physical
 *      formats cannot be attributed to one, so it groups as unspecified physical
 *      rather than being guessed onto the wrong printing.
 *
 * Returns the raw format string, or `UNSPEC_PHYSICAL` for the unknown-physical
 * bucket. Never returns a physical format the work has no evidence for.
 */
function effectiveFormat(
  copy: CopyView,
  editionById: Map<number, EditionView>,
  solePhysicalFormat: string | null,
): string {
  if (copy.edition_id != null) {
    const e = editionById.get(copy.edition_id);
    if (e) return e.format;
  }
  if (leatherboundImpliesHardcover(copy)) return LEATHER_IMPLIES_FORMAT;
  if (solePhysicalFormat) return solePhysicalFormat;
  return UNSPEC_PHYSICAL;
}

/**
 * Row order: OWNED before wanted before the neutral slot, and within each, a
 * physical printing before a file before audio — the object you would pull off a
 * shelf is the first thing a person looks for.
 */
function rowRank(r: ShelfRow): number {
  const state = r.neutral ? 200 : r.owned ? 0 : 100;
  const med = r.medium === 'physical' ? 0 : r.medium === 'ebook' ? 1 : r.medium === 'audio' ? 2 : 3;
  return state + med;
}

function buildRows(
  copies: CopyView[],
  editions: EditionView[],
  ebookHolding: WorkEbookHolding | null,
  audiobookHolding: WorkAudiobookHolding | null,
  audioCount: number,
): ShelfRow[] {
  const editionById = new Map<number, EditionView>(editions.map((e) => [e.id, e]));
  const physicalEditions = editions.filter((e) => isPhysicalFormat(e.format));
  const ebookEditions = editions.filter((e) => !isPhysicalFormat(e.format));
  const physicalFormats = new Set(physicalEditions.map((e) => e.format));
  const solePhysicalFormat = physicalFormats.size === 1 ? [...physicalFormats][0]! : null;

  const held = copies.filter((c) => (HELD_STATUSES as readonly string[]).includes(c.status));
  const wish = copies.filter((c) => (WISHLIST_STATUSES as readonly string[]).includes(c.status));

  const rows: ShelfRow[] = [];
  const usedEditionIds = new Set<number>();

  // A physical edition of a given effective format, not already spoken for — so
  // an unlinked-copy group can borrow its name/kind/collects, and so the same
  // edition is never rendered twice (once as an Owned copy-group, once bare).
  function claimPhysicalEditionFor(format: string): EditionView | null {
    const e = physicalEditions.find((pe) => pe.format === format && !usedEditionIds.has(pe.id));
    if (e) usedEditionIds.add(e.id);
    return e ?? null;
  }

  // Group a set of copies by their effective format. A copy that links to a real
  // edition nests under THAT exact edition (so two printings of one format stay
  // two rows); everything else groups by effective format. Groups come back in a
  // stable order — linked editions in edition order, then formats by first
  // appearance.
  function groupByFormat(cs: CopyView[]): {
    format: string;
    edition: EditionView | null;
    copies: CopyView[];
  }[] {
    const linkedByEdition = new Map<number, CopyView[]>();
    const byFormat = new Map<string, CopyView[]>();
    const order: string[] = [];

    for (const c of cs) {
      if (c.edition_id != null && editionById.has(c.edition_id)) {
        const list = linkedByEdition.get(c.edition_id) ?? [];
        list.push(c);
        linkedByEdition.set(c.edition_id, list);
        continue;
      }
      const fmt = effectiveFormat(c, editionById, solePhysicalFormat);
      if (!byFormat.has(fmt)) {
        byFormat.set(fmt, []);
        order.push(fmt);
      }
      byFormat.get(fmt)!.push(c);
    }

    const groups: { format: string; edition: EditionView | null; copies: CopyView[] }[] = [];
    // Linked editions in the editions array's own order, for stability.
    for (const e of editions) {
      const list = linkedByEdition.get(e.id);
      if (list) {
        usedEditionIds.add(e.id);
        groups.push({ format: e.format, edition: e, copies: list });
      }
    }
    for (const fmt of order) {
      const list = byFormat.get(fmt)!;
      const e = fmt === UNSPEC_PHYSICAL ? null : claimPhysicalEditionFor(fmt);
      groups.push({ format: fmt, edition: e, copies: list });
    }
    return groups;
  }

  function physicalRow(
    prefix: string,
    format: string,
    edition: EditionView | null,
    groupCopies: CopyView[],
    owned: boolean,
  ): ShelfRow {
    const sorted = sortCopies(groupCopies);
    const isUnspec = format === UNSPEC_PHYSICAL;
    const fmtLabel = edition ? formatLabel(edition.format) : isUnspec ? null : formatLabel(format);
    return {
      key: edition ? `${prefix}-e${edition.id}` : `${prefix}-${format}`,
      format: fmtLabel,
      // An unspecified group is still a physical copy in hand — colour it physical.
      medium: edition
        ? mediumOfFormat(edition.format)
        : isUnspec
          ? 'physical'
          : mediumOfFormat(format),
      editionName: edition?.edition_name ?? null,
      kind: edition?.edition_kind ?? null,
      collects: edition?.collects ?? null,
      owned,
      neutral: false,
      count: null,
      badges: mergeBadges(sorted, edition),
      copies: sorted.map((c) => toShelfCopy(c, edition)),
    };
  }

  // 1) OWNED rows from held copies, grouped by effective format. This is the fix:
  //    an unlinked owned copy still names its format and reads as Owned.
  for (const g of groupByFormat(held)) {
    rows.push(physicalRow('own', g.format, g.edition, g.copies, true));
  }

  // 2) Ebook files: every ebook edition is bytes you hold → Owned. (Skip any an
  //    owned copy already claimed above, so a linked ebook copy is not doubled.)
  for (const e of ebookEditions) {
    if (usedEditionIds.has(e.id)) continue;
    usedEditionIds.add(e.id);
    rows.push({
      key: `own-e${e.id}`,
      format: formatLabel(e.format),
      medium: 'ebook',
      editionName: e.edition_name ?? null,
      kind: e.edition_kind ?? null,
      collects: e.collects ?? null,
      owned: true,
      neutral: false,
      count: null,
      badges: mergeBadges([], e),
      copies: [],
    });
  }

  // 3) Shared-pool ebook: an Owned "Ebook" row only when it is live AND no ebook
  //    edition already stands for the file (dedupe — the edition is the better
  //    record when it exists).
  if (ebookHolding != null && ebookHolding.staleAt === null && ebookEditions.length === 0) {
    rows.push({
      key: 'own-ebook-pool',
      format: 'Ebook',
      medium: 'ebook',
      editionName: null,
      kind: null,
      collects: null,
      owned: true,
      neutral: false,
      count: null,
      badges: [],
      copies: [],
    });
  }

  // 4) Audiobook: a held recording (sibling library) is an Owned "Audiobook" row,
  //    carrying the recording count. No edition table backs it — audio is not an
  //    edition of anything in this database.
  if (audiobookHolding != null) {
    rows.push({
      key: 'own-audio',
      format: 'Audiobook',
      medium: 'audio',
      editionName: null,
      kind: null,
      collects: null,
      owned: true,
      neutral: false,
      count: audioCount > 1 ? audioCount : null,
      badges: [],
      copies: [],
    });
  }

  // 5) WANTED rows — genuinely wanted items only. A wish copy that links to an
  //    edition wants THAT printing; an unlinked wish groups by effective format;
  //    a formatless wish ("I want this book, in whatever comes") is one plain
  //    Wanted row. An edition nobody owns or wants is NOT a row.
  for (const g of groupByFormat(wish)) {
    if (g.format === UNSPEC_PHYSICAL && g.edition === null) {
      // A pure "want this book" with no format at all.
      const sorted = sortCopies(g.copies);
      rows.push({
        key: 'want-any',
        format: null,
        medium: null,
        editionName: null,
        kind: null,
        collects: null,
        owned: false,
        neutral: false,
        count: null,
        badges: mergeBadges(sorted, null),
        copies: sorted.map((c) => toShelfCopy(c, null)),
      });
      continue;
    }
    rows.push(physicalRow('want', g.format, g.edition, g.copies, false));
  }

  // 6) Never empty — but never a fabricated Want. A neutral, display-only slot.
  if (rows.length === 0) {
    rows.push({
      key: 'neutral',
      format: null,
      medium: null,
      editionName: null,
      kind: null,
      collects: null,
      owned: false,
      neutral: true,
      count: null,
      badges: [],
      copies: [],
    });
  }

  return rows.sort((a, b) => rowRank(a) - rowRank(b));
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
  // Audio: the count the SERVER measured, never `editions.length` (a stale
  // edition still shows a row but is not "owned"). Falls back to 1 when a holding
  // exists but the count field does not.
  const audioCount =
    audioEditionCount != null
      ? audioEditionCount
      : audiobookHolding
        ? Math.max(1, audioEditions.filter((e) => !e.staleAt).length || 1)
        : 0;

  const rows = buildRows(copies, editions, ebookHolding, audiobookHolding, audioCount);

  return { rows, availability: { peers: peerHoldings } };
}
