import { Hono } from 'hono';
import { z } from 'zod';
import {
  MIN_AUTHOR_SIMILARITY,
  blankLine,
  buildWorkIndex,
  classifyScannedCode,
  matchIndexedWork,
  normaliseTitle,
  primaryAuthor,
  titleSimilarity,
  type ScanLine,
} from '@lc/core';
import {
  createScanJob,
  deleteScanJob,
  findEditionByAsin,
  findEditionByIsbn13,
  getScanJob,
  getWork,
  listScanJobs,
  listWorkAliases,
  listWorksForMatching,
  updateScanJob,
} from '@lc/db';
import { resolveIsbn, searchOpenLibrary, type BookCandidate } from '@lc/isbn';
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
 * ## Why lookups are per line and driven by the client
 *
 * The sibling Board Game Catalog enriches a whole photo server-side, in chunks,
 * behind `waitUntil`, with staleness detection and a resume path — machinery it
 * grew after three shelves silently died against the 50-subrequest-per-
 * invocation ceiling. This deliberately does not copy that, for two reasons
 * specific to books:
 *
 *  1. **Half this library is not in Open Library** (measured: 14 of 30). Firing
 *     fifteen searches to have most of them answer nothing, or answer with a
 *     different book that shares a word, spends the budget to make the review
 *     list *worse*.
 *  2. **The spine text is often wrong**, so the useful lookup is the one made
 *     after a person has corrected it. `POST /:id/lines/:i/lookup` takes an
 *     optional `q`, which is exactly that.
 *
 * So a photograph gets vision plus the local catalog match — free, instant, and
 * the answer that actually prevents duplicates — and every external search is a
 * separate request the client makes one line at a time. No chunking, no
 * heartbeat, no stale-job recovery, and no ceiling to hit: every line is
 * written when it lands, so an interrupted sweep resumes exactly where it was.
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

/** Clear every field a previous resolution wrote. Used when the question changes. */
function unresolve(line: ScanLine): ScanLine {
  return {
    ...line,
    state: 'not_found',
    detail: null,
    existingWorkId: null,
    existingTitle: null,
    isbn13: null,
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

  if (classified.kind === 'ignore') {
    return {
      ...line,
      code: classified.raw,
      state: 'skipped',
      detail:
        classified.reason === 'price_addon'
          ? 'That is the five-digit price code printed beside the barcode. Use the longer one.'
          : 'Not a book barcode. Books start 978 or 979.',
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

  const { candidates } = await resolveIsbn(classified.isbn13, {
    googleBooksKey: env.GOOGLE_BOOKS_API_KEY,
    userAgent: UA,
  });
  const best = candidates[0];
  if (!best) {
    return {
      ...withCode,
      state: 'not_found',
      detail: 'Not in Open Library. About half this library is not — add it by hand.',
    };
  }
  // Searched by ISBN, so there is nothing to score a title against: the code is
  // the identity claim. `similarity` stays null rather than being invented.
  return { ...applyCandidate(withCode, best, best.title), similarity: null, isbn13: classified.isbn13 };
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
     * The client already refuses to re-submit a code it accepted this session,
     * but a book left in front of the lens is the single most likely way this
     * feature turns one book into five queue entries — so the server refuses
     * too. One code is one line, whatever arrives.
     *
     * The exception is a line whose lookup never reached a service. Pointing the
     * camera at it again is the obvious way to ask again, so an `error` line
     * re-runs in place instead of answering with the failure it already recorded.
     */
    const already = lines.findIndex((l) => l.code === code);
    if (already >= 0 && lines[already]!.state !== 'error') {
      return c.json({ job, index: already, line: lines[already], duplicate: true });
    }

    const index = already >= 0 ? already : lines.length;
    lines[index] = await resolveBarcode(c.env, index + 1, code);

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
  .post('/shelf', requireCapability('runResearch'), async (c) => {
    const parsed = photoSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(badRequest(parsed.error.issues), 400);
    if (tooLarge(parsed.data.data)) {
      return c.json(badRequest('That photo is too large. Downscale it before sending.'), 413);
    }

    const job = await createScanJob(c.env.DB, {
      mode: 'shelf',
      createdBy: c.get('user').id,
      status: 'reading',
    });

    let reading;
    try {
      reading = await readShelf(c.env.ANTHROPIC_API_KEY, {
        data: parsed.data.data,
        mediaType: parsed.data.mediaType as 'image/jpeg' | 'image/png' | 'image/webp',
      });
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
    const [works, aliases] = await Promise.all([
      listWorksForMatching(c.env.DB),
      listWorkAliases(c.env.DB),
    ]);
    const index = buildWorkIndex(works, aliases);

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
          // A title-only match on a spine that showed no author is the shape
          // that files a genuinely new book under "already yours", where it is
          // lost rather than merely wrong. Say so on the row.
          detail:
            match.authorSimilarity === null && match.via !== 'exact'
              ? 'Matched on the title alone — the spine showed no author. Check this one.'
              : null,
        };
      }

      return {
        ...line,
        detail: 'Not in the catalog. Look it up, or add it by hand.',
      };
    });

    const updated = await updateScanJob(c.env.DB, job.id, {
      lines,
      status: 'review',
      error: reading.unreadable
        ? 'The model could not read that photograph. Try again with more light, or closer.'
        : null,
    });

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
  })

  /**
   * Ask Open Library about one line.
   *
   * `?q=` is the whole point: the useful search is the one made *after* a person
   * has looked at "Wintersteei" and corrected it. Re-asking with the same misread
   * is theatre, and re-asking about fifteen lines nobody has read is how the
   * review list fills up with confidently wrong covers.
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

    let candidates: BookCandidate[] = [];
    try {
      candidates = await searchOpenLibrary(query, line.author, { userAgent: UA });
    } catch (err) {
      const lines = [...job.lines];
      lines[idx] = {
        ...line,
        state: 'error',
        detail: `Open Library did not answer: ${err instanceof Error ? err.message : String(err)}`,
      };
      const updated = await updateScanJob(c.env.DB, id, { lines });
      return c.json({ job: updated ?? job, index: idx, line: lines[idx] }, 502);
    }

    /*
     * Pick the best answer, and refuse a bad one.
     *
     * ⚠️ Unlike the barcode path, there is no identifier here — only two
     * strings a model read off a spine. Open Library answers "Firefight" +
     * "Brandon Sanderson" with a *different* 2001 novel called Firefight, at
     * a perfect title score. The author gate is what separates them, and it
     * is a rejection rather than a down-rank: a title match with a
     * contradicting author is a different book, not a worse match.
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
    const lines = [...job.lines];
    const corrected = query !== line.text;

    lines[idx] = best
      ? {
          ...applyCandidate(unresolve(line), best.candidate, query),
          relookedUpAs: corrected ? query : null,
        }
      : {
          ...unresolve(line),
          detail:
            candidates.length > 0
              ? 'Open Library answered, but with a different author. Nothing here matches.'
              : 'Open Library has nothing under that title. About half this library is not in it.',
          relookedUpAs: corrected ? query : null,
        };

    const updated = await updateScanJob(c.env.DB, id, { lines });
    return c.json({ job: updated ?? job, index: idx, line: lines[idx], found: Boolean(best) });
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
