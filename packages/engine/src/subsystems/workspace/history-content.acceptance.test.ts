import { describe, expect, it } from "vitest";
import { END_SEQUENCE_ANCHOR as anchor, type EditAction, type EngineCommand } from "@lode/sdk";
import { openTestWorkspace } from "../../../tests/support/workspace/open-test-workspace.js";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { queryHistory } from "../../domain/history/index.js";
import { graphActionBody, parseFactBody } from "../../domain/fact/index.js";
import { FactAuthority } from "./authority/fact-authority.js";

describe("History content restoration provenance", () => {
  for (const replacement of ["B", ""] as const) {
    it(`composes insert, ${replacement === "" ? "delete" : "replace"}, Undo and Redo across newly restored atoms`, async () => {
      const f = await fixture(replacement === "" ? "9940" : "9941");
      await f.edit([splice([], "A")]);
      const original = (await f.content()).filter((item) => item.kind === "text").map((item) => item.id);
      await f.edit([splice(original, replacement)]);
      for (const [operation, value] of [
        ["undo", "A"],
        ["redo", replacement],
        ["undo", "A"],
        ["undo", ""],
        ["redo", "A"],
        ["redo", replacement],
        ["undo", "A"],
        ["undo", ""],
      ] as const) {
        await f.history(operation);
        expect(await f.text()).toBe(value);
      }
      await f.workspace.close();
    });
  }

  it("compensates every attributable part of a combined content and structural invocation", async () => {
    const f = await fixture("9942");
    await f.edit([move("p"), splice([], "A")]);
    await f.edit([move("q"), splice(await f.atomIds(), "B")]);
    await f.history("undo");
    expect(await f.text()).toBe("A");
    await f.history("undo");
    expect(await f.text()).toBe("");
    expect(await f.parent()).toBe("workspace");
    await f.history("redo");
    expect(await f.text()).toBe("A");
    expect(await f.parent()).toBe("p");
    await f.workspace.close();
  });

  it("preserves a different channel's identical text and anchors after restoring local content", async () => {
    const f = await fixture("9943");
    await f.edit([splice([], "A")]);
    await f.edit([splice(await f.atomIds(), "B")]);
    await f.history("undo");
    const restoredId = (await f.atomIds())[0];
    if (!restoredId) {
      throw new Error("Restored atom is absent");
    }
    await f.edit([{ ...splice([], "A"), anchor: { ...anchor, after: restoredId } }], "other");
    const remoteId = (await f.atomIds())[1];
    await f.history("undo");
    expect(await f.text()).toBe("A");
    expect(await f.atomIds()).toEqual([remoteId]);
    await f.workspace.close();
  });

  it("addresses current restored atoms when undoing an earlier formatting decision", async () => {
    const f = await fixture("9944");
    await f.edit([splice([], "A")], "setup");
    const originalIds = await f.atomIds();
    await f.edit([
      {
        kind: "rich-text-mark",
        nodeId: "node",
        atomIds: originalIds,
        key: "bold",
        value: { kind: "set", value: true },
      },
    ]);
    await f.edit([splice(originalIds, "")]);
    await f.history("undo");
    const restoredIds = await f.atomIds();
    expect(restoredIds).not.toEqual(originalIds);
    await f.history("undo");
    expect(await f.atomIds()).toEqual(restoredIds);
    expect((await f.content()).every((item) => item.kind !== "text" || item.attributes.bold === undefined)).toBe(true);
    await f.workspace.close();
  });

  it("preserves Reference identity while attributing its restored producer through History", async () => {
    const f = await fixture("9945");
    await f.edit([
      { kind: "inline-reference-create", inlineReferenceId: "inline", hostNodeId: "node", targetNodeId: "p", anchor },
    ]);
    await f.edit([{ kind: "inline-reference-remove", inlineReferenceId: "inline" }]);
    for (const [operation, exists] of [
      ["undo", true],
      ["undo", false],
      ["redo", true],
      ["redo", false],
    ] as const) {
      await f.history(operation);
      expect(
        (await f.content()).some(
          (item) => item.kind === "inline-reference" && item.id === "inline" && item.targetNodeId === "p",
        ),
      ).toBe(exists);
    }
    await f.workspace.close();
  });

  it("replays restoration provenance after closing and reopening the authority", async () => {
    const documents = new InMemoryDocumentStore();
    const f = await fixture("9946", documents);
    await f.edit([splice([], "A")]);
    await f.edit([splice(await f.atomIds(), "B")]);
    await f.history("undo");
    await f.workspace.close();
    const reopened = await fixture("9947", documents, false);
    await reopened.history("undo");
    expect(await reopened.text()).toBe("");
    await reopened.workspace.close();
  });

  it("replays restoration provenance from Fact-only replication without local receipts", async () => {
    const f = await fixture("9949");
    await f.edit([splice([], "A")]);
    await f.edit([splice(await f.atomIds(), "B")]);
    await f.history("undo");
    const documents = new InMemoryDocumentStore();
    await documents.appendUpdate("facts", await f.facts.replication.exportUpdate());
    const replica = await fixture("9950", documents, false);
    expect(replica.facts.receipts()).toEqual([]);
    await replica.history("undo");
    expect(await replica.text()).toBe("");
    await replica.workspace.close();
    await f.workspace.close();
  });

  it("rejects restoration claims unrelated to the target and keeps provenance outside ordinary Edit", async () => {
    const f = await fixture("9948");
    await f.edit([splice([], "A")]);
    await f.edit([{ ...splice([], "A"), nodeId: "p" }], "other");
    await f.edit([splice(await f.atomIds(), "B")]);
    await f.history("undo");
    const nodes = await f.workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "nodes",
    });
    if (!("nodes" in nodes)) {
      throw new Error("Nodes unavailable");
    }
    const foreign = nodes.nodes.p?.content[0];
    if (!foreign) {
      throw new Error("Foreign content unavailable");
    }
    const snapshot = f.facts.snapshot();
    const forged = {
      ...snapshot,
      facts: snapshot.facts.map((fact) =>
        fact.body.kind === "history" && fact.body.restorations.length > 0
          ? {
              ...fact,
              body: parseFactBody({
                ...fact.body,
                restorations: fact.body.restorations.map((restoration) => ({
                  ...restoration,
                  sources: [{ id: foreign.id, factActionId: foreign.factActionId }],
                })),
              }),
            }
          : fact,
      ),
    };
    expect(() => queryHistory("local", forged)).toThrow("removed by its target");
    const target = snapshot.facts
      .filter(
        (fact) => fact.body.kind === "history" && fact.body.operation === "normal" && fact.body.channelId === "local",
      )
      .at(-1);
    if (!target) {
      throw new Error("Target History step is absent");
    }
    await expect(
      f.facts.commit({
        invocationId: "forged-authority",
        request: { kind: "audit-forged-restoration" },
        writes: [
          graphActionBody("local", "direct", [
            { kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor, insert: "A" },
          ]),
          parseFactBody({
            kind: "history",
            channelId: "local",
            operation: "undo",
            targetStepId: target.id,
            actionFactCount: 1,
            restorations: [
              { factIndex: 0, actionIndex: 0, sources: [{ id: foreign.id, factActionId: foreign.factActionId }] },
            ],
          }),
        ],
        lineage: { channelId: "local", operation: "undo", targetStepId: target.id },
        publishedFrontier: snapshot.frontier,
      }),
    ).rejects.toThrow("removed by its target");
    expect(f.facts.snapshot()).toEqual(snapshot);
    const ordinary = await f.workspace.execute({
      kind: "edit",
      workspaceId: "workspace",
      actorId: "local",
      invocationId: "forged-command",
      intent: "direct",
      historyChannelId: "local",
      actions: [splice([], "X")],
      restorations: [],
    } as unknown as EngineCommand);
    expect(ordinary).toMatchObject({ status: "rejected" });
    expect(await f.text()).toBe("A");
    await f.workspace.close();
  });
});

function splice(
  deleteAtomIds: readonly `${string}#${number}`[],
  insert: string,
): Extract<EditAction, { kind: "rich-text-splice" }> {
  return {
    kind: "rich-text-splice",
    nodeId: "node",
    anchor,
    deleteAtomIds: deleteAtomIds as Extract<EditAction, { kind: "rich-text-splice" }>["deleteAtomIds"],
    insert,
  };
}
function move(parentNodeId: string): EditAction {
  return { kind: "occurrence-move", occurrenceId: "node-original", parentNodeId, anchor };
}
async function fixture(loroPeerId: `${number}`, documents = new InMemoryDocumentStore(), setup = true) {
  const facts = await FactAuthority.open({ workspaceId: "workspace", documents, loroPeerId });
  const workspace = await openTestWorkspace({ workspaceId: "workspace", facts, versions });
  let sequence = 0;
  async function edit(actions: readonly EditAction[], channel = "local") {
    expect(
      await workspace.execute({
        kind: "edit",
        workspaceId: "workspace",
        actorId: channel,
        invocationId: `${loroPeerId}-edit-${sequence++}`,
        intent: "direct",
        historyChannelId: channel,
        actions,
      }),
    ).toMatchObject({ status: "published" });
  }
  async function content() {
    const result = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section: "nodes",
    });
    if (!("nodes" in result) || !result.nodes.node) {
      throw new Error("Node unavailable");
    }
    return result.nodes.node.content;
  }
  if (setup) {
    await edit([nodeAt("node", "workspace"), nodeAt("p", "workspace"), nodeAt("q", "workspace")], "setup");
  }
  return {
    workspace,
    facts,
    edit,
    content,
    text: async () => (await content()).flatMap((item) => (item.kind === "text" ? [item.value] : [])).join(""),
    atomIds: async () => (await content()).filter((item) => item.kind === "text").map((item) => item.id),
    parent: async () => {
      const result = await workspace.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
        section: "occurrences",
      });
      return "occurrences" in result ? result.occurrences["node-original"]?.parentNodeId : undefined;
    },
    history: async (operation: "undo" | "redo") => {
      const result = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "local" });
      if (!(operation in result) || !result[operation]) {
        throw new Error(`Missing ${operation}`);
      }
      const write = await workspace.execute({
        kind: operation,
        workspaceId: "workspace",
        actorId: "local",
        invocationId: `${loroPeerId}-history-${sequence++}`,
        selection: result[operation],
      });
      expect(write, JSON.stringify(write)).toMatchObject({ status: "published" });
    },
  };
}
