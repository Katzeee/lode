// Public entry. The host surface only: the composition root, structured app runtime, the
// broker relay (host server + dial client), the shared EMPTY response, the typed errors the wire
// layer maps, and the identity crypto hosts/test-tooling use. Everything else (the workspace
// registry, the membership log, the sync internals, the core Engine/store) is engine-internal — a
// client reaches it through `EngineRuntime.commands` (AppServerClient → commands), never directly.

// Identity crypto: mnemonic → actor keypair + a fresh mnemonic mint (host test-tooling uses these
// to set up authed sessions). See `crypto/`.
export { deriveActorKeypairFromMnemonic, generateMnemonic } from "./crypto/index.js";

export type { PersistenceOptions } from "./runtime/workspace/registry.js";
export { SessionRequiredError } from "./runtime/session/client-session-manager.js";
export {
  DocNotFoundError,
  NotFoundError,
  AuthenticationError,
  PreconditionFailedError,
  NotOwnerError,
  VaultLockedError,
} from "./errors/index.js";
export { DomainInvalidInputError } from "./domain/errors.js";

// Vault unlock-lease TTL policy + (de)serialization — the host reads it from config.json.
export type { VaultTtl } from "./runtime/identity/vault-file.js";
export { parseUnlockTtl, DEFAULT_TTL } from "./runtime/identity/vault-file.js";

export type { EngineRuntime, RuntimeConfig } from "./engine-runtime.js";
export { createEngineRuntime } from "./engine-runtime.js";
// Shared empty-response instance for void RPCs (the daemon's host-only handlers reuse it).
export { EMPTY } from "./commands/wire/empty.js";
// The single app/component instance runtime. Hosts add explicit resources to app.root before start.
export { AppRuntime } from "./runtime/kernel/app-runtime.js";
export { RuntimeInstance } from "./runtime/kernel/runtime.js";
export { InstanceUnavailableError } from "./runtime/kernel/types.js";
export type { StopOptions, StopReason, StopReport } from "./runtime/kernel/types.js";
export type { RuntimeResource } from "./runtime/kernel/resource.js";

// Broker — the workspace-routing relay wire (BrokerService over a Connect gRPC bidi stream on
// HTTP/2), formerly @lode/transport. The daemon hosts the server in --relay mode; daemons/mobile
// dial it via the client. The routing core (createBroker) + the broker-sync transport are
// engine-internal — consumed only by the workspace sync sub-graph.
export { BrokerClient } from "./runtime/broker/broker-client.js";
export type { BrokerClientOptions } from "./runtime/broker/broker-client.js";
export { BrokerServer } from "./runtime/broker/broker-server.js";
export type { BrokerServerOptions } from "./runtime/broker/broker-server.js";
