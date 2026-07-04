# Sync Identity, Membership & Persistence — Design Decisions

This document records the decisions from the **identity / membership / persistence**
design pass that followed [`sync-design.md`](./sync-design.md). It is the design
reference for identity, membership, and per-dataRoot persistence.

Read [`sync-design.md`](./sync-design.md) first for topology, the relay, and transport
security; this doc layers identity + membership + persistence on top.

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

## 1. Architecture boundary — the peer-sync wire lives in the engine

> **Decision reversed 2026-07-05.** An earlier version of this section (and the original
> sync-relay handoff) recorded the opposite — "engine stays transport-free; the broker
> wire + `SyncTransport` adapter live in a separate `@lode/transport` package." That split
> has been reversed: the broker wire + the sync protocol now live **inside `@lode/engine`**
> (`src/runtime/broker/`), and `@lode/transport` is deleted. The `SyncTransport`-interface
> lesson at the end of this section is unchanged; the packaging conclusion is what flipped.
> Recorded here so the evolution is visible, not just the latest state.

**Two "transport" layers — do not conflate them:**

| Layer                  | what it is                                                                                                               | lode                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| **A. peer-sync wire**  | the broker/relay between peers (`BrokerClient` / `BrokerServer`, the routing core, the `SyncTransport` protocol over it) | **inside `@lode/engine`**       |
| **B. client→core RPC** | the client app ↔ the local engine (Connect/gRPC IPC)                                                                     | `@lode/daemon` + `@lode/client` |

Layer A belongs inside the engine; Layer B is the client's job, separate. This matches
anytype: **anytype-heart bundles its networking (`any-sync`: libp2p/QUIC/DRPC) inside the
core** — `space/spacecore/` consumes any-sync directly, with no in-repo "transport"
wrapper; clients reach heart through a separate gRPC-Web surface (`cmd/grpcserver`), which
is Layer B.

**Why the wire lives in engine.** The broker wire + the sync protocol are co-designed and
CRDT-coupled — `BrokerFrame` carries `SyncMessage`; the protocol demuxes the transit-key
AEAD (`seal`/`open`), encodes the `SyncProfile`, and correlates request/response by
`reqId`. Splitting them across a package boundary produced a half-migration smell (the
security primitives lived in engine, their consumer in transport) and dragged `loro-crdt`

- engine types into a nominal "socket shell." Folding them into one package
  (`src/runtime/broker/`) removes the seam, and the wire then **travels with the engine into
  a future Rust port** (gRPC/tonic in Rust) — avoiding a permanent two-language core joined
  by a byte pipe.

**Why lode folds where any-sync stays separate.** `any-sync` is a genuinely reusable,
multi-consumer module (coordinator/file/consensus nodes all consume it), so it stays its
own repo that heart depends on. lode's broker is **single-consumer and lode-specific** —
its frames carry lode's `SyncMessage`, lode's wsId routing, lode's membership-sealed
envelopes — so pretending it is a reusable transport is speculative generalization. The
honest shape: the broker is engine business logic that happens to talk to a socket.

| Layer              | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Used by                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **`@lode/engine`** | sync core (`SyncManager` + the `SyncTransport` **interface**: docIds + bytes + VVs) + **the peer-sync wire** (`BrokerClient` / `BrokerServer` + the routing core + the `BrokerSyncProtocol` protocol, in `src/runtime/broker/`) + peerId → `setPeerId` + actor crypto (the `utils/crypto` leaf: Ed25519/X25519/AES-256-GCM/BIP-39/SLIP-10) + the membership log + the wire-security/SyncProfile content layer (transit-key AEAD seal/open, actor wire signing, membership→wire bridge) | daemon + mobile + apps |
| **`@lode/daemon`** | thin desktop host: engine (in-process) + the relay (`BrokerServer` in `--relay` mode) + the client→core gRPC IPC + process lifecycle                                                                                                                                                                                                                                                                                                                                                   | desktop                |
| **mobile**         | engine (in-process, incl. the broker client — dials the relay directly, no daemon)                                                                                                                                                                                                                                                                                                                                                                                                     | mobile                 |

The engine owns the wire, but the `SyncTransport` **interface** stays socket-free (next
paragraph) — `InMemorySyncTransport` (tests / two-workspaces-one-process) and
`BrokerSyncProtocol` (the network) are two implementations of the same
socket-free contract, both now engine-internal.

**The `SyncTransport` interface stays socket-free (lesson from any-sync, unchanged).**
any-sync's sync core (`commonspace/sync`, `headsync`) does **not** import `net/` on its
main path. It talks to the network through one interface — `peermanager.PeerManager`
(`BroadcastMessage` / `SendMessage` / `GetResponsiblePeers`), defined in the sync-side
package, implemented externally; transports (yamux/QUIC/webtransport) are plugins behind a
2-method `Transport` interface. lode's `SyncTransport` is the same shape — **no socket or
connection type crosses it** — so it can span a process boundary. any-sync's seam _leaks_
(`PeerManager` returns `[]peer.Peer`, and `peer.Peer` exposes `AcquireDrpcConn`, dragging
a wire type into the core); lode's does not. **Lesson: keep `SyncTransport` socket-free.**
If the broker adapter needs connection state, it owns it internally; never add a
`Connection`/`Peer` type to the interface.

> AGENTS.md registers the fold: the engine owns the peer-sync wire (Layer A); in-process
> clients (mobile) depend on `@lode/engine` alone and dial the relay via the engine's
> broker client.

---

## 2. Membership model — owner + member log

Membership is a **replicated, signed, append-only membership log** in a Loro doc — but
it is **not an ACL**: lode has no authoritative server to enforce access rules, so there is no
"access control list." The log is the source of truth for _who is in_ the workspace, _who
owns_ it, and each member's _transit key_. The only hard-enforced property is membership itself
(possession of the transit key); everything else is a log fact that honest clients respect
cooperatively.

**Why a log, not just a read-key:** a read-key alone can't represent ownership transfer,
revocation with forward secrecy, or membership history. The log records those transitions
signed by the owner; clients replay it to derive the current membership and unwrap their
transit key. The result is the simpler owner+member log below; lode has no admin/writer/reader
tiers, unlike any-sync's full ACL.

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

**What the log records (protobuf in `@lode/protocol` [`membership.proto`], stored base64 in a
LoroList; signed over the canonical proto3 body encoding — the wrapped set is `repeated`, ordered):**

- `root` — owner self-signs; carries the owner's transit key wrapped to the owner. Only the FIRST
  root applies; a later root is skipped (a former owner can't re-seize governance by appending one).
  The declared `owner` actorId must equal `actorIdFromPublicKey(ownerSignPub)` — actorId is a pure
  function of the sign pubkey, so a root whose label diverges from its signing key is skipped.
- `add` — owner adds a member; the current transit key wrapped to the member.
- `rotate` — owner re-keys. The `wrapped` set IS the new membership: every listed member gets the new
  transit key; anyone omitted is revoked (atomic removeAndRotate — the only revocation path). `enc_prev`
  = AEAD(newTransit, oldTransit) chains the old key under the new so current members walk back to prior
  epochs. A rotate whose epoch isn't strictly ahead of the current is skipped (stale), as is a rotate
  that omits the owner (the owner always survives — a self-removing rotate would delete the only key
  that can sign further governance, bricking the workspace).
- `transfer` — owner transfers ownership to an EXISTING member (skipped if the target isn't a member,
  so governance can't be bricked on a stranger; also skipped if the target is the current owner — a
  signed no-op). The old owner stays on as a member.

The log lives in the engine's in-process sync core (`runtime/membership/`) — it needs `core`
(LoroDoc) + the `utils/crypto` leaf + `@lode/protocol` (records), so it can't sit in `domain`
(no-protocol rule); `runtime` is sanctioned as the sync core (`SyncManager` lives there). It is a
**Loro doc inside the workspace**, so it syncs like any doc — `MembershipSync` gossip-pushes
it over the transport's plaintext envelope. Validity = the record's signature verifies AND the
signer is the current owner (root is
self-authorizing as the first record). The owner is always a member — a rotate may not omit the
owner — so the owner's signPub is always in `members` and governance signatures always verify.
Invalid records (bad signature / unknown signer / non-owner / second root / root whose owner label
diverges from its signing key / transfer to a non-member / transfer to the current owner / stale
rotate / rotate that omits the owner / undecodable) are **skipped at replay**, not fatal —
deterministic given the merged list, so every replica converges to the same membership.

**Transit key, not a content key.** The wrapped key is the **transit key**: it encrypts sync
messages in transit (`node:crypto` AEAD), so the untrusted relay sees only ciphertext.
**Encryption is transport-only** — content at rest is unencrypted (at-rest disk encryption is
a separate concern, out of scope — sync-design §4). There is **no per-object content encryption and
no per-object key derivation**; the transit key is one key per epoch, rotated as a unit.

**Re-key chain** (`encPrev` = AEAD(newTransitKey, oldTransitKey) on each rotate): each rotate
record stores its `encPrev`, so a current member can in principle walk back to decrypt transit
from any prior epoch (a removed member, with no wrapped key in new epochs, cannot). **The walker
is out of scope** — the chain stays on the wire record so history-decryption can be added later
without a migration; re-add yields the current transit key only (see §9). Rotate only re-wraps
the transit key to survivors (O(members)); content is never re-encrypted.

**Self-signed root, no masterKey.** The root is signed by the owner's actor key alone. The
actor key **is** the mnemonic-derived key (§3), so "same actorId" is cryptographic continuity
— a recovered owner on a new device re-derives the same key and signs as owner. any-sync's
masterKey co-signature exists to bind a _rotating_ sign key to a stable recovery key; lode's
actor key doesn't rotate, so co-signing is redundant. (Self-sign chosen over co-sign.)

**Owner continuity vs. node death.** A dead owner device with the mnemonic alive → owner
re-derives the same key on a new device → continues as owner or transfers. If **both** the key
and the mnemonic are lost, governance is frozen (members keep rw access to existing content but
cannot add/remove/rotate/transfer) — the honest lower bound of a no-authority model.
**Quorum-based owner succession is out of scope.**

**Consequence for §4/§6:** the membership credential is the transit key wrapped within the
membership log (not a separate read-key).

---

## 3. Identity — actor (client/session) + per-dataRoot peerId

Two distinct identities, do not conflate them:

**Actor keypair** (Ed25519, per-user) — the membership/attribution principal. **The actor is
client-side:** the client holds the mnemonic and supplies it at `sessionHello`; the daemon
derives the keypair transiently per session (**local recognition, not attestation** — there is
no challenge / no proof-of-possession beyond mnemonic possession). All of a user's devices share
the same actor keypair (same mnemonic).

- **The daemon holds no actor private key persistently — it has no identity of its own.** It acts
  on behalf of whichever actor a client brought. For background sync, the registered actor's key
  is captured **in-memory** by the sync registration (no persistence) — see `sync-handoff.md`.
  (This supersedes an earlier "daemon-side actor keystore / `actors.sqlite`" design.)
- **Signs** sync updates (attribution) and **membership-log records** (owner authority). The
  owner's actor key is the governance signer; it does **not** rotate, so it is its own recovery
  anchor (no masterKey co-signature — see §2).
- **Encrypts** via Ed25519→Curve25519 conversion (any-sync's dual-use trick; no separate X25519
  keypair type) — used to wrap the **transit key** to members. The Edwards↔Montgomery conversions
  - X25519 ECDH use `@noble/curves` (`ed25519.utils.toMontgomery` / `toMontgomerySecret` +
    `x25519.getSharedSecret`); SLIP-10 HMAC, Ed25519 sign/verify, and the sealed-box AES-256-GCM +
    HKDF stay in `node:crypto` (the `utils/crypto` leaf).
- **Mnemonic:** BIP-39 (12 words) → SLIP-10 hardened derivation → 32-byte seed → Ed25519. The
  mnemonic is the recovery root for the actor identity (mirrors any-sync's
  `util/crypto/mnemonic.go`). Lode's actor path is `m/44'/2026'/<account>'/0'/<index>'` (all
  hardened — SLIP-10 Ed25519 supports hardened only); account/index default 0.

**peerId** (random, per-**dataRoot**, non-secret) — set as the Loro `doc.setPeerId()` for VV
uniqueness. It identifies _one replica of the store_, i.e. one running daemon for that dataRoot.
It is **not** the actor (attribution) and is **not** per-actor — see §6. It is also the **routing
identity** for directed client→client requests (`sync-design.md` §3c).

**No password KDF** (no argon2/scrypt/bcrypt) — same as any-sync. The mnemonic is the secret,
held by the client. At-rest disk encryption (stolen-device) is a separate concern, out of
scope (sync-design.md §4).

---

## 4. Daemon topology — one process per machine; actor established per session

The daemon is a **single AppServer process per machine**, bound to one dataRoot, with **no
identity of its own**. An actor is **established per connection/session**, not per daemon startup.
Multiple actors on one machine (Alice, Bob) = multiple client connections to the same daemon,
each its own session.

This matches the existing session layer: `SessionHelloRequest` carries **only the mnemonic**;
`SessionManager.createSession` derives the keypair (and thus the actor id) per connection;
`requireOrigin` returns `{ nodeId, actorId, sessionId }`. Identity is **local recognition, not
attestation** — the daemon derives the keypair from the mnemonic the client supplies. There is no
client-declared actor id: it is fully determined by the mnemonic, so the daemon deriving it is the
whole truth. (An earlier challenge-response design was replaced by mnemonic-at-hello; an earlier
"client declares actor id, daemon cross-checks" variant was dropped as redundant — the id is
derivable, and there is no persistent session to anchor it.)

Because the daemon has no identity, **sync is a client-registered service**: a client registers
"sync ws-X as my actor via relay(s)"; the daemon captures that actor's key **in-memory** for
background sync rounds (no persistence — see `sync-handoff.md`). The daemon never picks or owns
an actor. (Local access derivation is in §7.)

---

## 5. Storage scoping — workspace + peerId per-dataRoot; identity client-held

A machine may host **multiple dataRoots** (separate lode profiles / instances). **peerId is
stored per-dataRoot.** The machine is just a host; it holds no shared cross-dataRoot state.

**Actor keys are NOT stored daemon-side.** The actor identity is client-held (the mnemonic);
the daemon derives it transiently at session hello and captures it in-memory only for a
registered sync (§4). There is no daemon-side actor registry or keystore. (An earlier design
proposed `actors.sqlite` + per-actor keystores per dataRoot; that is superseded — identity
belongs to the client, not the daemon.)

**Why peerId is per-dataRoot (correctness):** two dataRoots on one machine can each hold a
replica of the **same shared workspace** (two sqlite files, two Loro docs, same wsId — e.g.
two profiles whose actors are both members of W). Each replica needs its own peerId (Loro site
id). If peerId were per-machine, both replicas would share a site id and **collide in W's
version vector** → concurrent edits corrupt the VV. Per-dataRoot peerId gives each replica a
distinct site id.

**Why per-dataRoot (portability):** a dataRoot is the self-contained, portable unit (registry +
workspaces + the membership docs). Copy the directory, get a complete lode with its workspaces
and membership. Actor identities travel with the client (mnemonic), not the dataRoot.

The only machine-level concern is a **process singleton** (one daemon per dataRoot at a time,
like not opening the same sqlite concurrently) — a process lock, unrelated to identity/storage.

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
  registry.sqlite              # workspace catalog: wsId → relativePath, displayName
  device.peerId                # this dataRoot's Loro site id (non-secret)
  workspaces/<wsId>/           # workspace stored ONCE
    workspace.sqlite           # docs + crdt_updates + crdt_snapshots + workspace_meta
                               #   + the membership log as one of its docs/shards (syncs like any doc)
```

Separation of concerns: `registry.sqlite` = which workspaces exist on this dataRoot; the
**membership log (in each workspace)** = global membership/roles (replicated, authoritative).
Actor identity is client-held (mnemonic), not in the dataRoot.

---

## 9. Recovery model — re-add by the owner, then full history via the chain

A lost device loses its local transit keys (and its peerId); the actor key is mnemonic-derived,
so it survives if the mnemonic was backed up. Recovery is:

1. Enter mnemonic → derive the actor Ed25519 key (same actor pubkey as before — the actor key
   is mnemonic-derived and does not rotate, §3).
2. The **owner re-adds your actor** to the workspace (a signed `add` record wrapping the
   _current_ transit key to your actor pubkey). This step is **social** — lode has no
   coordinator/naming service to self-discover workspaces (any-sync relies on its coordinator
   for that bootstrap, which lode deliberately does not have).
3. You unwrap the current transit key. (Walking the re-key chain backward to recover
   historical-epoch transit keys is **out of scope** — the chain is stored on each rotate
   record, but no walker is provided; re-add yields the current transit key only.)

The win over a read-key-only model: re-add restores your current transit key (and the stored
re-key chain leaves the door open to full-history recovery once the walker ships). The bootstrap
(finding/re-joining the workspace) stays social.

**Owner continuity vs. node death** is the same mechanism: a dead owner device with the
mnemonic alive → re-derive the same key on a new device → continue as owner or `transfer`. If
both key and mnemonic are lost, governance is frozen (quorum succession is out of scope — see
§2/§11).

**Open question:** self-service workspace _discovery_ on a fresh device (without a
coordinator) is unsolved. The design relies on social re-add; a lightweight discovery path is
out of scope. See §11.

---

## 10. Validation surface

The membership-log invariants any implementation must satisfy: CRDT-merge replay is
deterministic across replicas; record signatures verify and the signer is the current owner;
transit-key wrapping + the re-key chain round-trip; the owner/member lifecycle (`transfer`,
`removeAndRotate`) preserves the §2 invariants; forged/invalid records are skipped, not fatal.

---

## 11. Supersessions & open questions

**Superseded by the current design pass:**

- **No daemon identity / no daemon-side actor keystore.** The daemon does not pick an actor or
  persist actor keys. Actors are client/session-side (mnemonic at hello); sync uses the session
  actor's key in-memory. Supersedes the earlier `actors.sqlite` + per-actor keystore + daemon
  `--actor-mnemonic` design (§3, §4, §5).
- **Membership auth = local recognition, no attestation.** mnemonic-at-hello, not challenge-response (§4).
- **`device peerId`** is just **per-dataRoot peerId** (and now also the routing identity) — §3.
- **Peer-sync wire folded into the engine** (§1, reversed 2026-07-05). The broker wire +
  `BrokerSyncProtocol` protocol moved from a separate `@lode/transport` package into
  `@lode/engine` (`src/runtime/broker/`); `@lode/transport` is deleted. Supersedes the earlier
  "engine stays transport-free, wire in `@lode/transport`" decision recorded here previously.

**Decided (membership model, stable):**

- **Roles = owner + member(rw)** — no admin/reader/writer tiers (§2, §6).
- **Self-signed root, no masterKey** — the actor key is mnemonic-derived and does not rotate,
  so it is its own recovery anchor (§2, §3).
- **`removeAndRotate`** is the atomic revocation path — no forward-secrecy window (§2).
- **Owner-only rotate** eliminates the concurrent-rotate loser-content edge (§2).
- **Encryption is transport-only** — one transit key per epoch, no per-object content keys (§2).
- **Record format = protobuf** in `@lode/protocol` (Loro stores the bytes); signing is over the
  deterministic protobuf encoding (wrapped set as `repeated`, not `map`, for canonical order).

**Open questions:**

- **Workspace discovery on a fresh device** without a coordinator (§9) — social re-add only.
- **Owner succession when key + mnemonic are both lost** — governance frozen; quorum-based
  succession is out of scope (§2, §9).
- **Re-key-chain walker** (history-epoch transit recovery) — out of scope; the chain is stored
  on each rotate record, but no walker is provided (§2, §9).
- **Local default-access UX** (do all local actors open all local workspaces by default, or is
  it gated everywhere?) — §7. A daemon UX choice, not a membership fact.

---

## 12. Structural decomposition

> Live status in `_local/handoff/sync-handoff.md`. The design decomposes (in dependency order)
> into:

1. **Directed client→client request capability** — relay peerId tracking + directed routing +
   peer-list query (`sync-design.md` §3c). The transport foundation.
2. **Identity model:** daemon has no identity (actors are client/session-side); sync is a
   client-registered service (in-memory); `createWorkspace` inits the root with the session actor.
3. **join/sync split:** join establishes membership (directed fetch); sync does content.
4. **Relay form** (`--listen` optional) + a periodic anti-entropy round + a manual trigger.
