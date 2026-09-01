export { createEngine } from "./engine.js";
export type { Engine, EngineOptions } from "./engine.js";
export type {
  PersistenceBackend,
  PhysicalIdentityStorage,
  PhysicalWorkspacePromotion,
  PhysicalWorkspaceStorage,
  PhysicalWorkspaceStorageStage,
} from "./subsystems/persistence/backend.js";
export type { BlobStore } from "./subsystems/persistence/blob-store.js";
export type { DocumentStore, DocumentUpdate, LoadedDocumentBytes } from "./subsystems/persistence/document-store.js";
export type {
  PeerTransportPort,
  ReplicaExchangeHandler,
  ReplicaExchangeProof,
  ReplicaExchangeWire,
  TransitHandshake,
} from "./subsystems/connection/index.js";
