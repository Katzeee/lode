import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAppServerClient } from "@lode/client";
import { Code } from "@connectrpc/connect";
import { afterEach, describe, expect, it } from "vitest";

import { startAppServerDaemon } from "../src/app-server-daemon.js";
import { dialTarget } from "../src/endpoint.js";

const accessToken = "lode-test-transport-access-token";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("local IPC typed EngineContract adapter", () => {
  it("preserves completion, retry and read-your-write semantics", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "lode-ipc-contract-"));
    temporaryDirectories.push(dataRoot);
    const daemon = await startAppServerDaemon({
      listen: "tcp://127.0.0.1:0",
      dataRoot,
      accessToken,
    });
    const client = createAppServerClient(dialTarget(daemon.address), accessToken);
    const unauthenticated = createAppServerClient(dialTarget(daemon.address), "wrong-token");
    try {
      await expect(unauthenticated.openWorkspace("workspace")).rejects.toMatchObject({
        code: Code.Unauthenticated,
      });
      expect(Object.keys(client).sort()).toEqual([
        "close",
        "engine",
        "openWorkspace",
        "recoverWorkspaceAuthority",
        "syncWorkspace",
      ]);
      expect(client).not.toHaveProperty("request");
      expect(client).not.toHaveProperty("rpc");
      await client.openWorkspace("workspace");
      const command = {
        kind: "mutate",
        workspaceId: "workspace",
        invocationId: "ipc-create",
        actorId: "actor",
        intent: "direct",
        historyChannelId: "desktop",
        mutations: [nodeAt("node", "workspace", "node-original")],
      } as const;
      const first = await client.engine.execute(command);
      expect(first.status).toBe("published");
      expect(await client.engine.execute(command)).toEqual(first);
      expect(
        await client.engine.query({
          kind: "projection",
          workspaceId: "workspace",
          view: "origin",
        }),
      ).toMatchObject({ status: "ok", value: { nodes: { node: { nodeId: "node" } } } });

      expect(
        await client.engine.execute({
          ...command,
          invocationId: "invalid-ipc",
          mutations: [{ kind: "future-mutation", extra: true }],
        } as never),
      ).toMatchObject({ status: "rejected", error: { code: "invalid-input" } });
      expect(
        await client.engine.query({
          kind: "projection",
          workspaceId: "workspace",
          view: "origin",
        }),
      ).toMatchObject({ status: "ok", value: { nodes: { node: { nodeId: "node" } } } });
    } finally {
      unauthenticated.close();
      client.close();
      await daemon.stop();
    }
  });

  it("daemon sync RPC composes the production Fact SyncExchange across replicas", async () => {
    const leftRoot = await mkdtemp(join(tmpdir(), "lode-ipc-sync-left-"));
    const rightRoot = await mkdtemp(join(tmpdir(), "lode-ipc-sync-right-"));
    temporaryDirectories.push(leftRoot, rightRoot);
    const leftDaemon = await startAppServerDaemon({
      listen: "tcp://127.0.0.1:0",
      dataRoot: leftRoot,
      accessToken,
    });
    const rightDaemon = await startAppServerDaemon({
      listen: "tcp://127.0.0.1:0",
      dataRoot: rightRoot,
      accessToken,
    });
    const left = createAppServerClient(dialTarget(leftDaemon.address), accessToken);
    const right = createAppServerClient(dialTarget(rightDaemon.address), accessToken);
    try {
      await Promise.all([left.openWorkspace("workspace"), right.openWorkspace("workspace")]);
      expect(
        (
          await left.engine.execute({
            kind: "mutate",
            workspaceId: "workspace",
            invocationId: "left-node",
            actorId: "left",
            intent: "direct",
            historyChannelId: "desktop",
            mutations: [nodeAt("from-left", "workspace", "from-left-original")],
          })
        ).status,
      ).toBe("published");

      await left.syncWorkspace("workspace", rightDaemon.address);

      expect(
        await right.engine.query({
          kind: "projection",
          workspaceId: "workspace",
          view: "origin",
        }),
      ).toMatchObject({
        status: "ok",
        value: { nodes: { "from-left": { nodeId: "from-left" } } },
      });
    } finally {
      left.close();
      right.close();
      await Promise.all([leftDaemon.stop(), rightDaemon.stop()]);
    }
  });
});

function nodeAt(nodeId: string, parentNodeId: string, occurrenceId: string) {
  return {
    kind: "node-create" as const,
    nodeId,
    occurrenceId,
    parentNodeId,
    anchor: { after: null, before: null, affinity: "after", fallback: "end" } as const,
  };
}
