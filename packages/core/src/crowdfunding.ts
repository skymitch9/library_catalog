/**
 * Telling a crowdfunded book's physical half from its digital half.
 *
 * ⚠️ This module exists because of one sentence: *"Kickstarter stuff generally
 * has a mix of physical and digital books so make sure when youre auditing
 * you're really looking close."* — the owner, 2026-08-10.
 *
 * The failure it guards against is specific and quiet. One pledge for one novel
 * delivers a deluxe hardcover **and** an EPUB. If the import records one line,
 * the catalog says the household owns a book in one format and half the pledge
 * disappears. If it records two lines but nothing distinguishes them, every
 * count double-counts the novel. Migration 0010's `pledge_item` is shaped so both
 * lines exist; this file is what says which is which, and `npm test` pins it.
 *
 * ## The ladder, in order, and why it stops where it does
 *
 *   1. **`edition.format`.** The only authoritative answer. `PHYSICAL_FORMATS`
 *      in constants.ts is the same list every other part of this app uses, so a
 *      format added there is classified here for free.
 *   2. **The campaign's own words** (`format_hint`, then the reward `title`).
 *      A scan finds "Deluxe Hardcover" long before anybody creates the hardcover
 *      edition row, and refusing to read it would make the audit report `unknown`
 *      for the entire import on day one.
 *   3. **`unknown`** — and it is a real answer, not a fallback.
 *
 * ⚠️ **There is no fourth rung and there must not be one.** Guessing from the
 * pledge tier, the amount paid or the delivery date is exactly the reasoning that
 * `isbn-ladder.md` §4.4 records going wrong: a wrong answer scored 1.00 on title
 * *and* author, twice. An `unknown` sends a person to look at the campaign page;
 * a confident guess sends nobody anywhere.
 *
 * ## ⚠️ Keyword order matters, and digital wins ties
 *
 * "Hardcover + Ebook Bundle" contains a physical word and a digital word, and it
 * is **one reward line describing two things**. It is reported as `both`, which
 * the audit treats as a line somebody has to split — not as a physical book with
 * a note. Silently choosing one is how the ebook goes missing.
 */

import { PHYSICAL_FORMATS, type EditionFormat, type EditionKind } from './constants.js';

/** What one reward line turned out to be. */
export type Medium = 'physical' | 'digital' | 'both' | 'unknown';

/**
 * Words that mean paper, in the vocabulary campaigns actually use.
 *
 * Lower-cased, matched as substrings against a lower-cased hint. Substring and
 * not word-boundary: "hardcovers", "paperback(s)" and "HC/PB" all have to hit.
 */
export const PHYSICAL_HINTS: readonly string[] = [
  'hardcover',
  'hardback',
  'hard cover',
  'paperback',
  'softcover',
  'soft cover',
  'trade pb',
  'mass market',
  'print',
  'physical',
  'signed copy',
  'slipcase',
  'boxed set',
  'box set',
  'omnibus edition',
  'leatherbound',
  'leather bound',
  'sprayed edge',
  'deluxe edition',
];

/**
 * Words that mean a file or a licence.
 *
 * ⚠️ `audiobook` is here. It is not a book this catalog will ever hold — audio
 * lives in `audiobook_catalog` and meets this app through `work_key` only
 * (constants.ts, `EDITION_FORMATS`) — but a pledge line for one is still
 * *digital*, and calling it `unknown` would put it in the queue of things a human
 * has to look at forever.
 */
export const DIGITAL_HINTS: readonly string[] = [
  'ebook',
  'e-book',
  'epub',
  'mobi',
  'azw3',
  'kepub',
  'pdf',
  'kindle',
  'digital',
  'download',
  'audiobook',
  'audio book',
  'drm-free',
  'drm free',
];

function hits(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/**
 * Read a campaign's own words. Exported so the import script can report on a
 * hint before any row exists.
 */
export function mediumFromHint(hint: string | null | undefined): Medium {
  if (!hint) return 'unknown';
  const s = hint.toLowerCase();
  const physical = hits(s, PHYSICAL_HINTS);
  const digital = hits(s, DIGITAL_HINTS);
  if (physical && digital) return 'both';
  if (physical) return 'physical';
  if (digital) return 'digital';
  return 'unknown';
}

export function mediumFromFormat(format: string | null | undefined): Medium {
  if (!format) return 'unknown';
  return (PHYSICAL_FORMATS as readonly string[]).includes(format) ? 'physical' : 'digital';
}

/** The subset of a `pledge_item` join that decides its medium. */
export interface PledgeItemSubject {
  /** `edition.format`, when the line has been matched to an edition. */
  format?: string | null;
  formatHint?: string | null;
  title?: string | null;
}

/**
 * What one reward line is, by the ladder above.
 *
 * ⚠️ A matched edition ends the question. Once `edition_id` is set the words on
 * the campaign page are evidence for the match, not a second opinion about it —
 * letting "Hardcover + Ebook Bundle" override an `ebook_epub` edition would make
 * the catalog disagree with itself about a row it already resolved.
 */
export function pledgeItemMedium(item: PledgeItemSubject): Medium {
  const byFormat = mediumFromFormat(item.format);
  if (byFormat !== 'unknown') return byFormat;

  const byHint = mediumFromHint(item.formatHint);
  if (byHint !== 'unknown') return byHint;

  return mediumFromHint(item.title);
}

/**
 * What one campaign's pledges add up to.
 *
 * ⚠️ `works` counts **distinct works**, and `lines` counts rows. They differ by
 * exactly the amount this whole design exists to preserve: a campaign delivering
 * one novel in hardcover and EPUB is `works: 1, lines: 2`. A summary that
 * reported `2` for both would be the double count; one that reported `1` for both
 * would be the disappeared ebook.
 */
export interface PledgeAudit {
  lines: number;
  works: number;
  physical: number;
  digital: number;
  /** Lines naming a physical AND a digital thing. Somebody must split these. */
  both: number;
  /** Lines nothing could classify. The queue of things to go and look at. */
  unknown: number;
  /** Lines with no `edition_id` — matched to a book, not yet to a printing. */
  unmatched: number;
  fulfilled: number;
}

export interface AuditableItem extends PledgeItemSubject {
  workId: number;
  editionId?: number | null;
  /**
   * ⚠️ A recorded verdict is an answer, not a gap — the rule `detailGaps` follows
   * in `gaps.ts`. An audiobook reward line can never have an `edition`, so
   * without this it would be reported as outstanding on every run forever.
   */
  editionVerdict?: 'none' | 'unknown' | null;
  fulfilled?: boolean | number | null;
}

export function pledgeAudit(items: readonly AuditableItem[]): PledgeAudit {
  const audit: PledgeAudit = {
    lines: items.length,
    works: new Set(items.map((i) => i.workId)).size,
    physical: 0,
    digital: 0,
    both: 0,
    unknown: 0,
    unmatched: 0,
    fulfilled: 0,
  };

  for (const item of items) {
    audit[pledgeItemMedium(item)] += 1;
    // ⚠️ A verdict closes the question. Counting a settled audiobook line as
    // "no printing" makes the queue permanently non-empty, which is the same
    // failure `gap_verdict` was added to fix for the details queue.
    if (item.editionId == null && item.editionVerdict == null) audit.unmatched += 1;
    if (item.fulfilled) audit.fulfilled += 1;
  }

  return audit;
}

/**
 * The sentence the audit prints, in the shape this project's other summaries use
 * (`completenessSentence` in completeness.ts).
 *
 * ⚠️ It leads with what is wrong. A campaign with three unsplit bundles and two
 * unclassifiable lines is a campaign somebody has to open, and a sentence that
 * opened with "6 books" would bury that.
 */
export function auditSentence(a: PledgeAudit): string {
  const problems: string[] = [];
  if (a.both > 0) problems.push(`${a.both} bundled line${a.both === 1 ? '' : 's'} to split`);
  if (a.unknown > 0) problems.push(`${a.unknown} unclassified`);
  if (a.unmatched > 0) problems.push(`${a.unmatched} with no printing`);

  const shape =
    a.works === a.lines
      ? `${a.works} book${a.works === 1 ? '' : 's'}`
      : `${a.lines} lines across ${a.works} book${a.works === 1 ? '' : 's'}`;

  const split = `${a.physical} physical, ${a.digital} digital`;
  return problems.length > 0
    ? `⚠️ ${problems.join(', ')} — ${shape}, ${split}`
    : `${shape}, ${split}`;
}

/**
 * Signed and numbered, read out of the reward's own prose.
 *
 * ⚠️ **There is no signed field on a campaign page.** Measured on the real scan:
 * *"Book 1 will be Signed & Numbered"*, *"CONQUEROR -- SIGNED PAPERBACK+"*,
 * *"Legendary Book Box (Uniquely Numbered)"*. It is prose in a reward title, and
 * that is the only place it ever appears.
 *
 * ⚠️ **These are proposals for `copy.is_signed` and `edition.edition_name`, and
 * nothing here writes either.** Those two columns have existed since migration
 * 0001 and are where the fact belongs; a `signed` column on the reward line
 * would be a second answer to "is our copy signed" with nothing keeping the two
 * in step. The importer prints this beside the line and a person ticks the box —
 * the same propose/accept rule the research pipeline obeys.
 *
 * ⚠️ Note what is NOT matched: a bare "special", "deluxe" or "premium". Those
 * mean a nicer printing, not a signature, and treating them as one would tick a
 * box that is very hard to un-believe once ticked.
 */
export function rewardFlags(text: string | null | undefined): {
  signed: boolean;
  numbered: boolean;
} {
  if (!text) return { signed: false, numbered: false };
  const s = text.toLowerCase();
  return {
    signed: s.includes('signed') || s.includes('autograph'),
    numbered: s.includes('numbered'),
  };
}

/**
 * Which `EDITION_FORMATS` value a hint suggests, or null.
 *
 * ⚠️ **A proposal, never applied automatically.** The import script prints it
 * beside the hint and a person decides — the same propose/accept rule the
 * research pipeline obeys, and for the reason `isbn-ladder.md` §4.4 gives. It is
 * here rather than in the script because it is a rule, and rules live in core.
 */
export function suggestFormat(hint: string | null | undefined): EditionFormat | null {
  if (!hint) return null;
  const s = hint.toLowerCase();
  if (s.includes('mass market')) return 'mass_market';
  if (s.includes('hardcover') || s.includes('hardback') || s.includes('hard cover')) {
    return 'hardcover';
  }
  if (s.includes('paperback') || s.includes('softcover') || s.includes('soft cover')) {
    return 'paperback';
  }
  if (s.includes('epub')) return 'ebook_epub';
  if (s.includes('mobi')) return 'ebook_mobi';
  if (s.includes('azw3')) return 'ebook_azw3';
  if (s.includes('kepub')) return 'ebook_kepub';
  if (s.includes('pdf')) return 'ebook_pdf';
  if (s.includes('kindle')) return 'ebook_kindle';

  /*
   * A bare "ebook" names no file type, and the owner's rule is that a campaign
   * offering one is offering a **choice**: "Ebook can be assumed epub. It
   * usually means I have a choice." EPUB is the one every such tier includes.
   * Kept below the specific matches so "Kindle edition" still wins.
   */
  if (s.includes('ebook') || s.includes('e-book')) return 'ebook_epub';

  /*
   * ⚠️ These name a *tier*, not a binding — and are answered anyway.
   *
   * "Collector's Edition" does not say hardcover, and this function used to
   * refuse it for that reason: a collector's edition is *usually* a hardcover,
   * and usually is not a fact. The owner overruled that on 2026-08-11 —
   * "Collector's edition is almost always hard cover books" — and they are
   * right about their own shelf: every such tier in this catalog turned out to
   * be one.
   *
   * What changed is the cost of being wrong. When this rule was written there
   * was **no way to edit an edition at all**, so a bad guess was permanent and
   * invisible. Editing shipped the same day (`PATCH /api/editions/:id`), so a
   * wrong format is now a two-tap correction — the same argument that makes the
   * barcode path's `paperback` default defensible.
   *
   * ⚠️ Still a guess, and it must stay visible as one. `edition.source` records
   * where a row came from, and the importer prints the hint beside the proposal
   * rather than swallowing it. If a paperback collector's edition ever turns up,
   * this line is why — not a data-entry mistake.
   */
  if (s.includes("collector's edition") || s.includes('collectors edition')) return 'hardcover';
  if (s.includes('leatherbound') || s.includes('leather-bound')) return 'hardcover';

  return null;
}

/**
 * Words that mean *this printing was sold as better than the standard one*.
 *
 * Lower-cased, matched as substrings against a lower-cased and
 * apostrophe-folded string, exactly like `PHYSICAL_HINTS` above. Substring and
 * not word-boundary, for the same reason: "Exclusive", "exclusives" and
 * "Campaign-only exclusive hardcover" all have to hit.
 *
 * ⚠️ **Every entry describes the OBJECT, and none describes its CONTENTS.**
 * That line is what keeps `omnibus`, `volume`, `book 1`, `trilogy` and `boxed
 * set` off this list — see the exclusions on `classifyEdition`. It is also why
 * this is a separate list from `PHYSICAL_HINTS`, which shares four words with it
 * and answers a completely different question: `deluxe edition` is on that list
 * because it implies paper, and on this one because it implies fancy paper.
 */
export const COLLECTORS_HINTS: readonly string[] = [
  "collector's",
  'collectors edition',
  'deluxe',
  'exclusive',
  'premium',
  'limited edition',
  'special edition',
  'anniversary edition',
  'signed',
  'numbered',
  'leatherbound',
  'leather bound',
  'leather-bound',
  'slipcase',
  'sprayed edge',
];

/**
 * One canonical bucket for every way a vendor spells "fancy".
 *
 * ⚠️ **The counterpart to `suggestFormat`, and it answers a different question
 * about the same string.** `suggestFormat` asks *what is this made of* and
 * returns an `EDITION_FORMATS` value; this asks *what kind of printing is it*
 * and returns an `EDITION_KINDS` value. They disagree on purpose and both are
 * right: `"Deluxe Edition"` names no binding, so `suggestFormat` refuses it and
 * returns null, while this returns `'collectors'` — the string says nothing
 * about paper and everything about the tier.
 *
 * ⚠️ **Unlike `suggestFormat` this one IS applied automatically**, by the
 * importers and by `scripts/backfill-edition-kinds.mjs`, and that is a departure
 * from the propose/accept rule the rest of this module obeys. The reason is what
 * is at stake in a wrong answer. A wrong `format` claims a fact about a physical
 * object — that the hardcover on the shelf is a paperback — and `isbn-ladder.md`
 * §4.4 records what confident guessing costs. A wrong `kind` claims only that a
 * printing is or is not fancy, `edition_name` sits beside it holding the exact
 * words the vendor used, and the collection has a filter for reviewing them. The
 * owner asked for it in as many words: *"all editions should be collectors and
 * we can fix them one off if needed."*
 *
 * ## ⚠️ What it refuses, and why the refusals are not pedantry
 *
 * Three real `edition_name` values in production must NOT become collector's
 * editions, and all three were checked against this function by name:
 *
 *   * **"Omnibus - collects volumes 1-3"** and **"Volume 1"** — both *White
 *     Sand*. They describe **what is inside the book**, not how it was printed.
 *     An omnibus is an ordinary trade printing that happens to contain three
 *     volumes, and White Sand is the original "alternate copies of stuff we
 *     already own" case that the whole series restructure was built around, so
 *     mislabelling it breaks the feature's own worked example.
 *   * **"ebook"** — junk that leaked out of a crowdfunding reward name. The row's
 *     `format` is already `ebook_epub`, so the name adds nothing; the backfill
 *     clears it to NULL rather than categorising it.
 *
 * Nothing here vetoes: the refusals work because no contents word is on
 * `COLLECTORS_HINTS` in the first place. That matters for the combination —
 * "Omnibus Collector's Edition" is a real product and is correctly `'collectors'`,
 * which a blacklist on the word "omnibus" would get wrong.
 */
export function classifyEdition(
  text: string | null | undefined,
  /**
   * ⚠️ **An ebook is an ordinary printing unless a person says otherwise.**
   *
   * The owner's rule, 2026-08-11: *"basically all ebooks are going to be normal
   * editions and not special editions unless we state otherwise."* And they are
   * right about what these strings mean — a file is a file. The words that make
   * a printing collectible are all about the *object*: leatherbound, sprayed
   * edges, a slipcase, a signature. A reward tier named "Deluxe Edition" that
   * delivers an EPUB is describing the pledge, not the bytes.
   *
   * So format vetoes the keywords, rather than the keywords being trimmed. The
   * hint list stays honest about physical books, and a campaign's marketing
   * language cannot leak a "collector's" EPUB into the filter.
   *
   * ⚠️ This is a veto on **automatic** classification only. `PATCH
   * /api/editions/:id` still accepts a hand-set kind, which is exactly what
   * "unless we state otherwise" means — a numbered digital art book is a real
   * thing and a person can say so.
   *
   * Omitted entirely means "format unknown", and the keywords decide as before;
   * callers that have a format should pass it.
   */
  format?: string | null,
): EditionKind | null {
  if (!text) return null;
  if (format && !(PHYSICAL_FORMATS as readonly string[]).includes(format)) return null;
  // ⚠️ The curly apostrophe is folded first. A vendor page that writes
  // "Collector’s Edition" with U+2019 is the same product as one that writes
  // "Collector's Edition", and a substring test that cannot see that would file
  // half the shelf as ordinary. Measured names in this catalog use the ASCII
  // form; the fold is here so the first one that does not still lands.
  const s = text.toLowerCase().split('’').join("'");
  return hits(s, COLLECTORS_HINTS) ? 'collectors' : null;
}
