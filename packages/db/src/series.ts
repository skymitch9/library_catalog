import {
  editionMedium,
  seriesCompleteness,
  type CreateSeriesVolume,
  type EditionMedium,
  type SeriesCompleteness,
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

/**
 * A volume we hold two printings of *in the same medium* — see `boughtTwice`.
 *
 * The Target-exclusive-versus-Barnes-&-Noble case. Kept apart from the ladder
 * because it answers a different question: the ladder is *which volumes*, this
 * is *how many ways we have one of them*, and threading the second into the
 * first makes a rung that is two rungs tall for a reason nobody scanning the run
 * cares about.
 *
 * `editions` carries **all** of the work's printings, not only the repeated
 * ones. Once a row is being shown at all, "two hardcovers and an EPUB" is the
 * honest description and "two hardcovers" is a partial one.
 */
export interface AlternateEditions {
  workId: number;
  title: string;
  /** Null for a work in the series with no place on the number line. */
  index: number | null;
  display: string | null;
  coverUrl: string | null;
  editions: EditionRef[];
}

/**
 * What we hold across a whole series, counted in works rather than editions.
 *
 * ⚠️ Works, not editions, and the difference matters the moment the alternate
 * editions above exist: three printings of volume 1 is one book on the shelf,
 * and "4 physical" meaning "2 books, one of them bought three times" would be a
 * number that sorts and filters and means nothing.
 */
export interface SeriesHoldings {
  /** Held works, wishes excluded. Matches `SeriesCompleteness.owned`. */
  works: number;
  physical: number;
  ebook: number;
  /** Held works the sibling audiobook catalog also has. */
  audio: number;
  /** Held works with two printings of one medium — see `boughtTwice`. */
  alternates: number;
}

export interface SeriesReport {
  completeness: SeriesCompleteness;
  holdings: SeriesHoldings;
  /** Every volume, owned or attested, in order. The page's ladder. */
  ladder: SeriesLadderEntry[];
  /** Works in this series we hold but cannot place on the number line. */
  unnumbered: { workId: number; title: string; display: string | null }[];
  /** Works we hold in more than one printing. Usually empty; see the type. */
  alternates: AlternateEditions[];
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

interface AudioRow {
  work_id: number;
  title: string;
  series: string | null;
  index_display: string | null;
  matched_via: string;
  via_alias: string | null;
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

async function loadAll(
  db: D1Database,
  readerId: number,
  onlySeries?: string,
): Promise<{
  owned: OwnedRow[];
  volumes: VolumeRow[];
  checks: Map<string, CheckRow>;
  editions: Map<number, EditionRow[]>;
  audio: Map<number, AudioRow>;
}> {
  const scope = onlySeries ? 'AND w.series = ?2' : '';
  const volumeScope = onlySeries ? 'WHERE series = ?1' : '';
  const checkScope = onlySeries ? 'WHERE series = ?1' : '';
  // These two join `work` rather than being scoped by a series column of their
  // own, so the bound parameter is ?1 and not ?2 — neither needs the reader id.
  const joinScope = onlySeries ? 'AND w.series = ?1' : '';

  const [owned, volumes, checks, editions, audio] = await Promise.all([
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
  ]);

  return {
    owned: owned.results,
    volumes: volumes.results,
    checks: new Map(checks.results.map((c) => [c.series, c])),
    editions: groupBy(editions.results),
    // One row per work — `audiobook_holding.work_id` is the primary key.
    audio: new Map(audio.results.map((a) => [a.work_id, a])),
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

/**
 * ⚠️ Two printings **of the same medium** — not merely two printings.
 *
 * The obvious rule is `editions.length > 1`, and it is wrong. A book held as an
 * EPUB and as a paperback has two edition rows and is not a book anybody bought
 * twice: it is one book in two formats, which the media chips on its rung
 * already say, and listing it again underneath is the same fact told twice.
 *
 * What the second section is for is the Target-exclusive-versus-Barnes-&-Noble
 * case — two objects of the same kind that differ only in who sold them, where
 * nothing else on the page can show you there are two. Requiring a repeat within
 * one medium catches exactly that, plus *White Sand* (two `ebook_epub` rows, a
 * single volume and an omnibus) and *Dinosaur Dance!* (a paperback and a
 * hardcover, which genuinely is the board book bought twice).
 *
 * Caught by a local fixture, not by reading: the first version put a rung with
 * an ebook and a paperback into "bought more than once", and against the
 * BackerKit import that is about to land it would have swept up nearly every
 * book in the house.
 */
function boughtTwice(editions: EditionRef[]): boolean {
  const perMedium = new Map<EditionMedium, number>();
  for (const e of editions) {
    const m = editionMedium(e.format);
    perMedium.set(m, (perMedium.get(m) ?? 0) + 1);
  }
  return [...perMedium.values()].some((n) => n > 1);
}

function toAudiobookRef(a: AudioRow): AudiobookRef {
  return {
    title: a.title,
    series: a.series,
    indexDisplay: a.index_display,
    matchedVia: a.matched_via,
    viaAlias: a.via_alias,
  };
}

function reportFor(
  series: string,
  owned: OwnedRow[],
  volumes: VolumeRow[],
  check: CheckRow | undefined,
  editionsByWork: Map<number, EditionRow[]>,
  audioByWork: Map<number, AudioRow>,
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
    alternates: 0,
  };
  const alternates: AlternateEditions[] = [];

  for (const w of heldWorks) {
    const editions = editionsFor(w.id);
    for (const m of mediaOf(editions)) holdings[m] += 1;
    if (audioByWork.has(w.id)) holdings.audio += 1;
    if (boughtTwice(editions)) {
      holdings.alternates += 1;
      alternates.push({
        workId: w.id,
        title: w.title,
        index: w.series_index_sort,
        display: w.series_index_display,
        coverUrl: w.cover_url,
        editions,
      });
    }
  }

  // Down the number line, then anything unplaceable — the ladder's order, so the
  // second section reads as an annotation of the first rather than a new list.
  alternates.sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity));

  return {
    completeness,
    holdings,
    ladder,
    unnumbered: unnumberedRows.map((w) => ({
      workId: w.id,
      title: w.title,
      display: w.series_index_display,
    })),
    alternates,
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
  const { owned, volumes, checks, editions, audio } = await loadAll(db, readerId);

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
        audio,
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
  const { owned, volumes, checks, editions, audio } = await loadAll(db, readerId, name);
  if (owned.length === 0 && volumes.length === 0) return null;
  return reportFor(name, owned, volumes, checks.get(name), editions, audio);
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
