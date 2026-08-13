import {
  HELD_STATUSES,
  editionMedium,
  heldCopies,
  ownedMoreThanOnce,
  seriesCompleteness,
  type AudioSeriesMatch,
  type CreateSeriesVolume,
  type EditionMedium,
  type SeriesAudioInput,
  type SeriesCompleteness,
  type SeriesSkipInput,
  type SeriesVolumeInput,
} from '@lc/core';

/**
 * Series, and what is missing from them.
 *
 * ## Why this loads everything and computes in JavaScript
 *
 * The arithmetic lives in `packages/core/src/completeness.ts` and is pure, so it
 * has to be handed rows rather than run in SQL. That is a choice, and the cost
 * is measured rather than assumed: 27 series, 111 works with a series, and — if
 * every series were fully attested — a few hundred `series_volume` rows. Five
 * queries and a group-by in memory, against a table where a self-join with a
 * generated integer series would be the alternative.
 *
 * The two added for formats and audiobooks are the cheapest of the five: one
 * row per edition and at most one row per work, both narrowed to works that have
 * a series at all. Measured against production 2026-08-10 they are 156 and 40
 * rows respectively, for the whole catalog, on the unscoped list request.
 *
 * The gain is that the one rule anybody will ever argue about — what counts as
 * missing — is a pure function with tests, and not a `WITH RECURSIVE` nobody
 * dares change. `npm test` covers it; no SQL in this repo is covered by
 * anything.
 *
 * ⚠️ `work.series` is the join key and it is matched **exactly**. It is a string
 * a person curated (`scripts/series-overrides.json`), and a fold applied here
 * would be a second normalisation rule that the importer's does not know about.
 * The importer resolves names on the way in and stores the spelling this catalog
 * uses — see `scripts/backfill-series-volumes.mjs`.
 */

/** One printing of a work: what it is, and what makes it tellable from its siblings. */
export interface EditionRef {
  id: number;
  format: string;
  /** "Target exclusive", "Barnes & Noble edition", "Omnibus - collects volumes 1-3". */
  editionName: string | null;
  publisher: string | null;
  publishedYear: number | null;
  isbn13: string | null;
}

/** What the sibling audiobook catalog has, cached by migration 0010. */
export interface AudiobookRef {
  /** Its title over there, which is not always ours. Shown when they differ. */
  title: string;
  /** That catalog's own series spelling and volume. Deliberately not folded to ours. */
  series: string | null;
  indexDisplay: string | null;
  matchedVia: string;
  /** The `work_alias` that unlocked the match, when one did. */
  viaAlias: string | null;
}

export interface SeriesLadderEntry {
  index: number;
  /** The `series_volume` row, for a rung nobody owns. Null for a book we hold. */
  volumeId: number | null;
  display: string | null;
  title: string | null;
  authors: string | null;
  /** Set when the volume is catalogued. Null for one only a source knows about. */
  workId: number | null;
  /** ⚠️ Catalogued, but only as a wish — see `SeriesVolumeInput.wanted`. */
  wanted: boolean;
  coverUrl: string | null;
  readState: string | null;
  source: string | null;
  sourceUrl: string | null;
  note: string | null;
  staleAt: string | null;
  /**
   * Every printing we hold of this volume. Empty for a rung nobody owns, and —
   * importantly — empty for a work created by the wishlist button, which is what
   * `isWish` keys on.
   */
  editions: EditionRef[];
  /** `editions` reduced to the question a person actually asks. */
  media: EditionMedium[];
  audiobook: AudiobookRef | null;
}

/** One object on the shelf — what tells it apart from the other one like it. */
export interface CopyRef {
  id: number;
  status: string;
  /** The printing it names, when it names one. `copy.edition_id` is nullable. */
  editionId: number | null;
  location: string | null;
  vendor: string | null;
  acquiredOn: string | null;
  isSigned: boolean;
  /** Free text on the copy: "Target exclusive cover", "signed at the launch". */
  editionNotes: string | null;
}

/**
 * A volume we own **two or more physical or licensed copies of** — see
 * `ownedMoreThanOnce` in `@lc/core`.
 *
 * ⚠️ **The rule changed on 2026-08-11, from editions to copies.** It used to be
 * "two printings of one medium", and measured against production every book it
 * named was a scan artifact rather than a purchase — see the header of
 * `packages/core/src/holdings.ts` for the three books and what was actually
 * wrong with each. `copy` is the table that means "an object in this house";
 * `edition` means "a printing that exists in the world", and the catalog can
 * hold two rows for one book without anybody having bought it twice.
 *
 * Kept apart from the ladder because it answers a different question: the ladder
 * is *which volumes*, this is *how many of one of them are on the shelf*, and
 * threading the second into the first makes a rung that is two rungs tall for a
 * reason nobody scanning the run cares about.
 *
 * `editions` still rides along — it is what turns "copy #412" into "the
 * hardcover" on screen — but it no longer decides anything.
 */
export interface OwnedTwice {
  workId: number;
  title: string;
  /** Null for a work in the series with no place on the number line. */
  index: number | null;
  display: string | null;
  coverUrl: string | null;
  /** The held copies — the objects. This is the list the section is about. */
  copies: CopyRef[];
  /** Every printing on file, so a copy can be labelled with what it is. */
  editions: EditionRef[];
}

/**
 * What we hold across a whole series, counted in works rather than editions.
 *
 * ⚠️ Works, not editions, and the difference matters the moment a book is owned
 * twice: three copies of volume 1 is one book on the shelf, and "4 physical"
 * meaning "2 books, one of them bought three times" would be a number that sorts
 * and filters and means nothing.
 */
export interface SeriesHoldings {
  /** Held works, wishes excluded. Matches `SeriesCompleteness.owned`. */
  works: number;
  physical: number;
  ebook: number;
  /** Held works the sibling audiobook catalog also has. */
  audio: number;
  /** Held works with 2+ held copies — see `ownedMoreThanOnce` in `@lc/core`. */
  ownedTwice: number;
}

/**
 * The owner's standing confirmation that this series and an audiobook series are
 * one series — migration 0110. Null when they have not been asked or said no.
 *
 * ⚠️ On the report rather than derived from the rungs, and it has to be: once a
 * confirmation is in force every rung reads `'owner'` and nothing on the page can
 * tell that a decision is what put it there. Without this the undo would be
 * unreachable — the state that makes the button unnecessary is the same state
 * that hides it.
 */
export interface AudioSeriesLink {
  /** Their spelling, as confirmed. Compared against the live rung; see the read path. */
  audiobookSeries: string;
  note: string | null;
  confirmedAt: string;
}

export interface SeriesReport {
  completeness: SeriesCompleteness;
  holdings: SeriesHoldings;
  /** Every volume, owned or attested, in order. The page's ladder. */
  ladder: SeriesLadderEntry[];
  /** Works in this series we hold but cannot place on the number line. */
  unnumbered: { workId: number; title: string; display: string | null }[];
  /** Works we own two or more copies of. Usually empty; see the type. */
  ownedTwice: OwnedTwice[];
  /** The owner's confirmed audio-series mapping, when there is one. */
  audioLink: AudioSeriesLink | null;
}

/** One row of the series list: the arithmetic, plus what is on the shelf. */
export interface SeriesSummary extends SeriesCompleteness {
  holdings: SeriesHoldings;
}

interface OwnedRow {
  id: number;
  series: string;
  series_index_sort: number | null;
  series_index_display: string | null;
  title: string;
  authors: string;
  cover_url: string | null;
  read_state: string | null;
  copies: number;
  wanted_copies: number;
  editions: number;
}

interface VolumeRow {
  id: number;
  series: string;
  index_sort: number;
  index_display: string | null;
  title: string | null;
  authors: string | null;
  source: string;
  source_url: string | null;
  note: string | null;
  stale_at: string | null;
}

interface CheckRow {
  series: string;
  outcome: string;
  source: string;
  known_total: number | null;
  known_total_source: string | null;
  note: string | null;
}

interface EditionRow {
  work_id: number;
  id: number;
  format: string;
  edition_name: string | null;
  publisher: string | null;
  published_year: number | null;
  isbn13: string | null;
}

interface CopyRow {
  work_id: number;
  id: number;
  status: string;
  edition_id: number | null;
  location: string | null;
  vendor: string | null;
  acquired_on: string | null;
  is_signed: number;
  edition_notes: string | null;
}

interface AudioRow {
  work_id: number;
  title: string;
  series: string | null;
  index_display: string | null;
  matched_via: string;
  via_alias: string | null;
}

/**
 * An audiobook the household holds at a rung with no `work` row — migration
 * 0090. Keyed on `(series, index_sort)`, because that is all a gap has.
 */
interface AudioRungRow {
  series: string;
  index_sort: number;
  title: string;
  authors: string | null;
  audiobook_series: string;
  index_display: string | null;
  series_matched_via: string;
}

/**
 * The owner's confirmation that our series name and the audiobook catalog's mean
 * one series — migration 0110.
 *
 * ⚠️ `audiobook_series` is a guard, not a label. It is compared against the live
 * rung before anything is upgraded, so a rename in the sibling catalog reverts
 * those rungs to the hedge and asks again rather than silently inheriting a
 * confirmation nobody gave.
 */
interface AudioLinkRow {
  series: string;
  audiobook_series: string;
  note: string | null;
  confirmed_at: string;
}

/** A rung the owner has decided never to own — migration 0100. */
interface SkipRow {
  series: string;
  index_sort: number;
  reason: string;
  note: string | null;
  decided_at: string;
}

/** `work_id` -> its rows, for a table read whole and grouped in memory. */
function groupBy<T extends { work_id: number }>(rows: T[]): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const r of rows) {
    const list = out.get(r.work_id);
    if (list) list.push(r);
    else out.set(r.work_id, [r]);
  }
  return out;
}

/** The same, for the two tables keyed on a series name rather than a work. */
function groupBySeries<T extends { series: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.series);
    if (list) list.push(r);
    else out.set(r.series, [r]);
  }
  return out;
}

async function loadAll(
  db: D1Database,
  readerId: number,
  onlySeries?: string,
): Promise<{
  owned: OwnedRow[];
  volumes: VolumeRow[];
  checks: Map<string, CheckRow>;
  editions: Map<number, EditionRow[]>;
  copies: Map<number, CopyRow[]>;
  audio: Map<number, AudioRow>;
  audioRungs: Map<string, AudioRungRow[]>;
  audioLinks: Map<string, AudioLinkRow>;
  skips: Map<string, SkipRow[]>;
}> {
  const scope = onlySeries ? 'AND w.series = ?2' : '';
  const volumeScope = onlySeries ? 'WHERE series = ?1' : '';
  const checkScope = onlySeries ? 'WHERE series = ?1' : '';
  // These three join `work` rather than being scoped by a series column of their
  // own, so the bound parameter is ?1 and not ?2 — none needs the reader id.
  const joinScope = onlySeries ? 'AND w.series = ?1' : '';
  // ⚠️ NOT `joinScope`. The copies query binds the held statuses first, so the
  // series lands after them — hard-coding `?1` there would have filtered the
  // whole catalog to a series called "owned" and quietly returned nothing.
  const copyScope = onlySeries ? `AND w.series = ?${HELD_STATUSES.length + 1}` : '';

  const [owned, volumes, checks, editions, copies, audio, audioRungs, audioLinks, skips] =
    await Promise.all([
      db
        .prepare(
          `SELECT w.id, w.series, w.series_index_sort, w.series_index_display,
                  w.title, w.authors, w.cover_url,
                  (SELECT ub.read_state FROM user_book ub
                    WHERE ub.work_id = w.id AND ub.user_id = ?1) AS read_state,
                  -- ⚠️ Held vs merely wished for. The copy table held 0 rows of
                  -- any status on 2026-08-10, so "no owned copy" says nothing at
                  -- all — every one of the 117 imported works looks like that.
                  -- The edition count is what separates them from a row the
                  -- wishlist button just created, which has neither.
                  -- (No backticks in here: this is inside a template literal.)
                  (SELECT COUNT(*) FROM copy c WHERE c.work_id = w.id) AS copies,
                  (SELECT COUNT(*) FROM copy c
                    WHERE c.work_id = w.id AND c.status IN ('wanted','preordered'))
                    AS wanted_copies,
                  (SELECT COUNT(*) FROM edition e WHERE e.work_id = w.id) AS editions
             FROM work w
            WHERE w.series IS NOT NULL ${scope}`,
        )
        .bind(...(onlySeries ? [readerId, onlySeries] : [readerId]))
        .all<OwnedRow>(),
      db
        .prepare(
          `SELECT id, series, index_sort, index_display, title, authors, source, source_url,
                  note, stale_at
             FROM series_volume ${volumeScope}`,
        )
        .bind(...(onlySeries ? [onlySeries] : []))
        .all<VolumeRow>(),
      db
        .prepare(
          `SELECT series, outcome, source, known_total, known_total_source, note
             FROM series_check ${checkScope}`,
        )
        .bind(...(onlySeries ? [onlySeries] : []))
        .all<CheckRow>(),
      // Every printing of every work in scope. This is what makes "we have it as
      // an ebook but not on paper" answerable, and what surfaces the works held in
      // more than one printing.
      db
        .prepare(
          `SELECT e.work_id, e.id, e.format, e.edition_name, e.publisher,
                  e.published_year, e.isbn13
             FROM edition e
             JOIN work w ON w.id = e.work_id
            WHERE w.series IS NOT NULL ${joinScope}
            ORDER BY e.work_id, e.id`,
        )
        .bind(...(onlySeries ? [onlySeries] : []))
        .all<EditionRow>(),
      // Every copy on the shelf, which is what "owned more than once" now counts.
      //
      // ⚠️ Filtered to `HELD_STATUSES` in SQL rather than in the loop, so a series
      // whose only extra copies are wishes does not carry them across the wire at
      // all. `ownedMoreThanOnce` applies the same filter again on what arrives —
      // belt and braces, and it is the pure function that has the tests.
      //
      // Small: production held 108 copies in total on 2026-08-11, against 224
      // works, and this is narrowed to the ones with a series.
      db
        .prepare(
          `SELECT c.work_id, c.id, c.status, c.edition_id, c.location, c.vendor,
                  c.acquired_on, c.is_signed, c.edition_notes
             FROM copy c
             JOIN work w ON w.id = c.work_id
            WHERE w.series IS NOT NULL
              AND c.status IN (${HELD_STATUSES.map((_, i) => `?${i + 1}`).join(', ')}) ${copyScope}
            ORDER BY c.work_id, c.id`,
        )
        .bind(...HELD_STATUSES, ...(onlySeries ? [onlySeries] : []))
        .all<CopyRow>(),
      // ⚠️ Requires migration 0010. Deploying this code against a database without
      // `audiobook_holding` makes every request to /api/series a 500 — the same
      // trap migrations 0003 and 0005 each carried, recorded again because it is
      // the one that keeps recurring in this project.
      //
      // `stale_at IS NULL` because a holding is marked and never deleted; a stale
      // row is history, not a book we have.
      db
        .prepare(
          `SELECT a.work_id, a.title, a.series, a.index_display, a.matched_via, a.via_alias
             FROM audiobook_holding a
             JOIN work w ON w.id = a.work_id
            WHERE w.series IS NOT NULL AND a.stale_at IS NULL ${joinScope}`,
        )
        .bind(...(onlySeries ? [onlySeries] : []))
        .all<AudioRow>(),
      // ⚠️ Requires migration 0090, and it is the fix for the worse of the two
      // bugs: `audiobook_holding` above can only speak for a work that EXISTS
      // here, so a book owned only on audio was invisible and the ladder drew it
      // as a hole. This table is keyed on the series and the number, which is all
      // a gap rung has.
      //
      // Scoped by its own `series` column — our spelling, exactly as
      // `series_volume` stores it — so the bound parameter is ?1 like the two
      // above it and no fold runs here. See migration 0090.
      db
        .prepare(
          `SELECT series, index_sort, title, authors, audiobook_series, index_display,
                  series_matched_via
             FROM audiobook_series_holding
            WHERE stale_at IS NULL ${onlySeries ? 'AND series = ?1' : ''}`,
        )
        .bind(...(onlySeries ? [onlySeries] : []))
        .all<AudioRungRow>(),
      // ⚠️ Requires migration 0110. "That IS the same series — I own those."
      //
      // The rows above are graded by a script and the grade is `fold` whenever
      // nothing but a folded name connects the two catalogs. For a series whose
      // volumes the two catalogs do not share at all, that grade is unreachable
      // by any re-run — so this table is where the owner settles it. Migration
      // 0110's header carries the two series it was built for.
      db
        .prepare(
          `SELECT series, audiobook_series, note, confirmed_at
             FROM audiobook_series_link ${onlySeries ? 'WHERE series = ?1' : ''}`,
        )
        .bind(...(onlySeries ? [onlySeries] : []))
        .all<AudioLinkRow>(),
      // ⚠️ Requires migration 0100. "I am never buying that one."
      db
        .prepare(
          `SELECT series, index_sort, reason, note, decided_at
             FROM series_gap_skip ${onlySeries ? 'WHERE series = ?1' : ''}`,
        )
        .bind(...(onlySeries ? [onlySeries] : []))
        .all<SkipRow>(),
    ]);

  return {
    owned: owned.results,
    volumes: volumes.results,
    checks: new Map(checks.results.map((c) => [c.series, c])),
    editions: groupBy(editions.results),
    copies: groupBy(copies.results),
    // One row per work — `audiobook_holding.work_id` is the primary key.
    audio: new Map(audio.results.map((a) => [a.work_id, a])),
    audioRungs: groupBySeries(audioRungs.results),
    // One row per series — `audiobook_series_link.series` is the primary key.
    audioLinks: new Map(audioLinks.results.map((l) => [l.series, l])),
    skips: groupBySeries(skips.results),
  };
}

function toCopyRef(c: CopyRow): CopyRef {
  return {
    id: c.id,
    status: c.status,
    editionId: c.edition_id,
    location: c.location,
    vendor: c.vendor,
    acquiredOn: c.acquired_on,
    isSigned: c.is_signed === 1,
    editionNotes: c.edition_notes,
  };
}

function toEditionRef(e: EditionRow): EditionRef {
  return {
    id: e.id,
    format: e.format,
    editionName: e.edition_name,
    publisher: e.publisher,
    publishedYear: e.published_year,
    isbn13: e.isbn13,
  };
}

/**
 * The distinct media a set of printings covers, physical first.
 *
 * ⚠️ Distinct, and that is the point. Three EPUBs of one book are one answer to
 * "do we have this on a screen", and listing the format of every row would make
 * the common case — a work with one printing — indistinguishable from the case
 * this feature exists for.
 */
function mediaOf(editions: EditionRef[]): EditionMedium[] {
  const seen = new Set(editions.map((e) => editionMedium(e.format)));
  return (['physical', 'ebook'] as const).filter((m) => seen.has(m));
}

/*
 * ⚠️ `boughtTwice(editions)` used to live here and has been deleted.
 *
 * Its rule was "two printings of the same medium", and it was the *second*
 * attempt: the obvious `editions.length > 1` had swept up every ebook-plus-
 * paperback pair, which is five works in this catalog and not one of them a
 * duplicate. The narrower rule was better and still wrong, because it answered
 * "how many printings do we have rows for" while the heading asked "how many of
 * these do I own". Measured against production on 2026-08-11, all three books it
 * named were scan artifacts and **nothing in the catalog was genuinely owned
 * twice**.
 *
 * The rule is now `ownedMoreThanOnce` in `@lc/core`, it counts held copies, and
 * it has tests. That header carries the three books and what was wrong with
 * each.
 */

function toAudiobookRef(a: AudioRow): AudiobookRef {
  return {
    title: a.title,
    series: a.series,
    indexDisplay: a.index_display,
    matchedVia: a.matched_via,
    viaAlias: a.via_alias,
  };
}

/**
 * A migration 0090 row as the arithmetic wants it, with migration 0110's
 * confirmation applied.
 *
 * ⚠️ `series_matched_via` is narrowed with a comparison rather than a cast. The
 * column has a CHECK constraint, but a database predating it — or one restored
 * from elsewhere — would hand `undefined` to a union type and the hedge would
 * silently become a certainty. Anything unrecognised falls to `'fold'`, which is
 * the answer that claims less. This is the ONE boundary where that narrowing
 * happens, which is why `held()` in `@lc/core` is free to test "not the hedge".
 *
 * ## ⚠️ The confirmation is applied HERE and is guarded on the name
 *
 * `link` upgrades `'fold'` to `'owner'` **only while it still names the audiobook
 * series the rung actually carries.** The owner confirmed a pair of names; if the
 * sibling catalog refiles the books under a different series, the fold produces
 * rows for a mapping nobody has ever looked at, and inheriting the old
 * confirmation would be the app claiming ownership on nobody's authority. A
 * rename therefore reverts those rungs to AUDIO? and asks again. See migration
 * 0110.
 *
 * ⚠️ A `'work_match'` row is left exactly as it is. It already claims as much,
 * and it claims it on evidence that can be re-checked, so overwriting it with the
 * owner's word would lose the stronger provenance for no gain.
 */
function toAudioRungInput(a: AudioRungRow, link: AudioLinkRow | undefined): SeriesAudioInput {
  const graded: AudioSeriesMatch = a.series_matched_via === 'work_match' ? 'work_match' : 'fold';
  const confirmed = link != null && link.audiobook_series === a.audiobook_series;
  return {
    index: a.index_sort,
    title: a.title,
    authors: a.authors,
    audiobookSeries: a.audiobook_series,
    indexDisplay: a.index_display,
    matchedVia: graded === 'fold' && confirmed ? 'owner' : graded,
  };
}

function toSkipInput(s: SkipRow): SeriesSkipInput {
  return { index: s.index_sort, reason: s.reason, note: s.note, decidedAt: s.decided_at };
}

function reportFor(
  series: string,
  owned: OwnedRow[],
  volumes: VolumeRow[],
  check: CheckRow | undefined,
  editionsByWork: Map<number, EditionRow[]>,
  copiesByWork: Map<number, CopyRow[]>,
  audioByWork: Map<number, AudioRow>,
  audioRungs: AudioRungRow[],
  audioLink: AudioLinkRow | undefined,
  skipRows: SkipRow[],
): SeriesReport {
  // ⚠️ Narrow on purpose — see the long note on `SeriesVolumeInput.wanted`.
  // A work with an edition is a work something on our side knows about; only a
  // row with no edition and nothing but wishes against it is purely a wish.
  const isWish = (w: OwnedRow) =>
    w.editions === 0 && w.copies > 0 && w.copies === w.wanted_copies;

  // A catalogued volume may ALSO have a `series_volume` row — putting an
  // attested volume on the wishlist creates the work and leaves the row that
  // named it. Carrying the source across keeps "listed in the audiobook
  // catalog" attached to the rung; without it a wished-for volume loses the
  // attribution that justified showing it in the first place.
  const attestedByIndex = new Map(volumes.map((v) => [v.index_sort, v]));

  const numbered = owned.filter((w) => w.series_index_sort != null);
  const workInputs: SeriesVolumeInput[] = numbered.map((w) => {
    const said = attestedByIndex.get(w.series_index_sort as number);
    return {
      index: w.series_index_sort as number,
      display: w.series_index_display,
      title: w.title,
      authors: w.authors,
      workId: w.id,
      wanted: isWish(w),
      volumeId: said?.id ?? null,
      source: said?.source ?? null,
      sourceUrl: said?.source_url ?? null,
    };
  });

  // A volume we hold — or have already wished for — is never also an attested
  // absence. The catalog row wins: it carries a cover, a link and a read state,
  // and a CSV row for the same number would only duplicate the rung.
  const catalogued = new Set(workInputs.map((v) => v.index));
  /**
   * Rungs whose audio answer comes from `audiobook_holding` instead.
   *
   * ⚠️ Held works only, NOT everything catalogued. A wished-for volume has a
   * work row and is still a gap, and "you already own this on audio" is exactly
   * what somebody about to buy it needs to be told.
   */
  const heldIndexes = new Set(workInputs.filter((v) => !v.wanted).map((v) => v.index));
  const attestedInputs: SeriesVolumeInput[] = volumes
    .filter((v) => !catalogued.has(v.index_sort))
    .map((v) => ({
      index: v.index_sort,
      volumeId: v.id,
      display: v.index_display,
      title: v.title,
      authors: v.authors,
      workId: null,
      source: v.source,
      sourceUrl: v.source_url,
      note: v.note,
      staleAt: v.stale_at,
    }));

  const unnumberedRows = owned.filter((w) => w.series_index_sort == null);
  const completeness = seriesCompleteness(
    series,
    [
      ...workInputs,
      ...attestedInputs,
      // Unnumbered works still count towards "how many do we hold", which
      // `seriesCompleteness` measures from rows with a workId. NaN is the
      // sentinel: `Number.isInteger(NaN)` is false, so it is excluded from
      // every position test and can never reach Math.min.
      ...unnumberedRows.map((w) => ({
        index: Number.NaN,
        workId: w.id,
        title: w.title,
        wanted: isWish(w),
      })),
    ],
    {
      outcome: check?.outcome ?? null,
      source: check?.source ?? null,
      knownTotal: check?.known_total ?? null,
      knownTotalSource: check?.known_total_source ?? null,
    },
    // ⚠️ A fourth argument and not more `volumes`, on purpose. Neither of these
    // claims a volume exists, and letting either into the volume list would let
    // it raise `highestKnown` — the ceiling `completeness.ts` calls "what stops
    // this fabricating". See its header.
    //
    // ⚠️ Held rungs are filtered OUT of the audio list. A work we hold already
    // gets its audio from `audiobook_holding`, matched on title AND author,
    // which is the stronger claim; feeding the series-level row in as well would
    // give one rung two answers that can disagree.
    {
      audio: audioRungs
        .filter((a) => !heldIndexes.has(a.index_sort))
        .map((a) => toAudioRungInput(a, audioLink)),
      skipped: skipRows.map(toSkipInput),
    },
  );

  const editionsFor = (workId: number) => (editionsByWork.get(workId) ?? []).map(toEditionRef);

  const ladder: SeriesLadderEntry[] = [
    ...numbered.map((w) => {
      const editions = editionsFor(w.id);
      const audio = audioByWork.get(w.id);
      return {
        index: w.series_index_sort as number,
        volumeId: null,
        display: w.series_index_display,
        title: w.title,
        authors: w.authors,
        workId: w.id,
        wanted: isWish(w),
        coverUrl: w.cover_url,
        readState: w.read_state,
        source: null,
        sourceUrl: null,
        note: null,
        staleAt: null,
        editions,
        media: mediaOf(editions),
        audiobook: audio ? toAudiobookRef(audio) : null,
      };
    }),
    ...attestedInputs.map((v) => ({
      index: v.index,
      volumeId: v.volumeId ?? null,
      display: v.display ?? null,
      title: v.title ?? null,
      authors: v.authors ?? null,
      workId: null,
      wanted: false,
      coverUrl: null,
      readState: null,
      source: v.source ?? null,
      sourceUrl: v.sourceUrl ?? null,
      note: v.note ?? null,
      staleAt: v.staleAt ?? null,
      // A rung nobody owns has nothing on the shelf, by definition. Empty arrays
      // rather than an optional field so the UI never has to test for undefined.
      editions: [] as EditionRef[],
      media: [] as EditionMedium[],
      audiobook: null,
    })),
  ].sort((a, b) => a.index - b.index);

  // ⚠️ Held works only — wishes excluded, the same rule `seriesCompleteness`
  // applies. A work created by the wishlist button has no editions anyway, so
  // this is belt and braces; it stops meaning belt and braces the moment
  // somebody wishes for a *second* printing of a book they already hold.
  const heldWorks = owned.filter((w) => !isWish(w));

  const holdings: SeriesHoldings = {
    works: heldWorks.length,
    physical: 0,
    ebook: 0,
    audio: 0,
    ownedTwice: 0,
  };
  const ownedTwice: OwnedTwice[] = [];

  for (const w of heldWorks) {
    const editions = editionsFor(w.id);
    for (const m of mediaOf(editions)) holdings[m] += 1;
    if (audioByWork.has(w.id)) holdings.audio += 1;

    // ⚠️ Copies, not editions. The rows arrive already filtered to
    // `HELD_STATUSES`; `heldCopies` re-applies it so this cannot start lying if
    // the query is ever widened.
    const copies = heldCopies((copiesByWork.get(w.id) ?? []).map(toCopyRef));
    if (ownedMoreThanOnce(copies)) {
      holdings.ownedTwice += 1;
      ownedTwice.push({
        workId: w.id,
        title: w.title,
        index: w.series_index_sort,
        display: w.series_index_display,
        coverUrl: w.cover_url,
        copies,
        editions,
      });
    }
  }

  // Down the number line, then anything unplaceable — the ladder's order, so the
  // second section reads as an annotation of the first rather than a new list.
  ownedTwice.sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity));

  return {
    completeness,
    holdings,
    ladder,
    unnumbered: unnumberedRows.map((w) => ({
      workId: w.id,
      title: w.title,
      display: w.series_index_display,
    })),
    ownedTwice,
    audioLink: audioLink
      ? {
          audiobookSeries: audioLink.audiobook_series,
          note: audioLink.note,
          confirmedAt: audioLink.confirmed_at,
        }
      : null,
  };
}

/**
 * Every series in the collection, with its completeness worked out.
 *
 * ⚠️ NaN sorts nowhere, so the unnumbered sentinel above must never reach
 * `Math.min`. `isPosition` in core rejects it because `Number.isInteger(NaN)` is
 * false, which is exactly why the test for that case exists.
 */
export async function listSeries(
  db: D1Database,
  readerId: number,
): Promise<{ series: SeriesSummary[]; withoutSeries: number }> {
  const { owned, volumes, checks, editions, copies, audio, audioRungs, audioLinks, skips } =
    await loadAll(db, readerId);

  const byName = new Map<string, OwnedRow[]>();
  for (const w of owned) {
    const list = byName.get(w.series);
    if (list) list.push(w);
    else byName.set(w.series, [w]);
  }
  // A series can exist entirely in `series_volume` — the sibling catalog knows
  // about it and we own nothing. Not possible today (the importer only walks
  // series we hold), and cheap to be right about now rather than later.
  for (const v of volumes) if (!byName.has(v.series)) byName.set(v.series, []);

  const volumesByName = new Map<string, VolumeRow[]>();
  for (const v of volumes) {
    const list = volumesByName.get(v.series);
    if (list) list.push(v);
    else volumesByName.set(v.series, [v]);
  }

  const series = [...byName.entries()]
    .map(([name, rows]) => {
      const report = reportFor(
        name,
        rows,
        volumesByName.get(name) ?? [],
        checks.get(name),
        editions,
        copies,
        audio,
        audioRungs.get(name) ?? [],
        audioLinks.get(name),
        skips.get(name) ?? [],
      );
      return { ...report.completeness, holdings: report.holdings };
    })
    // Alphabetical, and it stays that way. The list page offers other orders,
    // but the *default* has to be the one a person can predict — see the note
    // there on why "most missing first" is not the default it looks like.
    .sort((a, b) => a.series.localeCompare(b.series, undefined, { sensitivity: 'base' }));

  const none = await db
    .prepare('SELECT COUNT(*) AS n FROM work WHERE series IS NULL')
    .first<{ n: number }>();

  return { series, withoutSeries: none?.n ?? 0 };
}

/** One series, with the full ladder the page draws. */
export async function getSeriesReport(
  db: D1Database,
  readerId: number,
  name: string,
): Promise<SeriesReport | null> {
  const { owned, volumes, checks, editions, copies, audio, audioRungs, audioLinks, skips } =
    await loadAll(db, readerId, name);
  if (owned.length === 0 && volumes.length === 0) return null;
  return reportFor(
    name,
    owned,
    volumes,
    checks.get(name),
    editions,
    copies,
    audio,
    audioRungs.get(name) ?? [],
    audioLinks.get(name),
    skips.get(name) ?? [],
  );
}

/**
 * Record a volume some source says exists.
 *
 * An upsert on (series, index_sort), so a re-import is idempotent — and the
 * `DO UPDATE` deliberately leaves `first_seen_at` and any `manual` row alone.
 * A person's answer is not a CSV's to overwrite; the sibling project reached the
 * same conclusion in migration 0022 and for the same reason.
 */
export async function upsertSeriesVolume(
  db: D1Database,
  series: string,
  input: CreateSeriesVolume,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO series_volume (series, index_sort, index_display, title, authors,
                                  source, source_url, note)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(series, index_sort) DO UPDATE SET
         index_display = COALESCE(excluded.index_display, series_volume.index_display),
         title         = COALESCE(excluded.title, series_volume.title),
         authors       = COALESCE(excluded.authors, series_volume.authors),
         source        = CASE WHEN series_volume.source = 'manual'
                              THEN series_volume.source ELSE excluded.source END,
         source_url    = COALESCE(excluded.source_url, series_volume.source_url),
         note          = COALESCE(excluded.note, series_volume.note),
         last_seen_at  = datetime('now'),
         stale_at      = NULL`,
    )
    .bind(
      series,
      input.indexSort,
      input.indexDisplay ?? null,
      input.title ?? null,
      input.authors ?? null,
      input.source,
      input.sourceUrl ?? null,
      input.note ?? null,
    )
    .run();
}

/**
 * Withdraw a hand-entered volume.
 *
 * ⚠️ The only delete in this module, and it is scoped to `manual` rows on
 * purpose. An imported row is **marked, never deleted** (migration 0003) —
 * deleting one makes it reappear on the next import and makes a disappearance
 * indistinguishable from a purchase. A typo somebody made ten seconds ago is a
 * different thing and deserves an undo.
 */
export async function deleteManualSeriesVolume(db: D1Database, id: number): Promise<boolean> {
  const res = await db
    .prepare(`DELETE FROM series_volume WHERE id = ? AND source = 'manual'`)
    .bind(id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * A person asserting how long a series is — or withdrawing the assertion.
 *
 * Writes a `series_check` row with `source = 'manual'`, because saying "Cradle
 * is twelve books" *is* checking the series: it means somebody looked. The
 * source string is required by `setSeriesTotalSchema` and is stored verbatim.
 */
export async function setSeriesTotal(
  db: D1Database,
  series: string,
  knownTotal: number | null,
  knownTotalSource: string | null,
  note: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO series_check (series, source, outcome, known_total, known_total_source, note)
       VALUES (?1, 'manual', 'ok', ?2, ?3, ?4)
       ON CONFLICT(series) DO UPDATE SET
         checked_at         = datetime('now'),
         known_total        = ?2,
         -- Cleared with the total, so a withdrawn number cannot leave its
         -- justification behind to be read as still standing.
         known_total_source = ?3,
         note               = ?4`,
    )
    .bind(series, knownTotal, knownTotal == null ? null : knownTotalSource, note)
    .run();
}

/**
 * "I am never buying that one." — migration 0100.
 *
 * An upsert on `(series, index_sort)`, so changing the reason is one row and not
 * two contradicting decisions. Nothing here checks that the rung is *currently*
 * a gap: an `earlier` gap is pure arithmetic and exists in no table, and a
 * skip on a volume that later turns up on the shelf is simply inert.
 */
export async function skipSeriesGap(
  db: D1Database,
  series: string,
  indexSort: number,
  reason: string,
  note: string | null,
  decidedBy: number | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO series_gap_skip (series, index_sort, reason, note, decided_by)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(series, index_sort) DO UPDATE SET
         reason     = ?3,
         note       = ?4,
         decided_by = ?5,
         decided_at = datetime('now')`,
    )
    .bind(series, indexSort, reason, note, decidedBy)
    .run();
}

/**
 * Change your mind about a skipped rung.
 *
 * ⚠️ A real DELETE, unlike `deleteManualSeriesVolume`'s narrow one. That rule
 * exists because an imported row disappearing is indistinguishable from the book
 * having been bought; nothing imports these, so there is no such ambiguity and
 * no reason to keep a withdrawn decision on file.
 */
export async function unskipSeriesGap(
  db: D1Database,
  series: string,
  indexSort: number,
): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM series_gap_skip WHERE series = ?1 AND index_sort = ?2')
    .bind(series, indexSort)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * "That IS the same series — I own those on audio." — migration 0110.
 *
 * ⚠️ **Refuses a mapping no live rung carries**, and that guard is the whole
 * integrity of the feature. Without it this endpoint would accept any pair of
 * strings and unhedge rungs against a series name the audiobook catalog has never
 * used — the app claiming ownership on the strength of a typo. Returning `false`
 * rather than throwing lets the route answer 404, which is the honest reply:
 * there is nothing here to confirm.
 *
 * ⚠️ It deliberately does NOT require the rungs to be `fold`. Confirming a series
 * already corroborated by a work is inert — `toAudioRungInput` leaves a
 * `work_match` alone — and refusing it would mean the answer depended on a grade
 * the person clicking cannot see. An upsert, so re-confirming with a note is this
 * same request.
 */
export async function confirmAudioSeries(
  db: D1Database,
  series: string,
  audiobookSeries: string,
  note: string | null,
  confirmedBy: number | null,
): Promise<boolean> {
  const rung = await db
    .prepare(
      `SELECT 1 AS ok FROM audiobook_series_holding
        WHERE series = ?1 AND audiobook_series = ?2 AND stale_at IS NULL
        LIMIT 1`,
    )
    .bind(series, audiobookSeries)
    .first<{ ok: number }>();
  if (!rung) return false;

  await db
    .prepare(
      `INSERT INTO audiobook_series_link (series, audiobook_series, note, confirmed_by)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(series) DO UPDATE SET
         audiobook_series = ?2,
         note             = ?3,
         confirmed_by     = ?4,
         confirmed_at     = datetime('now')`,
    )
    .bind(series, audiobookSeries, note, confirmedBy)
    .run();
  return true;
}

/**
 * Take the confirmation back — every rung it was holding up goes back to AUDIO?
 * and back into the missing count.
 *
 * A plain DELETE, as in `unskipSeriesGap` and for the same reason: nothing imports
 * these rows, so a row disappearing cannot be mistaken for anything else.
 */
export async function unconfirmAudioSeries(db: D1Database, series: string): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM audiobook_series_link WHERE series = ?1')
    .bind(series)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Record that a source was consulted about a series, and what it said. */
export async function recordSeriesCheck(
  db: D1Database,
  series: string,
  source: string,
  outcome: 'ok' | 'not_found',
  volumesSeen: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO series_check (series, source, outcome, volumes_seen)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(series) DO UPDATE SET
         checked_at   = datetime('now'),
         source       = ?2,
         outcome      = ?3,
         volumes_seen = ?4`,
    )
    .bind(series, source, outcome, volumesSeen)
    .run();
}

/**
 * Every series name this catalog knows, from all three places one lives:
 * `work.series`, `series_volume.series`, `series_check.series`.
 *
 * This union is named by the bare-series-name rule (tier 2 of
 * `catalog-platform/docs/info/matching-thresholds.md` section 6): a scan or
 * lookup candidate titled with one of these names and carrying no volume
 * number is review-only, because it may be an Open Library work-level
 * aggregate wearing the series name as a title -- the shape that minted the
 * phantom Space Knight (6 editions, 6 copies) on 2026-08-13.
 *
 * Returned as the curated spellings; fold them with `foldSeriesNames` in
 * `@lc/core` -- folding here would be a second normalisation rule living in
 * SQL, which is the drift the matcher's header bans.
 */
export async function listKnownSeriesNames(db: D1Database): Promise<string[]> {
  const res = await db
    .prepare(
      `SELECT series FROM work WHERE series IS NOT NULL AND series <> ''
       UNION
       SELECT series FROM series_volume WHERE series IS NOT NULL AND series <> ''
       UNION
       SELECT series FROM series_check WHERE series IS NOT NULL AND series <> ''`,
    )
    .all<{ series: string }>();
  return (res.results ?? []).map((r) => r.series);
}
