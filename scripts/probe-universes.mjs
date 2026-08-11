/**
 * A CHEAP PROBE, not a feature. Can an LLM group series into shared universes?
 *
 * The owner asked for this before any real spend: *"Run some dry run samples by
 * yourself first to get a good idea of how well it will work before spending LLM
 * credits on it."* So this asks about a handful of series whose answers are
 * already known, and scores itself.
 *
 * ## What is actually being tested
 *
 * Not "does it know what the Cosmere is" — it does. The hard part is the owner's
 * constraint: **the flag may only exist where it adds something the series does
 * not already say.**
 *
 *   * Mistborn and Stormlight are different series, one universe → flag both.
 *   * Reckoners is the SAME AUTHOR and NOT the Cosmere → the trap. An LLM that
 *     groups by author scores well on the easy rows and fails this one.
 *   * Super Sales on Super Heroes and Fostering Faust are different authors'
 *     worlds sharing the Runnerverse → flag both. Author grouping cannot find it.
 *   * *The Frugal Wizard's Handbook* sits in the same publishing set as three
 *     Cosmere books and is not Cosmere → the second trap.
 *   * A children's picture-book line like Bizzy Bear is a brand, not a universe.
 *     Answering "Bizzy Bear universe" is a false positive, and this catalog is
 *     mostly children's books, so that failure would be the loudest one.
 *
 * ⚠️ Cost is the point of the probe. One call, low effort, no web search.
 *
 *   node scripts/probe-universes.mjs
 */

import { createClient, RESEARCH_MODEL } from '../packages/research/src/client.ts';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/d1.mjs';

function devVar(name) {
  const f = path.join(ROOT, 'apps/worker/.dev.vars');
  if (!existsSync(f)) return undefined;
  const m = new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm').exec(readFileSync(f, 'utf8'));
  return m?.[1]?.trim();
}

/** Real rows from this catalog, plus the two the owner named. Known answers. */
const CASES = [
  { series: 'Mistborn', author: 'Brandon Sanderson', expect: 'Cosmere' },
  { series: 'The Stormlight Archive', author: 'Brandon Sanderson', expect: 'Cosmere' },
  { series: 'Reckoners', author: 'Brandon Sanderson', expect: null },
  { series: 'Legion', author: 'Brandon Sanderson', expect: null },
  { series: null, title: 'Tress of the Emerald Sea', author: 'Brandon Sanderson', expect: 'Cosmere' },
  { series: null, title: "The Frugal Wizard's Handbook for Surviving Medieval England", author: 'Brandon Sanderson', expect: null },
  { series: null, title: 'Yumi and the Nightmare Painter', author: 'Brandon Sanderson', expect: 'Cosmere' },
  { series: 'Super Sales on Super Heroes', author: 'William D. Arand', expect: 'Runnerverse' },
  { series: 'Fostering Faust', author: 'William D. Arand', expect: 'Runnerverse' },
  { series: 'The Divine Dungeon', author: 'Dakota Krout', expect: 'ANY' },
  { series: 'The Completionist Chronicles', author: 'Dakota Krout', expect: 'ANY' },
  { series: 'Bizzy Bear', author: 'Benji Davies', expect: null },
  { series: 'Brown Bear and Friends', author: 'Bill Martin Jr.', expect: null },
  { series: 'Baby University', author: 'Chris Ferrie', expect: null },
  { series: null, title: 'Project Hail Mary', author: 'Andy Weir', expect: null },
];

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
        required: ['label', 'universe', 'confidence', 'why'],
        properties: {
          label: { type: 'string' },
          universe: { type: ['string', 'null'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          why: { type: 'string' },
        },
      },
    },
  },
};

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

const apiKey = devVar('ANTHROPIC_API_KEY');
if (!apiKey) {
  console.error('No ANTHROPIC_API_KEY in apps/worker/.dev.vars');
  process.exit(1);
}

const lines = CASES.map((c, i) => {
  const label = c.series ? `series: ${c.series}` : `book: ${c.title}`;
  return `${i + 1}. ${label} — by ${c.author}`;
});

const client = createClient(apiKey);
const started = Date.now();
const res = await client.messages.create({
  model: RESEARCH_MODEL,
  max_tokens: 4000,
  thinking: { type: 'adaptive' },
  output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
  system: [{ type: 'text', text: SYSTEM }],
  messages: [
    {
      role: 'user',
      content: `For each of these, name the shared fictional universe, or null.

Use the exact label given so I can match your answers back.

${lines.join('\n')}`,
    },
  ],
});

const text = res.content.find((b) => b.type === 'text')?.text ?? '{}';
const out = JSON.parse(text);
const got = new Map(out.results.map((r) => [String(r.label).toLowerCase(), r]));

let right = 0;
let falsePositives = 0;
let falseNegatives = 0;
console.log('');
for (const c of CASES) {
  const key = (c.series ?? c.title).toLowerCase();
  const hit =
    got.get(key) ??
    [...got.values()].find((r) => String(r.label).toLowerCase().includes(key)) ??
    null;
  const answer = hit?.universe ?? null;

  let verdict;
  if (c.expect === 'ANY') verdict = answer ? 'ok(any)' : 'MISS';
  else if (c.expect === null) verdict = answer === null ? 'ok' : 'FALSE POSITIVE';
  else verdict = answer && answer.toLowerCase().includes(c.expect.toLowerCase()) ? 'ok' : 'WRONG';

  if (verdict.startsWith('ok')) right++;
  else if (verdict === 'FALSE POSITIVE') falsePositives++;
  else falseNegatives++;

  console.log(
    `  ${verdict.padEnd(15)} ${(c.series ?? c.title).slice(0, 42).padEnd(44)} → ${String(answer ?? 'null').padEnd(14)} ${hit?.confidence ?? ''}`,
  );
  if (!verdict.startsWith('ok')) console.log(`                  expected ${c.expect ?? 'null'} — model said: ${hit?.why ?? '(no answer)'}`);
}

const u = res.usage;
// Opus 5 list pricing, matching COVER_CENTS_EACH's basis.
const cents = ((u.input_tokens / 1e6) * 5 + (u.output_tokens / 1e6) * 25) * 100;
console.log(`\n  ${right}/${CASES.length} correct · ${falsePositives} false positive(s) · ${falseNegatives} missed`);
console.log(`  ${u.input_tokens} in / ${u.output_tokens} out = ${cents.toFixed(2)}c for ${CASES.length} items in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`  ⇒ roughly ${((cents / CASES.length) * 100).toFixed(1)}c per 100 items at this batch size.`);
