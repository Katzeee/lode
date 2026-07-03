# Sync Identity, Membership & Persistence — Design Decisions

This document records the decisions from the **identity / membership / persistence**
design pass that followed [`sync-design.md`](./sync-design.md). It is the resume anchor
for the engineer wiring identity, membership, and per-dataRoot persistence into
production.

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

## 1. Architecture boundary — engine stays transport-free (resolves handoff vs AGENTS.md)

The sync-relay handoff proposed putting the **broker and `SyncTransport` in the engine**.
`AGENTS.md` says the opposite: the engine "must not import `@lode/client` or `@lode/transport`"
— transport responsibility lives outside engine. We follow **AGENTS.md**, and any-sync
proves this is the right split.

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

| Layer                 | Owns                                                                                                                                                                                                                                                                                                                                           | Used by                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **`@lode/engine`**    | sync core (`SyncManager` + the `SyncTransport` **interface**: docIds + bytes + VVs) + peerId → `setPeerId` + actor crypto (the `utils/crypto` leaf: Ed25519/X25519/AES-256-GCM/BIP-39/SLIP-10) + the membership log + the wire-security/SyncProfile **content layer** (transit-key AEAD seal/open, actor wire signing, membership→wire bridge) | daemon + mobile + apps |
| **`@lode/transport`** | `Broker` client + `Broker` server (`--relay`) + `BrokerClientSyncTransport` adapter + real WebSocket sockets — a pure socket shell (content/security imported from engine)                                                                                                                                                                     | daemon + mobile        |
| **`@lode/daemon`**    | thin desktop host: engine + transport(client) + broker server (`--relay`) + IPC transport + process lifecycle                                                                                                                                                                                                                                  | desktop                |
| **mobile**            | engine (in-process) + transport (client — dials the relay directly, no daemon)                                                                                                                                                                                                                                                                 | mobile                 |

Engine stays **socket-free** (no sockets / connection types) but it DOES own the content/security
layer (AEAD seal/open, actor wire signing, the SyncProfile codec) — that logic is needed by both
the membership log replay (verify signatures) and the wire (sign messages), so the lowest shared
layer owns it; it also travels inside the engine's future Rust dynamic-library form. Only the
socket I/O is split out into `@lode/transport`. The directed-routing work (peerId addressing, the
relay's subscription/routing table) is socket/routing logic too — it lives in `@lode/transport`
(TypeScript), not the engine, so a Rust engine rewrite is unaffected; `@lode/transport` is imported
only by the daemon (and future mobile), never by the engine. The broker **server** (`--relay`) also lives in
`@lode/transport`; the daemon merely hosts it, and mobile uses only the client half. This is
distinct from the IPC transport (connectrpc between client and daemon, owned by `@lode/client` +
`@lode/daemon`): the sync broker/AEAD/signing is a different concern.

The engine's existing `SyncTransport` interface is already clean — **no socket or
connection type crosses it**. any-sync's seam _leaks_ (`PeerManager` returns
`[]peer.Peer`, and `peer.Peer` exposes `AcquireDrpcConn`, dragging a wire type into the
core). **Lesson: keep `SyncTransport` socket-free.** If the adapter needs connection
state, it owns it internally; never add a `Connection`/`Peer` type to the interface.

> AGENTS.md registers `@lode/transport`: in-process clients (mobile) may depend on
> `@lode/engine` + `@lode/transport` so mobile can reach the shared sync transport.

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

**What the log records (protobuf in `@lode/protocol` [`membership.proto`], stored base64 in a
LoroList; signed over the canonical proto3 body encoding — the wrapped set is `repeated`, ordered):**

- `root` — owner self-signs; carries the owner's transit key wrapped to the owner. Only the FIRST
  root applies; a later root is skipped (a former owner can't re-seize governance by appending one).
- `add` — owner adds a member; the current transit key wrapped to the member.
- `rotate` — owner re-keys. The `wrapped` set IS the new membership: every listed member gets the new
  transit key; anyone omitted is revoked (atomic removeAndRotate — the only revocation path). `enc_prev`
  = AEAD(newTransit, oldTransit) chains the old key under the new so current members walk back to prior
  epochs. A rotate whose epoch isn't strictly ahead of the current is skipped (stale).
- `transfer` — owner transfers ownership to an EXISTING member (skipped if the target isn't a member,
  so governance can't be bricked on a stranger). The old owner stays on as a member.

The log lives in the engine's in-process sync core (`runtime/membership/`) — it needs `core`
(LoroDoc) + the `utils/crypto` leaf + `@lode/protocol` (records), so it can't sit in `domain`
(no-protocol rule); `runtime` is sanctioned as the sync core (`SyncManager` lives there). It is a
**Loro doc inside the workspace**, so it syncs like any doc — `MembershipSync` gossip-pushes
it over the transport's plaintext envelope. Validity = the record's signature verifies AND the
signer is the current owner (root is
self-authorizing as the first record). The owner is always a member — a rotate may not omit the
owner — so the owner's signPub is always in `members` and governance signatures always verify.
Invalid records (bad signature / unknown signer / non-owner / second root / transfer to a non-member
/ stale rotate / undecodable) are **skipped at replay**, not fatal — deterministic given the merged
list, so every replica converges to the same membership.

**Transit key, not a content key.** The wrapped key is the **transit key**: it encrypts sync
messages in transit (`node:crypto` AEAD), so the untrusted relay sees only ciphertext.
**Encryption is transport-only** — content at rest is unencrypted (at-rest disk encryption is
a separate, future feature; sync-design §4). There is **no per-object content encryption and
no per-object key derivation**; the transit key is one key per epoch, rotated as a unit.

**Re-key chain** (`encPrev` = AEAD(newTransitKey, oldTransitKey) on each rotate): each rotate
record stores its `encPrev`, so a current member can in principle walk back to decrypt transit
from any prior epoch (a removed member, with no wrapped key in new epochs, cannot). **The walker
is deferred** — it shipped once but was removed as forward-looking (no production caller); the
chain stays on the wire record so history-decryption can land later without a migration. Rotate
only re-wraps the transit key to survivors (O(members)); content is never re-encrypted.

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
transit key wrapped within the membership log. (The earlier egalitarian
read-key-as-membership idea is obsolete; this log is the model.)

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
  (This supersedes an earlier "daemon-side actor keystore / `actors.sqlite`" design; the current
  code still carries it, pending refactor.)
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
held by the client. At-rest disk encryption (stolen-device) remains a separate future feature
(sync-design.md §4).

---

## 4. Daemon topology — one process per machine; actor declared per session

The daemon is a **single AppServer process per machine**, bound to one dataRoot, with **no
identity of its own**. An actor is **declared per connection/session**, not per daemon startup.
Multiple actors on one machine (Alice, Bob) = multiple client connections to the same daemon,
each its own session.

This matches the existing session layer: `SessionHelloRequest` carries the actor **and the
mnemonic**; `SessionManager.createSession` derives the keypair per connection; `requireOrigin`
returns `{ nodeId, actorId, sessionId }`. Identity is **local recognition, not attestation** — the
daemon derives the keypair from the mnemonic the client supplies. (An earlier challenge-response
design was replaced by mnemonic-at-hello.)

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
   historical-epoch transit keys is a **deferred refinement** — the chain is stored on each
   rotate record, but the walker is not yet shipped; today re-add yields the current transit
   key only.)

The win over a read-key-only model: re-add restores your current transit key (and the stored
re-key chain leaves the door open to full-history recovery once the walker ships). The bootstrap
(finding/re-joining the workspace) stays social.

**Owner continuity vs. node death** is the same mechanism: a dead owner device with the
mnemonic alive → re-derive the same key on a new device → continue as owner or `transfer`. If
both key and mnemonic are lost, governance is frozen (quorum succession deferred — see §2/§11).

**Open question:** self-service workspace _discovery_ on a fresh device (without a
coordinator) is unsolved. MVP accepts social re-add; a future lightweight discovery path
is deferred. See §11.

---

## 10. Validation history

The membership log was validated playground-first (phase **P7**, in the now-deleted
`experiments/sync-transport/`) before production wiring — CRDT-merge replay semantics,
signature verification, transit-key wrapping + re-key chain, owner/member lifecycle
(`transfer`, `removeAndRotate`), forge-skip, recovery. It is now in production in
`runtime/membership/`.

---

## 11. Supersessions & open questions

**Superseded by the 2026-07-01 design pass:**

- **No daemon identity / no daemon-side actor keystore.** The daemon does not pick an actor or
  persist actor keys. Actors are client/session-side (mnemonic at hello); sync uses the session
  actor's key in-memory. Supersedes the earlier `actors.sqlite` + per-actor keystore + daemon
  `--actor-mnemonic` design (§3, §4, §5).
- **Membership auth = local recognition, no attestation.** mnemonic-at-hello, not challenge-response (§4).
- **`device peerId`** is just **per-dataRoot peerId** (and now also the routing identity) — §3.

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

- **Workspace discovery on a fresh device** without a coordinator (§9). MVP = social re-add.
- **Owner succession when key + mnemonic are both lost** — governance frozen; quorum-based
  succession deferred (not MVP) (§2, §9).
- **Re-key-chain walker** (history-epoch transit recovery) — deferred; the chain is stored on
  each rotate record, the walker is not shipped (§2, §9).
- **Local default-access UX** (do all local actors open all local workspaces by default, or is
  it gated everywhere?) — §7. A daemon UX choice, not a membership fact.

---

## 12. Roadmap (dependency order)

> Live status in `_local/handoff/sync-handoff.md`. Design-time sequence:

1. **Directed client→client request capability** — relay peerId tracking + directed routing +
   peer-list query (`sync-design.md` §3c). Foundation; lands without breaking existing code.
2. **Identity refactor:** daemon drops `--actor-mnemonic`; sync becomes a client-registered
   service (in-memory); `createWorkspace` inits the root with the session actor; remove the
   daemon-side actor keystore / `actors.sqlite`.
3. **join/sync split:** join establishes membership (directed fetch); sync does content.
4. **Relay-only mode** + tick → 20s + CLI manual trigger.
5. **Then:** N>2 usage of the directed capability; CLI e2e; hardening (merge-cycle policy,
   `getNodeByID(ref)` guard, dirty-shard-only `persistMutation`, mid-sync-read gate breadth,
   lazy shard LOAD).
