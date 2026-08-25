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
 * | 2 | the estate index (`/api/lookup`) | series, volume | ⚠️ **DARK** — see below |
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
 * rather than a silent one: the friend instance has no `HARDCOVER_API_TOKEN`
 * until the owner sets it.
 *
 * ⚠️ **Rung 2 is built and cannot fire.** `index.heygabi.ai/api/lookup` is
 * behind a blanket human Firebase-token check and no machine-read credential
 * exists; minting one is an access-INCREASING change in another repo
 * (`catalog-platform/apps/index-worker/src/index.ts`) and therefore the owner's
 * decision, not a build step. It is gated on `INDEX_READ_TOKEN` (see
 * `env.ts`), and unset — every environment today — means **skipped with a named
 * reason that travels in the response**, never silently. Nothing here guesses a
 * value, and the request shape has never been exercised against the real index.
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
 * outstanding returns before it reads anything. Worst case here is ~12; the
 * ordinary case is 4 or 5.
 */

import {
  detectSeriesFromTitle,
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

const UA = 'library_catalog (+private household catalog)';

/** A rung that costs nothing. `'index'` is reserved and dark — see the header. */
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

/** A record-shaped value, or null. Used only where the shape is genuinely unknown. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** The index's answer, whether it arrives bare or wrapped in `item`. */
function pickIndexRow(body: unknown): Record<string, unknown> | null {
  const top = asRecord(body);
  if (!top) return null;
  return asRecord(top['item']) ?? top;
}

/**
 * Rung 2 — the estate's own cross-catalogue index. ⚠️ **DARK. See the header.**
 *
 * Everything below the config check is unexercised: no machine-read credential
 * exists, so this code has never met the real `/api/lookup`. It is shaped after
 * the projection this catalog PUSHES (`packages/db/src/index-projection.ts`:
 * `title`, `creator`, `series`, `series_index`) and reads defensively, because
 * the response contract is genuinely unknown rather than merely unread. It
 * cannot answer `description` — the index is an identity index, not a metadata
 * store, and the projection carries no such column.
 *
 * ## Aliases: this is the one free rung that fans out over them
 *
 * The index is keyed by TITLE STRING, so an alias is a different question to ask
 * it — exactly like the enrich route (`routes/enrich.ts`) searching Open Library
 * under a pen name. It tries the catalogued title first, then each alias, and
 * stops at the first identity that names a series. A miss on one identity is
 * recorded and the next is tried; only when EVERY identity comes back empty is
 * the rung's silence reported. `askAudiobook` (work_id) and the two ISBN/key
 * rungs have no title to vary, so they do not fan out — see the options doc.
 */
async function askIndex(
  ctx: LadderContext,
  open: ReadonlySet<DetailField>,
  skipped: string[],
): Promise<FieldAnswer[]> {
  if (!open.has('series') && !open.has('seriesIndex')) return [];

  if (!ctx.env.INDEX_URL || !ctx.env.INDEX_READ_TOKEN) {
    skipped.push(
      'the estate index: not asked — INDEX_READ_TOKEN is unset. The index only accepts a ' +
        'human sign-in today; a machine-read credential has to be minted and mounted in ' +
        'catalog-platform/apps/index-worker/src/index.ts, which is an access-increasing ' +
        'change and the owner’s call. See docs/info/free-details-ladder.md.',
    );
    return [];
  }

  for (const title of ctx.titleIdentities()) {
    const under = title === ctx.work.title ? '' : ` (as “${title}”)`;
    const url = new URL('/api/lookup', ctx.env.INDEX_URL);
    url.searchParams.set('title', title);
    if (ctx.work.authors) url.searchParams.set('creator', ctx.work.authors);

    try {
      const res = await ctx.doFetch(url.toString(), {
        headers: { authorization: `Bearer ${ctx.env.INDEX_READ_TOKEN}` },
      });
      if (!res.ok) {
        skipped.push(`the estate index${under}: answered HTTP ${res.status}`);
        continue;
      }
      // ⚠️ Read as `unknown` and narrowed by hand, not cast to a shape. Every
      // other rung in this file is typed against a response somebody has actually
      // seen; this one is a guess, and a cast would let the guess masquerade as
      // knowledge the first time the index answers something else. A row may
      // arrive bare or wrapped in `item`, so both are tried.
      const body: unknown = await res.json();
      const row = pickIndexRow(body);
      const label = readSeriesLabel(stringOrNull(row?.series), true);
      if (!label) {
        skipped.push(`the estate index${under}: no series recorded for this book`);
        continue;
      }
      const answer: FieldAnswer = { rung: 'index', series: label.series };
      const raw = row?.series_index;
      const sort = typeof raw === 'number' && Number.isFinite(raw) ? raw : label.sort;
      if (sort !== null) {
        answer.seriesIndexSort = sort;
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
 * ⚠️ **Keyed, and its absence is a named skip.** The main instance holds
 * `HARDCOVER_API_TOKEN`; the friend instance does not until the owner sets it,
 * and a rung nobody could ask must never look like a rung that was asked and
 * knew nothing — see `FreeDetailsOutcome.skipped`.
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
// Running it
// ---------------------------------------------------------------------------

/**
 * Which fields one answer actually closes, given what is still open.
 *
 * ⚠️ A volume number with no series to hang on is not an answer — `applyFinding`
 * refuses the same thing for the same reason. So `seriesIndex` counts only when
 * the work already has a series or this same ladder is about to set one.
 */
function fieldsClosedBy(
  answer: FieldAnswer,
  open: ReadonlySet<DetailField>,
  seriesInHand: boolean,
): DetailField[] {
  const closed: DetailField[] = [];
  if (answer.series !== undefined && open.has('series')) closed.push('series');
  if (
    answer.seriesIndexSort !== undefined &&
    open.has('seriesIndex') &&
    (seriesInHand || answer.series !== undefined)
  ) {
    closed.push('seriesIndex');
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
  let seriesInHand = (work.series ?? '').trim() !== '';

  const rungs: ((o: ReadonlySet<DetailField>) => Promise<FieldAnswer[]>)[] = [
    (o) => askAudiobook(ctx, o, outcome.skipped),
    (o) => askIndex(ctx, o, outcome.skipped),
    (o) => askOpenLibrary(ctx, o, outcome.skipped, throttle),
    (o) => askGoogleBooks(ctx, o, outcome.skipped),
    // Before Wikidata: Hardcover's community skews genre/indie — exactly the
    // books Wikidata's notability bar misses — and it answers the blurb and the
    // series in one request, so it gets first crack at both.
    (o) => askHardcover(ctx, o, outcome.skipped),
    // Last, and series-only: the structured source that catches what the
    // title-parse rungs above miss on indie/genre books — the owner's actual gap.
    (o) => askWikidata(ctx, o, outcome.skipped),
  ];

  for (const rung of rungs) {
    if (open.size === 0) break;
    let answers: FieldAnswer[];
    try {
      answers = await rung(open);
    } catch (err) {
      // A rung is allowed to fail; the ladder is not.
      outcome.skipped.push(`a rung failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const answer of answers) {
      const closed = fieldsClosedBy(answer, open, seriesInHand);
      if (closed.length === 0) continue;
      held.push(answer);
      for (const field of closed) {
        outcome.sources[field] = answer.rung;
        open.delete(field);
      }
      if (closed.includes('series')) seriesInHand = true;
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
