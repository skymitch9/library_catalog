/**
 * GABI's tool allowlist — the conversational fixer's vocabulary, expressed once.
 *
 * `docs/info/gabi-fixer-design.md` §4.1 is the whole argument; the short version
 * is the estate's own rule, applied to a surface that will outlive the person
 * who wrote it:
 *
 * > *"Export/projection surfaces are default-deny: allowed fields as an explicit
 * > array, never SELECT-*-minus-exclusions — the exclusion form leaks when a
 * > column is added."*
 *
 * A denylist here would mean that a route added six months from now becomes
 * reachable by a conversation the moment somebody writes an executor for it.
 * `GABI_TOOL_NAMES` is therefore the **allowlist of record** and everything else
 * in this file — and in the Worker, and in the browser — is checked against it.
 *
 * ## ⚠️ PHASE 1 — READ + WRITE, GOVERNED BY CONFIRM LANES
 *
 * Phase 0 was read-only. Phase 1 adds four write tools (§4.2): `research_book`,
 * `set_book_details`, `undo_changes`, `add_book_by_isbn`. Writes split into two
 * lanes (§6):
 *
 * - **Auto lane** — fills a BLANK field on ONE book, executes without asking.
 *   Relaying the server's response verbatim IS the confirmation.
 * - **Confirm lane** — overwrites, batches, or anything not explicitly asked
 *   for. GABI says what would happen and waits for "yes".
 *
 * The three cover tools and `record_gap_verdict` remain absent until a later
 * phase ships.
 *
 * ## ⚠️ Mind the load-bearing import order (CLAUDE.md)
 *
 * `constants.ts` is the leaf, `capabilities.ts` builds on it, this file builds on
 * `capabilities.ts`, and `index.ts` re-exports all three. **Nothing under `src/`
 * may import from `index.ts`** — doing so reintroduces a cycle that makes
 * `z.enum()` receive `undefined` and every write endpoint 500 with a misleading
 * message, and typecheck does not catch it.
 *
 * @see docs/info/gabi-fixer-design.md — the design, section by section
 */

import { CAPABILITY_MATRIX } from './capabilities.js';

/** Named locally rather than imported from `index.ts` — see the header. */
type CapabilityName = keyof typeof CAPABILITY_MATRIX;

/**
 * THE ALLOWLIST. Nothing GABI can do is absent from this array, and nothing in
 * this array is absent from `GABI_TOOLS` below (pinned by a test).
 *
 * Phase 1: the four read tools from phase 0, plus four write tools from §4.2.
 * The three cover tools (`list_cover_candidates`, `set_cover_from_url`,
 * `mark_cover_wrong`) and `record_gap_verdict` remain **absent** until their
 * phase ships — see the header, and `gabi-tools.test.ts`.
 */
export const GABI_TOOL_NAMES = [
  'find_book',
  'get_book',
  'list_gaps',
  'list_recent_changes',
  'research_book',
  'set_book_details',
  'undo_changes',
  'add_book_by_isbn',
  'note_about_person',
] as const;

export type GabiToolName = (typeof GABI_TOOL_NAMES)[number];

/** Which shipped slice of the design this build implements. §9. */
export const GABI_PHASE = 1;

/**
 * The turn ceiling the route refuses past (design §3.2).
 *
 * *"A runaway loop is the one way a conversational surface can spend real
 * money, and a server-side count is the only place a browser bug cannot
 * bypass."* Start at 24, which is four times the six-turn conversation §7.1
 * costs out.
 */
export const GABI_MAX_TURNS = 24;

/**
 * The batch cap — owner-approved 2026-08-17, and **not arbitrary**.
 *
 * `POST /api/research/undo` refuses more than 10 ids, and refuses rather than
 * truncating, because 10 reverts is ~40 subrequests. Design §6.3:
 *
 * > *"A batch you cannot undo in one action is a batch that should not be one
 * > action."*
 *
 * Unused in phase 0 (there is nothing to batch), recorded here because it is a
 * settled decision and because `gabi-tools.test.ts` pins it against the undo
 * route's own literal — if somebody raises one, the other goes red.
 */
export const GABI_BATCH_CAP = 10;

/** A single property in a tool's input schema. Supports primitives, objects, and arrays. */
export type GabiToolProperty = {
  type: string;
  description: string;
  enum?: readonly string[];
  /** For `type: 'object'` — nested property definitions. */
  properties?: Record<string, GabiToolProperty>;
  additionalProperties?: false;
  /** For `type: 'array'` — item schema. */
  items?: { type: string };
  /** For `type: 'array'` — max items. */
  maxItems?: number;
};

/** One tool: what the model sees, plus what the executor is allowed to do with it. */
export interface GabiTool {
  name: GabiToolName;
  /**
   * ⚠️ Prescriptive about *when* to call, not just what it does. Recent Claude
   * models reach for tools conservatively, and a trigger condition in the
   * description measurably lifts should-call rate where a bare capability
   * statement does not.
   */
  description: string;
  /** JSON Schema, Anthropic tool shape. `additionalProperties: false` throughout. */
  input_schema: {
    type: 'object';
    properties: Record<string, GabiToolProperty>;
    required: readonly string[];
    additionalProperties: false;
  };
  /** The capability the ENDPOINT this rides gates on, server-side. Never re-checked here. */
  capability: CapabilityName;
  /** HTTP methods the executor may use for this tool. Phase 0: GET only. */
  methods: readonly ('GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE')[];
  /** Whether the tool can change the catalog. ⚠️ Every phase-0 tool is `false`. */
  mutates: boolean;
}

export const GABI_TOOLS: readonly GabiTool[] = [
  {
    name: 'find_book',
    description:
      'Turn a description of a book into a work id. Call this FIRST whenever the person ' +
      'names a book by title, author, series or a vague description ("the Sanderson one ' +
      'with the wrong cover") and you do not already have its numeric id. Searches this ' +
      'catalog only. ⚠️ When more than one book matches you MUST show the candidates and ' +
      'ask which one — never pick an id yourself. Returning nothing is a real answer: it ' +
      'means the catalog does not hold that book.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Title, author, or both — whatever the person actually said.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    capability: 'read',
    methods: ['GET'],
    mutates: false,
  },
  {
    name: 'get_book',
    description:
      'Everything the catalog currently records about one book, by work id. Call this ' +
      'before saying anything about a specific book\'s details — a statement about a ' +
      'current value must come from here, not from memory. Also call it after any change ' +
      'to see what the catalog now says.',
    input_schema: {
      type: 'object',
      properties: {
        workId: { type: 'integer', description: 'The numeric work id, from find_book.' },
      },
      required: ['workId'],
      additionalProperties: false,
    },
    capability: 'read',
    methods: ['GET'],
    mutates: false,
  },
  {
    name: 'list_gaps',
    description:
      'The catalog-wide worklist: which books are missing which details, the per-field ' +
      'tally, the questions this catalog deliberately refuses to ask, and whether paid ' +
      'lookups are configured at all. Call this for "what still needs fixing?", "what is ' +
      'missing?", or before suggesting where to start.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    capability: 'read',
    methods: ['GET'],
    mutates: false,
  },
  {
    name: 'list_recent_changes',
    description:
      'What was written to the catalog lately and by whom. With no workId: the machine\'s ' +
      'recent auto-applied values across the whole catalog. With a workId: that one book\'s ' +
      'full audit trail. Call this for "what did you just do?", "what changed?", or when ' +
      'somebody wants to check up on an automatic edit.',
    input_schema: {
      type: 'object',
      properties: {
        workId: {
          type: 'integer',
          description: 'Optional. Omit for the catalog-wide list of automatic writes.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    capability: 'read',
    methods: ['GET'],
    mutates: false,
  },

  // ── Phase 1 write tools ───────────────────────────────────────────────────

  {
    name: 'research_book',
    description:
      'Trigger a paid details lookup on one book. Call this when somebody asks to fill ' +
      'in a book\'s missing details and you see blanks in get_book — it costs ~2¢ and ' +
      'writes whatever it finds automatically. One book per call; the server refuses a ' +
      'second concurrent run for the same book. After it returns, call get_book to see ' +
      'what landed and what was skipped.',
    input_schema: {
      type: 'object',
      properties: {
        workId: { type: 'integer', description: 'The numeric work id of the book to research.' },
      },
      required: ['workId'],
      additionalProperties: false,
    },
    capability: 'runResearch',
    methods: ['POST'],
    mutates: true,
  },
  {
    name: 'set_book_details',
    description:
      'Fill blank fields on one book without a paid lookup — when you already know the ' +
      'value (because the person said it, or because another tool returned it). Call this ' +
      'instead of research_book when the answer is already in the conversation. ' +
      '⚠️ In the auto lane this only fills BLANKS; overwriting a recorded value requires ' +
      'explicit confirmation first. Only the listed fields are reachable — title and ' +
      'authors are excluded by construction.',
    input_schema: {
      type: 'object',
      properties: {
        workId: { type: 'integer', description: 'The numeric work id of the book to update.' },
        fields: {
          type: 'object',
          description:
            'An object whose keys are the fields to set and whose values are the new values. ' +
            'Allowed keys: firstPublished, series, seriesIndexSort, seriesIndexDisplay, ' +
            'description, universe. Only include fields you intend to change.',
          properties: {
            firstPublished: { type: 'integer', description: 'Year of first publication.' },
            series: { type: 'string', description: 'Series name, exactly as published.' },
            seriesIndexSort: { type: 'number', description: 'Numeric sort position within the series.' },
            seriesIndexDisplay: { type: 'string', description: 'Display form of the volume number (e.g. "2.5", "Part 1").' },
            description: { type: 'string', description: 'A brief description or blurb for the book.' },
            universe: { type: 'string', description: 'The shared fictional universe this book belongs to.' },
          },
          additionalProperties: false,
        },
      },
      required: ['workId', 'fields'],
      additionalProperties: false,
    },
    capability: 'runResearch',
    methods: ['PATCH'],
    mutates: true,
  },
  {
    name: 'undo_changes',
    description:
      'Revert one or more recent auto-applied changes by their finding ids. Call this ' +
      'when somebody says "undo that", "take that back", or "revert the last change". ' +
      'Use list_recent_changes first to find the finding ids. ' +
      `⚠️ Maximum ${GABI_BATCH_CAP} ids per call — the server refuses rather than ` +
      'truncating. Only machine-written values (decided_how = \'auto\') are revertible; ' +
      'a value a person typed cannot be undone this way.',
    input_schema: {
      type: 'object',
      properties: {
        findingIds: {
          type: 'array',
          description: `Array of finding ids to revert. At most ${GABI_BATCH_CAP}.`,
          items: { type: 'integer' },
          maxItems: GABI_BATCH_CAP,
        },
      },
      required: ['findingIds'],
      additionalProperties: false,
    },
    capability: 'runResearch',
    methods: ['POST'],
    mutates: true,
  },
  {
    name: 'add_book_by_isbn',
    description:
      'Add a new book to the catalog by ISBN. Call this when somebody says "add this ' +
      'book" and provides an ISBN (10 or 13 digits). The server creates the work from ' +
      'the ISBN\'s metadata. If the book is already in the catalog the server will say ' +
      'so — this is not a duplicate risk, it is an answer.',
    input_schema: {
      type: 'object',
      properties: {
        isbn: {
          type: 'string',
          description: 'The ISBN-10 or ISBN-13, digits only (no hyphens).',
        },
      },
      required: ['isbn'],
      additionalProperties: false,
    },
    capability: 'runResearch',
    methods: ['POST'],
    mutates: true,
  },

  // ── Personal context tool ─────────────────────────────────────────────────

  {
    name: 'note_about_person',
    description:
      'Record something you learned about this person for future conversations. Call this ' +
      'when they state a preference ("I don\'t like spoilers"), tell you what to call them, ' +
      'mention how they read (audiobook vs print), or ask you to remember something. ' +
      'Do NOT record what books they own — the catalog already knows. Do NOT record ' +
      'temporary facts or things from the current conversation that will be in the ' +
      'memory window anyway.',
    input_schema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'One short sentence (max 120 chars) about the person.' },
        kind: { type: 'string', enum: ['preference', 'thread', 'name'], description: 'preference = a lasting preference. thread = something to follow up on later. name = what to call them.' },
      },
      required: ['note', 'kind'],
      additionalProperties: false,
    },
    capability: 'read',
    methods: ['POST'],
    mutates: false,
  },
];

/** The one place anything decides whether a tool name is allowed. Default-deny. */
export function isGabiToolName(name: unknown): name is GabiToolName {
  return typeof name === 'string' && (GABI_TOOL_NAMES as readonly string[]).includes(name);
}

/** The definition for an allowlisted name, or `null`. Never throws on junk input. */
export function gabiToolByName(name: unknown): GabiTool | null {
  if (!isGabiToolName(name)) return null;
  return GABI_TOOLS.find((t) => t.name === name) ?? null;
}

/**
 * Whether the chat panel is visible on THIS instance.
 *
 * ⚠️ **A posture var, resolved by a pure function, exactly as `DEFAULT_THEME`
 * is** — the idiom that work established (`apps/web/test/
 * instance-default-theme.test.ts`): `wrangler.toml` is the posture of record,
 * one function reads it, and a test pins the two together so they cannot drift.
 *
 * The difference from `DEFAULT_THEME` is where it is resolved. A theme has to
 * be settled before first paint, so that one is read in `index.html` from
 * `location.hostname`; a chat panel is not, so this one is read by the Worker
 * and reported on `/api/me` (what the app reads at boot) and `/api/health`
 * (what a curl can check without signing in). That is the "when the Worker
 * grows a config surface the web app reads at boot" case `wrangler.toml`'s own
 * `DEFAULT_THEME` comment anticipated.
 *
 * **Unset means OFF**, and unrecognised means OFF: the feature is Samantha's
 * instance only in v1 (design §2), and a typo in a var must not switch a
 * money-spending surface on for a catalog it was never meant for.
 */
export function gabiPanelEnabled(raw: string | undefined | null): boolean {
  return (raw ?? '').trim().toLowerCase() === 'on';
}
