# Sync Design Decisions

This document records the stable decisions for lode's **Phase D** — real network sync across
devices. It explains **why** each choice was made: the constraints, the alternatives rejected,
and the trade-offs. The in-process CRDT sync core (`SyncManager` / `sweepOrphans` in
`@lode/engine`) is already landed and truth-tested; Phase D makes it reachable over a network.

Decisions were reached after studying the source of **any-sync** (`/home/xac/codes/any-sync`,
anytype's sync layer), **anytype-heart** (client), and **hapi** (`/home/xac/codes/hapi`, a
local-first remote-control app with a relay model).

## Governing principle

**Loro CRDT already guarantees convergence, validity, and no-resurrection.** The sync layer's
only job is therefore **reachability** (getting bytes across networks/NAT) and **membership**
(who you choose to sync with) — not correctness. Everything below follows from pushing work
out of the sync layer and onto the CRDT + social trust.

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
  reconnects, some client holding the workspace is online. **Transport-only ⇒ robust offline
  sync requires an always-on member client.** This is why the recommended relay form is
  co-located with a client (§7): that client is online whenever the relay is, providing the
  durable member.
- CRDT transitivity ⇒ a client only needs to sync with **one** up-to-date peer to converge.

## 3. Relay — a workspace-routing broker (routing-aware, content-blind)

The relay is **not** a dumb byte pipe. Clients register the workspaces they hold (subscribe), and
the relay **routes messages by workspace** to the subscribed clients. Worked example (devices A/B/C,
relay on B): A, B, C each subscribe their workspaces. A edits shared workspace W → relay forwards
that message **only** to B and C (W's other subscribers). A's private workspace W_A (A is the only
subscriber) → relay does **not** forward it to B/C. A dumb broadcast would leak private workspaces'
metadata/traffic to non-subscribers; routing by subscription is required.

The relay's exact scope:

- **Routing-aware** — it knows a subscription table (client → subscribed workspace ids) and routes
  each message to that workspace's subscribers. This is the minimal "data flow" logic the relay owns.
- **Content-blind** — it does NOT understand sync RPCs, VVs, or update bytes. Clients encrypt
  end-to-end (§5); the relay routes opaque ciphertext.
- **No auth** — it does not decide membership. Clients enforce the read-key AEAD (§4) + actor
  signature checks; the relay forwards whatever a subscriber publishes, and a non-member (lacking
  the read-key) cannot decrypt it anyway.
- **No content storage** — local-first: the relay forwards, never persists workspace content (§2).

> Earlier drafts waffled between "dumb byte pipe" and "sync-aware router." The relay is neither
> extreme: it is **routing-aware** (by workspace subscription) but **content-blind** (no CRDT/auth
> semantics). It must route — broadcasting everything to every client would leak private-workspace
> traffic to non-subscribers.

**Reachability is a SEPARATE concern (§3a).** How clients reach the relay (LAN / VPS / tunwg /
Cloudflare / Tailscale) is a deployment dimension, orthogonal to the relay's function above.

## 3a. Reachability — an independent deployment dimension

The relay (§3) must be reachable by its clients. **How** that reachability is achieved is a
deployment choice, **orthogonal to the sync design** — the relay is the same workspace-routing
broker regardless. Options, in increasing setup cost:

- **Same LAN** — clients connect to the relay directly (e.g. relay on device B, A/C dial B's LAN
  address). No public infrastructure needed at all.
- **Public VPS** — the relay runs on a VPS with a public IP; clients dial out to it. Simplest
  cross-network option; the user provides the VPS (or Cloudflare Tunnel / port-forward to a home
  machine). Pure Node; no external binary.
- **tunwg / hosted dumb pipe** — the relay runs on a user's NAT'd home machine and is exposed via a
  shared public dumb pipe (tunwg-style, with auto-cert). This is the option that lets **each user
  group self-host the relay at home** rather than on a VPS — useful in multi-user scenarios. It is
  **one deployment option, not MVP, and not part of the sync design**: it bundles a Go binary +
  WireGuard + a hosted public server, and is only about reachability, not routing/sync.

**tunwg is not being built for MVP.** It exists in this doc only to record that "relay on a NAT'd
home machine, exposed via a public pipe" is a _deployment_ path available later. The sync logic
(client ↔ workspace-routing relay) is identical across all reachability options.

## 4. Membership — possession of the workspace read-key (egalitarian, no admin)

> **⚠️ REVERSED — see [`sync-identity-persistence.md`](./sync-identity-persistence.md) §2.**
> Membership is now a **replicated signed membership log** with two roles — owner + member(rw)
> — no admin/reader/writer tiers. The read-key is no longer the membership credential; it is the
> **transit key** wrapped _within the membership log_. The egalitarian/no-roles model below is
> kept only as the historical rationale for the decision we later overturned.

A workspace is a set of devices that have agreed to sync. **All members are equal; there is no
admin and no fine-grained role (read-only/admin).**

- **Membership = who holds the workspace read-key.** The workspace **coordinate** is
  `(relay address, workspaceId, read-key)`; whoever has it is a member. There is no separate pubkey
  allowlist — the read-key does double duty as the membership credential AND the content-encryption
  key (§5). This is simpler than a pubkey allowlist + a separate encryption key.
- **Identity = actor keypair** (per-user, generated on first run, recoverable via mnemonic; §8) +
  **device peerId** (random UUID per device = the Loro VV id, for uniqueness across a user's
  devices). The actor key SIGNS updates (attribution) and encrypts re-key messages — it is NOT the
  membership credential.
- **Invite (add):** any member shares the coordinate out-of-band (QR / link); the recipient imports
  it → has the read-key → is a member. Trust is social (a member has full data).
- **Rejected:** any-sync's admin-signed ACL + roles (local-first can't enforce roles; binary
  membership only), AND a separate pubkey allowlist (read-key-as-membership subsumes it — the key
  is the membership).

## 5. Encryption — `node:crypto` AEAD with the workspace read-key

Clients encrypt sync content end-to-end with the workspace **read-key** (AEAD, e.g. AES-256-GCM);
the relay (§3) routes **opaque ciphertext** and cannot read workspace content. The read-key is
generated with the workspace and shared via the coordinate/invite (§4). No WireGuard (that was
tunwg-bundled; tunwg is now only an optional reachability choice, §3a).

- **The read-key IS the membership credential** (§4) — possessing it = being a member. A recipient
  AEAD-decrypts; success proves the sender held the key (member), failure = non-member (discard).
  Membership is enforced by cryptography, not a list.
- **What it protects:** the relay (untrusted, no-auth) and any non-member subscriber cannot read
  content — they lack the read-key. This is the transit-privacy property.
- **What it does NOT protect:** a member leaking the key/data (fundamental — a member has
  everything; no encryption constrains a willing leaker). "Anti-collusion" is not a real property.
- **Local at-rest** disk encryption (stolen-device) is a separate, future feature unrelated to sync.

## 6. Revocation — rotate the read-key, accept the fork

**You cannot confiscate data a peer already has** (fundamental to local-first). Revocation stops
_future_ content from being readable by the ousted member:

- A remaining member **rotates the workspace read-key** and distributes the **new key** to the
  other remaining members (encrypted to their actor pubkeys, §8). Updates after the rotation are
  AEAD'd with the new key.
- The ousted member keeps the OLD key (can still read what they cached/recorded — can't confiscate)
  but cannot read NEW content (new key) nor produce valid updates for the rotated workspace.
- No admin — any member can rotate; the social agreement is "the remaining members adopt the new
  key." Full cutoff is social, same as any local-first revocation.

## 7. Relay form — a daemon role; placement is deployment (§3a)

The relay (the §3 workspace-routing broker) is one role of the **AppServer daemon**, not a separate
binary. A machine runs `--relay` to act as the broker; clients (mobile, other devices) dial it.
**Where** that machine lives is the reachability/deployment dimension (§3a) — LAN, VPS, or a
tunwg-exposed home machine — and does not change the broker's function.

- The recommended form co-locates the relay with an always-on client (the user's desktop daemon
  runs `--relay` AND holds its workspaces). This satisfies §2: that co-located client is the
  always-on member that transport-only offline sync depends on.
- Relay mode is **opt-in** (`--relay`), **not the default**. Default = client mode (dial a
  configured relay). Starting a second `--relay` by mistake creates two relay islands
  (misconfiguration, not a crash); mitigated by explicit relay-address config.
- A dedicated relay-only process (no co-located client) is supported but weaker for offline sync
  (no always-on member unless a separate device is always-on).

## 8. Identity — actor keypair + device peerId

> **⚠️ Partially revised — see [`sync-identity-persistence.md`](./sync-identity-persistence.md)
> §3 & §5.** The "device peerId" is re-scoped to **per-dataRoot** (one replica site id per
> running daemon), not per-device — a machine may host multiple dataRoots, and two dataRoots
> holding the same shared workspace need distinct site ids or their version vectors collide.
> The actor keypair description below otherwise stands (Ed25519, mnemonic-recoverable).

**Actor keypair** (Ed25519, per-user): generated on first run, stored in a local keystore,
recoverable via a **mnemonic** (BIP39-style). All of a user's devices share the same actor keypair
(restored via mnemonic / QR / key-file import). The actor key is used to:

- **SIGN sync updates** (attribution: "this edit is by actor1").
- **ENCRYPT re-key messages** (distribute a new read-key to specific members after revocation, §6).

It is NOT the membership credential (membership = read-key, §4).

**Device peerId** (random UUID, per-device, non-secret): set as the Loro `doc.setPeerId()` for VV
uniqueness. Loro's peerId must be unique per concurrent editor — if two devices of the same actor
shared a peerId, concurrent edits would corrupt the VV. The device peerId is generated locally and
needs no coordination beyond randomness.

This replaces the engine's current runtime `randomUUID` nodeId, which is only an in-process id.

## Honest security model

- Trust among members is **social, not technical**. A member has all data and keys; leakage
  cannot be prevented technically.
- The only technical boundary is **member vs non-member**, enforced by the **read-key**: members
  can AEAD-decrypt sync content; non-members (no key) cannot.
- The relay is untrusted and harmless: clients E2E-encrypt (`node:crypto` AEAD with the read-key,
  §5), so the relay routes only ciphertext.
- No admin, no roles, no separate allowlist. The model is deliberately minimal and egalitarian.

## Roadmap (dependency order)

1. **Foundation (topology-agnostic):** device identity (keystore + stable peerId) → wire
   `SyncManager` into the runtime + export from the engine public API (audit BLOCKER 1) →
   `VersionVector` wire encode/decode (audit BLOCKER 2) → re-port the reconcile-before-resync
   hazard characterization test.
2. **Transport (the relay/broker + client transport):** the workspace-routing **relay** (§3:
   subscription table + route-by-workspace, content-blind, no data) + client-side `SyncTransport`
   (the validated pairwise sync protocol over the relay) + read-key AEAD auth + proto/CLI
   (`sync --relay <url>`). **Reachability (§3a) is deployment, not this layer** — LAN/VPS suffice
   for MVP; tunwg-exposed-home is a later option.
3. **Membership:** workspace coordinate `(relay addr, workspaceId, read-key)` — create/import/
   export; the read-key IS the membership credential (§4); no allowlist.
4. **Hardening (alongside):** merge-cycle policy (concurrent moves forming a cycle on merge —
   Loro abort), Loro `getNodeByID(ref)` upstream-panic guard, `persistMutation` dirty-shard-only,
   mid-sync-read gate breadth, lazy shard LOAD (async `shardLoader`).

## What is borrowed from where

- **any-sync** (`/home/xac/codes/any-sync`): the conceptual frame (per-object sync, VV/head diff,
  store-and-forward among replicas). Lode is simpler — Loro VVs are bounded and directly
  comparable, so lode needs none of any-sync's Merkle-bucket head-diff or coordinator/consensus
  machinery. Lode also confirmed (from any-sync's own gc-partition verification) that no-resurrection
  does not need tombstones — see the tombstone removal in `sharded-store.ts`.
- **hapi** (`/home/xac/codes/hapi`): a **reachability/deployment** reference, not a transport
  reference. hapi's `tunwg` / `tunnelManager.ts` solves "expose a NAT'd home machine via a hosted
  public dumb pipe" — that is ONE of lode's deployment options (§3a), not lode's relay function
  (lode's relay is the §3 workspace-routing broker, which hapi's tunwg pipe is NOT). hapi's
  `CLI_API_TOKEN` auth is _not_ borrowed — it is shared-secret connection auth, not actor identity;
  lode uses read-key AEAD for membership (§4) + actor keypairs for signing (§8) instead.
