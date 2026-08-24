/**
 * "On your shelf" — the shelf rows and the availability line, derived once,
 * WITHOUT a DOM or firebase, so it can be exercised by `node --test`.
 *
 * This is the `deriveWorkView` / `buildVersionEntries` pattern the repo already
 * uses: a pure function whose output a test pins, and a thin component
 * (`OnYourShelf.tsx`) that only renders it. The redesign hoists this to the top
 * of the work page — the one thing a person asks a book page ("what do I have,
 * and where else can I get it?") — so the logic that answers it earns a test of
 * its own rather than living inline in the page.
 *
 * ## The owner's model (2026-08-24): EDITIONS ARE THE SHELF
 *
 * ⚠️ **The shelf is a list of EDITIONS, never a single "hero", and it is never
 * empty.** Each edition (a format/version that exists in the world) is one row,
 * marked **Owned** (a copy of it is on your shelf, or it is a file you hold) or
 * **Wanted** (it exists but you have no copy). A book always has at least one
 * row: own nothing, and the primary row shows as **Wanted** — the old
 * `if (!hasAnything) return null` was the bug this replaces.
 *
 * ⚠️ **Copies NEST under an edition; they are not a competing list.** A held
 * copy hangs off the edition it is a copy of. The common case — one book, one
 * printing, one copy — is therefore exactly one clean row. A copy only earns its
 * own nested line when you hold more than one of the same printing.
 *
 * ## No new response fields
 *
 * Everything here is derived from data the `/api/works/:id` response already
 * carries (copies, editions, the audiobook / ebook / peer holdings). The
 * work-detail contract test (`work-detail-contract.test.ts`) is unaffected
 * because `deriveWorkView` reads no new `detail.` field.
 *
 * ## Special editions are FIRST-CLASS copy booleans (migration 0430)
 *
 * `is_signed`, `sprayed_edges`, `leatherbound` and `slipcase` are real columns
 * on `copy`; a badge lights when the column is set. For rows the 0430 sweep has
 * not reached (`scripts/sweep-special-editions.mjs`) the attribute may still
 * live only as free text in `edition.edition_name` — so the prose is still
 * scanned and OR-ed in, and nothing regresses until the sweep runs.
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
/** Preference order for which held copy leads a row — the one you own wins. */
const HELD_PRIORITY: Record<string, number> = { owned: 0, borrowed: 1, lent: 2 };

export interface SpecialEditionBadge {
  key: string;
  label: string;
  title: string;
}

/** One held copy, nested under the edition it is a copy of. */
export interface ShelfCopy {
  id: number;
  /** The copy status — owned/borrowed/lent. */
  status: string;
  location: string | null;
  condition: string | null;
  /** Who has it, when the server sent a name (lent/borrowed). Null otherwise. */
  personName: string | null;
  badges: SpecialEditionBadge[];
}

/**
 * One shelf row = one edition (a printing/version that exists), plus whatever
 * copies of it you hold.
 */
export interface ShelfRow {
  /** Stable list key. */
  key: string;
  /** The big format word — "Hardcover", "EPUB" — or null when unknown. */
  format: string | null;
  /** Coarse medium, for the chip colour. */
  medium: 'physical' | 'ebook' | 'audio' | null;
  /** The vendor's own name for the printing — "BN Exclusive" — to tell two of one format apart. */
  editionName: string | null;
  /** The canonical kind — "collectors" — or null for an ordinary printing. */
  kind: string | null;
  /** What is bound inside — "Volumes 1-3". */
  collects: string | null;
  /** True when you hold a copy of this edition, or it is a file you have. */
  owned: boolean;
  /** Special-edition badges for the row (union across its held copies + prose). */
  badges: SpecialEditionBadge[];
  /** The held copies of this exact printing. Empty for a Wanted or file row. */
  copies: ShelfCopy[];
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
  /** ⚠️ ALWAYS at least one row — the shelf is never empty (owner model). */
  rows: ShelfRow[];
  availability: ShelfAvailability;
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
 * the same flag, see `buildRows`.
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

function mediumOfFormat(format: string | null): 'physical' | 'ebook' | null {
  if (!format) return null;
  return isPhysicalFormat(format) ? 'physical' : 'ebook';
}

/** Held copies first by ownership preference, so a row leads with the copy you own. */
function sortHeld(copies: CopyView[]): CopyView[] {
  return [...copies].sort(
    (a, b) => (HELD_PRIORITY[a.status] ?? 9) - (HELD_PRIORITY[b.status] ?? 9),
  );
}

/**
 * The union of special-edition badges across a set of held copies and their
 * printing — deduped by key, so a signed copy and a "Signed" edition name light
 * ONE badge, not two.
 */
function mergeBadges(heldCopies: CopyView[], edition: EditionView | null): SpecialEditionBadge[] {
  const byKey = new Map<string, SpecialEditionBadge>();
  const add = (bs: SpecialEditionBadge[]) => {
    for (const b of bs) if (!byKey.has(b.key)) byKey.set(b.key, b);
  };
  if (heldCopies.length === 0) add(specialEditionBadges(null, edition));
  else for (const c of heldCopies) add(specialEditionBadges(c, edition));
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
 * Row order: OWNED before wanted (what you have leads), and within each, a
 * physical printing before a file before an unknown — the object you would pull
 * off a shelf is the first thing a person looks for.
 */
function rowRank(r: ShelfRow): number {
  const own = r.owned ? 0 : 100;
  const med = r.medium === 'physical' ? 0 : r.medium === 'ebook' ? 1 : r.medium === 'audio' ? 2 : 3;
  return own + med;
}

/**
 * Build the shelf rows — one per edition, copies nested, ALWAYS ≥ 1.
 *
 * - Every real edition becomes a row. It is **Owned** when a held copy links to
 *   it, or when it is a file the household holds (an ebook/audio printing exists
 *   as bytes on the drive, not as a thing you would "want"); otherwise
 *   **Wanted** — the printing exists, you have no copy.
 * - Held copies whose printing is not identified (`edition_id == null`) — the
 *   Kickstarter/Illumicrate copies that never had a barcode — collect into one
 *   Owned row. Leatherbound implies hardcover there (`LEATHER_IMPLIES_FORMAT`),
 *   so the row can still name a format with no edition to read one from.
 * - If there is nothing at all — no editions, no held copies — one **Wanted**
 *   row stands in, because the shelf is never empty.
 *
 * ⚠️ **No edition is minted here or anywhere else for a wish.** This is a
 * DISPLAY derivation; the synthetic "wanted" row is a view object, never a
 * write. `reportFor` / `copy.edition_id` nullable stay exactly as they were.
 */
function buildRows(
  copies: CopyView[],
  editions: EditionView[],
  audiobookHolding: WorkAudiobookHolding | null,
): ShelfRow[] {
  const held = copies.filter((c) => (HELD_STATUSES as readonly string[]).includes(c.status));
  const heldByEdition = new Map<number, CopyView[]>();
  const unlinked: CopyView[] = [];
  for (const c of held) {
    if (c.edition_id == null) unlinked.push(c);
    else {
      const list = heldByEdition.get(c.edition_id) ?? [];
      list.push(c);
      heldByEdition.set(c.edition_id, list);
    }
  }

  const rows: ShelfRow[] = [];

  for (const e of editions) {
    const rowCopies = sortHeld(heldByEdition.get(e.id) ?? []);
    const medium = mediumOfFormat(e.format);
    // A held copy makes it owned; a file printing (ebook) is owned by virtue of
    // the bytes existing. A physical printing with no copy is Wanted. (Editions
    // never carry the `audio` medium — audio is a sibling holding, handled in the
    // empty-fallback and the availability line, not as an edition row.)
    const owned = rowCopies.length > 0 || medium === 'ebook';
    rows.push({
      key: `e${e.id}`,
      format: formatLabel(e.format),
      medium,
      editionName: e.edition_name ?? null,
      kind: e.edition_kind ?? null,
      collects: e.collects ?? null,
      owned,
      badges: mergeBadges(rowCopies, e),
      copies: rowCopies.map((c) => toShelfCopy(c, e)),
    });
  }

  if (unlinked.length > 0) {
    const sorted = sortHeld(unlinked);
    const leather = sorted.some((c) => leatherboundImpliesHardcover(c));
    rows.push({
      key: 'copies-unlinked',
      format: leather ? formatLabel(LEATHER_IMPLIES_FORMAT) : null,
      medium: leather ? 'physical' : null,
      editionName: null,
      kind: null,
      collects: null,
      owned: true,
      badges: mergeBadges(sorted, null),
      copies: sorted.map((c) => toShelfCopy(c, null)),
    });
  }

  // Never empty. A book with no printing and no copy still has a shelf line:
  //  - own it only on audio (no edition, audio is a sibling-library holding, not
  //    an edition of anything here) → an Owned "Audiobook" row, as the old hero
  //    did, because a book you have only on audio still belongs on its shelf;
  //  - otherwise Wanted — you know the book exists, you do not have it.
  if (rows.length === 0) {
    rows.push(
      audiobookHolding
        ? {
            key: 'audio-primary',
            format: 'Audiobook',
            medium: 'audio',
            editionName: null,
            kind: null,
            collects: null,
            owned: true,
            badges: [],
            copies: [],
          }
        : {
            key: 'wanted-primary',
            format: null,
            medium: null,
            editionName: null,
            kind: null,
            collects: null,
            owned: false,
            badges: [],
            copies: [],
          },
    );
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
  const rows = buildRows(copies, editions, audiobookHolding);

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

  return { rows, availability };
}
