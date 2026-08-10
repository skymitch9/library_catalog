/**
 * Leaf module: is this the same book, on evidence other than its name?
 *
 * Imports `titles.ts` and `matching.ts`. No I/O, no types from `@lc/isbn` — the
 * facts a candidate offers arrive as a structural interface, the same way
 * `matching.ts` takes `WorkAliasRef` rather than a database row.
 *
 * ## ⚠️ Why this exists at all: the gate in `matching.ts` cannot catch the worst case
 *
 * `docs/info/isbn-ladder.md` §4.4, measured 2026-08-09 against this household's
 * own catalog. Open Library's fielded search was asked for "Firefight" by
 * "Brandon Sanderson" and returned:
 *
 * ```json
 * { "title": "Firefight", "authors": "Brandon Sanderson",
 *   "publisher": "Random House Books for Young Readers", "publishedYear": 2001,
 *   "similarity": 1, "authorSimilarity": 1 }
 * ```
 *
 * Sanderson's *Firefight* is Delacorte, 2015. This is a **different book with
 * the same name by the same author**, and it scores a perfect 1.0 on both axes
 * because the title string and the author string are exactly right. **No
 * similarity threshold can separate it, because there is nothing textual to
 * separate.** Only the publisher and the year did.
 *
 * So the rule this module encodes, and the one it exists to make unavoidable:
 *
 * > **Title and author agreement is necessary and never sufficient.** A match
 * > that nobody confirmed needs at least one fact about the *printing* — who
 * > published it, when, or what line it belongs to — to agree as well.
 *
 * ## What is a strong corroborator and what is not
 *
 * | | Corroborator | Why |
 * |---|---|---|
 * | strong | `isbn` | the artefact naming itself, not a search result |
 * | strong | `publisher` | the discriminator §4.4 says was the only one that worked |
 * | strong | `series+volume` | "Cradle, Volume Five" agreeing with a volume we hold independently is not a coincidence a wrong book produces |
 * | weak | `series` | the series name alone; a sequel or a boxed set shares it |
 * | weak | `year` | one year in a plausible range is a 1-in-*n* coincidence, not proof |
 *
 * Two weak ones make a high-confidence match; one does not. That is the whole
 * arithmetic, and it is deliberately arithmetic rather than a tuned score —
 * `matching.ts` opens with three wrong matches the sibling project shipped from
 * a second similarity function drifting from the first, and a weighted score
 * here would be exactly that mistake with more decimal places.
 */

import { normaliseTitle, parseVolumeNumber } from './titles.js';
import { titleSimilarity } from './matching.js';

export type Corroborator = 'isbn' | 'publisher' | 'series+volume' | 'series' | 'year';

const STRONG: readonly Corroborator[] = ['isbn', 'publisher', 'series+volume'];

/** What this catalog independently holds about a work, beyond title and author. */
export interface OurFacts {
  /** `work.series`, as this catalog spells it. */
  series?: string | null;
  /** `work.series_index_sort`. */
  volume?: number | null;
  /** The publisher the EPUB file declares — `work` does not carry one. */
  publisher?: string | null;
  /** The year the EPUB file declares — `work.first_published` is null on every row. */
  year?: number | null;
  /** A checksum-valid ISBN-13 read out of the file's own `<dc:identifier>`. */
  isbn13?: string | null;
}

/** What a candidate offers back, gathered from its Open Library edition records. */
export interface CandidateFacts {
  /** Every `series` and `subtitle` string across every edition, deduplicated. */
  seriesStrings?: readonly string[];
  /** Every publisher across every edition, plus the search index's. */
  publishers?: readonly string[];
  /** Every four-digit publication year seen, plus `first_publish_year`. */
  years?: readonly number[];
  /** Every ISBN-13 across every edition. */
  isbn13s?: readonly string[];
}

export interface CorroborationResult {
  strong: Corroborator[];
  weak: Corroborator[];
  /** One human-readable line per corroborator that fired, for the ledger. */
  evidence: string[];
  confidence: 'high' | 'medium' | 'none';
}

// ---------------------------------------------------------------------------
// Publisher
// ---------------------------------------------------------------------------

/**
 * Fold a publisher name to the part that identifies it.
 *
 * ⚠️ The suffix list is the whole trick and it is also the whole risk. This
 * catalog's files say "Dragonsteel Entertainment, LLC" and "Dragonsteel, LLC"
 * for the same publisher, and Open Library says "Dragonsteel Entertainment".
 * Stripping the corporate furniture makes those three one name.
 *
 * Stripping *too much* is how a corroborator becomes a rubber stamp — drop
 * "Books" and "Press" from everything and half the publishing industry folds
 * together. So only legal-form words and the two most generic trade words go,
 * and the comparison below still requires substantial word overlap on what is
 * left rather than accepting any shared token.
 */
const PUBLISHER_NOISE =
  /\b(llc|l l c|inc|incorporated|ltd|limited|co|company|corp|corporation|gmbh|plc|pty|publishing|publishers|publications|group|imprint|an imprint of)\b/g;

export function foldPublisher(raw: string): string {
  return normaliseTitle(raw)
    .replace(PUBLISHER_NOISE, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Do two publisher names denote the same house?
 *
 * Containment counts, because an imprint is genuinely the house that owns it for
 * this purpose: "Delacorte" inside "Delacorte Press" is the same printing, and
 * "Random House Books for Young Readers" against "Random House" is the same
 * corporate parent. What must NOT count is Random House against Dragonsteel,
 * which is exactly the Firefight case, and no amount of folding brings those
 * together.
 */
export function samePublisher(a: string, b: string): boolean {
  const x = foldPublisher(a);
  const y = foldPublisher(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  return titleSimilarity(x, y) >= 0.6;
}

// ---------------------------------------------------------------------------
// Series and volume
// ---------------------------------------------------------------------------

/** Every significant word of a folded name. Words of one character are noise. */
function words(s: string): string[] {
  return normaliseTitle(s).split(' ').filter((w) => w.length > 1);
}

/**
 * Is our series name present inside one of Open Library's series/subtitle strings?
 *
 * Subset rather than similarity: "Cradle" must be *in* "Cradle, Volume Five",
 * and the extra words in the OL string are the volume label rather than a
 * disagreement. Requiring every one of our words to appear is what stops
 * "Skyward" matching "Skyward Flight".
 */
export function seriesMentioned(olText: string, ourSeries: string): boolean {
  const ours = words(ourSeries);
  if (ours.length === 0) return false;
  const theirs = new Set(words(olText));
  return ours.every((w) => theirs.has(w));
}

/**
 * Is our volume number stated in the same string?
 *
 * Arabic, word and Roman all count — `parseVolumeNumber` already knows all three
 * because *Rise of the Weakest Summoner: Volume XI* is printed that way, and it
 * is reused here rather than re-derived (see the header on `matching.ts` for
 * what a second implementation costs).
 *
 * ⚠️ A bare number is only accepted when it follows a marker word. The same rule
 * `cleanAudiobookTitle` records: Eric Vall's books really are called "Summoner
 * 6", and a rule that read every trailing digit as a volume would corroborate
 * volume 6 against any title with a 6 in it.
 */
const VOLUME_MARKERS = new Set(['book', 'volume', 'vol', 'part', 'no', 'number']);

/**
 * What volume number does this string state, if any?
 *
 * The extracting half of `volumeMentioned`. Corroboration only ever needed
 * "does it say OUR number", but auditing our own `series_index_sort` against
 * Open Library needs the number itself — you cannot report a disagreement you
 * cannot name.
 *
 * Same marker rule, deliberately shared rather than re-derived: a bare trailing
 * digit is never a volume, because Eric Vall's book really is called
 * *Summoner 6*.
 *
 * Returns the FIRST marker-led number. A string stating two different volumes
 * is not something to average.
 */
export function volumeStatedIn(olText: string): number | null {
  const tokens = normaliseTitle(olText).split(' ').filter(Boolean);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!VOLUME_MARKERS.has(tokens[i] as string)) continue;
    const n = parseVolumeNumber(tokens[i + 1] as string);
    if (n !== null) return n;
  }
  return null;
}

export function volumeMentioned(olText: string, ourVolume: number): boolean {
  return volumeStatedIn(olText) === ourVolume;
}

// ---------------------------------------------------------------------------

/**
 * Weigh a candidate on everything except its name.
 *
 * The caller has already applied `matching.ts`'s title and author gates; this
 * answers the separate question §4.4 forces, which is whether anything other
 * than the name agrees.
 */
export function corroborate(ours: OurFacts, theirs: CandidateFacts): CorroborationResult {
  const strong: Corroborator[] = [];
  const weak: Corroborator[] = [];
  const evidence: string[] = [];

  if (ours.isbn13 && (theirs.isbn13s ?? []).includes(ours.isbn13)) {
    strong.push('isbn');
    evidence.push(`ISBN ${ours.isbn13} is on an edition of this work`);
  }

  if (ours.publisher) {
    const hit = (theirs.publishers ?? []).find((p) => samePublisher(p, ours.publisher as string));
    if (hit) {
      strong.push('publisher');
      evidence.push(`publisher "${ours.publisher}" matches Open Library's "${hit}"`);
    }
  }

  if (ours.series) {
    const mentioning = (theirs.seriesStrings ?? []).filter((s) => seriesMentioned(s, ours.series as string));
    const withVolume =
      ours.volume != null
        ? mentioning.find((s) => volumeMentioned(s, ours.volume as number))
        : undefined;
    if (withVolume) {
      strong.push('series+volume');
      evidence.push(`an edition is labelled "${withVolume}" — our series AND volume ${ours.volume}`);
    } else if (mentioning.length > 0) {
      weak.push('series');
      evidence.push(`an edition is labelled "${mentioning[0]}" — our series, volume unconfirmed`);
    }
  }

  if (ours.year != null) {
    const hit = (theirs.years ?? []).find((y) => Math.abs(y - (ours.year as number)) <= 1);
    if (hit != null) {
      weak.push('year');
      evidence.push(`our file says ${ours.year}; Open Library has an edition from ${hit}`);
    }
  }

  return {
    strong,
    weak,
    evidence,
    confidence: strong.length >= 1 ? 'high' : weak.length >= 2 ? 'high' : weak.length === 1 ? 'medium' : 'none',
  };
}

/** True for the corroborators that alone justify writing an id unattended. */
export function isStrong(c: Corroborator): boolean {
  return STRONG.includes(c);
}
