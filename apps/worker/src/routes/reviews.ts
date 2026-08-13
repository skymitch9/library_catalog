import { Hono } from 'hono';
import {
  observedRatingSchema,
  observedRatingsSchema,
  reviewDocFor,
  submitReviewSchema,
  workKeyFor,
} from '@lc/core';
import { applyObservedRating, applyObservedRatings, cacheRating, getWork } from '@lc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Which collection this deployment reads and writes, mirroring `col()` in
 * `audiobook_catalog/site/fb-env.js`.
 *
 * ⚠️ One function rather than the four copies of the ternary this file grew. A
 * dev deployment must never write into the collection the live site reads, and
 * getting it wrong is silent in both directions — so it is worth there being
 * exactly one place that can be wrong.
 */
const reviewCollection = (env: { ENVIRONMENT?: string }) =>
  env.ENVIRONMENT === 'production' ? 'reviews' : 'reviews_dev';

/**
 * The review bridge, server side.
 *
 * ## ⚠️ This route does not write the review
 *
 * It builds the document and hands it back; the **browser** writes it to
 * Firestore with the signed-in user's own credentials. That looks like a
 * detour, so here is why it is the right one:
 *
 * 1. Writing from the Worker needs a Firebase **service account** — a private
 *    key held as a Worker secret, minting its own access tokens. That key
 *    bypasses `firestore.rules` entirely. Introducing one to write a star
 *    rating puts the most powerful credential in the household behind the least
 *    important endpoint.
 * 2. The audiobook site already writes these documents from the browser, under
 *    the same rules, to the same collection. Matching it means one write path
 *    and one set of rules to reason about, not two that must agree.
 * 3. `validReview()` in `firestore.rules` accepts these documents **unchanged** —
 *    it asserts only `displayName is string` and a rating in 0.5…5, and ignores
 *    the extra fields. Verified against the live rules 2026-08-09. So no rules
 *    deploy is needed to start writing `workKey`, which matters: a rules deploy
 *    is a change to the audiobook site's security posture, and this feature does
 *    not need one.
 *
 * What the server *is* for: deriving the key. `workKey` must be computed by the
 * one implementation in `@lc/core`, and the document id must be built with the
 * audiobook site's own `bookIdFromTitle`, or the write lands beside the existing
 * review instead of on it. Neither belongs in hand-written client code.
 */
export const reviewRoutes = new Hono<AppBindings>()
  /**
   * Everything the browser needs to write one review: the collection, the
   * document id, and the payload.
   */
  .post('/:workId/draft', requireCapability('trackReading'), async (c) => {
    const workId = Number(c.req.param('workId'));
    if (!Number.isInteger(workId)) return c.json({ error: 'bad_request' }, 400);

    const body = await c.req.json().catch(() => null);
    const parsed = submitReviewSchema.safeParse({ ...(body ?? {}), workId });
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    const work = await getWork(c.env.DB, workId);
    if (!work) return c.json({ error: 'not_found' }, 404);

    // ⚠️ Guard 1 of the design's §3.4. `reviewDocFor` throws on the sentinel, but
    // a thrown error here would surface as a 500 and read as a broken site. The
    // friendly refusal comes first and says WHY, because the reason is the whole
    // point: a review written now would carry the provisional key and come loose
    // from this book the moment the author arrives.
    if (work.authors === null) {
      return c.json(
        {
          error: 'author_required',
          detail: 'Add the author first — a review written now would come loose when it arrives.',
        },
        409,
      );
    }

    const user = c.get('user');
    const displayName = user.reviewName ?? user.displayName ?? user.email;

    const { id, doc } = reviewDocFor({
      title: work.title,
      authors: work.authors,
      displayName,
      email: user.email,
      rating: parsed.data.rating,
      text: parsed.data.text,
      editionLabel: parsed.data.editionLabel ?? null,
    });

    // Cache it for sorting before the browser has even written. If the Firestore
    // write then fails the cache is wrong until the next sync — acceptable,
    // because this value is never presented as authoritative and the collection
    // page is the only thing that reads it.
    await cacheRating(c.env.DB, workId, user.id, parsed.data.rating);

    return c.json({ collection: reviewCollection(c.env), docId: id, doc });
  })

  /**
   * Which collection to read, for a caller that is not looking at one book.
   *
   * The per-book endpoints answer this as part of their reply, which is enough
   * for `Reviews.tsx`. The whole-library sweep has no `workId` to ask about and
   * must not guess the lane — a dev browser reading `reviews` would derive read
   * states in the dev database from the live site's ratings, which looks exactly
   * like the feature working.
   */
  .get('/collection', requireCapability('read'), (c) =>
    c.json({ collection: reviewCollection(c.env) }),
  )

  /**
   * The `workKey` for a work, so the browser can query Firestore for every
   * review of it — including the audiobook one written on the other site.
   *
   * Returns the audiobook site's `bookId` too, because reviews written before
   * the backfill have no `workKey` and can only be found by that key. Drop the
   * second query once the backfill has run everywhere and the count is stable;
   * until then, asking both is the difference between showing a review and
   * appearing to have lost it.
   */
  .get('/:workId/keys', requireCapability('read'), async (c) => {
    const workId = Number(c.req.param('workId'));
    if (!Number.isInteger(workId)) return c.json({ error: 'bad_request' }, 400);

    const work = await getWork(c.env.DB, workId);
    if (!work) return c.json({ error: 'not_found' }, 404);

    // ⚠️ Guard 2 of the design's §3.4, and the dangerous half of it. Suppressing
    // the `workKey` query is merely tidy — no Firestore document can carry the
    // sentinel, because `reviewDocFor` refuses to write one, so that query would
    // just match nothing. `legacyBookId` is the risk: it is derived from the
    // TITLE ALONE, so for a book with no author it can surface A STRANGER'S
    // reviews of a different book with the same name. "Two books called Gold" is
    // the exact case migration 0001 warns about, and with no author recorded
    // there is nothing left to disambiguate them with.
    //
    // Answered as a held STATE rather than an error, because the book page still
    // has to render, and "held" is a true thing to say about this book. The cost
    // — a real audiobook review staying invisible until the author is filled in
    // — is accepted deliberately and stated in the design's §8.
    if (work.authors === null) {
      return c.json({
        collection: reviewCollection(c.env),
        workKey: null,
        legacyBookId: null,
        held: 'Reviews are held until the author is known.',
      });
    }

    const { doc } = reviewDocFor({
      title: work.title,
      authors: work.authors,
      displayName: 'x',
      rating: 5,
      text: '',
    });

    return c.json({
      collection: reviewCollection(c.env),
      workKey: workKeyFor(work.title, work.authors),
      legacyBookId: doc.bookId,
    });
  })

  /**
   * "I have just read my own rating out of Firestore. Derive what follows."
   *
   * The owner's ask: *"if a book has a rating from the audiobook library mark it
   * as read"* — *"so if its a rating i left mark it read for me"*.
   *
   * ## ⚠️ Why the derivation happens here and not in `/draft`
   *
   * `/draft` is asked for a document **before** the browser writes it. Its
   * `cacheRating` call knowingly accepts being wrong if that write then fails,
   * and can afford to: nothing presents that number as authoritative and the
   * only reader is a sort. A read state cannot afford it. It is shown to the
   * person as a fact about their own life, and deriving one from a review that
   * never landed is a visible lie rather than a stale cache.
   *
   * So this endpoint takes only **observed** ratings — read back out of
   * Firestore after the fact — and it is called from exactly one place,
   * `Reviews.tsx`'s `load()`, which runs on page open and again after a
   * successful write.
   *
   * ## ⚠️ And why it has to exist at all
   *
   * The Worker cannot see Firestore; there is no service account anywhere in
   * this project and the long note at the head of this file is why. The browser
   * is the only thing in the estate that sees both stores. That makes this
   * endpoint the *only* path by which a review written on the **audiobook
   * site** — which is where nearly all of them are written, the owner reads far
   * more audiobooks than physical books — can ever reach this database. The
   * alternative designs were a cron (there is none, deliberately) and reading
   * `rating_cached` back (forbidden, and it would only ever see what this app
   * had already written).
   *
   * ## Whose rating
   *
   * The caller must have decided the review is theirs before posting it, using
   * `isMyReview` from `@lc/core` — the one implementation, shared with the
   * backfill. Other people in the household review into the same collection, and
   * the whole point of the refinement is that their ratings mark *their* books
   * read, not the caller's.
   *
   * ⚠️ This grants no authority the caller did not already have. It writes only
   * to `user_book` rows for `user.id`, taken from the verified token and never
   * from the request, and the same capability already permits
   * `PUT /works/:id/reading` to set 'read' outright.
   */
  .post('/:workId/observed', requireCapability('trackReading'), async (c) => {
    const workId = Number(c.req.param('workId'));
    if (!Number.isInteger(workId)) return c.json({ error: 'bad_request' }, 400);

    const body = await c.req.json().catch(() => null);
    const parsed = observedRatingSchema.safeParse(body ?? {});
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    const work = await getWork(c.env.DB, workId);
    if (!work) return c.json({ error: 'not_found' }, 404);

    const user = c.get('user');
    // ⚠️ By `work_key`, not by `workId`. That is the "all three copies" half of
    // the ask: a book scanned in twice under two spellings is two `work` rows
    // sharing one key, and one rating is honestly about both. See
    // `applyObservedRating` for why this is not, and must not become, duplicate
    // detection.
    const marked = await applyObservedRating(c.env.DB, work.workKey, user.id, {
      rating: parsed.data.rating,
      source: parsed.data.source ?? null,
    });

    // `marked: []` is the ordinary answer on every page view after the first.
    // The client uses it to decide whether to reload, so a second call costing
    // nothing is what keeps this off the critical path.
    return c.json({ marked });
  })

  /**
   * The same thing for every rating this person has ever written — the sweep.
   *
   * ## Why this exists on top of `/:workId/observed`
   *
   * That endpoint fires when somebody opens a book page, so it covers a book the
   * moment it is looked at and covers nothing otherwise. Nobody opens 258 book
   * pages. The alternative already in the repo,
   * `scripts/backfill-read-from-ratings.mjs`, is a Node script that needs a
   * checkout of the sibling audiobook repo to turn a `bookId` into a `workKey`,
   * so it is a thing a maintainer runs once, not a thing the household has.
   *
   * ⚠️ **It became possible on 2026-08-12**, when `backfill-review-keys.mjs`
   * was run with `--commit` for the first time and stamped `workKey` onto all
   * 870 documents. A sweep starts from the person rather than from a book, so
   * unlike `/keys` it has no legacy `bookId` to fall back on: a document with no
   * `workKey` names no book it can reach. `observedRatingsFromReviews` drops
   * those, and the per-book path remains the safety net for reviews written on
   * the audiobook site since that backfill.
   *
   * ## ⚠️ It grants nothing new
   *
   * Every write is scoped to `user.id` from the verified token — the body cannot
   * name a person — and the same capability already permits
   * `PUT /works/:id/reading`. The keys are matched against `work.work_key`, so
   * an unknown one is a no-op rather than an error, which is the ordinary case:
   * most of the household's audiobook reviews are of books this catalog does not
   * hold.
   */
  .post('/observed', requireCapability('trackReading'), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = observedRatingsSchema.safeParse(body ?? {});
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    const user = c.get('user');
    const marked = await applyObservedRatings(
      c.env.DB,
      user.id,
      parsed.data.ratings.map((r) => ({
        workKey: r.workKey,
        rating: r.rating,
        source: r.source ?? null,
      })),
    );

    // `considered` is the honest denominator for the sentence the browser draws:
    // "N of your M ratings are of books on these shelves" is a very different
    // claim from "N books were marked read", and only the server knows both.
    return c.json({ marked, considered: parsed.data.ratings.length });
  });
