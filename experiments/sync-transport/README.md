# sync-transport playground

Decoupled validation of lode's Phase D sync transport + membership. Raw `loro-crdt` + a
self-written minimal sync loop, **no `@lode/engine` dependency** — resolves deps from the
monorepo root `node_modules` via Node's upward resolution (no local install). This isolates
the sync/transport/membership risk from the production engine; once ported to production,
this directory is deleted.

**Durable design (NOT here — in `docs/design/`):**

- [`sync-design.md`](../../docs/design/sync-design.md) — transport topology, the
  workspace-routing broker, encryption (node:crypto AEAD), honest security model.
- [`sync-identity-persistence.md`](../../docs/design/sync-identity-persistence.md) —
  membership = replicated signed ACL log (model C), identity (actor keypair + per-dataRoot
  peerId), per-dataRoot persistence, daemon topology, recovery.

This README is the playground's own record: what it validated, the key files, and what's
left (P7). Detailed phase log: [`PROGRESS.md`](./PROGRESS.md). Test methodology:
[`TEST-MODEL.md`](./TEST-MODEL.md).

## Run

```
cd experiments/sync-transport && npx vitest run
```

## Status

P0–P6 done, **44 tests green, 0 skipped.** P7 (ACL log) is next — see below.

| Phase | Proved                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------- |
| P0    | In-process stand-in harness (convergence / conservation / determinism).                                       |
| P1    | Real-wire framing + Loro-native VV encode/decode converges over loopback TCP.                                 |
| P2    | Multi-doc docId-tagged routing discipline (an s3 update can't land in s7).                                    |
| P3    | Outcome-level partial-delivery + reconnect self-heal (no loss, no resurrection).                              |
| P4    | Ed25519 membership gate — non-member rejected before any doc bytes cross.                                     |
| P5    | `node:crypto` AES-256-GCM transit privacy — relay/bridge sees only ciphertext.                                |
| P6    | **Workspace-routing broker** — subscription routing, private-workspace isolation, fan-out, content-blindness. |

(Full per-phase detail + the honest "genuinely unvalidated" gaps:
[`PROGRESS.md`](./PROGRESS.md) §"Playground complete — assessment".)

## Key files

| File                 | What                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `src/broker.ts`      | The workspace-routing broker (P6). Production relay core.                             |
| `src/wire.ts`        | Framing (`FrameSocket`) + payload-level `Cipher`.                                     |
| `src/multi-sync.ts`  | Multi-doc exchange (`DocSet` + profile-union + per-doc).                              |
| `src/socket-sync.ts` | Loopback TCP pair harness.                                                            |
| `src/identity.ts`    | Ed25519 keypair (test-grade; production needs keystore + mnemonic).                   |
| `src/gated-sync.ts`  | Auth handshake (playground model; production = ACL log + read-key AEAD).              |
| `src/relay.ts`       | AES-256-GCM cipher + pairwise instrumented bridge (P5).                               |
| `src/sync.ts`        | P0 in-process harness (`exchangeDocs`, mirrors production `SyncManager.exchangeDoc`). |

## P7 — the ACL log (next)

P7 validates the **membership layer** decided in
[`sync-identity-persistence.md`](../../docs/design/sync-identity-persistence.md) §2 (model
C). It is the gate before production ACL wiring. Same substrate as P0–P6: raw `loro-crdt` +
`node:crypto`, no engine, reusing P4 (Ed25519) + P5 (AEAD).

The transport/broker is already de-risked (P1–P6) — an ACL doc is just another stream of
sync bytes, **do not re-prove routing.** P7 focuses on the genuinely new risk:

- **ACL log as a CRDT (Loro doc) — merge semantics.** The log is an append-only list of
  signed records; replay → deterministic ACL state. Stress case: two replicas concurrently
  append conflicting records (two admins mutually removing each other) → merge → replay →
  one consistent, deterministic state.
- **Crypto wrapping.** Read-key wrapped to each member's actor pubkey (X25519 sealed box);
  re-key chain (`encryptedPreviousReadKey`, AES-256-GCM) for cross-epoch historical
  decryption. Ed25519→Curve25519 conversion for the actor key's encrypt role.
- **Lifecycle scenarios.** Create workspace (ACL root with owner + wrapped read-key); add
  member; remove member + rotate key; change role; transfer ownership.
- **Security properties.** Non-admin forged ACL change is rejected on apply; a removed
  member cannot unwrap the new epoch's read-key; a current member can walk the re-key chain
  back to decrypt all history.
- **Recovery scenario.** Mnemonic → derive actor key → admin re-adds the actor (wraps
  current read-key to its pubkey) → unwrap → walk chain → full history.

These properties are cheap and conclusive to test in-process with real Loro merges and real
signatures — there is no reason to first hit them inside the production engine.

## Honest gaps (production work, NOT re-proved here)

OS-process isolation; frame-header metadata visibility; production
`SyncManager`/`ShardedBlockStore` wiring + ownership-derived shard discovery + per-op VV
provenance (pubHex→peerId); byte-level wire-fault robustness (mid-frame truncation,
`FrameSocket` timeout); delete/no-resurrection (CRDT-owned, covered by production truth
tests); reachability deployment (LAN/VPS/tunwg — orthogonal, by design not validated). See
[`PROGRESS.md`](./PROGRESS.md) for the full list.
