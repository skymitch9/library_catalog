import { Hono } from 'hono';
import {
  COLLECTION_PAGE_SIZE,
  COLLECTION_PAGE_SIZES,
  UNKNOWN_AUTHOR,
  WISHLIST_STATUSES,
  blankSiblingOf,
  can,
  workKeyFor,
  createCopySchema,
  createEditionSchema,
  createWorkSchema,
  groupDuplicates,
  reviewsSeenSchema,
  setReadStateSchema,
  updateCopySchema,
  updateEditionSchema,
  updateWorkSchema,
} from '@lc/core';
import {
  CopyLinkError,
  collectionFacets,
  collectionStats,
  createCopy,
  createEdition,
  createWork,
  deleteCopy,
  deleteEdition,
  deleteWork,
  evidenceSaysReviews,
  findEditionByIsbn13,
  findWorkByKey,
  getAudiobookHolding,
  deriveAudiobookHoldingFromSeriesLink,
  countAudioEditions,
  listAudioEditions,
  getEbookHolding,
  getCopy,
  getReadState,
  getWork,
  isCollectionSort,
  keyMoveEvidence,
  listChangesForEntity,
  listCollection,
  listCopiesForWork,
  listCopiesLinkedTo,
  listDuplicateCandidates,
  listEditionsForWork,
  listWatchesForWork,
  listWishlist,
  recordReviewsSeen,
  setReadState,
  updateCopy,
  updateEdition,
  updateWork,
  workDeletionReport,
  type Actor,
  type CollectionQuery,
} from '@lc/db';
import { universeFor, universeIndex } from '@lc/universes';
import type { AppBindings } from '../env.js';
import { withCopyPeople } from '../lib/copy-person.js';
import { describeError } from '../lib/describe-error.js';
import { buildWorkDetailResponse } from '../lib/work-detail-response.js';
import { shadowStrictCreate } from '../lib/strict-shadow.js';
import { universeFacet, universeIdsFor } from '../lib/universes.js';
import { capabilityDenied, requireCapability } from '../middleware/auth.js';

/** `copy.status` narrowed to "this is a wishlist row, not a held one." */
function isWishlistStatus(status: string): boolean {
  return (WISHLIST_STATUSES as readonly string[]).includes(status);
}

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
    // `?ebookOnly=hide` — the physical shelf. Not validated here for the same
    // reason as the rest: `EBOOK_ONLY_CLAUSE` is a fixed map of literal SQL and
    // an unknown value adds no clause.
    //
    // ⚠️ Read here rather than defaulted, so **nothing hides by default**. The
    // 94 ebook-only works are real rows that cross-catalog features read; the
    // owner asked for them off the "Recently added" shelf, and the caller that
    // wants that says so. `packages/db/src/works.ts`'s `EBOOK_ONLY_CLAUSE`
    // carries the census and why this is not `medium=physical`.
    ebookOnly: c.req.query('ebookOnly'),
    // The printing half of the consolidated Type control — a comma-separated
    // list since 2026-08-24, split here like `binding` below. Not validated:
    // `KIND_CLAUSE` is a fixed map of literal SQL (`'collectors'` is compared
    // against text written in that file, never against this string), so an
    // unknown value adds no clause and shows the collection. Migration 0050.
    //
    // ⚠️ Named in full here and shortened to `?kind=` in the *address bar*,
    // exactly as `readState` is shortened to `?read=`. `apps/web/src/router.tsx`
    // owns both ends of that name.
    editionKinds: (c.req.query('editionKind') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // The multi-type format selector — a comma-separated list, split here. Not
    // validated: `BINDING_CLAUSE` is a fixed map of literal SQL, so an unknown
    // type contributes no clause. Owner ask 2026-08-24: any of hardcover,
    // leatherbound, paperback, mass_market, ebook, audiobook, individually
    // selectable (leather ⊂ hardcover stays true in the data, but leather is its
    // own selectable type here).
    bindings: (c.req.query('binding') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    status: c.req.query('status'),
    // Not validated here either, and for the same reason: `NEEDS_CLAUSE` is a
    // fixed map of literal SQL and an unknown key adds no clause. No caller text
    // reaches the statement.
    needs: c.req.query('needs'),
    readState: c.req.query('readState'),
    // "Recorded twice" — books owned in 2+ physical copies across editions. A
    // `1`/`0` flag, spelled `?duplicates=1` for backward compatibility with the
    // control it replaced (see `CollectionQuery.ownedTwice`). Any value other
    // than the literal `'1'` reads as off, so a stale or malformed param shows
    // the collection rather than erroring.
    ownedTwice: c.req.query('duplicates') === '1',
    readerId,
    sort: isCollectionSort(sortParam) ? sortParam : 'series',
    dir,
    limit: pageSize,
    offset: page * pageSize,
  };
}

/**
 * "Another printing already carries that ISBN" — as a body the client can act
 * on, not just read.
 *
 * ⚠️ `holder` names the row and its book because the rescan flow's next move
 * depends on it: the person holding a Realmkeeper omnibus whose barcode is
 * already on the volume's OTHER row is offered the slipcase treatment (the
 * fact goes into this row's `edition_name`), and that offer needs the holder's
 * title to be worth anything. `detail` stays a plain sentence because
 * `Editions.tsx`'s error rendering shows string details verbatim.
 *
 * `null` means the ISBN is free (or absent, or already this row's own) and the
 * write may proceed.
 */
async function isbnTakenBody(
  db: D1Database,
  isbn13: string | null,
  selfId?: number,
): Promise<Record<string, unknown> | null> {
  if (!isbn13) return null;
  const holder = await findEditionByIsbn13(db, isbn13);
  if (!holder || holder.id === selfId) return null;
  const work = await getWork(db, holder.work_id);
  const name = holder.edition_name ?? holder.format;
  return {
    error: 'isbn_taken',
    detail:
      `That ISBN is already recorded on ` +
      `${work ? `“${work.title}”` : 'another book'} (${name}).`,
    holder: {
      editionId: holder.id,
      workId: holder.work_id,
      title: work?.title ?? null,
      editionName: holder.edition_name,
      format: holder.format,
    },
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
   * The same WORK recorded twice — books to merge or delete by hand.
   *
   * ## The board-game filter this mirrors, and the one place it could not
   *
   * The owner asked for *"the ability to search a catalog for duplicates with a
   * filter, we have this filter in boardgame catalog so lets mimic it from
   * there instead of redesigning the wheel"*. What was mimicked, exactly:
   *
   * | | Board_Game_Catalog | here |
   * |---|---|---|
   * | address bar | `?duplicates=1`, omitted when off (`apps/web/src/router.tsx:100,118`) | identical (`apps/web/src/router.tsx`) |
   * | control | a checkbox in the filter bar, last before Clear (`CollectionPage.tsx:299`) | identical |
   * | capability | the whole catalog router is `requireCapability('read')` (`routes/catalog.ts:84`) | identical — a reader may see duplicates |
   * | "only one" | never becomes a match at all | identical (`groupDuplicates`) |
   * | predicate | `HAVING SUM(quantity) > 1` — **copies** | **works** — see `@lc/core/duplicates.ts` |
   *
   * ⚠️ The predicate is the deliberate divergence and the owner settled it:
   * *"duplicates = the same WORK recorded twice"*, and two copies of one book
   * is legitimate. `duplicates.ts` carries the full argument.
   *
   * ## Why a route of its own rather than `?duplicates=1` on `/collection`
   *
   * The games filter can be a WHERE clause because its answer is a **list** —
   * the same tree rows, fewer of them. This answer is a list of **groups**: a
   * person merging by hand has to see the two rows *side by side*, and a flat
   * page of works sorted by series would put them anywhere. So the grammar the
   * person types is the games grammar, and the read behind it has the shape of
   * its own answer. Same seam, same reason, as `/collection/facets` above.
   *
   * ⚠️ **There is deliberately no merge action here, and adding one is not a
   * small follow-up.** Merging moves `work_key` — the column the audiobook
   * catalog's reviews join on — which `packages/db/src/works.ts` says may only
   * ever move as a migration with the §5 evidence ceremony. This route hands a
   * person the rows and links to them; the deciding stays with the person.
   */
  .get('/collection/duplicates', requireCapability('read'), async (c) => {
    const { candidates, totalWorks } = await listDuplicateCandidates(c.env.DB);
    return c.json({ groups: groupDuplicates(candidates), totalWorks });
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
    if (!title) {
      return c.json({ error: 'bad_request', detail: 'title is required' }, 400);
    }
    // ⚠️ No authors = "match my authorless add" (migration 0120): the lookup
    // runs against the PROVISIONAL key, so a second deliberate authorless scan
    // of the same title attaches to the existing provisional work instead of
    // minting a sibling. It can never match a real book — the sentinel key
    // equals no key a real author can produce — so the old contract for
    // callers that DO send authors is untouched.
    const work = await findWorkByKey(
      c.env.DB,
      workKeyFor(title, authors || UNKNOWN_AUTHOR),
    );
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
    const [
      editions,
      copies,
      reading,
      watches,
      audiobookHoldingDirect,
      audioEditions,
      audioEditionCount,
      ebookHolding,
    ] =
      await Promise.all([
        listEditionsForWork(c.env.DB, id),
        listCopiesForWork(c.env.DB, id),
        getReadState(c.env.DB, id, user.id),
        listWatchesForWork(c.env.DB, id),
        getAudiobookHolding(c.env.DB, id),
        // ⚠️ Beside `audiobookHolding`, never instead of it. That field reads the
        // `audiobook_holding` VIEW (one whole row per work) and five other
        // callers depend on it; this is the full set behind that view, migration
        // 0390, and the two are ordered identically so they cannot disagree
        // about which edition is the primary one.
        listAudioEditions(c.env.DB, id),
        // ⚠️ NOT `audioEditions.length`, and the difference is deliberate: this
        // counts LIVE editions only, while the list above carries stale ones so
        // the page can caveat them. Owner, 2026-08-23 — *"have it say 2 on the
        // physical and ebook libraries"* — and the 2 he wants is books he owns,
        // not rows on record. `audioEditionCountSql` is the one definition.
        countAudioEditions(c.env.DB, id),
        getEbookHolding(c.env.DB, id),
      ]);

    // ⚠️ The 507/508 fix. `getAudiobookHolding` answers from the per-work
    // `audiobook_holding` VIEW, which the backfill fills by matching TITLES — so
    // a work with a junk/typo title ("Fourth Wing - The Empyrean #1") has no row
    // there and shows no audio, even when the household owns the recording. When
    // that view is empty, derive the holding from the owner-CONFIRMED series link
    // (`audiobook_series_link` + `audiobook_series_holding`), joined on this
    // work's series and volume number — the safe number-line join migration 0090
    // describes, gated on the live confirmation migration 0110 guards. Honest
    // about confidence: `matchedVia = 'series_link'`, no title similarity.
    //
    // ⚠️ Fallback ONLY — the per-work view is the stronger answer when present,
    // and this deliberately does not feed the content-warning key path (which
    // needs the verbatim raw title the series holding does not carry).
    const audiobookHolding =
      audiobookHoldingDirect ??
      (await deriveAudiobookHoldingFromSeriesLink(c.env.DB, work.series, work.seriesIndexSort));

    // Peer holdings: does any connected library hold this same work?
    let peerHoldings: Array<{
      peerId: string;
      peerLabel: string;
      detailUrl: string | null;
      formats: string | null;
    }> = [];
    if (work.workKey) {
      const { results } = await c.env.DB.prepare(
        `SELECT peer_id, peer_label, detail_url, formats
         FROM peer_holding WHERE work_key = ?`
      ).bind(work.workKey).all();
      peerHoldings = (results ?? []).map((r: any) => ({
        peerId: r.peer_id,
        peerLabel: r.peer_label,
        detailUrl: r.detail_url,
        formats: r.formats,
      }));
    }

    // ⚠️ Shaped through the ONE builder, never an inline literal here. The
    // 2026-08-24 outage was a field silently dropped from this object; the
    // builder plus `work-detail-contract.test.ts` make that a red test instead
    // of a blank site. See `lib/work-detail-response.ts` for the whole story.
    //
    // Notes that used to live on the individual keys, kept because they are
    // load-bearing:
    //  · `copies` is redacted HERE, on the way out, by `lib/copy-person.ts` — an
    //    editor sees the borrower's name, the linked person sees their own row,
    //    everyone else gets nulls and keeps the status word. Never filtered in
    //    the query: a reader who may not see the name must still see the copy is
    //    lent, or the book reads as missing rather than out of the house.
    //  · `universe` is null for most books and the page draws nothing for it —
    //    same reading as a NULL `cover_status` ("nobody looked"). Resolved in
    //    memory from the prebuilt index, no query, and rides along because a
    //    header that grew a fact after paint is where a late arrival misleads.
    return c.json(
      buildWorkDetailResponse({
        work,
        editions,
        copies: await withCopyPeople(c.env.DB, copies, user),
        reading,
        watches,
        audiobookHolding,
        audioEditions,
        audioEditionCount,
        ebookHolding,
        peerHoldings,
        universe: universeFor(universeIndex, { title: work.title, series: work.series }),
      }),
    );
  })

  /**
   * ⚠️ Gated on `suggestWishlist`, not `editCatalog` — deliberately the
   * loosest of the two. This route only ever creates a bare `work` row (no
   * edition, no copy); the wishlist "ask for a thing" flow (AddWork.tsx)
   * calls it first and then `POST /copies` with `status: 'wanted'` to say
   * *why*. A member suggesting a book not yet in the catalog needs to be able
   * to create that row, so the floor here has to admit them.
   *
   * This does not widen anyone's real access: `suggestWishlist`'s role set is
   * a superset of `editCatalog`'s (member+ ⊇ contributor+, the ladder is
   * cumulative), so every caller who could reach this route yesterday still
   * can. `POST /copies` right below is where the split actually bites —
   * whether the copy that follows is a wish or a catalog entry decides which
   * capability it checks.
   */
  .post('/works', requireCapability('suggestWishlist'), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createWorkSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    // KI-6 shadow: name any unmodelled key a `.strict()` flip would reject, then
    // proceed and 201 exactly as today. Measures, does not enforce.
    shadowStrictCreate(createWorkSchema, body, 'POST /api/works', 'createWorkSchema');
    // Who added it — the `__row__` creation row in change_log. 'human' because
    // this route is only ever a person's form or a person's scan-review tap;
    // importers go through /api/ingest and scripts write SQL, both 'auto'.
    const actor: Actor = { userId: c.get('user').id, how: 'human' };
    return c.json({ work: await createWork(c.env.DB, parsed.data, actor) }, 201);
  })

  /**
   * ⚠️ **The key-move gate.** This block REPLACED the blanket
   * `400 frozen_field` refusal of `title`/`authors` on 2026-08-13, exactly as
   * that refusal's own comment instructed: the ceremony arrives through THIS
   * route, not beside it — two routes able to write `title` would be two
   * places to keep the review-carry rule.
   *
   * The stakes, unchanged: `work_key` is derived from `title` + `authors` and
   * is the join to **~870 audiobook reviews** in the shared Firestore store.
   * The Worker cannot see Firestore (no service account, deliberately), so it
   * can never verify a review count itself. What it enforces instead
   * (edit-and-audit-design.md §5):
   *
   *  - a patch that would move a **real** key without a `keyMove` attestation
   *    → `409 key_move_requires_check` with `{ oldKey, newKey, evidence }`.
   *    The browser then runs the live Firestore check, restamps the docs
   *    (Firestore FIRST — a half-done move degrades to legacy-query
   *    visibility, not loss), and resends with `keyMove`.
   *  - a stale `expectedOldKey` → `409 stale_key`: two editors collide loudly
   *    rather than interleave silently.
   *  - an attestation whose numbers disagree with themselves → 400.
   *  - `reviewsFound: 0` against contrary D1 evidence (`reviews_seen_*`,
   *    rating rows, a prior carried move) → `409 evidence_mismatch`. The
   *    floor can force the careful path; it can never authorise skipping it.
   *  - clearing `authors` back to null while anything says reviews exist
   *    → `409 reviews_would_detach`: the sentinel may never be carried onto
   *    documents, so there is nothing to carry them to.
   *  - a move FROM a provisional key (authors still null) is **free by
   *    construction** — zero documents can carry a provisional key, so zero
   *    can be orphaned. No ceremony, including fixing a typo'd title. This is
   *    what makes remediation always safe.
   *
   * A retitle that does not move the folded key ("gold" → "Gold") is an
   * ordinary edit: the key is the join, not the spelling.
   *
   * ⚠️ Unknown fields in the body are a 400 from `.strict()`, never a silent
   * strip — with an audit log, a stripped field would manufacture evidence
   * that a save happened while change_log recorded that nothing did.
   *
   * ⚠️ Do **not** copy the old frozen-field pattern onto `PATCH /editions/:id`
   * for `isbn13`. Measured during review: `Editions.tsx`'s form sends
   * `isbn13`/`isbn10`/`asin` on **every** save, changed or not, so a presence
   * check there would refuse every edition edit in the app. Freezing edition
   * identifiers has to arrive in the same commit that makes that form
   * delta-only.
   */
  .patch('/works/:id', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

    const body = await c.req.json().catch(() => null);
    const parsed = updateWorkSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    const { keyMove, ...patch } = parsed.data;

    const current = await getWork(c.env.DB, id);
    if (!current) return c.json({ error: 'not_found' }, 404);

    const actor: Actor = { userId: c.get('user').id, how: 'human' };

    // Would this patch move the key? Derived exactly as `updateWork` derives
    // it — same inputs, same one implementation — so the gate and the write
    // cannot disagree about what is about to happen.
    const nextTitle = patch.title ?? current.title;
    const nextAuthors = patch.authors !== undefined ? patch.authors : current.authors;
    const newKey = workKeyFor(nextTitle, nextAuthors ?? UNKNOWN_AUTHOR);
    const oldKey = current.workKey;

    if (newKey === oldKey) {
      const work = await updateWork(c.env.DB, id, patch, actor);
      if (!work) return c.json({ error: 'not_found' }, 404);
      return c.json({ work });
    }

    // A provisional key (authors never recorded) joins zero review documents
    // BY CONSTRUCTION — `reviewDocFor` refuses the sentinel, so nothing in
    // Firestore can carry it. Filling in the author — remediation, the whole
    // point of "Add without an author" — is therefore always a free move.
    if (current.authors === null) {
      const work = await updateWork(
        c.env.DB,
        id,
        patch,
        actor,
        'moved from provisional key (free by construction)',
      );
      if (!work) return c.json({ error: 'not_found' }, 404);
      return c.json({ work });
    }

    // The old key is real: reviews may follow it. The ceremony applies.
    const evidence = await keyMoveEvidence(c.env.DB, id);

    if (!keyMove) {
      return c.json(
        {
          error: 'key_move_requires_check',
          detail:
            'This edit moves the review join. Run the live review check and resend with keyMove — ' +
            'the server cannot see Firestore and never moves a real key on faith.',
          oldKey,
          newKey,
          evidence,
        },
        409,
      );
    }
    if (keyMove.expectedOldKey !== oldKey) {
      return c.json(
        {
          error: 'stale_key',
          detail:
            'The work’s key changed since you looked — someone else edited this book. ' +
            'Reload and start the edit again.',
          oldKey,
        },
        409,
      );
    }
    if (keyMove.restamped !== keyMove.reviewsFound) {
      return c.json(
        {
          error: 'bad_request',
          detail:
            `keyMove is inconsistent: reviewsFound ${keyMove.reviewsFound} but restamped ` +
            `${keyMove.restamped}. Reviews move with the key, or the key does not move.`,
        },
        400,
      );
    }
    if (keyMove.reviewsFound === 0 && evidenceSaysReviews(evidence)) {
      return c.json(
        {
          error: 'evidence_mismatch',
          detail:
            'The check counted zero reviews, but this database holds evidence some exist — ' +
            'a stale page, a failed read miscoded as zero, or a browser on the wrong lane. ' +
            'Reload the book page and try again.',
          evidence,
        },
        409,
      );
    }
    // Clearing the author back to unknown moves the key TO the provisional
    // sentinel — which no review document may ever carry, so there is nothing
    // to carry the reviews to. Refused whenever anything says reviews exist.
    if (nextAuthors === null && (keyMove.reviewsFound > 0 || evidenceSaysReviews(evidence))) {
      return c.json(
        {
          error: 'reviews_would_detach',
          detail:
            'This book has reviews, and a book with no author cannot hold them — ' +
            'the provisional key is never written onto review documents. Fix the author ' +
            'instead of clearing it.',
          evidence,
        },
        409,
      );
    }

    const work = await updateWork(
      c.env.DB,
      id,
      patch,
      actor,
      // One leg of the evidence floor for the NEXT move: 'reviews restamped: N'
      // with N > 0 is proof reviews existed here once.
      `reviews restamped: ${keyMove.restamped}`,
    );
    if (!work) return c.json({ error: 'not_found' }, 404);
    return c.json({ work });
  })

  /**
   * The browser reporting what its review fetch just returned — the write side
   * of the key-move evidence floor. Piggybacked on the book page's ordinary
   * review load, 'read' capability (design §5.2): it records an observation,
   * grants nothing, and is never authoritative. The server stamps the
   * timestamp so count and time cannot travel apart (0040's pairing rule).
   */
  .post('/works/:id/reviews-seen', requireCapability('read'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

    const parsed = reviewsSeenSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    const ok = await recordReviewsSeen(c.env.DB, id, parsed.data.count);
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  })

  /**
   * The Changes panel — who changed what, when, and what it said before.
   * Read-only and 'read'-capability: it is a household, and the log is written
   * by no one directly (`change_log` has no write route; rows land only in the
   * same batch as the mutation they describe).
   */
  .get('/works/:id/changes', requireCapability('read'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);
    return c.json({ changes: await listChangesForEntity(c.env.DB, 'work', id) });
  })

  /**
   * What deleting this work would destroy — read BEFORE the button renders.
   *
   * The dialog shows this; the DELETE below recomputes it rather than
   * trusting the client's copy. `editCatalog` and not `read`, because the
   * only consumer is the delete surface and a reader has no button to feed.
   */
  .get('/works/:id/deletion', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);
    const report = await workDeletionReport(c.env.DB, id);
    if (!report) return c.json({ error: 'not_found' }, 404);
    return c.json({ report });
  })

  /**
   * Delete a work — with a hard stop, not a warning, when copies record
   * property.
   *
   * ⚠️ **The refusal is absolute: there is no force flag.** Work #139 is the
   * lesson — two edition rows looked like duplicates and the two copies under
   * them were real books the owner owns. A duplicate edition and a duplicate
   * copy are different bugs. To delete a work whose copies block, the copies
   * must be removed one at a time through their own route (each removal logs
   * the whole row), so a person has looked at every object the record claims
   * before the record disappears. `copyBlocksDeletion` in `@lc/core` is the
   * rule; only plain wishes pass.
   *
   * Recomputed here, never taken from the client: the report a person saw and
   * the state this acts on can drift in the seconds between.
   *
   * What a permitted delete does: the whole-row `__row__` audit entry for the
   * work AND one for every edition and copy the cascade takes — the undo
   * material, all under one batch_id. Reviews in Firestore are untouched;
   * they are keyed by title+author and reattach if the book is re-added.
   */
  .delete('/works/:id', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

    const report = await workDeletionReport(c.env.DB, id);
    if (!report) return c.json({ error: 'not_found' }, 404);
    if (report.blockers.length > 0) {
      const n = report.blockers.length;
      return c.json(
        {
          error: 'copies_block_deletion',
          detail:
            `${n === 1 ? 'A copy' : `${n} copies`} of this book record${n === 1 ? 's' : ''} real ` +
            'property (owned, lent, pre-ordered, borrowed, sold, or signed). Deleting the record ' +
            'would destroy that. If this book is a duplicate, its copies belong on the right ' +
            'record; otherwise remove each copy from the Copies panel first — every removal is ' +
            'logged whole-row.',
          report,
        },
        409,
      );
    }

    const ok = await deleteWork(c.env.DB, id, { userId: c.get('user').id, how: 'human' });
    return ok ? c.json({ ok: true, report }) : c.json({ error: 'not_found' }, 404);
  })

  .post('/editions', requireCapability('editCatalog'), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createEditionSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    // KI-6 shadow — see POST /works. Measures a strict flip's would-rejects.
    shadowStrictCreate(createEditionSchema, body, 'POST /api/editions', 'createEditionSchema');

    // ⚠️ Asked BEFORE the insert, so the answer can NAME the holder. The
    // UNIQUE index (`idx_edition_isbn13`, catalog-wide) would refuse this
    // anyway, but its raw error cannot say which printing already carries the
    // ISBN — and the rescan flow needs the holder to offer the slipcase
    // treatment instead of a dead end. The Realmkeeper set is the live case:
    // 16 edition rows describe 8 physical omnibus volumes, so a volume's
    // barcode can only ever live on one of its two rows.
    const taken = await isbnTakenBody(c.env.DB, parsed.data.isbn13 ?? null);
    if (taken) return c.json(taken, 409);

    // ⚠️ The blank-sibling refusal — the last silent minting point for #139's
    // residue shape. A second edition of a format already on file must carry
    // SOMETHING that tells it apart (a name, an identifier, a publisher —
    // `blankSiblingOf` lists the marks); a row carrying nothing is not a
    // different printing being recorded, it is a duplicate being minted. The
    // importer path has `findEditionBySourceUrl` and the scan path has the
    // rescan question; this covers the raw POST, which the manual picker now
    // uses. Same body convention as `isbn_taken`: the holder is named so the
    // client can say which row this cannot be told apart from.
    const twin = blankSiblingOf(
      await listEditionsForWork(c.env.DB, parsed.data.workId),
      parsed.data,
    );
    if (twin) {
      return c.json(
        {
          error: 'indistinguishable_printing',
          detail:
            `A ${twin.format} of this book is already on file` +
            `${twin.edition_name ? ` (“${twin.edition_name}”)` : ''}, and this new one carries ` +
            'nothing to tell it apart. Give it an edition name — or an identifier, publisher ' +
            'or year — that says what makes it different.',
          holder: {
            editionId: twin.id,
            format: twin.format,
            editionName: twin.edition_name,
          },
        },
        409,
      );
    }

    const actor: Actor = { userId: c.get('user').id, how: 'human' };
    return c.json({ edition: await createEdition(c.env.DB, parsed.data, actor) }, 201);
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

    // ⚠️ The ISBN conflict is answered by name, before the write, with the
    // holding printing attached — see the POST above for why the raw UNIQUE
    // refusal is not enough. `id` is excluded so re-saving a row's own ISBN
    // (which `Editions.tsx` does on every save) stays a no-op, not a conflict.
    const taken = await isbnTakenBody(c.env.DB, parsed.data.isbn13 ?? null, id);
    if (taken) return c.json(taken, 409);

    const actor: Actor = { userId: c.get('user').id, how: 'human' };

    // `edition.isbn13` and `edition.asin` are UNIQUE partial indexes (migration
    // 0001: "an ISBN-13 identifies one printing by definition"). The pre-check
    // above names an ISBN conflict; this catch stays for the ASIN column and
    // for the race the pre-check cannot close. Typing one that another row
    // already holds is an ordinary mistake at a keyboard, and letting it reach
    // the generic 500 handler answers it with a raw SQLite string.
    let edition;
    try {
      edition = await updateEdition(c.env.DB, id, parsed.data, actor);
    } catch (err) {
      // ⚠️ `describeError`, not `String(err)`. This string is MATCHED, not just
      // shown: a D1 failure that arrives as a plain object stringifies to
      // `[object Object]`, the regex below misses, and an ordinary duplicate
      // ISBN falls through to the generic 500 with a raw SQLite string.
      const message = describeError(err);
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
    const ok = await deleteEdition(c.env.DB, id, { userId: c.get('user').id, how: 'human' });
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  })

  /**
   * ⚠️ Wishlist split #1, the create side. `POST /copies` is how BOTH a
   * catalog acquisition ("I bought this, add it to the shelf") and a wishlist
   * ask ("I want this") land — the same route, distinguished only by
   * `status`. `createCopySchema` defaults `status` to `'owned'`, so an absent
   * status is always the catalog case.
   *
   * Gated on `suggestWishlist` as the floor (member+, so a guest is refused
   * before the body is even read) and upgraded to `editCatalog` inline once
   * the body says this is not a wishlist ask — `editCatalog`'s role set is a
   * SUBSET of `suggestWishlist`'s (contributor+ ⊆ member+), so this can only
   * ever narrow access for a non-wishlist create, never widen it.
   */
  .post('/copies', requireCapability('suggestWishlist'), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createCopySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    // KI-6 shadow — see POST /works. The person fields (person_name snake_case)
    // are the measured KI-6 case; this is what would count them.
    shadowStrictCreate(createCopySchema, body, 'POST /api/copies', 'createCopySchema');

    const user = c.get('user');
    const required = isWishlistStatus(parsed.data.status) ? 'suggestWishlist' : 'editCatalog';
    if (!can(user.role, required)) return capabilityDenied(c, required, user.role);

    const actor: Actor = { userId: user.id, how: 'human' };
    // `CopyLinkError`: an `editionId` naming another book's printing is a false
    // statement refused in `@lc/db`, not stored — the accessories rule, one
    // table over. Mapped here exactly as `AccessoryError` is in its routes.
    try {
      const created = await createCopy(c.env.DB, parsed.data, actor);
      // Through the same rule as every other read, even though this caller just
      // wrote the row: one door, one redaction. `CopyLinkError` also covers the
      // two person refusals (a name on an `owned` copy, an id naming nobody) —
      // both already worded by `@lc/db` and relayed below.
      const [copy] = await withCopyPeople(c.env.DB, [created], user);
      return c.json({ copy }, 201);
    } catch (err) {
      if (err instanceof CopyLinkError) {
        return c.json({ error: 'bad_request', detail: err.message }, err.status);
      }
      throw err;
    }
  })

  /**
   * Change a copy — and therefore how a wanted book becomes an owned one.
   *
   * ⚠️ A PATCH, not a PUT, and not a delete-and-recreate. `updateCopy` in
   * `@lc/db` carries the reasoning: the row holds when it was wanted, what was
   * going to be paid and where from, and a promotion must not throw those away.
   * `{ "status": "owned" }` is the whole request the wishlist sends.
   *
   * ⚠️ Wishlist split #1, the curate side. Editing, prioritising or promoting
   * an EXISTING copy — wishlist or not — is `manageWishlist` / `editCatalog`,
   * never the looser `suggestWishlist`: asking is member+, but touching a row
   * that already exists (even your own ask) is contributor+. The two
   * capabilities happen to share the same role set today (contributor+), so
   * this branch cannot change who is let in — it exists so the capability
   * NAMED in a 403 (and in `capabilitiesFor` for the UI) is the one that
   * actually describes the row, and so the two stay correctly wired if they
   * are ever tuned apart.
   */
  .patch('/copies/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

    const parsed = updateCopySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    const existing = await getCopy(c.env.DB, id);
    if (!existing) return c.json({ error: 'not_found' }, 404);

    const user = c.get('user');
    const nextStatus = parsed.data.status ?? existing.status;
    const touchesWishlist = isWishlistStatus(existing.status) || isWishlistStatus(nextStatus);
    const required = touchesWishlist ? 'manageWishlist' : 'editCatalog';
    if (!can(user.role, required)) return capabilityDenied(c, required, user.role);

    // See POST /copies: a cross-work `editionId` is refused, never stored.
    let copy;
    try {
      copy = await updateCopy(c.env.DB, id, parsed.data, { userId: user.id, how: 'human' });
    } catch (err) {
      if (err instanceof CopyLinkError) {
        return c.json({ error: 'bad_request', detail: err.message }, err.status);
      }
      throw err;
    }
    if (!copy) return c.json({ error: 'not_found' }, 404);
    const [visible] = await withCopyPeople(c.env.DB, [copy], user);
    return c.json({ copy: visible });
  })

  /**
   * "Books with you" — every copy of this house's that is linked to the person
   * asking, from their own page.
   *
   * ⚠️ **The id comes from the verified token and there is no parameter**, so
   * this route cannot be pointed at anybody else. That is what makes it safe at
   * `read` rather than at `editCatalog`: it is not a lending register, it is a
   * person's own row, and decision #2 says the linked member sees it.
   *
   * ⚠️ It deliberately does NOT resolve or return `person_name` — the reader
   * already knows who they are, and the only person named in the answer would
   * be themselves. Nothing about any OTHER borrower can reach this response.
   */
  .get('/copies/with-me', requireCapability('read'), async (c) =>
    c.json({ copies: await listCopiesLinkedTo(c.env.DB, c.get('user').id) }),
  )

  /** Wishlist split #1, the curate side again — see PATCH /copies/:id above. */
  .delete('/copies/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'bad_request' }, 400);

    const existing = await getCopy(c.env.DB, id);
    if (!existing) return c.json({ error: 'not_found' }, 404);

    const user = c.get('user');
    const required = isWishlistStatus(existing.status) ? 'manageWishlist' : 'editCatalog';
    if (!can(user.role, required)) return capabilityDenied(c, required, user.role);

    const ok = await deleteCopy(c.env.DB, id, { userId: user.id, how: 'human' });
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
