import { Hono } from 'hono';
import { observedRatingSchema, reviewDocFor, submitReviewSchema, workKeyFor } from '@lc/core';
import { applyObservedRating, cacheRating, getWork } from '@lc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

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

    return c.json({
      // The lane switch, mirroring `col()` in audiobook_catalog/site/fb-env.js.
      // A dev deployment must never write into the collection the live site
      // reads, and getting this wrong is silent in both directions.
      collection: c.env.ENVIRONMENT === 'production' ? 'reviews' : 'reviews_dev',
      docId: id,
      doc,
    });
  })

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

    const { doc } = reviewDocFor({
      title: work.title,
      authors: work.authors,
      displayName: 'x',
      rating: 5,
      text: '',
    });

    return c.json({
      collection: c.env.ENVIRONMENT === 'production' ? 'reviews' : 'reviews_dev',
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
  });
