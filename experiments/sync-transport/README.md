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
  membership = owner+member membership log (not an ACL), identity (actor keypair +
  per-dataRoot peerId), per-dataRoot persistence, daemon topology, recovery.

This README is the playground's own record: what it validated, the key files, and what's
left (P7). Detailed phase log: [`PROGRESS.md`](./PROGRESS.md). Test methodology:
[`TEST-MODEL.md`](./TEST-MODEL.md).

## Run

```
cd experiments/sync-transport && npx vitest run
```

## Status

P0–P7 done, **51 tests green, 0 skipped.** (P7 = the owner+member membership log.)

| Phase | Proved                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0    | In-process stand-in harness (convergence / conservation / determinism).                                                                                       |
| P1    | Real-wire framing + Loro-native VV encode/decode converges over loopback TCP.                                                                                 |
| P2    | Multi-doc docId-tagged routing discipline (an s3 update can't land in s7).                                                                                    |
| P3    | Outcome-level partial-delivery + reconnect self-heal (no loss, no resurrection).                                                                              |
| P4    | Ed25519 membership gate — non-member rejected before any doc bytes cross.                                                                                     |
| P5    | `node:crypto` AES-256-GCM transit privacy — relay/bridge sees only ciphertext.                                                                                |
| P6    | **Workspace-routing broker** — subscription routing, private-workspace isolation, fan-out, content-blindness.                                                 |
| P7    | **Membership log (owner+member)** — signed append-only log, transit-key wrapping + re-key chain, owner-only governance + transfer, forward secrecy, recovery. |

(Full per-phase detail + the honest "genuinely unvalidated" gaps:
[`PROGRESS.md`](./PROGRESS.md) §"Playground complete — assessment".)

## Key files

| File                       | What                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/broker.ts`            | The workspace-routing broker (P6). Production relay core.                                                                  |
| `src/wire.ts`              | Framing (`FrameSocket`) + payload-level `Cipher`.                                                                          |
| `src/multi-sync.ts`        | Multi-doc exchange (`DocSet` + profile-union + per-doc).                                                                   |
| `src/socket-sync.ts`       | Loopback TCP pair harness.                                                                                                 |
| `src/identity.ts`          | Ed25519 keypair (test-grade; production needs keystore + mnemonic).                                                        |
| `src/gated-sync.ts`        | Auth handshake (playground model; production = membership log + transit-key AEAD).                                         |
| `src/relay.ts`             | AES-256-GCM cipher + pairwise instrumented bridge (P5).                                                                    |
| `src/membership-crypto.ts` | P7 actor keys (Ed25519 sign + X25519 encrypt), sealed-box transit-key wrap/unwrap, AEAD — pure `node:crypto`.              |
| `src/membership-log.ts`    | **P7 membership log** — signed append-only records (root/add/rotate/transfer) over a Loro doc, replay→state, re-key chain. |
| `src/sync.ts`              | P0 in-process harness (`exchangeDocs`, mirrors production `SyncManager.exchangeDoc`).                                      |

## P7 — the membership log (owner+member, validated)

P7 validates the **membership log** decided in
[`sync-identity-persistence.md`](../../docs/design/sync-identity-persistence.md) §2 — an
**owner + member(rw)** log, **not an ACL** (lode has no authoritative server to enforce access
rules). It was the gate before production membership-log wiring — now green (7 tests). Same
substrate as P0–P6: raw `loro-crdt` + `node:crypto`, no engine, reusing P4 (Ed25519) + P5
(AEAD).

The transport/broker is already de-risked (P1–P6) — the membership log is just another stream
of sync bytes, **do not re-prove routing.** P7 focused on the genuinely new risk, now covered:

- **Membership log as a CRDT (Loro doc) — replay semantics.** Signed append-only records
  (root/add/rotate/transfer); replay → deterministic membership. Invalid records (bad sig,
  non-owner signer, stale rotate) are **skipped** at replay (not fatal) so every replica
  converges. Owner-only governance means no multi-admin concurrent conflict to resolve.
- **Transit-key wrapping.** The transit key (transport-only AEAD key) is wrapped to each
  member's X25519 pubkey; re-key chain (`encPrev` = AEAD(new, old)) for cross-epoch historical
  decryption.
- **Lifecycle.** root (owner self-signs) → add member → rotate (omission = revoke, the atomic
  removeAndRotate) → transfer ownership (new owner governs, old owner becomes a member).
- **Security.** A non-owner's forged add/rotate is skipped; a revoked member cannot unwrap the
  new epoch's transit key; a current member walks the chain back to all history.
- **Recovery.** Owner re-adds a recovered actor (same mnemonic-derived key) → unwrap current
  transit key → walk chain → full history.

These properties are cheap and conclusive to test in-process with real Loro merges and real
signatures — there is no reason to first hit them inside the production engine.

## Honest gaps (production work, NOT re-proved here)

OS-process isolation; frame-header metadata visibility; production
`SyncManager`/`ShardedBlockStore` wiring + ownership-derived shard discovery + per-op VV
provenance (pubHex→peerId); byte-level wire-fault robustness (mid-frame truncation,
`FrameSocket` timeout); delete/no-resurrection (CRDT-owned, covered by production truth
tests); reachability deployment (LAN/VPS/tunwg — orthogonal, by design not validated). See
[`PROGRESS.md`](./PROGRESS.md) for the full list.
