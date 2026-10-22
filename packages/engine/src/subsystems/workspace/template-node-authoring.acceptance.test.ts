import { describe, expect, it } from "vitest";
import type { EditAction, EngineCommand, ProjectionPage, ProjectionPageSection } from "@lode/sdk";
import { END_SEQUENCE_ANCHOR as end } from "@lode/sdk";
import { openTestWorkspace, type TestWorkspace } from "../../../tests/support/workspace/open-test-workspace.js";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { nodeAt, createSupertagApplication } from "../../../tests/support/workspace/edit-test-actions.js";
import { templateInstanceNodeId, workspaceTrashNodeId } from "../../domain/fact/index.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { FactAuthority } from "./authority/fact-authority.js";

describe("owned ordinary Template Node authoring", () => {
  it("creates one definition-owned Original and preserves its identity through edit, undo, redo, and restart", async () => {
    const documents = new InMemoryDocumentStore();
    const workspace = await open(documents, "801");
    await edit(workspace, "setup", [
      nodeAt("tag", "workspace", undefined, { intrinsicNodeType: "supertag-definition" }),
    ]);
    await edit(workspace, "create-template", [
      {
        kind: "node-create",
        occurrenceId: "guidance-original",
        parentNodeId: "tag",
        nodeId: "guidance",
        anchor: end,
        seed: { text: [{ value: "Guidance", attributes: {} }] },
      },
    ]);
    const occurrenceId = await ownedTemplate(workspace);
    await history(workspace, "undo", "undo-create");
    expect((await section(workspace, "supertagTemplateNodes")).supertagTemplateNodes.tag ?? []).toEqual([]);
    await history(workspace, "redo", "redo-create");
    expect(await ownedTemplate(workspace)).toBe(occurrenceId);

    await edit(workspace, "edit-template", [
      {
        kind: "rich-text-splice",
        nodeId: "guidance",
        anchor: end,
        deleteAtomIds: [],
        insert: " edited",
      },
    ]);
    expect(await text(workspace, "guidance")).toBe("Guidance edited");
    await history(workspace, "undo", "undo-edit");
    expect(await text(workspace, "guidance")).toBe("Guidance");
    await history(workspace, "redo", "redo-edit");
    expect(await text(workspace, "guidance")).toBe("Guidance edited");

    await edit(workspace, "delete-original", [{ kind: "occurrence-delete", occurrenceId }]);
    expect((await section(workspace, "nodeOwners")).nodeOwners.guidance).toBe(workspaceTrashNodeId("workspace"));
    expect((await section(workspace, "supertagTemplateNodes")).supertagTemplateNodes.tag ?? []).toEqual([]);
    await history(workspace, "undo", "undo-delete");
    expect(await ownedTemplate(workspace)).toBe(occurrenceId);
    await workspace.close();
    const restarted = await open(documents, "802");
    expect(await ownedTemplate(restarted)).toBe(occurrenceId);
    expect(await text(restarted, "guidance")).toBe("Guidance edited");
    await restarted.close();
  });

  it("shows the source without instance ownership and detaches the first local content edit", async () => {
    const workspace = await open(new InMemoryDocumentStore(), "803");
    await edit(workspace, "setup", [
      nodeAt("tag", "workspace", undefined, { intrinsicNodeType: "supertag-definition" }),
      nodeAt("note", "workspace"),
      {
        kind: "node-create",
        occurrenceId: "guidance-original",
        parentNodeId: "tag",
        nodeId: "guidance",
        anchor: end,
        seed: { text: [{ value: "Guidance", attributes: {} }] },
      },
      createSupertagApplication("note", "tag"),
    ]);
    const linked = (await section(workspace, "templateNodeInstances")).templateNodeInstances[0];
    expect(linked).toMatchObject({
      ownerNodeId: "note",
      templateNodeId: "guidance",
      instanceNodeId: null,
      state: "linked",
    });
    if (!linked) {
      throw new Error("Template instance is absent");
    }
    const instanceNodeId = templateInstanceNodeId("note", "guidance");
    expect((await section(workspace, "nodes")).nodes[instanceNodeId]).toBeUndefined();
    expect((await section(workspace, "nodeOwners")).nodeOwners.guidance).toBe("tag");
    await edit(workspace, "edit-local-instance", [
      { kind: "template-node-edit", ownerNodeId: "note", templateNodeId: "guidance", sourcePath: [], intents: [] },
      { kind: "rich-text-splice", nodeId: instanceNodeId, deleteAtomIds: [], anchor: end, insert: " local" },
    ]);
    expect(await text(workspace, "guidance")).toBe("Guidance");
    expect(await text(workspace, instanceNodeId)).toBe("Guidance local");
    expect((await section(workspace, "nodeOwners")).nodeOwners[instanceNodeId]).toBe("note");
    await workspace.close();
  });
  it("removes and restores an external template Reference without moving its source", async () => {
    const workspace = await open(new InMemoryDocumentStore(), "804");
    await edit(workspace, "external-setup", [
      nodeAt("tag", "workspace", undefined, { intrinsicNodeType: "supertag-definition" }),
      nodeAt("external", "workspace", "external-original"),
      {
        kind: "occurrence-create",
        parentNodeId: "tag",
        nodeId: "external",
        occurrenceId: "external-template",
        anchor: end,
      },
    ]);
    await edit(workspace, "remove-external", [{ kind: "occurrence-delete", occurrenceId: "external-template" }]);
    expect((await section(workspace, "occurrences")).occurrences["external-template"]).toBeUndefined();
    expect((await section(workspace, "nodeOwners")).nodeOwners.external).toBe("workspace");
    await history(workspace, "undo", "undo-external-removal");
    expect((await section(workspace, "childOccurrences")).childOccurrences.tag).toEqual(["external-template"]);
    expect((await section(workspace, "supertagTemplateNodes")).supertagTemplateNodes.tag).toEqual(["external"]);
    await history(workspace, "redo", "redo-external-removal");
    expect((await section(workspace, "occurrences")).occurrences["external-template"]).toBeUndefined();
    expect((await section(workspace, "occurrences")).occurrences["external-original"]).toMatchObject({
      nodeId: "external",
      parentNodeId: "workspace",
    });
    const rejected = await workspace.execute({
      kind: "edit",
      workspaceId: "workspace",
      actorId: "actor",
      invocationId: "reuse-original-id",
      intent: "direct",
      historyChannelId: "owned-template",
      actions: [
        {
          kind: "occurrence-create",
          parentNodeId: "tag",
          nodeId: "external",
          occurrenceId: "external-original",
          anchor: end,
        },
      ],
    });
    expect(rejected).toMatchObject({ status: "rejected" });
    expect((await section(workspace, "occurrences")).occurrences["external-original"]).toMatchObject({
      parentNodeId: "workspace",
    });
    await workspace.close();
  });
});

async function open(documents: InMemoryDocumentStore, loroPeerId: `${number}`) {
  const facts = await FactAuthority.open({ workspaceId: "workspace", documents, loroPeerId });
  return openTestWorkspace({ workspaceId: "workspace", facts, versions });
}
async function edit(workspace: TestWorkspace, invocationId: string, actions: readonly EditAction[]) {
  return publish(workspace, {
    kind: "edit",
    workspaceId: "workspace",
    actorId: "actor",
    invocationId,
    intent: "direct",
    historyChannelId: "owned-template",
    actions,
  });
}
async function publish(workspace: TestWorkspace, command: EngineCommand) {
  const result = await workspace.execute(command);
  expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
}
async function history(workspace: TestWorkspace, operation: "undo" | "redo", invocationId: string) {
  const result = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "owned-template" });
  if (!(operation in result) || result[operation] === null) {
    throw new Error(`Expected ${operation}`);
  }
  await publish(workspace, {
    kind: operation,
    workspaceId: "workspace",
    actorId: "actor",
    invocationId,
    selection: result[operation],
  });
}
async function section<S extends ProjectionPageSection>(
  workspace: TestWorkspace,
  requested: S,
): Promise<ProjectionPage<S>> {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section: requested,
  });
  if (!("section" in result) || result.section !== requested) {
    throw new Error(`Expected ${requested}`);
  }
  return result as ProjectionPage<S>;
}
async function text(workspace: TestWorkspace, nodeId: string) {
  return (await section(workspace, "nodes")).nodes[nodeId]?.content
    .flatMap((item) => (item.kind === "text" ? [item.value] : []))
    .join("");
}
async function ownedTemplate(workspace: TestWorkspace) {
  const children = (await section(workspace, "childOccurrences")).childOccurrences;
  const occurrences = (await section(workspace, "occurrences")).occurrences;
  const sourceOccurrences = Object.values(occurrences).filter((occurrence) => occurrence.nodeId === "guidance");
  expect(sourceOccurrences).toHaveLength(1);
  const occurrenceId = sourceOccurrences[0]?.occurrenceId;
  expect(children.tag).toEqual([occurrenceId]);
  expect((children.workspace ?? []).every((id) => occurrences[id]?.nodeId !== "guidance")).toBe(true);
  expect((await section(workspace, "nodeOwners")).nodeOwners.guidance).toBe("tag");
  expect((await section(workspace, "supertagTemplateNodes")).supertagTemplateNodes.tag).toEqual(["guidance"]);
  if (!occurrenceId) {
    throw new Error("Owned Template occurrence is absent");
  }
  return occurrenceId;
}
