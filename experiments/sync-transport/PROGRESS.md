# sync-transport playground — progress

Decoupled validation of lode's Phase D sync transport (raw `loro-crdt` + a self-written minimal
sync loop). NOT production code; resolves deps from the monorepo root `node_modules` via Node's
upward resolution (no local install). Architecture + decisions: `docs/design/sync-design.md`.

**Testing philosophy:** truth-based, independent oracles (mirror `@lode/engine` `tests/sync/`).
NOT differential, NOT bug-hunting. Each assertion derived from the sync contract / spec.

## Run

```
cd experiments/sync-transport && npx vitest run
```

## Phases

- [x] **P0 — in-process stand-in harness.** `src/sync.ts` (`exchangeDocs`, mirroring production
      `SyncManager.exchangeDoc`) + `canonical` oracle + `test/p0-convergence.test.ts` (convergence /
      conservation / determinism / repeated-rounds). 4 tests green. Establishes the harness; isolates
      transport-only failures from logic proven here + in production.
- [x] **P1 — real-wire convergence (loopback TCP).** `src/wire.ts` (length-prefixed framed
      `FrameSocket` + Loro-native VV encode/decode — de-risks audit BLOCKER 2) +
      `src/socket-sync.ts` (`exchangeOverWire`, one fresh loopback TCP pair per call, echo-free
      exchange mirroring `SyncManager.exchangeDoc`) + `test/p1-wire.test.ts` (S1.1–S1.6:
      convergence / VV-equality / large-update **byte-conservation** / snapshot-bootstrap /
      idempotent re-sync / connection-restart). 6 tests green (10 total). **Fidelity note:**
      both docs run in ONE process over a real kernel loopback socket — this fully exercises
      framing/serialization/Loro-encode-decode over a real wire (the fundamental P1 unknown) but
      NOT true OS-process isolation or a separate relay; those are exercised by P3 (relay restart)
      and P5 (WireGuard transit). Subagent-reviewed (impl + org): no blockers; S1.3
      byte-conservation now asserted directly.
- [x] **P2 — multi-doc (main + shards) over the wire.** `src/multi-sync.ts` (`DocSet` = Map of
      independent LoroDocs; profile-union + per-doc exchange over one loopback TCP, docId-tagged
      so an s3 update can't land in s7; oracles `canonicalDocSet`/`docIdsEqual`/`docSetVVEqual`/
      `routingDisciplineOk`) + `test/p2-multi-doc.test.ts` (S2.1–S2.5 + routing + empty-profile +
      3-peer transitivity). 8 tests green (18 total). `wire.ts` extended to 5 message kinds
      (profile/doc-vv/doc-update) without breaking P1. Subagent-reviewed (impl + org): no blockers;
      applied should-fixes — framing validation (MAX_FRAME cap + docIdLen bounds; hardens for P3
      fault injection), routing oracle tightened (non-map entry = corruption), `docSetVVEqual`
      made symmetric. **Caveat:** profile-union replaces production's main-first ownership-derived
      shard discovery (an optimization, per TEST-MODEL property 4) — valid for convergence, but
      cannot catch "peer advertises a shard it doesn't own"; that ownership-coupling is P3's scope.
- [x] **P3 — reconnect / partial-delivery self-heal.** Models an unreliable wire via an `only`
      option on `exchangeDocSetOverWire` (outcome-level subset delivery — "only these docs' bytes
      crossed this round"); a later full round heals. `test/p3-fault-heal.test.ts` (S3.1 only-main→
      heal, S3.2 delayed shard, S3.3 3-peer partition, S3.5 idempotent re-delivery, S3.7 flaky
      incremental, + heal-from-pending). 6 tests green (24 total). Subagent-reviewed: no blockers;
      applied doc/naming fixes — tightened `collectNodeKeys` comment (ownership-lost vs pending),
      renamed the pending test to match scope, recorded deferrals in TEST-MODEL §P3. **Omissions
      (honest, per model):** S3.4 no-resurrection / deletes not modeled (CRDT-owned, production
      truth tests cover); socket-level mid-frame truncation / FrameSocket timeout deferred
      (transport robustness, not CRDT self-heal); S3.6 relay-restart reduces to S3.1 (fresh
      connection per call, no in-flight bytes).
- [x] **P4 — pubkey allowlist / membership gating.** `src/identity.ts` (Ed25519 keypair,
      `newIdentity`/`idSign`/`idVerify`/`allowlistOf`) + `src/gated-sync.ts` (`exchangeGatedOverWire`
      — auth handshake then, only on success, the doc-set exchange; rejection throws before any doc
      bytes cross) + `wire.ts` auth/auth-sig message kinds. `test/p4-membership.test.ts` (S4.1
      non-member rejected + member converges; S4.3 revocation freezes + no-confiscation; S4.4
      pairwise revocation; forged-identity at the allowlist; **allowlisted pubHex + wrong-key sig
      rejected** — exercises the signature branch). 5 tests green (29 total). Subagent-reviewed:
      verdict commit-with-minor-fixes; added the wrong-key-signature test (the idVerify branch was
      previously untested) + moved S4.6 provenance to out-of-scope in TEST-MODEL. **Omissions
      (honest):** S4.2 subsumed by S4.1; S4.5 (new-workspace hard cutoff) collapses to S4.3 (one
      allowlist per exchange, no coordinate multiplexing); S4.6 per-op provenance deferred (Loro
      peerId is numeric; pubHex→peerId is a production-integration detail; membership enforced at
      the connection gate here).
- [x] **P5 — transit privacy (AES-256-GCM AEAD over a pairwise bridge).** `src/relay.ts`
      (`makeAesGcmCipher` AEAD; `makeRelayedPair` an instrumented PAIRWISE bridge — NOT the relay
      model; `exchangeOverRelay`) + `wire.ts` `FrameSocket` optional `Cipher` (payload-level; P1–P4
      unchanged). `test/p5-transit-privacy.test.ts` (cipher-on → sentinel absent from the bridge's
      forwarded bytes; negative control cipher-off → present; statelessness; convergence-under-cipher).
      Validates design §5 (client-to-client `node:crypto` AEAD; the transport routes ciphertext).
      NOTE: the earlier "tunwg/WireGuard mock" framing + `hasWireGuard`/real-WG tests were removed
      (078ba4c) — tunwg is only an optional reachability choice (§3a), not the transport. The
      pairwise bridge is a P5 transport shape; the production relay is the §3 BROKER (P6).
- [x] **P6 — workspace-routing broker (the §3 relay core).** `src/broker.ts` (`createBroker`:
      subscription table `Map<wsId, Set<clientId>>`; `publish` routes to subscribers minus sender;
      content-blind — opaque bytes; no-auth — clients enforce allowlist (P4); pinned policy:
      publisher must be subscribed; no content storage) + `test/p6-broker.test.ts` (S6.1–S6.10 +
      disconnect: private-workspace isolation, fan-out, sender-exclusion, content-blind over AEAD,
      routing-table stability, subscribe/unsubscribe dynamism, multi-workspace, non-subscriber
      rejection). 11 tests green (44 total). Subagent-reviewed (impl + org), verdict
      commit-with-minor-fixes; applied — `forwardedBytes` doc tightened, S6.8 renamed. **Closes the
      "how to forward" gap** the audit identified: P0–P5 were pairwise; P6 is the multi-client
      workspace-routing layer the corrected design (§3) actually specifies.

- [x] **P7 — the membership log (owner+member).** `src/membership-crypto.ts` (actor Ed25519
      sign + X25519 encrypt keypairs; sealed-box transit-key wrap/unwrap via ephemeral X25519 +
      ECDH + HKDF-SHA256 + AES-256-GCM; pure `node:crypto`) + `src/membership-log.ts`
      (`MembershipLog` = a Loro doc with an append-only signed `LoroList` of root/add/rotate/
      transfer; replay → state; re-key chain). `test/p7-membership.test.ts` (7 tests): root+add+
      decrypt; rotate-omission revokes (forward secrecy); re-key chain history walk; transfer
      (new owner governs, old can't); non-owner forge skipped; tampered sig + unknown signer
      skipped; recovery (re-add → current transit key + full-history walk). Validates design §2 —
      membership = replicated signed log, **owner+member only (no ACL/admin)**, transit key wrapped
      per member, **owner-only governance** (no multi-admin conflict), forward secrecy on rotate
      (omission = revoke), CRDT convergence (invalid records SKIPPED at replay), full-history
      recovery via re-add + chain, self-signed root (no masterKey). **Unblocks A1 (production
      membership log).** No new deps (all `node:crypto`). Redone from the earlier ACL-log P7 after
      the model converged to owner+member.

## Playground complete — assessment

All eight phases done (P0–P7); 51 tests green, 0 skipped.

**De-risked (the playground's job):** real-wire framing/serialization/Loro encode-decode (P1);
multi-doc docId-tagged routing discipline (P2); outcome-level partial-delivery self-heal (P3);
membership gating at the connection boundary (P4); client-to-client `node:crypto` AEAD transit
privacy (P5); **the workspace-routing broker — subscription routing, private-workspace isolation,
fan-out, content-blindness (P6)**; **the membership log (owner+member) — signed append-only log,
transit-key wrapping + re-key chain, owner-only governance + transfer, forward secrecy on
rotate, full-history recovery (P7)**.

**Genuinely unvalidated (honest gaps → Phase D production work):** (1) true OS-process isolation
(peers/clients share one Node process); (2) frame-header metadata visibility (the broker/bridge see
plaintext tags/lengths); (3) production `SyncManager`/`ShardedBlockStore` wiring + ownership-derived
shard discovery + per-op VV provenance (pubHex→peerId); (4) byte-level wire-fault robustness
(mid-frame truncation, FrameSocket timeout); (5) **broker + CRDT composition end-to-end** — P6 used
opaque payloads, and P7 validated the membership log in ISOLATION, not composed with the broker +
pairwise
sync; that end-to-end composition is the production transport wiring (T1/T2);
(6) delete / no-resurrection / revocation-confiscation (CRDT-owned, production truth tests cover).
Reachability (§3a: LAN/VPS/tunwg) is a deployment dimension, orthogonal — not validated here, by
design.

Each substantive phase: subagent-guided test model → implement → subagent review (impl + org) →
adjust → update this doc → commit + push.

## Resume note (for the recurring loop)

Before starting a phase: `git log --oneline -5` + read this file. Do NOT redo committed phases.
The last committed phase's tests must stay green.
