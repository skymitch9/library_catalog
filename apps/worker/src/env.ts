import type { AppUser } from '@lc/core';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

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
   * Shared secret for the ebook indexer running in Docker.
   *
   * ⚠️ Why a static token at all, when everything else here verifies a Firebase
   * ID token: **the indexer is not a person and cannot hold one.** It is a cron
   * inside a container with no browser, no Google session and no way to refresh.
   * Firebase does offer service accounts, but a service-account private key
   * bypasses `firestore.rules` outright, and this process has no business
   * anywhere near Firestore — it writes to D1 and nothing else.
   *
   * So it gets a token that can do exactly one thing, and the route it unlocks
   * (`/api/ingest/*`) is the narrowest in the app: it can create works and
   * ebook editions. It cannot read the collection, cannot touch copies, cannot
   * write a review, and cannot manage users.
   *
   * Unset means the ingest route is **disabled entirely** rather than open. Set
   * it with `wrangler secret put EBOOK_INGEST_TOKEN` and generate it with
   * something like `openssl rand -hex 32`.
   */
  EBOOK_INGEST_TOKEN?: string;

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
