# Sync Identity, Membership & Persistence — Design Decisions

This document records the decisions from the **identity / membership / persistence**
design pass that followed [`sync-design.md`](./sync-design.md). It is the resume anchor
for the engineer wiring identity, membership, and per-dataRoot persistence into
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

**Lode mirrors this — but with a shared sync package, not a daemon-only layer.** The
constraint that decides the packaging: AGENTS.md says the **desktop** runtime is one daemon
wrapping engine + transport, while **mobile** uses `@lode/engine` **in-process** (no daemon).
Mobile is still a device that must sync (dial the relay, AEAD, sign, run the broker client) —
so the sync transport **cannot live daemon-only**. It goes in a shared package both depend on:

| Layer                  | Owns                                                                                                                                                                             | Used by                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **`@lode/engine`**     | sync core (`SyncManager` + the `SyncTransport` **interface**: docIds + bytes + VVs) + peerId → `setPeerId` + actor identity (keypair/keystore/`ActorStore`) + the membership log | daemon + mobile + apps |
| **`@lode/sync`** (new) | `Broker` client + `Broker` server (`--relay`) + `BrokerClientSyncTransport` adapter + transit-key AEAD + actor wire signing + real WebSocket sockets                             | daemon + mobile        |
| **`@lode/daemon`**     | thin desktop host: engine + sync(client) + broker server (`--relay`) + IPC transport + process lifecycle                                                                         | desktop                |
| **mobile**             | engine (in-process) + sync (client — dials the relay directly, no daemon)                                                                                                        | mobile                 |

Engine stays transport-free (no sockets/AEAD/wire-signing) and holds actor identity because
**both** the membership log replay (engine: verify signatures) and the wire (sync: sign messages)
need it — the lowest shared layer. The broker **server** (`--relay`) also lives in `@lode/sync`;
the daemon merely hosts it, and mobile uses only the client half. Not `@lode/transport` —
that package is the IPC transport (gRPC to the daemon); the sync broker/AEAD/signing is a
different concern.

The engine's existing `SyncTransport` interface is already clean — **no socket or
connection type crosses it**. any-sync's seam _leaks_ (`PeerManager` returns
`[]peer.Peer`, and `peer.Peer` exposes `AcquireDrpcConn`, dragging a wire type into the
core). **Lesson: keep `SyncTransport` socket-free.** If the adapter needs connection
state, it owns it internally; never add a `Connection`/`Peer` type to the interface.

> **AGENTS.md follow-up (pending user confirm):** AGENTS.md currently says "in-process
> clients (mobile) may depend on `@lode/engine`" — this should expand to "`@lode/engine` +
> `@lode/sync`" so mobile can reach the shared sync transport.

---

## 2. Membership model — owner + member log (reverses sync-design.md §4)

sync-design.md §4 chose **read-key-as-membership** (egalitarian, no roles). **We reverse
that.** Membership is a **replicated, signed, append-only membership log** in a Loro doc — but
it is **not an ACL**: lode has no authoritative server to enforce access rules, so there is no
"access control list." The log is the source of truth for _who is in_ the workspace, _who
owns_ it, and each member's _transit key_. The only hard-enforced property is membership itself
(possession of the transit key); everything else is a log fact that honest clients respect
cooperatively.

**Why a log, not just a read-key:** a read-key alone can't represent ownership transfer,
revocation with forward secrecy, or membership history. The log records those transitions
signed by the owner; clients replay it to derive the current membership and unwrap their
transit key. (Earlier A/B/C framing is dropped — the result is the simpler owner+member log
below; lode has no admin/writer/reader tiers, unlike any-sync's full ACL.)

**Two roles only:**

- **owner** — the single governance authority. Adds/removes members, rotates the transit key,
  transfers ownership. Exactly one owner at a time.
- **member (rw)** — full read+write; cannot manage membership or keys.

No admin tier (so no "multiple admins mutually removing each other" conflict), no
reader/writer distinction (it cannot be hard-enforced without an authority — see §6).

**Owner-only governance is the conflict-eliminator.** Because only the owner issues
governance records (`add` / `removeAndRotate` / `rotate` / `transfer`), there is no
multi-party concurrent governance to resolve: no mutual-removal, no concurrent rotates. The
CRDT-skip replay rule (skip records with a bad signature, an unknown signer, or — for rotate
— a stale epoch) is still needed to reject forged records, but the sharp conflict edges a
multi-admin model creates (e.g. concurrent-rotate loser content loss) do not arise.

**What the log records (protobuf in `@lode/protocol`, stored as bytes in a LoroList):**

- `root` — owner self-signs; carries the owner's transit key wrapped to the owner.
- `add` — owner adds a member; the current transit key wrapped to the member.
- `removeAndRotate` — owner removes a member **and** rotates the transit key in one atomic
  record (forward secrecy with no window; the only revocation path).
- `rotate` — owner re-keys (transit-key rotation) without changing membership.
- `transfer` — owner transfers ownership to an existing member (atomic demote-old +
  promote-new).

The log is a **Loro doc inside the workspace**, so it syncs for free through `SyncManager`
and lands in the existing `workspaces/<wsId>/` store — no new storage location. Validity =
the record's signature verifies AND the signer is the current owner (root is self-authorizing).
Invalid records are **skipped at replay**, not fatal — deterministic given the merged Loro
list, so every replica converges to the same membership.

**Transit key, not a content key.** The wrapped key is the **transit key**: it encrypts sync
messages in transit (`node:crypto` AEAD), so the untrusted relay sees only ciphertext.
**Encryption is transport-only** — content at rest is unencrypted (at-rest disk encryption is
a separate, future feature; sync-design §5). There is **no per-object content encryption and
no per-object key derivation**; the transit key is one key per epoch, rotated as a unit.

**Re-key chain** (`encPrev` = AEAD(newTransitKey, oldTransitKey) on each rotate): a current
member walks back to decrypt transit from any prior epoch; a removed member (no wrapped key in
new epochs) cannot. Rotate only re-wraps the transit key to survivors (O(members)); content is
never re-encrypted.

**Self-signed root, no masterKey.** The root is signed by the owner's actor key alone. The
actor key **is** the mnemonic-derived key (§3), so "same actorId" is cryptographic continuity
— a recovered owner on a new device re-derives the same key and signs as owner. any-sync's
masterKey co-signature exists to bind a _rotating_ sign key to a stable recovery key; lode's
actor key doesn't rotate, so co-signing is redundant. (Self-sign chosen over co-sign.)

**Owner continuity vs. node death.** A dead owner device with the mnemonic alive → owner
re-derives the same key on a new device → continues as owner or transfers. If **both** the key
and the mnemonic are lost, governance is frozen (members keep rw access to existing content but
cannot add/remove/rotate/transfer) — the honest lower bound of a no-authority model.
**Quorum-based owner succession is deferred (not MVP).**

**Consequence for §4/§6:** the read-key is no longer the membership credential; it is the
transit key wrapped within the membership log. sync-design.md §4 and §6 are superseded by this
section.

---

## 3. Identity — actor keypair + per-dataRoot peerId

Two distinct identities, do not conflate them:

**Actor keypair** (Ed25519, per-user) — the membership/attribution principal. Generated on
first run, stored in a keystore, **recoverable via mnemonic**. All of a user's devices
share the same actor keypair (restored via mnemonic / QR / key-file import).

- **Signs** sync updates (attribution) and **membership-log records** (owner authority). The
  owner's actor key is the governance signer; it does **not** rotate, so it is its own recovery
  anchor (no masterKey co-signature — see §2).
- **Encrypts** via Ed25519→Curve25519 conversion (any-sync's dual-use trick; no separate
  X25519 keypair type) — used to wrap the **transit key** to members and to seal re-key
  messages. (Production dual-use; the playground uses a separate X25519 keypair until F3b.)
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

## 6. Permissions are per-actor; roles are owner + member

The **actor is the principal/member**; the device is just a host. Membership-log records name
actors (pubkeys), not devices. Rationale:

- per-device membership would let all actors on a device share one membership — but actors
  are meant to be isolated identities (personal vs work); you do not want one actor's
  membership to leak into another's view.
- consistent with §3 (actor is the cross-device identity) and with any-sync (account =
  member).
- the broker routes by `workspaceId`, so multiple actors' workspaces flowing through one
  relay are isolated by distinct wsIds.

**Roles: owner + member (rw) only.** No admin/writer/reader tiers. The owner is the single
governance authority (§2); members are full rw. The only hard-enforced property is membership
(transit-key possession). Anything beyond that ("a member must not do X") is
**cooperative/client-side**: a rogue member with the transit key can decrypt and produce
updates, and honest clients respect the log, but there is no authoritative server to reject a
rogue's writes. This is the honest cost of no-authority local-first (see §2).

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

The actor↔workspace relationship is **derived from the replicated membership log**, not a local
table: "can local actor X open workspace W?" = "is X in W's membership log?" There is no
separate local access table. (If a default-all-local-actors-open policy is wanted for
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
                               #   + the membership log as one of its docs/shards (syncs like any doc)
```

Separation of concerns: `registry.sqlite` = which workspaces exist on this dataRoot;
`actors.sqlite` = which actors exist on this dataRoot; the **membership log (in each workspace)**
= global membership/roles (replicated, authoritative).

---

## 9. Recovery model — re-add by the owner, then full history via the chain

A lost device loses its local keystore and transit keys. Recovery is:

1. Enter mnemonic → derive the actor Ed25519 key (same actor pubkey as before — the actor key
   is mnemonic-derived and does not rotate, §3).
2. The **owner re-adds your actor** to the workspace (a signed `add` record wrapping the
   _current_ transit key to your actor pubkey). This step is **social** — lode has no
   coordinator/naming service to self-discover workspaces (any-sync relies on its coordinator
   for that bootstrap, which lode deliberately does not have).
3. You unwrap the current transit key, then **walk the re-key chain backward** to decrypt
   transit from all historical epochs.

The win over a read-key-only model: re-add gives you **full history**, not just transit from
the re-add forward (the chain lets the current key recover prior epochs). The bootstrap
(finding/re-joining the workspace) stays social.

**Owner continuity vs. node death** is the same mechanism: a dead owner device with the
mnemonic alive → re-derive the same key on a new device → continue as owner or `transfer`. If
both key and mnemonic are lost, governance is frozen (quorum succession deferred — see §2/§11).

**Open question:** self-service workspace _discovery_ on a fresh device (without a
coordinator) is unsolved. MVP accepts social re-add; a future lightweight discovery path
is deferred. See §11.

---

## 10. Playground-first — validate the membership log before production wiring

The membership log is **security-critical and conceptually new** (CRDT-merge replay semantics,
signature verification, transit-key wrapping + re-key chain, owner/member lifecycle). Following
the P0–P6 discipline that de-risked the transport layer, validate it in the playground first
(phase **P7**), then wire to production. **P7 green is the gate for production membership-log
wiring** — the detailed validation plan lives with the playground in
[`experiments/sync-transport/README.md`](../../experiments/sync-transport/README.md) §P7
(scope: membership-log CRDT merge semantics, transit-key wrapping + re-key chain, owner/member
lifecycle incl. `transfer` + `removeAndRotate`, forge-skip, recovery; substrate: raw `loro-crdt`

- `node:crypto`, no engine, reusing P4/P5). The detailed plan is intentionally NOT here — it is
  playground-coupled and goes away when `experiments/` is deleted after porting to production.

---

## 11. Reversals & open questions

**Reversals of `sync-design.md`:**

- **§4 reversed.** Membership is no longer read-key-as-membership. It is the **membership log**
  (§2): a replicated, signed, owner+member log; the read-key is now the **transit key** wrapped
  within it. §4/§6's "egalitarian, no admin, no roles" is superseded by owner + member(rw).
- **§8 "device peerId"** is re-scoped to **per-dataRoot** (§3, §5), not per-device.

**Decided (this design pass):**

- **Roles = owner + member(rw)** — no admin/reader/writer tiers (§2, §6).
- **Self-signed root, no masterKey** — the actor key is mnemonic-derived and does not rotate,
  so it is its own recovery anchor (§2, §3).
- **`removeAndRotate`** is the atomic revocation path — no forward-secrecy window (§2).
- **Owner-only rotate** eliminates the concurrent-rotate loser-content edge (§2).
- **Encryption is transport-only** — one transit key per epoch, no per-object content keys (§2).
- **Record format = protobuf** in `@lode/protocol` (Loro stores the bytes); signing is over the
  deterministic protobuf encoding (wrapped set as `repeated`, not `map`, for canonical order).

**Open questions:**

- **Workspace discovery on a fresh device** without a coordinator (§9). MVP = social re-add.
- **Owner succession when key + mnemonic are both lost** — governance frozen; quorum-based
  succession deferred (not MVP) (§2, §9).
- **`@lode/sync` package name** — the broker/sync-transport goes in a new **shared** package
  (decided, §1 — mobile needs it); only the exact name is minor.
- **Local default-access UX** (do all local actors open all local workspaces by default, or is
  it gated everywhere?) — §7. A daemon UX choice, not a membership fact.

---

## 12. Roadmap (dependency order, updated)

1. **Foundation:** per-dataRoot device peerId (persist + feed `setPeerId`) → actor keypair +
   keystore + actor registry (`actors.sqlite`) → actor-authenticated sessions (daemon verifies
   the session holds the actor's private key).
2. **Playground P7:** the membership log layer (§10) — owner/member lifecycle, transit-key
   wrapping + re-key chain, `transfer`, `removeAndRotate`, forge-skip, recovery. **Gate:** do
   not start production membership-log wiring until P7 is green.
3. **Production membership log:** port the validated log into the engine as a workspace doc
   (protobuf records in `@lode/protocol`); wire membership derivation + re-key + owner
   governance.
4. **Transport (relay/broker + client):** the workspace-routing broker + `SyncTransport` over
   the broker + transit-key AEAD + actor signing, in the shared `@lode/sync` package (§1).
5. **Coordinate management:** workspace coordinate create/import/export (relay addr, wsId,
   membership bootstrap).
6. **Hardening (alongside):** the items already listed in sync-design.md's roadmap (merge-cycle
   policy, `getNodeByID(ref)` guard, dirty-shard-only `persistMutation`, mid-sync-read gate
   breadth, lazy shard LOAD).
