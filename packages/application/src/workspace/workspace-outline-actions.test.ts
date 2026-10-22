import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createDesktopEngine } from "@lode/engine-platform-desktop";
import { END_SEQUENCE_ANCHOR as end } from "@lode/sdk";
import { expect, it } from "vitest";
import { ApplicationSession } from "../session/session.js";
import { WorkspaceController } from "./workspace-controller.js";
import { projectWorkspaceOutline } from "./workspace-outline.js";
import { workspaceOutlineActions } from "./workspace-outline-actions.js";

it("clears, pastes and undoes an appearance in its original sibling slot", async () => {
  const path = await mkdtemp(join(tmpdir(), "lode-appearance-"));
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
    await session.initialize({ actorLabel: "Writer", passphrase: "appearance-test-passphrase" });
    const state = await session.createWorkspace("Appearance editing");
    const workspaceId = state.workspaces[0]!.workspaceId;
    const controller = new WorkspaceController(session.engine, workspaceId, state.actors[0]!.actorId);
    stop = controller.start();
    await controller.whenIdle();
    await controller.apply(() => [
      {
        kind: "node-create",
        nodeId: "target",
        occurrenceId: "target-original",
        parentNodeId: workspaceId,
        anchor: end,
      },
      {
        kind: "node-create",
        nodeId: "parent",
        occurrenceId: "parent-original",
        parentNodeId: workspaceId,
        anchor: end,
      },
      { kind: "node-create", nodeId: "first", occurrenceId: "first-original", parentNodeId: "parent", anchor: end },
      { kind: "occurrence-create", nodeId: "target", occurrenceId: "reference", parentNodeId: "parent", anchor: end },
      { kind: "node-create", nodeId: "last", occurrenceId: "last-original", parentNodeId: "parent", anchor: end },
    ]);
    const actions = (root = "parent") => {
      const current = controller.getSnapshot();
      const graph = current.graph!;
      return workspaceOutlineActions(
        graph,
        controller,
        projectWorkspaceOutline(graph, current.drafts, root).bindings,
        root,
      );
    };
    const children = () => controller.getSnapshot().graph!.childOccurrences.parent;
    const original = ["first-original", "reference", "last-original"];
    expect(children()).toEqual(original);
    const empty = actions().clear(JSON.stringify(["reference"]));
    expect(empty).not.toBeNull();
    await controller.whenIdle();
    const emptyId = (JSON.parse(empty!.key) as string[])[0]!;
    expect(controller.getSnapshot().error).toBeNull();
    expect(children()).toEqual(["first-original", emptyId, "last-original"]);
    const restored = await actions().history("undo", empty);
    expect(children()).toEqual(original);
    expect(restored?.position).toMatchObject({ key: JSON.stringify(["reference"]), editing: false });
    await actions().history("redo", restored?.position ?? null);
    expect(children()).toEqual(["first-original", emptyId, "last-original"]);
    const pasted = actions().paste(empty!.key, {
      items: [{ content: [], children: [], data: { workspaceId, nodeId: "target" } }],
      selection: { from: 0, to: 0 },
      placement: "after",
      replaceEmpty: true,
    });
    expect(pasted).not.toBeNull();
    await controller.whenIdle();
    const pastedId = (JSON.parse(pasted!.key) as string[])[0]!;
    expect(controller.getSnapshot().error).toBeNull();
    expect(children()).toEqual(["first-original", pastedId, "last-original"]);
    await actions().history("undo", pasted);
    expect(children()).toEqual(["first-original", emptyId, "last-original"]);

    await controller.apply(() => [
      {
        kind: "node-create",
        nodeId: "destination",
        occurrenceId: "destination-occ",
        parentNodeId: workspaceId,
        anchor: end,
      },
      { kind: "node-create", nodeId: "before", occurrenceId: "before-occ", parentNodeId: "destination", anchor: end },
      { kind: "node-create", nodeId: "slot", occurrenceId: "slot-occ", parentNodeId: "destination", anchor: end },
      { kind: "node-create", nodeId: "after", occurrenceId: "after-occ", parentNodeId: "destination", anchor: end },
      { kind: "node-create", nodeId: "child", occurrenceId: "child-occ", parentNodeId: "first", anchor: end },
      {
        kind: "occurrence-create",
        nodeId: "first",
        occurrenceId: "first-reference",
        parentNodeId: workspaceId,
        anchor: end,
      },
    ]);
    const cut = actions().copy([JSON.stringify(["first-original"])], "cut");
    actions().remove([JSON.stringify(["first-original"])]);
    await controller.whenIdle();
    expect(controller.getSnapshot().graph!.nodeOwners.first).toBe(
      controller.getSnapshot().graph!.workspaceSystemNodes.trash,
    );
    const moved = actions("destination").paste(JSON.stringify(["slot-occ"]), {
      items: cut,
      selection: { from: 0, to: 0 },
      placement: "after",
      replaceEmpty: true,
    });
    await controller.whenIdle();
    expect(controller.getSnapshot().error).toBeNull();
    expect(controller.getSnapshot().graph!.childOccurrences.destination).toEqual([
      "before-occ",
      "first-original",
      "after-occ",
    ]);
    expect(controller.getSnapshot().graph!.nodeOwners.first).toBe("destination");
    expect(controller.getSnapshot().graph!.childOccurrences.first).toEqual(["child-occ"]);
    expect(controller.getSnapshot().graph!.occurrences["first-reference"]?.nodeId).toBe("first");
    await actions("destination").history("undo", moved);
    expect(controller.getSnapshot().graph!.nodeOwners.first).toBe(
      controller.getSnapshot().graph!.workspaceSystemNodes.trash,
    );
    await actions().history("undo", null);
    expect(controller.getSnapshot().error).toBeNull();
    expect(children()).toEqual(["first-original", emptyId, "last-original"]);
    expect(controller.getSnapshot().graph!.nodeOwners.first).toBe("parent");

    const cutReference = actions(workspaceId).copy([JSON.stringify(["first-reference"])], "cut");
    actions(workspaceId).remove([JSON.stringify(["first-reference"])]);
    await controller.whenIdle();
    expect(controller.getSnapshot().graph!.nodeOwners.first).toBe("parent");
    const pastedReference = actions("destination").paste(JSON.stringify(["slot-occ"]), {
      items: cutReference,
      selection: { from: 0, to: 0 },
      placement: "after",
      replaceEmpty: true,
    });
    await controller.whenIdle();
    expect(controller.getSnapshot().error).toBeNull();
    expect(controller.getSnapshot().graph!.occurrences["first-reference"]?.parentNodeId).toBe("destination");
    expect(controller.getSnapshot().graph!.nodeOwners.first).toBe("parent");
    await actions("destination").history("undo", pastedReference);
    await actions(workspaceId).history("undo", null);
    expect(controller.getSnapshot().error).toBeNull();
    expect(controller.getSnapshot().graph!.occurrences["first-reference"]?.parentNodeId).toBe(workspaceId);

    await controller.apply(() => [
      {
        kind: "node-create",
        nodeId: "merge-target",
        occurrenceId: "merge-target-occ",
        parentNodeId: workspaceId,
        anchor: end,
        seed: { text: [{ value: "Alpha ", attributes: {} }] },
      },
      {
        kind: "node-create",
        nodeId: "merge-source",
        occurrenceId: "merge-source-occ",
        parentNodeId: workspaceId,
        anchor: end,
        seed: { text: [{ value: "Beta", attributes: {} }] },
      },
    ]);
    actions(workspaceId).merge({
      sourceKey: JSON.stringify(["merge-source-occ"]),
      targetKey: JSON.stringify(["merge-target-occ"]),
      content: [{ type: "text", text: "Alpha Beta" }],
    });
    controller.stageNode("merge-target", [{ type: "text", text: "Alpha Beta!" }]);
    controller.flush();
    await controller.whenIdle();
    expect(controller.getSnapshot().error).toBeNull();
    expect(
      controller
        .getSnapshot()
        .graph!.nodes["merge-target"]!.content.map((part) => (part.kind === "text" ? part.value : "@"))
        .join(""),
      "typing after a queued merge must not be overwritten by that merge",
    ).toBe("Alpha Beta!");
  } finally {
    stop?.();
    await engine.stop();
    expect(resolve(path).startsWith(resolve(tmpdir()) + sep), "Test data stays inside the temporary directory").toBe(
      true,
    );
    await rm(path, { recursive: true, force: true });
  }
}, 20000);
