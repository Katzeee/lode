import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { AppServerClient, createSocketTransport } from "@lode/client";
import { dialTarget } from "../../src/endpoint.js";
import { startAppServerDaemon, type AppServerDaemon } from "../../src/index.js";
import { openAuthedSession } from "./authed-session.js";
import { createTestWorkspace, withDefaultWorkspace, type TestRpc } from "../helpers/workspace.js";

describe("AppServer integration", () => {
  let server: AppServerDaemon;
  let client: AppServerClient;
  let rpc: TestRpc;
  let seededRootOccurrenceId: string | undefined;

  beforeEach(async () => {
    server = await startAppServerDaemon({ listen: "tcp://127.0.0.1:0" });
    client = new AppServerClient(createSocketTransport(dialTarget(server.address)));
    client.connect();
    await hello(client);
    await createTestWorkspace(client);
    rpc = withDefaultWorkspace(client);
    seededRootOccurrenceId = undefined;
  });

  afterEach(async () => {
    client.close();
    await server.stop();
  });

  it("creates and reads outline nodes through RPC", async () => {
    // createWorkspace seeds the single root; nodes created via createPlainNode attach under it.
    const seededRoot = await rpc.listRoots({});
    expect(seededRoot.roots).toHaveLength(1);
    const node = await createNode({ props: { type: "task" } });

    const got = await getNode(node.occurrenceId);
    expect(got).toMatchObject({
      nodeId: node.nodeId,
      props: { type: "task" },
      occurrenceProps: {},
      deltas: [],
    });
    expect(got.parentOccurrenceId).toBe(seededRoot.roots.at(0)!.occurrenceId);
  });

  it("reads the canonical occurrence by node id through RPC", async () => {
    const node = await createNode();
    await rpc.replaceNodeText({
      occurrenceId: node.occurrenceId,
      deltas: [{ insert: "Canonical title" }],
    });

    const got = await rpc.getNodeById({
      nodeId: node.nodeId,
    });
    expect(got.occurrence).toMatchObject({
      nodeId: node.nodeId,
      occurrenceId: node.occurrenceId,
      deltas: [{ insert: "Canonical title" }],
    });
    const missing = await rpc.getNodeById({
      nodeId: "missing-node",
    });
    expect(missing.occurrence).toBeUndefined();
  });

  it("exposes reference occurrences with shared text and semantic children", async () => {
    const source = await createNode();
    const holder = await createNode();
    const ref = await rpc.createRef({
      targetNodeId: source.nodeId,
      parentOccurrenceId: holder.occurrenceId,
    });
    const child = await createNode({ parentOccurrenceId: ref.occurrenceId });

    await rpc.replaceNodeText({
      occurrenceId: ref.occurrenceId,
      deltas: [{ insert: "shared" }],
    });

    const sourceNode = await getNode(source.occurrenceId);
    expect(sourceNode.deltas).toMatchObject([{ insert: "shared" }]);
    const children = await rpc.getNodeChildren({
      occurrenceId: ref.occurrenceId,
    });
    expect(children.children).toEqual([
      expect.objectContaining({ occurrenceId: child.occurrenceId }),
    ]);
  });

  it("clones an occurrence into an independent node through RPC", async () => {
    const source = await createNode();
    const holder = await createNode();

    await rpc.replaceNodeText({
      occurrenceId: source.occurrenceId,
      deltas: [{ insert: "source" }],
    });
    const clone = await rpc.cloneRef({
      occurrenceId: source.occurrenceId,
      parentOccurrenceId: holder.occurrenceId,
    });
    await rpc.replaceNodeText({
      occurrenceId: clone.occurrenceId,
      deltas: [{ insert: "clone" }],
    });

    expect(clone.nodeId).not.toBe(source.nodeId);
    expect((await getNode(source.occurrenceId)).deltas).toMatchObject([{ insert: "source" }]);
    expect((await getNode(clone.occurrenceId)).deltas).toMatchObject([{ insert: "clone" }]);
  });

  it("mutates occurrence placement and node lifecycle through RPC", async () => {
    const source = await createNode();
    const holder = await createNode();
    const otherParent = await createNode();
    const ref = await rpc.createRef({
      targetNodeId: source.nodeId,
      parentOccurrenceId: holder.occurrenceId,
    });

    await rpc.setNodeProp({
      occurrenceId: ref.occurrenceId,
      key: "status",
      value: fromJson(ValueSchema, "todo"),
    });
    await rpc.setOccurrenceProp({
      occurrenceId: ref.occurrenceId,
      key: "collapsed",
      value: fromJson(ValueSchema, true),
    });
    await rpc.moveNode({
      occurrenceId: ref.occurrenceId,
      parentOccurrenceId: otherParent.occurrenceId,
    });
    await rpc.promoteCanonicalNode({
      nodeId: source.nodeId,
      occurrenceId: ref.occurrenceId,
    });

    let got = await getNode(ref.occurrenceId);
    expect(got).toMatchObject({
      parentOccurrenceId: otherParent.occurrenceId,
      canonicalOccurrenceId: ref.occurrenceId,
      props: { status: "todo" },
      occurrenceProps: { collapsed: true },
    });
    await rpc.unsetNodeProp({
      occurrenceId: ref.occurrenceId,
      key: "status",
    });
    await rpc.unsetOccurrenceProp({
      occurrenceId: ref.occurrenceId,
      key: "collapsed",
    });
    got = await getNode(ref.occurrenceId);
    expect(got.props).toEqual({});
    expect(got.occurrenceProps).toEqual({});

    await rpc.hardDeleteNode({
      nodeId: source.nodeId,
    });
    const hardDeleted = await rpc.getNode({ occurrenceId: ref.occurrenceId });
    expect(hardDeleted.occurrence).toBeUndefined();
  });

  it("removes a non-canonical occurrence without deleting its node", async () => {
    const source = await createNode();
    const holder = await createNode();
    const ref = await rpc.createRef({
      targetNodeId: source.nodeId,
      parentOccurrenceId: holder.occurrenceId,
    });

    await rpc.removeNodeOccurrence({
      occurrenceId: ref.occurrenceId,
    });

    const removedRef = await rpc.getNode({ occurrenceId: ref.occurrenceId });
    expect(removedRef.occurrence).toBeUndefined();
    await expect(getNode(source.occurrenceId)).resolves.toMatchObject({
      nodeId: source.nodeId,
    });
  });

  it("exposes document history state through RPC", async () => {
    await createNode();

    const canUndo = await rpc.canUndoHistory({});
    expect(canUndo.value).toBe(true);
    const undo = await rpc.undoHistory({});
    expect(undo.value).toBe(true);
    const canRedo = await rpc.canRedoHistory({});
    expect(canRedo.value).toBe(true);
    const redo = await rpc.redoHistory({});
    expect(redo.value).toBe(true);
  });

  // createWorkspace always seeds the workspace's single root; nodes that don't specify a parent
  // attach under it (single-root product policy enforced in services/node.ts).
  async function createNode(params: Record<string, unknown> = {}) {
    const init: Record<string, unknown> = { ...params };
    if (!init.parentOccurrenceId) {
      if (seededRootOccurrenceId === undefined) {
        const roots = await rpc.listRoots({});
        seededRootOccurrenceId = roots.roots[0]?.occurrenceId;
      }
      init.parentOccurrenceId = seededRootOccurrenceId;
    }
    return rpc.createPlainNode(init);
  }

  async function getNode(occurrenceId: string) {
    const response = await rpc.getNode({ occurrenceId });
    if (response.occurrence === undefined) {
      throw new Error(`expected node at occurrence ${occurrenceId}`);
    }
    return response.occurrence;
  }
});

async function hello(client: AppServerClient, _actorId = "test-actor"): Promise<void> {
  await openAuthedSession(client, { client: { name: "vitest" } });
}
