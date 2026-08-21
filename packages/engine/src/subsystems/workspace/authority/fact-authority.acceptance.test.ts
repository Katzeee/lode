import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";

import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import {
  admitAuthorityRecordShapes,
  canonicalDigest,
  canonicalJson,
  makeFact,
  requestDigest,
  unsignedFact,
  type AuthorityRecord,
  type Fact,
} from "../../../domain/fact/index.js";
import type { DocumentStore, LoadedDocumentBytes } from "../../persistence/document-store.js";
import { AuthorityFaultError, InvocationConflictError, ProjectionUnavailableError } from "./errors.js";
import { FactAuthority, createReplicaId } from "./fact-authority.js";
import { FACT_AUTHORITY_JOURNAL_DOCUMENT_ID } from "./authority-journal.js";
import { FactReplication } from "../fact-replication.js";
import { syncPair } from "../../../../tests/support/sync.js";

const REPLICA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const REPLICA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const request = { command: "create-node", nodeId: "node" } as const;
const body = {
  kind: "contribution" as const,
  actorId: "actor",
  intent: "direct" as const,
  mutation: { kind: "node-create" as const, nodeId: "node" },
};

async function open(documents: DocumentStore, replicaId = REPLICA_A, peerId: `${number}` = "101") {
  return FactAuthority.open({
    workspaceId: "workspace",
    replicaId,
    loroPeerId: peerId,
    authorityJournal: documents,
    factReplication: documents,
    admitRecords: admitAuthorityRecordShapes,
  });
}

async function seed(documents: DocumentStore, records: readonly AuthorityRecord[]): Promise<void> {
  await documents.appendUpdate(FACT_AUTHORITY_JOURNAL_DOCUMENT_ID, new TextEncoder().encode(canonicalJson(records)));
}

describe("production Fact authority store", () => {
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
    const conflict = { ...unsigned, contentDigest: canonicalDigest(unsigned), attribution: null };
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
      pendingTransactionIds: [second.transaction.transactionId],
      snapshot: { facts: [], frontier: {} },
      fault: null,
    });

    const local = await store.commit({
      invocationId: "local-while-remote-transaction-is-incomplete",
      request: { command: "local" },
      writes: [body],
      lineage: null,
      publishedFrontier: {},
    });
    expect(store.admission()).toMatchObject({
      kind: "pending",
      snapshot: {
        facts: [{ id: local.receipt.factIds[0] }],
        frontier: { [REPLICA_A]: 1 },
      },
    });
  });

  it("CMD-2 fact batch ledger receipt and frontier commit atomically", async () => {
    const durable = new RecordingDocumentStore();
    const store = await open(durable, REPLICA_A, "101");
    const result = await store.commit({
      invocationId: "invocation",
      request,
      writes: [
        {
          kind: "transaction",
          bodies: [body, { ...body, mutation: { kind: "node-create", nodeId: "node-2" } }],
        },
      ],
      lineage: null,
      publishedFrontier: {},
    });

    expect(result.created).toBe(true);
    expect(result.receipt.factIds).toHaveLength(2);
    expect(result.receipt.committedFrontier).toEqual({ [REPLICA_A]: 2 });
    expect(store.snapshot().facts).toHaveLength(2);
    expect(store.snapshot().facts.map((fact) => fact.transaction)).toEqual([
      { transactionId: `t1/workspace/${REPLICA_A}/1`, index: 0, size: 2 },
      { transactionId: `t1/workspace/${REPLICA_A}/1`, index: 1, size: 2 },
    ]);
    expect(durable.appendCount).toBe(1);
    const reopened = await open(durable, REPLICA_A, "102");
    expect(reopened.snapshot().facts).toHaveLength(2);
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
      replicaId: REPLICA_A,
      loroPeerId: "101",
      authorityJournal: sourceDocuments,
      factReplication: sourceDocuments,
      snapshotInterval: 1,
      admitRecords: admitAuthorityRecordShapes,
    });
    const first = await source.commit({
      invocationId: "compaction-failed",
      request,
      writes: [body],
      lineage: null,
      publishedFrontier: {},
    });
    expect(first.created).toBe(true);
    expect(source.snapshot().facts).toHaveLength(1);
    expect(source.receipt("compaction-failed")).not.toBeNull();

    sourceDocuments.failAuthoritySnapshot = false;
    await source.commit({
      invocationId: "compaction-retry",
      request: { ...request, nodeId: "second" },
      writes: [{ ...body, mutation: { kind: "node-create", nodeId: "second" } }],
      lineage: null,
      publishedFrontier: first.receipt.committedFrontier,
    });
    expect((await sourceDocuments.load(FACT_AUTHORITY_JOURNAL_DOCUMENT_ID))?.updates).toHaveLength(0);
    const destination = await open(new InMemoryDocumentStore(), REPLICA_B, "202");
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
      publishedFrontier: {},
    });
    const retry = await store.commit({
      invocationId: "invocation",
      request: { nodeId: "node", command: "create-node" },
      writes: [body],
      lineage: null,
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
      publishedFrontier: {},
    });
    await expect(
      store.commit({
        invocationId: "second",
        request: { ...request, nodeId: "node-2" },
        writes: [{ ...body, mutation: { kind: "node-create", nodeId: "node-2" } }],
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
      writes: [body],
      lineage: null,
      publishedFrontier: {},
    });
    const restarted = await open(documentsA, REPLICA_A, "101");
    expect(restarted.receipt("invocation")).toEqual(committed.receipt);
    expect(restarted.snapshot()).toEqual(storeA.snapshot());

    const storeB = await open(new InMemoryDocumentStore(), REPLICA_B, "202");
    await storeB.replication.importUpdate(await storeA.replication.exportUpdate());
    expect(storeB.snapshot()).toEqual(storeA.snapshot());
    expect(storeB.receipt("invocation")).toBeNull();
  });

  it("direct sync import preserves locally committed Facts without an earlier export", async () => {
    const local = await open(new InMemoryDocumentStore(), REPLICA_A, "101");
    await local.commit({
      invocationId: "local",
      request: { side: "local" },
      writes: [body],
      lineage: null,
      publishedFrontier: {},
    });
    const remote = await open(new InMemoryDocumentStore(), REPLICA_B, "202");
    await remote.commit({
      invocationId: "remote",
      request: { side: "remote" },
      writes: [{ ...body, mutation: { kind: "node-create", nodeId: "remote" } }],
      lineage: null,
      publishedFrontier: {},
    });

    await local.replication.importUpdate(await remote.replication.exportUpdate());

    expect(local.snapshot().facts).toHaveLength(2);
    expect(local.admission().kind).toBe("ready");
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
      writes: [body],
      lineage: null,
      publishedFrontier: {},
    });
    const right = await second.commit({
      invocationId: "right",
      request: { side: "right" },
      writes: [{ ...body, mutation: { kind: "node-create", nodeId: "right" } }],
      lineage: null,
      publishedFrontier: {},
    });
    expect(left.receipt.committedFrontier).toEqual({ [REPLICA_A]: 1 });
    expect(right.receipt.committedFrontier).toEqual({ [REPLICA_B]: 1 });
  });

  it("DUR-3 retained facts survive snapshots and long offline merge", async () => {
    const documents = new InMemoryDocumentStore();
    const store = await FactAuthority.open({
      workspaceId: "workspace",
      replicaId: REPLICA_A,
      loroPeerId: "101",
      authorityJournal: documents,
      factReplication: documents,
      snapshotInterval: 16,
      admitRecords: admitAuthorityRecordShapes,
    });
    for (let index = 0; index < 40; index += 1) {
      await store.commit({
        invocationId: `offline-${index}`,
        request: { index },
        writes: [{ ...body, mutation: { kind: "node-create", nodeId: `offline-${index}` } }],
        lineage: null,
        publishedFrontier: store.snapshot().frontier,
      });
    }
    const restarted = await open(documents);
    const remote = await open(new InMemoryDocumentStore(), REPLICA_B, "202");
    await remote.replication.importUpdate(await restarted.replication.exportUpdate());
    expect(restarted.snapshot().facts).toHaveLength(40);
    expect(remote.snapshot()).toEqual(restarted.snapshot());
  });

  it("production compaction bounds the external update replay chain without deleting Facts", async () => {
    const documents = new InMemoryDocumentStore();
    const store = await FactAuthority.open({
      workspaceId: "workspace",
      replicaId: REPLICA_A,
      loroPeerId: "101",
      authorityJournal: documents,
      factReplication: documents,
      snapshotInterval: 4,
      admitRecords: admitAuthorityRecordShapes,
    });
    for (let index = 0; index < 9; index += 1) {
      await store.commit({
        invocationId: `compact-${index}`,
        request: { index },
        writes: [{ ...body, mutation: { kind: "node-create", nodeId: `compact-${index}` } }],
        lineage: null,
        publishedFrontier: store.snapshot().frontier,
      });
    }

    expect((await documents.load(FACT_AUTHORITY_JOURNAL_DOCUMENT_ID))?.updates).toHaveLength(1);
    const restarted = await open(documents);
    expect(restarted.snapshot().facts).toHaveLength(9);
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
    const store = await open(documents, REPLICA_A, "101");
    expect(store.admission()).toMatchObject({ kind: "pending", snapshot: { frontier: {} } });
    expect(store.receipt("receipt-only-gap")).not.toBeNull();

    const remote = new LoroDoc();
    remote.setPeerId("202");
    remote
      .getMap<string>("facts")
      .set(`${first.id}/${first.contentDigest}`, canonicalJson({ recordKind: "fact", fact: first }));
    remote.commit({ message: "fill-admission-gap" });
    await store.replication.importUpdate(remote.export({ mode: "update" }));

    expect(store.admission()).toMatchObject({
      kind: "ready",
      snapshot: { frontier: { [REPLICA_B]: 2 } },
    });
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
    const unsigned = { ...unsignedFact(valid), schemaVersion: valid.schemaVersion + 1 };
    const unsupported = {
      ...unsigned,
      contentDigest: canonicalDigest(unsigned),
      attribution: null,
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

class FailingAuthoritySnapshotStore extends InMemoryDocumentStore {
  failAuthoritySnapshot = true;

  override writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
    if (id === FACT_AUTHORITY_JOURNAL_DOCUMENT_ID && this.failAuthoritySnapshot) {
      return Promise.reject(new Error("injected authority snapshot failure"));
    }
    return super.writeSnapshot(id, bytes);
  }
}
