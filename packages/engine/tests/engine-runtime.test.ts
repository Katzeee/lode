import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";

import { createEngineRuntime } from "../src/engine-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("fact-first EngineRuntime composition", () => {
  it("exposes one EngineContract capability for a dynamically opened Workspace", async () => {
    const runtime = await createEngineRuntime();
    await runtime.openWorkspace("workspace");
    const result = await runtime.engine.execute(createNodeCommand());
    expect(result.status).toBe("published");
    expect(
      await runtime.engine.query({ kind: "projection", workspaceId: "workspace", view: "origin" }),
    ).toMatchObject({ status: "ok", value: { nodes: { node: { nodeId: "node" } } } });
    await runtime.app.stop();
  });

  it("isolates public EngineRuntime event subscribers", async () => {
    const runtime = await createEngineRuntime();
    await runtime.openWorkspace("workspace");
    const events: string[] = [];
    runtime.engine.subscribe((event) => {
      const key = Object.keys(event.frontier)[0];
      if (key) {
        (event.frontier as Record<string, number>)[key] = 999;
      }
      throw new Error("injected public listener failure after mutation attempt");
    });
    runtime.engine.subscribe((event) => events.push(event.kind));

    const result = await runtime.engine.execute(createNodeCommand());
    expect(result.status).toBe("published");
    expect(events).toEqual(["authority-advanced", "projection-published"]);
    expect(
      await runtime.engine.query({
        kind: "invocation",
        workspaceId: "workspace",
        invocationId: "create-node",
      }),
    ).toEqual({ status: "ok", value: result });
    await runtime.app.stop();
  });

  it("History restart 与多 channel", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "lode-proposal-runtime-"));
    temporaryDirectories.push(dataRoot);
    const first = await createEngineRuntime({ persistence: { dataRoot } });
    await first.openWorkspace("workspace");
    const written = await first.engine.execute(createNodeCommand());
    await first.engine.execute({
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
    await first.app.stop();

    const restarted = await createEngineRuntime({ persistence: { dataRoot } });
    await restarted.openWorkspace("workspace");
    const retry = await restarted.engine.execute(createNodeCommand());
    expect(retry.status).toBe("published");
    if (retry.status === "published" && written.status === "published") {
      expect(retry.receipt).toEqual(written.receipt);
    }
    expect(
      await restarted.engine.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
      }),
    ).toMatchObject({
      status: "ok",
      value: { nodes: { node: { nodeId: "node" }, "mobile-node": { nodeId: "mobile-node" } } },
    });
    const desktopHistory = await restarted.engine.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "desktop",
    });
    expect(desktopHistory).toMatchObject({
      status: "ok",
      value: { undo: { targetInvocationId: "create-node", headOrdinal: 1 } },
    });
    const mobileHistory = await restarted.engine.query({
      kind: "history",
      workspaceId: "workspace",
      channelId: "mobile",
    });
    expect(mobileHistory).toMatchObject({
      status: "ok",
      value: { undo: { targetInvocationId: "mobile-node", headOrdinal: 1 } },
    });
    if (
      desktopHistory.status !== "ok" ||
      !("undo" in desktopHistory.value) ||
      !desktopHistory.value.undo
    ) {
      throw new Error("Expected the restarted desktop History selection");
    }
    expect(
      (
        await restarted.engine.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-desktop",
          actorId: "actor",
          selection: desktopHistory.value.undo,
        })
      ).status,
    ).toBe("published");
    expect(
      await restarted.engine.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
      }),
    ).toMatchObject({
      status: "ok",
      value: { nodes: { "mobile-node": { nodeId: "mobile-node" } } },
    });
    await restarted.app.stop();

    const afterUndoRestart = await createEngineRuntime({ persistence: { dataRoot } });
    await afterUndoRestart.openWorkspace("workspace");
    const persistedMobileHistory = await afterUndoRestart.engine.query({
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
        await afterUndoRestart.engine.execute({
          kind: "undo",
          workspaceId: "workspace",
          invocationId: "undo-mobile",
          actorId: "actor",
          selection: persistedMobileHistory.value.undo,
        })
      ).status,
    ).toBe("published");
    expect(
      await afterUndoRestart.engine.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
      }),
    ).toMatchObject({ status: "ok", value: { nodes: {} } });
    await afterUndoRestart.app.stop();
  });

  it("Review capability remains opaque and valid across a durable runtime restart", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "lode-review-capability-"));
    temporaryDirectories.push(dataRoot);
    const first = await createEngineRuntime({ persistence: { dataRoot } });
    await first.openWorkspace("workspace");
    expect(
      (
        await first.engine.execute({
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
    const review = await first.engine.query({ kind: "review", workspaceId: "workspace" });
    if (review.status !== "ok" || !("hunks" in review.value) || !review.value.hunks[0]) {
      throw new Error("Expected a durable Review capability");
    }
    const selection = review.value.hunks[0].selection;
    await first.app.stop();

    const restarted = await createEngineRuntime({ persistence: { dataRoot } });
    await restarted.openWorkspace("workspace");
    expect(
      (
        await restarted.engine.execute({
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
      await restarted.engine.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
      }),
    ).toMatchObject({
      status: "ok",
      value: { nodes: { "proposal-node": { nodeId: "proposal-node" } } },
    });
    await restarted.app.stop();
  });

  it("production runtime sync exchanges only Facts and publishes remote authority advances", async () => {
    const left = await createEngineRuntime();
    const right = await createEngineRuntime();
    await Promise.all([left.openWorkspace("workspace"), right.openWorkspace("workspace")]);
    const events: string[] = [];
    right.engine.subscribe((event) => events.push(event.kind));
    await left.engine.execute(createNodeCommand());

    await left.syncWorkspaceWith("workspace", right);

    expect(
      await right.engine.query({
        kind: "projection",
        workspaceId: "workspace",
        view: "origin",
      }),
    ).toMatchObject({ status: "ok", value: { nodes: { node: { nodeId: "node" } } } });
    expect(events).toContain("authority-advanced");
    expect(events).toContain("projection-published");
    await Promise.all([left.app.stop(), right.app.stop()]);
  });

  it("corrupt remote authority transitions once to fault and explicit recovery emits recovered", async () => {
    const runtime = await createEngineRuntime();
    await runtime.openWorkspace("workspace");
    const events: string[] = [];
    runtime.engine.subscribe((event) => events.push(event.kind));
    const corrupt = new LoroDoc();
    corrupt.setPeerId("909");
    corrupt.getMap("derived").set("leak", "projection");
    corrupt.commit({ message: "corrupt-sync" });
    const bytes = corrupt.export({ mode: "snapshot" });
    await expect(
      runtime.workspaceSyncTransport("workspace").send("facts", bytes),
    ).rejects.toThrow();
    await expect(
      runtime.workspaceSyncTransport("workspace").send("facts", bytes),
    ).rejects.toThrow();
    expect(events.filter((kind) => kind === "projection-failed")).toHaveLength(1);
    expect((await runtime.engine.execute(createNodeCommand())).status).toBe("rejected");
    expect(await runtime.recoverWorkspaceAuthority("workspace")).toBe(true);
    expect(events.at(-1)).toBe("projection-recovered");
    expect((await runtime.engine.execute(createNodeCommand())).status).toBe("published");
    await runtime.app.stop();
  });

  it("concurrent open is idempotent and close waits for workspace command serialization", async () => {
    const runtime = await createEngineRuntime();
    await Promise.all([
      runtime.openWorkspace("workspace"),
      runtime.openWorkspace("workspace"),
      runtime.openWorkspace("workspace"),
    ]);
    expect((await runtime.engine.execute(createNodeCommand())).status).toBe("published");
    expect(await runtime.closeWorkspace("workspace")).toBe(true);
    expect(await runtime.closeWorkspace("workspace")).toBe(false);
    await runtime.app.stop();
  });

  it("close drains an in-flight Fact sync lease before closing durable storage", async () => {
    const runtime = await createEngineRuntime();
    await runtime.openWorkspace("workspace");
    let enterProfile: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enterProfile = resolve;
    });
    let releaseProfile: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
      releaseProfile = resolve;
    });
    const syncing = runtime.syncWorkspace("workspace", {
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
    const closing = runtime.closeWorkspace("workspace").then((result) => {
      closed = true;
      return result;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    releaseProfile?.();
    await syncing;
    expect(await closing).toBe(true);
    await runtime.app.stop();
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
