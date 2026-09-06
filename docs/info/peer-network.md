# The peer network — who reads whose shelf, and who decides

> **Audience:** Claude sessions first, the owner second. **Status:** TRACKED.
> **Last verified: 2026-09-06** — written the day `resolvePeers()` landed
> (commit `bfba496`, deployed to both instances as `d950b97d` / `7f782b10`).
> MEASURED that day: `peer-push.test.ts` **1 → 15 cases, 0 fail**; the repo
> suite **2918 → 2968**; `tsc --noEmit -p apps/worker` clean; and the live
> registry answer (`GET https://index.heygabi.ai/api/catalogs` → 200, five
> catalogs, `library2` → `padhard.heygabi.ai`).
> ⚠️ **NOT verified: no peer push has been watched against the live registry.**
> The push fires only on an authenticated catalog mutation and there is no
> manual trigger route, so the proof is a `wrangler tail` line reading
> `[peer-push] registry: …` after a real edit, and nobody has taken it.

**The one-line version:** `PEERS` says **who** the peers are — an access
decision, made by the owner, by hand. The estate catalog registry says what
each of them is **called** and **where** it lives.

---

## 1 · What a peer entry actually grants

Each instance pushes its held `work_key` set to every configured peer after a
catalog mutation (`POST /api/peer/push`, full snapshot, `X-Peer-Token`). The
receiving instance stores it in `peer_holding` and its series and work pages
show *"📚 In the Padhard Library"* badges on gap rungs.

🔴 **So a peer entry is another household reading our shelf, and us reading
theirs.** That is access-INCREASING in both directions, which is why:

- `scripts/provision-catalog.mjs` ships a new instance with `PEERS = "[]"` and
  prints peering as a follow-up it deliberately does not take;
- adding a `library3` is a line in **every existing instance's** `PEERS` **plus
  a redeploy of each** — there is no way to join the network from one side.

## 2 · Why the registry does NOT decide membership

The multi-library survey (§3.6, 2026-09-05) measured `PEERS` as *"a SECOND,
INDEPENDENT LIBRARY REGISTRY on its own id vocabulary (`sky`, `padhard`) and
its own labels, stored as JSON in `[vars]`, per instance, N×(N−1) entries"* —
one fact with two homes, which is how a rename drifts.

The obvious fix is "feed the peer list from `/api/catalogs`". **That fix is
wrong on the half that matters**: it would make any catalog that appears in the
estate directory enrol itself into every household's peer network, silently, on
the next deploy. A directory is a name service; it must never be a grant
(the registry's own doc says the same thing about `/admin`'s permission array —
`catalog-platform/docs/info/catalog-registry.md` §10a).

**So the split is:**

| | Comes from | Changing it costs |
|---|---|---|
| **WHICH** catalogs are peers | `PEERS` in `wrangler.toml`, per instance | an edit in every instance + a redeploy of each |
| **WHAT** each peer is called | the registry (`label`) | nothing — up to 10 minutes |
| **WHERE** each peer lives | the registry (`host`) | nothing — a rehost follows on its own |

## 3 · How an entry is matched to a registry row

In order:

1. an explicit `"catalog": "library2"` field on the entry (the estate's
   visibility vocabulary), else
2. the entry's own `url` host.

⚠️ **The host match is why the two live instances needed no config change** —
their URLs already are the registry's hosts. The `catalog` field exists for the
case they diverge, which is exactly the rehost case this is for.

⚠️ **A peer that resolves onto THIS instance's own host is refused** and keeps
its static values. Pushing a snapshot to ourselves would look harmless and
would file our own holdings as a peer's.

## 4 · What happens when the directory is unreachable

| Situation | Behaviour |
|---|---|
| registry answers | host + label from it; every change is logged as `old → new` |
| registry refuses or times out (2 s) | the **static** `PEERS` values, and a note saying *"registry unreachable"* |
| no `INDEX_URL` at all | the static values, and a **different** note — an instance that never asked does not have an outage |
| no peers configured | the directory is not called at all |

🔴 **There is no hard-coded fallback list of catalogs**, deliberately — the same
rule the registry keeps on its own side. *"The directory is unreachable"* and
*"these are the catalogs"* are different facts, and `PEERS` is the fallback,
which is a fallback with a human behind it.

⚠️ **The 10-minute memo caches the FAILURE too.** Otherwise an unreachable
directory turns every catalog mutation into a 2-second wait — an outage that
presents as *"the site got slow"*, which is the hardest kind to diagnose. Ten
minutes is the registry's **own** TTL, so the estate has one number rather than
two.

## 5 · ⚠️ The half that does NOT move: persisted labels

Peer labels are stored in each **receiving** instance's `peer_holding` table,
written from the **sender's** `PEER_SELF_LABEL` (`buildPeerPayload`) — not from
the peer list resolved here. So:

**A registry rename reaches a peer's pages on that peer's next push to us, not
on our next deploy.** The label resolved by `resolvePeers()` is for our own
logs and to keep the module honest about which catalog an entry means.

If a rename has to appear on the other side now, the lever is a mutation on the
renamed instance (which triggers its push), not a deploy here.

## 6 · Reading it in a tail

Every decision is logged, and the notes travel at the **end** of
`pushToPeers()`'s results — never the front, because every caller reads
`results[0]` as *"what happened to the first peer"*.

```bash
npm run tail --workspace @lc/worker             # main
npm run tail --workspace @lc/worker -- --env friend
```

Look for `[peer-push] registry: …`. The lines worth knowing:

- `peer <id>: host <old> → <new> (from the registry)` — a rehost was followed.
- `registry unreachable — using the static PEERS values` — names an outage.
- `registry names N other physical book catalog(s) not in PEERS (…)` — ⚠️ said
  and NOT done: the network is smaller than the estate **on purpose**, and this
  line is how anybody ever notices that it is.

## 7 · Where the pieces live

| Piece | File |
|---|---|
| `parsePeers`, `resolvePeers`, `fetchRegistry`, `pushToPeers` | `apps/worker/src/lib/peer-push.ts` |
| The peer list itself, both instances | `apps/worker/wrangler.toml` — `[vars].PEERS` and `[env.friend.vars].PEERS` |
| The receiving side | `apps/worker/src/routes/peer.ts`, table `peer_holding` (migration 0370) |
| What renders it | `apps/web/src/components/OnYourShelf.tsx`, `PeerLibraries.tsx`, `pages/SeriesDetailPage.tsx` |
| The registry it reads | `catalog-platform/docs/info/catalog-registry.md` |
| The shared token | `PEER_TOKEN` — one value on every instance, names only ([`../access/secrets.md`](../access/secrets.md)) |
