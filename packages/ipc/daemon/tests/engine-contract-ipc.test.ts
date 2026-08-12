import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAppServerClient } from "@lode/client";
import { afterEach, describe, expect, it } from "vitest";

import { startAppServerDaemon } from "../src/app-server-daemon.js";
import { dialTarget } from "../src/endpoint.js";

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
    const daemon = await startAppServerDaemon({ listen: "tcp://127.0.0.1:0", dataRoot });
    const client = createAppServerClient(dialTarget(daemon.address));
    try {
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
        mutations: [{ kind: "node-create", nodeId: "node" }],
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
    });
    const rightDaemon = await startAppServerDaemon({
      listen: "tcp://127.0.0.1:0",
      dataRoot: rightRoot,
    });
    const left = createAppServerClient(dialTarget(leftDaemon.address));
    const right = createAppServerClient(dialTarget(rightDaemon.address));
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
            mutations: [{ kind: "node-create", nodeId: "from-left" }],
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
