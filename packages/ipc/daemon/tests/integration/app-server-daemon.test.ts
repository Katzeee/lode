import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppServerClient, createSocketTransport } from "@lode/client";
import { startAppServerDaemon, type AppServerDaemon } from "../../src/app-server-daemon.js";
import { openAuthedSession } from "./authed-session.js";

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
    daemon = await startAppServerDaemon({ listen: "tcp://127.0.0.1:0" });

    const client = new AppServerClient(createSocketTransport(daemon.address));
    client.connect();
    await openAuthedSession(client);
    await expect(client.rpc.listWorkspaces({})).resolves.toMatchObject({ workspaces: [] });
    client.close();
  });

  it("stops gracefully and closes transport connections", async () => {
    daemon = await startAppServerDaemon({ listen: "tcp://127.0.0.1:0" });
    const client = new AppServerClient(createSocketTransport(daemon.address));
    client.connect();

    await daemon.stop();
    daemon = null;

    await expect(client.rpc.listWorkspaces({})).rejects.toThrow();
    client.close();
  });

  it("persists workspace docs across daemon restarts with a data root", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "be-daemon-data-"));
    dataRoots.push(dataRoot);
    daemon = await startAppServerDaemon({ listen: "tcp://127.0.0.1:0", dataRoot });
    const first = new AppServerClient(createSocketTransport(daemon.address));
    first.connect();
    await openAuthedSession(first);
    await first.rpc.createWorkspace({
      workspaceId: "ws_daemon",
      displayName: "Daemon",
    });
    // createWorkspace seeds the single root; exercise persistence against it directly.
    const seededRoot = await first.rpc.listRoots({
      workspaceId: "ws_daemon",
    });
    const seededOccurrenceId = seededRoot.roots.at(0)!.occurrenceId;
    await first.rpc.replaceNodeText({
      workspaceId: "ws_daemon",

      occurrenceId: seededOccurrenceId,
      deltas: [{ insert: "daemon persisted" }],
    });
    first.close();
    await daemon.stop();
    daemon = null;

    daemon = await startAppServerDaemon({ listen: "tcp://127.0.0.1:0", dataRoot });
    const second = new AppServerClient(createSocketTransport(daemon.address));
    second.connect();
    await openAuthedSession(second);

    const restored = await second.rpc.getNode({
      workspaceId: "ws_daemon",

      occurrenceId: seededOccurrenceId,
    });
    expect(restored.occurrence?.deltas).toMatchObject([{ insert: "daemon persisted" }]);
    second.close();
  });
});
