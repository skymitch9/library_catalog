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
 *
 * ## The row LEADS with the edition, not the format word (owner, 2026-09-02)
 *
 * > "actually none of the edition stuff shows in the page anymore. i see we have
 * > it on the shelf but not what each edition is. lets have the editions listed
 * > in the on your shelf version with ebook and audio but instead of paperback
 * > replace that with the edition info and if its signed or not"
 *
 * The copy-driven fix above bought "an owned book is never Wanted" at the price
 * of edition identity: grouping by *effective format* made the headline the bare
 * format word, and the only identity the row ever showed was `edition_name` —
 * **NULL on 437 of 566 printings in production (measured 2026-09-02)**, so for
 * most books the identity line rendered nothing at all.
 *
 * So each row now carries a `label` (the headline) and a `meta` (the secondary
 * line), composed HERE rather than in the component, and pinned by the test:
 *
 *   - **A physical row whose copies resolve to a real edition leads with that
 *     edition's identity** — its `edition_name`, else its canonical kind, else
 *     its imprint (publisher/year) — and demotes the binding to `meta`.
 *   - ⚠️ **"Resolves" means UNAMBIGUOUSLY.** A copy's own `edition_id` is
 *     authoritative; an unlinked copy may borrow the work's printing of that
 *     format **only when the work has exactly one of them**. Work 220 is why:
 *     two owned unlinked copies, two hardcover printings ("Signed Leatherbound"
 *     and a slipcase-set volume), and the old `claimPhysicalEditionFor` handed
 *     the whole group the FIRST one's name — a fabricated identity, and the
 *     wrong one for the slipcase copy. Ambiguity now renders as the format word
 *     with no identity at all.
 *   - **Signed is shown either way** (`ShelfRow.signed` / `ShelfCopy.signed`) on
 *     an owned physical row — the owner asked for "if its signed or not", and a
 *     badge that only ever lights cannot answer "or not". ⚠️ It reports the
 *     RECORD, not the object: `is_signed` is `NOT NULL DEFAULT 0` (migration
 *     0430), so `false` means *no copy is marked signed*, which is what the
 *     rendered title says. The other three attributes stay light-when-set chips.
 *   - **Ebook, audiobook, wanted and neutral rows are UNCHANGED** — their
 *     `label`/`meta` reproduce exactly what the component used to compose.
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
import { editionKindLabel, formatLabel, isPhysicalFormat } from './formats.js';

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
  /**
   * ⚠️ **The RECORD's answer, not the object's.** True when `copy.is_signed` is
   * set (or the printing's own prose says so); false means *nobody has marked
   * this copy signed* — `is_signed` is `NOT NULL DEFAULT 0`, so an unexamined
   * copy and a genuinely unsigned one are indistinguishable here. Rendered as an
   * explicit two-state because the owner asked for "if its signed or not"; the
   * rendered title carries the caveat so the UI never over-claims.
   */
  signed: boolean;
}

/**
 * One shelf row = one format/version you HAVE or WANT, plus the copies of it.
 */
export interface ShelfRow {
  /** Stable list key. */
  key: string;
  /**
   * The big format word — "Hardcover", "EPUB", "Audiobook" — or null when unknown.
   *
   * ⚠️ This is still the FORMAT, and stays so: the emoji thumb, the row rank and
   * every existing caller key off it. What a person READS at the top of the card
   * is `label`, which is the format word only when no edition resolves.
   */
  format: string | null;
  /**
   * The headline the card leads with (owner, 2026-09-02). The resolved edition's
   * identity when there is one, else the format word, else null (the neutral slot
   * and the formatless "any format" want, which the component words itself).
   */
  label: string | null;
  /** Where `label` came from — so the component never renders the same fact twice. */
  labelSource: 'edition-name' | 'edition-kind' | 'imprint' | 'format' | null;
  /**
   * The one composed secondary line under the headline — binding, imprint, what
   * it collects. Composed here, not in the component, so the test can pin it.
   */
  meta: string | null;
  /**
   * How the row's edition identity was established, or null when NONE was — the
   * three cases the owner's ask turns on. `'linked'`: a copy's own `edition_id`.
   * `'sole-printing'`: the copy is unlinked and the work has exactly ONE physical
   * printing of this format, so the attribution is unambiguous. Null: the format
   * word stands alone — ⚠️ never a guess (see the header on work 220).
   */
  resolvedBy: 'linked' | 'sole-printing' | null;
  /**
   * Signed, shown either way on an OWNED physical row that has copies; null where
   * the question does not apply (a file row, an audiobook, the neutral slot, a
   * want). See `ShelfCopy.signed` for what `false` does and does not claim.
   */
  signed: boolean | null;
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
    // ⚠️ The COLUMN only — `specialEditionBadges` gives signing no prose
    // fallback (unlike the other three), because "Signed" in a shop's blurb
    // describes the printing on offer, not whether THIS object was ever signed.
    signed: !!copy.is_signed,
  };
}

/**
 * The identity of a printing — what a person would call it if you asked "which
 * edition is that one?" — in the order the record can actually answer:
 *
 *   1. `edition_name`, the vendor's own words for the printing ("BN Exclusive").
 *   2. its canonical kind ("Collector's edition") when nobody named it.
 *   3. its imprint — publisher and/or year ("TokyoPop · 2006"), which is the ONLY
 *      identity 437 of 566 production printings carry (measured 2026-09-02) and
 *      therefore the whole reason this ladder has a third rung.
 *
 * ⚠️ Returns null when the edition names itself in none of those ways. A null
 * here means the row falls back to the format word — an absence is rendered as
 * an absence, never filled in with something plausible.
 */
function editionIdentity(
  edition: EditionView | null,
): { text: string; source: 'edition-name' | 'edition-kind' | 'imprint' } | null {
  if (!edition) return null;
  const name = edition.edition_name?.trim();
  if (name) return { text: name, source: 'edition-name' };
  if (edition.edition_kind) {
    return { text: editionKindLabel(edition.edition_kind), source: 'edition-kind' };
  }
  const imprint = imprintOf(edition);
  return imprint ? { text: imprint, source: 'imprint' } : null;
}

/** "TokyoPop · 2006", "TokyoPop", "2006" — whichever of the two the row carries. */
function imprintOf(edition: EditionView | null): string | null {
  const publisher = edition?.publisher?.trim() || null;
  const year = edition?.published_year != null ? String(edition.published_year) : null;
  return [publisher, year].filter(Boolean).join(' · ') || null;
}

/** One line, ` · `-joined, or null when there is nothing to say. */
function joinMeta(parts: (string | null)[]): string | null {
  return parts.filter(Boolean).join(' · ') || null;
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
  //
  // ⚠️ **Only when the work has exactly ONE printing of that format.** A borrowed
  // identity is an inference, and an inference with two candidates is a guess:
  // work 220 holds two unlinked hardcover copies against two hardcover printings
  // ("Signed Leatherbound …" and a slipcase-set volume), and borrowing the first
  // labelled BOTH copies with the leatherbound's name. When the format is
  // ambiguous the group takes no edition at all and renders as the format word.
  function claimPhysicalEditionFor(format: string): EditionView | null {
    const ofFormat = physicalEditions.filter((pe) => pe.format === format);
    const e = ofFormat.find((pe) => !usedEditionIds.has(pe.id));
    if (e) usedEditionIds.add(e.id);
    return ofFormat.length === 1 ? (e ?? null) : null;
  }

  // Group a set of copies by their effective format. A copy that links to a real
  // edition nests under THAT exact edition (so two printings of one format stay
  // two rows); everything else groups by effective format. Groups come back in a
  // stable order — linked editions in edition order, then formats by first
  // appearance.
  function groupByFormat(cs: CopyView[]): {
    format: string;
    edition: EditionView | null;
    resolvedBy: 'linked' | 'sole-printing' | null;
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

    const groups: {
      format: string;
      edition: EditionView | null;
      resolvedBy: 'linked' | 'sole-printing' | null;
      copies: CopyView[];
    }[] = [];
    // Linked editions in the editions array's own order, for stability.
    for (const e of editions) {
      const list = linkedByEdition.get(e.id);
      if (list) {
        usedEditionIds.add(e.id);
        groups.push({ format: e.format, edition: e, resolvedBy: 'linked', copies: list });
      }
    }
    for (const fmt of order) {
      const list = byFormat.get(fmt)!;
      const e = fmt === UNSPEC_PHYSICAL ? null : claimPhysicalEditionFor(fmt);
      groups.push({ format: fmt, edition: e, resolvedBy: e ? 'sole-printing' : null, copies: list });
    }
    return groups;
  }

  function physicalRow(
    prefix: string,
    format: string,
    edition: EditionView | null,
    resolvedBy: 'linked' | 'sole-printing' | null,
    groupCopies: CopyView[],
    owned: boolean,
  ): ShelfRow {
    const sorted = sortCopies(groupCopies);
    const isUnspec = format === UNSPEC_PHYSICAL;
    const fmtLabel = edition ? formatLabel(edition.format) : isUnspec ? null : formatLabel(format);
    // The owner's ask: lead with the EDITION where one resolves, and demote the
    // binding to the line underneath. Where nothing resolves, the format word
    // keeps the headline exactly as it always has — an absence is not a guess.
    const identity = editionIdentity(edition);
    const label = identity?.text ?? fmtLabel;
    const labelSource = identity ? identity.source : fmtLabel ? 'format' : null;
    const meta = joinMeta([
      // The binding is secondary only when the edition took the headline;
      // otherwise it IS the headline and must not be said twice.
      identity ? fmtLabel : null,
      // The imprint, unless it is already the headline.
      identity?.source === 'imprint' ? null : imprintOf(edition),
      edition?.collects ? `contains ${edition.collects}` : null,
    ]);
    return {
      key: edition ? `${prefix}-e${edition.id}` : `${prefix}-${format}`,
      format: fmtLabel,
      label,
      labelSource,
      meta,
      resolvedBy,
      // Signed, either way — but only for something you HOLD. A wanted row is a
      // wish, and a wish has no object to have been signed.
      signed: owned && sorted.length > 0 ? sorted.some((c) => !!c.is_signed) : null,
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
    rows.push(physicalRow('own', g.format, g.edition, g.resolvedBy, g.copies, true));
  }

  // 2) Ebook files: every ebook edition is bytes you hold → Owned. (Skip any an
  //    owned copy already claimed above, so a linked ebook copy is not doubled.)
  for (const e of ebookEditions) {
    if (usedEditionIds.has(e.id)) continue;
    usedEditionIds.add(e.id);
    rows.push({
      key: `own-e${e.id}`,
      format: formatLabel(e.format),
      // ⚠️ UNCHANGED by the 2026-09-02 ask, deliberately: the owner asked for the
      // editions on the physical rows *"with ebook and audio"* beside them, not
      // for the file rows to be relabelled. A file row IS its edition — "EPUB" is
      // already the useful word — so the headline stays the format and the name
      // stays where the component always put it, on the line below.
      label: formatLabel(e.format),
      labelSource: 'format',
      meta: joinMeta([e.edition_name ?? null, e.collects ? `contains ${e.collects}` : null]),
      // Nothing had to be RESOLVED — the row is the edition, not a copy of one.
      resolvedBy: null,
      signed: null,
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
      label: 'Ebook',
      labelSource: 'format',
      meta: null,
      resolvedBy: null,
      signed: null,
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
  //    ⚠️ LIVE holdings only. `audiobookHolding` arrives UNfiltered on `staleAt`
  //    (the OtherVersions drawer wants stale rows so it can say "may be out of
  //    date") — but a stale match means the sibling catalog no longer confirms
  //    the audiobook, so a top-line "Owned on audio" glance would be a dead
  //    claim linking to a search that finds nothing. Match the series ladder,
  //    which is already live-only.
  if (audiobookHolding != null && audiobookHolding.staleAt == null) {
    rows.push({
      key: 'own-audio',
      format: 'Audiobook',
      label: 'Audiobook',
      labelSource: 'format',
      meta: null,
      resolvedBy: null,
      signed: null,
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
        // No format, no printing — the component words this slot itself.
        label: null,
        labelSource: null,
        meta: null,
        resolvedBy: null,
        signed: null,
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
    rows.push(physicalRow('want', g.format, g.edition, g.resolvedBy, g.copies, false));
  }

  // 6) Never empty — but never a fabricated Want. A neutral, display-only slot.
  if (rows.length === 0) {
    rows.push({
      key: 'neutral',
      format: null,
      label: null,
      labelSource: null,
      meta: null,
      resolvedBy: null,
      signed: null,
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
