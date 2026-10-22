import { describe, expect, it } from "vitest";
import { END_SEQUENCE_ANCHOR as anchor, type EditAction } from "@lode/sdk";
import { openTestWorkspace } from "../../../tests/support/workspace/open-test-workspace.js";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { FactAuthority } from "./authority/fact-authority.js";

describe("History restores complete content sequences", () => {
  it("preserves a foreign mark and source order across repeated multi-group Redo", async () => {
    const f = await fixture("9953");
    await f.edit([{ kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor, insert: "abc" }]);
    const [a, b, c] = await f.atoms();
    if (!a || !b || !c) {
      throw new Error("Source atoms absent");
    }
    await f.edit([
      {
        kind: "rich-text-splice",
        nodeId: "node",
        deleteAtomIds: [b.id],
        anchor: { ...anchor, after: a.id, before: c.id },
        insert: "",
      },
    ]);
    await f.history("undo");
    const restored = (await f.atoms())[1];
    if (!restored) {
      throw new Error("Restored atom absent");
    }
    await f.edit(
      [
        {
          kind: "rich-text-mark",
          nodeId: "node",
          atomIds: [restored.id],
          key: "bold",
          value: { kind: "set", value: true },
        },
      ],
      "other",
    );
    for (let round = 0; round < 4; round += 1) {
      await f.history("undo");
      expect(await f.content()).toEqual([]);
      await f.history("redo");
      expect((await f.atoms()).map((atom) => [atom.value, atom.attributes.bold ?? false])).toEqual([
        ["a", false],
        ["b", true],
        ["c", false],
      ]);
    }
    await f.workspace.close();
  });

  it("uses the complete invocation counterfactual for a mark followed by a replacement", async () => {
    const f = await fixture("9954");
    await f.edit([{ kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor, insert: "A" }], "setup");
    const ids = (await f.atoms()).map((atom) => atom.id);
    await f.edit([
      { kind: "rich-text-mark", nodeId: "node", atomIds: ids, key: "bold", value: { kind: "set", value: true } },
      { kind: "rich-text-splice", nodeId: "node", deleteAtomIds: ids, anchor, insert: "B" },
    ]);
    await f.history("undo");
    expect((await f.atoms()).map((atom) => [atom.value, atom.attributes])).toEqual([["A", {}]]);
    await f.history("redo");
    expect((await f.atoms()).map((atom) => [atom.value, atom.attributes])).toEqual([["B", {}]]);
    await f.workspace.close();
  });

  it("restores text and multiple inline References in their source order as one invocation", async () => {
    const f = await fixture("9955");
    await f.edit([{ kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor, insert: "abc" }], "setup");
    const [a, b, c] = await f.atoms();
    if (!a || !b || !c) {
      throw new Error("Source atoms absent");
    }
    await f.edit(
      [
        {
          kind: "inline-reference-create",
          inlineReferenceId: "first",
          hostNodeId: "node",
          targetNodeId: "p",
          anchor: { ...anchor, after: a.id, before: b.id },
        },
        {
          kind: "inline-reference-create",
          inlineReferenceId: "second",
          hostNodeId: "node",
          targetNodeId: "q",
          anchor: { ...anchor, after: b.id, before: c.id },
        },
      ],
      "setup",
    );
    const expected = (await f.content()).map((item) =>
      item.kind === "text" ? item.value : [item.id, item.targetNodeId],
    );
    expect(expected).toEqual(["a", ["first", "p"], "b", ["second", "q"], "c"]);
    await f.edit([
      { kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [a.id, b.id, c.id], anchor, insert: "" },
      { kind: "inline-reference-remove", inlineReferenceId: "first" },
      { kind: "inline-reference-remove", inlineReferenceId: "second" },
    ]);
    for (let round = 0; round < 3; round += 1) {
      await f.history("undo");
      expect(
        (await f.content()).map((item) => (item.kind === "text" ? item.value : [item.id, item.targetNodeId])),
      ).toEqual(expected);
      await f.history("redo");
      expect(await f.content()).toEqual([]);
    }
    await f.workspace.close();
  });
});

async function fixture(loroPeerId: `${number}`) {
  const facts = await FactAuthority.open({
    workspaceId: "workspace",
    documents: new InMemoryDocumentStore(),
    loroPeerId,
  });
  const workspace = await openTestWorkspace({ workspaceId: "workspace", facts, versions });
  let invocation = 0;
  async function edit(actions: readonly EditAction[], channel = "local") {
    const result = await workspace.execute({
      kind: "edit",
      workspaceId: "workspace",
      actorId: channel,
      invocationId: `order-${invocation++}`,
      intent: "direct",
      historyChannelId: channel,
      actions,
    });
    expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
  }
  async function content() {
    const result = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "nodes",
    });
    if (!("nodes" in result) || !result.nodes.node) {
      throw new Error("Target Node absent");
    }
    return result.nodes.node.content;
  }
  await edit([nodeAt("node", "workspace"), nodeAt("p", "workspace"), nodeAt("q", "workspace")], "setup");
  return {
    workspace,
    edit,
    content,
    atoms: async () => (await content()).filter((item) => item.kind === "text"),
    history: async (operation: "undo" | "redo") => {
      const result = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "local" });
      if (!(operation in result) || !result[operation]) {
        throw new Error(`Missing ${operation}`);
      }
      const write = await workspace.execute({
        kind: operation,
        workspaceId: "workspace",
        actorId: "local",
        invocationId: `history-${invocation++}`,
        selection: result[operation],
      });
      expect(write, JSON.stringify(write)).toMatchObject({ status: "published" });
    },
  };
}
