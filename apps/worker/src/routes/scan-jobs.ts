import { Hono } from 'hono';
import { z } from 'zod';
import {
  MIN_AUTHOR_SIMILARITY,
  blankLine,
  buildWorkIndex,
  classifyScannedCode,
  foldSeriesNames,
  hasPendingLookups,
  isBareSeriesTitle,
  matchIndexedWork,
  needsLookup,
  normaliseTitle,
  primaryAuthor,
  proposedAuthors,
  proposedTitle,
  titleSimilarity,
  workKeyFor,
  type ScanJob,
  type ScanLine,
  type ScanOverlap,
} from '@lc/core';
import {
  createScanJob,
  deleteScanJob,
  findEditionByAsin,
  findEditionByIsbn13,
  findWorkByKey,
  getScanJob,
  getWork,
  listKnownSeriesNames,
  listScanJobs,
  listWorkAliases,
  listWorksForMatching,
  loadContainmentIndex,
  updateScanJob,
} from '@lc/db';
import { coverFrom, resolveIsbn, searchOpenLibrary, wasRefused, type BookCandidate } from '@lc/isbn';
import type { AppBindings, Env } from '../env.js';
import { isPhotoMediaType, readShelf, VisionError } from '../lib/vision.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Scan jobs — the intake queue.
 *
 * Two ways in, one queue, one review list:
 *
 * - **A barcode.** Exact, free, and instant. Each scan appends a line to a job
 *   that stays open for the next one, so a stack of twelve books is *one* job
 *   with twelve lines rather than twelve trips through the review screen.
 * - **A shelf photograph.** One job per photo. Costs money, so it is the reason
 *   this file exists at all.
 *
 * ## ⚠️ Persistence came first, and that ordering was the point
 *
 * `ScanPage` used to keep its results in React state. A phone locking mid-sweep
 * lost the lot, which is a shrug for barcodes — re-scan, it is free — and
 * unacceptable for a photograph you have already paid to have read. Nothing in
 * the vision path was written until a job could survive a reload.
 *
 * ## ⚠️ Nothing here writes to the catalog
 *
 * Every line is a proposal. `addedWorkId` is set by the client *after* the
 * ordinary `POST /api/works` + `/api/editions` + `/api/copies`, and this route
 * only records that it happened. Phase 0 measured a wrong ISBN resolving to a
 * confident, well-formed, wrong book; a spine read is weaker evidence than an
 * ISBN, so the review step is not ceremony here either.
 *
 * ## The first lookup pass is automatic
 *
 * ⚠️ **This reverses an earlier decision, deliberately and on the owner's
 * instruction.** This file used to argue that every external search should be a
 * button, on two grounds: half this library is not in Open Library (measured:
 * 14 of 30), so most searches answer nothing; and spine text is often wrong, so
 * the *useful* search is the one made after a person corrects it.
 *
 * Both facts are still true and neither was the point. The sibling Board Game
 * Catalog does the first pass automatically, and it is plainly the better
 * screen to work through: you arrive at a list that already knows what it can,
 * instead of a list of fifteen buttons you must press one at a time before it
 * can tell you anything. A search that answers nothing costs a row that says
 * "not in Open Library" — which is *information*, arrived at without a tap.
 * What the two facts actually argue for is that the manual, corrected re-lookup
 * must survive, and it does: `POST /:id/lines/:i/lookup?q=` is unchanged and is
 * now the repair bench rather than the only way in.
 *
 * ## How, and it is the sibling's mechanism rather than a new one
 *
 * | | |
 * |---|---|
 * | **Barcode** | Already automatic, synchronously, inside the append. Unchanged. |
 * | **Photo** | `waitUntil` a chunked pass, kicked from the upload response |
 * | Continuing | the client asks for the next chunk; `POST /:id/enrich` |
 *
 * The chunking is the sibling's, and it exists because a Worker invocation has
 * a ceiling: theirs is the 50-subrequest limit that silently killed three
 * shelves. `LINES_PER_RUN` bounds one pass, the pass leaves the job at `read`
 * when there is more to do, and the review screen asks again. `read` therefore
 * means "lines exist, not all looked up" — which is what it already meant — so
 * continuing needed no new status and no migration.
 *
 * `processed_at` is the heartbeat: `STALE_AFTER_MS` is what lets a retry tell a
 * dead pass from a live one instead of racing it.
 *
 * ## ⚠️ Automatic must not mean silently wrong
 *
 * Nothing about the pass relaxes what a line claims. `similarity` is still
 * carried and not enforced, the author gate still *rejects* rather than
 * down-ranks, and a weak match still arrives unticked with its score printed.
 * The pass fills a proposal in; a person still confirms it.
 */

const UA = 'library_catalog (private household catalog)';

/**
 * base64 is 4 characters per 3 bytes. Check before decoding anything, so an
 * oversized upload is a sentence rather than a confusing 413 from the platform.
 */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
function tooLarge(base64: string): boolean {
  return Math.floor((base64.length * 3) / 4) > MAX_PHOTO_BYTES;
}

const photoSchema = z.object({
  /** Raw base64, no `data:` prefix — `captureFrame` strips it before sending. */
  data: z.string().min(64),
  mediaType: z.string().refine(isPhotoMediaType, 'unsupported image type'),
});

const barcodeSchema = z.object({
  /**
   * ⚠️ `min(3)`, not `min(8)`. The five-digit **price add-on** printed beside a
   * book's barcode is the single most common thing a sweep locks onto, and
   * `classifyScannedCode` exists to recognise and skip it — which it never gets
   * to do if the schema rejects the code as too short first. Caught by sending
   * `51999` through this route and getting a validation error where the whole
   * point was a quiet `skipped`.
   */
  code: z.string().trim().min(3).max(20),
  /**
   * The batch this scan belongs to. The client echoes back whatever the last
   * scan returned, so a session appends to one job; omitting it opens a new one,
   * which is what the first scan of a sweep does.
   */
  jobId: z.number().int().positive().nullable().optional(),
  /**
   * "Yes, I really do have two of these — put it on the sweep again."
   *
   * ⚠️ The answer to a prompt, never a default. Without it the route still
   * refuses a code the job already holds, because a book left in front of the
   * lens re-locks several times a second and that refusal is the only thing
   * standing between one book and five queue entries. With it, the person has
   * been *told* the code is already on the sweep and has said to add it anyway,
   * which is a completely different claim and deserves its own line.
   */
  allowDuplicate: z.boolean().optional(),
});

const lineUpdateSchema = z
  .object({
    addedWorkId: z.number().int().positive().nullable().optional(),
    dismissed: z.boolean().optional(),
    /** A corrected spine read. Clears the stale resolution — see the route. */
    text: z.string().trim().min(1).max(300).optional(),
    author: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

function badRequest(detail: unknown) {
  return { error: 'bad_request' as const, detail };
}

/** Renumber after any change to the list, so positions are 1..n with no gaps. */
function renumber(lines: ScanLine[]): ScanLine[] {
  return lines.map((line, i) => ({ ...line, position: i + 1 }));
}

// ---------------------------------------------------------------------------
// Resolving one line
// ---------------------------------------------------------------------------

/**
 * Fill a line in from a `BookCandidate`.
 *
 * `similarity` is scored against whatever we searched with, and **carried, not
 * enforced**. A weak match is shown with its score and left unticked, which
 * tells the truth about what was found; discarding it would silently drop a
 * title the person can see on the shelf in front of them.
 */
function applyCandidate(line: ScanLine, candidate: BookCandidate, searchedFor: string): ScanLine {
  return {
    ...line,
    state: 'found',
    // A candidate only exists because a service answered, so this is the one
    // place the flag can be set without repeating "we asked" at every call site.
    lookedUp: true,
    detail: null,
    isbn13: candidate.isbn13,
    resolvedTitle: candidate.title,
    resolvedAuthors: candidate.authors,
    publisher: candidate.publisher,
    publishedYear: candidate.publishedYear,
    coverUrl: candidate.coverUrl,
    similarity: titleSimilarity(normaliseTitle(candidate.title), normaliseTitle(searchedFor)),
  };
}

/**
 * Clear every field a previous resolution wrote. Used when the question changes.
 *
 * ⚠️ **A scanned ISBN survives this, and that is not an inconsistency.** Every
 * other field here is something a *service* claimed, so a new question makes it
 * stale. `isbn13` on a barcode line is something a *barcode* said — it is the
 * question, not the answer. Wiping it was how a board book that Open Library
 * has never heard of lost its ISBN the moment someone typed the title in by
 * hand, which is exactly when the ISBN is the only hard fact on the row.
 */
function unresolve(line: ScanLine): ScanLine {
  return {
    ...line,
    state: 'not_found',
    detail: null,
    existingWorkId: null,
    existingTitle: null,
    // Cleared with everything else the old resolution claimed. An overlap is a
    // statement about a *specific* work, and the whole point of a retype is that
    // the line no longer names that work — keeping it would warn about the book
    // somebody has just said this is not.
    overlap: [],
    isbn13: line.via === 'barcode' ? line.isbn13 : null,
    resolvedTitle: null,
    resolvedAuthors: null,
    publisher: null,
    publishedYear: null,
    coverUrl: null,
    similarity: null,
  };
}

/**
 * One scanned code, all the way through the ladder.
 *
 * Identical in behaviour to `GET /api/isbn/:code`, which it deliberately does
 * not call — that route answers a *question*, this one writes a *line*, and
 * going through HTTP to reach code in the same isolate would buy a subrequest
 * and a serialisation round trip for nothing. Both delegate to `@lc/isbn`,
 * which is the one implementation.
 */
async function resolveBarcode(env: Env, position: number, code: string): Promise<ScanLine> {
  const classified = classifyScannedCode(code);
  const line = blankLine(position, 'barcode', code);

  /*
   * ⚠️ Two very different kinds of "not an ISBN", and they used to be one.
   *
   * The owner asked whether a book carrying a **SKU or a retail UPC** instead
   * of an ISBN can be scanned. It can be *read* — the decoder does not care —
   * but every one of them was landing as `skipped`, which is settled, silent
   * and buttonless, so the answer in practice was no.
   *
   * They are now split by whether the code could plausibly belong to a book:
   *
   * - **`price_addon` stays `skipped`.** Five digits printed beside the real
   *   barcode. It is never the book, it is the single most common thing a sweep
   *   locks onto by mistake, and surfacing it would mean a warning per book.
   * - **A UPC, an own-brand SKU or a misread becomes `unresolvable`** — the
   *   state that already means "a real thing, and no free database indexes it".
   *   Outstanding, so it is visible; typeable, so a board book with only a SKU
   *   on the back can be given a title and added.
   *
   * ⚠️ **This has a cost, and it is the one to watch.** A back cover often
   * carries two or three barcodes, so a stray UPC read is ordinary rather than
   * exceptional — and each one now costs a "Not wanted" tap where it used to
   * cost nothing. If that turns out to be a nuisance in real use, reverting is
   * this branch and nothing else. Nothing is looked up either way: there is no
   * global registry of SKUs and inventing one lookup would be worse than none.
   */
  if (classified.kind === 'ignore') {
    if (classified.reason === 'price_addon') {
      return {
        ...line,
        code: classified.raw,
        state: 'skipped',
        detail: 'That is the five-digit price code printed beside the barcode. Use the longer one.',
      };
    }
    return {
      ...line,
      code: classified.raw,
      state: 'unresolvable',
      detail:
        'Not an ISBN — a shop barcode or a SKU, which nothing indexes. Type the title and ' +
        'author in and it can still be added.',
    };
  }

  if (classified.kind === 'asin') {
    const owned = await findEditionByAsin(env.DB, classified.asin);
    if (owned) return { ...line, code: classified.asin, ...(await ownedBy(env, owned.work_id)) };
    return {
      ...line,
      code: classified.asin,
      state: 'unresolvable',
      detail: 'Kindle ASIN — no free database indexes these.',
    };
  }

  const withCode: ScanLine = { ...line, code: classified.isbn13, isbn13: classified.isbn13 };

  const owned = await findEditionByIsbn13(env.DB, classified.isbn13);
  if (owned) return { ...withCode, ...(await ownedBy(env, owned.work_id)) };

  const { candidates, trace } = await resolveIsbn(classified.isbn13, {
    googleBooksKey: env.GOOGLE_BOOKS_API_KEY,
    userAgent: UA,
  });
  /*
   * ⚠️ Rung 1 wins the metadata, but the cover comes from whichever rung has one.
   *
   * This was `candidates[0]` alone, and it is why "every book should get a cover"
   * was not happening. Open Library answers for board-book ISBNs with a full
   * record and **no cover**; Google Books, rung 2, has the cover. Taking rung 1
   * whole took its `null` with it and discarded a cover already in hand.
   *
   * Safe because every candidate answered the same `isbn:` query — see
   * `coverFrom`. Not verified over the network here on purpose: this is a
   * *proposal* a person is about to look at, and the review screen renders the
   * cover, so a bad one is visible rather than silent. The backfill, which writes
   * without anyone looking, does verify.
   */
  const best = candidates[0]
    ? { ...candidates[0], coverUrl: candidates[0].coverUrl ?? coverFrom(candidates) }
    : undefined;
  if (!best) {
    /*
     * ⚠️ The one-barcode-one-edition refusal, said in the line's own words.
     *
     * `wasRefused` means a database ANSWERED — with a work-level aggregate or
     * an answer carrying several distinct ISBN-13s — and `@lc/isbn` refused it
     * rather than trimming it (matching-thresholds.md §6 tier 1; the phantom
     * *Space Knight* that gained 6 editions and 6 copies from scanned barcodes
     * on 2026-08-13 is why). That is a different fact from "not indexed", and
     * showing the board-book message for it would send the person hunting a
     * typo in a barcode that read perfectly. The remediation is the same —
     * type the title and author in — but the reason must be the true one.
     */
    if (wasRefused(trace)) {
      return {
        ...withCode,
        state: 'not_found',
        lookedUp: true,
        detail:
          'That barcode answered with a series-level record — several printings under one ' +
          'title, which one scan must never become. Type the exact title and author in, ' +
          'and it can still be added with this ISBN.',
      };
    }
    return {
      ...withCode,
      state: 'not_found',
      lookedUp: true,
      /*
       * ⚠️ Names the button, because this row is the owner's board-book
       * complaint: *"some baby board books are showing up with ISBN numbers but
       * when scanned they aren't populating with a title or author — we need
       * these to be able to still be added."* Board books and picture books are
       * the worst-indexed corner of Open Library and the best-represented
       * corner of this house, so this is a common row, not an edge case. The
       * ISBN stays on the line and reaches the edition when it is added.
       */
      detail:
        'Nothing found for that ISBN — board books and picture books often are not indexed. ' +
        'Type the title and author in, and it can still be added.',
    };
  }
  // Searched by ISBN, so there is nothing to score a title against: the code is
  // the identity claim. `similarity` stays null rather than being invented.
  return { ...applyCandidate(withCode, best, best.title), similarity: null, isbn13: classified.isbn13 };
}

/**
 * ⚠️ **"You already own this, inside something else" — said AT SCAN TIME.**
 *
 * The owner is holding the book and deciding. A report afterwards is too late,
 * and a refusal is wrong: they own volume 1 *and* the omnibus on purpose in some
 * cases. So this is a **reason**, added to the line, and the review screen raises
 * the prompt it already has for duplicates — "here is what you have, add it or
 * leave it" — rather than growing a second mechanism beside it.
 *
 * ## What it is not
 *
 * Not `state`. `state === 'owned'` means the *object* is already ours and is
 * answered from `edition.isbn13`; this means the *text* already reached us some
 * other way and is answered from `work_relation.contains`. They are independent:
 * a line can be neither, either, or both, and collapsing them would either hide
 * an overlap behind a duplicate or turn an overlap into a false duplicate.
 *
 * ## ⚠️ The short-circuit is load-bearing
 *
 * `work_relation` held **0 rows** on 2026-08-11. With no `contains` rows there is
 * nothing this can ever say, so it costs exactly one query per request and skips
 * the work index entirely. A scan path that got slower to support a table nobody
 * has filled in yet would be the wrong trade, and it is not the trade made here.
 *
 * Two ways a line names a work, and both are used:
 *
 * 1. `existingWorkId` — the ISBN, the ASIN or the spine matcher already said so.
 * 2. Otherwise the resolved title and author, through `workKeyFor` — the same key
 *    `POST /api/works` files under and the same question `/works/match` asks, so
 *    the overlap warning fires on exactly the works `addLineToCatalog` would
 *    attach to. A paperback of an ebook we hold has a *different* ISBN, so
 *    without this the commonest case in the house never matches.
 */
async function overlapsFor(
  env: Env,
  line: ScanLine,
  index: Map<number, ScanOverlap[]>,
): Promise<ScanOverlap[]> {
  if (index.size === 0) return [];

  let workId = line.existingWorkId;
  if (workId === null) {
    const title = proposedTitle(line);
    const authors = proposedAuthors(line);
    if (!title || !authors) return [];
    workId = (await findWorkByKey(env.DB, workKeyFor(title, authors)))?.id ?? null;
  }
  if (workId === null) return [];
  return index.get(workId) ?? [];
}

/**
 * Tier 2 of the bare-series-name rule — review-only, never silent, never a
 * refusal (`catalog-platform/docs/info/matching-thresholds.md` §6).
 *
 * A resolved title that equals a known series name and carries no volume
 * number is the signature of an Open Library record wearing the series name
 * as a title — the shape that minted the phantom *Space Knight* (six scanned
 * volumes absorbed as six editions and six copies of a book that does not
 * exist) on 2026-08-13. It may also, legitimately, be volume 1 or a picture
 * book: 18 of 341 real works are titled exactly this way, which is why this
 * warns on the row instead of refusing the candidate. A person can say
 * "it really is called that" in one tap; a phantom they were never warned
 * about costs an evening of SQL.
 *
 * Applied wherever a line gains a resolution — the barcode ladder, the
 * automatic pass, the manual re-lookup — and only to `found` lines: an
 * `owned` barcode line matched a real edition by identifier, and a typed
 * title is a person asserting, not a database answering.
 */
function warnBareSeries(line: ScanLine, seriesKeys: ReadonlySet<string>): ScanLine {
  if (line.state !== 'found' || !line.resolvedTitle) return line;
  if (!isBareSeriesTitle(line.resolvedTitle, seriesKeys)) return line;
  const warning =
    'That title is a bare series name in this catalog, with no volume number. The database ' +
    'may have answered for the whole series rather than this book — check which volume this ' +
    'is (or that it really is titled with the series name) before adding.';
  return { ...line, detail: line.detail ? `${warning} ${line.detail}` : warning };
}

/** The "we already have this" half of a line, named so both producers share it. */
async function ownedBy(env: Env, workId: number): Promise<Partial<ScanLine>> {
  const work = await getWork(env.DB, workId);
  return {
    state: 'owned' as const,
    existingWorkId: workId,
    existingTitle: work?.title ?? null,
    detail: null,
  };
}

/**
 * Ask Open Library about one line, and answer with the line it becomes.
 *
 * ⚠️ **The one implementation.** The automatic pass and the manual
 * "look it up again" button both call this, and they must, because the whole
 * promise of the automatic pass is that pressing the button afterwards asks the
 * *same question the same way* — only with better words. Two copies of this
 * scoring would mean an automatic answer a person could not reproduce by hand.
 *
 * Pure of the database: it takes a line and gives a line back. The caller
 * decides where that lands, which is what lets the chunked pass merge results
 * into a job that has moved on underneath it.
 */
async function lookupLine(line: ScanLine, query: string): Promise<ScanLine> {
  const corrected = query !== line.text;

  let candidates: BookCandidate[];
  try {
    candidates = await searchOpenLibrary(query, line.author, { userAgent: UA });
  } catch (err) {
    return {
      ...line,
      state: 'error',
      /*
       * ⚠️ `lookedUp` is *not* set here, and that is the difference between the
       * two ways a search can fail to produce a book.
       *
       * "Open Library has nothing" is an **answer**: asking again gets it
       * again, so the automatic pass must not spend another call on it. "Open
       * Library did not answer" is not an answer at all, so the line stays
       * eligible and the next pass — or the Retry button — picks it up.
       */
      detail: `Open Library did not answer: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  /*
   * Pick the best answer, and refuse a bad one.
   *
   * ⚠️ Unlike the barcode path, there is no identifier here — only two strings
   * a model read off a spine. Open Library answers "Firefight" + "Brandon
   * Sanderson" with a *different* 2001 novel called Firefight, at a perfect
   * title score. The author gate is what separates them, and it is a rejection
   * rather than a down-rank: a title match with a contradicting author is a
   * different book, not a worse match.
   *
   * ⚠️ None of this got stricter when the pass became automatic. A weak match
   * is still kept, still scored, and still shown unticked — see `applyCandidate`.
   * Raising the bar here to "protect" an automatic pass would silently drop
   * books that are visibly on the shelf, which is the failure the review screen
   * exists to prevent.
   */
  const scored = candidates
    .map((candidate) => ({
      candidate,
      title: titleSimilarity(normaliseTitle(candidate.title), normaliseTitle(query)),
      author: line.author
        ? titleSimilarity(
            normaliseTitle(primaryAuthor(candidate.authors)),
            normaliseTitle(primaryAuthor(line.author)),
          )
        : null,
    }))
    .filter((s) => s.author === null || s.author >= MIN_AUTHOR_SIMILARITY)
    .sort((a, b) => b.title - a.title);

  const best = scored[0];
  return best
    ? {
        ...applyCandidate(unresolve(line), best.candidate, query),
        relookedUpAs: corrected ? query : null,
      }
    : {
        ...unresolve(line),
        lookedUp: true,
        detail:
          candidates.length > 0
            ? 'Open Library answered, but with a different author. Nothing here matches.'
            : 'Open Library has nothing under that title. About half this library is not in it.',
        relookedUpAs: corrected ? query : null,
      };
}

// ---------------------------------------------------------------------------
// The automatic first pass
// ---------------------------------------------------------------------------

/**
 * Lines looked up in one Worker invocation.
 *
 * The sibling Board Game Catalog derives its chunk from the free plan's
 * 50-subrequest ceiling — `(40 - 5) / 4 = 8` — after three shelves were
 * silently killed by exceeding it. ⚠️ **The arithmetic does not transfer, and
 * copying the number without the reasoning would be luck rather than design.**
 * A line here costs exactly *one* subrequest (a single Open Library search; the
 * ISBN rungs do not run on a spine), plus four fixed reads and writes on the
 * job — so the subrequest ceiling alone would allow thirty-odd.
 *
 * What actually binds is **time**. Every search goes through the queue in
 * `@lc/isbn`'s `throttle.ts`, one at a time, `MIN_GAP_MS` apart, so thirty
 * lines is over half a minute of `waitUntil` for a single pass. Eight is about
 * nine seconds — short enough to be a chunk, long enough to be worth one.
 *
 * Landing on the same 8 as the sibling is a coincidence of two different
 * limits. Do not "unify" the two constants.
 */
const LINES_PER_RUN = 8;

/**
 * How long a pass may be silent before a retry is allowed to replace it.
 *
 * `processed_at` is stamped at the start and end of every chunk, so a pass that
 * is alive is beating. Without this, `enriching` is indistinguishable from a
 * pass whose isolate was torn down, and the job is stuck at "Looking up…"
 * forever with no button that will do anything about it.
 */
const STALE_AFTER_MS = 90_000;

/**
 * D1 hands back `datetime('now')` — `YYYY-MM-DD HH:MM:SS`, UTC, no zone marker.
 * `Date.parse` on that string is implementation-defined and has historically
 * been read as *local* time, which on a machine behind UTC makes every job look
 * stale and on one ahead makes none of them ever stale. Say UTC explicitly.
 */
function sqliteTime(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? null : ms;
}

function isStale(job: ScanJob): boolean {
  const beat = sqliteTime(job.processedAt);
  return beat === null || Date.now() - beat > STALE_AFTER_MS;
}

/**
 * One chunk of the automatic first pass.
 *
 * Runs inside `waitUntil`, so it must never throw and must always leave the job
 * in a status the review screen can act on. It leaves `read` when there is more
 * to do — the status already means "lines exist, not all looked up" — and the
 * screen asks for the next chunk. That is the whole continuation mechanism:
 * no cron, no queue, no new status, no migration.
 */
async function runLookupPass(env: Env, jobId: number): Promise<void> {
  try {
    const job = await getScanJob(env.DB, jobId);
    if (!job || job.status === 'done') return;

    const pending = job.lines.flatMap((line, i) => (needsLookup(line) ? [i] : []));
    if (pending.length === 0) {
      if (job.status !== 'review') await updateScanJob(env.DB, jobId, { status: 'review' });
      return;
    }

    // Heartbeat before the slow part, so a torn-down isolate is detectable.
    await updateScanJob(env.DB, jobId, { status: 'enriching', processed: true });

    /*
     * ⚠️ Eight at once here is *not* eight requests at once.
     *
     * `searchOpenLibrary` funnels every call through the serialising queue in
     * `@lc/isbn/throttle.ts`, so the real upstream concurrency from this
     * invocation is one. `Promise.all` is here to keep the code the shape the
     * sibling settled on, and because the queue — not this line — is the right
     * place for the limit to live.
     */
    const results = await Promise.all(
      pending.slice(0, LINES_PER_RUN).map(async (i) => {
        const before = job.lines[i]!;
        return { i, before, after: await lookupLine(before, before.text) };
      }),
    );

    /*
     * ⚠️ Re-read before writing. This is the one genuinely new hazard the
     * automatic pass introduces.
     *
     * A person is looking at this list *while* the pass runs — that is the
     * point of it being automatic — and every one of their actions is a
     * read-modify-write of the same JSON blob. Writing back the snapshot this
     * pass started from would silently undo an Add or a Not-wanted made in the
     * last nine seconds. So each result is merged into the *current* job, and
     * only onto a line that is still asking the same question.
     */
    const fresh = await getScanJob(env.DB, jobId);
    if (!fresh) return;

    // One read for the whole chunk, and none at all while nobody has recorded a
    // `contains` — see `overlapsFor`. Loaded after the slow part so it reflects a
    // relation added while Open Library was being waited on. The series names
    // ride the same read-once-per-chunk pattern for the same reason.
    const containments = await loadContainmentIndex(env.DB);
    const seriesKeys = foldSeriesNames(await listKnownSeriesNames(env.DB));

    const lines = [...fresh.lines];
    for (const { i, before, after } of results) {
      const current = lines[i];
      if (!current) continue;
      // Moved on without us: added, dismissed, retyped, or already answered by
      // the person pressing the button themselves. Their answer wins.
      if (!needsLookup(current)) continue;
      if (current.text !== before.text || current.author !== before.author) continue;
      lines[i] = warnBareSeries(
        {
          ...after,
          position: current.position,
          overlap: await overlapsFor(env, after, containments),
        },
        seriesKeys,
      );
    }

    const more = hasPendingLookups(lines);
    await updateScanJob(env.DB, jobId, {
      lines,
      // `read` is "paused between chunks", not a failure. `/enrich` already
      // accepts it, so continuing and retrying are the same request.
      status: more ? 'read' : 'review',
      processed: true,
    });
  } catch (err) {
    // A pass that dies must not leave the job pinned at `enriching`, where the
    // screen shows a spinner and the retry button refuses to race it.
    await updateScanJob(env.DB, jobId, {
      status: 'read',
      error: `Lookup pass failed: ${err instanceof Error ? err.message : String(err)}`,
    }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const scanJobRoutes = new Hono<AppBindings>()
  /** The queue: what you left half-finished. */
  .get('/', requireCapability('editCatalog'), async (c) =>
    c.json({ jobs: await listScanJobs(c.env.DB, { open: c.req.query('open') === '1' }) }),
  )

  .get('/:id{[0-9]+}', requireCapability('editCatalog'), async (c) => {
    const job = await getScanJob(c.env.DB, Number(c.req.param('id')));
    return job ? c.json({ job }) : c.json({ error: 'not_found' }, 404);
  })

  /**
   * One scanned barcode, appended to an open sweep.
   *
   * Registered before `/:id/...` and matched as a literal, so a job can never be
   * mistaken for the word "barcode". Nothing is deferred: the whole ladder is
   * fast and free, and the person scanning wants the title back before they put
   * the book down.
   */
  .post('/barcode', requireCapability('scan'), async (c) => {
    const parsed = barcodeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

    // A finished job is never reopened: its outstanding count has been dealt
    // with, and appending would make "all sorted" untrue after the fact.
    let job = parsed.data.jobId ? await getScanJob(c.env.DB, parsed.data.jobId) : null;
    if (job && (job.mode !== 'isbn' || job.status === 'done')) job = null;
    if (!job) {
      job = await createScanJob(c.env.DB, {
        mode: 'isbn',
        createdBy: c.get('user').id,
        // Straight to review: a barcode sweep has no reading step to wait for.
        status: 'review',
      });
    }

    const lines = [...job.lines];
    const code = parsed.data.code.trim();

    /*
     * The same code twice.
     *
     * ⚠️ **A refusal here is an answer to the machine, not to the person**, and
     * conflating the two was the bug. A book left in front of the lens re-locks
     * several times a second, so refusing a code the job already holds is the
     * only thing standing between one book and five queue entries — that part
     * is right and stays. What was wrong is that the refusal was *silent* and
     * *final*: the owner's report is that scanning a genuine second copy of a
     * book already on the sweep "doesn't prompt you, it just rejects the scan".
     * Some books in this house really are owned twice.
     *
     * So the refusal now carries everything needed to ask — `duplicate: true`
     * plus the index and the line it collided with — and `allowDuplicate` is
     * the person's answer coming back. One code is still one line *until
     * somebody says otherwise*.
     *
     * ⚠️ The second copy is **appended**, never inserted. The client patches
     * lines by array offset, so inserting would silently repoint every index
     * after it and confirm the wrong book.
     *
     * The other exception is a line whose lookup never reached a service.
     * Pointing the camera at it again is the obvious way to ask again, so an
     * `error` line re-runs in place instead of answering with the failure it
     * already recorded.
     */
    const already = lines.findIndex((l) => l.code === code);
    const collision = already >= 0 && lines[already]!.state !== 'error';
    if (collision && !parsed.data.allowDuplicate) {
      return c.json({ job, index: already, line: lines[already], duplicate: true });
    }

    // Append for a new code and for an allowed duplicate; re-run in place only
    // for the `error` line the loop above deliberately let through.
    const index = collision || already < 0 ? lines.length : already;

    const resolved = await resolveBarcode(c.env, index + 1, code);
    // ⚠️ After the ladder, not inside it. `resolveBarcode` has six exits — an
    // owned edition, a price add-on, a SKU, an ASIN, a miss, a hit — and only
    // some of them name a work. Asking once, here, is the difference between one
    // rule and six chances to forget it. `warnBareSeries` sits here for the
    // same reason — one rule, applied where the resolution lands.
    lines[index] = warnBareSeries(
      {
        ...resolved,
        overlap: await overlapsFor(c.env, resolved, await loadContainmentIndex(c.env.DB)),
      },
      foldSeriesNames(await listKnownSeriesNames(c.env.DB)),
    );

    const updated = await updateScanJob(c.env.DB, job.id, { lines: renumber(lines), status: 'review' });
    return c.json({ job: updated ?? job, index, line: lines[index], duplicate: false }, 201);
  })

  /**
   * A photograph of a shelf.
   *
   * ⚠️ **The photo is never stored.** It arrives in this request body, goes
   * straight into the vision call, and is gone when this handler returns.
   * There is no R2 binding in `wrangler.toml` and there must not be one.
   *
   * Gated on `runResearch` rather than `scan`, because this is the spend
   * capability and a barcode is free. Both are owner-only today; the gate says
   * which fact it depends on, so widening `scan` later does not quietly widen
   * "may spend money" with it.
   */
  .post('/shelf', requireCapability('runResearch'), (c) => readPhoto(c, 'shelf'))

  /**
   * ONE book, photographed front-on.
   *
   * ⚠️ Same pipeline, different prompt — and the difference earns its keep. A
   * cover prints the series, the volume and often the publisher; a spine prints
   * almost none of them. Those are exactly the discriminators §4.4 says a title
   * and an author cannot substitute for, so a single-cover read arrives with
   * more to match on than a shelf read of the same book.
   *
   * `mode: 'single'` was already legal in migration 0001's CHECK constraint, so
   * this needed no migration — 0001 anticipated it.
   *
   * The photo is never stored here either.
   */
  .post('/single', requireCapability('runResearch'), (c) => readPhoto(c, 'cover'))


  /**
   * Continue — or retry — the automatic first pass.
   *
   * ⚠️ This is the *only* new endpoint the automatic pass needed, and it is
   * both "carry on" and "try that again". One pass does `LINES_PER_RUN` lines
   * and leaves the job at `read`; the review screen sees lines still
   * outstanding and asks for the next chunk. A person pressing Retry sends the
   * identical request.
   *
   * Answering "it is already running" is not an error — it is the honest answer
   * to "please continue" — so it is a 200 with `running: true`, not a 409. The
   * staleness check is what stops that being a way to wedge a job forever: a
   * pass whose isolate died stops stamping `processed_at`, and after
   * `STALE_AFTER_MS` a retry may replace it.
   */
  .post('/:id{[0-9]+}/enrich', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    const job = await getScanJob(c.env.DB, id);
    if (!job) return c.json({ error: 'not_found' }, 404);

    if (job.status === 'done') return c.json({ job, running: false });
    if (job.status === 'enriching' && !isStale(job)) return c.json({ job, running: true });

    if (!hasPendingLookups(job.lines)) {
      // Nothing to do, and saying so by moving the job is better than saying so
      // in a field: a job with no outstanding lookups sitting at `read` would
      // have the screen ask again on every render.
      const settled =
        job.status === 'review' ? job : ((await updateScanJob(c.env.DB, id, { status: 'review' })) ?? job);
      return c.json({ job: settled, running: false });
    }

    c.executionCtx.waitUntil(runLookupPass(c.env, id));
    // The status the job is *about* to have. Returning the stale `read` would
    // have the screen fire a second request on the very next render.
    return c.json({ job: { ...job, status: 'enriching' as const }, running: true });
  })

  /**
   * Ask Open Library about one line — the repair bench.
   *
   * ⚠️ Since the first pass became automatic this is no longer how a line gets
   * looked up; it is how a line gets looked up **again, with better words**.
   * `?q=` is the whole point: the useful search is the one made after a person
   * has looked at "Wintersteei" and corrected it, and that is exactly the
   * search the automatic pass cannot make on its own.
   *
   * Delegates to `lookupLine`, so a hand-made lookup and an automatic one score
   * identically. See its header.
   */
  .post('/:id{[0-9]+}/lines/:index{[0-9]+}/lookup', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    const idx = Number(c.req.param('index'));

    const job = await getScanJob(c.env.DB, id);
    if (!job) return c.json({ error: 'not_found' }, 404);
    const line = job.lines[idx];
    if (!line) return c.json({ error: 'not_found' }, 404);

    const query = (c.req.query('q') ?? line.text).trim();
    if (!query) return c.json(badRequest('nothing to look up'), 400);

    const found = await lookupLine(line, query);
    // A new answer is a new work, so the overlap is re-asked rather than carried
    // over — `unresolve` has already cleared the old one. The bare-series check
    // re-runs too: the corrected query may have resolved to a different record.
    const resolved: ScanLine = warnBareSeries(
      {
        ...found,
        overlap: await overlapsFor(c.env, found, await loadContainmentIndex(c.env.DB)),
      },
      foldSeriesNames(await listKnownSeriesNames(c.env.DB)),
    );
    const lines = [...job.lines];
    lines[idx] = resolved;
    const updated = await updateScanJob(c.env.DB, id, { lines });

    // `error` means the service was unreachable, which is a 502 about *this*
    // request rather than a fact about the book — the line records it either way.
    if (resolved.state === 'error') {
      return c.json({ job: updated ?? job, index: idx, line: resolved, found: false }, 502);
    }
    return c.json({
      job: updated ?? job,
      index: idx,
      line: resolved,
      found: resolved.state === 'found',
    });
  })

  /**
   * Record what happened to one line, without finishing the job.
   *
   * ⚠️ Per line, and the job stays put. The behaviour this replaces — in the
   * sibling project — marked the *whole photo* reviewed as soon as the obvious
   * books were added, and everything not yet dealt with disappeared with it.
   * The good ones were the cheap part; the ones needing a second look were
   * exactly what got thrown away.
   *
   * A `text` or `author` change is a **new question**, so everything the old
   * resolution claimed is cleared. Keeping the cover of the book you just
   * renamed away from is how the wrong cover ends up on the right book.
   */
  .patch('/:id{[0-9]+}/lines/:index{[0-9]+}', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    const idx = Number(c.req.param('index'));

    const parsed = lineUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);

    const job = await getScanJob(c.env.DB, id);
    if (!job) return c.json({ error: 'not_found' }, 404);
    const current = job.lines[idx];
    if (!current) return c.json({ error: 'not_found' }, 404);

    const patch = parsed.data;
    let line: ScanLine = { ...current };

    if (patch.text !== undefined || patch.author !== undefined) {
      line = unresolve(line);
      if (patch.text !== undefined) line.text = patch.text;
      if (patch.author !== undefined) line.author = patch.author;
      line.detail = 'Edited. Look it up again.';
    }
    if (patch.addedWorkId !== undefined) line.addedWorkId = patch.addedWorkId;
    if (patch.dismissed !== undefined) line.dismissed = patch.dismissed;

    const lines = [...job.lines];
    lines[idx] = line;

    const updated = await updateScanJob(c.env.DB, id, { lines });
    return c.json({ job: updated ?? job, index: idx, line });
  })

  /**
   * "I am finished with this sweep."
   *
   * `done`, not deleted: the row is the only record of which photograph produced
   * which books, and of what a shelf read cost. Deleting it to tidy the queue
   * would throw away the only evidence the feature works.
   */
  .post('/:id{[0-9]+}/done', requireCapability('editCatalog'), async (c) => {
    const job = await updateScanJob(c.env.DB, Number(c.req.param('id')), { status: 'done' });
    return job ? c.json({ job }) : c.json({ error: 'not_found' }, 404);
  })

  .delete('/:id{[0-9]+}', requireCapability('editCatalog'), async (c) => {
    const ok = await deleteScanJob(c.env.DB, Number(c.req.param('id')));
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });

/**
 * The shared body of `/shelf` and `/single`.
 *
 * ⚠️ Extracted rather than duplicated. Everything after the vision call is
 * identical for both — create a job, keep the raw reading before anything
 * matched it, match each line against the catalog, hand back proposals. The
 * ONLY difference is which prompt and schema the model was given, and letting
 * that one difference fork a hundred lines is how the two drift apart.
 *
 * `kind` also picks the stored `scan_job.mode`: a cover read is recorded as
 * `'single'`, which migration 0001's CHECK constraint already allowed.
 */
async function readPhoto(c: any, kind: 'shelf' | 'cover') {
  const parsed = photoSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);
  if (tooLarge(parsed.data.data)) {
    return c.json(badRequest('That photo is too large. Downscale it before sending.'), 413);
  }

  const job = await createScanJob(c.env.DB, {
    mode: kind === 'cover' ? 'single' : 'shelf',
    createdBy: c.get('user').id,
    status: 'reading',
  });

  let reading;
  try {
    reading = await readShelf(
      c.env.ANTHROPIC_API_KEY,
      {
        data: parsed.data.data,
        mediaType: parsed.data.mediaType as 'image/jpeg' | 'image/png' | 'image/webp',
      },
      kind,
    );
  } catch (err) {
    const e = err instanceof VisionError ? err : new VisionError(String(err), 502, true);
    // The job is kept, not deleted. It records that a photo was taken and
    // failed, which is the difference between "nothing happened" and "you
    // paid for nothing" — and `error` is the only place that says which.
    await updateScanJob(c.env.DB, job.id, { status: 'failed', error: e.message });
    return c.json({ error: 'vision_failed', detail: e.message, retryable: e.retryable, jobId: job.id }, e.status as 502);
  }

  // Keep exactly what the model said, before anything matched it. This is the
  // only record of what was actually read, and the first thing to look at
  // when a match turns out to be wrong.
  await updateScanJob(c.env.DB, job.id, {
    status: 'read',
    rawTitles: JSON.stringify(reading.books),
    processed: true,
  });

  /*
   * Match against the catalog we already hold.
   *
   * This is the answer that earns the whole screen: re-adding books you own is
   * the obvious failure mode of bulk intake, and it is settled here for free,
   * before anyone is asked to tick anything. Two D1 reads for the whole photo,
   * folded once — see `buildWorkIndex`, which exists so nobody writes a
   * second, faster, subtly different matcher when the loop starts to hurt.
   */
  const [works, aliases, containments, seriesNames] = await Promise.all([
    listWorksForMatching(c.env.DB),
    listWorkAliases(c.env.DB),
    // Third read of the photo's three, and it answers every line at once. A
    // shelf is where the overlap warning earns its keep — twelve books go past
    // and one of them is already inside an omnibus upstairs.
    loadContainmentIndex(c.env.DB),
    // Fourth read: the bare-series-name tier-2 check (see `warnBareSeries`).
    // A spine routinely prints ONLY the series name, so a shelf photo is where
    // a series-titled match is likeliest to be the wrong volume.
    listKnownSeriesNames(c.env.DB),
  ]);
  const index = buildWorkIndex(works, aliases);
  const seriesKeys = foldSeriesNames(seriesNames);

  const lines: ScanLine[] = reading.books.map((book, i) => {
    const line = blankLine(i + 1, 'spine', book.text);
    line.author = book.author;
    line.confidence = book.confidence;
    line.note = book.note;

    const match = matchIndexedWork(index, book.text, book.author);
    if (match) {
      return {
        ...line,
        state: 'owned',
        existingWorkId: match.work.id,
        existingTitle: match.work.title,
        // Free: the matcher has just named the work, so this is a map lookup and
        // not a query. An unmatched spine gets its overlap from the lookup pass,
        // once something has said what the book is.
        overlap: containments.get(match.work.id) ?? [],
        // A title-only match on a spine that showed no author is the shape
        // that files a genuinely new book under "already yours", where it is
        // lost rather than merely wrong. Say so on the row. A spine that read
        // as a bare series name is the other say-so: it matched *a* work
        // carrying that name, but the spine alone cannot say which volume is
        // on the shelf (tier 2 of the bare-series-name rule — review-only).
        detail: isBareSeriesTitle(book.text, seriesKeys)
          ? 'The spine read as a bare series name — this matched one work, but it may be a ' +
            'different volume of the same series. Check this one.'
          : match.authorSimilarity === null && match.via !== 'exact'
            ? 'Matched on the title alone — the spine showed no author. Check this one.'
            : null,
      };
    }

    /*
     * No `detail`, and that is a change: it used to read "Not in the catalog.
     * Look it up, or add it by hand." — an instruction that is now wrong,
     * because the pass below is already looking it up. The next thing written
     * here is the answer, and a placeholder that contradicts the row's own
     * "Looking up…" is worse than a blank.
     */
    return line;
  });

  /*
   * ⚠️ The automatic first pass starts here, and this is the change the owner
   * asked for: "the first pass was always automatic and made for a better
   * experience when adding things to the catalog".
   *
   * `enriching` rather than `read`, even though nothing has run yet. The two
   * statuses differ only in who is expected to act next, and `waitUntil` has
   * already been handed the job — returning `read` would have the review screen
   * see an unstarted job and ask for a chunk that is at this moment starting.
   * One of the two passes would then find nothing to do, but only after paying
   * for a round trip and a D1 read to discover it.
   */
  const pending = hasPendingLookups(lines);
  const updated = await updateScanJob(c.env.DB, job.id, {
    lines,
    status: pending ? 'enriching' : 'review',
    error: reading.unreadable
      ? 'The model could not read that photograph. Try again with more light, or closer.'
      : null,
  });
  if (pending) c.executionCtx.waitUntil(runLookupPass(c.env, job.id));

  return c.json(
    {
      job: updated ?? job,
      unreadable: reading.unreadable,
      // Returned on purpose, and shown. The person spending the money is the
      // person holding the phone, and a cost that lives only in a dashboard
      // is a cost nobody ever sees.
      usage: {
        inputTokens: reading.inputTokens,
        outputTokens: reading.outputTokens,
        estimatedCents: reading.estimatedCents,
      },
    },
    201,
  );
}

