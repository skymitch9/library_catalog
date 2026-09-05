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

  /**
   * Hardcover.app GraphQL API token (Bearer). Optional — the free-details ladder
   * skips its Hardcover rung when unset, same as Google Books. Hardcover answers
   * description AND structured series+volume in one call; see
   * docs/info/scan-metadata-fill-strategy.md. Free key at hardcover.app/account/api.
   */
  HARDCOVER_API_TOKEN?: string;

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
   * ⚠️ **The estate Discord Worker's bearer for the DELEGATED GABI verbs**
   * (`routes/gabi-delegated.ts`, built 2026-08-18 for the owner's Tier-1
   * approval: *"Can I dm her an isbn or a photo and she adds it to the
   * catalog?"*).
   *
   * The estate's established *one value, two holders, the same NAME on both
   * sides* idiom — `DONOR_TOKEN`'s shape, and `INDEX_PUSH_TOKEN`'s: the value
   * is minted once and piped to `catalog-platform/apps/discord-worker` AND to
   * both instances of this Worker. Generate with `openssl rand -hex 32`; never
   * echoed, never printed, never in a file this repo tracks.
   *
   * ⚠️ **What holding it does and does not buy.** It proves only *"this request
   * came from the estate's Discord Worker"*. It authorises **no write on its
   * own**: every writing verb also resolves the on-behalf-of Firebase uid to an
   * `app_user` row ON THIS INSTANCE and checks that person's real capability.
   * A leaked value can therefore act only for people who already hold the
   * capability, which is a smaller blast radius than `EBOOK_INGEST_TOKEN`'s
   * (that one can create works with no person involved at all).
   *
   * ⚠️ **Unset means the routes answer a worded 503 and write nothing** — the
   * ships-dark direction every machine route in this Worker takes, and the
   * reason the code may be deployed before the secret exists.
   *
   * ⚠️ Held under the SAME name on both instances, unlike `ESTATE_APP_TOKEN_*`
   * whose name varies with `ESTATE_APP`. The difference is deliberate: those
   * assert *which consumer is speaking to the directory*, and the two instances
   * are two consumers. This one authenticates ONE caller (the bot) to both
   * shelves, and the instance question is answered by which hostname it dialled.
   */
  ESTATE_APP_TOKEN_DISCORD?: string;

  /**
   * The shared index Worker (catalog-platform/apps/index-worker), where this
   * catalog pushes its projection. See lib/index-push.ts and
   * packages/db/src/index-projection.ts.
   *
   * ⚠️ Both optional; unset means every push trigger logs one line and does
   * nothing — the index must never be able to stall this catalog.
   *
   * ⚠️ **PER-SOURCE, and per-INSTANCE by construction.** The URL is
   * `PUT {INDEX_URL}/api/push/{source}`, where the source is
   * `resolveIndexSource(ESTATE_APP)` — `library` on main, `library2` on
   * padhard (lib/index-push.ts, 2026-09-05). The index holds the matching
   * bearer under the suffixed name for that source:
   *
   * | This Worker | The index holds it as |
   * |---|---|
   * | main (`ESTATE_APP = "library"`) | `INDEX_PUSH_TOKEN_LIBRARY` |
   * | friend (`ESTATE_APP = "library2"`) | `INDEX_PUSH_TOKEN_LIBRARY2` |
   *
   * Same name on this side, different values — exactly `INDEX_READ_TOKEN`'s
   * shape below, and `scripts/push-secrets.mjs` marks it PER_INSTANCE so a
   * `--both` run refuses it with a sentence. Set one at a time:
   * `npx wrangler secret put INDEX_PUSH_TOKEN --config apps/worker/wrangler.toml`
   * (add `--env friend` for hers).
   *
   * `INDEX_URL` is a plain var and is set on BOTH envs in wrangler.toml.
   */
  INDEX_URL?: string;
  INDEX_PUSH_TOKEN?: string;

  /**
   * **The READ half of the index — LIVE on both instances since 2026-08-25.**
   *
   * `INDEX_PUSH_TOKEN` above is the WRITE direction. This is the other one: the
   * free details ladder (`lib/free-details.ts`, rung 2) asks
   * `GET {INDEX_URL}/api/machine/lookup?title=…` with this as a bearer, and gets
   * back the estate's own cross-catalog rows — a canonical **series** and volume
   * for a book another catalogue in this household already knows. It is the one
   * rung that can answer for a book no public database indexes, which, measured,
   * is about half this library.
   *
   * ⚠️ **PER INSTANCE, and this is the half that goes wrong.** The index tells
   * its machine callers apart BY THE VALUE presented — there is no `app` field
   * on the wire — so the two instances are two apps and hold two values:
   *
   * | This Worker | The index holds it as |
   * |---|---|
   * | main (`ESTATE_APP = "library"`) | `INDEX_READ_TOKEN_LIBRARY` |
   * | friend (`ESTATE_APP = "library2"`) | `INDEX_READ_TOKEN_LIBRARY2` |
   *
   * Same name on this side, different values — exactly the
   * `ESTATE_APP_TOKEN_LIBRARY` / `…_LIBRARY2` shape, and for the same reason: a
   * shared value would make the app name meaningless and one leak would revoke
   * both. `scripts/push-secrets.mjs` marks it PER_INSTANCE so a `--both` run
   * refuses it with a sentence.
   *
   * ⚠️ **Never point this at `INDEX_PUSH_TOKEN`** — that is the WRITE
   * credential and the two directions are separate on purpose. Unset is still a
   * **named** skip that travels in the response, never a silent one.
   *
   * 🔴 **The trap this entry used to BE.** Until 2026-08-25 this comment said
   * the rung was built dark and could never fire. It was wrong: `INDEX_URL` and
   * this token were both set on main, so the rung ran — at `/api/lookup`, the
   * HUMAN route, which sits below the index's `requireEstateMember()` blanket
   * and answers 401 to a bearer. Refused every run, looking perfectly
   * configured. ⚠️ **"The token is set" is not "the rung works",** and the fix
   * was the PATH, not the credential. See `docs/info/free-details-ladder.md` §4.
   */
  INDEX_READ_TOKEN?: string;

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
   * The SPENDING posture — `off` | `shadow` | `enforce`, the exact idiom of
   * `ESTATE_CHECK` above and for the same reasons (billing design §4).
   * Unrecognised values fall to `off` and log; see `lib/billing-gate.ts`.
   *
   *   off      nothing resolves, nothing is logged, nothing costs
   *   shadow   the decision is logged WITH `proceeded`, and the call proceeds
   *            and bills — this is what a soak measures
   *   enforce  a denied feature is refused, in words
   *
   * ⚠️ Ships `"off"` on BOTH instances, and each is flipped separately: the
   * main library and padhard are two estate sites spending two people's money.
   * Never flip as a side effect of an unrelated deploy (§4.2).
   */
  BILLING_POLICY?: string;

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
   * WHICH estate consumer this instance is: `library` (main) or `library2`
   * (the friend instance). Set in `wrangler.toml` per env — posture of record,
   * the `DEFAULT_THEME`/`GABI_PANEL` idiom — and read by `resolveEstateApp` in
   * packages/estate-auth/src/gate.ts, which also uses it to pick WHICH of the
   * two bearer secrets below to present.
   *
   * ⚠️ It was a hard-coded `'library'` in the gate until 2026-08-17, so the
   * friend instance presented the main library's identity and
   * `ESTATE_APP_TOKEN_LIBRARY2` on the auth Worker was an orphan (estate
   * credentials catalog F-5). ⚠️ Unset means `library`; anything else
   * unrecognised turns the gate OFF loudly rather than falling back to
   * `library` — the fallback would be the bug returning.
   */
  ESTATE_APP?: string;

  /**
   * This app's own bearer for `POST /api/estate/seen` (design §4.4 — the check
   * carries a per-app token, never the user's). Secret, set with
   * `wrangler secret put ESTATE_APP_TOKEN_LIBRARY` (or `.dev.vars` +
   * `npm run secrets:push`); the auth Worker holds the matching value under
   * the same name. ⚠️ Unset means the estate check is OFF (logged as
   * `estate_config_unset`), never half-on — the code deploys before the
   * secret exists, and that ordering must be safe.
   *
   * ⚠️ Read ONLY when `ESTATE_APP` is `library` — the main instance.
   */
  ESTATE_APP_TOKEN_LIBRARY?: string;

  /**
   * The SECOND instance's bearer, read only when `ESTATE_APP` is `library2`.
   * Same pairing rule, same name on the auth Worker (which has held it since
   * 2026-08-16). Set with `npm run secret:friend -- ESTATE_APP_TOKEN_LIBRARY2`.
   * ⚠️ Unset on her env means her gate logs `estate_config_unset` and behaves
   * as OFF — local auth only, nobody locked out, nothing enforced.
   */
  ESTATE_APP_TOKEN_LIBRARY2?: string;

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
   * ⚠️ **HOW FAR GABI TAKES HER PERSONALITY ON THE PANEL — and it ships `full`.**
   *
   * Owner decision 2026-09-02: *"library panel should match gabi in discord no
   * matter what. same experience different entry point"*. The edge posture was
   * built for her Discord surface on 2026-09-01 and the panel did not have it,
   * so one person got two different GABIs depending on which door they used.
   *
   * ⚠️ **This is the ONE posture var in this file that is NOT affirmative-only,
   * and the inversion is deliberate.** `GABI_PANEL`/`GABI_CONFIRM_T2` fail
   * closed because they turn a SURFACE on; this turns a REGISTER up on a surface
   * that is already on, and the owner's answer to *"which way should a typo
   * fall?"* is **no matter what**. So only the exact string `"standard"` turns
   * her down — absent, empty, a typo, or anything else reads as `full`.
   * `edgeMode` in `@lc/research` owns that parse; read its header first.
   *
   * ⚠️ It does NOT raise the PG-13 ceiling and it softens no honesty rule and no
   * confirm lane. Those limits are stated inside the appended block itself,
   * which is the structural reason the block goes last.
   */
  GABI_EDGE?: string;

  /**
   * ⚠️ **TIER 2 — GABI's CATALOG-FIX CONFIRM LANE on the panel, and it ships
   * OFF.** `catalog-platform/docs/info/gabi-confirm-lanes-design.md`.
   *
   * Affirmative-only `"on"`, the `GABI_PANEL` idiom — every typo is OFF. It is
   * the SAME lever name the Discord Worker carries, so a single owner decision
   * turns the lane on across both surfaces, or neither.
   *
   * ⚠️ **OFF means invisible on the panel**: no confirm card is rendered
   * (`apps/web/src/components/GabiConfirmCard.tsx` returns null) and the apply
   * logic refuses without touching the network. Reported on `/api/me` and
   * `/api/health` beside `GABI_PANEL` so the browser and a curl both see it.
   * Flipping it is the OWNER's evidence-gated step — never a deploy side effect.
   *
   * ⚠️ ON IS NOT A GRANT: the panel applies through the SAME authenticated
   * `PATCH /api/works/:id` the edit form uses, which checks the signed-in
   * person's own `editCatalog` capability and writes the audit trail.
   */
  GABI_CONFIRM_T2?: string;

  /**
   * Local development only. Ignored unless ENVIRONMENT is not "production", so a
   * stray value in production vars can never bypass sign-in.
   */
  DEV_EMAIL?: string;
  DEV_NAME?: string;

  // ─── Cross-library peer push (migration 0370) ───────────────────────────────

  /**
   * Shared secret for the peer push endpoint (`POST /api/peer/push`).
   * Same value on all instances in the network — one mint, set everywhere.
   * Unset means the route answers 404 (disabled, not open).
   */
  PEER_TOKEN?: string;

  /**
   * JSON array of peer instances to push holdings to. PUBLIC config — carries
   * no secret. The outbound auth token is the `PEER_TOKEN` secret, not a field
   * here.
   * Example: `[{"id":"padhard","label":"the Padhard Library","url":"https://padhard.heygabi.ai"}]`
   * Parsed at runtime by `lib/peer-push.ts`. Empty or unset = no outbound pushes.
   */
  PEERS?: string;

  /** This instance's peer ID (e.g. 'sky', 'padhard'). Sent in outbound pushes. */
  PEER_SELF_ID?: string;

  /** This instance's display label (e.g. "Sky's Library"). Sent in outbound pushes. */
  PEER_SELF_LABEL?: string;

  /** This instance's public origin, no trailing slash (e.g. 'https://library.heygabi.ai'). */
  SITE_ORIGIN?: string;
}

/** Values attached to the request context by middleware. */
export interface Variables {
  user: AppUser;
  /**
   * The money-path ids this person may NOT spend on, on this instance's site —
   * the cached `/seen` answer's billing half, put here by `requireAuth` and
   * read by `lib/billing-gate.ts` (billing design §3.4).
   *
   * 🔴 `null` is UNKNOWN and proceeds; `[]` is "the directory denied nothing";
   * `undefined` is a route that never ran `requireAuth` (the delegated lane,
   * which resolves the on-behalf-of person itself). All three proceed, and
   * only `[]` proceeds because an answer said so.
   */
  billingDenied?: string[] | null;
}

export type AppBindings = { Bindings: Env; Variables: Variables };

export function parseOwnerEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
