import type { BlobStore } from "./blob-store.js";
import type { DocumentStore } from "./document-store.js";

export type WorkspaceStorage = Readonly<{
  workspaceId: string;
  facts: DocumentStore;
  metadata: DocumentStore;
  release(): Promise<void>;
}>;

export type WorkspaceStoragePromotion = Readonly<{
  storage: WorkspaceStorage;
  rollback(): Promise<void>;
}>;

export type WorkspaceStorageStage = Readonly<{
  storage: WorkspaceStorage;
  promote(): Promise<WorkspaceStoragePromotion>;
  discard(): Promise<void>;
}>;

export type IdentityStorage = Readonly<{
  vault: BlobStore;
  peerIdentity: BlobStore;
}>;

export type WorkspaceStorageFactory = Readonly<{
  list(): Promise<readonly string[]>;
  open(workspaceId: string): Promise<WorkspaceStorage>;
  stage(workspaceId: string): Promise<WorkspaceStorageStage>;
}>;

export type PersistenceCapability = Readonly<{
  identityStorage: Readonly<{ open(): Promise<IdentityStorage> }>;
  workspaceStorage: WorkspaceStorageFactory;
}>;
