# Sync Identity, Membership & Persistence — Design Decisions

This document records the decisions from the **identity / membership / persistence**
design pass that followed [`sync-design.md`](./sync-design.md). It is the resume anchor
for the engineer wiring identity, ACL membership, and per-dataRoot persistence into
production.

It references `sync-design.md` and **explicitly reverses one of its decisions** (§4 —
read-key-as-membership). Read `sync-design.md` first for the transport topology, the
broker, and the honest security model; this doc layers identity + membership + storage on
top.

Decisions were reached after studying any-sync (`/home/xac/codes/any-sync`, anytype's
sync layer) and anytype-heart (`/home/xac/codes/anytype-heart`, anytype's client),
specifically: the `peermanager.PeerManager` transport seam, the replicated signed ACL
log, Ed25519→X25519 dual-use keys, and SLIP-10/SLIP-21 derivation.

---

## Governing principle (unchanged from sync-design.md)

**Loro CRDT already guarantees convergence, validity, and no-resurrection.** The sync
layer's job is **reachability + membership**, not correctness. This doc concerns the
_membership_ and _identity_ halves, and how they persist.

---

## 1. Architecture boundary — engine stays transport-free (resolves handoff vs AGENTS.md)

The sync-relay handoff proposed putting the **broker and `SyncTransport` in the engine**.
`AGENTS.md` says the opposite: the engine "must not import `@lode/transport`", and
transport "owns bytes and connections only". We follow **AGENTS.md**, and any-sync proves
this is the right split.

any-sync's sync core (`commonspace/sync`, `headsync`) does **not** import `net/` on its
main path. It talks to the network through one interface — `peermanager.PeerManager`
(`BroadcastMessage` / `SendMessage` / `GetResponsiblePeers`), defined in the sync-side
package, implemented externally. Transports (yamux/QUIC/webtransport) are plugins behind a
2-method `Transport` interface; nothing in sync imports them.

**Lode mirrors this:**

| Layer                  | Owns                                                                                                                               | Must not               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **engine**             | `SyncManager` + the `SyncTransport` **interface** (docIds + bytes + VersionVectors) + peerId → `setPeerId`                         | sockets, AEAD, signing |
| **transport / daemon** | `Broker` (pub/sub) + `BrokerClientSyncTransport` adapter + read-key AEAD + actor signing + real WebSocket sockets + `--relay` mode | CRDT merge logic       |

The engine's existing `SyncTransport` interface is already clean — **no socket or
connection type crosses it**. any-sync's seam _leaks_ (`PeerManager` returns
`[]peer.Peer`, and `peer.Peer` exposes `AcquireDrpcConn`, dragging a wire type into the
core). **Lesson: keep `SyncTransport` socket-free.** If the adapter needs connection
state, it owns it internally; never add a `Connection`/`Peer` type to the interface.

> Broker packaging (it is heavier than AGENTS.md's "bytes and connections only") is a
> secondary call — `@lode/transport`, a new `@lode/sync-net`, or `@lode/daemon`. The
> principle that matters: **not in the engine, behind the `SyncTransport` interface.**

---

## 2. Membership model — full ACL log (model C). This REVERSES sync-design.md §4

sync-design.md §4 chose **read-key-as-membership** (egalitarian, no admin, no roles), and
explicitly rejected any-sync's admin/ACL. **We reverse that.** Membership is now a
**replicated, signed, append-only ACL log** — any-sync's model.

**Why:** the alternatives we considered (A egalitarian, B lightweight owner-only) are both
**degenerations of C**. Under "no compromise", shipping a degenerate form means re-doing
the membership representation later. C subsumes A (all members equal = an ACL log where
everyone is admin) and B (single immutable owner = an ACL log with one admin). Build C
once.

**What C is:**

- The ACL log is a **Loro doc/sub-doc inside the workspace** — so it syncs for free through
  the existing `SyncManager`, and lands in the existing `workspaces/<wsId>/` store. No new
  storage location.
- It is an **append-only, signed** log of records encoding: **members** (actor pubkeys) +
  their **roles** (admin / writer / reader) + each member's **read-key wrapped to their
  actor pubkey** (X25519 box) + the **current read-key epoch**.
- ACL changes (add/remove member, change role, rotate key, transfer ownership) are signed
  records. **Validity = the signer is authorized by the current ACL state** (admin).
  Clients replay the log → derive ACL state → know who is a member, their role, and unwrap
  their read-key.
- **Re-key chain** (`encryptedPreviousReadKey`, AES-256-GCM): the previous epoch's read-key
  is encrypted under the new one, so a current member can walk back and decrypt all
  historical epochs; a removed member (whose wrapped key is absent from new epochs) cannot.

**Role enforcement is layered, hard vs soft:**

| Concern                  | Mechanism                                                          | Strength                      |
| ------------------------ | ------------------------------------------------------------------ | ----------------------------- |
| **Read (decrypt)**       | read-key wrapped to actor pubkey in ACL                            | hard crypto                   |
| **ACL change (admin)**   | admin signature on the log record                                  | hard crypto (forge-resistant) |
| **Content write (edit)** | client-side cooperative role check + needs read-key to participate | soft                          |

This is exactly the model any-sync uses. The honest caveat carries over from
sync-design.md's security model: enforcement is over the **accepted shared state**, not
over what a member who already holds the data does offline. A member can read everything
they have and maintain a local fork; they cannot produce ACL changes honest peers accept.

**Consequence for §4:** the read-key **no longer is** the membership credential. The ACL
log is the sole source of membership; the read-key is the content-encryption key wrapped
_within_ it. sync-design.md §4 and §6 must be read as superseded by this section.

---

## 3. Identity — actor keypair + per-dataRoot peerId

Two distinct identities, do not conflate them:

**Actor keypair** (Ed25519, per-user) — the membership/attribution principal. Generated on
first run, stored in a keystore, **recoverable via mnemonic**. All of a user's devices
share the same actor keypair (restored via mnemonic / QR / key-file import).

- **Signs** sync updates (attribution) and **ACL records** (admin authority).
- **Encrypts** via Ed25519→Curve25519 conversion (any-sync's dual-use trick; no separate
  X25519 keypair type) — used to wrap read-keys to members and to seal re-key messages.
- **Mnemonic:** BIP-39 (12 words) → SLIP-10 / BIP-44 hardened derivation → 32-byte seed →
  Ed25519. The mnemonic is the recovery root for the actor identity (mirrors any-sync's
  `util/crypto/mnemonic.go`).

**Device peerId** (random UUID, per-**dataRoot**, non-secret) — set as the Loro
`doc.setPeerId()` for VV uniqueness. It identifies _one replica of the store_, i.e. one
running daemon. It is **not** the actor (attribution) and is **not** per-actor — see §6.

> §8's name "device peerId" is now slightly misleading: with multiple dataRoots per
> machine (§5), the unit is the dataRoot, not the machine. Read it as "per-dataRoot replica
> site id".

**No password KDF** (no argon2/scrypt/bcrypt) — same as any-sync. The mnemonic is the
secret; the keystore file is `0600`. At-rest disk encryption (stolen-device) remains a
separate future feature (sync-design.md §5).

---

## 4. Daemon topology — one root per machine; actor declared per session

The daemon is a **single AppServer process per machine**, bound to one dataRoot. An actor
is **declared per connection/session**, not per daemon startup. Multiple actors on one
machine = multiple client connections to the same daemon, each its own session.

This matches the existing session layer: `SessionHelloRequest` already carries an `actor`,
`SessionManager.createSession` stores it per connection, and `requireOrigin` returns
`{ nodeId, actorId, sessionId }`. The mechanism exists; what's missing is making the actor
**keypair-backed** (verify the session really holds the actor's private key) and adding an
actor registry + keystore.

**New daemon responsibility: actor authentication.** A session declaring actor X must prove
it holds X's private key (challenge-response, reusing any-sync's handshake pattern). The
daemon gates workspace access on this. (Local access derivation is in §7.)

---

## 5. Storage scoping — everything per-dataRoot, NOT per-machine

A machine may host **multiple dataRoots** (separate lode profiles / instances). **Actor
registry, keystores, and peerId are all stored per-dataRoot.** The machine is just a host;
it holds no shared cross-dataRoot state.

**Why (correctness, not just tidiness):** two dataRoots on one machine can each hold a
replica of the **same shared workspace** (two sqlite files, two Loro docs, same wsId —
e.g. two profiles whose actors are both members of W). Each replica needs its own peerId
(Loro site id). If peerId were per-machine, both replicas would share a site id and
**collide in W's version vector** → concurrent edits corrupt the VV. Per-dataRoot peerId
gives each replica a distinct site id.

**Why (portability):** a dataRoot is the self-contained, portable unit (registry +
workspaces + identities). Per-machine identity storage would put state outside the
dataRoot — copying/moving/backing up a dataRoot to another machine would lose identities,
breaking the local-first portability guarantee. Per-dataRoot: copy the directory, get a
complete lode with its identities.

The only machine-level concern is a **process singleton** (one daemon per dataRoot at a
time, like not opening the same sqlite concurrently) — a process lock, unrelated to
identity/storage.

---

## 6. Permissions are per-actor, not per-device

The **actor is the principal/member**; the device is just a host. ACL records name actors
(pubkeys), not devices. Rationale:

- per-device membership would let all actors on a device share one membership — but actors
  are meant to be isolated identities (personal vs work); you do not want one actor's
  membership to leak into another's view.
- consistent with §3 (actor is the cross-device identity) and with any-sync (account =
  member).
- the broker routes by `workspaceId`, so multiple actors' workspaces flowing through one
  relay are isolated by distinct wsIds.

**peerId is NOT per-actor.** The daemon holds one replica per workspace; all local edits
to a workspace (by any local actor) flow through that one replica → one peerId. Actor
attribution is carried by the actor signature on each update, separate from peerId. So:
peerId = per-dataRoot (one daemon), actor = per-session (attribution + membership
principal). These are different axes.

---

## 7. Workspace stored ONCE; actor↔workspace is a mapping, not a path

A workspace is stored once at `workspaces/<wsId>/`, keyed by wsId — **never nested under an
actor** (which would duplicate storage + duplicate sync when multiple actors share it).
This is the current behavior; it does not change.

The actor↔workspace relationship is **derived from the replicated ACL log**, not a local
table: "can local actor X open workspace W?" = "is X in W's ACL?" There is no separate
local access table. (If a default-all-local-actors-open policy is wanted for non-ACL
convenience, that is a local daemon UX choice layered on top, not a membership fact.)

---

## 8. Persistence layout (concrete)

```
<dataRoot>/
  registry.sqlite              # workspace catalog (existing): wsId → relativePath, displayName
  device.peerId                # this dataRoot's Lora site id (non-secret); or a registry_meta key
  actors.sqlite                # actor catalog (NEW): actorId → displayName / pubkey / createdAt
  actors/<actorId>/
    keystore                   # actor Ed25519 private key (0600); mnemonic-derived on first run
  workspaces/<wsId>/           # workspace stored ONCE (unchanged)
    workspace.sqlite           # docs + crdt_updates + crdt_snapshots + workspace_meta
                               #   + the ACL log as one of its docs/shards (syncs like any doc)
```

Separation of concerns: `registry.sqlite` = which workspaces exist on this dataRoot;
`actors.sqlite` = which actors exist on this dataRoot; the **ACL log (in each workspace)**
= global membership/roles (replicated, authoritative).

---

## 9. Recovery model — re-add by an admin, then full history via the chain

A lost device loses its local keystore and read-keys. Under C, recovery is:

1. Enter mnemonic → derive actor Ed25519 key (same actor pubkey as before).
2. An **admin re-adds your actor** to the workspace (a signed ACL record wrapping the
   _current_ read-key to your actor pubkey). This step is **social** — lode has no
   coordinator/naming service to self-discover workspaces (any-sync relies on its
   coordinator for that bootstrap, which lode deliberately does not have).
3. You unwrap the current read-key, then **walk the re-key chain backward** to decrypt all
   historical epochs.

So C's win over the egalitarian model: re-add gives you **full history**, not just
content from the re-invite forward (the chain lets the current key decrypt prior epochs).
The bootstrap (finding/re-joining the workspace) stays social.

**Open question:** self-service workspace _discovery_ on a fresh device (without a
coordinator) is unsolved. MVP accepts social re-add; a future lightweight discovery path
is deferred. See §11.

---

## 10. Playground-first — validate the ACL log before production wiring

C is **security-critical and conceptually new** (ACL log merge semantics, signature
verification, re-key chain, membership lifecycle). Following the P0–P6 discipline that
de-risked the transport layer, validate C in the playground first (phase **P7**), then wire
to production. **P7 green is the gate for production ACL wiring** — the detailed validation
plan lives with the playground in
[`experiments/sync-transport/README.md`](../../experiments/sync-transport/README.md) §P7
(scope: ACL-log CRDT merge semantics, read-key wrapping + re-key chain, member lifecycle,
security properties, recovery; substrate: raw `loro-crdt` + `node:crypto`, no engine,
reusing P4/P5). The detailed plan is intentionally NOT here — it is playground-coupled and
goes away when `experiments/` is deleted after porting to production.

---

## 11. Reversals & open questions

**Reversals of `sync-design.md`:**

- **§4 reversed.** Membership is no longer read-key-as-membership. It is the **ACL log**
  (§2 of this doc). The read-key is the content-encryption key wrapped within the ACL log.
  §4/§6's "egalitarian, no admin, no roles" is superseded.
- **§8 "device peerId"** is re-scoped to **per-dataRoot** (§3, §5), not per-device.

**Open questions (to resolve in/after P7):**

- **Workspace discovery on a fresh device** without a coordinator (§9). MVP = social re-add.
- **Exact role set for MVP** (admin + member, or admin/writer/reader). C supports roles; the
  MVP cut is a playground/implementation call.
- **Broker packaging** (`@lode/transport` vs new `@lode/sync-net` vs `@lode/daemon`) — §1.
- **Local default-access UX** (do all local actors open all local workspaces by default, or
  is it ACL-gated everywhere?) — §7. A daemon UX choice, not a membership fact.

---

## 12. Roadmap (dependency order, updated)

1. **Foundation:** per-dataRoot device peerId (persist + feed `setPeerId`) → actor keypair +
   keystore + actor registry (`actors.sqlite`) → actor-authenticated sessions (daemon
   verifies the session holds the actor's private key).
2. **Playground P7:** the ACL log layer (§10) — merge semantics, crypto wrapping, lifecycle,
   security properties, recovery. **Gate:** do not start production ACL wiring until P7 is
   green.
3. **Production ACL:** port the validated ACL log into the engine as a workspace doc; wire
   membership derivation + re-key + role enforcement.
4. **Transport (relay/broker + client):** the workspace-routing broker + `SyncTransport`
   over the broker + read-key AEAD + actor signing, in the transport/daemon layer (§1).
5. **Coordinate management:** workspace coordinate create/import/export (relay addr, wsId,
   ACL bootstrap).
6. **Hardening (alongside):** the items already listed in sync-design.md's roadmap (merge-cycle
   policy, `getNodeByID(ref)` guard, dirty-shard-only `persistMutation`, mid-sync-read gate
   breadth, lazy shard LOAD).
