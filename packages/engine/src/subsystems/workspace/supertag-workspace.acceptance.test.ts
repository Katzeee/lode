import { describe, expect, it } from "vitest";

import type { EditAction } from "../../domain/edit/index.js";
import {
  factActionsFromFacts,
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  materializedFieldNodeId,
  materializedFieldOccurrenceId,
  NODE_SUPERTAGS_DEFINITION_NODE_ID,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  requireFactActionId,
  workspaceTrashNodeId,
  type IntrinsicNodeType,
} from "../../domain/fact/index.js";
import {
  supertagApplicationProjectionIdentity,
  type SupertagApplicationProjectionIdentity,
} from "../../domain/reconcile/supertag-application-graph.js";
import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import {
  createSupertagApplication,
  removeSupertagApplication,
} from "../../../tests/support/workspace/edit-test-actions.js";
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
    const removedApplication = await readApplication(restarted.workspace, "task", "project-supertag");
    if (removedApplication === undefined) {
      throw new Error("Expected the Project Supertag Application");
    }
    const removedIdentity = supertagApplicationProjectionIdentity(
      requireFactActionId(removedApplication.factActionId, "removed Application action"),
    );
    expect(
      await mutate(restarted.workspace, "remove-one-supertag-source", [
        removeSupertagApplication("task", "project-supertag"),
      ]),
    ).toMatchObject({ status: "published" });
    await expectApplications(restarted.workspace, ["work-supertag"]);

    const removedStructure = await readApplicationStructure(restarted.workspace, removedIdentity);
    expect(removedStructure).toEqual({ nodeExists: true, ownerNodeId: null, occurrenceExists: false });
    expect(await readApplicationEndpoints(restarted.workspace, removedIdentity)).toEqual({
      childOccurrenceIds: [removedIdentity.relationDefinitionOccurrenceId, removedIdentity.detachedValueOccurrenceId],
      childNodeIds: [NODE_SUPERTAGS_DEFINITION_NODE_ID, removedIdentity.detachedValueNodeId],
      detachedValueOwnerNodeId: removedIdentity.applicationNodeId,
      originalDefinitionOccurrenceExists: false,
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
    expect(await readApplicationStructure(restarted.workspace, removedIdentity)).toEqual(removedStructure);
    const restoredApplication = await readApplication(restarted.workspace, "task", "project-supertag");
    if (restoredApplication === undefined) {
      throw new Error("Expected Undo to create a new Project Supertag Application");
    }
    expect(restoredApplication.factActionId).not.toBe(removedApplication.factActionId);
    const restoredIdentity = supertagApplicationProjectionIdentity(
      requireFactActionId(restoredApplication.factActionId, "restored Application action"),
    );
    expect(await readApplicationStructure(restarted.workspace, restoredIdentity)).toEqual({
      nodeExists: true,
      ownerNodeId: "metanode:v1:task",
      occurrenceExists: true,
    });
    expect(await readApplicationEndpoints(restarted.workspace, restoredIdentity)).toMatchObject({
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
    expect(await readApplicationStructure(restarted.workspace, removedIdentity)).toEqual(removedStructure);
    expect(await readApplicationStructure(restarted.workspace, restoredIdentity)).toEqual(removedStructure);
    expect(await readApplicationEndpoints(restarted.workspace, restoredIdentity)).toMatchObject({
      childNodeIds: [NODE_SUPERTAGS_DEFINITION_NODE_ID, restoredIdentity.detachedValueNodeId],
      detachedValueOwnerNodeId: restoredIdentity.applicationNodeId,
    });

    await restarted.workspace.close();
    const detachedRestart = await open(documents, "303");
    await expectApplications(detachedRestart.workspace, ["work-supertag"]);
    expect(await readApplicationStructure(detachedRestart.workspace, removedIdentity)).toEqual(removedStructure);
    expect(await readApplicationStructure(detachedRestart.workspace, restoredIdentity)).toEqual(removedStructure);

    expect(
      (
        await mutate(detachedRestart.workspace, "reapply-project-supertag", [
          createSupertagApplication("task", "project-supertag"),
        ])
      ).status,
    ).toBe("published");
    await expectApplications(detachedRestart.workspace, ["work-supertag", "project-supertag"]);
    expect(await readApplicationStructure(detachedRestart.workspace, removedIdentity)).toEqual(removedStructure);
    const reappliedApplication = await readApplication(detachedRestart.workspace, "task", "project-supertag");
    if (reappliedApplication === undefined) {
      throw new Error("Expected the reapplied Project Supertag Application");
    }
    const reappliedIdentity = supertagApplicationProjectionIdentity(
      requireFactActionId(reappliedApplication.factActionId, "reapplied Application action"),
    );
    expect(await readApplicationStructure(detachedRestart.workspace, reappliedIdentity)).toEqual({
      nodeExists: true,
      ownerNodeId: "metanode:v1:task",
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
    expect(
      factActionsFromFacts(opened.facts.facts(deletion.receipt.factIds)).some(
        (fact) => fact.action.kind === "node-trash" && fact.action.nodeId === "project-supertag",
      ),
    ).toBe(true);
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
            occurrenceId: "project-supertag-original",
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
      fieldNodeId: materializedFieldNodeId("task", "status-field"),
      fieldOccurrenceId: materializedFieldOccurrenceId("task", "status-field"),
    });
  });
});

async function open(documents: InMemoryDocumentStore, loroPeerId: `${number}`) {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    loroPeerId,
    documents: documents,
  });
  return {
    facts,
    workspace: await Workspace.open({ workspaceId: "workspace", facts, versions }),
  };
}

async function mutate(
  workspace: Workspace,
  invocationId: string,
  actions: readonly EditAction[],
  intent: "direct" | "proposal" = "direct",
) {
  return workspace.execute({
    kind: "edit",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId: "desktop",
    actions,
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

async function readApplication(workspace: Workspace, hostNodeId: string, supertagId: string) {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: "supertagApplications",
  });
  if (!("supertagApplications" in result)) {
    throw new Error("Expected Supertag Applications Projection");
  }
  return result.supertagApplications[hostNodeId]?.find((application) => application.supertagId === supertagId);
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

async function readApplicationStructure(workspace: Workspace, identity: SupertagApplicationProjectionIdentity) {
  const [nodes, owners, occurrences] = await Promise.all([
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin", section: "nodes" }),
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin", section: "nodeOwners" }),
    workspace.query({ kind: "projection", workspaceId: "workspace", perspective: "origin", section: "occurrences" }),
  ]);
  if (!("nodes" in nodes) || !("nodeOwners" in owners) || !("occurrences" in occurrences)) {
    throw new Error("Expected Supertag Application structure");
  }
  return {
    nodeExists: nodes.nodes[identity.applicationNodeId] !== undefined,
    ownerNodeId: owners.nodeOwners[identity.applicationNodeId],
    occurrenceExists: occurrences.occurrences[identity.applicationOccurrenceId] !== undefined,
  };
}

async function readApplicationEndpoints(workspace: Workspace, identity: SupertagApplicationProjectionIdentity) {
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
  const childOccurrenceIds = children.childOccurrences[identity.applicationNodeId] ?? [];
  return {
    childOccurrenceIds,
    childNodeIds: childOccurrenceIds.map((occurrenceId) => occurrences.occurrences[occurrenceId]?.nodeId),
    detachedValueOwnerNodeId: owners.nodeOwners[identity.detachedValueNodeId],
    originalDefinitionOccurrenceExists: occurrences.occurrences[identity.definitionOccurrenceId] !== undefined,
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

function supertagProgram(): readonly EditAction[] {
  return [
    ...nodeAtWorkspace("task"),
    ...definitionAtWorkspace("project-supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE),
    ...definitionAtWorkspace("work-supertag", SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE),
    createSupertagApplication("task", "project-supertag"),
    createSupertagApplication("task", "work-supertag"),
  ];
}

function nodeAtWorkspace(nodeId: string): readonly EditAction[] {
  return [nodeAt(nodeId, "workspace", `${nodeId}-original`)];
}

function definitionAtWorkspace(nodeId: string, intrinsicNodeType: IntrinsicNodeType): readonly EditAction[] {
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

function nodeAt(nodeId: string, parentNodeId: string, occurrenceId: string): EditAction {
  return { kind: "node-create", nodeId, occurrenceId, parentNodeId, anchor: end };
}
