import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { AppServerClient } from "@lode/client";
import { startAppServerDaemon, type AppServerDaemon } from "../../src/index.js";
import { tempListenUrl } from "@lode/test-utils";
import {
  createTestWorkspaceAndDoc,
  TEST_WORKSPACE_ID as WORKSPACE_ID,
  withDefaultWorkspace,
  type TestRpc,
} from "../helpers/workspace.js";

describe("AppServer integration", () => {
  let server: AppServerDaemon;
  let client: AppServerClient;
  let rpc: TestRpc;

  beforeEach(async () => {
    server = await startAppServerDaemon({ listen: tempListenUrl() });
    client = new AppServerClient({ url: server.address });
    client.connect();
    await hello(client);
    await createTestWorkspaceAndDoc(client);
    rpc = withDefaultWorkspace(client);
  });

  afterEach(async () => {
    client.close();
    await server.stop();
  });

  it("creates and reads outline nodes through RPC", async () => {
    const node = await createNode({ props: { type: "task" } });

    const got = await getNode(node.occurrenceId);
    expect(got).toMatchObject({
      nodeId: node.nodeId,
      props: { type: "task" },
      occurrenceProps: {},
      deltas: [],
    });
    expect(got.parentOccurrenceId).toBeUndefined();
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

  it("removes the workspace doc through RPC (one doc per workspace; idempotent)", async () => {
    let docs = await client.rpc.listWorkspaceDocs({ workspaceId: WORKSPACE_ID });
    expect(docs.docIds).toEqual(["main"]);
    const removed = await client.rpc.removeWorkspaceDoc({
      workspaceId: WORKSPACE_ID,
      docId: "main",
    });
    expect(removed.value).toBe(true);
    docs = await client.rpc.listWorkspaceDocs({ workspaceId: WORKSPACE_ID });
    expect(docs.docIds).toEqual([]);
    const removedAgain = await client.rpc.removeWorkspaceDoc({
      workspaceId: WORKSPACE_ID,
      docId: "main",
    });
    expect(removedAgain.value).toBe(false);
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

  async function createNode(params: Record<string, unknown> = {}) {
    const init: Record<string, unknown> = { ...params };
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

async function hello(client: AppServerClient, actorId = "test-actor"): Promise<void> {
  await client.rpc.sessionHello({
    actor: { actorId },
    client: { name: "vitest" },
  });
}
