/**
 * Pushing this catalog's owned work_keys to configured peer instances.
 *
 * Same trigger pattern as index-push: fire after catalog mutations via
 * `waitUntil`, so peer_holding tables across the network stay fresh within
 * seconds of a shelf change.
 *
 * ## Design
 *
 * Full snapshot, POST /api/peer/push, bearer token — same as the index push,
 * the peer replaces this source's rows wholesale. No incremental state to
 * drift.
 *
 * PEERS is a JSON array in wrangler.toml [vars], parsed at runtime:
 * ```json
 * [{"id":"padhard","label":"the Padhard Library","url":"https://padhard.heygabi.ai"}]
 * ```
 * The outbound auth token is NOT in PEERS (it is a public [vars] block). It is
 * the `PEER_TOKEN` secret — a single shared value across all instances — sent
 * as the `X-Peer-Token` header below.
 *
 * ⚠️ Fails SOFT everywhere, on purpose: a peer being down must never stall
 * this catalog. Unset PEERS or empty array = no-op.
 *
 * ## 2026-09-06 — `PEERS` is the SET, the registry is the NAMES
 *
 * The multi-library survey (§3.6) measured this var as "a SECOND, INDEPENDENT
 * LIBRARY REGISTRY on its own id vocabulary (`sky`, `padhard`) and its own
 * labels, stored as JSON in [vars], per instance, N×(N−1) entries" — one fact
 * with two homes, which is how a rename drifts. `resolvePeers()` now reads
 * each named peer's host and label from `GET {INDEX_URL}/api/catalogs`, the
 * estate catalog registry, with these values as the fallback.
 *
 * 🔴 IT DOES NOT DECIDE WHO THE PEERS ARE, and that is deliberate rather than
 * unfinished: a peer entry lets this catalog read another household's
 * holdings and theirs read ours — access-INCREASING, therefore the owner's
 * explicit call each time. A catalog must never enrol itself into a peer
 * network by appearing in a directory. So adding a `library3` is still a line
 * in every instance's `PEERS` plus a redeploy of each, exactly as
 * `scripts/provision-catalog.mjs` prints; what stops being hand-kept is what
 * each named peer is CALLED and WHERE it lives.
 */

import type { MiddlewareHandler } from 'hono';
import { HELD_STATUSES } from '@lc/core';
import type { AppBindings, Env } from '../env.js';

/**
 * The held-copy set as a SQL literal list, e.g. `'owned','lent'`. Built from the
 * canonical `HELD_STATUSES` constant (fixed, code-defined values — no user
 * input, so interpolation is safe) so the peer push advertises exactly the
 * books we actually hold.
 */
const HELD_STATUSES_SQL = HELD_STATUSES.map((s) => `'${s}'`).join(', ');

export interface PeerConfig {
  id: string;
  label: string;
  url: string;
  /**
   * OPTIONAL: which registry catalog this peer IS, in the estate's visibility
   * vocabulary (`library`, `library2`, `library3`…). Only needed when the
   * entry's `url` does not already match that catalog's `host` — resolution
   * falls back to a host match, which is why the two existing instances need
   * no config change at all.
   */
  catalog?: string;
}

/**
 * Parse the PEERS JSON config. Returns [] if unset or invalid.
 */
export function parsePeers(env: Env): PeerConfig[] {
  const raw = (env as unknown as Record<string, unknown>).PEERS as string | undefined;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is PeerConfig =>
          typeof p.id === 'string' &&
          typeof p.label === 'string' &&
          typeof p.url === 'string'
      )
      .map((p) => (typeof p.catalog === 'string' ? p : { id: p.id, label: p.label, url: p.url }));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * The registry — one home for what a catalog is CALLED and where it IS
 * ------------------------------------------------------------------ */

/**
 * One row of `GET {INDEX_URL}/api/catalogs` — the estate catalog registry
 * (`catalog-platform/docs/info/catalog-registry.md`). Names only; the
 * anonymous answer carries no counts and no per-member state.
 */
export interface RegistryCatalog {
  id: string;
  /** ⚠️ `null` is a real answer ("pushes nothing of its own"), not a gap. */
  push_source: string | null;
  /** The CONTENT kind: `books` | `games` | `audio`. */
  kind: string;
  label: string;
  owner: string | null;
  holding: 'physical' | 'digital';
  shared: boolean;
  host: string;
}

export interface ResolvedPeers {
  peers: PeerConfig[];
  /** Where each entry's label and host ended up coming from. */
  source: 'static' | 'registry' | 'mixed';
  /** Worth logging: what the registry said, and what it did NOT do. */
  notes: string[];
}

/** The registry's own TTL, so the estate has ONE number rather than two. */
const REGISTRY_TTL_MS = 10 * 60 * 1000;
/** A directory outage must not become a latency outage. */
const REGISTRY_TIMEOUT_MS = 2000;

/**
 * Isolate-local memo. ⚠️ The FAILURE is cached too, deliberately — otherwise
 * an unreachable directory turns every catalog mutation into a 2-second wait,
 * which is the shape of outage that looks like "the site got slow".
 */
let registryMemo: { at: number; catalogs: RegistryCatalog[] | null } | null = null;

/** Test seam only — resets the memo between cases. */
export function _resetRegistryMemo(): void {
  registryMemo = null;
}

/** Hostname of a URL, lowercased; null if it is not a URL at all. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Fetch the estate catalog registry, or null.
 *
 * ⚠️ NULL MEANS "THE DIRECTORY DID NOT ANSWER", never "there are no catalogs",
 * and the caller must keep those apart: an empty list would say the estate
 * holds nothing, which is a confident false statement of exactly the kind the
 * registry's own §8 is written against. There is deliberately no hard-coded
 * fallback list here either — the static `PEERS` var IS the fallback, and it
 * is a fallback with a human behind it.
 */
export async function fetchRegistry(
  env: Env,
  { fetchImpl = fetch, now = Date.now() }: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<RegistryCatalog[] | null> {
  const base = (env as unknown as Record<string, unknown>).INDEX_URL as string | undefined;
  if (!base) return null;

  if (registryMemo && now - registryMemo.at < REGISTRY_TTL_MS) return registryMemo.catalogs;

  let catalogs: RegistryCatalog[] | null = null;
  try {
    const res = await fetchImpl(`${base.replace(/\/+$/, '')}/api/catalogs`, {
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    });
    if (res.ok) {
      const body = (await res.json()) as { catalogs?: unknown };
      if (Array.isArray(body.catalogs)) {
        catalogs = body.catalogs.filter(
          (c): c is RegistryCatalog =>
            !!c &&
            typeof (c as RegistryCatalog).id === 'string' &&
            typeof (c as RegistryCatalog).label === 'string' &&
            typeof (c as RegistryCatalog).host === 'string',
        );
      }
    }
  } catch {
    /* fails soft — the caller keeps the static config */
  }
  registryMemo = { at: now, catalogs };
  return catalogs;
}

/**
 * Resolve the peer list: the SET from `PEERS`, the NAMES from the registry.
 *
 * 🔴 THE SPLIT IS THE WHOLE DESIGN, AND IT IS AN ACCESS DECISION.
 * A peer entry lets this catalog read another household's holdings, and lets
 * theirs read ours — access-INCREASING, and therefore the owner's explicit
 * call every time (`scripts/provision-catalog.mjs` refuses to add one and says
 * so; `PEERS = "[]"` on a new instance is deliberate). So the registry does
 * NOT decide who the peers are: a catalog appearing in `/api/catalogs` must
 * never enrol itself into anybody's peer network. What the registry decides is
 * what each named peer is CALLED and WHERE it lives, which is the half that
 * was a second hand-kept copy of a fact with a home (survey §3.6: "a SECOND,
 * INDEPENDENT LIBRARY REGISTRY on its own id vocabulary").
 *
 * ⚠️ SO A `library3` STILL NEEDS A LINE IN EVERY INSTANCE'S `PEERS` AND A
 * REDEPLOY OF EACH. That has not changed and must not; what has changed is
 * that a rename or a rehost of an existing peer now propagates on its own.
 *
 * Matching, in order: an explicit `catalog` field, then the entry's own host.
 * The host match is why the two live instances need no config change — their
 * URLs already are `library.heygabi.ai` and `padhard.heygabi.ai`.
 *
 * ⚠️ A PEER THAT RESOLVES ONTO THIS INSTANCE'S OWN HOST IS REFUSED, keeping
 * its static values. Pushing a snapshot to ourselves would be harmless-looking
 * and would file our own holdings as a peer's.
 *
 * ⚠️ AND THE PERSISTED HALF DOES NOT MOVE. Peer labels are stored in each
 * RECEIVING instance's `peer_holding` table, written from the SENDER's
 * `PEER_SELF_LABEL` (see `buildPeerPayload`) — not from this list. So a
 * registry rename reaches a peer's pages on that peer's next push to us, not
 * on our next deploy. The label resolved here is used for our own logs and to
 * keep this file honest about which catalog an entry means.
 */
export async function resolvePeers(
  env: Env,
  { fetchImpl = fetch, now = Date.now() }: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<ResolvedPeers> {
  const staticPeers = parsePeers(env);
  const notes: string[] = [];
  // No peers configured: nothing to resolve, and no reason to ask the
  // directory on every mutation of a catalog that peers with nobody.
  if (staticPeers.length === 0) return { peers: [], source: 'static', notes };

  // ⚠️ "NOT CONFIGURED" AND "UNREACHABLE" ARE DIFFERENT FACTS and are worded
  // differently. An instance with no INDEX_URL was never asking; one whose
  // directory did not answer has an outage worth seeing in a tail.
  const configured = Boolean((env as unknown as Record<string, unknown>).INDEX_URL);
  const catalogs = await fetchRegistry(env, { fetchImpl, now });
  if (catalogs === null) {
    notes.push(
      configured
        ? 'registry unreachable — using the static PEERS values (names may be stale; routing is unchanged)'
        : 'no INDEX_URL — the registry was not consulted; static PEERS values used',
    );
    return { peers: staticPeers, source: 'static', notes };
  }

  const selfHost = hostOf(
    ((env as unknown as Record<string, unknown>).SITE_ORIGIN as string | undefined) ?? '',
  );

  let resolvedCount = 0;
  const peers = staticPeers.map((p) => {
    const wantHost = hostOf(p.url);
    const row =
      catalogs.find((c) => (p.catalog ? c.id === p.catalog : false)) ??
      catalogs.find((c) => wantHost !== null && c.host.toLowerCase() === wantHost);
    if (!row) {
      notes.push(`peer ${p.id}: no registry row matches ${p.catalog ? `catalog ${p.catalog}` : p.url} — static values kept`);
      return p;
    }
    if (selfHost && row.host.toLowerCase() === selfHost) {
      notes.push(`peer ${p.id}: the registry resolves it onto THIS instance's own host — refused, static values kept`);
      return p;
    }
    resolvedCount += 1;
    const url = `https://${row.host}`;
    if (url !== p.url) notes.push(`peer ${p.id}: host ${p.url} → ${url} (from the registry)`);
    if (row.label !== p.label) notes.push(`peer ${p.id}: label ${JSON.stringify(p.label)} → ${JSON.stringify(row.label)}`);
    return { ...p, url, label: row.label };
  });

  // ⚠️ SAID, NOT DONE. A physical catalog the registry names and PEERS does
  // not is not a bug and must not be auto-added; naming it in the log is how
  // somebody notices the network is smaller than the estate on purpose.
  const peeredHosts = new Set(peers.map((p) => hostOf(p.url)).filter(Boolean));
  const unpeered = catalogs.filter(
    (c) =>
      c.holding === 'physical' &&
      c.kind !== 'games' &&
      c.host.toLowerCase() !== selfHost &&
      !peeredHosts.has(c.host.toLowerCase()),
  );
  if (unpeered.length > 0) {
    notes.push(
      `registry names ${unpeered.length} other physical book catalog(s) not in PEERS (${unpeered
        .map((c) => c.id)
        .join(', ')}) — peering is access-increasing and is added by hand, deliberately`,
    );
  }

  const source: ResolvedPeers['source'] =
    resolvedCount === peers.length ? 'registry' : resolvedCount === 0 ? 'static' : 'mixed';
  return { peers, source, notes };
}

/**
 * Build the peer push payload from this catalog's held works.
 * Only includes works that have at least one copy with a "held" status.
 */
export async function buildPeerPayload(
  db: D1Database,
  selfId: string,
  selfLabel: string,
  siteOrigin: string,
): Promise<{
  peerId: string;
  peerLabel: string;
  holdings: Array<{
    work_key: string;
    title: string | null;
    cover_url: string | null;
    detail_url: string | null;
    formats: string | null;
    series: string | null;
    series_index: number | null;
  }>;
}> {
  // Query all works that have at least one HELD copy — the canonical
  // HELD_STATUSES set ('owned','lent'). ⚠️ The old list ('owned','preordered',
  // 'borrowed') was wrong in both directions: it advertised preordered (not yet
  // delivered) and borrowed (someone else's book we hold) to peers as things we
  // own, and it HID 'lent' — a book we own that is just in someone else's hands.
  const { results } = await db.prepare(`
    SELECT DISTINCT
      w.work_key,
      w.title,
      w.cover_url,
      w.id,
      w.series,
      w.series_index_sort,
      GROUP_CONCAT(DISTINCT e.format) as formats
    FROM work w
    JOIN copy c ON c.work_id = w.id
    LEFT JOIN edition e ON e.id = c.edition_id
    WHERE c.status IN (${HELD_STATUSES_SQL})
      AND w.work_key IS NOT NULL
      AND w.work_key != ''
    GROUP BY w.id
  `).all<{
    work_key: string;
    title: string | null;
    cover_url: string | null;
    id: number;
    series: string | null;
    series_index_sort: number | null;
    formats: string | null;
  }>();

  const holdings = (results ?? []).map((r) => {
    // Normalise formats: group into physical/ebook
    let formatLabel: string | null = null;
    if (r.formats) {
      const fmts = r.formats.split(',');
      const hasPhysical = fmts.some((f) =>
        ['hardcover', 'paperback', 'mass_market'].includes(f)
      );
      const hasEbook = fmts.some((f) =>
        ['ebook_epub', 'ebook_kindle', 'ebook_pdf'].includes(f)
      );
      if (hasPhysical && hasEbook) formatLabel = 'physical,ebook';
      else if (hasPhysical) formatLabel = 'physical';
      else if (hasEbook) formatLabel = 'ebook';
    }

    // Absolutise cover URL
    let coverUrl = r.cover_url;
    if (coverUrl && coverUrl.startsWith('/')) {
      coverUrl = `${siteOrigin}${coverUrl}`;
    }

    return {
      work_key: r.work_key,
      title: r.title,
      cover_url: coverUrl,
      detail_url: `${siteOrigin}/work/${r.id}`,
      formats: formatLabel,
      series: r.series,
      series_index: r.series_index_sort,
    };
  });

  return { peerId: selfId, peerLabel: selfLabel, holdings };
}

/**
 * Push this catalog's holdings to all configured peers.
 * Returns a summary per peer.
 */
export async function pushToPeers(env: Env): Promise<Array<{ peer: string; result: string }>> {
  // ⚠️ The SET is still `PEERS`; the registry only says what each one is called
  // and where it is. See `resolvePeers` for why that split is an access
  // decision and not a refactor.
  const { peers, notes } = await resolvePeers(env);
  if (peers.length === 0) return [];
  // ⚠️ Notes go at the END, never the front. Every caller of this function
  // reads `results[0]` as "what happened to the first peer" — including a test
  // that pins the PEER_TOKEN refusal — and a diagnostic line that displaced it
  // would be a report about the reporter. Each note is still a line somebody
  // has to be able to read after the fact: a rehost that moved a push, a
  // directory that did not answer, a catalog the estate has and this peer
  // network deliberately does not.
  const trailer: Array<{ peer: string; result: string }> = notes.map((n) => ({ peer: 'registry', result: n }));

  // Outbound auth: the shared PEER_TOKEN secret, sent as X-Peer-Token. This is
  // the value the RECEIVING instance checks against its own env.PEER_TOKEN in
  // routes/peer.ts. ⚠️ REQUIREMENT: the network uses ONE shared token, so
  // `sky.PEER_TOKEN` and `padhard.PEER_TOKEN` MUST be the SAME value (they
  // already are). Rotating it means re-minting on BOTH workers, same value.
  // If it is unset we must NOT send an empty token — skip the push entirely.
  const peerToken = env.PEER_TOKEN;
  if (!peerToken) {
    return [{ peer: '*', result: 'PEER_TOKEN not set — outbound peer push skipped' }, ...trailer];
  }

  const selfId = (env as unknown as Record<string, unknown>).PEER_SELF_ID as string | undefined;
  const selfLabel = (env as unknown as Record<string, unknown>).PEER_SELF_LABEL as string | undefined;
  const siteOrigin = (env as unknown as Record<string, unknown>).SITE_ORIGIN as string | undefined;

  if (!selfId || !selfLabel || !siteOrigin) {
    return [{ peer: '*', result: 'PEER_SELF_ID / PEER_SELF_LABEL / SITE_ORIGIN not configured' }, ...trailer];
  }

  const payload = await buildPeerPayload(env.DB, selfId, selfLabel, siteOrigin);
  const results: Array<{ peer: string; result: string }> = [];

  for (const p of peers) {
    try {
      const res = await fetch(`${p.url}/api/peer/push`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Peer-Token': peerToken,
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const body = await res.json<{ received: number }>();
        results.push({ peer: p.id, result: `pushed ${body.received} holdings` });
      } else {
        results.push({ peer: p.id, result: `HTTP ${res.status}` });
      }
    } catch (e) {
      results.push({ peer: p.id, result: `error: ${e}` });
    }
  }

  return [...results, ...trailer];
}

/**
 * Middleware: after a successful mutation on item-touching routes, push
 * holdings to all peers via `waitUntil`. Same pattern as `indexPushAfterMutation`.
 */
const ITEM_TOUCHING_PREFIXES = [
  '/api/works',
  '/api/ingest',
  '/api/enrich',
  '/api/research',
  '/api/scan-jobs',
  '/api/series',
];

export function peerPushAfterMutation(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    await next();

    // Only fire on successful writes to item-touching routes
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    if (c.res.status < 200 || c.res.status >= 300) return;

    const path = new URL(c.req.url).pathname;
    if (!ITEM_TOUCHING_PREFIXES.some((p) => path.startsWith(p))) return;

    const peers = parsePeers(c.env);
    if (peers.length === 0) return;

    // Fire and forget via waitUntil
    c.executionCtx.waitUntil(
      pushToPeers(c.env).then((r) => {
        for (const { peer, result } of r) {
          console.log(`[peer-push] ${peer}: ${result}`);
        }
      }).catch((e) => {
        console.error('[peer-push] failed:', e);
      })
    );
  };
}
