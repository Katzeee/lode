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
    const actions = () => {
      const current = controller.getSnapshot();
      const graph = current.graph!;
      return workspaceOutlineActions(
        graph,
        controller,
        projectWorkspaceOutline(graph, current.drafts, "parent").bindings,
        "parent",
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
  } finally {
    stop?.();
    await engine.stop();
    expect(resolve(path).startsWith(resolve(tmpdir()) + sep), "Test data stays inside the temporary directory").toBe(
      true,
    );
    await rm(path, { recursive: true, force: true });
  }
}, 20000);
