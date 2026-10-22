import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createDesktopEngine } from "@lode/engine-platform-desktop";
import { END_SEQUENCE_ANCHOR, type EditAction } from "@lode/sdk";
import { expect, it } from "vitest";
import { ApplicationSession } from "../session/session.js";
import { readWorkspace } from "./workspace-model.js";
import { contentToSource } from "@lode/ui";
import { nodeLabel, nodeSource, referenceToken } from "./node-source.js";
import { editNodeSource } from "./node-edit.js";
import { WorkspaceController } from "./workspace-controller.js";

it("edits formatted source around identity-bearing references and preserves aliases and supertag applications", async () => {
  const path = await mkdtemp(join(tmpdir(), "lode-source-"));
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
  try {
    await engine.start();
    const session = new ApplicationSession(engine.api);
    await session.initialize({ actorLabel: "Writer", passphrase: "source-test-passphrase" });
    const state = await session.createWorkspace("Source editing");
    const workspaceId = state.workspaces[0]!.workspaceId;
    const actorId = state.actors[0]!.actorId;
    const write = async (actions: readonly EditAction[]) => {
      const result = await session.engine.execute({
        kind: "edit",
        workspaceId,
        actorId,
        invocationId: crypto.randomUUID(),
        historyChannelId: "source-test",
        intent: "direct",
        actions,
      });
      expect(result.status, JSON.stringify({ result, actions })).toBe("published");
    };
    await write([
      {
        kind: "node-create",
        nodeId: "target",
        occurrenceId: "target-original",
        parentNodeId: workspaceId,
        anchor: END_SEQUENCE_ANCHOR,
        seed: { text: [{ value: "Target", attributes: {} }] },
      },
      {
        kind: "node-create",
        nodeId: "host",
        occurrenceId: "host-original",
        parentNodeId: workspaceId,
        anchor: END_SEQUENCE_ANCHOR,
        seed: { text: [{ value: "Before ", attributes: {} }] },
      },
      {
        kind: "inline-reference-create",
        inlineReferenceId: "reference",
        hostNodeId: "host",
        targetNodeId: "target",
        anchor: END_SEQUENCE_ANCHOR,
      },
      {
        kind: "inline-reference-alias-create",
        inlineReferenceId: "reference",
        hostNodeId: "host",
        aliasNodeId: "alias",
        seed: { text: [{ value: "Local label", attributes: {} }] },
      },
      { kind: "rich-text-splice", nodeId: "host", deleteAtomIds: [], anchor: END_SEQUENCE_ANCHOR, insert: " after" },
      {
        kind: "node-create",
        nodeId: "project",
        occurrenceId: "project-original",
        parentNodeId: workspaceId,
        anchor: END_SEQUENCE_ANCHOR,
        intrinsicNodeType: "supertag-definition",
        seed: { text: [{ value: "project", attributes: {} }] },
      },
      { kind: "supertag-application-create", hostNodeId: "host", supertagId: "project", anchor: END_SEQUENCE_ANCHOR },
    ]);
    let graph = await readWorkspace(session.engine, workspaceId);
    const applicationId = graph.supertagApplications.host![0]!.applicationNodeId;
    const source = nodeSource(graph.nodes.host!, graph);
    expect(contentToSource(source)).toBe("Before @{Local label} after #{project}");
    expect(editNodeSource(graph.nodes.host!, source, graph)).toEqual([]);
    await write(editNodeSource(graph.nodes.host!, [{ type: "text", text: "**Changed** " }, ...source.slice(1)], graph));
    graph = await readWorkspace(session.engine, workspaceId);
    expect(nodeLabel(graph.nodes.host!, graph)).toBe("Changed Local label after");
    expect(graph.nodes.host!.content.find((item) => item.kind === "inline-reference")).toMatchObject({
      id: "reference",
      targetNodeId: "target",
      aliasNodeId: "alias",
    });
    expect(graph.supertagApplications.host![0]!.applicationNodeId).toBe(applicationId);
    expect(
      graph.nodes
        .host!.content.filter((item) => item.kind === "text" && item.attributes.bold === true)
        .map((item) => (item.kind === "text" ? item.value : ""))
        .join(""),
    ).toBe("Changed");

    const controller = new WorkspaceController(session.engine, workspaceId, actorId);
    const stop = controller.start();
    await controller.whenIdle();
    const repaired = contentToSource(nodeSource(graph.nodes.host!, graph));
    controller.stageNode("host", [{ type: "text", text: repaired.replace("@{Local label}", "@{Local label") }]);
    controller.flush();
    await controller.whenIdle();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(
      (await readWorkspace(session.engine, workspaceId)).nodes.host!.content.some(
        (item) => item.kind === "inline-reference" && item.id === "reference",
      ),
    ).toBe(true);
    await controller.history("undo");
    expect(controller.getSnapshot().drafts.size).toBe(0);
    expect(
      controller
        .getSnapshot()
        .graph!.nodes.host!.content.some((item) => item.kind === "inline-reference" && item.id === "reference"),
    ).toBe(true);
    await controller.history("redo");
    expect(controller.getSnapshot().drafts.size).toBe(1);
    controller.stageNode("host", [{ type: "text", text: repaired }]);
    controller.flush();
    await controller.whenIdle();
    expect(controller.getSnapshot().error).toBeNull();
    expect(
      controller.getSnapshot().graph!.nodes.host!.content.find((item) => item.kind === "inline-reference"),
    ).toMatchObject({ id: "reference", aliasNodeId: "alias" });
    const splitSource = nodeSource(controller.getSnapshot().graph!.nodes.host!, controller.getSnapshot().graph!);
    controller.split("host-original", [{ type: "text", text: "Left" }], splitSource.slice(1), "after");
    await controller.whenIdle();
    expect(controller.getSnapshot().error).toBeNull();
    const splitGraph = controller.getSnapshot().graph!;
    const right = Object.values(splitGraph.nodes).find(
      (node) =>
        node.nodeId !== "host" &&
        node.content.some((item) => item.kind === "inline-reference" && item.targetNodeId === "target"),
    );
    expect(right).toBeDefined();
    const copied = right!.content.find((item) => item.kind === "inline-reference");
    expect(copied?.kind === "inline-reference" ? splitGraph.nodeOwners[copied.aliasNodeId!] : null).toBe(right!.nodeId);
    await controller.history("undo");
    await controller.whenIdle();
    expect(controller.getSnapshot().error).toBeNull();
    expect(
      controller.getSnapshot().graph!.nodes.host!.content.find((item) => item.kind === "inline-reference"),
    ).toMatchObject({ id: "reference", aliasNodeId: "alias" });
    stop();
    await controller.whenIdle();

    await write([
      {
        kind: "node-create",
        nodeId: "mixed",
        occurrenceId: "mixed-original",
        parentNodeId: workspaceId,
        anchor: END_SEQUENCE_ANCHOR,
      },
    ]);
    graph = await readWorkspace(session.engine, workspaceId);
    await write(
      editNodeSource(
        graph.nodes.mixed!,
        [
          { type: "text", text: "**Hello** " },
          referenceToken({ kind: "reference", targetNodeId: "target" }, "Target"),
          { type: "text", text: " and __more__ " },
          referenceToken({ kind: "reference", targetNodeId: "target" }, "Target"),
          { type: "text", text: " end" },
        ],
        graph,
      ),
    );
    graph = await readWorkspace(session.engine, workspaceId);
    expect(nodeLabel(graph.nodes.mixed!, graph)).toBe("Hello Target and more Target end");
    expect(graph.nodes.mixed!.content.filter((item) => item.kind === "inline-reference")).toHaveLength(2);
    expect(
      editNodeSource(
        graph.nodes.mixed!,
        [
          { type: "text", text: "**Hello** " },
          referenceToken({ kind: "reference", targetNodeId: "target" }, "Target"),
          { type: "text", text: " and __more__ " },
          referenceToken({ kind: "reference", targetNodeId: "target" }, "Target"),
          { type: "text", text: " end" },
        ],
        graph,
      ),
    ).toEqual([]);
  } finally {
    await engine.stop();
    expect(resolve(path).startsWith(resolve(tmpdir()) + sep), "Test data stays inside the temporary directory").toBe(
      true,
    );
    await rm(path, { recursive: true, force: true });
  }
}, 20_000);
