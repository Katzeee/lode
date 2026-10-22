import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createDesktopEngine } from "@lode/engine-platform-desktop";
import { END_SEQUENCE_ANCHOR as end } from "@lode/sdk";
import { expect, it } from "vitest";
import { ApplicationSession } from "../session/session.js";
import { WorkspaceController } from "./workspace-controller.js";
import { projectWorkspaceRegion } from "./workspace-region-projection.js";
import { workspaceOutlineActions } from "./workspace-outline-actions.js";
import { nodeText } from "./workspace-model.js";

it("edits deferred multi-value cells and template defaults through their real Engine targets", async () => {
  const path = await mkdtemp(join(tmpdir(), "lode-regions-"));
  const engine = createDesktopEngine({
    dataRoot: path,
    peerTransport: {
      start: () => {},
      close: () => {},
      dial: () => {
        throw new Error("Local test");
      },
    },
  });
  let stop: (() => void) | undefined;
  try {
    await engine.start();
    const session = new ApplicationSession(engine.api);
    await session.initialize({ actorLabel: "Writer", passphrase: "region-test-passphrase" });
    const state = await session.createWorkspace("Collections");
    const workspaceId = state.workspaces[0]!.workspaceId;
    const controller = new WorkspaceController(session.engine, workspaceId, state.actors[0]!.actorId);
    stop = controller.start();
    await controller.whenIdle();
    expect(
      await controller.apply(() => [
        {
          kind: "node-create",
          nodeId: "owner",
          occurrenceId: "owner-occ",
          parentNodeId: workspaceId,
          anchor: end,
          seed: { text: [{ value: "Owner", attributes: {} }] },
        },
        {
          kind: "node-create",
          nodeId: "field",
          occurrenceId: "field-occ",
          parentNodeId: controller.getSnapshot().graph!.workspaceSystemNodes.schema!,
          intrinsicNodeType: "field-definition",
          anchor: end,
        },
        {
          kind: "node-create",
          nodeId: "tag",
          occurrenceId: "tag-occ",
          parentNodeId: workspaceId,
          intrinsicNodeType: "supertag-definition",
          anchor: end,
        },
      ]),
    ).toBe(true);
    const source = { kind: "field-values", ownerNodeId: "owner", fieldDefinitionId: "field" } as const;
    const region = () => projectWorkspaceRegion(controller.viewGraph()!, controller.getSnapshot(), source, "cell");
    const before = controller.getSnapshot().graph!.generationId;
    const empty = controller.prepareField("owner", "field");
    controller.flush();
    await controller.whenIdle();
    expect(controller.getSnapshot().graph!.generationId).toBe(before);
    expect(controller.getSnapshot().graph!.materializedFields.owner ?? []).toHaveLength(0);
    expect(region().items[0]).toMatchObject({ key: `cell:${JSON.stringify([empty.occurrenceId])}`, placeholder: true });
    expect(
      await controller.apply(() => [
        { kind: "shared-default-view-create", hostNodeId: "owner", viewType: "outline", anchor: end },
      ]),
    ).toBe(true);
    expect(controller.getSnapshot().graph!.nodes[empty.nodeId]).toBeUndefined();
    expect(controller.getSnapshot().graph!.materializedFields.owner ?? []).toHaveLength(0);
    controller.commitNode(empty.nodeId, [], "blur");
    expect(region().items).toHaveLength(0);
    const value = controller.prepareField("owner", "field");
    controller.stageNode(value.nodeId, [{ type: "text", text: "Alpha" }]);
    controller.flush();
    controller.stageNode(value.nodeId, [{ type: "text", text: "Alpha continued" }]);
    controller.flush();
    await controller.whenIdle();
    expect(controller.getSnapshot().error).toBeNull();
    const field = controller.getSnapshot().graph!.materializedFields.owner![0]!;
    expect(field.valueOccurrenceIds).toEqual([value.occurrenceId]);
    expect(nodeText(controller.getSnapshot().graph!.nodes[value.nodeId]!)).toBe("Alpha continued");
    expect(region().items[0]!.key).toBe(`cell:${JSON.stringify([value.occurrenceId])}`);
    const beta = controller.create(value.occurrenceId, "after", [{ type: "text", text: "Beta" }])!;
    const child = controller.create(beta.occurrenceId, "child", [{ type: "text", text: "Nested" }])!;
    await controller.whenIdle();
    expect(controller.getSnapshot().error).toBeNull();
    expect(region().items[1]?.children?.[0]?.key).toBe(
      `cell:${JSON.stringify([beta.occurrenceId, child.occurrenceId])}`,
    );
    const keys = () => controller.getSnapshot().graph!.materializedFields.owner![0]!.valueOccurrenceIds;
    const scopedActions = () => {
      const projected = region();
      return workspaceOutlineActions(
        controller.viewGraph()!,
        controller,
        projected.bindings,
        projected.rootNodeId,
        (path) => `cell:${JSON.stringify(path)}`,
      );
    };
    await scopedActions().move({
      kind: "absolute",
      sourceKeys: [`cell:${JSON.stringify([beta.occurrenceId])}`],
      targetParentKey: `cell:${JSON.stringify([value.occurrenceId])}`,
      index: 0,
    });
    expect(controller.getSnapshot().error).toBeNull();
    expect(keys()).toEqual([value.occurrenceId]);
    const restored = await scopedActions().history("undo", {
      key: `cell:${JSON.stringify([value.occurrenceId, beta.occurrenceId])}`,
      caret: 2,
    });
    expect(restored?.position?.key).toBe(`cell:${JSON.stringify([beta.occurrenceId])}`);
    expect(keys()).toEqual([value.occurrenceId, beta.occurrenceId]);
    expect(
      await controller.apply(() => [
        { kind: "shared-default-view-create", hostNodeId: workspaceId, viewType: "table", anchor: end },
      ]),
    ).toBe(true);
    const view = controller.getSnapshot().graph!.sharedDefaultViewDefinitions[workspaceId]![0]!;
    expect(
      await controller.apply(() => [
        {
          kind: "view-column-add",
          hostNodeId: workspaceId,
          viewId: view.viewId,
          fieldDefinitionId: "field",
          anchor: end,
        },
      ]),
    ).toBe(true);
    const row = (await controller.viewRows(workspaceId)).rows.find((row) => row.targetNodeId === "owner")!;
    expect(row.sourceIdentity).toBe("owner-occ");
    expect(row.cells[0]?.valueNodeIds).toEqual([value.nodeId, beta.nodeId]);
    expect(
      await controller.apply(() => [
        { kind: "supertag-template-field-add-existing", supertagId: "tag", fieldDefinitionId: "field", anchor: end },
      ]),
      controller.getSnapshot().error ?? undefined,
    ).toBe(true);
    const template = controller.getSnapshot().graph!.templateFields.tag![0]!;
    const defaultTarget = {
      kind: "template-default",
      nodeId: template.staticDefaultValueNodeId,
      supertagId: "tag",
      templateFieldId: template.factActionId,
    } as const;
    controller.stageContent(defaultTarget, [{ type: "text", text: "Default A" }]);
    controller.flush();
    await controller.whenIdle();
    expect(controller.getSnapshot().error).toBeNull();
    expect(nodeText(controller.getSnapshot().graph!.nodes[template.staticDefaultValueNodeId]!)).toBe("Default A");
    expect(
      await controller.apply(() => [
        {
          kind: "node-create",
          nodeId: "instance",
          occurrenceId: "instance-occ",
          parentNodeId: workspaceId,
          anchor: end,
        },
        { kind: "supertag-application-create", hostNodeId: "instance", supertagId: "tag", anchor: end },
      ]),
    ).toBe(true);
    const instanceValue = controller.getSnapshot().graph!.materializedFields.instance![0]!.valueOccurrenceIds[0]!;
    controller.stageContent(defaultTarget, [{ type: "text", text: "Default B" }]);
    controller.flush();
    await controller.whenIdle();
    const graph = controller.getSnapshot().graph!;
    expect(nodeText(graph.nodes[graph.occurrences[instanceValue]!.nodeId]!)).toBe("Default A");
    expect(nodeText(graph.nodes[value.nodeId]!)).toBe("Alpha continued");
    expect(nodeText(graph.nodes[template.staticDefaultValueNodeId]!)).toBe("Default B");
    controller.stageContent(defaultTarget, [{ type: "text", text: "Default B" }]);
    controller.flush();
    await controller.whenIdle();
    expect(controller.getSnapshot().error).toBeNull();
    const referenceOwner = controller.prepare(workspaceId, [{ type: "text", text: "References" }]);
    await controller.whenIdle();
    const slot = controller.prepareField(referenceOwner.nodeId, "field");
    const referenceRegion = projectWorkspaceRegion(
      controller.viewGraph()!,
      controller.getSnapshot(),
      { kind: "field-values", ownerNodeId: referenceOwner.nodeId, fieldDefinitionId: "field" },
      "reference-cell",
    );
    const pasted = workspaceOutlineActions(
      controller.viewGraph()!,
      controller,
      referenceRegion.bindings,
      referenceRegion.rootNodeId,
      (path) => `reference-cell:${JSON.stringify(path)}`,
    ).paste(referenceRegion.items[0]!.key, {
      items: [{ content: [], children: [], data: { workspaceId, nodeId: value.nodeId } }],
      placement: "after",
      replaceEmpty: true,
      selection: { from: 0, to: 0 },
    });
    expect(pasted).not.toBeNull();
    await controller.whenIdle();
    const referencedGraph = controller.getSnapshot().graph!;
    const referenceField = referencedGraph.materializedFields[referenceOwner.nodeId]![0]!;
    expect(referenceField.valueOccurrenceIds).toHaveLength(1);
    expect(referencedGraph.occurrences[referenceField.valueOccurrenceIds[0]!]!.nodeId).toBe(value.nodeId);
    expect(referencedGraph.nodes[slot.nodeId]).toBeUndefined();
    expect(referencedGraph.nodeOwners[value.nodeId]).toBe(field.fieldNodeId);
    expect(controller.getSnapshot().error).toBeNull();
  } finally {
    stop?.();
    await engine.stop();
    expect(resolve(path).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    await rm(path, { recursive: true, force: true });
  }
}, 25_000);
