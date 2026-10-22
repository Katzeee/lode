import { describe, expect, it } from "vitest";
import { END_SEQUENCE_ANCHOR as anchor } from "@lode/sdk";
import { templateFixture as fixture } from "../../../tests/support/workspace/template-fixture.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";

describe("template materialization content and incarnation", () => {
  it("keeps a moved local copy as ordinary content while its instance resumes the source", async () => {
    const f = await fixture("9979");
    await f.edit([nodeAt("source", "tag", "source-original", { text: "Source" })], "setup");
    await f.edit([
      {
        kind: "template-node-edit",
        ownerNodeId: "two",
        templateNodeId: "source",
        sourcePath: [],
        intents: [{ kind: "set-content", content: { items: [{ kind: "text", value: "Local", attributes: {} }] } }],
      },
    ]);
    const copy = (await f.read("templateNodeInstances")).templateNodeInstances.find(
      (item) => item.ownerNodeId === "two",
    )!;
    const originalContent = (await f.read("nodes")).nodes[copy.instanceNodeId!]?.content;
    await f.edit([
      { kind: "occurrence-move", occurrenceId: copy.instanceOccurrenceId, parentNodeId: "workspace", anchor },
    ]);
    expect(
      (await f.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "two"),
    ).toMatchObject({ state: "linked", instanceNodeId: null });
    expect((await f.read("nodeOwners")).nodeOwners[copy.instanceNodeId!]).toBe("workspace");
    expect((await f.read("occurrences")).occurrences[copy.instanceOccurrenceId]).toMatchObject({
      nodeId: copy.instanceNodeId,
      parentNodeId: "workspace",
    });
    expect((await f.read("nodes")).nodes[copy.instanceNodeId!]?.content).toEqual(originalContent);
    await f.edit([{ kind: "occurrence-move", occurrenceId: copy.instanceOccurrenceId, parentNodeId: "two", anchor }]);
    expect(
      (await f.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "two"),
    ).toMatchObject(copy);
    expect((await f.read("nodes")).nodes[copy.instanceNodeId!]?.content).toEqual(originalContent);
    await f.close();
  });

  it("makes each new edit a distinct copy and redoes the same second copy without touching the first Trash identity", async () => {
    const f = await fixture("9976");
    await f.edit([nodeAt("source", "tag", "source-original", { text: "Source" })], "setup");
    const text = (value: string) => ({ items: [{ kind: "text" as const, value, attributes: {} }] });
    await f.edit([
      {
        kind: "template-node-edit",
        ownerNodeId: "two",
        templateNodeId: "source",
        sourcePath: [],
        intents: [{ kind: "set-content", content: text("Source first") }],
      },
    ]);
    const first = (await f.read("templateNodeInstances")).templateNodeInstances.find(
      (item) => item.ownerNodeId === "two",
    )!;
    await f.history("undo");
    await f.edit(
      [{ kind: "rich-text-splice", nodeId: "source", deleteAtomIds: [], anchor, insert: " changed" }],
      "other",
    );
    await f.edit([
      {
        kind: "template-node-edit",
        ownerNodeId: "two",
        templateNodeId: "source",
        sourcePath: [],
        intents: [{ kind: "set-content", content: text("Source changed second") }],
      },
    ]);
    const second = (await f.read("templateNodeInstances")).templateNodeInstances.find(
      (item) => item.ownerNodeId === "two",
    )!;
    expect(second.instanceNodeId).not.toBe(first.instanceNodeId);
    expect(second.instanceOccurrenceId).not.toBe(first.instanceOccurrenceId);
    const trash = (await f.read("workspaceSystemNodes")).workspaceSystemNodes.trash;
    for (let round = 0; round < 2; round += 1) {
      await f.history("undo");
      expect(
        (await f.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "two"),
      ).toMatchObject({ state: "linked", instanceNodeId: null });
      expect((await f.read("nodeOwners")).nodeOwners[second.instanceNodeId!]).toBe(trash);
      expect((await f.read("nodes")).nodes[second.instanceNodeId!]?.content).toEqual([]);
      await f.history("redo");
      expect(
        (await f.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "two"),
      ).toMatchObject(second);
      const nodes = (await f.read("nodes")).nodes;
      expect(
        nodes[second.instanceNodeId!]?.content
          .filter((item) => item.kind === "text")
          .map((item) => item.value)
          .join(""),
      ).toBe("Source changed second");
      expect((await f.read("nodeOwners")).nodeOwners[first.instanceNodeId!]).toBe(trash);
      expect((await f.read("occurrences")).occurrences[first.instanceOccurrenceId]).toMatchObject({
        nodeId: first.instanceNodeId,
        parentNodeId: trash,
      });
    }
    const beforeDelete = (await f.read("nodes")).nodes[second.instanceNodeId!]?.content;
    await f.edit([{ kind: "occurrence-delete", occurrenceId: second.instanceOccurrenceId }]);
    expect((await f.read("nodes")).nodes[second.instanceNodeId!]?.content).toEqual(beforeDelete);
    expect(
      (await f.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "two"),
    ).toMatchObject({ state: "linked", instanceNodeId: null });
    await f.close();
  });

  it("copies full source content and accepts edited content through ordinary text, Reference and alias Facts", async () => {
    const f = await fixture("9977");
    await f.edit([nodeAt("target", "workspace"), nodeAt("source", "tag", "source-original", { text: "A" })], "setup");
    const atom = (await f.read("nodes")).nodes.source?.content[0];
    if (!atom || atom.kind !== "text") {
      throw new Error("Source text is absent");
    }
    await f.edit(
      [
        {
          kind: "rich-text-mark",
          nodeId: "source",
          atomIds: [atom.id],
          key: "bold",
          value: { kind: "set", value: true },
        },
        {
          kind: "inline-reference-create",
          inlineReferenceId: "source-ref",
          hostNodeId: "source",
          targetNodeId: "target",
          anchor,
        },
        nodeAt("source-alias", "source", "source-alias-original", { text: "Alias" }),
        { kind: "inline-alias-attach", inlineReferenceId: "source-ref", aliasNodeId: "source-alias" },
      ],
      "setup",
    );
    await f.edit([
      { kind: "template-node-edit", ownerNodeId: "one", templateNodeId: "source", sourcePath: [], intents: [] },
    ]);
    const copy = (await f.read("templateNodeInstances")).templateNodeInstances.find(
      (item) => item.ownerNodeId === "one",
    )!;
    const nodes = (await f.read("nodes")).nodes;
    expect(nodes[copy.instanceNodeId!]?.content[0]).toMatchObject({
      kind: "text",
      value: "A",
      attributes: { bold: true },
    });
    const reference = nodes[copy.instanceNodeId!]?.content[1];
    expect(reference).toMatchObject({ kind: "inline-reference", targetNodeId: "target" });
    if (reference?.kind !== "inline-reference" || !reference.aliasNodeId) {
      throw new Error("Copied Reference alias is absent");
    }
    expect(reference.id).not.toBe("source-ref");
    expect(reference.aliasNodeId).not.toBe("source-alias");
    expect(
      nodes[reference.aliasNodeId]?.content
        .filter((item) => item.kind === "text")
        .map((item) => item.value)
        .join(""),
    ).toBe("Alias");
    await f.edit([
      {
        kind: "template-node-edit",
        ownerNodeId: "two",
        templateNodeId: "source",
        sourcePath: [],
        intents: [
          {
            kind: "set-content",
            content: {
              items: [
                { kind: "text", value: "Edited ", attributes: { italic: true } },
                { kind: "inline-reference", targetNodeId: "target" },
                { kind: "text", value: " suffix", attributes: {} },
              ],
            },
          },
        ],
      },
    ]);
    const edited = (await f.read("templateNodeInstances")).templateNodeInstances.find(
      (item) => item.ownerNodeId === "two",
    )!;
    const editedNode = (await f.read("nodes")).nodes[edited.instanceNodeId!];
    if (!editedNode) {
      throw new Error("Edited Node is absent");
    }
    const editedContent = editedNode.content;
    expect(editedContent.map((item) => (item.kind === "text" ? item.value : "@")).join("")).toBe("Edited @ suffix");
    expect(editedContent[0]).toMatchObject({ attributes: { italic: true } });
    await f.history("undo");
    expect(
      (await f.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "two"),
    ).toMatchObject({ state: "linked" });
    await f.history("redo");
    const values = (content: typeof editedContent) =>
      content.map((item) =>
        item.kind === "text"
          ? { kind: item.kind, value: item.value, attributes: item.attributes }
          : { kind: item.kind, id: item.id, targetNodeId: item.targetNodeId, aliasNodeId: item.aliasNodeId },
      );
    const restoredNode = (await f.read("nodes")).nodes[edited.instanceNodeId!];
    if (!restoredNode) {
      throw new Error("Restored Node is absent");
    }
    expect(values(restoredNode.content)).toEqual(values(editedContent));
    await f.close();
  });

  it("keeps external template References shared and removes only their appearance", async () => {
    const f = await fixture("9978");
    await f.edit(
      [
        nodeAt("source", "workspace", "source-original", { text: "Shared" }),
        { kind: "occurrence-create", nodeId: "source", occurrenceId: "template-ref", parentNodeId: "tag", anchor },
      ],
      "setup",
    );
    const instance = (await f.read("templateNodeInstances")).templateNodeInstances[0];
    expect(instance?.state).toBe("reference");
    expect(
      await f.workspace.execute({
        kind: "edit",
        workspaceId: "workspace",
        actorId: "local",
        historyChannelId: "local",
        invocationId: "forbidden-copy",
        intent: "direct",
        actions: [
          { kind: "template-node-edit", ownerNodeId: "one", templateNodeId: "source", sourcePath: [], intents: [] },
        ],
      }),
    ).toMatchObject({ status: "rejected" });
    await f.edit([{ kind: "rich-text-splice", nodeId: "source", deleteAtomIds: [], anchor, insert: " changed" }]);
    const graph = await f.read("occurrences");
    for (const item of (await f.read("templateNodeInstances")).templateNodeInstances) {
      expect(graph.occurrences[item.instanceOccurrenceId]?.nodeId).toBe("source");
    }
    await f.edit([{ kind: "occurrence-delete", occurrenceId: "template-ref" }]);
    expect((await f.read("templateNodeInstances")).templateNodeInstances).toEqual([]);
    expect((await f.read("nodeOwners")).nodeOwners.source).toBe("workspace");
    expect(
      (await f.read("nodes")).nodes.source?.content
        .filter((item) => item.kind === "text")
        .map((item) => item.value)
        .join(""),
    ).toBe("Shared changed");
    await f.close();
  });
});
