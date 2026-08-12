import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";
import { admitAuthorityRecords } from "../src/domain/admission/index.js";

import {
  frontierOf,
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
import { LoroFactStore } from "../src/runtime/authority/loro-fact-store.js";
import { BoundedProjectionMaterializer } from "../src/runtime/workspace/bounded-materializer.js";
import { queryReview } from "../src/domain/review/review.js";

const CHECKPOINT_KEY = "performance-checkpoint-key";

const REPLICA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const versions = { rulesVersion: "proposal-rules-1", schemaVersion: "proposal-schema-1" } as const;
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
      ownerObserver: (owner, view) => evaluated.push(`${view}/${owner}`),
    });
    const tailMilliseconds = performance.now() - tailStart;
    const checkpointOwners: string[] = [];
    const checkpointTailStart = performance.now();
    const checkpointTail = reconcileFromCheckpoint(
      checkpoint,
      "workspace",
      after,
      versions,
      CHECKPOINT_KEY,
      { ownerObserver: (owner, view) => checkpointOwners.push(`${view}/${owner}`) },
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
    expect(incremental.stats.evaluatedOwners).toEqual(["activation", "text", "assembly"]);
    expect(evaluated).toEqual([
      "origin/activation",
      "origin/text",
      "origin/assembly",
      "review/activation",
      "review/text",
      "review/assembly",
    ]);
    expect(checkpointOwners).toEqual(evaluated);
    expect(checkpointBytes).toBeLessThan(limits.checkpointBytes);
    expect(materializer.retainedUnits()).toBe(limits.materializedUnits);
    expect(projectionPage.identity).toEqual(retainedGeneration.identity);
    expect(projectionPage.entries).toHaveLength(32);
    expect(materializer.largestPageUnits()).toBe(32);
    expect(heapGrowth).toBeLessThan(limits.heapGrowthBytes);
  });

  it("bounds Resolution replay across many independently terminal Proposal owners", () => {
    const facts: Fact[] = [];
    for (let index = 0; index < 200; index += 1) {
      const proposal = nextFact(facts, nodeBody(`proposal-${index}`, "proposal"));
      facts.push(proposal);
      facts.push(
        nextFact(facts, {
          kind: "resolution",
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
    expect(Object.keys(result.generation.origin.nodes)).toHaveLength(100);
  });

  it("bounds support convergence and Loro incremental sync tail bytes", async () => {
    const facts = textWorkload(300, "proposal");
    const result = rebuildGeneration("workspace", snapshot(facts), versions);
    expect(result.stats.supportPasses).toBeLessThanOrEqual(facts.length + 1);

    const documents = new InMemoryDocumentStore();
    const store = await LoroFactStore.open({
      workspaceId: "workspace",
      replicaId: REPLICA,
      loroPeerId: "901",
      documents,
      admitRecords: admitAuthorityRecords,
    });
    await store.commit({
      invocationId: "first",
      request: { kind: "first" },
      bodies: [nodeBody("first")],
      lineage: null,
      publishedFrontier: {},
    });
    const remoteVersion = await store.syncDoc.version();
    await store.commit({
      invocationId: "tail",
      request: { kind: "tail" },
      bodies: [nodeBody("tail")],
      lineage: null,
      publishedFrontier: store.snapshot().frontier,
    });
    const tailBytes = await store.syncDoc.exportUpdate(remoteVersion);
    const snapshotBytes = await store.syncDoc.exportSnapshot();
    expect(tailBytes.length).toBeGreaterThan(0);
    expect(tailBytes.length).toBeLessThan(snapshotBytes.length);
    expect(tailBytes.length).toBeLessThan(limits.syncTailBytes);
  });

  it("bounds the production authority ledger across many invocations", async () => {
    const store = await LoroFactStore.open({
      workspaceId: "workspace",
      replicaId: REPLICA,
      loroPeerId: "902",
      documents: new InMemoryDocumentStore(),
      admitRecords: admitAuthorityRecords,
    });
    const started = performance.now();
    for (let index = 0; index < 100; index += 1) {
      await store.commit({
        invocationId: `command-${index}`,
        request: { index },
        bodies: [nodeBody(`command-${index}`)],
        lineage: null,
        publishedFrontier: store.snapshot().frontier,
      });
    }
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(limits.authorityCommandsMilliseconds);
    expect(store.receipts()).toHaveLength(100);
  });

  it("bounds representative text authority commands without replaying every prefix", async () => {
    const store = await LoroFactStore.open({
      workspaceId: "workspace",
      replicaId: REPLICA,
      loroPeerId: "903",
      documents: new InMemoryDocumentStore(),
      admitRecords: admitAuthorityRecords,
      snapshotInterval: 1_000,
    });
    let committed = await store.commit({
      invocationId: "text-node",
      request: { kind: "text-node" },
      bodies: [nodeBody("text-node")],
      lineage: null,
      publishedFrontier: {},
    });
    let lastAtomId: string | null = null;
    const started = performance.now();
    for (let index = 0; index < 200; index += 1) {
      committed = await store.commit({
        invocationId: `text-${index}`,
        request: { kind: "text", index },
        bodies: [
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
      facts.push(
        nextFact(facts, {
          kind: "contribution",
          actorId: "actor",
          intent: "direct",
          mutation: {
            kind: "occurrence-create",
            occurrenceId: `shared-${index}`,
            nodeId: "shared",
            parentOccurrenceId: null,
            parentPolicy: "cascade",
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
});

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
        parentOccurrenceId: null,
        parentPolicy: "cascade",
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
