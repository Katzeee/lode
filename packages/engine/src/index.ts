// Public entry. Re-exports the runtime composition root + the cross-layer types the
// daemon and in-process clients need. See runtime/app-runtime.ts for the composition.

// Crypto leaf (Ed25519 actor signing / X25519 peer keys / AES-256-GCM / BIP-39 / SLIP-10) — see
// `utils/crypto/`.
export {
  deriveActorKeypairFromMnemonic,
  generateActorKeypair,
  generateMnemonic,
  actorIdFromPublicKey,
  generatePeerKeypair,
  peerKeypairFromPrivateKey,
  type ActorKeypair,
  type PeerKeypair,
} from "./utils/crypto/index.js";

export type { PersistenceOptions } from "./runtime/workspace-registry.js";
export type { AppContext } from "./services/index.js";
export type { EngineOrigin } from "./session/session-manager.js";
export { SessionRequiredError } from "./session/session-manager.js";
export {
  DocNotFoundError,
  AuthenticationError,
  PreconditionFailedError,
  NotOwnerError,
} from "./services/errors.js";
export { DomainInvalidInputError } from "./domain/errors.js";

export type { AppRuntime, AppRuntimeOptions, LodeCommands } from "./runtime/app-runtime.js";
export { createAppRuntime } from "./runtime/app-runtime.js";
// The App/Component lifecycle framework. createAppRuntime returns the engine subsystems registered on
// an App but NOT started — the host (daemon/mobile) registers its own components (sync, relay, http)
// and drives lifecycle via app.start()/stop() (anytype-ideal composition root: assemble-then-start).
export { App } from "./runtime/app.js";
export type { Component } from "./runtime/app.js";

// Sync — the in-process CRDT sync primitives. `SyncManager` + the `SyncTransport` seam are
// engine-internal now (consumed by the SyncRegistry sub-graph); `InMemorySyncTransport` +
// `syncPair` remain exported as test helpers. The store/doc/version types are core vocabulary.
export { InMemorySyncTransport, syncPair } from "./runtime/sync/sync-manager.js";
export type { SyncTransport, SyncProfile } from "./runtime/sync/sync-manager.js";
export type { SyncBytes, SyncableDoc, SyncableComposite } from "./core/store/syncable.js";
export { Engine } from "./core/engine.js";
export { ShardedBlockStore } from "./core/store/sharded-store.js";

// Membership log — the replicated, signed owner+member log (the membership half of the in-process
// sync core; design sync-identity-persistence §2). Protobuf records in a Loro doc that the engine's
// sync sub-graph gossip-pushes over the broker's plaintext envelope (a public roster); the
// sub-graph derives the content transport's wire security from its state. `MembershipLog` is the
// governance surface; the gossip + wire-security pieces are engine-internal to the sub-graph.
export { MembershipLog, MEMBERSHIP_DOC_ID } from "./runtime/membership/membership-log.js";
export type {
  Peer,
  PeerPublicKeys,
  LocalPeer,
  MembershipState,
} from "./runtime/membership/membership-log.js";

// Wire security + the SyncProfile codec — the content/security layer the transport consumes.
export { seal, open } from "./runtime/membership/wire-security.js";
export type {
  WireSecurity,
  WireSealContext,
  WireOpenContext,
} from "./runtime/membership/wire-security.js";
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
// The broker sync protocol (`SyncTransport` over `BrokerClient`) is engine-internal now — consumed
// only by the SyncRegistry sub-graph.

// Sync — the engine-owned per-workspace sync composition (the successor to the daemon-side
// DaemonSyncRunner). Hosts (daemon, mobile, embedded) drive register/share/join/syncNow through
// `AppRuntime.sync` (a SyncRegistry) without importing engine sync internals. The sub-graph
// itself (context + round driver + push path + round bodies) is engine-internal — not re-exported.
export { SyncRegistry } from "./runtime/sync/registry.js";
export type { SyncRegistryOptions, WorkspaceCoordinateData } from "./runtime/sync/registry.js";
export type { SyncDeps, RoundSummary } from "./runtime/sync/deps.js";
