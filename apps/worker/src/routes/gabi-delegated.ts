/**
 * **The delegated door: GABI acting for a person who is not holding a token.**
 *
 * Owner ask, 2026-08-17, verbatim: *"Can I dm her an isbn or a photo and she
 * adds it to the catalog?"* and *"Hey Gabi, fix all my missing details… Hey
 * @Sam i went ahead and fixed all your missing stuff."* Approved as **Tier 1**
 * of the T0–T4 ladder (`catalog-platform/docs/info/gabi-application-map.md`):
 * *additive writes with easy undo, auto-apply then report.*
 *
 * ## ⚠️ THE ONE SECURITY SENTENCE THIS FILE EXISTS TO ENFORCE
 *
 * > **GABI holds no permissions.** She borrows the asker's identity, and the
 * > **destination site** — this Worker, on this instance — checks that person's
 * > own stored role before anything happens.
 *
 * So the bot's bearer proves only *"this request really came from the estate's
 * Discord Worker"*. It proves **nothing about what may be written**. The
 * authority check is `findUserByFirebaseUid` + `can(role, capability)` right
 * here, against `app_user` on THIS instance's D1 — the same `CAPABILITY_MATRIX`
 * row the equivalent button in the web app is gated on:
 *
 * | Verb | Capability | The button it borrows from |
 * |---|---|---|
 * | `add-isbn` | `editCatalog` | the scan review screen's **Add** |
 * | `run-details` | `runResearch` | the details queue's **Run** |
 * | `whoami` | — (identity only) | nothing; it writes nothing and spends nothing |
 *
 * ⚠️ **Two independent things must both be true**, and conflating them is the
 * whole class of bug this shape avoids: the *caller* must be the bot (a shared
 * secret), and the *asker* must hold the capability (a role on this instance).
 * A stolen bot token still cannot write on behalf of somebody with no account
 * here, and a moderator cannot be written for by anything but the bot.
 *
 * ## ⚠️ Mounted BEFORE `requireAuth`, the fourth machine route
 *
 * Same reasoning as `/api/ingest`, `/api/machine/audiobook-mapping` and
 * `/api/donor` (see `index.ts`): the caller is a Worker, not a browser. It has
 * no Google session and nothing to refresh a Firebase ID token with. It carries
 * a static bearer instead, and this file enforces it.
 *
 * ⚠️ **Unset `ESTATE_APP_TOKEN_DISCORD` means DISABLED, never open** — the same
 * failure direction as every other machine route here.
 *
 * ## ⚠️ Why 401 with words, where `/api/donor` answers a blank 404
 *
 * The donor route has exactly one legitimate caller holding the same secret, so
 * a mismatch is an attacker or a misconfiguration and neither is owed a hint
 * that the door exists. This route's refusals are **relayed to a person in a
 * Discord message**, and the estate's no-bare-status rule applies to them:
 * every refusal here says what happened, what it needs and how to get it, in a
 * `message` field the bot repeats verbatim. A silent 404 would surface as GABI
 * saying nothing at all, which is the one thing she must never do.
 *
 * ## Provenance: every write is stamped, and separable
 *
 * `Actor { userId: <the asker>, how: 'auto', note: 'gabi-discord' }` — the
 * `changes.ts` precedent for *"any writer that did not read the value it
 * wrote"*, with `userId` still meaning *who triggered it*. So:
 *
 *   - `SELECT * FROM change_log WHERE note LIKE 'gabi-discord%'` is the whole
 *     of what she has ever added, per book, per field, with the asker's id;
 *   - the details sweep stamps `research_run.triggered_by = <the asker>`
 *     instead of the cron's `NULL`, so *"what did GABI fill for me"* is one
 *     query and the queue page's existing **auto-applied → Undo** list is the
 *     undo, unchanged and already built.
 *
 * ## ⚠️ WHAT THIS DOOR DELIBERATELY WILL NOT DO
 *
 * **It never answers the rescan question** (`@lc/core/rescan.ts`). A barcode
 * whose book is already on the shelf can mean four different things and *"the
 * catalog cannot tell them apart"* — guessing mints phantom printings, and the
 * repo already carries residue from the version that guessed. That question is
 * a **T2 mutation** (propose → confirm), which this build does not have. GABI
 * writes nothing there and hands over the link, in words.
 *
 * **It never answers the pre-order question** either, for the same reason and
 * from the same precedent (`@lc/core/preorders.ts`).
 *
 * **It never creates an `app_user` row.** `findUserByFirebaseUid` is a lookup;
 * an unknown uid is refused in words. A door that could mint standing would be
 * the estate-grant verb the ladder puts at T4.
 */

import { Hono } from 'hono';
import {
  ROLE_LADDER,
  can,
  classifyScannedCode,
  createCopySchema,
  createEditionSchema,
  createWorkSchema,
  preorderedCopies,
  rescanChoices,
  workKeyFor,
  type AppUser,
  type Capability,
  type Role,
} from '@lc/core';
import {
  createCopy,
  createEdition,
  createWork,
  findEditionByIsbn13,
  findUserByFirebaseUid,
  findWorkByKey,
  getWork,
  listCopiesForWork,
  listEditionsForWork,
  readEstateCache,
  type Actor,
} from '@lc/db';
import { resolveIsbn } from '@lc/isbn';
import type { AppBindings, Env } from '../env.js';
import { runDetailsSweep } from '../lib/details-sweep.js';
import { secretEquals } from '../lib/secret-equals.js';

/**
 * ⚠️ **THE ALLOWLIST OF DELEGATED VERBS, as an explicit array.**
 *
 * The estate's default-deny rule, applied to a write surface: *"allowed fields
 * as an explicit array, never SELECT-*-minus-exclusions — the exclusion form
 * leaks when a column is added."* A verb absent from here has no route, and
 * `gabi-delegated.test.ts` pins the array plus each entry's capability, so a
 * fifth verb cannot arrive as a side effect of a feature.
 *
 * ⚠️ The Discord Worker keeps a MIRROR of these names in its own
 * `src/gabi-tools.ts`, in a category deliberately separate from its read-only
 * tool list, pinned by its own build-failing test. Two allowlists, two ends,
 * neither of them a denylist.
 */
export const DELEGATED_VERBS = ['whoami', 'add-isbn', 'run-details'] as const;
export type DelegatedVerb = (typeof DELEGATED_VERBS)[number];

/**
 * Which capability each writing verb borrows. `whoami` is absent on purpose —
 * it writes nothing, spends nothing and answers only about the caller's own
 * uid, so gating it would refuse the very question *"what may I do here?"*.
 */
export const DELEGATED_VERB_CAPABILITY: Record<'add-isbn' | 'run-details', Capability> = {
  'add-isbn': 'editCatalog',
  'run-details': 'runResearch',
};

/** The `change_log.note` prefix every delegated write wears. One string, so
 * *"what has GABI added"* is one `LIKE` and never a guess. */
export const GABI_DISCORD_NOTE = 'gabi-discord';

/**
 * Every worded answer this door can give, in one place — reviewable as copy,
 * testable as contract. The estate rule, without exception: say what happened,
 * say what it needs, say how to get it, and never dress a service failure as a
 * permissions failure.
 *
 * ⚠️ Written to be **repeated verbatim into a Discord message**. That is why
 * they are sentences rather than codes, and why the instance names itself:
 * somebody with an account on two shelves must be told which one changed.
 */
export const DELEGATED_MSG = {
  notConfigured:
    'The estate has not finished wiring GABI up to this catalog yet (a configuration gap on our ' +
    'side, NOT a permissions problem with your account). Nothing was changed. The owner has the ' +
    'exact step in the runbook.',
  badBearer:
    'This request did not carry the estate’s own Discord credential, so nothing was read and ' +
    'nothing was changed. If you are seeing this in a chat, it means GABI and this catalog are ' +
    'holding different values for the same secret — that is an owner fix, not yours.',
  unknownHere: (site: string) =>
    `I could not find an account for you on ${site}, so I did not change anything there. Sign in ` +
    `once at ${site} with the same Google account you linked to Discord, and ask me again — ` +
    'signing in is what creates the account I look for.',
  insufficient: (site: string, capability: Capability, role: Role, needed: readonly Role[]) =>
    `Your account on ${site} is **${role}**, and adding to the catalog there needs ` +
    `**${capability}** — which is ${needed.join(' or ')}. Nothing was changed. An owner or admin ` +
    'can change your role on the People page.',
  pendingHere: (site: string) =>
    `Your account on ${site} is still waiting to be approved, so nothing was changed. An owner ` +
    'or admin approves people on that site’s People page — once they do, ask me again.',
  revoked: (site: string) =>
    `The estate directory has your access to ${site} switched off, so nothing was changed. That ` +
    'is an estate-level decision rather than anything about this request — an owner can turn it ' +
    'back on from the estate admin page.',
  notAnIsbn: (raw: string) =>
    `**${raw}** is not a book identifier I can look up — it reads as a barcode add-on or a shop ` +
    'SKU rather than an ISBN. Send me the 13-digit number printed under the barcode (or the ' +
    '10-digit one on an older book) and I will try again.',
  asin:
    'That is an Amazon ASIN rather than an ISBN, and no free database indexes ASINs — so I have ' +
    'no way to look it up. Kindle books arrive through the ebook importer instead. If the book ' +
    'is a physical one, send me the ISBN printed under its barcode.',
  notFound: (isbn: string) =>
    `Nothing came back for **${isbn}**. That is a statement about the free book databases, not ` +
    'about the book: roughly half this library — the Kindle Unlimited and indie half — has no ' +
    'record anywhere free. Nothing was added. Adding it by hand on the site takes a moment.',
  lookupNoAuthor: (isbn: string, title: string) =>
    `**${isbn}** resolved to *${title}* but with no author recorded, and I will not file a book ` +
    'under a blank author from a chat — the author is half of how this catalog joins a book to ' +
    'its reviews. Nothing was added. The site has an explicit “Add without an author” button ' +
    'for exactly this.',
  alreadyOwned: (title: string, site: string) =>
    `That barcode is already on ${site} — it is *${title}*. Nothing was added, because it is ` +
    'already there.',
  needsAPerson: (title: string, isbn: string, site: string) =>
    `${site} already has *${title}*, but the barcode you sent (${isbn}) is not on any of its ` +
    'printings. That can mean four different things — the copy you already have, a second copy ' +
    'of it, a different printing, or a different book with the same name — and nothing the ' +
    'catalog knows can tell them apart, so I have deliberately not guessed. **Nothing was ' +
    'changed.** Open the book on the site and it will ask you the question properly.',
  preorderOnFile: (title: string, site: string) =>
    `${site} already has *${title}* with a copy recorded as on-the-way. Whether the book in ` +
    'your hands is that pre-order arriving or a separate copy is a question I must not guess — ' +
    'getting it wrong either leaves a phantom order open forever or loses what you paid. ' +
    '**Nothing was changed.** The site asks it in one tap.',
  sweepUnavailable: (site: string) =>
    `${site} has no way to look details up right now — neither an AI key nor a donor library is ` +
    'configured there. That is a configuration gap on our side, NOT a permissions problem, and ' +
    'nothing was changed.',
} as const;

/**
 * The role list a capability needs, for a refusal that says how to fix it.
 *
 * ⚠️ Derived by asking `can()` over `ROLE_LADDER` rather than reading
 * `CAPABILITY_MATRIX` a second time. This string is only ever used to WORD a
 * refusal, and a second copy of the matrix — even a read-only one — is exactly
 * the drift `capabilities.ts` exists to prevent.
 */
function rolesFor(capability: Capability): readonly Role[] {
  return (ROLE_LADDER as readonly Role[]).filter((role) => can(role, capability));
}

/**
 * Which shelf this Worker is, in words a person recognises.
 *
 * ⚠️ Derived from `ESTATE_APP`, the per-instance identity that already exists
 * (`wrangler.toml`: `library` on the main env, `library2` under
 * `[env.friend]`). Deliberately NOT from the request's Host header, which a
 * caller controls, and not a fifth hard-coded constant: the instance-identity
 * bug of 2026-08-17 was exactly a hard-coded `'library'`.
 */
export function instanceLabel(env: Pick<Env, 'ESTATE_APP'>): { app: string; site: string } {
  const app = (env.ESTATE_APP ?? 'library').trim() || 'library';
  return {
    app,
    site: app === 'library2' ? 'padhard.heygabi.ai' : 'library.heygabi.ai',
  };
}

/** The identity half of the check, with every refusal already worded. */
type Authority =
  | { ok: true; user: AppUser }
  | { ok: false; status: 403; body: Record<string, unknown> };

/**
 * Resolve the on-behalf-of uid to a person on THIS instance, and decide whether
 * they hold the capability the equivalent button needs.
 *
 * ⚠️ Order matters and is the order a person experiences: *do I exist here* →
 * *has the estate switched me off* → *am I approved* → *is my role enough*. Four
 * causes, four sentences, because they need four different fixes — the estate's
 * no-bare-status rule spelled out.
 */
async function authority(
  env: Env,
  db: D1Database,
  uid: string,
  capability: Capability,
): Promise<Authority> {
  const { site } = instanceLabel(env);
  const user = await findUserByFirebaseUid(db, uid);
  if (!user) {
    return {
      ok: false,
      status: 403,
      body: { error: 'unknown_here', message: DELEGATED_MSG.unknownHere(site) },
    };
  }

  // ⚠️ The CACHED estate status, not a fresh `/seen` call. This door is not a
  // sign-in: refreshing the directory here would put an outbound estate call on
  // a write path whose failure mode must be "refuse in words", and the cache is
  // exactly what `requireAuth` acts on for a signed-in person. A revocation
  // therefore takes effect here the moment their next sign-in records it —
  // and the local role check below stands on its own regardless.
  const estate = await readEstateCache(db, user.id);
  if (estate.status === 'revoked') {
    return {
      ok: false,
      status: 403,
      body: { error: 'estate_revoked', message: DELEGATED_MSG.revoked(site) },
    };
  }

  if (user.role === 'pending') {
    return {
      ok: false,
      status: 403,
      body: { error: 'pending', message: DELEGATED_MSG.pendingHere(site) },
    };
  }

  if (!can(user.role, capability)) {
    return {
      ok: false,
      status: 403,
      body: {
        error: 'forbidden',
        capability,
        role: user.role,
        message: DELEGATED_MSG.insufficient(site, capability, user.role, rolesFor(capability)),
      },
    };
  }

  return { ok: true, user };
}

/** The on-behalf-of uid, or null. Never trusted for anything but a lookup. */
function onBehalfOf(body: unknown): string | null {
  const uid = (body as { onBehalfOf?: unknown } | null)?.onBehalfOf;
  if (typeof uid !== 'string') return null;
  const trimmed = uid.trim();
  // Firebase uids are 28 opaque characters today; the bound is a sanity floor
  // and ceiling on a value that goes into one parameterised lookup, not a
  // format assertion about somebody else's identity system.
  return trimmed.length >= 8 && trimmed.length <= 128 ? trimmed : null;
}

export const gabiDelegatedRoutes = new Hono<AppBindings>()
  /**
   * The bearer gate. ⚠️ Unset secret = disabled, and it says so — a Worker that
   * silently opened on a missing secret is the failure direction every machine
   * route here refuses.
   */
  .use('*', async (c, next) => {
    const expected = c.env.ESTATE_APP_TOKEN_DISCORD;
    if (!expected) {
      return c.json({ error: 'not_configured', message: DELEGATED_MSG.notConfigured }, 503);
    }
    const header = c.req.header('Authorization') ?? '';
    const presented = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] ?? '';
    if (!presented || !secretEquals(presented, expected)) {
      return c.json({ error: 'unauthenticated', message: DELEGATED_MSG.badBearer }, 401);
    }
    await next();
  })

  /**
   * *"Does this person have standing here, and for what?"*
   *
   * ⚠️ **Answers 200 even when the answer is no**, which is deliberate and is
   * what makes instance routing possible: the bot asks BOTH shelves before it
   * decides where to send a write, and on a household where somebody has one
   * account, exactly one of those answers is always "not here". Turning the
   * ordinary case into an error would make the bot's routing indistinguishable
   * from an outage.
   *
   * It writes nothing, spends nothing and reveals nothing about anyone but the
   * uid asked about — which the caller already holds.
   */
  .post('/whoami', async (c) => {
    const body = await c.req.json().catch(() => null);
    const uid = onBehalfOf(body);
    const { app, site } = instanceLabel(c.env);
    if (!uid) return c.json({ error: 'bad_request', detail: 'onBehalfOf is required' }, 400);

    const user = await findUserByFirebaseUid(c.env.DB, uid);
    if (!user) return c.json({ app, site, known: false });

    const estate = await readEstateCache(c.env.DB, user.id);
    return c.json({
      app,
      site,
      known: true,
      role: user.role,
      pending: user.role === 'pending',
      estateStatus: estate.status,
      capabilities: {
        editCatalog: can(user.role, 'editCatalog'),
        runResearch: can(user.role, 'runResearch'),
        scanPhoto: can(user.role, 'scanPhoto'),
      },
    });
  })

  /**
   * **Verb 1 — add a book by ISBN, on somebody's behalf.**
   *
   * The ladder, in the order `docs/info/isbn-ladder.md` measured it:
   *
   * 1. classify the code (a five-digit price add-on and a shop SKU are the two
   *    things most often mistaken for one, and both are worded refusals);
   * 2. is that barcode already on a printing here? — answered from D1, free;
   * 3. `resolveIsbn` — Open Library (9/10, free), Google Books only with a key;
   * 4. does this catalog already hold the book? — `work_key`, the canonical
   *    fold, never a second matcher;
   * 5. write, or refuse to guess.
   *
   * ⚠️ **The auto-apply is bounded to the additive case, and that boundary is
   * the T1 promise rather than caution.** A genuinely new book is `work` +
   * `edition` + `copy`, all three revertible and all three stamped. A book the
   * catalog already holds *physically* raises the rescan question, and this
   * route hands it back rather than answering it — see the header.
   */
  .post('/add-isbn', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      onBehalfOf?: unknown;
      isbn?: unknown;
    } | null;
    const uid = onBehalfOf(body);
    if (!uid) return c.json({ error: 'bad_request', detail: 'onBehalfOf is required' }, 400);
    const raw = typeof body?.isbn === 'string' ? body.isbn.trim() : '';
    if (!raw || raw.length > 20) {
      return c.json({ error: 'bad_request', detail: 'isbn is required' }, 400);
    }

    const verdict = await authority(c.env, c.env.DB, uid, DELEGATED_VERB_CAPABILITY['add-isbn']);
    if (!verdict.ok) return c.json(verdict.body, verdict.status);
    const { site } = instanceLabel(c.env);

    const classified = classifyScannedCode(raw);
    if (classified.kind === 'ignore') {
      return c.json({ outcome: 'not_an_isbn', message: DELEGATED_MSG.notAnIsbn(raw) });
    }
    if (classified.kind === 'asin') {
      return c.json({ outcome: 'not_an_isbn', message: DELEGATED_MSG.asin });
    }

    const isbn13 = classified.isbn13;

    // Already on a printing here. Free, no network call — every successful add
    // writes `edition.isbn13` back, so the collection is its own barcode index.
    const owned = await findEditionByIsbn13(c.env.DB, isbn13);
    if (owned) {
      const work = await getWork(c.env.DB, owned.work_id);
      return c.json({
        outcome: 'already_owned',
        workId: owned.work_id,
        title: work?.title ?? null,
        message: DELEGATED_MSG.alreadyOwned(work?.title ?? 'a book already on the shelf', site),
      });
    }

    const { candidates, trace } = await resolveIsbn(isbn13, {
      ...(c.env.GOOGLE_BOOKS_API_KEY ? { googleBooksKey: c.env.GOOGLE_BOOKS_API_KEY } : {}),
      userAgent: 'library_catalog (private household catalog, GABI delegated add)',
    });
    const top = candidates[0];
    if (!top) {
      // ⚠️ The trace travels back. When a scan comes back empty the only useful
      // question is *which rung* was empty, and a trace that lives only in a
      // Worker log cannot be read from a phone — `routes/isbn.ts`'s reasoning,
      // and it holds identically for a chat.
      return c.json({ outcome: 'not_found', isbn13, trace, message: DELEGATED_MSG.notFound(isbn13) });
    }

    const title = top.title.trim();
    const authors = top.authors.trim();
    if (!title) {
      return c.json({ outcome: 'not_found', isbn13, trace, message: DELEGATED_MSG.notFound(isbn13) });
    }
    if (!authors) {
      return c.json({
        outcome: 'needs_a_person',
        isbn13,
        title,
        message: DELEGATED_MSG.lookupNoAuthor(isbn13, title),
      });
    }

    // ⚠️ `workKeyFor` — the canonical fold that produces the STORED key and the
    // join to ~870 audiobook reviews. Reused, never reimplemented (CLAUDE.md).
    const existing = await findWorkByKey(c.env.DB, workKeyFor(title, authors));

    if (existing) {
      const [editions, copies] = await Promise.all([
        listEditionsForWork(c.env.DB, existing.id),
        listCopiesForWork(c.env.DB, existing.id),
      ]);

      // The pre-order question, asked by the same pure predicate the web app
      // asks it with. Checked FIRST because it is about an object already paid
      // for, and guessing it wrong is the more expensive of the two mistakes.
      if (preorderedCopies(copies).length > 0) {
        return c.json({
          outcome: 'needs_a_person',
          workId: existing.id,
          title: existing.title,
          isbn13,
          message: DELEGATED_MSG.preorderOnFile(existing.title, site),
        });
      }

      // The rescan question — four outcomes, nothing here can tell them apart.
      if (rescanChoices(editions, copies).shouldAsk) {
        return c.json({
          outcome: 'needs_a_person',
          workId: existing.id,
          title: existing.title,
          isbn13,
          message: DELEGATED_MSG.needsAPerson(existing.title, isbn13, site),
        });
      }

      // No physical presence at all — the paperback-of-an-ebook case, where
      // `rescanChoices.shouldAsk` is false precisely because adding the FIRST
      // physical printing is what Add means. Purely additive: a printing and a
      // copy on a work that already exists.
      const actor = actorFor(verdict.user.id, `by ISBN ${isbn13}`);
      const edition = await createEdition(
        c.env.DB,
        createEditionSchema.parse(editionFrom(existing.id, isbn13, top)),
        actor,
      );
      await createCopy(
        c.env.DB,
        createCopySchema.parse({ workId: existing.id, status: 'owned', editionId: edition.id }),
        actor,
      );
      return c.json({
        outcome: 'attached',
        workId: existing.id,
        editionId: edition.id,
        title: existing.title,
        authors: existing.authors,
        publisher: top.publisher,
        year: top.publishedYear,
        message:
          `Added a printing of *${existing.title}* to ${site} — it was already catalogued ` +
          'without a physical copy, so this is the first one on the shelf.',
      });
    }

    // A genuinely new book. Work + printing + copy, one atomic-per-row batch
    // each, every one stamped and every one revertible from the book's own
    // Changes panel.
    const actor = actorFor(verdict.user.id, `by ISBN ${isbn13}`);
    const work = await createWork(
      c.env.DB,
      createWorkSchema.parse({
        title,
        authors,
        ...(top.coverUrl ? { coverUrl: top.coverUrl } : {}),
        ...(top.publishedYear ? { firstPublished: top.publishedYear } : {}),
        ...(top.openlibraryWorkId ? { openlibraryWorkId: top.openlibraryWorkId } : {}),
      }),
      actor,
    );
    const edition = await createEdition(
      c.env.DB,
      createEditionSchema.parse(editionFrom(work.id, isbn13, top)),
      actor,
    );
    await createCopy(
      c.env.DB,
      createCopySchema.parse({ workId: work.id, status: 'owned', editionId: edition.id }),
      actor,
    );

    return c.json({
      outcome: 'added',
      workId: work.id,
      editionId: edition.id,
      title: work.title,
      authors: work.authors,
      publisher: top.publisher,
      year: top.publishedYear,
      universe: work.universe,
      site,
      message:
        `Added **${work.title}** by ${work.authors} to ${site}` +
        (top.publishedYear || top.publisher
          ? ` — ${[top.publishedYear, top.publisher].filter(Boolean).join(' ')}`
          : '') +
        '.',
    });
  })

  /**
   * **Verb 2 — "fix all my missing details", attributed to the asker.**
   *
   * The hourly sweep, run once on demand. ⚠️ It is deliberately the SAME
   * function the cron runs (`lib/details-sweep.ts`) rather than a second
   * implementation: that file is where the subrequest arithmetic, the
   * donor-before-AI ladder, the never-ask-twice history and the "it never
   * throws" guarantee all live, and a chat-shaped copy of it would be a second
   * place for every one of those to be got wrong.
   *
   * The ONE thing that differs is provenance: `triggeredBy` carries the asker's
   * `app_user.id` where the cron passes `null`. That is how the run history
   * tells a person's request from the clock — without inventing a column, and
   * exactly as `POST /research/works/:id/run` already does.
   *
   * ⚠️ **Slow on purpose.** A details lookup takes 20–90 seconds and the sweep
   * may take two of them, so the CALLER is expected to have already said "on
   * it" before this returns. Answering fast and finishing in the background is
   * the failure this repo has already paid for twice (`waitUntil` cancels after
   * ~30s, silently).
   */
  .post('/run-details', async (c) => {
    const body = await c.req.json().catch(() => null);
    const uid = onBehalfOf(body);
    if (!uid) return c.json({ error: 'bad_request', detail: 'onBehalfOf is required' }, 400);

    const verdict = await authority(
      c.env,
      c.env.DB,
      uid,
      DELEGATED_VERB_CAPABILITY['run-details'],
    );
    if (!verdict.ok) return c.json(verdict.body, verdict.status);
    const { site } = instanceLabel(c.env);

    if (!c.env.ANTHROPIC_API_KEY && !(c.env.DONOR_URL && c.env.DONOR_TOKEN)) {
      return c.json(
        { outcome: 'unavailable', message: DELEGATED_MSG.sweepUnavailable(site) },
        503,
      );
    }

    const result = await runDetailsSweep(c.env, undefined, undefined, {
      triggeredBy: verdict.user.id,
    });

    return c.json({ outcome: 'swept', site, result, message: sweepSentence(result, site) });
  });

/**
 * The sweep's own numbers, as one sentence somebody can act on.
 *
 * ⚠️ **It reports what could NOT be fixed as loudly as what could**, which is
 * the owner's own wording for this feature (*"Hey @Sam i went ahead and fixed
 * all your missing stuff"* only means something if the misses are named too).
 * `queued` is the honest denominator: this queue does not converge — roughly
 * half this library has no free record anywhere — so "0 filled" is frequently
 * the correct outcome rather than a failure, and saying so is the difference
 * between a bot that looks broken and one that is being straight.
 */
export function sweepSentence(
  result: { queued: number; attempted: number; filled: number; donorFilled: number; notFound: number; errored: number; heldForPerson: number },
  site: string,
): string {
  if (result.queued === 0) {
    return `Nothing on ${site} is missing a detail I can chase — the queue is empty. Nothing to do.`;
  }
  if (result.attempted === 0) {
    return (
      `${result.queued} book${result.queued === 1 ? '' : 's'} on ${site} still ${result.queued === 1 ? 'has' : 'have'} ` +
      'a gap, but every one of them has already been asked the question it is missing and the ' +
      'answer did not exist. I did not spend anything asking again.'
    );
  }
  const parts: string[] = [];
  parts.push(
    `I filled ${result.filled} of the ${result.attempted} book${result.attempted === 1 ? '' : 's'} I looked at`,
  );
  if (result.donorFilled > 0) {
    parts.push(`${result.donorFilled} of them free from the other library rather than paid for`);
  }
  if (result.notFound > 0) {
    parts.push(`${result.notFound} came back with nothing anybody records`);
  }
  if (result.heldForPerson > 0) {
    parts.push(`${result.heldForPerson} found a maybe that I will not apply without you looking`);
  }
  if (result.errored > 0) {
    parts.push(`${result.errored} failed outright`);
  }
  return (
    `${parts.join('; ')}. ` +
    `${result.queued} book${result.queued === 1 ? '' : 's'} on ${site} still ${result.queued === 1 ? 'has' : 'have'} ` +
    'something missing — I take two an hour so I do not run the bill up, and the rest keep their turn.'
  );
}

/** The one stamp. `how: 'auto'` per `changes.ts` — GABI did not read the value
 * she wrote — with `userId` naming who asked for it. */
function actorFor(userId: number, what: string): Actor {
  return { userId, how: 'auto', note: `${GABI_DISCORD_NOTE}: added ${what}` };
}

/**
 * The printing a resolved ISBN earns.
 *
 * ⚠️ `format: 'paperback'` is the same DOCUMENTED GUESS the scan path makes
 * (`apps/web/src/lib/catalog-add.ts`): a barcode proves a printing exists and
 * does not say which one, so a hardcover scanned off its own barcode lands here
 * as a paperback. It stays the right default for the same reason it does there
 * — it is the commoner printing, and the Editions panel corrects it in one tap.
 * ⚠️ It must not silently become something cleverer here: two spellings of this
 * guess is how the two paths drift.
 */
function editionFrom(
  workId: number,
  isbn13: string,
  candidate: {
    publisher: string | null;
    publishedYear: number | null;
    coverUrl: string | null;
    pages: number | null;
    language: string | null;
    source: string;
    sourceUrl: string | null;
  },
) {
  return {
    workId,
    isbn13,
    format: 'paperback',
    publisher: candidate.publisher,
    publishedYear: candidate.publishedYear,
    pages: candidate.pages,
    language: candidate.language,
    coverUrl: candidate.coverUrl,
    source: candidate.source,
    sourceUrl: candidate.sourceUrl,
  };
}
