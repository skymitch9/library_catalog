import { Hono } from 'hono';
import { absoluteCoverUrl, legacyReadingListDocId, tbrDocFor, tbrResolveSchema } from '@lc/core';
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
 * `readingListDocId` (which is `${uid}_${bookId}` — the REVERSE of a review's
 * id, see `packages/core/src/tbr.ts`), and `workKey` must come from the one
 * implementation in `@lc/core`. Neither belongs in hand-written client code.
 *
 * ## ⚠️ The key moved to the ACCOUNT — and this time the rules DID change
 *
 * Owner's order, 2026-08-18: *"Make tbr keyed to account"*. The id used to be
 * `${displayNameLower}_${bookId}`, so two members with the same display name
 * shared one document per book. `docs/info/tbr.md` §1 and §2 said no rules
 * change was needed and that the two id orders could never be harmonised;
 * both statements are now superseded and the doc records why.
 *
 * `firestore.rules` now makes an account-keyed document owner-only for writes
 * and deletes, and pins the `uid` FIELD to the uid in the ID — both must be the
 * caller's. That is why `uid` here comes off the verified token and nowhere
 * else. Legacy display-name ids keep the old shape-only rules so the 53
 * documents that could not be migrated stay reachable. Smoked against the live
 * rules 2026-08-18: 17/17, both lanes.
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

    // ⚠️ THE ACCOUNT COMES OFF THE VERIFIED TOKEN, never off the request body.
    // It is the document id since 2026-08-18 ("Make tbr keyed to account"), so
    // a caller who could name it could file an entry on somebody else's list —
    // the very thing the migration removed. `firebaseUid` is `payload.sub` from
    // the token middleware/auth.ts already verified.
    //
    // ⚠️ Answered as a HELD STATE, not a 500. `firebase_uid` is nullable on
    // `app_user` (migration 0001) — a row created before the column was
    // populated, or by a path that never had a token, has none — and
    // `tbrDocFor` throws on an empty one by design. A person in that state gets
    // a sentence telling them what to do, not a bare failure: the estate rule
    // is that nobody ever sees a bare status, and "sign in again" is an action.
    if (!user.firebaseUid) {
      return c.json({
        collection: tbrCollection(c.env),
        docId: null,
        doc: null,
        held: 'Your to-read list needs a signed-in account. Sign out and back in with Google, and this will work.',
      });
    }

    const { id, doc } = tbrDocFor({
      title: work.title,
      authors: work.authors,
      displayName,
      uid: user.firebaseUid,
      email: user.email,
      // ⚠️ Absolute, against this request's own origin. `work.cover_url` is
      // usually `/covers/…` — a path this Worker serves — and the document is
      // read by another site, where that path means something else or nothing
      // at all. See `absoluteCoverUrl`.
      coverUrl: absoluteCoverUrl(work.coverUrl, c.req.url),
    });

    // ⚠️ THE LEGACY ID RIDES ALONG, READ-ONLY. Until the audiobook site's
    // 181-document move lands with its promote, every entry in this collection
    // is still filed under `{displayNameLower}_{bookId}` — and 53 of them stay
    // there permanently. A button that read only the account id would report
    // "not on your list" for a book that is, and adding it would then file a
    // SECOND document beside the person's real entry.
    //
    // ⚠️ It is never a write target. `firestore.rules` refuses a legacy-shaped
    // id carrying a `uid`, and `doc` above always carries one, so an attempt
    // fails loudly rather than quietly re-opening the display-name hole.
    // REMOVAL CONDITION: drop this field, and `legacyDocId` in Tbr.tsx, when
    // `migrate_tbr_to_uid.py --report` prints zero uid-less documents.
    return c.json({
      collection: tbrCollection(c.env),
      docId: id,
      legacyDocId: legacyReadingListDocId(displayName, doc.bookId),
      doc,
    });
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
