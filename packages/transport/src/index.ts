// @lode/transport — the shared sync transport SHELL: the workspace-routing broker (client + `--relay`
// server) over real WebSocket + the `SyncTransport` adapter over it. Content/security (transit-key
// AEAD seal/open, actor wire signing, the SyncProfile codec) is imported from `@lode/engine`; this
// package owns only sockets. The broker is content-blind + no-auth + no storage
// (design sync-design.md §3). Used by both daemon (desktop) and mobile (in-process, dials a relay).

export { BrokerServer, type BrokerServerOptions } from "./broker-server.js";
export { BrokerClient, type BrokerClientOptions } from "./broker-client.js";
export { BrokerClientSyncTransport } from "./broker-sync-transport.js";
