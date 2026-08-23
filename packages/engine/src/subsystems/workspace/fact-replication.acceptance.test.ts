import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";

import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import type { EditAction } from "../../domain/edit/index.js";
import {
  factActionsFromFacts,
  workspaceGenesisActions,
  workspaceSchemaNodeId,
  workspaceTrashNodeId,
  type EditIntent,
  type FactBody,
  type EditBody,
} from "../../domain/fact/index.js";
import {
  CURRENT_PROJECTION_VERSIONS as versions,
  rebuildGeneration,
  textAtoms,
  viewProjectionIdentity,
} from "../../domain/reconcile/index.js";
import { queryReview } from "../../domain/review/index.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { Workspace } from "./workspace.js";
import { SyncExchange } from "../synchronization/sync-exchange.js";
import { FactReplication } from "./fact-replication.js";
import { InMemoryReplicaPeer, syncPair } from "../../../tests/support/sync.js";

async function replica(peerId: `${number}`) {
  return FactAuthority.open({
    workspaceId: "workspace",
    loroPeerId: peerId,
    documents: new InMemoryDocumentStore(),
  });
}

async function domainReplica(peerId: `${number}`) {
  return FactAuthority.open({
    workspaceId: "workspace",
    loroPeerId: peerId,
    documents: new InMemoryDocumentStore(),
  });
}

describe("Fact-only production sync", () => {
  it("SYNC-1 only the authority FactAuthorityPort enters domain sync", async () => {
    const store = await replica("101");
    const composite = new FactReplication(store.replication);
    expect(composite.docs().map((doc) => doc.id)).toEqual(["facts"]);
  });

  it("publishes causally pending Facts when their missing dependency arrives", async () => {
    const dependency = await domainReplica("101");
    await dependency.commit({
      invocationId: "dependency",
      request: { kind: "test" },
      writes: [
        {
          kind: "edit",
          actorId: "actor",
          intent: "direct",
          actions: [{ kind: "node-create", nodeId: "dependency", ownerNodeId: "workspace", originalPlacement: null }],
        },
      ],
      lineage: null,
      inverse: [],
      publishedFrontier: {},
    });
    const dependent = await domainReplica("202");
    await dependent.replication.importUpdate(await dependency.replication.exportUpdate());
    const beforeDependent = await dependent.replication.version();
    await dependent.commit({
      invocationId: "dependent",
      request: { kind: "test" },
      writes: [
        {
          kind: "edit",
          actorId: "actor",
          intent: "direct",
          actions: [{ kind: "node-create", nodeId: "dependent", ownerNodeId: "workspace", originalPlacement: null }],
        },
      ],
      lineage: null,
      inverse: [],
      publishedFrontier: dependent.snapshot().frontier,
    });

    const targetDocuments = new InMemoryDocumentStore();
    const targetOptions = {
      workspaceId: "workspace",
      loroPeerId: "303" as const,
      documents: targetDocuments,
      snapshotInterval: 1,
    };
    const target = await FactAuthority.open(targetOptions);
    await target.replication.importUpdate(await dependent.replication.exportUpdate(beforeDependent));
    expect(target.snapshot().facts).toEqual([]);
    await target.commit({
      invocationId: "local-while-pending",
      request: { kind: "test" },
      writes: [
        {
          kind: "edit",
          actorId: "actor",
          intent: "direct",
          actions: [{ kind: "node-create", nodeId: "local", ownerNodeId: "workspace", originalPlacement: null }],
        },
      ],
      lineage: null,
      inverse: [],
      publishedFrontier: {},
    });

    await target.replication.importUpdate(await dependency.replication.exportUpdate());
    expect(
      factActionsFromFacts(target.snapshot().facts).map(({ action }) =>
        action.kind === "node-create" ? action.nodeId : null,
      ),
    ).toEqual(["dependency", "local", "dependent"]);
    const restarted = await FactAuthority.open(targetOptions);
    expect(restarted.snapshot()).toEqual(target.snapshot());
  });

  it("syncs a same-Definition Template Field re-add", async () => {
    const sourceStore = await replica("621");
    const source = await Workspace.open({ workspaceId: "workspace", facts: sourceStore, versions });
    const target = await domainReplica("622");
    const publish = async (invocationId: string, actions: readonly EditAction[]) => {
      const result = await source.execute({
        kind: "edit",
        workspaceId: "workspace",
        invocationId,
        actorId: "actor",
        intent: "direct",
        historyChannelId: "template-field-sync",
        actions,
      });
      expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
    };
    const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

    await publish("same-definition-fixture", [
      {
        kind: "node-create",
        nodeId: "sync-supertag",
        occurrenceId: "sync-supertag-original",
        parentNodeId: "workspace",
        anchor: end,
        intrinsicNodeType: "supertag-definition",
      },
      {
        kind: "supertag-template-field-create",
        supertagId: "sync-supertag",
        fieldDefinitionId: "sync-field-definition",
        anchor: end,
      },
    ]);
    const original = await currentTemplateField(source, "sync-supertag");
    await publish("same-definition-discoverable", [
      {
        kind: "supertag-template-field-make-discoverable",
        supertagId: "sync-supertag",
        templateFieldId: original.factActionId,
      },
    ]);
    await publish("same-definition-remove", [
      {
        kind: "supertag-template-field-remove",
        supertagId: "sync-supertag",
        templateFieldId: original.factActionId,
      },
    ]);
    await publish("same-definition-readd", [
      {
        kind: "supertag-template-field-add-existing",
        supertagId: "sync-supertag",
        fieldDefinitionId: "sync-field-definition",
        anchor: end,
      },
    ]);
    const readded = await currentTemplateField(source, "sync-supertag");

    expect(
      factActionsFromFacts(sourceStore.snapshot().facts).some(
        (fact) => fact.action.kind === "template-field-add" && fact.action.fieldDefinition.kind === "existing",
      ),
    ).toBe(true);
    await target.replication.importUpdate(await sourceStore.replication.exportUpdate());
    const synced = rebuildGeneration("workspace", target.snapshot(), versions).origin;
    expect(synced.templateFields["sync-supertag"]).toEqual([
      expect.objectContaining({
        factActionId: readded.factActionId,
        fieldDefinitionId: "sync-field-definition",
        fieldDefinitionOwner: "workspace-schema",
      }),
    ]);
    expect(synced.nodeOwners[original.templateFieldNodeId]).toBe(workspaceTrashNodeId("workspace"));
    expect(synced.nodeOwners[readded.templateFieldNodeId]).toBe("sync-supertag");
    expect(synced.nodeOwners["sync-field-definition"]).toBe(workspaceSchemaNodeId("workspace"));
  });

  it("syncs a public Static Default edit", async () => {
    const sourceStore = await replica("641");
    const source = await Workspace.open({ workspaceId: "workspace", facts: sourceStore, versions });
    const target = await domainReplica("642");
    const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
    const execute = async (invocationId: string, actions: readonly EditAction[]) => {
      const result = await source.execute({
        kind: "edit",
        workspaceId: "workspace",
        invocationId,
        actorId: "actor",
        intent: "direct",
        historyChannelId: "template-field-static-default-sync",
        actions,
      });
      expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
    };

    await execute("static-default-sync-setup", [
      {
        kind: "node-create",
        nodeId: "static-default-sync-supertag",
        occurrenceId: "static-default-sync-supertag-occurrence",
        parentNodeId: "workspace",
        anchor: end,
        intrinsicNodeType: "supertag-definition",
      },
      {
        kind: "supertag-template-field-create",
        supertagId: "static-default-sync-supertag",
        fieldDefinitionId: "static-default-sync-definition",
        anchor: end,
      },
    ]);
    const staticDefaultField = await currentTemplateField(source, "static-default-sync-supertag");
    await execute("static-default-sync-set", [
      {
        kind: "supertag-template-field-static-default-set",
        supertagId: "static-default-sync-supertag",
        templateFieldId: staticDefaultField.factActionId,
        value: "Alpha",
      },
    ]);

    await target.replication.importUpdate(await sourceStore.replication.exportUpdate());
    const synced = rebuildGeneration("workspace", target.snapshot(), versions).origin;
    expect(
      textAtoms(synced.nodes[staticDefaultField.staticDefaultValueNodeId])
        .map((atom) => atom.value)
        .join(""),
    ).toBe("Alpha");
    expect(synced.nodeOwners[staticDefaultField.staticDefaultValueNodeId]).toBe(staticDefaultField.templateFieldNodeId);
  });

  it("syncs Template Field visibility", async () => {
    const sourceStore = await replica("631");
    const source = await Workspace.open({ workspaceId: "workspace", facts: sourceStore, versions });
    const target = await domainReplica("632");
    const execute = async (invocationId: string, actions: readonly EditAction[]) => {
      const result = await source.execute({
        kind: "edit",
        workspaceId: "workspace",
        invocationId,
        actorId: "actor",
        intent: "direct",
        historyChannelId: "template-field-visibility-sync",
        actions,
      });
      expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
    };
    const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
    await execute("visibility-sync-setup", [
      {
        kind: "node-create",
        nodeId: "visibility-sync-supertag",
        occurrenceId: "visibility-sync-supertag-occurrence",
        parentNodeId: "workspace",
        anchor: end,
        intrinsicNodeType: "supertag-definition",
      },
      {
        kind: "supertag-template-field-create",
        supertagId: "visibility-sync-supertag",
        fieldDefinitionId: "visibility-sync-field-definition",
        anchor: end,
      },
    ]);
    const visibilityField = await currentTemplateField(source, "visibility-sync-supertag");
    await execute("visibility-sync-pinned", [
      {
        kind: "supertag-template-field-visibility-set",
        supertagId: "visibility-sync-supertag",
        templateFieldId: visibilityField.factActionId,
        visibility: "pinned",
      },
    ]);
    await target.replication.importUpdate(await sourceStore.replication.exportUpdate());
    const synced = rebuildGeneration("workspace", target.snapshot(), versions).origin;
    expect(synced.templateFields["visibility-sync-supertag"]?.[0]?.visibility).toBe("pinned");
    expect(synced.nodeOwners["visibility-sync-field-definition"]).toBe(visibilityField.templateFieldNodeId);
  });

  it("syncs a public View removal as its complete removal graph", async () => {
    const sourceStore = await domainReplica("101");
    const targetStore = await domainReplica("202");
    const source = await Workspace.open({ workspaceId: "workspace", facts: sourceStore, versions });
    await Workspace.open({ workspaceId: "workspace", facts: targetStore, versions });
    await source.execute({
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "view-sync-fixture",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "view-sync",
      actions: [
        {
          kind: "node-create",
          nodeId: "host",
          occurrenceId: "host-original",
          parentNodeId: "workspace",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "shared-default-view-create",
          hostNodeId: "host",
          viewType: "table",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      ],
    });
    const sourceView = await currentView(source, "host");
    await targetStore.replication.importUpdate(await sourceStore.replication.exportUpdate());
    const attached = rebuildGeneration("workspace", targetStore.snapshot(), versions).origin;
    expect(attached.sharedDefaultViewDefinitions.host?.[0]).toMatchObject({
      viewId: sourceView.viewId,
      viewType: "table",
    });

    const removal = await source.execute({
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "view-sync-remove",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "view-sync",
      actions: [
        {
          kind: "shared-default-view-remove",
          hostNodeId: "host",
        },
      ],
    });
    expect(removal, JSON.stringify(removal)).toMatchObject({ status: "published" });
    await targetStore.replication.importUpdate(await sourceStore.replication.exportUpdate());

    const generation = rebuildGeneration("workspace", targetStore.snapshot(), versions);
    const viewIdentity = viewProjectionIdentity(sourceView.viewId);
    expect(generation.origin.sharedDefaultViewDefinitions.host).toBeUndefined();
    expect(generation.origin.nodeOwners[sourceView.attachmentNodeId]).toBeNull();
    expect(generation.origin.nodeOwners[sourceView.viewDefinitionNodeId]).toBe(sourceView.attachmentNodeId);
    expect(generation.origin.nodeOwners[viewIdentity.detachedValueNodeId]).toBe(sourceView.attachmentNodeId);
    expect(generation.origin.childOccurrences[sourceView.attachmentNodeId]).toEqual([
      sourceView.relationDefinitionOccurrenceId,
      viewIdentity.detachedValueOccurrenceId,
    ]);
  });

  it("syncs typed View options", async () => {
    const sourceStore = await replica("101");
    const targetStore = await domainReplica("202");
    const source = await Workspace.open({ workspaceId: "workspace", facts: sourceStore, versions });
    await Workspace.open({ workspaceId: "workspace", facts: targetStore, versions });
    const published = await source.execute({
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "view-options-sync-fixture",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "view-options-sync",
      actions: [
        {
          kind: "node-create",
          nodeId: "options-host",
          occurrenceId: "options-host-occurrence",
          parentNodeId: "workspace",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "node-create",
          nodeId: "options-field",
          occurrenceId: "options-field-occurrence",
          parentNodeId: "workspace",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          intrinsicNodeType: "field-definition",
        },
        {
          kind: "shared-default-view-create",
          hostNodeId: "options-host",
          viewType: "table",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      ],
    });
    expect(published, JSON.stringify(published)).toMatchObject({ status: "published" });
    const optionsView = await currentView(source, "options-host");
    const options = await source.execute({
      kind: "edit",
      workspaceId: "workspace",
      invocationId: "view-options-sync",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "view-options-sync",
      actions: [
        {
          kind: "view-column-add",
          hostNodeId: "options-host",
          viewId: optionsView.viewId,
          fieldDefinitionId: "options-field",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "view-sort-add",
          hostNodeId: "options-host",
          viewId: optionsView.viewId,
          fieldDefinitionId: "options-field",
          direction: "ascending",
        },
        {
          kind: "view-group-add",
          hostNodeId: "options-host",
          viewId: optionsView.viewId,
          fieldDefinitionId: "options-field",
        },
      ],
    });
    expect(options, JSON.stringify(options)).toMatchObject({ status: "published" });
    await targetStore.replication.importUpdate(await sourceStore.replication.exportUpdate());
    const synced = rebuildGeneration("workspace", targetStore.snapshot(), versions).origin;
    expect(synced.sharedDefaultViewDefinitions["options-host"]?.[0]?.options).toMatchObject({
      columns: [{ fieldDefinitionId: "options-field" }],
      sort: { fieldDefinitionId: "options-field", direction: "ascending" },
      group: { fieldDefinitionId: "options-field" },
    });
    expect(synced.nodeOwners["options-field"]).toBe("workspace");
  });

  it("History receipt lineage remains local while compensating Facts enter sync", async () => {
    const store = await replica("101");
    await store.commit({
      invocationId: "local-history",
      request: { command: "create" },
      writes: [
        {
          kind: "edit",
          actorId: "actor",
          intent: "direct",
          actions: [{ kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null }],
        },
      ],
      lineage: {
        channelId: "private-desktop-channel",
        ordinal: 1,
        parentStepId: null,
        operation: "normal",
        targetStepId: null,
      },
      inverse: [],
      publishedFrontier: {},
    });
    const received = new LoroDoc();
    received.import(await store.replication.exportUpdate());
    const records = received
      .getList("facts")
      .toArray()
      .map((value) => value as { kind?: unknown; receipt?: unknown });
    expect(records).toHaveLength(1);
    expect(records.every((record) => record.kind !== undefined)).toBe(true);
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

  it("concurrent Template Field visibility writes converge without hiding the conflict", async () => {
    const directedEdges = [
      [0, 1],
      [1, 0],
      [0, 2],
      [2, 0],
      [1, 2],
      [2, 1],
    ] as const;
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) => runVisibilityTopology(shuffle(directedEdges, index + 41))),
    );
    for (const result of results) {
      expect(result).toEqual({
        visibility: "pinned",
        visibilityCandidates: ["normal", "pinned"],
        visibilityConflicted: true,
      });
    }
  });

  it("keeps concurrent opposite Resolutions out of Origin and visible in Review", async () => {
    const result = await runTopology([
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 0],
    ]);
    expect(new Set(result.factIds).size).toBe(result.factIds.length);
    expect(result.originNodeIds).toEqual(
      expect.arrayContaining([
        "direct-b",
        "direct-c",
        "system-definition-catalog:v1",
        "workspace",
        workspaceTrashNodeId("workspace"),
      ]),
    );
    expect(result.originNodeIds).not.toContain("proposal");
    expect(result.reviewNodeIds).toEqual(
      expect.arrayContaining([
        "direct-b",
        "direct-c",
        "proposal",
        "system-definition-catalog:v1",
        "workspace",
        workspaceTrashNodeId("workspace"),
      ]),
    );
    expect(result.reviewHunkCount).toBeGreaterThan(0);
  });

  it("requested exchange pushes a new tail and then converges", async () => {
    const a = await replica("101");
    const b = await replica("202");
    await a.commit({
      invocationId: "a",
      request: { command: "create" },
      writes: [
        {
          kind: "edit",
          actorId: "a",
          intent: "direct",
          actions: [{ kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null }],
        },
      ],
      lineage: null,
      inverse: [],
      publishedFrontier: {},
    });
    const remote = new FactReplication(b.replication);
    const transport = new CountingReplicaPeer(new InMemoryReplicaPeer(remote));
    const exchange = new SyncExchange(new FactReplication(a.replication), transport);
    await exchange.sync();
    await a.commit({
      invocationId: "tail",
      request: { command: "tail" },
      writes: [
        {
          kind: "edit",
          actorId: "a",
          intent: "direct",
          actions: [{ kind: "node-create", nodeId: "tail", ownerNodeId: "workspace", originalPlacement: null }],
        },
      ],
      lineage: null,
      inverse: [],
      publishedFrontier: a.snapshot().frontier,
    });
    expect(await new SyncExchange(new FactReplication(a.replication), transport).sync()).toMatchObject({ pushed: 1 });
    const bytesAfterTail = transport.sentBytes;
    expect(await new SyncExchange(new FactReplication(a.replication), transport).sync()).toEqual({
      pulled: 0,
      pushed: 0,
    });
    expect(transport.sentBytes).toBe(bytesAfterTail);
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it("restart preserves Fact-sync CRDT history and sends only a new tail", async () => {
    const documents = new InMemoryDocumentStore();
    const open = () =>
      FactAuthority.open({
        workspaceId: "workspace",
        loroPeerId: "404" as const,
        documents: documents,
      });
    let local = await open();
    const remote = await replica("505");
    for (let index = 0; index < 80; index += 1) {
      await local.commit({
        invocationId: `restart-${index}`,
        request: { index },
        writes: [
          {
            kind: "edit",
            actorId: "actor",
            intent: "direct",
            actions: [
              {
                kind: "node-create",
                nodeId: `restart-${index}`,
                ownerNodeId: "workspace",
                originalPlacement: null,
              },
            ],
          },
        ],
        lineage: null,
        inverse: [],
        publishedFrontier: local.snapshot().frontier,
      });
    }
    await syncPair(new FactReplication(local.replication), new FactReplication(remote.replication));
    local = await open();
    const transport = new CountingReplicaPeer(new InMemoryReplicaPeer(new FactReplication(remote.replication)));
    const exchange = new SyncExchange(new FactReplication(local.replication), transport);
    expect(await exchange.sync()).toEqual({ pulled: 0, pushed: 0 });
    expect(transport.sentBytes).toBe(0);
    await local.commit({
      invocationId: "restart-tail",
      request: { tail: true },
      writes: [
        {
          kind: "edit",
          actorId: "actor",
          intent: "direct",
          actions: [{ kind: "node-create", nodeId: "restart-tail", ownerNodeId: "workspace", originalPlacement: null }],
        },
      ],
      lineage: null,
      inverse: [],
      publishedFrontier: local.snapshot().frontier,
    });
    expect(await new SyncExchange(new FactReplication(local.replication), transport).sync()).toMatchObject({
      pushed: 1,
    });
    expect(transport.sentBytes).toBeGreaterThan(0);
    expect(transport.sentBytes).toBeLessThan(32_000);
  });
});

async function runVisibilityTopology(edges: readonly (readonly [number, number])[]) {
  const stores = await Promise.all([domainReplica("411"), domainReplica("422"), domainReplica("433")]);
  const composites = stores.map((store) => new FactReplication(store.replication));
  const setup = await Workspace.open({
    workspaceId: "workspace",
    facts: required(stores[0], "visibility setup store"),
    versions,
  });
  const setupResult = await setup.execute({
    kind: "edit",
    workspaceId: "workspace",
    invocationId: "visibility-setup",
    actorId: "setup",
    intent: "direct",
    historyChannelId: "template-field-visibility",
    actions: [
      {
        kind: "node-create",
        nodeId: "visibility-supertag",
        occurrenceId: "visibility-supertag-occurrence",
        parentNodeId: "workspace",
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        intrinsicNodeType: "supertag-definition",
      },
      {
        kind: "supertag-template-field-create",
        supertagId: "visibility-supertag",
        fieldDefinitionId: "visibility-field-definition",
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
      },
    ],
  });
  expect(setupResult, JSON.stringify(setupResult)).toMatchObject({ status: "published" });
  const visibilityField = await currentTemplateField(setup, "visibility-supertag");
  await syncPair(
    required(composites[0], "visibility first composite"),
    required(composites[1], "visibility second composite"),
  );
  await syncPair(
    required(composites[0], "visibility first composite"),
    required(composites[2], "visibility third composite"),
  );

  const workspaces = await Promise.all(
    stores.map((facts) => Workspace.open({ workspaceId: "workspace", facts, versions })),
  );
  const configure = async (index: 1 | 2, visibility: "normal" | "pinned") => {
    const workspace = required(workspaces[index], `visibility workspace ${index}`);
    const result = await workspace.execute({
      kind: "edit",
      workspaceId: "workspace",
      invocationId: `visibility-${visibility}`,
      actorId: `actor-${index}`,
      intent: "direct",
      historyChannelId: "template-field-visibility",
      actions: [
        {
          kind: "supertag-template-field-visibility-set",
          supertagId: "visibility-supertag",
          templateFieldId: visibilityField.factActionId,
          visibility,
        },
      ],
    });
    expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
  };
  await Promise.all([configure(1, "pinned").then(() => configure(1, "normal")), configure(2, "pinned")]);

  for (const [left, right] of edges) {
    await syncPair(
      required(composites[left], `visibility composite ${left}`),
      required(composites[right], `visibility composite ${right}`),
    );
  }
  await syncPair(
    required(composites[0], "visibility first composite"),
    required(composites[1], "visibility second composite"),
  );
  await syncPair(
    required(composites[1], "visibility second composite"),
    required(composites[2], "visibility third composite"),
  );
  await syncPair(
    required(composites[0], "visibility first composite"),
    required(composites[2], "visibility third composite"),
  );

  const snapshots = stores.map((store) => store.snapshot());
  expect(snapshots[1]).toEqual(snapshots[0]);
  expect(snapshots[2]).toEqual(snapshots[0]);
  const generation = rebuildGeneration("workspace", required(snapshots[0], "visibility snapshot"), versions);
  const field = generation.origin.templateFields["visibility-supertag"]?.[0];
  if (field === undefined) {
    throw new Error("Expected converged Template Field visibility");
  }
  return {
    visibility: field.visibility,
    visibilityCandidates: field.visibilityCandidates.map((candidate) => candidate.visibility).sort(),
    visibilityConflicted: field.visibilityConflicted,
  };
}

async function runTopology(edges: readonly (readonly [number, number])[]) {
  const stores = await Promise.all([domainReplica("101"), domainReplica("202"), domainReplica("303")]);
  const composites = stores.map((store) => new FactReplication(store.replication));
  await required(stores[0], "first store").commit({
    invocationId: "workspace-genesis",
    request: { command: "workspace-genesis" },
    writes: [genesisBody()],
    lineage: null,
    inverse: [],
    publishedFrontier: {},
  });
  await syncPair(required(composites[0], "first composite"), required(composites[1], "second composite"));
  await syncPair(required(composites[0], "first composite"), required(composites[2], "third composite"));
  const proposal = await required(stores[0], "first store").commit({
    invocationId: "proposal",
    request: { command: "proposal" },
    writes: [nodeTransaction("proposal", "a", "proposal")],
    lineage: null,
    inverse: [],
    publishedFrontier: required(stores[0], "first store").snapshot().frontier,
  });
  await syncPair(required(composites[0], "first composite"), required(composites[1], "second composite"));
  await syncPair(required(composites[0], "first composite"), required(composites[2], "third composite"));
  await required(stores[1], "second store").commit({
    invocationId: "b",
    request: { command: "b" },
    writes: [
      nodeTransaction("direct-b", "b", "direct"),
      {
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "b",
        decision: "accept",
        proposalFactIds: proposal.receipt.factIds,
      },
    ],
    lineage: null,
    inverse: [],
    publishedFrontier: required(stores[1], "second store").snapshot().frontier,
  });
  await required(stores[2], "third store").commit({
    invocationId: "c",
    request: { command: "c" },
    writes: [
      nodeTransaction("direct-c", "c", "direct"),
      {
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "c",
        decision: "reject",
        proposalFactIds: proposal.receipt.factIds,
      },
    ],
    lineage: null,
    inverse: [],
    publishedFrontier: required(stores[2], "third store").snapshot().frontier,
  });
  for (const [left, right] of edges) {
    await syncPair(required(composites[left], `composite ${left}`), required(composites[right], `composite ${right}`));
  }
  await syncPair(required(composites[0], "first composite"), required(composites[1], "second composite"));
  await syncPair(required(composites[1], "second composite"), required(composites[2], "third composite"));
  await syncPair(required(composites[0], "first composite"), required(composites[2], "third composite"));

  const snapshots = stores.map((store) => store.snapshot());
  expect(snapshots[1]).toEqual(snapshots[0]);
  expect(snapshots[2]).toEqual(snapshots[0]);
  const firstSnapshot = required(snapshots[0], "first snapshot");
  const generation = rebuildGeneration("workspace", firstSnapshot, versions);
  return {
    factIds: firstSnapshot.facts.map((fact) => fact.id).sort(),
    originNodeIds: Object.keys(generation.origin.nodes).sort(),
    reviewNodeIds: Object.keys(generation.review.nodes).sort(),
    reviewHunkCount: queryReview("workspace", firstSnapshot, generation).hunks.length,
  };
}

function genesisBody(): FactBody {
  return {
    kind: "edit",
    actorId: "workspace-genesis",
    intent: "direct",
    actions: workspaceGenesisActions("workspace"),
  };
}

async function currentTemplateField(workspace: Workspace, supertagId: string) {
  const projection = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: "templateFields",
  });
  if (!("templateFields" in projection)) {
    throw new Error("Expected Template Fields Projection");
  }
  return required(projection.templateFields[supertagId]?.[0], "Template Field");
}

async function currentView(workspace: Workspace, hostNodeId: string) {
  const projection = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: "sharedDefaultViewDefinitions",
  });
  if (!("sharedDefaultViewDefinitions" in projection)) {
    throw new Error("Expected View Definition Projection");
  }
  return required(projection.sharedDefaultViewDefinitions[hostNodeId]?.[0], "View Definition");
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function nodeTransaction(nodeId: string, actorId: string, intent: EditIntent): EditBody {
  return {
    kind: "edit",
    actorId,
    intent,
    actions: [
      {
        kind: "node-create",
        nodeId,
        ownerNodeId: "workspace",
        originalPlacement: {
          placementId: `${nodeId}-original`,
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      },
    ],
  };
}

class CountingReplicaPeer {
  sentBytes = 0;

  constructor(private readonly inner: InMemoryReplicaPeer) {}

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
