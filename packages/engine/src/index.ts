// Public entry. Re-exports the runtime composition root + the cross-layer types the
// daemon and in-process clients need. See runtime/app-runtime.ts for the composition.

export type { PersistenceOptions } from "./runtime/workspace-registry.js";
export type { AppContext } from "./services/index.js";
export type { EngineOrigin } from "./session/session-manager.js";
export { SessionRequiredError } from "./session/session-manager.js";
export { DocNotFoundError } from "./services/errors.js";
export { DomainInvalidInputError } from "./domain/errors.js";

export type { AppRuntime, AppRuntimeOptions, LodeCommands } from "./runtime/app-runtime.js";
export { createAppRuntime } from "./runtime/app-runtime.js";
// The App/Component lifecycle framework. createAppRuntime returns the engine subsystems registered on
// an App but NOT started — the host (daemon/mobile) registers its own components (sync, relay, http)
// and drives lifecycle via app.start()/stop() (anytype-ideal composition root: assemble-then-start).
export { App } from "./runtime/app.js";
export type { Component } from "./runtime/app.js";

// Sync — the in-process CRDT sync core. SyncManager + the SyncTransport seam are the
// engine's whole sync surface; the daemon/transport layer implements SyncTransport over the
// broker (design: docs/design/sync-identity-persistence.md §1). Exported so out-of-process
// transports can reach them without importing engine source directly.
export { SyncManager, InMemorySyncTransport, syncPair } from "./runtime/sync.js";
export type { SyncTransport, SyncProfile } from "./runtime/sync.js";
// The sync-core store + doc + version types the transport layer (T2) reaches via
// `runtime.workspaces.getEngine(wsId).getShardedStore()`. Exported as types/values so @lode/sync can
// construct a SyncManager and serve/respond over the broker without importing engine source.
export type { VersionVector } from "./core/types.js";
export { Engine } from "./core/engine.js";
export { ShardedBlockStore } from "./core/sharded-store.js";
export type { SyncDoc } from "./core/sharded-store.js";

// Actor identity — the membership/attribution principal (Ed25519 keypair) + per-dataRoot
// keystore/catalog. Mnemonic recovery (BIP-39/SLIP-10) + Ed25519→X25519 dual-use (transit-key
// wrapping) are landed (F3b). Exported so the daemon can authenticate actor sessions (F4), sign
// membership-log records (A1), and wrap transit keys — without importing engine source directly.
// Generic crypto utilities (mirrors anytype's util/crypto/): AES-256-GCM AEAD, BIP-39 mnemonic,
// SLIP-10 Ed25519 derivation, Edwards↔Montgomery conversion. Pure leaves (node:crypto + audited
// libs); re-exported so @lode/sync shares them (no duplicated wire-security AEAD).
export { aeadEncrypt, aeadDecrypt } from "./utils/crypto/aes.js";
export { generateMnemonic, validateMnemonic, mnemonicToSeed } from "./utils/crypto/bip39.js";
export { deriveEd25519Seed } from "./utils/crypto/slip10.js";
export type { Slip10Node } from "./utils/crypto/slip10.js";
export { edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from "./utils/crypto/curve.js";
export {
  actorIdFromPublicKey,
  generateActorKeypair,
  keypairFromEd25519Seed,
  ed25519SeedFromPrivateKey,
  deriveActorKeypairFromMnemonic,
  signWithActor,
  verifyActorSignature,
  serializeActorPrivateKey,
  deserializeActorPrivateKey,
} from "./identity/actor-key.js";
export type { ActorKeypair, ActorPrivateKey, ActorPublicKey } from "./identity/actor-key.js";
export {
  actorEncryptionPublic,
  actorEncryptionPrivate,
  wrapKey,
  unwrapKey,
} from "./identity/actor-encryption.js";
export { ActorStore } from "./identity/actor-store.js";
export type { ActorRecord } from "./identity/actor-store.js";

// Membership log — the replicated, signed owner+member log (the membership half of the in-process
// sync core; design sync-identity-persistence §2). Protobuf records in a Loro doc; F3b dual-use
// crypto. T4-b wires it as a synced doc: `MembershipSync` gossip-pushes it over a transport (plaintext
// — it's a public roster), and a host derives the content transport's `WireSecurity` from its state.
export { MembershipLog, MEMBERSHIP_DOC_ID } from "./runtime/membership/membership-log.js";
export type {
  Member,
  MembershipState,
  MemberPublicKeys,
} from "./runtime/membership/membership-log.js";
export { MembershipSync } from "./runtime/membership/membership-sync.js";
