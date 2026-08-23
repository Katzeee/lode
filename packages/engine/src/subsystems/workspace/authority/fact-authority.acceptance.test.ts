import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";

import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import type { DocumentStore, DocumentUpdate, LoadedDocumentBytes } from "../../persistence/document-store.js";
import { InvocationConflictError, ProjectionUnavailableError } from "./errors.js";
import { FactAuthority } from "./fact-authority.js";
import { FACT_AUTHORITY_DOCUMENT_ID } from "./loro-fact-store.js";
import { localReceiptsDocumentId } from "./local-receipt-store.js";
import { FactReplication } from "../fact-replication.js";
import { syncPair } from "../../../../tests/support/sync.js";

const REPLICA_A = "101";
const REPLICA_B = "202";
const request = { command: "create-node", nodeId: "node" } as const;
const body = edit("node");

function edit(nodeId: string) {
  return {
    kind: "edit" as const,
    actorId: "actor",
    intent: "direct" as const,
    actions: [
      {
        kind: "node-create" as const,
        nodeId,
        ownerNodeId: "workspace",
        originalPlacement: null,
      },
    ] as const,
  };
}

async function open(documents: DocumentStore, peerId: `${number}` = "101") {
  return FactAuthority.open({
    workspaceId: "workspace",
    loroPeerId: peerId,
    documents,
  });
}

describe("production Fact authority store", () => {
  it("CMD-2 edit Fact batch, receipt, and frontier commit atomically", async () => {
    const durable = new RecordingDocumentStore();
    const store = await open(durable, "101");
    const result = await store.commit({
      invocationId: "invocation",
      request,
      writes: [
        {
          ...body,
          actions: [
            ...body.actions,
            { kind: "node-create", nodeId: "node-2", ownerNodeId: "workspace", originalPlacement: null },
          ],
        },
      ],
      lineage: null,
      inverse: [],
      publishedFrontier: {},
    });

    expect(result.created).toBe(true);
    expect(result.receipt.factIds).toHaveLength(1);
    expect(result.receipt.committedFrontier).toEqual({ [REPLICA_A]: 1 });
    expect(store.snapshot().facts).toHaveLength(1);
    expect(durable.appendCount).toBe(1);
    const persisted = await durable.load(FACT_AUTHORITY_DOCUMENT_ID);
    const authorityUpdate = persisted?.updates[0];
    if (!authorityUpdate) {
      throw new Error("Expected one durable authority update");
    }
    const authorityDocument = new LoroDoc();
    authorityDocument.import(authorityUpdate);
    const factRecords = authorityDocument.getList("facts");
    expect(factRecords.length).toBe(1);
    expect(factRecords.get(0)).toEqual({
      kind: "edit",
      actorId: "actor",
      intent: "direct",
      actions: [
        { kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null },
        { kind: "node-create", nodeId: "node-2", ownerNodeId: "workspace", originalPlacement: null },
      ],
    });
    const reopened = await open(durable, "101");
    expect(reopened.snapshot().facts).toHaveLength(1);
    expect(reopened.receipt("invocation")).toEqual(result.receipt);
  });

  it("an append failure leaves authority unchanged", async () => {
    const documents = new FailingDocumentStore();
    const store = await open(documents);
    await expect(
      store.commit({
        invocationId: "invocation",
        request,
        writes: [body],
        lineage: null,
        inverse: [],
        publishedFrontier: {},
      }),
    ).rejects.toThrow("injected append failure");

    expect(store.snapshot()).toEqual({ facts: [], frontier: {} });
    expect(store.receipt("invocation")).toBeNull();
  });

  it("a failed automatic compaction keeps the commit and retries after the next append", async () => {
    const sourceDocuments = new FailingAuthoritySnapshotStore();
    const source = await FactAuthority.open({
      workspaceId: "workspace",
      loroPeerId: "101",
      documents: sourceDocuments,
      snapshotInterval: 1,
    });
    const first = await source.commit({
      invocationId: "compaction-failed",
      request,
      writes: [body],
      lineage: null,
      inverse: [],
      publishedFrontier: {},
    });
    expect(first.created).toBe(true);
    expect(source.snapshot().facts).toHaveLength(1);
    expect(source.receipt("compaction-failed")).not.toBeNull();

    sourceDocuments.failAuthoritySnapshot = false;
    await source.commit({
      invocationId: "compaction-retry",
      request: { ...request, nodeId: "second" },
      writes: [edit("second")],
      lineage: null,
      inverse: [],
      publishedFrontier: first.receipt.committedFrontier,
    });
    expect((await sourceDocuments.load(FACT_AUTHORITY_DOCUMENT_ID))?.updates).toHaveLength(0);
    const destination = await open(new InMemoryDocumentStore(), "202");
    await syncPair(new FactReplication(source.replication), new FactReplication(destination.replication));
    expect(destination.snapshot().facts).toHaveLength(2);
  });

  it("Invocation retry and identity conflict use the canonical request digest", async () => {
    const documents = new InMemoryDocumentStore();
    const store = await open(documents);
    const first = await store.commit({
      invocationId: "invocation",
      request,
      writes: [body],
      lineage: null,
      inverse: [],
      publishedFrontier: {},
    });
    const retry = await store.commit({
      invocationId: "invocation",
      request: { nodeId: "node", command: "create-node" },
      writes: [body],
      lineage: null,
      inverse: [],
      publishedFrontier: {},
    });

    expect(retry).toEqual({ receipt: first.receipt, created: false });
    expect(store.snapshot().facts).toHaveLength(1);
    await expect(
      store.commit({
        invocationId: "invocation",
        request: { ...request, nodeId: "other" },
        writes: [body],
        lineage: null,
        inverse: [],
        publishedFrontier: first.receipt.committedFrontier,
      }),
    ).rejects.toBeInstanceOf(InvocationConflictError);
  });

  it("concurrent Invocation retries serialize to one atomic authority batch", async () => {
    const store = await open(new InMemoryDocumentStore());
    const commit = {
      invocationId: "concurrent-retry",
      request,
      writes: [body],
      lineage: null,
      inverse: [],
      publishedFrontier: {},
    } as const;

    const [left, right] = await Promise.all([store.commit(commit), store.commit(commit)]);

    expect([left.created, right.created].sort()).toEqual([false, true]);
    expect(left.receipt).toEqual(right.receipt);
    expect(store.snapshot().facts).toHaveLength(1);
    expect(store.receipt("concurrent-retry")).toEqual(left.receipt);
  });

  it("Command during projection lag", async () => {
    const store = await open(new InMemoryDocumentStore());
    const first = await store.commit({
      invocationId: "first",
      request,
      writes: [body],
      lineage: null,
      inverse: [],
      publishedFrontier: {},
    });
    await expect(
      store.commit({
        invocationId: "second",
        request: { ...request, nodeId: "node-2" },
        writes: [edit("node-2")],
        lineage: null,
        inverse: [],
        publishedFrontier: {},
      }),
    ).rejects.toBeInstanceOf(ProjectionUnavailableError);
    expect(store.receipt("second")).toBeNull();
    expect(first.receipt.committedFrontier).toEqual({ [REPLICA_A]: 1 });
  });

  it("restart preserves separate Fact and receipt documents while sync exports only Facts", async () => {
    const documentsA = new InMemoryDocumentStore();
    const storeA = await open(documentsA);
    const committed = await storeA.commit({
      invocationId: "invocation",
      request,
      writes: [body],
      lineage: null,
      inverse: [],
      publishedFrontier: {},
    });
    const restarted = await open(documentsA, "101");
    expect(restarted.receipt("invocation")).toEqual(committed.receipt);
    expect(restarted.snapshot()).toEqual(storeA.snapshot());
    expect(await documentsA.listIds()).toEqual([FACT_AUTHORITY_DOCUMENT_ID, localReceiptsDocumentId(REPLICA_A)]);

    const storeB = await open(new InMemoryDocumentStore(), "202");
    await storeB.replication.importUpdate(await storeA.replication.exportUpdate());
    expect(storeB.snapshot()).toEqual(storeA.snapshot());
    expect(storeB.receipt("invocation")).toBeNull();
  });

  it("local receipt retention can end without deleting authoritative Facts", async () => {
    const documents = new InMemoryDocumentStore();
    const store = await open(documents);
    await store.commit({
      invocationId: "expires-locally",
      request,
      writes: [body],
      lineage: null,
      inverse: [],
      publishedFrontier: {},
    });

    await documents.delete(localReceiptsDocumentId(REPLICA_A));
    const reopened = await open(documents, "101");

    expect(reopened.snapshot().facts).toHaveLength(1);
    expect(reopened.receipt("expires-locally")).toBeNull();
  });

  it("direct sync import preserves locally committed Facts without an earlier export", async () => {
    const local = await open(new InMemoryDocumentStore(), "101");
    await local.commit({
      invocationId: "local",
      request: { side: "local" },
      writes: [body],
      lineage: null,
      inverse: [],
      publishedFrontier: {},
    });
    const remote = await open(new InMemoryDocumentStore(), "202");
    await remote.commit({
      invocationId: "remote",
      request: { side: "remote" },
      writes: [edit("remote")],
      lineage: null,
      inverse: [],
      publishedFrontier: {},
    });

    await local.replication.importUpdate(await remote.replication.exportUpdate());

    expect(local.snapshot().facts).toHaveLength(2);
  });

  it("SYNC-3 workspace replica sequences are isolated", async () => {
    const first = await open(new InMemoryDocumentStore(), "101");
    const second = await open(new InMemoryDocumentStore(), "202");
    const left = await first.commit({
      invocationId: "left",
      request: { side: "left" },
      writes: [body],
      lineage: null,
      inverse: [],
      publishedFrontier: {},
    });
    const right = await second.commit({
      invocationId: "right",
      request: { side: "right" },
      writes: [edit("right")],
      lineage: null,
      inverse: [],
      publishedFrontier: {},
    });
    expect(left.receipt.committedFrontier).toEqual({ [REPLICA_A]: 1 });
    expect(right.receipt.committedFrontier).toEqual({ [REPLICA_B]: 1 });
  });

  it("DUR-3 retained facts survive snapshots and long offline merge", async () => {
    const documents = new InMemoryDocumentStore();
    const store = await FactAuthority.open({
      workspaceId: "workspace",
      loroPeerId: "101",
      documents: documents,
      snapshotInterval: 16,
    });
    for (let index = 0; index < 40; index += 1) {
      await store.commit({
        invocationId: `offline-${index}`,
        request: { index },
        writes: [edit(`offline-${index}`)],
        lineage: null,
        inverse: [],
        publishedFrontier: store.snapshot().frontier,
      });
    }
    const restarted = await open(documents);
    const remote = await open(new InMemoryDocumentStore(), "202");
    await remote.replication.importUpdate(await restarted.replication.exportUpdate());
    expect(restarted.snapshot().facts).toHaveLength(40);
    expect(remote.snapshot()).toEqual(restarted.snapshot());
  });

  it("production compaction bounds the external update replay chain without deleting Facts", async () => {
    const documents = new InMemoryDocumentStore();
    const store = await FactAuthority.open({
      workspaceId: "workspace",
      loroPeerId: "101",
      documents: documents,
      snapshotInterval: 4,
    });
    for (let index = 0; index < 9; index += 1) {
      await store.commit({
        invocationId: `compact-${index}`,
        request: { index },
        writes: [edit(`compact-${index}`)],
        lineage: null,
        inverse: [],
        publishedFrontier: store.snapshot().frontier,
      });
    }

    expect((await documents.load(FACT_AUTHORITY_DOCUMENT_ID))?.updates).toHaveLength(1);
    const restarted = await open(documents);
    expect(restarted.snapshot().facts).toHaveLength(9);
  });
});

class RecordingDocumentStore extends InMemoryDocumentStore {
  appendCount = 0;

  override appendUpdates(updates: readonly DocumentUpdate[]): Promise<readonly number[]> {
    this.appendCount += 1;
    return super.appendUpdates(updates);
  }
}

class FailingDocumentStore implements DocumentStore {
  delete(_id: string): Promise<void> {
    return Promise.resolve();
  }

  load(_id: string): Promise<LoadedDocumentBytes | null> {
    return Promise.resolve(null);
  }

  listIds(): Promise<string[]> {
    return Promise.resolve([]);
  }

  appendUpdate(_id: string, _bytes: Uint8Array): Promise<number> {
    return Promise.reject(new Error("injected append failure"));
  }

  appendUpdates(_updates: readonly DocumentUpdate[]): Promise<readonly number[]> {
    return Promise.reject(new Error("injected append failure"));
  }

  writeSnapshot(_id: string, _bytes: Uint8Array): Promise<void> {
    return Promise.resolve();
  }
}

class FailingAuthoritySnapshotStore extends InMemoryDocumentStore {
  failAuthoritySnapshot = true;

  override writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
    if (id === FACT_AUTHORITY_DOCUMENT_ID && this.failAuthoritySnapshot) {
      return Promise.reject(new Error("injected authority snapshot failure"));
    }
    return super.writeSnapshot(id, bytes);
  }
}
