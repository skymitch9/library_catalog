import { Hono } from 'hono';
import {
  createCampaignSchema,
  createPledgeItemSchema,
  createPledgeSchema,
} from '@lc/core';
import {
  CrowdfundingError,
  deleteCampaign,
  deletePledge,
  deletePledgeItem,
  getCampaign,
  listCampaigns,
  listPledgeOptions,
  listProvenanceForWork,
  matchPledgeItemEdition,
  upsertCampaign,
  upsertPledge,
  upsertPledgeItem,
} from '@lc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Kickstarter, BackerKit and Indiegogo — where a book came from.
 *
 * Two mounts, and the split is on purpose:
 *
 * - `crowdfundingRoutes` at `/api/crowdfunding` — the campaign list, the pledges,
 *   the audit. This is the reconciliation surface for a scan.
 * - `provenanceRoutes` at `/api` — `/works/:id/provenance`, one more segment than
 *   `/works/:id`, exactly as `relations.ts` and `aliases.ts` do it.
 *
 * ## ⚠️ The audit is the point of the read endpoints
 *
 * *"Kickstarter stuff generally has a mix of physical and digital books so make
 * sure when youre auditing you're really looking close."* — the owner. Every
 * campaign and every pledge comes back with a `PledgeAudit`: lines versus
 * distinct works, physical versus digital, and counts of the two states a person
 * has to resolve — `both` (one reward line naming a hardcover *and* an ebook, so
 * it needs splitting into two) and `unknown` (nothing could classify it).
 * `packages/core/src/crowdfunding.ts` makes that decision and `npm test` pins it.
 *
 * ## ⚠️ Everything is gated on `editCatalog`, including the reads
 *
 * What was paid, when, and from which of two logins is household financial
 * detail, so it is kept off the read-only roles: `read` (which every signed-in
 * role holds, member and guest included) gates the catalog; this is not the
 * catalog. `editCatalog` admits contributor and up — anyone trusted to edit
 * the catalog can see the provenance behind it.
 */
export const crowdfundingRoutes = new Hono<AppBindings>()
  .use('*', requireCapability('editCatalog'))

  .get('/', async (c) => c.json({ campaigns: await listCampaigns(c.env.DB) }))

  /** The flat list the accessory form's "which pledge" dropdown offers. */
  .get('/pledges', async (c) => c.json({ pledges: await listPledgeOptions(c.env.DB) }))

  .get('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);
    const report = await getCampaign(c.env.DB, id);
    return report ? c.json(report) : c.json({ error: 'not_found' }, 404);
  })

  /**
   * Record a campaign, or find the one already recorded.
   *
   * ⚠️ An upsert on `(platform, external_id)`, not a plain insert. A second scan
   * of the same BackerKit account must find last run's campaign, or the pledges
   * split across two rows and every count doubles.
   */
  .post('/', async (c) => {
    const parsed = createCampaignSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    try {
      return c.json({ campaign: await upsertCampaign(c.env.DB, parsed.data) }, 201);
    } catch (err) {
      if (err instanceof CrowdfundingError) {
        return c.json({ error: 'bad_request', detail: err.message }, err.status);
      }
      throw err;
    }
  })

  /**
   * Record our pledge.
   *
   * ⚠️ `account` is required by the schema and there are **two BackerKit
   * accounts**. A pledge that does not say which one cannot be reconciled against
   * a scan of either.
   */
  .post('/pledges', async (c) => {
    const parsed = createPledgeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    try {
      return c.json({ pledge: await upsertPledge(c.env.DB, parsed.data) }, 201);
    } catch (err) {
      if (err instanceof CrowdfundingError) {
        return c.json({ error: 'bad_request', detail: err.message }, err.status);
      }
      throw err;
    }
  })

  /**
   * Record one book the pledge delivered.
   *
   * ⚠️ Posting the hardcover and then the EPUB of the same novel to one pledge is
   * **correct** and produces two rows. See `upsertPledgeItem` — nothing here may
   * dedupe on `workId`.
   */
  .post('/pledges/:id/items', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);

    const parsed = createPledgeItemSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    try {
      return c.json({ item: await upsertPledgeItem(c.env.DB, id, parsed.data) }, 201);
    } catch (err) {
      if (err instanceof CrowdfundingError) {
        return c.json({ error: 'bad_request', detail: err.message }, err.status);
      }
      throw err;
    }
  })

  /**
   * Say which printing a reward line actually was.
   *
   * This is what closes an `unknown` or an `unmatched` in the audit, and it is a
   * PUT of one field rather than a general update — moving `edition_id` changes
   * which slot of the unique index the row occupies, and an upsert would express
   * that as "insert a second one".
   */
  .put('/items/:id/edition', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);

    const body = (await c.req.json().catch(() => null)) as { editionId?: unknown } | null;
    const raw = body?.editionId;
    const editionId = raw == null ? null : Number(raw);
    if (editionId != null && (!Number.isInteger(editionId) || editionId <= 0)) {
      return c.json({ error: 'bad_request', detail: 'editionId must be a positive integer or null' }, 400);
    }

    try {
      const item = await matchPledgeItemEdition(c.env.DB, id, editionId);
      return item ? c.json({ item }) : c.json({ error: 'not_found' }, 404);
    } catch (err) {
      if (err instanceof CrowdfundingError) {
        return c.json({ error: 'bad_request', detail: err.message }, err.status);
      }
      throw err;
    }
  })

  .delete('/items/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);
    const ok = await deletePledgeItem(c.env.DB, id);
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  })

  .delete('/pledges/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);
    const ok = await deletePledge(c.env.DB, id);
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  })

  /**
   * ⚠️ Cascades to every pledge and every reward line under it. It does NOT touch
   * `work`, `edition` or `copy` — deleting a campaign must never take books off
   * the shelf. `book_accessory.pledge_id` is `ON DELETE SET NULL` for the same
   * reason: the plushie is still in the house after the campaign row is gone.
   */
  .delete('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);
    const ok = await deleteCampaign(c.env.DB, id);
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });

/**
 * Where one book came from, for its own page.
 *
 * ⚠️ `read`, not `editCatalog`, and this is the one crowdfunding read that is.
 * "This came from the Dungeon Crawler Carl Kickstarter" is provenance about the
 * book — the same class of fact as its publisher, and it is what makes the
 * physical/digital pair visible at the place somebody actually looks for it.
 *
 * ⚠️ `listProvenanceForWork` deliberately selects **no money**. `amount_cents`
 * and `currency` exist on `crowdfunding_pledge` and never leave the
 * `editCatalog`-gated routes above. The account label does come through, because
 * "which of the two BackerKit logins has this" is the question the page is for
 * and a household of two already knows both addresses.
 */
export const provenanceRoutes = new Hono<AppBindings>().get(
  '/works/:id/provenance',
  requireCapability('read'),
  async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad_request' }, 400);
    return c.json({ provenance: await listProvenanceForWork(c.env.DB, id) });
  },
);
