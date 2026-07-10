// Public entry. The host surface only: the composition root, the App/Component lifecycle, the
// broker relay (host server + dial client), the shared EMPTY response, the typed errors the wire
// layer maps, and the identity crypto hosts/test-tooling use. Everything else (the workspace
// registry, the membership log, the sync internals, the core Engine/store) is engine-internal — a
// client reaches it through `AppRuntime.commands` (AppServerClient → commands), never directly.

// Identity crypto: mnemonic → actor keypair + a fresh mnemonic mint (host test-tooling uses these
// to set up authed sessions). See `utils/crypto/`.
export { deriveActorKeypairFromMnemonic, generateMnemonic } from "./utils/crypto/index.js";

export type { PersistenceOptions } from "./runtime/workspace/registry.js";
export { SessionRequiredError } from "./runtime/identity/session-identity.js";
export {
  DocNotFoundError,
  NotFoundError,
  AuthenticationError,
  PreconditionFailedError,
  NotOwnerError,
} from "./errors.js";
export { DomainInvalidInputError } from "./domain/errors.js";

export type { AppRuntime, AppRuntimeOptions } from "./runtime/app-runtime.js";
export { createAppRuntime } from "./runtime/app-runtime.js";
// Shared empty-response instance for void RPCs (the daemon's host-only handlers reuse it).
export { EMPTY } from "./services/wire/empty.js";
// The App/Component lifecycle framework. createAppRuntime returns the engine subsystems registered on
// an App but NOT started — the host (daemon/mobile) registers its own components (sync, relay, http)
// and drives lifecycle via app.start()/stop() (anytype-ideal composition root: assemble-then-start).
export { App } from "./runtime/app.js";
export type { Component } from "./runtime/app.js";

// Broker — the workspace-routing relay wire (BrokerService over a Connect gRPC bidi stream on
// HTTP/2), formerly @lode/transport. The daemon hosts the server in --relay mode; daemons/mobile
// dial it via the client. The routing core (createBroker) + the broker-sync transport are
// engine-internal — consumed only by the SyncRegistry sub-graph.
export { BrokerClient } from "./runtime/broker/broker-client.js";
export type { BrokerClientOptions } from "./runtime/broker/broker-client.js";
export { BrokerServer } from "./runtime/broker/broker-server.js";
export type { BrokerServerOptions } from "./runtime/broker/broker-server.js";
