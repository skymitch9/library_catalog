import type { AppUser } from '@lc/core';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  /**
   * Where an uploaded cover is stored. **Optional, and absent today.**
   *
   * ⚠️ **This is NOT the bucket `wrangler.toml` and `docs/access/cloudflare.md`
   * §7 say must never exist.** That decision is about **scan photographs**, and
   * its whole reasoning is that a photo is write-only — nothing ever read one
   * back, so the bucket's only purpose was to be emptied later and one code path
   * forgetting to delete would have kept photographs of a household indefinitely.
   *
   * A cover is the exact opposite object: it is read on every page load, forever,
   * and deleting it is the bug. The two absences are not the same absence, and
   * the photo one still holds — nothing here ever writes a scan frame.
   *
   * ## Why a binding is needed at all
   *
   * Four works in this catalog cannot get a cover from any rung (a Paw Patrol
   * shaped board book, *Home Sweet Home*, a Korean Tinyping board book, *The
   * Nightmare Before Christmas*), and five more wear a deliberate stand-in. The
   * only remaining source is a person photographing or downloading one, and that
   * image has to live somewhere this app controls. `apps/web/public/covers/` is
   * not that somewhere: it is committed to git, and this household has already
   * had a 377MB `.git` force a hosting migration.
   *
   * ⚠️ **With this undefined the upload route answers 501 and says so.** It does
   * not fall back to storing bytes in D1 — a base64 image in a row is a database
   * that gets slower every time somebody is helpful. `PUT /works/:id/cover`
   * (point at a URL somebody else hosts) needs no binding and works today.
   *
   * See `docs/access/cloudflare.md` §7 for the exact `wrangler.toml` stanza and
   * the custom-domain requirement — ⚠️ the `r2.dev` URL is rate-limited and
   * uncacheable, which is why the sibling audiobook catalog fronts its bucket
   * with a real hostname.
   */
  COVERS?: R2Bucket;

  /**
   * Public base URL for `COVERS`, no trailing slash — e.g.
   * `https://covers.heygabi.ai`.
   *
   * ⚠️ Required alongside the binding and pointedly separate from it: a Worker
   * can write to a bucket it has no idea how to serve from, and a stored object
   * whose URL nobody can construct is a cover that does not exist. The upload
   * route refuses to write unless BOTH are set, rather than storing an object
   * and then failing to record where it went.
   */
  COVERS_BASE_URL?: string;

  APP_VERSION: string;
  ENVIRONMENT: string;

  /** Comma-separated emails forced to `owner` on sign-in. A recovery hatch only. */
  OWNER_EMAILS: string;

  /**
   * The Firebase project whose Google sign-in this app trusts.
   *
   * ⚠️ **Must be the same project as `audiobook_catalog`** — `audiobook-catalog`.
   * That is the entire mechanism by which one Google account is one person
   * across both sites. A different project mints different tokens for the same
   * human and re-creates the duplicate users this exists to prevent.
   *
   * It is also both the token's `aud` and the tail of its `iss`, so it is the
   * only value the verifier needs.
   */
  FIREBASE_PROJECT_ID: string;

  /**
   * Google Books API key.
   *
   * ⚠️ Optional, and its absence is not a degraded mode — it is the *measured*
   * default. Anonymous Google Books returned HTTP 429 on 40 of 40 calls on
   * 2026-08-09 (shared unauthenticated quota, exhausted). With no key the rung
   * is skipped rather than burning a subrequest to be refused. See
   * docs/info/isbn-ladder.md.
   */
  GOOGLE_BOOKS_API_KEY?: string;

  /** Anthropic key for the research pipeline (phase 5). Secret, never in wrangler.toml. */
  ANTHROPIC_API_KEY?: string;

  /**
   * Shared secret for the ebook importer.
   *
   * ⚠️ Why a static token when everything else verifies a Firebase ID token:
   * **the importer is not a person.** The owner's requirement is unattended
   * import, and a Firebase token belongs to a human, expires in an hour, and
   * needs a browser to refresh. Firebase service accounts exist but a
   * service-account key bypasses `firestore.rules` outright, and this process
   * has no business anywhere near Firestore — it writes to D1 and nothing else.
   *
   * So it gets a token that unlocks exactly one route, and that route
   * (`/api/ingest/*`) is the narrowest in the app: it can create a work and an
   * ebook edition. It cannot read the collection, touch copies, write a review
   * or manage users.
   *
   * **Unset means the route is disabled entirely, not open.** Generate with
   * `openssl rand -hex 32`, put it in `.dev.vars`, and `npm run secrets:push`.
   */
  EBOOK_INGEST_TOKEN?: string;

  /**
   * Shared secret for the audiobook pipeline's mapping export
   * (`routes/audiobook-mapping.ts`, `GET /api/machine/audiobook-mapping`).
   *
   * Same trade as `EBOOK_INGEST_TOKEN` above and for the same reason: the
   * caller is `audiobook_catalog`'s Task Scheduler pipeline, not a person, so
   * it carries a static bearer instead of a Firebase ID token. The route is
   * read-only and answers only work ids, the audiobook title already cached
   * in `audiobook_holding`, and format labels — never a review, a copy, or
   * anything else in the collection.
   *
   * **Unset means the route is disabled entirely, not open** — see that
   * route's header. Generate with `openssl rand -hex 32`, put it in
   * `.dev.vars`, and `npm run secrets:push`. The audiobook repo holds the
   * SAME value under `LIBRARY_MAPPING_TOKEN` in its own (gitignored) `.env`.
   */
  AUDIOBOOK_MAPPING_TOKEN?: string;


  /**
   * The donor library — another instance of THIS app asked for details before
   * any paid AI lookup (owner ask 2026-08-16: *"before pinging the ai it
   * checks other libraries for answers. If I have Stormlight Archive don't
   * have her look it up"*).
   *
   * `DONOR_URL` is the donor's origin, no trailing slash — e.g.
   * `https://library.heygabi.ai`. `DONOR_TOKEN` does double duty, same value
   * both ways because the two instances are the same product:
   *
   * - **Outbound**: sent as `X-Donor-Token` when this instance's details
   *   sweep asks `DONOR_URL`'s `/api/donor/details`.
   * - **Inbound**: the gate on this instance's OWN `/api/donor/details`.
   *   ⚠️ Unset means that route answers 404 — disabled, not open, the same
   *   failure direction as `EBOOK_INGEST_TOKEN` — and unlike the ingest gate
   *   a WRONG token is also 404, not 401: a donor endpoint has exactly one
   *   legitimate caller, so there is nobody worth telling "almost".
   *
   * The sweep asks the donor only when BOTH are set. With `DONOR_URL` +
   * `DONOR_TOKEN` set and no `ANTHROPIC_API_KEY`, the sweep runs in
   * donor-only mode instead of skipping — that is what makes the friend
   * instance's hourly sweep useful with no AI key at all. Secrets via
   * `wrangler secret put DONOR_TOKEN` (already set on both instances,
   * 2026-08-16); `DONOR_URL` is a plain var in `wrangler.toml`.
   */
  DONOR_URL?: string;
  DONOR_TOKEN?: string;

  /**
   * The shared index Worker (catalog-platform/apps/index-worker), where this
   * catalog pushes its projection. See lib/index-push.ts and
   * packages/db/src/index-projection.ts.
   *
   * ⚠️ Both optional, and unset in production ON PURPOSE until the
   * dispatcher's deploy step. Unset means every push trigger logs one line
   * and does nothing — the index must never be able to stall this catalog.
   * At that step: uncomment INDEX_URL in wrangler.toml [vars] and
   * `wrangler secret put INDEX_PUSH_TOKEN` (the same value the index Worker
   * holds as its INDEX_PUSH_TOKEN_LIBRARY secret — mint one value, set it on
   * both sides).
   */
  INDEX_URL?: string;
  INDEX_PUSH_TOKEN?: string;

  /**
   * Estate auth mode: `off` | `shadow` | `enforce` — the §14.5 rollout flag
   * (catalog-platform/docs/info/estate-auth-design.md §9 step 5).
   *
   * `off` = fully inert. `shadow` calls `/seen` after local auth resolves and
   * logs what the §3.1 table WOULD decide — one `estate_shadow` JSON line per
   * request in `wrangler tail` — and never changes a response. `enforce`
   * (built in the wave-2 revision; games precedent) acts on the verdicts:
   * revoked → 403 computed-not-stored, unreachable with no standing → named
   * 503, estate-approved never-locally-decided pending → auto-grant `reader`
   * with a change_log audit row (`changed_how='auto'`). Unrecognised values
   * fall to `off`, loudly.
   *
   * ⚠️ Flipping shadow → enforce is the DISPATCHER'S evidence-gated step
   * (zero household `"would_deny":true` lines over a days-long soak), same
   * as games. Never flip it as a side effect of a deploy.
   */
  ESTATE_CHECK?: string;

  /** The estate directory — `https://auth.heygabi.ai`. Absent = estate check off, by name. */
  ESTATE_AUTH_URL?: string;

  /**
   * Per-instance posture lever: the role the estate auto-grant hands out on
   * THIS instance, overriding LIBRARY_POSTURE's `member`. Built for the
   * second instance (friend-ingest-design.md §3 — its wrangler env can say
   * `moderator` in one line); unset everywhere today, and unset or invalid
   * means the posture default, unchanged. Only `member`/`contributor`/
   * `moderator` are accepted — see `resolveDefaultRole` in
   * packages/estate-auth/src/gate.ts. ⚠️ Access-increasing to set; an
   * explicit owner decision, never a side effect.
   */
  ESTATE_DEFAULT_ROLE?: string;

  /**
   * This app's own bearer for `POST /api/estate/seen` (design §4.4 — the check
   * carries a per-app token, never the user's). Secret, set with
   * `wrangler secret put ESTATE_APP_TOKEN_LIBRARY` (or `.dev.vars` +
   * `npm run secrets:push`); the auth Worker holds the matching value under
   * the same name. ⚠️ Unset means the estate check is OFF (logged as
   * `estate_config_unset`), never half-on — the code deploys before the
   * secret exists, and that ordering must be safe.
   */
  ESTATE_APP_TOKEN_LIBRARY?: string;

  /**
   * The GABI chat panel's per-instance posture — `on` on hers, absent on ours.
   *
   * ⚠️ **Unset means OFF, and so does anything unrecognised** (`gabiPanelEnabled`
   * in `@lc/core`, which is the only thing that reads it). The design's §2 scopes
   * v1 to `padhard.heygabi.ai` — *"The main library is out of scope and stays out
   * until this has run on hers for a while"* — and the route it gates spends her
   * key's money, so a typo in a var must not switch it on for a catalog it was
   * never meant for. Same failure direction as `resolveDefaultRole` and
   * `parseEstateMode`.
   *
   * ⚠️ **It gates the ROUTE as well as the panel**, in `lib/gabi-turn.ts`.
   * Hiding a control has never been the lock in this app — `/people`'s nav
   * comment says exactly that — and one deploy serves both instances the same
   * bundle, so the flag has to mean something server-side or it means nothing.
   *
   * The posture-var idiom is `DEFAULT_THEME`'s (see `wrangler.toml`), with one
   * difference: a theme must resolve before first paint so it is read in the
   * browser from `location.hostname`, while a chat panel need not, so this one
   * is read by the Worker and reported on `/api/me` (what the app reads at boot)
   * and `/api/health` (what a curl can check with no sign-in). That is the
   * "when the Worker grows a config surface the web app reads at boot" case
   * `DEFAULT_THEME`'s own comment anticipated.
   */
  GABI_PANEL?: string;

  /**
   * Local development only. Ignored unless ENVIRONMENT is not "production", so a
   * stray value in production vars can never bypass sign-in.
   */
  DEV_EMAIL?: string;
  DEV_NAME?: string;
}

/** Values attached to the request context by middleware. */
export interface Variables {
  user: AppUser;
}

export type AppBindings = { Bindings: Env; Variables: Variables };

export function parseOwnerEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
