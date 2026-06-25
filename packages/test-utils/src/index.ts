// A loopback TCP endpoint with an ephemeral port for integration tests. The daemon binds
// and reports the actual port via AppServerDaemon.address.
export function tempListenUrl(): string {
  return "tcp://127.0.0.1:0";
}
