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

// Sync — the in-process CRDT sync core. SyncManager + the SyncTransport seam are the
// engine's whole sync surface; the daemon/transport layer implements SyncTransport over the
// broker (design: docs/design/sync-identity-persistence.md §1). Exported so out-of-process
// transports can reach them without importing engine source directly.
export { SyncManager, InMemorySyncTransport, syncPair } from "./runtime/sync.js";
export type { SyncTransport, SyncProfile } from "./runtime/sync.js";

// Actor identity — the membership/attribution principal (Ed25519 keypair) + per-dataRoot
// keystore/catalog. Pure node:crypto; mnemonic + Ed25519→X25519 (read-key wrapping) land with
// the ACL work. Exported so the daemon can authenticate actor sessions (F4) and sign ACL
// records (A1) without importing engine source directly.
export {
  actorIdFromPublicKey,
  generateActorKeypair,
  signWithActor,
  verifyActorSignature,
  serializeActorPrivateKey,
  deserializeActorPrivateKey,
} from "./identity/actor-key.js";
export type { ActorKeypair, ActorPrivateKey, ActorPublicKey } from "./identity/actor-key.js";
export { ActorStore } from "./identity/actor-store.js";
export type { ActorRecord } from "./identity/actor-store.js";
