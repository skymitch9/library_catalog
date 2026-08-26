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
import {
  CANDIDATE_LIMIT,
  donorDetailsFor,
  donorRoutes,
  rankCandidates,
  type DonorDetailsReply,
} from './donor.js';

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
    const { details } = donorDetailsFor({
      firstPublished: 2016,
      series: null,
      seriesIndexSort: null,
      seriesIndexDisplay: null,
      description: '   ',
    });
    assert.deepEqual(details, { firstPublished: 2016 });
    assert.ok(!('series' in details), 'a null must not travel — it would become a blank-overwrite proposal');
    assert.ok(!('description' in details), 'whitespace is not a description');
  });

  it('seriesIndex carries the SORT value — the ladder position, usable by applyFinding', () => {
    const { details } = donorDetailsFor({
      firstPublished: null,
      series: 'Cradle',
      seriesIndexSort: 2.5,
      seriesIndexDisplay: null,
      description: null,
    });
    assert.deepEqual(details, { series: 'Cradle', seriesIndex: 2.5 });
  });

  it('seriesIndexDisplay is handed out when the donor holds a printed form', () => {
    const result = donorDetailsFor({
      firstPublished: null,
      series: 'Cradle',
      seriesIndexSort: 7,
      seriesIndexDisplay: 'Volume 07',
      description: null,
    });
    assert.deepEqual(result.details, { series: 'Cradle', seriesIndex: 7 });
    assert.equal(result.seriesIndexDisplay, 'Volume 07');
  });

  it('seriesIndexDisplay is omitted when blank', () => {
    const result = donorDetailsFor({
      firstPublished: null,
      series: 'Cradle',
      seriesIndexSort: 1,
      seriesIndexDisplay: '   ',
      description: null,
    });
    assert.equal(result.seriesIndexDisplay, undefined);
  });

  it('a fully-blank work answers an empty object, not a lie', () => {
    assert.deepEqual(
      donorDetailsFor({ firstPublished: null, series: null, seriesIndexSort: null, seriesIndexDisplay: null, description: null }).details,
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

/** One `work_alias` row, in the shape `listWorkAliases` returns. */
interface AliasRow {
  workId: number;
  alias: string;
  kind: 'title' | 'author';
}

/**
 * Answers the four queries the route can make: work_key lookup, the matching
 * list, `work_alias`, and getWork by id. Anything else throws, so a new query
 * in the route fails this file loudly instead of silently matching nothing.
 *
 * ⚠️ `work_alias` is tested BEFORE `FROM work`, because `'FROM work_alias'`
 * contains `'FROM work'` as a substring and the looser test would quietly hand
 * the alias reader a list of works.
 */
function stubDb(
  rows: ReturnType<typeof workRow>[],
  byKey: Record<string, number> = {},
  aliases: AliasRow[] = [],
) {
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
          if (sql.includes('FROM work_alias')) return { results: aliases };
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

  it('a miss without ?candidates=1 answers exactly what it answered before the judged rung existed', async () => {
    // ⚠️ The donor-only instance's request. Her sweep has no ANTHROPIC_API_KEY,
    // so it never asks for a shortlist — and must get back the same shape it
    // got yesterday, with no `candidates` key to misread.
    const reply = await matched(stubDb([workRow(1, 'Unsouled', 'Will Wight')]), 'title=Nonexistent');
    assert.equal(reply.matched, false);
    assert.equal(reply.candidates, undefined, 'no shortlist unless it was asked for');
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

/**
 * ⚠️ The alias rung — the cross-instance identity bridge, measured 2026-08-26.
 *
 * padhard #348 is *"Isles of the Emberdark: A Cosmere Novel"* (the Tor
 * edition, ISBN 9781250415394) and main #4 is *"Isles of the Emberdark"* (the
 * Dragonsteel one, 9781938570506). `work_key` bakes the printed title in, so
 * neither the key nor the folded title reaches the other, and `work_key` is a
 * PERSISTED key — re-deriving it is a migration, not an edit. Both instances
 * already record the other spelling as a `work_alias`, and this rung is what
 * spends it.
 *
 * The exact strings below are the two live rows, verbatim.
 */
describe('donor lookup — the alias rung, both sides (2026-08-26)', () => {
  const EMBERDARK_SUB = 'Isles of the Emberdark: A Cosmere Novel';
  const EMBERDARK_BARE = 'Isles of the Emberdark';
  const SANDERSON = 'Brandon Sanderson';

  it('main answers padhard #348 because PADHARD sent its alias', async () => {
    // main's catalog: one work, titled without the subtitle, no aliases of its
    // own. The bridge is entirely the caller's `alias=` parameter.
    const db = stubDb([workRow(4, EMBERDARK_BARE, SANDERSON, { first_published: 2025 })]);
    const reply = await matched(
      db,
      `title=${encodeURIComponent(EMBERDARK_SUB)}&author=${encodeURIComponent(SANDERSON)}` +
        `&alias=${encodeURIComponent(EMBERDARK_BARE)}`,
    );
    assert.equal(reply.matched, true, 'the recorded alias is what makes these one book');
    assert.equal(reply.workId, 4);
    assert.deepEqual(reply.details, { firstPublished: 2025 });
  });

  it('…and the same ask without the alias still misses — the alias is doing the work', async () => {
    const db = stubDb([workRow(4, EMBERDARK_BARE, SANDERSON, { first_published: 2025 })]);
    const reply = await matched(
      db,
      `title=${encodeURIComponent(EMBERDARK_SUB)}&author=${encodeURIComponent(SANDERSON)}`,
    );
    assert.equal(reply.matched, false, 'containment is 0.58 against a 0.6 floor — correctly refused');
  });

  it('padhard answers main #4 through its OWN recorded alias', async () => {
    // The other direction: the caller has nothing to send, and the responder's
    // `work_alias` row is what bridges it.
    const db = stubDb(
      [workRow(348, EMBERDARK_SUB, SANDERSON, { first_published: 2025 })],
      {},
      [{ workId: 348, alias: EMBERDARK_BARE, kind: 'title' }],
    );
    const reply = await matched(
      db,
      `title=${encodeURIComponent(EMBERDARK_BARE)}&author=${encodeURIComponent(SANDERSON)}`,
    );
    assert.equal(reply.matched, true);
    assert.equal(reply.workId, 348);
  });

  it('⚠️ a CONTAINMENT near-miss is still refused — the rung takes exact and alias only', async () => {
    // Measured 2026-08-26 over both live instances: containment would have
    // answered main #222 "Dungeon Crawler Carl: Crocodile" with padhard #25
    // "Dungeon Crawler Carl" at 0.86. Two different books, and the donor's
    // findings are applied with no person in the loop.
    const db = stubDb([workRow(25, 'Dungeon Crawler Carl', 'Matt Dinniman', { first_published: 2024 })]);
    const reply = await matched(
      db,
      `title=${encodeURIComponent('Dungeon Crawler Carl: Crocodile')}` +
        `&author=${encodeURIComponent('Matt Dinniman')}`,
    );
    assert.equal(reply.matched, false, 'containment must not reach the donor — it writes unattended');
  });

  it('the author gate still applies to an alias match', async () => {
    const db = stubDb(
      [workRow(348, EMBERDARK_SUB, 'Someone Else', { first_published: 2025 })],
      {},
      [{ workId: 348, alias: EMBERDARK_BARE, kind: 'title' }],
    );
    const reply = await matched(
      db,
      `title=${encodeURIComponent(EMBERDARK_BARE)}&author=${encodeURIComponent(SANDERSON)}`,
    );
    assert.equal(reply.matched, false, 'an alias asserts a string, not that anyone who used it wrote this');
  });

  it('an AUTHOR alias never widens the title rung — migration 0005’s `kind` doing its job', async () => {
    const db = stubDb(
      [workRow(348, EMBERDARK_SUB, SANDERSON)],
      {},
      [{ workId: 348, alias: EMBERDARK_BARE, kind: 'author' }],
    );
    const reply = await matched(
      db,
      `title=${encodeURIComponent(EMBERDARK_BARE)}&author=${encodeURIComponent(SANDERSON)}`,
    );
    assert.equal(reply.matched, false, 'an alternate AUTHOR name must never be offered as a title');
  });

  it('two works claiming the same alias still match NOBODY', async () => {
    // `buildWorkIndex` rule 2: a contested alias is dropped rather than
    // arbitrated. The ambiguity posture of the exact rung, one rung down.
    const db = stubDb(
      [workRow(1, 'Gold A', 'Raven Kennedy'), workRow(2, 'Gold B', 'Raven Kennedy')],
      {},
      [
        { workId: 1, alias: 'Gold', kind: 'title' },
        { workId: 2, alias: 'Gold', kind: 'title' },
      ],
    );
    const reply = await matched(db, `title=Gold&author=${encodeURIComponent('Raven Kennedy')}`);
    assert.equal(reply.matched, false);
  });

  it('an instance with no aliases answers exactly what it answered before this rung', async () => {
    const db = stubDb([workRow(1, 'Unsouled', 'Will Wight')]);
    const reply = await matched(db, 'title=Nonexistent');
    assert.equal(reply.matched, false);
    assert.deepEqual(reply.details, {});
    assert.equal(reply.candidates, undefined);
  });
});

// ---------------------------------------------------------------------------
// The shortlist — rung 2's raw material (owner ask 2026-08-16: "fuzzy match
// before going to web"). What it offers is what a model will be asked to
// judge, so what it REFUSES to offer is the interesting half.
// ---------------------------------------------------------------------------

describe('rankCandidates', () => {
  const rows = [
    { id: 1, title: 'Unsouled', authors: 'Will Wight' },
    { id: 2, title: 'Soulsmith', authors: 'Will Wight' },
    { id: 3, title: 'The Way of Kings', authors: 'Brandon Sanderson' },
  ];

  it('a title variant is shortlisted on the canonical similarity floor alone', () => {
    // "Unsouled (Cradle Book 1)" scores 0.5 against "Unsouled" — over
    // MIN_TITLE_SIMILARITY (0.34), which is the ported-verbatim floor this
    // must never re-implement.
    const ranked = rankCandidates(rows, 'Unsouled (Cradle Book 1)', '');
    assert.deepEqual(ranked.map((r) => r.row.id), [1]);
  });

  it('⚠️ a shared author with NO word of the title in common is never offered', () => {
    // The §4.4 failure shape with the author as the alibi: one author writes
    // forty books, and handing all forty to a judge is how the wrong one gets
    // picked. "Soulsmith" and "The Way of Kings" share no title word with
    // "Blood Line", so neither may appear however well the author matches.
    const ranked = rankCandidates(rows, 'Blood Line', 'Will Wight');
    assert.deepEqual(ranked, []);
  });

  it('an agreeing author outranks a stranger with an equally similar title', () => {
    const ambiguous = [
      { id: 10, title: 'Gold', authors: 'Chris Cleave' },
      { id: 11, title: 'Gold', authors: 'Crouch, Blake' },
    ];
    // "Crouch, Blake" against "Blake Crouch" scores 1.0 on the canonical author
    // gate; "Chris Cleave" scores 0. Both rows still travel — see the assertion.
    const ranked = rankCandidates(ambiguous, 'Gold', 'Blake Crouch');
    assert.deepEqual(
      ranked.map((r) => r.row.id),
      [11, 10],
      'the author gate ranks; it never excludes the other reading of an ambiguous fold',
    );
    assert.equal(ranked[0]?.authorAgrees, true);
    assert.equal(ranked[1]?.authorAgrees, false);
  });

  it('a whole series of near-identical titles is capped, not poured into the prompt', () => {
    const series = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      title: `The Wandering Inn Volume ${i + 1}`,
      authors: 'pirateaba',
    }));
    const ranked = rankCandidates(series, 'The Wandering Inn', 'pirateaba');
    assert.equal(ranked.length, CANDIDATE_LIMIT);
    assert.ok(CANDIDATE_LIMIT <= 5, 'every extra row is another chance to judge wrong');
  });

  it('an empty title asks for nothing rather than ranking the whole catalog', () => {
    assert.deepEqual(rankCandidates(rows, '   ', 'Will Wight'), []);
  });
});

describe('donor shortlist over the wire', () => {
  it('a miss WITH ?candidates=1 offers the near-misses and exactly what each could donate', async () => {
    const db = stubDb([
      workRow(1, 'Unsouled', 'Will Wight', {
        series: 'Cradle',
        series_index_sort: 1,
        first_published: 2016,
      }),
      workRow(2, 'Soulsmith', 'Will Wight', { first_published: 2016 }),
    ]);
    const reply = await matched(
      db,
      `title=${encodeURIComponent('Unsouled (Cradle Book 1)')}&author=${encodeURIComponent('Will Wight')}&candidates=1`,
    );
    assert.equal(reply.matched, false, 'the fold did not match — this is still a miss');
    assert.equal(reply.candidates?.length, 1);
    const [c] = reply.candidates!;
    assert.equal(c?.workId, 1);
    assert.equal(c?.fold, 'unsouled', 'the canonical fold, so the caller can see WHY the exact rung missed');
    assert.equal(c?.authorAgrees, true);
    assert.deepEqual(c?.details, { firstPublished: 2016, series: 'Cradle', seriesIndex: 1 });
  });

  it('⚠️ a candidate with nothing to donate is dropped — a judgement with no possible payoff', async () => {
    const db = stubDb([workRow(1, 'Unsouled', 'Will Wight')]); // every detail null
    const reply = await matched(
      db,
      `title=${encodeURIComponent('Unsouled (Cradle Book 1)')}&candidates=1`,
    );
    assert.deepEqual(reply.candidates, [], 'asked for, and honestly empty');
  });

  it('both readings of an ambiguous fold are offered — the rung the exact match refuses', async () => {
    // Two works sharing a folded title match NOBODY on rung 1 (above). This is
    // exactly the case rung 2 was asked for: offer both, let a judge and an
    // author line settle it.
    const db = stubDb([
      workRow(1, 'Gold', 'Author One', { first_published: 2001 }),
      workRow(2, 'Gold', 'Author Two', { first_published: 2002 }),
    ]);
    const reply = await matched(db, 'title=Gold&candidates=1');
    assert.equal(reply.matched, false);
    assert.deepEqual(reply.candidates?.map((c) => c.workId), [1, 2]);
  });
});
