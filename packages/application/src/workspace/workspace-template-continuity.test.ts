import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createDesktopEngine } from "@lode/engine-platform-desktop";
import { END_SEQUENCE_ANCHOR as anchor, type EngineApplicationContract } from "@lode/sdk";
import { contentToSource } from "@lode/ui";
import { expect, it } from "vitest";
import { ApplicationSession } from "../session/session.js";
import { WorkspaceController } from "./workspace-controller.js";
import { projectWorkspaceOutline } from "./workspace-outline.js";
import { nodeText } from "./workspace-model.js";

it("keeps successive inherited child insertions local while materialization is in flight", async () => {
  const f = await fixture();
  try {
    const source = f.appearance();
    const entered = f.hold();
    const first = f.controller.create(source.occurrenceId, "child", [], source.contentTarget)!;
    await entered;
    f.controller.commitNode(first.nodeId, text("First"), "operation");
    const second = f.controller.create(first.occurrenceId, "after")!;
    f.controller.commitNode(second.nodeId, text("Second🙂"), "operation");
    const pending = f.view("one").items[0]!.children!;
    expect(pending.slice(0, 2).map((item) => contentToSource(item.content))).toEqual(["First", "Second🙂"]);
    expect(f.view("two").items[0]!.children!.map((item) => contentToSource(item.content))).toEqual(["Nested child"]);
    f.release();
    await f.controller.whenIdle();
    expect(f.controller.getSnapshot().error).toBeNull();
    const graph = f.controller.viewGraph()!;
    const root = f.appearance().contentNodeId;
    const children = graph.childOccurrences[root]!;
    expect(children.slice(0, 2)).toEqual([first.occurrenceId, second.occurrenceId]);
    expect(graph.nodeOwners[first.nodeId]).toBe(root);
    expect(graph.nodeOwners[second.nodeId]).toBe(root);
    expect(nodeText(graph.nodes[second.nodeId]!)).toBe("Second🙂");
    f.assertSource();
  } finally {
    await f.close();
  }
});

it.each(["child", "split"] as const)(
  "preserves a later parent edit across its own pending %s materialization",
  async (operation) => {
    const f = await fixture();
    try {
      const source = f.appearance();
      const entered = f.hold();
      if (operation === "child") {
        f.controller.create(source.occurrenceId, "child", [], source.contentTarget);
      } else {
        f.controller.split(source.occurrenceId!, text("Alpha"), text("Omega"), "after", source.contentTarget);
      }
      await entered;
      const continued = operation === "child" ? "AlphaOmega continued🙂" : "Alpha continued🙂";
      f.controller.commitContent(source.contentTarget!, text(continued), "operation");
      expect(contentToSource(f.view("two").items[0]!.content)).toBe("AlphaOmega");
      f.release();
      await f.controller.whenIdle();
      expect(f.controller.getSnapshot().error).toBeNull();
      const current = f.appearance();
      expect(current.key).toBe(source.key);
      expect(current.contentNodeId).not.toBe("source");
      expect(nodeText(f.controller.viewGraph()!.nodes[current.contentNodeId]!)).toBe(continued);
      expect(f.controller.getSnapshot().drafts.size).toBe(0);
      f.assertSource();
    } finally {
      await f.close();
    }
  },
);

function text(value: string) {
  return [{ type: "text" as const, text: value }];
}

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), "lode-template-continuity-"));
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
  await engine.start();
  const session = new ApplicationSession(engine.api);
  await session.initialize({ actorLabel: "Writer", passphrase: "template-continuity-passphrase" });
  const state = await session.createWorkspace("Template continuity");
  const workspaceId = state.workspaces[0]!.workspaceId;
  let gate: Promise<void> | undefined;
  let release = () => {};
  let entered = () => {};
  const service: EngineApplicationContract = {
    ...session.engine,
    execute: async (command) => {
      if (gate && command.kind === "edit" && command.actions.some((action) => action.kind === "template-node-edit")) {
        const held = gate;
        gate = undefined;
        entered();
        await held;
      }
      return session.engine.execute(command);
    },
  };
  const controller = new WorkspaceController(service, workspaceId, state.actors[0]!.actorId);
  const stop = controller.start();
  await controller.whenIdle();
  const node = (nodeId: string, parentNodeId: string, value: string, intrinsicNodeType?: "supertag-definition") => ({
    kind: "node-create" as const,
    nodeId,
    parentNodeId,
    occurrenceId: `${nodeId}-occ`,
    anchor,
    ...(intrinsicNodeType ? { intrinsicNodeType } : {}),
    seed: { text: [{ value, attributes: {} }] },
  });
  expect(
    await controller.apply(() => [
      node("tag", workspaceId, "Tag", "supertag-definition"),
      node("source", "tag", "AlphaOmega"),
      node("nested", "source", "Nested child"),
      node("one", workspaceId, "One"),
      node("two", workspaceId, "Two"),
      ...["one", "two"].map((hostNodeId) => ({
        kind: "supertag-application-create" as const,
        hostNodeId,
        supertagId: "tag",
        anchor,
      })),
    ]),
  ).toBe(true);
  const source = controller.viewGraph()!.nodes.source;
  const nested = controller.viewGraph()!.nodes.nested;
  const view = (owner = "one") =>
    projectWorkspaceOutline(
      controller.viewGraph()!,
      controller.getSnapshot().drafts,
      owner,
      controller.getSnapshot().insertions,
    );
  return {
    controller,
    view,
    appearance: () =>
      [...view().bindings.values()].find(
        (item) => item.contentTarget?.kind === "template-instance" && item.contentTarget.sourcePath.length === 0,
      )!,
    hold: () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return new Promise<void>((resolve) => {
        entered = resolve;
      });
    },
    release: () => release(),
    assertSource: () => {
      const graph = controller.viewGraph()!;
      expect(graph.nodes.source).toEqual(source);
      expect(graph.nodes.nested).toEqual(nested);
      expect(graph.childOccurrences.source).toEqual(["nested-occ"]);
      expect(graph.templateNodeInstances.find((item) => item.ownerNodeId === "two")?.state).toBe("linked");
    },
    close: async () => {
      release();
      await controller.whenIdle();
      stop();
      await engine.stop();
      expect(resolve(path).startsWith(resolve(tmpdir()) + sep)).toBe(true);
      await rm(path, { recursive: true, force: true });
    },
  };
}
