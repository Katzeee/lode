import { describe, expect, it } from "vitest";

import type { ProjectionPage } from "@lode/sdk";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import type { EditMutation } from "../../domain/edit/index.js";
import { workspaceTrashNodeId, type ProjectionPerspective } from "../../domain/fact/index.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { createReplicaId, FactAuthorityStore } from "../authority/fact-authority-store.js";
import { ProposalWorkspace } from "./proposal-workspace.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("instance Field content deletion", () => {
  it("deletes one ordered Field Value through Proposal, Direct, Reject, and History", async () => {
    const opened = await open(new InMemoryDocumentStore(), "601");
    expect((await mutate(opened, "setup-values", explicitFieldProgram())).status).toBe("published");

    expect(
      (await mutate(opened, "propose-value-delete", [valueDeletion("value-a-occurrence")], "proposal")).status,
    ).toBe("published");
    expect(await fieldValues(opened, "origin")).toEqual(["value-a-occurrence", "value-b-occurrence"]);
    expect(await fieldValues(opened, "review")).toEqual(["value-b-occurrence"]);

    const review = await opened.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review)) {
      throw new Error("Expected Field Value deletion Review Hunk");
    }
    const hunk = review.hunks.find(
      (candidate) =>
        candidate.diffSpace.kind === "child-sequence" &&
        candidate.selection.evidence.effects.some(
          (effect) => effect.kind === "structure" && effect.occurrenceId === "value-a-occurrence",
        ),
    );
    if (!hunk) {
      throw new Error("Expected typed structure Hunk for the deleted Field Value");
    }
    expect(hunk.selection.evidence.associatedImpactIds.length).toBeGreaterThan(0);
    expect(
      (
        await opened.workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "reject-value-delete",
          actorId: "reviewer",
          decision: "reject",
          selection: hunk.selection,
        })
      ).status,
    ).toBe("published");
    expect(await fieldValues(opened, "origin")).toEqual(["value-a-occurrence", "value-b-occurrence"]);

    expect((await mutate(opened, "delete-value-direct", [valueDeletion("value-a-occurrence")])).status).toBe(
      "published",
    );
    expect(await fieldValues(opened, "origin")).toEqual(["value-b-occurrence"]);
    expect((await section(opened, "origin", "nodes")).nodes["value-a"]).toBeDefined();
    expect((await section(opened, "origin", "nodeOwners")).nodeOwners["value-a"]).toBe(
      workspaceTrashNodeId("workspace"),
    );

    const history = await opened.workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "desktop",
    });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Expected Field Value deletion Undo");
    }
    const undone = await opened.workspace.execute({
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-value-delete",
      actorId: "actor",
      selection: history.undo,
    });
    if (undone.status !== "published") {
      throw new Error(JSON.stringify(undone));
    }
    expect(undone).toMatchObject({ status: "published" });
    expect(await fieldValues(opened, "origin")).toEqual(["value-a-occurrence", "value-b-occurrence"]);

    expect((await mutate(opened, "delete-whole-field-direct", [materializedFieldDeletion()])).status).toBe("published");
    const fieldHistory = await opened.workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "desktop",
    });
    if (!("undo" in fieldHistory) || !fieldHistory.undo) {
      throw new Error("Expected whole Field deletion Undo");
    }
    expect(
      (
        await opened.workspace.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-whole-field-delete",
          actorId: "actor",
          selection: fieldHistory.undo,
        })
      ).status,
    ).toBe("published");
    expect(await fieldValues(opened, "origin")).toEqual(["value-a-occurrence", "value-b-occurrence"]);
  });

  it("accepts Materialized Field deletion by trashing its owned subtree and retaining the Effective placeholder", async () => {
    const documents = new InMemoryDocumentStore();
    const opened = await open(documents, "701");
    expect((await mutate(opened, "setup-field", explicitFieldProgram())).status).toBe("published");
    expect((await mutate(opened, "propose-field-delete", [materializedFieldDeletion()], "proposal")).status).toBe(
      "published",
    );
    expect(await materializedField(opened, "origin")).toBeDefined();
    expect(await materializedField(opened, "review")).toBeUndefined();

    const review = await opened.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review)) {
      throw new Error("Expected Materialized Field deletion Review Hunk");
    }
    const hunk = review.hunks.find((candidate) => candidate.diffSpace.kind === "materialized-field");
    if (!hunk) {
      throw new Error("Expected typed Materialized Field Hunk");
    }
    expect(hunk.selection.evidence.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "field-materialization",
          ownerNodeId: "owner",
          fieldDefinitionId: "field-definition",
          originFieldNodeId: "field-node",
          reviewFieldNodeId: null,
        }),
      ]),
    );
    expect(
      (
        await opened.workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "accept-field-delete",
          actorId: "reviewer",
          decision: "accept",
          selection: hunk.selection,
        })
      ).status,
    ).toBe("published");
    await expectDeletedFieldState(opened);

    await opened.workspace.close();
    const restarted = await open(documents, "702");
    await expectDeletedFieldState(restarted);
    expect(
      (
        await mutate(restarted, "remove-field-source", [
          { kind: "supertag-remove", nodeId: "owner", supertagId: "supertag" },
        ])
      ).status,
    ).toBe("published");
    expect((await section(restarted, "origin", "effectiveFields")).effectiveFields.owner).toBeUndefined();
    expect((await section(restarted, "origin", "nodes")).nodes["field-node"]).toBeDefined();
  });

  it("does not regenerate deleted initialized values or initialized Fields", async () => {
    const opened = await open(new InMemoryDocumentStore(), "801");
    expect((await mutate(opened, "setup-default", initializedFieldProgram())).status).toBe("published");
    const field = await materializedField(opened, "origin");
    const valueOccurrenceId = field?.valueOccurrenceIds[0];
    if (!field || !valueOccurrenceId) {
      throw new Error("Expected initialized Field and value");
    }
    expect(
      (
        await mutate(opened, "delete-default-value", [
          {
            kind: "field-value-delete",
            ownerNodeId: "owner",
            fieldDefinitionId: "field-definition",
            valueOccurrenceId,
          },
        ])
      ).status,
    ).toBe("published");
    expect((await materializedField(opened, "origin"))?.valueOccurrenceIds).toEqual([]);

    expect(
      (
        await mutate(opened, "delete-initialized-field", [
          {
            kind: "materialized-field-delete",
            ownerNodeId: "owner",
            fieldDefinitionId: "field-definition",
            fieldNodeId: field.fieldNodeId,
            fieldOccurrenceId: field.fieldOccurrenceId,
          },
        ])
      ).status,
    ).toBe("published");
    expect(await materializedField(opened, "origin")).toBeUndefined();
    const nodes = (await section(opened, "origin", "nodes")).nodes;
    expect(nodes[field.fieldNodeId]).toBeDefined();

    const history = await opened.workspace.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "desktop",
    });
    if (!("undo" in history) || !history.undo) {
      throw new Error("Expected initialized Field deletion Undo");
    }
    const undone = await opened.workspace.execute({
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-initialized-field-delete",
      actorId: "actor",
      selection: history.undo,
    });
    if (undone.status !== "published") {
      throw new Error(JSON.stringify(undone));
    }
    expect(await materializedField(opened, "origin")).toMatchObject({
      fieldNodeId: field.fieldNodeId,
      fieldOccurrenceId: field.fieldOccurrenceId,
      valueOccurrenceIds: [],
    });
  });
});

function explicitFieldProgram(): readonly EditMutation[] {
  return [
    nodeAt("owner", "workspace", "owner-occurrence"),
    nodeAt("supertag", "workspace", "supertag-original"),
    nodeAt("field-definition", "workspace", "field-definition-original"),
    { kind: "node-type-declare", nodeId: "supertag", nodeType: "supertag-definition" },
    { kind: "node-type-declare", nodeId: "field-definition", nodeType: "field-definition" },
    nodeAt("field-node", "owner", "field-occurrence"),
    nodeAt("value-a", "field-node", "value-a-occurrence"),
    nodeAt("value-b", "field-node", "value-b-occurrence"),
    {
      kind: "supertag-field-add",
      supertagId: "supertag",
      fieldDefinitionId: "field-definition",
      fieldNodeId: "supertag-field-definition-template-field",
      fieldOccurrenceId: "supertag-field-definition-template-field-occurrence",
      anchor: end,
    },
    {
      kind: "supertag-field-configure",
      supertagId: "supertag",
      fieldDefinitionId: "field-definition",
      fieldNodeId: "supertag-field-definition-template-field",

      config: { visibility: "normal", staticDefault: null },
    },
    { kind: "supertag-apply", nodeId: "owner", supertagId: "supertag", anchor: end },
    {
      kind: "field-materialize",
      ownerNodeId: "owner",
      fieldDefinitionId: "field-definition",
      fieldNodeId: "field-node",
      fieldOccurrenceId: "field-occurrence",
    },
  ];
}

function initializedFieldProgram(): readonly EditMutation[] {
  return [
    nodeAt("owner", "workspace", "owner-occurrence"),
    nodeAt("supertag", "workspace", "supertag-original"),
    nodeAt("field-definition", "workspace", "field-definition-original"),
    { kind: "node-type-declare", nodeId: "supertag", nodeType: "supertag-definition" },
    { kind: "node-type-declare", nodeId: "field-definition", nodeType: "field-definition" },
    {
      kind: "supertag-field-add",
      supertagId: "supertag",
      fieldDefinitionId: "field-definition",
      fieldNodeId: "supertag-field-definition-template-field",
      fieldOccurrenceId: "supertag-field-definition-template-field-occurrence",
      anchor: end,
    },
    {
      kind: "supertag-field-configure",
      supertagId: "supertag",
      fieldDefinitionId: "field-definition",
      fieldNodeId: "supertag-field-definition-template-field",

      config: {
        visibility: "normal",
        staticDefault: [{ kind: "text", value: "Default" }],
      },
    },
    { kind: "supertag-apply", nodeId: "owner", supertagId: "supertag", anchor: end },
  ];
}

function nodeAt(nodeId: string, parentNodeId: string, occurrenceId: string): EditMutation {
  return {
    kind: "node-create",
    occurrenceId,
    nodeId,
    parentNodeId,
    anchor: end,
  };
}

function valueDeletion(valueOccurrenceId: string): EditMutation {
  return {
    kind: "field-value-delete",
    ownerNodeId: "owner",
    fieldDefinitionId: "field-definition",
    valueOccurrenceId,
  };
}

function materializedFieldDeletion(): EditMutation {
  return {
    kind: "materialized-field-delete",
    ownerNodeId: "owner",
    fieldDefinitionId: "field-definition",
    fieldNodeId: "field-node",
    fieldOccurrenceId: "field-occurrence",
  };
}

async function expectDeletedFieldState(opened: Opened): Promise<void> {
  expect(await materializedField(opened, "origin")).toBeUndefined();
  expect((await section(opened, "origin", "effectiveFields")).effectiveFields.owner?.[0]).toMatchObject({
    fieldDefinitionId: "field-definition",
    materializedFieldNodeId: null,
  });
  const nodes = (await section(opened, "origin", "nodes")).nodes;
  expect(nodes["field-node"]).toBeDefined();
  expect(nodes["value-a"]).toBeDefined();
  expect(nodes["value-b"]).toBeDefined();
  const owners = (await section(opened, "origin", "nodeOwners")).nodeOwners;
  expect(owners["field-node"]).toBe(workspaceTrashNodeId("workspace"));
  expect(owners["value-a"]).toBe("field-node");
  expect(owners["value-b"]).toBe("field-node");
}

async function fieldValues(opened: Opened, perspective: ProjectionPerspective): Promise<readonly string[]> {
  return (await materializedField(opened, perspective))?.valueOccurrenceIds ?? [];
}

async function materializedField(opened: Opened, perspective: ProjectionPerspective) {
  return (await section(opened, perspective, "materializedFields")).materializedFields.owner?.[0];
}

async function mutate(
  opened: Opened,
  invocationId: string,
  mutations: readonly EditMutation[],
  intent: "direct" | "proposal" = "direct",
) {
  return opened.workspace.execute({
    kind: "mutate",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId: "desktop",
    mutations,
  });
}

type Opened = Awaited<ReturnType<typeof open>>;

async function open(documents: InMemoryDocumentStore, loroPeerId: `${number}`) {
  const facts = await FactAuthorityStore.open({
    workspaceId: "workspace",
    replicaId: createReplicaId(),
    loroPeerId,
    documents,
    admitRecords: admitAuthorityRecords,
  });
  return {
    facts,
    workspace: await ProposalWorkspace.open({ workspaceId: "workspace", facts, versions }),
  };
}

async function section<S extends ProjectionPage["section"]>(
  opened: Opened,
  perspective: ProjectionPerspective,
  requested: S,
): Promise<ProjectionPage & Readonly<{ section: S }>> {
  const result = await opened.workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective,
    section: requested,
  });
  if (!("section" in result) || result.section !== requested) {
    throw new Error(`Expected ${requested} Projection`);
  }
  return result as ProjectionPage & Readonly<{ section: S }>;
}
