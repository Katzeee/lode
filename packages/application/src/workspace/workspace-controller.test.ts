import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDesktopEngine } from "@lode/engine-platform-desktop";
import { describe, expect, it } from "vitest";
import { ApplicationSession } from "../session/session.js";
import { connectApplication, dispatchApplicationRequest } from "../session/connection.js";
import { WorkspaceController } from "./workspace-controller.js";
import { nodeText, readWorkspace } from "./workspace-model.js";

const peerTransport = {
  start: () => {},
  close: () => {},
  dial: () => {
    throw new Error("No peer in this local test");
  },
};
describe("application lifecycle with a real Engine", () => {
  it("preserves identity and editing across restart, coalesces duplicate saves and uses Engine undo", async () => {
    const path = await mkdtemp(join(tmpdir(), "lode-application-"));
    let engine = createDesktopEngine({ dataRoot: path, peerTransport });
    let stop: (() => void) | undefined;
    try {
      await engine.start();
      const session = new ApplicationSession(engine.api);
      let dropReply = false;
      const host = connectApplication({
        request: async (method, input) => {
          const result = structuredClone(await dispatchApplicationRequest(session, method, structuredClone(input)));
          if (method === "execute" && dropReply) {
            dropReply = false;
            throw new Error("Connection lost after commit");
          }
          return result;
        },
        subscribe: () => () => {},
      });
      expect((await host.getState()).phase).toBe("initializing");
      const initialized = await host.initialize({ actorLabel: "Writer", passphrase: " passphrase with spaces " });
      expect(initialized.recoveryPhrase.split(" ").length).toBeGreaterThanOrEqual(12);
      const state = await host.createWorkspace("Notes");
      const workspaceId = state.workspaces[0]!.workspaceId;
      const controller = new WorkspaceController(host.engine, workspaceId, state.actors[0]!.actorId);
      stop = controller.start();
      await controller.whenIdle();
      controller.create();
      await controller.whenIdle();
      const graph = controller.getSnapshot().graph!;
      const occurrence = Object.values(graph.occurrences).find(
        (item) => item.parentNodeId === graph.rootNodeId && !graph.systemNodeIds.includes(item.nodeId),
      )!;
      expect(occurrence).toBeDefined();
      controller.stage(occurrence.occurrenceId, "First draft");
      controller.flush();
      controller.flush();
      await controller.whenIdle();
      expect(controller.getSnapshot().error).toBeNull();
      expect(nodeText(controller.getSnapshot().graph!.nodes[occurrence.nodeId]!)).toBe("First draft");
      dropReply = true;
      controller.stage(occurrence.occurrenceId, "Final note 🌱");
      controller.flush();
      await controller.whenIdle();
      controller.history("undo");
      await controller.whenIdle();
      expect(nodeText(controller.getSnapshot().graph!.nodes[occurrence.nodeId]!)).toBe("First draft");
      controller.history("redo");
      await controller.whenIdle();
      expect(nodeText(controller.getSnapshot().graph!.nodes[occurrence.nodeId]!)).toBe("Final note 🌱");
      stop();
      stop = undefined;
      await controller.whenIdle();
      await engine.stop();
      engine = createDesktopEngine({ dataRoot: path, peerTransport });
      await engine.start();
      const reopened = new ApplicationSession(engine.api);
      expect((await reopened.getState()).phase).toBe("locked");
      await expect(reopened.unlock("passphrase with spaces")).rejects.toThrow();
      await reopened.unlock(" passphrase with spaces ");
      expect(nodeText((await readWorkspace(reopened.engine, workspaceId)).nodes[occurrence.nodeId]!)).toBe(
        "Final note 🌱",
      );
    } finally {
      stop?.();
      await engine.stop();
      await rm(path, { recursive: true, force: true });
    }
  }, 20_000);
  it("retains a local draft when another client edits the same node", async () => {
    const path = await mkdtemp(join(tmpdir(), "lode-application-conflict-"));
    const engine = createDesktopEngine({ dataRoot: path, peerTransport });
    let stop: (() => void) | undefined;
    try {
      await engine.start();
      const session = new ApplicationSession(engine.api);
      await session.initialize({ actorLabel: "Writer", passphrase: "test passphrase" });
      const state = await session.createWorkspace("Notes");
      const workspaceId = state.workspaces[0]!.workspaceId;
      const actorId = state.actors[0]!.actorId;
      const controller = new WorkspaceController(session.engine, workspaceId, actorId);
      stop = controller.start();
      await controller.whenIdle();
      controller.create();
      await controller.whenIdle();
      const graph = controller.getSnapshot().graph!;
      const occurrence = Object.values(graph.occurrences).find(
        (item) => item.parentNodeId === graph.rootNodeId && !graph.systemNodeIds.includes(item.nodeId),
      )!;
      controller.stage(occurrence.occurrenceId, "Local draft");
      await session.engine.execute({
        kind: "edit",
        workspaceId,
        actorId,
        invocationId: crypto.randomUUID(),
        historyChannelId: "other",
        intent: "direct",
        actions: [
          {
            kind: "rich-text-splice",
            nodeId: occurrence.nodeId,
            deleteAtomIds: [],
            anchor: { before: null, after: null, affinity: "after", fallback: "end" },
            insert: "External note",
          },
        ],
      });
      controller.flush();
      await controller.whenIdle();
      expect(controller.getSnapshot().drafts.get(occurrence.nodeId)?.text).toBe("Local draft");
      expect(controller.getSnapshot().error).toContain("another client");
      expect(nodeText((await readWorkspace(session.engine, workspaceId)).nodes[occurrence.nodeId]!)).toBe(
        "External note",
      );
    } finally {
      stop?.();
      await engine.stop();
      await rm(path, { recursive: true, force: true });
    }
  }, 20_000);
});
