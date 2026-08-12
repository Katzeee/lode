import { describe, expect, it } from "vitest";

import { rebuildGeneration } from "../../domain/reconcile/index.js";
import { end, Facts, versions } from "../../domain/reconcile/reconcile-test-helpers.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { BoundedProjectionMaterializer } from "./bounded-materializer.js";
import { directoryPrefix } from "./materialized-generation-format.js";
import { readMutationGeneration } from "./mutation-generation-reader.js";
import { publicationStep } from "./generation-publication.js";

describe("bounded derived materialization", () => {
  it("serves public Projection pages without assembling every shard", async () => {
    const documents = new InMemoryDocumentStore();
    const materializer = new BoundedProjectionMaterializer(documents, { capacity: 8 });
    const facts = new Facts();
    for (let index = 0; index < 250; index += 1) {
      facts.add({ kind: "node-create", nodeId: `node-${String(index).padStart(3, "0")}` });
    }
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;
    await materializer.publish(generation);
    const first = await materializer.page(generation.identity.generationId, {
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
      section: "nodes",
      after: null,
      limit: 25,
    });
    expect(first.entries).toHaveLength(25);
    expect(first.next).not.toBeNull();
    expect(Object.keys(first.nodes)).toHaveLength(25);
    expect(materializer.retainedUnits()).toBeLessThanOrEqual(8);
    expect(materializer.largestPageUnits()).toBe(25);
  });

  it("pages Schema Search from its membership index without reading the whole result", async () => {
    const materializer = new BoundedProjectionMaterializer(new InMemoryDocumentStore(), {
      capacity: 8,
    });
    const facts = new Facts();
    for (const schemaId of ["anime", "book"]) {
      facts.add({ kind: "node-create", nodeId: schemaId });
    }
    for (let index = 0; index < 250; index += 1) {
      const nodeId = `anime-${String(index).padStart(3, "0")}`;
      facts.add({ kind: "node-create", nodeId });
      facts.add({ kind: "schema-apply", nodeId, schemaId: "anime", anchor: end });
    }
    for (let index = 0; index < 50; index += 1) {
      const nodeId = `book-${String(index).padStart(3, "0")}`;
      facts.add({ kind: "node-create", nodeId });
      facts.add({ kind: "schema-apply", nodeId, schemaId: "book", anchor: end });
    }
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;
    await materializer.publish(generation);

    const nodeIds: string[] = [];
    let after: string | null = null;
    do {
      const page = await materializer.schemaSearch(
        generation.identity.generationId,
        "origin",
        "anime",
        after,
        25,
      );
      nodeIds.push(...page.nodeIds);
      after = page.next;
    } while (after !== null);

    expect(nodeIds).toHaveLength(250);
    expect(nodeIds.at(0)).toBe("anime-000");
    expect(nodeIds.at(-1)).toBe("anime-249");
    expect(nodeIds).not.toContain("book-000");
    expect(materializer.retainedUnits()).toBeLessThanOrEqual(8);
    expect(materializer.largestPageUnits()).toBe(25);
  });
  it("retains a fixed-capacity rebuildable shard cache", async () => {
    const facts = new Facts();
    for (let index = 0; index < 80; index += 1) {
      facts.add({ kind: "node-create", nodeId: `node-${index}` });
    }
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;
    const materializer = new BoundedProjectionMaterializer(new InMemoryDocumentStore(), {
      capacity: 32,
    });

    await materializer.publish(generation);

    expect(materializer.retainedUnits()).toBe(32);
    expect(materializer.generationId()).toBe(generation.identity.generationId);
    expect(await materializer.load(generation.identity.generationId)).toEqual(generation);
    expect(materializer.retainedUnits()).toBe(32);
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
      await materializer.publish(generation);
    }
    const firstId = generations[0]?.identity.generationId;
    if (!firstId) {
      throw new Error("Expected the first materialized generation");
    }
    expect(await documents.listIds()).not.toContain(`materialized-generation/header/${firstId}`);
    expect(materializer.retainedUnits()).toBeLessThanOrEqual(4);
  });

  it("owner or publisher failure leaves the previous materialized generation atomic", async () => {
    const before = new Facts();
    before.add({ kind: "node-create", nodeId: "before" });
    const first = rebuildGeneration("workspace", before.snapshot(), versions).generation;
    const after = new Facts();
    after.add({ kind: "node-create", nodeId: "after" });
    after.add({ kind: "node-create", nodeId: "after-tail" });
    const second = rebuildGeneration("workspace", after.snapshot(), versions).generation;
    const materializer = new BoundedProjectionMaterializer(new InMemoryDocumentStore(), {
      beforeCommit: (generation) => {
        if (generation.identity.generationId === second.identity.generationId) {
          throw new Error("injected materializer failure");
        }
      },
    });
    await materializer.publish(first);

    await expect(materializer.publish(second)).rejects.toThrow("injected materializer failure");
    expect(materializer.generationId()).toBe(first.identity.generationId);
    expect(materializer.retainedUnits()).toBeGreaterThan(0);
    expect(await materializer.load(first.identity.generationId)).toEqual(first);
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
    await materializer.publish(first);
    documents.fail = true;

    await expect(materializer.publish(second)).rejects.toThrow("lost derived acknowledgement");
    expect(materializer.generationId()).toBe(first.identity.generationId);
    expect(await materializer.load(first.identity.generationId)).toEqual(first);
  });

  it("verifies shard content against the committed generation header", async () => {
    const facts = new Facts();
    facts.add({ kind: "node-create", nodeId: "verified" });
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;
    const documents = new InMemoryDocumentStore();
    const materializer = new BoundedProjectionMaterializer(documents, { capacity: 1 });
    await materializer.publish(generation);
    const shardId = (await documents.listIds()).find((id) =>
      id.startsWith("materialized-generation/shard/"),
    );
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
      new BoundedProjectionMaterializer(documents).load(generation.identity.generationId),
    ).rejects.toThrow("Projection shard is corrupt");
  });

  it("verifies paged directory nodes against the fixed generation root", async () => {
    const facts = new Facts();
    facts.add({ kind: "node-create", nodeId: "verified-directory" });
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;
    const documents = new InMemoryDocumentStore();
    const materializer = new BoundedProjectionMaterializer(documents, { capacity: 1 });
    await materializer.publish(generation);
    const directoryId = (
      await documents.listIds({
        prefix: directoryPrefix(generation.identity.generationId, "origin", "nodes"),
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
    await expect(
      materializer.page(generation.identity.generationId, {
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
        section: "nodes",
        after: null,
        limit: 1,
      }),
    ).rejects.toThrow("Projection directory is corrupt");
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
      await materializer.publish(generation);
      const prefix = directoryPrefix(generation.identity.generationId, "origin", "nodes");
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
      leaves.sort(
        (left, right) =>
          left.entries[0]?.identity.localeCompare(right.entries[0]?.identity ?? "") ?? 0,
      );
      const selected =
        position === "first"
          ? leaves[0]
          : position === "last"
            ? leaves.at(-1)
            : leaves[Math.floor(leaves.length / 2)];
      const identity = selected?.entries[Math.floor(selected.entries.length / 2)]?.identity;
      if (!selected || !identity) {
        throw new Error("Expected a materialized directory leaf");
      }
      await documents.delete(selected.id);

      await expect(
        materializer.page(generation.identity.generationId, {
          kind: "projection",
          workspaceId: "workspace",
          view: "origin",
          section: "nodes",
          after: null,
          limit: 100,
        }),
      ).rejects.toThrow("Projection directory is unavailable");
      await expect(
        materializer.read(generation.identity.generationId, "origin", "nodes", [identity]),
      ).rejects.toThrow("Projection directory is unavailable");
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
    await materializer.publish(generation0);
    documents.delay = true;
    const reading = materializer.page(generation0.identity.generationId, {
      kind: "projection",
      workspaceId: "workspace",
      view: "origin",
      section: "nodes",
      after: "node-0",
      limit: 2,
    });
    await documents.entered;
    await materializer.publish(generation1);
    await materializer.publish(generation2);
    documents.release();
    expect((await reading).entries.map((entry) => entry.identity)).toEqual(["node-1", "node-2"]);
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
    await materializer.publish(generation0);
    documents.delay = true;
    const reading = readMutationGeneration(materializer, generation0.identity.generationId, [
      { kind: "node-delete", nodeId: "node-2" },
    ]);
    await documents.entered;
    await materializer.publish(generation1);
    await materializer.publish(generation2);
    documents.release();
    expect((await reading).origin.nodes["node-2"]?.nodeId).toBe("node-2");
    expect(await documents.listIds()).not.toContain(
      `materialized-generation/header/${generation0.identity.generationId}`,
    );
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
      await materializer.publish(generation);
      documents.shardLoads = 0;
      documents.loadedBytes = 0;
      expect(
        (
          await materializer.page(generation.identity.generationId, {
            kind: "projection",
            workspaceId: "workspace",
            view: "origin",
            section: "nodes",
            after: null,
            limit: 1,
          })
        ).entries,
      ).toHaveLength(1);
      pageBytes.push(documents.loadedBytes);
      documents.loadedBytes = 0;
      const target = `node-${String(count - 1).padStart(4, "0")}`;
      const selected = await readMutationGeneration(
        materializer,
        generation.identity.generationId,
        [{ kind: "node-delete", nodeId: target }],
      );
      expect(Object.keys(selected.origin.nodes)).toEqual([target]);
      expect(Object.keys(selected.review.nodes)).toEqual([target]);
      loads.push(documents.shardLoads);
      commandBytes.push(documents.loadedBytes);
      expect(materializer.retainedUnits()).toBe(1);
    }
    expect(loads).toEqual([2, 2]);
    expect(pageBytes[1]).toBeLessThanOrEqual((pageBytes[0] ?? 0) + 4_096);
    expect(commandBytes[1]).toBeLessThanOrEqual((commandBytes[0] ?? 0) + 8_192);
  });

  it("a timed-out late publication cannot reorder newer manifest generations", async () => {
    const generations = [0, 1, 2, 3].map((count) => {
      const facts = new Facts();
      for (let index = 0; index <= count; index += 1) {
        facts.add({ kind: "node-create", nodeId: `node-${index}` });
      }
      return rebuildGeneration("workspace", facts.snapshot(), versions).generation;
    });
    const [generation0, generation1, generation2, generation3] = generations;
    if (!generation0 || !generation1 || !generation2 || !generation3) {
      throw new Error("publication generation fixture failed");
    }
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const materializer = new BoundedProjectionMaterializer(new InMemoryDocumentStore(), {
      beforeCommit: async (generation) => {
        if (generation.identity.generationId === generation1.identity.generationId) {
          entered();
          await blocked;
        }
      },
    });
    await materializer.publish(generation0);
    const late = materializer.publish(generation1);
    await waiting;
    await expect(publicationStep(late, 10)).rejects.toThrow("publication timed out");
    await materializer.publish(generation2);
    release();
    await late;
    await materializer.publish(generation3);

    await expect(materializer.load(generation2.identity.generationId)).resolves.toEqual(
      generation2,
    );
    expect(materializer.generationId()).toBe(generation3.identity.generationId);
  });

  it("a lost newer manifest acknowledgement fences an older timed-out publication", async () => {
    const generations = [0, 1, 2].map((count) => {
      const facts = new Facts();
      for (let index = 0; index <= count; index += 1) {
        facts.add({ kind: "node-create", nodeId: `combined-${index}` });
      }
      return rebuildGeneration("workspace", facts.snapshot(), versions).generation;
    });
    const [generation0, generation1, generation2] = generations;
    if (!generation0 || !generation1 || !generation2) {
      throw new Error("combined publication fixture failed");
    }
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const documents = new LostManifestAcknowledgementStore();
    const materializer = new BoundedProjectionMaterializer(documents, {
      beforeCommit: async (generation) => {
        if (generation.identity.generationId === generation1.identity.generationId) {
          entered();
          await blocked;
        }
      },
    });
    await materializer.publish(generation0);
    const late = materializer.publish(generation1);
    await waiting;
    await expect(publicationStep(late, 10)).rejects.toThrow("publication timed out");
    documents.loseNextManifestAcknowledgement = true;
    await expect(materializer.publish(generation2)).rejects.toThrow(
      "lost manifest acknowledgement",
    );
    release();
    await late;

    await expect(materializer.load(generation0.identity.generationId)).resolves.toEqual(
      generation0,
    );
    const manifest = await documents.load("materialized-generation/manifest");
    if (!manifest?.snapshot) {
      throw new Error("Expected a durable generation manifest");
    }
    expect(JSON.parse(new TextDecoder().decode(manifest.snapshot))).toEqual({
      format: "lode-materialized-generation-manifest-v1",
      generationIds: [generation0.identity.generationId, generation2.identity.generationId],
    });
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

class LostManifestAcknowledgementStore extends InMemoryDocumentStore {
  loseNextManifestAcknowledgement = false;

  override async writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
    await super.writeSnapshot(id, bytes);
    if (id === "materialized-generation/manifest" && this.loseNextManifestAcknowledgement) {
      this.loseNextManifestAcknowledgement = false;
      throw new Error("lost manifest acknowledgement");
    }
  }
}
