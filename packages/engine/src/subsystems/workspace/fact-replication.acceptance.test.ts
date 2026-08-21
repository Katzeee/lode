import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";

import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import type { EditMutation } from "../../domain/edit/index.js";
import {
  admitAuthorityRecordShapes,
  canonicalJson,
  detachedViewValueNodeId,
  detachedViewValueOccurrenceId,
  makeFact,
  parseMutation,
  NODE_SUPERTAGS_DEFINITION_NODE_ID,
  NODE_VIEWS_DEFINITION_NODE_ID,
  workspaceGenesisMutations,
  workspaceTrashNodeId,
  workspaceSchemaNodeId,
  type EditIntent,
  type FactBody,
  type FactTransactionPlan,
  type Mutation,
} from "../../domain/fact/index.js";
import { CURRENT_PROJECTION_VERSIONS as versions, rebuildGeneration, textAtoms } from "../../domain/reconcile/index.js";
import { queryReview } from "../../domain/review/index.js";
import { createReplicaId, FactAuthority } from "./authority/fact-authority.js";
import { Workspace } from "./workspace.js";
import { SyncExchange } from "../synchronization/sync-exchange.js";
import { FactReplication } from "./fact-replication.js";
import { InMemoryReplicaPeer, syncPair } from "../../../tests/support/sync.js";

async function replica(peerId: `${number}`, replicaId = createReplicaId()) {
  return FactAuthority.open({
    workspaceId: "workspace",
    replicaId,
    loroPeerId: peerId,
    authorityJournal: new InMemoryDocumentStore(),
    factReplication: new InMemoryDocumentStore(),
    admitRecords: admitAuthorityRecordShapes,
  });
}

async function domainReplica(peerId: `${number}`, replicaId = createReplicaId()) {
  return FactAuthority.open({
    workspaceId: "workspace",
    replicaId,
    loroPeerId: peerId,
    authorityJournal: new InMemoryDocumentStore(),
    factReplication: new InMemoryDocumentStore(),
    admitRecords: admitAuthorityRecords,
  });
}

describe("Fact-only production sync", () => {
  it("SYNC-1 only the authority FactAuthorityPort enters domain sync", async () => {
    const store = await replica("101");
    const composite = new FactReplication(store.replication);
    expect(composite.docs().map((doc) => doc.id)).toEqual(["facts"]);
  });

  it("keeps a partially replicated transaction invisible until every Fact arrives", async () => {
    const target = await replica("101", "aaaaaaaaaaaaaaaaaaaaaaaaaa");
    const replicaId = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
    const transactionId = `t1/workspace/${replicaId}/1`;
    const first = makeFact({
      workspaceId: "workspace",
      replicaId,
      sequence: 1,
      observed: {},
      lamport: 1,
      transaction: { transactionId, index: 0, size: 2 },
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "node" },
      },
    });
    const second = makeFact({
      workspaceId: "workspace",
      replicaId,
      sequence: 2,
      observed: { [replicaId]: 1 },
      lamport: 2,
      transaction: { transactionId, index: 1, size: 2 },
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: {
          kind: "occurrence-create",
          occurrenceId: "node-original",
          nodeId: "node",
          parentNodeId: "workspace",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      },
    });
    const remote = new LoroDoc();
    remote.setPeerId("202");
    const facts = remote.getMap<string>("facts");
    facts.set(`${first.id}/${first.contentDigest}`, canonicalJson({ recordKind: "fact", fact: first }));
    remote.commit({ message: "first transaction member" });
    const beforeSecond = remote.version();
    await target.replication.importUpdate(remote.export({ mode: "snapshot" }));

    expect(target.admission()).toMatchObject({
      kind: "pending",
      snapshot: { facts: [], frontier: {} },
      pendingTransactionIds: [transactionId],
    });

    facts.set(`${second.id}/${second.contentDigest}`, canonicalJson({ recordKind: "fact", fact: second }));
    remote.commit({ message: "complete transaction" });
    await target.replication.importUpdate(remote.export({ mode: "update", from: beforeSecond }));

    expect(target.admission()).toMatchObject({
      kind: "ready",
      snapshot: { facts: [{ id: first.id }, { id: second.id }], frontier: { [replicaId]: 2 } },
      pendingTransactionIds: [],
    });
  });

  it("conflicting content for one FactId fails closed during sync import", async () => {
    const replicaId = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const left = await replica("101", replicaId);
    const right = await replica("202", replicaId);
    await left.commit({
      invocationId: "common",
      request: { command: "common" },
      writes: [
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
    await right.replication.importUpdate(await left.replication.exportSnapshot());
    await left.commit({
      invocationId: "left",
      request: { command: "left" },
      writes: [
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
      writes: [
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
    const update = await left.replication.exportUpdate(await right.replication.version());

    await expect(right.replication.importUpdate(update)).rejects.toThrow(/content conflict/i);
    const faulted = right.admission();
    expect(faulted.kind).toBe("fault");
    expect(faulted.snapshot.facts).toHaveLength(2);
    await right.recoverToLastValidPrefix();
    expect(right.admission().kind).toBe("ready");
  });

  it("rejects a synced generic edit that would break a typed tuple role", async () => {
    const source = await replica("101", "aaaaaaaaaaaaaaaaaaaaaaaaaa");
    const target = await domainReplica("202", "bbbbbbbbbbbbbbbbbbbbbbbbbb");
    const commit = async (invocationId: string, writes: FactTransactionPlan[]): Promise<void> => {
      await source.commit({
        invocationId,
        request: { command: invocationId },
        writes,
        lineage: null,
        publishedFrontier: source.snapshot().frontier,
      });
    };
    await commit("workspace-genesis", [{ kind: "transaction", bodies: genesisBodies() }]);
    await commit("nodes", [nodeTransaction("host", "actor", "direct"), nodeTransaction("tag", "actor", "direct")]);
    await commit("tag-type", [
      directTransaction([
        { kind: "intrinsic-node-type-declare", nodeId: "tag", intrinsicNodeType: "supertag-definition" },
      ]),
    ]);
    await commit("application", [
      directTransaction([
        { kind: "node-create", nodeId: "host-metanode" },
        { kind: "node-owner-set", nodeId: "host-metanode", ownerNodeId: "host", previousOwnerNodeId: null },
        { kind: "metanode-attach", hostNodeId: "host", metanodeId: "host-metanode" },
        { kind: "node-create", nodeId: "application" },
        {
          kind: "node-owner-set",
          nodeId: "application",
          ownerNodeId: "host-metanode",
          previousOwnerNodeId: null,
        },
        {
          kind: "occurrence-create",
          occurrenceId: "application-occurrence",
          nodeId: "application",
          parentNodeId: "host-metanode",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "occurrence-create",
          occurrenceId: "relation-definition-occurrence",
          nodeId: NODE_SUPERTAGS_DEFINITION_NODE_ID,
          parentNodeId: "application",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "occurrence-create",
          occurrenceId: "definition-occurrence",
          nodeId: "tag",
          parentNodeId: "application",
          anchor: { after: "relation-definition-occurrence", before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "supertag-apply",
          hostNodeId: "host",
          supertagId: "tag",
          applicationNodeId: "application",
          applicationOccurrenceId: "application-occurrence",
          relationDefinitionOccurrenceId: "relation-definition-occurrence",
          definitionOccurrenceId: "definition-occurrence",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      ]),
    ]);
    await target.replication.importUpdate(await source.replication.exportSnapshot());
    expect(target.admission().kind).toBe("ready");

    await commit("malformed-role-edit", [
      directTransaction([
        {
          kind: "occurrence-delete",
          occurrenceId: "definition-occurrence",
          previousParentNodeId: "application",
          previousAnchor: {
            after: "relation-definition-occurrence",
            before: null,
            affinity: "after",
            fallback: "end",
          },
        },
      ]),
    ]);
    await expect(
      target.replication.importUpdate(await source.replication.exportUpdate(await target.replication.version())),
    ).rejects.toThrow(/Structural role requires a typed mutation/);
    const admission = target.admission();
    expect(admission.kind).toBe("fault");
    if (admission.kind !== "fault") {
      throw new Error("Expected structural-role sync import to fault the target");
    }
    expect(admission.fault).toMatch(/typed mutation/);
  });

  it("rejects a synced typed Metanode attachment that also places the Metanode in the outline", async () => {
    const source = await replica("101", "aaaaaaaaaaaaaaaaaaaaaaaaaa");
    const target = await domainReplica("202", "bbbbbbbbbbbbbbbbbbbbbbbbbb");
    const commit = async (invocationId: string, writes: FactTransactionPlan[]): Promise<void> => {
      await source.commit({
        invocationId,
        request: { command: invocationId },
        writes,
        lineage: null,
        publishedFrontier: source.snapshot().frontier,
      });
    };
    await commit("workspace-genesis", [{ kind: "transaction", bodies: genesisBodies() }]);
    await commit("host", [nodeTransaction("host", "actor", "direct")]);
    await target.replication.importUpdate(await source.replication.exportSnapshot());
    expect(target.admission().kind).toBe("ready");

    await commit("malformed-metanode", [
      directTransaction([
        { kind: "node-create", nodeId: "host-configuration" },
        {
          kind: "node-owner-set",
          nodeId: "host-configuration",
          ownerNodeId: "host",
          previousOwnerNodeId: null,
        },
        { kind: "metanode-attach", hostNodeId: "host", metanodeId: "host-configuration" },
        {
          kind: "occurrence-create",
          occurrenceId: "host-configuration-occurrence",
          nodeId: "host-configuration",
          parentNodeId: "host",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      ]),
    ]);
    await expect(
      target.replication.importUpdate(await source.replication.exportUpdate(await target.replication.version())),
    ).rejects.toThrow(/Metanode structure is invalid/);
    expect(target.admission()).toMatchObject({
      kind: "fault",
      fault: "Metanode structure is invalid: host-configuration",
    });
  });

  it("rejects a synced View mode transaction that also rewrites the protected Definition Intrinsic Node Type", async () => {
    const source = await replica("101", "aaaaaaaaaaaaaaaaaaaaaaaaaa");
    const target = await domainReplica("202", "bbbbbbbbbbbbbbbbbbbbbbbbbb");
    const commit = async (invocationId: string, writes: FactTransactionPlan[]): Promise<void> => {
      await source.commit({
        invocationId,
        request: { command: invocationId },
        writes,
        lineage: null,
        publishedFrontier: source.snapshot().frontier,
      });
    };
    await commit("workspace-genesis", [{ kind: "transaction", bodies: genesisBodies() }]);
    await commit("view-host", [nodeTransaction("host", "actor", "direct")]);
    await commit("view-attachment", [
      directTransaction([
        { kind: "node-create", nodeId: "host-metanode" },
        { kind: "node-owner-set", nodeId: "host-metanode", ownerNodeId: "host", previousOwnerNodeId: null },
        { kind: "metanode-attach", hostNodeId: "host", metanodeId: "host-metanode" },
        { kind: "node-create", nodeId: "view-attachment" },
        {
          kind: "node-owner-set",
          nodeId: "view-attachment",
          ownerNodeId: "host-metanode",
          previousOwnerNodeId: null,
        },
        { kind: "node-create", nodeId: "view-definition" },
        {
          kind: "node-owner-set",
          nodeId: "view-definition",
          ownerNodeId: "view-attachment",
          previousOwnerNodeId: null,
        },
        {
          kind: "occurrence-create",
          occurrenceId: "view-attachment-occurrence",
          nodeId: "view-attachment",
          parentNodeId: "host-metanode",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "occurrence-create",
          occurrenceId: "view-relation-definition-occurrence",
          nodeId: NODE_VIEWS_DEFINITION_NODE_ID,
          parentNodeId: "view-attachment",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "occurrence-create",
          occurrenceId: "view-definition-occurrence",
          nodeId: "view-definition",
          parentNodeId: "view-attachment",
          anchor: {
            after: "view-relation-definition-occurrence",
            before: null,
            affinity: "after",
            fallback: "end",
          },
        },
        {
          kind: "shared-default-view-definition-attach",
          hostNodeId: "host",
          attachmentNodeId: "view-attachment",
          attachmentOccurrenceId: "view-attachment-occurrence",
          relationDefinitionOccurrenceId: "view-relation-definition-occurrence",
          viewDefinitionNodeId: "view-definition",
          viewDefinitionOccurrenceId: "view-definition-occurrence",
        },
        {
          kind: "shared-default-view-definition-mode-set",
          viewDefinitionNodeId: "view-definition",
          viewType: "outline",
          previousViewType: null,
          observedModeFactIds: [],
        },
      ]),
    ]);
    await target.replication.importUpdate(await source.replication.exportSnapshot());
    expect(target.admission().kind).toBe("ready");
    const initialMode = source
      .snapshot()
      .facts.find(
        (fact) =>
          fact.body.kind === "contribution" && fact.body.mutation.kind === "shared-default-view-definition-mode-set",
      );
    if (!initialMode) {
      throw new Error("Expected initial View mode Fact");
    }

    await commit("malformed-view-mode", [
      directTransaction([
        {
          kind: "shared-default-view-definition-mode-set",
          viewDefinitionNodeId: "view-definition",
          viewType: "table",
          previousViewType: "outline",
          observedModeFactIds: [initialMode.id],
        },
        { kind: "intrinsic-node-type-declare", nodeId: "view-definition", intrinsicNodeType: "supertag-definition" },
      ]),
    ]);
    await expect(
      target.replication.importUpdate(await source.replication.exportUpdate(await target.replication.version())),
    ).rejects.toThrow(/Structural role requires a typed mutation: Intrinsic Node Type view-definition/);
    expect(target.admission()).toMatchObject({
      kind: "fault",
      fault: "Structural role requires a typed mutation: Intrinsic Node Type view-definition",
    });
  });

  it("rejects synced Template Field discoverability that carries an Intrinsic Node Type rewrite", async () => {
    const sourceStore = await replica("611", "cccccccccccccccccccccccccc");
    const source = await Workspace.open({ workspaceId: "workspace", facts: sourceStore, versions });
    const target = await domainReplica("612", "dddddddddddddddddddddddddd");
    const published = await source.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "template-field-fixture",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "template-field",
      mutations: [
        {
          kind: "node-create",
          nodeId: "sync-supertag",
          occurrenceId: "sync-supertag-original",
          parentNodeId: "workspace",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          intrinsicNodeType: "supertag-definition",
        },
        {
          kind: "supertag-template-field-create",
          supertagId: "sync-supertag",
          templateFieldNodeId: "sync-template-field",
          templateFieldOccurrenceId: "sync-template-field-occurrence",
          fieldDefinitionId: "sync-field-definition",
          definitionOccurrenceId: "sync-field-definition-occurrence",
          staticDefaultValueNodeId: "sync-static-default",
          staticDefaultValueOccurrenceId: "sync-static-default-occurrence",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      ],
    });
    expect(published, JSON.stringify(published)).toMatchObject({ status: "published" });
    await target.replication.importUpdate(await sourceStore.replication.exportSnapshot());
    expect(target.admission().kind).toBe("ready");

    await sourceStore.commit({
      invocationId: "smuggled-template-field-type",
      request: { command: "smuggled-template-field-type" },
      writes: [
        directTransaction([
          {
            kind: "supertag-template-field-discoverability-set",
            supertagId: "sync-supertag",
            templateFieldNodeId: "sync-template-field",
            fieldDefinitionId: "sync-field-definition",
            discoverable: true,
            previousDiscoverable: false,
          },
          {
            kind: "node-owner-set",
            nodeId: "sync-field-definition",
            ownerNodeId: workspaceSchemaNodeId("workspace"),
            previousOwnerNodeId: "sync-template-field",
          },
          {
            kind: "intrinsic-node-type-declare",
            nodeId: "sync-field-definition",
            intrinsicNodeType: "supertag-definition",
          },
          {
            kind: "intrinsic-node-type-declare",
            nodeId: "sync-field-definition",
            intrinsicNodeType: "field-definition",
          },
        ]),
      ],
      lineage: null,
      publishedFrontier: sourceStore.snapshot().frontier,
    });
    await expect(
      target.replication.importUpdate(await sourceStore.replication.exportUpdate(await target.replication.version())),
    ).rejects.toThrow(/Structural role requires a typed mutation: Intrinsic Node Type sync-field-definition/);
    const admission = target.admission();
    expect(admission.kind).toBe("fault");
    if (admission.kind !== "fault") {
      throw new Error("Expected Template Field sync import to quarantine the target");
    }
    expect(
      rebuildGeneration("workspace", admission.snapshot, versions).origin.nodes["sync-field-definition"]
        ?.intrinsicNodeType,
    ).toBe("field-definition");
  });

  it("syncs a same-Definition Template Field re-add and rejects authority smuggled through its narrower Fact", async () => {
    const sourceStore = await replica("621", "eeeeeeeeeeeeeeeeeeeeeeeeee");
    const source = await Workspace.open({ workspaceId: "workspace", facts: sourceStore, versions });
    const target = await domainReplica("622", "ffffffffffffffffffffffffff");
    const publish = async (invocationId: string, mutations: readonly EditMutation[]) => {
      const result = await source.execute({
        kind: "mutate",
        workspaceId: "workspace",
        invocationId,
        actorId: "actor",
        intent: "direct",
        historyChannelId: "template-field-sync",
        mutations,
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
        templateFieldNodeId: "sync-template-field",
        templateFieldOccurrenceId: "sync-template-field-occurrence",
        fieldDefinitionId: "sync-field-definition",
        definitionOccurrenceId: "sync-field-definition-occurrence",
        staticDefaultValueNodeId: "sync-static-default",
        staticDefaultValueOccurrenceId: "sync-static-default-occurrence",
        anchor: end,
      },
    ]);
    await publish("same-definition-discoverable", [
      {
        kind: "supertag-template-field-make-discoverable",
        supertagId: "sync-supertag",
        templateFieldNodeId: "sync-template-field",
        fieldDefinitionId: "sync-field-definition",
      },
    ]);
    await publish("same-definition-remove", [
      {
        kind: "supertag-template-field-remove",
        supertagId: "sync-supertag",
        templateFieldNodeId: "sync-template-field",
      },
    ]);
    await publish("same-definition-readd", [
      {
        kind: "supertag-template-field-add-existing",
        supertagId: "sync-supertag",
        templateFieldNodeId: "sync-template-field-readded",
        templateFieldOccurrenceId: "sync-template-field-readded-occurrence",
        fieldDefinitionId: "sync-field-definition",
        definitionOccurrenceId: "sync-field-definition-readded-occurrence",
        staticDefaultValueNodeId: "sync-static-default-readded",
        staticDefaultValueOccurrenceId: "sync-static-default-readded-occurrence",
        anchor: end,
      },
    ]);

    expect(
      sourceStore
        .snapshot()
        .facts.some(
          (fact) =>
            fact.body.kind === "contribution" && fact.body.mutation.kind === "supertag-template-field-existing-attach",
        ),
    ).toBe(true);
    await target.replication.importUpdate(await sourceStore.replication.exportSnapshot());
    expect(target.admission().kind).toBe("ready");
    const synced = rebuildGeneration("workspace", target.snapshot(), versions).origin;
    expect(synced.templateFields["sync-supertag"]).toEqual([
      expect.objectContaining({
        templateFieldNodeId: "sync-template-field-readded",
        fieldDefinitionId: "sync-field-definition",
        fieldDefinitionOwner: "workspace-schema",
      }),
    ]);
    expect(synced.nodeOwners["sync-template-field"]).toBe(workspaceTrashNodeId("workspace"));
    expect(synced.nodeOwners["sync-template-field-readded"]).toBe("sync-supertag");
    expect(synced.nodeOwners["sync-field-definition"]).toBe(workspaceSchemaNodeId("workspace"));

    await sourceStore.commit({
      invocationId: "smuggled-existing-template-field-authority",
      request: { command: "smuggled-existing-template-field-authority" },
      writes: [
        directTransaction([
          {
            kind: "supertag-template-field-existing-attach",
            supertagId: "sync-supertag",
            templateFieldNodeId: "sync-template-field-readded",
            templateFieldOccurrenceId: "sync-template-field-readded-occurrence",
            fieldDefinitionId: "sync-field-definition",
            definitionOccurrenceId: "sync-field-definition-readded-occurrence",
            staticDefaultValueNodeId: "sync-static-default-readded",
            staticDefaultValueOccurrenceId: "sync-static-default-readded-occurrence",
            anchor: end,
          },
          {
            kind: "node-owner-set",
            nodeId: "sync-field-definition",
            ownerNodeId: "sync-template-field-readded",
            previousOwnerNodeId: workspaceSchemaNodeId("workspace"),
          },
        ]),
      ],
      lineage: null,
      publishedFrontier: sourceStore.snapshot().frontier,
    });
    await expect(
      target.replication.importUpdate(await sourceStore.replication.exportUpdate(await target.replication.version())),
    ).rejects.toThrow(/Structural role requires a typed mutation: Owner sync-field-definition/);
    expect(target.admission()).toMatchObject({
      kind: "fault",
      fault: "Structural role requires a typed mutation: Owner sync-field-definition",
    });
  });

  it("syncs a public Static Default edit and rejects Owner authority smuggled through its text Fact", async () => {
    const sourceStore = await replica("641", "cdcdcdcdcdcdcdcdcdcdcdcdcd");
    const source = await Workspace.open({ workspaceId: "workspace", facts: sourceStore, versions });
    const target = await domainReplica("642", "dcdcdcdcdcdcdcdcdcdcdcdcdc");
    const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
    const execute = async (invocationId: string, mutations: readonly EditMutation[]) => {
      const result = await source.execute({
        kind: "mutate",
        workspaceId: "workspace",
        invocationId,
        actorId: "actor",
        intent: "direct",
        historyChannelId: "template-field-static-default-sync",
        mutations,
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
        templateFieldNodeId: "static-default-sync-template-field",
        templateFieldOccurrenceId: "static-default-sync-template-field-occurrence",
        fieldDefinitionId: "static-default-sync-definition",
        definitionOccurrenceId: "static-default-sync-definition-occurrence",
        staticDefaultValueNodeId: "static-default-sync-value",
        staticDefaultValueOccurrenceId: "static-default-sync-value-occurrence",
        anchor: end,
      },
    ]);
    await execute("static-default-sync-set", [
      {
        kind: "supertag-template-field-static-default-set",
        supertagId: "static-default-sync-supertag",
        templateFieldNodeId: "static-default-sync-template-field",
        value: "Alpha",
      },
    ]);

    await target.replication.importUpdate(await sourceStore.replication.exportSnapshot());
    expect(target.admission().kind).toBe("ready");
    let synced = rebuildGeneration("workspace", target.snapshot(), versions).origin;
    expect(
      textAtoms(synced.nodes["static-default-sync-value"])
        .map((atom) => atom.value)
        .join(""),
    ).toBe("Alpha");
    expect(synced.nodeOwners["static-default-sync-value"]).toBe("static-default-sync-template-field");

    const sourceProjection = rebuildGeneration("workspace", sourceStore.snapshot(), versions).origin;
    const alphaAtoms = textAtoms(sourceProjection.nodes["static-default-sync-value"]);
    await sourceStore.commit({
      invocationId: "smuggled-static-default-owner",
      request: { command: "smuggled-static-default-owner" },
      writes: [
        directTransaction([
          {
            kind: "text-splice",
            nodeId: "static-default-sync-value",
            deleteAtomIds: alphaAtoms.map((atom) => atom.id),
            deletedAtoms: alphaAtoms.map((atom) => ({
              id: atom.id,
              value: atom.value,
              attributes: atom.attributes,
            })),
            anchor: end,
            insert: "Beta",
          },
          {
            kind: "node-owner-set",
            nodeId: "static-default-sync-value",
            ownerNodeId: "workspace",
            previousOwnerNodeId: "static-default-sync-template-field",
          },
        ]),
      ],
      lineage: null,
      publishedFrontier: sourceStore.snapshot().frontier,
    });
    await expect(
      target.replication.importUpdate(await sourceStore.replication.exportUpdate(await target.replication.version())),
    ).rejects.toThrow(/Structural role requires a typed mutation: Owner static-default-sync-value/);
    const fault = target.admission();
    expect(fault.kind).toBe("fault");
    if (fault.kind !== "fault") {
      throw new Error("Expected Static Default sync import to quarantine the target");
    }
    synced = rebuildGeneration("workspace", fault.snapshot, versions).origin;
    expect(
      textAtoms(synced.nodes["static-default-sync-value"])
        .map((atom) => atom.value)
        .join(""),
    ).toBe("Alpha");
    expect(synced.nodeOwners["static-default-sync-value"]).toBe("static-default-sync-template-field");
  });

  it("rejects ownership authority smuggled through a Template Field visibility Fact", async () => {
    const sourceStore = await replica("631", "ababababababababababababab");
    const source = await Workspace.open({ workspaceId: "workspace", facts: sourceStore, versions });
    const target = await domainReplica("632", "bababababababababababababa");
    const execute = async (invocationId: string, mutations: readonly EditMutation[]) => {
      const result = await source.execute({
        kind: "mutate",
        workspaceId: "workspace",
        invocationId,
        actorId: "actor",
        intent: "direct",
        historyChannelId: "template-field-visibility-sync",
        mutations,
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
        templateFieldNodeId: "visibility-sync-template-field",
        templateFieldOccurrenceId: "visibility-sync-template-field-occurrence",
        fieldDefinitionId: "visibility-sync-field-definition",
        definitionOccurrenceId: "visibility-sync-field-definition-occurrence",
        staticDefaultValueNodeId: "visibility-sync-default",
        staticDefaultValueOccurrenceId: "visibility-sync-default-occurrence",
        anchor: end,
      },
    ]);
    await execute("visibility-sync-pinned", [
      {
        kind: "supertag-template-field-visibility-set",
        supertagId: "visibility-sync-supertag",
        templateFieldNodeId: "visibility-sync-template-field",
        visibility: "pinned",
      },
    ]);
    await target.replication.importUpdate(await sourceStore.replication.exportSnapshot());
    expect(target.admission().kind).toBe("ready");
    const observedVisibilityFact = sourceStore
      .snapshot()
      .facts.find(
        (fact) =>
          fact.body.kind === "contribution" &&
          fact.body.mutation.kind === "supertag-template-field-visibility-configure",
      );
    if (observedVisibilityFact === undefined) {
      throw new Error("Expected pinned Template Field visibility Fact");
    }

    await sourceStore.commit({
      invocationId: "smuggled-template-field-visibility-authority",
      request: { command: "smuggled-template-field-visibility-authority" },
      writes: [
        directTransaction([
          {
            kind: "supertag-template-field-visibility-configure",
            supertagId: "visibility-sync-supertag",
            templateFieldNodeId: "visibility-sync-template-field",
            fieldDefinitionId: "visibility-sync-field-definition",
            visibility: "normal",
            previousVisibility: "pinned",
            observedVisibilityFactIds: [observedVisibilityFact.id],
          },
          {
            kind: "node-owner-set",
            nodeId: "visibility-sync-field-definition",
            ownerNodeId: "workspace",
            previousOwnerNodeId: "visibility-sync-template-field",
          },
        ]),
      ],
      lineage: null,
      publishedFrontier: sourceStore.snapshot().frontier,
    });
    await expect(
      target.replication.importUpdate(await sourceStore.replication.exportUpdate(await target.replication.version())),
    ).rejects.toThrow(/Structural role requires a typed mutation: Owner visibility-sync-field-definition/);
  });

  it("rejects a synced View Sort transaction that also rewrites the protected Definition Intrinsic Node Type", async () => {
    const sourceStore = await replica("101", "aaaaaaaaaaaaaaaaaaaaaaaaaa");
    const source = await Workspace.open({ workspaceId: "workspace", facts: sourceStore, versions });
    const target = await domainReplica("202", "bbbbbbbbbbbbbbbbbbbbbbbbbb");
    const publish = async (command: Parameters<Workspace["execute"]>[0]): Promise<void> => {
      const result = await source.execute(command);
      expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
    };
    await publish({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "view-sort-fixture",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "fixture",
      mutations: [
        {
          kind: "node-create",
          nodeId: "host",
          occurrenceId: "host-occurrence",
          parentNodeId: "workspace",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "shared-default-view-definition-create",
          hostNodeId: "host",
          metanodeId: "host-metanode",
          attachmentNodeId: "view-attachment",
          attachmentOccurrenceId: "view-attachment-occurrence",
          relationDefinitionOccurrenceId: "view-relation-definition-occurrence",
          viewDefinitionNodeId: "view-definition",
          viewDefinitionOccurrenceId: "view-definition-occurrence",
          viewType: "outline",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      ],
    });
    await publish({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "view-sort",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "view-sort",
      mutations: [
        {
          kind: "shared-default-view-definition-sort-by-name-create",
          hostNodeId: "host",
          viewDefinitionNodeId: "view-definition",
          sortOrderFieldNodeId: "sort-order",
          sortOrderFieldOccurrenceId: "sort-order-occurrence",
          sortFieldNodeId: "sort-field",
          sortFieldOccurrenceId: "sort-field-occurrence",
          nodeNameOccurrenceId: "sort-node-name-occurrence",
          ascendingOccurrenceId: "sort-ascending-occurrence",
        },
      ],
    });
    const history = await source.query({ kind: "history", workspaceId: "workspace", channelId: "view-sort" });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Expected View Sort Undo evidence");
    }
    const [firstCompensation, ...restCompensations] = history.undo.evidence.compensations.map((mutation) =>
      parseMutation(mutation),
    );
    if (firstCompensation === undefined) {
      throw new Error("Expected View Sort Undo compensations");
    }
    await target.replication.importUpdate(await sourceStore.replication.exportSnapshot());
    expect(target.admission().kind).toBe("ready");

    await sourceStore.commit({
      invocationId: "malformed-view-sort",
      request: { command: "malformed-view-sort" },
      writes: [
        directTransaction([
          firstCompensation,
          ...restCompensations,
          { kind: "intrinsic-node-type-declare", nodeId: "view-definition", intrinsicNodeType: "supertag-definition" },
        ]),
      ],
      lineage: null,
      publishedFrontier: sourceStore.snapshot().frontier,
    });
    await expect(
      target.replication.importUpdate(await sourceStore.replication.exportUpdate(await target.replication.version())),
    ).rejects.toThrow(/Structural role requires a typed mutation: Intrinsic Node Type view-definition/);
    expect(target.admission()).toMatchObject({
      kind: "fault",
      fault: "Structural role requires a typed mutation: Intrinsic Node Type view-definition",
    });
  });

  it("syncs a public View removal as its complete removal graph", async () => {
    const sourceStore = await domainReplica("101", "aaaaaaaaaaaaaaaaaaaaaaaaaa");
    const targetStore = await domainReplica("202", "bbbbbbbbbbbbbbbbbbbbbbbbbb");
    const source = await Workspace.open({ workspaceId: "workspace", facts: sourceStore, versions });
    await Workspace.open({ workspaceId: "workspace", facts: targetStore, versions });
    await source.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "view-sync-fixture",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "view-sync",
      mutations: [
        {
          kind: "node-create",
          nodeId: "host",
          occurrenceId: "host-original",
          parentNodeId: "workspace",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        {
          kind: "shared-default-view-definition-create",
          hostNodeId: "host",
          metanodeId: "host-metanode",
          attachmentNodeId: "host-view-attachment",
          attachmentOccurrenceId: "host-view-attachment-occurrence",
          relationDefinitionOccurrenceId: "host-view-attachment-definition",
          viewDefinitionNodeId: "host-view",
          viewDefinitionOccurrenceId: "host-view-occurrence",
          viewType: "table",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      ],
    });
    await targetStore.replication.importUpdate(await sourceStore.replication.exportSnapshot());
    const attached = rebuildGeneration("workspace", targetStore.snapshot(), versions).origin;
    expect(attached.sharedDefaultViewDefinitions.host?.[0]).toMatchObject({
      viewDefinitionNodeId: "host-view",
      viewType: "table",
    });

    const removal = await source.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "view-sync-remove",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "view-sync",
      mutations: [
        {
          kind: "shared-default-view-definition-remove",
          hostNodeId: "host",
          attachmentNodeId: "host-view-attachment",
          attachmentOccurrenceId: "host-view-attachment-occurrence",
          relationDefinitionOccurrenceId: "host-view-attachment-definition",
          viewDefinitionNodeId: "host-view",
          viewDefinitionOccurrenceId: "host-view-occurrence",
        },
      ],
    });
    expect(removal, JSON.stringify(removal)).toMatchObject({ status: "published" });
    await targetStore.replication.importUpdate(await sourceStore.replication.exportSnapshot());

    const generation = rebuildGeneration("workspace", targetStore.snapshot(), versions);
    expect(generation.origin.sharedDefaultViewDefinitions.host).toBeUndefined();
    expect(generation.origin.nodeOwners["host-view-attachment"]).toBe(workspaceTrashNodeId("workspace"));
    expect(generation.origin.nodeOwners["host-view"]).toBe(workspaceTrashNodeId("workspace"));
    expect(generation.origin.nodeOwners[detachedViewValueNodeId("host-view-attachment")]).toBe("host-view-attachment");
    expect(generation.origin.childOccurrences["host-view-attachment"]).toEqual([
      "host-view-attachment-definition",
      detachedViewValueOccurrenceId("host-view-attachment"),
    ]);
  });

  it("syncs typed View options and rejects a compensation transaction that smuggles Field Definition ownership", async () => {
    const sourceStore = await replica("101", "cccccccccccccccccccccccccc");
    const targetStore = await domainReplica("202", "dddddddddddddddddddddddddd");
    const source = await Workspace.open({ workspaceId: "workspace", facts: sourceStore, versions });
    await Workspace.open({ workspaceId: "workspace", facts: targetStore, versions });
    const published = await source.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "view-options-sync-fixture",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "view-options-sync",
      mutations: [
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
          kind: "shared-default-view-definition-create",
          hostNodeId: "options-host",
          metanodeId: "options-host-metanode",
          attachmentNodeId: "options-view-attachment",
          attachmentOccurrenceId: "options-view-attachment-occurrence",
          relationDefinitionOccurrenceId: "options-view-attachment-definition",
          viewDefinitionNodeId: "options-view",
          viewDefinitionOccurrenceId: "options-view-occurrence",
          viewType: "table",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      ],
    });
    expect(published, JSON.stringify(published)).toMatchObject({ status: "published" });
    const options = await source.execute({
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: "view-options-sync",
      actorId: "actor",
      intent: "direct",
      historyChannelId: "view-options-sync",
      mutations: [
        {
          kind: "shared-default-view-definition-options-update",
          hostNodeId: "options-host",
          viewDefinitionNodeId: "options-view",
          options: {
            columns: [{ columnNodeId: "options-column", fieldDefinitionId: "options-field" }],
            filter: null,
            sort: { sortNodeId: "options-sort", fieldDefinitionId: "options-field", direction: "ascending" },
            group: { groupNodeId: "options-group", fieldDefinitionId: "options-field" },
          },
        },
      ],
    });
    expect(options, JSON.stringify(options)).toMatchObject({ status: "published" });
    await targetStore.replication.importUpdate(await sourceStore.replication.exportSnapshot());
    const synced = rebuildGeneration("workspace", targetStore.snapshot(), versions).origin;
    expect(synced.sharedDefaultViewDefinitions["options-host"]?.[0]?.options).toMatchObject({
      columns: [{ columnNodeId: "options-column", fieldDefinitionId: "options-field" }],
      sort: { sortNodeId: "options-sort", direction: "ascending" },
      group: { groupNodeId: "options-group" },
    });
    expect(synced.nodeOwners["options-field"]).toBe("workspace");

    const history = await source.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "view-options-sync",
    });
    if (!("undo" in history) || history.undo === null) {
      throw new Error("Expected View options Undo evidence");
    }
    const compensations = history.undo.evidence.compensations.map((mutation) => parseMutation(mutation));
    const firstCompensation = compensations[0];
    if (firstCompensation === undefined) {
      throw new Error("Expected View options compensation evidence");
    }
    await sourceStore.commit({
      invocationId: "malformed-view-options",
      request: { command: "malformed-view-options" },
      writes: [
        directTransaction([
          firstCompensation,
          ...compensations.slice(1),
          {
            kind: "node-owner-set",
            nodeId: "options-field",
            ownerNodeId: "options-view",
            previousOwnerNodeId: "workspace",
          },
        ]),
      ],
      lineage: null,
      publishedFrontier: sourceStore.snapshot().frontier,
    });
    await expect(
      targetStore.replication.importUpdate(
        await sourceStore.replication.exportUpdate(await targetStore.replication.version()),
      ),
    ).rejects.toThrow(/Structural role requires a typed mutation: Owner options-field/);
  });

  it("History receipt lineage remains local while compensating Facts enter sync", async () => {
    const store = await replica("101");
    await store.commit({
      invocationId: "local-history",
      request: { command: "create" },
      writes: [
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
    received.import(await store.replication.exportSnapshot());
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
          kind: "contribution",
          actorId: "a",
          intent: "direct",
          mutation: { kind: "node-create", nodeId: "node" },
        },
      ],
      lineage: null,
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
          kind: "contribution",
          actorId: "a",
          intent: "direct",
          mutation: { kind: "node-create", nodeId: "tail" },
        },
      ],
      lineage: null,
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
    const replicaId = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const open = () =>
      FactAuthority.open({
        workspaceId: "workspace",
        replicaId,
        loroPeerId: "404" as const,
        authorityJournal: documents,
        factReplication: documents,
        admitRecords: admitAuthorityRecordShapes,
      });
    let local = await open();
    const remote = await replica("505", "bbbbbbbbbbbbbbbbbbbbbbbbbb");
    for (let index = 0; index < 80; index += 1) {
      await local.commit({
        invocationId: `restart-${index}`,
        request: { index },
        writes: [
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
          kind: "contribution",
          actorId: "actor",
          intent: "direct",
          mutation: { kind: "node-create", nodeId: "restart-tail" },
        },
      ],
      lineage: null,
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
  const stores = await Promise.all([
    domainReplica("411", "dddddddddddddddddddddddddd"),
    domainReplica("422", "eeeeeeeeeeeeeeeeeeeeeeeeee"),
    domainReplica("433", "ffffffffffffffffffffffffff"),
  ]);
  const composites = stores.map((store) => new FactReplication(store.replication));
  const setup = await Workspace.open({
    workspaceId: "workspace",
    facts: required(stores[0], "visibility setup store"),
    versions,
  });
  const setupResult = await setup.execute({
    kind: "mutate",
    workspaceId: "workspace",
    invocationId: "visibility-setup",
    actorId: "setup",
    intent: "direct",
    historyChannelId: "template-field-visibility",
    mutations: [
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
        templateFieldNodeId: "visibility-template-field",
        templateFieldOccurrenceId: "visibility-template-field-occurrence",
        fieldDefinitionId: "visibility-field-definition",
        definitionOccurrenceId: "visibility-field-definition-occurrence",
        staticDefaultValueNodeId: "visibility-default",
        staticDefaultValueOccurrenceId: "visibility-default-occurrence",
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
      },
    ],
  });
  expect(setupResult, JSON.stringify(setupResult)).toMatchObject({ status: "published" });
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
      kind: "mutate",
      workspaceId: "workspace",
      invocationId: `visibility-${visibility}`,
      actorId: `actor-${index}`,
      intent: "direct",
      historyChannelId: "template-field-visibility",
      mutations: [
        {
          kind: "supertag-template-field-visibility-set",
          supertagId: "visibility-supertag",
          templateFieldNodeId: "visibility-template-field",
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
  const stores = await Promise.all([
    domainReplica("101", "aaaaaaaaaaaaaaaaaaaaaaaaaa"),
    domainReplica("202", "bbbbbbbbbbbbbbbbbbbbbbbbbb"),
    domainReplica("303", "cccccccccccccccccccccccccc"),
  ]);
  const composites = stores.map((store) => new FactReplication(store.replication));
  await required(stores[0], "first store").commit({
    invocationId: "workspace-genesis",
    request: { command: "workspace-genesis" },
    writes: [
      {
        kind: "transaction",
        bodies: genesisBodies(),
      },
    ],
    lineage: null,
    publishedFrontier: {},
  });
  await syncPair(required(composites[0], "first composite"), required(composites[1], "second composite"));
  await syncPair(required(composites[0], "first composite"), required(composites[2], "third composite"));
  const proposal = await required(stores[0], "first store").commit({
    invocationId: "proposal",
    request: { command: "proposal" },
    writes: [nodeTransaction("proposal", "a", "proposal")],
    lineage: null,
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
        proposalContributionIds: proposal.receipt.factIds,
      },
    ],
    lineage: null,
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
        proposalContributionIds: proposal.receipt.factIds,
      },
    ],
    lineage: null,
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

function genesisBodies(): readonly [FactBody, ...FactBody[]] {
  const [first, ...rest] = workspaceGenesisMutations("workspace");
  const body = (mutation: typeof first): FactBody => ({
    kind: "contribution",
    actorId: "workspace-genesis",
    intent: "direct",
    mutation,
  });
  return [body(first), ...rest.map(body)];
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function nodeTransaction(nodeId: string, actorId: string, intent: EditIntent): FactTransactionPlan {
  return {
    kind: "transaction",
    bodies: [
      {
        kind: "contribution",
        actorId,
        intent,
        mutation: { kind: "node-create", nodeId },
      },
      {
        kind: "contribution",
        actorId,
        intent,
        mutation: {
          kind: "node-owner-set",
          nodeId,
          ownerNodeId: "workspace",
          previousOwnerNodeId: null,
        },
      },
      {
        kind: "contribution",
        actorId,
        intent,
        mutation: {
          kind: "occurrence-create",
          occurrenceId: `${nodeId}-original`,
          nodeId,
          parentNodeId: "workspace",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
      },
    ],
  };
}

function directTransaction(mutations: readonly [Mutation, ...Mutation[]]): FactTransactionPlan {
  const [first, ...rest] = mutations;
  const body = (mutation: Mutation): FactBody => ({
    kind: "contribution",
    actorId: "actor",
    intent: "direct",
    mutation,
  });
  return {
    kind: "transaction",
    bodies: [body(first), ...rest.map(body)],
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
