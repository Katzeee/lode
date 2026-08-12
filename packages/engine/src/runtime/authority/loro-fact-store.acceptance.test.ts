import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";

import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import {
  canonicalDigest,
  canonicalJson,
  makeFact,
  requestDigest,
  unsignedFact,
  type AuthorityRecord,
  type Fact,
} from "../../domain/fact/index.js";
import type { DocumentStore, LoadedDocumentBytes } from "../../persistence/document-store.js";
import {
  AuthorityCommitUnknownError,
  AuthorityFaultError,
  InvocationConflictError,
  ProjectionUnavailableError,
} from "./errors.js";
import { FACT_AUTHORITY_DOCUMENT_ID, LoroFactStore, createReplicaId } from "./loro-fact-store.js";
import { FactSyncComposite } from "../sync/fact-sync.js";
import { syncPair } from "../sync/sync-exchange.js";

const REPLICA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const REPLICA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const request = { command: "create-node", nodeId: "node" } as const;
const body = {
  kind: "contribution" as const,
  actorId: "actor",
  intent: "direct" as const,
  mutation: { kind: "node-create" as const, nodeId: "node" },
};

async function open(
  documents: DocumentStore,
  replicaId = REPLICA_A,
  peerId: `${number}` = "101",
  onAuthorityAdvanced?: (frontier: Readonly<Record<string, number>>) => void,
) {
  return LoroFactStore.open({
    workspaceId: "workspace",
    replicaId,
    loroPeerId: peerId,
    documents,
    admitRecords: admitAuthorityRecords,
    ...(onAuthorityAdvanced ? { onAuthorityAdvanced } : {}),
  });
}

async function seed(documents: DocumentStore, records: readonly AuthorityRecord[]): Promise<void> {
  const doc = new LoroDoc();
  doc.setPeerId("991");
  const list = doc.getList<string>("authority-records");
  for (const record of records) {
    list.push(canonicalJson(record));
  }
  doc.commit({ message: "test-authority-records" });
  await documents.appendUpdate(FACT_AUTHORITY_DOCUMENT_ID, doc.export({ mode: "update" }));
}

describe("production Loro-backed FactStore", () => {
  it("AUTH-2 immutable idempotent records fail closed on conflicts", async () => {
    const documents = new InMemoryDocumentStore();
    const first = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA_A,
      sequence: 1,
      observed: {},
      lamport: 1,
      body,
    });
    const unsigned = {
      ...unsignedFact(first),
      body: { ...body, mutation: { kind: "node-create" as const, nodeId: "other" } },
    };
    const conflict = { ...unsigned, contentDigest: canonicalDigest(unsigned) };
    await seed(documents, [
      { recordKind: "fact", fact: first },
      { recordKind: "fact", fact: first },
      { recordKind: "fact", fact: conflict },
    ]);

    const store = await open(documents);
    expect(store.admission().kind).toBe("fault");
    expect(() => store.snapshot()).toThrow(AuthorityFaultError);
  });

  it("AUTH-5 admission distinguishes pending gaps from authority faults", async () => {
    const documents = new InMemoryDocumentStore();
    const second = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA_B,
      sequence: 2,
      observed: { [REPLICA_B]: 1 },
      lamport: 2,
      body: { ...body, mutation: { kind: "node-create", nodeId: "late" } },
    });
    await seed(documents, [{ recordKind: "fact", fact: second }]);
    const store = await open(documents);

    expect(store.admission()).toMatchObject({
      kind: "pending",
      pendingFactIds: [second.id],
      snapshot: { facts: [], frontier: {} },
      fault: null,
    });
  });

  it("CMD-2 fact batch ledger receipt and frontier commit atomically", async () => {
    const durable = new RecordingDocumentStore();
    const advanced: Readonly<Record<string, number>>[] = [];
    const store = await open(durable, REPLICA_A, "101", (frontier) => advanced.push(frontier));
    const result = await store.commit({
      invocationId: "invocation",
      request,
      bodies: [body, { ...body, mutation: { kind: "node-create", nodeId: "node-2" } }],
      lineage: null,
      publishedFrontier: {},
    });

    expect(result.created).toBe(true);
    expect(result.receipt.factIds).toHaveLength(2);
    expect(result.receipt.committedFrontier).toEqual({ [REPLICA_A]: 2 });
    expect(store.snapshot().facts).toHaveLength(2);
    expect(durable.appendCount).toBe(1);
    expect(advanced).toEqual([{ [REPLICA_A]: 2 }]);
    const reopened = await open(durable, REPLICA_A, "102");
    expect(reopened.snapshot().facts).toHaveLength(2);
    expect(reopened.receipt("invocation")).toEqual(result.receipt);
  });

  it("Durable crash boundaries", async () => {
    const documents = new FailingDocumentStore();
    const store = await open(documents);
    await expect(
      store.commit({
        invocationId: "invocation",
        request,
        bodies: [body],
        lineage: null,
        publishedFrontier: {},
      }),
    ).rejects.toBeInstanceOf(AuthorityCommitUnknownError);

    expect(store.snapshot()).toEqual({ facts: [], frontier: {} });
    expect(store.receipt("invocation")).toBeNull();
  });

  it("Durable crash boundaries audit and adopt a durable commit after its acknowledgement is lost", async () => {
    const documents = new PersistThenFailDocumentStore();
    const store = await open(documents);
    await expect(
      store.commit({
        invocationId: "durable-before-crash",
        request,
        bodies: [body],
        lineage: null,
        publishedFrontier: {},
      }),
    ).rejects.toBeInstanceOf(AuthorityCommitUnknownError);
    expect(store.snapshot().facts).toHaveLength(1);
    expect(store.receipt("durable-before-crash")).toMatchObject({
      invocationId: "durable-before-crash",
    });

    documents.fail = false;
    const restarted = await open(documents);
    expect(restarted.snapshot().facts).toHaveLength(1);
    expect(restarted.receipt("durable-before-crash")).toMatchObject({
      invocationId: "durable-before-crash",
    });
  });

  it("Durable crash boundaries heal Fact sync after authority snapshot compaction fails", async () => {
    const sourceDocuments = new FailingAuthoritySnapshotStore();
    const source = await LoroFactStore.open({
      workspaceId: "workspace",
      replicaId: REPLICA_A,
      loroPeerId: "101",
      documents: sourceDocuments,
      snapshotInterval: 1,
    });
    await expect(
      source.commit({
        invocationId: "compaction-failed",
        request,
        bodies: [body],
        lineage: null,
        publishedFrontier: {},
      }),
    ).rejects.toBeInstanceOf(AuthorityCommitUnknownError);
    expect(source.snapshot().facts).toHaveLength(1);
    expect(source.receipt("compaction-failed")).not.toBeNull();

    sourceDocuments.failAuthoritySnapshot = false;
    expect(
      (
        await source.commit({
          invocationId: "compaction-failed",
          request,
          bodies: [body],
          lineage: null,
          publishedFrontier: {},
        })
      ).created,
    ).toBe(false);
    const destination = await open(new InMemoryDocumentStore(), REPLICA_B, "202");
    await syncPair(new FactSyncComposite(source), new FactSyncComposite(destination));
    expect(destination.snapshot().facts).toHaveLength(1);
  });

  it("Invocation retry and identity conflict use the canonical request digest", async () => {
    const documents = new InMemoryDocumentStore();
    const store = await open(documents);
    const first = await store.commit({
      invocationId: "invocation",
      request,
      bodies: [body],
      lineage: null,
      publishedFrontier: {},
    });
    const retry = await store.commit({
      invocationId: "invocation",
      request: { nodeId: "node", command: "create-node" },
      bodies: [body],
      lineage: null,
      publishedFrontier: {},
    });

    expect(retry).toEqual({ receipt: first.receipt, created: false });
    expect(store.snapshot().facts).toHaveLength(1);
    await expect(
      store.commit({
        invocationId: "invocation",
        request: { ...request, nodeId: "other" },
        bodies: [body],
        lineage: null,
        publishedFrontier: first.receipt.committedFrontier,
      }),
    ).rejects.toBeInstanceOf(InvocationConflictError);
  });

  it("concurrent Invocation retries serialize to one atomic authority batch", async () => {
    const store = await open(new InMemoryDocumentStore());
    const commit = {
      invocationId: "concurrent-retry",
      request,
      bodies: [body],
      lineage: null,
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
      bodies: [body],
      lineage: null,
      publishedFrontier: {},
    });
    await expect(
      store.commit({
        invocationId: "second",
        request: { ...request, nodeId: "node-2" },
        bodies: [{ ...body, mutation: { kind: "node-create", nodeId: "node-2" } }],
        lineage: null,
        publishedFrontier: {},
      }),
    ).rejects.toBeInstanceOf(ProjectionUnavailableError);
    expect(store.receipt("second")).toBeNull();
    expect(first.receipt.committedFrontier).toEqual({ [REPLICA_A]: 1 });
  });

  it("restart and real Loro sync preserve admitted Facts and local receipts", async () => {
    const documentsA = new InMemoryDocumentStore();
    const storeA = await open(documentsA);
    const committed = await storeA.commit({
      invocationId: "invocation",
      request,
      bodies: [body],
      lineage: null,
      publishedFrontier: {},
    });
    const restarted = await open(documentsA, REPLICA_A, "101");
    expect(restarted.receipt("invocation")).toEqual(committed.receipt);
    expect(restarted.snapshot()).toEqual(storeA.snapshot());

    const storeB = await open(new InMemoryDocumentStore(), REPLICA_B, "202");
    await storeB.syncDoc.importUpdate(await storeA.syncDoc.exportUpdate());
    expect(storeB.snapshot()).toEqual(storeA.snapshot());
    expect(storeB.receipt("invocation")).toBeNull();
  });

  it("replica identities are 128-bit lowercase base32 values", () => {
    expect(createReplicaId()).toMatch(/^[a-z2-7]{26}$/);
  });

  it("receipt-only records do not advance the logical Fact frontier", async () => {
    const documents = new InMemoryDocumentStore();
    await seed(documents, [
      {
        recordKind: "receipt",
        receipt: {
          workspaceId: "workspace",
          replicaId: REPLICA_A,
          invocationId: "receipt-only",
          requestDigest: requestDigest(request),
          factIds: [`g1/workspace/${REPLICA_A}/1`],
          committedFrontier: { [REPLICA_A]: 1 },
          lineage: null,
        },
      },
    ]);
    const store = await open(documents);
    expect(store.snapshot()).toEqual({ facts: [], frontier: {} });
    expect(store.receipt("receipt-only")?.factIds).toEqual([`g1/workspace/${REPLICA_A}/1`]);
  });

  it("SYNC-3 workspace replica sequence and admission events are isolated", async () => {
    const first = await open(new InMemoryDocumentStore(), REPLICA_A, "101");
    const second = await open(new InMemoryDocumentStore(), REPLICA_B, "202");
    const left = await first.commit({
      invocationId: "left",
      request: { side: "left" },
      bodies: [body],
      lineage: null,
      publishedFrontier: {},
    });
    const right = await second.commit({
      invocationId: "right",
      request: { side: "right" },
      bodies: [{ ...body, mutation: { kind: "node-create", nodeId: "right" } }],
      lineage: null,
      publishedFrontier: {},
    });
    expect(left.receipt.committedFrontier).toEqual({ [REPLICA_A]: 1 });
    expect(right.receipt.committedFrontier).toEqual({ [REPLICA_B]: 1 });
  });

  it("DUR-3 retained facts survive snapshots and long offline merge", async () => {
    const documents = new InMemoryDocumentStore();
    const store = await open(documents);
    for (let index = 0; index < 40; index += 1) {
      await store.commit({
        invocationId: `offline-${index}`,
        request: { index },
        bodies: [{ ...body, mutation: { kind: "node-create", nodeId: `offline-${index}` } }],
        lineage: null,
        publishedFrontier: store.snapshot().frontier,
      });
    }
    await store.compact();
    const restarted = await open(documents);
    const remote = await open(new InMemoryDocumentStore(), REPLICA_B, "202");
    await remote.syncDoc.importUpdate(await restarted.syncDoc.exportUpdate());
    expect(restarted.snapshot().facts).toHaveLength(40);
    expect(remote.snapshot()).toEqual(restarted.snapshot());
  });

  it("production compaction bounds the external update replay chain without deleting Facts", async () => {
    const documents = new InMemoryDocumentStore();
    const store = await LoroFactStore.open({
      workspaceId: "workspace",
      replicaId: REPLICA_A,
      loroPeerId: "101",
      documents,
      snapshotInterval: 4,
    });
    for (let index = 0; index < 9; index += 1) {
      await store.commit({
        invocationId: `compact-${index}`,
        request: { index },
        bodies: [{ ...body, mutation: { kind: "node-create", nodeId: `compact-${index}` } }],
        lineage: null,
        publishedFrontier: store.snapshot().frontier,
      });
    }

    expect((await documents.load(FACT_AUTHORITY_DOCUMENT_ID))?.updates).toHaveLength(1);
    const restarted = await open(documents);
    expect(restarted.snapshot().facts).toHaveLength(9);
  });

  it("反序、重复与迟到 support", async () => {
    const documents = new InMemoryDocumentStore();
    const node = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA_A,
      sequence: 1,
      observed: {},
      lamport: 1,
      body,
    });
    const occurrence = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA_A,
      sequence: 2,
      observed: { [REPLICA_A]: 1 },
      lamport: 2,
      body: {
        ...body,
        mutation: {
          kind: "occurrence-create",
          occurrenceId: "occurrence",
          nodeId: "node",
          parentOccurrenceId: null,
          parentPolicy: "cascade",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      },
    });
    await seed(documents, [
      { recordKind: "fact", fact: occurrence },
      { recordKind: "fact", fact: node },
      { recordKind: "fact", fact: occurrence },
    ]);
    expect((await open(documents)).admission()).toMatchObject({
      kind: "ready",
      snapshot: { facts: [{ id: node.id }, { id: occurrence.id }] },
    });
  });

  it("Admission gap 与 receipt-only update", async () => {
    const documents = new InMemoryDocumentStore();
    const first = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA_B,
      sequence: 1,
      observed: {},
      lamport: 1,
      body,
    });
    const second = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA_B,
      sequence: 2,
      observed: { [REPLICA_B]: 1 },
      lamport: 2,
      body,
    });
    await seed(documents, [
      { recordKind: "fact", fact: second },
      {
        recordKind: "receipt",
        receipt: {
          workspaceId: "workspace",
          replicaId: REPLICA_A,
          invocationId: "receipt-only-gap",
          requestDigest: requestDigest(request),
          factIds: [`g1/workspace/${REPLICA_A}/1`],
          committedFrontier: { [REPLICA_A]: 1 },
          lineage: null,
        },
      },
    ]);
    const advanced: Readonly<Record<string, number>>[] = [];
    const store = await open(documents, REPLICA_A, "101", (frontier) => advanced.push(frontier));
    expect(store.admission()).toMatchObject({ kind: "pending", snapshot: { frontier: {} } });
    expect(store.receipt("receipt-only-gap")).not.toBeNull();

    const remote = new LoroDoc();
    remote.setPeerId("202");
    remote
      .getMap<string>("facts")
      .set(
        `${first.id}/${first.contentDigest}`,
        canonicalJson({ recordKind: "fact", fact: first }),
      );
    remote.commit({ message: "fill-admission-gap" });
    await store.syncDoc.importUpdate(remote.export({ mode: "update" }));

    expect(store.admission()).toMatchObject({
      kind: "ready",
      snapshot: { frontier: { [REPLICA_B]: 2 } },
    });
    expect(advanced).toEqual([{ [REPLICA_B]: 2 }]);
  });

  it("Version 与 corruption", async () => {
    const documents = new InMemoryDocumentStore();
    const valid = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA_A,
      sequence: 1,
      observed: {},
      lamport: 1,
      body,
    });
    const unsigned = { ...unsignedFact(valid), schemaVersion: 5 };
    const unsupported = {
      ...unsigned,
      contentDigest: canonicalDigest(unsigned),
    } as unknown as Fact;
    await seed(documents, [{ recordKind: "fact", fact: unsupported }]);
    const admission = (await open(documents)).admission();
    expect(admission.kind).toBe("fault");
    expect(admission.fault).toContain("Unsupported Fact version");
  });
});

class RecordingDocumentStore extends InMemoryDocumentStore {
  appendCount = 0;

  override appendUpdate(id: string, bytes: Uint8Array): Promise<number> {
    this.appendCount += 1;
    return super.appendUpdate(id, bytes);
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

  writeSnapshot(_id: string, _bytes: Uint8Array): Promise<void> {
    return Promise.resolve();
  }
}

class PersistThenFailDocumentStore extends InMemoryDocumentStore {
  fail = true;

  override async appendUpdate(id: string, bytes: Uint8Array): Promise<number> {
    const sequence = await super.appendUpdate(id, bytes);
    if (this.fail) {
      throw new Error("injected crash after durable append");
    }
    return sequence;
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
