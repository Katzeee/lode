import { createEngine, type Engine, type PeerTransportPort } from "@lode/engine";
import { NodePersistenceBackend } from "./node-persistence-backend.js";

export type DesktopEngineOptions = Readonly<{
  dataRoot: string;
  peerTransport: PeerTransportPort;
}>;

export function createDesktopEngine(options: DesktopEngineOptions): Engine {
  return createEngine({
    persistence: new NodePersistenceBackend(options.dataRoot),
    peerTransport: options.peerTransport,
  });
}

export { NodePersistenceBackend } from "./node-persistence-backend.js";
