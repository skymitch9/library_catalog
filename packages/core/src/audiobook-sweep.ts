/**
 * The audiobook association sweep, as a decision — the DATA, never the SQL.
 *
 * Phases 1 and 2 of `scripts/backfill-audiobook-holdings.mjs` moved here whole
 * on 2026-09-05 (phase 0 of
 * `catalog-platform/docs/info/audiobook-association-route.md`). Read that
 * script's header for the *why* behind every rule below; this file is the same
 * rules with the I/O taken out.
 *
 * ## 🔴 The hinge: this returns ROWS, not statements
 *
 * The script builds SQL strings (`lit(...)` interpolation, run through
 * `wrangler d1 execute`). A Worker binds prepared statements. If this function
 * returned SQL, only one of the two callers could use it — and the whole point
 * of the extraction is that the script and the route cannot drift about which
 * audiobook belongs to which book. So it returns a plan:
 *
 * - `editionUpserts` / `editionStales` — `audiobook_edition_holding` (0390)
 * - `rungUpserts` / `rungStales` — `audiobook_series_holding` (0090)
 * - `report` — exactly the numbers and lists the script prints today
 *
 * ⚠️ **`report` is part of the contract, not a debugging extra.** The script's
 * dry-run output is the phase-0 acceptance test: it must not change by one
 * character, and it can only stay unchanged if everything it prints is derivable
 * from the plan.
 *
 * ## ⚠️ The matcher is NOT reimplemented here
 *
 * Every match comes from `matchIndexedWorkAll` in `matching.ts`, through the
 * index this module builds with `buildWorkIndex`. That file opens with three
 * wrong-game matches the sibling Board Game Catalog shipped, every one from a
 * second similarity function drifting from the first. Nothing below compares
 * two strings itself, and nothing below may start to.
 *
 * ## ⚠️ Phase 2 does NO title comparison, deliberately
 *
 * It joins on `(series, index_sort)` and on nothing else, because a gap rung has
 * no title to compare. Containment matching is what produced the flat lie "All 5
 * held on audio" on *Tamer*; there is none of it in phase 2 and there must not
 * be.
 */

import {
  buildWorkIndex,
  matchIndexedWorkAll,
  type WorkIndex,
} from './matching.js';
import { normaliseTitle } from './titles.js';
import type { AudiobookRow } from './audiobook-csv.js';

/** How a work-level match was made. Strongest first — see `VIA_RANK`. */
export type AudiobookMatchedVia = 'exact' | 'alias' | 'containment';

/** How a series' rungs were reached. */
export type SeriesMatchedVia = 'work_match' | 'fold';

/**
 * ⚠️ Strongest first. A rung that claims less never displaces one that claims
 * more — and the printed pair is always tried before any alias, so a work with
 * aliases can only ever GAIN a match, never have one replaced by a weaker route.
 */
export const VIA_RANK: Readonly<Record<AudiobookMatchedVia, number>> = {
  exact: 0,
  alias: 1,
  containment: 2,
};

/** One of our works, as the sweep needs it. `work.series_index_sort`, camelCased. */
export interface SweepWork {
  id: number;
  title: string;
  authors: string;
  series: string | null;
  /** Our side's volume number. Only ever consulted by an ambiguous fold. */
  seriesIndexSort: number | null;
}

/** One `work_alias` row. `kind` absent means `'title'` — migration 0005's default. */
export interface SweepAlias {
  workId: number;
  alias: string;
  kind?: string | null | undefined;
}

/** The other names our books answer to, kept apart by kind. */
export interface WorkAliasGroups {
  titles: ReadonlyMap<number, string[]>;
  authors: ReadonlyMap<number, string[]>;
}

/**
 * Group `work_alias` rows by work and kind.
 *
 * ⚠️ Exported because the script PRINTS the two group sizes before the sweep
 * runs, and computing them a second way is how two numbers start to disagree.
 * A title alias is offered as a title and an author alias as an author, never
 * the other way round — letting an alternate title widen the AUTHOR gate is the
 * one thing `matching.ts` says must not happen.
 */
export function groupWorkAliases(rows: readonly SweepAlias[]): WorkAliasGroups {
  const titles = new Map<number, string[]>();
  const authors = new Map<number, string[]>();
  for (const a of rows) {
    const into = a.kind === 'author' ? authors : titles;
    const list = into.get(Number(a.workId));
    if (list) list.push(a.alias);
    else into.set(Number(a.workId), [a.alias]);
  }
  return { titles, authors };
}

/** An `audiobook_edition_holding` row as it stands today, for the stale sweep. */
export interface ExistingEdition {
  workId: number;
  audioKey: string;
  staleAt: string | null;
}

/** An `audiobook_series_holding` row as it stands today. */
export interface ExistingRung {
  series: string;
  indexSort: number;
  staleAt: string | null;
}

/**
 * 🔴 Which works this run stands behind — and therefore what it may mark stale.
 *
 * `{ kind: 'all' }` is the full sweep: it has looked at every work, so a row it
 * did not reproduce is genuinely gone.
 *
 * `{ kind: 'works', ids }` is the per-work hook. **It has looked at one book, so
 * it has no standing to say any OTHER row is gone**, and this plan therefore
 * carries ZERO stale entries under it — §6.2 guard 3 of the design, as a
 * type-level distinction rather than a flag somebody remembers.
 * `packages/core/test/audiobook-sweep-scope.test.ts` pins it.
 */
export type SweepScope = { kind: 'all' } | { kind: 'works'; ids: readonly number[] };

export interface AudiobookSweepInput {
  works: readonly SweepWork[];
  aliases: WorkAliasGroups;
  audiobooks: readonly AudiobookRow[];
  existingEditions: readonly ExistingEdition[];
  existingRungs: readonly ExistingRung[];
  /**
   * The estate series canon fold, injected because `@lc/core` holds no data.
   * The script passes the LIVE read; the Worker passes `@lc/universes`'
   * `canonicalSeries` over the generated copy. §2.4 states the skew.
   *
   * ⚠️ An unknown name must come back UNCHANGED, never null.
   */
  canonicalSeries: (name: string) => string;
  scope: SweepScope;
}

/** One row for `audiobook_edition_holding`. Column names, camelCased. */
export interface AudiobookEditionRow {
  workId: number;
  audioKey: string;
  title: string;
  rawTitle: string;
  authors: string;
  series: string | null;
  indexDisplay: string | null;
  indexSort: number | null;
  coverHref: string | null;
  narrator: string | null;
  matchedVia: AudiobookMatchedVia;
  /** Rounded to 4 places HERE, so both callers store the identical number. */
  titleSimilarity: number;
  /** Which alias this row was reached under, or null for the printed pair. */
  viaAlias: string | null;
}

/** One row for `audiobook_series_holding`. */
export interface AudiobookSeriesRungRow {
  series: string;
  indexSort: number;
  title: string;
  authors: string;
  audiobookSeries: string | null;
  indexDisplay: string | null;
  coverHref: string | null;
  seriesMatchedVia: SeriesMatchedVia;
}

/** One audiobook edition a work reached, with the rung it was reached by. */
export interface MatchedEdition {
  row: AudiobookRow;
  via: AudiobookMatchedVia;
  similarity: number;
  alias: string | null;
}

/** The per-work verdict the report prints. ONE entry per work, however many editions. */
export interface MatchedWork extends MatchedEdition {
  work: SweepWork;
  editionCount: number;
}

/** A work reaching more than one recording — migration 0390's whole point. */
export interface MultiEditionWork {
  work: SweepWork;
  editions: MatchedEdition[];
}

/** What phase 2 decided about one of our series. */
export interface RungReportEntry {
  series: string;
  via: SeriesMatchedVia;
  /** What the audiobook catalog calls it, when that differs. */
  abName: string | null;
  indexes: number[];
  /** How many of those rungs did not exist before this run. */
  fresh: number;
}

/**
 * Everything the script prints, and everything the route returns as JSON.
 *
 * ⚠️ Nothing here is a convenience. If a field is dropped, the script's output
 * changes, and the phase-0 gate is that it does not.
 */
export interface SweepReport {
  /** Works considered for the percentages — the whole catalog, even under scope. */
  workCount: number;
  audiobookCount: number;
  matched: MatchedWork[];
  missed: SweepWork[];
  byVia: Record<AudiobookMatchedVia, number>;
  /** Matches reached only through one of our aliases. */
  viaAliasCount: number;
  /** Every `(work, audio_key)` this run stands behind. */
  liveEditions: { workId: number; audioKey: string }[];
  multiEdition: MultiEditionWork[];
  editionsGoneStale: number;
  rungs: RungReportEntry[];
  rungsGoneStale: number;
  /**
   * ⚠️ Series a SCOPED run declined to write rungs for — see `planAudiobookSweep`.
   * Always empty under `{ kind: 'all' }`.
   */
  foldSeriesDeferred: string[];
}

export interface SweepPlan {
  editionUpserts: AudiobookEditionRow[];
  editionStales: { workId: number; audioKey: string }[];
  rungUpserts: AudiobookSeriesRungRow[];
  rungStales: { series: string; indexSort: number }[];
  report: SweepReport;
  scope: SweepScope;
}

/**
 * A NUL joins the two halves so no work id + audio title can ever collide with
 * another pair. Written as an escape, never a literal byte: a stray NUL in a
 * source file makes git treat it as binary and every future diff unreadable.
 */
function editionKey(workId: number, audioKey: string): string {
  return `${workId}\u0000${audioKey}`;
}

function rungKey(series: string, index: number): string {
  return `${series}|${index}`;
}

/** One attempt at naming a work: a title, an author, and which alias was spent. */
interface Attempt {
  title: string;
  authors: string;
  alias: string | null;
}

/**
 * Every name pair worth asking under: the printed one first, then the recorded
 * aliases.
 *
 * ⚠️ The printed pair is always tried first and wins ties, so a work with
 * aliases can only ever gain a match, never have one replaced by a weaker route.
 */
function attempts(w: SweepWork, aliases: WorkAliasGroups): Attempt[] {
  const titles: (string | null)[] = [null, ...(aliases.titles.get(Number(w.id)) ?? [])];
  const authors: (string | null)[] = [null, ...(aliases.authors.get(Number(w.id)) ?? [])];
  const out: Attempt[] = [];
  for (const t of titles) {
    for (const a of authors) {
      out.push({
        title: t ?? w.title,
        authors: a ?? w.authors,
        // Which alias, if any, this attempt is spending. Null for the printed
        // pair; the alias string when one is in play, so the row can record it.
        alias: t && a ? `${t} / ${a}` : (t ?? a),
      });
    }
  }
  return out;
}

/** `matchIndexedWorkAll`, and nothing else. See the header. */
function lookupAll(
  index: WorkIndex<AudiobookRow>,
  title: string,
  authors: string,
  seriesIndex: number | null,
): MatchedEdition[] {
  return matchIndexedWorkAll(index, title, authors, seriesIndex).map((m) => ({
    row: m.work,
    via: m.via,
    similarity: m.titleSimilarity,
    alias: null,
  }));
}

/**
 * Decide the whole sweep, and write nothing.
 *
 * ## Scope, and the one place the two callers genuinely differ
 *
 * Under `{ kind: 'all' }` this is the script's behaviour exactly.
 *
 * Under `{ kind: 'works', ids }`:
 *
 * - phase 1 runs over those works only;
 * - 🔴 **`editionStales` and `rungStales` are empty** — a run that looked at one
 *   book cannot say another book's row is gone (§6.2 guard 3);
 * - phase 2 runs over those works' series only, and ⚠️ **emits a rung ONLY when
 *   this run itself corroborated the series** (`via === 'work_match'`). A scoped
 *   run holds a fraction of the evidence, so a `fold` verdict from it is not a
 *   weaker fact — it is an ABSENCE of the evidence a full sweep had, and writing
 *   it would downgrade a `work_match` rung the cron had already earned. Those
 *   series are named in `report.foldSeriesDeferred` and left to the cron, which
 *   is the backstop the design already relies on.
 */
export function planAudiobookSweep(input: AudiobookSweepInput): SweepPlan {
  const { works, aliases, audiobooks, existingEditions, existingRungs, canonicalSeries, scope } =
    input;

  const scopedIds = scope.kind === 'works' ? new Set(scope.ids.map(Number)) : null;
  const scopedWorks = scopedIds ? works.filter((w) => scopedIds.has(Number(w.id))) : works;

  const index = buildWorkIndex(audiobooks as AudiobookRow[]);

  const editionUpserts: AudiobookEditionRow[] = [];
  const matched: MatchedWork[] = [];
  const missed: SweepWork[] = [];
  /** Every edition this run stands behind. */
  const liveEditions = new Set<string>();
  const multiEdition: MultiEditionWork[] = [];

  // -------------------------------------------------------------------------
  // Phase 1 — the works this catalog holds
  // -------------------------------------------------------------------------

  for (const w of scopedWorks) {
    let best: MatchedEdition | null = null;
    // Our own volume number, when we have one. Per-work rather than per-attempt:
    // an alias never changes which physical book #w is, so its volume number is
    // the same on every attempt. Only ever consulted by an ambiguous-fold match
    // (Space Knight). See matching.ts `disambiguateByVolume`.
    const seriesIndex = w.seriesIndexSort == null ? null : Number(w.seriesIndexSort);

    /**
     * Every audiobook edition this work reaches, keyed by `audio_key` — the
     * sibling catalog's verbatim title, which is `audiobook_edition_holding`'s
     * other primary-key half (migration 0390).
     *
     * ⚠️ One entry per key with the STRONGEST rung kept, exactly as `best` is
     * chosen below. Two attempts (the printed pair, then an alias pair) can
     * reach the same edition by different rungs, and the row must record the
     * better of them — an alias-route containment claim must not overwrite an
     * exact one.
     */
    const editions = new Map<string, MatchedEdition>();

    for (const attempt of attempts(w, aliases)) {
      // ⚠️ `lookupAll`, not a single answer: the table is keyed per edition, and
      // a work with two recordings must produce two rows. `hits[0]` is what a
      // single lookup would have returned, so `best` below is unchanged.
      const hits = lookupAll(index, attempt.title, attempt.authors, seriesIndex);
      for (const hit of hits) {
        const prev = editions.get(hit.row.rawTitle);
        const stronger =
          !prev ||
          VIA_RANK[hit.via] < VIA_RANK[prev.via] ||
          (VIA_RANK[hit.via] === VIA_RANK[prev.via] && hit.similarity > prev.similarity);
        if (stronger) editions.set(hit.row.rawTitle, { ...hit, alias: attempt.alias });
      }

      const top = hits[0];
      if (!top) continue;
      const better =
        !best ||
        VIA_RANK[top.via] < VIA_RANK[best.via] ||
        (VIA_RANK[top.via] === VIA_RANK[best.via] && top.similarity > best.similarity);
      if (better) best = { ...top, alias: attempt.alias };
    }

    if (!best) {
      missed.push(w);
      continue;
    }
    // ⚠️ Still ONE entry per work. Phase 2 and the report both read this, and
    // both ask a per-work question ("did a work corroborate this series
    // mapping?"). The edition set is a separate structure on purpose.
    matched.push({ work: w, ...best, editionCount: editions.size });
    if (editions.size > 1) multiEdition.push({ work: w, editions: [...editions.values()] });

    for (const [audioKey, e] of editions) {
      liveEditions.add(editionKey(w.id, audioKey));
      editionUpserts.push({
        workId: w.id,
        audioKey,
        title: e.row.title,
        // ⚠️ `raw_title` is `e.row.rawTitle`, NOT `e.row.title` — migration
        // 0340. `title` is stripped by `cleanTitleWithSeries` and is what a
        // person is shown; `raw_title` is the sibling catalog's verbatim string
        // and is the one the content-warning key is derived from. Migration 0390
        // reuses that same string as `audio_key`, so the edition identity here
        // and the warning identity there cannot drift apart.
        rawTitle: e.row.rawTitle,
        authors: e.row.authors,
        series: e.row.series,
        indexDisplay: e.row.seriesIndexDisplay,
        indexSort: e.row.seriesIndexSort,
        coverHref: e.row.coverHref,
        narrator: e.row.narrator,
        matchedVia: e.via,
        titleSimilarity: Number(e.similarity.toFixed(4)),
        viaAlias: e.alias,
      });
    }
  }

  // An EDITION that no longer matches. Marked, never deleted — migration 0010's
  // rule, now applied one row finer: a work can keep one recording and lose
  // another (the other catalog re-titled it, or it was returned), and only the
  // row that went away may be marked. Marking by `work_id` alone would stale a
  // live edition every time its sibling changed.
  //
  // 🔴 Empty under a scoped run. See the doc comment above.
  const goneStale =
    scope.kind === 'all'
      ? existingEditions.filter(
          (r) => !liveEditions.has(editionKey(Number(r.workId), r.audioKey)) && !r.staleAt,
        )
      : [];
  const editionStales = goneStale.map((r) => ({ workId: Number(r.workId), audioKey: r.audioKey }));

  // -------------------------------------------------------------------------
  // Phase 2 — the rungs with no work row at all (migration 0090)
  //
  // ⚠️ Joined on `(series, index_sort)` and on nothing else. A gap rung has no
  // title — `completeness.ts` cannot even name an `interior` hole — so there is
  // nothing to match, which is exactly why this is safe.
  //
  // The fold is `normaliseTitle` after `canonicalSeries`, and the script's
  // header records why each: `normaliseTitle` is the project's ONE fold and
  // already the series-name fold `backfill-series-volumes.mjs` uses;
  // `canonicalSeries` removes the DECORATION-shaped cross-catalog drift
  // (`"[publication order]"`, `"(Full-Cast Editions)"`) that `normaliseTitle`
  // alone does not, and which built ZERO audio rungs for three series before
  // 2026-08-14.
  //
  // ⚠️ It folds for COMPARISON only. What is STORED is our spelling, so the read
  // path joins `work.series` exactly and no fold runs in the Worker.
  // -------------------------------------------------------------------------

  const fold = (name: string): string => normaliseTitle(canonicalSeries(name));

  /** Folded audiobook series name -> its rows. */
  const abBySeries = new Map<string, AudiobookRow[]>();
  for (const row of audiobooks) {
    if (!row.series) continue;
    const key = fold(row.series);
    const list = abBySeries.get(key);
    if (list) list.push(row);
    else abBySeries.set(key, [row]);
  }

  /**
   * Which of our series a work-level match has already proved.
   *
   * ⚠️ Both halves, and the second is the one that matters. A work matched by
   * `matching.ts` proves the two SERIES NAMES mean one series; the same work
   * carrying the same volume number on both sides additionally proves the two
   * catalogs NUMBER it alike. Only that pair earns `work_match` — everything
   * else is a `fold`, because a series whose numbering we have never seen agree
   * is a series whose book 4 might be somebody else's 3.
   */
  const corroborated = new Set<string>();
  for (const m of matched) {
    if (!m.work.series || !m.row.series) continue;
    if (fold(m.work.series) !== fold(m.row.series)) continue;
    if (m.work.seriesIndexSort == null || m.row.seriesIndexSort == null) continue;
    if (Number(m.work.seriesIndexSort) !== Number(m.row.seriesIndexSort)) continue;
    corroborated.add(m.work.series);
  }

  const ourSeries = [
    ...new Set((scopedIds ? scopedWorks : works).map((w) => w.series).filter(Boolean)),
  ].sort() as string[];

  const rungUpserts: AudiobookSeriesRungRow[] = [];
  const rungs: RungReportEntry[] = [];
  const liveRungs = new Set<string>();
  const foldSeriesDeferred: string[] = [];

  for (const series of ourSeries) {
    const hits = abBySeries.get(fold(series)) ?? [];
    const numbered = hits.filter((h) => typeof h.seriesIndexSort === 'number');
    if (numbered.length === 0) continue;

    const via: SeriesMatchedVia = corroborated.has(series) ? 'work_match' : 'fold';

    // ⚠️ A scoped run holds a fraction of the evidence, so its `fold` verdict is
    // an absence of proof rather than a weaker proof — writing it would
    // DOWNGRADE a `work_match` rung a full sweep already earned. Defer to the
    // cron, and say which series were deferred.
    if (scope.kind !== 'all' && via !== 'work_match') {
      foldSeriesDeferred.push(series);
      continue;
    }

    // One row per index — the same rule `backfill-series-volumes.mjs` applies,
    // so the two tables cannot end up describing different rungs. First wins.
    const seen = new Map<number, AudiobookRow>();
    for (const h of numbered) {
      if (!seen.has(h.seriesIndexSort as number)) seen.set(h.seriesIndexSort as number, h);
    }

    for (const [index, row] of [...seen].sort((a, b) => a[0] - b[0])) {
      liveRungs.add(rungKey(series, index));
      rungUpserts.push({
        series,
        indexSort: index,
        title: row.title,
        authors: row.authors,
        audiobookSeries: row.series,
        indexDisplay: row.seriesIndexDisplay,
        coverHref: row.coverHref,
        seriesMatchedVia: via,
      });
    }

    rungs.push({
      series,
      via,
      abName: (hits[0] as AudiobookRow).series,
      indexes: [...seen.keys()].sort((a, b) => a - b),
      fresh: [...seen.keys()].filter(
        (i) => !existingRungs.some((r) => rungKey(r.series, r.indexSort) === rungKey(series, i)),
      ).length,
    });
  }

  // Marked, never deleted — the other catalog renaming a series must not look
  // like the audiobook having been returned. 🔴 Empty under a scoped run.
  const rungsGoneStale =
    scope.kind === 'all'
      ? existingRungs.filter((r) => !liveRungs.has(rungKey(r.series, r.indexSort)) && !r.staleAt)
      : [];
  const rungStales = rungsGoneStale.map((r) => ({ series: r.series, indexSort: r.indexSort }));

  const byVia = (v: AudiobookMatchedVia): number => matched.filter((m) => m.via === v).length;

  return {
    editionUpserts,
    editionStales,
    rungUpserts,
    rungStales,
    scope,
    report: {
      workCount: works.length,
      audiobookCount: audiobooks.length,
      matched,
      missed,
      byVia: { exact: byVia('exact'), alias: byVia('alias'), containment: byVia('containment') },
      viaAliasCount: matched.filter((m) => m.alias).length,
      liveEditions: [...liveEditions].map((k) => {
        // Undo `editionKey`. The split must use the SAME escape, never a literal
        // byte — a stray NUL in a source file makes git call it binary.
        const cut = k.indexOf('\u0000');
        return { workId: Number(k.slice(0, cut)), audioKey: k.slice(cut + 1) };
      }),
      multiEdition,
      editionsGoneStale: goneStale.length,
      rungs,
      rungsGoneStale: rungsGoneStale.length,
      foldSeriesDeferred,
    },
  };
}
