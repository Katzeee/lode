import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fromJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { AppServerClient } from "@lode/client";
import { startAppServerDaemon } from "../../src/index.js";
import { openAuthedSession } from "./authed-session.js";

const dataRoots: string[] = [];

afterEach(async () => {
  for (const dataRoot of dataRoots.splice(0)) {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

describe("AppServer persistence", () => {
  it("starts with an empty persisted data root without creating workspaces", async () => {
    const dataRoot = await tempDataRoot();
    const server = await startAppServerDaemon({
      listen: "tcp://127.0.0.1:0",
      persistence: { dataRoot },
    });
    const client = new AppServerClient({ url: server.address });
    client.connect();
    try {
      await openAuthedSession(client);

      await expect(client.rpc.listWorkspaces({})).resolves.toMatchObject({ workspaces: [] });
    } finally {
      client.close();
      await server.stop();
    }
  });

  it("restores document data after AppServer restart", async () => {
    const dataRoot = await tempDataRoot();
    const first = await startPersistentServer(dataRoot);
    const workspace = await first.client.rpc.createWorkspace({
      workspaceId: "ws_main",
      displayName: "Personal",
    });
    const node = await first.client.rpc.createPlainNode({
      workspaceId: workspace.workspaceId,
    });
    await first.client.rpc.replaceNodeText({
      workspaceId: workspace.workspaceId,

      occurrenceId: node.occurrenceId,
      deltas: [{ insert: "Persist me" }],
    });
    await first.stop();

    const second = await startPersistentServer(dataRoot);
    try {
      const restored = await second.client.rpc.getNode({
        workspaceId: workspace.workspaceId,

        occurrenceId: node.occurrenceId,
      });
      expect(restored.occurrence?.deltas).toMatchObject([{ insert: "Persist me" }]);
    } finally {
      await second.stop();
    }
  });

  it("restores document data from snapshot plus remaining updates", async () => {
    const dataRoot = await tempDataRoot();
    const first = await startPersistentServer(dataRoot, 2);
    await first.client.rpc.createWorkspace({
      workspaceId: "ws_main",
      displayName: "Personal",
    });
    const node = await first.client.rpc.createPlainNode({
      workspaceId: "ws_main",
    });
    await first.client.rpc.replaceNodeText({
      workspaceId: "ws_main",

      occurrenceId: node.occurrenceId,
      deltas: [{ insert: "Snapshot base" }],
    });
    await first.client.rpc.setNodeProp({
      workspaceId: "ws_main",

      occurrenceId: node.occurrenceId,
      key: "status",
      value: fromJson(ValueSchema, "after-snapshot"),
    });
    await first.stop();

    const second = await startPersistentServer(dataRoot, 2);
    try {
      const restored = await second.client.rpc.getNode({
        workspaceId: "ws_main",

        occurrenceId: node.occurrenceId,
      });
      expect(restored.occurrence?.deltas).toMatchObject([{ insert: "Snapshot base" }]);
      expect(restored.occurrence?.props).toMatchObject({ status: "after-snapshot" });
    } finally {
      await second.stop();
    }
  });
});

async function tempDataRoot(): Promise<string> {
  const dataRoot = await mkdtemp(join(tmpdir(), "be-data-"));
  dataRoots.push(dataRoot);
  return dataRoot;
}

async function startPersistentServer(
  dataRoot: string,
  snapshotEveryUpdates?: number,
): Promise<{ client: AppServerClient; stop: () => Promise<void> }> {
  const server = await startAppServerDaemon({
    listen: "tcp://127.0.0.1:0",
    persistence: { dataRoot, ...(snapshotEveryUpdates ? { snapshotEveryUpdates } : {}) },
  });
  const client = new AppServerClient({ url: server.address });
  client.connect();
  await openAuthedSession(client);
  return {
    client,
    stop: async () => {
      client.close();
      await server.stop();
    },
  };
}
