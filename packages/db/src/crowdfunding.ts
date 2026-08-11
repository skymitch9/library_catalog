import {
  pledgeAudit,
  type CreateCampaign,
  type CreatePledge,
  type CreatePledgeItem,
  type CrowdfundingPlatform,
  type PledgeAudit,
  type PledgeItemVerdict,
  type PledgeStatus,
} from '@lc/core';

/**
 * Where a book came from, when it did not come from a shop.
 *
 * Three grains, and migration 0010's header has the reasoning: a **campaign** is
 * a fact about the world, a **pledge** is a fact about one of our accounts, and a
 * **pledge item** is one book that pledge delivered.
 *
 * ## ⚠️ The one thing to get right
 *
 * *"Kickstarter stuff generally has a mix of physical and digital books so make
 * sure when youre auditing you're really looking close."* — the owner.
 *
 * Every count in this file is therefore taken two ways: `lines` (rows) and
 * `works` (DISTINCT work_id). They differ by exactly the amount that matters. A
 * pledge delivering *Cradle 12* as a signed hardcover and as an EPUB is one book
 * and two lines; a query that answered `2` to "how many books" would be
 * double-counting, and one that answered `1` to "how many things arrived" would
 * have lost the ebook. `pledgeItemMedium` in `@lc/core` decides which is which,
 * and it is the only place that decision is made.
 *
 * ## ⚠️ Accessories are not pledge items
 *
 * A plushie delivered by a pledge is a `book_accessory` row with `pledge_id` set
 * — see migration 0011. `pledge_item` holds **books only**. Two tables pointing
 * at each other would be two places to keep in step, which is the shape of bug
 * this repo's schema comments keep warning about.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface Campaign {
  id: number;
  platform: CrowdfundingPlatform;
  name: string;
  creator: string | null;
  url: string | null;
  externalId: string | null;
  launchedOn: string | null;
  fundedOn: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Pledge {
  id: number;
  campaignId: number;
  platform: CrowdfundingPlatform;
  /** ⚠️ Which login. There are two BackerKit accounts; this is what tells them apart. */
  account: string;
  tier: string | null;
  pledgedOn: string | null;
  amountCents: number | null;
  currency: string;
  managerUrl: string | null;
  status: PledgeStatus;
  notes: string | null;
  createdAt: string;
}

export interface PledgeItem {
  id: number;
  pledgeId: number;
  workId: number;
  editionId: number | null;
  /** 'none' means no printing can exist for this line — an audiobook. */
  editionVerdict: PledgeItemVerdict | null;
  copyId: number | null;
  formatHint: string | null;
  title: string | null;
  quantity: number;
  fulfilled: boolean;
  externalRef: string | null;
  notes: string | null;
  /** From the joined `work`, so a pledge can be read without a second query. */
  workTitle: string;
  workAuthors: string;
  /** From the joined `edition`. Null until the line is matched to a printing. */
  format: string | null;
}

/** A campaign with our pledges on it, and the physical/digital audit. */
export interface CampaignReport {
  campaign: Campaign;
  pledges: (Pledge & { items: PledgeItem[]; audit: PledgeAudit })[];
  audit: PledgeAudit;
}

/** What one work's page says about where it came from. */
export interface WorkProvenance {
  itemId: number;
  pledgeId: number;
  campaignId: number;
  campaignName: string;
  campaignUrl: string | null;
  /** Where the campaign ran. */
  campaignPlatform: CrowdfundingPlatform;
  /** Where our pledge lives, which is not always the same place. */
  pledgePlatform: CrowdfundingPlatform;
  account: string;
  tier: string | null;
  pledgedOn: string | null;
  status: PledgeStatus;
  editionId: number | null;
  /**
   * ⚠️ 'none' means no printing CAN exist for this line, not that nobody looked.
   * An audiobook reward is the measured case — one pledge routinely delivers
   * ebook + print + audiobook, and audio is never an `edition` here.
   */
  editionVerdict: PledgeItemVerdict | null;
  format: string | null;
  formatHint: string | null;
  title: string | null;
  quantity: number;
  fulfilled: boolean;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

interface CampaignRow {
  id: number;
  platform: string;
  name: string;
  creator: string | null;
  url: string | null;
  external_id: string | null;
  launched_on: string | null;
  funded_on: string | null;
  notes: string | null;
  created_at: string;
}

const CAMPAIGN_COLS =
  'id, platform, name, creator, url, external_id, launched_on, funded_on, notes, created_at';

function toCampaign(r: CampaignRow): Campaign {
  return {
    id: r.id,
    platform: r.platform as CrowdfundingPlatform,
    name: r.name,
    creator: r.creator,
    url: r.url,
    externalId: r.external_id,
    launchedOn: r.launched_on,
    fundedOn: r.funded_on,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

interface PledgeRow {
  id: number;
  campaign_id: number;
  platform: string;
  account: string;
  tier: string | null;
  pledged_on: string | null;
  amount_cents: number | null;
  currency: string;
  manager_url: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

const PLEDGE_COLS =
  'id, campaign_id, platform, account, tier, pledged_on, amount_cents, currency, ' +
  'manager_url, status, notes, created_at';

function toPledge(r: PledgeRow): Pledge {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    platform: r.platform as CrowdfundingPlatform,
    account: r.account,
    tier: r.tier,
    pledgedOn: r.pledged_on,
    amountCents: r.amount_cents,
    currency: r.currency,
    managerUrl: r.manager_url,
    status: r.status as PledgeStatus,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

interface ItemRow {
  id: number;
  pledge_id: number;
  work_id: number;
  edition_id: number | null;
  edition_verdict: string | null;
  copy_id: number | null;
  format_hint: string | null;
  title: string | null;
  quantity: number;
  fulfilled: number;
  external_ref: string | null;
  notes: string | null;
  work_title: string;
  work_authors: string;
  format: string | null;
}

/**
 * ⚠️ `e.format` is LEFT JOINed, never assumed. A line with no `edition_id` is the
 * ordinary state of a fresh scan, and it is what `pledgeItemMedium` falls back
 * from `format` to `formatHint` for.
 */
const ITEM_SELECT = `
  SELECT i.id, i.pledge_id, i.work_id, i.edition_id, i.edition_verdict, i.copy_id,
         i.format_hint, i.title,
         i.quantity, i.fulfilled, i.external_ref, i.notes,
         w.title   AS work_title,
         w.authors AS work_authors,
         e.format  AS format
    FROM pledge_item i
    JOIN work w      ON w.id = i.work_id
    LEFT JOIN edition e ON e.id = i.edition_id`;

function toItem(r: ItemRow): PledgeItem {
  return {
    id: r.id,
    pledgeId: r.pledge_id,
    workId: r.work_id,
    editionId: r.edition_id,
    editionVerdict: r.edition_verdict as PledgeItemVerdict | null,
    copyId: r.copy_id,
    formatHint: r.format_hint,
    title: r.title,
    quantity: r.quantity,
    fulfilled: r.fulfilled === 1,
    externalRef: r.external_ref,
    notes: r.notes,
    workTitle: r.work_title,
    workAuthors: r.work_authors,
    format: r.format,
  };
}

/** The shape `pledgeAudit` wants, built from rows we already hold. */
function auditOf(items: readonly PledgeItem[]): PledgeAudit {
  return pledgeAudit(
    items.map((i) => ({
      workId: i.workId,
      editionId: i.editionId,
      editionVerdict: i.editionVerdict,
      format: i.format,
      formatHint: i.formatHint,
      title: i.title,
      fulfilled: i.fulfilled,
    })),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export class CrowdfundingError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

/**
 * Every campaign, with its audit. The list the owner reconciles a scan against.
 *
 * ⚠️ Three queries, not one per campaign. The whole table is read and grouped in
 * memory because a household's campaign list is tens of rows, and because the
 * audit has to be computed over items grouped by pledge — which a single flat
 * join would have to re-derive anyway.
 */
export async function listCampaigns(db: D1Database): Promise<CampaignReport[]> {
  const [{ results: campaigns }, { results: pledges }, { results: items }] = await Promise.all([
    db
      .prepare(`SELECT ${CAMPAIGN_COLS} FROM crowdfunding_campaign ORDER BY name COLLATE NOCASE`)
      .all<CampaignRow>(),
    db
      .prepare(`SELECT ${PLEDGE_COLS} FROM crowdfunding_pledge ORDER BY account, id`)
      .all<PledgeRow>(),
    db.prepare(`${ITEM_SELECT} ORDER BY w.sort_title COLLATE NOCASE, i.id`).all<ItemRow>(),
  ]);

  const itemsByPledge = new Map<number, PledgeItem[]>();
  for (const row of items) {
    const item = toItem(row);
    const list = itemsByPledge.get(item.pledgeId);
    if (list) list.push(item);
    else itemsByPledge.set(item.pledgeId, [item]);
  }

  const pledgesByCampaign = new Map<number, (Pledge & { items: PledgeItem[]; audit: PledgeAudit })[]>();
  for (const row of pledges) {
    const pledge = toPledge(row);
    const own = itemsByPledge.get(pledge.id) ?? [];
    const entry = { ...pledge, items: own, audit: auditOf(own) };
    const list = pledgesByCampaign.get(pledge.campaignId);
    if (list) list.push(entry);
    else pledgesByCampaign.set(pledge.campaignId, [entry]);
  }

  return campaigns.map((row) => {
    const campaign = toCampaign(row);
    const own = pledgesByCampaign.get(campaign.id) ?? [];
    // ⚠️ The campaign audit is over ALL of its pledges' items at once, not the
    // sum of the per-pledge audits. Summing would count a work twice when two
    // accounts backed the same campaign — the exact BackerKit case this schema
    // exists to represent.
    return { campaign, pledges: own, audit: auditOf(own.flatMap((p) => p.items)) };
  });
}

export async function getCampaign(db: D1Database, id: number): Promise<CampaignReport | null> {
  const all = await listCampaigns(db);
  return all.find((c) => c.campaign.id === id) ?? null;
}

/**
 * Where one book came from — the book page's read.
 *
 * ⚠️ Returns **one row per `pledge_item`**, so a work delivered as a hardcover
 * and an EPUB by one pledge appears twice, deliberately. Collapsing them here
 * would hide the physical/digital pair at the exact place a person looks for it.
 */
export async function listProvenanceForWork(
  db: D1Database,
  workId: number,
): Promise<WorkProvenance[]> {
  const { results } = await db
    .prepare(
      `SELECT i.id AS item_id, i.edition_id, i.edition_verdict, i.format_hint, i.title, i.quantity,
              i.fulfilled, i.notes,
              e.format AS format,
              p.id AS pledge_id, p.platform AS pledge_platform, p.account, p.tier,
              p.pledged_on, p.status,
              c.id AS campaign_id, c.name AS campaign_name, c.url AS campaign_url,
              c.platform AS campaign_platform
         FROM pledge_item i
         JOIN crowdfunding_pledge p   ON p.id = i.pledge_id
         JOIN crowdfunding_campaign c ON c.id = p.campaign_id
         LEFT JOIN edition e          ON e.id = i.edition_id
        WHERE i.work_id = ?
        ORDER BY p.pledged_on, p.id, i.id`,
    )
    .bind(workId)
    .all<{
      item_id: number;
      edition_id: number | null;
      edition_verdict: string | null;
      format_hint: string | null;
      title: string | null;
      quantity: number;
      fulfilled: number;
      notes: string | null;
      format: string | null;
      pledge_id: number;
      pledge_platform: string;
      account: string;
      tier: string | null;
      pledged_on: string | null;
      status: string;
      campaign_id: number;
      campaign_name: string;
      campaign_url: string | null;
      campaign_platform: string;
    }>();

  return results.map((r) => ({
    itemId: r.item_id,
    pledgeId: r.pledge_id,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    campaignUrl: r.campaign_url,
    campaignPlatform: r.campaign_platform as CrowdfundingPlatform,
    pledgePlatform: r.pledge_platform as CrowdfundingPlatform,
    account: r.account,
    tier: r.tier,
    pledgedOn: r.pledged_on,
    status: r.status as PledgeStatus,
    editionId: r.edition_id,
    editionVerdict: r.edition_verdict as PledgeItemVerdict | null,
    format: r.format,
    formatHint: r.format_hint,
    title: r.title,
    quantity: r.quantity,
    fulfilled: r.fulfilled === 1,
    notes: r.notes,
  }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Record a campaign, or find the one already recorded.
 *
 * ⚠️ Idempotent on `(platform, external_id)` — the whole point of the column. A
 * second scan of the same BackerKit account must find the campaign it created
 * last time, not mint a duplicate that splits the pledges across two rows.
 *
 * With no `externalId` there is nothing to be idempotent on, so a name match on
 * the same platform is used instead. That is a weaker guarantee and it is stated
 * rather than hidden: two genuinely different campaigns with the same name on one
 * platform would merge, which has never happened here and would be visible the
 * moment it did.
 */
export async function upsertCampaign(db: D1Database, input: CreateCampaign): Promise<Campaign> {
  const existing = input.externalId
    ? await db
        .prepare(
          `SELECT ${CAMPAIGN_COLS} FROM crowdfunding_campaign
            WHERE platform = ? AND external_id = ?`,
        )
        .bind(input.platform, input.externalId)
        .first<CampaignRow>()
    : await db
        .prepare(
          `SELECT ${CAMPAIGN_COLS} FROM crowdfunding_campaign
            WHERE platform = ? AND name = ? COLLATE NOCASE`,
        )
        .bind(input.platform, input.name.trim())
        .first<CampaignRow>();

  if (existing) {
    // COALESCE, so a re-scan that knows less than the last one does not erase
    // what a person filled in by hand. The same rule `edition.source = 'manual'`
    // states in migration 0001: an importer never overwrites an answer.
    const row = await db
      .prepare(
        `UPDATE crowdfunding_campaign
            SET name = ?2, creator = COALESCE(?3, creator), url = COALESCE(?4, url),
                external_id = COALESCE(?5, external_id),
                launched_on = COALESCE(?6, launched_on),
                funded_on = COALESCE(?7, funded_on),
                notes = COALESCE(?8, notes),
                updated_at = datetime('now')
          WHERE id = ?1
        RETURNING ${CAMPAIGN_COLS}`,
      )
      .bind(
        existing.id,
        input.name.trim(),
        input.creator ?? null,
        input.url ?? null,
        input.externalId ?? null,
        input.launchedOn ?? null,
        input.fundedOn ?? null,
        input.notes ?? null,
      )
      .first<CampaignRow>();
    if (!row) throw new CrowdfundingError('Could not update that campaign', 400);
    return toCampaign(row);
  }

  const row = await db
    .prepare(
      `INSERT INTO crowdfunding_campaign
         (platform, name, creator, url, external_id, launched_on, funded_on, notes)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       RETURNING ${CAMPAIGN_COLS}`,
    )
    .bind(
      input.platform,
      input.name.trim(),
      input.creator ?? null,
      input.url ?? null,
      input.externalId ?? null,
      input.launchedOn ?? null,
      input.fundedOn ?? null,
      input.notes ?? null,
    )
    .first<CampaignRow>();
  if (!row) throw new CrowdfundingError('Could not record that campaign', 400);
  return toCampaign(row);
}

/**
 * Record our pledge on it, or update the one already recorded.
 *
 * ⚠️ The conflict target is `(campaign_id, platform, account)` — the three
 * columns that identify *which of our logins backed which campaign where*. Two
 * BackerKit accounts backing one campaign are two rows and must stay two rows.
 */
export async function upsertPledge(db: D1Database, input: CreatePledge): Promise<Pledge> {
  const campaign = await db
    .prepare('SELECT id FROM crowdfunding_campaign WHERE id = ?')
    .bind(input.campaignId)
    .first<{ id: number }>();
  if (!campaign) throw new CrowdfundingError('That campaign is not recorded', 404);

  const account = input.account.trim();
  if (!account) throw new CrowdfundingError('A pledge needs an account — which login?', 400);

  const row = await db
    .prepare(
      `INSERT INTO crowdfunding_pledge
         (campaign_id, platform, account, tier, pledged_on, amount_cents, currency,
          manager_url, status, notes)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT (campaign_id, platform, account) DO UPDATE SET
         tier = COALESCE(?4, crowdfunding_pledge.tier),
         pledged_on = COALESCE(?5, crowdfunding_pledge.pledged_on),
         amount_cents = COALESCE(?6, crowdfunding_pledge.amount_cents),
         currency = ?7,
         manager_url = COALESCE(?8, crowdfunding_pledge.manager_url),
         status = ?9,
         notes = COALESCE(?10, crowdfunding_pledge.notes),
         updated_at = datetime('now')
       RETURNING ${PLEDGE_COLS}`,
    )
    .bind(
      input.campaignId,
      input.platform,
      account,
      input.tier ?? null,
      input.pledgedOn ?? null,
      input.amountCents ?? null,
      input.currency,
      input.managerUrl ?? null,
      input.status,
      input.notes ?? null,
    )
    .first<PledgeRow>();
  if (!row) throw new CrowdfundingError('Could not record that pledge', 400);
  return toPledge(row);
}

/**
 * Record one book a pledge delivered.
 *
 * ⚠️ **Adding the hardcover and then the EPUB of the same novel to one pledge is
 * correct and both rows survive.** Migration 0010's unique index is
 * `(pledge_id, work_id, IFNULL(edition_id, 0), IFNULL(format_hint, ''))`, so the
 * two lines differ and both land; an exact repeat of either updates in place.
 * Nothing here may add a `work_id` uniqueness check — that would delete half of
 * every pledge in this catalog.
 */
export async function upsertPledgeItem(
  db: D1Database,
  pledgeId: number,
  input: CreatePledgeItem,
): Promise<PledgeItem> {
  const pledge = await db
    .prepare('SELECT id FROM crowdfunding_pledge WHERE id = ?')
    .bind(pledgeId)
    .first<{ id: number }>();
  if (!pledge) throw new CrowdfundingError('That pledge is not recorded', 404);

  const work = await db
    .prepare('SELECT id FROM work WHERE id = ?')
    .bind(input.workId)
    .first<{ id: number }>();
  if (!work) throw new CrowdfundingError('That book is not in the catalog', 404);

  if (input.editionId != null) {
    const edition = await db
      .prepare('SELECT work_id FROM edition WHERE id = ?')
      .bind(input.editionId)
      .first<{ work_id: number }>();
    if (!edition) throw new CrowdfundingError('That printing is not in the catalog', 404);
    // The same false-statement refusal `assertCopyBelongs` makes for accessories.
    if (edition.work_id !== input.workId) {
      throw new CrowdfundingError('That printing belongs to a different book', 400);
    }
  }

  const row = await db
    .prepare(
      `INSERT INTO pledge_item
         (pledge_id, work_id, edition_id, edition_verdict, copy_id, format_hint, title,
          quantity, fulfilled, external_ref, notes)
       VALUES (?1, ?2, ?3, ?11, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT (pledge_id, work_id, IFNULL(edition_id, 0), IFNULL(format_hint, ''))
         DO UPDATE SET
           edition_verdict = COALESCE(?11, pledge_item.edition_verdict),
           copy_id = COALESCE(?4, pledge_item.copy_id),
           title = COALESCE(?6, pledge_item.title),
           quantity = ?7,
           fulfilled = ?8,
           external_ref = COALESCE(?9, pledge_item.external_ref),
           notes = COALESCE(?10, pledge_item.notes),
           updated_at = datetime('now')
       RETURNING id`,
    )
    .bind(
      pledgeId,
      input.workId,
      input.editionId ?? null,
      input.copyId ?? null,
      input.formatHint ?? null,
      input.title ?? null,
      input.quantity,
      input.fulfilled ? 1 : 0,
      input.externalRef ?? null,
      input.notes ?? null,
      input.editionVerdict ?? null,
    )
    .first<{ id: number }>();
  if (!row) throw new CrowdfundingError('Could not record that reward', 400);

  const created = await db
    .prepare(`${ITEM_SELECT} WHERE i.id = ?`)
    .bind(row.id)
    .first<ItemRow>();
  if (!created) throw new CrowdfundingError('Could not record that reward', 400);
  return toItem(created);
}

/**
 * Attach a line to a printing after the fact — the audit's whole purpose.
 *
 * ⚠️ Separate from `upsertPledgeItem` because setting `edition_id` moves the row
 * into a different slot of the unique index, which an upsert would express as
 * "insert a second one". This is an UPDATE by id and cannot.
 */
export async function matchPledgeItemEdition(
  db: D1Database,
  itemId: number,
  editionId: number | null,
): Promise<PledgeItem | null> {
  const item = await db
    .prepare('SELECT work_id FROM pledge_item WHERE id = ?')
    .bind(itemId)
    .first<{ work_id: number }>();
  if (!item) return null;

  if (editionId != null) {
    const edition = await db
      .prepare('SELECT work_id FROM edition WHERE id = ?')
      .bind(editionId)
      .first<{ work_id: number }>();
    if (!edition) throw new CrowdfundingError('That printing is not in the catalog', 404);
    if (edition.work_id !== item.work_id) {
      throw new CrowdfundingError('That printing belongs to a different book', 400);
    }
  }

  // ⚠️ Naming a printing CLEARS the verdict. The two are answers to one
  // question and a row holding both would say "there is no edition" beside an
  // edition id — the same second-copy-of-a-fact the verdict tables exist to avoid.
  await db
    .prepare(
      `UPDATE pledge_item
          SET edition_id = ?,
              edition_verdict = CASE WHEN ? IS NULL THEN edition_verdict ELSE NULL END,
              updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(editionId, editionId, itemId)
    .run();

  const row = await db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).bind(itemId).first<ItemRow>();
  return row ? toItem(row) : null;
}

export async function deletePledgeItem(db: D1Database, itemId: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM pledge_item WHERE id = ?').bind(itemId).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deletePledge(db: D1Database, pledgeId: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM crowdfunding_pledge WHERE id = ?').bind(pledgeId).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function deleteCampaign(db: D1Database, campaignId: number): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM crowdfunding_campaign WHERE id = ?')
    .bind(campaignId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * The pledges one may attach an accessory to, newest first.
 *
 * A short flat list rather than the campaign tree: the accessory form asks "which
 * pledge did this come in", and a person picking from a dropdown wants
 * "Kickstarter · Dungeon Crawler Carl · nbaslamking@gmail.com", not a hierarchy.
 */
export async function listPledgeOptions(
  db: D1Database,
): Promise<{ id: number; label: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.platform, p.account, p.pledged_on, c.name
         FROM crowdfunding_pledge p
         JOIN crowdfunding_campaign c ON c.id = p.campaign_id
        ORDER BY p.pledged_on DESC, p.id DESC`,
    )
    .all<{
      id: number;
      platform: string;
      account: string;
      pledged_on: string | null;
      name: string;
    }>();

  return results.map((r) => ({
    id: r.id,
    label: [r.name, r.platform, r.account, r.pledged_on].filter(Boolean).join(' · '),
  }));
}
