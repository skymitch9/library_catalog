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
 * ## ⚠️ A fact is printed ONCE (owner, 2026-09-03)
 *
 * > "This has double information, let's normalize this."
 *
 * Said of a **Hardcover · OWNED** card carrying three copies, whose card line
 * read *"Not signed · Sprayed edges"* over three copy lines reading *"On the
 * shelf · Not signed · Sprayed edges"*, *"On the shelf · Not signed"* and *"Lent
 * out · good · Not signed"*. Every fact on that card was said two to four times,
 * because the row carried the **union** of its copies' attributes and each copy
 * then carried its own as well.
 *
 * The rule, approved the same day: **on the card when every copy agrees, on the
 * copies (and only there) when they differ.** So that card becomes *card: "Not
 * signed"* (all three agree), *copy 1: "On the shelf · Sprayed edges"*, *copy 2:
 * "On the shelf"*, *copy 3: "Lent out · good"*. Signing moves UP because the
 * copies agree; the sprayed edges move DOWN to the one copy that has them.
 *
 * ⚠️ **Decided HERE, not by filtering at render time** — `ShelfRow.badges` is
 * what the card should print and `ShelfCopy.badges` is what that copy should
 * print, so a test pins what a row SAYS. `splitBadges` does the halving;
 * `ShelfRow.signed` (the group answer, now null when they disagree) and
 * `ShelfRow.signedVaries` do the same job for the two-state signed chip.
 *
 * ⚠️ **An edition's PROSE badge stays on the card.** It describes the printing,
 * so it is equally true of every copy of it and there is no one copy to pin it
 * on — the un-swept-row back-compat above must not be lost to this rule.
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
 *
 * ## "On your shelf" is now THE list, in per-format TABS (owner, 2026-09-02 → 03)
 *
 * > "on your shelf should be the main with other editions available under their
 * > given section. so if its a second physical there should be 2 under physical.
 * > we should also add being able to set the covers for the alternate editions
 * > too."
 *
 * The separate **"Other versions available"** panel is gone. Everything it
 * carried files into this derivation, and the rows group by format — which is
 * what *"under physical"* named.
 *
 * ⚠️ **The grouping became TABS on 2026-09-03 (round 2).** Owner, 15:18, of the
 * round-1 card: *"Better but still duplicate, the hard cover section has info
 * and the stuff underneath has information"*, and then, at 15:33, the shape he
 * wants, verbatim:
 *
 * > "I want to see hardcover paperback cover audio ebook as the tabs and the
 * > editions owned of each under
 * > So paperback with standard under it. So very similar to A with minor
 * > changes. Keep what makes them different took.
 * > So hardcover
 * > Collectors edition - sprayed edges signed
 * > Standard edition
 * > Standard edition - signed - lent out"
 *
 * So the three MEDIUM sections (Physical / Ebook / Audio) became FORMAT tabs —
 * **Hardcover · Paperback · Audio · Ebook** — and under a tab there is **one
 * line per owned copy**: the printing's name, then only what distinguishes that
 * copy. `tabs` is a grouping OF `rows`, not a second list — the same row objects
 * are behind both, so nothing can come to disagree. See `buildTabs`.
 *
 * ⚠️ *"cover"* in his tab list is read as a slip between *hardcover* and
 * *paperback*; there is deliberately no fifth tab of that name. A format he did
 * NOT name (Mass market, or a physical copy whose binding cannot be attributed)
 * still earns its own tab when something of it is owned — the shelf is what you
 * HAVE, and a tab set that silently drops a holding is worse than one with five
 * words in it.
 *
 * ⚠️ **This deliberately amends the 2026-08-24 invariant "an edition you neither
 * own nor want is not a row at all."** That rule existed to stop a printing you
 * do not own being fabricated into a **Wanted**, and that half is untouched — an
 * unowned printing is never Wanted. It is now shown, under its format, in a
 * third state the shelf did not have:
 *
 *   | `state` | means | pill |
 *   |---|---|---|
 *   | `owned` | you hold a copy, or it is a file/recording you have | Owned |
 *   | `wanted` | a wishlist copy wants it | Wanted |
 *   | `available` | this version exists; nothing of yours is it | Available / May be yours |
 *   | `neutral` | the never-empty placeholder | Not on your shelf |
 *
 * ⚠️ **"Available" is a claim, and where it cannot be made honestly it is not
 * made.** An unlinked owned copy of format F could BE any unclaimed printing of
 * F — `copy.edition_id` is null across nearly the whole catalog — so labelling
 * such a printing "Available" would assert non-ownership on no evidence, which
 * is the work-220 fabrication pointing the other way. Those rows say **"May be
 * yours"** instead and name the reason. An unlinked copy of *unknown* physical
 * format (`UNSPEC_PHYSICAL`) could be any physical printing, so it softens every
 * physical format the same way. Linking the copy in *Editions & copies* is what
 * turns "May be yours" into a real answer — the DATA follow-up in `TODO.md`.
 *
 * ## The audiobook cross-link renders ONCE, here, in the Audio section
 *
 * ⚠️ It used to paint **twice** — measured in a browser on
 * <https://library.heygabi.ai/work/232>, once as this shelf's Owned "Audiobook"
 * row and once as an "Other versions available" entry, both linking to the same
 * search. That is the estate's "one fact, one home applies to SURFACES too"
 * rule, in its hard-to-catch shape.
 *
 * The merge keeps **both** halves of what the two panels knew, because they were
 * not redundant in content:
 *
 *   - the **ownership state** the shelf carried, and
 *   - ⚠️ the **provenance sentence** the other panel carried — *"Matched by
 *     containment — a partial title match, worth a second look (87% title
 *     match)."* Migration 0010's rule is that `matched_via` is **shown, never
 *     hidden**: it is the whole reason a wrong match gets noticed instead of
 *     quietly believed. It rides on `ShelfRow.notes`, beside the narrator, the
 *     series-spelling disagreement and the staleness caveat.
 *
 * ⚠️ **A stale audio row is `available`, not `owned`.** `staleAt` means the
 * sibling catalog no longer confirms the match, so claiming it as a holding
 * would be a dead claim — but hiding it looks identical to "never matched",
 * which loses the fact that it WAS true once. It shows, lighter, with the
 * caveat sentence. Same rule the retired panel followed.
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
import { audiobookDetailUrl, resolveAudiobookCover } from './audiobook-site.js';
import { ebookShelfUrl } from './ebook-site.js';
import { editionKindLabel, formatLabel, isPhysicalFormat } from './formats.js';
import { statusLabel } from './statuses.js';

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

/**
 * ⚠️ ONE definition of the signed badge. It is minted in two places — from a
 * copy's `is_signed` column (`specialEditionBadges`) and, on a shelf tab's copy
 * line, put back after the card/copy split has taken it out (`copyBadges`) — and
 * two object literals of the same badge is how a word comes to be spelled two
 * ways on one page.
 */
const SIGNED_BADGE: SpecialEditionBadge = {
  key: 'signed',
  label: 'Signed',
  title: 'A signed copy',
};

/** One held (or wanted) copy, nested under the edition/format it is a copy of. */
export interface ShelfCopy {
  id: number;
  /** The copy status — owned/borrowed/lent/wanted/preordered. */
  status: string;
  location: string | null;
  condition: string | null;
  /** Who has it, when the server sent a name (lent/borrowed). Null otherwise. */
  personName: string | null;
  /**
   * ⚠️ **Only what THIS copy should print** — the badges that are true of it and
   * are NOT already printed on the card above it (owner 2026-09-03: *"This has
   * double information, let's normalize this."*). A badge every copy shares is
   * the card's to say; a badge only some copies carry belongs here and nowhere
   * else. So a single-copy row's list is always empty — the card said it all —
   * and the three-copy card in the owner's screenshot puts *Sprayed edges* on
   * the one copy that has them. See `splitBadges`.
   */
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
   * printing of this format, so the attribution is unambiguous. `'edition'`: the
   * row **is** the printing (an `available` row, or a file row), so there was
   * nothing to attribute. Null: the format word stands alone — ⚠️ never a guess
   * (see the header on work 220).
   */
  resolvedBy: 'linked' | 'sole-printing' | 'edition' | null;
  /**
   * What this row IS to you (owner 2026-09-02). ⚠️ `owned` and `neutral` below
   * are the same facts as booleans and are kept because every caller and pin
   * reads them; `state` is the one that distinguishes the new third case.
   */
  state: 'owned' | 'wanted' | 'available' | 'neutral';
  /**
   * The pill's word and its tooltip — composed HERE, like `label`/`meta`, so the
   * component chooses none of its own and a test pins what a row claims. ⚠️ The
   * `available` case has TWO wordings and the difference is not cosmetic: see
   * the "Available is a claim" note in the file header.
   */
  stateLabel: string;
  stateTitle: string;
  /**
   * Where the row opens, when it is a version living in a sibling catalog — the
   * audiobook site's title search, or the ebook shelf's. Null for everything the
   * catalog holds itself.
   *
   * ⚠️ An audio row links **whether or not it is owned**: a stale match is still
   * worth following to see what the other catalog now says about it.
   */
  href: string | null;
  /**
   * The row's OWN cover, when it has one — an edition's `cover_url` (owner
   * 2026-09-02: *"add being able to set the covers for the alternate editions
   * too"*), or the audiobook catalog's jacket for an audio row. ⚠️ Null means
   * *this row has no cover of its own*, and the component falls back to the work
   * cover — an absence, never a borrowed claim about the printing.
   */
  coverUrl: string | null;
  /**
   * Sentences that belong to this row and nothing else — the recording's
   * narrator, the two catalogs spelling a series differently, the **provenance**
   * of a cross-catalog match, the staleness caveat.
   *
   * ⚠️ Provenance is the load-bearing one. Migration 0010's rule is that
   * `matched_via` is shown and never hidden, and this list is where it survived
   * the merge that deleted the panel it used to live in.
   */
  notes: string[];
  /**
   * The GROUP's signed answer, shown either way on an OWNED physical row whose
   * copies AGREE; null where the question does not apply (a file row, an
   * audiobook, the neutral slot, a want) **and — since 2026-09-03 — where the
   * copies DISAGREE**, because there is then no one answer for the card to give
   * and `signedVaries` hands the question down to the copies. See
   * `ShelfCopy.signed` for what `false` does and does not claim.
   */
  signed: boolean | null;
  /**
   * ⚠️ **The copies disagree about signing, so each one answers for itself**
   * (owner 2026-09-03: *"This has double information, let's normalize this."*).
   *
   * `signed` and this field are two halves of ONE answer and are never both
   * "on": all copies agreeing puts the chip on the card (`signed` non-null,
   * this false); copies differing puts a chip on every copy (this true, `signed`
   * null). It is false wherever signing does not apply at all, so a component
   * can read it without first asking whether the row is an owned physical one.
   */
  signedVaries: boolean;
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
  /**
   * ⚠️ **Only what the CARD should print** — changed 2026-09-03. It used to be
   * the plain UNION across the copies plus the printing's prose, which is what
   * printed *Sprayed edges* on a card AND on the one copy that has them. It is
   * now the badges EVERY copy shares (plus the edition's own prose badges, which
   * belong to the printing and so to all of them); a badge only some copies
   * carry has moved down to `ShelfCopy.badges`. See `splitBadges`.
   */
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

/**
 * ONE OWNED COPY, as the one line the owner asked for (2026-09-03, round 2):
 *
 * > "So hardcover / Collectors edition - sprayed edges signed / Standard edition
 * > / Standard edition - signed - lent out"
 *
 * The printing's name, and then **only what distinguishes that copy from the
 * others under the same tab**. A copy with nothing distinctive is its name
 * alone. ⚠️ *"On the shelf"* and *"Not signed"* are never printed: the absence
 * of the word IS the plain case, which is exactly the *"double information"* the
 * two rounds of this ask exist to remove.
 */
export interface ShelfCopyLine {
  /** Stable list key. */
  key: string;
  /** The copy this line is about. */
  copyId: number;
  /**
   * What to call the printing this copy is of.
   *
   * ⚠️ **Round 1's headline, verbatim — no new label was invented.** It is the
   * row's own `label`: `edition_name` → the canonical kind → the imprint → the
   * format word, and the component's *"Any format"* where even the binding is
   * unknown. So a copy nobody has linked to a printing still reads *"Hardcover"*
   * rather than borrowing a name the record never made (work 220), and the
   * owner's *"Collectors edition"* appears exactly when the copy says which
   * printing it is.
   */
  name: string;
  /** What distinguishes THIS copy, in reading order. Empty when nothing does. */
  facts: string[];
  /** `name`, or `name — fact · fact`. Composed here so a test pins what it SAYS. */
  text: string;
  /**
   * Everything the line leaves out, for the hover: the facts the header took,
   * the signed record **either way** (owner 2026-09-02 — the negative stays
   * reachable even though it stopped being printed), the status, and the
   * condition, which the owner's own example dropped from the line.
   */
  title: string;
  /** The printing's own jacket where it has one. ⚠️ Null is an absence, never the work cover. */
  coverUrl: string | null;
}

/**
 * One FORMAT TAB on the shelf and everything under it (owner 2026-09-03: *"I
 * want to see hardcover paperback cover audio ebook as the tabs and the editions
 * owned of each under"*).
 *
 * ⚠️ **A grouping of `rows`, never a second list.** `rows` here holds the same
 * objects as `ShelfView.rows`, so a fact cannot appear differently in the two —
 * the estate's "one fact, one home" rule applied to a shape rather than a page.
 */
export interface ShelfTab {
  /** Stable key — `hardcover`, `paperback`, `audio`, `ebook`, `mass market`, `physical`. */
  key: string;
  /** The word on the tab — "Hardcover", "Audio". */
  label: string;
  /**
   * The heading INSIDE the panel: the label, plus the facts every owned copy
   * under this tab shares (*"Hardcover · all signed"*). ⚠️ This is round 1's
   * rule lifted from the edition group to the FORMAT group — a fact true of
   * every copy is said once, here, and appears on no line.
   */
  header: string;
  /** True when something under this tab is a holding — this is what picks the default tab. */
  owned: boolean;
  /** One line per owned copy, in the rows' own order. */
  lines: ShelfCopyLine[];
  /**
   * The rows under this tab that are still CARDS: the audiobook recordings (they
   * carry a cover and the provenance sentence migration 0010 requires be shown),
   * the ebook files you hold with no copy row, the wishes, and the *"May be
   * yours"* printings — ⚠️ deliberately untouched by round 2, which is about how
   * OWNED copies read.
   */
  rows: ShelfRow[];
}

export interface ShelfView {
  /**
   * ⚠️ ALWAYS at least one row — the shelf is never empty (owner model). Flat and
   * in the pre-2026-09-02 order, so every existing caller and pin still reads it.
   */
  rows: ShelfRow[];
  /**
   * The same rows, under their format tabs, in the owner's order. A format with
   * nothing on it gets no tab at all.
   */
  tabs: ShelfTab[];
  /**
   * The rows that belong under NO format — the formatless *"any format"* want and
   * the never-empty *"not on your shelf"* placeholder. ⚠️ They name themselves,
   * so they are shown beside the tabs rather than filed under a tab called
   * "Other", which would be inventing a category to hold two special cases.
   */
  looseRows: ShelfRow[];
  /**
   * *"You own 2 audiobooks of this book."* — or null. The owner's 2026-08-23 ask
   * ("SAY THE NUMBER"), which came across with the panel merge. See
   * `audioCountLine`.
   */
  audioCountLine: string | null;
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
    badges.push(SIGNED_BADGE);
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

/**
 * ⚠️ **A fact is printed ONCE — on the card when every copy agrees, on the
 * copies (and only there) when they differ.** Owner, 2026-09-03, with a
 * screenshot of a three-copy Hardcover card reading *"Not signed · Sprayed
 * edges"* over three copy lines that each said *"Not signed"* again and one of
 * which said *"Sprayed edges"* again:
 *
 * > "This has double information, let's normalize this."
 *
 * So the group's badges split in two rather than being rendered twice:
 *
 *   - **`card`** — the printing's own PROSE badges (they describe the edition,
 *     so they are true of every copy of it and there is no copy to pin them on),
 *     plus every badge each and every copy carries.
 *   - **`perCopy`** — for each copy, in the same order, only what is left: the
 *     badges that copy has and the group does not share. Empty for a single-copy
 *     row, because one copy always "agrees" with itself and the card says it all.
 *
 * ⚠️ **The shared set is computed BEFORE `signed` is taken out of the card
 * list.** Signing is rendered as a two-state chip rather than a badge, so it is
 * dropped from whichever list the chip is about to speak for — and dropping it
 * from `card` must not push it back down onto the copies, which is exactly the
 * double-print this function exists to remove.
 *
 * The card list keeps `mergeBadges`' ordering so a badge does not move about the
 * row depending on which copy happened to carry it.
 */
function splitBadges(
  copies: CopyView[],
  edition: EditionView | null,
): { card: SpecialEditionBadge[]; perCopy: SpecialEditionBadge[][]; sharedKeys: Set<string> } {
  // ⚠️ The copy's own COLUMNS only. The printing's prose is handled once, below,
  // as an edition-level fact — reading it per copy is what let one printing's
  // blurb light the same badge on the card and on all of its copies.
  const own = copies.map((c) => specialEditionBadges(c, null));
  const sharedKeys = new Set(specialEditionBadges(null, edition).map((b) => b.key));
  for (const b of own[0] ?? []) {
    if (own.every((list) => list.some((x) => x.key === b.key))) sharedKeys.add(b.key);
  }
  return {
    card: mergeBadges(copies, edition).filter((b) => sharedKeys.has(b.key)),
    perCopy: own.map((list) => list.filter((b) => !sharedKeys.has(b.key))),
    sharedKeys,
  };
}

function toShelfCopy(
  copy: CopyView,
  /**
   * ⚠️ What this copy alone should print — `splitBadges`' share, REQUIRED. It
   * was `specialEditionBadges(copy, edition)` until 2026-09-03; a default that
   * reproduced the old union would be a silent way back to printing a fact
   * twice, so the caller must say which list it means.
   */
  badges: SpecialEditionBadge[],
): ShelfCopy {
  return {
    id: copy.id,
    status: copy.status,
    location: copy.location,
    condition: copy.condition,
    // Rendered only when the server actually sent a name — a redacted person
    // arrives null and the row simply carries the status word (`Copies.tsx`
    // documents why "nobody recorded" would be a claim without evidence).
    personName: copy.person_name,
    badges,
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
 * The pill's word and its tooltip for each state — the words the component used
 * to hold, moved here so one test pins what a row CLAIMS.
 *
 * ⚠️ `available` has two wordings and choosing between them is the whole
 * anti-fabrication rule of the 2026-09-02 merge. *"Available"* asserts you do
 * not own this printing. That assertion is only safe when nothing on your shelf
 * could BE it; where an unlinked copy could, the row says *"May be yours"* and
 * points at the one action that settles it. See the file header.
 */
function stateWords(
  state: ShelfRow['state'],
  couldBeYours = false,
): { stateLabel: string; stateTitle: string } {
  switch (state) {
    case 'owned':
      return {
        stateLabel: 'Owned',
        stateTitle: 'A copy is on your shelf, or it is a file you hold',
      };
    case 'wanted':
      return {
        stateLabel: 'Wanted',
        stateTitle: 'A wishlist copy wants this; you have no copy of it yet',
      };
    case 'available':
      return couldBeYours
        ? {
            stateLabel: 'May be yours',
            stateTitle:
              'This printing exists and nothing on your shelf is linked to it — but you hold an ' +
              'unlinked copy it could be, so the catalog will not claim either way. Say which ' +
              'printing you own under Editions & copies and this row answers properly.',
          }
        : {
            stateLabel: 'Available',
            stateTitle: 'This version of the book exists — you have no copy of it',
          };
    case 'neutral':
      return {
        stateLabel: 'Not on your shelf',
        stateTitle: 'You do not own or want this yet — nothing is recorded on your shelf',
      };
  }
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
  const state = r.neutral ? 300 : r.owned ? 0 : r.state === 'wanted' ? 100 : 200;
  const med = r.medium === 'physical' ? 0 : r.medium === 'ebook' ? 1 : r.medium === 'audio' ? 2 : 3;
  return state + med;
}

/** Rank WITHIN one section: what you hold, then what you want, then what merely exists. */
function stateRank(r: ShelfRow): number {
  return r.state === 'owned' ? 0 : r.state === 'wanted' ? 1 : r.state === 'available' ? 2 : 3;
}

function buildRows(
  copies: CopyView[],
  editions: EditionView[],
  ebookHolding: WorkEbookHolding | null,
  audiobookHolding: WorkAudiobookHolding | null,
  audioEditions: WorkAudioEdition[],
  audioCount: number,
  title: string | null,
  ourSeries: string | null,
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
  //
  // ⚠️ The ambiguous case marks NOTHING used — corrected 2026-09-02. It used to
  // add the first candidate to `usedEditionIds` and then return null, which was
  // invisible while an unclaimed printing rendered no row at all. Now that one
  // does (step 6), that stray mark would silently swallow exactly one of work
  // 220's two hardcover printings.
  function claimPhysicalEditionFor(format: string): EditionView | null {
    const ofFormat = physicalEditions.filter((pe) => pe.format === format);
    if (ofFormat.length !== 1) return null;
    const e = ofFormat.find((pe) => !usedEditionIds.has(pe.id));
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
    // ⚠️ Print each fact ONCE (owner 2026-09-03). The card carries what every
    // copy agrees on; anything the copies disagree about lives on the copies.
    const signedValues = sorted.map((c) => !!c.is_signed);
    const signedAgree = signedValues.every((v) => v === signedValues[0]);
    // Signed is a two-state CHIP, not a light-when-set badge, so it comes out of
    // whichever badge list the chip is about to speak for.
    const signedOnCard = owned && signedValues.length > 0 && signedAgree;
    const signedVaries = owned && signedValues.length > 1 && !signedAgree;
    const split = splitBadges(sorted, edition);
    return {
      key: edition ? `${prefix}-e${edition.id}` : `${prefix}-${format}`,
      format: fmtLabel,
      label,
      labelSource,
      meta,
      resolvedBy,
      state: owned ? 'owned' : 'wanted',
      ...stateWords(owned ? 'owned' : 'wanted'),
      href: null,
      // The printing's OWN cover when it has one — never the work's, which the
      // component supplies as the fallback. An absence stays an absence.
      coverUrl: edition?.cover_url ?? null,
      notes: [],
      // Signed, either way — but only for something you HOLD (a wanted row is a
      // wish, and a wish has no object to have been signed), and only when the
      // copies AGREE. ⚠️ It used to be `.some()`, which answered "at least one of
      // these is signed" on a card whose copies then each answered again.
      signed: signedOnCard ? signedValues[0]! : null,
      signedVaries,
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
      badges: signedOnCard ? split.card.filter((b) => b.key !== 'signed') : split.card,
      copies: sorted.map((c, i) =>
        toShelfCopy(
          c,
          // The copy's own chip answers signing when the copies differ, so the
          // badge would say it twice on that copy's own line.
          signedVaries ? split.perCopy[i]!.filter((b) => b.key !== 'signed') : split.perCopy[i]!,
        ),
      ),
    };
  }

  /**
   * A printing this shelf holds no copy of and no wish for — the owner's *"other
   * editions available under their given section"*.
   *
   * ⚠️ `couldBeYours` is not decoration; see `stateWords` and the file header.
   * It is true when an unlinked held copy could be a copy of THIS printing, and
   * it is the difference between the shelf asserting something it cannot know
   * and the shelf saying so.
   */
  function availableEditionRow(edition: EditionView, couldBeYours: boolean): ShelfRow {
    const fmtLabel = formatLabel(edition.format);
    const identity = editionIdentity(edition);
    return {
      key: `avail-e${edition.id}`,
      format: fmtLabel,
      label: identity?.text ?? fmtLabel,
      labelSource: identity ? identity.source : 'format',
      meta: joinMeta([
        identity ? fmtLabel : null,
        identity?.source === 'imprint' ? null : imprintOf(edition),
        edition.collects ? `contains ${edition.collects}` : null,
      ]),
      // Nothing had to be attributed — the row IS the printing.
      resolvedBy: 'edition',
      state: 'available',
      ...stateWords('available', couldBeYours),
      href: null,
      coverUrl: edition.cover_url ?? null,
      notes: [],
      // ⚠️ Null, not false. Signing is a fact about an OBJECT and there is no
      // object here; "Not signed" over a printing nobody holds would be an
      // answer to a question that was not asked.
      signed: null,
      // No copies, so nothing can disagree; the prose badges above are the
      // printing's own and the card is the only place they could go.
      signedVaries: false,
      medium: mediumOfFormat(edition.format),
      editionName: edition.edition_name ?? null,
      kind: edition.edition_kind ?? null,
      collects: edition.collects ?? null,
      owned: false,
      neutral: false,
      count: null,
      // The printing's own prose only — there are no copies to read booleans off.
      badges: mergeBadges([], edition),
      copies: [],
    };
  }

  /**
   * One recording in the sibling audiobook catalog — the rows that used to be
   * the "Other versions available" panel.
   *
   * ⚠️ Everything that panel said survives here: the narrator (the fact that
   * tells two recordings of one book apart), the series-spelling disagreement,
   * the authors, the **provenance sentence**, and the staleness caveat. It also
   * keeps that panel's link, because a stale row is still worth following.
   */
  function audioRow(
    key: string,
    rec: {
      title: string;
      authors: string | null;
      series: string | null;
      indexDisplay: string | null;
      coverHref: string | null;
      matchedVia: string;
      titleSimilarity: number | null;
      staleAt: string | null;
      narrator?: string | null;
      /** ⚠️ Two names for ONE thing — that catalog's verbatim title.
       *  `rawTitle` on a `WorkAudiobookHolding` (migration 0340); `audioKey` on
       *  a `WorkAudioEdition` (0390, where the same string is the row's
       *  identity). Both are absent on the series-link rung, and the link then
       *  falls back to `title` exactly as it always did. See
       *  `audiobookDetailUrl` for what this buys, measured. */
      rawTitle?: string | null;
      audioKey?: string | null;
      /** The owner's standing verdict — migration 0450. Only `'confirmed'`
       *  reaches this function with any effect: it rewords the provenance
       *  sentence. A `'rejected'` recording never becomes a row at all. */
      review?: 'confirmed' | 'rejected' | null;
    },
    count: number | null,
  ): ShelfRow {
    const live = rec.staleAt == null;
    const notes: string[] = [];
    if (rec.narrator) notes.push(`Read by ${rec.narrator}`);
    // Only worth a line when the two catalogs actually disagree — saying it
    // unconditionally would turn the ordinary case into noise.
    if (rec.series && rec.series !== ourSeries) {
      notes.push(
        `Filed there under “${rec.series}”${ourSeries ? `, not “${ourSeries}”` : ''} — the two catalogs spell this series differently.`,
      );
    }
    if (rec.authors) notes.push(rec.authors);
    // ⚠️ Provenance, in words, never hidden — migration 0010's rule, carried
    // through the merge that deleted the panel it used to live on.
    notes.push(matchProvenance(rec));
    if (!live) {
      notes.push('May be out of date — the audiobook catalog no longer confirms this match.');
    }
    return {
      key,
      format: 'Audiobook',
      label: 'Audiobook',
      labelSource: 'format',
      // The sibling catalog's own title, said only when it is not simply the
      // title already at the top of this page.
      meta: joinMeta([
        title && rec.title === title ? null : rec.title,
        rec.indexDisplay ? `(${rec.indexDisplay})` : null,
      ]),
      resolvedBy: null,
      state: live ? 'owned' : 'available',
      // ⚠️ A stale row is not "available" in the ordinary sense and its note says
      // so in the next breath; `couldBeYours` would be the wrong softening — the
      // question is not which copy is yours, it is whether the match still holds.
      ...stateWords(live ? 'owned' : 'available'),
      // ⚠️ The verbatim title is the search key, our spelling is the fallback —
      // stripping Audible's decoration is exactly what throws the volume away,
      // and on a series-named title that leaves the SERIES in the search box.
      href: audiobookDetailUrl(rec.title, rec.rawTitle ?? rec.audioKey ?? null),
      coverUrl: resolveAudiobookCover(rec.coverHref),
      notes,
      signed: null,
      signedVaries: false,
      medium: 'audio',
      editionName: null,
      kind: null,
      collects: null,
      owned: live,
      neutral: false,
      count: count != null && count > 1 ? count : null,
      badges: [],
      copies: [],
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
      resolvedBy: 'edition',
      state: 'owned',
      ...stateWords('owned'),
      href: title ? ebookShelfUrl(title) : null,
      coverUrl: e.cover_url ?? null,
      notes: [],
      signed: null,
      signedVaries: false,
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
      state: 'owned',
      ...stateWords('owned'),
      href: title ? ebookShelfUrl(title) : null,
      coverUrl: null,
      notes: [],
      signed: null,
      signedVaries: false,
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

  // 4) AUDIO — the section that absorbed "Other versions available" (owner
  //    2026-09-02). No edition table backs it: audio is not an edition of
  //    anything in this database, it is the sibling catalog's row.
  //
  //    ⚠️ The list REPLACES the single row only when it genuinely says more —
  //    `buildVersionEntries`' rule, kept verbatim through the merge. `holding` IS
  //    `audioEditions[0]` (both ordered series-first) and five other callers
  //    trust it, so a one-recording book renders from the holding and never
  //    depends on a field an older cached API response may not carry.
  //
  //    ⚠️ A STALE row still renders — as `available`, with the caveat sentence,
  //    never as a holding. The old shelf hid it (a dead "Owned on audio" claim
  //    was worse than nothing) and the old panel showed it with a note; the
  //    merged row does both halves at once, which is what neither surface could.
  //
  //    ⚠️ **A REJECTED row does NOT render, and that is a different call from
  //    the stale one** (migration 0450). Stale means the OTHER catalog stopped
  //    confirming a match that was once true, which is a fact worth showing
  //    with a caveat. Rejected means the owner has looked at this recording and
  //    said it is not this book — there is nothing left to caveat, and a row
  //    under the heading "Audio" is itself the claim. The cache row survives
  //    (0003: mark, never delete) and the edit box's Audio tab still lists it
  //    with its verdict, which is where the decision is taken back.
  //
  //    ⚠️ Filtered HERE rather than server-side on purpose: one payload feeds
  //    both the shelf and the edit box, and the edit box needs the rejected row.
  const shownEditions = audioEditions.filter((e) => e.review !== 'rejected');
  if (shownEditions.length > 1) {
    for (const e of shownEditions) rows.push(audioRow(`audio:${e.audioKey}`, e, null));
  } else if (audiobookHolding != null && audiobookHolding.review !== 'rejected') {
    // ⚠️ Still the HOLDING and not `shownEditions[0]`: five other callers trust
    // `audiobookHolding` to be the row the view picked, and a one-recording book
    // must not start depending on a field an older cached response may not
    // carry. When the holding IS the rejected one, the section is empty — which
    // is the correct answer, not a fall-through to a second-best recording.
    rows.push(audioRow('own-audio', audiobookHolding, audioCount));
  } else if (shownEditions.length === 1 && audiobookHolding?.review === 'rejected') {
    // The one shape the branch above cannot serve: two recordings on record, the
    // primary one rejected, one survivor. Render the survivor rather than an
    // empty Audio section over a book the household demonstrably owns on audio.
    rows.push(audioRow(`audio:${shownEditions[0]!.audioKey}`, shownEditions[0]!, null));
  }

  // 5) WANTED rows — genuinely wanted items only. A wish copy that links to an
  //    edition wants THAT printing; an unlinked wish groups by effective format;
  //    a formatless wish ("I want this book, in whatever comes") is one plain
  //    Wanted row. An edition nobody owns or wants is NOT a row.
  for (const g of groupByFormat(wish)) {
    if (g.format === UNSPEC_PHYSICAL && g.edition === null) {
      // A pure "want this book" with no format at all.
      const sorted = sortCopies(g.copies);
      // The 2026-09-03 once-only rule reaches here too: two wished copies that
      // differ on a badge say it on the copy, not on the card. ⚠️ A wish is
      // still never asked whether it is SIGNED — no object, no signature — so
      // `signed`/`signedVaries` stay null/false whatever the wish rows carry.
      const split = splitBadges(sorted, null);
      rows.push({
        key: 'want-any',
        format: null,
        // No format, no printing — the component words this slot itself.
        label: null,
        labelSource: null,
        meta: null,
        resolvedBy: null,
        state: 'wanted',
        ...stateWords('wanted'),
        href: null,
        coverUrl: null,
        notes: [],
        signed: null,
        signedVaries: false,
        medium: null,
        editionName: null,
        kind: null,
        collects: null,
        owned: false,
        neutral: false,
        count: null,
        badges: split.card,
        copies: sorted.map((c, i) => toShelfCopy(c, split.perCopy[i]!)),
      });
      continue;
    }
    rows.push(physicalRow('want', g.format, g.edition, g.resolvedBy, g.copies, false));
  }

  // 6) AVAILABLE — the printings this book has that your shelf accounts for
  //    NEITHER as a holding nor as a wish. Owner 2026-09-02: "other editions
  //    available under their given section. so if its a second physical there
  //    should be 2 under physical."
  //
  //    ⚠️ Runs LAST, after every claim above, so a printing an owned or wanted
  //    row already stands for is never rendered twice.
  //
  //    ⚠️ Only PHYSICAL printings reach here. An ebook edition is bytes you hold
  //    — step 2's invariant, untouched — so it is always Owned and never falls
  //    into this bucket.
  //
  //    `couldBeYours`: an unlinked held copy of this format could BE this
  //    printing, so the row must not assert you lack it. An unlinked copy of
  //    UNKNOWN physical format (`UNSPEC_PHYSICAL`) could be any physical
  //    printing, so it softens every format at once. See `stateWords`.
  const unresolvedHeldFormats = new Set(
    rows
      .filter((r) => r.owned && r.medium === 'physical' && r.resolvedBy === null && r.copies.length)
      .map((r) => r.format ?? UNSPEC_PHYSICAL),
  );
  const anyUnattributableCopy = unresolvedHeldFormats.has(UNSPEC_PHYSICAL);
  for (const e of physicalEditions) {
    if (usedEditionIds.has(e.id)) continue;
    usedEditionIds.add(e.id);
    rows.push(
      availableEditionRow(
        e,
        anyUnattributableCopy || unresolvedHeldFormats.has(formatLabel(e.format)),
      ),
    );
  }

  // 7) Never empty — but never a fabricated Want. A neutral, display-only slot.
  if (rows.length === 0) {
    rows.push({
      key: 'neutral',
      format: null,
      label: null,
      labelSource: null,
      meta: null,
      resolvedBy: null,
      state: 'neutral',
      ...stateWords('neutral'),
      href: null,
      coverUrl: null,
      notes: [],
      signed: null,
      signedVaries: false,
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

/**
 * The order the facts read in on a copy line, and it is the OWNER'S order, taken
 * from his own example rather than from the badge list:
 *
 * > "Collectors edition - sprayed edges signed" … "Standard edition - signed -
 * > lent out"
 *
 * ⚠️ **Signed comes LAST of the badges**, which is the one place this departs
 * from `specialEditionBadges`' ordering (where it is first, because the card's
 * two-state chip leads). Written the owner's way, a copy reads *"Sprayed edges ·
 * Signed"* and *"Signed · Lent out"* — both of his lines, exactly.
 */
const BADGE_LINE_ORDER = ['sprayed', 'leather', 'slipcase', 'signed'];

/**
 * How a badge every copy shares is said ONCE on the tab's header line — *"all
 * signed"*, the owner's own example (*"Hardcover · all signed"*).
 *
 * ⚠️ It is a phrase per badge and not `all ${label}`, because English does not
 * cooperate: *"all slipcase"* is not a sentence. The fallback is there so a
 * badge added later prints something rather than nothing.
 */
const SHARED_BADGE_PHRASE: Record<string, string> = {
  signed: 'all signed',
  sprayed: 'all sprayed edges',
  leather: 'all leatherbound',
  slipcase: 'all in slipcases',
};

function sharedBadgePhrase(badge: SpecialEditionBadge): string {
  return SHARED_BADGE_PHRASE[badge.key] ?? `all ${badge.label.toLowerCase()}`;
}

function badgeLineRank(badge: SpecialEditionBadge): number {
  const i = BADGE_LINE_ORDER.indexOf(badge.key);
  return i < 0 ? BADGE_LINE_ORDER.length : i;
}

/**
 * ⚠️ **Every badge true of ONE copy, put back together from the two lists round
 * 1 split it into.** `ShelfRow.badges` is what the card says (the printing's
 * prose plus what every copy of that printing shares) and `ShelfCopy.badges` is
 * what is left for that copy, so their union is that copy's whole truth — and
 * `signed`, which both lists deliberately drop because a two-state CHIP was
 * about to speak for it, comes back off `ShelfCopy.signed`.
 *
 * It is reassembled rather than carried as a third list on the type: three badge
 * lists on one copy is three chances for them to disagree, and the two that
 * exist are each defined by what they are FOR. The tab's split (below) is a
 * different question asked of the same facts — *does every copy of this FORMAT
 * share it* rather than *every copy of this PRINTING* — so it needs the facts,
 * not either answer.
 */
function copyBadges(row: ShelfRow, copy: ShelfCopy): SpecialEditionBadge[] {
  const byKey = new Map<string, SpecialEditionBadge>();
  for (const b of row.badges) byKey.set(b.key, b);
  for (const b of copy.badges) byKey.set(b.key, b);
  if (copy.signed) byKey.set(SIGNED_BADGE.key, SIGNED_BADGE);
  return [...byKey.values()].sort((a, b) => badgeLineRank(a) - badgeLineRank(b));
}

/**
 * The copy's status as one phrase, with the person when the server sent a name —
 * *"Lent out to Sam"*, *"Borrowed from Sam"*.
 *
 * ⚠️ One phrase, not the status and the person as two facts. `CopyFacts` said
 * *"Lent out · Lent to Sam"* and that is the word "lent" twice on one line, in a
 * panel whose whole ask is that a fact is said once. A redacted or unrecorded
 * person both arrive null and the phrase is then the bare status — never
 * "nobody has it", which would be a claim on no evidence (`Copies.tsx`).
 */
function statusPhrase(copy: ShelfCopy): string {
  const label = statusLabel(copy.status);
  if (!copy.personName) return label;
  if (copy.status === 'borrowed') return `${label} from ${copy.personName}`;
  if (copy.status === 'lent' || copy.status === 'sold') return `${label} to ${copy.personName}`;
  return label;
}

/**
 * One owned copy's line. `shared` is the set of badge keys every copy under the
 * tab carries — those were said once on the header and must not be said again
 * here.
 *
 * ⚠️ **Never *"On the shelf"*.** A copy that is simply where it should be says
 * nothing about its status; the word only appears for a copy that is somewhere
 * else. Same rule as *"Not signed"*, and it is the owner's: his plain copy is
 * *"Standard edition"* and nothing more.
 */
function copyLine(
  row: ShelfRow,
  copy: ShelfCopy,
  badges: SpecialEditionBadge[],
  shared: Set<string>,
): ShelfCopyLine {
  // Round 1's headline, verbatim — see `ShelfCopyLine.name`. The `?? 'Any
  // format'` is the component's own fallback for a row that names no format at
  // all, kept here so the line is never subject-less.
  const name = row.label ?? 'Any format';
  const facts = [
    ...badges.filter((b) => !shared.has(b.key)).map((b) => b.label),
    copy.status === 'owned' ? null : statusPhrase(copy),
    copy.location,
  ].filter(Boolean) as string[];
  return {
    key: `copy-${copy.id}`,
    copyId: copy.id,
    name,
    facts,
    text: facts.length ? `${name} — ${facts.join(' · ')}` : name,
    // The whole record, for the hover: everything above plus what the line drops
    // on purpose — the shared badges, the signed answer either way, the plain
    // status, and the condition.
    title: [
      name,
      ...badges.filter((b) => b.key !== SIGNED_BADGE.key).map((b) => b.label),
      copy.signed ? 'Signed' : 'Not signed',
      statusPhrase(copy),
      copy.location,
      copy.condition ? `Condition: ${copy.condition}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    coverUrl: row.coverUrl,
  };
}

/**
 * Which tab a row belongs under, and where that tab sits.
 *
 * ⚠️ **The taxonomy is deliberately MIXED, because the owner's is** — *"hardcover
 * paperback cover audio ebook"*. Hardcover and Paperback are physical FORMATS;
 * Audio and Ebook are MEDIA. Nobody asks for the EPUB tab and the MOBI tab.
 *
 * A physical format he did not name gets its own tab rather than being folded
 * into one of his, so a mass-market copy is still on the shelf; a physical copy
 * whose binding cannot be attributed at all (`UNSPEC_PHYSICAL`, work 220's
 * shape) files under the coarse word **Physical**, which is the heading the
 * shelf already used for it before the tabs.
 *
 * Returns null for a row that belongs under no format — `looseRows`.
 */
function tabOf(row: ShelfRow): { key: string; label: string; rank: number } | null {
  if (row.medium === 'audio') return { key: 'audio', label: 'Audio', rank: 40 };
  if (row.medium === 'ebook') return { key: 'ebook', label: 'Ebook', rank: 50 };
  if (row.medium !== 'physical') return null;
  const fmt = row.format;
  if (!fmt) return { key: 'physical', label: 'Physical', rank: 30 };
  if (fmt === 'Hardcover') return { key: 'hardcover', label: fmt, rank: 0 };
  if (fmt === 'Paperback') return { key: 'paperback', label: fmt, rank: 10 };
  return { key: fmt.toLowerCase(), label: fmt, rank: 20 };
}

/**
 * One tab: its header, its copy lines, and the rows that stay cards.
 *
 * ⚠️ **The shared/differing split is round 1's, lifted one level up.** Round 1
 * asked *"do all the copies of this PRINTING agree?"*; a tab holds every copy of
 * a FORMAT, which may be several printings, so it asks the same question of the
 * wider set. A fact every copy under the tab carries is said once on the header;
 * anything else is on the copy that has it.
 *
 * ⚠️ **It takes TWO copies for the split to mean anything.** With one copy there
 * is nothing to share with, and *"Hardcover · all signed"* over a single book is
 * a claim about a set of one — so a lone copy's line carries all of its own
 * facts and the header is just the format word. That is also the case the owner
 * will see on most books, and it has to read as one clean line (his *"So
 * paperback with standard under it"*).
 *
 * ⚠️ **Only BADGES lift.** Status and location stay on the copy, always: they
 * are what you scan the list FOR, and *"all lent out"* on a header hides which
 * copy is where — the fact is about the object, not about the format.
 */
function makeTab(key: string, label: string, rows: ShelfRow[]): ShelfTab {
  // Only a HOLDING becomes lines. A wish, a "May be yours" printing, an
  // audiobook and an ebook file keep the card they already had.
  const held = rows.filter((r) => r.owned && r.copies.length > 0);
  const entries = held.flatMap((row) =>
    row.copies.map((copy) => ({ row, copy, badges: copyBadges(row, copy) })),
  );

  const shared = new Set<string>();
  if (entries.length > 1) {
    for (const b of entries[0]!.badges) {
      if (entries.every((e) => e.badges.some((x) => x.key === b.key))) shared.add(b.key);
    }
  }
  const sharedPhrases = (entries[0]?.badges ?? [])
    .filter((b) => shared.has(b.key))
    .map(sharedBadgePhrase);

  return {
    key,
    label,
    header: [label, ...sharedPhrases].join(' · '),
    owned: rows.some((r) => r.owned),
    lines: entries.map((e) => copyLine(e.row, e.copy, e.badges, shared)),
    rows: rows.filter((r) => !(r.owned && r.copies.length > 0)),
  };
}

/**
 * The rows, under their format tabs — the owner's *"hardcover paperback cover
 * audio ebook as the tabs and the editions owned of each under"*.
 *
 * ⚠️ A VIEW of `rows`, holding the same objects. A tab with nothing in it is not
 * built at all, so the strip only ever offers formats this book actually has.
 * Within a tab the rows keep the state order the shelf already used: what you
 * hold, then what you want, then what merely exists.
 */
function buildTabs(rows: ShelfRow[]): { tabs: ShelfTab[]; looseRows: ShelfRow[] } {
  const looseRows: ShelfRow[] = [];
  const order: string[] = [];
  const buckets = new Map<string, { label: string; rank: number; rows: ShelfRow[] }>();

  for (const row of rows) {
    const t = tabOf(row);
    if (!t) {
      looseRows.push(row);
      continue;
    }
    let bucket = buckets.get(t.key);
    if (!bucket) {
      bucket = { label: t.label, rank: t.rank, rows: [] };
      buckets.set(t.key, bucket);
      order.push(t.key);
    }
    bucket.rows.push(row);
  }

  const tabs = [...buckets.entries()]
    // The owner's order first, then — for a format he did not name — the order
    // the rows themselves arrived in, so nothing jumps about between renders.
    .sort(([ak, a], [bk, b]) => a.rank - b.rank || order.indexOf(ak) - order.indexOf(bk))
    .map(([tabKey, bucket]) =>
      makeTab(tabKey, bucket.label, [...bucket.rows].sort((a, b) => stateRank(a) - stateRank(b))),
    );

  return { tabs, looseRows };
}

/**
 * The match's provenance as a sentence, honest about how sure it is.
 *
 * ⚠️ Moved here from `OtherVersions.tsx` when that panel was merged into the
 * shelf (owner 2026-09-02). It is the sentence migration 0010 requires be shown
 * and never hidden — 'containment' in particular is a partial-title guess and
 * says so in words, muted but not in smaller print pretending to be a footnote.
 *
 * Exported so `apps/web/test/shelf-view.test.ts` can pin the four wordings
 * directly, which is what `other-versions.test.ts` used to do.
 */
export function matchProvenance(holding: {
  matchedVia: string;
  titleSimilarity: number | null;
  /** The owner's standing verdict on this recording — migration 0450. */
  review?: 'confirmed' | 'rejected' | null;
}): string {
  const pct =
    holding.titleSimilarity != null
      ? ` (${Math.round(holding.titleSimilarity * 100)}% title match)`
      : '';
  /*
   * ⚠️ A settled match says who settled it, and it is checked FIRST because the
   * answer supersedes the guess that prompted it. Migration 0450, and the rule
   * migration 0110 states for the series-level twin: the app must not launder a
   * person's word into evidence, so this sentence says "you" and never dresses
   * itself up as a title match.
   *
   * There is deliberately no `'rejected'` branch. A rejected recording is not
   * rendered on the shelf at all (see `buildRows`); the edit box, the one
   * surface that still lists it, prints its own words for the verdict.
   */
  if (holding.review === 'confirmed') return 'Confirmed by you as the right recording.';
  if (holding.matchedVia === 'exact') return `Matched by exact title${pct}.`;
  if (holding.matchedVia === 'alias') return `Matched by alternate title${pct}.`;
  if (holding.matchedVia === 'containment') {
    /*
     * ⚠️ **A pointer, not a question** — owner ask 2026-09-03, approved 15:03.
     * It used to end *"worth a second look"*, which asked something of the
     * reader and gave them nowhere to answer it. Same doubt, same rung, but the
     * sentence now names the control that settles it once and for all.
     *
     * ⚠️ Migration 0010's rule is intact: the provenance is still SHOWN, and it
     * still says the match was partial. Rewording is allowed; removing is not.
     */
    return `Matched on a partial title${pct} — confirm it in ✎ Edit this book.`;
  }
  // Reached from `audiobook_series_link` — the owner confirmed these two series
  // are the same, and this rung matched on series + volume number, not on title.
  if (holding.matchedVia === 'series_link') {
    return 'Matched to the audiobook series you confirmed — by series and volume number.';
  }
  return `Matched via ${holding.matchedVia}${pct}.`;
}

/**
 * *"You own 2 audiobooks of this book."* — or nothing at all.
 *
 * Owner's decision, 2026-08-23: *"have it say 2 on the physical and ebook
 * libraries; on audiobook have them be different since they're different files
 * being served."* This is the physical library's half of it, moved here from
 * `OtherVersions.tsx` with that panel's merge into the shelf.
 *
 * ⚠️ **Silent below two, on purpose.** *"You own 1 audiobook of this book"* adds
 * nothing to a section already showing exactly that one audiobook.
 *
 * ⚠️ **The number is the SERVER's count, never `audioEditions.length`.** They are
 * different questions: the array carries **stale** rows so each can be shown with
 * a caveat, while this line claims the household **owns** them and counts only
 * what the sibling catalog still confirms (`stale_at IS NULL`). One live
 * recording and one withdrawn one is **two rows and no count line** — the honest
 * pair of answers rather than a contradiction.
 */
export function audioCountLine(count: number | undefined): string | null {
  if (count == null || count < 2) return null;
  return `You own ${count} audiobooks of this book.`;
}

export function deriveShelfView({
  title = null,
  copies,
  editions,
  audiobookHolding,
  audioEditions,
  audioEditionCount,
  ebookHolding,
  peerHoldings,
  ourSeries = null,
}: {
  /**
   * The work's title — the search token for a sibling-catalog link, and the
   * thing an audio row's own title is compared against before it is repeated.
   * Optional so a test can build rows without it; the page always passes it.
   */
  title?: string | null;
  copies: CopyView[];
  editions: EditionView[];
  audiobookHolding: WorkAudiobookHolding | null;
  audioEditions: WorkAudioEdition[];
  audioEditionCount: number | undefined;
  ebookHolding: WorkEbookHolding | null;
  peerHoldings: PeerHoldingView[];
  /** This work's OWN series spelling, shown on an audio row only when the two disagree. */
  ourSeries?: string | null;
}): ShelfView {
  // Audio: the count the SERVER measured, never `editions.length` (a stale
  // edition still shows a row but is not "owned"). Falls back to 1 when a holding
  // exists but the count field does not.
  //
  // ⚠️ The fallback also drops REJECTED recordings (migration 0450), matching
  // what `audioEditionCountSql` now does server-side. Both halves have to agree
  // or the badge and the row would count different things — the exact drift the
  // "one definition" rule on that fragment exists to prevent.
  const audioCount =
    audioEditionCount != null
      ? audioEditionCount
      : audiobookHolding
        ? Math.max(
            1,
            audioEditions.filter((e) => !e.staleAt && e.review !== 'rejected').length || 1,
          )
        : 0;

  const rows = buildRows(
    copies,
    editions,
    ebookHolding,
    audiobookHolding,
    audioEditions,
    audioCount,
    title,
    ourSeries,
  );

  const { tabs, looseRows } = buildTabs(rows);

  return {
    rows,
    tabs,
    looseRows,
    audioCountLine: audioCountLine(audioEditionCount),
    availability: { peers: peerHoldings },
  };
}
