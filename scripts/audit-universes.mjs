/**
 * WHOLE-CATALOG UNIVERSE AUDIT — a dry run that writes nothing, ever.
 *
 * The owner: *"Run the whole catalog dry run first so we can see before we write
 * to either DB."* So there is deliberately **no `--commit` flag and no write
 * path in this file at all**. It reads `work` (SELECT only), reads the sibling
 * catalog's CSV, asks Claude, and prints. Adding a writer here later should mean
 * adding a *second* script, not a flag — the safe rehearsal cannot be a mode of
 * the dangerous thing.
 *
 * ## What is being detected
 *
 * A shared fictional **universe**, and only where naming it adds something the
 * series name does not already say: Mistborn and Stormlight → The Cosmere;
 * *Sixth of the Dusk* → The Cosmere. Not same author, not a genre, not a
 * publisher line, not a children's picture-book brand.
 *
 * ## Why the system prompt below is copied verbatim from probe-universes.mjs
 *
 * That probe scored **13/15 with zero false positives** at ~21c/100 items. Its
 * two misses were both Runnerverse and both answered `null` at **low**
 * confidence — so the gate is confidence, not a better prompt. ⚠️ Do NOT add web
 * search: measured at 16.8c for 3 items (5x the price), no better confidence,
 * and it *invented* a universe name.
 *
 *   node scripts/audit-universes.mjs --remote            # the real run
 *   node scripts/audit-universes.mjs --remote --plan     # counts + cost, no spend
 *   node scripts/audit-universes.mjs --remote --limit 60 # a cheap slice
 *
 * ⚠️ `--remote` matters. The local D1 in this checkout holds 116 works; the
 * production one holds 231. A local run silently audits half the catalog.
 * ⚠️ From a git worktree, `LC_AUDIOBOOK_ROOT` is not optional — see audiobooks.mjs.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { createClient, RESEARCH_MODEL } from '../packages/research/src/client.ts';
import { query, ROOT } from './lib/d1.mjs';
import { loadAudiobooks, AUDIOBOOK_CSV } from './lib/audiobooks.mjs';

/* ------------------------------------------------------------------ *
 * THE KNOWN-TRUTH TABLE
 *
 * ⚠️ This is the one place the owner's rulings live. It exists as a table and
 * not as prompt wording on purpose: a correction must be cheap to add and
 * visible to read, and a hint buried in the system prompt is neither. It will
 * grow every time the owner corrects something. That is the point.
 * ------------------------------------------------------------------ */

/**
 * What the model answers → what the owner calls it.
 *
 * Keys are lowercased and stripped of a leading "the". The model is quite happy
 * to answer "Cosmere", "the cosmere" or "Arand multiverse" on different rows of
 * the same run, and three spellings of one universe is three universes as far as
 * any future GROUP BY is concerned.
 */
const CANONICAL_NAMES = [
  { match: ['cosmere', 'cosmere universe'], canonical: 'The Cosmere' },
  {
    // The owner: detecting "Arand multiverse" is fine, but it is called this.
    match: ['runnerverse', 'arand multiverse', 'arand-verse', 'arandverse', 'william d. arand multiverse', 'randi darren multiverse'],
    canonical: 'Runnerverse',
  },
];

/**
 * Facts the owner has asserted that the model gets wrong unaided.
 *
 * ⚠️ `Randi Darren` is William D. Arand's pen name, so Otherlife / Selfless Hero,
 * Wild Wastes and the rest are Runnerverse too. The model answered **null** for
 * Otherlife when asked cold. Seeding it is not a shortcut past a hard question;
 * it is recording an answer the owner already knows and the model demonstrably
 * does not.
 *
 * A seed OVERRIDES the model, and the report always shows what the model said
 * anyway, so a seed that has gone stale is visible rather than silent.
 */
const KNOWN_TRUTH = [
  {
    when: { authorAnyOf: ['william d. arand', 'randi darren'] },
    universe: 'Runnerverse',
    note: "Owner's ruling: Randi Darren is William D. Arand's pen name; both bibliographies share the Runnerverse.",
  },
];

/**
 * Universe names that are never a universe, whatever the model says.
 *
 * Empty today — the probe produced zero false positives across the children's
 * picture-book traps. Here so the next correction has an obvious home rather
 * than becoming an `if` somewhere in the reporting code.
 */
const NEVER_A_UNIVERSE = [];

/* ------------------------------------------------------------------ */

/** VERBATIM from scripts/probe-universes.mjs. This wording is what scored 13/15. */
const SYSTEM = `You group books and series into shared FICTIONAL UNIVERSES.

A universe is a shared fictional continuity that spans MORE THAN ONE series, or
that a standalone book belongs to alongside other works. The Cosmere is the
canonical example: Mistborn and The Stormlight Archive are separate series set
in one universe.

Answer null unless ALL of these hold:
  1. The universe is a real, named, in-world continuity that fans and the author
     use — not a genre, not a publisher line, not a marketing brand.
  2. It spans more than one series, OR takes in standalone books beyond a
     single series.
  3. Naming it tells you something the series name does not already tell you.

⚠️ Same author is NOT a universe. Brandon Sanderson wrote both the Cosmere and
The Reckoners; Reckoners is not Cosmere. Answer null for it.

⚠️ A children's picture-book line — Bizzy Bear, Baby University, Brown Bear and
Friends — is a brand or an imprint, not a fictional universe. Answer null.

⚠️ If a series is itself the whole universe and nothing else shares it, answer
null: the series name already says everything.

Prefer null over a guess. A wrong universe is worse than no universe, because
nobody re-checks a filled-in field.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        // `id` is the probe's schema plus one field: with 40 items in a batch,
        // matching answers back by label alone is a fuzzy string compare on
        // titles that genuinely resemble each other. The echoed number is exact.
        required: ['id', 'label', 'universe', 'confidence', 'why'],
        properties: {
          id: { type: 'integer' },
          label: { type: 'string' },
          universe: { type: ['string', 'null'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          why: { type: 'string' },
        },
      },
    },
  },
};

const BATCH_SIZE = 40;
const OUT_FILE = path.join(
  process.env.LC_AUDIT_OUT_DIR ??
    'C:/Users/nbasl/AppData/Local/Temp/claude/C--Users-nbasl-OneDrive-Documents-vs-code-repos-bookbuddy/2f77a392-c766-4f88-bcd5-38c31cedbe67/scratchpad',
  'universe-audit-dryrun.json',
);

function devVar(name) {
  const f = path.join(ROOT, 'apps/worker/.dev.vars');
  if (!existsSync(f)) return undefined;
  const m = new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm').exec(readFileSync(f, 'utf8'));
  return m?.[1]?.trim();
}

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const stripThe = (s) => norm(s).replace(/^the\s+/, '');

/** The owner's spelling, or the model's if we have no ruling on it. */
function canonicalise(universe) {
  if (!universe) return null;
  const k = stripThe(universe);
  for (const row of CANONICAL_NAMES) {
    if (row.match.some((m) => stripThe(m) === k)) return row.canonical;
  }
  return String(universe).trim();
}

function seedFor(candidate) {
  const authors = norm(candidate.author);
  for (const row of KNOWN_TRUTH) {
    if (row.when.authorAnyOf?.some((a) => authors.includes(norm(a)))) return row;
    if (row.when.seriesAnyOf?.some((s) => norm(s) === norm(candidate.series))) return row;
  }
  return null;
}

/* ---------------------------- gathering ---------------------------- */

/**
 * One thing to ask about: a whole series, or a work that has no series.
 *
 * ⚠️ Keyed on **series + author**, not on a work row, and that is the shape the
 * eventual storage wants too. The same series exists in both catalogs as
 * different rows — often present in only one of them — so a key both sides can
 * compute is the only key that serves both.
 */
function addCandidate(map, { kind, series, title, author, catalog, member }) {
  const key = kind === 'series' ? `series::${norm(series)}::${norm(author)}` : `work::${norm(title)}::${norm(author)}`;
  let c = map.get(key);
  if (!c) {
    c = { key, kind, series: series ?? null, title: title ?? null, author, counts: { library: 0, audiobook: 0 }, members: [] };
    map.set(key, c);
  }
  c.counts[catalog]++;
  if (c.members.length < 25) c.members.push({ catalog, ...member });
  return c;
}

function gatherLibrary(map, remote) {
  const rows = query(
    "SELECT id, title, primary_author, series FROM work ORDER BY series, sort_title",
    { remote },
  );
  for (const r of rows) {
    const series = (r.series ?? '').trim() || null;
    const author = (r.primary_author ?? '').trim() || '(unknown)';
    addCandidate(map, {
      kind: series ? 'series' : 'work',
      series,
      title: r.title,
      author,
      catalog: 'library',
      member: { title: r.title, workId: r.id },
    });
  }
  return rows.length;
}

function gatherAudiobooks(map) {
  const rows = loadAudiobooks();
  for (const r of rows) {
    const series = r.series || null;
    const author = (r.authors || '').trim() || '(unknown)';
    addCandidate(map, {
      kind: series ? 'series' : 'work',
      series,
      title: r.title,
      author,
      catalog: 'audiobook',
      member: { title: r.title },
    });
  }
  return rows.length;
}

/* ----------------------------- asking ------------------------------ */

function labelOf(c) {
  return c.kind === 'series' ? `series: ${c.series}` : `book: ${c.title}`;
}

async function askBatch(client, batch, offset) {
  const lines = batch.map((c, i) => `${offset + i + 1}. ${labelOf(c)} — by ${c.author}`);
  const res = await client.messages.create({
    model: RESEARCH_MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: [{ type: 'text', text: SYSTEM }],
    messages: [
      {
        role: 'user',
        content: `For each of these, name the shared fictional universe, or null.

Echo back the id number and the exact label given so I can match your answers back.

${lines.join('\n')}`,
      },
    ],
  });
  if (res.stop_reason === 'max_tokens') throw new Error('answer truncated — lower BATCH_SIZE');
  const text = res.content.find((b) => b.type === 'text')?.text ?? '{}';
  return { results: JSON.parse(text).results ?? [], usage: res.usage };
}

/* ----------------------------- running ----------------------------- */

const argv = process.argv.slice(2);
const remote = argv.includes('--remote');
const plan = argv.includes('--plan');
const only = argv.includes('--library-only') ? 'library' : argv.includes('--audiobooks-only') ? 'audiobook' : null;
const limit = (() => {
  const i = argv.indexOf('--limit');
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : Infinity;
})();

if (argv.includes('--commit')) {
  console.error('This script has no --commit. It is a dry run by construction; nothing here writes.');
  process.exit(2);
}

const candidates = new Map();
let libraryRows = 0;
let audiobookRows = 0;

if (only !== 'audiobook') libraryRows = gatherLibrary(candidates, remote);
if (only !== 'library') {
  audiobookRows = gatherAudiobooks(candidates);
  if (audiobookRows === 0) {
    console.error(`No audiobooks read from ${AUDIOBOOK_CSV} — set LC_AUDIOBOOK_ROOT (you are probably in a worktree).`);
    process.exit(1);
  }
}

const all = [...candidates.values()];
const asked = all.slice(0, Number.isFinite(limit) ? limit : all.length);

const shared = all.filter((c) => c.counts.library > 0 && c.counts.audiobook > 0);
console.log(`\nlibrary_catalog   ${libraryRows} work rows`);
console.log(`audiobook_catalog ${audiobookRows} rows  (${AUDIOBOOK_CSV})`);
console.log(
  `\n${all.length} distinct things to ask about — ` +
    `${all.filter((c) => c.kind === 'series').length} series, ${all.filter((c) => c.kind === 'work').length} seriesless works`,
);
console.log(
  `  library-only ${all.filter((c) => c.counts.library > 0 && c.counts.audiobook === 0).length} · ` +
    `audiobook-only ${all.filter((c) => c.counts.audiobook > 0 && c.counts.library === 0).length} · ` +
    `in both ${shared.length}`,
);
console.log(`  ${Math.ceil(asked.length / BATCH_SIZE)} batch(es) of ${BATCH_SIZE} to ask`);

if (plan) {
  console.log('\n--plan: nothing asked, nothing spent.');
  process.exit(0);
}

const apiKey = devVar('ANTHROPIC_API_KEY');
if (!apiKey) {
  console.error('No ANTHROPIC_API_KEY in apps/worker/.dev.vars');
  process.exit(1);
}
const client = createClient(apiKey);

const started = Date.now();
let inTok = 0;
let outTok = 0;
const answers = new Map();

for (let i = 0; i < asked.length; i += BATCH_SIZE) {
  const batch = asked.slice(i, i + BATCH_SIZE);
  process.stdout.write(`  batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(asked.length / BATCH_SIZE)} … `);
  let out;
  for (let attempt = 1; ; attempt++) {
    try {
      out = await askBatch(client, batch, i);
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.log(`retry ${attempt} (${err.message})`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  inTok += out.usage.input_tokens ?? 0;
  outTok += out.usage.output_tokens ?? 0;

  const byId = new Map(out.results.map((r) => [Number(r.id), r]));
  const byLabel = new Map(out.results.map((r) => [norm(r.label), r]));
  let matched = 0;
  for (let j = 0; j < batch.length; j++) {
    const c = batch[j];
    const hit =
      byId.get(i + j + 1) ??
      byLabel.get(norm(labelOf(c))) ??
      byLabel.get(norm(c.series ?? c.title)) ??
      null;
    if (hit) matched++;
    answers.set(c.key, hit);
  }
  console.log(`${matched}/${batch.length} answered`);
}

const seconds = (Date.now() - started) / 1000;
// Claude Opus 5 list pricing, the same basis as estimateCents in packages/research.
const cents = (inTok / 1e6) * 500 + (outTok / 1e6) * 2500;

/* --------------------------- verdicts ------------------------------ */

const verdicts = asked.map((c) => {
  const raw = answers.get(c.key) ?? null;
  const modelUniverse = raw?.universe ?? null;
  const modelConfidence = raw?.confidence ?? null;
  const seed = seedFor(c);

  let universe = canonicalise(modelUniverse);
  let source = universe ? 'model' : null;
  let confidence = modelConfidence;

  if (seed) {
    universe = seed.universe;
    source = 'seed';
    confidence = 'seed';
  }
  if (universe && NEVER_A_UNIVERSE.some((n) => stripThe(n) === stripThe(universe))) {
    universe = null;
    source = 'blocked';
  }

  const applicable = Boolean(universe) && (source === 'seed' || confidence === 'high');
  const queued = Boolean(universe) && !applicable;

  return {
    key: c.key,
    kind: c.kind,
    series: c.series,
    title: c.title,
    author: c.author,
    catalogs: c.counts,
    memberCount: c.counts.library + c.counts.audiobook,
    members: c.members,
    universe,
    source,
    confidence,
    modelSaid: modelUniverse,
    modelConfidence,
    why: raw?.why ?? null,
    answered: Boolean(raw),
    applicable,
    queued,
    seedNote: seed?.note ?? null,
  };
});

/** A `series` value that is really a universe name — the shape argument. */
const universeShapedSeries = verdicts.filter(
  (v) => v.kind === 'series' && v.universe && stripThe(v.series) === stripThe(v.universe),
);

const grouped = new Map();
for (const v of verdicts.filter((x) => x.universe)) {
  if (!grouped.has(v.universe)) grouped.set(v.universe, []);
  grouped.get(v.universe).push(v);
}
const groups = [...grouped.entries()]
  .map(([universe, items]) => ({
    universe,
    items,
    works: items.reduce((n, i) => n + i.memberCount, 0),
    libraryWorks: items.reduce((n, i) => n + i.catalogs.library, 0),
    audiobookWorks: items.reduce((n, i) => n + i.catalogs.audiobook, 0),
    anyHigh: items.some((i) => i.applicable),
  }))
  .sort((a, b) => b.works - a.works || a.universe.localeCompare(b.universe));

/* ---------------------------- report ------------------------------- */

const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);

function reportFor(scope) {
  const pick = (v) => (scope === 'both' ? true : v.catalogs[scope] > 0);
  const rows = verdicts.filter(pick);
  const flagged = rows.filter((v) => v.universe);
  const high = rows.filter((v) => v.applicable);
  const q = rows.filter((v) => v.queued);
  const works = rows.reduce((n, v) => n + (scope === 'both' ? v.memberCount : v.catalogs[scope]), 0);
  const us = new Set(flagged.map((v) => v.universe));
  return { rows, flagged, high, q, works, universes: us };
}

console.log('\n' + '='.repeat(78));
console.log('UNIVERSE AUDIT — DRY RUN. Nothing was written to any database or CSV.');
console.log('='.repeat(78));

for (const scope of ['library', 'audiobook', 'both']) {
  if (only && scope !== 'both' && scope !== only) continue;
  const r = reportFor(scope);
  const name = scope === 'library' ? 'library_catalog' : scope === 'audiobook' ? 'audiobook_catalog' : 'BOTH TOGETHER';
  console.log(`\n## ${name}`);
  console.log(`   ${r.rows.length} candidates covering ${r.works} works`);
  console.log(`   ${r.flagged.length} flagged into ${r.universes.size} universe(s) · ${r.high.length} applicable · ${r.q.length} for the owner`);
}

console.log('\n' + '-'.repeat(78));
console.log('UNIVERSES FOUND — grouped, every member shown');
console.log('-'.repeat(78));
for (const g of groups) {
  console.log(`\n▸ ${g.universe}  — ${g.items.length} candidate(s), ${g.works} work(s)  [library ${g.libraryWorks} · audio ${g.audiobookWorks}]`);
  for (const i of g.items.sort((a, b) => (a.applicable === b.applicable ? 0 : a.applicable ? -1 : 1))) {
    const tag = i.source === 'seed' ? 'SEED' : (i.confidence ?? '?').toUpperCase();
    const where = `${i.catalogs.library ? 'L' + i.catalogs.library : '  '}${i.catalogs.audiobook ? ' A' + i.catalogs.audiobook : ''}`;
    console.log(`    ${i.applicable ? '✓' : '?'} ${pad(tag, 7)} ${pad(where, 8)} ${pad(i.kind === 'series' ? i.series : i.title, 46)} ${pad(i.author, 24)}`);
    if (i.source === 'seed' && i.modelSaid !== i.universe) {
      console.log(`              ↳ seeded; the model said ${i.modelSaid ?? 'null'} (${i.modelConfidence ?? '-'})`);
    }
  }
}

const queue = verdicts.filter((v) => v.queued);
console.log('\n' + '-'.repeat(78));
console.log(`THE OWNER'S QUEUE — ${queue.length} medium/low, none of these would be applied`);
console.log('-'.repeat(78));
for (const v of queue.sort((a, b) => a.universe.localeCompare(b.universe))) {
  console.log(`  ${pad(v.confidence, 7)} ${pad(v.universe, 26)} ← ${pad(v.kind === 'series' ? v.series : v.title, 42)} ${v.author}`);
  console.log(`          ${v.why ?? ''}`);
}

const unanswered = verdicts.filter((v) => !v.answered);
if (unanswered.length) {
  console.log(`\n⚠️ ${unanswered.length} candidate(s) came back with no answer at all:`);
  for (const v of unanswered) console.log(`     ${v.kind === 'series' ? v.series : v.title} — ${v.author}`);
}

console.log('\n' + '-'.repeat(78));
console.log('A UNIVERSE MASQUERADING AS A SERIES');
console.log('-'.repeat(78));
if (universeShapedSeries.length === 0) console.log('  none found');
for (const v of universeShapedSeries) {
  console.log(`  series "${v.series}" is really the universe "${v.universe}" — ${v.catalogs.library} library / ${v.catalogs.audiobook} audio work(s)`);
}

console.log('\n' + '-'.repeat(78));
console.log(`COST — ${inTok} in / ${outTok} out = ${cents.toFixed(1)}c for ${asked.length} items in ${seconds.toFixed(0)}s`);
console.log(`       ${((cents / asked.length) * 100).toFixed(1)}c per 100 items at batch size ${BATCH_SIZE}`);
console.log('-'.repeat(78));

mkdirSync(path.dirname(OUT_FILE), { recursive: true });
writeFileSync(
  OUT_FILE,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      dryRun: true,
      wrote: 'nothing',
      model: RESEARCH_MODEL,
      effort: 'low',
      webSearch: false,
      batchSize: BATCH_SIZE,
      source: {
        library: { rows: libraryRows, from: remote ? 'D1 --remote (production)' : 'D1 --local' },
        audiobook: { rows: audiobookRows, from: AUDIOBOOK_CSV },
      },
      knownTruth: { canonicalNames: CANONICAL_NAMES, seeds: KNOWN_TRUTH, neverAUniverse: NEVER_A_UNIVERSE },
      cost: { inputTokens: inTok, outputTokens: outTok, cents: Number(cents.toFixed(2)), seconds: Number(seconds.toFixed(1)) },
      totals: {
        candidates: asked.length,
        flagged: verdicts.filter((v) => v.universe).length,
        applicable: verdicts.filter((v) => v.applicable).length,
        ownerQueue: queue.length,
        unanswered: unanswered.length,
        universes: groups.length,
        inBothCatalogs: shared.length,
      },
      perCatalog: Object.fromEntries(
        ['library', 'audiobook', 'both'].map((s) => {
          const r = reportFor(s);
          return [s, { candidates: r.rows.length, works: r.works, flagged: r.flagged.length, applicable: r.high.length, ownerQueue: r.q.length, universes: [...r.universes].sort() }];
        }),
      ),
      universes: groups.map((g) => ({
        universe: g.universe,
        works: g.works,
        libraryWorks: g.libraryWorks,
        audiobookWorks: g.audiobookWorks,
        members: g.items,
      })),
      ownerQueue: queue,
      universeShapedSeries,
      unanswered,
      nulls: verdicts.filter((v) => !v.universe).map((v) => ({
        kind: v.kind,
        name: v.kind === 'series' ? v.series : v.title,
        author: v.author,
        catalogs: v.catalogs,
        confidence: v.confidence,
        why: v.why,
      })),
    },
    null,
    2,
  ),
  'utf8',
);
console.log(`\nJSON → ${OUT_FILE}`);
console.log('Dry run complete. No D1 write, no CSV write, no migration.\n');
