import { describe, expect, it } from "vitest";

import { rebuildGeneration } from "../../domain/reconcile/index.js";
import { end, Facts, versions } from "../../../tests/support/reconcile/reconcile-test-helpers.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { BoundedProjectionMaterializer } from "./bounded-materializer.js";
import { directoryPrefix } from "./materialized-generation-format.js";
import { projectionMaterializedDataset } from "./projection-materialized-dataset.js";
import { readMutationGeneration } from "../workspace/generation-reading/index.js";

const emptyReviewReadModel = { scopes: {}, supportByContribution: {} } as const;

describe("bounded derived materialization", () => {
  it("serves Projection section pages without assembling every shard", async () => {
    const documents = new InMemoryDocumentStore();
    const materializer = new BoundedProjectionMaterializer(documents, { capacity: 8 });
    const facts = new Facts();
    for (let index = 0; index < 250; index += 1) {
      facts.add({ kind: "node-create", nodeId: `node-${String(index).padStart(3, "0")}` });
    }
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;
    await materializer.publish(generation, emptyReviewReadModel);
    const first = await materializer.page(generation.identity.generationId, "origin", "nodes", null, 25);
    expect(first.next).not.toBeNull();
    expect(first.entries).toHaveLength(25);
    await expect(materializer.page(generation.identity.generationId, "origin", "nodes", null, 0)).rejects.toThrow(
      "Materialized page limit must be a positive safe integer",
    );
  });

  it("publishes Review indexes beside, but outside, the semantic Projection", async () => {
    const materializer = new BoundedProjectionMaterializer(new InMemoryDocumentStore());
    const facts = new Facts();
    facts.add({ kind: "node-create", nodeId: "node" });
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;
    await materializer.publish(generation, {
      scopes: { "scope-a": ["proposal-a"], "scope-b": ["proposal-b"] },
      supportByContribution: { "proposal-a": ["support-a"] },
    });

    expect(await materializer.load(generation.identity.generationId)).toEqual(generation);
    expect(await materializer.reviewScopes(generation.identity.generationId, null, 1)).toMatchObject({
      scopes: [{ identity: "scope-a", contributionIds: ["proposal-a"] }],
      next: "scope-a",
    });
    expect(await materializer.reviewSupport(generation.identity.generationId, ["proposal-a"])).toMatchObject({
      entries: [{ identity: "proposal-a", supportIds: ["support-a"] }],
    });
  });

  it("pages Supertag Search from its membership index without reading the whole result", async () => {
    const materializer = new BoundedProjectionMaterializer(new InMemoryDocumentStore(), {
      capacity: 8,
    });
    const facts = new Facts();
    for (const supertagId of ["anime", "book"]) {
      facts.addPlaced(supertagId);
      facts.add({ kind: "intrinsic-node-type-declare", nodeId: supertagId, intrinsicNodeType: "supertag-definition" });
    }
    for (let index = 0; index < 250; index += 1) {
      const nodeId = `anime-${String(index).padStart(3, "0")}`;
      facts.addPlaced(nodeId);
      facts.applySupertag(nodeId, "anime");
    }
    for (let index = 0; index < 50; index += 1) {
      const nodeId = `book-${String(index).padStart(3, "0")}`;
      facts.addPlaced(nodeId);
      facts.applySupertag(nodeId, "book");
    }
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;
    await materializer.publish(generation, emptyReviewReadModel);

    const nodeIds: string[] = [];
    let after: string | null = null;
    do {
      const page = await materializer.supertagInstances(generation.identity.generationId, "origin", "anime", after, 25);
      nodeIds.push(...page.nodeIds);
      after = page.next;
    } while (after !== null);

    expect(nodeIds).toHaveLength(250);
    expect(nodeIds.at(0)).toBe("anime-000");
    expect(nodeIds.at(-1)).toBe("anime-249");
    expect(nodeIds).not.toContain("book-000");
  });
  it("retains backing shards for only the current and previous generations", async () => {
    const documents = new InMemoryDocumentStore();
    const materializer = new BoundedProjectionMaterializer(documents, { capacity: 4 });
    const generations = [];
    for (let index = 0; index < 3; index += 1) {
      const facts = new Facts();
      for (let node = 0; node <= index; node += 1) {
        facts.add({ kind: "node-create", nodeId: `node-${node}` });
      }
      const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;
      generations.push(generation);
      await materializer.publish(generation, emptyReviewReadModel);
    }
    const firstId = generations[0]?.identity.generationId;
    if (!firstId) {
      throw new Error("Expected the first materialized generation");
    }
    expect(await documents.listIds()).not.toContain(`materialized-generation/header/${firstId}`);
  });

  it("a lost backing-store acknowledgement still leaves the previous generation readable", async () => {
    const firstFacts = new Facts();
    firstFacts.add({ kind: "node-create", nodeId: "first" });
    const secondFacts = new Facts();
    secondFacts.add({ kind: "node-create", nodeId: "first" });
    secondFacts.add({ kind: "node-create", nodeId: "second" });
    const first = rebuildGeneration("workspace", firstFacts.snapshot(), versions).generation;
    const second = rebuildGeneration("workspace", secondFacts.snapshot(), versions).generation;
    const documents = new PersistThenFailSnapshotStore();
    const materializer = new BoundedProjectionMaterializer(documents);
    await materializer.publish(first, emptyReviewReadModel);
    documents.fail = true;

    await expect(materializer.publish(second, emptyReviewReadModel)).rejects.toThrow("lost derived acknowledgement");
    expect(await materializer.load(first.identity.generationId)).toEqual(first);
  });

  it("verifies shard content against the committed generation header", async () => {
    const facts = new Facts();
    facts.add({ kind: "node-create", nodeId: "verified" });
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;
    const documents = new InMemoryDocumentStore();
    const materializer = new BoundedProjectionMaterializer(documents, { capacity: 1 });
    await materializer.publish(generation, emptyReviewReadModel);
    const shardId = (await documents.listIds()).find((id) => id.startsWith("materialized-generation/shard/"));
    if (!shardId) {
      throw new Error("Expected a stored Projection shard");
    }
    const stored = await documents.load(shardId);
    if (!stored?.snapshot) {
      throw new Error("Expected stored shard bytes");
    }
    const corrupted = JSON.parse(new TextDecoder().decode(stored.snapshot)) as {
      value: Record<string, unknown>;
    };
    corrupted.value = { ...corrupted.value, injected: true };
    await documents.writeSnapshot(shardId, new TextEncoder().encode(JSON.stringify(corrupted)));
    await expect(new BoundedProjectionMaterializer(documents).load(generation.identity.generationId)).rejects.toThrow(
      "materialized dataset shard is corrupt",
    );
  });

  it("verifies paged directory nodes against the fixed generation root", async () => {
    const facts = new Facts();
    facts.add({ kind: "node-create", nodeId: "verified-directory" });
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;
    const documents = new InMemoryDocumentStore();
    const materializer = new BoundedProjectionMaterializer(documents, { capacity: 1 });
    await materializer.publish(generation, emptyReviewReadModel);
    const directoryId = (
      await documents.listIds({
        prefix: directoryPrefix(
          generation.identity.generationId,
          projectionMaterializedDataset("origin", "nodes").root,
        ),
      })
    )[0];
    if (!directoryId) {
      throw new Error("Expected a stored Projection directory entry");
    }
    const stored = await documents.load(directoryId);
    if (!stored?.snapshot) {
      throw new Error("Expected stored directory bytes");
    }
    const corrupted = JSON.parse(new TextDecoder().decode(stored.snapshot)) as {
      contentDigest: string;
    };
    corrupted.contentDigest = "0".repeat(64);
    await documents.writeSnapshot(directoryId, new TextEncoder().encode(JSON.stringify(corrupted)));
    await expect(materializer.page(generation.identity.generationId, "origin", "nodes", null, 1_000)).rejects.toThrow(
      "materialized dataset directory is corrupt",
    );
  });

  it("fails closed when a first, middle, or last authenticated directory leaf is absent", async () => {
    for (const position of ["first", "middle", "last"] as const) {
      const facts = new Facts();
      for (let index = 0; index < 100; index += 1) {
        facts.add({ kind: "node-create", nodeId: `node-${String(index).padStart(3, "0")}` });
      }
      const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;
      const documents = new InMemoryDocumentStore();
      const materializer = new BoundedProjectionMaterializer(documents, { capacity: 1 });
      await materializer.publish(generation, emptyReviewReadModel);
      const prefix = directoryPrefix(
        generation.identity.generationId,
        projectionMaterializedDataset("origin", "nodes").root,
      );
      const leaves = [];
      for (const id of await documents.listIds({ prefix })) {
        const stored = await documents.load(id);
        if (!stored?.snapshot) {
          continue;
        }
        const value = JSON.parse(new TextDecoder().decode(stored.snapshot)) as {
          level: number;
          entries?: readonly { identity: string }[];
        };
        if (value.level === 0 && value.entries?.length) {
          leaves.push({ id, entries: value.entries });
        }
      }
      leaves.sort((left, right) => left.entries[0]?.identity.localeCompare(right.entries[0]?.identity ?? "") ?? 0);
      const selected =
        position === "first" ? leaves[0] : position === "last" ? leaves.at(-1) : leaves[Math.floor(leaves.length / 2)];
      const identity = selected?.entries[Math.floor(selected.entries.length / 2)]?.identity;
      if (!selected || !identity) {
        throw new Error("Expected a materialized directory leaf");
      }
      await documents.delete(selected.id);

      await expect(materializer.page(generation.identity.generationId, "origin", "nodes", null, 1_000)).rejects.toThrow(
        "materialized dataset directory is unavailable",
      );
      await expect(materializer.read(generation.identity.generationId, "origin", "nodes", [identity])).rejects.toThrow(
        "materialized dataset directory is unavailable",
      );
    }
  });

  it("pins a generation while an asynchronous read crosses later publications", async () => {
    const documents = new DelayedShardStore();
    const materializer = new BoundedProjectionMaterializer(documents, { capacity: 1 });
    const generations = [2, 3, 4].map((count) => {
      const facts = new Facts();
      for (let index = 0; index <= count; index += 1) {
        facts.add({ kind: "node-create", nodeId: `node-${index}` });
      }
      return rebuildGeneration("workspace", facts.snapshot(), versions).generation;
    });
    const [generation0, generation1, generation2] = generations;
    if (!generation0 || !generation1 || !generation2) {
      throw new Error("generation fixture failed");
    }
    await materializer.publish(generation0, emptyReviewReadModel);
    documents.delay = true;
    const reading = materializer.page(generation0.identity.generationId, "origin", "nodes", "node-0", 2);
    await documents.entered;
    await materializer.publish(generation1, emptyReviewReadModel);
    await materializer.publish(generation2, emptyReviewReadModel);
    documents.release();
    const result = await reading;
    expect(result.entries.map((entry) => entry.identity)).toEqual(["node-1", "node-2"]);
  });

  it("holds one read lease across every page of a state-dependent command read", async () => {
    const documents = new DelayedShardStore();
    const materializer = new BoundedProjectionMaterializer(documents, { capacity: 1 });
    const generations = [3, 4, 5].map((count) => {
      const facts = new Facts();
      for (let index = 0; index < count; index += 1) {
        facts.add({ kind: "node-create", nodeId: `node-${index}` });
      }
      return rebuildGeneration("workspace", facts.snapshot(), versions).generation;
    });
    const [generation0, generation1, generation2] = generations;
    if (!generation0 || !generation1 || !generation2) {
      throw new Error("generation fixture failed");
    }
    await materializer.publish(generation0, emptyReviewReadModel);
    documents.delay = true;
    const reading = readMutationGeneration(materializer, generation0.identity.generationId, [
      { kind: "node-delete", nodeId: "node-2" },
    ]);
    await documents.entered;
    await materializer.publish(generation1, emptyReviewReadModel);
    await materializer.publish(generation2, emptyReviewReadModel);
    documents.release();
    expect((await reading).origin.nodes["node-2"]?.nodeId).toBe("node-2");
    expect(await documents.listIds()).not.toContain(
      `materialized-generation/header/${generation0.identity.generationId}`,
    );
  });

  it("reads the complete owned subtree only when a deletion can remove it", async () => {
    const materializer = new BoundedProjectionMaterializer(new InMemoryDocumentStore(), {
      capacity: 8,
    });
    const facts = new Facts();
    facts.addPlaced("parent");
    facts.addPlaced("child", "parent");
    facts.addPlaced("grandchild", "child");
    facts.addPlaced("reference-context");
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "parent-reference",
      nodeId: "parent",
      parentNodeId: "reference-context",
      anchor: end,
    });
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;
    await materializer.publish(generation, emptyReviewReadModel);

    const originalDeletion = await readMutationGeneration(materializer, generation.identity.generationId, [
      { kind: "occurrence-delete", occurrenceId: "parent-original" },
    ]);
    expect(originalDeletion.origin.nodes).toMatchObject({
      parent: { nodeId: "parent" },
      child: { nodeId: "child" },
      grandchild: { nodeId: "grandchild" },
    });
    expect(originalDeletion.origin.nodeOwners).toMatchObject({
      parent: "workspace",
      child: "parent",
      grandchild: "child",
    });

    const referenceDeletion = await readMutationGeneration(materializer, generation.identity.generationId, [
      { kind: "occurrence-delete", occurrenceId: "parent-reference" },
    ]);
    expect(referenceDeletion.origin.nodes.child).toBeUndefined();
    expect(referenceDeletion.origin.nodes.grandchild).toBeUndefined();
  });

  it("reads one command target with shard IO independent of unrelated workspace size", async () => {
    const loads = [];
    const commandBytes = [];
    const pageBytes = [];
    for (const count of [250, 1_000]) {
      const facts = new Facts();
      for (let index = 0; index < count; index += 1) {
        facts.add({
          kind: "node-create",
          nodeId: `node-${String(index).padStart(4, "0")}`,
        });
      }
      const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;
      const documents = new CountingShardStore();
      const materializer = new BoundedProjectionMaterializer(documents, { capacity: 1 });
      await materializer.publish(generation, emptyReviewReadModel);
      documents.shardLoads = 0;
      documents.loadedBytes = 0;
      const page = await materializer.page(generation.identity.generationId, "origin", "nodes", null, 1);
      expect(page.entries).toHaveLength(1);
      pageBytes.push(documents.loadedBytes);
      documents.loadedBytes = 0;
      const target = `node-${String(count - 1).padStart(4, "0")}`;
      const selected = await readMutationGeneration(materializer, generation.identity.generationId, [
        { kind: "node-delete", nodeId: target },
      ]);
      expect(Object.keys(selected.origin.nodes)).toEqual([target]);
      expect(Object.keys(selected.review.nodes)).toEqual([target]);
      expect(selected).not.toHaveProperty("planCaches");
      for (const projection of [selected.origin, selected.review]) {
        expect(projection).not.toHaveProperty("conflictIssues");
      }
      loads.push(documents.shardLoads);
      commandBytes.push(documents.loadedBytes);
    }
    expect(new Set(loads).size).toBe(1);
    expect(loads[0]).toBeLessThanOrEqual(9);
    expect(pageBytes[1]).toBeLessThanOrEqual((pageBytes[0] ?? 0) + 4_096);
    expect(commandBytes[1]).toBeLessThanOrEqual((commandBytes[0] ?? 0) + 8_192);
  });
});

class PersistThenFailSnapshotStore extends InMemoryDocumentStore {
  fail = false;

  override async writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
    await super.writeSnapshot(id, bytes);
    if (this.fail) {
      throw new Error("lost derived acknowledgement");
    }
  }
}

class DelayedShardStore extends InMemoryDocumentStore {
  delay = false;
  readonly entered: Promise<void>;
  private signalEntered!: () => void;
  private signalRelease!: () => void;
  private readonly released: Promise<void>;

  constructor() {
    super();
    this.entered = new Promise((resolve) => {
      this.signalEntered = resolve;
    });
    this.released = new Promise((resolve) => {
      this.signalRelease = resolve;
    });
  }

  override async load(id: string) {
    if (this.delay && id.startsWith("materialized-generation/shard/")) {
      this.signalEntered();
      await this.released;
    }
    return super.load(id);
  }

  release(): void {
    this.signalRelease();
  }
}

class CountingShardStore extends InMemoryDocumentStore {
  shardLoads = 0;
  loadedBytes = 0;

  override async load(id: string) {
    if (id.startsWith("materialized-generation/shard/")) {
      this.shardLoads += 1;
    }
    const stored = await super.load(id);
    this.loadedBytes +=
      (stored?.snapshot?.byteLength ?? 0) +
      (stored?.updates.reduce((total, update) => total + update.byteLength, 0) ?? 0);
    return stored;
  }
}
