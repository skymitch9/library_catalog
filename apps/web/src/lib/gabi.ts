/**
 * The executor: a `tool_use` block becomes an authenticated request this app
 * already makes.
 *
 * `docs/info/gabi-fixer-design.md` §10 splits the feature into three parts, and
 * **this file is the only one that is per-front-end**:
 *
 * | Part | Where | Front-end specific? |
 * |---|---|---|
 * | Tool definitions + allowlist | `@lc/core` | No |
 * | `POST /api/gabi/turn` | her Worker | No |
 * | **The executor** | here | **Yes. This is the whole difference** |
 *
 * A Discord front end would write its own version of this file and reuse the
 * other two unchanged. That is the entire reason the split exists.
 *
 * ## ⚠️ IT CANNOT FETCH, AND THAT IS DELIBERATE
 *
 * Nothing here builds a URL, sets a header or touches `fetch`. It takes a
 * `GabiReadApi` — six functions the panel wires straight to `api.ts` — so the
 * only way a tool call can reach the network is through the client that already
 * knows how a request is authenticated. `middleware/auth.ts`'s header names the
 * one thing not to copy from the audiobook site, and a chat panel is exactly
 * where somebody would be tempted:
 *
 * > *`audiobook_catalog/site/identity.js` … its own `isAdmin()` is "PRESENTATION
 * > ONLY … not, and cannot be, an access control." This app keeps the token live
 * > and sends it, because here it IS the access control. A GABI panel must use
 * > `api.ts`, not a hand-rolled fetch.*
 *
 * Making that structural rather than remembered is what the injected shape buys.
 * It also makes this file a LEAF — `apps/web/test/errors.test.ts` records why
 * that matters: anything reaching `api.ts` → `firebase.ts` reads
 * `import.meta.env`, which is `undefined` outside Vite, so a test importing it
 * dies at module load before any assertion runs.
 *
 * ## ⚠️ Every result is an EXPLICIT projection, never the raw response
 *
 * Two reasons, and the first is the estate's standing rule: *"Export/projection
 * surfaces are default-deny: allowed fields as an explicit array, never
 * SELECT-*-minus-exclusions — the exclusion form leaks when a column is added."*
 * A tool result goes into a model's context and then into a transcript; a column
 * added to `work` next year must not arrive there because nobody remembered to
 * exclude it. The second is cost: every field costs tokens on every subsequent
 * turn of the conversation, because the whole history is re-sent each time.
 */

import { isGabiToolName, GABI_BATCH_CAP, type GabiToolName } from '@lc/core';

/**
 * The six calls phase 0's four tools need, as functions rather than an object,
 * so this file cannot reach anything the panel did not hand it.
 *
 * ⚠️ `GET /api/works/match` is deliberately NOT among them, though design §4.2
 * lists it beside the collection search for `find_book`. It computes an EXACT
 * `work_key` from a title *and* an author and is the dedupe front door — "do we
 * already hold this?" — not a search. A conversational query is one free string,
 * so using it would mean splitting that string into title and author by guess,
 * and a wrong guess there returns nothing while looking like an answer. The
 * collection search already handles a partial phrase. Revisit if a phase ever
 * has both halves separately.
 */
export interface GabiReadApi {
  /** `GET /api/collection?q=` — the searchable list, capability `read`. */
  searchCollection: (query: string) => Promise<unknown>;
  /** `GET /api/works/:id` — one book with everything, capability `read`. */
  work: (workId: number) => Promise<unknown>;
  /** `GET /api/research/queue` — the worklist and the per-field tally. */
  queue: () => Promise<unknown>;
  /** `GET /api/research/auto-applied` — what the machine wrote lately. */
  autoApplied: (limit: number) => Promise<unknown>;
  /** `GET /api/works/:id/changes` — one book's audit trail. */
  workChanges: (workId: number) => Promise<unknown>;
}

/**
 * Phase 1 write methods. Each rides the same authenticated path the UI does.
 * The panel wires these to `api.ts` just like the read methods.
 */
export interface GabiWriteApi {
  /** `POST /api/research/works/:id/run` — trigger a paid details lookup. */
  researchBook: (workId: number) => Promise<unknown>;
  /** `PATCH /api/works/:id` — fill blank fields on one book. */
  setBookDetails: (workId: number, fields: Record<string, unknown>) => Promise<unknown>;
  /** `POST /api/research/undo` — revert auto-applied changes by finding ids. */
  undoChanges: (findingIds: number[]) => Promise<unknown>;
  /** `POST /api/works` — add a new book by ISBN. */
  addBookByIsbn: (isbn: string) => Promise<unknown>;
  /** `POST /api/gabi/note` — record something GABI learned about this person. */
  noteAboutPerson: (note: string, kind: string) => Promise<unknown>;
}

/** What the panel renders and what goes back to the model as a `tool_result`. */
export interface GabiToolOutcome {
  toolUseId: string;
  name: string;
  /** ⚠️ `true` maps to `tool_result.is_error`. The model relays, never invents. */
  isError: boolean;
  /** The projection, or the server's own words about why there is none. */
  result: unknown;
}

/** How many candidates a disambiguation question may offer before it is a list. */
export const GABI_MAX_CANDIDATES = 8;
/** How many gap rows `list_gaps` carries. The TALLY is the information; rows are examples. */
export const GABI_MAX_GAP_ROWS = 15;
/** How many audit rows `list_recent_changes` carries. */
export const GABI_MAX_CHANGE_ROWS = 20;

// ── projections ─────────────────────────────────────────────────────────────

function pick<T extends Record<string, unknown>>(row: unknown, keys: readonly string[]): T {
  const out: Record<string, unknown> = {};
  if (typeof row !== 'object' || row === null) return out as T;
  for (const key of keys) {
    const value = (row as Record<string, unknown>)[key];
    // Undefined is dropped; null is KEPT. In this catalog they mean different
    // things — a null `series` is "nobody has recorded one", which is exactly
    // the fact GABI most often has to distinguish from "this book has none".
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

/** The columns a search hit shows. Enough to tell two books apart, and no more. */
const CANDIDATE_FIELDS = ['id', 'title', 'authors', 'series', 'seriesIndexDisplay'] as const;

/** ⚠️ Explicit, and NOT `work` minus a few. `workKey` in particular never leaves. */
const BOOK_FIELDS = [
  'id',
  'title',
  'subtitle',
  'authors',
  'illustrator',
  'series',
  'seriesIndexDisplay',
  'firstPublished',
  'description',
  'coverUrl',
  'coverStatus',
] as const;

const GAP_ROW_FIELDS = ['workId', 'title', 'authors', 'missingLabels', 'pending'] as const;
const TALLY_FIELDS = ['field', 'label', 'missing', 'filled', 'none', 'unknown'] as const;
const APPLIED_FIELDS = ['findingId', 'workId', 'title', 'field', 'value', 'sourceTier', 'appliedAt'] as const;
const CHANGE_FIELDS = ['field', 'oldValue', 'newValue', 'changedByName', 'changedHow', 'note', 'createdAt'] as const;

// ── Phase 1 write-tool projections ──────────────────────────────────────────

/**
 * Fields to forward from the `run` object a `POST /api/research/works/:id/run`
 * response carries (a `RunView`). ⚠️ These are read from `answer.run`, NOT the
 * top-level body: the endpoint returns `{ run, alreadyRunning, findings,
 * missing }`, and the old list (`status`/`runId`/`filled`/`skipped`/`message`)
 * named nothing that exists anywhere on the response — so `research_book`
 * forwarded only `{ workId }` and a lookup that came back an error was
 * indistinguishable from one that filled every field. `detail` is the run's own
 * human sentence ("Wrote 2 of 3…"); `applied` vs `proposed` is what was written
 * vs found.
 */
const RESEARCH_RESULT_FIELDS = ['status', 'applied', 'proposed', 'detail'] as const;
/** Fields to forward from a `PATCH /api/works/:id` response. */
const PATCH_RESULT_FIELDS = ['updated', 'message', 'work'] as const;
/** Fields to forward from a `POST /api/research/undo` response. */
const UNDO_RESULT_FIELDS = ['reverted', 'failed', 'message'] as const;
/** Fields to forward from a `POST /api/works` (add by ISBN) response. */
const ADD_BOOK_RESULT_FIELDS = ['workId', 'title', 'authors', 'message', 'alreadyExists'] as const;
/** The only fields `set_book_details` ever sends in its PATCH body. */
const SET_DETAILS_FIELDS = ['firstPublished', 'series', 'seriesIndexSort', 'description', 'universe'] as const;

function rowsOf(value: unknown, key: string): unknown[] {
  if (typeof value !== 'object' || value === null) return [];
  const rows = (value as Record<string, unknown>)[key];
  return Array.isArray(rows) ? rows : [];
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return null;
  return (value as Record<string, unknown>)[key] ?? null;
}

// ── the executor ────────────────────────────────────────────────────────────

/**
 * Run one tool call.
 *
 * ⚠️ **Default-deny.** A name that is not in `GABI_TOOL_NAMES` is refused here
 * as well as at the turn route, in words the model relays. Two checks, because
 * they fail in different places: the route's guard stops a forged conversation
 * from reaching the model, and this one stops anything the model does emit from
 * reaching an endpoint. Neither is redundant, and neither is the access control
 * — that is the capability gate on the endpoint itself, server-side.
 *
 * ⚠️ **Never throws.** A failed call becomes an `is_error` result carrying the
 * server's own sentence, and the loop continues (§8, row 1). A thrown error
 * would kill the turn and leave the model unable to say what happened — which
 * is the difference between "GABI says the lookup was refused because it needs
 * the moderator role" and a panel that just stops.
 */
export async function executeGabiTool(
  api: GabiReadApi & GabiWriteApi,
  call: { id: string; name: string; input: unknown },
  describeError: (err: unknown) => string,
): Promise<GabiToolOutcome> {
  const base = { toolUseId: call.id, name: call.name };

  if (!isGabiToolName(call.name)) {
    return {
      ...base,
      isError: true,
      result: {
        error: `GABI has no tool called '${call.name}'.`,
        detail:
          'That is not something it can do from here. Nothing was attempted and nothing changed.',
      },
    };
  }

  const input = (typeof call.input === 'object' && call.input !== null ? call.input : {}) as Record<
    string,
    unknown
  >;

  try {
    return { ...base, isError: false, result: await run(api, call.name, input) };
  } catch (err) {
    // The endpoints word themselves — `capabilityDenied` returns a role and a
    // sentence, `describeError` turns any of them into that sentence. The loop's
    // error vocabulary is the app's error vocabulary, unchanged (§8).
    return { ...base, isError: true, result: { error: describeError(err) } };
  }
}

async function run(
  api: GabiReadApi & GabiWriteApi,
  name: GabiToolName,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'find_book': {
      const query = String(input['query'] ?? '').trim();
      if (!query) return { candidates: [], total: 0, note: 'No search text was given.' };

      const answer = await api.searchCollection(query);
      const rows = rowsOf(answer, 'rows');
      const total = Number(field(answer, 'total') ?? rows.length);
      return {
        query,
        total,
        candidates: rows.slice(0, GABI_MAX_CANDIDATES).map((r) => pick(r, CANDIDATE_FIELDS)),
        // ⚠️ The instruction the model needs at the moment it is tempted to
        // guess, carried IN the result rather than only in the system prompt.
        // A wrong id is how the wrong book gets edited in a later phase.
        note:
          total === 0
            ? 'This catalog holds no book matching that. That is an answer, not a failure.'
            : total === 1
              ? 'Exactly one match.'
              : `${total} books match. Show these and ask which one — do not choose.`,
      };
    }

    case 'get_book': {
      const workId = Number(input['workId']);
      if (!Number.isInteger(workId) || workId <= 0) {
        return { error: 'That is not a work id. Use find_book first.' };
      }
      const answer = await api.work(workId);
      const editions = rowsOf(answer, 'editions');
      const copies = rowsOf(answer, 'copies');
      return {
        book: pick(field(answer, 'work'), BOOK_FIELDS),
        universe: field(answer, 'universe'),
        // Counts rather than rows: "does this book have editions" is the
        // question a conversation asks, and the rows would be most of the tokens.
        editions: editions.length,
        copies: copies.length,
        openWatches: rowsOf(answer, 'watches').filter((w) => !field(w, 'resolvedAt')).length,
        note:
          'A null field means nobody has recorded that value — not that the book has none.',
      };
    }

    case 'list_gaps': {
      const answer = await api.queue();
      const works = rowsOf(answer, 'works');
      return {
        // The tally IS the information. Measured against production 2026-08-10:
        // every work is missing its year and its description, so a bare list of
        // rows says the same two words 116 times and carries nothing.
        summary: rowsOf(answer, 'summary').map((s) => pick(s, TALLY_FIELDS)),
        refused: field(answer, 'refused'),
        booksNeedingDetails: works.length,
        examples: works.slice(0, GABI_MAX_GAP_ROWS).map((w) => pick(w, GAP_ROW_FIELDS)),
        truncated: works.length > GABI_MAX_GAP_ROWS,
        /** False means no Anthropic key here, so no paid lookup can be run at all. */
        lookupsConfigured: field(answer, 'configured'),
      };
    }

    case 'list_recent_changes': {
      const raw = input['workId'];
      if (raw === undefined || raw === null || raw === '') {
        const answer = await api.autoApplied(GABI_MAX_CHANGE_ROWS);
        return {
          scope: 'everything the machine wrote lately, newest first',
          applied: rowsOf(answer, 'applied')
            .slice(0, GABI_MAX_CHANGE_ROWS)
            .map((a) => pick(a, APPLIED_FIELDS)),
        };
      }
      const workId = Number(raw);
      if (!Number.isInteger(workId) || workId <= 0) {
        return { error: 'That is not a work id. Omit it for the catalog-wide list.' };
      }
      const answer = await api.workChanges(workId);
      const changes = rowsOf(answer, 'changes');
      return {
        scope: `the audit trail for work ${workId}, newest first`,
        changes: changes.slice(0, GABI_MAX_CHANGE_ROWS).map((c) => pick(c, CHANGE_FIELDS)),
        truncated: changes.length > GABI_MAX_CHANGE_ROWS,
        note:
          "changedHow 'auto' means nobody read the value before it landed; 'human' means somebody did.",
      };
    }

    // ── Phase 1 write tools ─────────────────────────────────────────────────

    case 'research_book': {
      const workId = Number(input['workId']);
      if (!Number.isInteger(workId) || workId <= 0) {
        return { error: 'That is not a work id. Use find_book first.' };
      }
      const answer = await api.researchBook(workId);
      // The outcome lives on `answer.run` (a RunView); an error response never
      // reaches here — `request()` throws ApiError on non-2xx and the executor's
      // catch turns it into an explicit `{ error }`.
      const run = field(answer, 'run');
      return {
        workId,
        runId: field(run, 'id'),
        alreadyRunning: field(answer, 'alreadyRunning') ?? false,
        // How many findings are still pending for a person (a value that could
        // not be applied). Normally 0.
        pending: rowsOf(answer, 'findings').length,
        ...pick(run, RESEARCH_RESULT_FIELDS),
      };
    }

    case 'set_book_details': {
      const workId = Number(input['workId']);
      if (!Number.isInteger(workId) || workId <= 0) {
        return { error: 'That is not a work id. Use find_book first.' };
      }
      const fields = input['fields'];
      if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
        return { error: 'fields must be an object with the values to set.' };
      }
      // ⚠️ Only forward allowed keys — the wrapper builds the body from a fixed
      // field list, never forwarding the model's object verbatim.
      const allowed = pick<Record<string, unknown>>(fields, SET_DETAILS_FIELDS);
      if (Object.keys(allowed).length === 0) {
        return { error: 'No recognised fields to set. Allowed: firstPublished, series, seriesIndexSort, description, universe.' };
      }
      const answer = await api.setBookDetails(workId, allowed);
      return {
        workId,
        ...pick(answer, PATCH_RESULT_FIELDS),
      };
    }

    case 'undo_changes': {
      const findingIds = input['findingIds'];
      if (!Array.isArray(findingIds) || findingIds.length === 0) {
        return { error: 'findingIds must be a non-empty array of finding ids.' };
      }
      const ids = findingIds
        .slice(0, GABI_BATCH_CAP)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0);
      if (ids.length === 0) {
        return { error: 'None of the provided ids are valid integers.' };
      }
      const answer = await api.undoChanges(ids);
      return {
        ...pick(answer, UNDO_RESULT_FIELDS),
      };
    }

    case 'add_book_by_isbn': {
      const isbn = String(input['isbn'] ?? '').trim();
      if (!isbn) {
        return { error: 'An ISBN is required.' };
      }
      const answer = await api.addBookByIsbn(isbn);
      return {
        isbn,
        ...pick(answer, ADD_BOOK_RESULT_FIELDS),
      };
    }

    case 'note_about_person': {
      const note = String(input['note'] ?? '').trim().slice(0, 120);
      const kind = String(input['kind'] ?? 'preference');
      if (!note) return { error: 'A note is required.' };
      await api.noteAboutPerson(note, kind);
      return { saved: true, note, kind };
    }
  }
}
