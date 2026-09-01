import type {
  PersistenceBackend,
  PhysicalIdentityStorage,
  PhysicalWorkspaceStorage,
  PhysicalWorkspaceStorageStage,
} from "../../../src/subsystems/persistence/backend.js";
import { InMemoryDocumentStore } from "../document-store.js";
import { InMemoryBlobStore } from "./in-memory-blob-store.js";

export class InMemoryPersistenceBackend implements PersistenceBackend {
  private readonly vault = new InMemoryBlobStore();
  private readonly peerIdentity = new InMemoryBlobStore();
  private readonly workspaces = new Map<string, InMemoryDocumentStore>();
  private readonly staged = new Map<string, InMemoryDocumentStore>();
  private closed = false;

  openIdentityStorage(): Promise<PhysicalIdentityStorage> {
    this.assertOpen();
    return Promise.resolve({ vault: this.vault, peerIdentity: this.peerIdentity });
  }

  listWorkspaceIds(): Promise<readonly string[]> {
    this.assertOpen();
    return Promise.resolve([...this.workspaces.keys()].sort());
  }

  openWorkspace(workspaceId: string): Promise<PhysicalWorkspaceStorage> {
    this.assertOpen();
    const documents = this.workspaces.get(workspaceId);
    if (!documents) {
      return Promise.reject(new Error(`Workspace storage does not exist: ${workspaceId}`));
    }
    return Promise.resolve({ workspaceId, documents, close: () => {} });
  }

  stageWorkspace(workspaceId: string): Promise<PhysicalWorkspaceStorageStage> {
    this.assertOpen();
    if (this.workspaces.has(workspaceId) || this.staged.has(workspaceId)) {
      return Promise.reject(new Error(`Workspace storage already exists: ${workspaceId}`));
    }
    const documents = new InMemoryDocumentStore();
    this.staged.set(workspaceId, documents);
    let active = true;
    const storage = { workspaceId, documents, close: () => {} };
    return Promise.resolve({
      storage,
      promote: () => {
        this.assertOpen();
        if (!active) {
          return Promise.reject(new Error(`Workspace storage stage is no longer active: ${workspaceId}`));
        }
        if (this.workspaces.has(workspaceId)) {
          return Promise.reject(new Error(`Workspace storage already exists: ${workspaceId}`));
        }
        active = false;
        this.staged.delete(workspaceId);
        this.workspaces.set(workspaceId, documents);
        let rolledBack = false;
        return Promise.resolve({
          storage,
          rollback: () => {
            if (!rolledBack && this.workspaces.get(workspaceId) === documents) {
              rolledBack = true;
              this.workspaces.delete(workspaceId);
            }
            return Promise.resolve();
          },
        });
      },
      discard: () => {
        this.assertOpen();
        if (active) {
          active = false;
          this.staged.delete(workspaceId);
        }
        return Promise.resolve();
      },
    });
  }

  discardStagedWorkspaces(): Promise<void> {
    this.assertOpen();
    this.staged.clear();
    return Promise.resolve();
  }

  close(): void {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("Persistence backend is closed");
    }
  }
}
