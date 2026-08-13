import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import {
  frontierOf,
  admitAuthorityRecordShapes,
  makeFact,
  type Fact,
  type FactBody,
  type FactSnapshot,
} from "../src/domain/fact/index.js";
import { advanceGeneration, rebuildGeneration } from "../src/domain/reconcile/index.js";
import {
  createGenerationCheckpoint,
  reconcileFromCheckpoint,
} from "../src/runtime/workspace/generation-checkpoint.js";
import { InMemoryDocumentStore } from "../src/persistence/in-memory-document-store.js";
import type { DocumentStore, LoadedDocumentBytes } from "../src/persistence/document-store.js";
import { FactAuthorityStore } from "../src/runtime/authority/fact-authority-store.js";
import { BoundedProjectionMaterializer } from "../src/runtime/workspace/bounded-materializer.js";
import { queryReview } from "../src/domain/review/review.js";
import { ProposalWorkspace } from "../src/runtime/workspace/proposal-workspace.js";

const CHECKPOINT_KEY = "performance-checkpoint-key";

const REPLICA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const versions = { rulesVersion: "proposal-rules-3", schemaVersion: "lode-schema-16" } as const;
const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
const limits = {
  fullRebuildMilliseconds: 2_000,
  directTailMilliseconds: 250,
  checkpointTailMilliseconds: 250,
  checkpointBytes: 3_000_000,
  materializedUnits: 64,
  heapGrowthBytes: 64 * 1024 * 1024,
  resolutionMilliseconds: 2_000,
  syncTailBytes: 32_000,
  authorityCommandsMilliseconds: 2_000,
  reviewQueryMilliseconds: 500,
  restartMilliseconds: 2_000,
} as const;

describe("Proposal Mode deterministic performance and retention gates", () => {
  it("bounds startup rebuild checkpoint-tail work actual owner invalidation heap and materialized retention", async () => {
    const facts = textWorkload(600);
    const before = snapshot(facts);
    const heapBefore = process.memoryUsage().heapUsed;
    const rebuildStart = performance.now();
    const generation = rebuildGeneration("workspace", before, versions).generation;
    const rebuildMilliseconds = performance.now() - rebuildStart;
    const checkpoint = createGenerationCheckpoint("workspace", before, generation, CHECKPOINT_KEY);
    const checkpointBytes = new TextEncoder().encode(JSON.stringify(checkpoint)).length;

    const after = snapshot([
      ...facts,
      nextFact(facts, {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          deletedAtoms: [],
          anchor: end,
          insert: "x",
        },
      }),
    ]);
    const tailStart = performance.now();
    const evaluated: string[] = [];
    const incremental = advanceGeneration("workspace", before, after, versions, generation, {
      stageObserver: (stage, view) => evaluated.push(`${view}/${stage}`),
    });
    const tailMilliseconds = performance.now() - tailStart;
    const checkpointStages: string[] = [];
    const checkpointTailStart = performance.now();
    const checkpointTail = reconcileFromCheckpoint(
      checkpoint,
      "workspace",
      after,
      versions,
      CHECKPOINT_KEY,
      { stageObserver: (stage, view) => checkpointStages.push(`${view}/${stage}`) },
    );
    const checkpointTailMilliseconds = performance.now() - checkpointTailStart;
    const materializer = new BoundedProjectionMaterializer(new InMemoryDocumentStore(), {
      capacity: limits.materializedUnits,
    });
    const retentionFacts: Fact[] = [];
    for (let index = 0; index < 1_000; index += 1) {
      retentionFacts.push(nextFact(retentionFacts, nodeBody(`retained-${index}`)));
    }
    const retainedGeneration = rebuildGeneration(
      "workspace",
      snapshot(retentionFacts),
      versions,
    ).generation;
    await materializer.publish(retainedGeneration);
    const projectionPage = await materializer.page(retainedGeneration.identity.generationId, {
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
      section: "nodes",
      after: null,
      limit: 32,
    });
    const heapGrowth = process.memoryUsage().heapUsed - heapBefore;

    expect(rebuildMilliseconds).toBeLessThan(limits.fullRebuildMilliseconds);
    expect(tailMilliseconds).toBeLessThan(limits.directTailMilliseconds);
    expect(checkpointTailMilliseconds).toBeLessThan(limits.checkpointTailMilliseconds);
    expect(checkpointTail?.generation).toEqual(incremental.generation);
    expect(incremental.stats.evaluatedStages).toEqual(["activation", "text", "assembly"]);
    expect(evaluated).toEqual([
      "origin/activation",
      "origin/text",
      "origin/assembly",
      "review/activation",
      "review/text",
      "review/assembly",
    ]);
    expect(checkpointStages).toEqual(evaluated);
    expect(checkpointBytes).toBeLessThan(limits.checkpointBytes);
    expect(materializer.retainedUnits()).toBe(limits.materializedUnits);
    expect(projectionPage.identity).toEqual(retainedGeneration.identity);
    expect(projectionPage.entries).toHaveLength(32);
    expect(materializer.largestPageUnits()).toBe(32);
    expect(heapGrowth).toBeLessThan(limits.heapGrowthBytes);
  });

  it("bounds Resolution replay across many independently terminal Proposal owners", () => {
    const facts: Fact[] = [];
    facts.push(nextFact(facts, nodeBody("workspace", "direct")));
    for (let index = 0; index < 200; index += 1) {
      const proposal = nextFact(facts, nodeBody(`proposal-${index}`, "proposal"));
      facts.push(proposal);
      facts.push(
        nextFact(facts, {
          kind: "resolution",
          adjudicatesResolutionIds: [],
          actorId: "reviewer",
          decision: index % 2 === 0 ? "accept" : "reject",
          proposalContributionIds: [proposal.id],
        }),
      );
    }
    const started = performance.now();
    const result = rebuildGeneration("workspace", snapshot(facts), versions);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(limits.resolutionMilliseconds);
    expect(result.stats.supportPasses).toBeLessThanOrEqual(facts.length + 1);
    expect(Object.keys(result.generation.origin.nodes)).toHaveLength(101);
  });

  it("bounds support convergence and Loro incremental sync tail bytes", async () => {
    const facts = textWorkload(300, "proposal");
    const result = rebuildGeneration("workspace", snapshot(facts), versions);
    expect(result.stats.supportPasses).toBeLessThanOrEqual(facts.length + 1);

    const documents = new InMemoryDocumentStore();
    const store = await FactAuthorityStore.open({
      workspaceId: "workspace",
      replicaId: REPLICA,
      loroPeerId: "901",
      documents,
      admitRecords: admitAuthorityRecordShapes,
    });
    await store.commit({
      invocationId: "first",
      request: { kind: "first" },
      writes: [nodeBody("first")],
      lineage: null,
      publishedFrontier: {},
    });
    const remoteVersion = await store.replication.version();
    await store.commit({
      invocationId: "tail",
      request: { kind: "tail" },
      writes: [nodeBody("tail")],
      lineage: null,
      publishedFrontier: store.snapshot().frontier,
    });
    const tailBytes = await store.replication.exportUpdate(remoteVersion);
    const snapshotBytes = await store.replication.exportSnapshot();
    expect(tailBytes.length).toBeGreaterThan(0);
    expect(tailBytes.length).toBeLessThan(snapshotBytes.length);
    expect(tailBytes.length).toBeLessThan(limits.syncTailBytes);
  });

  it("bounds the production authority ledger across many invocations", async () => {
    const store = await FactAuthorityStore.open({
      workspaceId: "workspace",
      replicaId: REPLICA,
      loroPeerId: "902",
      documents: new InMemoryDocumentStore(),
      admitRecords: admitAuthorityRecordShapes,
    });
    const started = performance.now();
    for (let index = 0; index < 100; index += 1) {
      await store.commit({
        invocationId: `command-${index}`,
        request: { index },
        writes: [nodeBody(`command-${index}`)],
        lineage: null,
        publishedFrontier: store.snapshot().frontier,
      });
    }
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(limits.authorityCommandsMilliseconds);
    expect(store.receipts()).toHaveLength(100);
  });

  it("bounds representative text authority commands without replaying every prefix", async () => {
    const store = await FactAuthorityStore.open({
      workspaceId: "workspace",
      replicaId: REPLICA,
      loroPeerId: "903",
      documents: new InMemoryDocumentStore(),
      admitRecords: admitAuthorityRecordShapes,
      snapshotInterval: 1_000,
    });
    let committed = await store.commit({
      invocationId: "text-node",
      request: { kind: "text-node" },
      writes: [nodeBody("text-node")],
      lineage: null,
      publishedFrontier: {},
    });
    let lastAtomId: string | null = null;
    const started = performance.now();
    for (let index = 0; index < 200; index += 1) {
      committed = await store.commit({
        invocationId: `text-${index}`,
        request: { kind: "text", index },
        writes: [
          {
            kind: "contribution",
            actorId: "actor",
            intent: "direct",
            mutation: {
              kind: "text-splice",
              nodeId: "text-node",
              deleteAtomIds: [],
              deletedAtoms: [],
              anchor: { after: lastAtomId, before: null, affinity: "after", fallback: "end" },
              insert: "x",
            },
          },
        ],
        lineage: null,
        publishedFrontier: committed.receipt.committedFrontier,
      });
      lastAtomId = `${committed.receipt.factIds[0]}#0`;
    }
    expect(performance.now() - started).toBeLessThan(limits.authorityCommandsMilliseconds);
    expect(store.snapshot().facts).toHaveLength(201);
  });

  it("bounds durable workspace restart and first bounded read", async () => {
    const documents = new InMemoryDocumentStore();
    const replicaId = REPLICA;
    const initial = await FactAuthorityStore.open({
      workspaceId: "workspace",
      replicaId,
      loroPeerId: "904",
      documents,
      admitRecords: admitAuthorityRecordShapes,
    });
    await initial.commit({
      invocationId: "restart-workload",
      request: { kind: "restart-workload" },
      writes: Array.from({ length: 300 }, (_, index) => nodeBody(`restart-${index}`)),
      lineage: null,
      publishedFrontier: {},
    });

    const started = performance.now();
    const restartedFacts = await FactAuthorityStore.open({
      workspaceId: "workspace",
      replicaId,
      loroPeerId: "905",
      documents,
      admitRecords: admitAuthorityRecordShapes,
    });
    const workspace = await ProposalWorkspace.open({
      workspaceId: "workspace",
      facts: restartedFacts,
      versions,
    });
    const page = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
      section: "nodes",
      limit: 25,
    });
    expect(performance.now() - started).toBeLessThan(limits.restartMilliseconds);
    expect("entries" in page && page.entries).toHaveLength(25);
    await workspace.close();
  });

  it("bounds one Review evaluation across many independent Hunks", () => {
    const facts: Fact[] = [];
    for (let index = 0; index < 400; index += 1) {
      facts.push(nextFact(facts, nodeBody(`review-${index}`, "proposal")));
    }
    const current = snapshot(facts);
    const generation = rebuildGeneration("workspace", current, versions).generation;
    const started = performance.now();
    const review = queryReview("workspace", current, generation, "performance-capability-key");
    const elapsed = performance.now() - started;
    expect(review.hunks).toHaveLength(400);
    expect(elapsed).toBeLessThan(limits.reviewQueryMilliseconds);
  });

  it("bounds linked Review Hunks for one shared Node across many positions", () => {
    const facts: Fact[] = [nextFact([], nodeBody("shared"))];
    for (let index = 0; index < 400; index += 1) {
      facts.push(nextFact(facts, nodeBody(`parent-${index}`)));
      facts.push(
        nextFact(facts, {
          kind: "contribution",
          actorId: "actor",
          intent: "direct",
          mutation: {
            kind: "occurrence-create",
            occurrenceId: `shared-${index}`,
            nodeId: "shared",
            parentNodeId: `parent-${index}`,
            anchor: end,
          },
        }),
      );
    }
    facts.push(
      nextFact(facts, {
        kind: "contribution",
        actorId: "actor",
        intent: "proposal",
        mutation: { kind: "node-delete", nodeId: "shared" },
      }),
    );
    const current = snapshot(facts);
    const generation = rebuildGeneration("workspace", current, versions).generation;
    const started = performance.now();
    const review = queryReview("workspace", current, generation, "performance-capability-key");
    const elapsed = performance.now() - started;
    expect(review.hunks).toHaveLength(400);
    expect(review.hunks[0]?.linkedHunkIds).toHaveLength(399);
    expect(elapsed).toBeLessThan(limits.reviewQueryMilliseconds);
  });

  it("keeps indexed authority Review and History work independent of 250 or 1000 unrelated Nodes", async () => {
    const small = await indexedWorkspaceWorkload(250);
    const large = await indexedWorkspaceWorkload(1_000);

    expect(small.authorityAppendUnits).toEqual([3]);
    expect(large.authorityAppendUnits).toEqual([3]);
    expect(large.authorityUpdateBytes).toBeLessThanOrEqual(small.authorityUpdateBytes * 1.5);
    expect(small.reviewIndexedUnits).toBeLessThanOrEqual(7);
    expect(large.reviewIndexedUnits).toBe(small.reviewIndexedUnits);
    expect(small.historyIndexedUnits).toBeLessThanOrEqual(6);
    expect(large.historyIndexedUnits).toBe(small.historyIndexedUnits);
    expect(large.reviewReadBytes).toBeLessThanOrEqual(small.reviewReadBytes * 3);
    expect(large.historyReadBytes).toBeLessThanOrEqual(small.historyReadBytes * 3);
    expect(large.largestExactReadUnits).toBeLessThanOrEqual(2);
  }, 30_000);
});

async function indexedWorkspaceWorkload(unrelatedNodeCount: number) {
  const documents = new MeasuredDocumentStore();
  const indexedWork: { operation: string; units: number }[] = [];
  const facts = await FactAuthorityStore.open({
    workspaceId: "workspace",
    replicaId: REPLICA,
    loroPeerId: unrelatedNodeCount === 250 ? "920" : "921",
    documents,
    admitRecords: admitAuthorityRecordShapes,
    snapshotInterval: 10_000,
    onIndexedWork: (work) => indexedWork.push(work),
  });
  await facts.commit({
    invocationId: "unrelated",
    request: { kind: "performance-unrelated", count: unrelatedNodeCount },
    writes: Array.from({ length: unrelatedNodeCount }, (_, index) => ({
      kind: "contribution" as const,
      actorId: "actor",
      intent: "direct" as const,
      mutation: { kind: "node-create" as const, nodeId: `unrelated-${index}` },
    })),
    lineage: null,
    publishedFrontier: facts.snapshot().frontier,
  });
  const generations = new BoundedProjectionMaterializer(documents, { capacity: 1 });
  const workspace = await ProposalWorkspace.open({
    workspaceId: "workspace",
    facts,
    versions,
    generations,
  });
  await workspace.execute({
    kind: "mutate",
    workspaceId: "workspace",
    invocationId: "history-target",
    actorId: "actor",
    intent: "direct",
    historyChannelId: "target-channel",
    mutations: nodeAtWorkspace("history-node"),
  });

  indexedWork.length = 0;
  await workspace.execute({
    kind: "mutate",
    workspaceId: "workspace",
    invocationId: "review-target",
    actorId: "actor",
    intent: "proposal",
    historyChannelId: "proposal-channel",
    mutations: nodeAtWorkspace("review-node"),
  });
  const authorityAppendUnits = indexedWork
    .filter((work) => work.operation === "authority-local-append")
    .map((work) => work.units);
  const authorityUpdateBytes = documents.lastAuthorityUpdateBytes;

  indexedWork.length = 0;
  generations.resetReadMetrics();
  documents.resetReadBytes();
  const review = await workspace.query({
    kind: "review",
    workspaceId: "workspace",
    limit: 1,
  });
  if (!("hunks" in review) || review.hunks.length !== 1) {
    throw new Error("Indexed performance fixture must expose one Review Hunk");
  }
  const reviewIndexedUnits = indexedWork.reduce((total, work) => total + work.units, 0);
  const reviewReadBytes = documents.readBytes;

  indexedWork.length = 0;
  documents.resetReadBytes();
  const history = await workspace.query({
    kind: "history",
    workspaceId: "workspace",
    channelId: "target-channel",
  });
  if (!("undo" in history) || history.undo?.targetInvocationId !== "history-target") {
    throw new Error("Indexed performance fixture must expose the target History step");
  }
  const historyIndexedUnits = indexedWork.reduce((total, work) => total + work.units, 0);
  const historyReadBytes = documents.readBytes;
  await workspace.close();
  return {
    authorityAppendUnits,
    authorityUpdateBytes,
    reviewIndexedUnits,
    reviewReadBytes,
    historyIndexedUnits,
    historyReadBytes,
    largestExactReadUnits: generations.largestExactReadUnits(),
  };
}

function nodeAtWorkspace(nodeId: string) {
  return [
    {
      kind: "node-create" as const,
      occurrenceId: `${nodeId}-original`,
      nodeId,
      parentNodeId: "workspace",
      anchor: end,
    },
  ];
}

class MeasuredDocumentStore implements DocumentStore {
  private readonly inner = new InMemoryDocumentStore();
  readBytes = 0;
  lastAuthorityUpdateBytes = 0;

  async load(id: string): Promise<LoadedDocumentBytes | null> {
    const loaded = await this.inner.load(id);
    this.readBytes +=
      (loaded?.snapshot?.length ?? 0) +
      (loaded?.updates.reduce((total, update) => total + update.length, 0) ?? 0);
    return loaded;
  }

  listIds(query?: Parameters<DocumentStore["listIds"]>[0]): Promise<string[]> {
    return this.inner.listIds(query);
  }

  appendUpdate(id: string, bytes: Uint8Array): Promise<number> {
    if (id === "facts") {
      this.lastAuthorityUpdateBytes = bytes.length;
    }
    return this.inner.appendUpdate(id, bytes);
  }

  writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
    return this.inner.writeSnapshot(id, bytes);
  }

  delete(id: string): Promise<void> {
    return this.inner.delete(id);
  }

  resetReadBytes(): void {
    this.readBytes = 0;
  }
}

function textWorkload(count: number, intent: "direct" | "proposal" = "direct"): Fact[] {
  const facts: Fact[] = [];
  facts.push(nextFact(facts, nodeBody("node", intent)));
  facts.push(
    nextFact(facts, {
      kind: "contribution",
      actorId: "actor",
      intent,
      mutation: {
        kind: "occurrence-create",
        occurrenceId: "occurrence",
        nodeId: "node",
        parentNodeId: "workspace",
        anchor: end,
      },
    }),
  );
  for (let index = 0; index < count; index += 1) {
    facts.push(
      nextFact(facts, {
        kind: "contribution",
        actorId: "actor",
        intent,
        mutation: {
          kind: "text-splice",
          nodeId: "node",
          deleteAtomIds: [],
          deletedAtoms: [],
          anchor: end,
          insert: "x",
        },
      }),
    );
  }
  return facts;
}

function nextFact(facts: readonly Fact[], body: FactBody): Fact {
  const sequence = facts.length + 1;
  return makeFact({
    workspaceId: "workspace",
    replicaId: REPLICA,
    sequence,
    observed: sequence === 1 ? {} : { [REPLICA]: sequence - 1 },
    lamport: sequence,
    body,
  });
}

function nodeBody(nodeId: string, intent: "direct" | "proposal" = "direct"): FactBody {
  return {
    kind: "contribution",
    actorId: "actor",
    intent,
    mutation: { kind: "node-create", nodeId },
  };
}

function snapshot(facts: readonly Fact[]): FactSnapshot {
  return { facts, frontier: frontierOf(facts) };
}
