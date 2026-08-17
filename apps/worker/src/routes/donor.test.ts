/**
 * The donor endpoint's gate and editorial policy.
 *
 * Two properties whose failure would be silent, pinned the way this repo pins
 * them ("fails if the behaviour breaks", never "returns something"):
 *
 * 1. **The token gate fails CLOSED and UNIFORMLY.** Unset `DONOR_TOKEN`, absent
 *    header, wrong header — all must be 404, indistinguishable from the route
 *    not existing. A regression to 401/403 advertises the door; a regression to
 *    "unset means open" hands the catalog to anyone. Driven through the real
 *    Hono routes, reading the status a real caller would see.
 *
 * 2. **`donorDetailsFor` hands out recorded facts and nothing else.** Only
 *    filled DETAIL_FIELDS; `seriesIndex` is the SORT value (display quotes a
 *    cover the caller does not hold); blanks and nulls are omitted rather than
 *    sent as null — a null that travels becomes a blank overwrite proposal on
 *    the other side.
 *
 * The matched/unmatched lookup itself needs a D1 and is exercised through a
 * minimal stub that answers the two queries the route makes — enough to pin
 * the ambiguity rule (two works sharing a folded title match NOBODY), which is
 * the route's one genuinely dangerous decision.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { AppBindings, Env } from '../env.js';
import { donorDetailsFor, donorRoutes, type DonorDetailsReply } from './donor.js';

function app() {
  const a = new Hono<AppBindings>();
  a.route('/api/donor', donorRoutes);
  return a;
}

async function ask(env: Partial<Env>, headers: Record<string, string> = {}, qs = 'title=Unsouled') {
  return app().request(`/api/donor/details?${qs}`, { headers }, env as Env);
}

// Never dereferenced on gate-refusal paths: the 404 happens before any handler.
const noDb = {} as unknown as Env;

describe('donor token gate — 404 for every way of being wrong', () => {
  it('DONOR_TOKEN unset: 404 even with a header presented', async () => {
    const res = await ask({ ...noDb }, { 'X-Donor-Token': 'anything' });
    assert.equal(res.status, 404, 'unset token must mean disabled, never open');
  });

  it('no header: 404, not 401 — the door is not advertised', async () => {
    const res = await ask({ DONOR_TOKEN: 's3cret' });
    assert.equal(res.status, 404);
  });

  it('wrong token: 404, indistinguishable from the route not existing', async () => {
    const res = await ask({ DONOR_TOKEN: 's3cret' }, { 'X-Donor-Token': 's3cret-but-wrong' });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'not_found', 'the body must match an ordinary unmatched-/api/* answer');
  });

  it('right token: admitted past the gate (400 on the missing title proves the handler ran)', async () => {
    const res = await app().request('/api/donor/details', { headers: { 'X-Donor-Token': 's3cret' } }, {
      DONOR_TOKEN: 's3cret',
    } as Env);
    assert.equal(res.status, 400, 'no title is a bad request FROM AN ADMITTED CALLER — not a 404');
  });
});

// ---------------------------------------------------------------------------
// The editorial policy: what the donor will and will not hand out
// ---------------------------------------------------------------------------

describe('donorDetailsFor', () => {
  it('sends only filled fields — nulls and blanks are omitted, never sent as null', () => {
    const details = donorDetailsFor({
      firstPublished: 2016,
      series: null,
      seriesIndexSort: null,
      description: '   ',
    });
    assert.deepEqual(details, { firstPublished: 2016 });
    assert.ok(!('series' in details), 'a null must not travel — it would become a blank-overwrite proposal');
    assert.ok(!('description' in details), 'whitespace is not a description');
  });

  it('seriesIndex carries the SORT value — the ladder position, usable by applyFinding', () => {
    const details = donorDetailsFor({
      firstPublished: null,
      series: 'Cradle',
      seriesIndexSort: 2.5,
      description: null,
    });
    assert.deepEqual(details, { series: 'Cradle', seriesIndex: 2.5 });
  });

  it('a fully-blank work answers an empty object, not a lie', () => {
    assert.deepEqual(
      donorDetailsFor({ firstPublished: null, series: null, seriesIndexSort: null, description: null }),
      {},
    );
  });
});

// ---------------------------------------------------------------------------
// Matching through a stub D1 — the ambiguity rule is the dangerous part
// ---------------------------------------------------------------------------

/** A work row as WORK_COLS selects it. Only the fields toWork reads. */
function workRow(id: number, title: string, authors: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    subtitle: null,
    sort_title: title,
    authors,
    primary_author: authors,
    work_key: 'stub|stub',
    series: null,
    series_index_sort: null,
    series_index_display: null,
    first_published: null,
    openlibrary_work_id: null,
    description: null,
    cover_url: null,
    cover_status: null,
    illustrator: null,
    universe: null,
    universe_how: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    ...extra,
  };
}

/**
 * Answers the three queries the route can make: work_key lookup, the
 * matching list, and getWork by id. Anything else throws, so a new query in
 * the route fails this file loudly instead of silently matching nothing.
 */
function stubDb(rows: ReturnType<typeof workRow>[], byKey: Record<string, number> = {}) {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first() {
          if (sql.includes('WHERE work_key = ?')) {
            const id = byKey[String(bound[0])];
            return rows.find((r) => r.id === id) ?? null;
          }
          if (sql.includes('FROM work WHERE id = ?')) {
            return rows.find((r) => r.id === bound[0]) ?? null;
          }
          throw new Error(`stubDb: unexpected first() for: ${sql}`);
        },
        async all() {
          if (sql.includes('FROM work')) {
            return { results: rows.map((r) => ({ id: r.id, title: r.title, authors: r.authors })) };
          }
          throw new Error(`stubDb: unexpected all() for: ${sql}`);
        },
      };
      return stmt;
    },
  } as unknown as Env['DB'];
}

async function matched(db: Env['DB'], qs: string): Promise<DonorDetailsReply> {
  const res = await app().request(
    `/api/donor/details?${qs}`,
    { headers: { 'X-Donor-Token': 's3cret' } },
    { DONOR_TOKEN: 's3cret', DB: db } as Env,
  );
  assert.equal(res.status, 200);
  return (await res.json()) as DonorDetailsReply;
}

describe('donor lookup', () => {
  it('a unique folded-title match answers with the work id, title and filled details', async () => {
    const db = stubDb([workRow(7, 'The Way of Kings', 'Brandon Sanderson', {
      series: 'The Stormlight Archive',
      series_index_sort: 1,
      first_published: 2010,
    })]);
    const reply = await matched(db, `title=${encodeURIComponent('way of kings')}`);
    assert.equal(reply.matched, true);
    assert.equal(reply.workId, 7);
    assert.equal(reply.title, 'The Way of Kings');
    assert.deepEqual(reply.details, {
      firstPublished: 2010,
      series: 'The Stormlight Archive',
      seriesIndex: 1,
    });
  });

  it('two works sharing a folded title match NOBODY — ambiguity must not guess', async () => {
    // The §4.4 failure shape: right title, wrong book, no person in the loop.
    const db = stubDb([
      workRow(1, 'Gold', 'Author One'),
      workRow(2, 'Gold', 'Author Two'),
    ]);
    const reply = await matched(db, 'title=Gold');
    assert.equal(reply.matched, false);
    assert.deepEqual(reply.details, {});
  });

  it('an unknown book is matched:false with 200 — "reachable, no answer" is not an error', async () => {
    const reply = await matched(stubDb([]), 'title=Nonexistent');
    assert.equal(reply.matched, false);
    assert.deepEqual(reply.details, {});
  });

  it('an author narrows Gold to the right one via the canonical work key', async () => {
    const rows = [
      workRow(1, 'Gold', 'Author One', { first_published: 2001 }),
      workRow(2, 'Gold', 'Author Two', { first_published: 2002 }),
    ];
    // workKeyFor('Gold', 'Author One') === 'gold|author one'
    const db = stubDb(rows, { 'gold|author one': 1 });
    const reply = await matched(db, `title=Gold&author=${encodeURIComponent('Author One')}`);
    assert.equal(reply.matched, true);
    assert.equal(reply.workId, 1);
    assert.deepEqual(reply.details, { firstPublished: 2001 });
  });
});
