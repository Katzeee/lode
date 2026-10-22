import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createDesktopEngine } from "@lode/engine-platform-desktop";
import { END_SEQUENCE_ANCHOR as anchor } from "@lode/sdk";
import { expect, it } from "vitest";
import { ApplicationSession } from "../session/session.js";
import { WorkspaceController } from "./workspace-controller.js";
import { projectWorkspaceOutline } from "./workspace-outline.js";
import { workspaceMovement } from "./workspace-movement.js";

it("maps both queued and current paths when successive relative moves cross ancestors", async () => {
  const path = await mkdtemp(join(tmpdir(), "lode-movement-"));
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
    await session.initialize({ actorLabel: "Writer", passphrase: "movement-test-passphrase" });
    const state = await session.createWorkspace("Movement");
    const workspaceId = state.workspaces[0]!.workspaceId;
    const controller = new WorkspaceController(session.engine, workspaceId, state.actors[0]!.actorId);
    stop = controller.start();
    await controller.whenIdle();
    expect(
      await controller.apply(() => [
        ...[
          ["a", workspaceId],
          ["b", "a"],
          ["c", "b"],
        ].map(([nodeId, parentNodeId]) => ({
          kind: "node-create" as const,
          nodeId: nodeId!,
          parentNodeId: parentNodeId!,
          occurrenceId: `${nodeId}-occ`,
          anchor,
        })),
      ]),
    ).toBe(true);
    const graph = controller.viewGraph()!;
    const projection = projectWorkspaceOutline(graph, controller.getSnapshot().drafts, workspaceId);
    const key = (parts: readonly string[]) => JSON.stringify(parts);
    const move = workspaceMovement(controller, projection.bindings, workspaceId, key);
    const original = key(["a-occ", "b-occ", "c-occ"]);
    const first = move({ kind: "relative", operation: "outdent", sourceKeys: [original] });
    const second = move({ kind: "relative", operation: "outdent", sourceKeys: [original] });
    expect((await first)?.keyMap.get(original)).toBe(key(["a-occ", "c-occ"]));
    const result = await second;
    expect(controller.viewGraph()!.nodeOwners.c).toBe(workspaceId);
    expect(result?.keyMap.get(original)).toBe(key(["c-occ"]));
    expect(result?.keyMap.get(key(["a-occ", "c-occ"]))).toBe(key(["c-occ"]));
  } finally {
    stop?.();
    await engine.stop();
    expect(resolve(path).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    await rm(path, { recursive: true, force: true });
  }
});
