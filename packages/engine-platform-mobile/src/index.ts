import { createEngine, type Engine, type PeerTransportPort } from "@lode/engine";
import { MobilePersistenceBackend } from "./mobile-persistence-backend.js";
import type { MobilePersistenceBridge } from "./persistence-bridge.js";

export type MobileEngineOptions = Readonly<{
  persistence: MobilePersistenceBridge;
  peerTransport: PeerTransportPort;
}>;

export function createMobileEngine(options: MobileEngineOptions): Engine {
  return createEngine({
    persistence: new MobilePersistenceBackend(options.persistence),
    peerTransport: options.peerTransport,
  });
}

export { MobilePersistenceBackend } from "./mobile-persistence-backend.js";
export type {
  MobileDocumentUpdate,
  MobileIdentityBlob,
  MobileLoadedDocument,
  MobilePersistenceBridge,
} from "./persistence-bridge.js";
