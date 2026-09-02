/**
 * The FREE rungs, asked before anybody pays for an answer.
 *
 * ## Why this file exists — the owner's words, 2026-08-22
 *
 * > *"we have a problem with Elantris. item 514 in the library didnt pull from
 * > the audiobook catalog even though we own 2 audio editions, and it didnt pull
 * > information from the other catalog when i hit look up. so first link them
 * > all together, then in missing details make sure when the look up button is
 * > hit, it does the free checks first, we have a pipeline use it"*
 *
 * "Look up" went straight to the paid model. There was **no free rung anywhere
 * on that path** — not the household's own audiobook catalogue, not Open
 * Library, not Google Books — so the button spent money asking the open web for
 * facts this estate already holds, and *Elantris* came back with nothing from
 * "the other catalog" because it was never asked.
 *
 * ## The ladder
 *
 * | # | Rung | Can answer | Costs |
 * |---|---|---|---|
 * | 1 | `audiobook_holding` — our own D1 | series, volume | a JOIN |
 * | 2 | the estate index (`/api/machine/lookup`) | series, volume | 1–3 requests |
 * | 3 | Open Library `/works/<key>/editions.json` | series, volume, description | 1 req/s |
 * | 4 | Google Books by ISBN | description, series hints | a keyed request |
 * | 5 | Hardcover.app GraphQL by ISBN | description, series, volume | a keyed request, 5,000/day |
 * | 6 | Wikidata SPARQL by ISBN | series, volume | a keyless request |
 *
 * ⚠️ **Rung 5 is where the structured series arrives first.** Hardcover's
 * contributors skew genre/indie — the end of this catalogue that Wikidata's
 * notability bar misses — so it is asked BEFORE the Wikidata fallback, and it is
 * the only free rung that answers a blurb and a series in one request. Like
 * Google Books it is keyed, and like Google Books its absence is a NAMED skip
 * rather than a silent one (both instances hold `HARDCOVER_API_TOKEN` since
 * 2026-08-25; the named skip is what a future instance without it will see).
 *
 * ⚠️ **Rung 2 IS LIVE since 2026-08-25 — it was dark for two days and this
 * paragraph used to say so.** The gap it named ("no machine-read credential
 * exists anywhere in the estate") was closed by the index Worker's named
 * MACHINE READ exception, built 2026-08-23 and keyed 2026-08-25:
 *
 * | | Then (dark) | Now |
 * |---|---|---|
 * | Endpoint | `/api/lookup` — the HUMAN route | **`/api/machine/lookup`** |
 * | Credential | none existed | `INDEX_READ_TOKEN`, one value per INSTANCE |
 * | Response shape | **a guess**, parsed defensively from `unknown` | read off `read.ts:39-40,79` and parsed to a named type |
 *
 * ⚠️ **The old code dialled the wrong door and would have been refused every
 * run.** `INDEX_URL` and `INDEX_READ_TOKEN` were both set on this instance,
 * which read as "the rung is live", while the request went to `/api/lookup` —
 * a route sitting *below* the index's `requireEstateMember()` blanket, which
 * wants a human's Firebase ID token and answers 401 to a bearer. The machine
 * routes are mounted ABOVE that blanket, by name. So a rung can be configured,
 * unskipped, and still answer nothing; "the token is set" was never the same
 * fact as "the rung works".
 *
 * ⚠️ **Still gated on `INDEX_READ_TOKEN`, and unset is still a NAMED skip.**
 * A future instance without one must not look like a rung that was asked and
 * knew nothing. Nothing here guesses a value.
 *
 * ⚠️ **What the index will NOT answer: `description`.** It is an identity
 * index, not a metadata store — the projection this catalog pushes
 * (`packages/db/src/index-projection.ts`) carries no such column, and neither
 * does the row that comes back.
 *
 * ## ⚠️ The three rules that are not negotiable
 *
 * **1. Stop PER FIELD, not per rung.** A rung that answers `series` does not
 * end the ladder — `description` is still open and rung 4 is the one that
 * carries blurbs. Every rung is asked only about what is still outstanding, so
 * a fully-answered work costs nothing beyond the first rung and a half-answered
 * one costs exactly the rungs it needs.
 *
 * **2. A PRESENT ROW WITH A NULL COLUMN IS NOT AN ANSWER.** This is the
 * *Elantris* bug in one sentence. `audiobook_holding.work_id` is a PRIMARY KEY
 * (migration 0010), so the table holds **one** audio edition per work; the
 * household owns two *Elantris* audiobooks — the full-cast one and the Tenth
 * Anniversary Special Edition — and the row that landed is the first, whose
 * `series` is NULL. A ladder that treated "row found" as "rung answered" would
 * stop there and report nothing, for ever. Row present + column null ⇒ **fall
 * through to the next rung** and say why.
 *
 * **3. Never `work.title`, never `work.authors`.** `updateWork` re-derives
 * `work_key` from those two and the key joins ~860 audiobook reviews. The patch
 * this file builds names four columns and cannot name a fifth.
 *
 * ## What it deliberately does NOT answer: `firstPublished`
 *
 * Every free rung here can produce *a* year and none of them can produce the
 * right one. Open Library's editions and Google Books both date a **printing**;
 * `work.first_published` is a fact about the work's first appearance, and
 * `gaps.ts` already refuses edition years for exactly this reason ("facts about
 * a printing, attached to a row that is a file"). Filling it from a printing
 * would be a wrong number that sorts, filters and looks exactly like data.
 *
 * That refusal is **reported, not silent** — it comes back as a named skip — and
 * it costs little: measured 2026-08-22, the main catalogue had 30 works with no
 * year against 138 with no series and 51 with no description.
 *
 * ## Subrequest budget
 *
 * Every D1 call and every fetch counts against the Worker's 50 per invocation,
 * and this ladder runs *inside* a research run that already spends ~24 (see
 * `research-run.ts`). So every rung is **lazy**: the ISBN is looked up only when
 * a rung that needs one is actually going to run, the Open Library work record
 * is fetched only when `description` is still open, and a ladder with nothing
 * outstanding returns before it reads anything.
 *
 * ⚠️ **The worst case is not a number typed in a comment any more.** It is
 * `FREE_DETAILS_SUBREQUESTS`, summed from `FREE_LADDER_RUNGS` — see the table
 * there — because it was wrong twice: two rungs (Hardcover, Wikidata) landed
 * without moving it, and the enumeration it was copied from never counted
 * `updateWork`'s own `getWork`. Today it is **16** (13 + rung 2 going live at
 * `INDEX_MAX_IDENTITIES`); the ordinary case is still 4 or 5.
 */

import {
  detectSeriesFromTitle,
  // ⚠️ THE project's one matcher — F9's same-series gate compares with this and
  // never with a fold of its own. See `fieldsClosedBy`, and `matching.ts`'s
  // header for the three wrong matches a second similarity function cost.
  isConfidentMatch,
  parseVolumeNumber,
  type DetailField,
} from '@lc/core';
import {
  getAudiobookHolding,
  getWork,
  listEditionsForWork,
  listGapVerdicts,
  updateWork,
  type Work,
} from '@lc/db';
import {
  editionsOfWork,
  lookupGoogleBooksByIsbn,
  lookupHardcover,
  lookupWikidataSeries,
  schedule,
  workDescription,
  workKeyForIsbn,
} from '@lc/isbn';
import type { Env } from '../env.js';
// ⚠️ `quotedDesignation`, NOT `printedFormIn` — they differ on "Volume Five"
// and the header of that file says exactly why. The free rungs read volume
// numbers with `parseVolumeNumber`, which understands words and Roman numerals.
import { quotedDesignation } from './detail-values.js';
// ⚠️ The ONE place the shared universe list meets this catalog's rows, and the
// only fold of a universe name in the Worker. `askHardcover` uses it as a
// PREDICATE — see the note there — rather than growing a second normaliser.
import { canonicalUniverse } from './universes.js';

/**
 * How this catalog identifies itself to every free API the ladder asks.
 *
 * ⚠️ **The contact is not decoration.** Wikidata's policy requires one and
 * blocks by UA when it throttles (F14, 2026-08-25); Open Library asks for one
 * too. A block arrives as a thrown HTTP error — a rung permanently skipped,
 * reported as one line in `skipped`, which is a quiet way to lose a source.
 * Same address and same spelling as `scripts/backfill-openlibrary-ids.mjs`.
 */
const UA = 'library_catalog/1.0 (private household catalog; nbaslamking@gmail.com)';

/** A rung that costs nothing. */
export type FreeRung =
  | 'audiobook'
  | 'index'
  | 'openlibrary'
  | 'googlebooks'
  | 'hardcover'
  | 'wikidata';

/**
 * Who answered for one field. The free rungs plus the paid one, so a single
 * per-field map can describe a whole run without the reader having to know
 * which half of the pipeline produced which entry.
 */
export type DetailSource = FreeRung | 'llm';

/** How a rung is named on screen and in the run record. */
export const RUNG_LABEL: Record<DetailSource, string> = {
  audiobook: 'the audiobook catalogue',
  index: 'the estate index',
  openlibrary: 'Open Library',
  googlebooks: 'Google Books',
  hardcover: 'Hardcover',
  wikidata: 'Wikidata',
  llm: 'a paid lookup',
};

/**
 * The fields a free rung can honestly answer.
 *
 * ⚠️ `firstPublished` is absent on purpose and its absence is REPORTED — see
 * the header. Adding it here without solving "which year is this?" would fill
 * a column with a printing's date.
 */
export const FREE_LADDER_FIELDS: readonly DetailField[] = ['series', 'seriesIndex', 'description'];

/** One field's worth of answer, and which rung is claiming it. */
interface FieldAnswer {
  rung: FreeRung;
  /** The series NAME. */
  series?: string;
  /** The position on the ladder — what closes the `seriesIndex` gap. */
  seriesIndexSort?: number;
  /** A designation the source QUOTED. Written only through `printedFormIn`. */
  seriesIndexDisplay?: string | null;
  description?: string;
}

export interface FreeDetailsOutcome {
  /** Fields written into `work`, with the rung that supplied each. */
  sources: Partial<Record<DetailField, FreeRung>>;
  /** One sentence per value written, in the shape `applyFinding` uses. */
  applied: string[];
  /**
   * ⚠️ Named, never counted. A rung that could not be ASKED and a rung that was
   * asked and knew nothing are different facts, and the cover sweep already
   * cost real time by printing them the same way (`covers-and-series.md` §0).
   * Every skip in here says which it was.
   */
  skipped: string[];
  /** Of the fields it was given, the ones still outstanding afterwards. */
  stillOpen: DetailField[];
  /**
   * The rungs this pass actually INVOKED, in ladder order.
   *
   * ⚠️ **"Not asked" and "asked and silent" are different facts, and `skipped`
   * can only ever carry the second.** The loop `break`s the moment every field
   * is closed, so a rung below the answer is never called and never writes a
   * skip line — it simply is not mentioned. Reading that absence as "it knew
   * nothing" would be the covers sweep's *"no cover anywhere"* mistake in a new
   * place (`covers-and-series.md` §0); reading it as "it was not reached" is the
   * truth, and it is the sentence that answers *why did this run cost money?*
   *
   * A run that closes everything on rung 1 therefore records ONE rung here, and
   * that short list is the evidence — not an omission.
   */
  askedRungs: FreeRung[];
}

export interface FreeDetailsOptions {
  /** Injected by the tests. Production passes nothing and gets global `fetch`. */
  fetchImpl?: typeof fetch;
  /**
   * ⚠️ Off in tests only. Open Library is a free, donation-funded service and
   * every call from production goes through `schedule` at ~1/s, the pace
   * `packages/isbn/src/throttle.ts` sets and every backfill script keeps.
   * Leaving it on in tests would add 1.1 s of real sleeping per assertion.
   */
  throttle?: boolean;
  /**
   * Other title names this book answers to — `work_alias` rows of kind `title`,
   * already capped and de-duplicated by `selectTitleAliases`. Only the rungs
   * that key off a TITLE STRING can use them, and today only `askIndex` does:
   * `askAudiobook` joins on `work_id`, and `askOpenLibrary`/`askGoogleBooks`
   * resolve by the recorded Open Library key or an ISBN, so an alias cannot
   * change what they ask. The caller passes them anyway, and the rung that CAN
   * use them fans out; the others ignore them, which is the honest shape rather
   * than pretending an ISBN lookup has a title to vary.
   */
  titleAliases?: readonly string[];
}

// ---------------------------------------------------------------------------
// Reading a series label
// ---------------------------------------------------------------------------

/**
 * A source's series label, split into a name and a volume.
 *
 * ⚠️ **The parse is `detectSeriesFromTitle`'s and nothing else's.** That
 * function is a measurement — it fires on 63 of this library's own 117 rows
 * where `parseSeriesFromTitle` fires on 0 — and it refuses to read a bare
 * trailing number as a volume, which is the rule that keeps *Summoner 6* one
 * title rather than six. A second, looser parse here would be a fifth author-
 * splitting rule in a project that has already been bitten by four.
 *
 * `declared` is what makes this safe to point at two very different strings:
 *
 * - **`true`** for a field the source SAYS is a series (`entries[].series`,
 *   `audiobook_holding.series`). A label that carries no volume — plain
 *   `"Cradle"` — is still a series name, so it is taken whole.
 * - **`false`** for a field that merely MIGHT contain one (an edition's
 *   `subtitle`, a Google Books title). ⚠️ Here an unparsed label is thrown
 *   away, because most subtitles are subtitles: reading *"A Novel"* as a series
 *   name would file the book on a shelf that does not exist. Only an explicit
 *   volume shape — *"Cradle, Volume Five"* — is believed.
 */
export function readSeriesLabel(
  raw: string | null | undefined,
  declared: boolean,
): { series: string; sort: number | null; display: string | null } | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  const parsed = detectSeriesFromTitle(text);
  if (parsed.series) {
    return {
      series: parsed.series,
      sort: parsed.index,
      // Only a QUOTED designation, never a bare number dressed up as one — and
      // only where a position was actually read, which is what stands in for
      // `printedFormIn`'s digit test. See `detail-values.ts`.
      display: parsed.index === null ? null : quotedDesignation(parsed.display),
    };
  }
  if (!declared) return null;

  /*
   * ⚠️ **The markerless numbering Open Library actually uses.** Measured
   * 2026-08-23 against the live API: `/works/OL…W/editions.json` answered
   * `series: ["Elantris (1)"]` — a bare number in brackets, with no *Book* or
   * *Volume* in sight. `detectSeriesFromTitle` refuses that shape by design
   * (rule: a bare trailing number is never a volume, or *Summoner 6* becomes
   * six copies of one book), so before this branch existed the whole string
   * landed in `work.series` and the catalogue grew a series literally named
   * **"Elantris (1)"** — a shelf of one, next to the real one.
   *
   * `Name (N)` and `Name #N` are the two spellings this field carries. The
   * NUMBER still goes through `parseVolumeNumber` and nothing else; the name is
   * whatever is in front of it, which is a split rather than a parse — the same
   * distinction `splitSeriesPrefix` draws in `@lc/core`.
   *
   * ⚠️ It only fires when `parseVolumeNumber` returns a position, so a series
   * whose name genuinely ends in a parenthetical — *"Discworld (UK)"* — keeps
   * its name whole. That guard is the whole reason this is safe.
   */
  const numbered = /^(.+?)\s*(?:\(\s*([^()]+?)\s*\)|#\s*([^\s#]+))\s*$/.exec(text);
  if (numbered) {
    const name = (numbered[1] ?? '').trim();
    const token = (numbered[2] ?? numbered[3] ?? '').trim();
    const sort = parseVolumeNumber(token);
    if (name && sort !== null) {
      // The token is a bare position, not a designation anybody printed, so
      // `quotedDesignation` refuses it and the display column stays empty.
      return { series: name, sort, display: quotedDesignation(token) };
    }
  }

  return { series: text, sort: null, display: null };
}

/**
 * The volume out of a stored display string, given the series it belongs to.
 *
 * `audiobook_holding.index_display` is the other catalogue's own spelling and
 * arrives as `"1"`, `"1.5"`, occasionally `"Book 1"`. `parseVolumeNumber`
 * handles the bare, worded and Roman forms directly; anything else is handed to
 * `detectSeriesFromTitle` with the series name in front of it, which is the
 * sanctioned reader for a marker-and-number shape. Null when neither can make a
 * position out of it — *"Extra.1"* and *"BR SS Compilation"* are real labels in
 * this library with no place on a number line, and null is the honest answer.
 */
export function readVolumeDisplay(
  display: string | null | undefined,
  series: string,
): { sort: number | null; display: string | null } {
  const text = (display ?? '').trim();
  if (!text) return { sort: null, display: null };

  const bare = parseVolumeNumber(text);
  if (bare !== null) return { sort: bare, display: quotedDesignation(text) };

  const combined = detectSeriesFromTitle(`${series} ${text}`);
  return {
    sort: combined.index,
    display: combined.index === null ? null : quotedDesignation(text),
  };
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/**
 * Lazily-fetched things a rung might need, so nothing is read for a rung that
 * never runs. Each getter caches, including its own failure to find anything.
 */
class LadderContext {
  private isbnLoaded = false;
  private isbnValue: string | null = null;
  private olKeyLoaded = false;
  private olKeyValue: string | null = null;

  constructor(
    readonly env: Env,
    readonly work: Work,
    readonly doFetch: typeof fetch,
    /** Extra title names a title-keyed rung may search under. See `askIndex`. */
    readonly titleAliases: readonly string[] = [],
  ) {}

  /**
   * Every title name this book answers to, most-canonical first: the catalogued
   * title, then its aliases. What a title-keyed rung fans out over.
   */
  titleIdentities(): string[] {
    return [this.work.title, ...this.titleAliases];
  }

  /** The first ISBN-13 on any edition of this work, or null. One D1 read. */
  async isbn13(): Promise<string | null> {
    if (this.isbnLoaded) return this.isbnValue;
    this.isbnLoaded = true;
    const editions = await listEditionsForWork(this.env.DB, this.work.id);
    this.isbnValue = editions.find((e) => (e.isbn13 ?? '').trim())?.isbn13 ?? null;
    return this.isbnValue;
  }

  /**
   * Open Library's WORK key: the recorded one, or one resolved from an ISBN.
   *
   * ⚠️ `workKeyForIsbn`, not `/api/books` — the latter returns an EDITION key
   * (`OL…M`), and `openlibrary_work_id` is a work key (`OL…W`) by definition.
   * Storing the wrong kind in that column is the mistake `resolve.ts` leaves a
   * comment about rather than making.
   */
  async openLibraryWorkKey(throttle: boolean): Promise<string | null> {
    if (this.olKeyLoaded) return this.olKeyValue;
    this.olKeyLoaded = true;

    const recorded = (this.work.openlibraryWorkId ?? '').trim();
    if (recorded) {
      this.olKeyValue = recorded;
      return this.olKeyValue;
    }

    const isbn = await this.isbn13();
    if (!isbn) return null;

    const found = await paced(throttle, () =>
      workKeyForIsbn(isbn, { fetchImpl: this.doFetch, userAgent: UA }),
    );
    this.olKeyValue = found?.workKey ?? null;
    return this.olKeyValue;
  }
}

/** One Open Library call, at the pace the whole project keeps. See `throttle.ts`. */
function paced<T>(throttle: boolean, fn: () => Promise<T>): Promise<T> {
  return throttle ? schedule(fn) : fn();
}

/**
 * Rung 1 — the household's own audiobook catalogue, already in this D1.
 *
 * ⚠️ The NULL-series fall-through lives here. See rule 2 in the header: a row
 * whose `series` is NULL is a row about an audio edition nobody recorded a
 * series for, not a statement that the book has none.
 */
async function askAudiobook(
  ctx: LadderContext,
  open: ReadonlySet<DetailField>,
  skipped: string[],
): Promise<FieldAnswer[]> {
  if (!open.has('series') && !open.has('seriesIndex')) return [];

  const holding = await getAudiobookHolding(ctx.env.DB, ctx.work.id);
  if (!holding) {
    skipped.push('the audiobook catalogue: no audio edition is linked to this book');
    return [];
  }

  const label = readSeriesLabel(holding.series, true);
  if (!label) {
    skipped.push(
      'the audiobook catalogue: an audio edition is linked but its series is blank — ' +
        'the table holds one edition per book (migration 0010) and this one carries no series, ' +
        'so the next rung was asked',
    );
    return [];
  }

  const volume = readVolumeDisplay(holding.indexDisplay, label.series);
  const answer: FieldAnswer = { rung: 'audiobook', series: label.series };
  const sort = volume.sort ?? label.sort;
  if (sort !== null) {
    answer.seriesIndexSort = sort;
    answer.seriesIndexDisplay = volume.display ?? label.display;
  }
  return [answer];
}

/**
 * The route this rung calls, and the ONLY one it may call.
 *
 * ⚠️ **`/api/machine/lookup`, never `/api/lookup`.** They are the same handler
 * (`read.ts`'s `lookupHandler`, mounted twice on purpose so the two surfaces
 * cannot drift about what a lookup MEANS) behind two completely different
 * gates: the human one sits below the index's `requireEstateMember()` blanket
 * and wants a person's Firebase ID token; the machine one is mounted ABOVE it,
 * by name, and takes this bearer. Pointing this at the human path is the bug
 * this rung shipped with — it looked configured and was refused every run.
 */
const INDEX_LOOKUP_PATH = '/api/machine/lookup';

/**
 * ⚠️ **The fan-out cap, and it is a BUDGET decision, not a taste one.**
 *
 * This is the one rung whose cost scales with a work's aliases, and the hourly
 * sweep's `SWEEP_BUDGET` is the binding constraint on the whole ladder
 * (`details-sweep.ts`: an overrun does not throw, it silently kills the
 * invocation). Pricing an uncapped fan-out at `1 + MAX_ALIAS_IDENTITIES` = 5
 * pushed `estimateSubrequests` past the budget for a two-question book on the
 * donor instances, which would have meant the sweep quietly picking NOTHING —
 * a worse failure than a rung that asks three spellings instead of five.
 *
 * Three is enough for the question actually being asked: this is the
 * household's OWN store, keyed on an exact title fold. If three spellings of a
 * title do not find a row here, a fourth is not going to.
 *
 * ⚠️ Change this and `FREE_LADDER_RUNGS`' price for `index` must change with
 * it — they are the same number and the cost test counts the real calls.
 */
export const INDEX_MAX_IDENTITIES = 3;

/**
 * ONE row of the index's `matches` array — the columns this rung reads.
 *
 * ⚠️ **Read off the real handler, not guessed.** `read.ts:39-40` is the
 * `ENTRY_COLS` string the SELECT uses and `read.ts:79` is the envelope it is
 * wrapped in. The full row also carries `source_id`, `title_fold`, `work_fold`,
 * `universe`, `series_slug`, `year`, `publisher`, `format`, `kind`,
 * `parent_source_id`, `cover_url`, `detail_url` and `pushed_at`; they are
 * deliberately absent from this type because nothing here reads them, and a
 * type that claims fields it does not use is a type nobody re-checks.
 */
interface IndexMatch {
  /** `audiobook` | `library` | `game` — which shelf this row came from. */
  source: string;
  title: string;
  creator: string | null;
  series: string | null;
  /** A NUMBER on the wire (or null) — the index stores the sort position. */
  series_index: number | null;
}

/** `read.ts:79` — `{ query, title_fold, matches }`. */
interface IndexLookupResponse {
  query: string;
  title_fold: string;
  matches: IndexMatch[];
}

/**
 * Parse the lookup envelope, or return null.
 *
 * ⚠️ **This is a PARSE against a known contract, not the old defensive guess.**
 * The previous version accepted a bare row or one wrapped in `item` because
 * nobody had seen the response; both shapes were wrong, and the guesswork is
 * what let a rung that could never work look like one that merely found
 * nothing. What is checked here is only what the reader must not crash on: an
 * envelope carrying a `matches` ARRAY. A body that is not that shape means the
 * index changed its contract, and the honest answer is a named skip rather
 * than a row invented out of whatever did arrive.
 */
function parseIndexLookup(body: unknown): IndexLookupResponse | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.matches)) return null;

  const matches: IndexMatch[] = [];
  for (const raw of b.matches) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    matches.push({
      source: typeof r.source === 'string' ? r.source : '',
      title: typeof r.title === 'string' ? r.title : '',
      creator: typeof r.creator === 'string' ? r.creator : null,
      series: typeof r.series === 'string' ? r.series : null,
      series_index:
        typeof r.series_index === 'number' && Number.isFinite(r.series_index)
          ? r.series_index
          : null,
    });
  }
  return {
    query: typeof b.query === 'string' ? b.query : '',
    title_fold: typeof b.title_fold === 'string' ? b.title_fold : '',
    matches,
  };
}

/**
 * The first match that actually NAMES a series.
 *
 * ⚠️ **A lookup answers MANY rows** — every format on every shelf whose
 * `title_fold` equals the query's, `ORDER BY source, format, title`
 * (`read.ts:74`). Most of them are silent about series. Taking `matches[0]`
 * would let the *audiobook* copy's blank series field end the rung while the
 * *games* row two positions down carried the answer, which is rule 2 of this
 * file's header — a present row with a null column is not an answer — repeated
 * one level up.
 *
 * The index's own ordering is kept rather than re-sorted here: it is stable,
 * it is the same order a member's lookup shows, and a second ranking would be
 * a second matcher.
 */
function firstIndexRowWithSeries(matches: readonly IndexMatch[]): IndexMatch | null {
  return matches.find((m) => (m.series ?? '').trim() !== '') ?? null;
}

/**
 * Rung 2 — the estate's own cross-catalogue index, over the MACHINE read route.
 *
 * ## The request, in full
 *
 * `GET {INDEX_URL}/api/machine/lookup?title=<one identity>` with
 * `Authorization: Bearer {INDEX_READ_TOKEN}`. That is the whole of it, and the
 * two things it deliberately does NOT send are worth naming:
 *
 * - ⚠️ **No `creator` param.** The old code sent one; `lookupHandler` reads
 *   `title` and nothing else (`read.ts:57`), so it was a parameter the server
 *   has never looked at — decoration that read like a safety gate. Removing it
 *   changes no behaviour and stops the next reader believing the rung filters
 *   by author when it does not.
 * - ⚠️ **No author gate of our own either, and that is the endpoint's own
 *   contract rather than laziness.** `/api/lookup` is the *exact-identity*
 *   endpoint (`read.ts:22-23`): it joins on `title_fold`, the same fold the
 *   write side used, and the estate treats that fold AS identity. This rung is
 *   not searching the open web — where an unmatched author is how *Firefight*
 *   came back as a different 2001 book — it is asking the household's own
 *   store whether one of its other shelves holds this exact title. A
 *   similarity gate here would be a second matcher over a key that is already
 *   exact.
 *
 * ## Why `/api/machine/search?source=library` is NOT used for series
 *
 * The machine surface offers a search too, and this rung deliberately ignores
 * it, for two independent reasons either of which would be enough:
 *
 * 1. ⚠️ **It is a RANKED PARTIAL match, and this rung AUTO-WRITES.** The index's
 *    own header is explicit that its search "claims resemblance and never
 *    identity", and that title-only matching is safe "HERE AND ONLY HERE"
 *    because a human is looking at a result list with covers and publishers
 *    (`read.ts:19-25`). Nothing looks at this ladder's result list — it writes
 *    `work.series` straight into the row. Feeding a resemblance score into an
 *    auto-acting write is the 0.34/0.7 lesson this project has already paid
 *    for twice.
 * 2. **`source=library` narrows to rows THIS catalog pushed.** The projection
 *    it would be reading back is `packages/db/src/index-projection.ts` — our
 *    own `series` column, which is blank, which is why the rung is running.
 *    The value of the index is the shelves that are NOT ours (the audiobook
 *    pool, the games shelf), and that param excludes exactly those.
 *
 * ## Aliases: this is the one free rung that fans out over them
 *
 * The index is keyed by TITLE STRING, so an alias is a different question to ask
 * it — exactly like the enrich route (`routes/enrich.ts`) searching Open Library
 * under a pen name. It tries the catalogued title first, then each alias (up to
 * `INDEX_MAX_IDENTITIES` in total), and stops at the first identity that names a
 * series. A miss on one identity is recorded and the next is tried; only when
 * EVERY identity comes back empty is the rung's silence reported. `askAudiobook`
 * (work_id) and the two ISBN/key rungs have no title to vary, so they do not fan
 * out — see the options doc.
 */
async function askIndex(
  ctx: LadderContext,
  open: ReadonlySet<DetailField>,
  skipped: string[],
): Promise<FieldAnswer[]> {
  if (!open.has('series') && !open.has('seriesIndex')) return [];

  if (!ctx.env.INDEX_URL || !ctx.env.INDEX_READ_TOKEN) {
    // ⚠️ Which of the two is missing is NOT reported separately, on purpose:
    // both are set together at the same deploy step, and naming one would send
    // an operator to fix half a pairing.
    skipped.push(
      'the estate index: not asked — INDEX_URL / INDEX_READ_TOKEN are not both set on this ' +
        'instance. The index holds the matching value as INDEX_READ_TOKEN_<THIS INSTANCE>; ' +
        'the owner mints one value per instance and sets it on both holders in one sitting. ' +
        'See docs/info/free-details-ladder.md.',
    );
    return [];
  }

  for (const title of ctx.titleIdentities().slice(0, INDEX_MAX_IDENTITIES)) {
    const under = title === ctx.work.title ? '' : ` (as “${title}”)`;
    const url = new URL(INDEX_LOOKUP_PATH, ctx.env.INDEX_URL);
    url.searchParams.set('title', title);

    try {
      const res = await ctx.doFetch(url.toString(), {
        headers: { authorization: `Bearer ${ctx.env.INDEX_READ_TOKEN}` },
      });
      if (!res.ok) {
        // ⚠️ The index answers WORDED refusals with a named `error` code
        // (`machine_token_invalid`, `machine_read_unconfigured`,
        // `unfoldable_query`…). Carrying the code into the skip is the whole
        // difference between "the index said no" and knowing WHICH no — a bare
        // status would send whoever reads the queue to guess between a broken
        // pairing, an unminted secret and a title that cannot fold.
        skipped.push(`the estate index${under}: answered HTTP ${res.status}${await refusalCode(res)}`);
        continue;
      }
      const parsed = parseIndexLookup(await res.json());
      if (!parsed) {
        skipped.push(
          `the estate index${under}: answered 200 but not the { query, title_fold, matches } ` +
            'envelope this rung parses — the index has changed its contract',
        );
        continue;
      }
      const row = firstIndexRowWithSeries(parsed.matches);
      if (!row) {
        skipped.push(
          parsed.matches.length === 0
            ? `the estate index${under}: no shelf in the estate holds this title`
            : `the estate index${under}: ${parsed.matches.length} row(s) across the estate, none naming a series`,
        );
        continue;
      }

      // Declared: `entry.series` IS a series field, so a label carrying no
      // volume ("Cradle") is still a series name and is taken whole.
      const label = readSeriesLabel(row.series, true);
      if (!label) {
        skipped.push(`the estate index${under}: the row's series is blank after parsing`);
        continue;
      }
      const answer: FieldAnswer = { rung: 'index', series: label.series };
      // ⚠️ `series_index` wins over anything parsed out of the label: it is a
      // STORED position, the same number the source pushed, where the label's
      // is read out of a string. Falls back to the label's only when the
      // column is null.
      const sort = row.series_index ?? label.sort;
      if (sort !== null) {
        answer.seriesIndexSort = sort;
        // ⚠️ No display form from `series_index` — it is a number, not a
        // designation a publisher printed. Same rule as `askWikidata` and
        // `askHardcover`. `label.display` is only ever non-null when the
        // series STRING itself quoted one.
        answer.seriesIndexDisplay = label.display;
      }
      return [answer];
    } catch (err) {
      skipped.push(
        `the estate index${under}: could not be reached (${err instanceof Error ? err.message : String(err)})`,
      );
      continue;
    }
  }
  return [];
}

/**
 * ` (machine_token_invalid)` for a worded refusal, or `''`.
 *
 * Never throws and never blocks the ladder: a refusal body that is not JSON, or
 * carries no `error`, simply adds nothing. Reading the body is free here — the
 * response is already in hand and a refusal is never large.
 */
async function refusalCode(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    const code = (body as Record<string, unknown> | null)?.['error'];
    return typeof code === 'string' && code ? ` (${code})` : '';
  } catch {
    return '';
  }
}

/**
 * Rung 3 — Open Library, at the EDITION level.
 *
 * ⚠️ **`search.json` is the wrong endpoint and this has been rediscovered
 * twice.** It returns `series: null` for everything, *including* `Unsouled`,
 * whose first edition record says `series: ["Cradle, Volume 1"]` in as many
 * words. The series lives on the EDITION. Twelve of the twenty-four series the
 * 2026-08-10 backfill recovered came from `editions.json` and from nowhere
 * else — `docs/info/covers-and-series.md` §3.1 carries the measurement.
 *
 * `subtitle` matters as much as `series`: Hidden Gnome files the volume number
 * there (`"Ghostwater" :: "Cradle, Volume Five"`) on more editions than it uses
 * the `series` field at all. ⚠️ But a subtitle is usually a *subtitle*, so it is
 * read with `declared: false` — only an explicit volume shape is believed.
 *
 * The description comes from the WORK record, which is a different call at a
 * different level, and is made only when `description` is still open.
 */
async function askOpenLibrary(
  ctx: LadderContext,
  open: ReadonlySet<DetailField>,
  skipped: string[],
  throttle: boolean,
): Promise<FieldAnswer[]> {
  const wantsSeries = open.has('series') || open.has('seriesIndex');
  const wantsDescription = open.has('description');
  if (!wantsSeries && !wantsDescription) return [];

  const key = await ctx.openLibraryWorkKey(throttle);
  if (!key) {
    skipped.push(
      'Open Library: no work key recorded and no ISBN on any edition to resolve one from',
    );
    return [];
  }

  const answers: FieldAnswer[] = [];

  if (wantsSeries) {
    try {
      const editions = await paced(throttle, () =>
        editionsOfWork(key, { fetchImpl: ctx.doFetch, userAgent: UA }),
      );
      let label: ReturnType<typeof readSeriesLabel> = null;
      for (const edition of editions) {
        label = readSeriesLabel(edition.series[0], true) ?? readSeriesLabel(edition.subtitle, false);
        if (label) break;
      }
      if (label) {
        const answer: FieldAnswer = { rung: 'openlibrary', series: label.series };
        if (label.sort !== null) {
          answer.seriesIndexSort = label.sort;
          answer.seriesIndexDisplay = label.display;
        }
        answers.push(answer);
      } else {
        skipped.push(
          `Open Library: ${editions.length} edition${editions.length === 1 ? '' : 's'} of ${key}, none naming a series`,
        );
      }
    } catch (err) {
      skipped.push(
        `Open Library editions: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (wantsDescription) {
    try {
      const text = await paced(throttle, () =>
        workDescription(key, { fetchImpl: ctx.doFetch, userAgent: UA }),
      );
      if (text) answers.push({ rung: 'openlibrary', description: text });
      else skipped.push(`Open Library: work ${key} carries no description`);
    } catch (err) {
      skipped.push(`Open Library work: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return answers;
}

/**
 * Rung 4 — Google Books by ISBN. The blurb rung.
 *
 * ⚠️ **Keyed, and its absence is the measured default rather than a degraded
 * mode.** Anonymous Google Books answered HTTP 429 on 40 of 40 calls on
 * 2026-08-09 (a shared, exhausted quota), so with no key the rung is skipped
 * rather than burning a subrequest to be refused — the same gate `resolve.ts`
 * applies. The key was measured healthy on 2026-08-22.
 *
 * The series here is a HINT and is read as one: Google's title carries the
 * subtitle joined on (`"He Who Fights with Monsters 10: A LitRPG Adventure"`),
 * which is a shape `detectSeriesFromTitle` is measured against — so it is read
 * with `declared: false` and an unparsed title yields nothing at all.
 */
async function askGoogleBooks(
  ctx: LadderContext,
  open: ReadonlySet<DetailField>,
  skipped: string[],
): Promise<FieldAnswer[]> {
  const wantsSeries = open.has('series') || open.has('seriesIndex');
  const wantsDescription = open.has('description');
  if (!wantsSeries && !wantsDescription) return [];

  if (!ctx.env.GOOGLE_BOOKS_API_KEY) {
    skipped.push(
      'Google Books: not asked — no GOOGLE_BOOKS_API_KEY, and anonymous calls answer 429',
    );
    return [];
  }
  const isbn = await ctx.isbn13();
  if (!isbn) {
    skipped.push('Google Books: no ISBN on any edition of this book to ask with');
    return [];
  }

  try {
    const candidates = await lookupGoogleBooksByIsbn(isbn, {
      googleBooksKey: ctx.env.GOOGLE_BOOKS_API_KEY,
      fetchImpl: ctx.doFetch,
      userAgent: UA,
    });
    const best = candidates[0];
    if (!best) {
      skipped.push(`Google Books: nothing indexed for ISBN ${isbn}`);
      return [];
    }

    const answers: FieldAnswer[] = [];
    if (wantsDescription) {
      const text = (best.description ?? '').trim();
      if (text) answers.push({ rung: 'googlebooks', description: text });
      else skipped.push('Google Books: the record carries no description');
    }
    if (wantsSeries) {
      const label = readSeriesLabel(best.title, false);
      if (label) {
        const answer: FieldAnswer = { rung: 'googlebooks', series: label.series };
        if (label.sort !== null) {
          answer.seriesIndexSort = label.sort;
          answer.seriesIndexDisplay = label.display;
        }
        answers.push(answer);
      } else {
        skipped.push('Google Books: its title claims no series');
      }
    }
    return answers;
  } catch (err) {
    skipped.push(`Google Books: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Rung 5 — Hardcover.app. The only free rung that answers a BLURB and a
 * STRUCTURED series in the same request.
 *
 * ⚠️ **The series here is not parsed out of anything.** Hardcover models it as a
 * join (`book_series.series.name`), so unlike Google Books' title hint or Open
 * Library's subtitle there is nothing to read: the name is taken whole and
 * `readSeriesLabel` is deliberately NOT applied. Running a series-detector over
 * a field that is already a series name is how *"Elantris (1)"* became a shelf
 * of one — the parse is for strings that MIGHT contain a series, not for ones
 * that are declared to be one.
 *
 * ⚠️ **No `seriesIndexDisplay`.** `position` is a `float8` — a number, not a
 * designation any publisher printed — so it closes `seriesIndexSort` and never
 * the printed form. Same rule as `askWikidata`, same owner rule (2026-08-19)
 * behind it: the printed form is only ever written when a source QUOTED one.
 *
 * ⚠️ **Keyed, and its absence is a named skip.** Both instances hold
 * `HARDCOVER_API_TOKEN` (set 2026-08-25); an instance without it must never
 * look like a rung that was asked and knew nothing — see
 * `FreeDetailsOutcome.skipped`.
 *
 * ⚠️ **Hardcover files UNIVERSES as series too — and this rung refuses to write
 * one** (fixed 2026-08-25). Live that day, ISBN 9780765326355 (*The Way of
 * Kings*) answered `book_series` = [The Stormlight Archive #1, **The Cosmere
 * #7**]. Taking the first named entry meant Hardcover's row order decided
 * whether a UNIVERSE landed in `work.series` — a shelf this catalogue keeps one
 * tier ABOVE series (`@lc/universes`, from `catalog-platform/data/universes.json`).
 *
 * `lookupHardcover` now returns EVERY named entry and `pickSeries` chooses:
 * universes dropped, then the smallest `series.books_count` wins (a universe is
 * always the bigger set), ties to the first. If every entry was a universe the
 * rung answers **no series** with a named skip, because "we found only a
 * universe" and "Hardcover knows no series" are different facts.
 *
 * ⚠️ The predicate is built from `canonicalUniverse` — the SAME fold the
 * universe filter and facets use (`normaliseUniverseText` inside
 * `@lc/universes`). It is passed IN rather than imported by `@lc/isbn`, so the
 * cross-repo dependency stays in one package and no second similarity or
 * normalising function is created. That ban is not stylistic: this estate has
 * already shipped a silent failure from two normalisers that agreed until they
 * did not (`resolve_author_link` / `_resolveAuthorFolder`).
 */
async function askHardcover(
  ctx: LadderContext,
  open: ReadonlySet<DetailField>,
  skipped: string[],
): Promise<FieldAnswer[]> {
  const wantsSeries = open.has('series') || open.has('seriesIndex');
  const wantsDescription = open.has('description');
  if (!wantsSeries && !wantsDescription) return [];

  if (!ctx.env.HARDCOVER_API_TOKEN) {
    skipped.push('Hardcover: not asked — no HARDCOVER_API_TOKEN');
    return [];
  }
  const isbn = await ctx.isbn13();
  if (!isbn) {
    skipped.push('Hardcover: no ISBN on any edition of this book to ask with');
    return [];
  }

  try {
    const hit = await lookupHardcover(isbn, {
      token: ctx.env.HARDCOVER_API_TOKEN,
      fetchImpl: ctx.doFetch,
      userAgent: UA,
      // Non-null for any canonical universe name OR any alias in the shared
      // list's `canonicalNames` map — "cosmere", "the cosmere universe" and
      // "arand multiverse" all fold, because that is the map the rest of the
      // catalog resolves universe URLs and filters with.
      isUniverseName: (name) => canonicalUniverse(name) !== null,
    });
    if (!hit) {
      skipped.push(`Hardcover: no edition indexed for ISBN ${isbn}`);
      return [];
    }

    const answers: FieldAnswer[] = [];
    if (wantsDescription) {
      if (hit.description) answers.push({ rung: 'hardcover', description: hit.description });
      else skipped.push('Hardcover: the record carries no description');
    }
    if (wantsSeries) {
      if (hit.series) {
        const answer: FieldAnswer = { rung: 'hardcover', series: hit.series };
        // A number closes the position and nothing else. See the header.
        if (hit.position !== null) answer.seriesIndexSort = hit.position;
        answers.push(answer);
      } else if (hit.universesDropped.length > 0) {
        // ⚠️ NOT "names no series". Hardcover named something; this catalogue
        // files it a tier up. Reporting it as an empty record would send the
        // next reader looking for a bug in Hardcover's data.
        skipped.push('Hardcover: only a universe named, no series');
      } else {
        skipped.push('Hardcover: the record names no series');
      }
    }
    return answers;
  } catch (err) {
    skipped.push(`Hardcover: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Wikidata — the only free rung with a STRUCTURED, sourced series + ordinal, so
 * it is the last free chance to fill `series`/`seriesIndex` before the paid
 * lookup. It answers series ONLY (Wikidata carries no synopsis worth using), and
 * only when one is still open. See `lookupWikidataSeries` in `@lc/isbn` for the
 * two-hop ISBN→edition→work query and why the ISBN is de-hyphenated in the FILTER.
 *
 * ⚠️ **No `seriesIndexDisplay`.** `P1545` is an ordinal NUMBER, not a designation
 * a publisher printed, so it closes the sort/position (`seriesIndexSort`) but
 * never the printed form — `printedFormIn`'s rule, the same one the title-parse
 * rungs obey. A book that needs "Book One" on the page still gets it from a rung
 * that quotes it, or from a person; this rung will not invent one from a digit.
 */
async function askWikidata(
  ctx: LadderContext,
  open: ReadonlySet<DetailField>,
  skipped: string[],
): Promise<FieldAnswer[]> {
  if (!open.has('series') && !open.has('seriesIndex')) return [];

  const isbn = await ctx.isbn13();
  if (!isbn) {
    skipped.push('Wikidata: no ISBN on any edition of this book to ask with');
    return [];
  }

  try {
    const hit = await lookupWikidataSeries(isbn, { fetchImpl: ctx.doFetch, userAgent: UA });
    if (!hit) {
      skipped.push(`Wikidata: no series recorded for ISBN ${isbn}`);
      return [];
    }
    const answer: FieldAnswer = { rung: 'wikidata', series: hit.series };
    if (hit.ordinal !== null) answer.seriesIndexSort = hit.ordinal;
    return [answer];
  } catch (err) {
    skipped.push(`Wikidata: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// The ladder, as data — so its COST can be derived rather than remembered
// ---------------------------------------------------------------------------

/** One rung: what it is called, what it costs at worst, and how to ask it. */
interface FreeLadderRung {
  readonly rung: FreeRung;
  /**
   * ⚠️ **Worst-case subrequests, counted by reading the rung.** Every D1 call
   * and every `fetch` is one, and an overrun does not throw — it silently kills
   * the invocation (`details-sweep.ts` header §2). `ctx.isbn13()` is memoised,
   * so its one D1 read is charged to the FIRST rung that needs it and to no
   * other.
   */
  readonly subrequests: number;
  readonly ask: (
    ctx: LadderContext,
    open: ReadonlySet<DetailField>,
    skipped: string[],
    throttle: boolean,
  ) => Promise<FieldAnswer[]>;
}

/**
 * The ladder, in the order it is walked.
 *
 * ⚠️ **A new rung goes HERE, with its cost, or the build fails.** This table is
 * the single source of both the order and the price:
 * `free-details.test.ts` asserts that every `FreeRung` in the union has an entry
 * and that a worst-case run really spends `FREE_DETAILS_SUBREQUESTS`, and
 * `details-sweep.ts` prices `SWEEP_BUDGET` off the same sum. It exists because
 * the number was a hand-written `11` when two rungs (Hardcover 2026-08-25,
 * Wikidata 2026-08-25) had already landed in front of it — every AI-mode book
 * was priced short, against a ceiling whose overrun is silent.
 */
const FREE_LADDER_RUNGS: readonly FreeLadderRung[] = [
  // getAudiobookHolding — one D1 read.
  { rung: 'audiobook', subrequests: 1, ask: (ctx, open, skipped) => askAudiobook(ctx, open, skipped) },
  // ⚠️ LIVE since 2026-08-25, and the ONLY rung whose price is not 1-per-call:
  // it fans out over title identities, so its worst case is one fetch per
  // identity — `INDEX_MAX_IDENTITIES`, which exists to bound exactly this. The
  // note that used to sit here said "revisit the day the rung goes live"; this
  // is that revision.
  {
    rung: 'index',
    subrequests: INDEX_MAX_IDENTITIES,
    ask: (ctx, open, skipped) => askIndex(ctx, open, skipped),
  },
  // isbn13 (1 D1, memoised here) + workKeyForIsbn + editionsOfWork + workDescription.
  {
    rung: 'openlibrary',
    subrequests: 4,
    ask: (ctx, open, skipped, throttle) => askOpenLibrary(ctx, open, skipped, throttle),
  },
  // One fetch; the ISBN is already in hand.
  { rung: 'googlebooks', subrequests: 1, ask: (ctx, open, skipped) => askGoogleBooks(ctx, open, skipped) },
  // One GraphQL POST.
  { rung: 'hardcover', subrequests: 1, ask: (ctx, open, skipped) => askHardcover(ctx, open, skipped) },
  // One SPARQL GET.
  { rung: 'wikidata', subrequests: 1, ask: (ctx, open, skipped) => askWikidata(ctx, open, skipped) },
];

/**
 * What `freeDetailsFor` spends OUTSIDE the rungs, worst case:
 *
 *   getWork                         1
 *   listGapVerdicts                 1
 *   writeFreeValues.getWork         1
 *   updateWork's own getWork        1   ⚠️ `updateWork` re-reads the row before
 *                                       it writes (`works.ts:361`) — the old
 *                                       hand count missed this one
 *   updateWork's batch              1   (UPDATE + change_log in one batch)
 *   ---------------------------------
 *                                   5
 */
const FREE_DETAILS_FIXED_SUBREQUESTS = 5;

/**
 * ⚠️ **The free ladder's worst-case subrequest cost, DERIVED.** `details-sweep`
 * adds what its own caller spends around it; nothing else may re-type this
 * number. See `FREE_LADDER_RUNGS`.
 */
export const FREE_DETAILS_SUBREQUESTS =
  FREE_DETAILS_FIXED_SUBREQUESTS +
  FREE_LADDER_RUNGS.reduce((total, r) => total + r.subrequests, 0);

/** The rungs' names, in ladder order — what the cost test checks the union against. */
export const FREE_LADDER_RUNG_NAMES: readonly FreeRung[] = FREE_LADDER_RUNGS.map((r) => r.rung);

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

/**
 * Which fields one answer actually closes, given what is still open.
 *
 * ⚠️ A volume number with no series to hang on is not an answer — `applyFinding`
 * refuses the same thing for the same reason. So `seriesIndex` counts only when
 * the work already has a series or this same ladder is about to set one.
 *
 * ## ⚠️ F9 — a volume number is written only against the SAME series
 *
 * Owner decision **A**, 2026-08-25 ("skip on mismatch"), from review finding F9
 * (`docs/info/review-2026-08-25-overnight-work.md`).
 *
 * The bug: a rung answering `series` + `seriesIndex` had its NAME thrown away
 * and only its NUMBER kept whenever the book already had a series. Live case,
 * measured on the Hardcover rung the same day: ISBN 9780765326355 (*The Way of
 * Kings*) is filed under **The Stormlight Archive** and Wikidata answers **The
 * Cosmere, 7** — a true fact about a UNIVERSE, which this catalogue keeps one
 * tier above series. Before this gate, `7` landed in `series_index_sort` and
 * *The Way of Kings* became volume 7 of Stormlight: a wrong number that sorts,
 * filters and looks exactly like data.
 *
 * So when a rung NAMES a series and the book is already filed under a
 * different one, the ordinal is **dropped with a named skip**. Never option B
 * (re-filing the book from a rung): a free rung may fill a blank, and moving a
 * book somebody else shelved is not a gap-fill.
 *
 * ⚠️ **The comparison is the project's ONE matcher** (`isConfidentMatch` over
 * `titleSimilarity`, `packages/core/src/matching.ts`) and never a new fold.
 * That file's header is explicit about why: the sibling project shipped three
 * wrong matches and every one came from a second similarity function drifting
 * from the first. At the 0.7 spine floor, `"Stormlight Archive"` vs `"The
 * Stormlight Archive"` scores 0.8 and is written; `"The Cosmere"` vs `"The
 * Stormlight Archive"` scores 0.4 and is not.
 *
 * ⚠️ `isConfidentMatch` (0.7) and not `isTrustedMatch` (0.34), because nobody
 * confirmed this pairing — it is exactly the "matched without anyone looking"
 * case the stricter floor was measured for.
 *
 * `seriesNameInHand` is what the book is filed under RIGHT NOW: the catalogued
 * series, or the one an earlier rung closed in this same run. `null` means the
 * shelf is empty, so there is nothing to contradict.
 */
function fieldsClosedBy(
  answer: FieldAnswer,
  open: ReadonlySet<DetailField>,
  seriesNameInHand: string | null,
  skipped: string[],
): DetailField[] {
  const closed: DetailField[] = [];
  if (answer.series !== undefined && open.has('series')) closed.push('series');

  if (answer.seriesIndexSort !== undefined && open.has('seriesIndex')) {
    const claimed = answer.series;
    if (seriesNameInHand === null) {
      // No series yet. The ordinal is only an answer if this same rung is
      // bringing the series with it — otherwise it has nowhere to hang, which
      // is `applyFinding`'s refusal and `writeFreeValues`' too.
      if (claimed !== undefined) closed.push('seriesIndex');
    } else if (claimed === undefined || isConfidentMatch(claimed, seriesNameInHand)) {
      // Either the rung made no claim about WHICH series (so it is not
      // contradicting anything), or it named the one this book is already
      // filed under, spelling allowed to differ.
      closed.push('seriesIndex');
    } else {
      skipped.push(
        `${RUNG_LABEL[answer.rung]}: names series ${claimed}, but this book is filed under ` +
          `${seriesNameInHand} — volume not written`,
      );
    }
  }

  if (answer.description !== undefined && open.has('description')) closed.push('description');
  return closed;
}

/**
 * Ask the free rungs for everything this book still owes, and write what they say.
 *
 * `fields` is the caller's — **this file does not decide what a work owes.**
 * `gapsAndAsksFor` in `research-run.ts` is the one implementation of that policy
 * and it already honours `gap_verdict`; a second copy here would be a second
 * place for the "answers are not gaps" rule to drift. What this function does
 * add is a refusal to write into a field a verdict has already settled, which
 * is defence in depth against a caller that computed its list a moment too early.
 *
 * Never throws: every rung is individually caught, and a ladder that cannot
 * reach anything returns a list of named skips. The paid path behind it must
 * still run.
 */
export async function freeDetailsFor(
  env: Env,
  workId: number,
  fields: readonly DetailField[],
  options: FreeDetailsOptions = {},
): Promise<FreeDetailsOutcome> {
  const doFetch = options.fetchImpl ?? fetch;
  const throttle = options.throttle ?? true;

  const asked = fields.filter((f) => FREE_LADDER_FIELDS.includes(f));
  const outcome: FreeDetailsOutcome = {
    sources: {},
    applied: [],
    skipped: [],
    stillOpen: [...fields],
    askedRungs: [],
  };

  for (const field of fields) {
    if (!FREE_LADDER_FIELDS.includes(field)) {
      outcome.skipped.push(
        `${field}: no free rung can answer this honestly — every one of them dates a PRINTING, ` +
          'and first publication is a different fact. Left to the paid lookup.',
      );
    }
  }
  if (asked.length === 0) return outcome;

  const work = await getWork(env.DB, workId);
  if (!work) {
    outcome.skipped.push('That book no longer exists.');
    return outcome;
  }

  // Defence in depth — see the docstring. One query.
  const settled = new Set((await listGapVerdicts(env.DB, workId)).map((v) => v.field));
  const open = new Set(asked.filter((f) => !settled.has(f)));
  for (const field of asked) {
    if (settled.has(field)) {
      outcome.skipped.push(`${field}: already answered by a recorded verdict — not re-asked.`);
    }
  }
  if (open.size === 0) {
    outcome.stillOpen = [...fields].filter((f) => !settled.has(f));
    return outcome;
  }

  const ctx = new LadderContext(env, work, doFetch, options.titleAliases ?? []);
  const held: FieldAnswer[] = [];
  // ⚠️ The series NAME, not a boolean — F9. `fieldsClosedBy` has to be able to
  // ask "is this rung talking about the same shelf?", and a boolean threw away
  // the only thing that could answer.
  let seriesNameInHand: string | null = (work.series ?? '').trim() || null;

  // ⚠️ The order — and the price — live in `FREE_LADDER_RUNGS`. Hardcover sits
  // before Wikidata because its community skews genre/indie (exactly the books
  // Wikidata's notability bar misses) and it answers blurb and series in one
  // request; Wikidata is last and series-only, the structured source that
  // catches what the title-parse rungs above miss.
  for (const rung of FREE_LADDER_RUNGS) {
    if (open.size === 0) break;
    // ⚠️ Stamped BEFORE the call and outside the try, so a rung that throws is
    // still recorded as having been reached. "We asked and it fell over" and
    // "we never got to it" are different answers to *why did this cost money?*,
    // and the catch below writes only the first of them.
    outcome.askedRungs.push(rung.rung);
    let answers: FieldAnswer[];
    try {
      answers = await rung.ask(ctx, open, outcome.skipped, throttle);
    } catch (err) {
      // A rung is allowed to fail; the ladder is not.
      outcome.skipped.push(`a rung failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const answer of answers) {
      const closed = fieldsClosedBy(answer, open, seriesNameInHand, outcome.skipped);
      if (closed.length === 0) continue;
      held.push(answer);
      for (const field of closed) {
        outcome.sources[field] = answer.rung;
        open.delete(field);
      }
      // ⚠️ The NAME the shelf now carries, so a later rung's ordinal is checked
      // against what this run just filed the book under and not against the
      // blank it started from.
      if (closed.includes('series') && answer.series !== undefined) {
        seriesNameInHand = answer.series;
      }
    }
  }

  if (held.length === 0) {
    outcome.stillOpen = [...fields].filter((f) => !settled.has(f));
    return outcome;
  }

  const written = await writeFreeValues(env.DB, workId, held, outcome);
  outcome.stillOpen = [...fields].filter((f) => !written.has(f) && !settled.has(f));
  return outcome;
}

/**
 * Write everything the ladder found, in one patch.
 *
 * ⚠️ **Gaps only, re-checked at write time.** The work is read again here rather
 * than trusting the copy the ladder started with: the scan path runs this after
 * responding, so a column can genuinely fill in between. Anything that filled is
 * left alone and reported — `applyFinding` follows the same rule for the same
 * reason, and it is what keeps "the value before a machine write was always
 * empty" true, which is the invariant `revertFinding` is built on.
 *
 * ⚠️ **`series_index_display` is written only when a source QUOTED one.** Owner
 * rule 2026-08-19: the printed form is optional data, never derived from the
 * sort value. `printedFormIn` is the gate and it is shared with the paid path.
 */
async function writeFreeValues(
  db: D1Database,
  workId: number,
  answers: readonly FieldAnswer[],
  outcome: FreeDetailsOutcome,
): Promise<Set<DetailField>> {
  const work = await getWork(db, workId);
  const written = new Set<DetailField>();
  if (!work) {
    outcome.skipped.push('That book was deleted while the free checks were running.');
    return written;
  }

  const blank = (v: string | number | null) =>
    v == null || (typeof v === 'string' && v.trim() === '');

  const patch: {
    series?: string;
    seriesIndexSort?: number;
    seriesIndexDisplay?: string;
    description?: string;
  } = {};

  const seriesAnswer = answers.find((a) => a.series !== undefined);
  const volumeAnswer = answers.find((a) => a.seriesIndexSort !== undefined);
  const blurbAnswer = answers.find((a) => a.description !== undefined);

  if (seriesAnswer?.series !== undefined) {
    if (blank(work.series)) {
      patch.series = seriesAnswer.series;
      written.add('series');
      outcome.applied.push(
        `Series set to ${seriesAnswer.series} — from ${RUNG_LABEL[seriesAnswer.rung]}.`,
      );
    } else {
      delete outcome.sources.series;
      outcome.skipped.push(`series: already in the series ${work.series}.`);
    }
  }

  if (volumeAnswer?.seriesIndexSort !== undefined) {
    const seriesNow = patch.series ?? work.series;
    if (work.seriesIndexSort != null) {
      delete outcome.sources.seriesIndex;
      outcome.skipped.push(`seriesIndex: already volume ${work.seriesIndexSort}.`);
    } else if (blank(seriesNow)) {
      // Not a failure of the value — it has nowhere to hang. Same wording and
      // the same reasoning as `applyFinding`'s branch for this case.
      delete outcome.sources.seriesIndex;
      outcome.skipped.push('seriesIndex: this book has no series to be a volume of.');
    } else {
      patch.seriesIndexSort = volumeAnswer.seriesIndexSort;
      const quoted = volumeAnswer.seriesIndexDisplay ?? null;
      if (quoted && blank(work.seriesIndexDisplay)) patch.seriesIndexDisplay = quoted;
      written.add('seriesIndex');
      outcome.applied.push(
        patch.seriesIndexDisplay
          ? `Volume number set to ${volumeAnswer.seriesIndexSort}, printed as "${patch.seriesIndexDisplay}" — ` +
            `the form ${RUNG_LABEL[volumeAnswer.rung]} quoted.`
          : `Volume number set to ${volumeAnswer.seriesIndexSort} — from ${RUNG_LABEL[volumeAnswer.rung]}.`,
      );
    }
  }

  if (blurbAnswer?.description !== undefined) {
    if (blank(work.description)) {
      patch.description = blurbAnswer.description;
      written.add('description');
      outcome.applied.push(`Description saved — from ${RUNG_LABEL[blurbAnswer.rung]}.`);
    } else {
      delete outcome.sources.description;
      outcome.skipped.push('description: a description is already recorded.');
    }
  }

  // ⚠️ One `updateWork`, and NOTHING in `patch` can name `title` or `authors` —
  // see rule 3 in the header. Skipped entirely when every value was refused,
  // so a no-op ladder costs no write and bumps no `updated_at`.
  if (Object.keys(patch).length > 0) await updateWork(db, workId, patch);
  return written;
}
