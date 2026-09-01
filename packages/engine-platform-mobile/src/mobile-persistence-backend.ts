import type {
  BlobStore,
  DocumentStore,
  DocumentUpdate,
  PersistenceBackend,
  PhysicalIdentityStorage,
  PhysicalWorkspaceStorage,
  PhysicalWorkspaceStorageStage,
} from "@lode/engine";
import type { MobileDocumentUpdate, MobileIdentityBlob, MobilePersistenceBridge } from "./persistence-bridge.js";

export class MobilePersistenceBackend implements PersistenceBackend {
  private closed = false;

  constructor(private readonly bridge: MobilePersistenceBridge) {}

  openIdentityStorage(): Promise<PhysicalIdentityStorage> {
    this.assertOpen();
    return Promise.resolve({
      vault: this.identityBlob("vault"),
      peerIdentity: this.identityBlob("peer"),
    });
  }

  async listWorkspaceIds(): Promise<readonly string[]> {
    this.assertOpen();
    return this.bridge.listWorkspaceIds();
  }

  async openWorkspace(workspaceId: string): Promise<PhysicalWorkspaceStorage> {
    this.assertOpen();
    return this.physicalWorkspace(workspaceId, await this.bridge.openWorkspace(workspaceId));
  }

  async stageWorkspace(workspaceId: string): Promise<PhysicalWorkspaceStorageStage> {
    this.assertOpen();
    const storageId = await this.bridge.stageWorkspace(workspaceId);
    let active = true;
    return {
      storage: this.physicalWorkspace(workspaceId, storageId),
      promote: async () => {
        this.assertOpen();
        if (!active) {
          throw new Error(`Workspace storage stage is no longer active: ${workspaceId}`);
        }
        await this.bridge.promoteWorkspace(storageId);
        active = false;
        return {
          storage: this.physicalWorkspace(workspaceId, storageId),
          rollback: () => this.bridge.deleteWorkspaceStorage(storageId),
        };
      },
      discard: async () => {
        this.assertOpen();
        if (!active) {
          return;
        }
        await this.bridge.deleteWorkspaceStorage(storageId);
        active = false;
      },
    };
  }

  async discardStagedWorkspaces(): Promise<void> {
    this.assertOpen();
    await this.bridge.discardStagedWorkspaces();
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.bridge.close();
  }

  private identityBlob(kind: MobileIdentityBlob): BlobStore {
    return {
      read: () => this.bridge.readIdentityBlob(kind),
      write: (bytes) => this.bridge.writeIdentityBlob(kind, bytes),
    };
  }

  private physicalWorkspace(workspaceId: string, storageId: string): PhysicalWorkspaceStorage {
    return {
      workspaceId,
      documents: new MobileDocumentStore(this.bridge, storageId),
      close: () => {},
    };
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("Persistence backend is closed");
    }
  }
}

class MobileDocumentStore implements DocumentStore {
  constructor(
    private readonly bridge: MobilePersistenceBridge,
    private readonly storageId: string,
  ) {}

  async load(id: string) {
    const loaded = await this.bridge.loadDocument(this.storageId, id);
    return loaded === null
      ? null
      : {
          snapshot: loaded.snapshot === null ? null : new Uint8Array(loaded.snapshot),
          updates: loaded.updates.map((bytes) => new Uint8Array(bytes)),
        };
  }

  async appendUpdate(id: string, bytes: Uint8Array): Promise<number> {
    const [sequence] = await this.appendUpdates([{ id, bytes }]);
    if (sequence === undefined) {
      throw new Error("Mobile persistence bridge returned no sequence for an appended update");
    }
    return sequence;
  }

  async appendUpdates(updates: readonly DocumentUpdate[]): Promise<readonly number[]> {
    const input: readonly MobileDocumentUpdate[] = updates.map(({ id, bytes }) => ({ id, bytes }));
    const sequences = await this.bridge.appendDocumentUpdates(this.storageId, input);
    if (
      sequences.length !== input.length ||
      sequences.some((sequence) => !Number.isSafeInteger(sequence) || sequence <= 0)
    ) {
      throw new Error("Mobile persistence bridge returned invalid document update sequences");
    }
    return sequences;
  }

  writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
    return this.bridge.writeDocumentSnapshot(this.storageId, id, bytes);
  }
}
