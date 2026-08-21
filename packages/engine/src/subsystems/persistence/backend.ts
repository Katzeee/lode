import type { BlobStore } from "./blob-store.js";
import type { DocumentStore } from "./document-store.js";

export type PhysicalIdentityStorage = Readonly<{
  vault: BlobStore;
  peerIdentity: BlobStore;
}>;

export type PhysicalWorkspaceStorage = Readonly<{
  workspaceId: string;
  documents: DocumentStore;
  close(): void | Promise<void>;
}>;

export type PhysicalWorkspaceStorageStage = Readonly<{
  storage: PhysicalWorkspaceStorage;
  promote(): Promise<PhysicalWorkspaceStorage>;
  discard(): Promise<void>;
}>;

export type PersistenceBackend = Readonly<{
  openIdentityStorage(): Promise<PhysicalIdentityStorage>;
  listWorkspaceIds(): Promise<readonly string[]>;
  openWorkspace(workspaceId: string): Promise<PhysicalWorkspaceStorage>;
  stageWorkspace(workspaceId: string): Promise<PhysicalWorkspaceStorageStage>;
  discardStagedWorkspaces(): Promise<void>;
  close(): void | Promise<void>;
}>;
