import { Hono } from 'hono';
import { reviewDocFor, submitReviewSchema, workKeyFor } from '@lc/core';
import { cacheRating, getWork } from '@lc/db';
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
  });
