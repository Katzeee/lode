import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fromJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { AppServerClient, createSocketTransport } from "@lode/client";
import { dialTarget } from "../../src/endpoint.js";
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
    const client = new AppServerClient(createSocketTransport(dialTarget(server.address)));
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
    // createWorkspace seeds the single root; write text to it and verify it survives restart.
    const seededRoot = await first.client.rpc.listRoots({
      workspaceId: workspace.workspaceId,
    });
    const seededOccurrenceId = seededRoot.roots.at(0)!.occurrenceId;
    await first.client.rpc.replaceNodeText({
      workspaceId: workspace.workspaceId,

      occurrenceId: seededOccurrenceId,
      deltas: [{ insert: "Persist me" }],
    });
    await first.stop();

    const second = await startPersistentServer(dataRoot);
    try {
      const restored = await second.client.rpc.getNode({
        workspaceId: workspace.workspaceId,

        occurrenceId: seededOccurrenceId,
      });
      expect(restored.occurrence?.deltas).toMatchObject([{ insert: "Persist me" }]);
    } finally {
      await second.stop();
    }
  });

  it("restores document data across restart via the `dataRoot` shortcut option", async () => {
    // The `dataRoot` shortcut vs the full `persistence: { dataRoot }` form (previous test): same
    // round-trip, different constructor shape. Both must restore after a restart.
    const dataRoot = await tempDataRoot();

    const first = await startAppServerDaemon({ listen: "tcp://127.0.0.1:0", dataRoot });
    const firstClient = new AppServerClient(createSocketTransport(dialTarget(first.address)));
    firstClient.connect();
    await openAuthedSession(firstClient);
    await firstClient.rpc.createWorkspace({ workspaceId: "ws_shortcut", displayName: "Shortcut" });
    const seededOccurrenceId = (
      await firstClient.rpc.listRoots({ workspaceId: "ws_shortcut" })
    ).roots.at(0)!.occurrenceId;
    await firstClient.rpc.replaceNodeText({
      workspaceId: "ws_shortcut",

      occurrenceId: seededOccurrenceId,
      deltas: [{ insert: "shortcut persisted" }],
    });
    firstClient.close();
    await first.stop();

    const second = await startAppServerDaemon({ listen: "tcp://127.0.0.1:0", dataRoot });
    const secondClient = new AppServerClient(createSocketTransport(dialTarget(second.address)));
    secondClient.connect();
    await openAuthedSession(secondClient);
    try {
      const restored = await secondClient.rpc.getNode({
        workspaceId: "ws_shortcut",

        occurrenceId: seededOccurrenceId,
      });
      expect(restored.occurrence?.deltas).toMatchObject([{ insert: "shortcut persisted" }]);
    } finally {
      secondClient.close();
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
    // createWorkspace seeds the single root; exercise snapshot+tail persistence against it.
    const seededRoot = await first.client.rpc.listRoots({
      workspaceId: "ws_main",
    });
    const seededOccurrenceId = seededRoot.roots.at(0)!.occurrenceId;
    await first.client.rpc.replaceNodeText({
      workspaceId: "ws_main",

      occurrenceId: seededOccurrenceId,
      deltas: [{ insert: "Snapshot base" }],
    });
    await first.client.rpc.setNodeProp({
      workspaceId: "ws_main",

      occurrenceId: seededOccurrenceId,
      key: "status",
      value: fromJson(ValueSchema, "after-snapshot"),
    });
    await first.stop();

    const second = await startPersistentServer(dataRoot, 2);
    try {
      const restored = await second.client.rpc.getNode({
        workspaceId: "ws_main",

        occurrenceId: seededOccurrenceId,
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
  const client = new AppServerClient(createSocketTransport(dialTarget(server.address)));
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
