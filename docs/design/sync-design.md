# Sync Design Decisions

The stable decisions for lode's real network sync. Each records **why**: the constraints, the
alternatives rejected, the trade-offs. The in-process CRDT sync core (`SyncManager` /
`sweepOrphans` in `@lode/engine`) is landed; this doc is about reaching it over a network.

Identity, membership, and persistence layer on top — see
[`sync-identity-persistence.md`](./sync-identity-persistence.md); this doc focuses on topology,
the relay, and transport security.

Decisions were reached after studying **any-sync** (`/home/xac/codes/any-sync`, anytype's sync
layer), **anytype-heart** (client), and **hapi** (`/home/xac/codes/hapi`, a local-first
remote-control app with a relay model).

## Governing principle

**Loro CRDT already guarantees convergence, validity, and no-resurrection.** The sync layer's
only job is therefore **reachability** (getting bytes across networks/NAT) and **membership**
(who you choose to sync with) — not correctness. Everything below follows from pushing work out
of the sync layer and onto the CRDT + social trust.

## 1. Topology — dedicated central relay (star)

Every device connects (outbound) to **one relay**; devices never connect to each other directly.

- **Rejected: mesh / device-to-device P2P.** Mesh requires every device to know all peers'
  addresses (unacceptable configuration burden at 3+ devices) AND needs NAT traversal per device
  (overlay/STUN/TURN) — a network-setup dependency lode refuses to place on the user. Star needs
  only outbound from each device, so per-device NAT is a non-issue.
- **Rejected: vendor-operated relay (anytype network).** Centralizes and requires infra lode does
  not want to run. The relay is **user-self-deployed** (their always-on machine or a VPS), address
  configurable. Who-operates is not the concern; reachability is.
- The relay is the single meeting point. LAN case: one machine is the relay, all devices sync to it.

## 2. Relay — pure transport, no data, untrusted

The relay does **presence + routing only**. It stores **no workspace content**, holds **no
identity**, and is **untrusted**.

- **Why not store-and-forward on the relay:** keeping the relay stateless of user data removes
  privacy/at-rest concerns and keeps it trivial to operate (a forwarding process).
- **Offline durability is therefore an always-on _client_'s job, not the relay's.** CRDT updates
  are durable in every client's own store. A workspace stays in sync as long as, when a peer
  reconnects, some client holding the workspace is online.
- CRDT transitivity ⇒ a client only needs to sync with **one** up-to-date peer to converge.

## 3. Relay — an address-aware, content-blind workspace broker

The relay is **not** a dumb byte pipe. Clients register the workspaces they hold (subscribe), and
the relay **routes messages by workspace** to the subscribed clients — and, within a workspace,
can **address a specific peer** so one client can request data directly from another. Worked
example (devices A/B/C, relay on B): A, B, C each subscribe their workspaces. A edits shared
workspace W → relay forwards that message **only** to B and C (W's other subscribers). A's private
workspace W_A (A is the only subscriber) → relay does **not** forward it to B/C. A dumb broadcast
would leak private workspaces' metadata/traffic to non-subscribers; routing by subscription is
required.

The relay's scope:

- **Address-aware** — it routes by workspace channel AND can address a specific peer within it
  (peerId-keyed), enabling directed client→client requests (§3c). This is routing metadata, not
  content understanding.
- **Content-blind (where it matters)** — it cannot read sealed content. Clients encrypt
  end-to-end (transit-key AEAD, §4); the relay routes opaque ciphertext. It sees peerIds and
  channel membership (public routing info) but never plaintext.
- **Auth — open question.** Today the relay is **no-auth** (forwards anything; admission is
  transit-key-based + cooperative). Whether to add relay-side admission is undecided; current
  leaning is no. **Address-awareness is routing, NOT admission** — do not let it slide into
  enforcement. A non-member can request data but cannot decrypt the sealed response.
- **No persistence (hard)** — routing tables are in-memory, rebuilt on connect; the relay never
  persists workspace content or identity (§2). Its in-memory state may grow beyond a bare routing
  table (e.g., hints like "which peer holds membership for a newcomer"); that is undecided and the
  next discussion.

> The relay is neither a "dumb byte pipe" nor a "sync-aware router": it is **routing-aware** (by
> workspace subscription + peerId) but **content-blind** (no CRDT/plaintext/auth semantics). It
> must route — broadcasting everything to every client would leak private-workspace traffic to
> non-subscribers.

**Reachability is a SEPARATE concern (§3a).** How clients reach the relay (LAN / VPS / tunwg /
Cloudflare / Tailscale) is a deployment dimension, orthogonal to the relay's function.

## 3a. Reachability — an independent deployment dimension

The relay must be reachable by its clients. **How** is a deployment choice, **orthogonal to the
sync design** — the relay is the same broker regardless. Options, increasing setup cost:

- **Same LAN** — clients connect to the relay directly. No public infrastructure needed.
- **Public VPS** — the relay runs on a VPS with a public IP; clients dial out to it. Simplest
  cross-network option; the user provides the VPS (or Cloudflare Tunnel / port-forward). Pure Node.
- **tunwg / hosted dumb pipe** — the relay runs on a NAT'd home machine exposed via a shared
  public dumb pipe (tunwg-style, auto-cert). Lets each user group self-host at home. **One
  deployment option, not MVP, not part of the sync design** — it bundles a Go binary + WireGuard +
  a hosted public server, and is only about reachability.

**tunwg is not being built for MVP.** It is recorded here only to note "relay on a NAT'd home
machine, exposed via a public pipe" is a deployment path available later.

## 3b. Relay migration — moving the relay to a new host

A workspace's coordinate is `(relay address(es), workspaceId, transit key)` (§4). The relay is a
**stateless coordinate**, not replicated state — so **relocating the relay is supported and
lightweight**: only the `relay address` field changes. Because the relay stores no
content/identity/membership (§2/§3), there is **nothing to migrate** — every member already holds
the full workspace locally.

- **MVP migration = social re-share**: the owner exports the new coordinate; members import it and
  dial the new relay. Same flow as inviting a device.
- **In-flight during migration**: members split across old/new relay temporarily; CRDT merge
  catches everyone up once they converge.
- A workspace may register **multiple relays**; each member dials all of them (no inter-relay
  routing). This is a strength of the stateless relay: a stateful coordinator (e.g. any-sync's)
  would require data/identity migration on relocation; lode's relay has nothing to move.

## 3c. Directed client→client requests — the core transport capability

The essential capability: **one client can request something from another specific client** (by
peerId), through the relay. This is what makes `join` clean (fetch membership on demand) and
replaces broadcast-then-first-responder-wins for N>2.

**The primitives already exist — no new RPC.** The `SyncTransport` interface + its broker adapter
(`BrokerClientSyncTransport`) already have the broadcast/directed split any-sync uses:

|                                                         | our primitive                                                                 | anytype analog                                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **broadcast** (one-way push)                            | `updatesPush` (`sendUpdates`) + the membership gossip-push (`MembershipSync`) | `HeadUpdate` on mutation (heads + inline changes); ACL-record push                          |
| **directed** (req/resp to one peer, `reqId`-correlated) | `profileReq/Resp` (`remoteProfile`) + `updatesReq/Resp` (`fetchUpdates`)      | `HeadSync` (ldiff); `ObjectSyncRequestStream` (missing-data pull); `SpacePull` (cold-start) |

Concretely:

- **join fetches membership via the existing `fetchUpdates("membership", ∅)`** — the membership doc
  is already reachable (`lookupDoc` searches `store ∪ publicDocs`). `respondUpdates` emits on the
  **plaintext envelope** for a public doc (so a pre-key joiner can read it) and **aims the response at
  the asker** via the deliver frame's `fromPeerId` — the relay populates `fromPeerId` from its route
  table at publish time, and the responder sets `toPeerId = fromPeerId` (broadcast fallback when the
  asker declared no peerId).
- **Directed routing** = `toPeerId` on the broker publish; the relay's
  `channel → {peerId → connection}` table routes it. The `reqId` req/resp correlation is reused as-is.
  A directed request targets one peer (broadcast remains the default + the fallback).

- **peerId (per-dataRoot) is the routing identity** — already the CRDT site id, so reusing it for
  routing is consistent. A directed request is daemon→daemon, keyed by the ws's peerId.
- **Discovery:** a peer learns whom to ask via a relay query ("who's on channel W"), answered from
  the relay's in-memory table.
- **Security:** the relay is no-auth, so an unauthorized peer _can_ request — but the content
  response is transit-key-sealed (it cannot decrypt), and membership is a public roster anyway.
  peerId is a routing _hint_, not a trust anchor (spoofable on a no-auth relay); trust comes from
  the AEAD seal + actor signature on the response.
- **Liveness / fallback** (a directed request hits a just-disconnected peer) is the **client's**
  strategy — try another peer, fall back to broadcast; the relay does not manage it.

This mirrors any-sync's model (broadcast head-updates for changes; directed streaming pull for
missing data) but **simpler**: any-sync needs a hash ring + "responsible peers" because it shards
storage; lode **full-replicates** (every member holds the whole doc), so _any_ peer can answer —
no sharding machinery.

**Split (decided):** broadcast pushes changes (content `updatesPush` + membership-roster updates);
directed pulls gaps (cold-start full doc + missing shards, via `fetchUpdates`/`remoteProfile`). MVP
content sync is round-based directed (each round: profile-req + updates-req to a peer); push-on-
mutation (the low-latency broadcast path) is the event-driven refinement, deferred.

## 4. Membership, encryption, revocation

Authority: [`sync-identity-persistence.md`](./sync-identity-persistence.md) §2. Summary:

- **Membership** = a replicated, signed, append-only **membership log** (a Loro doc) with two
  roles — **owner** + **member(rw)**. Not an ACL (no authoritative server enforces it); the only
  hard-enforced property is membership itself. Invalid records are skipped at CRDT replay.
- **Encryption** = one **transit key** per epoch, transport-only (the relay sees ciphertext),
  rotated as a unit by the owner. No per-object content keys, no at-rest content encryption.
- **Revocation** = owner-only `rotate` whose wrapped set omits the ousted member (atomic
  removeAndRotate — no forward-secrecy window); a re-key chain (`encPrev`) lets current members
  walk back to prior epochs.

The membership doc rides the relay's **plaintext envelope** (a public roster) so a joining device
can read it _before_ it holds the transit key; content docs ride **sealed**.

## 5. Relay form — one binary, three modes

The relay is one role of the **AppServer binary**, not a separate process. `--listen` is
**optional**, giving three modes:

| invocation              | mode          | runs                                                  |
| ----------------------- | ------------- | ----------------------------------------------------- |
| `app-server --listen …` | engine daemon | engine + gRPC ConnectServer                           |
| `app-server --relay …`  | relay-only    | only the broker — **no engine, no gRPC, no identity** |
| both                    | combined      | engine daemon that also hosts the relay               |

- Relay-only mode is how a dedicated relay machine runs (one process, no wasted engine).
- The recommended desktop form is **combined** (co-located always-on client + relay) — that client
  is the always-on member transport-only offline sync depends on (§2).
- A second `--relay` by mistake creates two relay islands (misconfiguration, not a crash);
  mitigated by explicit relay-address config.

## 6. Identity — actor (client/session) + peerId (per-dataRoot)

Authority: [`sync-identity-persistence.md`](./sync-identity-persistence.md) §3–§5. Summary:

- **The daemon has no identity.** Actors are **client-side**: declared per session (mnemonic at
  `sessionHello`; the daemon derives the keypair transiently, no attestation). One daemon, many
  actors, many sessions. Permissions follow the actor.
- **Actor keypair** (Ed25519, mnemonic-recoverable, Ed25519→X25519 dual-use): signs updates +
  membership records; wraps the transit key to members. The mnemonic is held by the client.
- **peerId** (random, per-dataRoot, non-secret): the Loro `setPeerId()` for VV uniqueness —
  identifies one replica (one running daemon for that dataRoot). Also the **routing identity** for
  directed requests (§3c). It is per-dataRoot, not per-actor (one replica per workspace; all local
  actors' edits flow through it; attribution rides on the actor signature).

## Honest security model

- Trust among members is **social, not technical**. A member has all data and keys; leakage cannot
  be prevented technically.
- The only technical boundary is **member vs non-member**, enforced by the **transit key**: members
  can AEAD-decrypt sync content; non-members cannot. The relay (untrusted, no-auth) routes only
  ciphertext.
- Roles are owner + member(rw) only — no admin/reader/writer tiers (cannot hard-enforce without an
  authority).
- Local at-rest disk encryption (stolen-device) is a separate, future feature unrelated to sync.

## Roadmap

> Live status lives in `_local/handoff/sync-handoff.md`. Design-time sequence (1–4 landed; 5 open):

1. **Directed client→client request capability** (§3c) — relay peerId tracking + directed routing +
   peer-list query. The foundation; lands alongside without breaking existing code.
2. **Identity refactor:** daemon has no identity (drops `--actor` / `--sync-workspace` /
   `ownerWorkspaces` / `actors.sqlite`); sync becomes a client-registered service (in-memory);
   `createWorkspace` inits the root with the session actor.
3. **join/sync split:** join establishes membership (directed fetch); sync does content.
4. **Relay-only mode** (`--listen` optional) + **tick → 20s** + CLI manual trigger.
5. **Then:** N>2 usage of the directed capability; CLI e2e; hardening (merge-cycle policy,
   `getNodeByID(ref)` guard, dirty-shard-only `persistMutation`, mid-sync-read gate breadth,
   lazy shard LOAD).

## What is borrowed from where

- **any-sync**: the conceptual frame (broadcast-push + directed-pull + gossip relay; signed-log
  membership; Ed25519→X25519 dual-use). Lode is simpler — Loro VVs are bounded and directly
  comparable, so lode needs none of any-sync's Merkle-bucket head-diff, coordinator/consensus, or
  hash-ring sharding (lode full-replicates). Confirmed from any-sync's own gc-partition: no
  tombstones needed (see `sharded-store.ts`).
- **hapi**: a **reachability/deployment** reference only — `tunwg` solves "expose a NAT'd home
  machine via a hosted public pipe," one of lode's deployment options (§3a), not lode's relay
  function. hapi's `CLI_API_TOKEN` shared-secret auth is NOT borrowed.
