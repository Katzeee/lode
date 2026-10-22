import { describe, expect, it } from "vitest";
import { END_SEQUENCE_ANCHOR as anchor } from "@lode/sdk";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";
import { templateInstanceNodeId } from "../../domain/fact/index.js";

import { templateFixture as fixture } from "../../../tests/support/workspace/template-fixture.js";

describe("ordinary template content is the Definition child graph", () => {
  it("interprets ordinary creation, movement and cut restoration through the same source graph", async () => {
    const f = await fixture("9970");
    await f.edit([nodeAt("created", "tag"), nodeAt("moved", "workspace")]);
    expect((await f.read("supertagTemplateNodes")).supertagTemplateNodes.tag).toEqual(["created"]);
    await f.edit([{ kind: "occurrence-move", occurrenceId: "moved-original", parentNodeId: "tag", anchor }]);
    expect((await f.read("supertagTemplateNodes")).supertagTemplateNodes.tag).toEqual(["created", "moved"]);
    expect((await f.read("templateNodeInstances")).templateNodeInstances).toHaveLength(4);
    await f.history("undo");
    expect((await f.read("supertagTemplateNodes")).supertagTemplateNodes.tag).toEqual(["created"]);
    await f.history("redo");
    await f.edit([{ kind: "occurrence-move", occurrenceId: "moved-original", parentNodeId: "workspace", anchor }]);
    expect(
      (await f.read("templateNodeInstances")).templateNodeInstances.every((item) => item.templateNodeId === "created"),
    ).toBe(true);
    await f.edit([{ kind: "occurrence-delete", occurrenceId: "moved-original" }]);
    await f.edit([
      {
        kind: "node-restore",
        nodeId: "moved",
        occurrenceId: "moved-original",
        destination: { kind: "node", nodeId: "tag" },
        anchor,
      },
    ]);
    expect((await f.read("supertagTemplateNodes")).supertagTemplateNodes.tag).toEqual(["created", "moved"]);
    expect((await f.read("nodeOwners")).nodeOwners.moved).toBe("tag");
    for (const host of ["one", "two"]) {
      expect(
        (await f.read("templateNodeInstances")).templateNodeInstances.filter((item) => item.ownerNodeId === host),
      ).toHaveLength(2);
      expect(Object.values((await f.read("nodeOwners")).nodeOwners).filter((owner) => owner === host)).toHaveLength(1);
    }
    await f.close();
  });

  it("derives Reference versus copy-on-write from current ownership and deletes a promoted Original into Trash", async () => {
    const f = await fixture("9971");
    await f.edit([
      nodeAt("source", "workspace"),
      { kind: "occurrence-create", nodeId: "source", occurrenceId: "source-in-template", parentNodeId: "tag", anchor },
    ]);
    expect((await f.read("templateNodeInstances")).templateNodeInstances.map((item) => item.state)).toEqual([
      "reference",
      "reference",
    ]);
    await f.edit([{ kind: "reference-promote", occurrenceId: "source-in-template" }]);
    expect((await f.read("nodeOwners")).nodeOwners.source).toBe("tag");
    expect((await f.read("templateNodeInstances")).templateNodeInstances.map((item) => item.state)).toEqual([
      "linked",
      "linked",
    ]);
    await f.edit([{ kind: "occurrence-delete", occurrenceId: "source-in-template" }]);
    const trash = (await f.read("workspaceSystemNodes")).workspaceSystemNodes.trash;
    expect((await f.read("nodeOwners")).nodeOwners.source).toBe(trash);
    expect((await f.read("occurrences")).occurrences["source-original"]).toMatchObject({
      nodeId: "source",
      parentNodeId: "workspace",
    });
    expect((await f.read("templateNodeInstances")).templateNodeInstances).toEqual([]);
    await f.history("undo");
    expect((await f.read("nodeOwners")).nodeOwners.source).toBe("tag");
    expect((await f.read("templateNodeInstances")).templateNodeInstances.map((item) => item.state)).toEqual([
      "linked",
      "linked",
    ]);
    await f.close();
  });

  it("undoes first instance editing back to its source while preserving the materialized Node in Trash", async () => {
    const documents = new InMemoryDocumentStore();
    const f = await fixture("9972", documents);
    await f.edit([nodeAt("source", "tag", "source-original", { text: "Source" })], "setup");
    const instance = (await f.read("templateNodeInstances")).templateNodeInstances.find(
      (item) => item.ownerNodeId === "two",
    )!;
    const instanceNodeId = templateInstanceNodeId("two", "source");
    await f.edit([
      { kind: "template-node-edit", ownerNodeId: "two", templateNodeId: "source", sourcePath: [], intents: [] },
      { kind: "rich-text-splice", nodeId: instanceNodeId, deleteAtomIds: [], anchor, insert: " local" },
    ]);
    expect(
      (await f.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "two"),
    ).toMatchObject({ state: "detached", instanceNodeId });
    await f.history("undo");
    const linked = (await f.read("templateNodeInstances")).templateNodeInstances.find(
      (item) => item.ownerNodeId === "two",
    )!;
    expect(linked).toMatchObject({ state: "linked", instanceNodeId: null });
    expect((await f.read("occurrences")).occurrences[linked.instanceOccurrenceId]?.nodeId).toBe("source");
    const trash = (await f.read("workspaceSystemNodes")).workspaceSystemNodes.trash;
    expect((await f.read("nodeOwners")).nodeOwners[instanceNodeId]).toBe(trash);
    expect((await f.read("occurrences")).occurrences[instance.instanceOccurrenceId]).toMatchObject({
      nodeId: instanceNodeId,
      parentNodeId: trash,
    });
    await f.edit(
      [{ kind: "rich-text-splice", nodeId: "source", deleteAtomIds: [], anchor, insert: " changed" }],
      "other",
    );
    expect(
      (await f.read("nodes")).nodes.source?.content
        .filter((item) => item.kind === "text")
        .map((item) => item.value)
        .join(""),
    ).toBe("Source changed");
    await f.close();
    const reopened = await fixture("9973", documents, false);
    expect(
      (await reopened.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "two"),
    ).toMatchObject({ state: "linked", instanceNodeId: null });
    await reopened.history("redo");
    expect(
      (await reopened.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "two"),
    ).toMatchObject({ state: "detached", instanceNodeId });
    await reopened.close();
  });

  it("exposes source movement and affected instances to Proposal review and replays the accepted graph without receipts", async () => {
    const f = await fixture("9974");
    await f.edit([nodeAt("source", "workspace")], "setup");
    await f.edit(
      [{ kind: "occurrence-move", occurrenceId: "source-original", parentNodeId: "tag", anchor }],
      "local",
      "proposal",
    );
    expect((await f.read("templateNodeInstances")).templateNodeInstances).toEqual([]);
    const review = await f.workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review) || !review.hunks[0]) {
      throw new Error("Expected structural source Hunk");
    }
    expect(
      await f.workspace.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        actorId: "reviewer",
        invocationId: "accept-move",
        decision: "accept",
        selection: review.hunks[0].selection,
      }),
    ).toMatchObject({ status: "published" });
    expect((await f.read("templateNodeInstances")).templateNodeInstances).toHaveLength(2);
    const documents = new InMemoryDocumentStore();
    await documents.appendUpdate("facts", await f.facts.replication.exportUpdate());
    const replica = await fixture("9975", documents, false);
    expect(replica.facts.receipts()).toEqual([]);
    expect((await replica.read("templateNodeInstances")).templateNodeInstances).toEqual(
      (await f.read("templateNodeInstances")).templateNodeInstances,
    );
    await replica.close();
    await f.close();
  });
});
