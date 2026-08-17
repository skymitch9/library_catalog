import { Hono } from 'hono';
import { tbrDocFor, tbrResolveSchema } from '@lc/core';
import { getWork, resolveTbrEntries } from '@lc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Which reading-list collection this deployment reads and writes, mirroring
 * `col()` in `audiobook_catalog/site/fb-env.js` — and mirroring
 * `reviewCollection` in `routes/reviews.ts`, which is the same rule for the
 * other collection.
 *
 * ⚠️ A dev deployment must never write into the collection the live site reads.
 * Getting it wrong is silent in both directions: dev intentions appearing on
 * somebody's real TBR, or a real entry invisible in dev.
 */
const tbrCollection = (env: { ENVIRONMENT?: string }) =>
  env.ENVIRONMENT === 'production' ? 'readingLists' : 'readingLists_dev';

/**
 * The cross-catalog to-be-read list, server side.
 *
 * ## ⚠️ This route does not write the TBR entry, for the reason reviews are not written here either
 *
 * The browser writes it, with the signed-in person's own credentials, to the
 * `readingLists` collection the audiobook site has always written. There is no
 * Firebase service account in this project and `routes/reviews.ts` argues at
 * length why that is the design rather than an omission; nothing about a
 * to-read list is worth introducing one for.
 *
 * What the server is for is the same thing it is for with reviews: **deriving
 * the keys**. The document id must be built with the audiobook site's own
 * `readingListDocId` (which is `${displayNameLower}_${bookId}` — the REVERSE of
 * a review's id, see `packages/core/src/tbr.ts`), and `workKey` must come from
 * the one implementation in `@lc/core`. Neither belongs in hand-written client
 * code, and the display name in the id is the server's `reviewName ??
 * displayName ?? email` ladder, which the browser must not re-derive.
 *
 * ## No rules change was needed
 *
 * `validReadingList()` in `audiobook_catalog/firestore.rules` asserts
 * `displayName`, `bookId` and `status` are strings and ignores unknown fields,
 * so `workKey`, `email` and `source` ride along exactly as they do on a review
 * document. Verified against the live rules 2026-08-17. That matters for the
 * same reason it did in 2026-08-09: a rules deploy changes the audiobook site's
 * security posture, and this feature does not need one.
 */
export const tbrRoutes = new Hono<AppBindings>()
  /**
   * Which collection to read, for a caller that is not looking at one book.
   *
   * The My-TBR list starts from the *person*, so it has no `workId` to ask
   * `/:workId/keys` with — and it must not guess the lane. A dev browser
   * reading `readingLists` would show the live site's real intentions and let a
   * dev click delete one, which looks exactly like the feature working. Same
   * argument, same shape, as `GET /api/reviews/collection`.
   */
  .get('/collection', requireCapability('read'), (c) =>
    c.json({ collection: tbrCollection(c.env) }),
  )

  /**
   * Everything the browser needs to add, check or remove one book: the
   * collection, the document id, and the payload to write.
   *
   * ⚠️ `held` for a book with no author, and it is the same guard
   * `/api/reviews/:workId/keys` applies (design §3.4). A TBR entry written now
   * would carry the provisional key and come loose the day the author arrives —
   * and the sentinel would exist in Firestore, which is the one place "zero
   * documents carry a provisional key" has to stay true. Answered as a state
   * rather than an error, because the book page still has to render.
   */
  .get('/:workId/keys', requireCapability('read'), async (c) => {
    const workId = Number(c.req.param('workId'));
    if (!Number.isInteger(workId)) return c.json({ error: 'bad_request' }, 400);

    const work = await getWork(c.env.DB, workId);
    if (!work) return c.json({ error: 'not_found' }, 404);

    if (work.authors === null) {
      return c.json({
        collection: tbrCollection(c.env),
        docId: null,
        doc: null,
        held: 'A book with no author cannot go on your list yet — it would come loose when the author arrives.',
      });
    }

    const user = c.get('user');
    const displayName = user.reviewName ?? user.displayName ?? user.email;

    const { id, doc } = tbrDocFor({
      title: work.title,
      authors: work.authors,
      displayName,
      email: user.email,
      coverUrl: work.coverUrl ?? null,
    });

    return c.json({ collection: tbrCollection(c.env), docId: id, doc });
  })

  /**
   * "Here is my whole TBR out of Firestore — which of these do we hold, and
   * have I read them?"
   *
   * ## ⚠️ Why the browser asks rather than the server fetching
   *
   * The Worker cannot see Firestore (no service account — `routes/reviews.ts`).
   * The browser is the only thing in the estate that sees both stores, which is
   * the same reason the read-state sweep lives in `lib/read-sync.ts`. So the
   * browser brings the list and this answers about the books.
   *
   * ## It grants nothing
   *
   * Read-only, and every read state comes from `user_book` for the `user.id` on
   * the verified token — the body cannot name a person. `read` rather than
   * `trackReading` because nothing is written; the *clearing* that follows is a
   * Firestore delete the person's own credentials perform, and the read state
   * it keys on was set by `PUT /works/:id/reading` or the observed-rating path,
   * both already gated.
   */
  .post('/resolve', requireCapability('read'), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = tbrResolveSchema.safeParse(body ?? {});
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    const user = c.get('user');
    const entries = await resolveTbrEntries(
      c.env.DB,
      user.id,
      // ⚠️ Keys only. The browser already holds the title and cover it fetched
      // from Firestore, and a server that echoed a client-supplied title back
      // would let the page print a string nothing checked as though the catalog
      // had said it. `TbrEntryRef` carries no title for that reason.
      parsed.data.entries.map((e) => ({
        docId: e.docId,
        bookId: e.bookId,
        workKey: e.workKey ?? null,
      })),
    );

    return c.json({ entries });
  });
