// Public entry. Re-exports the runtime composition root + the cross-layer types the
// daemon and in-process clients need. See runtime/app-runtime.ts for the composition.

// Crypto leaf (Ed25519 / X25519 / AES-256-GCM / BIP-39 / SLIP-10) — see `utils/crypto/`.
export {
  deriveActorKeypairFromMnemonic,
  generateActorKeypair,
  generateMnemonic,
  actorEncryptionPublic,
  actorIdFromPublicKey,
  type ActorKeypair,
} from "./utils/crypto/index.js";

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
// The sync-core store + doc + version types the daemon's sync runner reaches via
// `runtime.workspaces.getEngine(wsId).getShardedStore()`. Exported as types/values so the daemon can
// construct a SyncManager + BrokerSyncProtocol without importing engine source.
export type { VersionVector } from "./core/types.js";
export { Engine } from "./core/engine.js";
export { ShardedBlockStore } from "./core/sharded-store.js";
export type { SyncDoc } from "./core/sharded-store.js";

// Membership log — the replicated, signed owner+member log (the membership half of the in-process
// sync core; design sync-identity-persistence §2). Protobuf records in a Loro doc that
// `MembershipSync` gossip-pushes over a transport (plaintext — it's a public roster); a host derives
// the content transport's `WireSecurity` from its state.
export { MembershipLog, MEMBERSHIP_DOC_ID } from "./runtime/membership/membership-log.js";
export type {
  Member,
  MembershipState,
  MemberPublicKeys,
} from "./runtime/membership/membership-log.js";
export { MembershipSync } from "./runtime/membership/membership-sync.js";

// Wire security + the SyncProfile codec — the content/security layer the transport consumes.
export { seal, open } from "./runtime/membership/wire-security.js";
export type {
  WireSecurity,
  WireSealContext,
  WireOpenContext,
} from "./runtime/membership/wire-security.js";
export {
  createMembershipWireSecurity,
  type MembershipWireSecurity,
} from "./runtime/membership/membership-security.js";
export { encodeProfile, decodeProfile } from "./runtime/sync-message.js";

// Broker — the workspace-routing relay wire (BrokerClient + BrokerServer) over a Connect gRPC bidi
// stream (HTTP/2), formerly @lode/transport. Engine-internal now so the wire travels with the
// @lode/transport. Engine-internal now so the wire travels with the engine. The daemon hosts the
// server in --relay mode; daemons/mobile dial it via the client. The routing core (createBroker) is
// engine-internal — not re-exported.
export { BrokerClient } from "./runtime/broker/broker-client.js";
export type { BrokerClientOptions } from "./runtime/broker/broker-client.js";
export { BrokerServer } from "./runtime/broker/broker-server.js";
export type { BrokerServerOptions } from "./runtime/broker/broker-server.js";
// The broker sync protocol — `SyncTransport` over `BrokerClient` (CRDT-coupled: profile codec, seal/
// open demux, request/response correlation). Formerly `@lode/transport`'s adapter; engine-internal now.
export { BrokerSyncProtocol } from "./runtime/broker/broker-sync-transport.js";
