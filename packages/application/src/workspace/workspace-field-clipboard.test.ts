import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createDesktopEngine } from "@lode/engine-platform-desktop";
import { END_SEQUENCE_ANCHOR as anchor } from "@lode/sdk";
import { expect, it } from "vitest";
import { ApplicationSession } from "../session/session.js";
import { WorkspaceController } from "./workspace-controller.js";
import { projectWorkspaceOutline } from "./workspace-outline.js";
import { projectWorkspaceRegion } from "./workspace-region-projection.js";
import { workspaceOutlineActions } from "./workspace-outline-actions.js";
import { nodeText } from "./workspace-model.js";

it("pastes a cut Original into an unmaterialized Field without publishing a placeholder or splitting History", async () => {
  const path = await mkdtemp(join(tmpdir(), "lode-field-clipboard-"));
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
    await session.initialize({ actorLabel: "Writer", passphrase: "clipboard-test-passphrase" });
    const state = await session.createWorkspace("Clipboard");
    const workspaceId = state.workspaces[0]!.workspaceId;
    const controller = new WorkspaceController(session.engine, workspaceId, state.actors[0]!.actorId);
    stop = controller.start();
    await controller.whenIdle();
    expect(
      await controller.apply(() => [
        { kind: "node-create", nodeId: "parent", occurrenceId: "parent-occ", parentNodeId: workspaceId, anchor },
        {
          kind: "node-create",
          nodeId: "source",
          occurrenceId: "source-occ",
          parentNodeId: "parent",
          anchor,
          seed: { text: [{ value: "Cut Original", attributes: {} }] },
        },
        { kind: "node-create", nodeId: "child", occurrenceId: "child-occ", parentNodeId: "source", anchor },
        {
          kind: "node-create",
          nodeId: "destination",
          occurrenceId: "destination-occ",
          parentNodeId: workspaceId,
          anchor,
        },
        { kind: "node-create", nodeId: "observer", occurrenceId: "observer-occ", parentNodeId: workspaceId, anchor },
        {
          kind: "occurrence-create",
          nodeId: "source",
          occurrenceId: "source-reference",
          parentNodeId: "observer",
          anchor,
        },
        {
          kind: "node-create",
          nodeId: "marker",
          occurrenceId: "marker-occ",
          parentNodeId: workspaceId,
          intrinsicNodeType: "supertag-definition",
          anchor,
        },
        { kind: "supertag-template-field-create", supertagId: "marker", fieldDefinitionId: "field", anchor },
        { kind: "supertag-application-create", hostNodeId: "destination", supertagId: "marker", anchor },
      ]),
    ).toBe(true);
    const graph = () => controller.getSnapshot().graph!;
    const sourceKey = JSON.stringify(["parent-occ", "source-occ"]);
    const outline = projectWorkspaceOutline(graph(), controller.getSnapshot().drafts, workspaceId);
    const actions = workspaceOutlineActions(graph(), controller, outline.bindings, workspaceId);
    const clipboard = actions.copy([sourceKey], "cut");
    expect(clipboard).toHaveLength(1);
    actions.remove([sourceKey]);
    await controller.whenIdle();
    expect(graph().nodeOwners.source).toBe(graph().workspaceSystemNodes.trash);
    const placeholder = controller.prepareField("destination", "field");
    const region = projectWorkspaceRegion(
      controller.viewGraph()!,
      controller.getSnapshot(),
      { kind: "field-values", ownerNodeId: "destination", fieldDefinitionId: "field" },
      "field",
    );
    const fieldActions = workspaceOutlineActions(
      controller.viewGraph()!,
      controller,
      region.bindings,
      region.rootNodeId,
      (path) => `field:${JSON.stringify(path)}`,
    );
    const result = fieldActions.paste(`field:${JSON.stringify([placeholder.occurrenceId])}`, {
      items: clipboard,
      selection: { from: 0, to: 0 },
      placement: "after",
      replaceEmpty: true,
    });
    expect(result?.key).toBe(`field:${JSON.stringify(["source-occ"])}`);
    await controller.whenIdle();
    expect(controller.getSnapshot().error).toBeNull();
    const field = graph().materializedFields.destination?.[0];
    expect(field?.valueOccurrenceIds).toEqual(["source-occ"]);
    expect(graph().nodeOwners.source).toBe(field?.fieldNodeId);
    expect(graph().nodes[placeholder.nodeId]).toBeUndefined();
    expect(graph().childOccurrences.source).toEqual(["child-occ"]);
    expect(graph().occurrences["source-reference"]).toMatchObject({ nodeId: "source", parentNodeId: "observer" });
    expect(nodeText(graph().nodes.source!)).toBe("Cut Original");
    expect(await controller.history("undo")).toBe(true);
    expect(graph().materializedFields.destination ?? []).toEqual([]);
    expect(graph().nodeOwners.source).toBe(graph().workspaceSystemNodes.trash);
    expect(await controller.history("undo")).toBe(true);
    expect(graph().nodeOwners.source).toBe("parent");
    expect(graph().childOccurrences.parent).toEqual(["source-occ"]);
    expect(graph().materializedFields.destination ?? []).toEqual([]);
    expect(nodeText(graph().nodes.source!)).toBe("Cut Original");
  } finally {
    stop?.();
    await engine.stop();
    expect(resolve(path).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    await rm(path, { recursive: true, force: true });
  }
}, 20000);
