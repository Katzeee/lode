import { describe, expect, it, vi } from "vitest";

import { MobilePersistenceBackend } from "./mobile-persistence-backend.js";
import type { MobilePersistenceBridge } from "./persistence-bridge.js";

describe("MobilePersistenceBackend", () => {
  it("routes identity blobs through the native bridge", async () => {
    const reads: string[] = [];
    const writes: Readonly<{ kind: string; bytes: readonly number[] }>[] = [];
    const bridge = createBridge({
      readIdentityBlob: (kind) => {
        reads.push(kind);
        return Promise.resolve(kind === "vault" ? Uint8Array.of(1, 2) : null);
      },
      writeIdentityBlob: (kind, bytes) => {
        writes.push({ kind, bytes: [...bytes] });
        return Promise.resolve();
      },
    });

    const identity = await new MobilePersistenceBackend(bridge).openIdentityStorage();

    await expect(identity.vault.read()).resolves.toEqual(Uint8Array.of(1, 2));
    await expect(identity.peerIdentity.read()).resolves.toBeNull();
    await identity.peerIdentity.write(Uint8Array.of(3, 4));
    expect(reads).toEqual(["vault", "peer"]);
    expect(writes).toEqual([{ kind: "peer", bytes: [3, 4] }]);
  });

  it("keeps Workspace staging, promotion, rollback, and discard explicit", async () => {
    const events: string[] = [];
    const bridge = createBridge({
      stageWorkspace: (workspaceId) => {
        events.push(`stage:${workspaceId}`);
        return Promise.resolve(workspaceId === "workspace-1" ? "storage-1" : "storage-2");
      },
      promoteWorkspace: (storageId) => {
        events.push(`promote:${storageId}`);
        return Promise.resolve();
      },
      deleteWorkspaceStorage: (storageId) => {
        events.push(`delete:${storageId}`);
        return Promise.resolve();
      },
    });
    const backend = new MobilePersistenceBackend(bridge);

    const promotedStage = await backend.stageWorkspace("workspace-1");
    const promotion = await promotedStage.promote();
    expect(promotion.storage.workspaceId).toBe("workspace-1");
    await promotion.rollback();
    await expect(promotedStage.promote()).rejects.toThrow("no longer active");

    const discardedStage = await backend.stageWorkspace("workspace-2");
    await discardedStage.discard();
    await discardedStage.discard();

    expect(events).toEqual([
      "stage:workspace-1",
      "promote:storage-1",
      "delete:storage-1",
      "stage:workspace-2",
      "delete:storage-2",
    ]);
  });

  it("adapts native document persistence and rejects invalid sequences", async () => {
    const bridge = createBridge({
      openWorkspace: () => Promise.resolve("storage-7"),
      loadDocument: () =>
        Promise.resolve({
          snapshot: Uint8Array.of(1),
          updates: [Uint8Array.of(2), Uint8Array.of(3)],
        }),
      appendDocumentUpdates: (_storageId, updates) => Promise.resolve(updates.length === 1 ? [4] : [5]),
    });
    const workspace = await new MobilePersistenceBackend(bridge).openWorkspace("workspace-7");

    await expect(workspace.documents.load("facts")).resolves.toEqual({
      snapshot: Uint8Array.of(1),
      updates: [Uint8Array.of(2), Uint8Array.of(3)],
    });
    await expect(workspace.documents.appendUpdate("facts", Uint8Array.of(4))).resolves.toBe(4);
    await expect(
      workspace.documents.appendUpdates([
        { id: "facts", bytes: Uint8Array.of(5) },
        { id: "governance", bytes: Uint8Array.of(6) },
      ]),
    ).rejects.toThrow("invalid document update sequences");
  });

  it("closes the bridge once and refuses new backend operations", async () => {
    const close = vi.fn<() => Promise<void>>().mockResolvedValue();
    const backend = new MobilePersistenceBackend(createBridge({ close }));

    await backend.close();
    await backend.close();

    expect(close).toHaveBeenCalledTimes(1);
    await expect(backend.listWorkspaceIds()).rejects.toThrow("Persistence backend is closed");
    expect(() => backend.openIdentityStorage()).toThrow("Persistence backend is closed");
  });
});

function createBridge(overrides: Partial<MobilePersistenceBridge> = {}): MobilePersistenceBridge {
  return {
    readIdentityBlob: () => Promise.resolve(null),
    writeIdentityBlob: () => Promise.resolve(),
    listWorkspaceIds: () => Promise.resolve([]),
    openWorkspace: () => Promise.resolve("storage-default"),
    stageWorkspace: () => Promise.resolve("storage-default"),
    promoteWorkspace: () => Promise.resolve(),
    deleteWorkspaceStorage: () => Promise.resolve(),
    discardStagedWorkspaces: () => Promise.resolve(),
    loadDocument: () => Promise.resolve(null),
    appendDocumentUpdates: () => Promise.resolve([]),
    writeDocumentSnapshot: () => Promise.resolve(),
    close: () => Promise.resolve(),
    ...overrides,
  };
}
