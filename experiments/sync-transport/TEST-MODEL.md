# Sync-Transport Playground — Test Model

Truth-based test model (mirrors `@lode/engine` `tests/sync/`). Every assertion is derived from
the **sync contract or transport/membership spec independently of any sync code**. It does not
re-prove CRDT semantics (production `tests/sync/truth.test.ts` already pins those). The playground
validates only the **transport/membership unknowns**: process boundary, real wire, multi-doc,
partial delivery, membership gating, protocol-blind transit.

## Cross-cutting oracles (reused in every phase)

1. **Per-doc canonical projection** — walk containers, read app-minted permanent keys (occId/
   entityKey), project to key-sorted deterministic JSON; translate live ids via a `liveId→key`
   map (port of production `normalizeSnapshot`). Convergence oracle: identical projection ⇒
   converged. Independent (built from app data, not VVs/op-logs).
2. **Set-membership conservation** — record the union of permanent keys ever created; after sync,
   every key present on every peer (or, for delete-wins, absent on every peer — never split).
   No-op-lost / no-resurrection oracle.
3. **Structural validity** — forest (acyclic, single-parent), no dangling refs after a full heal.
4. **Idempotence / no-op re-sync** — re-running a round leaves the projection byte-identical.
5. **Determinism across schedules** — same divergent state, different sync orders ⇒ identical result.
6. **VV-monotonicity** — each peer's `doc.version()` is monotone non-decreasing per peerId; after a
   full two-way round, VVs are pointwise-equal. Transport oracle (the wire delivered what VVs
   promised). Redundant-with-convergence on success by design — catches echo/transport bugs that
   pure content comparison misses.

## What the playground must NOT re-prove

CRDT convergence, no-resurrection, concurrent-op outcomes, tombstone-necessity, the
`sweepOrphans` algorithm — all covered by production truth tests. The playground takes them as
given and asserts only the **delta** above in-process: process boundary, real wire, multi-doc over
wire, partial delivery, membership, protocol-blind transit.

---

## P1 — Real process-boundary convergence

**Question:** does `exportUpdate`/`importUpdate` + VV-diff converge across a **real wire** (two
`LoroDoc`s in separate Node processes over a self-written local TCP/WS relay)?

**Properties:** (1) content convergence across processes (oracle 1); (2) VV equality across
processes (oracle 6); (3) no-op re-sync (oracle 4); (4) idempotent re-delivery; (5) snapshot vs
update equivalence (a snapshot-bootstrapped peer converges to the same state as an incremental-only
peer).

**Oracle:** canonical projection + VV-monotonicity; relay holds no LoroDoc; oracle reads each
peer's doc from its own process.

**Scenarios:**

- S1.1 Both empty; A edits, syncs to B → converge + VV equal.
- S1.2 Divergent edits on a shared base, sync once → converge (merged value Loro-defined; assert
  both hold the SAME merged value, not a specific one).
- S1.3 Large update (thousands of entries) → byte-conservation (`push.length === delivered`) +
  converge.
- S1.4 Snapshot bootstrap → matches an incremental-only peer.
- S1.5 Bidirectional both-dirty (catches an echo bug via the no-op re-sync property).
- S1.6 Relay killed + restarted between rounds → still converges (relay stateless).

**Out of scope:** multi-doc (P2); wire faults (P3); membership (P4); WireGuard (P5).

## P2 — Multi-doc (treeDoc + shards)

**Question:** does a `SyncManager`-shape exchange (main first, then the **union** of shard ids,
each its own VV) converge across the full doc set over the wire?

**Properties:** (1) full-set convergence for every id in `localIds ∪ remoteIds`; (2) doc-id set
equality on both sides (catches an unmaterialized shard); (3) per-doc VV equality; (4)
ordering-independence (main-first vs shards-first both converge — main-first is an optimization,
not a correctness lever); (5) routing discipline (a shard's projection contains only keys whose
minted shardId equals that shard's id — no cross-doc corruption).

**Oracle:** per-doc canonical projection unioned across the set + doc-id-set equality + routing
discipline.

**Scenarios:**

- S2.1 Asymmetric shard knowledge (A has main+s1+s3, B has main) → B gains s1,s3, all converge.
- S2.2 Disjoint shard ownership → both gain all, converge.
- S2.3 New shard discovered mid-round (treeDoc delivers its ownership) → materialized + synced.
- S2.4 Hundreds of shards → full-set converge, no shard dropped.
- S2.5 Re-round after a new local edit → only that shard's VV advances (minimal round).

**Out of scope:** `sweepOrphans` algorithm (production owns it; P3 reuses the shape as a scenario);
wire faults (P3); membership (P4).

## P3 — Reconnect / partial-delivery self-heal

**Question:** under an **unreliable** wire (tunnel drop mid-sync, partial shard delivery), does
reconnect converge with **no loss and no resurrection**? Transport analog of `chaos.test.ts` +
`mid-sync-read.test.ts`.

**Properties:** (1) eventual convergence after faults (faults are never permanent); (2) conservation
across faults (every created key survives on all peers); (3) no resurrection across faults; (4)
partial delivery does not corrupt — a pending peer (treeDoc but not shard) must not sweep the orphan
(ownership-based heal, like `sweepOrphans`); (5) reconnect is a clean re-sync (VV grows, never
resets); (6) re-delivery idempotence under faults.

**Oracle:** conservation/no-resurrection (oracle 2) is load-bearing — computed from the global
created/deleted key set, independent of any peer's view.

**Scenarios:**

- S3.1 Tunnel drop mid-round (treeDoc delivered, shards not), reconnect, re-sync → converge + conserve.
- S3.2 Partial shard delivery (s2 delayed) → pending state must not sweep s2's occurrences; heal converges.
- S3.3 A edits while B offline; C online buffers; B reconnects → all three converge, partition-time creates survive.
- S3.4 Delete delivered before its concurrent ref → after heal, X gone on both, B's orphan ref gone (conservation oracle).
- S3.5 Stale re-send (lost ACK) → no-op, no echo.
- S3.6 Relay restart with in-flight updates → recoverable (peer stores durable), not data loss.
- S3.7 Flaky tunnel, many short drops → eventual convergence after flapping stops.

**Out of scope:** `sweepOrphans` algorithm correctness (no-resurrection / S3.4 delete-before-ref is
CRDT-owned — covered by production truth tests; the playground models no deletes); `reconcileDurability`
crash-restart (engine persistence, not transport); membership (P4); **mid-frame truncation /
FrameSocket timeout** (a partial BYTE-stream of one doc, or a connection dying mid-`recv` — transport
robustness, deferred; the playground models outcome-level partial delivery via the `only` option,
which delivers whole docs or none, not truncated frames); **S3.6 relay-restart's in-flight content**
(reduces to S3.1 here — `exchangeDocSetOverWire` opens a fresh connection per call and fully drains
before close, so there are no in-flight bytes to lose).

## P4 — Pubkey allowlist / membership gating

**Question:** does the per-workspace pubkey allowlist enforce binary membership, and does
revocation (drop pubkey) cut future updates **without** confiscating existing data?

**Properties:** (1) non-member cannot complete an exchange — its doc is byte-identical before/after,
and the member's doc is unchanged (no leak); (2) member converges normally; (3) revocation cuts
future updates (revoked peer's projection frozen at revocation point despite continued edits
elsewhere); (4) revocation cannot confiscate existing data (projection unchanged across the
revocation event); (5) revocation is **pairwise, not global** — a non-compliant member C that keeps
the pubkey still syncs with the revoked peer (characterizes the design's honesty: full cutoff is
social); (6) pubkey = peerId consistency (every peerId in every VV is a known allowlist member —
provenance discipline).

**Oracle:** membership rejection = non-member/revoked peer's projection byte-identical before/after
(computed from its own doc, not the gate's decision — catches a buggy-permissive gate). No-confiscation
= local-state comparison. Provenance = VV peerId ∈ allowlist set check.

**Scenarios:**

- S4.1 Non-member rejected, member accepted.
- S4.2 Member edits, non-member sees nothing.
- S4.3 Revocation: future withheld, existing kept.
- S4.4 Partial revocation (C non-compliant) → M syncs with C, not A/B.
- S4.5 Hard cutoff via new workspace (M lacks the new coordinate) → gate rejects.
- S4.6 Provenance discipline (no mystery peerIds).

**Out of scope:** crypto strength (assume the library); multi-device-per-actor; admin/roles (their
absence is the property); relay-enforced membership (relay is untrusted/protocol-blind; gating is
client-side); **per-op VV provenance / S4.6** (design §8 says pubkey = Loro peerId, but Loro's
`setPeerId` is NUMERIC — pubHex→peerId mapping is a production-integration detail; the playground
enforces membership at the connection gate, so per-op provenance is structurally implied, not
directly asserted); **S4.5 hard-cutoff via new workspace coordinate** (the playground has one
allowlist per exchange, no workspace-coordinate multiplexing, so it collapses to S4.3 — a
production-engine concern).

## P5 — transit privacy (client-to-client `node:crypto` AEAD)

**Question:** does payload-level AEAD make the forwarding transport content-blind — a known plaintext
sentinel in the payload never appears in what the transport forwarded? (Design §5: clients
E2E-encrypt; the transport routes opaque ciphertext. **No WireGuard** — that was tunwg-bundled;
tunwg is only an optional reachability choice, §3a, not the transport.)

**Properties:** (1) cipher-on → sentinel absent from the transport's forwarded-byte log (transit
privacy); (2) negative control — cipher-off → sentinel present (the oracle is meaningful, not
tautological); (3) the transport holds no decoded state (stateless forwarder); (4) convergence holds
with the cipher on (encryption doesn't perturb the sync outcome).

**Oracle:** `forwardedBytes().includes(sentinel)` byte check; convergence via the P1/P2 canonical
projection.

**Scenarios:** S5.1 sentinel-absent (cipher on); negative control sentinel-present (cipher off);
statelessness; convergence-under-cipher.

**Out of scope:** AEAD crypto strength (assume `node:crypto`); frame-header metadata visibility (the
transport sees plaintext tags/lengths — the playground asserts "cannot read CONTENT," not "sees only
opaque bytes"); the production relay's workspace ROUTING — P5's transport is a PAIRWISE bridge, not
the multi-client broker (that's P6).

## P6 — workspace-routing broker (the §3 relay core)

**Question:** does the broker route messages by workspace subscription — content-blind,
sender-excluded fan-out — WITHOUT leaking a private workspace's traffic to non-subscribers (the
defining property vs a dumb broadcast)? This is the layer P0–P5 (pairwise) did not cover.

**Properties (truth-based, implementation-independent):**

- **B1 private-workspace isolation** — a publish to W reaches ONLY subscribers(W); a non-subscriber's
  received-log is byte-identical before/after.
- **B2 fan-out** — one publish to W (N subscribers) reaches exactly N−1 received-logs (sender excluded).
- **B3 sender-exclusion** — the publisher's own received-log is unchanged by its publish (no echo).
- **B4 content-blind** — with a cipher, a plaintext sentinel never appears in `forwardedBytes()`; it
  does appear in a recipient's decoded payload.
- **B5 routing-table stability** — `stateSummary()` is structurally equal across a publish session
  (no routing-state mutation; deliver is synchronous, in-flight drains to 0).
- **B6 subscription dynamism** — late subscriber gets subsequent publishes, not backlog;
  unsubscribe stops delivery; re-subscribe resumes.
- **B7 multi-workspace** — a client in {W1,W2} gets per-workspace routing; no conflation.

**Oracle:** per-client received-log diffs (byte-identical ⇒ nothing delivered); delivery-count tally
(N−1 for fan-out); sentinel-substring check on `forwardedBytes()` (content-blind); deep-equal diff on
`stateSummary()` (routing-table stability).

**Scenarios:** S6.1 isolation+fan-out+sender-exclusion; S6.2 3+ fan-out; S6.3 private-workspace
no-leak; S6.4 late-subscriber (no backlog); S6.5 unsub/resub; S6.6 content-blind over AEAD; S6.7
multi-workspace; S6.8 routing-table stability; S6.9 sender-exclusion under fan-out; S6.10
non-subscriber publish rejected (pinned policy: publisher must be subscribed, §3 "subscriber
publishes"); + disconnect removes all subscriptions.

**Out of scope:** CRDT convergence (P1–P3 — P6 uses opaque payloads, not Loro updates); allowlist
auth (P4 — the broker is no-auth, membership is client-side); AEAD strength (P5); reachability/NAT
(§3a — deployment); broker+CRDT composition end-to-end (a hypothetical P7).

---

## Phase readiness

- **P1 first** — foundation; every later phase reuses its oracle helpers.
- **P2** lifts single-doc oracles to doc-sets (per-doc projection + id-set equality).
- **P3** builds on P2 (partial delivery needs multi-doc) + adds fault injection.
- **P4** orthogonal — wraps the transport with a gate; only needs P1's convergence.
- **P5** transit privacy — `node:crypto` AEAD content-blindness (no WireGuard; tunwg is §3a deployment).
- **P6 last** — the workspace-routing broker (the §3 relay core); the multi-client layer P0–P5 lacked.

Each scenario names peers + wire shape + fault + oracle(s), asserted as a **contract property**
(convergence / conservation / no-resurrection / idempotence / membership-rejection /
transit-privacy / workspace-isolation), never as "the sync loop did X internally."
