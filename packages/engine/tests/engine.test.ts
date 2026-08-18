import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";

import { createEngine } from "../src/engine.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Engine composition", () => {
  it("isolates public Engine event subscribers", async () => {
    const engine = await createEngine();
    await engine.workspaces.createWorkspace("workspace", "Workspace");
    const events: string[] = [];
    engine.application.subscribe((event) => {
      const key = Object.keys(event.frontier)[0];
      if (key) {
        (event.frontier as Record<string, number>)[key] = 999;
      }
      throw new Error("injected public listener failure after mutation attempt");
    });
    engine.application.subscribe((event) => events.push(event.kind));

    const result = await engine.application.execute(createNodeCommand());
    expect(result.status).toBe("published");
    expect(events).toEqual(["authority-advanced", "projection-published"]);
    expect(
      await engine.application.query({
        kind: "invocation",
        workspaceId: "workspace",
        invocationId: "create-node",
      }),
    ).toEqual({ status: "ok", value: result });
    await engine.close();
  });

  it("History restart 与多 channel", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "lode-proposal-engine-"));
    temporaryDirectories.push(dataRoot);
    const first = await createEngine({ persistence: { dataRoot } });
    await first.workspaces.createWorkspace("workspace", "Workspace");
    const written = await first.application.execute(createNodeCommand());
    await first.application.execute({
      ...createNodeCommand(),
      invocationId: "mobile-node",
      historyChannelId: "mobile",
      mutations: [
        {
          kind: "node-create",
          occurrenceId: "mobile-node-original",
          nodeId: "mobile-node",
          parentNodeId: "workspace",
          anchor: end,
        },
      ],
    });
    await first.close();

    const restarted = await createEngine({ persistence: { dataRoot } });
    await restarted.workspaces.createWorkspace("workspace", "Workspace");
    const retry = await restarted.application.execute(createNodeCommand());
    expect(retry.status).toBe("published");
    if (retry.status === "published" && written.status === "published") {
      expect(retry.receipt).toEqual(written.receipt);
    }
    expect(
      await restarted.application.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
      }),
    ).toMatchObject({
      status: "ok",
      value: { nodes: { node: { nodeId: "node" }, "mobile-node": { nodeId: "mobile-node" } } },
    });
    const desktopHistory = await restarted.application.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "desktop",
    });
    expect(desktopHistory).toMatchObject({
      status: "ok",
      value: { undo: { targetInvocationId: "create-node", headOrdinal: 1 } },
    });
    const mobileHistory = await restarted.application.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "mobile",
    });
    expect(mobileHistory).toMatchObject({
      status: "ok",
      value: { undo: { targetInvocationId: "mobile-node", headOrdinal: 1 } },
    });
    if (desktopHistory.status !== "ok" || !("undo" in desktopHistory.value) || !desktopHistory.value.undo) {
      throw new Error("Expected the restarted desktop History selection");
    }
    expect(
      (
        await restarted.application.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-desktop",
          actorId: "actor",
          selection: desktopHistory.value.undo,
        })
      ).status,
    ).toBe("published");
    expect(
      await restarted.application.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
      }),
    ).toMatchObject({
      status: "ok",
      value: { nodes: { "mobile-node": { nodeId: "mobile-node" } } },
    });
    await restarted.close();

    const afterUndoRestart = await createEngine({ persistence: { dataRoot } });
    await afterUndoRestart.workspaces.createWorkspace("workspace", "Workspace");
    const persistedMobileHistory = await afterUndoRestart.application.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "mobile",
    });
    if (
      persistedMobileHistory.status !== "ok" ||
      !("undo" in persistedMobileHistory.value) ||
      !persistedMobileHistory.value.undo
    ) {
      throw new Error("Expected the mobile History selection after desktop Undo restart");
    }
    expect(
      (
        await afterUndoRestart.application.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-mobile",
          actorId: "actor",
          selection: persistedMobileHistory.value.undo,
        })
      ).status,
    ).toBe("published");
    expect(
      await afterUndoRestart.application.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
      }),
    ).toMatchObject({ status: "ok", value: { nodes: {} } });
    await afterUndoRestart.close();
  });

  it("Review capability remains opaque and valid across a durable engine restart", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "lode-review-capability-"));
    temporaryDirectories.push(dataRoot);
    const first = await createEngine({ persistence: { dataRoot } });
    await first.workspaces.createWorkspace("workspace", "Workspace");
    expect(
      (
        await first.application.execute({
          ...createNodeCommand(),
          invocationId: "proposal-create",
          intent: "proposal",
          mutations: [
            {
              kind: "node-create",
              occurrenceId: "proposal-node-original",
              nodeId: "proposal-node",
              parentNodeId: "workspace",
              anchor: end,
            },
          ],
        })
      ).status,
    ).toBe("published");
    const review = await first.application.query({ kind: "review", workspaceId: "workspace" });
    if (review.status !== "ok" || !("hunks" in review.value) || !review.value.hunks[0]) {
      throw new Error("Expected a durable Review capability");
    }
    const selection = review.value.hunks[0].selection;
    await first.close();

    const restarted = await createEngine({ persistence: { dataRoot } });
    await restarted.workspaces.createWorkspace("workspace", "Workspace");
    expect(
      (
        await restarted.application.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          invocationId: "accept-after-restart",
          actorId: "reviewer",
          decision: "accept",
          selection,
        })
      ).status,
    ).toBe("published");
    expect(
      await restarted.application.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
      }),
    ).toMatchObject({
      status: "ok",
      value: { nodes: { "proposal-node": { nodeId: "proposal-node" } } },
    });
    await restarted.close();
  });

  it("production engine sync exchanges only Facts and publishes remote authority advances", async () => {
    const left = await createEngine();
    const right = await createEngine();
    await Promise.all([
      left.workspaces.createWorkspace("workspace", "Workspace"),
      right.workspaces.createWorkspace("workspace", "Workspace"),
    ]);
    const events: string[] = [];
    right.application.subscribe((event) => events.push(event.kind));
    await left.application.execute(createNodeCommand());

    await left.replicas.synchronize("workspace", right.replicas.peer("workspace"));

    expect(
      await right.application.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
      }),
    ).toMatchObject({ status: "ok", value: { nodes: { node: { nodeId: "node" } } } });
    expect(events).toContain("authority-advanced");
    expect(events).toContain("projection-published");
    await Promise.all([left.close(), right.close()]);
  });

  it("corrupt remote authority transitions once to fault and explicit recovery emits recovered", async () => {
    const engine = await createEngine();
    await engine.workspaces.createWorkspace("workspace", "Workspace");
    const events: string[] = [];
    engine.application.subscribe((event) => events.push(event.kind));
    const corrupt = new LoroDoc();
    corrupt.setPeerId("909");
    corrupt.getMap("derived").set("leak", "projection");
    corrupt.commit({ message: "corrupt-sync" });
    const bytes = corrupt.export({ mode: "snapshot" });
    await expect(engine.replicas.peer("workspace").send("facts", bytes)).rejects.toThrow();
    await expect(engine.replicas.peer("workspace").send("facts", bytes)).rejects.toThrow();
    expect(events.filter((kind) => kind === "projection-failed")).toHaveLength(1);
    expect((await engine.application.execute(createNodeCommand())).status).toBe("rejected");
    expect(await engine.workspaces.recoverAuthority("workspace")).toBe(true);
    expect(events.at(-1)).toBe("projection-recovered");
    expect((await engine.application.execute(createNodeCommand())).status).toBe("published");
    await engine.close();
  });

  it("engine close drains an in-flight Fact sync lease before closing durable storage", async () => {
    const engine = await createEngine();
    await engine.workspaces.createWorkspace("workspace", "Workspace");
    let enterProfile: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enterProfile = resolve;
    });
    let releaseProfile: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
      releaseProfile = resolve;
    });
    const syncing = engine.replicas.synchronize("workspace", {
      profile: async () => {
        enterProfile?.();
        await released;
        return [];
      },
      fetch: () => Promise.resolve(new Uint8Array()),
      send: () => Promise.resolve(),
    });
    await entered;
    let closed = false;
    const closing = engine.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    releaseProfile?.();
    await syncing;
    await closing;
  });
});

function createNodeCommand() {
  return {
    kind: "mutate",
    workspaceId: "workspace",
    invocationId: "create-node",
    actorId: "actor",
    intent: "direct",
    historyChannelId: "desktop",
    mutations: [
      {
        kind: "node-create",
        occurrenceId: "node-original",
        nodeId: "node",
        parentNodeId: "workspace",
        anchor: end,
      },
    ],
  } as const;
}

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
