/**
 * "What am I missing" for a series — and, much more importantly, what we are
 * entitled to say we are missing.
 *
 * ⚠️ Imports nothing from `index.ts`. See the header of `constants.ts`.
 *
 * ## The whole feature is one distinction
 *
 * There are three different sentences hiding inside "you're missing a book", and
 * exactly one of them is free:
 *
 * | Sentence | Needs | Can it be wrong? |
 * |---|---|---|
 * | "You own Cradle 1, 2 and 4 — 3 is missing" | nothing | **No.** A book numbered 4 and a book numbered 2 have a book 3 between them. |
 * | "You own High School DxD 7–21 — 1–6 are missing" | nothing | **No.** Volume 7 exists, so volumes 1–6 were printed. |
 * | "You own 6 of 12" | an external source | **Yes**, and catastrophically: with nothing behind the 12 it is a lie that sorts, filters and looks exactly like data. |
 *
 * The first two are arithmetic and are computed here. The third is refused
 * outright unless something attested it, which is what `series_volume` is for
 * (migration 0003) — and even then the claim it supports is a **lower bound**,
 * "at least 16", never a total. A total may only ever be typed by a person, with
 * a source, into `series_check.known_total`.
 *
 * ## The mistake this is shaped to prevent
 *
 * **"We stop at book 13" is not the same claim as "book 13 is missing."** The
 * naive version of this function is `for (i = 1; i <= max; i++)`, which is
 * correct, followed by "…and the series probably has more", which is invented.
 * `highestOwned` is therefore where the gap scan *ends* unless a source says
 * otherwise, and `openEnded` says out loud that we do not know whether the line
 * continues. Measured against this catalog on 2026-08-10, that distinction is
 * the difference between 3 honest gaps in *Beneath the Dragoneye Moons* and a
 * fabricated claim about every unfinished series on the shelf.
 *
 * ## ⚠️ Two ways a "missing" volume is not missing — added 2026-08-11
 *
 * Both are the same failure as the third sentence above, from the other side:
 * the app saying something untrue about the shelf. Both arrive through
 * `GapContext` rather than through `volumes`, because **neither is a claim that
 * a volume exists** — the volume's existence is already settled by the time
 * either is consulted, and letting them into `volumes` would let them raise
 * `highestKnown` and start inventing books.
 *
 * | | What it is | What it does to the arithmetic |
 * |---|---|---|
 * | `audio` | the household owns that volume, in the sibling audiobook catalog (migration 0090) | the rung stays a gap — it IS absent from *this* catalog — but stops being counted as missing |
 * | `skipped` | the owner has decided never to own it (migration 0100) | the rung leaves `gaps` for `skipped`, so nothing derived from `gaps` counts it |
 *
 * The audio case is the one that was actively lying. The household holds all
 * seven Stormlight Archive audiobooks and this catalog holds one of those titles
 * as an ebook; the page read *"1 book of at least 5 — 6 missing from the run
 * itself"*, and every one of the six is in the house. See migration 0090.
 *
 * ⚠️ **An unconfirmed audio match stays counted as missing.** `matchedVia` is
 * `'fold'` when nothing but a folded series name connects the two catalogs, and
 * a hedge that removed a book from the missing list would be a certainty wearing
 * a question mark. It earns a separate, quieter clause instead.
 */

/** A volume of a series, owned or merely attested. */
export interface SeriesVolumeInput {
  /** Its place on the number line. */
  index: number;
  /**
   * The `series_volume` row, when the volume is one somebody recorded.
   *
   * Carried all the way to the UI so a hand-entered volume can be withdrawn from
   * the page that shows it. Without it a typo is unfixable outside SQL, which is
   * the state the sibling project's `manual_state` column was added to avoid.
   */
  volumeId?: number | null;
  /** What the cover says: "Book 7", "Volume 07". */
  display?: string | null;
  title?: string | null;
  authors?: string | null;
  /** The catalog row, when this volume is catalogued at all. */
  workId?: number | null;
  /**
   * ⚠️ Catalogued, but only as a wish.
   *
   * A `work` row means the book is *known to this catalog*, which for the 115
   * rows imported from ebook files is the same thing as having it. It stops
   * being the same thing the moment a wishlist exists: putting a missing volume
   * on the list creates a work, and without this flag the series would
   * immediately report that volume as owned — the gap would close because you
   * said you wanted it. Observed in a browser the first time the two features
   * met, which is the only way it would ever have been found.
   *
   * ⚠️ The caller decides this, and the rule has to be **narrow**, because
   * `copy` is a table with nothing in it. Measured 2026-08-10: 117 works, 118
   * editions, **0 copies of any status**. So "has no owned copy" says nothing
   * whatever about whether a book is in the house, and a rule built on it would
   * report the entire shelf missing.
   *
   * The narrowest rule that still catches the case this flag exists for — a work
   * the wishlist button just created — is: no editions at all, and every copy it
   * has is a wishlist status. That is "there is no evidence this book exists on
   * our side, and somebody said they want it". See `reportFor` in
   * `packages/db/src/series.ts`, where it is applied.
   *
   * The rule was reached the hard way: the first version was "all copies are
   * wishlist statuses", and wanting a *hardcover* of Cradle 1 — held as an EPUB
   * — made the series report Cradle as 11 of 12 with book 1 missing.
   */
  wanted?: boolean;
  /** Who said it exists. Null when the answer is "we own it, that is how we know". */
  source?: string | null;
  sourceUrl?: string | null;
  note?: string | null;
  /** Set when the source stopped listing it. Shown, never deleted. */
  staleAt?: string | null;
}

/**
 * How strong the claim that a volume is missing actually is.
 *
 * Rendered differently on purpose. `interior` and `earlier` are arithmetic;
 * `attested` is somebody's word, and the UI names whose.
 */
export type GapEvidence =
  /** Between two volumes we own. Certain. */
  | 'interior'
  /** Below the lowest volume we own. Certain — a book 7 implies a book 1. */
  | 'earlier'
  /** A source names this exact volume. As good as the source. */
  | 'attested'
  /**
   * Above our top, not itself named, but below a volume a source *does* name.
   *
   * Two steps, both sound: the source says a book 4 exists, and a book numbered
   * 4 implies a book 3. Kept apart from `attested` because it inherits the
   * source's fallibility without inheriting its title — the real case is
   * *Legion*, where the sibling catalog lists a book 4 (the omnibus) and says
   * nothing at all about book 3, which is *Lies of the Beholder*.
   */
  | 'implied';

/**
 * How firmly the two catalogs' series names were shown to mean one series.
 *
 * ⚠️ Not the same question as migration 0010's `matched_via`, which is one title
 * meeting another. See migration 0090 for both values in full.
 */
export type AudioSeriesMatch =
  /** A work we hold corroborated the name mapping AND the numbering. Firm. */
  | 'work_match'
  /** The names merely fold onto one key. Nothing confirmed it. Hedged. */
  | 'fold';

/**
 * A volume of this series the household owns on audio — cached by migration
 * 0090, because the Worker cannot read the sibling catalog's CSV.
 *
 * ⚠️ It never says a volume *exists*; `series_volume` does that, from the same
 * file, and by construction there is a row there for every row here. This only
 * answers "that one, you have".
 */
export interface SeriesAudioInput {
  index: number;
  /** Its title over there, which is not always the one we would print. */
  title: string;
  authors: string | null;
  /** That catalog's own series spelling. Shown when it differs from ours. */
  audiobookSeries: string;
  indexDisplay: string | null;
  matchedVia: AudioSeriesMatch;
}

/** The owner's decision never to own one rung. Migration 0100. */
export interface SeriesSkipInput {
  index: number;
  /** Why, in their words. Not evidence — a reminder. See migration 0100. */
  reason: string;
  note?: string | null;
  decidedAt?: string | null;
}

/**
 * Facts about rungs that are neither "we hold it" nor "a source named it".
 *
 * ⚠️ Deliberately a fourth argument and not part of `volumes`. Nothing in here
 * may raise `highestKnown` — see the header. An `earlier` gap is also reachable
 * from here and from nowhere else: it is pure arithmetic, so it has no
 * `series_volume` row to hang a flag on.
 */
export interface GapContext {
  audio?: readonly SeriesAudioInput[];
  skipped?: readonly SeriesSkipInput[];
}

export interface SeriesGap {
  index: number;
  /** The `series_volume` row behind it, when a source named this volume. */
  volumeId: number | null;
  /** The catalog row, when the volume is catalogued as a wish. */
  workId: number | null;
  /** Already on the wishlist — still missing, but nothing left to decide. */
  wanted: boolean;
  evidence: GapEvidence;
  /** Only when a source named it. Null means "the number, and nothing else". */
  title: string | null;
  authors: string | null;
  display: string | null;
  source: string | null;
  sourceUrl: string | null;
  note: string | null;
  staleAt: string | null;
  /**
   * ⚠️ Owned on audio — absent from THIS catalog, present in the house.
   *
   * The rung stays a gap because it genuinely is one: there is no ebook and no
   * printing here, and "buy the paperback" is still a decision somebody might
   * make. What it stops being is *missing*, which is the word that was wrong.
   */
  audio: SeriesAudioInput | null;
  /** Set only on a rung in `skipped`. Never on one in `gaps`. */
  skipped: SeriesSkipInput | null;
}

export interface SeriesCompleteness {
  series: string;
  /** Works we hold in this series, numbered or not. */
  owned: number;
  /**
   * Works we hold whose volume number is unknown or unplaceable.
   *
   * Real and not an error: the six *Seirei Tsukai no Blade Dance* "Extra" side
   * stories, and *White Sand*, whose three 160pp volumes cannot be told apart
   * from the file. They are excluded from gap arithmetic and counted here so the
   * page can say why the numbers do not add up.
   */
  unnumbered: number;
  lowestOwned: number | null;
  highestOwned: number | null;
  /** The highest volume anything — us or a source — says exists. */
  highestKnown: number | null;
  /**
   * Volumes we do not have here. ⚠️ Skipped rungs are NOT in this list.
   *
   * Every count in this object that is about absence is derived from it, so
   * moving a rung out of it is the one edit that keeps two screens agreeing.
   */
  gaps: SeriesGap[];
  /**
   * Rungs the owner has decided never to own. Migration 0100.
   *
   * Kept as full rungs rather than a count so the ladder can still draw them,
   * with their reason and an undo. A skipped book that vanishes from the page is
   * indistinguishable from one nobody has noticed.
   */
  skipped: SeriesGap[];
  /** Missing volumes already on the wishlist. A subset of `gaps`. */
  wanted: number;
  /**
   * Gaps we worked out ourselves. Cannot be wrong.
   *
   * ⚠️ Excludes rungs confidently held on audio, and that is the fix for the
   * whole bug: this number is what the series list prints as "N missing", and
   * counting a book the owner owns was the lie. `gaps.length` is still the
   * count of rungs absent from *this* catalog, which is a different question.
   */
  certainGaps: number;
  /** Gaps that rest on a source. Named in the UI. Same audio exclusion. */
  attestedGaps: number;
  /** Gaps the household owns on audio — `matchedVia: 'work_match'`. */
  onAudio: number;
  /**
   * Gaps that *may* be held on audio — `matchedVia: 'fold'`.
   *
   * ⚠️ These are still inside `certainGaps` / `attestedGaps`. A hedge does not
   * cross a book off a list.
   */
  maybeOnAudio: number;
  /**
   * A total, if and only if a person typed one with a source.
   *
   * Nothing derives this. See `series_check.known_total` in migration 0003.
   */
  knownTotal: number | null;
  knownTotalSource: string | null;
  /**
   * ⚠️ True whenever we do not know how long the series is — i.e. almost always.
   *
   * With this true the app may say "at least N" and must never say "complete".
   */
  openEnded: boolean;
  /** Whether any source has been consulted about this series at all. */
  checked: boolean;
  /** What that check found: 'ok', 'not_found', or null when never checked. */
  checkOutcome: string | null;
  checkSource: string | null;
}

export interface SeriesCheckInput {
  outcome?: string | null;
  source?: string | null;
  knownTotal?: number | null;
  knownTotalSource?: string | null;
}

/** Integer positions only. A volume 2.5 does not create a hole at 3. */
function isPosition(n: number): boolean {
  return Number.isInteger(n);
}

/**
 * Work out what is missing from one series, and how strongly.
 *
 * `volumes` is every volume of the series we know about from any direction:
 * the works we hold (`workId` set) and the rows some source attested
 * (`workId` null). A volume that appears in both arrives once, with its
 * `workId` set — resolving that is the caller's job, because only the caller
 * knows how the two tables join.
 */
export function seriesCompleteness(
  series: string,
  volumes: SeriesVolumeInput[],
  check: SeriesCheckInput = {},
  context: GapContext = {},
): SeriesCompleteness {
  const audioByIndex = new Map((context.audio ?? []).map((a) => [a.index, a]));
  const skipByIndex = new Map((context.skipped ?? []).map((s) => [s.index, s]));
  // Held, not merely catalogued. See `SeriesVolumeInput.wanted`.
  const owned = volumes.filter((v) => v.workId != null && !v.wanted);
  const ownedPositions = owned.map((v) => v.index).filter(isPosition);
  // Everything we do not hold: volumes a source named, and volumes we have put
  // on the wishlist. Both are missing; only the second has a catalog row.
  const attested = volumes.filter((v) => v.workId == null || v.wanted);

  const lowestOwned = ownedPositions.length ? Math.min(...ownedPositions) : null;
  const highestOwned = ownedPositions.length ? Math.max(...ownedPositions) : null;

  const attestedByIndex = new Map<number, SeriesVolumeInput>();
  for (const v of attested) attestedByIndex.set(v.index, v);

  const knownPositions = [...ownedPositions, ...attested.map((v) => v.index).filter(isPosition)];
  const highestKnown = knownPositions.length ? Math.max(...knownPositions) : null;

  const ownedSet = new Set(ownedPositions);
  /** Every rung we do not hold here, skipped ones included. Partitioned below. */
  const absent: SeriesGap[] = [];
  const toGap = (index: number, row: SeriesVolumeInput | undefined, evidence: GapEvidence) =>
    gapFrom(index, row, evidence, audioByIndex.get(index) ?? null, skipByIndex.get(index) ?? null);

  if (highestKnown != null && knownPositions.length) {
    // The floor is 1 for an ordinarily numbered series. It drops only if
    // something genuinely sits below 1 — a book 0, a 0.5 prequel — because
    // inventing volumes below the lowest number anyone has ever mentioned is the
    // same invention as inventing them above the highest.
    const floor = Math.min(1, ...knownPositions);
    for (let p = floor; p <= highestKnown; p++) {
      if (ownedSet.has(p)) continue;
      const row = attestedByIndex.get(p);
      // The strongest available evidence wins, and position decides it first:
      // a volume between two we own is certain whether or not a CSV also
      // mentions it, so it is never downgraded to "the CSV said so".
      //
      // ⚠️ The loop's ceiling — and not any test in here — is what stops this
      // fabricating. `highestKnown` is the maximum of what we own and what a
      // source named, so a position above our top is only ever reached because
      // something attested a volume at or above it. Raise that ceiling by any
      // other rule and the whole module starts inventing books.
      const evidence: GapEvidence =
        lowestOwned != null && p < lowestOwned
          ? 'earlier'
          : highestOwned != null && p < highestOwned
            ? 'interior'
            : row
              ? 'attested'
              : 'implied';
      absent.push(toGap(p, row, evidence));
    }
  }

  // Attested volumes off the integer line — a 2.5 novella a source names and we
  // do not hold. Missing, certainly; just not part of a range scan.
  for (const v of attested) {
    if (isPosition(v.index)) continue;
    if (owned.some((o) => o.index === v.index)) continue;
    absent.push(toGap(v.index, v, 'attested'));
  }

  absent.sort((a, b) => a.index - b.index);

  // ⚠️ The partition, and it is the whole of bug 2's arithmetic. A skipped rung
  // leaves `gaps`, so every count below — and both chips on the series list, and
  // the "only series with gaps" filter — stop seeing it, with no edit to any of
  // them. It is still a rung and the ladder still draws it.
  const gaps = absent.filter((g) => g.skipped == null);
  const skipped = absent.filter((g) => g.skipped != null);

  // Owned on audio, and evidenced. `'fold'` is deliberately not in here — see
  // the header: a hedge does not cross a book off a list.
  const held = (g: SeriesGap) => g.audio?.matchedVia === 'work_match';

  const knownTotal = check.knownTotal ?? null;

  return {
    series,
    owned: owned.length,
    unnumbered: owned.length - ownedPositions.length,
    lowestOwned,
    highestOwned,
    highestKnown,
    gaps,
    skipped,
    wanted: volumes.filter((v) => v.wanted).length,
    certainGaps: gaps.filter(
      (g) => !held(g) && (g.evidence === 'interior' || g.evidence === 'earlier'),
    ).length,
    attestedGaps: gaps.filter(
      (g) => !held(g) && (g.evidence === 'attested' || g.evidence === 'implied'),
    ).length,
    onAudio: gaps.filter(held).length,
    maybeOnAudio: gaps.filter((g) => g.audio?.matchedVia === 'fold').length,
    knownTotal,
    knownTotalSource: check.knownTotalSource ?? null,
    openEnded: knownTotal == null,
    checked: Boolean(check.outcome),
    checkOutcome: check.outcome ?? null,
    checkSource: check.source ?? null,
  };
}

function gapFrom(
  index: number,
  row: SeriesVolumeInput | undefined,
  evidence: GapEvidence,
  audio: SeriesAudioInput | null,
  skipped: SeriesSkipInput | null,
): SeriesGap {
  return {
    index,
    volumeId: row?.volumeId ?? null,
    workId: row?.workId ?? null,
    wanted: row?.wanted ?? false,
    evidence,
    // ⚠️ Our attesting row first; the audiobook catalog's name only when we have
    // none at all. The two spellings differ — "Dawnshard - Stormlight Archive"
    // there — and a rung that renames itself the day an audio match lands reads
    // as a different book. `audio.title` is shown beside it, never instead of
    // it, so a wrong mapping stays visible.
    title: row?.title ?? audio?.title ?? null,
    authors: row?.authors ?? audio?.authors ?? null,
    display: row?.display ?? null,
    source: row?.source ?? null,
    sourceUrl: row?.sourceUrl ?? null,
    note: row?.note ?? null,
    staleAt: row?.staleAt ?? null,
    audio,
    skipped,
  };
}

/**
 * The sentence the UI prints, written once so two screens cannot disagree.
 *
 * ⚠️ Every branch is a claim about the world, and the wording is the feature.
 * "10 of at least 16" and "10 of 16" differ by two words and by whether the app
 * is telling the truth.
 */
export function completenessSentence(c: SeriesCompleteness): string {
  const held = `${c.owned} ${c.owned === 1 ? 'book' : 'books'}`;
  const skips = c.skipped.length;
  const source = c.knownTotalSource ?? 'a recorded source';

  /**
   * The clauses that follow the main claim, in order of how much they change it.
   *
   * Kept in one place because they are the same three sentences on every branch,
   * and the last time a branch grew its own copy of one of them the two screens
   * that print it disagreed about which books they were counting.
   */
  const tail = () => {
    const extra: string[] = [];
    // ⚠️ "you own", said outright. This clause is the fix for the whole bug:
    // before it existed these books were counted as missing, and telling
    // somebody they lack a book they own is how they buy it twice.
    // ⚠️ "more", not "of those". Read in a rendered sentence: with every gap
    // covered the clause before this one is "nothing here is missing", and
    // "6 of those" then refers to nothing at all.
    if (c.onAudio) extra.push(`${c.onAudio} more you own on audio.`);
    // The hedge. Separate sentence, weaker verb, and the book is STILL counted
    // as missing above — see `maybeOnAudio`.
    if (c.maybeOnAudio) extra.push(`${c.maybeOnAudio} possibly on audio.`);
    if (skips) extra.push(`${skips} deliberately skipped.`);
    if (c.wanted) extra.push(`${c.wanted} already on the wishlist.`);
    return extra.length ? ` ${extra.join(' ')}` : '';
  };

  if (c.knownTotal != null) {
    // ⚠️ Skips come off the outstanding count, never off the total. Deciding not
    // to buy book 13 does not un-publish it, and only a sourced
    // `series_check.known_total` may say how long a series is — migration 0100.
    const missing = c.knownTotal - c.owned - skips - c.onAudio;
    if (missing > 0) {
      return `${c.owned} of ${c.knownTotal}, per ${source} — ${missing} to go.${tail()}`;
    }
    // Every volume accounted for, but "Complete" is only honest when they are
    // all actually here. Anything else has to say how it is accounted for.
    return skips || c.onAudio
      ? `All ${c.knownTotal} accounted for, per ${source} — ${c.owned} here.${tail()}`
      : `All ${c.knownTotal}. Complete, per ${source}.`;
  }

  if (c.highestKnown == null) return `${held}, none of them numbered.`;

  if (c.gaps.length === 0) {
    // The honest version of "complete". We hold an unbroken run, and we do not
    // know whether the author has written a fifteenth. With skips it is not
    // unbroken and must not claim to be.
    const run = skips
      ? `${held} of at least ${c.highestKnown}, and nothing else is missing.`
      : `${held}, 1–${c.highestKnown} unbroken.`;
    return `${run}${tail()} Nothing says whether the series goes further.`;
  }

  // ⚠️ "of at least". Never "of". The number after it is the highest volume
  // anything has claimed to exist, which is a floor and not a total — see the
  // note on `series_check.known_total` in migration 0003.
  const parts = [`${held} of at least ${c.highestKnown}`];
  // ⚠️ `certainGaps` and `attestedGaps` already exclude the rungs held on audio.
  // Subtracting here instead would be a second copy of that rule, free to drift
  // from the one the series list prints its chips from.
  if (c.certainGaps) parts.push(`${c.certainGaps} missing from the run itself`);
  if (c.attestedGaps) parts.push(`${c.attestedGaps} more beyond it, on a source's word`);
  // Every remaining gap turned out to be one we own on audio: there is nothing
  // left to call missing, so the sentence must not lead with a dash and a count
  // of zero.
  if (parts.length === 1) parts.push('nothing here is missing');
  return `${parts.join(' — ')}.${tail()}`;
}

/**
 * How a gap should be explained, in one line, with its source named.
 *
 * Kept beside the arithmetic rather than in a component so the words and the
 * evidence they describe cannot drift apart.
 */
export function gapEvidenceLabel(gap: SeriesGap): string {
  switch (gap.evidence) {
    case 'interior':
      return 'a hole between books you own';
    case 'earlier':
      return 'earlier than the lowest you own';
    case 'attested':
      return sourceLabel(gap.source);
    case 'implied':
      return 'implied by a later volume on the list';
  }
}

/**
 * "You have this one on audio" — or the hedged form, when we cannot prove it.
 *
 * ⚠️ Lives here, next to the rule that decides which gaps count as missing, for
 * the same reason `gapEvidenceLabel` does. The two must agree: a rung the
 * arithmetic has stopped calling missing and a rung whose caption still hedges
 * would be one screen contradicting itself.
 *
 * Null when there is no audio at all, so a caller cannot print an empty caption.
 */
export function gapAudioLabel(gap: SeriesGap): string | null {
  if (!gap.audio) return null;
  const named = `“${gap.audio.title}”`;
  return gap.audio.matchedVia === 'work_match'
    ? `you own this on audio, as ${named}`
    : // The whole hedge in one clause: what was actually compared, and what was
      // not. `matching.ts` opens with three wrong matches the sibling project
      // shipped, every one of which would have read fine as a flat claim.
      `possibly on audio — ${named} is filed under “${gap.audio.audiobookSeries}” there,` +
        ' and only the series name connects the two catalogs';
}

/** Why a rung is greyed out. The owner's words, never the app's guess. */
export function gapSkipLabel(gap: SeriesGap): string | null {
  return gap.skipped ? `skipped — ${gap.skipped.reason}` : null;
}

function sourceLabel(source: string | null): string {
  switch (source) {
    case 'audiobook_catalog':
      return 'listed in the audiobook catalog';
    case 'openlibrary':
      return 'listed by Open Library';
    case 'manual':
      return 'recorded by hand';
    default:
      return 'from a recorded source';
  }
}
