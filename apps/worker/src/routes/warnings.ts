import { Hono } from 'hono';
import { addWarningSchema, warningDocFor, warningKeysFor } from '@lc/core';
import { getAudiobookHolding, getWork } from '@lc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Which warning collection this deployment reads and writes, mirroring `col()`
 * in `audiobook_catalog/site/fb-env.js` — the same rule `reviewCollection` and
 * `tbrCollection` state for their collections.
 *
 * ⚠️ A dev deployment must never write into the collection the live site reads.
 * Getting it wrong is silent in both directions: a dev experiment appearing as
 * a real warning on somebody's book page, or a real warning invisible in dev.
 */
const warningCollection = (env: { ENVIRONMENT?: string }) =>
  env.ENVIRONMENT === 'production' ? 'user_content_warnings' : 'user_content_warnings_dev';

/**
 * Reader-contributed content warnings, server side — the 2026-08-17 port of
 * the audiobook site's feature (owner: *"port content warning feature over to
 * all physical book and the ebook site"*).
 *
 * ## ⚠️ This route writes nothing, for the third time in this repo
 *
 * The browser writes and deletes the document with the signed-in person's own
 * credentials, against the shared `user_content_warnings` collection the
 * audiobook site has always written. `routes/reviews.ts` argues at length why
 * there is no Firebase service account in this project, and a content note is
 * not the thing to introduce one for.
 *
 * What the server is for is the same as it is for reviews and the TBR:
 * **deriving the keys** — and here that is the whole feature, because the key
 * is where the trap lives. See `packages/core/src/warnings.ts`: a note filed
 * under `bookIdFromTitle(work.title)` is invisible on the audiobook site for
 * the 33-of-92 works the two catalogs spell differently, and invisible in the
 * other direction too. The one place that knows their spelling is
 * `audiobook_holding.title` (migration 0010), which lives here, in D1.
 *
 * ## No rules change is needed, and that is deliberate
 *
 * `validUserWarning()` asserts `label` (≤80), `bookId` and `displayName` are
 * strings and ignores unknown fields, so `workKey`, `source` and `email` ride
 * along exactly as they do on a review or a reading-list document. Verified
 * against the live `audiobook_catalog/firestore.rules` 2026-08-17 — which had
 * just been tightened that same day for `delete` (author-or-moderator, bound to
 * `authorUid`). **Do not touch that file from this repo**: a rules deploy
 * changes the audiobook site's security posture, and this feature does not need
 * one.
 */
export const warningRoutes = new Hono<AppBindings>()
  /**
   * Everything the browser needs to READ the notes for one book: the lane, the
   * ids to query, and the exact title the published pipeline file is keyed by.
   *
   * ⚠️ `held` for a book with no author, and it is guard 2 of the design's §3.4
   * repeated verbatim from `GET /api/reviews/:workId/keys`. The dangerous half
   * is the title-only fallback id: on an authorless book it can surface notes
   * about A DIFFERENT BOOK WITH THE SAME NAME ("two books called Gold",
   * migration 0001), and there is nothing left to disambiguate them with. A
   * content warning attached to the wrong book is worse than an absent one.
   * Answered as a state rather than an error, because the page still renders.
   */
  .get('/:workId/keys', requireCapability('read'), async (c) => {
    const workId = Number(c.req.param('workId'));
    if (!Number.isInteger(workId)) return c.json({ error: 'bad_request' }, 400);

    const work = await getWork(c.env.DB, workId);
    if (!work) return c.json({ error: 'not_found' }, 404);

    if (work.authors === null) {
      return c.json({
        collection: warningCollection(c.env),
        bookIds: [],
        publishedTitle: null,
        held: 'Content notes are held until the author is known.',
      });
    }

    const holding = await getAudiobookHolding(c.env.DB, workId);
    const keys = warningKeysFor({
      title: work.title,
      audiobookRawTitle: holding?.rawTitle ?? null,
      audiobookTitle: holding?.title ?? null,
      audiobookTitleStale: holding?.staleAt != null,
    });

    return c.json({
      collection: warningCollection(c.env),
      bookIds: keys.bookIds,
      publishedTitle: keys.publishedTitle,
      // ⚠️ Which spelling the write key came from, said out loud. The panel
      // prints it, because "your note goes on the audiobook catalog's record
      // for <their title>" is exactly the fact a person cannot otherwise see —
      // and it is the fact that makes the feature cross-catalog rather than
      // merely local.
      writeBookId: keys.writeBookId,
      // ⚠️ The RAW spelling, because that is the one the write key came from
      // (migration 0340) and this string is what the panel prints in "your note
      // goes on the audiobook catalog's record for «…»". Printing the cleaned
      // title here would name a spelling nothing is actually filed under.
      audiobookTitle: keys.publishedTitle,
    });
  })

  /**
   * Everything the browser needs to ADD one note: the lane, the document id and
   * the payload — including `authorUid`, taken from the VERIFIED token.
   *
   * ⚠️ **The uid is the server's, not the client's.** `firestore.rules` binds
   * delete to `resource.data.authorUid == request.auth.uid`, so this field is
   * what decides whether the author can ever remove their own note. The
   * audiobook site has to ask its own SDK for it (`liveUid()`), because its
   * session is presentation-only; here the Worker has already verified the
   * token that the browser will write with, so the authoritative answer is
   * to hand. A null `firebaseUid` (never seen — `sub` is always present on a
   * verified token) omits the field rather than inventing one, and the panel
   * says the note will need a moderator to remove.
   *
   * `trackReading` — the member floor, the same capability that permits a
   * review. Adding a note is the same kind of act: your own words about a book,
   * attributed to you.
   */
  .post('/:workId/draft', requireCapability('trackReading'), async (c) => {
    const workId = Number(c.req.param('workId'));
    if (!Number.isInteger(workId)) return c.json({ error: 'bad_request' }, 400);

    const body = await c.req.json().catch(() => null);
    const parsed = addWarningSchema.safeParse(body ?? {});
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    const work = await getWork(c.env.DB, workId);
    if (!work) return c.json({ error: 'not_found' }, 404);

    // Guard 1 of the design's §3.4, the same friendly 409 `/api/reviews/:id/draft`
    // answers. `warningDocFor` throws on the sentinel; a throw here would
    // surface as a 500 and read as a broken site.
    if (work.authors === null) {
      return c.json(
        {
          error: 'author_required',
          detail: 'Add the author first — a note written now would come loose when it arrives.',
        },
        409,
      );
    }

    const user = c.get('user');
    const displayName = user.reviewName ?? user.displayName ?? user.email;
    const holding = await getAudiobookHolding(c.env.DB, workId);

    const { id, doc } = warningDocFor({
      title: work.title,
      authors: work.authors,
      label: parsed.data.label,
      displayName,
      email: user.email,
      authorUid: user.firebaseUid,
      audiobookRawTitle: holding?.rawTitle ?? null,
      audiobookTitle: holding?.title ?? null,
      audiobookTitleStale: holding?.staleAt != null,
    });

    return c.json({ collection: warningCollection(c.env), docId: id, doc });
  });
