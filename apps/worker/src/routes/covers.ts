import { Hono } from 'hono';
import {
  MAX_COVER_BYTES,
  checkCoverUpload,
  coverObjectKey,
  setCoverSchema,
  setCoverStatusSchema,
} from '@lc/core';
import { getWork, listCoverCandidates, updateWork } from '@lc/db';
import { verifyCoverUrl } from '@lc/isbn';
import type { AppBindings, Env } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Giving a book the right cover — or admitting it has the wrong one.
 *
 * Three ways in, in ascending order of how much this app has to own:
 *
 * | | | needs R2 |
 * |---|---|---|
 * | `PUT /works/:id/cover` | point at an image somebody else hosts | no |
 * | `PATCH /works/:id/cover-status` | say the cover already there is a stand-in | no |
 * | `POST /works/:id/cover` | upload a file we then serve | **yes** |
 *
 * ## ⚠️ Nothing is stored unverified, down any of the three paths
 *
 * `docs/info/covers-and-series.md` and the header of `verifyCoverUrl` state the
 * rule this enforces: **nothing in this system ever revisits a cover column**, so
 * a bad value is permanent in a way a blank is not. A blank renders the
 * deliberate title-on-spine placeholder and looks like a book with no cover; a
 * dead URL renders a broken image and looks like an app that is failing.
 *
 * So the URL path fetches the image before writing the column, and the upload
 * path reads the file's own magic bytes rather than believing the `Content-Type`
 * the browser attached. Both share one size floor — `MIN_COVER_BYTES`, which
 * exists because Open Library serves a 43-byte 1×1 placeholder as HTTP 200.
 *
 * ## ⚠️ The status travels with the URL
 *
 * Every write here sets `cover_status` in the same `updateWork` call as
 * `cover_url`. That pairing is migration 0040's whole point: the Percy Jackson
 * case is "use this image AND record that it is wrong", and doing it as two
 * requests means the first can succeed while the second fails, leaving a wrong
 * cover that looks right. `updateWork` additionally clears a stale status when a
 * URL moves without one, so a stand-in can never survive onto its replacement.
 */

/** Is there anywhere to put an uploaded file? Both halves or neither. */
function storage(env: Env): { bucket: R2Bucket; baseUrl: string } | null {
  if (!env.COVERS || !env.COVERS_BASE_URL) return null;
  return { bucket: env.COVERS, baseUrl: env.COVERS_BASE_URL.replace(/\/+$/, '') };
}

/**
 * ⚠️ The one sentence a person sees when the binding is missing, and it is
 * written for the owner rather than for a log. It has to say what is absent and
 * what still works, because the alternative — an upload button that returns
 * "internal error" — is indistinguishable from a broken app.
 */
const NO_STORAGE =
  'Uploading is not switched on: this Worker has no R2 bucket bound. Add the `COVERS` binding and `COVERS_BASE_URL` (see docs/access/cloudflare.md §7). Pasting a link to an image hosted elsewhere works without it.';

export const coverRoutes = new Hono<AppBindings>()
  /**
   * Can this browser offer an upload button?
   *
   * Asked once when the panel opens, so the UI can hide a control that could
   * only fail. ⚠️ `read` and not `editCatalog`: it reports a property of the
   * deployment, not of the collection, and gating it higher would make the panel
   * ask a question it is not allowed to hear the answer to.
   */
  .get('/cover-storage', requireCapability('read'), (c) => {
    const store = storage(c.env);
    return c.json({
      enabled: store !== null,
      maxBytes: MAX_COVER_BYTES,
      ...(store ? {} : { reason: NO_STORAGE }),
    });
  })

  /**
   * Every cover this book could wear, side by side — the picker's read.
   *
   * Candidates come from what the catalog already knows (edition covers, the
   * change_log history of the cover column, the current value) plus computed
   * Open Library guesses that announce themselves as guesses. Nothing here
   * fetches an image; **applying a pick goes through the verified PUT below**,
   * so a candidate that no longer serves is refused at the moment of choice,
   * never stored on faith.
   *
   * ⚠️ The reason a "previous cover" is a real offer and not a hope: uploaded
   * objects are content-addressed (`coverObjectKey` hashes the bytes) and the
   * DELETE below never removes them from the bucket. Swapping back is
   * re-pointing a column, not re-uploading a file.
   *
   * `editCatalog` because its only consumer is the edit surface — a reader
   * has no picker to feed.
   */
  .get('/works/:id/covers', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);
    const covers = await listCoverCandidates(c.env.DB, id);
    if (!covers) return c.json({ error: 'not_found' }, 404);
    return c.json(covers);
  })

  /**
   * Use an image somebody else hosts.
   *
   * The path that needs no bucket, and the one the Percy Jackson stand-in takes:
   * the Illumicrate CDN is already serving that photograph and copying it would
   * add nothing but a second thing to keep alive.
   *
   * ⚠️ The URL is **fetched** here, in the Worker, before the column moves. That
   * costs one subrequest and buys the only defence there is against a plausible
   * dead link — the failure `verifyCoverUrl` was written for is a URL that is
   * well-formed, on the right domain, and 404.
   */
  .put('/works/:id/cover', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);

    const parsed = setCoverSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    const work = await getWork(c.env.DB, id);
    if (!work) return c.json({ error: 'not_found' }, 404);

    const check = await verifyCoverUrl(parsed.data.url, {
      userAgent: 'library_catalog (private household catalog)',
    });
    if (!check.ok) {
      return c.json(
        {
          error: 'not_an_image',
          detail: `That link did not give back a usable image — ${check.reason}. Nothing was saved.`,
        },
        422,
      );
    }

    const updated = await updateWork(c.env.DB, id, {
      coverUrl: parsed.data.url,
      // `?? null` and not `?? undefined`: an omitted status means "unassessed",
      // which is the honest record for a link somebody has just pasted.
      coverStatus: parsed.data.status ?? null,
    });
    return c.json({ work: updated, bytes: check.bytes });
  })

  /**
   * "That cover is not the book." — or take the mark back off.
   *
   * ⚠️ The one route here that changes no URL, and the reason the whole feature
   * is not just an upload form. Five works are going to keep a wrong image for
   * as long as no right one exists, and the app has to be able to say so.
   */
  .patch('/works/:id/cover-status', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);

    const parsed = setCoverStatusSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);

    const work = await updateWork(c.env.DB, id, { coverStatus: parsed.data.status });
    if (!work) return c.json({ error: 'not_found' }, 404);
    return c.json({ work });
  })

  /**
   * Upload a file and serve it ourselves.
   *
   * ## ⚠️ This route is complete and inert
   *
   * There is no `COVERS` binding on this Worker, deliberately left for the owner
   * to add — see the long note in `env.ts` for why a covers bucket is not the
   * photo bucket that must never exist. Until it is added this answers **501
   * with a sentence naming what is missing**, and the UI hides the control. It
   * does not degrade into storing bytes in D1.
   *
   * ## What is checked, and in what order
   *
   * 1. **Size, from the header, before reading the body.** A 40MB upload should
   *    be refused at the door rather than buffered in a Worker's 128MB first.
   * 2. **The bytes are an image**, read from the file's own magic numbers.
   *    `checkCoverUpload` explains why the declared `Content-Type` is evidence of
   *    nothing.
   * 3. **The floor**, the same one a fetched URL must clear.
   *
   * ## The object name hashes the CONTENT
   *
   * Unlike `apps/web/public/covers/`, whose names hash the work key — a choice
   * `docs/info/covers-and-series.md` flags as the reason those files can only be
   * cached for a day, because re-running the backfill serves different bytes from
   * the same URL. An object named after its own content cannot do that, so these
   * can be cached hard, and replacing a cover is simply a different address.
   */
  .post('/works/:id/cover', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);

    const store = storage(c.env);
    if (!store) return c.json({ error: 'cover_storage_unconfigured', detail: NO_STORAGE }, 501);

    const work = await getWork(c.env.DB, id);
    if (!work) return c.json({ error: 'not_found' }, 404);

    // Advisory — a client can lie or omit it — but it is the only chance to
    // refuse a huge upload without reading it. The real limit is enforced below
    // on the bytes actually received.
    const declaredLength = Number(c.req.header('content-length') ?? '0');
    if (declaredLength > MAX_COVER_BYTES * 1.1) {
      return c.json(
        { error: 'too_large', detail: `That file is larger than the ${MAX_COVER_BYTES / (1024 * 1024)}MB limit.` },
        413,
      );
    }

    let file: unknown;
    try {
      const form = await c.req.formData();
      file = form.get('file');
    } catch {
      return c.json({ error: 'bad_request', detail: 'Expected a multipart form with a `file` part.' }, 400);
    }
    if (!(file instanceof File)) {
      return c.json({ error: 'bad_request', detail: 'No file was attached.' }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkCoverUpload(bytes, file.type);
    if (!check.ok || !check.contentType) {
      return c.json({ error: 'not_an_image', detail: check.reason }, 422);
    }

    // `crypto.subtle` is available in Workers and in Node 20+, so this is the
    // same code in the Worker and in a script.
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const key = coverObjectKey(work.workKey, hex, check.contentType);

    await store.bucket.put(key, bytes, {
      httpMetadata: {
        contentType: check.contentType,
        // Safe precisely because the name is the content hash — see above.
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });

    const updated = await updateWork(c.env.DB, id, {
      coverUrl: `${store.baseUrl}/${key}`,
      // ⚠️ 'ok' and not NULL. A person who went and found this image and uploaded
      // it has assessed it more thoroughly than any rung in the ladder ever
      // does, and leaving it unassessed would put the book straight back on the
      // "cover needed" list they just cleared it from.
      coverStatus: 'ok',
    });

    return c.json({ work: updated, key, bytes: check.bytes }, 201);
  })

  /**
   * Take the cover off.
   *
   * ⚠️ Clears the column; it does **not** delete the R2 object. Two reasons: a
   * previous version of a cover is the cheapest possible undo, and the objects
   * are content-addressed, so two works that legitimately share an image do not
   * have one of them delete it out from under the other. Bucket housekeeping, if
   * it is ever wanted, is a sweep that reads the column — not a delete inlined
   * into a request.
   */
  .delete('/works/:id/cover', requireCapability('editCatalog'), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);
    const work = await updateWork(c.env.DB, id, { coverUrl: null, coverStatus: null });
    if (!work) return c.json({ error: 'not_found' }, 404);
    return c.json({ work });
  });
