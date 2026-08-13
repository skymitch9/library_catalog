import { Hono } from 'hono';
import {
  COLLECTION_PAGE_SIZE,
  COLLECTION_PAGE_SIZES,
  WISHLIST_STATUSES,
  workKeyFor,
  createCopySchema,
  createEditionSchema,
  createWorkSchema,
  setReadStateSchema,
  updateCopySchema,
  updateEditionSchema,
  updateWorkSchema,
} from '@lc/core';
import {
  collectionFacets,
  collectionStats,
  createCopy,
  createEdition,
  createWork,
  deleteCopy,
  deleteEdition,
  deleteWork,
  findWorkByKey,
  getReadState,
  getWork,
  isCollectionSort,
  listCollection,
  listCopiesForWork,
  listEditionsForWork,
  listWatchesForWork,
  listWishlist,
  setReadState,
  updateCopy,
  updateEdition,
  updateWork,
  type CollectionQuery,
} from '@lc/db';
import { universeFor, universeIndex } from '@lc/universes';
import type { AppBindings } from '../env.js';
import { universeFacet, universeIdsFor } from '../lib/universes.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Read the query string into a `CollectionQuery`.
 *
 * ⚠️ `pageSize` is chosen from a fixed list, not clamped from whatever arrived.
 * `COLLECTION_PAGE_SIZE`'s comment says why the server owns this number: a
 * caller asking for 5,000 is handed the exact payload paging exists to prevent.
 * Offering a *menu* — the audiobook catalog offers 10/20/50/100 — is a different
 * thing from letting the client name a number, and the allowlist is what keeps
 * them different.
 *
 * `readerId` comes from the verified token and never from the query string, so
 * "unread" can only ever mean "unread by whoever is asking".
 */
function collectionQueryFrom(c: {
  req: { query: (k: string) => string | undefined };
}, readerId: number): CollectionQuery {
  const page = Math.max(0, Number(c.req.query('page') ?? '0') || 0);
  const asked = Number(c.req.query('pageSize'));
  const pageSize = COLLECTION_PAGE_SIZES.includes(asked) ? asked : COLLECTION_PAGE_SIZE;
  const sortParam = c.req.query('sort');
  const dir = c.req.query('dir') === 'desc' ? 'desc' : 'asc';

  return {
    q: c.req.query('q'),
    series: c.req.query('series'),
    format: c.req.query('format'),
    // Not validated here: `collectionFilter` looks the value up in a fixed map
    // and adds no clause when it misses, so an unknown medium shows the
    // collection rather than a 400. Same rule the sort allowlist follows.
    medium: c.req.query('medium'),
    // Not validated here either. `KIND_CLAUSE` is a fixed map of literal SQL —
    // `'collectors'` is compared against text written in that file, never
    // against this string — so an unknown value adds no clause and shows the
    // collection. Migration 0050.
    //
    // ⚠️ Named in full here and shortened to `?kind=` in the *address bar*,
    // exactly as `readState` is shortened to `?read=`. The API parameter says
    // which of three format-ish axes it is; the address bar can afford to be
    // terse because `apps/web/src/router.tsx` owns both ends of that name.
    editionKind: c.req.query('editionKind'),
    status: c.req.query('status'),
    // Not validated here either, and for the same reason: `NEEDS_CLAUSE` is a
    // fixed map of literal SQL and an unknown key adds no clause. No caller text
    // reaches the statement.
    needs: c.req.query('needs'),
    readState: c.req.query('readState'),
    readerId,
    sort: isCollectionSort(sortParam) ? sortParam : 'series',
    dir,
    limit: pageSize,
    offset: page * pageSize,
  };
}

/**
 * The catalog: works, their editions, the copies on the shelf, and read-state.
 *
 * Routes are thin — parse, authorise, delegate to `@lc/db`, serialise. Anything
 * that makes a decision belongs in `packages/`, so the CLI can use it too.
 */
export const catalogRoutes = new Hono<AppBindings>()
  .get('/collection', requireCapability('read'), async (c) => {
    const base = collectionQueryFrom(c, c.get('user').id);
    // ⚠️ Resolved before the statement is built, not inside it. A universe is a
    // hand-written list in another repo keyed on series names and exact titles,
    // so there is nothing to put in a WHERE clause until JavaScript has said
    // which rows it means — see `apps/worker/src/lib/universes.ts`. An
    // unrecognised name yields `undefined` and therefore no clause, so a stale
    // link shows the collection rather than a 400, exactly as an unknown sort,
    // medium, printing or needs value already does.
    const query = {
      ...base,
      universeIds: await universeIdsFor(c.env.DB, base, c.req.query('universe')),
    };
    const { rows, total } = await listCollection(c.env.DB, query);
    return c.json({
      rows,
      total,
      page: Math.floor(query.offset / query.limit),
      pageSize: query.limit,
      sort: query.sort,
      dir: query.dir,
    });
  })

  /**
   * What there is to filter by, counted against the filter already applied.
   *
   * Separate from `/collection` rather than folded into it, because the two have
   * different lifetimes: the list changes on every keystroke of a debounced
   * search, and the facets only need to change when a filter does. One response
   * would recompute three GROUP BYs per keystroke to send bytes nothing redrew.
   */
  /**
   * ⚠️ `universes` is added here rather than inside `collectionFacets`, and the
   * seam is deliberate: `@lc/db` does not import `@lc/universes`, which is the
   * one package in this repo that reads another checkout. Keeping the join in
   * the worker is what stops catalog-platform ending up behind every query in
   * the app. The counts drop the universe clause before counting, exactly as
   * the series, media, needs and kind facets drop their own.
   */
  .get('/collection/facets', requireCapability('read'), async (c) => {
    const base = collectionQueryFrom(c, c.get('user').id);
    // ⚠️ Resolved here as well as on `/collection`, and it has to be: every
    // other facet is counted against the filter that is actually applied, so a
    // chosen universe must narrow "Edition (12)" the same way a chosen series
    // does. Without this the list would show six books while the controls above
    // it counted a hundred and sixteen.
    const universeIds = await universeIdsFor(c.env.DB, base, c.req.query('universe'));
    const [facets, universes] = await Promise.all([
      collectionFacets(c.env.DB, { ...base, universeIds }),
      // Its own clause dropped, exactly as `series`, `media`, `needs` and
      // `kinds` drop theirs — `listUniverseKeys` does it — so "CAL Verse (7)"
      // beside a selected "The Cosmere" is what picking it would give you and
      // not the count of the books that are somehow both.
      universeFacet(c.env.DB, base),
    ]);
    return c.json({ ...facets, universes });
  })

  /**
   * Counted live on every request — never a literal written into the UI.
   *
   * ⚠️ **This route used to also run `listSeries` for a `seriesWithGaps` count,
   * and no longer does** — added 2026-08-11, removed 2026-08-12 when the owner
   * removed the chip that read it. Do not restore either half without asking.
   *
   * Worth knowing what it cost, because it was invisible: `listSeries` loads
   * every work, every `series_volume` row, every edition, every copy, every
   * audio rung, every link and every skip in the catalog, then runs
   * `completeness.ts` over all 81 series — to produce one integer, on a screen
   * about the books you *have*. `/stats` is fetched on every visit to the
   * collection page, so that was the most expensive query in the app serving the
   * least-read number on it.
   *
   * ⚠️ The standing decision is not about cost, though: **a gap is answered on
   * the series it belongs to, reached from the book that prompted the
   * question.** A single number cannot say which series, so it could only ever
   * be a button to somewhere else.
   */
  .get('/stats', requireCapability('read'), async (c) =>
    c.json(await collectionStats(c.env.DB, c.get('user').id)),
  )

  /**
   * The wishlist: copies we want and do not hold.
   *
   * ⚠️ A separate route rather than `?status=wanted` on `/collection`, and the
   * grain is the reason. `/collection` filters *works*, so a wanted hardcover of
   * a book we already hold as an EPUB would simply not appear — the work is in
   * the collection, and the wish is invisible. This returns *copies*, which is
   * what a wishlist entry actually is.
   *
   * `status` narrows to one of the two wishlist statuses; absent means both.
   * Anything else is refused rather than silently widened, or the route becomes
   * "list every copy" the first time somebody passes `?status=owned`.
   */
  .get('/wishlist', requireCapability('read'), async (c) => {
    const asked = c.req.query('status');
    if (asked && !(WISHLIST_STATUSES as readonly string[]).includes(asked)) {
      return c.json(
        { error: 'bad_request', detail: `status must be one of ${WISHLIST_STATUSES.join(', ')}` },
        400,
      );
    }
    const statuses = asked ? [asked] : WISHLIST_STATUSES;
    return c.json({ rows: await listWishlist(c.env.DB, statuses), statuses });
  })

  /**
   * "Do we already hold this book?" — asked BEFORE creating a work.
   *
   * ⚠️ This exists because `POST /api/works` deliberately does not dedupe.
   * Migration 0001 says `work_key` is not UNIQUE on purpose: two genuinely
   * different works can fold to one key, and a refused write is a mystery where
   * a duplicate is visible and fixable.
   *
   * That is right for the database and wrong as a default for scanning. The
   * catalog already holds 81 works imported from ebooks, so scanning the
   * paperback of one of them would otherwise produce a second row for the same
   * book — the exact "filed under already-yours, where it is lost" failure the
   * matcher was designed to prevent, arriving through the front door instead.
   *
   * So the client asks first, and a hit becomes "add this edition to the book
   * you already have" rather than a new work. The decision stays with a person;
   * the database keeps its permissive shape.
   */
  .get('/works/match', requireCapability('read'), async (c) => {
    const title = c.req.query('title');
    const authors = c.req.query('authors');
    if (!title || !authors) {
      return c.json({ error: 'bad_request', detail: 'title and authors are required' }, 400);
    }
    const work = await findWorkByKey(c.env.DB, workKeyFor(title, authors));
    return c.json({ work: work ?? null });
  })

  .get('/works/:id', requireCapability('read'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

    const work = await getWork(c.env.DB, id);
    if (!work) return c.json({ error: 'not_found' }, 404);

    const user = c.get('user');
    // Watches ride along rather than being a second request from the page: the
    // panel is above the fold on a book that has one, and a book page that
    // rendered and *then* grew a "check this" note is the one place a late
    // arrival actually misleads. Resolved ones come too — see `listWatchesForWork`.
    const [editions, copies, reading, watches] = await Promise.all([
      listEditionsForWork(c.env.DB, id),
      listCopiesForWork(c.env.DB, id),
      getReadState(c.env.DB, id, user.id),
      listWatchesForWork(c.env.DB, id),
    ]);

    return c.json({
      work,
      editions,
      copies,
      reading,
      watches,
      /**
       * Which shared world this book belongs to — the tier above its series —
       * or null.
       *
       * ⚠️ **null is the ordinary answer and the page must render nothing for
       * it.** Most of this catalog is children's picture books that belong to
       * no universe and are perfectly filed; a badge, a dash or an "unknown"
       * here would turn 90% of the shelf into a worklist. Same reading as a
       * NULL `cover_status` ("nobody looked") and a NULL `edition_kind`
       * ("ordinary").
       *
       * Resolved in memory from the prebuilt index — no query, no I/O. It rides
       * along with the work rather than being a second request because it is a
       * line in the page header, and a header that grew an extra fact after
       * paint is the one place a late arrival misleads. Same argument
       * `watches` makes above.
       */
      universe: universeFor(universeIndex, { title: work.title, series: work.series }),
    });
  })

  .post('/works', requireCapability('editCatalog'), async (c) => {
    const parsed = createWorkSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    return c.json({ work: await createWork(c.env.DB, parsed.data) }, 201);
  })

  /**
   * ⚠️ **`title` and `authors` are refused here, on the server.**
   *
   * They were accepted until 2026-08-13. `updateWorkSchema` is
   * `createWorkSchema.partial()`, so both fields pass validation, and this route
   * added no check of its own — which meant **the only thing protecting the
   * review join was that the web UI's patch object happened not to send them.**
   *
   * That is a convention, not a guard. `WorkFields`' header describes itself as
   * refusing `title`/`authors` because `work_key` is derived from them and is the
   * join to **~870 audiobook reviews** in the sibling catalog; but any other
   * caller — a script, a curl with a token, a future feature written by someone
   * who read the schema rather than that comment — could move the key and orphan
   * every review for that book. Nothing would have reported it.
   *
   * ⚠️ **A refusal, not a silent drop.** Zod's `.strip()` behaviour would have
   * been the tempting fix and is worse: the caller would get HTTP 200 and believe
   * the rename happened. `identity-and-reviews.md` §5 records the review backfill
   * reporting 860/860 matched while writing keys no print edition could meet —
   * the same shape of lie. So this answers 400 and says why.
   *
   * This is deliberately a **dead end rather than a locked door**: renaming a
   * work is a real need (see `docs/info/edit-and-audit-design.md`), and the
   * feature that grants it must arrive with the review-carry ceremony attached.
   *
   * ⚠️ **When it does, REPLACE this block — do not add an endpoint beside it.**
   * The design routes the ceremony through *this same* PATCH, carrying a
   * `keyMove` payload, so this `400 frozen_field` becomes the
   * `409 key_move_requires_check` branch **in place**. An earlier draft of this
   * comment said the feature "opens its own guarded path", which reads as
   * *build a second route* — corrected after review, because two routes able to
   * write `title` would mean two places to keep the review-carry rule, and this
   * file's whole point is that there is one.
   *
   * ⚠️ Do **not** copy this pattern onto `PATCH /editions/:id` for `isbn13`.
   * Measured during review: `Editions.tsx`'s form sends `isbn13`/`isbn10`/`asin`
   * on **every** save, changed or not, so a presence check there would refuse
   * every edition edit in the app. Freezing edition identifiers has to arrive in
   * the same commit that makes that form delta-only. The risk asymmetry allows
   * the wait: a wrong ISBN is one visible, UNIQUE-guarded row, while a moved
   * `work_key` silently orphans ~870 reviews.
   */
  .patch('/works/:id', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

    const body = await c.req.json().catch(() => null);
    // Checked on the RAW body, before Zod, because parsing is where a stripped
    // field would vanish without trace.
    const frozen = ['title', 'authors'].filter(
      (f) => body != null && typeof body === 'object' && f in (body as Record<string, unknown>),
    );
    if (frozen.length > 0) {
      return c.json(
        {
          error: 'frozen_field',
          detail:
            `${frozen.join(' and ')} cannot be changed here: work_key is derived from them ` +
            'and is the join to the audiobook catalog’s reviews, so moving it orphans them. ' +
            'Everything else in this patch was refused too — resend without those fields.',
          fields: frozen,
        },
        400,
      );
    }

    const parsed = updateWorkSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    const work = await updateWork(c.env.DB, id, parsed.data);
    if (!work) return c.json({ error: 'not_found' }, 404);
    return c.json({ work });
  })

  .delete('/works/:id', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);
    const ok = await deleteWork(c.env.DB, id);
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  })

  .post('/editions', requireCapability('editCatalog'), async (c) => {
    const parsed = createEditionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    return c.json({ edition: await createEdition(c.env.DB, parsed.data) }, 201);
  })

  /**
   * Correct a printing — the route a wrongly-filed hardcover needs.
   *
   * ⚠️ This existed as a schema and nothing else. `updateEditionSchema` has been
   * in `@lc/core` since the beginning with no route, no query and no control
   * behind it, so `edition.format` was effectively write-once: a barcode scan
   * writes `paperback` for every book it sees (deliberately — see
   * `addLineToCatalog`) and a hardcover scanned off its own barcode was stuck
   * that way. Reported from the shelf, not from a test.
   *
   * A PATCH like `/copies/:id`, so `{ "format": "hardcover" }` is a complete
   * request that changes one column and leaves the ISBN, the publisher and the
   * provenance where they are.
   */
  .patch('/editions/:id', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

    const parsed = updateEditionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    // `edition.isbn13` and `edition.asin` are UNIQUE partial indexes (migration
    // 0001: "an ISBN-13 identifies one printing by definition"). Typing one that
    // another row already holds is an ordinary mistake at a keyboard, and
    // letting it reach the generic 500 handler answers it with a raw SQLite
    // string. Answered here instead, as the conflict it is.
    let edition;
    try {
      edition = await updateEdition(c.env.DB, id, parsed.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint failed/i.test(message)) {
        return c.json(
          {
            error: 'conflict',
            detail: 'Another edition already has that ISBN or ASIN.',
          },
          409,
        );
      }
      throw err;
    }

    if (!edition) return c.json({ error: 'not_found' }, 404);
    return c.json({ edition });
  })

  /**
   * Remove a printing.
   *
   * Safe for the collection: `copy.edition_id` is `ON DELETE SET NULL`, so a
   * copy on the shelf survives its edition being deleted and merely stops
   * naming which printing it is. See `deleteEdition` in `@lc/db` for the one
   * cascade that is not so gentle.
   */
  .delete('/editions/:id', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);
    const ok = await deleteEdition(c.env.DB, id);
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  })

  .post('/copies', requireCapability('editCatalog'), async (c) => {
    const parsed = createCopySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    return c.json({ copy: await createCopy(c.env.DB, parsed.data) }, 201);
  })

  /**
   * Change a copy — and therefore how a wanted book becomes an owned one.
   *
   * ⚠️ A PATCH, not a PUT, and not a delete-and-recreate. `updateCopy` in
   * `@lc/db` carries the reasoning: the row holds when it was wanted, what was
   * going to be paid and where from, and a promotion must not throw those away.
   * `{ "status": "owned" }` is the whole request the wishlist sends.
   */
  .patch('/copies/:id', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

    const parsed = updateCopySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    const copy = await updateCopy(c.env.DB, id, parsed.data);
    if (!copy) return c.json({ error: 'not_found' }, 404);
    return c.json({ copy });
  })

  .delete('/copies/:id', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);
    const ok = await deleteCopy(c.env.DB, id);
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  })

  /**
   * Read-state is per-person, so a `reader` may write their own and only their
   * own — the user id comes from the verified token, never from the body.
   *
   * There is no rating field here. Ratings go to Firestore through
   * /api/reviews/:workId/draft so one review serves both catalogs.
   */
  .put('/works/:id/reading', requireCapability('trackReading'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

    const parsed = setReadStateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    const user = c.get('user');
    return c.json({ reading: await setReadState(c.env.DB, id, user.id, parsed.data) });
  });
