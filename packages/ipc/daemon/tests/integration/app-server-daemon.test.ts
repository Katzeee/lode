import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppServerClient } from "@lode/client";
import { startAppServerDaemon, type AppServerDaemon } from "../../src/app-server-daemon.js";
import { tempListenUrl } from "@lode/test-utils";

describe("app server daemon runtime", () => {
  let daemon: AppServerDaemon | null = null;
  const dataRoots: string[] = [];

  afterEach(async () => {
    await daemon?.stop();
    daemon = null;
    for (const dataRoot of dataRoots.splice(0)) {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it("starts from a tcp listen URL and accepts client RPCs", async () => {
    daemon = await startAppServerDaemon({ listen: tempListenUrl() });

    const client = new AppServerClient({ url: daemon.address });
    client.connect();
    await client.rpc.sessionHello({ actor: { actorId: "daemon-test" } });
    await expect(client.rpc.listWorkspaces({})).resolves.toMatchObject({ workspaces: [] });
    client.close();
  });

  it("stops gracefully and closes transport connections", async () => {
    daemon = await startAppServerDaemon({ listen: tempListenUrl() });
    const client = new AppServerClient({ url: daemon.address });
    client.connect();

    await daemon.stop();
    daemon = null;

    await expect(client.rpc.listWorkspaces({})).rejects.toThrow();
    client.close();
  });

  it("persists workspace docs across daemon restarts with a data root", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "be-daemon-data-"));
    dataRoots.push(dataRoot);
    daemon = await startAppServerDaemon({ listen: tempListenUrl(), dataRoot });
    const first = new AppServerClient({ url: daemon.address });
    first.connect();
    await first.rpc.sessionHello({ actor: { actorId: "daemon-test" } });
    await first.rpc.createWorkspace({
      workspaceId: "ws_daemon",
      displayName: "Daemon",
    });
    await first.rpc.createWorkspaceDoc({
      workspaceId: "ws_daemon",
      docId: "main",
      displayName: "Main",
    });
    const node = await first.rpc.createPlainNode({
      workspaceId: "ws_daemon",
    });
    await first.rpc.replaceNodeText({
      workspaceId: "ws_daemon",

      occurrenceId: node.occurrenceId,
      deltas: [{ insert: "daemon persisted" }],
    });
    first.close();
    await daemon.stop();
    daemon = null;

    daemon = await startAppServerDaemon({ listen: tempListenUrl(), dataRoot });
    const second = new AppServerClient({ url: daemon.address });
    second.connect();
    await second.rpc.sessionHello({ actor: { actorId: "daemon-test" } });

    const restored = await second.rpc.getNode({
      workspaceId: "ws_daemon",

      occurrenceId: node.occurrenceId,
    });
    expect(restored.occurrence?.deltas).toMatchObject([{ insert: "daemon persisted" }]);
    second.close();
  });
});
