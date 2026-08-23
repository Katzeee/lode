import { describe, expect, it } from "vitest";

import type { EditAction } from "../../domain/edit/index.js";
import {
  templateFieldInstanceNodeId,
  templateFieldInstanceValueNodeId,
  workspaceSchemaNodeId,
  workspaceTrashNodeId,
} from "../../domain/fact/index.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { createSupertagApplication } from "../../../tests/support/workspace/edit-test-actions.js";
import { InMemoryDocumentStore } from "../persistence/in-memory-document-store.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { Workspace } from "./workspace.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Supertag Template Field authoring", () => {
  it("authors a Template Field, makes its Definition discoverable, contributes it optionally, and materializes its default", async () => {
    const { workspace } = await open();
    await publish(workspace, "setup", setupNodes());
    await publish(workspace, "create-template-field", [templateFieldCreation("task-supertag", "status-definition")]);
    const field = await templateField(workspace, "task-supertag", "status-definition");
    expect(field).toMatchObject({ fieldDefinitionOwner: "template-field", visibility: "normal" });
    expect(field.factActionId).toContain("/actions/");

    await publish(workspace, "author-static-default", [
      {
        kind: "supertag-template-field-static-default-set",
        supertagId: "task-supertag",
        templateFieldId: field.factActionId,
        value: "Ready",
      },
    ]);
    await publish(workspace, "apply-task-supertag", [createSupertagApplication("task", "task-supertag")]);
    const materialized = await projection(workspace, "materializedFields");
    expect(materialized.materializedFields.task?.[0]).toMatchObject({
      fieldDefinitionId: "status-definition",
      fieldNodeId: templateFieldInstanceNodeId("task", field.templateFieldNodeId),
    });
    const nodes = await projection(workspace, "nodes");
    expect(nodeText(nodes.nodes[templateFieldInstanceValueNodeId("task", field.templateFieldNodeId)])).toBe("Ready");

    await publish(workspace, "make-discoverable", [
      {
        kind: "supertag-template-field-make-discoverable",
        supertagId: "task-supertag",
        templateFieldId: field.factActionId,
      },
    ]);
    const owners = await projection(workspace, "nodeOwners");
    expect(owners.nodeOwners["status-definition"]).toBe(workspaceSchemaNodeId("workspace"));

    await publish(workspace, "add-optional-field", [
      {
        kind: "supertag-optional-field-contribution-add",
        supertagId: "other-supertag",
        fieldDefinitionId: "status-definition",
        anchor: end,
      },
    ]);
    const optional = await projection(workspace, "optionalFieldContributions");
    expect(optional.optionalFieldContributions["other-supertag"]?.[0]).toMatchObject({
      fieldDefinitionId: "status-definition",
    });
    expect(optional.optionalFieldContributions["other-supertag"]?.[0]?.factActionId).toContain("/actions/");

    await publish(workspace, "remove-optional-field", [
      {
        kind: "supertag-optional-field-contribution-remove",
        supertagId: "other-supertag",
        fieldDefinitionId: "status-definition",
      },
    ]);
    expect(
      (await projection(workspace, "optionalFieldContributions")).optionalFieldContributions["other-supertag"],
    ).toBeUndefined();
    await publishCommand(workspace, {
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-optional-field-removal",
      actorId: "actor",
      selection: await historySelection(workspace, "template-fields", "undo"),
    });
    expect(
      (await projection(workspace, "optionalFieldContributions")).optionalFieldContributions["other-supertag"]?.[0],
    ).toMatchObject({ fieldDefinitionId: "status-definition" });
  });

  it("keeps a proposed Template Field out of Origin until the composite intent is accepted", async () => {
    const { workspace } = await open();
    await publish(workspace, "setup", setupNodes());
    await publish(
      workspace,
      "propose-template-field",
      [templateFieldCreation("task-supertag", "status-definition")],
      "proposal",
    );
    expect((await projection(workspace, "templateFields", "origin")).templateFields["task-supertag"]).toBeUndefined();
    const reviewField = await templateField(workspace, "task-supertag", "status-definition", "review");
    await acceptAllHunks(workspace, "accept-template-field");
    expect((await templateField(workspace, "task-supertag", "status-definition")).factActionId).toBe(
      reviewField.factActionId,
    );
  });

  it("removes and restores one use through History, then creates a new use of the same discoverable Definition", async () => {
    const { workspace } = await open();
    await publish(workspace, "setup", setupNodes());
    await publish(workspace, "create-template-field", [templateFieldCreation("task-supertag", "status-definition")]);
    const original = await templateField(workspace, "task-supertag", "status-definition");
    await publish(workspace, "make-discoverable", [
      {
        kind: "supertag-template-field-make-discoverable",
        supertagId: "task-supertag",
        templateFieldId: original.factActionId,
      },
    ]);
    await publish(workspace, "remove-template-field", [
      { kind: "supertag-template-field-remove", supertagId: "task-supertag", templateFieldId: original.factActionId },
    ]);
    expect((await projection(workspace, "templateFields")).templateFields["task-supertag"]).toBeUndefined();
    expect((await projection(workspace, "nodeOwners")).nodeOwners[original.templateFieldNodeId]).toBe(
      workspaceTrashNodeId("workspace"),
    );

    await publishCommand(workspace, {
      kind: "undo",
      workspaceId: "workspace",
      invocationId: "undo-template-field-remove",
      actorId: "actor",
      selection: await historySelection(workspace, "template-fields", "undo"),
    });
    expect((await templateField(workspace, "task-supertag", "status-definition")).factActionId).toBe(
      original.factActionId,
    );

    await publish(workspace, "remove-again", [
      { kind: "supertag-template-field-remove", supertagId: "task-supertag", templateFieldId: original.factActionId },
    ]);
    await publish(workspace, "add-existing-template-field", [
      {
        kind: "supertag-template-field-add-existing",
        supertagId: "task-supertag",
        fieldDefinitionId: "status-definition",
        anchor: end,
      },
    ]);
    const replacement = await templateField(workspace, "task-supertag", "status-definition");
    expect(replacement.factActionId).not.toBe(original.factActionId);
    expect(replacement.fieldDefinitionOwner).toBe("workspace-schema");
  });

  it("merges inherited sources by Definition while preserving visibility and authored Field content", async () => {
    const { workspace } = await open();
    await publish(workspace, "setup", [
      ...setupNodes(),
      nodeAt("base-a", "workspace", "supertag-definition"),
      nodeAt("base-b", "workspace", "supertag-definition"),
      nodeAt("derived", "workspace", "supertag-definition"),
      nodeAt("derived-instance", "workspace"),
    ]);
    await publish(workspace, "base-field", [templateFieldCreation("base-a", "shared-definition")]);
    const source = await templateField(workspace, "base-a", "shared-definition");
    await publish(workspace, "discover-source", [
      { kind: "supertag-template-field-make-discoverable", supertagId: "base-a", templateFieldId: source.factActionId },
    ]);
    await publish(workspace, "base-b-field", [
      {
        kind: "supertag-template-field-add-existing",
        supertagId: "base-b",
        fieldDefinitionId: "shared-definition",
        anchor: end,
      },
    ]);
    const secondSource = await templateField(workspace, "base-b", "shared-definition");
    await publish(workspace, "pin-base-a", [
      {
        kind: "supertag-template-field-visibility-set",
        supertagId: "base-a",
        templateFieldId: source.factActionId,
        visibility: "pinned",
      },
    ]);
    await publish(workspace, "extend-and-apply", [
      { kind: "supertag-extension-add", supertagId: "derived", baseSupertagId: "base-a", anchor: end },
      { kind: "supertag-extension-add", supertagId: "derived", baseSupertagId: "base-b", anchor: end },
      createSupertagApplication("derived-instance", "derived"),
    ]);

    const effective = await projection(workspace, "effectiveFields");
    expect(effective.effectiveFields["derived-instance"]?.[0]).toMatchObject({
      fieldDefinitionId: "shared-definition",
      visibility: "pinned",
    });
    expect(effective.effectiveFields["derived-instance"]?.[0]?.sources).toHaveLength(2);

    const fieldNodeId = "authored-shared-field";
    await publish(workspace, "author-field", [
      nodeAt(fieldNodeId, "derived-instance"),
      nodeAt("authored-shared-value", fieldNodeId),
      { kind: "rich-text-splice", nodeId: "authored-shared-value", deleteAtomIds: [], anchor: end, insert: "Authored" },
      {
        kind: "field-materialize",
        ownerNodeId: "derived-instance",
        fieldDefinitionId: "shared-definition",
        fieldNodeId,
        fieldOccurrenceId: `${fieldNodeId}-original`,
      },
    ]);
    await publish(workspace, "remove-sources", [
      { kind: "supertag-template-field-remove", supertagId: "base-a", templateFieldId: source.factActionId },
      { kind: "supertag-template-field-remove", supertagId: "base-b", templateFieldId: secondSource.factActionId },
    ]);
    expect(
      (await projection(workspace, "materializedFields")).materializedFields["derived-instance"]?.[0],
    ).toMatchObject({
      fieldNodeId,
    });
  });

  it("restores semantic Template Field identity, visibility, and Static Default after restart", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await open(documents, "501");
    await publish(first.workspace, "setup", setupNodes());
    await publish(first.workspace, "create-field", [templateFieldCreation("task-supertag", "status-definition")]);
    const field = await templateField(first.workspace, "task-supertag", "status-definition");
    await publish(first.workspace, "configure-field", [
      {
        kind: "supertag-template-field-visibility-set",
        supertagId: "task-supertag",
        templateFieldId: field.factActionId,
        visibility: "pinned",
      },
      {
        kind: "supertag-template-field-static-default-set",
        supertagId: "task-supertag",
        templateFieldId: field.factActionId,
        value: "Ready",
      },
    ]);

    const restarted = await open(documents, "502");
    const restored = await templateField(restarted.workspace, "task-supertag", "status-definition");
    expect(restored).toMatchObject({ factActionId: field.factActionId, visibility: "pinned" });
    expect(restored.staticDefaultCandidates).toEqual([expect.objectContaining({ value: "Ready" })]);
  });
});

async function open(documents = new InMemoryDocumentStore(), loroPeerId: `${number}` = "101") {
  const facts = await FactAuthority.open({ workspaceId: "workspace", loroPeerId, documents });
  return { facts, workspace: await Workspace.open({ workspaceId: "workspace", facts, versions }) };
}

function setupNodes(): EditAction[] {
  return [
    nodeAt("task", "workspace"),
    nodeAt("task-supertag", "workspace", "supertag-definition"),
    nodeAt("other-supertag", "workspace", "supertag-definition"),
  ];
}

function nodeAt(nodeId: string, parentNodeId: string, intrinsicNodeType?: "supertag-definition"): EditAction {
  return {
    kind: "node-create",
    nodeId,
    occurrenceId: `${nodeId}-original`,
    parentNodeId,
    anchor: end,
    ...(intrinsicNodeType ? { intrinsicNodeType } : {}),
  };
}

function templateFieldCreation(supertagId: string, fieldDefinitionId: string): EditAction {
  return {
    kind: "supertag-template-field-create",
    supertagId,
    fieldDefinitionId,
    anchor: end,
    fieldDefinitionSeed: { text: [{ value: "Status", attributes: {} }] },
  };
}

async function templateField(
  workspace: Workspace,
  supertagId: string,
  fieldDefinitionId: string,
  perspective: "origin" | "review" = "origin",
) {
  const fields = await projection(workspace, "templateFields", perspective);
  return required(
    fields.templateFields[supertagId]?.find((field) => field.fieldDefinitionId === fieldDefinitionId),
    "Template Field",
  );
}

async function projection<
  Section extends
    "templateFields" | "optionalFieldContributions" | "materializedFields" | "effectiveFields" | "nodeOwners" | "nodes",
>(workspace: Workspace, section: Section, perspective: "origin" | "review" = "origin") {
  const result = await workspace.query({ kind: "projection", workspaceId: "workspace", perspective, section });
  if (!(section in result)) {
    throw new Error(`Expected ${section} Projection`);
  }
  return result as Extract<typeof result, Record<Section, unknown>>;
}

async function publish(
  workspace: Workspace,
  invocationId: string,
  actions: EditAction[],
  intent: "direct" | "proposal" = "direct",
): Promise<void> {
  await publishCommand(workspace, {
    kind: "edit",
    workspaceId: "workspace",
    invocationId,
    actorId: "actor",
    intent,
    historyChannelId: "template-fields",
    actions,
  });
}

async function publishCommand(workspace: Workspace, command: Parameters<Workspace["execute"]>[0]): Promise<void> {
  const result = await workspace.execute(command);
  if (result.status === "rejected") {
    throw new Error(JSON.stringify(result.error));
  }
  expect(result.status).toBe("published");
}

async function acceptAllHunks(workspace: Workspace, invocationId: string): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || review.hunks.length === 0) {
      return;
    }
    await publishCommand(workspace, {
      kind: "resolve-review",
      workspaceId: "workspace",
      invocationId: `${invocationId}-${index}`,
      actorId: "reviewer",
      decision: "accept",
      selection: required(review.hunks[0], "Review Hunk").selection,
    });
  }
  throw new Error("Review did not converge");
}

async function historySelection(workspace: Workspace, channelId: string, operation: "undo" | "redo") {
  const history = await workspace.query({ kind: "history", workspaceId: "workspace", channelId });
  if (!(operation in history) || history[operation] === null) {
    throw new Error(`Expected Template Field ${operation}`);
  }
  return history[operation];
}

function nodeText(node: { content: readonly { kind: string; value?: string }[] } | undefined): string {
  return node?.content.flatMap((item) => (item.kind === "text" && item.value ? [item.value] : [])).join("") ?? "";
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}
