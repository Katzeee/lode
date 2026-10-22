import { describe, expect, it } from "vitest";
import type { EditAction, ProjectionPage, ProjectionPageSection } from "@lode/sdk";
import { END_SEQUENCE_ANCHOR as anchor } from "@lode/sdk";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { syncPair, testFactReplication } from "../../../tests/support/sync.js";
import { nodeAt, createSupertagApplication } from "../../../tests/support/workspace/edit-test-actions.js";
import { openTestWorkspace, type TestWorkspace } from "../../../tests/support/workspace/open-test-workspace.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { FactAuthority } from "./authority/fact-authority.js";

const restore: EditAction = {
  kind: "node-restore",
  nodeId: "source",
  occurrenceId: "source-occ",
  destination: { kind: "field", ownerNodeId: "destination", fieldDefinitionId: "field" },
  anchor,
};

describe("restoring an Original into a logical Field destination", () => {
  it("materializes an empty Field and restores the same Original in one reversible paste", async () => {
    const { workspace } = await fixture("9211");
    await emptyField(workspace);
    await edit(workspace, "cut", [{ kind: "occurrence-delete", occurrenceId: "source-occ" }]);
    const trash = (await read(workspace, "workspaceSystemNodes")).workspaceSystemNodes.trash;
    await sourceAt(workspace, trash!);
    await edit(workspace, "paste", [restore]);
    const field = await materializedField(workspace);
    await sourceAt(workspace, field.fieldNodeId);
    expect(field.valueOccurrenceIds).toEqual(["source-occ"]);
    expect((await read(workspace, "childOccurrences")).childOccurrences.destination).toContain(field.fieldOccurrenceId);
    await history(workspace, "undo", "undo-paste");
    await emptyField(workspace);
    await sourceAt(workspace, trash!);
    expect((await read(workspace, "nodeOwners")).nodeOwners[field.fieldNodeId]).toBe(trash);
    await history(workspace, "undo", "undo-cut");
    await sourceAt(workspace, "parent");
    await emptyField(workspace);
    await history(workspace, "redo", "redo-cut");
    await sourceAt(workspace, trash!);
    await history(workspace, "redo", "redo-paste");
    expect((await materializedField(workspace)).fieldNodeId).toBe(field.fieldNodeId);
    await sourceAt(workspace, field.fieldNodeId);
    await workspace.close();
  });

  it("preserves a logical destination through Proposal, storage reopen and Fact replication", async () => {
    const documents = new InMemoryDocumentStore();
    const opened = await fixture("9212", documents);
    await edit(opened.workspace, "cut", [{ kind: "occurrence-delete", occurrenceId: "source-occ" }]);
    await edit(opened.workspace, "paste", [restore], "proposal");
    await emptyField(opened.workspace);
    const proposed = await materializedField(opened.workspace, "review");
    await sourceAt(opened.workspace, proposed.fieldNodeId, "review");
    await acceptReview(opened.workspace);
    await sourceAt(opened.workspace, proposed.fieldNodeId);
    await opened.workspace.close();
    const restarted = await open("9213", documents);
    expect((await materializedField(restarted.workspace)).valueOccurrenceIds).toEqual(["source-occ"]);
    await sourceAt(restarted.workspace, proposed.fieldNodeId);
    const replica = await open("9214");
    await syncPair(testFactReplication(restarted.facts.replication), testFactReplication(replica.facts.replication));
    await replica.workspace.reconcileAuthorityAdvance();
    await sourceAt(replica.workspace, proposed.fieldNodeId);
    expect(await materializedField(replica.workspace)).toEqual(await materializedField(restarted.workspace));
    await restarted.workspace.close();
    await replica.workspace.close();
  });

  it("uses an existing Field and rejects invalid restoration without publishing an empty container", async () => {
    const { workspace } = await fixture("9215");
    const before = await read(workspace, "nodes");
    expect(await execute(workspace, "not-cut", [restore])).toMatchObject({ status: "rejected" });
    expect((await read(workspace, "nodes")).nodes).toEqual(before.nodes);
    await emptyField(workspace);
    await edit(workspace, "cut", [{ kind: "occurrence-delete", occurrenceId: "source-occ" }]);
    expect(
      await execute(workspace, "invalid-field", [
        { ...restore, destination: { kind: "field", ownerNodeId: "destination", fieldDefinitionId: "absent" } },
      ]),
    ).toMatchObject({ status: "rejected" });
    await emptyField(workspace);
    await edit(
      workspace,
      "existing-value",
      [
        {
          kind: "field-value-create",
          ownerNodeId: "destination",
          fieldDefinitionId: "field",
          valueNodeId: "existing",
          valueOccurrenceId: "existing-occ",
          anchor,
        },
      ],
      "direct",
      "other",
    );
    const existing = await materializedField(workspace);
    await edit(workspace, "paste", [restore]);
    expect(await materializedField(workspace)).toMatchObject({
      fieldNodeId: existing.fieldNodeId,
      valueOccurrenceIds: ["existing-occ", "source-occ"],
    });
    await history(workspace, "undo", "undo-paste");
    expect((await materializedField(workspace)).valueOccurrenceIds).toEqual(["existing-occ"]);
    await workspace.close();
  });
});

async function fixture(peer: `${number}`, documents = new InMemoryDocumentStore()) {
  const opened = await open(peer, documents);
  await edit(
    opened.workspace,
    "fixture",
    [
      nodeAt("parent", "workspace"),
      nodeAt("source", "parent", "source-occ", { text: "Cut into empty field" }),
      nodeAt("child", "source", "child-occ", { text: "Preserved child" }),
      nodeAt("observer", "workspace"),
      {
        kind: "occurrence-create",
        occurrenceId: "source-reference",
        nodeId: "source",
        parentNodeId: "observer",
        anchor,
      },
      nodeAt("destination", "workspace"),
      nodeAt("marker", "workspace", undefined, { intrinsicNodeType: "supertag-definition" }),
      { kind: "supertag-template-field-create", supertagId: "marker", fieldDefinitionId: "field", anchor },
      createSupertagApplication("destination", "marker"),
    ],
    "direct",
    "setup",
  );
  return opened;
}

async function open(loroPeerId: `${number}`, documents = new InMemoryDocumentStore()) {
  const facts = await FactAuthority.open({ workspaceId: "workspace", loroPeerId, documents });
  return { facts, workspace: await openTestWorkspace({ workspaceId: "workspace", facts, versions }) };
}

async function execute(
  workspace: TestWorkspace,
  invocationId: string,
  actions: readonly EditAction[],
  intent: "direct" | "proposal" = "direct",
  channel = "clipboard",
) {
  return workspace.execute({
    kind: "edit",
    workspaceId: "workspace",
    actorId: "actor",
    invocationId,
    historyChannelId: channel,
    intent,
    actions,
  });
}
async function edit(
  workspace: TestWorkspace,
  invocationId: string,
  actions: readonly EditAction[],
  intent: "direct" | "proposal" = "direct",
  channel = "clipboard",
) {
  const result = await execute(workspace, invocationId, actions, intent, channel);
  expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
}

async function read<S extends ProjectionPageSection>(
  workspace: TestWorkspace,
  section: S,
  perspective: "origin" | "review" = "origin",
): Promise<ProjectionPage<S>> {
  const result = await workspace.query({ kind: "projection", workspaceId: "workspace", perspective, section });
  if (!("section" in result) || result.section !== section) {
    throw new Error(`Expected ${section}`);
  }
  return result as ProjectionPage<S>;
}

async function materializedField(workspace: TestWorkspace, perspective: "origin" | "review" = "origin") {
  const field = (await read(workspace, "materializedFields", perspective)).materializedFields.destination?.[0];
  if (!field) {
    throw new Error("Expected destination Field");
  }
  return field;
}

async function emptyField(workspace: TestWorkspace) {
  expect((await read(workspace, "materializedFields")).materializedFields.destination ?? []).toEqual([]);
  expect((await read(workspace, "effectiveFields")).effectiveFields.destination).toEqual(
    expect.arrayContaining([expect.objectContaining({ fieldDefinitionId: "field", materializedFieldNodeId: null })]),
  );
}

async function sourceAt(workspace: TestWorkspace, parentNodeId: string, perspective: "origin" | "review" = "origin") {
  const owners = (await read(workspace, "nodeOwners", perspective)).nodeOwners;
  const occurrences = (await read(workspace, "occurrences", perspective)).occurrences;
  const children = (await read(workspace, "childOccurrences", perspective)).childOccurrences;
  expect(owners).toMatchObject({ source: parentNodeId, child: "source" });
  expect(occurrences["source-occ"]).toMatchObject({ nodeId: "source", parentNodeId });
  expect(occurrences["source-reference"]).toMatchObject({ nodeId: "source", parentNodeId: "observer" });
  expect(children[parentNodeId]).toContain("source-occ");
  expect(children.source).toEqual(["child-occ"]);
  const source = (await read(workspace, "nodes", perspective)).nodes.source;
  expect(source?.content.flatMap((item) => (item.kind === "text" ? [item.value] : [])).join("")).toBe(
    "Cut into empty field",
  );
}

async function history(workspace: TestWorkspace, kind: "undo" | "redo", invocationId: string) {
  const state = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "clipboard" });
  if (!(kind in state) || !state[kind]) {
    throw new Error(`Expected ${kind}`);
  }
  const result = await workspace.execute({
    kind,
    workspaceId: "workspace",
    actorId: "actor",
    invocationId,
    selection: state[kind],
  });
  expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
}

async function acceptReview(workspace: TestWorkspace) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const review = await workspace.query({ kind: "review", workspaceId: "workspace" });
    if (!("hunks" in review)) {
      throw new Error("Expected Review");
    }
    const hunk = review.hunks[0];
    if (!hunk) {
      return;
    }
    expect(
      await workspace.execute({
        kind: "resolve-review",
        workspaceId: "workspace",
        actorId: "reviewer",
        invocationId: `accept-${attempt}`,
        decision: "accept",
        selection: hunk.selection,
      }),
    ).toMatchObject({ status: "published" });
  }
  throw new Error("Review did not settle");
}
