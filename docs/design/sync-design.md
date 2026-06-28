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
- **No auth** — it does not decide membership. Clients enforce the allowlist (§4) + signature checks;
  the relay forwards whatever a subscriber publishes, and a non-member cannot decrypt it anyway.
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

## 4. Membership — egalitarian, no admin, no roles

A workspace is a set of devices that have agreed to sync. **All members are equal; there is no
admin and no fine-grained role (read-only/admin).**

- **Membership = who holds the workspace coordinate** (relay address + workspaceId + tunnel
  credential). The set of devices that can sync = the set whose public keys are in each member's
  **allowlist** for that workspace.
- **Invite (add):** any member shares the coordinate out-of-band and adds the new device's pubkey
  to its allowlist. Trust is social — you only invite people you trust, because a member has full
  data and can invite others.
- **Rejected: any-sync's admin-signed ACL + roles.** Local-first has no authority: any member
  with a full replica can "write"/fork locally, so roles cannot be technically enforced. Binary
  membership (in/out) is the only enforceable boundary. (any-sync carries admin/ACL because it
  has a coordination layer; lode does not.)

## 5. Encryption — client-to-client E2E (`node:crypto` AEAD)

Clients encrypt sync content end-to-end with each other (AEAD, e.g. AES-256-GCM); the relay (§3)
routes **opaque ciphertext** and cannot read workspace content. This is the transit-privacy property,
done in pure Node (`node:crypto`) — **no WireGuard**. (WireGuard was tied to tunwg; with tunwg now
just an optional reachability choice (§3a), encryption is lode's own `node:crypto` AEAD.)

- **No workspace read-key / content encryption beyond transit AEAD.** Members are trusted by
  definition (they hold all data and any keys); extra encryption cannot constrain a member who wants
  to leak, so "defense against member collusion" is not a real property.
- **Non-members are excluded by the allowlist (§4) + cannot decrypt** — they get no key, and clients
  reject unsigned/non-member updates. So there is nothing more to encrypt against.
- The only encryption that matters and is **not** covered here is **local at-rest** disk encryption
  (stolen-device defense) — a separate, future feature unrelated to sync.

## 6. Revocation — cut the tunnel, accept the fork

**You cannot confiscate data a peer already has** (fundamental to local-first). Revocation only
stops _future_ updates:

- Members agree (out-of-band) to **remove the revoked peer's pubkey from their allowlists** → the
  peer can no longer open tunnels to any member → transport-level cutoff. Its local copy freezes
  at the revocation point; it gets no new updates.
- No admin action — each member just maintains its own allowlist; the social agreement is "all of
  us drop this pubkey."
- If a hard cutoff is ever needed beyond tunnel-dropping (e.g., worry that a member keeps the
  ousted peer's tunnel alive), the group migrates to a new workspace (new coordinate), excluding
  the ousted peer. This is "move the party elsewhere," not "kick from the existing workspace."

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

## 8. Identity — device keypair

Each device has a signing keypair. The public key is the device identity and serves as:

- the **allowlist membership key** (§4 — workspace membership is "whose pubkey is in the list"), and
- the **signing key** for sync auth (peers prove they own the claimed pubkey; playground P4).

(Loro's `setPeerId` takes a NUMERIC id, so pubHex→Loro-peerId mapping is a production-integration
detail; the playground enforces membership at the connection gate, which is where it structurally
belongs. An actor may own multiple devices; multi-device-per-actor grouping is higher-level, not
required for the sync mechanism.) This replaces the engine's current runtime `randomUUID` nodeId,
which is only an in-process id.

## Honest security model

- Trust among members is **social, not technical**. A member has all data and keys; leakage
  cannot be prevented technically.
- The only technical boundary is **member vs non-member**, enforced by the pubkey allowlist
  (non-members cannot sync — clients reject them at the gate).
- The relay is untrusted and harmless: clients E2E-encrypt (`node:crypto` AEAD, §5), so the relay
  routes only ciphertext.
- No admin, no roles, no workspace read-key. The model is deliberately minimal and egalitarian.

## Roadmap (dependency order)

1. **Foundation (topology-agnostic):** device identity (keystore + stable peerId) → wire
   `SyncManager` into the runtime + export from the engine public API (audit BLOCKER 1) →
   `VersionVector` wire encode/decode (audit BLOCKER 2) → re-port the reconcile-before-resync
   hazard characterization test.
2. **Transport (the relay/broker + client transport):** the workspace-routing **relay** (§3:
   subscription table + route-by-workspace, content-blind, no data) + client-side `SyncTransport`
   (the validated pairwise sync protocol over the relay) + allowlist auth + proto/CLI
   (`sync --relay <url>`). **Reachability (§3a) is deployment, not this layer** — LAN/VPS suffice
   for MVP; tunwg-exposed-home is a later option.
3. **Membership:** workspace coordinate + pubkey allowlist; client-side "sync only with allowlist
   members."
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
  lode uses per-device keypairs + allowlists instead.
