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

> **One edge revised 2026-07-05 by §13.** Self-service peer-add (an actor signs `add` for its own
> peers) reopens exactly one concurrent edge this paragraph disclaimed — an `add` racing a
> `rotate`-that-omits-the-actor. It is closed by a `staleAdd` replay guard (skip an `add` whose
> joinEpoch trails the current epoch), mirroring `staleRotate`. The owner stays the sole authority
> for _dangerous_ ops (kick/rotate/transfer); peer-add is not dangerous.

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
— a recovered owner on a new peer re-derives the same key and signs as owner. any-sync's
masterKey co-signature exists to bind a _rotating_ sign key to a stable recovery key; lode's
actor key doesn't rotate, so co-signing is redundant. (Self-sign chosen over co-sign.)

**Owner continuity vs. node death.** A dead owner peer with the mnemonic alive → owner
re-derives the same key on a new peer → continues as owner or transfers. If **both** the key
and the mnemonic are lost, governance is frozen (members keep rw access to existing content but
cannot add/remove/rotate/transfer) — the honest lower bound of a no-authority model.
**Quorum-based owner succession is out of scope.**

**Consequence for §4/§6:** the membership credential is the transit key wrapped within the
membership log (not a separate read-key).

---

## 3. Identity — actor (client/session) + per-dataRoot peerId

> **Partially superseded 2026-07-05 by §13 (peer-level membership).** The actor keypair's roles
> split: **all signing (wire attribution + governance + self-service-add) stays with the actor**,
> which is always present in-session (CLI carries it / GUI logs in) — "all of a user's peers share
> the same actor keypair" still holds for signing, and that IS the cross-peer attribution payoff.
> The **transit-wrap encryption role moves to a per-peer random X25519 key**; the actor's
> Ed25519→X25519 dual-use is dropped (`curve.ts` deleted). peerId is additionally the membership/
> revocation unit (the peer).

Two distinct identities, do not conflate them:

**Actor keypair** (Ed25519, per-user) — the membership/attribution principal. **The actor is
client-side:** the client holds the mnemonic and supplies it at `sessionHello`; the daemon
derives the keypair transiently per session (**local recognition, not attestation** — there is
no challenge / no proof-of-possession beyond mnemonic possession). All of a user's peers share
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
held by the client. At-rest disk encryption (stolen-peer) is a separate concern, out of
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

> **Superseded 2026-07-05 by §13.** Membership is now per-**peer** (peerId), not per-actor. The
> rationale below (per-actor isolation across actors sharing one peer) still holds for
> **attribution** — but the membership/revocation unit is the peer, and the member list groups by
> actor with peers nested beneath. See §13.

The **actor is the principal/member**; the peer is just a host. Membership-log records name
actors (pubkeys), not peers. Rationale:

- per-peer membership would let all actors on a peer share one membership — but actors
  are meant to be isolated identities (personal vs work); you do not want one actor's
  membership to leak into another's view.
- consistent with §3 (actor is the cross-peer identity) and with any-sync (account =
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
  peer.peerId                # this dataRoot's Loro site id (non-secret)
  workspaces/<wsId>/           # workspace stored ONCE
    workspace.sqlite           # docs + crdt_updates + crdt_snapshots + workspace_meta
                               #   + the membership log as one of its docs/shards (syncs like any doc)
```

Separation of concerns: `registry.sqlite` = which workspaces exist on this dataRoot; the
**membership log (in each workspace)** = global membership/roles (replicated, authoritative).
Actor identity is client-held (mnemonic), not in the dataRoot.

---

## 9. Recovery model — re-add by the owner, then full history via the chain

> **Recovery primary story superseded 2026-07-05 by §13 (fork).** Re-add below remains the _normal_
> new-peer flow; **recovery** from kicked / lost-owner / rogue-owner is now **fork** — see §13.

A lost peer loses its local transit keys (and its peerId); the actor key is mnemonic-derived,
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

**Owner continuity vs. node death** is the same mechanism: a dead owner peer with the
mnemonic alive → re-derive the same key on a new peer → continue as owner or `transfer`. If
both key and mnemonic are lost, governance is frozen (quorum succession is out of scope — see
§2).

Recovery on a fresh peer is **social re-add** (§9 steps 1–3): the new peer enters its
mnemonic + the owner re-adds its actor. There is no coordinator to self-discover workspaces.

---

## 10. Validation surface

The membership-log invariants any implementation must satisfy: CRDT-merge replay is
deterministic across replicas; record signatures verify and the signer is the current owner;
transit-key wrapping + the re-key chain round-trip; the owner/member lifecycle (`transfer`,
`removeAndRotate`) preserves the §2 invariants; forged/invalid records are skipped, not fatal.

---

## 11. Supersessions & stable decisions

**Superseded by the current design pass:**

- **Transit-wrap encryption → per-peer X25519 key (§13, supersedes parts of §3 and all of §6).**
  The actor keypair KEEPS all signing (wire attribution + governance + self-service-add) and stays
  always-present in-session; only the transit-wrap target moves from the actor's Ed25519→X25519
  dual-use derivative to a per-peer random X25519 key. Membership is per-peer (peerId);
  revocation = rotate omits the peer. The actor's Ed↔Montgomery conversion (`curve.ts`) is deleted.
  (Corrects an earlier draft that moved wire signing to peer keys — retracted: it would break
  cross-peer attribution.)
- **Recovery = fork (§13).** Kicked / lost-owner / rogue-owner all recover by forking the local copy
  into a new workspace. Supersedes the §9 "social re-add" framing as the primary recovery story
  (re-add still exists for the normal new-peer case).
- **No daemon identity / no daemon-side actor keystore.** The daemon does not pick an actor or
  persist actor keys. Actors are client/session-side (mnemonic at hello); sync uses the session
  actor's key in-memory. Supersedes the earlier `actors.sqlite` + per-actor keystore + daemon
  `--actor-mnemonic` design (§3, §4, §5).
- **Membership auth = local recognition, no attestation.** mnemonic-at-hello, not challenge-response (§4).
- **`peerId`** is just **per-dataRoot peerId** (and now also the routing identity) — §3.
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

---

## 13. Peer-level membership & per-peer keys (2026-07-05 design pass)

> Resolves the peer-revocation gap in §3/§6. Adds a per-peer X25519 key as the transit-wrap
> target; the actor key KEEPS all signing and is always present in-session. Corrects an earlier
> draft that moved wire signing to peer keys (retracted — it would break cross-peer attribution,
> and member peers are always logged in anyway). Supersede markers sit inline at §2, §3, §6, §9;
> [`sync-design.md`](./sync-design.md) §6; registered in §11.

**The shift (corrected model).** A new **peer key** (random X25519, per-dataRoot) becomes the
**transit-wrap target**, making each peer independently revocable. The **actor keypair**
(mnemonic-derived Ed25519) **keeps all signing** — wire attribution, governance, self-service-add —
and is **always present in-session** (CLI carries the actor; GUI logs in as an actor; background sync
holds the registered actor's key in-memory). The peer key never signs. peerId stays the non-secret
routing/CRDT id and is additionally the **membership unit** — the thing admitted and revoked.

**Why the move (problem statement).** Today transit is wrapped to the actor's encPub, derived (via
Ed25519→X25519 dual-use) from the mnemonic-derived signPub. Every peer of an actor shares one
encPub/encPriv, so `rotate` re-wraps to the same encPub: a lost peer holding the mnemonic can always
re-derive encPriv and unwrap every new transit key. **Per-peer revocation was impossible.** Moving
only the transit-wrap target to a per-peer random X25519 key makes each peer independently
revocable, while leaving attribution on the actor (so Alice's edits from any peer all show "Alice").

**Identity, three layers — do not conflate:**

- **peerId** (random, per-dataRoot, non-secret) — Loro replica site id + routing id + **the membership
  unit** (admitted/revoked as one peer). Unchanged from §3 except it is now the revocation handle.
- **peer key** (random X25519-only, generated on-peer, persisted per-dataRoot alongside peerId,
  never mnemonic-derived) — the transit-wrap target (encPub). This is the key that gets revoked. It
  never signs.
- **actor** (mnemonic → Ed25519, always present in-session) — signs wire payloads (attribution,
  cross-peer consistent), governance records (owner), and self-service-add records. The mnemonic is
  the recovery root; the actor private key is derived at session hello and held in-session, not
  persisted on disk by the daemon (unchanged from §3/§4).

**Membership-log record shape (proto + state).** Records name **peers**, not bare actors:

- Each admitted peer = `(peerId, owningActorId, peerEncPub, wrappedTransit, joinEpoch)`. The
  `signPub` is the **actor's** signPub (peers don't sign); it lives on an **`actors` index**, set
  when the owner first adds a peer of that actor.
- `MembershipState` becomes `peers: Map<peerId, Peer>` + `actors: Map<actorId, { signPub }>`. The
  member-list UI groups `peers` by `owningActorId`.
- Proto reshape: `MemberWrap`→`PeerWrap` (renamed — it holds a peer) and `AddRecord` —
  `actor_id`→`owning_actor_id`, `enc_pub`→`peer_enc_pub`, add `peer_id`. `RootRecord` —
  `owner_enc_pub`→`owner_peer_enc_pub` + `owner_peer_id`. `RotateRecord.wrapped` is a peer list;
  survivor comparison by peerId.

**Signing rule + replay (the core change).** `MembershipRecord.signer` is an **actorId** throughout
(no peer-key signing). Authorization broadens from "owner signs everything":

- `root` / `rotate` / `transfer`: signed by the **owner actor** (governance), as today.
- `add`: valid if `signer == owner` (owner adding anyone's peer) **OR** `signer == owningActor` AND
  that actor already has ≥1 admitted peer (self-service).
- `verifySignature` resolves signer (actorId) → signPub via the **`actors` index**, not the peer map.
- **`staleAdd` guard (new, mirrors `staleRotate`)**: an `add` whose `joinEpoch` trails the current
  epoch is skipped. This closes the concurrent edge self-service-add reopens (§2 amendment): an `add`
  racing a `rotate`-that-omitted-the-actor cannot re-admit the actor on a stale transit. The replay's
  skip-set gains `staleAdd`; determinism is preserved.

**Adding peers (UX-confirmed).**

- **Owner approves an actor's first peer** (signs the first `add`; establishes the actor in the
  `actors` index). Owner-only governance.
- **An actor self-adds further peers** (signs the `add` itself — actor-signed, not peer-signed;
  no owner round-trip).
- **The owner may also add** further peers to any actor. Adding is not a dangerous op; **kick is
  owner-only**. Self-service is bounded by per-peer + per-actor revocation.

**Revocation = rotate omits the peerId.** Reuses the atomic removeAndRotate: the omitted
peer cannot unwrap the new transit key, so it can neither read new content nor produce a
decryptable update (peers' `open()` fails AEAD first). The actor signing key it still holds is useless
without transit. Wire `seal`/`open` are unchanged — the actor still signs; only the membership
layer's wrap target moved. The `wrapped` set IS the owner-signed roster: a peer the owner LISTS is
admitted (owner-signed onboarding via rotate is valid), a peer omitted is revoked. This admission
semantics is required for CRDT convergence — a concurrent `add(X,epoch=N)` + `rotate([…,X],epoch=N+1)`
lands X admitted at epoch N+1 in both merge orders (add-before-rotate re-keys X; rotate-before-add
admits X from the roster and the stale add is skipped).

**Kicked / lost-owner / rogue-owner — one recovery mechanism: fork.** Local-first means a kicked
peer **keeps its local copy** (data already replicated cannot be recalled — accepted). Any surviving
member can **fork**:

- **Mint a new wsId** (same wsId on one relay would collide on the channel).
- **Start from an EMPTY membership log + a fresh `root`** signed by the forker's actor (the forker is
  logged in). Do NOT copy the old log — the old owner's root would rank first and brick governance.
- The fresh `root` carries the forker's **peer** encPub + peerId (root reshaped per above); transit
  wraps to it. The forker is the new owner; the new workspace starts at epoch 0 (the re-key chain
  does NOT carry over — fork is a new workspace, no historical-epoch continuity).
- Content (treeDoc + shards) is copied into the new workspace.

One mechanism covers kicked-individual, lost-owner (governance frozen), and rogue-owner (kicked
everyone) — no special cases. **Rogue-owner is not defended against**; fork is the symmetric answer
("owner kicked us all" ≈ "we all forked away"). Re-add (§9) remains the _normal_ new-peer flow;
fork is the _recovery_ flow.

**Identity in the UI.**

- The **member list groups by actor**, peers nested beneath: `Alice (owner) / [Alice's laptop,
Alice's phone]`. Users see people, not peerIds.
- **Actor name** is self-declared (first run), replicated with the actor — edits from any of Alice's
  peers show "Alice" (the cross-peer attribution payoff, which is WHY signing stays on the actor).
  Visible in: member list, edit attribution, @-mentions, owner badge.
- **Peer name** is self-declared at install ("Alice's laptop"), stored on the peer record.
  Visible in: the peer-management screen and the revoke picker.
- **Same peer, multiple actors**: if Alice and Bob share one peerId, edits still attribute
  per-actor — `edited by Alice` vs `edited by Bob` (attribution rides the actor signature). Rare; no
  special UI.

**Rename / reshape pass (no backward-compat — thorough refactor).**

- **Crypto:** `actor-encryption.ts` → `transit-wrap.ts` (wrap/unwrap retargeted to peer X25519);
  **delete `curve.ts`** (Ed↔Montgomery — zero consumers after the move); delete
  `actorEncryptionPublic/Private`; update `actor-key.ts` docstring (Ed25519 signing-only); drop the
  re-exports in `utils/crypto/index.ts` and `engine/src/index.ts`.
- **State/types:** `Member` → `Peer`; `MemberPublicKeys` → `PeerPublicKeys`;
  `MembershipState.members: Map<actorId>` → `peers: Map<peerId>` (no separate `actors` index — the
  signer's signPub is recovered from its actorId via `actorPublicKeyFromId`, since actorId IS the hex
  of the Ed25519 pub); `unwrapCurrentTransitKey` takes a `LocalPeer`.
- **Proto:** `MemberWrap`→`PeerWrap`, `RootRecord`/`AddRecord` reshaped (above);
  `AddMemberRequest.member_sign_pub` → `(peer_enc_pub, peer_id, owning_actor_id)`;
  `MembershipRecord.signer` comment notes the owner-or-self-add cases.
- **Daemon:** `sync-runner.ts registrations: Map<wsId, ActorKeypair>` STAYS actor-per-workspace (the
  peer key + peerId are per-dataRoot, not per-registration); `AppWorkspaceRuntime.localPeerFor(actor)` bundles `{actor, peer, peerId}` for the daemon's wire-security + addMember sites.
- **Docs:** §2/§3/§6/§9 markers, `sync-design.md` §6 marker, this section — drop all "actor encPub /
  Ed25519→X25519 dual-use" language that no longer applies.

**Decided (stable):**

- Membership unit = peerId (peer). Peer key = random X25519, transit-wrap target only, never signs.
- Actor key = all signing (wire attribution + governance + self-service-add); mnemonic-derived;
  always present in-session.
- Peer-add: owner first / actor self-service / owner may also add. Kick = owner-only rotate that
  omits the peerId.
- Replay: peer-keyed state + `actors` index + `staleAdd` guard.
- Recovery (kicked / lost-owner / rogue-owner) = fork (new wsId, empty log, fresh forker-signed root,
  copy content). No quorum/social-recovery machinery this pass.
- Identity display: actor name (self-declared, replicated, groups the member list); peer name
  (self-declared at install, on the peer record).

**Still out of scope:** mnemonic-loss governance recovery beyond fork (quorum / social-recovery
signing); walking the re-key chain backward for historical-epoch transit keys (§9); fork re-key-chain
continuity (fork starts epoch 0).
