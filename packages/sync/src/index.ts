// @lode/sync — the shared sync transport: the workspace-routing broker (client + `--relay` server)
// over real WebSocket, the `SyncTransport` adapter over it, and the wire-security contract. Used by
// both the daemon (desktop) and mobile (in-process, dials a relay directly). The broker is
// content-blind + no-auth + no storage (design sync-design.md §3).
//
// Public surface is intentionally narrow — only the host-facing pieces. The routing core, the frame
// + sync-message codecs, and the seal/open primitives are package-internal (tests reach them via
// relative imports); keeping them out of the public API protects future internal refactors.

export { BrokerServer, type BrokerServerOptions } from "./broker-server.js";
export { BrokerClient, type BrokerClientOptions } from "./broker-client.js";
export { BrokerClientSyncTransport } from "./broker-sync-transport.js";
export { type WireSecurity, type WireSealContext, type WireOpenContext } from "./wire-security.js";
export {
  createMembershipWireSecurity,
  type MembershipWireSecurity,
} from "./membership-security.js";
