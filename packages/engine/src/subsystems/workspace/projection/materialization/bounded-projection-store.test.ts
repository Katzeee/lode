import { describe, expect, it } from "vitest";

import { rebuildGeneration } from "../../../../domain/reconcile/index.js";
import { end, Facts, versions } from "../../../../../tests/support/reconcile/reconcile-test-helpers.js";
import { addDefinitionNode } from "../../../../../tests/support/reconcile/placed-node-test-helpers.js";
import { InMemoryDocumentStore } from "../../../persistence/in-memory-document-store.js";
import { BoundedProjectionStore } from "./bounded-projection-store.js";
import { directoryPrefix, shardPrefix } from "./store/materialized-generation-format.js";
import { projectionMaterializedDataset } from "./projection-materialized-dataset.js";
import { readEditGeneration } from "../../generation-reading/index.js";

const emptyReviewReadModel = { scopes: {}, supportByAction: {} } as const;

describe("bounded Projection store", () => {
  it("serves Projection section pages without assembling every shard", async () => {
    const documents = new InMemoryDocumentStore();
    const materializer = new BoundedProjectionStore(documents, { capacity: 8 });
    const facts = new Facts();
    for (let index = 0; index < 250; index += 1) {
      facts.add({
        kind: "node-create",
        nodeId: `node-${String(index).padStart(3, "0")}`,
        ownerNodeId: "workspace",
        originalPlacement: null,
      });
    }
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions);
    await materializer.publish(generation, emptyReviewReadModel);
    const first = await materializer.page(generation.identity.generationId, "origin", "nodes", null, 25);
    expect(first.next).not.toBeNull();
    expect(first.entries).toHaveLength(25);
    await expect(materializer.page(generation.identity.generationId, "origin", "nodes", null, 0)).rejects.toThrow(
      "Materialized page limit must be a positive safe integer",
    );
  });

  it("publishes Review indexes beside, but outside, the semantic Projection", async () => {
    const materializer = new BoundedProjectionStore(new InMemoryDocumentStore());
    const facts = new Facts();
    facts.add({ kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null });
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions);
    await materializer.publish(generation, {
      scopes: {
        "scope-a": ["g1/workspace/101/1/actions/0"],
        "scope-b": ["g1/workspace/101/2/actions/0"],
      },
      supportByAction: { "g1/workspace/101/1/actions/0": ["g1/workspace/101/3/actions/0"] },
    });

    expect(await materializer.reviewScopes(generation.identity.generationId, null, 1)).toMatchObject({
      scopes: [{ identity: "scope-a", factActionIds: ["g1/workspace/101/1/actions/0"] }],
      next: "scope-a",
    });
    expect(
      await materializer.reviewSupport(generation.identity.generationId, ["g1/workspace/101/1/actions/0"]),
    ).toMatchObject({
      entries: [{ identity: "g1/workspace/101/1/actions/0", supportIds: ["g1/workspace/101/3/actions/0"] }],
    });
  });

  it("restores one complete generation and classifies missing or corrupt derived state", async () => {
    const documents = new InMemoryDocumentStore();
    const generation = rebuildGeneration("workspace", new Facts().snapshot(), versions);
    const store = new BoundedProjectionStore(documents);

    expect(await store.restore(generation.identity.generationId)).toEqual({ kind: "missing" });
    await store.publish(generation, emptyReviewReadModel);
    expect(await store.storedIdentities()).toEqual([generation.identity]);
    expect(await new BoundedProjectionStore(documents).restore(generation.identity.generationId)).toEqual({
      kind: "found",
      generation,
    });

    const shardId = (await documents.listIds({ prefix: shardPrefix(generation.identity.generationId) }))[0];
    if (!shardId) {
      throw new Error("Expected a stored Projection shard");
    }
    await documents.delete(shardId);
    expect(await new BoundedProjectionStore(documents).restore(generation.identity.generationId)).toMatchObject({
      kind: "invalid",
    });
  });

  it("does not misclassify persistence failures as rebuildable derived state", async () => {
    const documents = new FailingLoadDocumentStore();
    await expect(new BoundedProjectionStore(documents).restore("generation")).rejects.toThrow(
      "injected Projection storage failure",
    );
  });

  it("pages Supertag Search from its membership index without reading the whole result", async () => {
    const documents = new CountingShardStore();
    const materializer = new BoundedProjectionStore(documents, {
      capacity: 8,
    });
    const facts = new Facts();
    for (const supertagId of ["anime", "book"]) {
      addDefinitionNode(facts, supertagId, "supertag-definition");
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
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions);
    await materializer.publish(generation, emptyReviewReadModel);
    documents.shardLoads = 0;

    const nodeIds: string[] = [];
    let after: string | null = null;
    let firstPageShardLoads = 0;
    do {
      const page = await materializer.supertagInstances(generation.identity.generationId, "origin", "anime", after, 25);
      nodeIds.push(...page.nodeIds);
      after = page.next;
      if (nodeIds.length === 25) {
        firstPageShardLoads = documents.shardLoads;
      }
    } while (after !== null);

    expect(nodeIds).toHaveLength(250);
    expect(nodeIds.at(0)).toBe("anime-000");
    expect(nodeIds.at(-1)).toBe("anime-249");
    expect(nodeIds).not.toContain("book-000");
    expect(firstPageShardLoads).toBeLessThanOrEqual(26);
  });
  it("retains backing shards for only the current generation", async () => {
    const documents = new InMemoryDocumentStore();
    const materializer = new BoundedProjectionStore(documents, { capacity: 4 });
    const generations = [];
    for (let index = 0; index < 3; index += 1) {
      const facts = new Facts();
      for (let node = 0; node <= index; node += 1) {
        facts.add({ kind: "node-create", nodeId: `node-${node}`, ownerNodeId: "workspace", originalPlacement: null });
      }
      const generation = rebuildGeneration("workspace", facts.snapshot(), versions);
      generations.push(generation);
      await materializer.publish(generation, emptyReviewReadModel);
    }
    const firstId = generations[0]?.identity.generationId;
    const secondId = generations[1]?.identity.generationId;
    const thirdId = generations[2]?.identity.generationId;
    if (!firstId || !secondId || !thirdId) {
      throw new Error("Expected retained materialized generations");
    }
    const ids = await documents.listIds();
    expect(ids).not.toContain(`materialized-generation/header/${firstId}`);
    expect(ids).not.toContain(`materialized-generation/header/${secondId}`);
    expect(ids).toContain(`materialized-generation/header/${thirdId}`);
  });

  it("a partial publication leaves the previous generation readable", async () => {
    const firstFacts = new Facts();
    firstFacts.add({ kind: "node-create", nodeId: "first", ownerNodeId: "workspace", originalPlacement: null });
    const secondFacts = new Facts();
    secondFacts.add({ kind: "node-create", nodeId: "first", ownerNodeId: "workspace", originalPlacement: null });
    secondFacts.add({ kind: "node-create", nodeId: "second", ownerNodeId: "workspace", originalPlacement: null });
    const first = rebuildGeneration("workspace", firstFacts.snapshot(), versions);
    const second = rebuildGeneration("workspace", secondFacts.snapshot(), versions);
    const documents = new FailAfterSnapshotWriteStore();
    const materializer = new BoundedProjectionStore(documents);
    await materializer.publish(first, emptyReviewReadModel);
    documents.fail = true;

    await expect(materializer.publish(second, emptyReviewReadModel)).rejects.toThrow(
      "injected materialized write failure",
    );
    expect(await materializer.restore(first.identity.generationId)).toEqual({ kind: "found", generation: first });
  });

  it("verifies shard content against the committed generation header", async () => {
    const facts = new Facts();
    facts.add({ kind: "node-create", nodeId: "verified", ownerNodeId: "workspace", originalPlacement: null });
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions);
    const documents = new InMemoryDocumentStore();
    const materializer = new BoundedProjectionStore(documents, { capacity: 1 });
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
    await expect(
      new BoundedProjectionStore(documents).restore(generation.identity.generationId),
    ).resolves.toMatchObject({ kind: "invalid" });
  });

  it("verifies paged directory nodes against the fixed generation root", async () => {
    const facts = new Facts();
    facts.add({ kind: "node-create", nodeId: "verified-directory", ownerNodeId: "workspace", originalPlacement: null });
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions);
    const documents = new InMemoryDocumentStore();
    const materializer = new BoundedProjectionStore(documents, { capacity: 1 });
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
        facts.add({
          kind: "node-create",
          nodeId: `node-${String(index).padStart(3, "0")}`,
          ownerNodeId: "workspace",
          originalPlacement: null,
        });
      }
      const generation = rebuildGeneration("workspace", facts.snapshot(), versions);
      const documents = new InMemoryDocumentStore();
      const materializer = new BoundedProjectionStore(documents, { capacity: 1 });
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

  it("reads the complete owned subtree only when a deletion can remove it", async () => {
    const materializer = new BoundedProjectionStore(new InMemoryDocumentStore(), {
      capacity: 8,
    });
    const facts = new Facts();
    facts.addPlaced("parent");
    facts.addPlaced("child", "parent");
    facts.addPlaced("grandchild", "child");
    facts.addPlaced("reference-context");
    facts.add({
      kind: "placement-create",
      placementId: "parent-reference",
      nodeId: "parent",
      parentNodeId: "reference-context",
      anchor: end,
    });
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions);
    await materializer.publish(generation, emptyReviewReadModel);

    const originalDeletion = await readEditGeneration(materializer, generation.identity.generationId, [
      { kind: "node-delete", nodeId: "parent" },
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

    const referenceDeletion = await readEditGeneration(materializer, generation.identity.generationId, [
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
          ownerNodeId: "workspace",
          originalPlacement: null,
        });
      }
      const generation = rebuildGeneration("workspace", facts.snapshot(), versions);
      const documents = new CountingShardStore();
      const materializer = new BoundedProjectionStore(documents, { capacity: 1 });
      await materializer.publish(generation, emptyReviewReadModel);
      documents.shardLoads = 0;
      documents.loadedBytes = 0;
      const page = await materializer.page(generation.identity.generationId, "origin", "nodes", null, 1);
      expect(page.entries).toHaveLength(1);
      pageBytes.push(documents.loadedBytes);
      documents.loadedBytes = 0;
      const target = `node-${String(count - 1).padStart(4, "0")}`;
      const selected = await readEditGeneration(materializer, generation.identity.generationId, [
        { kind: "node-delete", nodeId: target },
      ]);
      expect(Object.keys(selected.origin.nodes).sort()).toEqual([target, "workspace"].sort());
      expect(Object.keys(selected.review.nodes).sort()).toEqual([target, "workspace"].sort());
      expect(selected).not.toHaveProperty("planCaches");
      for (const projection of [selected.origin, selected.review]) {
        expect(projection).not.toHaveProperty("conflictIssues");
      }
      loads.push(documents.shardLoads);
      commandBytes.push(documents.loadedBytes);
    }
    expect(new Set(loads).size).toBe(1);
    expect(pageBytes[1]).toBeLessThanOrEqual((pageBytes[0] ?? 0) + 4_096);
    expect(commandBytes[1]).toBeLessThanOrEqual((commandBytes[0] ?? 0) + 8_192);
  });
});

class FailAfterSnapshotWriteStore extends InMemoryDocumentStore {
  fail = false;

  override async writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
    await super.writeSnapshot(id, bytes);
    if (this.fail) {
      throw new Error("injected materialized write failure");
    }
  }
}

class FailingLoadDocumentStore extends InMemoryDocumentStore {
  override load(_id: string): Promise<never> {
    return Promise.reject(new Error("injected Projection storage failure"));
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
