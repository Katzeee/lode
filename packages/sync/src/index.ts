// @lode/sync — the shared sync transport: the workspace-routing broker (client + `--relay` server)
// over real WebSocket. Used by both the daemon (desktop) and mobile (in-process, dials a relay
// directly). The broker is content-blind + no-auth + no storage (design sync-design.md §3); the
// `BrokerClientSyncTransport` adapter over this lands in T2.

export { createBroker, type Broker, type BrokerPeer } from "./broker.js";
export { encodeFrame, decodeFrame, type BrokerFrame } from "./frame.js";
export { BrokerServer, type BrokerServerOptions } from "./broker-server.js";
export { BrokerClient, type BrokerClientOptions } from "./broker-client.js";
export {
  encodeSyncMessage,
  decodeSyncMessage,
  encodeProfile,
  decodeProfile,
  type SyncMessage,
} from "./sync-message.js";
export { BrokerClientSyncTransport } from "./broker-sync-transport.js";
export {
  seal,
  open,
  type WireSealContext,
  type WireOpenContext,
  type WireSecurity,
} from "./wire-security.js";
