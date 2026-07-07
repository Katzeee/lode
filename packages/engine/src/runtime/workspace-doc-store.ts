import type { DocStore, LoadedDocBytes } from "../core/doc-store.js";
import type { WorkspaceStore } from "../persistence/workspace-store.js";

/**
 * Adapts the persistence leaf (WorkspaceStore — sqlite today; a different binding on mobile, a
 * future PG) to the core `DocStore` port. This is the dependency-inversion hinge: core owns the
 * `id → bytes` contract, the runtime adapts the leaf to it, and the leaf imports nothing from core.
 * The adapter is the only place that knows the leaf's concrete method names — everything above it
 * (`loadOutliner`, `persistMutation`) speaks `DocStore`, so swapping the leaf touches only this file.
 *
 * Field-name translation lives here too: persistence's `LoadedDocBytes` (`snapshotBytes`/`updateBytes`)
 * becomes core's (`snapshot`/`updates`). The leaf's `coveredUpdateSeq` (its snapshot-PK version) is
 * the leaf's own latest-seq — an internal storage detail the port rightly hides.
 */
export class WorkspaceDocStore implements DocStore {
  constructor(private readonly store: WorkspaceStore) {}

  async load(id: string): Promise<LoadedDocBytes | null> {
    const bytes = await this.store.loadDocBytes(id);
    return bytes ? { snapshot: bytes.snapshotBytes, updates: bytes.updateBytes } : null;
  }

  listIds(): Promise<string[]> {
    return this.store.listSubDocs();
  }

  appendUpdate(id: string, bytes: Uint8Array): Promise<number> {
    return this.store.appendUpdate({ subDoc: id, updateBytes: bytes });
  }

  async writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
    // The snapshot covers the doc's latest appended state; the leaf tracks that seq internally.
    const coveredUpdateSeq = await this.store.latestSeq(id);
    await this.store.writeSnapshot({ subDoc: id, coveredUpdateSeq, snapshotBytes: bytes });
  }
}
