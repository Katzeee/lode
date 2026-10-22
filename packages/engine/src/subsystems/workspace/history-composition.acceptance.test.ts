import { describe, expect, it } from "vitest";
import {
  END_SEQUENCE_ANCHOR as anchor,
  type EditAction,
  type ProjectionPage,
  type ProjectionPageSection,
} from "@lode/sdk";
import { openTestWorkspace, type TestWorkspace } from "../../../tests/support/workspace/open-test-workspace.js";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { FactAuthority } from "./authority/fact-authority.js";

describe("History composition through public editing commands", () => {
  it("preserves another channel's later restoration while undoing the earlier restoration", async () => {
    const workspace = await fixture("9936");
    await publish(workspace, "initial-cut", [{ kind: "occurrence-delete", occurrenceId: "node-occ" }], "setup");
    await publish(workspace, "local-restore", [
      {
        kind: "node-restore",
        nodeId: "node",
        occurrenceId: "node-occ",
        destination: { kind: "node", nodeId: "p" },
        anchor,
      },
    ]);
    await publish(workspace, "other-cut", [{ kind: "occurrence-delete", occurrenceId: "node-occ" }], "other");
    await publish(
      workspace,
      "other-restore",
      [
        {
          kind: "node-restore",
          nodeId: "node",
          occurrenceId: "node-occ",
          destination: { kind: "node", nodeId: "q" },
          anchor,
        },
      ],
      "other",
    );
    expect(await history(workspace, "undo-local-restore", "undo")).toMatchObject({
      status: "rejected",
      error: { code: "history-unavailable" },
    });
    await assertLocation(workspace, "q");
    await workspace.close();
  });

  it("undoes and redoes consecutive moves without mistaking compensation for independent work", async () => {
    const workspace = await fixture("9930");
    await publish(workspace, "move-a", [move("p")]);
    await publish(workspace, "move-b", [move("q")]);
    for (const [invocationId, operation, parent] of [
      ["undo-b", "undo", "p"],
      ["redo-b-before-a", "redo", "q"],
      ["undo-redone-b-before-a", "undo", "p"],
      ["undo-a", "undo", "workspace"],
      ["redo-a", "redo", "p"],
      ["redo-b", "redo", "q"],
      ["undo-redo-b", "undo", "p"],
      ["undo-redo-a", "undo", "workspace"],
    ] as const) {
      expect(await history(workspace, invocationId, operation)).toMatchObject({ status: "published" });
      await assertLocation(workspace, parent);
    }
    await workspace.close();
  });

  it("preserves another channel's later text while reversing the local move sequence", async () => {
    const workspace = await fixture("9931");
    await publish(workspace, "move-a", [move("p")]);
    await publish(workspace, "move-b", [move("q")]);
    await publish(
      workspace,
      "remote-text",
      [{ kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor, insert: " shared" }],
      "other",
    );
    expect(await history(workspace, "undo-b", "undo")).toMatchObject({ status: "published" });
    expect(await history(workspace, "undo-a", "undo")).toMatchObject({ status: "published" });
    await assertLocation(workspace, "workspace");
    expect(
      (await targetNode(workspace)).content.flatMap((item) => (item.kind === "text" ? [item.value] : [])).join(""),
    ).toBe("Node shared");
    await workspace.close();
  });

  it("does not pull a Node back from another channel's later structural decision", async () => {
    const workspace = await fixture("9932");
    await publish(workspace, "move-a", [move("p")]);
    await publish(workspace, "move-b", [move("q")]);
    expect(await history(workspace, "undo-b", "undo")).toMatchObject({ status: "published" });
    await publish(workspace, "remote-move", [move("r")], "other");
    expect(await history(workspace, "undo-a", "undo")).toMatchObject({
      status: "rejected",
      error: { code: "history-unavailable" },
    });
    await assertLocation(workspace, "r");
    await workspace.close();
  });

  it("reverses a dependent multi-action invocation after a later move is undone", async () => {
    const workspace = await fixture("9933");
    await publish(workspace, "create-and-move", [nodeAt("container", "workspace"), move("container")]);
    await publish(workspace, "move-later", [move("q")]);
    expect(await history(workspace, "undo-later", "undo")).toMatchObject({ status: "published" });
    expect(await history(workspace, "undo-dependent", "undo")).toMatchObject({ status: "published" });
    await assertLocation(workspace, "workspace");
    const system = await read(workspace, "workspaceSystemNodes");
    expect((await read(workspace, "nodeOwners")).nodeOwners.container).toBe(system.workspaceSystemNodes.trash);
    expect(await history(workspace, "redo-dependent", "redo")).toMatchObject({ status: "published" });
    await assertLocation(workspace, "container");
    expect((await read(workspace, "nodeOwners")).nodeOwners.container).toBe("workspace");
    await workspace.close();
  });

  it("rejects the whole inverse when another channel still depends on its created parent", async () => {
    const workspace = await fixture("9934");
    await publish(workspace, "create-and-move", [nodeAt("container", "workspace"), move("container")]);
    await publish(workspace, "remote-child", [nodeAt("remote", "container")], "other");
    await publish(workspace, "move-later", [move("q")]);
    expect(await history(workspace, "undo-later", "undo")).toMatchObject({ status: "published" });
    expect(await history(workspace, "undo-dependent", "undo")).toMatchObject({
      status: "rejected",
      error: { code: "stale-selection" },
    });
    await assertLocation(workspace, "container");
    const owners = (await read(workspace, "nodeOwners")).nodeOwners;
    expect(owners.container).toBe("workspace");
    expect(owners.remote).toBe("container");
    await workspace.close();
  });

  it("uses the same attribution for successive formatting changes", async () => {
    const workspace = await fixture("9935");
    const atomIds = (await targetNode(workspace)).content.filter((item) => item.kind === "text").map((atom) => atom.id);
    await publish(workspace, "mark-a", [
      { kind: "rich-text-mark", nodeId: "node", atomIds, key: "color", value: { kind: "set", value: "red" } },
    ]);
    await publish(workspace, "mark-b", [
      { kind: "rich-text-mark", nodeId: "node", atomIds, key: "color", value: { kind: "set", value: "blue" } },
    ]);
    expect(await history(workspace, "undo-mark-b", "undo")).toMatchObject({ status: "published" });
    expect(await history(workspace, "undo-mark-a", "undo")).toMatchObject({ status: "published" });
    const atoms = (await targetNode(workspace)).content.filter((item) => item.kind === "text");
    expect(atoms.map((atom) => atom.id)).toEqual(atomIds);
    expect(atoms.every((atom) => atom.attributes.color == null)).toBe(true);
    await workspace.close();
  });
});

async function fixture(loroPeerId: `${number}`) {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    documents: new InMemoryDocumentStore(),
    loroPeerId,
  });
  const workspace = await openTestWorkspace({ workspaceId: "workspace", facts, versions });
  await publish(
    workspace,
    "setup",
    [
      nodeAt("node", "workspace", "node-occ", { text: "Node" }),
      nodeAt("child", "node", "child-occ"),
      nodeAt("references", "workspace"),
      ...["p", "q", "r"].map((id) => nodeAt(id, "workspace")),
      { kind: "occurrence-create", nodeId: "node", occurrenceId: "reference", parentNodeId: "references", anchor },
    ],
    "setup",
  );
  return workspace;
}
function move(parentNodeId: string): EditAction {
  return { kind: "occurrence-move", occurrenceId: "node-occ", parentNodeId, anchor };
}
async function publish(
  workspace: TestWorkspace,
  invocationId: string,
  actions: readonly EditAction[],
  channelId = "local",
) {
  const result = await workspace.execute({
    kind: "edit",
    workspaceId: "workspace",
    actorId: channelId,
    invocationId,
    intent: "direct",
    historyChannelId: channelId,
    actions,
  });
  expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
}
async function history(workspace: TestWorkspace, invocationId: string, operation: "undo" | "redo") {
  const result = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "local" });
  if (!(operation in result) || !result[operation]) {
    throw new Error(`Expected ${operation} selection`);
  }
  return workspace.execute({
    kind: operation,
    workspaceId: "workspace",
    actorId: "local",
    invocationId,
    selection: result[operation],
  });
}
async function read<S extends ProjectionPageSection>(workspace: TestWorkspace, section: S): Promise<ProjectionPage<S>> {
  const result = await workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "origin",
    section,
  });
  if (!("section" in result) || result.section !== section) {
    throw new Error(`Expected ${section}`);
  }
  return result as ProjectionPage<S>;
}
async function assertLocation(workspace: TestWorkspace, parentNodeId: string) {
  const occurrences = (await read(workspace, "occurrences")).occurrences;
  expect(occurrences["node-occ"]).toMatchObject({ nodeId: "node", parentNodeId });
  expect(occurrences.reference).toMatchObject({ nodeId: "node", parentNodeId: "references" });
  expect(occurrences["child-occ"]).toMatchObject({ nodeId: "child", parentNodeId: "node" });
  expect((await read(workspace, "nodeOwners")).nodeOwners.node).toBe(parentNodeId);
  expect((await read(workspace, "childOccurrences")).childOccurrences[parentNodeId]).toContain("node-occ");
}
async function targetNode(workspace: TestWorkspace) {
  const node = (await read(workspace, "nodes")).nodes.node;
  if (!node) {
    throw new Error("Target Node is absent");
  }
  return node;
}
