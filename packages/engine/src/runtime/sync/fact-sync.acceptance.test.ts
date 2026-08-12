import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";

import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import { rebuildGeneration } from "../../domain/reconcile/index.js";
import { queryReview } from "../../domain/review/index.js";
import { createReplicaId, LoroFactStore } from "../authority/loro-fact-store.js";
import { FactSyncComposite } from "./fact-sync.js";
import { InMemorySyncTransport, SyncExchange, syncPair } from "./sync-exchange.js";

const versions = { rulesVersion: "proposal-rules-1", schemaVersion: "lode-schema-12" } as const;

async function replica(peerId: `${number}`, replicaId = createReplicaId()) {
  return LoroFactStore.open({
    workspaceId: "workspace",
    replicaId,
    loroPeerId: peerId,
    documents: new InMemoryDocumentStore(),
    admitRecords: admitAuthorityRecords,
  });
}

describe("Fact-only production sync", () => {
  it("SYNC-1 only the authority FactStore enters domain sync", async () => {
    const store = await replica("101");
    const composite = new FactSyncComposite(store);
    expect(composite.docs().map((doc) => doc.id)).toEqual(["facts"]);
    expect(composite).not.toHaveProperty("projection");
    expect(composite).not.toHaveProperty("checkpoint");
  });

  it("conflicting content for one FactId fails closed during sync import", async () => {
    const replicaId = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const left = await replica("101", replicaId);
    const right = await replica("202", replicaId);
    await left.commit({
      invocationId: "common",
      request: { command: "common" },
      bodies: [
        {
          kind: "contribution",
          actorId: "actor",
          intent: "direct",
          mutation: { kind: "node-create", nodeId: "common" },
        },
      ],
      lineage: null,
      publishedFrontier: {},
    });
    await right.syncDoc.importUpdate(await left.syncDoc.exportSnapshot());
    await left.commit({
      invocationId: "left",
      request: { command: "left" },
      bodies: [
        {
          kind: "contribution",
          actorId: "actor",
          intent: "direct",
          mutation: { kind: "node-create", nodeId: "left" },
        },
      ],
      lineage: null,
      publishedFrontier: left.snapshot().frontier,
    });
    await right.commit({
      invocationId: "right",
      request: { command: "right" },
      bodies: [
        {
          kind: "contribution",
          actorId: "actor",
          intent: "direct",
          mutation: { kind: "node-create", nodeId: "right" },
        },
      ],
      lineage: null,
      publishedFrontier: right.snapshot().frontier,
    });
    const update = await left.syncDoc.exportUpdate(await right.syncDoc.version());

    await expect(right.syncDoc.importUpdate(update)).rejects.toThrow(/content conflict/i);
    const faulted = right.admission();
    expect(faulted.kind).toBe("fault");
    expect(faulted.snapshot.facts).toHaveLength(2);
    await right.recoverToLastValidPrefix();
    expect(right.admission().kind).toBe("ready");
  });

  it("History receipt lineage remains local while compensating Facts enter sync", async () => {
    const store = await replica("101");
    await store.commit({
      invocationId: "local-history",
      request: { command: "create" },
      bodies: [
        {
          kind: "contribution",
          actorId: "actor",
          intent: "direct",
          mutation: { kind: "node-create", nodeId: "node" },
        },
      ],
      lineage: {
        channelId: "private-desktop-channel",
        ordinal: 1,
        parentStepId: null,
        operation: "normal",
        targetStepId: null,
      },
      publishedFrontier: {},
    });
    const received = new LoroDoc();
    received.import(await store.syncDoc.exportSnapshot());
    const records = received
      .getMap("facts")
      .values()
      .map((value) => JSON.parse(String(value)) as { recordKind: string; receipt?: unknown });
    expect(records).toHaveLength(1);
    expect(records.every((record) => record.recordKind === "fact")).toBe(true);
    expect(JSON.stringify(records)).not.toContain("private-desktop-channel");
    expect(records.every((record) => record.receipt === undefined)).toBe(true);
  });

  it("SYNC-2 shuffled duplicate offline merges converge", async () => {
    const directedEdges = [
      [0, 1],
      [1, 0],
      [0, 2],
      [2, 0],
      [1, 2],
      [2, 1],
    ] as const;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) => runTopology(shuffle(directedEdges, index + 1))),
    );
    for (const result of results.slice(1)) {
      expect(result).toEqual(results[0]);
    }
  });

  it("keeps concurrent opposite Resolutions out of Origin and visible in Review", async () => {
    const result = await runTopology([
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 0],
    ]);
    expect(result.factIds).toHaveLength(5);
    expect(result.originNodeIds).toEqual(["direct-b", "direct-c"]);
    expect(result.reviewNodeIds).toEqual(["direct-b", "direct-c", "proposal"]);
    expect(result.reviewHunkCount).toBe(1);
  });

  it("Sync push 与 anti-entropy", async () => {
    const a = await replica("101");
    const b = await replica("202");
    await a.commit({
      invocationId: "a",
      request: { command: "create" },
      bodies: [
        {
          kind: "contribution",
          actorId: "a",
          intent: "direct",
          mutation: { kind: "node-create", nodeId: "node" },
        },
      ],
      lineage: null,
      publishedFrontier: {},
    });
    const remote = new FactSyncComposite(b);
    const transport = new CountingSyncTransport(new InMemorySyncTransport(remote));
    const exchange = new SyncExchange(new FactSyncComposite(a), transport);
    await exchange.sync();
    await a.commit({
      invocationId: "tail",
      request: { command: "tail" },
      bodies: [
        {
          kind: "contribution",
          actorId: "a",
          intent: "direct",
          mutation: { kind: "node-create", nodeId: "tail" },
        },
      ],
      lineage: null,
      publishedFrontier: a.snapshot().frontier,
    });
    expect(await exchange.pushOnly()).toEqual({ pushed: 1 });
    const bytesAfterTail = transport.sentBytes;
    expect(await exchange.pushOnly()).toEqual({ pushed: 0 });
    expect(transport.sentBytes).toBe(bytesAfterTail);
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it("restart preserves Fact-sync CRDT history and sends only a new tail", async () => {
    const documents = new InMemoryDocumentStore();
    const replicaId = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const open = () =>
      LoroFactStore.open({
        workspaceId: "workspace",
        replicaId,
        loroPeerId: "404" as const,
        documents,
        admitRecords: admitAuthorityRecords,
      });
    let local = await open();
    const remote = await replica("505", "bbbbbbbbbbbbbbbbbbbbbbbbbb");
    for (let index = 0; index < 80; index += 1) {
      await local.commit({
        invocationId: `restart-${index}`,
        request: { index },
        bodies: [
          {
            kind: "contribution",
            actorId: "actor",
            intent: "direct",
            mutation: { kind: "node-create", nodeId: `restart-${index}` },
          },
        ],
        lineage: null,
        publishedFrontier: local.snapshot().frontier,
      });
    }
    await syncPair(new FactSyncComposite(local), new FactSyncComposite(remote));
    local = await open();
    const transport = new CountingSyncTransport(
      new InMemorySyncTransport(new FactSyncComposite(remote)),
    );
    const exchange = new SyncExchange(new FactSyncComposite(local), transport);
    expect(await exchange.sync()).toEqual({ pulled: 0, pushed: 0 });
    expect(transport.sentBytes).toBe(0);
    await local.commit({
      invocationId: "restart-tail",
      request: { tail: true },
      bodies: [
        {
          kind: "contribution",
          actorId: "actor",
          intent: "direct",
          mutation: { kind: "node-create", nodeId: "restart-tail" },
        },
      ],
      lineage: null,
      publishedFrontier: local.snapshot().frontier,
    });
    expect(await exchange.pushOnly()).toEqual({ pushed: 1 });
    expect(transport.sentBytes).toBeGreaterThan(0);
    expect(transport.sentBytes).toBeLessThan(32_000);
  });
});

async function runTopology(edges: readonly (readonly [number, number])[]) {
  const stores = await Promise.all([
    replica("101", "aaaaaaaaaaaaaaaaaaaaaaaaaa"),
    replica("202", "bbbbbbbbbbbbbbbbbbbbbbbbbb"),
    replica("303", "cccccccccccccccccccccccccc"),
  ]);
  const composites = stores.map((store) => new FactSyncComposite(store));
  const proposal = await required(stores[0], "first store").commit({
    invocationId: "proposal",
    request: { command: "proposal" },
    bodies: [
      {
        kind: "contribution",
        actorId: "a",
        intent: "proposal",
        mutation: { kind: "node-create", nodeId: "proposal" },
      },
    ],
    lineage: null,
    publishedFrontier: {},
  });
  await syncPair(
    required(composites[0], "first composite"),
    required(composites[1], "second composite"),
  );
  await syncPair(
    required(composites[0], "first composite"),
    required(composites[2], "third composite"),
  );
  await required(stores[1], "second store").commit({
    invocationId: "b",
    request: { command: "b" },
    bodies: [
      {
        kind: "contribution",
        actorId: "b",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "direct-b" },
      },
      {
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "b",
        decision: "accept",
        proposalContributionIds: proposal.receipt.factIds,
      },
    ],
    lineage: null,
    publishedFrontier: required(stores[1], "second store").snapshot().frontier,
  });
  await required(stores[2], "third store").commit({
    invocationId: "c",
    request: { command: "c" },
    bodies: [
      {
        kind: "contribution",
        actorId: "c",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "direct-c" },
      },
      {
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "c",
        decision: "reject",
        proposalContributionIds: proposal.receipt.factIds,
      },
    ],
    lineage: null,
    publishedFrontier: required(stores[2], "third store").snapshot().frontier,
  });
  for (const [left, right] of edges) {
    await syncPair(
      required(composites[left], `composite ${left}`),
      required(composites[right], `composite ${right}`),
    );
  }
  await syncPair(
    required(composites[0], "first composite"),
    required(composites[1], "second composite"),
  );
  await syncPair(
    required(composites[1], "second composite"),
    required(composites[2], "third composite"),
  );
  await syncPair(
    required(composites[0], "first composite"),
    required(composites[2], "third composite"),
  );

  const snapshots = stores.map((store) => store.snapshot());
  expect(snapshots[1]).toEqual(snapshots[0]);
  expect(snapshots[2]).toEqual(snapshots[0]);
  const firstSnapshot = required(snapshots[0], "first snapshot");
  const generation = rebuildGeneration("workspace", firstSnapshot, versions).generation;
  return {
    factIds: firstSnapshot.facts.map((fact) => fact.id).sort(),
    originNodeIds: Object.keys(generation.origin.nodes).sort(),
    reviewNodeIds: Object.keys(generation.review.nodes).sort(),
    reviewHunkCount: queryReview("workspace", firstSnapshot, generation).hunks.length,
  };
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

class CountingSyncTransport {
  sentBytes = 0;

  constructor(private readonly inner: InMemorySyncTransport) {}

  profile() {
    return this.inner.profile();
  }
  fetch(documentId: string, from: Uint8Array) {
    return this.inner.fetch(documentId, from);
  }
  async send(documentId: string, bytes: Uint8Array): Promise<void> {
    this.sentBytes += bytes.length;
    await this.inner.send(documentId, bytes);
  }
}

function shuffle<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const target = state % (index + 1);
    [result[index], result[target]] = [
      required(result[target], "shuffle target"),
      required(result[index], "shuffle source"),
    ];
  }
  return result;
}
