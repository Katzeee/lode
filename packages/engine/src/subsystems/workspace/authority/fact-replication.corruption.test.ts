import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";

import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { admitAuthorityRecordShapes } from "../../../domain/fact/index.js";
import { createReplicaId, FactAuthority } from "./fact-authority.js";

async function store(peerId: `${number}`) {
  return FactAuthority.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId: peerId,
    authorityJournal: new InMemoryDocumentStore(),
    factReplication: new InMemoryDocumentStore(),
    admitRecords: admitAuthorityRecordShapes,
  });
}

async function commitNode(target: Awaited<ReturnType<typeof store>>): Promise<void> {
  await target.commit({
    invocationId: "create",
    request: { command: "create" },
    writes: [
      {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "node" },
      },
    ],
    lineage: null,
    publishedFrontier: {},
  });
}

describe("Fact sync corruption boundaries", () => {
  it("rejects non-Fact root containers instead of forwarding derived payload", async () => {
    const target = await store("101");
    const remote = new LoroDoc();
    remote.setPeerId("202");
    remote.getMap("projection").set("leak", "derived");
    remote.commit({ message: "inject-derived-container" });

    await expect(target.replication.importUpdate(remote.export({ mode: "snapshot" }))).rejects.toThrow(
      /unknown root container/i,
    );
    expect(target.admission().kind).toBe("fault");
    await target.recoverToLastValidPrefix();
    const exported = new LoroDoc();
    exported.import(await target.replication.exportSnapshot());
    expect(exported.toJSON()).toEqual({ facts: {} });
  });

  it("rejects Fact tombstones and continues serving the immutable Fact", async () => {
    const target = await store("101");
    await commitNode(target);
    const remote = new LoroDoc();
    remote.setPeerId("202");
    remote.import(await target.replication.exportSnapshot());
    const facts = remote.getMap<string>("facts");
    const projection = remote.toJSON() as unknown;
    const key = factKeys(projection)[0];
    if (!key) {
      throw new Error("Expected a synced Fact entry");
    }
    const before = remote.version();
    facts.delete(key);
    remote.commit({ message: "delete-immutable-fact" });

    await expect(target.replication.importUpdate(remote.export({ mode: "update", from: before }))).rejects.toThrow(
      /removes immutable authority content/i,
    );
    expect(target.admission().kind).toBe("fault");
    await target.recoverToLastValidPrefix();
    const downstream = await store("303");
    await downstream.replication.importUpdate(await target.replication.exportSnapshot());
    expect(downstream.snapshot()).toEqual(target.snapshot());
  });

  it("persists a deterministic sync fault across restart until explicit recovery", async () => {
    const documents = new InMemoryDocumentStore();
    const replicaId = createReplicaId();
    const target = await FactAuthority.open({
      workspaceId: "workspace",
      replicaId,
      loroPeerId: "101",
      authorityJournal: documents,
      factReplication: documents,
      admitRecords: admitAuthorityRecordShapes,
    });
    await commitNode(target);
    const remote = new LoroDoc();
    remote.setPeerId("202");
    remote.getMap("projection").set("leak", "derived");
    remote.commit({ message: "inject-derived-container" });
    await expect(target.replication.importUpdate(remote.export({ mode: "snapshot" }))).rejects.toThrow(
      /unknown root container/i,
    );

    const restarted = await FactAuthority.open({
      workspaceId: "workspace",
      replicaId,
      loroPeerId: "101",
      authorityJournal: documents,
      factReplication: documents,
      admitRecords: admitAuthorityRecordShapes,
    });
    expect(restarted.admission()).toMatchObject({
      kind: "fault",
      snapshot: { facts: [{ body: { mutation: { nodeId: "node" } } }] },
    });
    await expect(
      restarted.commit({
        invocationId: "new-write",
        request: { command: "new-write" },
        writes: [
          {
            kind: "contribution",
            actorId: "actor",
            intent: "direct",
            mutation: { kind: "node-create", nodeId: "other" },
          },
        ],
        lineage: null,
        publishedFrontier: restarted.admission().snapshot.frontier,
      }),
    ).rejects.toThrow(/authority|quarantined/i);
    await restarted.recoverToLastValidPrefix();
    expect(restarted.admission()).toMatchObject({ kind: "ready" });
    expect(restarted.snapshot().facts).toHaveLength(1);
  });
});

function factKeys(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  const facts = (value as Record<string, unknown>).facts;
  return typeof facts === "object" && facts !== null && !Array.isArray(facts) ? Object.keys(facts) : [];
}
