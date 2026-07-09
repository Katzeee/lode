import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppServerClient, createSocketTransport } from "@lode/client";
import { startAppServerDaemon, type AppServerDaemon } from "../../src/index.js";
import { openAuthedSession } from "./authed-session.js";
import { createTestWorkspace, withDefaultWorkspace, type TestRpc } from "../helpers/workspace.js";

// Proves the single-root product policy: createWorkspace seeds the workspace's one root (named =
// displayName), and every node attaches under it. Single-root is now structural — createPlainNode
// takes a required parent, and createWorkspaceRoot is the only rooting entry — so there is no
// "no-parent" path left to refuse.
describe("single-root product policy", () => {
  let server: AppServerDaemon;
  let client: AppServerClient;
  let rpc: TestRpc;

  beforeEach(async () => {
    server = await startAppServerDaemon({ listen: "tcp://127.0.0.1:0" });
    client = new AppServerClient(createSocketTransport(server.address));
    client.connect();
    await openAuthedSession(client);
    await createTestWorkspace(client);
    rpc = withDefaultWorkspace(client);
  });

  afterEach(async () => {
    client.close();
    await server.stop();
  });

  it("createWorkspace seeds exactly one root named = displayName", async () => {
    const { roots } = await rpc.listRoots({});
    expect(roots).toHaveLength(1);
    expect(roots.at(0)!.deltas).toMatchObject([{ insert: "Test Workspace" }]);
  });

  it("attaches a child when parentOccurrenceId is the seeded root", async () => {
    const { roots } = await rpc.listRoots({});
    const seededRootOccurrenceId = roots.at(0)!.occurrenceId;
    const child = await rpc.createPlainNode({ parentOccurrenceId: seededRootOccurrenceId });
    expect(child.parentOccurrenceId).toBe(seededRootOccurrenceId);
    // The tree is still single-rooted: listRoots returns only the seeded root.
    const after = await rpc.listRoots({});
    expect(after.roots).toHaveLength(1);
    expect(after.roots.at(0)!.occurrenceId).toBe(seededRootOccurrenceId);
  });
});
