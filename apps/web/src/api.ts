/**
 * The API client. One place that knows how a request is authenticated, so
 * nothing else has to.
 */

import type { Role, ScanJob, ScanLine, TbrGroupFormats } from '@lc/core';
import { getIdToken } from './lib/firebase.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
    message: string,
    /**
     * The whole decoded error body, when there was one. Some refusals carry
     * fields beside `error`/`detail` that the caller must act on — the
     * `isbn_taken` 409 names the printing that already holds the ISBN in
     * `holder`, which is what lets the rescan flow offer the slipcase
     * treatment instead of a dead end. `null` when the body was not JSON.
     */
    readonly body: unknown = null,
  ) {
    super(message);
  }
}

/**
 * One audit row, as `GET /api/works/:id/changes` returns it. Mirrors
 * `ChangeRow` in `@lc/db`. `oldValue`/`newValue` are decoded JSON — `null`
 * means the column was NULL, and `__row__` rows carry a whole row (creation:
 * old null; deletion: new null).
 */
export interface ChangeView {
  id: number;
  batchId: string;
  entity: string;
  entityId: number;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: number | null;
  changedByName: string | null;
  changedHow: string;
  note: string | null;
  createdAt: string;
}

/** One cover the book could wear. Mirrors `CoverCandidate` in `@lc/core`. */
export interface CoverCandidateView {
  url: string;
  label: string;
  caption: string | null;
  source: 'edition' | 'history' | 'current' | 'guess';
  /** The work is wearing this URL right now (saved, not merely picked). */
  selected: boolean;
  /** A computed guess — the grid hides it when its image fails to load. */
  derived: boolean;
  editionId: number | null;
}

/** What the paid cover search claimed. See `findCover` in `@lc/research`. */
export interface CoverProposal {
  found: boolean;
  url: string | null;
  source: string | null;
  confidence: 'high' | 'low';
  note: string;
}

/**
 * `POST /api/works/:id/cover/find` — a proposed cover plus whether its URL
 * actually returned an image just now. Nothing is stored: applying it is a
 * separate `setCover` call, which re-verifies.
 */
export interface CoverFindResult {
  proposal: CoverProposal;
  verified: boolean;
  bytes?: number;
  verifyReason?: string;
  usage: { inputTokens: number; outputTokens: number };
  centsEach: number;
}

/** One copy, as the deletion preview names it. Mirrors `WorkDeletionCopy` in `@lc/db`. */
export interface DeletionCopy {
  id: number;
  status: string;
  isSigned: boolean;
  location: string | null;
  /** ⚠️ Deprecated by migration 0400 — a new record lands in `personName`. */
  lentTo: string | null;
  /** WHO has it, as typed. See `WorkDeletionCopy` in `@lc/db` for why both are here. */
  personName: string | null;
  editionId: number | null;
  editionNotes: string | null;
}

/**
 * Everything `DELETE /api/works/:id` would destroy, computed server-side
 * BEFORE it happens. `blockers` non-empty means the server will refuse — the
 * rule is `copyBlocksDeletion` in `@lc/core`: everything except a plain wish
 * blocks, signed copies always.
 */
export interface DeletionReport {
  workId: number;
  title: string;
  editions: number;
  copies: DeletionCopy[];
  blockers: DeletionCopy[];
  traces: { what: string; rows: number }[];
  reviewEvidence: boolean;
}

/**
 * Every call carries a Firebase ID token.
 *
 * On a 401 the token is refreshed once and the request retried once — a token
 * expiring mid-session is ordinary, and making the user sign in again for it
 * would be the worst possible response. Twice would be a loop, so it is exactly
 * once: a second 401 means the session is genuinely gone.
 */
async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = await getIdToken(retried);
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401 && !retried) return request<T>(path, init, true);

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; detail?: unknown } | null;
    throw new ApiError(res.status, body?.detail, body?.error ?? `HTTP ${res.status}`, body);
  }
  return (await res.json()) as T;
}

export interface Me {
  email: string;
  displayName: string | null;
  role: Role;
  capabilities: string[];
  reviewName: string | null;
  /**
   * Outstanding work, riding along on `/api/me` — the sibling's pattern.
   *
   * ⚠️ `null` means the count could not be taken, and is NOT the same as `0`.
   * Zero hides the nav link; null shows it without a count. A failed query must
   * never look like a finished job.
   */
  chores: { missingDetails: number } | null;
  /**
   * Whether the GABI chat panel exists on THIS instance — the per-instance
   * posture var (`GABI_PANEL` in wrangler.toml), resolved server-side.
   *
   * ⚠️ A POSTURE, not a permission. It says the feature is switched on here at
   * all; whether *this person* may use it is `capabilities.includes('runResearch')`
   * beside it, and the route re-checks both. Neither is the lock — the lock is
   * the capability gate on the Worker.
   *
   * ⚠️ Optional on the wire because the app and the Worker deploy separately at
   * the seam of a release; an older Worker answers without it and `undefined`
   * must read as OFF, never as ON.
   */
  gabiPanel?: boolean;
}

/**
 * One turn of a GABI conversation.
 *
 * ⚠️ `content` is the model's blocks VERBATIM — text and `tool_use`, unparsed.
 * The panel renders a card for every one of them and the executor runs them; a
 * claimed action with no card is visibly a claim (design §8).
 */
export interface GabiTurnResponse {
  conversationId: string;
  content: { type: string; [key: string]: unknown }[];
  /** `end_turn` | `tool_use` | `pause_turn` — the browser decides what happens next. */
  stopReason: string | null;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    /** Cache-aware list pricing, not an invoice. See `gabiCents` in packages/research/src/gabi.ts. */
    estimatedCents: number;
  };
  /**
   * What GABI remembered from before this browser tab existed.
   *
   * ⚠️ **COUNTS, NEVER TEXT.** The server holds a 30-minute rolling window of
   * what was said — the same window, the same shape and the same limits GABI's
   * Discord surface uses (`@lc/gabi-conv`, materialised from catalog-platform's
   * `@platform/gabi-conversation`) — and prepends the part this tab was not
   * present for. It does not send the transcript back, because the tab already
   * holds everything it was present for and a second copy of somebody's chat
   * crossing the wire would serve nothing.
   *
   * `turns > 0` is the panel's cue to say she is picking up where they left off.
   */
  memory: {
    /** Remembered turns prepended to this prompt. 0 on a fresh conversation. */
    turns: number;
    /** Their character count — continuity's share of the input, measured. */
    chars: number;
    /** Whether this exchange was written into the window. */
    saved: boolean;
  };
}

export interface WorkSummary {
  id: number;
  title: string;
  subtitle: string | null;
  /**
   * As printed — or **null for a book whose author is not yet recorded**
   * (migration 0120, "Add without an author"). Null IS the remediation flag:
   * the card draws the mark from it, the Needs→Author filter derives from it,
   * and nothing stores a second copy of the fact.
   */
  authors: string | null;
  series: string | null;
  seriesIndexDisplay: string | null;
  coverUrl: string | null;
  formats: string | null;
  copyCount: number;
  /**
   * Copies paid for and not here yet. `0` for almost everything.
   *
   * There is deliberately no `owned` counterpart to mark: being owned is what
   * being in the collection means, and only the exceptions earn a label.
   */
  preordered: number;
  createdAt: string;
  /** This reader's state, not the household's. Null when nobody has set one. */
  readState: string | null;
  /**
   * Whether the cover we hold is really this book's — `'ok'`, `'standin'`, or
   * `null` for "nobody has looked".
   *
   * ⚠️ `null` is NOT `'ok'`. It is true of nearly every row and means only that
   * the question has not been asked; `coverNeeded` in `@lc/core` is the one
   * place that decides what the combination of this and `coverUrl` means, and
   * both the card mark and the server's filter go through it.
   */
  coverStatus: 'ok' | 'standin' | null;
  /** Open "check this later" notes. `0` for almost everything. */
  openWatches: number;
}

/** One "needs my eyes" note. Mirrors `Watch` in `@lc/db`. */
export interface Watch {
  id: number;
  workId: number;
  note: string;
  /** `'human'` — a person raised it. `'auto'` — a run raised it about its own guess. */
  raisedHow: 'human' | 'auto';
  raisedBy: number | null;
  raisedByName: string | null;
  createdAt: string;
  /** Null while open. Set means somebody has said they looked. */
  resolvedAt: string | null;
  resolvedBy: number | null;
}

/**
 * One work a rating marked read, and how.
 *
 * ⚠️ Only ever the works that **changed**. An empty list is the ordinary answer
 * on every call after the first, and the caller reads it as "nothing to redraw"
 * rather than as a failure.
 */
export interface DerivedRead {
  workId: number;
  title: string;
  readState: string;
  readFormat: string | null;
}

/**
 * One TBR entry, matched against this catalog. Mirrors `TbrMatch` in `@lc/db`.
 *
 * ⚠️ `workId: null` is the ORDINARY answer, not a failure — most of anybody's
 * to-read list is audiobooks this catalog does not hold. `readState: null`
 * means there is no `user_book` row, which is not the same as 'unread'.
 */
export interface TbrMatchView {
  docId: string;
  bookId: string;
  workKey: string | null;
  workId: number | null;
  readState: string | null;
  workTitle: string | null;
  authors: string | null;
  series: string | null;
  seriesIndexDisplay: string | null;
  workCoverUrl: string | null;
  /**
   * ⚠️ The matched WORK's key — what two documents for one book fold on.
   * See `tbrFoldKey` in `@lc/core`; null on an entry nothing matched.
   */
  workWorkKey: string | null;
  /** Which shelves the book is on. Null when the catalog matched nothing. */
  formats: TbrGroupFormats | null;
  matchedVia: 'work_key' | 'title_slug' | 'audio_bridge' | 'ebook_bridge' | null;
}

/**
 * The server's fold: which documents are one book.
 *
 * ⚠️ **No titles, deliberately** — see `routes/tbr.ts`. The page holds the
 * titles it read from Firestore and re-folds with the same `groupTbrEntries`,
 * so this is the authoritative COUNT rather than a second rendering path.
 */
export interface TbrGroupView {
  key: string;
  /** ⚠️ Every document in the group — "Off the list" deletes all of them. */
  docIds: string[];
  workId: number | null;
  readState: string | null;
  formats: TbrGroupFormats;
}

/** One work in a duplicate group, as `/api/collection/duplicates` returns it. */
export interface DuplicateWork {
  id: number;
  title: string;
  subtitle: string | null;
  /**
   * ⚠️ The **raw stored** author string, so an authorless book arrives as the
   * `?unknown` sentinel rather than as null. The list renders it through
   * `duplicateAuthorLabel`, which is the one place that becomes words.
   */
  authors: string;
  series: string | null;
  /** Owned + lent. Shown so a pair can be told apart; never part of the fold. */
  copyCount: number;
}

/** Works that folded onto one key — always two or more. */
export interface DuplicateGroupView {
  key: string;
  works: DuplicateWork[];
}

export interface DuplicatesResponse {
  groups: DuplicateGroupView[];
  /** Every work the finder looked at. The empty state says this number. */
  totalWorks: number;
}

/**
 * What the collection screen can ask for.
 *
 * ⚠️ Every one of these is *validated again on the server* — the sort key
 * against an allowlist, the page size against a menu. This type is a
 * convenience, not a contract: `packages/db/src/works.ts` is where an unknown
 * value is decided about.
 */
export interface CollectionParams {
  q?: string;
  series?: string;
  format?: string;
  /** The coarse axis: `physical` or `ebook`. Composes with `format`. */
  medium?: string;
  /**
   * `'hide'` — leave out the books this catalog holds only as an ebook file.
   *
   * ⚠️ **Not a synonym for `medium: 'physical'`**, which asks whether a physical
   * *edition row* exists and so drops the books whose printing nobody has typed
   * in yet — the ordinary state of a book a spine photo just added. The server's
   * `EBOOK_ONLY_CLAUSE` carries the measurement that settled it.
   */
  ebookOnly?: string;
  /**
   * `collectors` or `unsorted` — how fancy the printing is. Migration 0050.
   * Travels as `?kind=`; the server reads it as `editionKind`.
   */
  editionKind?: string;
  /**
   * The multi-type format selector, as a comma-separated list — any of
   * `hardcover`, `leatherbound`, `paperback`, `mass_market`, `ebook`,
   * `audiobook`. Owner ask, 2026-08-24. Travels as `?binding=`; the server's
   * `BINDING_CLAUSE` is a fixed map, so an unknown type adds no clause.
   */
  binding?: string;
  status?: string;
  /**
   * One shared fictional world, the tier above `series` — and it composes with
   * it rather than replacing it.
   *
   * The server folds spellings onto the owner's (`cosmere` → `The Cosmere`) and
   * ignores a name that is not one of the six, so an unrecognised value shows
   * the collection rather than erroring.
   */
  universe?: string;
  /** `cover`, `watch` or `any` — what is still outstanding. Migration 0040. */
  needs?: string;
  readState?: string;
  /**
   * `tbr` or `read` — narrow to this person's own cross-catalog reading list.
   * Owner ask, 2026-08-26.
   *
   * ⚠️ **Sent WITH `listIds`, and the pair is the design.** This half says the
   * narrowing is in force and is the half that goes in the address bar;
   * `listIds` carries the work ids, which only the browser can resolve (the
   * list lives in Firestore and the Worker has no service account). `list` with
   * no `listIds` means *"asked, and this catalogue holds none of them"* — no
   * rows, as against no filter at all. See `readingListIdsFrom` in the Worker.
   *
   * ⚠️ **Not `readState`.** That is `user_book.read_state`, this catalog's own
   * column; this is a field on a shared Firestore document, and the two
   * disagree by construction. `READING_LIST_STATUSES` in `@lc/core` carries the
   * measurement and the reason they stay apart.
   */
  list?: string;
  /**
   * The work ids `POST /api/tbr/resolve` matched for the list above,
   * comma-joined. Never bookmarked — one person's answer, not the question.
   *
   * ⚠️ Dropped by `collectionQuery` when empty, which is exactly right: `list`
   * still travels, and the server reads that as "asked, nothing matched".
   */
  listIds?: string;
  /**
   * `1` narrows to books owned in 2+ physical copies (across editions) — the
   * "Owned 2+ (physical)" checkbox. Sent as `?owned2=1`; the server reads it as
   * `ownedTwice`. `0`/absent is off, and `collectionQuery` drops a `0`.
   */
  owned2?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface CollectionFacets {
  series: { name: string; count: number }[];
  /**
   * Always both media, zeroes included — see the note on `CollectionFacets` in
   * `@lc/db`. The two counts overlap on purpose: a book held on the shelf *and*
   * on the Kindle is counted in each.
   */
  media: { medium: string; count: number }[];
  statuses: { status: string; count: number }[];
  /**
   * How much is still outstanding. The three overlap — a book can want a cover
   * *and* be on watch — so they are numbers rather than a breakdown.
   * `author` is the remediation queue for books added without one (0120).
   */
  needs: { cover: number; watch: number; author: number };
  /**
   * ⚠️ **No `kinds` or `formats` here on purpose** (F12, 2026-08-25). They fed
   * the old "Printing" and "Edition" selects, which the Type-filter
   * consolidation deleted — and under the new OR semantics the variant behind
   * `kinds` counted an intersection that clicking the box could never produce.
   * The reasoning, and what a correct version would have to do, is on
   * `CollectionFacets` in `@lc/db`.
   */
  /**
   * How many books each shared universe holds, under the rest of the filter.
   *
   * ⚠️ **Always all six, zeroes included**, the rule `media` follows: a control
   * that appears and disappears with the data is worse than one reading
   * "Maasverse (0)". And ⚠️ **there is no count of the books in no universe** —
   * that is most of the catalog, it is the correct answer for a picture book,
   * and putting a number on it would invent a worklist out of rows that are
   * perfectly filed.
   *
   * Added by the worker rather than by `@lc/db`, which does not know what a
   * universe is. See the `/collection/facets` route.
   */
  universes: { name: string; count: number }[];
}

/**
 * One shared fictional world, and what this catalog holds from it.
 *
 * ⚠️ Deliberately NOT a `SeriesReport`. There is no ladder, no gap list and no
 * completeness: a universe has no volume numbering to be complete against, and
 * the question it answers — which books across *different* series are the same
 * world — is the one a series page cannot.
 */
export interface UniverseView {
  /** The owner's spelling, whatever spelling was asked for. */
  name: string;
  /** Every held book, ordered by series and then by volume. Same shape the collection uses. */
  rows: WorkSummary[];
  /** ⚠️ May exceed `rows.length`; the page says so rather than hiding it. */
  total: number;
  /**
   * How big the universe is in the *shared list*, which is not how much of it
   * is on this shelf. Both catalogs read that list, so most of a universe is
   * often in the other one — which is why the page says both numbers.
   */
  declared: { series: number; titles: number };
}

export interface Stats {
  works: number;
  editions: number;
  copies: number;
  series: number;
  authors: number;
  withCover: number;
  /**
   * Copies we might buy — `wanted` alone. ⚠️ Deliberately **not** summed with
   * `preordered`; see the doc comment in `@lc/db`, which records what happened
   * to the sibling project when they were one number.
   */
  wanted: number;
  /** Copies paid for and on the way. Shown as "N on the way", never "preordered". */
  preordered: number;
  /*
   * ⚠️ `seriesWithGaps` was here and is GONE — added 2026-08-11, removed
   * 2026-08-12 at the owner's request. Do not add it back without asking: a gap
   * is answered on its own series page, and the route no longer computes it. See
   * the note in `CollectionPage.tsx`'s stat strip.
   */
  formats: { format: string; count: number }[];
  readStates: { readState: string; count: number }[];
}

/**
 * A series and what is missing from it.
 *
 * ⚠️ Mirrors `SeriesCompleteness` in `@lc/core`, which is where the rules live.
 * The web app imports the *functions* — `completenessSentence`,
 * `gapEvidenceLabel` — rather than re-wording anything here, so the sentence a
 * page prints and the arithmetic behind it cannot drift.
 */
/**
 * An audiobook the household owns at a rung with no work row — migration 0090.
 *
 * ⚠️ `matchedVia` is the honesty rail and not decoration. `'fold'` means only
 * the series name connects the two catalogs, and the ladder must render it as
 * AUDIO? rather than AUDIO.
 */
export interface SeriesGapAudio {
  index: number;
  title: string;
  authors: string | null;
  audiobookSeries: string;
  indexDisplay: string | null;
  /**
   * `'work_match'` a book proved it · `'owner'` you confirmed it (migration 0110)
   * · `'fold'` only the series names fold together, so it is still hedged and
   * still counted as missing.
   */
  matchedVia: 'work_match' | 'owner' | 'fold';
}

/** The owner's decision never to own one rung — migration 0100. */
export interface SeriesGapSkip {
  index: number;
  reason: string;
  note: string | null;
  decidedAt: string | null;
}

export interface SeriesGap {
  index: number;
  volumeId: number | null;
  workId: number | null;
  wanted: boolean;
  evidence: 'interior' | 'earlier' | 'attested' | 'implied';
  title: string | null;
  authors: string | null;
  display: string | null;
  /** When a source states it — a scan, most often. Migration 0200. */
  year: number | null;
  source: string | null;
  sourceUrl: string | null;
  note: string | null;
  staleAt: string | null;
  /** Absent from this catalog, present in the house. See `SeriesGapAudio`. */
  audio: SeriesGapAudio | null;
  /** Set only on a rung in `skipped`, never on one in `gaps`. */
  skipped: SeriesGapSkip | null;
}

export interface SeriesCompleteness {
  series: string;
  owned: number;
  unnumbered: number;
  lowestOwned: number | null;
  highestOwned: number | null;
  highestKnown: number | null;
  gaps: SeriesGap[];
  /** Rungs the owner has decided never to own. Not in `gaps`. */
  skipped: SeriesGap[];
  wanted: number;
  /** ⚠️ Excludes rungs confidently held on audio. See `@lc/core`. */
  certainGaps: number;
  attestedGaps: number;
  /** Held on audio — a work proved it, or you confirmed the series. */
  onAudio: number;
  /** Still inside the two counts above — a hedge does not cross a book off. */
  maybeOnAudio: number;
  knownTotal: number | null;
  knownTotalSource: string | null;
  openEnded: boolean;
  checked: boolean;
  checkOutcome: string | null;
  checkSource: string | null;
  /** When the check happened. Migration 0200. */
  checkedAt: string | null;
  /** A caveat about the check itself — "reads as an ongoing web serial," and the like. Never evidence; see `@lc/core`. */
  checkNote: string | null;
}

/** One printing. Mirrors `EditionRef` in `@lc/db`. */
export interface EditionRef {
  id: number;
  format: string;
  editionName: string | null;
  publisher: string | null;
  publishedYear: number | null;
  isbn13: string | null;
}

/**
 * What the sibling audiobook catalog holds for this work — cached by migration
 * 0010, because the Worker cannot read that catalog's CSV.
 */
export interface AudiobookRef {
  title: string;
  series: string | null;
  indexDisplay: string | null;
  matchedVia: string;
  viaAlias: string | null;
  /**
   * How many recordings of this volume the household holds — migration 0390,
   * counted by `audioEditionCountSql` in `@lc/db` and by nothing else.
   *
   * ⚠️ **RECORDINGS, never rungs.** A volume owned twice on audio is still one
   * rung held, and `SeriesHoldings.audio` / `SeriesCompleteness.onAudio` keep
   * saying so. This number is for the chip and the rung signature — see
   * `audioToken` in `SeriesDetailPage`.
   *
   * Always ≥ 1 wherever this ref exists (the ladder's read is already filtered
   * to live holdings). The interesting value is 2.
   */
  editionCount: number;
}

/**
 * What the sibling audiobook catalog holds for THIS work — `GET
 * /api/works/:id`'s `audiobookHolding` field. Mirrors `AudiobookHolding` in
 * `@lc/db`.
 *
 * ⚠️ Not `AudiobookRef` above — that is the series ladder's narrower chip.
 * This is the whole row the work page's "On audio" section shows, and unlike
 * the ladder's read it is NOT filtered on `staleAt`: a stale holding still
 * arrives here so the page can say so rather than showing nothing.
 */
export interface WorkAudiobookHolding {
  title: string;
  authors: string | null;
  series: string | null;
  indexDisplay: string | null;
  /** Relative to `audiobook_catalog/site/`. See `resolveAudiobookCover`. */
  coverHref: string | null;
  /** 'exact' | 'alias' | 'containment' — shown, never hidden. */
  matchedVia: string;
  titleSimilarity: number | null;
  /** Non-null means the sibling catalog no longer agrees. */
  staleAt: string | null;
}

/**
 * One audiobook edition of a work — an entry of `GET /api/works/:id`'s
 * `audioEditions`. Mirrors `AudiobookEdition` in `@lc/db` (migration 0390).
 *
 * ⚠️ This list runs BESIDE `audiobookHolding`, never instead of it, and the two
 * are ordered identically, so `audioEditions[0]` is the row `audiobookHolding`
 * describes. The ordinary length is 0 or 1; 2 is the case the migration exists
 * for — the household's two Elantris recordings.
 */
export interface WorkAudioEdition {
  /** The sibling catalog's verbatim title. The row's identity across runs. */
  audioKey: string;
  title: string;
  authors: string | null;
  series: string | null;
  indexDisplay: string | null;
  /** Verbatim from that catalog, one comma-joined string. The field that tells
   *  a full-cast recording apart from a single-narrator one. */
  narrator: string | null;
  /** Relative to `audiobook_catalog/site/`. See `resolveAudiobookCover`. */
  coverHref: string | null;
  /** 'exact' | 'alias' | 'containment' — shown, never hidden. */
  matchedVia: string;
  titleSimilarity: number | null;
  /** Non-null means the sibling catalog no longer confirms this edition. */
  staleAt: string | null;
}

/**
 * What the shared household pool holds for THIS work as an ebook — `GET
 * /api/works/:id`'s `ebookHolding` field. Mirrors `EbookHolding` in `@lc/db`
 * (migration 0310, `audiobook_holding`'s ebook twin).
 *
 * ⚠️ Phase 4 of the ebook split: this is the SHADOW answer, running beside the
 * edition rows the page already shows, never replacing them. Like
 * `WorkAudiobookHolding` it is NOT filtered on `staleAt` — a stale holding
 * still arrives so the page can say so rather than showing nothing.
 */
export interface WorkEbookHolding {
  /** Manifest-spelling formats ('epub', 'pdf'). */
  formats: string[];
  sourcePath: string | null;
  /** 'file' | 'manual' — provenance, shown, never hidden. */
  editionSource: string;
  /** 'edition' today; 'manifest' after phase 5. */
  derivedVia: string;
  /** Non-null means no edition backs this any more. */
  staleAt: string | null;
}

/** `physical` or `ebook`. There is deliberately no `audio` — see `@lc/core`. */
export type EditionMedium = 'physical' | 'ebook';

export interface SeriesLadderEntry {
  index: number;
  volumeId: number | null;
  display: string | null;
  title: string | null;
  authors: string | null;
  workId: number | null;
  wanted: boolean;
  coverUrl: string | null;
  readState: string | null;
  source: string | null;
  sourceUrl: string | null;
  note: string | null;
  staleAt: string | null;
  editions: EditionRef[];
  media: EditionMedium[];
  audiobook: AudiobookRef | null;
}

/** One object on the shelf. See `CopyRef` in `@lc/db`. */
export interface CopyRef {
  id: number;
  status: string;
  editionId: number | null;
  location: string | null;
  vendor: string | null;
  acquiredOn: string | null;
  isSigned: boolean;
  editionNotes: string | null;
}

/**
 * A book we own two or more copies of.
 *
 * ⚠️ **Copies, not editions** — the rule changed on 2026-08-11 and the old one
 * fired on scan artifacts. `packages/core/src/holdings.ts` carries the argument.
 */
export interface OwnedTwice {
  workId: number;
  title: string;
  index: number | null;
  display: string | null;
  coverUrl: string | null;
  copies: CopyRef[];
  editions: EditionRef[];
}

/** Counted in works, never in editions. See `SeriesHoldings` in `@lc/db`. */
export interface SeriesHoldings {
  works: number;
  physical: number;
  ebook: number;
  audio: number;
  ownedTwice: number;
}

/**
 * Your standing confirmation that this series and an audiobook series are one —
 * migration 0110. Null when you have not been asked.
 *
 * ⚠️ Sent on the report rather than left to be inferred from the rungs, because
 * once it is in force every rung reads `'owner'` and nothing on the page can tell
 * that a decision is what put it there. The undo needs this to exist at all.
 */
export interface AudioSeriesLink {
  audiobookSeries: string;
  note: string | null;
  confirmedAt: string;
}

/** One autocomplete suggestion for the editor's series field. */
export interface SeriesSuggestion {
  name: string;
  /** Which catalog(s) know this name — our own works, the audiobook catalog, or both. */
  sources: Array<'library' | 'audiobook'>;
}

/** One audiobook-series a library series could be confirmed equivalent to. */
export interface AudioSeriesCandidate {
  /** The sibling catalog's own spelling — sent back to `confirmAudioSeries` as the guard. */
  audiobookSeries: string;
  /** How many live rungs the sibling catalog files under this mapping. */
  rungs: number;
}

/**
 * What the editor's audio-equivalence control needs for one series: the works
 * confirming would fold across, the audiobook-series it can be linked to, and
 * the current link if one already stands. `GET /api/series/:name/audio-candidates`.
 */
export interface AudioSeriesCandidates {
  series: string;
  /** How many works are in this library series — the fold size. */
  works: number;
  linked: AudioSeriesLink | null;
  candidates: AudioSeriesCandidate[];
}

export interface SeriesReport {
  completeness: SeriesCompleteness;
  holdings: SeriesHoldings;
  ladder: SeriesLadderEntry[];
  unnumbered: { workId: number; title: string; display: string | null }[];
  ownedTwice: OwnedTwice[];
  audioLink: AudioSeriesLink | null;
  /** Whether a scan can even be attempted — mirrors `/api/research/queue`'s field of the same name. */
  configured: boolean;
}

/** `POST /api/series/:name/scan`'s response. */
export interface SeriesScanResponse {
  report: SeriesReport | null;
  identified: boolean;
  volumesWritten: number;
  note: string | null;
  estimatedCents: number;
}

/** A row of the series list. */
export interface SeriesSummary extends SeriesCompleteness {
  holdings: SeriesHoldings;
}

export interface WishlistRow {
  copyId: number;
  workId: number;
  title: string;
  /** Null for a book added without an author. */
  authors: string | null;
  series: string | null;
  seriesIndexDisplay: string | null;
  coverUrl: string | null;
  status: string;
  vendor: string | null;
  pricePaidCents: number | null;
  currency: string;
  notes: string | null;
  createdAt: string;
  /**
   * Normally null here — a copy on this list has not arrived. Carried so that
   * marking it arrived fills the column only when it is empty; see
   * `arrivedPatch` in `lib/statuses.ts`.
   */
  acquiredOn: string | null;
  formats: string | null;
}

/** A row of `work_alias`. `kind` decides which gate the name widens. */
export interface WorkAlias {
  id: number;
  workId: number;
  alias: string;
  kind: 'title' | 'author';
  source: 'openlibrary' | 'manual';
  createdAt: string;
}

/** A row of `app_user`, as the People screen sees it. */
export interface Person {
  id: number;
  email: string;
  displayName: string | null;
  reviewName: string | null;
  photoUrl: string | null;
  role: Role;
  firstSeenAt: string;
  approvedAt: string | null;
}

/**
 * A member as the OR-1 name picker sees them — `id` + `displayName`, nothing
 * else. Mirrors `MemberSummary` in `@lc/db` and the `GET /api/members` body.
 *
 * ⚠️ Deliberately NOT `Person`: the picker's roster (`editCatalog`) must never
 * carry the email/photo/role that `Person` (the `manageUsers` People page) does.
 */
export interface Member {
  id: number;
  displayName: string;
}

/**
 * One row of "Books with you" — a copy of this house's that is linked to the
 * signed-in person. Mirrors `LinkedCopyRow` in `@lc/db`.
 *
 * ⚠️ It carries no `personName`: the only person it could name is the reader,
 * and nothing about any other borrower reaches this response.
 */
export interface LinkedCopy {
  copyId: number;
  workId: number;
  title: string;
  authors: string | null;
  coverUrl: string | null;
  status: string;
  acquiredOn: string | null;
}

export interface RelatedWork {
  relationId: number;
  workId: number;
  title: string;
  /** Null for a book added without an author. */
  authors: string | null;
  series: string | null;
  seriesIndexDisplay: string | null;
  coverUrl: string | null;
  relation: 'same_universe' | 'companion' | 'contains' | 'precedes';
  outgoing: boolean;
  note: string | null;
}

/**
 * A row of `book_accessory` — the things in the box that are not books.
 *
 * ⚠️ Only ever fetched for one work. There is no collection-wide accessory read
 * and there must not be one: *"we don't need ti publish that count on the main
 * page, just keep it each book."*
 */
export interface Accessory {
  id: number;
  workId: number;
  copyId: number | null;
  name: string;
  kind: string;
  isDigital: boolean;
  quantity: number;
  location: string | null;
  notes: string | null;
  pledgeId: number | null;
  campaignName: string | null;
  campaignPlatform: string | null;
  createdAt: string;
}

/**
 * One reward line that delivered this book.
 *
 * ⚠️ A work legitimately has **two** of these from one pledge — the deluxe
 * hardcover and the EPUB. The panel renders them as two rows on purpose; see
 * `listProvenanceForWork` in `@lc/db`.
 */
export interface Provenance {
  itemId: number;
  pledgeId: number;
  campaignId: number;
  campaignName: string;
  campaignUrl: string | null;
  campaignPlatform: 'kickstarter' | 'backerkit' | 'indiegogo';
  pledgePlatform: 'kickstarter' | 'backerkit' | 'indiegogo';
  account: string;
  tier: string | null;
  pledgedOn: string | null;
  status: 'pledged' | 'delivered' | 'partial' | 'cancelled' | 'refunded';
  editionId: number | null;
  /** 'none' = no printing can exist for this line (an audiobook), not "unmatched". */
  editionVerdict: 'none' | 'unknown' | null;
  format: string | null;
  formatHint: string | null;
  title: string | null;
  quantity: number;
  fulfilled: boolean;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Details queue and research
// ---------------------------------------------------------------------------

/** A `DETAIL_FIELDS` value. Mirrors `@lc/core`, which is where the list lives. */
export type DetailField = 'firstPublished' | 'series' | 'seriesIndex' | 'description';

export interface NeedsDetails {
  workId: number;
  title: string;
  /** Null for a book added without an author. */
  authors: string | null;
  series: string | null;
  missing: DetailField[];
  missingLabels: string[];
  /** Proposals waiting on a decision. Counted server-side so a row can say so
   *  without being opened — a worklist you must expand row by row is not one. */
  pending: number;
  /** Fields already settled. Shown so the page can say what it is NOT asking. */
  answered: DetailField[];
  answeredLabels: string[];
  /**
   * Questions a **finished** run has already put to this book, answered or not.
   *
   * ⚠️ Not the same as `answered`, and not derivable from `runs`. `answered` is
   * a `gap_verdict` — somebody wrote down a conclusion. This is the run log:
   * the field was asked, and the answer (found / none / unknown / nothing) did
   * not close it. `missing` minus this is what is still worth paying for; see
   * `unaskedGaps` in `@lc/core` and `lib/details-outstanding.ts`.
   *
   * Errored runs are excluded server-side — a lookup that never got an answer
   * has not put the question — so this is safe to treat as "already bought".
   *
   * Typed loosely as `string[]` because it is read straight out of
   * `research_run.unfilled`, which is text this app does not own the shape of.
   */
  asked: string[];
}

/**
 * The per-field tally.
 *
 * ⚠️ The part of the queue page that carries information. Every work is missing
 * its year and its description, so the *list* says the same thing 116 times;
 * this says which questions are nearly closed and which are wide open, and it is
 * where already-answered work shows up as done rather than as absence.
 */
export interface FieldGapCount {
  field: DetailField;
  label: string;
  missing: number;
  /** A verdict says this book has no such thing. */
  none: number;
  /** A verdict says nobody knows. */
  unknown: number;
  filled: number;
  /** The field cannot apply — a volume number on a book with no series. */
  notApplicable: number;
}

/** What a run proposed about one field. Three kinds, and the third one matters. */
export interface FindingValue {
  kind: 'found' | 'none' | 'unknown';
  value?: string | number | null;
  /**
   * What the source says, in the model's words.
   *
   * ⚠️ This is deliberately where a confidence score would otherwise be. §4.4 of
   * `isbn-ladder.md`: a wrong answer scored 1.00 on title and 1.00 on author,
   * twice. A number invites ranking; a sentence naming the page invites reading.
   */
  basis?: string | null;
}

export interface ResearchFinding {
  id: number;
  runId: number;
  workId: number;
  field: string;
  value: FindingValue;
  /**
   * 'donor' = copied from the sibling library instance on an exact key match
   * (migration 0320); 'donor_fuzzy' = copied from a donor row an AI judge tied
   * to this book rather than a key (migration 0321). Neither is a web claim.
   */
  sourceTier: 'official' | 'crowdfunding' | 'retail' | 'community' | 'donor' | 'donor_fuzzy';
  sourceUrl: string | null;
  /** Always null. See `FindingValue.basis`. */
  confidence: number | null;
  reviewState: 'pending' | 'accepted' | 'rejected';
  reviewedAt: string | null;
  /**
   * Whether a person read this before it was accepted. Migration 0013.
   *
   * ⚠️ `accepted` no longer implies anybody looked — a run accepts its own
   * findings now. Anything reasoning about how trustworthy a value is must read
   * this and not the review state.
   */
  decidedHow: 'human' | 'auto' | null;
  createdAt: string;
}

/** One value the machine wrote, with enough around it to judge and undo. */
export interface AutoApplied {
  findingId: number;
  workId: number;
  title: string;
  /** Null for a book added without an author. */
  authors: string | null;
  field: string;
  value: FindingValue;
  /**
   * 'donor' = copied from the sibling library instance on an exact key match
   * (migration 0320); 'donor_fuzzy' = copied from a donor row an AI judge tied
   * to this book rather than a key (migration 0321). Neither is a web claim.
   */
  sourceTier: 'official' | 'crowdfunding' | 'retail' | 'community' | 'donor' | 'donor_fuzzy';
  sourceUrl: string | null;
  appliedAt: string | null;
}

export interface RunView {
  id: number;
  workId: number;
  status: 'queued' | 'running' | 'done' | 'error';
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCents: number;
  asked: string[];
  proposed: number;
  /**
   * How many proposals were actually written in. ⚠️ Not `proposed` — a column
   * that filled while the lookup was out is proposed and not applied, and
   * showing the larger number would overstate what the run did.
   */
  applied: number;
  detail: string | null;
  /**
   * Which rung answered each field — `{ series: 'audiobook', description:
   * 'llm' }`. Keys are `DetailField` names; values are
   * `audiobook | index | openlibrary | googlebooks | hardcover | wikidata | llm`
   * (the `FreeRung` union in `apps/worker/src/lib/free-details.ts`, plus `llm`).
   *
   * ⚠️ **`{}` means "nobody wrote it down", NOT "the model found everything".**
   * Every run made before 2026-08-23 is in that state, and rendering an empty
   * map as a paid lookup would attribute a cost to work that may well have been
   * free. The page shows the line only when there is something in it.
   */
  sources: Record<string, string>;
  model: string | null;
  effort: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface GapVerdictRow {
  id: number;
  workId: number;
  field: DetailField;
  verdict: 'none' | 'unknown';
  source: string;
  note: string | null;
  runId: number | null;
  decidedAt: string;
}

export interface QueueResponse {
  works: NeedsDetails[];
  summary: FieldGapCount[];
  /** Fields deliberately not asked about, each with the reason. */
  refused: { field: string; because: string }[];
  runs: RunView[];
  spent: {
    runs: number;
    errors: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCents: number;
  };
  model: string;
  centsEach: { low: number; high: number };
  /** False when no Anthropic key is configured, so the page can say so once. */
  configured: boolean;
}

function collectionQuery(params: CollectionParams): string {
  const u = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // `page: 0` and `q: ''` both mean "no opinion"; sending them adds noise to
    // the URL and, for an empty q, an unnecessary LIKE over the whole table.
    if (value === undefined || value === null || value === '' || value === 0) continue;
    u.set(key, String(value));
  }
  return u.toString();
}

export const api = {
  me: () => request<Me>('/api/me'),

  collection: (params: CollectionParams) =>
    request<{
      rows: WorkSummary[];
      total: number;
      page: number;
      pageSize: number;
      sort: string;
      dir: 'asc' | 'desc';
    }>(`/api/collection?${collectionQuery(params)}`),

  /** Counted against the same filter the list uses, so the numbers agree. */
  facets: (params: CollectionParams) =>
    request<CollectionFacets>(`/api/collection/facets?${collectionQuery(params)}`),

  /**
   * The same book recorded twice, grouped so a person can compare the rows.
   *
   * ⚠️ **Takes no `CollectionParams`, and that is not an oversight.** The other
   * filters narrow *which books you are looking at*; this one answers *which
   * rows in the catalog are the same book*, and narrowing it to (say) one
   * series would hide the half of a pair filed under a different one — which is
   * precisely how the pair got there. The whole catalog, or nothing.
   *
   * `totalWorks` is what the empty state counts: "No duplicates found across
   * 1,143 works" says the finder ran, which a bare "none" does not.
   */
  duplicates: () => request<DuplicatesResponse>('/api/collection/duplicates'),

  /** ⚠️ Always from the database. No count in this app is ever a literal. */
  stats: () => request<Stats>('/api/stats'),

  /**
   * One shared world, across the series in it.
   *
   * The name is the id and is folded onto the owner's spelling server-side, so
   * `cosmere` and `The Cosmere` are one page. A name that is not one of the six
   * is a 404 — unlike a series name, which comes from the catalog and can
   * legitimately match nothing, this vocabulary is closed.
   */
  universe: (name: string) => request<UniverseView>(`/api/universes/${encodeURIComponent(name)}`),

  work: (id: number) => request<Record<string, unknown>>(`/api/works/${id}`),

  /**
   * "Do we already hold this book?" Ask before creating one.
   *
   * ⚠️ `createWork` does NOT dedupe — the schema allows two works with one key
   * on purpose. Skipping this check means scanning the paperback of a book you
   * already hold as an ebook silently produces a second row for the same book.
   */
  /** `authors: null` asks about the PROVISIONAL key — the authorless-add dedupe. */
  matchWork: (title: string, authors: string | null) =>
    request<{
      // The endpoint returns the whole work row; this type was narrower than
      // the wire for no reason, which hid `coverUrl` from the add path and let
      // a scan attach to a coverless book without noticing it could fill it in.
      work: { id: number; title: string; authors: string | null; coverUrl: string | null } | null;
    }>(
      `/api/works/match?title=${encodeURIComponent(title)}` +
        (authors === null ? '' : `&authors=${encodeURIComponent(authors)}`),
    ),

  /**
   * ⚠️ A PUT, so it REPLACES the whole read-state row. Send the dates back with
   * it or they are cleared — the endpoint is `.strict()` and will also reject any
   * key it does not know, including `rating` (ratings go through reviewDraft).
   */
  setReading: (
    id: number,
    body: {
      readState: string;
      startedOn?: string | null;
      finishedOn?: string | null;
      readFormat?: string | null;
      notes?: string | null;
    },
  ) => request<Record<string, unknown>>(`/api/works/${id}/reading`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }),

  createWork: (body: unknown) =>
    request<{ work: WorkSummary }>('/api/works', { method: 'POST', body: JSON.stringify(body) }),


  createEdition: (body: unknown) =>
    request<{ edition: { id: number } }>('/api/editions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * A PATCH: `{ format: 'hardcover' }` corrects the format and touches nothing
   * else. This is how a book scanned off its barcode — which always lands as
   * `paperback` — stops being the wrong kind of printing.
   */
  updateEdition: (id: number, body: Record<string, unknown>) =>
    request<{ edition: Record<string, unknown> }>(`/api/editions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteEdition: (id: number) =>
    request<{ ok: true }>(`/api/editions/${id}`, { method: 'DELETE' }),

  createCopy: (body: unknown) =>
    request<{ copy: { id: number } }>('/api/copies', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  scan: (code: string) => request<Record<string, unknown>>(`/api/isbn/${encodeURIComponent(code)}`),

  /** Proposals only — see apps/worker/src/routes/enrich.ts. */
  enrichCandidates: (workId: number) =>
    request<{
      candidates: {
        title: string;
        authors: string;
        publisher: string | null;
        publishedYear: number | null;
        coverUrl: string | null;
        openlibraryWorkId: string | null;
        similarity: number;
        authorSimilarity: number;
      }[];
      note: string | null;
    }>(`/api/enrich/works/${workId}/candidates`),

  updateWork: (id: number, body: unknown) =>
    request<Record<string, unknown>>(`/api/works/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /**
   * What deleting this work would destroy — fetched before the dialog can
   * offer the button, and recomputed by the server when the DELETE arrives.
   */
  workDeletionReport: (id: number) =>
    request<{ report: DeletionReport }>(`/api/works/${id}/deletion`),

  /**
   * Delete a work outright.
   *
   * ⚠️ Refused with **409 `copies_block_deletion`** whenever any copy records
   * real property — everything except a plain wish blocks, and there is no
   * force flag. The 409 body carries the fresh `report` naming the copies.
   */
  deleteWork: (id: number) =>
    request<{ ok: true; report: DeletionReport }>(`/api/works/${id}`, { method: 'DELETE' }),

  /* -- covers ------------------------------------------------------------- */

  /** Is an R2 bucket bound? Asked once, so the panel can hide what cannot work. */
  coverStorage: () =>
    request<{ enabled: boolean; maxBytes: number; reason?: string }>('/api/cover-storage'),

  /**
   * Every cover this book could wear, side by side — editions' own covers,
   * previous covers from the change log (still retrievable: uploads are
   * content-addressed and never deleted by a swap), and Open Library guesses
   * that announce themselves as guesses. Applying a pick goes through
   * `setCover`, whose server-side fetch check still applies.
   */
  coverCandidates: (id: number) =>
    request<{
      workId: number;
      title: string;
      currentUrl: string | null;
      coverStatus: 'ok' | 'standin' | null;
      candidates: CoverCandidateView[];
    }>(`/api/works/${id}/covers`),

  /**
   * Run the paid cover search for one book — owner/admin/moderator only, and the
   * UI confirms first because it spends money (~6¢). Returns a proposed cover and
   * whether its URL is live; applying it is a separate `setCover` call.
   *
   * ⚠️ Slow: the server awaits a 20-90s web search, so this promise is long-lived.
   */
  findCover: (id: number) =>
    request<CoverFindResult>(`/api/works/${id}/cover/find`, { method: 'POST' }),

  /**
   * Point a book at an image somebody else hosts.
   *
   * ⚠️ The Worker **fetches and checks** the URL before storing it, so this can
   * fail with 422 on a link that looks perfectly good. That is the feature —
   * nothing revisits a cover column, so a dead link would be permanent.
   */
  setCover: (id: number, body: { url: string; status?: 'ok' | 'standin' | null }) =>
    request<{ work: WorkSummary; bytes: number }>(`/api/works/${id}/cover`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  /** Mark the cover already there as a stand-in, as right, or as unassessed. */
  setCoverStatus: (id: number, status: 'ok' | 'standin' | null) =>
    request<{ work: WorkSummary }>(`/api/works/${id}/cover-status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  removeCover: (id: number) =>
    request<{ work: WorkSummary }>(`/api/works/${id}/cover`, { method: 'DELETE' }),

  /**
   * Upload a file the app then serves.
   *
   * ⚠️ **Not `request()`** — that helper sets `Content-Type: application/json`
   * on every call, and setting any content type by hand on a `FormData` body
   * strips the multipart boundary the browser was about to generate, so the
   * server receives a body it cannot parse. The boundary is why this is the one
   * call that builds its own fetch.
   *
   * ⚠️ Answers **501** when no R2 bucket is bound, which is the state of this
   * Worker today. `coverStorage()` is how the UI avoids offering it.
   */
  uploadCover: async (id: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const token = await getIdToken();
    const res = await fetch(`/api/works/${id}/cover`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string; detail?: unknown } | null;
      throw new ApiError(
        res.status,
        body?.detail,
        typeof body?.detail === 'string' ? body.detail : (body?.error ?? `HTTP ${res.status}`),
        body,
      );
    }
    return (await res.json()) as { work: WorkSummary; key: string; bytes: number };
  },

  /* -- watches ------------------------------------------------------------ */

  /** Everything still open, across the catalog. */
  watches: () => request<{ watches: (Watch & { title: string; authors: string | null; coverUrl: string | null })[] }>(
    '/api/watches',
  ),

  workWatches: (id: number) => request<{ watches: Watch[] }>(`/api/works/${id}/watches`),

  addWatch: (id: number, note: string) =>
    request<{ watches: Watch[] }>(`/api/works/${id}/watches`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  /** "I have looked at this." Kept as history rather than deleted. */
  resolveWatch: (id: number, watchId: number) =>
    request<{ watches: Watch[] }>(`/api/works/${id}/watches/${watchId}/resolve`, { method: 'POST' }),

  /** Raised by mistake — distinct from resolving, which asserts somebody looked. */
  deleteWatch: (id: number, watchId: number) =>
    request<{ watches: Watch[] }>(`/api/works/${id}/watches/${watchId}`, { method: 'DELETE' }),

  /** The Worker builds the review document; the browser writes it. See routes/reviews.ts. */
  reviewDraft: (workId: number, body: { rating: number; text: string; editionLabel?: string }) =>
    request<{ collection: string; docId: string; doc: Record<string, unknown> }>(
      `/api/reviews/${workId}/draft`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /**
   * ⚠️ Both keys are null — and `held` says why — for a book with no author
   * recorded (design §3.4 guard 2). The legacy bookId is title-only, so on an
   * authorless book it could surface a stranger's reviews of a different book
   * with the same name; the panel renders the held sentence instead of asking.
   */
  reviewKeys: (workId: number) =>
    request<{
      collection: string;
      workKey: string | null;
      legacyBookId: string | null;
      held?: string;
    }>(`/api/reviews/${workId}/keys`),

  /**
   * Report what the review fetch just returned — the write side of the
   * key-move evidence floor (design §5.2). Piggybacked after every successful
   * fetch; failure is non-fatal and silent, because nothing was promised.
   */
  reviewsSeen: (workId: number, count: number) =>
    request<{ ok: boolean }>(`/api/works/${workId}/reviews-seen`, {
      method: 'POST',
      body: JSON.stringify({ count }),
    }),

  /** The Changes panel read — who changed what, when, newest first. */
  workChanges: (workId: number) => request<{ changes: ChangeView[] }>(`/api/works/${workId}/changes`),

  /**
   * "This rating is really in Firestore, and it is mine." Derives read state.
   *
   * ⚠️ Only ever called with a rating that has been **read back** out of
   * Firestore, never with one about to be written — the Worker cannot see
   * Firestore, so this browser is the only witness it has, and a read state
   * derived from a write that failed would be a visible lie rather than a stale
   * cache. See `routes/reviews.ts`.
   *
   * `marked` lists the works that changed, which is empty on every call after
   * the first. That is what the caller uses to decide whether to reload.
   */
  reviewObserved: (workId: number, body: { rating: number; source?: 'audio' | 'library' | null }) =>
    request<{ marked: DerivedRead[] }>(`/api/reviews/${workId}/observed`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * Which review collection this deployment uses. The per-book calls answer it
   * as part of their reply; the sweep has no book to ask about and must not
   * guess — see `routes/reviews.ts`.
   */
  reviewCollection: () => request<{ collection: string }>('/api/reviews/collection'),

  /**
   * The `bookId → workKey` lookup for works with an audiobook holding.
   *
   * Used by the sweep to resolve reviews that lack a `workKey` field — those
   * written on the audiobook site after the last `backfill-review-keys.mjs` run.
   * Without this, such reviews are invisible to the sweep (they are still picked
   * up when the book page is opened, via the per-book fallback).
   */
  reviewBookIdIndex: () => request<{ index: Record<string, string> }>('/api/reviews/bookid-index'),

  /**
   * Every rating this person has written, in one call. See `lib/read-sync.ts`
   * for what reads them out of Firestore and `routes/reviews.ts` for why the
   * browser is the only thing that can.
   */
  reviewsObserved: (
    ratings: { workKey: string; rating: number; source?: 'audio' | 'library' | null }[],
  ) =>
    request<{ marked: DerivedRead[]; considered: number }>('/api/reviews/observed', {
      method: 'POST',
      body: JSON.stringify({ ratings }),
    }),

  // -------------------------------------------------------------------------
  // The cross-catalog to-be-read list
  // -------------------------------------------------------------------------

  /**
   * The collection, the document id and the payload for one book's TBR entry.
   *
   * ⚠️ `docId` and `doc` are **null** — and `held` says why — for a book with
   * no author recorded, the same guard `reviewKeys` applies: an entry written
   * now would carry the provisional key and come loose the day the author
   * arrives. The control renders the held sentence and offers no button.
   */
  /**
   * Which reading-list collection this deployment uses. The per-book call
   * answers it as part of its reply; the list screen has no book to ask about
   * and must not guess the lane — see `routes/tbr.ts`.
   */
  tbrCollection: () => request<{ collection: string }>('/api/tbr/collection'),

  tbrKeys: (workId: number) =>
    request<{
      collection: string;
      /** The ACCOUNT-keyed id, `{uid}_{bookId}` — the only write target. */
      docId: string | null;
      /**
       * ⚠️ The pre-2026-08-18 id, `{displayNameLower}_{bookId}`. READ-ONLY, and
       * absent when the server could not build one. It exists so the button
       * does not report "not on your list" for an entry the account migration
       * has not reached (or, for 53 documents, never will) — see `routes/tbr.ts`
       * for the removal condition.
       */
      legacyDocId?: string | null;
      doc: Record<string, unknown> | null;
      held?: string;
    }>(`/api/tbr/${workId}/keys`),

  /**
   * "Which of my TBR entries are books on these shelves, and have I read them?"
   *
   * The browser brings the list because the Worker cannot see Firestore. Every
   * read state comes back for the signed-in person only — see `routes/tbr.ts`.
   */
  tbrResolve: (entries: { docId: string; bookId: string; workKey: string | null }[]) =>
    request<{ entries: TbrMatchView[]; groups: TbrGroupView[] }>('/api/tbr/resolve', {
      method: 'POST',
      body: JSON.stringify({ entries }),
    }),

  // -------------------------------------------------------------------------
  // Reader content warnings — the shared `user_content_warnings` collection
  // -------------------------------------------------------------------------

  /**
   * The lane, the ids to query, and the exact title the audiobook pipeline's
   * published warnings file is keyed by.
   *
   * ⚠️ **`bookIds` is a list, not a key, and the order matters** — the first is
   * the id a note written here is filed under, which is the AUDIOBOOK
   * catalog's spelling of the title whenever this catalog knows it. That is the
   * whole cross-catalog join; see `packages/core/src/warnings.ts`.
   *
   * ⚠️ Empty (and `held` says why) for a book with no author recorded, the same
   * guard `reviewKeys` applies: a title-only id could surface notes about a
   * different book with the same name.
   */
  warningKeys: (workId: number) =>
    request<{
      collection: string;
      bookIds: string[];
      publishedTitle: string | null;
      writeBookId?: string;
      audiobookTitle?: string | null;
      held?: string;
    }>(`/api/warnings/${workId}/keys`),

  /** The Worker builds the note document; the browser writes it. See routes/warnings.ts. */
  warningDraft: (workId: number, body: { label: string }) =>
    request<{ collection: string; docId: string; doc: Record<string, unknown> }>(
      `/api/warnings/${workId}/draft`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // -------------------------------------------------------------------------
  // Series completeness
  // -------------------------------------------------------------------------

  seriesList: () =>
    request<{ series: SeriesSummary[]; withoutSeries: number }>('/api/series'),

  series: (name: string) =>
    request<SeriesReport>(`/api/series/${encodeURIComponent(name)}`),

  /**
   * Autocomplete for the editor's series field — distinct names from our own
   * `work.series` and the audiobook catalog, each tagged with where it came
   * from. Read-only; typing an existing name is what groups a work with its
   * series, and an `audiobook`-tagged name signals a confirmable audio match.
   */
  suggestSeries: (q: string) =>
    request<{ suggestions: SeriesSuggestion[] }>(
      `/api/series/suggest?q=${encodeURIComponent(q)}`,
    ),

  /**
   * For the editor's audio-equivalence control: the works this series folds
   * across, the audiobook-series it can be linked to (exactly what
   * `confirmAudioSeries` will accept), and the current link if any.
   */
  audioSeriesCandidates: (name: string) =>
    request<AudioSeriesCandidates>(
      `/api/series/${encodeURIComponent(name)}/audio-candidates`,
    ),

  /** Hand-entered: "this series has a book 14". Always stored as `manual`. */
  addSeriesVolume: (
    name: string,
    body: {
      indexSort: number;
      indexDisplay?: string | null;
      title?: string | null;
      authors?: string | null;
      source: 'manual';
      sourceUrl?: string | null;
      note?: string | null;
    },
  ) =>
    request<SeriesReport>(`/api/series/${encodeURIComponent(name)}/volumes`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteSeriesVolume: (name: string, id: number) =>
    request<SeriesReport>(`/api/series/${encodeURIComponent(name)}/volumes/${id}`, {
      method: 'DELETE',
    }),

  /**
   * ⚠️ The only way a series length enters this app, and the server refuses it
   * without a source. `knownTotal: null` withdraws the claim.
   */
  setSeriesTotal: (
    name: string,
    body: { knownTotal: number | null; knownTotalSource?: string | null; note?: string | null },
  ) =>
    request<SeriesReport>(`/api/series/${encodeURIComponent(name)}/total`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  /**
   * "I am never buying that one."
   *
   * ⚠️ Costs a `reason` but no *source*, unlike every other write above it. It
   * is a decision about intent, not a claim about the world — see migration
   * 0100. An upsert, so re-recording with a better reason is the same call.
   */
  skipSeriesGap: (name: string, body: { indexSort: number; reason: string; note?: string | null }) =>
    request<SeriesReport>(`/api/series/${encodeURIComponent(name)}/skips`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Change your mind. The rung goes back to being missing. */
  unskipSeriesGap: (name: string, index: number) =>
    request<SeriesReport>(`/api/series/${encodeURIComponent(name)}/skips/${index}`, {
      method: 'DELETE',
    }),

  /**
   * "That IS the same series — I own those on audio." — migration 0110.
   *
   * ⚠️ `audiobookSeries` is **their** spelling, taken from the rung the page just
   * showed. Sending it back is what lets the server refuse a mapping that has
   * since changed; it is not a convenience field.
   */
  confirmAudioSeries: (name: string, body: { audiobookSeries: string; note?: string | null }) =>
    request<SeriesReport>(`/api/series/${encodeURIComponent(name)}/audio-link`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Withdraw it. Every rung it was holding up is missing again. */
  unconfirmAudioSeries: (name: string) =>
    request<SeriesReport>(`/api/series/${encodeURIComponent(name)}/audio-link`, {
      method: 'DELETE',
    }),

  /**
   * Research this series' complete volume list on the open web, and write down
   * what a source says — `series_volume` rows the ladder above already knows
   * how to render as gaps. Spends money and takes 20–90 seconds, the same shape
   * as `runResearch`; the request is held open for the whole scan on purpose.
   *
   * Re-running is expected, not just tolerated — "scan again" refreshes every
   * `claude_research` row's `last_seen_at` and never touches a `manual` one.
   */
  scanSeries: (name: string) =>
    request<SeriesScanResponse>(`/api/series/${encodeURIComponent(name)}/scan`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // -------------------------------------------------------------------------
  // Wishlist
  // -------------------------------------------------------------------------

  /**
   * ⚠️ Copies, not works. A wanted hardcover of a book already held as an EPUB
   * is a real wish and a work-level filter cannot express it — see the route.
   */
  wishlist: (status?: string) =>
    request<{ rows: WishlistRow[]; statuses: string[] }>(
      `/api/wishlist${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    ),

  /** A PATCH: `{ status: 'owned' }` promotes a wish without losing the rest. */
  updateCopy: (id: number, body: Record<string, unknown>) =>
    request<{ copy: Record<string, unknown> }>(`/api/copies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteCopy: (id: number) => request<{ ok: true }>(`/api/copies/${id}`, { method: 'DELETE' }),

  /**
   * "Books with you" — the copies of this house's that are linked to the person
   * asking. No parameter, deliberately: the server reads the id off the token,
   * so this can only ever answer about whoever is signed in.
   */
  copiesWithMe: () => request<{ copies: LinkedCopy[] }>('/api/copies/with-me'),

  // -------------------------------------------------------------------------
  // Related books
  // -------------------------------------------------------------------------

  relations: (workId: number) =>
    request<{ related: RelatedWork[] }>(`/api/works/${workId}/relations`),

  /** Answers with the whole list, so a directional link is drawn from the end it was stored at. */
  addRelation: (
    workId: number,
    body: { toWorkId: number; relation: string; note?: string | null },
  ) =>
    request<{ related: RelatedWork[] }>(`/api/works/${workId}/relations`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteRelation: (relationId: number) =>
    request<{ ok: true }>(`/api/relations/${relationId}`, { method: 'DELETE' }),

  // -------------------------------------------------------------------------
  // Other names a book answers to
  // -------------------------------------------------------------------------

  aliases: (workId: number) => request<{ aliases: WorkAlias[] }>(`/api/works/${workId}/aliases`),

  /**
   * ⚠️ `kind` is required and has no client-side default, mirroring the schema.
   * A title alias helps a search find this book; an author alias stops the author
   * gate refusing it. Guessing which one somebody meant is how an alternate title
   * ends up widening the check that keeps wrong books out.
   */
  addAlias: (workId: number, body: { alias: string; kind: 'title' | 'author' }) =>
    request<{ aliases: WorkAlias[] }>(`/api/works/${workId}/aliases`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteAlias: (workId: number, aliasId: number) =>
    request<{ aliases: WorkAlias[] }>(`/api/works/${workId}/aliases/${aliasId}`, {
      method: 'DELETE',
    }),

  // -------------------------------------------------------------------------
  // Accessories — the things in the box that are not books
  //
  // ⚠️ Every one of these is scoped to a single work, and that is the feature.
  // There is no `api.accessoryCount()` and no collection-wide read, because the
  // owner asked for the count to stay off the main page. Adding one here is how
  // it would arrive there by accident.
  // -------------------------------------------------------------------------

  accessories: (workId: number) =>
    request<{ accessories: Accessory[] }>(`/api/works/${workId}/accessories`),

  addAccessory: (
    workId: number,
    body: {
      name: string;
      kind?: string;
      isDigital?: boolean;
      quantity?: number;
      copyId?: number | null;
      pledgeId?: number | null;
      location?: string | null;
      notes?: string | null;
    },
  ) =>
    request<{ accessories: Accessory[] }>(`/api/works/${workId}/accessories`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** ⚠️ A PATCH: send only what changed. Sending the whole object is safe too. */
  updateAccessory: (workId: number, accessoryId: number, body: Record<string, unknown>) =>
    request<{ accessories: Accessory[] }>(`/api/works/${workId}/accessories/${accessoryId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteAccessory: (workId: number, accessoryId: number) =>
    request<{ accessories: Accessory[] }>(`/api/works/${workId}/accessories/${accessoryId}`, {
      method: 'DELETE',
    }),

  // -------------------------------------------------------------------------
  // Crowdfunding provenance
  // -------------------------------------------------------------------------

  /** Where this book came from. Two rows for one pledge is the physical/digital pair. */
  provenance: (workId: number) =>
    request<{ provenance: Provenance[] }>(`/api/works/${workId}/provenance`),

  /** Owner-only, for the accessory form's "which pledge did this come in" picker. */
  pledgeOptions: () =>
    request<{ pledges: { id: number; label: string }[] }>('/api/crowdfunding/pledges'),

  /** ⚠️ Unlinks the reward line. It does not delete the book or the copy. */
  deletePledgeItem: (itemId: number) =>
    request<{ ok: true }>(`/api/crowdfunding/items/${itemId}`, { method: 'DELETE' }),

  /** Close an `unmatched` line by saying which printing it actually was. */
  matchPledgeItemEdition: (itemId: number, editionId: number | null) =>
    request<{ item: Record<string, unknown> }>(`/api/crowdfunding/items/${itemId}/edition`, {
      method: 'PUT',
      body: JSON.stringify({ editionId }),
    }),

  // -------------------------------------------------------------------------
  // People
  // -------------------------------------------------------------------------

  users: () => request<{ users: Person[] }>('/api/users'),

  /**
   * The name-picker roster — `{ id, displayName }` only, gated on `editCatalog`
   * server-side (`GET /api/members`). This is what the OR-1 person field reads,
   * NOT `users()`: that one is `manageUsers`-only and hands out email, photo and
   * role. Any editor who may record who has a book may list this.
   */
  members: () => request<{ members: Member[] }>('/api/members'),

  /**
   * ⚠️ The server refuses the last owner demoting themselves, and refuses anyone
   * without `manageUsers` outright. The UI disables those buttons too, but the
   * server is the one that decides — see `apps/worker/src/routes/users.ts`.
   */
  // ⚠️ `Role`, not a hand-written union. This listed the three role names
  // literally until 2026-08-10, and adding `manager` to core is what surfaced
  // it: the People page derives its buttons from ROLES, so the new role
  // appeared in the UI and then failed to typecheck here. That is the good
  // outcome — the same drift with a wider signature would have compiled and
  // 400d at runtime.
  setRole: (userId: number, role: Role) =>
    request<{ user: Person }>(`/api/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  /**
   * Download the whole catalog.
   *
   * ⚠️ Not a plain `<a download href="/api/export.json">`, and this is the one
   * place that differs from the sibling Board Game Catalog. That app is behind
   * Cloudflare Access, whose session is a **cookie**, so the browser attaches it
   * to an ordinary navigation and an anchor just works. Here the credential is a
   * Firebase **Bearer token** that only `request()` knows how to attach — an
   * anchor would arrive with no Authorization header and 401.
   *
   * ⚠️ And it would have looked fine locally. `middleware/auth.ts`'s dev bypass
   * answers without a token, so an anchor downloads perfectly on `:8787` and
   * fails the moment it is deployed. That is the exact shape of bug this
   * project's notes keep recording, so it is written down rather than discovered.
   *
   * The trade: the response is buffered into a Blob on this device before the
   * save dialog opens. The *server* still streams and pages — see
   * `packages/db/src/export.ts` — but the browser holds the finished file, which
   * for a household catalog is a few hundred kilobytes and for a very large one
   * would want the File System Access API instead (not available on iOS).
   */
  downloadExport: async (format: 'json' | 'csv'): Promise<{ filename: string; blob: Blob }> => {
    const token = await getIdToken(false);
    const res = await fetch(`/api/export.${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(res.status, null, body?.error ?? `HTTP ${res.status}`, body);
    }
    // The server names the file; the date in it is the server's, which is the one
    // the data is as of.
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const named = /filename="([^"]+)"/.exec(disposition)?.[1];
    return {
      filename: named ?? `library-catalog.${format}`,
      blob: await res.blob(),
    };
  },
  // -------------------------------------------------------------------------
  // Scan jobs — the intake queue
  //
  // ⚠️ Every one of these is a *proposal*. Nothing here writes to the catalog;
  // `patchScanLine({ addedWorkId })` records that the ordinary create endpoints
  // already did. See apps/worker/src/routes/scan-jobs.ts.
  // -------------------------------------------------------------------------

  /** `open` narrows to sweeps that still want attention. */
  scanJobs: (open = true) =>
    request<{ jobs: ScanJob[] }>(`/api/scan-jobs${open ? '?open=1' : ''}`),

  scanJob: (id: number) => request<{ job: ScanJob }>(`/api/scan-jobs/${id}`),

  /**
   * One barcode, appended to an open sweep. Omit `jobId` to start one.
   *
   * ⚠️ `duplicate: true` means the server declined to add a second line for a
   * code the sweep already holds — **not an error, and not the end of it**. A
   * book left in front of the lens is the ordinary case, so the refusal is
   * right by default; but the response carries `index` and `line` precisely so
   * the screen can say *which* row it collided with and offer to add it anyway.
   * `allowDuplicate` is that offer being accepted, and it appends a new line.
   */
  scanBarcode: (code: string, jobId: number | null, allowDuplicate = false) =>
    request<{ job: ScanJob; index: number; line: ScanLine; duplicate: boolean }>(
      '/api/scan-jobs/barcode',
      { method: 'POST', body: JSON.stringify({ code, jobId, allowDuplicate }) },
    ),

  /**
   * ⚠️ Costs money, and the photo is never stored — see the route.
   * `usage.estimatedCents` comes back so the screen can say what it cost.
   */
  /**
   * ONE book, photographed front-on. Same shape as `scanShelf`, different
   * prompt — a cover also yields series, volume and publisher, which a spine
   * almost never prints and which are the discriminators a title and an author
   * cannot substitute for.
   *
   * ⚠️ Costs money, and the photo is never stored — see the route.
   */
  scanSingle: (data: string, mediaType: string) =>
    request<{
      job: ScanJob;
      unreadable: boolean;
      usage: { inputTokens: number; outputTokens: number; estimatedCents: number };
    }>('/api/scan-jobs/single', { method: 'POST', body: JSON.stringify({ data, mediaType }) }),

  scanShelf: (data: string, mediaType: string) =>
    request<{
      job: ScanJob;
      unreadable: boolean;
      usage: { inputTokens: number; outputTokens: number; estimatedCents: number };
    }>('/api/scan-jobs/shelf', { method: 'POST', body: JSON.stringify({ data, mediaType }) }),

  /**
   * Continue — or retry — the automatic first lookup pass.
   *
   * ⚠️ One call does one chunk. The review screen asks again each time progress
   * moves, which is the whole continuation mechanism; there is no cron and no
   * queue. `running: false` means there was nothing left to look up.
   *
   * Never an error when a pass is already in flight: the honest answer to
   * "please continue" is `running: true`.
   */
  enrichScanJob: (id: number) =>
    request<{ job: ScanJob; running: boolean }>(`/api/scan-jobs/${id}/enrich`, { method: 'POST' }),

  /** `q` is the corrected title. Without it, the spine's own words are used. */
  lookupScanLine: (jobId: number, index: number, q?: string) =>
    request<{ job: ScanJob; index: number; line: ScanLine; found: boolean }>(
      `/api/scan-jobs/${jobId}/lines/${index}/lookup${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      { method: 'POST' },
    ),

  patchScanLine: (
    jobId: number,
    index: number,
    body: { addedWorkId?: number | null; dismissed?: boolean; text?: string; author?: string | null },
  ) =>
    request<{ job: ScanJob; index: number; line: ScanLine }>(
      `/api/scan-jobs/${jobId}/lines/${index}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  finishScanJob: (id: number) =>
    request<{ job: ScanJob }>(`/api/scan-jobs/${id}/done`, { method: 'POST' }),

  deleteScanJob: (id: number) =>
    request<{ ok: true }>(`/api/scan-jobs/${id}`, { method: 'DELETE' }),
  // Details queue and research
  // -------------------------------------------------------------------------

  queue: () => request<QueueResponse>('/api/research/queue'),

  workFindings: (workId: number) =>
    request<{
      work: { id: number; title: string; authors: string };
      findings: ResearchFinding[];
      runs: RunView[];
      verdicts: GapVerdictRow[];
      missing: DetailField[];
    }>(`/api/research/works/${workId}/findings`),

  /**
   * ⚠️ Spends money, and takes 20–90 seconds. The request is held open for the
   * whole lookup on purpose — see apps/worker/src/lib/research-run.ts. The
   * outcome is written to `research_run` before the response is sent, so a
   * lookup whose response never arrives still shows up on the next poll.
   */
  runResearch: (workId: number) =>
    request<{
      run: RunView;
      alreadyRunning: boolean;
      /**
       * ⚠️ Still pending *after* the run — which now means "could not be
       * applied", not "waiting to be read". Normally empty; a value that was not
       * a usable year lands here and is the only thing left for a person.
       */
      findings?: ResearchFinding[];
      missing?: DetailField[];
    }>(`/api/research/works/${workId}/run`, { method: 'POST', body: JSON.stringify({}) }),

  /** What the machine wrote lately, newest first. The undo list. */
  autoApplied: (limit = 50) =>
    request<{ applied: AutoApplied[] }>(`/api/research/auto-applied?limit=${limit}`),

  /**
   * Take back auto-applied values — one, or a screenful.
   *
   * ⚠️ At most 10 per call; the server refuses more rather than truncating,
   * because each revert costs D1 subrequests and a partial undo reporting
   * success would be worse than a refusal.
   */
  undoAutoApplied: (ids: number[]) =>
    request<{ reverted: string[]; skipped: string[]; works: number[] }>(
      '/api/research/undo',
      { method: 'POST', body: JSON.stringify({ ids }) },
    ),

  /**
   * Accept or reject one proposal.
   *
   * ⚠️ Accepting applies it — to a blank column only, never over something
   * already recorded, and a `none`/`unknown` becomes a verdict rather than a
   * value. `applied` and `skipped` say in a sentence what actually happened.
   */
  reviewFinding: (findingId: number, reviewState: 'accepted' | 'rejected') =>
    request<{
      finding: ResearchFinding;
      applied: string | null;
      skipped: string | null;
      missing: DetailField[];
    }>(`/api/research/findings/${findingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ reviewState }),
    }),

  /** Free, and it demands a source. The honest way to close a gap by hand. */
  setVerdict: (
    workId: number,
    body: { field: DetailField; verdict: 'none' | 'unknown'; source: string; note?: string | null },
  ) =>
    request<{ verdict: GapVerdictRow; missing: DetailField[] }>(
      `/api/research/works/${workId}/verdict`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  deleteVerdict: (id: number) =>
    request<{ ok: true }>(`/api/research/verdicts/${id}`, { method: 'DELETE' }),

  // GABI — the conversational fixer
  // -------------------------------------------------------------------------

  /**
   * ⚠️ Spends money on this instance's Anthropic key, one model call per call.
   *
   * The loop runs HERE, not on the Worker: this posts a turn, the panel executes
   * whatever tools the model asked for through the ordinary methods above — each
   * one its own authenticated request, its own invocation, its own fresh
   * subrequest budget — and posts the next turn. `docs/info/gabi-fixer-design.md`
   * §3.1 carries the arithmetic; the short version is that a server-side loop
   * spends ~40 of an invocation's 50 subrequests on a six-turn conversation, and
   * going over **terminates the invocation rather than throwing**.
   *
   * ⚠️ The whole `messages` array goes up every time — the route is stateless
   * and persists no transcript. The Worker refuses past 24 turns.
   */
  gabiTurn: (conversationId: string, messages: unknown[]) =>
    request<GabiTurnResponse>('/api/gabi/turn', {
      method: 'POST',
      body: JSON.stringify({ conversationId, messages }),
    }),

  /** Save a note GABI made about the person (personal context). */
  gabiNote: (body: { note: string; kind: string }) =>
    request<{ ok: true }>('/api/gabi/note', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
