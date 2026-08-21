import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../../domain/admission/index.js";
import type { EditMutation } from "../../domain/edit/index.js";
import {
  detachedSupertagValueNodeId,
  detachedSupertagValueOccurrenceId,
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  NODE_SUPERTAGS_DEFINITION_NODE_ID,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  workspaceTrashNodeId,
  type IntrinsicNodeType,
} from "../../domain/fact/index.js";
import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import { createReplicaId, FactAuthority } from "./authority/fact-authority.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import {
  createSupertagApplication,
  removeSupertagApplication,
} from "../../../tests/support/workspace/edit-test-mutations.js";
import { Workspace } from "./workspace.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Supertag product model", () => {
  it("writes, queries, and restarts multiple Supertag applications", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await open(documents, "101");
    expect((await mutate(first.workspace, "define-and-apply-supertags", supertagProgram())).status).toBe("published");
    await expectApplications(first.workspace, ["project-supertag", "work-supertag"]);

    await first.workspace.close();
    const restarted = await open(documents, "202");
    await expectApplications(restarted.workspace, ["project-supertag", "work-supertag"]);
    expect(
      await mutate(restarted.workspace, "remove-one-supertag-source", [
        removeSupertagApplication("task", "project-supertag"),
      ]),
    ).toMatchObject({ status: "published" });
    await expectApplications(restarted.workspace, ["work-supertag"]);

    const removedApplicationNodeId = "task-supertag-application-project-supertag-1";
    const detachedValueNodeId = detachedSupertagValueNodeId(removedApplicationNodeId);
    const detachedValueOccurrenceId = detachedSupertagValueOccurrenceId(removedApplicationNodeId);
    const removedStructure = await readApplicationStructure(restarted.workspace, removedApplicationNodeId);
    expect(removedStructure).toEqual({ nodeExists: true, ownerNodeId: null, occurrenceExists: false });
    expect(await readApplicationEndpoints(restarted.workspace, removedApplicationNodeId)).toEqual({
      childOccurrenceIds: [`${removedApplicationNodeId}-relation-definition-occurrence`, detachedValueOccurrenceId],
      childNodeIds: [NODE_SUPERTAGS_DEFINITION_NODE_ID, detachedValueNodeId],
      detachedValueOwnerNodeId: removedApplicationNodeId,
      originalDefinitionOccurrenceExists: false,
    });
    expect(
      await mutate(restarted.workspace, "corrupt-removed-supertag-application", [
        {
          kind: "occurrence-delete",
          occurrenceId: `${removedApplicationNodeId}-relation-definition-occurrence`,
        },
      ]),
    ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    expect(await readApplicationEndpoints(restarted.workspace, removedApplicationNodeId)).toMatchObject({
      childNodeIds: [NODE_SUPERTAGS_DEFINITION_NODE_ID, detachedValueNodeId],
    });

    const removalHistory = await restarted.workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "desktop",
    });
    if (!("undo" in removalHistory) || !removalHistory.undo) {
      throw new Error("Expected Supertag removal Undo");
    }
    const undoResult = await restarted.workspace.execute({
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-project-supertag-removal",
      actorId: "actor",
      selection: removalHistory.undo,
    });
    if (undoResult.status !== "published") {
      throw new Error(JSON.stringify(undoResult));
    }
    await expectApplications(restarted.workspace, ["project-supertag", "work-supertag"]);
    expect(await readApplicationStructure(restarted.workspace, removedApplicationNodeId)).toEqual({
      nodeExists: true,
      ownerNodeId: "task-metanode",
      occurrenceExists: true,
    });
    expect(await readApplicationEndpoints(restarted.workspace, removedApplicationNodeId)).toMatchObject({
      childNodeIds: [NODE_SUPERTAGS_DEFINITION_NODE_ID, "project-supertag"],
      originalDefinitionOccurrenceExists: true,
    });

    const removalRedo = await restarted.workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "desktop",
    });
    if (!("redo" in removalRedo) || !removalRedo.redo) {
      throw new Error("Expected Supertag removal Redo");
    }
    expect(
      (
        await restarted.workspace.execute({
          kind: "redo",
          workspaceId: "workspace",
          invocationId: "redo-project-supertag-removal",
          actorId: "actor",
          selection: removalRedo.redo,
        })
      ).status,
    ).toBe("published");
    await expectApplications(restarted.workspace, ["work-supertag"]);
    expect(await readApplicationStructure(restarted.workspace, removedApplicationNodeId)).toEqual(removedStructure);
    expect(await readApplicationEndpoints(restarted.workspace, removedApplicationNodeId)).toMatchObject({
      childNodeIds: [NODE_SUPERTAGS_DEFINITION_NODE_ID, detachedValueNodeId],
      detachedValueOwnerNodeId: removedApplicationNodeId,
    });

    await restarted.workspace.close();
    const detachedRestart = await open(documents, "303");
    await expectApplications(detachedRestart.workspace, ["work-supertag"]);
    expect(await readApplicationStructure(detachedRestart.workspace, removedApplicationNodeId)).toEqual(
      removedStructure,
    );
    expect(await readApplicationEndpoints(detachedRestart.workspace, removedApplicationNodeId)).toMatchObject({
      childNodeIds: [NODE_SUPERTAGS_DEFINITION_NODE_ID, detachedValueNodeId],
      detachedValueOwnerNodeId: removedApplicationNodeId,
    });

    expect(
      (
        await mutate(detachedRestart.workspace, "reapply-project-supertag", [
          createSupertagApplication("task", "project-supertag", "2"),
        ])
      ).status,
    ).toBe("published");
    await expectApplications(detachedRestart.workspace, ["work-supertag", "project-supertag"]);
    expect(await readApplicationStructure(detachedRestart.workspace, removedApplicationNodeId)).toEqual(
      removedStructure,
    );
    expect(await readApplicationEndpoints(detachedRestart.workspace, removedApplicationNodeId)).toMatchObject({
      childNodeIds: [NODE_SUPERTAGS_DEFINITION_NODE_ID, detachedValueNodeId],
    });
    expect(
      await readApplicationStructure(detachedRestart.workspace, "task-supertag-application-project-supertag-2"),
    ).toEqual({
      nodeExists: true,
      ownerNodeId: "task-metanode",
      occurrenceExists: true,
    });
  });

  it("blocks new use of a deleted Definition and restores the same identity", async () => {
    const opened = await open(new InMemoryDocumentStore(), "111");
    expect(
      (
        await mutate(opened.workspace, "definition-lifecycle-setup", [
          ...supertagProgram(),
          ...nodeAtWorkspace("other"),
        ])
      ).status,
    ).toBe("published");

    const deletion = await mutate(opened.workspace, "delete-project-definition", [
      { kind: "node-delete", nodeId: "project-supertag" },
    ]);
    if (deletion.status !== "published") {
      throw new Error("Expected Definition deletion to publish");
    }
    const deletionFactId = opened.facts
      .facts(deletion.receipt.factIds)
      .find(
        (fact) =>
          fact.body.kind === "contribution" &&
          fact.body.mutation.kind === "node-delete" &&
          fact.body.mutation.nodeId === "project-supertag",
      )?.id;
    if (!deletionFactId) {
      throw new Error("Expected Definition deletion Fact identity");
    }
    expect(await readNodePlacement(opened.workspace, "project-supertag")).toMatchObject({ state: "trash" });

    expect(
      await mutate(opened.workspace, "apply-deleted-definition", [
        createSupertagApplication("other", "project-supertag"),
      ]),
    ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
    expect(
      (
        await mutate(opened.workspace, "remove-deleted-definition-application", [
          removeSupertagApplication("task", "project-supertag"),
        ])
      ).status,
    ).toBe("published");
    expect(
      (
        await mutate(opened.workspace, "restore-project-definition", [
          {
            kind: "node-restore",
            nodeId: "project-supertag",
            deletionFactId,
            occurrenceId: "project-supertag-original",
            ownerNodeId: "workspace",
            parentNodeId: "workspace",
            anchor: end,
          },
          createSupertagApplication("other", "project-supertag"),
        ])
      ).status,
    ).toBe("published");
    expect(await readNodePlacement(opened.workspace, "project-supertag")).toMatchObject({ state: "active" });
    await expectApplications(opened.workspace, ["project-supertag"], "other");
  });

  it("reviews a Definition move to Trash before it changes Origin", async () => {
    const opened = await open(new InMemoryDocumentStore(), "112");
    expect((await mutate(opened.workspace, "proposal-trash-setup", supertagProgram())).status).toBe("published");
    expect(
      (
        await mutate(
          opened.workspace,
          "propose-supertag-trash",
          [{ kind: "node-delete", nodeId: "project-supertag" }],
          "proposal",
        )
      ).status,
    ).toBe("published");
    expect(await readNodePlacement(opened.workspace, "project-supertag", "origin")).toMatchObject({
      state: "active",
    });
    expect(await readNodePlacement(opened.workspace, "project-supertag", "review")).toMatchObject({
      state: "trash",
    });

    const review = await opened.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || !review.hunks[0]) {
      throw new Error("Expected Definition deletion Review Hunk");
    }
    expect(
      (
        await opened.workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "accept-supertag-trash",
          actorId: "reviewer",
          decision: "accept",
          selection: review.hunks[0].selection,
        })
      ).status,
    ).toBe("published");
    expect(await readNodePlacement(opened.workspace, "project-supertag")).toMatchObject({ state: "trash" });
  });

  it("reviews, accepts, queries, and restarts a Supertag Extension", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await open(documents, "454");
    expect(
      (
        await mutate(first.workspace, "extension-setup", [
          ...definitionAtWorkspace("base-supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE),
          ...definitionAtWorkspace("child-supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE),
        ])
      ).status,
    ).toBe("published");
    expect(
      (
        await mutate(
          first.workspace,
          "propose-extension",
          [
            {
              kind: "supertag-extension-add",
              supertagId: "child-supertag",
              baseSupertagId: "base-supertag",
              anchor: end,
            },
          ],
          "proposal",
        )
      ).status,
    ).toBe("published");
    expect(await readExtensions(first.workspace, "origin")).not.toHaveProperty("child-supertag");
    expect(await readExtensions(first.workspace, "review")).toMatchObject({
      "child-supertag": ["base-supertag"],
    });

    const review = await first.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || !review.hunks[0]) {
      throw new Error("Expected Supertag Extension Review Hunk");
    }
    expect(
      (
        await first.workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "accept-extension",
          actorId: "reviewer",
          decision: "accept",
          selection: review.hunks[0].selection,
        })
      ).status,
    ).toBe("published");
    await first.workspace.close();
    const restarted = await open(documents, "455");
    expect(await readExtensions(restarted.workspace, "origin")).toMatchObject({
      "child-supertag": ["base-supertag"],
    });
  });

  it("reviews and accepts a Materialized Field with stable identities", async () => {
    const { workspace } = await open(new InMemoryDocumentStore(), "808");
    expect(
      (
        await mutate(workspace, "materialization-proposal-setup", [
          nodeAt("task", "workspace", "task-occurrence"),
          ...definitionAtWorkspace("status-field", FIELD_DEFINITION_INTRINSIC_NODE_TYPE),
          nodeAt("status-on-task", "task", "status-on-task-occurrence"),
        ])
      ).status,
    ).toBe("published");
    expect(
      (
        await mutate(
          workspace,
          "propose-materialized-field",
          [
            {
              kind: "field-materialize",
              ownerNodeId: "task",
              fieldDefinitionId: "status-field",
              fieldNodeId: "status-on-task",
              fieldOccurrenceId: "status-on-task-occurrence",
            },
          ],
          "proposal",
        )
      ).status,
    ).toBe("published");
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    const hunk =
      "hunks" in review ? review.hunks.find(({ diffSpace }) => diffSpace.kind === "materialized-field") : undefined;
    if (!hunk) {
      throw new Error("Expected Materialized Field Review Hunk");
    }
    expect(
      (
        await workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "accept-materialized-field",
          actorId: "reviewer",
          decision: "accept",
          selection: hunk.selection,
        })
      ).status,
    ).toBe("published");
    const materialized = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "materializedFields",
    });
    expect("materializedFields" in materialized && materialized.materializedFields.task?.[0]).toMatchObject({
      fieldDefinitionId: "status-field",
      fieldNodeId: "status-on-task",
      fieldOccurrenceId: "status-on-task-occurrence",
    });
  });
});

async function open(documents: InMemoryDocumentStore, loroPeerId: `${number}`) {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId,
    authorityJournal: documents,
    factReplication: documents,
    admitRecords: admitAuthorityRecords,
  });
  return {
    facts,
    workspace: await Workspace.open({ workspaceId: "workspace", facts, versions }),
  };
}

async function mutate(
  workspace: Workspace,
  invocationId: string,
  mutations: readonly EditMutation[],
  intent: "direct" | "proposal" = "direct",
) {
  return workspace.execute({
    kind: "mutate",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId: "desktop",
    mutations,
  });
}

async function expectApplications(
  workspace: Workspace,
  expectedSupertagIds: readonly string[],
  hostNodeId = "task",
): Promise<void> {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: "supertagApplications",
  });
  if (!("supertagApplications" in result)) {
    throw new Error("Expected Supertag Applications Projection");
  }
  expect(result.supertagApplications[hostNodeId]?.map(({ supertagId }) => supertagId)).toEqual(expectedSupertagIds);
}

async function readNodePlacement(workspace: Workspace, nodeId: string, perspective: "origin" | "review" = "origin") {
  const [nodes, owners] = await Promise.all([
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective, section: "nodes" }),
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective, section: "nodeOwners" }),
  ]);
  if (!("nodes" in nodes) || !("nodeOwners" in owners)) {
    throw new Error("Expected Node Graph Projection");
  }
  const node = nodes.nodes[nodeId];
  return node
    ? {
        nodeId,
        intrinsicNodeType: node.intrinsicNodeType,
        state: owners.nodeOwners[nodeId] === workspaceTrashNodeId("workspace") ? "trash" : "active",
      }
    : undefined;
}

async function readApplicationStructure(workspace: Workspace, applicationNodeId: string) {
  const [nodes, owners, occurrences] = await Promise.all([
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin", section: "nodes" }),
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin", section: "nodeOwners" }),
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin", section: "occurrences" }),
  ]);
  if (!("nodes" in nodes) || !("nodeOwners" in owners) || !("occurrences" in occurrences)) {
    throw new Error("Expected Supertag Application structure");
  }
  return {
    nodeExists: nodes.nodes[applicationNodeId] !== undefined,
    ownerNodeId: owners.nodeOwners[applicationNodeId],
    occurrenceExists: occurrences.occurrences[`${applicationNodeId}-occurrence`] !== undefined,
  };
}

async function readApplicationEndpoints(workspace: Workspace, applicationNodeId: string) {
  const [owners, occurrences, children] = await Promise.all([
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin", section: "nodeOwners" }),
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin", section: "occurrences" }),
    workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "childOccurrences",
    }),
  ]);
  if (!("nodeOwners" in owners) || !("occurrences" in occurrences) || !("childOccurrences" in children)) {
    throw new Error("Expected Supertag Application endpoint structure");
  }
  const detachedValueNodeId = detachedSupertagValueNodeId(applicationNodeId);
  const childOccurrenceIds = children.childOccurrences[applicationNodeId] ?? [];
  return {
    childOccurrenceIds,
    childNodeIds: childOccurrenceIds.map((occurrenceId) => occurrences.occurrences[occurrenceId]?.nodeId),
    detachedValueOwnerNodeId: owners.nodeOwners[detachedValueNodeId],
    originalDefinitionOccurrenceExists:
      occurrences.occurrences[`${applicationNodeId}-definition-occurrence`] !== undefined,
  };
}

async function readExtensions(workspace: Workspace, perspective: "origin" | "review") {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective,
    section: "supertagExtensions",
  });
  if (!("supertagExtensions" in result)) {
    throw new Error("Expected Supertag Extensions Projection");
  }
  return result.supertagExtensions;
}

function supertagProgram(): readonly EditMutation[] {
  return [
    ...nodeAtWorkspace("task"),
    ...definitionAtWorkspace("project-supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE),
    ...definitionAtWorkspace("work-supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE),
    createSupertagApplication("task", "project-supertag"),
    createSupertagApplication("task", "work-supertag"),
  ];
}

function nodeAtWorkspace(nodeId: string): readonly EditMutation[] {
  return [nodeAt(nodeId, "workspace", `${nodeId}-original`)];
}

function definitionAtWorkspace(nodeId: string, intrinsicNodeType: IntrinsicNodeType): readonly EditMutation[] {
  return [
    {
      kind: "node-create",
      nodeId,
      occurrenceId: `${nodeId}-original`,
      parentNodeId: "workspace",
      anchor: end,
      intrinsicNodeType,
    },
  ];
}

function nodeAt(nodeId: string, parentNodeId: string, occurrenceId: string): EditMutation {
  return { kind: "node-create", nodeId, occurrenceId, parentNodeId, anchor: end };
}
